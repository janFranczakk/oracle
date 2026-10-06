"""Real trained inference, isolated replay, correct metrics and stale-request boundaries."""

import json
import math
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from oracle import api
from oracle.datasets.engine import generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import read_json, write_json
from oracle.models.schema import ModelConfig
from oracle.predict import forecast
from oracle.prediction.catalog import ModelCatalog
from oracle.prediction.context import capture
from oracle.prediction.metrics import compare
from oracle.prediction.reference import replay_reference
from oracle.prediction.schema import PredictionRequest
from oracle.prediction.service import PredictionService
from oracle.scenes import scene
from oracle.session import Session
from oracle.training.engine import train
from oracle.training.schema import TrainConfig
from oracle.world import Frame, Vec2


@pytest.fixture(scope="module")
def models(tmp_path_factory):
    root = tmp_path_factory.mktemp("prediction")
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
    return root


def request_for(session, model="gru", horizon=5):
    return PredictionRequest(
        model_id=model,
        generation=session.generation,
        anchor_tick=session.engine.tick,
        revision=session.revision,
        horizon=horizon,
    )


@pytest.mark.parametrize("family", ["mlp", "gru", "transformer"])
def test_real_forecast_preserves_world_and_uses_checkpoint(models, family):
    session = Session()
    session.advance(12)
    before, history = session.payload(), [f.model_dump() for f in session.history]
    catalog = ModelCatalog(models)
    description = catalog.describe(family)
    context = capture(session, request_for(session, family), description)
    result = forecast(catalog.checkpoint(family), context)
    assert session.payload() == before
    assert [f.model_dump() for f in session.history] == history
    assert result["source"] == "learned_model" and result["uncertainty"] is None
    assert result["model_version"] == f"{family}/epoch-1"
    assert result["model"]["sha256"] == description.sha256
    assert [f["tick"] for f in result["frames"]] == [16, 20, 24, 28, 32]
    assert result["frames"] != result["reference"]["frames"]
    assert result["metrics"]["summary"]["objects_scored"] == 20
    for frame in result["frames"]:
        assert [b["id"] for b in frame["objects"]] == [b.id for b in session.engine.frame().objects]
        assert all(math.isfinite(b["position"]["x"]) for b in frame["objects"])


def test_transformer_worker_returns_real_seeded_intervals_and_measured_coverage(models):
    session = Session()
    session.advance(12)
    service = PredictionService(models)
    request = request_for(session, "transformer").model_copy(
        update={"samples": 16, "sampling_seed": 23}
    )
    context = capture(session, request, service.catalog.describe("transformer"))
    result = service.run(context)
    repeat = service.run(context)
    assert result["uncertainty"] == repeat["uncertainty"]
    assert result["attention"] == repeat["attention"]
    assert result["uncertainty"]["samples"] == 16
    assert result["uncertainty"]["calibrated"] is False
    assert 0 <= result["uncertainty"]["measurement"]["coverage_xy"] <= 1
    assert result["uncertainty"]["measurement"]["objects_scored"] == 20
    assert result["attention"]["causal_explanation"] is False
    point_context = capture(
        session, request_for(session, "transformer"), service.catalog.describe("transformer")
    )
    assert service.run(point_context)["frames"] == result["frames"]


def test_worker_process_and_api_import_boundary(models):
    session = Session()
    session.advance(4)
    service = PredictionService(models)
    context = capture(session, request_for(session), service.catalog.describe("gru"))
    result = service.run(context)
    assert result["reference"]["source"] == "pymunk-7.2.0"
    proc = subprocess.run(
        [sys.executable, "-c", "import oracle.api, sys; assert 'torch' not in sys.modules"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert not proc.stdout


def test_reference_preserves_contact_caches_and_ignores_future_edits():
    session = Session(scene(preset="collision"))
    session.advance(180)
    session.update("orb-01", {"mass": 9})
    session.advance(100)
    session.seek(120)
    anchor = session.engine.frame()
    reference = replay_reference(session.export(), anchor, 4, 30)
    control = Session.restore(session.export())
    control.events = [e for e in control.events if e.tick <= anchor.tick]
    expected = []
    for _ in range(30):
        control.advance(4)
        expected.append(
            control.engine.frame().model_copy(update={"collisions": control.latest_collisions})
        )
    assert reference == expected
    assert session.engine.tick == 120 and session.duration == 280


def test_history_requires_real_post_edit_samples(models):
    session = Session()
    model = ModelCatalog(models).describe("gru")
    with pytest.raises(ValueError, match="Record 4"):
        capture(session, request_for(session), model)
    session.advance(8)
    session.update("orb-01", {"mass": 9})
    with pytest.raises(ValueError, match="Record 4"):
        capture(session, request_for(session), model)
    session.advance(4)
    context = capture(session, request_for(session), model)
    assert [f["tick"] for f in context["history"]] == [8, 12]
    assert next(b for b in context["history"][0]["objects"] if b["id"] == "orb-01")["mass"] == 9


def test_forecast_after_material_and_static_geometry_edits(models):
    session = Session()
    session.advance(4)
    session.update("orb-01", {"mass": 9})
    session.update("ramp-1", {"rotation": 0.5})
    session.advance(4)
    catalog = ModelCatalog(models)
    context = capture(session, request_for(session), catalog.describe("gru"))
    result = forecast(catalog.checkpoint("gru"), context)
    for frame in result["frames"] + result["reference"]["frames"]:
        assert next(b for b in frame["objects"] if b["id"] == "orb-01")["mass"] == 9
        assert next(b for b in frame["objects"] if b["id"] == "ramp-1")["rotation"] == 0.5
    assert session.engine.tick == 8 and session.duration == 8


def test_environment_static_world_and_time_limits(models):
    session = Session()
    model = ModelCatalog(models).describe("gru")
    session.advance(4)
    changed = model.model_copy(update={"gravity": (0, -5)})
    with pytest.raises(ValueError, match="gravity"):
        capture(session, request_for(session), changed)
    session.engine.tick = 14400
    with pytest.raises(ValueError, match="120-second"):
        capture(session, request_for(session), model)
    empty = Session(scene(preset="empty"))
    empty.advance(4)
    with pytest.raises(ValueError, match="dynamic"):
        capture(empty, request_for(empty), model)


def test_model_catalog_rejects_missing_provenance_and_paths(models, tmp_path):
    catalog = ModelCatalog(models)
    for identity in ("../gru", "gru/../../secret", "missing"):
        with pytest.raises(ValueError):
            catalog.checkpoint(identity)
    assert {m["architecture"]["family"] for m in catalog.list()["models"]} == {
        "mlp",
        "gru",
        "transformer",
    }
    import shutil

    shutil.copytree(models / "gru", tmp_path / "bad")
    value = read_json(tmp_path / "bad/best.metadata.json")
    del value["dataset"]["gravity"]
    write_json(tmp_path / "bad/best.metadata.json", value)
    assert ModelCatalog(tmp_path).list() == {"models": [], "unavailable": ["bad"]}


def test_tampered_weights_are_not_used(models, tmp_path):
    import shutil

    shutil.copytree(models / "gru", tmp_path / "bad")
    session = Session()
    session.advance(4)
    catalog = ModelCatalog(tmp_path)
    context = capture(session, request_for(session, "bad"), catalog.describe("bad"))
    with catalog.checkpoint("bad").open("ab") as stream:
        stream.write(b"tampered")
    with pytest.raises(ValueError, match="checksum"):
        forecast(catalog.checkpoint("bad"), context)


def test_metrics_physical_units_periodic_rotation_and_contact_counts():
    dynamic = scene().objects[-1].model_copy(update={"id": "a", "static": False})
    static = scene().objects[0]
    actual = [Frame(tick=t, objects=[dynamic, static]) for t in (4, 8)]
    predicted = [
        Frame(
            tick=t,
            objects=[
                dynamic.model_copy(
                    update={
                        "position": Vec2(x=dynamic.position.x + dx, y=dynamic.position.y + dy),
                        "velocity": Vec2(x=dynamic.velocity.x + 2, y=dynamic.velocity.y),
                        "rotation": dynamic.rotation + 2 * math.pi,
                    }
                ),
                static,
            ],
            collisions=contacts,
        )
        for t, dx, dy, contacts in [(4, 3, 4, ["a"]), (8, 0, 2, [])]
    ]
    scores = compare(predicted, actual, 0, 1 / 120)
    summary = scores["summary"]
    assert summary["ade_m"] == 3.5 and summary["fde_m"] == 2
    assert summary["position_mse"] == 29 / 4 and summary["velocity_mse"] == 2
    assert summary["rotation_mae_rad"] < 1e-12
    assert summary["contact_counts"] == {"tp": 0, "tn": 1, "fp": 1, "fn": 0}
    assert summary["contact_balanced_accuracy"] is None
    assert scores["horizons"][1]["seconds"] == 8 / 120
    with pytest.raises(ValueError, match="match"):
        compare(predicted, [actual[0], actual[1].model_copy(update={"tick": 9})], 0, 1 / 120)


@pytest.mark.parametrize("mutation", ["edit", "seek", "step", "reset", "scene", "play"])
def test_api_discards_stale_result_without_blocking_commands(models, monkeypatch, mutation):
    service = PredictionService(models)
    started, release = threading.Event(), threading.Event()

    def slow(context):
        started.set()
        assert release.wait(5)
        return {"source": "learned_model"}

    monkeypatch.setattr(service, "run", slow)
    monkeypatch.setattr(api, "predictions", service)
    with TestClient(api.app) as client, ThreadPoolExecutor() as pool, ExitStack() as stack:
        created = client.post("/api/sessions", json={}).json()
        sid = created["id"]
        stack.enter_context(client.websocket_connect(f"/ws/{sid}"))
        state = client.post(
            f"/api/sessions/{sid}/commands", json={"kind": "step", "steps": 8}
        ).json()
        body = request_for(api.sessions[sid]).model_dump(mode="json")
        pending = pool.submit(client.post, f"/api/sessions/{sid}/predict", json=body)
        assert started.wait(5)
        if mutation == "scene":
            response = client.post(f"/api/sessions/{sid}/scene", json={"scene": "empty"})
        else:
            cmd = {"kind": mutation}
            if mutation == "edit":
                cmd.update(object_id="orb-01", patch={"mass": 9})
            if mutation == "seek":
                cmd["tick"] = state["tick"]
            response = client.post(f"/api/sessions/{sid}/commands", json=cmd)
        assert response.status_code == 200
        release.set()
        assert pending.result(timeout=5).status_code == 409
    api.sessions.clear()


def test_worker_timeout_releases_prediction_capacity(models, monkeypatch):
    service = PredictionService(models)
    session = Session()
    session.advance(4)
    context = capture(session, request_for(session), service.catalog.describe("gru"))

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("prediction", 45)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(ValueError, match="45 seconds"):
        service.run(context)
    assert not service.lock.locked()


def test_missing_ml_dependencies_and_invalid_model_do_not_change_world(models, monkeypatch):
    monkeypatch.setattr(api, "predictions", PredictionService(models))
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={}).json()["id"]
        api.sessions[sid].advance(4)
        before = client.get(f"/api/sessions/{sid}").json()
        request = request_for(api.sessions[sid]).model_dump()
        result = client.post(
            f"/api/sessions/{sid}/predict", json={**request, "model_id": "missing"}
        )
        assert result.status_code == 422
        assert "Traceback" not in result.text
        monkeypatch.setattr(api.importlib.util, "find_spec", lambda _: None)
        assert client.post(f"/api/sessions/{sid}/predict", json=request).status_code == 503
        assert client.get(f"/api/sessions/{sid}").json() == before
    api.sessions.clear()


def test_api_request_bounds_busy_and_current_anchor(models, monkeypatch):
    service = PredictionService(models)
    monkeypatch.setattr(api, "predictions", service)
    with TestClient(api.app) as client:
        sid = client.post("/api/sessions", json={}).json()["id"]
        session = api.sessions[sid]
        assert (
            client.post(
                f"/api/sessions/{sid}/predict", json=request_for(session).model_dump()
            ).status_code
            == 422
        )
        session.advance(4)
        request = request_for(session).model_dump()
        assert (
            client.post(
                f"/api/sessions/{sid}/predict", json={**request, "horizon": 121}
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/sessions/{sid}/predict", json={**request, "revision": 99}
            ).status_code
            == 409
        )
        service.lock.acquire()
        try:
            assert client.post(f"/api/sessions/{sid}/predict", json=request).status_code == 409
        finally:
            service.lock.release()
        result = client.post(f"/api/sessions/{sid}/predict", json=request)
        assert result.status_code == 200
        assert client.get(f"/api/sessions/{sid}").json()["tick"] == 4
        assert json.dumps(result.json(), allow_nan=False)
    api.sessions.clear()
