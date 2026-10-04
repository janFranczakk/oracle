# ORACLE — Stage 2 report

Verified **4 October 2026**, Europe/Warsaw. Stage 2 implements the dataset foundation and observation explorer. It does not train a world model or claim generalization performance.

## Implemented

- Procedural circles / boxes and randomized ramp obstacles, with non-overlapping dynamic spawn, variable counts, mass, dimensions, material properties, orientations and linear / angular velocities.
- Deterministic episode seeds derived from master seed, split, suite and index; train / validation / test / OOD remain disjoint at episode level.
- Six explicit OOD suites: mass, velocity, angle, object count, obstacle count and a reserved mass–speed combination.
- Versioned, compressed JSON episodes, manifest, canonical SHA-256 content fingerprints, exact origins, configuration, runtime and UTC timestamp.
- Train-only streaming population normalization, constant-feature handling, reversible per-object transforms and checksum-bound provenance.
- Object-centric adjacent-frame iterator with static context, categorical shape, stable IDs, 13 continuous features, sample interval and contact-onset labels.
- Real headless commands: `oracle.generate_dataset` and `oracle.inspect_dataset`.
- Research UI: background collection controls / progress, dataset catalog, split / suite filters, observed scene and timeline, specimen inspection, distribution histograms and normalization statistics.
- Readable failure states, validated bounds, completed-dataset reuse and preservation of failed partial work.

## Architecture

The existing `PhysicsEngine` remains the only dynamics authority. Collection runs in a separate hidden Python process. A scene is generated from a split-owned seed, simulated at 120 Hz and sampled at an independent observation stride. Files are written one episode at a time; training statistics are fitted only after collection; the manifest is published last.

The UI receives verified recorded frames, never future predictions. Research SVG rendering reads transforms; Lab continues to use PixiJS. No physics is duplicated in TypeScript. No new runtime dependency was needed for Stage 2.

[Dataset specification](docs/DATASETS.md) · [Architecture](docs/ARCHITECTURE.md).

## Physics

Same pinned Pymunk 7.2, single-threaded 120 Hz / 20-iteration solver as Stage 1. Procedural sampling changes initial conditions, not integration rules. Body identities and ordering remain stable. Short contact onsets are accumulated over each observation interval so stride sampling does not silently omit them.

OOD labels apply to initial conditions. Later speeds / rotations can leave those ranges under real dynamics. The joint upper mass–speed region is excluded from all in-distribution splits and reserved for the combination suite. Thin-surface / fast-motion solver limitations remain; there is no claim of universal physical fidelity.

## Frontend and visual design

Research extends ORACLE's shared colours, fonts, spacing and motion tokens. Independent split colours, read-only scene status, payload-verification feedback and normalization provenance communicate research ownership. All histogram values are computed from collected initial states. There are no invented losses or model scores.

Episode list, timeline and inspector were checked for resizing and internal scrolling. The scene / library / inspector have bounded heights to avoid a long episode list stretching the observer. Initial-condition details can be expanded within the inspector. SVG specimens support keyboard selection.

| Viewport | Horizontal document overflow | Library / scene / inspector overlap | Result |
| --- | --- | --- | --- |
| 1440×900 | None, document width 1440 | None | Passed |
| 1920×1080 | None, document width 1920 | None | Passed |

Evidence: [1440 explorer](docs/screenshots/dataset-explorer-1440.jpg), [1920 explorer](docs/screenshots/dataset-explorer-1920.jpg), [normalization inspector](docs/screenshots/dataset-normalization-1440.jpg). Analysis panels are reached by normal vertical workspace scrolling. Mobile has a stacked layout; exhaustive touch QA was not performed.

## Testing

### Automated verification

| Check | Result |
| --- | --- |
| Backend pytest, including Stage 1 regression suite | **69 passed** |
| Frontend Vitest, including existing geometry / store tests | **21 passed** |
| Ruff lint / formatting | Passed |
| ESLint / Prettier | Passed |
| Strict TypeScript / Vite production build | Passed |
| Production preview | Connected, opened the collection and advanced an observation; no browser error / warning logs |
| Full dataset inspection / independent reproduction | Passed, same content fingerprint |
| Desktop visual checks | Passed at 1440×900 and 1920×1080 |

The dataset tests cover repeated payloads, seed isolation, procedural bounds / placement, exact observed solver states, interval contact accumulation, independent normalization refitting, changes to OOD without changes to train statistics, static exclusion, constant features, transition identity, serialization / checksum failures, existing-data protection, real CLI collection / inspection, subprocess status polling across three seeds and preservation of partial output. The full inspector also regenerates initial scenes from their seeds and checks summary statistics against payloads.

The frontend tests cover dataset split / suite filtering, histogram boundaries, collection configuration and invalid seeds, alongside the existing geometry, timeline and observation-store suite.

One existing dependency warning remains: Starlette TestClient deprecates its httpx adapter. It does not fail tests.

### Actual browser verification

- Collected the standard dataset through the running UI: **64 episodes**, **7,680 transition pairs**, 121 observed frames per episode.
- Verified collection progress / disabled controls and successful dataset publication. Identical configuration reuses the existing completed dataset.
- Opened train, validation, test and OOD episodes. Filtered unseen-mass OOD to four episodes.
- Scrubbed to the last observation at tick 480 / 4.000 s; selected a different circle and observed its real mass / velocity / position.
- Stepped validation from tick 0 to tick 4, corresponding to one 30 Hz observation interval.
- Inspected actual mean / scale statistics from 24 train episodes and **15,367 dynamic observations**.
- Entered seed −1; a readable validation error appeared, preserving the collected dataset.
- Checked layout at both required desktop sizes and saved screenshots.

Two Windows issues were found through actual use and fixed. Atomic status-file replacement can briefly conflict with a reader, so both publication and concurrent opening now retry transient sharing violations; concurrent polling is covered by worker tests across three seeds. The launcher formerly hid denied WMI access and compared a string timestamp with an automatically parsed date; it now probes loopback ports without WMI, compares numeric creation ticks, records ownership before startup checks and reports early exits. Start / stop / restart were rechecked on the actual application.

## Reproduction evidence and performance

The browser collection and a separate headless collection produced the same dataset ID and full content fingerprint:

```text
ds-2cda3301ce8c3c5c
900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e
```

Both passed the full inspector, including independent train-only normalization refitting. The manifest timestamp differs between runs; it is excluded from content identity.

One local headless measurement: **3.700 s** including process startup, 64 × 480 ticks, compression and normalization. The collection uses **2,356,693 bytes** in 66 files (64 compressed episodes, normalization and manifest). This is a small demonstration / QA dataset, not a recommendation for sufficient training volume or a scaling guarantee. Runtime: Windows, Python 3.12.14, pinned Pymunk 7.2.

## Known limitations

- Dataset schema is object-state based; no image dataset, camera observations, intervention episodes or learned labels.
- Split isolation is episode / seed based. No empirical ML generalization scores are available before Stage 3 training.
- The world has no roof; fast objects may leave the visible region / escape over a wall. Stored observations are preserved, not clipped. Filtering for future experiments must be explicit.
- The procedural family is limited to circles, boxes and ramps within one environment. Its OOD suites test specified shifts, not every unseen physical situation.
- Each episode is held in memory while collecting; datasets are streamed episode by episode. API and CLI have explicit bounded sizes.
- One local collection worker; no distributed scheduler, persistent supervisor, cancellation UI, partial resume or migration tooling. Backend restart loses in-memory worker supervision; artifacts remain on disk.
- Dataset files and logs remain local under ignored `datasets/`. Browser snapshots remain separate Stage 1 experiments.
- PyTorch models, training, checkpoints, learned predictions, uncertainty and branch comparisons are intentionally absent.
- Git author identity is still unconfigured; source and documentation are reviewable, with no invented-author commits. Ignore rules now scope generated datasets to the root data directory while retaining the backend dataset source package.

## Roadmap

Stages 1–2 are complete. Stage 3 should introduce object encoders and replaceable MLP / GRU dynamics, masks for variable object counts, reproducible training / validation, one-step and autoregressive evaluation and configuration-rich checkpoints. Stages 4–8 retain their prediction, counterfactual, advanced-model, research-comparison and planning boundaries.

## Next Stage

Use the verified pair iterator as the training boundary. Freeze dataset identity, feature schema and train normalizer into checkpoint metadata; keep validation and OOD out of fitting. Start with an object-centric baseline, measure against a clearly named naive baseline, report dynamic-object errors by horizon and split, and expose only actual logged metrics in Research. Model prediction endpoints must be backed by trained weights and remain separate from ground truth.
