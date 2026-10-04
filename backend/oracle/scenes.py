"""Reproducible curated scenes; randomness belongs to a local seeded generator."""

import random

from oracle.world import BodyState, Shape, Vec2, World


def scene(seed: int = 42, preset: str = "incline") -> World:
    rng = random.Random(seed)
    objects = [
        BodyState(
            id="floor",
            label="Ground plane",
            shape=Shape.PLATFORM,
            static=True,
            position=Vec2(x=12, y=0.3),
            width=24,
            height=0.6,
        ),
        BodyState(
            id="wall-l",
            label="Left boundary",
            shape=Shape.WALL,
            static=True,
            position=Vec2(x=0.15, y=7),
            width=0.3,
            height=14,
        ),
        BodyState(
            id="wall-r",
            label="Right boundary",
            shape=Shape.WALL,
            static=True,
            position=Vec2(x=23.85, y=7),
            width=0.3,
            height=14,
        ),
    ]
    if preset == "incline":
        objects += [
            BodyState(
                id="ramp-1",
                label="Inclined plane",
                shape=Shape.RAMP,
                static=True,
                position=Vec2(x=6.4, y=4.6),
                width=8,
                height=0.3,
                rotation=-0.25,
            ),
            BodyState(
                id="platform-1",
                label="Elevated platform",
                shape=Shape.PLATFORM,
                static=True,
                position=Vec2(x=18.6, y=3),
                width=6,
                height=0.3,
            ),
            BodyState(
                id="ramp-2",
                label="Return ramp",
                shape=Shape.RAMP,
                static=True,
                position=Vec2(x=15, y=5.8),
                width=5,
                height=0.3,
                rotation=0.29,
            ),
        ]
        objects += [
            BodyState(
                id="orb-01",
                label="Primary sphere",
                shape=Shape.CIRCLE,
                position=Vec2(x=5.0, y=9.3),
                velocity=Vec2(x=2.4, y=0.2),
                radius=0.7,
                mass=round(rng.uniform(2, 3), 3),
                restitution=0.8,
            ),
            BodyState(
                id="orb-02",
                label="Secondary sphere",
                shape=Shape.CIRCLE,
                position=Vec2(x=9.4, y=11),
                velocity=Vec2(x=-1.2),
                radius=0.45,
                mass=1.2,
                restitution=0.72,
            ),
            BodyState(
                id="box-01",
                label="Test block",
                shape=Shape.BOX,
                position=Vec2(x=17.5, y=9.5),
                width=1.25,
                height=1.25,
                rotation=0.18,
                mass=round(rng.uniform(3, 4), 3),
            ),
            BodyState(
                id="orb-03",
                label="Contact probe",
                shape=Shape.CIRCLE,
                position=Vec2(x=20.4, y=6),
                radius=0.55,
                mass=1.8,
            ),
        ]
    elif preset == "collision":
        for i in range(6):
            objects.append(
                BodyState(
                    id=f"orb-{i + 1:02}",
                    label=f"Collision sphere {i + 1}",
                    shape=Shape.CIRCLE,
                    position=Vec2(x=4 + i * 3, y=3 + rng.random() * 6),
                    velocity=Vec2(x=rng.uniform(-4, 4), y=rng.uniform(-1, 2)),
                    radius=rng.uniform(0.4, 0.75),
                    mass=rng.uniform(1, 5),
                    restitution=0.9,
                )
            )
    return World(seed=seed, scene=preset, objects=objects)
