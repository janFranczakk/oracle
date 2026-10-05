"""Deterministic local optimization, validation selection and atomic run artifacts."""

import os
import platform
import time
from datetime import UTC, datetime
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from oracle.datasets.engine import verify_dataset
from oracle.datasets.schema import Split
from oracle.datasets.storage import read_json, write_json
from oracle.models.dynamics import ObjectDynamics
from oracle.models.schema import MODEL_SCHEMA
from oracle.training.checkpoint import load_checkpoint, save_checkpoint
from oracle.training.data import Batch, SequenceDataset, collate
from oracle.training.evaluation import evaluate_model
from oracle.training.schema import TrainConfig


def configure_runtime(config: TrainConfig) -> None:
    if config.device == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable in this PyTorch installation; choose CPU")
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    torch.set_num_threads(config.threads)
    torch.manual_seed(config.seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False


def objective(output, batch: Batch, positive_weight: float, contact_weight: float):
    motion = (output.features[..., :7] - batch.targets[..., :7]).square()[batch.dynamic].mean()
    contacts = nn.functional.binary_cross_entropy_with_logits(
        output.contact_logits[batch.dynamic],
        batch.contacts[batch.dynamic],
        pos_weight=batch.inputs.new_tensor(positive_weight),
    )
    return motion + contact_weight * contacts, motion


def epoch(model, data, config, positive_weight, index, optimizer=None) -> tuple[float, float, int]:
    model.train(optimizer is not None)
    generator = torch.Generator().manual_seed(config.seed + index)
    loader = DataLoader(
        data,
        batch_size=config.batch_size,
        shuffle=optimizer is not None,
        generator=generator,
        collate_fn=collate,
    )
    total = motion_total = count = batches = 0
    with torch.set_grad_enabled(optimizer is not None):
        for batch in loader:
            batch = batch.to(config.device)
            output = model(batch.inputs, batch.mask, batch.dynamic)
            loss, motion = objective(output, batch, positive_weight, config.contact_weight)
            if not torch.isfinite(loss):
                raise ValueError("Optimization produced a non-finite objective")
            if optimizer is not None:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                optimizer.step()
            size = batch.dynamic.sum().item()
            total += loss.item() * size
            motion_total += motion.item() * size
            count += size
            batches += 1
    return total / count, motion_total / count, batches


def dataset_identity(data: SequenceDataset) -> dict:
    manifest = data.manifest
    return {
        "id": manifest.id,
        "content_sha256": manifest.content_sha256,
        "normalization_sha256": manifest.normalization_sha256,
        "sample_stride": manifest.config.sample_stride,
        "sample_dt": data.dt,
        "gravity": list(data.gravity),
    }


def runtime_identity(config: TrainConfig) -> dict:
    return {
        "torch": str(torch.__version__),
        "python": platform.python_version(),
        "platform": platform.system(),
        "device": config.device,
        "threads": config.threads,
    }


def train(root: Path, output: Path, config: TrainConfig, resume: Path | None = None) -> dict:
    configure_runtime(config)
    started = time.perf_counter()
    if not resume and output.exists() and any(output.iterdir()):
        # API creates only config + initial status before launching its worker.
        if {p.name for p in output.iterdir()} - {"config.json", "status.json", "worker.log"}:
            raise ValueError("Run output is not empty; use another directory or resume last.pt")
    output.mkdir(parents=True, exist_ok=True)
    initial = read_json(output / "status.json") if (output / "status.json").exists() else {}
    status = {
        "id": output.name,
        "status": "running",
        "phase": "verifying",
        "epoch": 0,
        "epochs": config.epochs,
        "family": config.model.family,
        "seed": config.seed,
        "device": config.device,
        "history": config.model.history,
        "created_at": initial.get("created_at", datetime.now(UTC).isoformat()),
        "interactive": initial.get("interactive", False),
    }
    if not resume:
        write_json(output / "status.json", status)
    verify_dataset(root)
    training = SequenceDataset(root, Split.TRAIN, config.model.history)
    validation = SequenceDataset(root, Split.VALIDATION, config.model.history)
    identity = dataset_identity(training)
    status.update(
        dataset_id=identity["id"], train_windows=len(training), validation_windows=len(validation)
    )
    model = ObjectDynamics(config.model).to(config.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=0.0001)
    positive_weight = training.contact_positive_weight()
    history, start_epoch, best, best_epoch, prior_elapsed = [], 0, float("inf"), 0, 0.0
    if resume:
        if resume.resolve() != (output / "last.pt").resolve():
            raise ValueError("Resume must use this run's last.pt checkpoint")
        loaded, value = load_checkpoint(resume, identity)
        if value["runtime"] != runtime_identity(config):
            raise ValueError(
                "Exact resume requires the original PyTorch, Python, platform and device"
            )
        previous = value["config"].copy()
        current = config.model_dump(mode="json")
        previous.pop("epochs")
        current.pop("epochs")
        if previous != current or config.epochs <= value["epoch"]:
            raise ValueError(
                "Resume preserves configuration and requires a larger total epoch count"
            )
        model.load_state_dict(loaded.state_dict())
        optimizer.load_state_dict(value["optimizer"])
        torch.set_rng_state(value["rng_state"])
        if config.device == "cuda":
            torch.cuda.set_rng_state_all(value["cuda_rng_state"])
        start_epoch, best, best_epoch = (
            value["epoch"],
            value["best_validation"],
            value["best_epoch"],
        )
        history = read_json(output / "metrics.json")["epochs"][:start_epoch]
        prior_elapsed = value["elapsed_seconds"]
    status.update(parameters=model.parameters_count, best_epoch=best_epoch, epoch=start_epoch)
    write_json(output / "status.json", status)
    write_json(
        output / "config.json", {"config": config.model_dump(mode="json"), "dataset": identity}
    )
    for index in range(start_epoch + 1, config.epochs + 1):
        epoch_start = time.perf_counter()
        status.update(phase="training", epoch=index - 1)
        write_json(output / "status.json", status)
        train_loss, train_motion, batches = epoch(
            model, training, config, positive_weight, index, optimizer
        )
        val_loss, val_motion, _ = epoch(model, validation, config, positive_weight, index)
        elapsed = prior_elapsed + time.perf_counter() - started
        history.append(
            {
                "epoch": index,
                "train_loss": train_loss,
                "validation_loss": val_loss,
                "train_motion_loss": train_motion,
                "validation_motion_loss": val_motion,
                "learning_rate": config.learning_rate,
                "batches": batches,
                "epoch_seconds": time.perf_counter() - epoch_start,
                "elapsed_seconds": elapsed,
            }
        )
        improved = val_loss < best
        if improved:
            best, best_epoch = val_loss, index
        checkpoint = {
            "schema": MODEL_SCHEMA,
            "feature_names": training.normalizer.feature_names,
            "architecture": config.model.model_dump(mode="json"),
            "config": config.model_dump(mode="json"),
            "normalization": training.normalizer.model_dump(mode="json"),
            "dataset": identity,
            "weights": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "epoch": index,
            "best_validation": best,
            "best_epoch": best_epoch,
            "elapsed_seconds": elapsed,
            "parameters": model.parameters_count,
            "contact_positive_weight": positive_weight,
            "rng_state": torch.get_rng_state(),
            "cuda_rng_state": torch.cuda.get_rng_state_all() if config.device == "cuda" else [],
            "runtime": runtime_identity(config),
        }
        if improved:
            save_checkpoint(output / "best.pt", checkpoint)
        save_checkpoint(output / "last.pt", checkpoint)
        write_json(output / "metrics.json", {"epochs": history})
        status.update(
            epoch=index, best_epoch=best_epoch, best_validation_loss=best, elapsed_seconds=elapsed
        )
        write_json(output / "status.json", status)
    selected, checkpoint = load_checkpoint(output / "best.pt", identity)
    selected.to(config.device)
    status.update(phase="evaluating")
    write_json(output / "status.json", status)

    def progress(group, completed, total):
        status.update(
            evaluation_group=group, evaluation_completed=completed, evaluation_total=total
        )
        write_json(output / "status.json", status)

    evaluation = evaluate_model(selected, root, config.horizons, config.device, progress)
    evaluation.update(
        dataset=identity,
        model_version=f"{output.name}/epoch-{checkpoint['epoch']}",
        selected_epoch=checkpoint["epoch"],
    )
    write_json(output / "evaluation.json", evaluation)
    status.update(
        status="complete",
        phase="ready",
        elapsed_seconds=prior_elapsed + time.perf_counter() - started,
    )
    write_json(output / "status.json", status)
    return status
