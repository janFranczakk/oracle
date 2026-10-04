"""Procedural initial conditions; labels describe distributions, never learned behavior."""

import hashlib
import math
import random
from collections.abc import Iterator

from oracle.datasets.schema import OOD_SUITES, DatasetConfig, SamplingRanges, Split, Suite
from oracle.scenes import scene
from oracle.world import BodyState, Shape, Vec2, World


def episode_plan(config: DatasetConfig) -> Iterator[tuple[str, Split, Suite, int]]:
    """Derive independent episode seeds before collecting any transitions."""
    used: set[int] = set()
    groups = [
        (Split.TRAIN, Suite.ID, config.train),
        (Split.VALIDATION, Suite.ID, config.validation),
        (Split.TEST, Suite.ID, config.test),
    ]
    groups += [(Split.OOD, suite, config.ood_per_suite) for suite in OOD_SUITES]
    for split, suite, count in groups:
        for index in range(count):
            nonce = 0
            while True:
                key = f"oracle-v1:{config.seed}:{split}:{suite}:{index}:{nonce}".encode()
                seed = int.from_bytes(hashlib.sha256(key).digest()[:4], "big")
                if seed not in used:
                    break
                nonce += 1
            used.add(seed)
            yield f"{split}-{suite}-{index:05d}-{seed:08x}", split, suite, seed


def sample_world(seed: int, ranges: SamplingRanges) -> World:
    """Place non-overlapping bodies above separated, randomized obstacles."""
    rng = random.Random(seed)
    world = scene(seed, "empty")
    count = rng.randint(*ranges.object_count)
    obstacle_count = rng.randint(*ranges.obstacle_count)
    for i in range(obstacle_count):
        world.objects.append(
            BodyState(
                id=f"obstacle-{i:02}",
                label=f"Procedural ramp {i + 1}",
                shape=Shape.RAMP,
                static=True,
                position=Vec2(x=3 + i * 5.5, y=rng.uniform(2, 3.5)),
                width=rng.uniform(2.5, 4),
                height=0.25,
                rotation=math.radians(rng.uniform(*ranges.angle_degrees)) * rng.choice((-1, 1)),
                friction=rng.uniform(*ranges.friction),
                restitution=rng.uniform(*ranges.restitution),
            )
        )
    placed: list[tuple[float, float, float]] = []
    for i in range(count):
        # Every scene contains both types, making angular OOD meaningful for boxes.
        shape = Shape.BOX if i == 0 or (i > 1 and rng.random() < 0.4) else Shape.CIRCLE
        radius = rng.uniform(*ranges.radius)
        width, height = rng.uniform(*ranges.box_dimension), rng.uniform(*ranges.box_dimension)
        bound = radius if shape == Shape.CIRCLE else math.hypot(width, height) / 2
        for _ in range(500):
            x, y = rng.uniform(1.5, 22.5), rng.uniform(7, 12.5)
            if all(math.hypot(x - px, y - py) > bound + pr + 0.15 for px, py, pr in placed):
                placed.append((x, y, bound))
                break
        else:
            raise ValueError("Could not place non-overlapping procedural objects")
        while True:
            mass, speed = rng.uniform(*ranges.mass), rng.uniform(*ranges.speed)
            # Reserve the joint upper corner across ALL in-distribution splits.
            if (
                ranges.held_out_corner
                or ranges.mass[0] > 5
                or ranges.speed[0] > 10
                or mass < 4.5
                or speed < 9
            ):
                break
        direction = rng.uniform(-math.pi, math.pi)
        world.objects.append(
            BodyState(
                id=f"body-{i:02}",
                label=f"Specimen {i + 1:02}",
                shape=shape,
                position=Vec2(x=x, y=y),
                velocity=Vec2(x=speed * math.cos(direction), y=speed * math.sin(direction)),
                rotation=math.radians(rng.uniform(*ranges.angle_degrees)) * rng.choice((-1, 1)),
                angular_velocity=rng.uniform(*ranges.angular_velocity),
                mass=mass,
                friction=rng.uniform(*ranges.friction),
                restitution=rng.uniform(*ranges.restitution),
                radius=radius,
                width=width,
                height=height,
            )
        )
    return World.model_validate(world.model_dump())
