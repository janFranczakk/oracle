"""Local run catalog and bounded subprocess training. No PyTorch import in the API process."""

import importlib.util
import re
import subprocess
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from oracle.datasets.api import PROJECT_ROOT
from oracle.datasets.api import service as datasets
from oracle.datasets.storage import read_json, read_manifest, write_json
from oracle.training.schema import TrainRequest

router = APIRouter(prefix="/api/training", tags=["Learned dynamics training"])


class TrainingService:
    def __init__(self, root: Path):
        self.root = root
        self.processes: dict[str, subprocess.Popen] = {}
        self.lock = threading.Lock()

    def find(self, identity: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
            raise FileNotFoundError("Invalid run identifier")
        directory = self.root / identity
        if not directory.resolve().is_relative_to(self.root.resolve()) or not directory.is_dir():
            raise FileNotFoundError("Run is unavailable")
        return directory

    def status(self, identity: str) -> dict:
        root = self.find(identity)
        value = read_json(root / "status.json")
        process = self.processes.get(identity)
        if value["status"] == "running" and process and process.poll() is not None:
            # Completion can be published between the initial read and process exit.
            value = read_json(root / "status.json")
        if value["status"] == "running" and process and process.poll() is not None:
            value = {
                **value,
                "status": "failed",
                "phase": "failed",
                "error": "The training worker stopped. Inspect its local log.",
            }
            write_json(root / "status.json", value)
        return value

    def catalog(self) -> list[dict]:
        results = []
        if self.root.exists():
            for directory in self.root.iterdir():
                if not directory.is_dir() or not (directory / "status.json").exists():
                    continue
                try:
                    results.append(self.status(directory.name))
                except (ValueError, KeyError, OSError):
                    continue
        return sorted(results, key=lambda value: value.get("created_at", ""), reverse=True)[:100]

    def detail(self, identity: str) -> dict:
        root = self.find(identity)
        configuration = read_json(root / "config.json")
        if "config" not in configuration:
            configuration = {"config": configuration, "dataset": None}
        result = {"summary": self.status(identity), "config": configuration}
        for name in ("metrics", "evaluation"):
            path = root / f"{name}.json"
            result[name] = read_json(path) if path.exists() else None
        path = root / "best.metadata.json"
        result["checkpoint"] = read_json(path) if path.exists() else None
        if result["summary"]["status"] != "complete":
            # Resume keeps old artifacts for recovery; never present them as current evaluation.
            result["evaluation"] = None
        return result

    def start(self, request: TrainRequest) -> dict:
        if importlib.util.find_spec("torch") is None:
            raise ValueError("Install the documented PyTorch ML dependencies before training")
        from filelock import FileLock, Timeout

        config = request.config
        if config.epochs > 120 or config.model.hidden > 128 or config.model.history > 8:
            raise ValueError(
                "Interactive training supports ≤120 epochs, history ≤8 and hidden ≤128"
            )
        dataset_root = datasets.find(request.dataset_id)
        manifest = read_manifest(dataset_root)
        if manifest.config.total > 256:
            raise ValueError("Use the CLI for datasets with more than 256 episodes")
        if manifest.config.steps // manifest.config.sample_stride <= config.model.history:
            raise ValueError("The dataset is too short for this history window")
        with self.lock:
            if any(process.poll() is None for process in self.processes.values()):
                raise RuntimeError("A training run is active. Wait for it to finish.")
            self.root.mkdir(parents=True, exist_ok=True)
            guard = FileLock(self.root / ".training.lock")
            try:
                guard.acquire(timeout=0)
            except Timeout as exc:
                raise RuntimeError("A training run is active. Wait for it to finish.") from exc
            try:
                return self.launch(request, dataset_root)
            finally:
                guard.release()

    def launch(self, request: TrainRequest, dataset_root: Path) -> dict:
        config = request.config
        identity = f"run-{uuid4().hex[:12]}"
        root = self.root / identity
        root.mkdir(parents=True)
        write_json(root / "config.json", config.model_dump(mode="json"))
        write_json(
            root / "status.json",
            {
                "id": identity,
                "status": "running",
                "phase": "starting",
                "epoch": 0,
                "epochs": config.epochs,
                "family": config.model.family,
                "seed": config.seed,
                "device": config.device,
                "history": config.model.history,
                "dataset_id": request.dataset_id,
                "created_at": datetime.now(UTC).isoformat(),
                "interactive": True,
            },
        )
        try:
            with (root / "worker.log").open("wb") as log:
                self.processes[identity] = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "oracle.train",
                        "--dataset",
                        str(dataset_root),
                        "--output",
                        str(root),
                        "--config",
                        str(root / "config.json"),
                    ],
                    cwd=PROJECT_ROOT,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                )
        except OSError:
            write_json(
                root / "status.json",
                {
                    **read_json(root / "status.json"),
                    "status": "failed",
                    "phase": "failed",
                    "error": "The local training worker could not start.",
                },
            )
            raise
        return self.status(identity)


service = TrainingService(PROJECT_ROOT / "checkpoints")


@router.get("/runs")
def catalog() -> dict:
    return {
        "runs": service.catalog(),
        "torch_available": importlib.util.find_spec("torch") is not None,
    }


@router.get("/runs/{identity}")
def detail(identity: str) -> dict:
    try:
        return service.detail(identity)
    except (ValueError, KeyError, OSError) as exc:
        raise HTTPException(
            404, "This run is unavailable or its local artifacts are incompatible."
        ) from exc


@router.post("/jobs")
def start(request: TrainRequest) -> dict:
    try:
        return service.start(request)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(503, "The local training worker could not start.") from exc
