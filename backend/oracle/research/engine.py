"""Matched held-out scoring of fixed checkpoint weights, with measured CPU latency."""

import math
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

import torch

from oracle.datasets.schema import Split
from oracle.datasets.storage import digest, read_json, write_json
from oracle.research.schema import BatchRequest
from oracle.training.checkpoint import file_hash, load_checkpoint
from oracle.training.data import SequenceDataset, collate
from oracle.training.engine import configure_runtime, dataset_identity, runtime_identity
from oracle.training.evaluation import evaluate_group
from oracle.training.schema import TrainConfig


@torch.no_grad()
def benchmark(model, data: SequenceDataset, history: int) -> dict:
    episode = data.episodes[0]
    anchor = history - 1
    batch = collate(
        [
            (
                episode.inputs[anchor - data.history + 1 : anchor + 1],
                episode.inputs[anchor, :, :13],
                episode.contacts[anchor],
                episode.dynamic,
            )
        ]
    )
    model.eval()
    for _ in range(3):
        model(batch.inputs, batch.mask, batch.dynamic)
    elapsed = []
    for _ in range(10):
        started = time.perf_counter()
        model(batch.inputs, batch.mask, batch.dynamic)
        elapsed.append((time.perf_counter() - started) * 1000)
    return {
        "scope": "warmed_cpu_forward_only",
        "batch_size": 1,
        "warmup": 3,
        "repetitions": 10,
        "median_ms": statistics.median(elapsed),
        "p95_ms": sorted(elapsed)[math.ceil(0.95 * len(elapsed)) - 1],
        "episode_id": episode.id,
        "anchor": anchor,
        "objects": len(episode.dynamic),
    }


def run_batch(dataset: Path, output: Path, request: BatchRequest, checkpoints: list[dict]) -> dict:
    if output.exists() and {p.name for p in output.iterdir()} - {
        "request.json",
        "status.json",
        "worker.log",
    }:
        raise ValueError("Research output is not empty; choose a new batch directory")
    if [entry["id"] for entry in checkpoints] != request.models:
        raise ValueError("Checkpoint entries do not match the requested model order")
    output.mkdir(parents=True, exist_ok=True)
    initial = read_json(output / "status.json") if (output / "status.json").exists() else {}
    status = {
        **initial,
        "id": output.name,
        "status": "running",
        "phase": "verifying",
        "completed": 0,
        "total": len(request.models) * len(request.groups),
        "dataset_id": request.dataset_id,
        "created_at": initial.get("created_at", datetime.now(UTC).isoformat()),
    }

    def publish(**updates):
        status.update(updates)
        write_json(output / "status.json", status)

    publish()
    started = time.perf_counter()
    try:
        runtime = TrainConfig(threads=request.threads, seed=7)
        configure_runtime(runtime)
        loaded = []
        for entry in checkpoints:
            path = Path(entry["path"])
            if read_json(path.parent / "status.json")["status"] != "complete":
                raise ValueError("Wait for all selected training runs to complete")
            if file_hash(path) != entry["sha256"]:
                raise ValueError("A selected checkpoint changed after batch submission")
            model, metadata = load_checkpoint(path)
            loaded.append((entry, model, metadata))
        history = max(model.config.history for _, model, _ in loaded)
        identity = dataset_identity(SequenceDataset(dataset, Split.TRAIN, history))
        if identity["id"] != request.dataset_id or any(
            meta["dataset"] != identity for _, _, meta in loaded
        ):
            raise ValueError(
                "All checkpoints must match the dataset, normalizer and environment exactly"
            )
        results = []
        schedules = {}
        for entry, model, metadata in loaded:
            groups = {}
            latency = None
            for group in request.groups:
                if time.perf_counter() - started > 900:
                    raise ValueError("The research batch exceeded its 15-minute CPU deadline")
                publish(phase="evaluating", model_id=entry["id"], group=group)
                split, suite = (Split.TEST, None) if group == "test" else (Split.OOD, group[4:])
                data = SequenceDataset(dataset, split, model.config.history, suite)
                result = evaluate_group(model, data, request.horizons, anchor_history=history)
                schedule = digest(
                    {
                        "anchors": result["anchors"],
                        "windows": result["windows"],
                        "horizons": [r["horizon"] for r in result["rollout"]["learned"]],
                    }
                )
                if group in schedules and schedules[group] != schedule:
                    raise ValueError("Comparison sample schedules disagree")
                schedules[group] = schedule
                groups[group] = result
                if latency is None:
                    latency = {"group": group, **benchmark(model, data, history)}
                publish(completed=status["completed"] + 1)
            results.append(
                {
                    "id": entry["id"],
                    "label": entry.get("label", ""),
                    "checkpoint_sha256": entry["sha256"],
                    "architecture": model.config.model_dump(),
                    "parameters": metadata["parameters"],
                    "selected_epoch": metadata["epoch"],
                    "training_seed": metadata["config"]["seed"],
                    "bytes": Path(entry["path"]).stat().st_size,
                    "groups": groups,
                    "latency": latency,
                }
            )
        report = {
            "protocol": "oracle-research-comparison-v1",
            "id": output.name,
            "created_at": status["created_at"],
            "source": "learned_model",
            "point_forecast": "deterministic_eval",
            "dataset": identity,
            "request": request.model_dump(),
            "common_history": history,
            "schedule_sha256": schedules,
            "runtime": runtime_identity(runtime),
            "models": results,
            "elapsed_seconds": time.perf_counter() - started,
        }
        write_json(output / "report.json", report)
        publish(status="complete", phase="complete", elapsed_seconds=report["elapsed_seconds"])
        return report
    except Exception as exc:
        publish(
            status="failed",
            phase="failed",
            error=str(exc)
            if isinstance(exc, ValueError)
            else "The research worker failed. Inspect its local log.",
        )
        raise
