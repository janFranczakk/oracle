"""Actual learned weights, cache-preserving branch replay and immutable owner boundaries."""

import copy
import json
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from oracle.counterfactual import api as branch_api
from oracle.counterfactual.api import create_router
from oracle.counterfactual.conditioning import condition_history
from oracle.counterfactual.plans import PlanStore, branch_hash, capture_snapshot, materialize
from oracle.counterfactual.schema import AnchorRequest, CreateBranch, Plan
from oracle.counterfactual.worker import execute
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.models.schema import ModelConfig
from oracle.physics import PhysicsEngine
from oracle.prediction.metrics import compare
from oracle.prediction.service import PredictionService
from oracle.scenes import scene
from oracle.session import Session
from oracle.training.engine import train
from oracle.training.schema import TrainConfig
from oracle.world import Frame


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("counterfactual")
    generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=24), root / "data"
    )
    for family in ("mlp", "gru"):
        train(
            root / "data",
            root / family,
            TrainConfig(
                model=ModelConfig(family=family, history=2, embedding=16, hidden=16),
                epochs=1,
                batch_size=16,
                threads=1,
                horizons=[1, 3],
            ),
        )
    return PredictionService(root)


def source(session=None):
    session = session or Session()
    if session.engine.tick < 12:
        session.advance(12)
    request = AnchorRequest(
        generation=session.generation, revision=session.revision, anchor_tick=session.engine.tick
    )
    return session, capture_snapshot(session, request)


def update(identity="orb-01", **patch):
    return {"kind": "update", "object_id": identity, "patch": patch}


def add_branch(store, plan, changes, parent="baseline", name="Alternative"):
    value = store.add("owner", plan.id, CreateBranch(parent_id=parent, name=name, changes=changes))
    return Plan.model_validate(value["plan"]), value["plan"]["branches"][-1]["id"]


def context(plan, branch, operation="reality", service=None, family="gru", horizon=5):
    value = {
        "operation": operation,
        "plan": plan.model_dump(mode="json"),
        "branch_id": branch,
        "request": {"horizon": horizon, "sample_stride": 4, "model_id": family},
    }
    if operation == "predict":
        value["model"] = service.catalog.describe(family).model_dump(mode="json")
    return value


def test_snapshot_seek_keeps_live_future_and_nested_siblings_are_isolated():
    session = Session(scene(preset="collision"))
    session.advance(180)
    session.update("orb-01", {"mass": 8})
    session.advance(20)
    session.seek(120)
    before = [f.model_dump() for f in session.history], session.payload(), session.export().events
    _, plan = source(session)
    assert plan.snapshot.experiment.duration == 120
    assert not plan.snapshot.experiment.events
    store = PlanStore()
    store.put("owner", plan)
    plan, first = add_branch(store, plan, [update(mass=4)])
    plan, child = add_branch(store, plan, [update(velocity={"x": 7, "y": 1})], first)
    plan, sibling = add_branch(store, plan, [update(mass=9)])
    first_body = next(b for b in materialize(plan, first)[0].objects if b.id == "orb-01")
    child_body = next(b for b in materialize(plan, child)[0].objects if b.id == "orb-01")
    assert first_body.mass == child_body.mass == 4
    assert child_body.velocity.x == 7 and first_body.velocity.x != 7
    assert next(b for b in materialize(plan, sibling)[0].objects if b.id == "orb-01").mass == 9
    assert before == (
        [f.model_dump() for f in session.history],
        session.payload(),
        session.export().events,
    )
    fetched = store.get("owner", plan.id)
    fetched.snapshot.frame.objects[0].mass = 99
    assert store.get("owner", plan.id).snapshot.frame.objects[0].mass != 99
    with pytest.raises(KeyError):
        store.get("another-owner", plan.id)


def test_reality_rebuilds_contacts_applies_exact_edits_and_never_changes_source():
    session = Session(scene(preset="collision"))
    session.advance(120)
    _, plan = source(session)
    store = PlanStore()
    store.put("owner", plan)
    plan, branch = add_branch(
        store, plan, [update(mass=6), update("wall-r", position={"x": 21, "y": 7})]
    )
    original = plan.model_dump()
    result = execute(context(plan, branch, horizon=30))
    control = Session.restore(plan.snapshot.experiment)
    control.update("orb-01", {"mass": 6})
    control.update("wall-r", {"position": {"x": 21, "y": 7}})
    expected = []
    for _ in range(30):
        control.advance(4)
        expected.append(
            control.engine.frame()
            .model_copy(update={"collisions": control.latest_collisions})
            .model_dump(mode="json")
        )
    assert result["frames"] == expected
    assert result["source"] == "pymunk-7.2.0" and "model" not in result
    assert original == plan.model_dump() and session.engine.tick == 120


@pytest.mark.parametrize("family", ["mlp", "gru"])
def test_prediction_uses_real_weights_and_no_future_physics(trained, monkeypatch, family):
    session, plan = source()
    store = PlanStore()
    store.put("owner", plan)
    duplicate = session.engine.frame().objects[-1].model_copy(deep=True)
    duplicate.id = "duplicate"
    duplicate.position.x += 2
    plan, branch = add_branch(
        store,
        plan,
        [
            update(velocity={"x": 8, "y": 0}),
            {"kind": "remove", "object_id": "box-01"},
            {"kind": "add", "object": duplicate.model_dump()},
        ],
    )
    before = [f.model_dump() for f in session.history]
    step = PhysicsEngine.step

    def known_past_only(self):
        assert self.tick < plan.snapshot.frame.tick, "Prediction advanced physical future"
        return step(self)

    monkeypatch.setattr(PhysicsEngine, "step", known_past_only)
    result = execute(
        context(plan, branch, "predict", trained, family), trained.catalog.checkpoint(family)
    )
    assert result["source"] == "learned_model" and "comparison" not in result
    assert result["model"]["sha256"] == trained.catalog.describe(family).sha256
    assert result["conditioning"]["added_ids"] == ["duplicate"]
    assert result["conditioning"]["removed_ids"] == ["box-01"]
    assert result["conditioning"]["added_history"] == "synthetic_repeated_anchor_placeholders"
    assert all(any(b["id"] == "box-01" for b in f["objects"]) for f in result["observations"])
    assert all(
        not any(b["id"] == "box-01" for b in f["objects"]) for f in result["conditioned_inputs"]
    )
    assert result["observations"][-1] != result["conditioned_inputs"][-1]
    assert result["frames"][-1]["tick"] == 32 and result["uncertainty"] is None
    assert session.engine.tick == 12 and before == [f.model_dump() for f in session.history]


def test_conditioning_preserves_observed_past_for_existing_bodies():
    session, plan = source()
    store = PlanStore()
    store.put("owner", plan)
    plan, branch = add_branch(store, plan, [update(mass=5)])
    history = tuple(session.history[t] for t in (0, 4, 8, 12))
    original = [f.model_dump() for f in history]
    inputs, policy = condition_history(history, materialize(plan, branch)[0])
    for old, conditioned in zip(history[:-1], inputs[:-1], strict=True):
        assert {b.id: b for b in old.objects} == {b.id: b for b in conditioned.objects}
    assert next(b for b in inputs[-1].objects if b.id == "orb-01").mass == 5
    assert original == [f.model_dump() for f in history]
    assert policy["added_history"] is None and not policy["intervention_trained"]


@pytest.mark.parametrize(
    "mutation",
    ["cycle", "duplicate", "root-edit", "anchor", "missing", "reuse-id", "velocity", "shape"],
)
def test_invalid_graphs_and_interventions_are_rejected(mutation):
    _, plan = source()
    data = plan.model_dump()
    if mutation == "cycle":
        data["branches"].append(
            {"id": "a", "name": "A", "parent_id": "a", "changes": [update(mass=4)]}
        )
    elif mutation == "duplicate":
        data["branches"].append(
            {"id": "baseline", "name": "A", "parent_id": "baseline", "changes": [update(mass=4)]}
        )
    elif mutation == "root-edit":
        data["branches"][0]["changes"] = [update(mass=4)]
    elif mutation == "anchor":
        data["snapshot"]["frame"]["tick"] += 1
    else:
        body = plan.snapshot.frame.objects[-1].model_dump()
        changes = {
            "missing": [update("absent", mass=4)],
            "reuse-id": [
                {"kind": "remove", "object_id": body["id"]},
                {"kind": "add", "object": body},
            ],
            "velocity": [update(velocity={"x": 1001, "y": 0})],
            "shape": [update(shape="wall")],
        }[mutation]
        data["branches"].append(
            {"id": "a", "name": "A", "parent_id": "baseline", "changes": changes}
        )
    with pytest.raises((ValueError, ValidationError)):
        parsed = Plan.model_validate(data)
        materialize(parsed, parsed.branches[-1].id)


def test_replayed_snapshot_validation_and_horizon_bounds():
    _, plan = source()
    tampered = plan.model_copy(deep=True)
    tampered.snapshot.frame.objects[-1].position.x += 1
    with pytest.raises(ValueError, match="replay"):
        execute({"operation": "validate", "plan": tampered.model_dump()})
    ctx = context(plan, "baseline")
    ctx["request"]["horizon"] = 121
    with pytest.raises(ValidationError):
        execute(ctx)


def test_real_worker_without_torch_import(trained):
    _, plan = source()
    ctx = context(plan, "baseline")
    result = trained.run_counterfactual(ctx)
    assert result["source"] == "pymunk-7.2.0"
    code = (
        "import sys,json; from oracle.counterfactual.worker import execute; "
        "execute(json.loads(sys.stdin.read())); assert 'torch' not in sys.modules"
    )
    subprocess.run(
        [sys.executable, "-c", code],
        input=json.dumps(ctx),
        text=True,
        capture_output=True,
        check=True,
    )


def test_measurements_require_both_matching_futures_and_recalculate(trained):
    _, plan = source()
    store = PlanStore()
    store.put("owner", plan)
    predicted = execute(
        context(plan, "baseline", "predict", trained), trained.catalog.checkpoint("gru")
    )
    actual = execute(context(plan, "baseline"))
    assert store.record_future("owner", predicted) is None
    changed_clock = copy.deepcopy(actual)
    changed_clock["sample_stride"] = 5
    assert store.record_future("owner", changed_clock) is None
    comparison = store.record_future("owner", actual)
    assert comparison["metrics"] == compare(
        [Frame.model_validate(f) for f in predicted["frames"]],
        [Frame.model_validate(f) for f in actual["frames"]],
        12,
        1 / 120,
    )
    assert comparison["model_sha256"] == predicted["model"]["sha256"]
    assert comparison["metrics"]["summary"]["ade_m"] > 0
    store.discard_owner("owner")
    assert not store.futures and not store.owners


def test_api_capture_preview_import_and_live_changes_during_worker(trained):
    session, plan = source()
    store = PlanStore()
    app = FastAPI()
    app.include_router(create_router(lambda _sid: session, store, trained))
    with TestClient(app) as client:
        prefix = "/api/sessions/test/counterfactual"
        response = client.post(prefix + "/capture", json=plan.snapshot.source.model_dump())
        assert response.status_code == 200
        data = response.json()
        pid = data["plan"]["id"]
        request = {
            "parent_id": "baseline",
            "name": "Faster",
            "changes": [update(velocity={"x": 9, "y": 0})],
        }
        preview = client.post(f"{prefix}/{pid}/preview", json=request).json()
        assert next(b for b in preview["objects"] if b["id"] == "orb-01")["velocity"]["x"] == 9
        assert len(store.get("test", pid).branches) == 1
        child = client.post(f"{prefix}/{pid}/branches", json=request)
        assert child.status_code == 200
        bid = child.json()["plan"]["branches"][-1]["id"]
        session.update("orb-01", {"mass": 11})
        result = client.post(
            f"{prefix}/{pid}/{bid}/reality", json={"horizon": 5, "sample_stride": 4}
        )
        assert result.status_code == 200
        assert (
            next(b for b in result.json()["anchor_frame"]["objects"] if b["id"] == "orb-01")["mass"]
            != 11
        )
        assert result.json()["comparison"] is None
        imported = client.post(prefix + "/import", json=data["plan"])
        assert imported.status_code == 200 and imported.json()["plan"]["id"] != pid
        data["plan"]["snapshot"]["frame"]["objects"][0]["position"]["x"] += 1
        assert client.post(prefix + "/import", json=data["plan"]).status_code == 422
        assert session.engine.tick == 12


def test_api_source_edit_does_not_stale_immutable_prediction(trained, monkeypatch):
    session, plan = source()
    store = PlanStore()
    store.put("test", plan)
    entered, finish = threading.Event(), threading.Event()
    original = trained.run_counterfactual

    def delayed(ctx):
        entered.set()
        assert finish.wait(10)
        return original(ctx)

    monkeypatch.setattr(trained, "run_counterfactual", delayed)
    app = FastAPI()
    app.include_router(create_router(lambda _sid: session, store, trained))
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        result = pool.submit(
            client.post,
            f"/api/sessions/test/counterfactual/{plan.id}/baseline/predict",
            json={"model_id": "gru", "sample_stride": 4, "horizon": 5},
        )
        assert entered.wait(5)
        session.advance(4)
        finish.set()
        assert result.result(timeout=10).status_code == 200
        assert session.engine.tick == 16


def test_branch_limit_and_fingerprints_are_stable_for_siblings():
    _, plan = source()
    store = PlanStore()
    store.put("owner", plan)
    baseline = branch_hash(plan, "baseline")
    for index in range(15):
        plan, _ = add_branch(store, plan, [update(mass=2 + index)], name=str(index))
        assert branch_hash(plan, "baseline") == baseline
    with pytest.raises(ValidationError):
        add_branch(store, plan, [update(mass=30)])
    assert len(store.get("owner", plan.id).branches) == 16


def test_missing_torch_only_blocks_learned_branch_operation(trained, monkeypatch):
    session, plan = source()
    before = session.payload()
    store = PlanStore()
    store.put("test", plan)
    app = FastAPI()
    app.include_router(create_router(lambda _sid: session, store, trained))
    monkeypatch.setattr(branch_api.importlib.util, "find_spec", lambda _: None)
    with TestClient(app) as client:
        prefix = f"/api/sessions/test/counterfactual/{plan.id}/baseline"
        request = {"model_id": "gru", "horizon": 3, "sample_stride": 4}
        assert client.post(prefix + "/predict", json=request).status_code == 503
        reality = client.post(prefix + "/reality", json=request)
        assert reality.status_code == 200 and reality.json()["comparison"] is None
        assert session.payload() == before


def test_branch_worker_busy_and_timeout_release_shared_capacity(trained, monkeypatch):
    session, plan = source()
    before = session.payload()
    store = PlanStore()
    store.put("test", plan)
    app = FastAPI()
    app.include_router(create_router(lambda _sid: session, store, trained))
    with TestClient(app) as client:
        path = f"/api/sessions/test/counterfactual/{plan.id}/baseline/reality"
        request = {"horizon": 3, "sample_stride": 4}
        trained.lock.acquire()
        try:
            assert client.post(path, json=request).status_code == 409
        finally:
            trained.lock.release()

        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired("counterfactual", 45)

        monkeypatch.setattr(subprocess, "run", timeout)
        response = client.post(path, json=request)
        assert response.status_code == 422 and "45 seconds" in response.text
        assert "Traceback" not in response.text
        assert not trained.lock.locked() and not store.futures
        assert session.payload() == before
