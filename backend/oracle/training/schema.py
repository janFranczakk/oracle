"""Validated run configuration; API imports this without importing PyTorch."""

from typing import Literal

from pydantic import Field, field_validator

from oracle.models.schema import ModelConfig
from oracle.world import StrictModel


class TrainConfig(StrictModel):
    model: ModelConfig = Field(default_factory=ModelConfig)
    seed: int = Field(default=7, ge=0, le=2**32 - 1)
    epochs: int = Field(default=25, ge=1, le=500)
    batch_size: int = Field(default=64, ge=1, le=512)
    learning_rate: float = Field(default=0.001, gt=0, le=0.1)
    contact_weight: float = Field(default=0.1, ge=0, le=1)
    threads: int = Field(default=2, ge=1, le=8)
    device: Literal["cpu", "cuda"] = "cpu"
    horizons: list[int] = Field(default_factory=lambda: [1, 5, 10, 20, 50], min_length=1)

    @field_validator("horizons")
    @classmethod
    def bounded_horizons(cls, value: list[int]) -> list[int]:
        if (
            len(value) > 16
            or len(set(value)) != len(value)
            or any(not 1 <= h <= 240 for h in value)
        ):
            raise ValueError("Choose at most 16 distinct horizons from 1 to 240")
        return sorted(value)


class TrainRequest(StrictModel):
    dataset_id: str = Field(pattern=r"^ds-[a-f0-9]{16}$")
    config: TrainConfig = Field(default_factory=TrainConfig)
