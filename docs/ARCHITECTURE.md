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

Editing a historical state discards the later recording and its later events. Existing edits at the selected tick remain and the new edit is appended. This is a ground-truth recording fork; Counterfactual Lab separately owns immutable alternative branches and their comparisons.

Import validates format, engine version, bounds, chronology, identifiers and object counts, then replays into a separate Session. Failed imports preserve the active world. Snapshots contain plain JSON and never executable pickle data. Restored worlds are paused.

Determinism is tested within the same Pymunk version, platform and timestep. Cross-platform, cross-version bitwise equality is not promised.

## Transport and rendering

Full metadata is sent on connection, edits, scene changes and commands. Playing worlds send only dynamic transforms, clock, playback state and sampled contact events at 20 Hz. Rendering runs on the Pixi ticker with a small observation interpolation delay. Static geometry is cached. Camera transforms ease toward their targets. Collision events are gathered over each tick batch so short contacts survive stream sampling.

Each session retains up to 14,400 solver ticks (120 simulated seconds), 64 objects and 512 edits. Idle disconnected sessions expire after 30 minutes. Disconnecting pauses an unattended world. This local research prototype supports 16 simultaneous sessions; it does not use a persistent database. Browser snapshots retain at most eight experiments and can be exported as JSON.

Import replay runs in a worker thread. Long seeks currently replay synchronously; a future recording store should use solver checkpoints / replay workers while preserving deterministic semantics. Dataset collection and Stage 3 training run in isolated Python subprocesses, outside the API event loop.

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

## Stage 3 learned dynamics

```text
verified split-owned episode windows + train normalizer
                  │
       shared per-object encoder (22 → 64 features)
                  │
       object embedding + masked scene mean
                  │
       shared temporal MLP / GRU
                  │
       learned motion residuals + contact logits
                  │
       AdamW train / validation-only checkpoint selection
                  │
       checkpoint weights + optimizer + provenance
                  │
       held-out one-step / free autoregressive evaluation
                  │
       Research charts + test / OOD groups + CV reference
```

`models/dynamics.py` provides interchangeable object-centric temporal architectures. `training/data.py` owns verified sequences, categorical / static encoding, environment input and padding. `engine.py` owns deterministic optimization and validation selection. `checkpoint.py` verifies bounded weight artifacts and binds exact normalization / dataset identity. `evaluation.py` feeds model outputs back into its own input; it does not call physics. `metrics.py` reports physical-unit errors and explicit contact class counts. CLI and API workers share this path.

`models/inference.py` adapts checkpoint weights to `DynamicsModel` and typed frames, preserving identity and sampled ticks. Interventions are rejected until conditioning is implemented. Uncertainty remains unset. The API imports training schemas / catalog code without loading PyTorch; heavy training runs in a locked subprocess. The Research workspace is lazy-loaded so charting dependencies do not enlarge the initial Lab bundle. [Training specification](TRAINING.md) defines the configuration, artifact and evaluation contracts.

## Stage 4 Prediction Lab

The paused Lab freezes real sampled observations and the experiment journal through its anchor. A bounded subprocess loads a verified checkpoint, calls the existing learned adapter and independently replays Pymunk to that anchor for the physical reference. Learned frames never use reference outputs as inputs. The live world / recording is untouched; reference conditions are held at the anchor, excluding future recorded edits.

`prediction/` owns catalog, capture, supervision, replay and metrics. `oracle.predict` owns worker inference. Session envelopes add transient generation and last edit tick, preserving portable Experiment schema 1. Both server and Zustand reject predictions after generation / revision / tick / paused-state changes. The Pixi ghost layer and independent forecast cursor render exact sampled model / reference poses; the observation timeline still owns real playback. Recharts is loaded on demand for measured errors. [Prediction specification](PREDICTION.md) defines the clocks, API, provenance, metrics and bounds.

## Stage 5 Counterfactual Lab

`counterfactual/` owns strict portable source / branch schemas, pure immutable materialization, owner-scoped bounded storage, explicit derived-history conditioning and a separate worker. The router receives the existing session lookup and prediction supervisor. Stage 4 / 5 share a single worker slot; neither operation takes control of live session physics.

```text
paused observed source + origin / journal through anchor
                         │
                  immutable source snapshot
                         │
            branch ancestry → ordered interventions at same anchor
                         │
          ┌──────────────┴─────────────────────┐
          ▼                                    ▼
real past → explicit derived inputs      explicit Run reality
verified MLP / GRU weights                Pymunk past replay + branch edits
autoregressive learned future            isolated physical future
          └──────────────┬─────────────────────┘
                         ▼
            matched frames → measured errors
            branch comparison / shared cursor / report
```

`frontend/src/counterfactual/` keeps branch state separate from the live store, presents previews and a bounded tree, and renders exact returned poses in PixiJS overlay / split views. Shared drawing helpers preserve the existing Lab styling. A draft hides saved futures / measurements until committed or discarded. Browser plans persist locally; imported sources are replay-validated and imported metrics are ignored. [Counterfactual specification](COUNTERFACTUAL.md) defines conditioning, source identity, clocks, bounds and compatibility.

## Stage 6 advanced models and extension points

`contracts.py` defines `DynamicsModel`, an object-centric frame-history input, typed interventions and a model-attributed `Prediction` result. Lab responses use `oracle-prediction-v1`; Counterfactual Lab uses portable plan / future / report v1 formats with separate sources. Stage 6 adds optional attention and MC dropout distribution fields without changing deterministic point forecasts. The direct adapter rejects opaque interventions; Counterfactual Lab derives its model window explicitly. Intervention-specific training, aleatoric estimation and uncertainty calibration remain future work. [Advanced model and measurement contract](ADVANCED_MODELS.md).

| Stage | Planned modules | Research boundary |
| --- | --- | --- |
| 2 — implemented | `datasets/`, headless collection / inspection | Seeded episodes; splits by episode; train-only normalization; explicit OOD ranges |
| 3 — implemented | `models/`, `training/` | PyTorch encoder, MLP / GRU, checkpoints, one-step / autoregressive evaluation |
| 4 — implemented | `prediction/` | Verified learned rollout, Lab ghost trajectories and per-object ground-truth error visualization |
| 5 — implemented | `counterfactual/` | Immutable source observations, explicit derived conditioning, branch trees, separate prediction and reality execution |
| 6 — implemented | `models/attention.py`, `models/sampling.py`, `training/uncertainty.py` | Masked object and temporal attention; seeded MC dropout paths; measured test/OOD marginal and joint coverage |
| 7 — implemented | `research/`, `oracle.research_batch` | Matched checkpoint targets/anchors, test/OOD batches, CPU timing and persistent reports |
| 8 — implemented | `planning/`, `oracle.plan` | Nine velocity actions ranked by learned endpoint distance; fixed winner separately verified in reality |

V2 visual encoders can map rendered observations into the same temporal input boundary. The renderer does not need to know whether a model uses a CNN, VAE, GRU or Transformer. 2.5D / 3D requires a versioned world schema and another physics / rendering adapter; Stage 1 does not claim a drop-in 3D engine.

## Stage 7 research platform

`research/schema.py` defines bounded batch requests and checkpoint annotations without loading PyTorch. `registry.py` extends the existing verified model catalog with separate labels/pins/archive files; weights, training metadata and laboratory availability stay intact. `api.py` supervises one file-locked research subprocess, persists status/report artifacts and enforces its owned worker deadline. `oracle.research_batch` and API jobs share `research/engine.py`.

The engine validates completed training and fixed hashes, then requires exact dataset/normalizer/environment/clock identity. The maximum selected history becomes a common observation start passed to `training/evaluation.py`. Models keep their own trained history lengths, while targets, anchors, supported horizons and constant-velocity references are shared. Schedule hashes must agree before the complete report is atomically published. Real warmed CPU forward timing records its sample, threads and limited scope. [Research contract and API](RESEARCH.md).

`ComparisonDashboard.tsx` owns selection, annotations, worker progress and the persistent batch log. `ComparisonResults.tsx` renders returned metrics, horizon points and provenance; `comparison.ts` validates inputs and creates CSV from measured values. It performs no simulation, inference or metric fabrication. Existing Research training/data views remain available.

## Stage 8 learned rollout planning

`planning/schema.py` and `search.py` validate the paused source identity, dynamic target, terminal position goal and bounded action grid. They materialize the unchanged baseline plus eight velocity offsets at the same captured anchor. `worker.py` replays known past once to obtain real history, loads one verified checkpoint with dropout disabled and rolls out each action through the learned adapter. It never integrates a physical future during search. Ranking is endpoint Euclidean distance, velocity-change magnitude and original input order. The selected full-world future and all nine target trajectories are returned.

The report binds a normalized source plan, request and model description with SHA-256, including exact weights/data/normalizer/clock provenance. Normalization before hashing survives the browser's conversion of integral floats to JSON integers. Predictions reuse the existing counterfactual future and terminal-state conditioning contract, including `intervention_trained: false`. `store.py` keeps bounded owner-scoped reports; separate explicit reality requests execute the cached fixed winner through the Counterfactual worker, measure actual goal distance and forecast error, and leave the learned ranking intact.

Prediction, Counterfactual and Planning share one inference supervisor slot and its 45-second deadline. API startup and reality-only workers do not import Torch. `frontend/src/planning/` owns goal controls, returned ranking, sampled cursor, separate measurements and JSON export. `BranchViewport` adds optional goal/alternative trajectory layers using returned positions. Existing callers retain their rendering behavior. The UI never performs physics, inference or objective scoring. [Planning protocol, API, reproduction and limits](PLANNING.md).

## Design system

`frontend/src/styles.css` owns palette, spacing, radii, shadows, fonts and timing tokens. Graphite surfaces and cool cyan identify the laboratory; neutral traces represent recorded reality, violet identifies learned futures. Manrope is the interface typeface; IBM Plex Mono is used for measurements. Both fonts are bundled locally. The live Lab viewport occupies about 76% of the desktop workspace width at 1440 and about 80% at 1920. Counterfactual Lab also allocates space to a branch tree and an execution inspector. Inspectors scroll within their boundary rather than over the scene.
