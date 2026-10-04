# ORACLE architecture

## Stage 1 boundary

```text
Scene (seed + SI-unit definitions)
          │
          ▼
Pymunk / Chipmunk ground truth — 120 Hz
          │
          ├── Frame history + ordered edit journal
          ├── Validated JSON experiment export
          └── WebSocket transforms — 20 Hz
                            │
                            ▼
                   Zustand observation store
                            │
                     PixiJS interpolation
                            │
                      React laboratory
```

Python owns positions, velocities, contacts and angular motion. Browser interpolation only blends two **observed** transforms; it does not integrate gravity, resolve collisions or extrapolate a future. Speed changes the number of fixed solver steps per elapsed wall time, never the solver timestep.

`world.py` holds versioned Pydantic schemas. `scenes.py` uses an isolated `random.Random(seed)`. `physics.py` adapts these definitions to Pymunk. `session.py` owns recording, replay and paused edits. `api.py` handles isolated sessions and transport. The headless runner uses the same Session and PhysicsEngine classes.

## Replay and edits

The solver retains internal contact caches. Copying only transforms would not recreate that state. JSON therefore records the original scene and ordered, tick-indexed `upsert` / `remove` events. Seeking rebuilds the original solver and replays it to the playhead. Events at a tick are applied after reaching that tick, before its next integration step. Multiple edits at the same tick retain their order.

Editing a historical state discards the later recording and its later events. Existing edits at the selected tick remain and the new edit is appended. This is a ground-truth recording fork; Stage 5 will add explicit counterfactual branch ownership and comparisons.

Import validates format, engine version, bounds, chronology, identifiers and object counts, then replays into a separate Session. Failed imports preserve the active world. Snapshots contain plain JSON and never executable pickle data. Restored worlds are paused.

Determinism is tested within the same Pymunk version, platform and timestep. Cross-platform, cross-version bitwise equality is not promised.

## Transport and rendering

Full metadata is sent on connection, edits, scene changes and commands. Playing worlds send only dynamic transforms, clock, playback state and sampled contact events at 20 Hz. Rendering runs on the Pixi ticker with a small observation interpolation delay. Static geometry is cached. Camera transforms ease toward their targets. Collision events are gathered over each tick batch so short contacts survive stream sampling.

Each session retains up to 14,400 solver ticks (120 simulated seconds), 64 objects and 512 edits. Idle disconnected sessions expire after 30 minutes. Disconnecting pauses an unattended world. This local research prototype supports 16 simultaneous sessions; it does not use a persistent database. Browser snapshots retain at most eight experiments and can be exported as JSON.

Import replay runs in a worker thread. Long seeks currently replay synchronously; a future recording store should use solver checkpoints / replay workers while preserving deterministic semantics. Stage 2 dataset collection runs in an isolated Python subprocess. Future training will also run outside the API event loop.

## Stage 2 data flow

```text
DatasetConfig → independent split / suite / episode seeds
                         │
                 Procedural initial World
                         │
                 shared PhysicsEngine — 120 Hz
                         │
               sampled object observations — 30 Hz by default
                         │
               compressed per-episode JSON + SHA-256
                         │
               train-only streaming normalization
                         │
                 published dataset manifest
                         │
       ┌─────────────────┴────────────────────┐
       ▼                                      ▼
verified pair iterator             read-only Research explorer
for future training                recorded world / timeline / histograms
```

`datasets/schema.py` versions config, episode, manifest and normalization. `sampling.py` derives split-owned seeds and non-overlapping initial placements. `engine.py` collects ground truth through the existing adapter, publishes one episode at a time, fits normalization and exposes a verified transition iterator. `storage.py` owns canonical JSON / gzip, checksums and atomic publication. `datasets/api.py` supervises one collection process and serves a lightweight catalog, metadata and sampled previews.

The manifest is published after all episodes and normalization. Readers validate clocks, object identities, disjoint episode seeds and exact train-only normalizer provenance. Physics state remains raw in storage; object-centric training features encode angles as sine / cosine and retain categorical shape / static flags. [Dataset specification](DATASETS.md) defines OOD suites, bounds and scientific limitations.

RESEARCH uses SVG for a read-only replay of stored states and histogram counts; it performs no dynamics integration. The editable Lab keeps its PixiJS renderer and unchanged solver ownership. The dataset worker's status files permit progress updates while another session renders or plays.

## Stage 2–8 extension points

`contracts.py` defines `DynamicsModel`, an object-centric frame-history input, typed interventions and a model-attributed `Prediction` result. Frontend prediction responses use a separate `source: 'learned_model'` type. No current endpoint returns model predictions.

| Stage | Planned modules | Research boundary |
| --- | --- | --- |
| 2 — implemented | `datasets/`, headless collection / inspection | Seeded episodes; splits by episode; train-only normalization; explicit OOD ranges |
| 3 | `models/`, `training/` | PyTorch object encoder + replaceable MLP / GRU dynamics; configuration-rich checkpoints |
| 4 | `prediction/`, `analytics/` | One-step and autoregressive model rollout; ADE / FDE / MSE versus ground truth |
| 5 | `counterfactual/` | Immutable source observations, intervention branches, separate prediction and reality execution |
| 6 | `models/attention/`, `uncertainty/` | Temporal Transformer, ensemble / MC dropout outputs with named estimation methods |
| 7 | `experiments/`, `research/` | Matched-model evaluations, OOD suites, batch runs and honest reports |
| 8 | `planning/` | Candidate actions ranked by learned rollouts and verified in reality |

V2 visual encoders can map rendered observations into the same temporal input boundary. The renderer does not need to know whether a model uses a CNN, VAE, GRU or Transformer. 2.5D / 3D requires a versioned world schema and another physics / rendering adapter; Stage 1 does not claim a drop-in 3D engine.

## Design system

`frontend/src/styles.css` owns palette, spacing, radii, shadows, fonts and timing tokens. Graphite surfaces and cool cyan identify the laboratory; neutral traces represent recorded reality, violet identifies future ML capabilities. Manrope is the interface typeface; IBM Plex Mono is used for measurements. Both fonts are bundled locally. The viewport occupies about 76% of the desktop workspace width at 1440 and about 80% at 1920. Inspectors scroll within their boundary rather than over the scene.
