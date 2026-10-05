"""Bounded, checksum-verified tensor checkpoints with explicit architecture and provenance."""

import hashlib
import time
from pathlib import Path

import torch

from oracle.datasets.normalization import FEATURE_NAMES
from oracle.datasets.schema import Normalization
from oracle.datasets.storage import digest, read_json, write_json
from oracle.models.dynamics import ObjectDynamics
from oracle.models.schema import MODEL_SCHEMA, ModelConfig
from oracle.training.schema import TrainConfig


def file_hash(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(part)
    return result.hexdigest()


def save_checkpoint(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".pt.tmp")
    torch.save(value, temporary)
    for attempt in range(8):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.01 * 2**attempt)
    metadata = {
        key: item
        for key, item in value.items()
        if key not in {"weights", "optimizer", "rng_state", "cuda_rng_state"}
    }
    write_json(path.with_suffix(".metadata.json"), {**metadata, "sha256": file_hash(path)})


def load_checkpoint(
    path: Path, expected_dataset: dict | None = None
) -> tuple[ObjectDynamics, dict]:
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Checkpoint exceeds the local 64 MiB limit")
    metadata = read_json(path.with_suffix(".metadata.json"))
    if file_hash(path) != metadata["sha256"]:
        raise ValueError("Checkpoint checksum mismatch")
    try:
        value = torch.load(path, map_location="cpu", weights_only=True)
        public = {
            key: item
            for key, item in value.items()
            if key not in {"weights", "optimizer", "rng_state", "cuda_rng_state"}
        }
        if digest(public) != digest(
            {key: item for key, item in metadata.items() if key != "sha256"}
        ):
            raise ValueError("Checkpoint metadata does not match its weights artifact")
        if value["schema"] != MODEL_SCHEMA or value["feature_names"] != FEATURE_NAMES:
            raise ValueError("Incompatible checkpoint schema")
        config = ModelConfig.model_validate(value["architecture"])
        TrainConfig.model_validate(value["config"])
        normalizer = Normalization.model_validate(value["normalization"])
        if (
            normalizer.feature_names != FEATURE_NAMES
            or value["config"]["model"] != value["architecture"]
        ):
            raise ValueError("Checkpoint feature or architecture metadata is incompatible")
        if digest(normalizer.model_dump(mode="json")) != value["dataset"]["normalization_sha256"]:
            raise ValueError("Checkpoint normalizer fingerprint mismatch")
        if expected_dataset and value["dataset"] != expected_dataset:
            raise ValueError("Checkpoint dataset identity or normalizer is incompatible")
        model = ObjectDynamics(config)
        model.load_state_dict(value["weights"], strict=True)
        if any(not torch.isfinite(weight).all() for weight in model.state_dict().values()):
            raise ValueError("Checkpoint contains non-finite weights")
    except (KeyError, TypeError, RuntimeError) as exc:
        raise ValueError("Checkpoint structure or weights are incompatible") from exc
    model.eval()
    return model, value
