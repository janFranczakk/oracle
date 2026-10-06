import pytest
from pydantic import ValidationError
from test_benchmarking import weights as weights

from oracle.datasets.storage import read_json
from oracle.models.schema import ModelConfig
from oracle.training.schema import TrainConfig


def test_real_multiseed_common_schedule_aggregation_validation_selection_and_catalog(
    weights, tmp_path
):
    from oracle.benchmarking.multiseed import MultiSeedConfig, run_study
    from oracle.datasets.storage import write_json
    from oracle.research.families import FamilyStudies

    config = MultiSeedConfig(
        seeds=[1, 2],
        training=TrainConfig(
            model=ModelConfig(history=2, embedding=16, hidden=16),
            epochs=2,
            threads=1,
            horizons=[1, 3],
        ),
    )
    report = run_study(weights[1], tmp_path / "studies" / "smoke", config)
    assert len(report["families"]) == 3
    for family in report["families"]:
        runs = family["runs"]
        assert [r["seed"] for r in runs] == [1, 2]
        assert runs[0]["checkpoint_sha256"] != runs[1]["checkpoint_sha256"]
        for run in runs:
            epochs = read_json(tmp_path / "studies/smoke/runs" / run["id"] / "metrics.json")[
                "epochs"
            ]
            best = min(epochs, key=lambda e: e["validation_loss"])
            assert run["selected_epoch"] == best["epoch"]
            assert run["best_validation"] == best["validation_loss"]
        for entry in family["metrics"]:
            assert entry["statistics"]["n"] + entry["statistics"]["missing"] == 2
            if entry["metric"] == "fde_m" and entry["group"] == "test":
                h = entry["horizon"]
                fdes = [
                    next(
                        row["fde_m"]
                        for row in r["evaluation"]["groups"]["test"]["rollout"]["learned"]
                        if row["horizon"] == h
                    )
                    for r in runs
                ]
                assert entry["statistics"]["mean"] == sum(fdes) / 2
                assert entry["statistics"]["mean_ci95"] is not None
    studies = FamilyStudies(tmp_path / "studies")
    assert studies.detail("smoke") == report
    assert studies.catalog()[0]["seeds"] == [1, 2]
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from oracle.api import app
    from oracle.research import api as research_api

    with patch.object(research_api, "family_studies", studies), TestClient(app) as client:
        assert client.get("/api/research/families").json()["studies"][0]["id"] == "smoke"
        assert client.get("/api/research/families/smoke").json() == report
        assert client.get("/api/research/families/missing").status_code == 404
        assert client.post("/api/research/families", json={}).status_code == 405
    with pytest.raises(FileExistsError):
        run_study(weights[1], tmp_path / "studies/smoke", config)
    with pytest.raises(ValueError):
        studies.detail("../smoke")
    write_json(tmp_path / "studies/smoke/report.json", {**report, "elapsed_seconds": 0})
    assert studies.catalog() == []
    with pytest.raises(ValueError, match="changed"):
        studies.detail("smoke")


def test_multiseed_bounds_and_failure_preserve_partial_experiment(weights, tmp_path, monkeypatch):
    from oracle.benchmarking.multiseed import MultiSeedConfig, run_study
    from oracle.training import engine

    for kwargs in (
        {"seeds": [1, 1]},
        {"families": ["gru", "gru"]},
        {"training": TrainConfig(epochs=121)},
        {"training": TrainConfig(device="cuda")},
    ):
        with pytest.raises(ValidationError):
            MultiSeedConfig(**kwargs)

    def fail(*args):
        raise RuntimeError("Training failure")

    monkeypatch.setattr(engine, "train", fail)
    with pytest.raises(RuntimeError, match="Training failure"):
        run_study(
            weights[1],
            tmp_path / "failed-study",
            MultiSeedConfig(
                seeds=[1], families=["gru"], training=TrainConfig(model=ModelConfig(history=2))
            ),
        )
    assert read_json(tmp_path / "failed-study/status.json")["status"] == "failed"
    assert not (tmp_path / "failed-study/report.json").exists()
