"""Independent Pymunk replay; no learned model calls and no live Session mutation."""

from oracle.physics import PhysicsEngine
from oracle.world import Experiment, Frame


def replay_reference(
    experiment: Experiment, anchor: Frame, stride: int, horizon: int
) -> list[Frame]:
    engine = PhysicsEngine(experiment.origin)
    events = {}
    for event in experiment.events:
        if event.tick <= anchor.tick:
            events.setdefault(event.tick, []).append(event)
    for tick in range(anchor.tick + 1):
        for event in events.get(tick, []):
            engine.apply(event)
        if tick < anchor.tick:
            engine.step()
    if engine.frame().objects != anchor.objects:
        raise ValueError("The reference replay does not match the observed anchor")
    frames = []
    for _ in range(horizon):
        contacts = set()
        for _ in range(stride):
            frame = engine.step()
            contacts.update(frame.collisions)
        frames.append(frame.model_copy(update={"collisions": sorted(contacts)}))
    return frames
