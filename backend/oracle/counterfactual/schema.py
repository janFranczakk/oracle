"""Portable plans contain data and edit intent, never executable model artifacts."""

from typing import Literal

from pydantic import Field, model_validator

from oracle.prediction.uncertainty import SamplingOptions
from oracle.world import BodyState, Experiment, Frame, Scalar, StrictModel, Vec2


class ObjectPatch(StrictModel):
    position: Vec2 | None = None
    velocity: Vec2 | None = None
    mass: Scalar | None = Field(default=None, ge=0.05, le=100)
    friction: Scalar | None = Field(default=None, ge=0, le=1)
    restitution: Scalar | None = Field(default=None, ge=0, le=1)
    rotation: Scalar | None = Field(default=None, ge=-1e6, le=1e6)
    angular_velocity: Scalar | None = Field(default=None, ge=-1000, le=1000)
    width: Scalar | None = Field(default=None, ge=0.1, le=30)
    height: Scalar | None = Field(default=None, ge=0.1, le=20)
    radius: Scalar | None = Field(default=None, ge=0.1, le=3)

    @model_validator(mode="after")
    def nonempty(self) -> "ObjectPatch":
        if not self.model_dump(exclude_none=True):
            raise ValueError("Choose at least one property to change")
        return self


class Change(StrictModel):
    kind: Literal["update", "add", "remove"]
    object_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    patch: ObjectPatch | None = None
    object: BodyState | None = None

    @model_validator(mode="after")
    def payload(self) -> "Change":
        valid = {
            "update": self.object_id is not None and self.patch is not None and self.object is None,
            "remove": self.object_id is not None and self.patch is None and self.object is None,
            "add": self.object is not None and self.object_id is None and self.patch is None,
        }
        if not valid[self.kind]:
            raise ValueError("Intervention payload does not match its kind")
        return self


class AnchorRequest(StrictModel):
    generation: str = Field(pattern=r"^[a-f0-9]{32}$")
    anchor_tick: int = Field(ge=0, le=14400)
    revision: int = Field(ge=0)


class Snapshot(StrictModel):
    created_at: str = Field(max_length=80)
    source: AnchorRequest
    experiment: Experiment
    frame: Frame

    @model_validator(mode="after")
    def anchor(self) -> "Snapshot":
        tick = self.source.anchor_tick
        if not (self.frame.tick == self.experiment.playhead == self.experiment.duration == tick):
            raise ValueError("Snapshot clocks must identify the same frozen anchor")
        if len(self.frame.objects) > 64:
            raise ValueError("Snapshot supports up to 64 objects")
        if len({b.id for b in self.frame.objects}) != len(self.frame.objects):
            raise ValueError("Snapshot object identifiers must be unique")
        return self


class Branch(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=60)
    parent_id: str | None = None
    changes: list[Change] = Field(default_factory=list, max_length=4)


class Plan(StrictModel):
    format: Literal["oracle-counterfactual-plan-v1"] = "oracle-counterfactual-plan-v1"
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    snapshot: Snapshot
    branches: list[Branch] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def graph(self) -> "Plan":
        ancestors: dict[str, tuple[int, int]] = {}
        for index, branch in enumerate(self.branches):
            if branch.id in ancestors:
                raise ValueError("Branch identifiers must be unique")
            if index == 0:
                if branch.parent_id is not None or branch.changes:
                    raise ValueError("The root must be an unchanged observed baseline")
                ancestors[branch.id] = (0, 0)
                continue
            if branch.parent_id not in ancestors or not branch.changes:
                raise ValueError("Each alternative needs an earlier parent and interventions")
            depth, count = ancestors[branch.parent_id]
            if depth >= 8 or count + len(branch.changes) > 16:
                raise ValueError("A branch path supports eight levels and sixteen interventions")
            ancestors[branch.id] = (depth + 1, count + len(branch.changes))
        return self


class CreateBranch(StrictModel):
    parent_id: str
    name: str = Field(min_length=1, max_length=60)
    changes: list[Change] = Field(min_length=1, max_length=4)


class ExecutionRequest(SamplingOptions):
    horizon: int = Field(default=50, ge=1, le=120)
    sample_stride: int = Field(default=4, ge=1, le=120)
    model_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,80}$")
