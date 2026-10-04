"""Train-only streaming statistics and reversible per-object feature encoding."""

import math
from collections.abc import Iterable

from oracle.datasets.schema import Episode, Normalization, Split
from oracle.world import BodyState, Shape

FEATURE_NAMES = [
    "x",
    "y",
    "vx",
    "vy",
    "sin_rotation",
    "cos_rotation",
    "angular_velocity",
    "mass",
    "friction",
    "restitution",
    "radius",
    "width",
    "height",
]


def features(body: BodyState) -> list[float]:
    circle = body.shape == Shape.CIRCLE
    return [
        body.position.x,
        body.position.y,
        body.velocity.x,
        body.velocity.y,
        math.sin(body.rotation),
        math.cos(body.rotation),
        body.angular_velocity,
        body.mass,
        body.friction,
        body.restitution,
        body.radius if circle else 0,
        0 if circle else body.width,
        0 if circle else body.height,
    ]


def fit_normalization(episodes: Iterable[tuple[Episode, str]]) -> Normalization:
    """Welford population statistics over dynamic observations, with explicit provenance."""
    mean, m2 = [0.0] * len(FEATURE_NAMES), [0.0] * len(FEATURE_NAMES)
    count = 0
    sources: dict[str, str] = {}
    for episode, sha256 in episodes:
        if episode.split != Split.TRAIN:
            raise ValueError("Only training episodes may fit normalization")
        if episode.id in sources:
            raise ValueError("Duplicate training episode in normalization")
        sources[episode.id] = sha256
        for frame in episode.frames:
            for body in frame.objects:
                if body.static:
                    continue
                count += 1
                for i, value in enumerate(features(body)):
                    delta = value - mean[i]
                    mean[i] += delta / count
                    m2[i] += delta * (value - mean[i])
    if not count:
        raise ValueError("No dynamic training observations available")
    std = [math.sqrt(max(0, value / count)) for value in m2]
    constants = [name for name, s in zip(FEATURE_NAMES, std, strict=True) if s < 1e-8]
    return Normalization(
        feature_names=FEATURE_NAMES,
        mean=mean,
        scale=[s if s >= 1e-8 else 1 for s in std],
        constant_features=constants,
        observations=count,
        source_episodes=sources,
    )


def transform(
    values: list[float], normalization: Normalization, inverse: bool = False
) -> list[float]:
    if normalization.feature_names != FEATURE_NAMES or len(values) != len(FEATURE_NAMES):
        raise ValueError("Incompatible feature schema")
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Features must be finite")
    return [
        (v * s + m) if inverse else (v - m) / s
        for v, m, s in zip(values, normalization.mean, normalization.scale, strict=True)
    ]
