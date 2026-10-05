"""Compatible completed checkpoints; weights are verified again by the inference worker."""

import re
from pathlib import Path

from oracle.datasets.normalization import FEATURE_NAMES
from oracle.datasets.schema import Normalization
from oracle.datasets.storage import digest, read_json
from oracle.models.schema import MODEL_SCHEMA
from oracle.prediction.schema import ModelDescription


class ModelCatalog:
    def __init__(self, root: Path):
        self.root = root

    def checkpoint(self, identity: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
            raise ValueError("Invalid model identifier")
        path = (self.root / identity / "best.pt").resolve()
        if not path.is_relative_to(self.root.resolve()) or not path.is_file():
            raise ValueError("This local model is unavailable")
        if path.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("Checkpoint exceeds the local 64 MiB limit")
        return path

    def describe(self, identity: str) -> ModelDescription:
        path = self.checkpoint(identity)
        if read_json(path.parent / "status.json")["status"] != "complete":
            raise ValueError("Wait for this training run to complete")
        value = read_json(path.with_suffix(".metadata.json"))
        if value["schema"] != MODEL_SCHEMA or value["feature_names"] != FEATURE_NAMES:
            raise ValueError("Checkpoint feature schema is incompatible")
        normalizer = Normalization.model_validate(value["normalization"])
        dataset = value["dataset"]
        if (
            normalizer.feature_names != FEATURE_NAMES
            or digest(normalizer.model_dump(mode="json")) != dataset["normalization_sha256"]
        ):
            raise ValueError("Checkpoint normalization metadata is incompatible")
        return ModelDescription(
            id=identity,
            architecture=value["architecture"],
            epoch=value["epoch"],
            sha256=value["sha256"],
            dataset_id=dataset["id"],
            dataset_sha256=dataset["content_sha256"],
            normalization_sha256=dataset["normalization_sha256"],
            sample_stride=dataset["sample_stride"],
            sample_dt=dataset["sample_dt"],
            gravity=dataset["gravity"],
        )

    def list(self) -> dict:
        models, unavailable = [], []
        directories = sorted(self.root.iterdir()) if self.root.exists() else []
        for directory in directories:
            if not directory.is_dir() or not (directory / "best.metadata.json").exists():
                continue
            try:
                models.append(self.describe(directory.name).model_dump(mode="json"))
            except (ValueError, KeyError, TypeError, OSError):
                unavailable.append(directory.name)
        return {"models": models[:100], "unavailable": unavailable[:100]}
