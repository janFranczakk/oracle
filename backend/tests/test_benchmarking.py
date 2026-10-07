"""Real trained weights, deterministic sources, intervention validity and held-out statistics."""

import csv
import math

import pytest
from pydantic import ValidationError

from oracle.benchmarking.counterfactual import BenchmarkConfig, run_benchmark, source_plan
from oracle.benchmarking.scenarios import INTERVENTIONS, fits, intervention
from oracle.benchmarking.statistics import summarize
from oracle.counterfactual.plans import materialize
from oracle.counterfactual.schema import Branch, Plan
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import read_json
from oracle.models.schema import ModelConfig
from oracle.physics import PhysicsEngine
from oracle.training.engine import train
from oracle.training.schema import TrainConfig


@pytest.fixture(scope="module")
def weights(tmp_path_factory):
    root = tmp_path_factory.mktemp("release-benchmark")
    dataset = root / "data"
    generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=32), dataset
    )
    checkpoint = root / "checkpoints" / "gru"
    train(
        dataset,
        checkpoint,
        TrainConfig(
            model=ModelConfig(family="gru", history=2, embedding=16, hidden=16),
            epochs=1,
            threads=1,
            horizons=[1, 3],
        ),
    )
    return root, dataset, checkpoint / "best.pt"


def test_statistics_missing_values_sample_std_and_mean_interval():
    stats = summarize([1, 2, 3, None], confidence=True)
    assert stats["n"] == 3 and stats["missing"] == 1
    assert stats["mean"] == stats["median"] == 2
    assert stats["std"] == 1
    assert stats["min"] == 1 and stats["max"] == 3
    assert stats["mean_ci95"][1] == pytest.approx(2 + 4.302653 / math.sqrt(3))
    assert summarize([None])["mean"] is None
    assert summarize([1], confidence=True)["std"] is None
    assert summarize([1], confidence=True)["mean_ci95"] is None
    with pytest.raises(ValueError, match="non-finite"):
        summarize([math.inf])


def test_sources_and_interventions_are_repeatable_preserve_live_world():
    _, original = source_plan(42, 12)
    _, repeat = source_plan(42, 12)
    assert original.snapshot.frame == repeat.snapshot.frame
    assert original.snapshot.experiment.origin == repeat.snapshot.experiment.origin
    before = original.model_dump(mode="json")
    for name in INTERVENTIONS:
        case = intervention(name, original.snapshot.frame)
        assert case == intervention(name, repeat.snapshot.frame)
        if case.unsupported:
            assert not case.changes
            continue
        if not case.changes:
            assert name == "baseline"
            continue
        plan = Plan.model_validate(
            {
                **before,
                "branches": [
                    before["branches"][0],
                    Branch(
                        id="case", name=name, parent_id="baseline", changes=list(case.changes)
                    ).model_dump(mode="json"),
                ],
            }
        )
        preview, _ = materialize(plan, "case")
        assert any(not b.static for b in preview.objects)
        for change in case.changes:
            if change.kind == "add":
                assert fits(change.object, original.snapshot.frame.objects)
    assert original.model_dump(mode="json") == before


def test_missing_geometry_zero_direction_and_removing_only_body_are_explicit():
    _, plan = source_plan(42, 0)
    dynamic = next(b for b in plan.snapshot.frame.objects if not b.static)
    frame = plan.snapshot.frame.model_copy(update={"objects": [dynamic]})
    assert intervention("static_remove", frame).unsupported
    assert intervention("ramp_rotate", frame).unsupported
    assert intervention("dynamic_remove", frame).unsupported
    dynamic.velocity.x = dynamic.velocity.y = 0
    assert intervention("velocity_direction", frame).unsupported
    dynamic.mass = 80
    assert intervention("mass_2", frame).unsupported


def test_benchmark_work_bounds_and_bad_names():
    with pytest.raises(ValidationError, match="500"):
        BenchmarkConfig(scenes=100)
    with pytest.raises(ValidationError):
        BenchmarkConfig(interventions=["invented"])
    with pytest.raises(ValidationError):
        BenchmarkConfig(horizons=[1, 1])


def test_real_benchmark_repeats_metrics_and_never_steps_future_during_prediction(
    weights, tmp_path, monkeypatch
):
    from oracle.benchmarking import counterfactual as module

    actual_execute = module.execute
    physical_step = PhysicsEngine.step

    def guarded(context, checkpoint=None):
        if context["operation"] != "predict":
            return actual_execute(context, checkpoint)
        anchor = context["plan"]["snapshot"]["frame"]["tick"]

        def step(engine):
            assert engine.tick < anchor, "Learned prediction invoked future physics"
            return physical_step(engine)

        with monkeypatch.context() as patch:
            patch.setattr(PhysicsEngine, "step", step)
            return actual_execute(context, checkpoint)

    monkeypatch.setattr(module, "execute", guarded)
    config = BenchmarkConfig(scenes=2, anchor_tick=12, horizons=[1, 3])
    first = run_benchmark([weights[2]], tmp_path / "first", config)
    repeated = run_benchmark([weights[2]], tmp_path / "repeat", config)
    for a, b in zip(first["cases"], repeated["cases"], strict=True):
        assert a["metrics"] == b["metrics"]
        assert a["case_sha256"] == b["case_sha256"]
        assert a["changes"] == b["changes"]
        assert a["checkpoint_sha256"] == first["provenance"]["models"][0]["sha256"]
    assert first["aggregates"] == repeated["aggregates"]
    assert any(r["status"] == "evaluated" and r["metrics"]["fde_m"] > 0 for r in first["cases"])
    assert read_json(tmp_path / "first/status.json")["status"] == "complete"
    with (tmp_path / "first/summary.csv").open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    item = first["aggregates"][0]
    assert item["magnitude"]["mean"] == 0  # unchanged baseline, equal-scene aggregation
    assert float(rows[0]["mean"]) == item["metrics"][rows[0]["metric"]]["mean"]
    with pytest.raises(FileExistsError):
        run_benchmark([weights[2]], tmp_path / "first", config)


def test_failure_persists_status_without_publishing_complete_report(weights, tmp_path, monkeypatch):
    from oracle.benchmarking import counterfactual as module

    def fail(*args):
        raise RuntimeError("Measured failure")

    monkeypatch.setattr(module, "execute", fail)
    root = tmp_path / "failed"
    with pytest.raises(RuntimeError, match="Measured failure"):
        run_benchmark([weights[2]], root, BenchmarkConfig(scenes=1, interventions=["baseline"]))
    assert read_json(root / "status.json")["status"] == "failed"
    assert not (root / "report.json").exists()
