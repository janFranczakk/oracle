"""Versioned model architecture, independent of the ground-truth engine."""

from typing import Literal

from pydantic import Field, model_validator

from oracle.world import StrictModel

INPUT_FEATURES = 22  # 13 continuous, 5 categorical, static flag, gravity x/y and observed dt
MOTION_FEATURES = 7
MODEL_SCHEMA = "oracle-object-dynamics-v1"


class ModelConfig(StrictModel):
    family: Literal["mlp", "gru", "transformer"] = "mlp"
    history: int = Field(default=4, ge=1, le=16)
    embedding: int = Field(default=64, ge=16, le=128)
    hidden: int = Field(default=64, ge=16, le=256)
    heads: int = Field(default=4, ge=1, le=8)
    layers: int = Field(default=2, ge=1, le=4)
    dropout: float = Field(default=0.1, ge=0, le=0.5)

    @model_validator(mode="after")
    def attention_dimensions(self):
        if self.family == "transformer" and self.embedding % self.heads:
            raise ValueError("Transformer embedding must be divisible by attention heads")
        return self
