"""Real learned-only searches, fixed-winner physical verification and owner boundaries."""

import copy
import json
import subprocess
import sys

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from oracle.contracts import Prediction
from oracle.counterfactual.plans import capture_snapshot
from oracle.counterfactual.schema import AnchorRequest, Plan
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.models.inference import LearnedDynamics
from oracle.models.schema import ModelConfig
from oracle.physics import PhysicsEngine
from oracle.planning.api import create_router
from oracle.planning.schema import SearchRequest
from oracle.planning.search import candidates, rank
from oracle.planning.store import PlanningStore, reality_context, verification
from oracle.planning.worker import execute
from oracle.prediction.service import PredictionService
from oracle.session import Session
from oracle.training.checkpoint import file_hash
from oracle.training.engine import train
from oracle.training.schema import TrainConfig


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("planning")
    generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=24), root / "data"
    )
    for family in ("mlp", "gru", "transformer"):
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


def context(service, family="gru"):
    session = Session()
    session.advance(12)
    source = AnchorRequest(generation=session.generation, anchor_tick=12, revision=session.revision)
    plan = capture_snapshot(session, source)
    request = SearchRequest(
        **source.model_dump(),
        model_id=family,
        object_id="orb-01",
        goal={"x": 10, "y": 5},
        horizon=5,
    )
    return session, {
        "operation": "search",
        "plan": plan.model_dump(mode="json"),
        "request": request.model_dump(mode="json"),
        "model": service.catalog.describe(family).model_dump(mode="json"),
    }


@pytest.mark.parametrize("family", ["mlp", "gru", "transformer"])
def test_real_weights_select_shared_learned_candidates_without_changing_source(trained, family):
    session, value = context(trained, family)
    before = (
        session.export().model_dump(exclude={"created_at"}),
        session.engine.frame().model_dump(),
    )
    path = trained.catalog.checkpoint(family)
    weight_hash = file_hash(path)
    report = execute(value, path)
    assert len(report["candidates"]) == 9
    assert report["verification"] is None
    assert report["selection_source"] == "learned_model_only"
    assert report["selected_id"] == report["candidates"][0]["id"]
    assert {len(c["trajectory"]) for c in report["candidates"]} == {6}
    assert {c["trajectory"][0]["position"]["x"] for c in report["candidates"]} == {
        next(b for b in session.engine.frame().objects if b.id == "orb-01").position.x
    }
    assert report["prediction"]["conditioning"]["intervention_trained"] is False
    assert file_hash(path) == weight_hash
    assert before == (
        session.export().model_dump(exclude={"created_at"}),
        session.engine.frame().model_dump(),
    )
    repeated = execute(value, path)
    assert repeated["candidates"] == report["candidates"]
    assert repeated["search_sha256"] == report["search_sha256"]


def test_search_only_steps_the_known_past_once(trained, monkeypatch):
    _, value = context(trained)
    steps = []
    original = PhysicsEngine.step

    def observed(self):
        steps.append(self.tick)
        assert self.tick < 12, "Search must not step a physical future"
        return original(self)

    monkeypatch.setattr(PhysicsEngine, "step", observed)
    execute(value, trained.catalog.checkpoint("gru"))
    assert steps == list(range(12))


def test_tied_learned_objectives_choose_unchanged_baseline(trained, monkeypatch):
    _, value = context(trained)

    def unchanged(self, history, intervention, horizon):
        return Prediction(
            tuple(
                history[-1].model_copy(update={"tick": history[-1].tick + 4 * (i + 1)})
                for i in range(horizon)
            ),
            self.version,
        )

    monkeypatch.setattr(LearnedDynamics, "predict", unchanged)
    report = execute(value, trained.catalog.checkpoint("gru"))
    assert report["selected_id"] == "baseline"
    rows = [{"goal_distance_m": 1, "velocity_change_m_s": 2, "input_order": i} for i in [3, 1, 2]]
    assert [r["input_order"] for r in rank(rows)] == [1, 2, 3]


def test_explicit_reality_scores_fixed_winner_and_rejects_another_branch(trained):
    _, value = context(trained)
    report = execute(value, trained.catalog.checkpoint("gru"))
    before = copy.deepcopy(report)
    actual = execute(reality_context(report))
    measured = verification(report, actual)
    assert measured["selection_updated"] is False
    assert report == before
    position = next(b["position"] for b in actual["frames"][-1]["objects"] if b["id"] == "orb-01")
    assert measured["actual_goal_distance_m"] == pytest.approx(
        ((position["x"] - 10) ** 2 + (position["y"] - 5) ** 2) ** 0.5
    )
    assert measured["target_error"]["id"] == "orb-01"
    with pytest.raises(ValueError, match="fixed learned selection"):
        verification(report, {**actual, "branch_id": "other"})


@pytest.mark.parametrize(
    "patch",
    [
        {"horizon": 121},
        {"velocity_delta": 0},
        {"goal": {"x": float("nan"), "y": 5}},
        {"goal": {"x": 25, "y": 5}},
    ],
)
def test_schema_rejects_unbounded_planning_requests(trained, patch):
    _, value = context(trained)
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(value["request"] | patch)


def test_static_target_source_mismatch_and_changed_weights_are_rejected(trained):
    _, value = context(trained)
    plan = Plan.model_validate(value["plan"])
    static = next(b.id for b in plan.snapshot.frame.objects if b.static)
    with pytest.raises(ValueError, match="dynamic"):
        candidates(plan, SearchRequest.model_validate(value["request"] | {"object_id": static}))
    with pytest.raises(ValueError, match="frozen source"):
        candidates(plan, SearchRequest.model_validate(value["request"] | {"anchor_tick": 13}))
    bad = copy.deepcopy(value)
    bad["model"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="checkpoint changed"):
        execute(bad, trained.catalog.checkpoint("gru"))


def test_candidate_velocity_and_work_limits(trained):
    _, value = context(trained)
    plan = Plan.model_validate(value["plan"])
    next(b for b in plan.snapshot.frame.objects if b.id == "orb-01").velocity.x = 99
    with pytest.raises(ValueError, match="100 m/s"):
        candidates(plan, SearchRequest.model_validate(value["request"]))
    plan.snapshot.frame.objects += [
        plan.snapshot.frame.objects[0].model_copy(update={"id": f"extra-{i}"}) for i in range(23)
    ]
    with pytest.raises(ValueError, match="32 objects"):
        candidates(plan, SearchRequest.model_validate(value["request"]))


def test_owner_storage_eviction_and_cleanup(trained):
    _, value = context(trained)
    report = execute(value, trained.catalog.checkpoint("gru"))
    store = PlanningStore()
    for i in range(3):
        store.put("owner", {**report, "id": str(i)})
    with pytest.raises(KeyError):
        store.get("owner", "0")
    with pytest.raises(KeyError):
        store.get("other", "2")
    store.discard_owner("owner")
    assert not store.reports


def test_real_api_worker_preserves_live_world_and_separates_reality(trained):
    session, value = context(trained)
    before = session.export().model_dump(exclude={"created_at"})

    def get_session(sid):
        if sid not in {"owner", "other"}:
            raise HTTPException(404, "Expired")
        return session

    app = FastAPI()
    app.include_router(create_router(get_session, PlanningStore(), trained))
    with TestClient(app) as client:
        response = client.post("/api/sessions/owner/planning/search", json=value["request"])
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["verification"] is None
        url = f"/api/sessions/owner/planning/{report['id']}"
        assert client.get(url).json() == report
        assert client.get(url.replace("owner", "other")).status_code == 404
        actual = client.post(url + "/reality").json()
        assert actual["selected_id"] == report["selected_id"]
        assert actual["candidates"] == report["candidates"]
        assert actual["verification"]["reality"]["source"] == "pymunk-7.2.0"
        assert session.export().model_dump(exclude={"created_at"}) == before
        session.playing = True
        assert (
            client.post("/api/sessions/owner/planning/search", json=value["request"]).status_code
            == 409
        )


def test_reality_only_worker_does_not_import_torch(trained):
    _, value = context(trained)
    report = execute(value, trained.catalog.checkpoint("gru"))
    code = (
        "import json,sys; from oracle.planning.worker import execute; "
        "execute(json.load(sys.stdin)); assert 'torch' not in sys.modules; "
        "print('reality has no torch')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        input=json.dumps(reality_context(report)),
        text=True,
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr


def test_cli_reproduces_search_and_protects_existing_output(trained, tmp_path):
    from oracle.datasets.storage import write_json

    _, value = context(trained)
    report = execute(value, trained.catalog.checkpoint("gru"))
    source, output = tmp_path / "source.json", tmp_path / "repeat.json"
    # Browser JSON.stringify writes integral floats as integers. Canonical hashing
    # must survive the actual UI export, including gravity 0.0 -> 0.
    exported = json.loads(
        json.dumps(report),
        parse_float=lambda text: int(float(text)) if float(text).is_integer() else float(text),
    )
    write_json(source, exported)
    command = [
        sys.executable,
        "-m",
        "oracle.plan",
        "--input",
        str(source),
        "--checkpoint",
        str(trained.catalog.checkpoint("gru")),
        "--output",
        str(output),
    ]
    result = subprocess.run(command, text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr
    repeated = json.loads(output.read_text())
    assert repeated["candidates"] == report["candidates"]
    assert repeated["search_sha256"] == report["search_sha256"]
    original = output.read_bytes()
    assert subprocess.run(command, capture_output=True, timeout=20).returncode != 0
    assert output.read_bytes() == original
    reality_output = tmp_path / "actual.json"
    verified = subprocess.run(
        [
            sys.executable,
            "-m",
            "oracle.plan",
            "--input",
            str(output),
            "--reality",
            "--output",
            str(reality_output),
        ],
        text=True,
        capture_output=True,
        timeout=20,
    )
    assert verified.returncode == 0, verified.stderr
    actual = json.loads(reality_output.read_text())
    assert actual["verification"]["selection_updated"] is False
    assert actual["candidates"] == repeated["candidates"]


def test_insufficient_observations_and_active_worker_are_rejected(trained):
    session, value = context(trained)
    session.update("orb-01", {"mass": 4})
    request = AnchorRequest(
        generation=session.generation, revision=session.revision, anchor_tick=session.engine.tick
    )
    value["plan"] = capture_snapshot(session, request).model_dump(mode="json")
    value["request"].update(request.model_dump())
    with pytest.raises(ValueError, match="more real history"):
        execute(value, trained.catalog.checkpoint("gru"))
    trained.lock.acquire()
    try:
        with pytest.raises(RuntimeError, match="Another prediction"):
            trained.run_planning(value)
    finally:
        trained.lock.release()
