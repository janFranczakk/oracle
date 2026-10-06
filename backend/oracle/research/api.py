"""One isolated research batch, persistent reports and reversible checkpoint annotations."""

import importlib.util
import re
import subprocess
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from oracle.datasets.api import PROJECT_ROOT, DatasetService
from oracle.datasets.api import service as datasets
from oracle.datasets.storage import read_json, read_manifest, write_json
from oracle.research.families import FamilyStudies
from oracle.research.registry import CheckpointRegistry
from oracle.research.schema import BatchRequest, CheckpointNotes

router = APIRouter(prefix="/api/research", tags=["Matched research experiments"])


class ResearchService:
    def __init__(self, root: Path, checkpoints: Path, dataset_service: DatasetService):
        self.root = root
        self.registry = CheckpointRegistry(checkpoints)
        self.datasets = dataset_service
        self.processes: dict[str, subprocess.Popen] = {}
        self.lock = threading.Lock()

    def find(self, identity: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
            raise FileNotFoundError("Invalid research batch identifier")
        path = (self.root / identity).resolve()
        if not path.is_relative_to(self.root.resolve()) or not path.is_dir():
            raise FileNotFoundError("Research batch is unavailable")
        return path

    def status(self, identity: str) -> dict:
        path = self.find(identity) / "status.json"
        status = read_json(path)
        process = self.processes.get(identity)
        if status["status"] == "running" and process and process.poll() is not None:
            status = read_json(path)
            if status["status"] == "running":
                status.update(
                    status="failed",
                    phase="failed",
                    error="The research worker stopped. Inspect its local log.",
                )
                write_json(path, status)
        if status["status"] == "running" and process is None and status.get("created_at"):
            # After an API restart, the worker lock distinguishes a live CLI/old worker from
            # an interrupted batch. Allow startup to acquire the lock before inspecting it.
            age = (datetime.now(UTC) - datetime.fromisoformat(status["created_at"])).total_seconds()
            if age > 30 and importlib.util.find_spec("filelock") is not None:
                from filelock import FileLock, Timeout

                guard = FileLock(self.root / ".research.lock")
                try:
                    guard.acquire(timeout=0)
                except Timeout:
                    pass
                else:
                    try:
                        status = read_json(path)
                        if status["status"] == "running":
                            status.update(
                                status="failed",
                                phase="failed",
                                error="This research batch was interrupted. Start a new batch; "
                                "its artifacts are preserved.",
                            )
                            write_json(path, status)
                    finally:
                        guard.release()
        return status

    def catalog(self) -> list[dict]:
        results = []
        for path in self.root.iterdir() if self.root.exists() else []:
            if not path.is_dir() or not (path / "status.json").exists():
                continue
            try:
                results.append(self.status(path.name))
            except (OSError, ValueError, KeyError):
                continue
        return sorted(results, key=lambda r: r.get("created_at", ""), reverse=True)[:100]

    def detail(self, identity: str) -> dict:
        root = self.find(identity)
        summary = self.status(identity)
        return {
            "summary": summary,
            "report": read_json(root / "report.json") if summary["status"] == "complete" else None,
        }

    def monitor(self, identity: str, process: subprocess.Popen):
        try:
            process.wait(timeout=900)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            path = self.find(identity) / "status.json"
            status = read_json(path)
            if status["status"] == "running":
                write_json(
                    path,
                    {
                        **status,
                        "status": "failed",
                        "phase": "failed",
                        "error": "The research batch exceeded its 15-minute CPU deadline.",
                    },
                )

    def start(self, request: BatchRequest) -> dict:
        if importlib.util.find_spec("torch") is None:
            raise ValueError("Install the documented ML dependencies before research evaluation")
        from filelock import FileLock, Timeout

        dataset = self.datasets.find(request.dataset_id)
        manifest = read_manifest(dataset)
        if manifest.config.total > 256 or manifest.config.steps > 1200:
            raise ValueError("Interactive research supports ≤256 episodes and ≤1200 solver ticks")
        selected = []
        for identity in request.models:
            model = self.registry.catalog.describe(identity)
            if (
                model.dataset_id != manifest.id
                or model.dataset_sha256 != manifest.content_sha256
                or model.normalization_sha256 != manifest.normalization_sha256
            ):
                raise ValueError("Select checkpoints from this exact dataset and normalizer")
            notes = self.registry.notes(identity)
            if notes.archived:
                raise ValueError("Restore archived checkpoints before selecting them for a batch")
            selected.append(
                {
                    "id": identity,
                    "path": str(self.registry.catalog.checkpoint(identity)),
                    "sha256": model.sha256,
                    "label": notes.label,
                }
            )
        with self.lock:
            if any(p.poll() is None for p in self.processes.values()):
                raise RuntimeError("A research batch is active. Wait for it to finish.")
            self.root.mkdir(parents=True, exist_ok=True)
            guard = FileLock(self.root / ".research.lock")
            try:
                guard.acquire(timeout=0)
            except Timeout as exc:
                raise RuntimeError("A research batch is active. Wait for it to finish.") from exc
            try:
                identity = f"batch-{uuid4().hex[:12]}"
                root = self.root / identity
                root.mkdir()
                write_json(
                    root / "request.json",
                    {
                        "request": request.model_dump(),
                        "dataset": str(dataset),
                        "checkpoints": selected,
                    },
                )
                write_json(
                    root / "status.json",
                    {
                        "id": identity,
                        "status": "running",
                        "phase": "starting",
                        "completed": 0,
                        "total": len(request.models) * len(request.groups),
                        "dataset_id": request.dataset_id,
                        "created_at": datetime.now(UTC).isoformat(),
                    },
                )
                try:
                    with (root / "worker.log").open("wb") as log:
                        process = subprocess.Popen(
                            [
                                sys.executable,
                                "-m",
                                "oracle.research_batch",
                                "--request",
                                str(root / "request.json"),
                                "--output",
                                str(root),
                            ],
                            cwd=PROJECT_ROOT,
                            stdout=log,
                            stderr=subprocess.STDOUT,
                            creationflags=subprocess.CREATE_NO_WINDOW
                            if sys.platform == "win32"
                            else 0,
                        )
                    self.processes[identity] = process
                    threading.Thread(
                        target=self.monitor, args=(identity, process), daemon=True
                    ).start()
                except OSError:
                    write_json(
                        root / "status.json",
                        {
                            **read_json(root / "status.json"),
                            "status": "failed",
                            "phase": "failed",
                            "error": "The local research worker could not start.",
                        },
                    )
                    raise
                return self.status(identity)
            finally:
                guard.release()


service = ResearchService(
    PROJECT_ROOT / "experiments" / "research", PROJECT_ROOT / "checkpoints", datasets
)
family_studies = FamilyStudies(PROJECT_ROOT / "experiments" / "multiseed")


@router.get("/families")
def families():
    return {"studies": family_studies.catalog()}


@router.get("/families/{identity}")
def family_detail(identity: str):
    try:
        return family_studies.detail(identity)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            404, "This completed seed study is unavailable or incompatible."
        ) from exc


@router.get("/checkpoints")
def checkpoints():
    return {
        **service.registry.list(),
        "torch_available": importlib.util.find_spec("torch") is not None,
    }


@router.post("/checkpoints/{identity}/notes")
def annotate(identity: str, notes: CheckpointNotes):
    try:
        return service.registry.update(identity, notes)
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(
            422, "This completed checkpoint is unavailable or incompatible."
        ) from exc


@router.get("/batches")
def batches():
    return {"batches": service.catalog()}


@router.get("/batches/{identity}")
def detail(identity: str):
    try:
        return service.detail(identity)
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(404, "This research batch is unavailable or incompatible.") from exc


@router.post("/jobs")
def start(request: BatchRequest):
    try:
        return service.start(request)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(
            422,
            str(exc)
            if isinstance(exc, ValueError)
            else "The research inputs are unavailable or the worker could not start.",
        ) from exc
