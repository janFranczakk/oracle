import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from oracle.api import app, clients, sessions
from oracle.physics import PhysicsEngine
from oracle.scenes import scene
from oracle.session import Session
from oracle.world import BodyState, EditEvent, Experiment, Shape, Vec2, World


def advance(session: Session, ticks: int) -> None:
    while ticks:
        batch = min(600, ticks)
        session.advance(batch)
        ticks -= batch


@pytest.mark.parametrize("preset", ["incline", "collision", "empty"])
def test_seeded_initial_conditions(preset):
    assert scene(81, preset) == scene(81, preset)
    if preset != "empty":
        assert scene(81, preset).objects != scene(82, preset).objects


@pytest.mark.parametrize("preset", ["incline", "collision"])
def test_determinism_including_collisions(preset):
    a, b = Session(scene(55, preset)), Session(scene(55, preset))
    advance(a, 1200)
    advance(b, 1200)
    assert a.history == b.history
    assert any(frame.collisions for frame in a.history)


def test_gravity_and_ground_contact_are_real_engine_dynamics():
    s = Session()
    before = s.engine.frame().objects[6]
    s.advance(60)
    after = s.engine.frame().objects[6]
    assert after.velocity.y < before.velocity.y
    assert after.position.y < before.position.y
    advance(s, 1800)
    assert all(o.position.y >= 0.35 for o in s.engine.frame().objects if not o.static)


def test_exact_replay_after_contact_and_same_tick_edits():
    s = Session(scene(123, "collision"))
    advance(s, 500)
    s.update("orb-01", {"mass": 4.2})
    s.update("orb-02", {"velocity": {"x": 4, "y": 3}})
    advance(s, 600)
    s.seek(690)
    exported = Experiment.model_validate_json(s.export().model_dump_json())
    restored = Session.restore(exported)
    assert restored.engine.frame() == s.engine.frame()
    assert restored.history == s.history
    s.advance(410)
    restored.advance(410)
    assert restored.engine.frame() == s.engine.frame()


def test_seeking_then_playing_replays_future_edits():
    s = Session()
    s.advance(120)
    s.update("orb-01", {"velocity": {"x": 5, "y": 2}})
    s.advance(120)
    expected = s.engine.frame()
    s.seek(30)
    s.advance(210)
    assert s.engine.frame() == expected


def test_editing_the_past_truncates_future():
    s = Session()
    s.advance(240)
    s.update("orb-01", {"mass": 3})
    s.advance(100)
    s.seek(60)
    s.update("orb-01", {"mass": 5})
    assert s.duration == 60
    assert len(s.events) == 1
    assert s.events[0].tick == 60


def test_clone_isolated_from_source():
    source = Session()
    clone = Session.restore(source.export())
    clone.update("orb-01", {"mass": 9})
    assert source.engine.frame().objects[6].mass != clone.engine.frame().objects[6].mass
    assert not source.events


def test_serialization_uses_si_units_and_preserves_state():
    world = scene(77)
    assert World.model_validate_json(world.model_dump_json()) == world
    s = Session(world)
    s.advance(250)
    assert Session.restore(s.export()).engine.frame() == s.engine.frame()


def test_add_remove_and_duplicate_shape():
    s = Session(scene(preset="empty"))
    body = BodyState(
        id="custom", label="Custom block", shape=Shape.BOX, position=Vec2(x=10, y=8), rotation=0.3
    )
    s.edit(EditEvent(tick=0, kind="upsert", object=body))
    assert "custom" in s.engine.bodies
    s.advance(50)
    s.edit(EditEvent(tick=0, kind="remove", object_id="custom"))
    assert "custom" not in s.engine.bodies
    assert Session.restore(s.export()).engine.frame() == s.engine.frame()


def test_static_ramp_edit_changes_ground_truth_without_mutating_origin():
    s = Session()
    s.update("ramp-1", {"rotation": 0.5})
    assert next(o for o in s.engine.frame().objects if o.id == "ramp-1").rotation == 0.5
    assert s.origin.objects[3].rotation == -0.25


def test_edit_rejected_while_playing():
    s = Session()
    s.playing = True
    with pytest.raises(ValueError, match="Pause"):
        s.update("orb-01", {"mass": 3})


@pytest.mark.parametrize(
    "patch",
    [
        {"mass": -1},
        {"position": {"x": float("nan"), "y": 1}},
        {"restitution": 2},
        {"shape": "wall"},
    ],
)
def test_invalid_edits_leave_world_untouched(patch):
    s = Session()
    before = s.engine.frame()
    with pytest.raises((ValueError, ValidationError)):
        s.update("orb-01", patch)
    assert s.engine.frame() == before


def test_missing_object_removal_does_not_truncate_history():
    s = Session()
    s.advance(100)
    s.seek(50)
    with pytest.raises(ValueError):
        s.edit(EditEvent(tick=50, kind="remove", object_id="absent"))
    assert s.duration == 100


@pytest.mark.parametrize("tick", [-1, 1, 14401])
def test_invalid_seek(tick):
    with pytest.raises(ValueError):
        Session().seek(tick)


def test_duplicate_world_ids_rejected():
    world = scene()
    with pytest.raises(ValidationError):
        World(seed=42, objects=[world.objects[0], world.objects[0]])


def test_no_physics_powered_prediction_endpoint():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["model_available"] is False
        assert client.post("/api/predict", json={}).status_code == 404


@pytest.fixture
def client():
    sessions.clear()
    clients.clear()
    with TestClient(app) as instance:
        yield instance
    sessions.clear()
    clients.clear()


def test_api_commands_stream_and_snapshot_restore(client):
    created = client.post("/api/sessions", json={"seed": 42}).json()
    sid = created["id"]
    with client.websocket_connect(f"/ws/{sid}") as ws:
        assert ws.receive_json()["type"] == "full"
        response = client.post(f"/api/sessions/{sid}/commands", json={"kind": "step", "steps": 100})
        assert response.json()["tick"] == 100
        assert ws.receive_json()["tick"] == 100
        snapshot = client.get(f"/api/sessions/{sid}/export").json()
        client.post(f"/api/sessions/{sid}/commands", json={"kind": "step", "steps": 50})
        ws.receive_json()
        restored = client.post(f"/api/sessions/{sid}/restore", json=snapshot)
        assert restored.status_code == 200
        assert restored.json()["objects"] == response.json()["objects"]
        assert restored.json()["playing"] is False
        assert ws.receive_json()["tick"] == 100


def test_api_rejects_bad_import_atomically(client):
    sid = client.post("/api/sessions", json={}).json()["id"]
    before = client.get(f"/api/sessions/{sid}").json()
    data = client.get(f"/api/sessions/{sid}/export").json()
    data["events"] = [{"tick": 0, "kind": "remove", "object_id": "missing"}]
    assert client.post(f"/api/sessions/{sid}/restore", json=data).status_code == 422
    assert client.get(f"/api/sessions/{sid}").json() == before
    data["engine"] = "incompatible"
    assert client.post(f"/api/sessions/{sid}/restore", json=data).status_code == 422


def test_api_validates_inputs_and_new_scene(client):
    assert client.post("/api/sessions", json={"seed": -1}).status_code == 422
    sid = client.post("/api/sessions", json={}).json()["id"]
    assert (
        client.post(f"/api/sessions/{sid}/commands", json={"kind": "speed", "speed": 9}).status_code
        == 422
    )
    result = client.post(f"/api/sessions/{sid}/scene", json={"seed": 99, "scene": "empty"}).json()
    assert result["seed"] == 99 and len(result["objects"]) == 3
    assert client.get(f"/api/sessions/{sid}/history").json()["frames"][0]["tick"] == 0
    assert json.dumps(result)


def test_transform_stream_omits_static_geometry():
    s = Session()
    s.advance(12)
    payload = s.payload(full=False)
    assert "objects" not in payload and "seed" not in payload
    assert len(payload["transforms"]) == 4
    assert all(
        set(t) == {"id", "position", "velocity", "rotation", "angular_velocity"}
        for t in payload["transforms"]
    )


def test_engine_is_not_mutated_by_reading_frames():
    engine = PhysicsEngine(scene())
    frame = engine.frame()
    frame.objects[6].position.x = 99
    assert engine.frame().objects[6].position.x == 5
