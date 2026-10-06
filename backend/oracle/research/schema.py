"""Bounded research requests, independent of the ML runtime."""

from typing import Literal

from pydantic import Field, field_validator

from oracle.world import StrictModel

Group = Literal[
    "test",
    "ood/unseen_mass",
    "ood/unseen_velocity",
    "ood/unseen_angle",
    "ood/unseen_object_count",
    "ood/unseen_obstacles",
    "ood/held_out_combination",
]
GROUPS = list(Group.__args__)


class BatchRequest(StrictModel):
    dataset_id: str = Field(pattern=r"^ds-[a-f0-9]{16}$")
    models: list[str] = Field(min_length=2, max_length=4)
    horizons: list[int] = Field(default_factory=lambda: [1, 5, 10, 20, 50], min_length=1)
    groups: list[Group] = Field(default_factory=lambda: GROUPS.copy(), min_length=1)
    threads: int = Field(default=2, ge=1, le=4)

    @field_validator("models")
    @classmethod
    def distinct_models(cls, value):
        import re

        if len(set(value)) != len(value) or any(
            not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", name) for name in value
        ):
            raise ValueError("Choose distinct checkpoint identifiers")
        return value

    @field_validator("horizons")
    @classmethod
    def bounded_horizons(cls, value):
        if len(value) > 8 or len(set(value)) != len(value) or any(not 1 <= h <= 120 for h in value):
            raise ValueError("Choose at most eight distinct horizons from 1 to 120")
        return sorted(value)

    @field_validator("groups")
    @classmethod
    def distinct_groups(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Choose distinct evaluation groups")
        return value


class CheckpointNotes(StrictModel):
    label: str = Field(default="", max_length=64)
    pinned: bool = False
    archived: bool = False

    @field_validator("label")
    @classmethod
    def readable_label(cls, value):
        if any(ord(char) < 32 for char in value):
            raise ValueError("Checkpoint labels cannot contain control characters")
        return value.strip()
