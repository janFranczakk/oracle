"""Timeline, editing and replay. Portable snapshots contain data, never pickled code."""

from datetime import UTC, datetime
from time import monotonic

from oracle.physics import PhysicsEngine
from oracle.scenes import scene
from oracle.world import BodyState, EditEvent, Experiment, World

MAX_TICKS = 14400


class Session:
    def __init__(self, world: World | None = None):
        self.origin = world.model_copy(deep=True) if world is not None else scene()
        self.engine = PhysicsEngine(self.origin)
        self.events: list[EditEvent] = []
        self.history = [self.engine.frame()]
        self.playing = False
        self.speed = 1.0
        self.last_active = monotonic()
        self.revision = 0
        self.latest_collisions: list[str] = []

    @property
    def duration(self) -> int:
        return len(self.history) - 1

    def seek(self, tick: int) -> None:
        """Rebuild solver caches by replay, rather than copying incomplete body snapshots."""
        if not 0 <= tick <= self.duration:
            raise ValueError("Choose a recorded timeline frame")
        self.playing = False
        engine = PhysicsEngine(self.origin)
        events: dict[int, list[EditEvent]] = {}
        for event in self.events:
            events.setdefault(event.tick, []).append(event)
        for t in range(tick + 1):
            for event in events.get(t, []):
                engine.apply(event)
            if t < tick:
                engine.step()
        self.engine = engine
        self.latest_collisions = self.history[tick].collisions.copy()
        self.revision += 1

    def advance(self, steps: int = 1) -> None:
        if not 1 <= steps <= 600:
            raise ValueError("Step count must be between 1 and 600")
        contacts: set[str] = set()
        for _ in range(min(steps, MAX_TICKS - self.engine.tick)):
            frame = self.engine.step()
            contacts.update(frame.collisions)
            for event in self.events:
                if event.tick == frame.tick:
                    self.engine.apply(event)
                    frame = self.engine.frame()
            if frame.tick < len(self.history):
                self.history[frame.tick] = frame
            else:
                self.history.append(frame)
        self.latest_collisions = sorted(contacts)
        if self.engine.tick >= MAX_TICKS:
            self.playing = False

    def edit(self, event: EditEvent) -> None:
        if self.playing:
            raise ValueError("Pause the world before editing objects")
        if len(self.events) >= 512:
            raise ValueError("This experiment has reached its edit limit")
        if event.kind == "upsert" and event.object is not None:
            if event.object.id not in self.engine.bodies and len(self.engine.bodies) >= 64:
                raise ValueError("The scene supports up to 64 objects")
        event = event.model_copy(update={"tick": self.engine.tick})
        self.engine.apply(event)
        # Editing the past intentionally forks the ground-truth recording at this playhead.
        self.events = [e for e in self.events if e.tick <= self.engine.tick]
        self.events.append(event)
        self.history = self.history[: self.engine.tick + 1]
        self.history[-1] = self.engine.frame()
        self.revision += 1

    def update(self, object_id: str, patch: dict) -> None:
        current = next((o for o in self.engine.frame().objects if o.id == object_id), None)
        if current is None:
            raise ValueError("This object no longer exists")
        if set(patch) - {
            "position",
            "velocity",
            "mass",
            "friction",
            "restitution",
            "rotation",
            "angular_velocity",
            "width",
            "height",
            "radius",
        }:
            raise ValueError("Unsupported object properties")
        updated = BodyState.model_validate(current.model_dump() | patch)
        self.edit(EditEvent(tick=self.engine.tick, kind="upsert", object=updated))

    def export(self) -> Experiment:
        return Experiment(
            created_at=datetime.now(UTC).isoformat(),
            origin=self.origin,
            events=self.events,
            playhead=self.engine.tick,
            duration=self.duration,
        ).model_copy(deep=True)

    @classmethod
    def restore(cls, experiment: Experiment) -> "Session":
        """Replay all events to regenerate history, then place the paused playhead."""
        result = cls(experiment.origin)
        for event in experiment.events:
            if event.tick == 0:
                result.engine.apply(event)
        result.history[0] = result.engine.frame()
        result.events = [event.model_copy(deep=True) for event in experiment.events]
        while result.engine.tick < experiment.duration:
            result.advance(min(600, experiment.duration - result.engine.tick))
        result.seek(experiment.playhead)
        return result

    def payload(self, full: bool = True) -> dict:
        frame = self.engine.frame()
        envelope = {
            "type": "full" if full else "frame",
            "tick": frame.tick,
            "duration": self.duration,
            "playing": self.playing,
            "speed": self.speed,
            "revision": self.revision,
            "collisions": self.latest_collisions,
        }
        if full:
            envelope.update(
                {
                    "objects": [o.model_dump() for o in frame.objects],
                    "seed": self.origin.seed,
                    "scene": self.origin.scene,
                    "environment": self.origin.environment.model_dump(),
                }
            )
        else:
            envelope["transforms"] = [
                {
                    "id": o.id,
                    "position": o.position.model_dump(),
                    "velocity": o.velocity.model_dump(),
                    "rotation": o.rotation,
                    "angular_velocity": o.angular_velocity,
                }
                for o in frame.objects
                if not o.static
            ]
        return envelope
