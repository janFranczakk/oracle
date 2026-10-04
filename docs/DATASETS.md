# ORACLE dataset engine

Stage 2 collects **ground-truth observations** through the same `PhysicsEngine` used by the interactive laboratory. It contains no model predictions, training results or invented generalization scores.

## Reproduction and split ownership

A strict `DatasetConfig` specifies master seed, train / validation / test episode counts, episodes per OOD suite, solver ticks and sample stride. SHA-256 derives a separate 32-bit seed from master seed, split, suite and episode index. A deterministic collision-resolution nonce ensures globally unique seeds. Splits are established before simulation, never by randomly dividing adjacent frames.

Each procedural scene uses a private `random.Random` instance. Origin definitions include all positions, shapes, mass, material coefficients, dimensions, linear / angular velocities, orientations and environment settings. Pymunk 7.2 uses the Stage 1 120 Hz, single-threaded solver with 20 iterations. Observation stride changes sampling, never the integration step.

Reproduction is scoped to the pinned engine, Python runtime and platform. The dataset ID fingerprints config, generator and runtime. Content SHA-256 fingerprints episode checksums and normalization; timestamps do not affect content hashes. Canonical JSON and gzip with zero modification time produce repeated identical payloads on the verified runtime. [Python gzip documentation](https://docs.python.org/3/library/gzip.html).

## Procedural scene policy

All scenes contain a floor and two walls. Randomized ramps occupy separated lower-world regions. Circles and boxes spawn without overlap in the upper region; bounding circles conservatively cover rotated boxes. Every scene contains both a box and circle. Randomness includes shape mix, dynamic object count, obstacle count, positions, dimensions, radius, mass, speed / direction, orientation, angular velocity, friction and restitution.

| Initial condition | Train / validation / test | OOD suite |
| --- | --- | --- |
| Dynamic mass | 1–5 kg | Unseen mass: 6–8 kg |
| Speed magnitude | 0–10 m/s | Unseen velocity: 11–15 m/s |
| Absolute orientation | 0–45° | Unseen angle: 60–80° |
| Dynamic object count | 3–8 | Unseen object count: 9–12 |
| Randomized obstacle count | 0–2 | Unseen obstacles: 3–4 |
| Joint mass / speed corner | Exclude mass ≥4.5 AND speed ≥9 | Held-out combination: mass 4.5–5 AND speed 9–10 |

Other common ranges: friction 0.1–0.8, restitution 0.2–0.95, circle radius 0.3–0.65 m, box sides 0.6–1.2 m, angular velocity −1–1 rad/s. Velocity direction spans the full circle. Body and ramp orientation signs vary.

The reserved joint corner is excluded from **all in-distribution splits** and the angle / count / obstacle suites. Mass-only and speed-only OOD retain the other base range. The combination suite uses known marginal values whose joint region is deliberately withheld. It is a controlled held-out joint-range test, not a claim that every arbitrary combination is unseen.

These are initial-condition shifts. Gravity, contacts and rotation can produce later states outside initial ranges. The world has no roof; objects may briefly leave the visible world and can escape over a side wall. No observation is clipped or silently removed from the dataset. The data explorer is a 24×14 m view and can therefore show fewer bodies when some lie outside it. Stage 3 should explicitly measure / filter trajectories using documented criteria if a bounded domain is required.

## Storage

```text
datasets/ds-<configuration-runtime-hash>/
├── episodes/
│   └── <split>-<suite>-<index>-<seed>.json.gz
├── normalization.json
└── manifest.json
```

`Episode` schema v1 stores identity, split, suite, seed, sampling ranges, origin, solver duration, observation stride and ordered frames. Each frame contains full object definitions and observed transforms, stable object ordering, solver tick and contact-onset IDs accumulated over the preceding sample interval. Contact IDs are not pairwise collision relations or persistent support labels.

`DatasetManifest` records generator / engine / schema versions, UTC timestamp, runtime, config and per-episode checksums, seed, counts, initial masses / speeds and sample / pair counts. The manifest is published last. A failed collection is not advertised as complete. GUI retry preserves partial files under `.partial/`; the CLI refuses any non-empty destination.

Readers validate schemas, clocks, unique IDs / seeds, split sizes, content checksums and normalization provenance. Full `oracle.inspect_dataset` additionally opens every episode, validates its configured seed assignment / OOD policy, regenerates its initial scene, checks summary statistics against the payload and independently refits training statistics. This verifies internal consistency and integrity, not the scientific correctness of the physics engine or cryptographic authenticity of a third-party dataset.

## Object-centric features and transition reader

`iter_pairs(root, Split.TRAIN, normalized=True)` streams adjacent sampled frames without loading the whole dataset. Each pair contains episode ID, seed, split / suite, input / next ticks, physical sample interval, environment, per-object records and contact-onset IDs for the next interval. Static objects remain as context. Dynamic object IDs are stable within an episode; similarly named objects in different episodes are separate entities.

Each object record preserves ID, categorical shape and static flag alongside 13 continuous features:

```text
x, y, vx, vy, sin(rotation), cos(rotation), angular_velocity,
mass, friction, restitution, radius, width, height
```

Circle width / height and rectangle radius are encoded as zero with categorical shape retained. Sine / cosine avoids an angular discontinuity at ±π. Stage 3 must encode shape and static flag separately and create masks / padding for variable object counts; Stage 2 does not flatten scenes into one fixed global vector.

## Normalization and leakage prevention

Streaming Welford statistics use **dynamic observations from training episodes only**, including their final observed frame. Each dynamic body / observed tick has equal weight, so episodes with more bodies contribute more observations. Static context does not fit statistics. Population standard deviation is used; near-constant features get unit scale and are recorded by name. Transform / inverse transform validate the feature schema and finite values.

Mean / scale are saved with every exact training episode ID and checksum. Validation, test and OOD apply the same transform without refitting or clipping. The reader rejects a normalizer whose provenance differs from the manifest's training entries. This follows the [train-only preprocessing principle](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage); scikit-learn is not a runtime dependency here.

## Collection API and UI

`POST /api/datasets/jobs` validates an interactive config and starts one hidden Python subprocess. Atomic status JSON supports `GET /api/datasets/jobs/{id}`; transient Windows sharing locks are retried during replacement and concurrent opening. Logs and job config stay in `datasets/.jobs/`. An identical complete collection is reused. No training or collection work runs inside the rendering loop.

`GET /api/datasets` returns lightweight catalog summaries. `GET /api/datasets/{id}` returns manifest and normalization. `GET /api/datasets/{id}/episodes/{episode}` verifies the episode checksum and returns at most 241 observed preview frames, including the final frame. Preview downsampling does not modify stored transitions.

RESEARCH exposes collection controls, progress, split / suite filters, a read-only recorded scene, discrete timeline, specimen measurements, initial-distribution histograms and normalization statistics. Histogram bar heights count actual initial dynamic bodies; train / validation / test / OOD have separate colours. No chart is a model metric.

## Limits and next work

CLI: at most 10,000 episodes, 14,400 solver ticks per episode and 3,601 observed frames; API: at most 256 episodes, 1,200 solver ticks and stride ≥4. Files are streamed per episode, but an individual episode is held in memory. Inspected decompressed episodes are limited to 64 MiB. The catalog lists up to 50 compatible collections.

Local collection has no distributed scheduler, cancellation control, resume of a partial episode, persistent job supervisor or dataset migration tool. A worker can finish after the UI leaves RESEARCH; it retains a job reference for browser reload. A backend restart loses in-memory process supervision, while files and status remain. Thin-surface / high-speed solver limitations persist from Stage 1. No images / pixel dataset or intervention episodes are generated yet.

Next: dataset adapters / masks, a train / validation baseline, reproducible PyTorch training, object encoders, honest one-step / rollout evaluation and checkpoint metadata containing this feature schema and exact normalizer.
