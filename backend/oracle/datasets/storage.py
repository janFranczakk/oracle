"""Canonical, bounded JSON storage. Dataset files never contain executable objects."""

import gzip
import hashlib
import json
import re
import time
from pathlib import Path

from oracle.datasets.schema import DatasetManifest, Episode, EpisodeEntry, Normalization


def canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value: dict) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def write_json(path: Path, value: dict) -> None:
    """Publish JSON atomically; progress readers never see a partial document."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(canonical(value))
    # On Windows a concurrent status reader may briefly deny replacement sharing.
    # Retry the atomic rename, never expose a partially written destination.
    for attempt in range(8):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.01 * 2**attempt)


def read_json(path: Path) -> dict:
    """A Windows atomic replacement may briefly deny a concurrent open as well."""
    for attempt in range(8):
        try:
            return json.loads(path.read_bytes())
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.01 * 2**attempt)
    raise AssertionError("Unreachable retry state")


def episode_path(root: Path, episode_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9_-]{1,100}", episode_id):
        raise ValueError("Invalid episode identifier")
    return root / "episodes" / f"{episode_id}.json.gz"


def write_episode(root: Path, episode: Episode) -> str:
    raw = canonical(episode.model_dump(mode="json"))
    episode_path(root, episode.id).write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))
    return hashlib.sha256(raw).hexdigest()


def read_episode(root: Path, entry: EpisodeEntry) -> Episode:
    with gzip.open(episode_path(root, entry.id), "rb") as stream:
        raw = stream.read(64 * 1024 * 1024 + 1)
    if len(raw) > 64 * 1024 * 1024:
        raise ValueError("Episode exceeds the 64 MiB inspection limit")
    if hashlib.sha256(raw).hexdigest() != entry.sha256:
        raise ValueError("Episode checksum mismatch")
    episode = Episode.model_validate_json(raw)
    if (episode.id, episode.seed, episode.split, episode.suite) != (
        entry.id,
        entry.seed,
        entry.split,
        entry.suite,
    ):
        raise ValueError("Episode metadata does not match its manifest")
    return episode


def read_manifest(root: Path) -> DatasetManifest:
    path = root / "manifest.json"
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError("Manifest is too large")
    manifest = DatasetManifest.model_validate_json(path.read_bytes())
    fingerprint = digest(
        {
            "episodes": [e.model_dump(mode="json") for e in manifest.episodes],
            "normalization": manifest.normalization_sha256,
        }
    )
    if fingerprint != manifest.content_sha256:
        raise ValueError("Manifest content fingerprint mismatch")
    return manifest


def read_normalization(root: Path, manifest: DatasetManifest) -> Normalization:
    value = json.loads((root / "normalization.json").read_bytes())
    if digest(value) != manifest.normalization_sha256:
        raise ValueError("Normalization checksum mismatch")
    normalizer = Normalization.model_validate(value)
    train = {e.id: e.sha256 for e in manifest.episodes if e.split == "train"}
    if normalizer.source_episodes != train:
        raise ValueError("Normalization provenance must match exactly the training episodes")
    return normalizer
