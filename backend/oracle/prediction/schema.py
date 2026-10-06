"""Bounded prediction requests; checkpoint descriptions do not import PyTorch."""

from pydantic import Field, model_validator

from oracle.models.schema import ModelConfig
from oracle.prediction.uncertainty import SamplingOptions
from oracle.world import Scalar, StrictModel


class PredictionRequest(SamplingOptions):
    model_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    generation: str = Field(pattern=r"^[a-f0-9]{32}$")
    anchor_tick: int = Field(ge=0, le=14400)
    revision: int = Field(ge=0)
    horizon: int = Field(default=50, ge=1, le=120)


class ModelDescription(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    architecture: ModelConfig
    epoch: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    dataset_id: str
    dataset_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    normalization_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    sample_stride: int = Field(ge=1, le=120)
    sample_dt: Scalar = Field(gt=0, le=1)
    gravity: tuple[Scalar, Scalar]

    @model_validator(mode="after")
    def supported_clock(self) -> "ModelDescription":
        if abs(self.sample_dt - self.sample_stride / 120) > 1e-12:
            raise ValueError("Checkpoint observation clock is incompatible with the Lab")
        return self

    @property
    def version(self) -> str:
        return f"{self.id}/epoch-{self.epoch}"
