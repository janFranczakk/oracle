"""Dataset contracts and explicit initial-condition distribution shifts."""

from enum import StrEnum
from typing import Literal

from pydantic import Field, model_validator

from oracle.world import Frame, StrictModel, World


class Split(StrEnum):
    TRAIN = "train"
    VALIDATION = "validation"
    TEST = "test"
    OOD = "ood"


class Suite(StrEnum):
    ID = "in_distribution"
    MASS = "unseen_mass"
    SPEED = "unseen_velocity"
    ANGLE = "unseen_angle"
    COUNT = "unseen_object_count"
    OBSTACLES = "unseen_obstacles"
    COMBINATION = "held_out_combination"


OOD_SUITES = tuple(s for s in Suite if s != Suite.ID)


class DatasetConfig(StrictModel):
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    train: int = Field(default=24, ge=1, le=10000)
    validation: int = Field(default=8, ge=1, le=10000)
    test: int = Field(default=8, ge=1, le=10000)
    ood_per_suite: int = Field(default=4, ge=1, le=10000)
    steps: int = Field(default=480, ge=4, le=14400)
    sample_stride: int = Field(default=4, ge=1, le=120)

    @property
    def total(self) -> int:
        return self.train + self.validation + self.test + self.ood_per_suite * len(OOD_SUITES)

    @model_validator(mode="after")
    def valid_recording(self) -> "DatasetConfig":
        if self.steps % self.sample_stride:
            raise ValueError("Steps must be divisible by sample_stride")
        if self.steps // self.sample_stride > 3600:
            raise ValueError("An episode supports at most 3,601 sampled frames")
        if self.total > 10000:
            raise ValueError("A dataset supports at most 10,000 episodes")
        return self


class SamplingRanges(StrictModel):
    mass: tuple[float, float] = (1, 5)
    speed: tuple[float, float] = (0, 10)
    angle_degrees: tuple[float, float] = (0, 45)
    object_count: tuple[int, int] = (3, 8)
    obstacle_count: tuple[int, int] = (0, 2)
    friction: tuple[float, float] = (0.1, 0.8)
    restitution: tuple[float, float] = (0.2, 0.95)
    radius: tuple[float, float] = (0.3, 0.65)
    box_dimension: tuple[float, float] = (0.6, 1.2)
    angular_velocity: tuple[float, float] = (-1, 1)
    held_out_corner: bool = False


def ranges_for(suite: Suite) -> SamplingRanges:
    updates = {
        Suite.MASS: {"mass": (6, 8)},
        Suite.SPEED: {"speed": (11, 15)},
        Suite.ANGLE: {"angle_degrees": (60, 80)},
        Suite.COUNT: {"object_count": (9, 12)},
        Suite.OBSTACLES: {"obstacle_count": (3, 4)},
        Suite.COMBINATION: {"mass": (4.5, 5), "speed": (9, 10), "held_out_corner": True},
    }
    return SamplingRanges(**updates.get(suite, {}))


class Episode(StrictModel):
    schema_version: Literal[1] = 1
    id: str = Field(pattern=r"^[a-z0-9_-]{1,100}$")
    split: Split
    suite: Suite
    seed: int = Field(ge=0, le=2**32 - 1)
    ranges: SamplingRanges
    origin: World
    steps: int
    sample_stride: int
    frames: list[Frame]

    @model_validator(mode="after")
    def aligned_frames(self) -> "Episode":
        if (self.split == Split.OOD) != (self.suite != Suite.ID):
            raise ValueError("Only OOD episodes may use OOD suites")
        if self.steps < 1 or self.sample_stride < 1 or self.steps % self.sample_stride:
            raise ValueError("Invalid sample clock")
        if self.seed != self.origin.seed:
            raise ValueError("Episode and world seeds disagree")
        if [f.tick for f in self.frames] != list(range(0, self.steps + 1, self.sample_stride)):
            raise ValueError("Frames do not cover the declared sample clock")
        ids = [o.id for o in self.origin.objects]
        for frame in self.frames:
            if [o.id for o in frame.objects] != ids:
                raise ValueError("Object order / identity changed inside an episode")
            if not set(frame.collisions).issubset(ids):
                raise ValueError("Contact labels refer to missing objects")
        if self.frames[0].objects != self.origin.objects:
            raise ValueError("Initial observation differs from the origin")
        return self


class EpisodeEntry(StrictModel):
    id: str
    split: Split
    suite: Suite
    seed: int
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    dynamic_objects: int
    obstacles: int
    samples: int
    pairs: int
    contacts: int
    initial_masses: list[float]
    initial_speeds: list[float]


class Normalization(StrictModel):
    schema_version: Literal[1] = 1
    method: Literal["population_zscore_dynamic_train"] = "population_zscore_dynamic_train"
    feature_names: list[str]
    mean: list[float]
    scale: list[float]
    constant_features: list[str]
    observations: int
    source_episodes: dict[str, str]

    @model_validator(mode="after")
    def valid_statistics(self) -> "Normalization":
        if not len(self.feature_names) == len(self.mean) == len(self.scale):
            raise ValueError("Normalization feature dimensions disagree")
        if any(s <= 0 for s in self.scale) or self.observations < 1:
            raise ValueError("Normalization requires positive scales and observations")
        return self


class DatasetManifest(StrictModel):
    schema_version: Literal[1] = 1
    generator: Literal["oracle-procedural-v1"] = "oracle-procedural-v1"
    id: str = Field(pattern=r"^ds-[a-f0-9]{16}$")
    engine: Literal["pymunk-7.2.0"] = "pymunk-7.2.0"
    created_at: str
    runtime: dict[str, str]
    config: DatasetConfig
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    normalization_sha256: str
    episodes: list[EpisodeEntry]

    @model_validator(mode="after")
    def isolated_splits(self) -> "DatasetManifest":
        ids = [e.id for e in self.episodes]
        seeds = [e.seed for e in self.episodes]
        if len(set(ids)) != len(ids) or len(set(seeds)) != len(seeds):
            raise ValueError("Episode identifiers and seeds must be globally disjoint")
        expected = {
            Split.TRAIN: self.config.train,
            Split.VALIDATION: self.config.validation,
            Split.TEST: self.config.test,
            Split.OOD: self.config.ood_per_suite * len(OOD_SUITES),
        }
        for split, count in expected.items():
            if sum(e.split == split for e in self.episodes) != count:
                raise ValueError("Manifest split sizes disagree with configuration")
        for suite in OOD_SUITES:
            if sum(e.suite == suite for e in self.episodes) != self.config.ood_per_suite:
                raise ValueError("Manifest OOD suite sizes disagree with configuration")
        if any((e.split == Split.OOD) != (e.suite != Suite.ID) for e in self.episodes):
            raise ValueError("Manifest has inconsistent split / suite membership")
        if any(
            e.samples != self.config.steps // self.config.sample_stride + 1
            or e.pairs != e.samples - 1
            for e in self.episodes
        ):
            raise ValueError("Manifest sample / pair counts disagree with configuration")
        return self
