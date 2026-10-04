"""Versioned, SI-unit world schemas. Positive y points up; angles are radians."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Scalar = Annotated[float, Field(allow_inf_nan=False)]
Coordinate = Annotated[float, Field(ge=-1e9, le=1e9, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Vec2(StrictModel):
    x: Coordinate = 0
    y: Coordinate = 0


class Shape(StrEnum):
    CIRCLE = "circle"
    BOX = "box"
    RAMP = "ramp"
    WALL = "wall"
    PLATFORM = "platform"


class BodyState(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    label: str = Field(min_length=1, max_length=60)
    shape: Shape
    static: bool = False
    position: Vec2
    velocity: Vec2 = Field(default_factory=Vec2)
    rotation: Scalar = Field(default=0, ge=-1e9, le=1e9)
    angular_velocity: Scalar = Field(default=0, ge=-1e9, le=1e9)
    mass: Scalar = Field(default=2, ge=0.05, le=100)
    friction: Scalar = Field(default=0.5, ge=0, le=1)
    restitution: Scalar = Field(default=0.65, ge=0, le=1)
    width: Scalar = Field(default=1, ge=0.1, le=30)
    height: Scalar = Field(default=1, ge=0.1, le=20)
    radius: Scalar = Field(default=0.5, ge=0.1, le=3)


class Environment(StrictModel):
    width: Literal[24] = 24
    height: Literal[14] = 14
    gravity: Vec2 = Field(default_factory=lambda: Vec2(y=-9.81))
    dt: Literal[0.008333333333333333] = 1 / 120
    iterations: Literal[20] = 20

    @model_validator(mode="after")
    def bounded_gravity(self) -> "Environment":
        if max(abs(self.gravity.x), abs(self.gravity.y)) > 100:
            raise ValueError("Gravity components must stay within ±100 m/s²")
        return self


class World(StrictModel):
    seed: int = Field(ge=0, le=2**32 - 1)
    scene: Literal["incline", "collision", "empty"] = "incline"
    environment: Environment = Field(default_factory=Environment)
    objects: list[BodyState] = Field(max_length=64)

    @model_validator(mode="after")
    def unique_ids(self) -> "World":
        ids = [obj.id for obj in self.objects]
        if len(set(ids)) != len(ids):
            raise ValueError("Object identifiers must be unique")
        return self


class Frame(StrictModel):
    tick: int = Field(ge=0)
    objects: list[BodyState]
    collisions: list[str] = Field(default_factory=list)


class EditEvent(StrictModel):
    tick: int = Field(ge=0, le=14400)
    kind: Literal["upsert", "remove"]
    object: BodyState | None = None
    object_id: str | None = None

    @model_validator(mode="after")
    def valid_payload(self) -> "EditEvent":
        if self.kind == "upsert" and self.object is None:
            raise ValueError("An upsert requires an object")
        if self.kind == "remove" and self.object_id is None:
            raise ValueError("A removal requires an object ID")
        return self


class Experiment(StrictModel):
    schema_version: Literal[1] = 1
    engine: Literal["pymunk-7.2.0"] = "pymunk-7.2.0"
    model_version: None = None
    created_at: str
    origin: World
    events: list[EditEvent] = Field(default_factory=list, max_length=512)
    playhead: int = Field(ge=0, le=14400)
    duration: int = Field(ge=0, le=14400)

    @model_validator(mode="after")
    def ordered_events(self) -> "Experiment":
        if self.playhead > self.duration:
            raise ValueError("Playhead exceeds recorded duration")
        ticks = [event.tick for event in self.events]
        if ticks != sorted(ticks) or any(t > self.duration for t in ticks):
            raise ValueError("Invalid event chronology")
        ids = {obj.id for obj in self.origin.objects}
        for event in self.events:
            if event.kind == "upsert" and event.object is not None:
                ids.add(event.object.id)
            elif event.object_id not in ids:
                raise ValueError("Removal refers to a missing object")
            else:
                ids.remove(event.object_id)
            if len(ids) > 64:
                raise ValueError("An experiment supports up to 64 objects")
        return self
