"""Real optimization and artifact tests on independently simulated, disjoint episodes."""

import math
import shutil
import subprocess
import sys
import time

import pytest
import torch
from fastapi.testclient import TestClient
from filelock import FileLock
from pydantic import ValidationError

from oracle.api import app
from oracle.datasets.api import DatasetService
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig, Split
from oracle.datasets.storage import read_episode, read_json, write_json
from oracle.models.dynamics import ObjectDynamics
from oracle.models.inference import LearnedDynamics
from oracle.models.schema import ModelConfig
from oracle.physics import PhysicsEngine
from oracle.training import api as training_api
from oracle.training.checkpoint import load_checkpoint, save_checkpoint
from oracle.training.data import SequenceDataset, collate
from oracle.training.engine import configure_runtime, train
from oracle.training.evaluation import evaluate_group
from oracle.training.metrics import Scores
from oracle.training.schema import TrainConfig, TrainRequest


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    root = tmp_path_factory.mktemp("training-data") / "tiny"
    manifest = generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=48), root
    )
    return root, manifest


def configuration(family="mlp", epochs=2):
    return TrainConfig(
        model=ModelConfig(family=family, history=2, embedding=16, hidden=16),
        epochs=epochs,
        batch_size=16,
        threads=1,
        horizons=[1, 3],
    )


@pytest.fixture(scope="module")
def trained(data, tmp_path_factory):
    output = tmp_path_factory.mktemp("trained") / "run"
    train(data[0], output, configuration())
    return output


def test_windows_never_cross_episode_or_split(data):
    root, manifest = data
    dataset = SequenceDataset(root, Split.TRAIN, 2)
    assert {e.id for e in dataset.episodes} == {
        e.id for e in manifest.episodes if e.split == Split.TRAIN
    }
    assert len(dataset) == 22
    for i, (episode_index, end) in enumerate(dataset.windows):
        episode = dataset.episodes[episode_index]
        x, y, contact, dynamic = dataset[i]
        assert torch.equal(x[-1], episode.inputs[end - 1])
        assert torch.equal(y, episode.inputs[end, :, :13])
        assert torch.equal(contact, episode.contacts[end])
        assert torch.equal(dynamic, episode.dynamic)
    with pytest.raises(ValueError, match="Only train"):
        SequenceDataset(root, Split.TEST, 2).contact_positive_weight()


@pytest.mark.parametrize("family", ["mlp", "gru", "transformer"])
def test_object_permutation_padding_and_static_context(data, family):
    configure_runtime(configuration(family))
    dataset = SequenceDataset(data[0], Split.TRAIN, 2)
    batch = collate([dataset[0]])
    model = ObjectDynamics(configuration(family).model).eval()
    expected = model(batch.inputs, batch.mask, batch.dynamic)
    permutation = torch.randperm(batch.mask.shape[1])
    reordered = model(
        batch.inputs[:, :, permutation], batch.mask[:, permutation], batch.dynamic[:, permutation]
    )
    assert torch.allclose(reordered.features, expected.features[:, permutation], atol=1e-6)
    assert torch.allclose(
        reordered.contact_logits, expected.contact_logits[:, permutation], atol=1e-6
    )
    padded = torch.cat((batch.inputs, torch.randn(1, 2, 5, 22)), dim=2)
    mask = torch.cat((batch.mask, torch.zeros(1, 5, dtype=torch.bool)), dim=1)
    dynamic = torch.cat((batch.dynamic, torch.zeros(1, 5, dtype=torch.bool)), dim=1)
    actual = model(padded, mask, dynamic)
    assert torch.allclose(actual.features[:, :-5], expected.features, atol=1e-6)
    assert torch.equal(actual.features[:, -5:], torch.zeros(1, 5, 13))
    static = ~batch.dynamic
    assert torch.equal(expected.features[static], batch.inputs[:, -1, :, :13][static])
    assert torch.equal(expected.features[..., 7:], batch.inputs[:, -1, :, 7:13])


@pytest.mark.parametrize("family", ["mlp", "gru", "transformer"])
def test_real_training_updates_weights_and_publishes_held_out_evaluation(data, tmp_path, family):
    config = configuration(family)
    configure_runtime(config)
    initial = ObjectDynamics(config.model).state_dict()
    status = train(data[0], tmp_path / family, config)
    model, checkpoint = load_checkpoint(tmp_path / family / "last.pt")
    assert status["status"] == "complete"
    assert any(not torch.equal(initial[k], v) for k, v in model.state_dict().items())
    assert checkpoint["optimizer"]["state"]
    assert checkpoint["dataset"]["gravity"] == [0.0, -9.81]
    evaluation = read_json(tmp_path / family / "evaluation.json")
    assert len(evaluation["groups"]) == 8
    assert evaluation["selected_epoch"] == checkpoint["best_epoch"]
    group = evaluation["groups"]["test"]
    assert [r["horizon"] for r in group["rollout"]["learned"]] == [1, 3]
    assert group["one_step"]["learned"]["objects_scored"] > 0
    assert group["rollout"]["learned"][-1]["ade_m"] >= 0
    if family == "transformer":
        uncertainty = read_json(tmp_path / family / "uncertainty.json")
        assert len(uncertainty["groups"]) == 7
        assert uncertainty["calibrated"] is False
        assert (
            uncertainty["checkpoint_sha256"]
            == read_json(tmp_path / family / "best.metadata.json")["sha256"]
        )
        assert uncertainty["groups"]["test"]["horizons"][-1]["objects_scored"] > 0


@pytest.mark.parametrize("family", ["mlp", "transformer"])
def test_same_seed_and_exact_resume_match_uninterrupted_cpu_training(data, tmp_path, family):
    full, repeat, resumed = [tmp_path / name for name in ("full", "repeat", "resumed")]
    train(data[0], full, configuration(family, epochs=3))
    train(data[0], repeat, configuration(family, epochs=3))
    train(data[0], resumed, configuration(family, epochs=1))
    if family == "mlp":
        # Simulate the exact pre-Stage-6 public architecture. Weights and optimizer are unchanged.
        _, legacy = load_checkpoint(resumed / "last.pt")
        for key in ("heads", "layers", "dropout"):
            legacy["architecture"].pop(key)
            legacy["config"]["model"].pop(key)
        save_checkpoint(resumed / "last.pt", legacy)
    train(data[0], resumed, configuration(family, epochs=3), resumed / "last.pt")
    _, reference = load_checkpoint(full / "last.pt")
    for directory in (repeat, resumed):
        _, candidate = load_checkpoint(directory / "last.pt")
        assert candidate["epoch"] == reference["epoch"]
        assert candidate["best_epoch"] == reference["best_epoch"]
        assert candidate["best_validation"] == reference["best_validation"]
        assert all(torch.equal(reference["weights"][k], v) for k, v in candidate["weights"].items())
        history = read_json(directory / "metrics.json")["epochs"]
        expected = read_json(full / "metrics.json")["epochs"]
        assert [r["train_loss"] for r in history] == [r["train_loss"] for r in expected]


def test_checkpoint_rejects_corruption_metadata_drift_and_wrong_dataset(trained, tmp_path):
    _, checkpoint = load_checkpoint(trained / "best.pt")
    path = tmp_path / "copy.pt"
    save_checkpoint(path, checkpoint)
    with pytest.raises(ValueError, match="incompatible"):
        load_checkpoint(path, {**checkpoint["dataset"], "id": "another"})
    metadata = read_json(path.with_suffix(".metadata.json"))
    write_json(path.with_suffix(".metadata.json"), {**metadata, "epoch": 99})
    with pytest.raises(ValueError, match="metadata"):
        load_checkpoint(path)
    save_checkpoint(path, checkpoint)
    path.write_bytes(path.read_bytes()[:-4] + b"oops")
    with pytest.raises(ValueError, match="checksum"):
        load_checkpoint(path)


def test_rejected_resume_preserves_completed_run_status(data, trained):
    before = (trained / "status.json").read_bytes()
    config = configuration(epochs=3).model_copy(update={"seed": 99})
    with pytest.raises(ValueError, match="preserves configuration"):
        train(data[0], trained, config, trained / "last.pt")
    assert (trained / "status.json").read_bytes() == before


def test_non_finite_weights_are_rejected(trained, tmp_path):
    _, checkpoint = load_checkpoint(trained / "best.pt")
    next(iter(checkpoint["weights"].values())).flatten()[0] = float("nan")
    save_checkpoint(tmp_path / "invalid.pt", checkpoint)
    with pytest.raises(ValueError, match="non-finite"):
        load_checkpoint(tmp_path / "invalid.pt")


def test_rollout_uses_learned_outputs_as_next_input_and_never_physics(
    data, trained, tmp_path, monkeypatch
):
    _, checkpoint = load_checkpoint(trained / "best.pt")
    for weights in checkpoint["weights"].values():
        weights.zero_()
    checkpoint["weights"]["decoder.bias"][0] = 0.1
    path = tmp_path / "learned.pt"
    save_checkpoint(path, checkpoint)
    episode = read_episode(data[0], data[1].episodes[0])
    monkeypatch.setattr(
        PhysicsEngine, "step", lambda *args: pytest.fail("Prediction invoked physics")
    )
    predictor = LearnedDynamics(path)
    prediction = predictor.predict(tuple(episode.frames[:2]), None, 3)
    assert [f.tick for f in prediction.frames] == [8, 12, 16]
    delta = 0.1 * predictor.normalizer.scale[0]
    for body in episode.frames[1].objects:
        actual = next(b for b in prediction.frames[-1].objects if b.id == body.id)
        if body.static:
            assert actual == body
        else:
            assert actual.position.x == pytest.approx(body.position.x + 3 * delta, abs=2e-5)
            assert actual.mass == body.mass
    assert prediction.uncertainty_method is None and prediction.position_std is None
    with pytest.raises(ValueError, match="history"):
        predictor.predict(tuple(episode.frames[:1]), None, 3)


def test_metrics_use_physical_units_periodic_rotation_and_exclude_static():
    actual = torch.zeros(1, 3, 13)
    actual[..., 5] = 1
    predicted = actual.clone()
    predicted[0, 0, :4] = torch.tensor([3, 4, 1, 2])
    predicted[0, 0, 4:6] = torch.tensor([math.sin(2 * math.pi - 0.1), math.cos(2 * math.pi - 0.1)])
    predicted[0, 2, :2] = 1000
    scores = Scores()
    scores.add(
        predicted,
        actual,
        torch.tensor([[True, True, False]]),
        torch.tensor([[1, 1, 1]]),
        torch.tensor([[1, 0, 1]]),
    )
    result = scores.result()
    assert result["position_mse"] == 25 / 4
    assert result["velocity_mse"] == 5 / 4
    assert result["rotation_mae_rad"] == pytest.approx(0.05)
    assert result["displacement_m"] == 2.5
    assert result["contact_balanced_accuracy"] == 0.5
    assert result["contact_counts"] == {"tp": 1, "tn": 0, "fp": 1, "fn": 0}


def test_evaluation_reports_unsupported_horizons_without_fabricating_them(data, trained):
    model, _ = load_checkpoint(trained / "best.pt")
    dataset = SequenceDataset(data[0], Split.TEST, 2)
    result = evaluate_group(model, dataset, [1, 50])
    assert result["omitted_horizons"] == [50]
    assert len(result["rollout"]["learned"]) == 1
    assert len(result["anchors"]) == 3


@pytest.mark.parametrize("horizons", [[0], [241], [1, 1], list(range(1, 18))])
def test_invalid_horizons_rejected(horizons):
    with pytest.raises(ValidationError):
        TrainConfig(horizons=horizons)


def test_cli_evaluation_is_repeatable_and_existing_run_is_preserved(data, trained, tmp_path):
    output = tmp_path / "evaluation.json"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "oracle.evaluate",
            str(trained / "best.pt"),
            "--dataset",
            str(data[0]),
            "--output",
            str(output),
        ],
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert read_json(output)["groups"] == read_json(trained / "evaluation.json")["groups"]
    before = (trained / "last.pt").read_bytes()
    with pytest.raises(ValueError, match="not empty"):
        train(data[0], trained, configuration())
    assert (trained / "last.pt").read_bytes() == before


def test_training_api_runs_real_worker_catalogs_and_rejects_concurrent_jobs(
    data, tmp_path, monkeypatch
):
    service = training_api.TrainingService(tmp_path / "runs")
    monkeypatch.setattr(training_api, "service", service)
    monkeypatch.setattr(training_api, "datasets", DatasetService(data[0].parent))
    request = TrainRequest(dataset_id=data[1].id, config=configuration())
    with TestClient(app) as client:
        assert client.get("/api/training/runs/missing").status_code == 404
        started = client.post("/api/training/jobs", json=request.model_dump(mode="json"))
        assert started.status_code == 200
        identity = started.json()["id"]
        process = service.processes[identity]
        try:
            assert (
                client.post("/api/training/jobs", json=request.model_dump(mode="json")).status_code
                == 409
            )
            deadline = time.monotonic() + 30
            while process.poll() is None and time.monotonic() < deadline:
                response = client.get(f"/api/training/runs/{identity}")
                assert response.status_code == 200
                assert "config" in response.json()["config"]
                time.sleep(0.01)
            process.wait(timeout=3)
            assert process.returncode == 0, (service.find(identity) / "worker.log").read_text()
            details = client.get(f"/api/training/runs/{identity}").json()
            assert details["summary"]["status"] == "complete"
            assert details["checkpoint"]["sha256"]
            assert len(details["evaluation"]["groups"]) == 8
            assert client.get("/api/training/runs").json()["runs"][0]["id"] == identity
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        invalid = request.model_dump(mode="json")
        invalid["config"]["epochs"] = 121
        assert client.post("/api/training/jobs", json=invalid).status_code == 422
    with pytest.raises(FileNotFoundError):
        service.find("../runs")


def test_api_worker_guard_survives_service_recreation(data, tmp_path, monkeypatch):
    root = tmp_path / "runs"
    root.mkdir()
    monkeypatch.setattr(training_api, "datasets", DatasetService(data[0].parent))
    with FileLock(root / ".training.lock"):
        recreated = training_api.TrainingService(root)
        with pytest.raises(RuntimeError, match="active"):
            recreated.start(TrainRequest(dataset_id=data[1].id, config=configuration()))
    assert recreated.catalog() == []


def test_failed_worker_launch_does_not_leave_a_running_job(data, tmp_path, monkeypatch):
    monkeypatch.setattr(training_api, "datasets", DatasetService(data[0].parent))

    def failed_launch(*args, **kwargs):
        raise OSError("Launch rejected")

    monkeypatch.setattr(training_api.subprocess, "Popen", failed_launch)
    service = training_api.TrainingService(tmp_path / "runs")
    with pytest.raises(OSError, match="Launch rejected"):
        service.start(TrainRequest(dataset_id=data[1].id, config=configuration()))
    assert service.catalog()[0]["status"] == "failed"


def test_resuming_run_does_not_present_previous_evaluation_as_current(trained, tmp_path):
    root = tmp_path / "runs"
    copied = root / "resumed"
    shutil.copytree(trained, copied)
    status = read_json(copied / "status.json")
    write_json(
        copied / "status.json",
        {**status, "id": "resumed", "status": "running", "phase": "training", "epochs": 10},
    )
    details = training_api.TrainingService(root).detail("resumed")
    assert details["evaluation"] is None
    assert details["metrics"]["epochs"]
    assert (copied / "evaluation.json").exists()
