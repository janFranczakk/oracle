"""Local dataset catalog and one isolated collection process; no work runs in the UI thread."""

import math
import re
import subprocess
import sys
import threading
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from oracle.datasets.engine import dataset_id
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import (
    read_episode,
    read_json,
    read_manifest,
    read_normalization,
    write_json,
)
from oracle.paths import ARTIFACT_ROOT, PROJECT_ROOT

router = APIRouter(prefix="/api/datasets", tags=["Ground-truth datasets"])


class DatasetService:
    def __init__(self, root: Path):
        self.root = root
        self.processes: dict[str, subprocess.Popen] = {}
        self.lock = threading.Lock()

    def catalog(self) -> list[tuple[Path, dict]]:
        results = []
        seen = set()
        if self.root.exists():
            for directory in sorted(self.root.iterdir()):
                if not directory.is_dir() or not (directory / "manifest.json").is_file():
                    continue
                try:
                    manifest = read_manifest(directory)
                    read_normalization(directory, manifest)
                except (ValueError, OSError, KeyError):
                    continue
                if manifest.id not in seen:
                    seen.add(manifest.id)
                    results.append((directory, manifest.model_dump(mode="json")))
        return sorted(results, key=lambda item: item[1]["created_at"], reverse=True)[:50]

    def find(self, identity: str) -> Path:
        if not re.fullmatch(r"ds-[a-f0-9]{16}", identity):
            raise ValueError("Invalid dataset identifier")
        for directory, manifest in self.catalog():
            if manifest["id"] == identity:
                return directory
        raise FileNotFoundError("Dataset is missing or its manifest is incompatible")

    def status(self, job_id: str) -> dict:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise FileNotFoundError("Unknown dataset collection job")
        value = read_json(self.root / ".jobs" / f"{job_id}.status.json")
        process = self.processes.get(job_id)
        if value["status"] == "running" and process and process.poll() is not None:
            value = {
                **value,
                "status": "failed",
                "phase": "failed",
                "error": "The collection worker stopped. Check its local log.",
            }
        return {"id": job_id, **value}

    def start(self, config: DatasetConfig) -> dict:
        if config.total > 256 or config.steps > 1200 or config.sample_stride < 4:
            raise ValueError(
                "Interactive collection supports ≤256 episodes, ≤1200 ticks and stride ≥4. "
                "Use the CLI for larger runs."
            )
        with self.lock:
            if any(p.poll() is None for p in self.processes.values()):
                raise RuntimeError("A collection is already running. Wait for it to finish.")
            identity = dataset_id(config)
            try:
                self.find(identity)
                return {
                    "id": "",
                    "status": "complete",
                    "phase": "ready",
                    "dataset_id": identity,
                    "completed": config.total,
                    "total": config.total,
                }
            except FileNotFoundError:
                pass
            destination = self.root / identity
            if destination.exists() and any(destination.iterdir()):
                if (destination / "manifest.json").exists():
                    raise ValueError(
                        "An incompatible dataset occupies this configuration. Inspect it locally."
                    )
                # Preserve failed work and start clean; never overwrite completed collections.
                quarantine = self.root / ".partial" / f"{identity}-{uuid4().hex[:8]}"
                resolved_root = self.root.resolve()
                if not (
                    destination.resolve().is_relative_to(resolved_root)
                    and quarantine.resolve().is_relative_to(resolved_root)
                ):
                    raise ValueError("Partial dataset paths must stay within the dataset directory")
                quarantine.parent.mkdir(exist_ok=True)
                destination.rename(quarantine)
            jobs = self.root / ".jobs"
            jobs.mkdir(parents=True, exist_ok=True)
            job_id = uuid4().hex
            config_path, status_path = (
                jobs / f"{job_id}.config.json",
                jobs / f"{job_id}.status.json",
            )
            write_json(config_path, config.model_dump())
            write_json(
                status_path,
                {"status": "running", "phase": "starting", "completed": 0, "total": config.total},
            )
            with (jobs / f"{job_id}.log").open("wb") as log:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "oracle.generate_dataset",
                        "--config",
                        str(config_path),
                        "--output",
                        str(destination),
                        "--progress",
                        str(status_path),
                    ],
                    cwd=PROJECT_ROOT,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                )
            self.processes[job_id] = process
            return self.status(job_id)


service = DatasetService(ARTIFACT_ROOT / "datasets")


def fail(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(404, "This dataset or episode is unavailable. Refresh the catalog.")
    return HTTPException(
        422, "Dataset integrity check failed. Inspect its manifest and files locally."
    )


@router.get("")
def list_datasets() -> dict:
    return {
        "datasets": [
            {k: v for k, v in value.items() if k != "episodes"}
            | {
                "episode_count": len(value["episodes"]),
                "pair_count": sum(e["pairs"] for e in value["episodes"]),
            }
            for _, value in service.catalog()
        ]
    }


@router.post("/jobs")
def collect(config: DatasetConfig) -> dict:
    try:
        return service.start(config)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(503, "The local collection worker could not start.") from exc


@router.get("/jobs/{job_id}")
def job(job_id: str) -> dict:
    try:
        return service.status(job_id)
    except (ValueError, OSError) as exc:
        raise fail(exc) from exc


@router.get("/{identity}")
def dataset(identity: str) -> dict:
    try:
        root = service.find(identity)
        manifest = read_manifest(root)
        return {
            "manifest": manifest.model_dump(mode="json"),
            "normalization": read_normalization(root, manifest).model_dump(mode="json"),
        }
    except (ValueError, OSError, KeyError) as exc:
        raise fail(exc) from exc


@router.get("/{identity}/episodes/{episode_id}")
def episode_preview(identity: str, episode_id: str) -> dict:
    try:
        root = service.find(identity)
        manifest = read_manifest(root)
        entry = next((e for e in manifest.episodes if e.id == episode_id), None)
        if entry is None:
            raise FileNotFoundError("Unknown episode")
        episode = read_episode(root, entry)
        stride = max(1, math.ceil((len(episode.frames) - 1) / 240))
        frames = episode.frames[::stride]
        if frames[-1].tick != episode.steps:
            frames.append(episode.frames[-1])
        return {
            "entry": entry.model_dump(mode="json"),
            "ranges": episode.ranges.model_dump(),
            "environment": episode.origin.environment.model_dump(),
            "frames": [f.model_dump(mode="json") for f in frames],
            "preview_stride": stride * episode.sample_stride,
            "checksum_verified": True,
        }
    except (ValueError, OSError, KeyError) as exc:
        raise fail(exc) from exc
