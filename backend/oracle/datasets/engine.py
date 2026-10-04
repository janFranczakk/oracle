"""Shared Pymunk episode collection, dataset publication and verified pair iteration."""

import math
import platform
import sys
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

from oracle.datasets.normalization import features, fit_normalization, transform
from oracle.datasets.sampling import episode_plan, sample_world
from oracle.datasets.schema import (
    DatasetConfig,
    DatasetManifest,
    Episode,
    EpisodeEntry,
    Split,
    ranges_for,
)
from oracle.datasets.storage import (
    digest,
    read_episode,
    read_manifest,
    read_normalization,
    write_episode,
    write_json,
)
from oracle.physics import PhysicsEngine


def runtime_info() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "platform": sys.platform,
        "machine": platform.machine(),
    }


def dataset_id(config: DatasetConfig) -> str:
    return (
        "ds-"
        + digest(
            {
                "config": config.model_dump(),
                "generator": "oracle-procedural-v1",
                "engine": "pymunk-7.2.0",
                "runtime": runtime_info(),
            }
        )[:16]
    )


def collect_episode(config: DatasetConfig, identity: tuple) -> Episode:
    eid, split, suite, seed = identity
    ranges = ranges_for(suite)
    origin = sample_world(seed, ranges)
    engine = PhysicsEngine(origin)
    frames = [engine.frame()]
    contacts: set[str] = set()
    for tick in range(1, config.steps + 1):
        frame = engine.step()
        contacts.update(frame.collisions)
        if tick % config.sample_stride == 0:
            frame.collisions = sorted(contacts)
            frames.append(frame)
            contacts.clear()
    return Episode(
        id=eid,
        split=split,
        suite=suite,
        seed=seed,
        ranges=ranges,
        origin=origin,
        steps=config.steps,
        sample_stride=config.sample_stride,
        frames=frames,
    )


def generate_dataset(
    config: DatasetConfig, root: Path, progress: Callable[[dict], None] | None = None
) -> DatasetManifest:
    """Write one episode at a time; publish the manifest only after train-only fitting."""
    if root.exists() and any(root.iterdir()):
        raise ValueError("Output directory must be empty; existing datasets are never overwritten")
    (root / "episodes").mkdir(parents=True, exist_ok=True)
    entries = []
    for index, identity in enumerate(episode_plan(config)):
        episode = collect_episode(config, identity)
        sha256 = write_episode(root, episode)
        dynamic = [b for b in episode.origin.objects if not b.static]
        entries.append(
            EpisodeEntry(
                id=episode.id,
                split=episode.split,
                suite=episode.suite,
                seed=episode.seed,
                sha256=sha256,
                dynamic_objects=len(dynamic),
                obstacles=len(episode.origin.objects) - len(dynamic) - 3,
                samples=len(episode.frames),
                pairs=len(episode.frames) - 1,
                contacts=sum(bool(f.collisions) for f in episode.frames),
                initial_masses=[b.mass for b in dynamic],
                initial_speeds=[math.hypot(b.velocity.x, b.velocity.y) for b in dynamic],
            )
        )
        if progress:
            progress({"phase": "collecting", "completed": index + 1, "total": config.total})
    if progress:
        progress({"phase": "normalizing", "completed": config.total, "total": config.total})
    normalization = fit_normalization(
        (read_episode(root, e), e.sha256) for e in entries if e.split == Split.TRAIN
    )
    value = normalization.model_dump(mode="json")
    write_json(root / "normalization.json", value)
    normalization_hash = digest(value)
    manifest = DatasetManifest(
        id=dataset_id(config),
        config=config,
        created_at=datetime.now(UTC).isoformat(),
        runtime=runtime_info(),
        normalization_sha256=normalization_hash,
        content_sha256=digest(
            {
                "episodes": [e.model_dump(mode="json") for e in entries],
                "normalization": normalization_hash,
            }
        ),
        episodes=entries,
    )
    write_json(root / "manifest.json", manifest.model_dump(mode="json"))
    return manifest


def iter_pairs(root: Path, split: Split, *, normalized: bool = False) -> Iterator[dict]:
    """Adjacent sampled observations, stable object IDs, static context and categorical shape."""
    manifest = read_manifest(root)
    normalizer = read_normalization(root, manifest) if normalized else None
    for entry in manifest.episodes:
        if entry.split != split:
            continue
        episode = read_episode(root, entry)
        for before, after in zip(episode.frames[:-1], episode.frames[1:], strict=True):

            def encode(frame):
                return [
                    {
                        "id": b.id,
                        "shape": b.shape.value,
                        "static": b.static,
                        "features": transform(features(b), normalizer)
                        if normalizer
                        else features(b),
                    }
                    for b in frame.objects
                ]

            yield {
                "episode_id": entry.id,
                "seed": entry.seed,
                "split": entry.split.value,
                "suite": entry.suite.value,
                "tick": before.tick,
                "next_tick": after.tick,
                "dt": episode.sample_stride * episode.origin.environment.dt,
                "state": encode(before),
                "next_state": encode(after),
                "contacts_next_interval": after.collisions,
                "environment": episode.origin.environment.model_dump(),
            }


def verify_dataset(root: Path) -> dict:
    """Check every payload, split provenance and independently refit normalization."""
    manifest = read_manifest(root)
    normalization = read_normalization(root, manifest)
    expected = {identity[0]: identity for identity in episode_plan(manifest.config)}
    for entry in manifest.episodes:
        episode = read_episode(root, entry)
        if expected.get(entry.id) != (entry.id, entry.split, entry.suite, entry.seed):
            raise ValueError("Episode assignment does not match the configured seed plan")
        if episode.ranges != ranges_for(entry.suite):
            raise ValueError("Episode sampling ranges do not match its declared OOD suite")
        if episode.origin != sample_world(entry.seed, episode.ranges):
            raise ValueError("Procedural origin cannot be reproduced from its seed and policy")
        if (len(episode.frames), episode.steps, episode.sample_stride) != (
            entry.samples,
            manifest.config.steps,
            manifest.config.sample_stride,
        ):
            raise ValueError("Episode sample clock disagrees with manifest")
        dynamic = [b for b in episode.origin.objects if not b.static]
        if (
            entry.dynamic_objects != len(dynamic)
            or entry.obstacles
            != sum(b.static and b.shape == "ramp" for b in episode.origin.objects)
            or entry.initial_masses != [b.mass for b in dynamic]
            or entry.initial_speeds != [math.hypot(b.velocity.x, b.velocity.y) for b in dynamic]
            or entry.contacts != sum(bool(f.collisions) for f in episode.frames)
        ):
            raise ValueError("Episode summary disagrees with its observed payload")
    refit = fit_normalization(
        (read_episode(root, e), e.sha256) for e in manifest.episodes if e.split == Split.TRAIN
    )
    if refit != normalization:
        raise ValueError("Normalization does not match independently fitted training statistics")
    return {
        "id": manifest.id,
        "episodes": len(manifest.episodes),
        "pairs": sum(e.pairs for e in manifest.episodes),
        "sha256": manifest.content_sha256,
        "verified": True,
    }
