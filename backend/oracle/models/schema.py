"""Versioned model architecture, independent of the ground-truth engine."""

from typing import Literal

from pydantic import Field

from oracle.world import StrictModel

INPUT_FEATURES = 22  # 13 continuous, 5 categorical, static flag, gravity x/y and observed dt
MOTION_FEATURES = 7
MODEL_SCHEMA = "oracle-object-dynamics-v1"


class ModelConfig(StrictModel):
    family: Literal["mlp", "gru"] = "mlp"
    history: int = Field(default=4, ge=1, le=16)
    embedding: int = Field(default=64, ge=16, le=128)
    hidden: int = Field(default=64, ge=16, le=256)
