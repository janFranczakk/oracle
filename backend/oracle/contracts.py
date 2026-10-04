"""Interfaces for later stages. Implementations must never delegate prediction to physics."""

from dataclasses import dataclass
from typing import Protocol

from oracle.world import BodyState, Frame


@dataclass(frozen=True)
class Intervention:
    object_id: str
    replacement: BodyState | None


@dataclass(frozen=True)
class Prediction:
    frames: tuple[Frame, ...]
    model_version: str
    uncertainty_method: str | None = None
    position_std: tuple[tuple[float, ...], ...] | None = None


class DynamicsModel(Protocol):
    """Object-centric model contract; temporal encoders can accept a frame history."""

    version: str

    def predict(
        self, history: tuple[Frame, ...], intervention: Intervention | None, horizon: int
    ) -> Prediction: ...
