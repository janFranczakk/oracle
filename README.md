# ORACLE

**Counterfactual Physics Lab** · Interactive laboratory for learned world models and counterfactual reasoning.

## What is ORACLE?

ORACLE studies the gap between what a controlled physical world does and what a learned dynamics model predicts. The intended workflow is observation → intervention → model prediction → ground-truth execution → measured error.

**Stages 1–2 are implemented:** a polished, deterministic 2D laboratory and a reproducible dataset engine with an interactive episode explorer. A trained world model is not included. Every motion shown in this release is explicitly labeled ground truth.

## Core idea

The simulator knows physical dynamics. Future models learn from recorded object observations, without receiving handwritten collision behavior or physics equations as their prediction implementation. Model outputs must remain distinct from simulator outputs.

## Architecture

```text
oracle/
├── backend/
│   ├── oracle/        # physics, sessions, API, model contracts, dataset CLI
│   │   └── datasets/  # procedural sampling, schemas, storage, normalization, workers
│   ├── tests/         # deterministic replay and API tests
│   ├── pyproject.toml
│   └── requirements.lock.txt
├── frontend/
│   ├── src/
│   │   ├── api/       # HTTP and WebSocket transport
│   │   ├── components/# object inspector
│   │   ├── rendering/ # PixiJS scene and camera geometry
│   │   ├── research/  # dataset explorer, observed timelines, distributions, roadmap
│   │   ├── state/     # typed observation store
│   │   └── timeline/  # recorded state scrubbing and transport
│   └── pnpm-lock.yaml
├── scripts/          # Windows launcher and benchmark
├── docs/             # requirements, architecture, visual verification
├── experiments/      # local exports, ignored by Git
├── datasets/         # generated collections, ignored by Git
├── STAGE_1_REPORT.md
└── STAGE_2_REPORT.md
```

[Architecture](docs/ARCHITECTURE.md) · [Dataset specification](docs/DATASETS.md) · [Stage 1 report](STAGE_1_REPORT.md) · [Stage 2 report](STAGE_2_REPORT.md)

## Physics engine

Pymunk 7.2 wraps the established Chipmunk rigid-body engine and integrates directly with Python. A single-threaded Space, fixed `1/120 s` timestep, deterministic object insertion and local seeded RNG provide reproducible tests. Circles and rectangles cover spheres, blocks, ramps, walls and platforms. Ramp angles are rectangle rotations.

Pymunk was chosen over Box2D for its compact Python API and straightforward local installation. Its [Space documentation](https://www.pymunk.org/en/latest/pymunk.html#pymunk.Space) describes the solver and contact cache behavior that motivated replay-based restoration. This is a controlled rigid-body sandbox; extreme velocities may tunnel through thin surfaces, and arbitrary overlapping initial conditions are not physically meaningful experiments.

PixiJS provides GPU rendering, anti-aliased geometry, cached shapes and smooth camera motion. It fits the [scene-graph / Graphics API](https://pixijs.com/8.x/guides/components/scene-objects/graphics) needed for instrumentation and later model trajectories. It never runs a second physics engine.

## World model

Stage 1 includes object-structured observations and a `DynamicsModel` protocol for future MLP, GRU and Transformer implementations. The planned V1 path is object encoder → latent dynamics → structured state decoder. V2 can introduce visual encoders and latent visual dynamics. PyTorch, training code and model weights enter in Stage 3.

## Counterfactual reasoning

Today you can pause, edit a body and observe the changed ground-truth world. Editing a past frame starts a new recording from that frame. Explicit counterfactual trees, immutable alternatives and learned future comparisons enter in Stage 5. Current replay trails are **recorded observations**, not predictions.

## Prediction pipeline

Planned: frame history + typed intervention → trained dynamics model → autoregressive rollout → model-attributed frames and named uncertainty estimates → UI trajectory layer. A separate simulator run will produce the actual future for comparison. Stage 1 displays “No model connected”, “Prediction unavailable” and “Confidence not estimated”.

## Screenshots

### Main Lab

![ORACLE Main Lab at 1440×900](docs/screenshots/main-lab-1440.jpg)

[1920×1080 verification](docs/screenshots/main-lab-1920.jpg)

### Research Mode

![Stage 2 dataset explorer](docs/screenshots/dataset-explorer-1440.jpg)

[1920×1080 dataset explorer](docs/screenshots/dataset-explorer-1920.jpg) · [Stage 1 roadmap archive](docs/screenshots/research-1920.jpg)

### Counterfactual Branches

Screenshot reserved for Stage 5. Branches are not yet implemented.

### Predicted vs Actual

Screenshot reserved for Stage 4. No learned predictions are shown in Stage 1.

### Training Dashboard

Screenshot reserved for Stage 3. No fabricated training metrics are displayed.

## Demo workflow

1. Open the Lab and start physics with **Play** or **Space**.
2. Pause after an interesting contact. Drag the timeline to any recorded tick.
3. Select a body. Edit its material properties or use **Motion & transform** for position, rotation, velocity and angular velocity.
4. Inspect the scene preview, then **Apply to world**. Editing truncates future observations at the selected tick.
5. Add, duplicate, drag or remove objects while paused. Static ramps / walls can be moved and rotated too.
6. Use focus, follow, pan, scroll zoom and camera reset.
7. **Save state** creates a browser snapshot. Open the library to restore it, export JSON or import an experiment.
8. Choose another scene and seed to start another reproducible experiment.
9. Switch to **Research → Dataset engine**. Choose a collection seed, size and episode duration, then **Collect dataset**. An isolated Python worker collects real observations.
10. Inspect train / validation / test / OOD episodes. Scrub their observed timeline, select a specimen, compare initial mass / speed distributions and inspect normalization provenance.

## Installation

Requirements: Python 3.12+, Node.js 22.12+ (verified with 24.19), pnpm (verified with 11.25). Commands below are PowerShell, from the project root. Python 3.12 was used for verification.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
.\.venv\Scripts\python.exe -m pip install --no-deps -e ./backend
cd frontend
pnpm install --frozen-lockfile
cd ..
```

For dependency development, use `.\.venv\Scripts\python.exe -m pip install -e './backend[dev]'`. The frontend explicitly allows esbuild's registry package build step in `pnpm-workspace.yaml`.

## Development

Run in two terminals from the root:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn oracle.api:app --host 127.0.0.1 --port 8011
```

```powershell
# Terminal 2
cd frontend
pnpm run dev
```

Open [ORACLE Lab](http://127.0.0.1:5181). The backend exposes [interactive API docs](http://127.0.0.1:8011/docs). Vite proxies both HTTP and WebSocket connections to port 8011. These ports avoid typical local services on 8000 / 5173. If you change them, update the Vite proxy and backend origin list together.

Optional Windows launcher: `./scripts/dev.ps1` starts hidden processes and saves logs in `.run/`. `./scripts/dev.ps1 -Stop` stops the tracked process trees after checking their IDs and creation timestamps. The launcher checks occupied ports and refuses to replace unrelated services. The two-terminal workflow is also available when you prefer direct control of server lifetimes.

Verification:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests
.\.venv\Scripts\python.exe -m ruff check backend scripts/benchmark.py
.\.venv\Scripts\python.exe -m ruff format --check backend scripts/benchmark.py
cd frontend
pnpm test
pnpm run lint
pnpm run build
pnpm run preview
```

The production preview runs at [127.0.0.1:4181](http://127.0.0.1:4181) and still requires the Python backend. Font files are bundled, so typography does not depend on a third-party font service.

Keyboard shortcuts: **Space** play / pause, **.** one tick, **R** reset camera, **Delete** remove selection. Drag objects while paused; drag empty space or Alt-drag to pan. Scroll zooms around the pointer. Form fields and dialogs retain normal keyboard behavior.

On Windows, start / stop the helper from a normal terminal with permission to manage its own process trees. It now probes loopback ports without WMI, compares numeric process creation timestamps, records ownership before startup validation and reports early failures instead of silently claiming success.

## Dataset generation

Collect the default 64-episode dataset: 24 train, 8 validation, 8 test and 4 episodes for each of six OOD suites. Each episode has 480 solver ticks (4 seconds), sampled every 4 ticks (30 Hz), producing 120 adjacent transition pairs.

```powershell
.\.venv\Scripts\python.exe -m oracle.generate_dataset --seed 42 --output datasets/demo
.\.venv\Scripts\python.exe -m oracle.inspect_dataset datasets/demo
.\.venv\Scripts\python.exe -m oracle.inspect_dataset datasets/demo --pair train --normalized
```

Count and clock flags: `--train`, `--validation`, `--test`, `--ood-per-suite`, `--steps`, `--sample-stride`. `--config config.json` accepts a strict DatasetConfig; `--output path` requires an empty directory. Completed datasets are never overwritten. No browser is required.

The UI exposes the same generator and reuses completed identical configurations. Failed partial collections are preserved in `datasets/.partial/` before a retry. Each collection includes compressed JSON episodes, a versioned manifest, checksums, exact initial conditions and train-only normalization. The catalog inspects immediate subdirectories of `datasets/`.

Splits are assigned before simulation and remain disjoint at episode / seed level. OOD suites cover unseen mass, velocity, orientation, object count, obstacle count and a reserved mass–speed combination. OOD refers to **initial conditions**; later velocities can exceed those ranges under gravity. [Dataset format, boundaries and feature encoding](docs/DATASETS.md).

## Training

Stage 3 will add PyTorch MLP / GRU training, validation, rollout and checkpoints containing weights, optimizer state, epoch, config, normalization and architecture metadata. `oracle.train` is not available in this stage.

## Evaluation

Model evaluation enters with Stage 3–4. No AI accuracy or confidence claims can be made from this release.

## Experiments

The shared headless simulation path works without a browser:

```powershell
.\.venv\Scripts\python.exe -m oracle.experiment --seed 42 --scene incline --steps 600 --output experiments/example.json
.\.venv\Scripts\python.exe scripts/benchmark.py
```

An experiment contains schema and engine versions, a null model version, timestamp, seed, complete environment and initial object definitions, ordered edit events, playhead and recorded duration. Import reconstructs the solver history and restores a paused playhead. Equal runs are tested on this platform and pinned Pymunk version; bitwise identity across versions / operating systems is not guaranteed.

## Metrics

Stage 1 displays physical state and **translational kinetic energy** computed from current observations. It excludes rotational energy and is not a conservation diagnostic. Later evaluation will report position / velocity MSE, periodic rotation error, collision classification accuracy, ADE, FDE, trajectory error and error versus horizon. Uncertainty will always identify its estimation method and be checked against observed error.

## Roadmap

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Physics foundation and polished visual sandbox | Implemented and verified |
| 2 | Dataset engine, splits, normalization, data explorer | Implemented and verified |
| 3 | Object encoder, MLP / GRU, training and validation | Next |
| 4 | Learned rollout, ghost futures and prediction error | Planned |
| 5 | Interventions, branch trees and comparative futures | Planned |
| 6 | Transformer, object attention and uncertainty | Planned |
| 7 | Model comparison, OOD suites and batch reports | Planned |
| 8 | Planning through learned model rollouts | Planned |

## Limitations

Local prototype: no accounts, remote hosting or persistent session database. Dataset collection uses a separate process. Browser snapshots are limited to eight and can be cleared by browser storage reset; export important experiments. Recordings stop at 120 simulated seconds, scenes support 64 objects and experiments 512 edits. Seeks replay from the start. Use ordinary speeds and avoid heavy initial overlaps. The procedural dataset is a bounded research baseline, not proof of generalization or numerical fidelity at extreme speed. 3D, ML, training, branching, model comparison and uncertainty remain later work. Both reports record actual verification coverage.

## Research questions

1. How accurately can a learned model predict short-horizon dynamics?
2. How quickly does autoregressive rollout error accumulate?
3. Does it generalize to unseen masses and velocities?
4. Does it generalize to more objects and new obstacle arrangements?
5. Which architecture best captures interacting-object dynamics?
6. Does estimated uncertainty correlate with actual prediction error?
7. Can learned rollouts support planning with real-world verification?
