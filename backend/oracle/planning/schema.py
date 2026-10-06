"""A terminal-position goal and bounded single-anchor velocity actions."""

from pydantic import Field

from oracle.counterfactual.schema import AnchorRequest
from oracle.world import Scalar, StrictModel


class Goal(StrictModel):
    x: Scalar = Field(ge=0, le=24)
    y: Scalar = Field(ge=0, le=14)
    tolerance_m: Scalar = Field(default=0.5, ge=0.05, le=3)


class SearchRequest(AnchorRequest):
    model_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    object_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    goal: Goal
    horizon: int = Field(default=50, ge=1, le=120)
    velocity_delta: Scalar = Field(default=3, ge=0.1, le=15)
