import gzip
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from oracle.api import app
from oracle.datasets import api as dataset_api
from oracle.datasets.engine import (
    collect_episode,
    dataset_id,
    generate_dataset,
    iter_pairs,
    verify_dataset,
)
from oracle.datasets.normalization import FEATURE_NAMES, features, fit_normalization, transform
from oracle.datasets.sampling import episode_plan, sample_world
from oracle.datasets.schema import DatasetConfig, DatasetManifest, Episode, Split, Suite, ranges_for
from oracle.datasets.storage import (
    episode_path,
    read_episode,
    read_json,
    read_manifest,
    read_normalization,
    write_json,
)
from oracle.physics import PhysicsEngine


def config(**updates):
    return DatasetConfig(train=2, validation=1, test=1, ood_per_suite=1, steps=120, **updates)


@pytest.fixture
def dataset(tmp_path):
    root = tmp_path / "data"
    manifest = generate_dataset(config(), root)
    return root, manifest


def test_episode_plan_is_deterministic_disjoint_and_prefix_stable():
    baseline = list(episode_plan(config()))
    assert baseline == list(episode_plan(config()))
    assert len({item[3] for item in baseline}) == 10
    expanded = DatasetConfig(train=3, validation=1, test=1, ood_per_suite=1, steps=120)
    lookup = {item[0]: item for item in episode_plan(expanded)}
    assert all(lookup[item[0]] == item for item in baseline)


@pytest.mark.parametrize("suite", list(Suite))
def test_procedural_ranges_and_non_overlapping_spawn(suite):
    limits = ranges_for(suite)
    before = random.getstate()
    world = sample_world(1984, limits)
    assert world == sample_world(1984, limits)
    assert world != sample_world(1985, limits)
    assert random.getstate() == before
    bodies = [o for o in world.objects if not o.static]
    assert limits.object_count[0] <= len(bodies) <= limits.object_count[1]
    assert (
        limits.obstacle_count[0] <= len(world.objects) - len(bodies) - 3 <= limits.obstacle_count[1]
    )
    assert {o.shape.value for o in bodies} == {"box", "circle"}
    for i, body in enumerate(bodies):
        speed = math.hypot(body.velocity.x, body.velocity.y)
        assert limits.mass[0] <= body.mass <= limits.mass[1]
        assert limits.speed[0] - 1e-12 <= speed <= limits.speed[1] + 1e-12
        assert (
            limits.angle_degrees[0] <= abs(math.degrees(body.rotation)) <= limits.angle_degrees[1]
        )
        if suite == Suite.COMBINATION:
            assert body.mass >= 4.5 and speed >= 9
        elif suite not in (Suite.MASS, Suite.SPEED):
            assert not (body.mass >= 4.5 and speed >= 9)
        bound = body.radius if body.shape == "circle" else math.hypot(body.width, body.height) / 2
        for other in bodies[:i]:
            other_bound = (
                other.radius
                if other.shape == "circle"
                else math.hypot(other.width, other.height) / 2
            )
            assert (
                math.hypot(body.position.x - other.position.x, body.position.y - other.position.y)
                > bound + other_bound
            )


def test_sampled_frames_are_real_physics_and_preserve_short_contacts():
    cfg = DatasetConfig(train=1, validation=1, test=1, ood_per_suite=1, steps=480, sample_stride=12)
    episode = collect_episode(cfg, next(episode_plan(cfg)))
    engine = PhysicsEngine(episode.origin)
    contacts = set()
    assert episode.frames[0] == engine.frame()
    for tick in range(1, cfg.steps + 1):
        expected = engine.step()
        contacts.update(expected.collisions)
        if tick % cfg.sample_stride == 0:
            actual = episode.frames[tick // cfg.sample_stride]
            assert actual.objects == expected.objects
            assert actual.collisions == sorted(contacts)
            contacts.clear()
    assert any(f.collisions for f in episode.frames)


def test_dataset_reproducible_bytes_and_content_fingerprint(dataset, tmp_path):
    root, manifest = dataset
    duplicate = tmp_path / "duplicate"
    regenerated = generate_dataset(config(), duplicate)
    assert regenerated.content_sha256 == manifest.content_sha256
    assert regenerated.episodes == manifest.episodes
    assert (root / "normalization.json").read_bytes() == (
        duplicate / "normalization.json"
    ).read_bytes()
    for entry in manifest.episodes:
        assert (
            episode_path(root, entry.id).read_bytes()
            == episode_path(duplicate, entry.id).read_bytes()
        )
    assert verify_dataset(root)["pairs"] == 300


def test_normalization_matches_train_population_statistics(dataset):
    root, manifest = dataset
    normalization = read_normalization(root, manifest)
    rows = [
        features(b)
        for e in manifest.episodes
        if e.split == Split.TRAIN
        for f in read_episode(root, e).frames
        for b in f.objects
        if not b.static
    ]
    assert normalization.observations == len(rows)
    for i in range(len(FEATURE_NAMES)):
        mean = sum(r[i] for r in rows) / len(rows)
        scale = math.sqrt(sum((r[i] - mean) ** 2 for r in rows) / len(rows))
        assert normalization.mean[i] == pytest.approx(mean)
        assert normalization.scale[i] == pytest.approx(scale if scale >= 1e-8 else 1)
    raw = rows[0]
    assert transform(transform(raw, normalization), normalization, inverse=True) == pytest.approx(
        raw
    )


def test_constant_features_use_unit_scale_and_ignore_static_mass():
    world = sample_world(7, ranges_for(Suite.ID))
    circle = next(b for b in world.objects if b.shape == "circle" and not b.static)
    world.objects = [world.objects[0], circle]
    world.objects[0].mass = 100
    engine = PhysicsEngine(world)
    frames = [engine.frame()]
    for _ in range(4):
        frame = engine.step()
    frames.append(frame)
    episode = Episode(
        id="constant-features",
        split=Split.TRAIN,
        suite=Suite.ID,
        seed=7,
        ranges=ranges_for(Suite.ID),
        origin=world,
        steps=4,
        sample_stride=4,
        frames=frames,
    )
    normalizer = fit_normalization([(episode, "0" * 64)])
    mass = FEATURE_NAMES.index("mass")
    assert normalizer.mean[mass] == circle.mass
    assert normalizer.scale[mass] == 1
    assert {"mass", "width", "height"}.issubset(normalizer.constant_features)
    assert normalizer.observations == 2
    assert all(math.isfinite(v) for v in transform(features(circle), normalizer))


@pytest.mark.parametrize("split", [Split.VALIDATION, Split.TEST, Split.OOD])
def test_non_train_normalization_is_rejected(dataset, split):
    root, manifest = dataset
    entry = next(e for e in manifest.episodes if e.split == split)
    with pytest.raises(ValueError, match="Only training"):
        fit_normalization([(read_episode(root, entry), entry.sha256)])


def test_adding_ood_episodes_cannot_change_train_normalization(dataset, tmp_path):
    root, manifest = dataset
    expanded = tmp_path / "expanded"
    other = generate_dataset(
        DatasetConfig(train=2, validation=1, test=1, ood_per_suite=2, steps=120), expanded
    )
    assert read_normalization(root, manifest) == read_normalization(expanded, other)
    assert manifest.content_sha256 != other.content_sha256


def test_pairs_keep_object_identity_static_context_and_sample_interval(dataset):
    root, manifest = dataset
    pairs = list(iter_pairs(root, Split.TRAIN, normalized=True))
    assert len(pairs) == 60
    train_ids = {e.id for e in manifest.episodes if e.split == Split.TRAIN}
    assert {p["episode_id"] for p in pairs} == train_ids
    for pair in pairs:
        assert pair["next_tick"] - pair["tick"] == 4
        assert pair["dt"] == pytest.approx(1 / 30)
        assert [o["id"] for o in pair["state"]] == [o["id"] for o in pair["next_state"]]
        assert any(o["static"] for o in pair["state"])
        assert all(len(o["features"]) == 13 for o in pair["state"])


def test_manifest_rejects_cross_split_seed_overlap(dataset):
    _, manifest = dataset
    value = manifest.model_dump()
    value["episodes"][-1]["seed"] = value["episodes"][0]["seed"]
    with pytest.raises(ValidationError, match="disjoint"):
        DatasetManifest.model_validate(value)


def test_episode_checksum_rejects_tampered_payload(dataset):
    root, manifest = dataset
    entry = manifest.episodes[0]
    path = episode_path(root, entry.id)
    raw = json.loads(gzip.decompress(path.read_bytes()))
    raw["frames"][0]["objects"][3]["mass"] = 99
    path.write_bytes(gzip.compress(json.dumps(raw).encode(), mtime=0))
    with pytest.raises(ValueError, match="checksum"):
        read_episode(root, entry)


def test_normalization_and_manifest_fingerprints_are_checked(dataset):
    root, manifest = dataset
    path = root / "normalization.json"
    value = json.loads(path.read_bytes())
    value["mean"][0] += 1
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="checksum"):
        read_normalization(root, manifest)
    path = root / "manifest.json"
    value = json.loads(path.read_bytes())
    value["episodes"][0]["sha256"] = "0" * 64
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="fingerprint"):
        read_manifest(root)


def test_existing_dataset_never_overwritten(dataset):
    root, _ = dataset
    before = (root / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="never overwritten"):
        generate_dataset(config(), root)
    assert (root / "manifest.json").read_bytes() == before


@pytest.mark.parametrize(
    "updates",
    [dict(train=0), dict(steps=121), dict(steps=14400, sample_stride=1), dict(ood_per_suite=10000)],
)
def test_invalid_generation_configuration(updates):
    with pytest.raises(ValidationError):
        DatasetConfig(**updates)


def test_api_catalog_preview_and_integrity_boundary(dataset, monkeypatch):
    root, manifest = dataset
    monkeypatch.setattr(dataset_api, "service", dataset_api.DatasetService(root.parent))
    with TestClient(app) as client:
        catalog = client.get("/api/datasets").json()["datasets"]
        assert catalog[0]["episode_count"] == 10
        assert catalog[0]["pair_count"] == 300
        assert "episodes" not in catalog[0]
        assert (
            client.get(f"/api/datasets/{manifest.id}")
            .json()["normalization"]["method"]
            .endswith("train")
        )
        entry = manifest.episodes[0]
        url = f"/api/datasets/{manifest.id}/episodes/{entry.id}"
        response = client.get(url).json()
        assert response["checksum_verified"] and response["frames"][0]["tick"] == 0
        assert response["frames"][-1]["tick"] == 120
        assert client.get(f"/api/datasets/{manifest.id}/episodes/missing").status_code == 404
        episode_path(root, entry.id).write_bytes(gzip.compress(b"{}", mtime=0))
        assert client.get(url).status_code == 422
        assert client.post("/api/datasets/jobs", json={"train": 300}).status_code == 422


@pytest.mark.parametrize("seed", [3, 42, 99])
def test_collection_worker_finishes_and_existing_config_is_reused(tmp_path, seed):
    service = dataset_api.DatasetService(tmp_path / "catalog")
    cfg = DatasetConfig(seed=seed, train=1, validation=1, test=1, ood_per_suite=1, steps=4)
    job = service.start(cfg)
    process = service.processes[job["id"]]
    try:
        deadline = time.monotonic() + 20
        # Exercise status readers concurrently with Windows atomic file replacement.
        while process.poll() is None and time.monotonic() < deadline:
            assert service.status(job["id"])["status"] in ("running", "complete")
            time.sleep(0.005)
        process.wait(timeout=2)
        complete = service.status(job["id"])
        assert process.returncode == 0 and complete["status"] == "complete"
        assert len(service.catalog()) == 1
        assert service.start(cfg)["dataset_id"] == complete["dataset_id"]
        assert service.start(cfg)["id"] == ""
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


def test_atomic_status_publication_retries_transient_reader_lock(tmp_path, monkeypatch):
    original = Path.replace
    calls = 0

    def transient_replace(path, target):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise PermissionError("Simulated Windows reader sharing violation")
        return original(path, target)

    monkeypatch.setattr(Path, "replace", transient_replace)
    destination = tmp_path / "status.json"
    write_json(destination, {"status": "complete"})
    assert json.loads(destination.read_bytes())["status"] == "complete"
    assert calls == 2


def test_failed_partial_collection_is_preserved_before_retry(tmp_path):
    service = dataset_api.DatasetService(tmp_path / "catalog")
    cfg = DatasetConfig(train=1, validation=1, test=1, ood_per_suite=1, steps=4)
    destination = service.root / dataset_id(cfg)
    destination.mkdir(parents=True)
    (destination / "unfinished.txt").write_text("preserve this partial episode")
    job = service.start(cfg)
    process = service.processes[job["id"]]
    try:
        process.wait(timeout=20)
        assert service.status(job["id"])["status"] == "complete"
        archived = list((service.root / ".partial").iterdir())
        assert len(archived) == 1
        assert (archived[0] / "unfinished.txt").read_text() == "preserve this partial episode"
        assert not (destination / "unfinished.txt").exists()
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


def test_status_read_retries_transient_publication_lock(tmp_path, monkeypatch):
    path = tmp_path / "status.json"
    write_json(path, {"status": "complete"})
    original = Path.read_bytes
    calls = 0

    def transient_read(path):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise PermissionError("Simulated Windows replacement sharing violation")
        return original(path)

    monkeypatch.setattr(Path, "read_bytes", transient_read)
    assert read_json(path)["status"] == "complete"
    assert calls == 2


def test_headless_cli_and_inspection(tmp_path):
    root = tmp_path / "cli"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "oracle.generate_dataset",
            "--train",
            "1",
            "--validation",
            "1",
            "--test",
            "1",
            "--ood-per-suite",
            "1",
            "--steps",
            "4",
            "--output",
            str(root),
        ],
        capture_output=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    result = subprocess.run(
        [sys.executable, "-m", "oracle.inspect_dataset", str(root)], capture_output=True, timeout=20
    )
    assert result.returncode == 0 and json.loads(result.stdout)["verified"] is True
