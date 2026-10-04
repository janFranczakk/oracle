import pytest
from pydantic import ValidationError

from oracle.session import MAX_TICKS, Session
from oracle.world import EditEvent, Environment, Vec2


def test_outside_world_and_fast_rotation_do_not_break_state_serialization():
    session = Session()
    session.update("orb-01", {"position": {"x": 30, "y": 2}, "angular_velocity": 100})
    for _ in range(4):
        session.advance(600)
    orb = next(o for o in session.engine.frame().objects if o.id == "orb-01")
    assert orb.position.y < -1000
    assert orb.rotation > 1000
    assert session.export().model_dump_json()


def test_extreme_input_is_rejected_before_replacing_the_body():
    session = Session()
    before = session.engine.frame()
    with pytest.raises(ValueError, match="range"):
        session.update("orb-01", {"velocity": {"x": 1e8, "y": 0}})
    assert session.engine.frame() == before


def test_environment_rejects_unbounded_gravity():
    with pytest.raises(ValidationError):
        Environment(gravity=Vec2(y=-1e8))


def test_collision_events_survive_stream_sampling():
    session = Session()
    session.advance(300)
    contacts = sorted({i for frame in session.history[1:] for i in frame.collisions})
    assert contacts and session.payload(full=False)["collisions"] == contacts


def test_recording_limit_pauses_and_prevents_further_steps():
    session = Session()
    # Empty scene makes the full bounded replay inexpensive.
    from oracle.scenes import scene

    session = Session(scene(preset="empty"))
    for _ in range(MAX_TICKS // 600):
        session.advance(600)
    session.playing = True
    session.advance(1)
    assert session.engine.tick == MAX_TICKS and not session.playing


def test_imported_event_cannot_exceed_the_object_limit():
    session = Session()
    experiment = session.export()
    body = session.origin.objects[6]
    experiment.events = [
        EditEvent(tick=0, kind="upsert", object=body.model_copy(update={"id": f"clone-{i}"}))
        for i in range(65)
    ]
    with pytest.raises(ValidationError, match="64"):
        type(experiment).model_validate_json(experiment.model_dump_json())


def test_portable_clone_does_not_share_origin_or_edit_definitions():
    source = Session()
    source.update("orb-01", {"mass": 4})
    cloned = Session.restore(source.export())
    cloned.origin.objects[0].mass = 8
    cloned.events[0].object.mass = 9
    assert source.origin.objects[0].mass == 2
    assert source.events[0].object.mass == 4
