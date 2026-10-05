"""Freeze real observations and journal state on the API event loop before worker inference."""

import math

from oracle.prediction.schema import ModelDescription, PredictionRequest
from oracle.session import MAX_TICKS, Session


def matches(session: Session, request: PredictionRequest) -> bool:
    return (
        not session.playing
        and session.generation == request.generation
        and session.engine.tick == request.anchor_tick
        and session.revision == request.revision
    )


def capture(session: Session, request: PredictionRequest, model: ModelDescription) -> dict:
    if not matches(session, request):
        raise RuntimeError("The world changed. Pause and predict again from its current state.")
    env = session.origin.environment
    if not all(
        math.isclose(a, b, abs_tol=1e-12)
        for a, b in zip((env.gravity.x, env.gravity.y), model.gravity, strict=True)
    ) or not math.isclose(env.dt * model.sample_stride, model.sample_dt, abs_tol=1e-12):
        raise ValueError("This model was trained with a different gravity or observation clock")
    tick, stride = request.anchor_tick, model.sample_stride
    start = tick - (model.architecture.history - 1) * stride
    last_edit = max((e.tick for e in session.events if e.tick <= tick), default=0)
    if start < last_edit:
        required = last_edit + (model.architecture.history - 1) * stride - tick
        raise ValueError(
            f"Record {required} more physics ticks after the last edit before predicting"
        )
    if tick + request.horizon * stride > MAX_TICKS:
        raise ValueError("This forecast would exceed the 120-second experiment limit")
    frames = [session.history[t].model_copy(deep=True) for t in range(start, tick + 1, stride)]
    if not any(not body.static for body in frames[-1].objects):
        raise ValueError("Add a dynamic object before predicting")
    experiment = session.export()
    # Replay only conditions known at the anchor, never future edits recorded after a seek.
    experiment.events = [e for e in experiment.events if e.tick <= tick]
    experiment.duration = tick
    return {
        "request": request.model_dump(mode="json"),
        "model": model.model_dump(mode="json"),
        "history": [frame.model_dump(mode="json") for frame in frames],
        "experiment": experiment.model_dump(mode="json"),
    }
