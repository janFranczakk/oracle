"""Reversible annotations; never modify checkpoint weights or training metadata."""

import threading
from pathlib import Path

from oracle.datasets.storage import read_json, write_json
from oracle.prediction.catalog import ModelCatalog
from oracle.research.schema import CheckpointNotes


class CheckpointRegistry:
    def __init__(self, root: Path):
        self.catalog = ModelCatalog(root)
        self.root = root / ".research"
        self.lock = threading.Lock()

    def notes(self, identity: str) -> CheckpointNotes:
        path = self.root / f"{identity}.json"
        return (
            CheckpointNotes.model_validate(read_json(path)) if path.exists() else CheckpointNotes()
        )

    def list(self) -> dict:
        catalog = self.catalog.list()
        models = []
        for value in catalog["models"]:
            path = self.catalog.checkpoint(value["id"])
            try:
                metadata = read_json(path.with_suffix(".metadata.json"))
                notes = self.notes(value["id"])
                models.append(
                    {
                        **value,
                        **notes.model_dump(),
                        "parameters": metadata["parameters"],
                        "training_seed": metadata["config"]["seed"],
                        "bytes": path.stat().st_size,
                    }
                )
            except (OSError, ValueError, KeyError):
                catalog["unavailable"].append(value["id"])
        return {
            "models": sorted(models, key=lambda m: (not m["pinned"], m["id"])),
            "unavailable": sorted(set(catalog["unavailable"])),
        }

    def update(self, identity: str, notes: CheckpointNotes) -> dict:
        self.catalog.describe(identity)  # Validates containment, identity and completed status.
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            write_json(self.root / f"{identity}.json", notes.model_dump())
        return {"id": identity, **notes.model_dump()}
