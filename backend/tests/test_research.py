"""Actual fixed weights and common targets across histories; isolated persistent batches."""

import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from filelock import FileLock
from pydantic import ValidationError

from oracle.api import app
from oracle.datasets.api import DatasetService
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import read_json, write_json
from oracle.models.schema import ModelConfig
from oracle.prediction.catalog import ModelCatalog
from oracle.research import api as research_api
from oracle.research.api import ResearchService
from oracle.research.engine import run_batch
from oracle.research.registry import CheckpointRegistry
from oracle.research.schema import BatchRequest, CheckpointNotes
from oracle.training.checkpoint import file_hash
from oracle.training.engine import train
from oracle.training.schema import TrainConfig


@pytest.fixture(scope="module")
def study(tmp_path_factory):
    root = tmp_path_factory.mktemp("research")
    dataset = root / "datasets" / "tiny"
    manifest = generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=48), dataset
    )
    entries = []
    for family, history in [("mlp", 1), ("gru", 3), ("transformer", 2)]:
        path = root / "checkpoints" / family
        config = TrainConfig(
            model=ModelConfig(family=family, history=history, embedding=16, hidden=16),
            epochs=1,
            threads=1,
            horizons=[1, 3],
        )
        train(dataset, path, config)
        entries.append(
            {"id": family, "path": str(path / "best.pt"), "sha256": file_hash(path / "best.pt")}
        )
    return root, dataset, manifest, entries


def batch(study):
    return BatchRequest(
        dataset_id=study[2].id, models=[e["id"] for e in study[3]], horizons=[1, 3, 50], threads=1
    )


def test_different_histories_score_identical_targets_anchors_and_reference(study, tmp_path):
    report = run_batch(study[1], tmp_path / "first", batch(study), study[3])
    assert report["common_history"] == 3
    assert report["point_forecast"] == "deterministic_eval"
    assert len(report["schedule_sha256"]) == 7
    for key in report["models"][0]["groups"]:
        groups = [model["groups"][key] for model in report["models"]]
        assert all(g["windows"] == groups[0]["windows"] for g in groups)
        assert all(
            g["one_step"]["constant_velocity"] == groups[0]["one_step"]["constant_velocity"]
            for g in groups
        )
        assert all(g["anchors"] == groups[0]["anchors"] for g in groups)
        assert all(
            g["rollout"]["constant_velocity"] == groups[0]["rollout"]["constant_velocity"]
            for g in groups
        )
        assert all(g["omitted_horizons"] == [50] for g in groups)
        assert groups[0]["anchors"][0]["sample"] == 2
    repeated = run_batch(study[1], tmp_path / "repeat", batch(study), study[3])
    for first, second in zip(report["models"], repeated["models"], strict=True):
        assert first["groups"] == second["groups"]
        assert first["latency"]["median_ms"] > 0
        assert first["latency"]["p95_ms"] >= first["latency"]["median_ms"]
        assert first["latency"]["anchor"] == 2
        assert first["checkpoint_sha256"] == file_hash(
            Path(study[3][report["models"].index(first)]["path"])
        )
    with pytest.raises(ValueError, match="not empty"):
        run_batch(study[1], tmp_path / "first", batch(study), study[3])


def test_incompatible_dataset_and_changed_checkpoint_fail_without_complete_report(study, tmp_path):
    other = tmp_path / "other"
    manifest = generate_dataset(
        DatasetConfig(seed=43, train=2, validation=1, test=1, ood_per_suite=1, steps=48), other
    )
    request = batch(study).model_copy(update={"dataset_id": manifest.id})
    with pytest.raises(ValueError, match="match the dataset"):
        run_batch(other, tmp_path / "wrong-data", request, study[3])
    assert read_json(tmp_path / "wrong-data/status.json")["status"] == "failed"
    entries = [{**e} for e in study[3]]
    entries[0]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="changed"):
        run_batch(study[1], tmp_path / "changed", batch(study), entries)
    assert not (tmp_path / "changed/report.json").exists()


def test_registry_annotations_persist_preserve_weights_and_lab_catalog(study):
    root = study[0] / "checkpoints"
    registry = CheckpointRegistry(root)
    before = file_hash(root / "mlp/best.pt")
    registry.update("mlp", CheckpointNotes(label="Pinned baseline", pinned=True, archived=True))
    recreated = CheckpointRegistry(root)
    item = recreated.list()["models"][0]
    assert item["id"] == "mlp" and item["label"] == "Pinned baseline" and item["archived"]
    assert file_hash(root / "mlp/best.pt") == before
    assert ModelCatalog(root).describe("mlp").sha256 == before
    registry.update("mlp", CheckpointNotes())
    with pytest.raises(ValueError, match="identifier"):
        registry.update("../mlp", CheckpointNotes())


def test_api_runs_real_batch_and_preserves_reports_on_reload(study, tmp_path, monkeypatch):
    service = ResearchService(
        tmp_path / "batches", study[0] / "checkpoints", DatasetService(study[1].parent)
    )
    monkeypatch.setattr(research_api, "service", service)
    with TestClient(app) as client:
        assert len(client.get("/api/research/checkpoints").json()["models"]) == 3
        assert client.get("/api/research/batches/missing").status_code == 404
        response = client.post("/api/research/jobs", json=batch(study).model_dump())
        assert response.status_code == 200
        identity = response.json()["id"]
        process = service.processes[identity]
        try:
            assert (
                client.post("/api/research/jobs", json=batch(study).model_dump()).status_code == 409
            )
            assert client.get(f"/api/research/batches/{identity}").json()["report"] is None
            process.wait(timeout=45)
            assert process.returncode == 0, (service.find(identity) / "worker.log").read_text()
            detail = client.get(f"/api/research/batches/{identity}").json()
            assert detail["summary"]["status"] == "complete"
            assert len(detail["report"]["models"]) == 3
            recreated = ResearchService(service.root, study[0] / "checkpoints", service.datasets)
            assert recreated.detail(identity)["report"] == detail["report"]
            assert client.get("/api/research/batches").json()["batches"][0]["id"] == identity
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


def test_guards_failed_launch_archival_and_incomplete_publication(study, tmp_path, monkeypatch):
    service = ResearchService(
        tmp_path / "batches", study[0] / "checkpoints", DatasetService(study[1].parent)
    )
    service.root.mkdir()
    with FileLock(service.root / ".research.lock"):
        with pytest.raises(RuntimeError, match="active"):
            service.start(batch(study))
    service.registry.update("mlp", CheckpointNotes(archived=True))
    try:
        with pytest.raises(ValueError, match="Restore"):
            service.start(batch(study))
    finally:
        service.registry.update("mlp", CheckpointNotes())

    def fail(*args, **kwargs):
        raise OSError("synthetic launch failure")

    monkeypatch.setattr(research_api.subprocess, "Popen", fail)
    with pytest.raises(OSError):
        service.start(batch(study))
    status = service.catalog()[0]
    assert status["status"] == "failed"
    write_json(service.find(status["id"]) / "report.json", {"partial": True})
    assert service.detail(status["id"])["report"] is None
    with pytest.raises(FileNotFoundError):
        service.find("../batches")


@pytest.mark.parametrize(
    "update",
    [
        {"models": ["mlp", "mlp"]},
        {"models": ["mlp", "../gru"]},
        {"horizons": [0]},
        {"horizons": [121]},
        {"groups": ["train"]},
        {"groups": ["test", "test"]},
    ],
)
def test_invalid_research_requests_rejected(update):
    with pytest.raises(ValidationError):
        BatchRequest(**{"dataset_id": "ds-" + "0" * 16, "models": ["mlp", "gru"], **update})


def test_api_import_does_not_load_optional_ml_dependencies():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import oracle.api, sys; assert 'torch' not in sys.modules; "
            "assert 'filelock' not in sys.modules",
        ],
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr


def test_recreated_service_recovers_interrupted_batch_but_preserves_locked_worker(study, tmp_path):
    service = ResearchService(tmp_path, study[0] / "checkpoints", DatasetService(study[1].parent))
    root = tmp_path / "interrupted"
    root.mkdir()
    write_json(
        root / "status.json",
        {
            "id": "interrupted",
            "status": "running",
            "created_at": (datetime.now(UTC) - timedelta(seconds=31)).isoformat(),
        },
    )
    with FileLock(tmp_path / ".research.lock"):
        assert service.status("interrupted")["status"] == "running"
    assert service.status("interrupted")["status"] == "failed"
    assert service.detail("interrupted")["report"] is None


def test_deadline_kills_owned_worker_and_marks_report_failed(study, tmp_path):
    service = ResearchService(tmp_path, study[0] / "checkpoints", DatasetService(study[1].parent))
    root = tmp_path / "timeout"
    root.mkdir()
    write_json(root / "status.json", {"id": "timeout", "status": "running"})

    class Worker:
        killed = False

        def wait(self, timeout=None):
            if timeout is not None:
                raise subprocess.TimeoutExpired("test-owned-worker", timeout)

        def kill(self):
            self.killed = True

    worker = Worker()
    service.monitor("timeout", worker)
    assert worker.killed
    assert service.status("timeout")["status"] == "failed"
    assert "deadline" in service.status("timeout")["error"]
