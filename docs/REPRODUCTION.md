# Full research reproduction

Run all commands from the repository root unless a command changes directory.
The fast demonstration and real E2E fixture are in [Demo and E2E](DEMO_AND_E2E.md).

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
11. Open **Research → World model**, choose MLP, GRU or Transformer, a dataset, training seed, epoch count and observed history. **Train world model** launches real optimization in a separate worker.
12. Inspect logged losses and the validation-selected checkpoint. Choose test / OOD groups and rollout horizons, compare with the constant-velocity reference, and export evaluation JSON.
13. Return to **Lab → Prediction**, select a completed model and pause the world. **Record observations** collects the real history needed by its sampling clock.
14. Choose the horizon and **Predict future**. Scrub the separate forecast, compare violet learned ghosts / cyan Pymunk actual, select a body and inspect measured errors. Expand **Forecast settings** to change model / horizon; export the actual report JSON. Edits, seeks and real playback clear stale predictions.
15. Open **Counterfactual**, record any missing real history and **Capture source**. Choose a body, preview an intervention and **Save alternative**. Select a parent before creating a child; all changes use the original observed anchor.
16. **Predict future** uses real model weights. **Run reality** separately executes the branch in Pymunk. Compare alternatives or predicted / actual using overlay / split and the shared cursor. Save plans locally or export the full JSON report. Imported plans are replay-validated and require fresh computed futures.
17. Open **Research → Checkpoint comparison**, select 2–4 completed checkpoints from the same dataset and choose test/OOD groups and observed horizons. **Run matched batch** scores identical targets/anchors, records real CPU forward timing and preserves its report in the batch log. Switch groups/horizons and export JSON/CSV. Inspect a checkpoint to label, pin or reversibly archive it from comparison selection.
18. Open **Planning**, pause the live world and record any missing real history. Choose a dynamic body, terminal position goal/tolerance, completed model, observed horizon and velocity grid step. **Search learned futures** ranks the unchanged baseline and eight offsets using learned rollouts only. **Run reality** separately measures the fixed winner; inspect both goal distances and target FDE, scrub the sampled future and export the report. Expanding **Goal & search settings** lets you change the goal; changed settings hide previous measurements until a matching search is available.

## Installation

Requirements: Python 3.12+, Node.js 22.12+ (verified with 24.19), pnpm (verified with 11.25). Commands below are PowerShell, from the project root. Python 3.12 was used for verification.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
.\.venv\Scripts\python.exe -m pip install --no-deps -e ./backend
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-ml.lock.txt
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
.\.venv\Scripts\python.exe -m pip check
cd frontend
pnpm test
pnpm run lint
pnpm exec prettier --check src e2e playwright.config.ts
pnpm exec tsc --project tsconfig.e2e.json
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

Splits are assigned before simulation and remain disjoint at episode / seed level. OOD suites cover unseen mass, velocity, orientation, object count, obstacle count and a reserved mass–speed combination. OOD refers to **initial conditions**; later velocities can exceed those ranges under gravity. [Dataset format, boundaries and feature encoding](DATASETS.md).

## Training

```powershell
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/mlp --model mlp --epochs 35
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/gru --model gru --epochs 35
```

Defaults: CPU, two threads, history four observed frames, 64-dimensional embeddings / hidden state, AdamW lr 0.001, batch 64. `best.pt` is selected by validation alone; `last.pt` contains optimizer / RNG state for exact resume in the verified CPU runtime. Every checkpoint binds dataset hashes, architecture, normalization, gravity and observation clock. [Configuration, resume, artifact layout and bounds](TRAINING.md).

## Evaluation

```powershell
.\.venv\Scripts\python.exe -m oracle.evaluate checkpoints/gru/best.pt --dataset datasets/demo --output experiments/gru-evaluation.json
```

Report one-step position / velocity MSE, periodic rotation MAE, contact classification and autoregressive ADE / FDE at 1 / 5 / 10 / 20 / 50 observed steps. Validation, test and six OOD suites stay separate. The same samples also score a named constant-velocity analytical reference. No confidence estimates are invented. [Measured results and limitations](../STAGE_3_REPORT.md).

For matched multi-checkpoint evaluation, use **Research → Checkpoint comparison** or:

```powershell
.\.venv\Scripts\python.exe -m oracle.research_batch --dataset datasets/demo --checkpoint checkpoints/mlp/best.pt --checkpoint checkpoints/gru/best.pt --output experiments/research/comparison-demo
```

The common observation start uses the longest selected history. Reports retain exact anchors, supported/omitted horizons, hashes, measured CPU timing and separate test/OOD results. [Research protocol, worker bounds and exports](RESEARCH.md) · [Actual Stage 7 results](../STAGE_7_REPORT.md).

## Experiments

The shared headless simulation path works without a browser:

```powershell
.\.venv\Scripts\python.exe -m oracle.experiment --seed 42 --scene incline --steps 600 --output experiments/example.json
.\.venv\Scripts\python.exe scripts/benchmark.py
```

An experiment contains schema and engine versions, a null model version, timestamp, seed, complete environment and initial object definitions, ordered edit events, playhead and recorded duration. Import reconstructs the solver history and restores a paused playhead. Equal runs are tested on this platform and pinned Pymunk version; bitwise identity across versions / operating systems is not guaranteed.

## Release studies

Add the third existing family using the same dataset/configuration:

```powershell
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/transformer --model transformer --epochs 35
.\.venv\Scripts\python.exe -m oracle.counterfactual_benchmark --checkpoint checkpoints/mlp/best.pt --checkpoint checkpoints/gru/best.pt --checkpoint checkpoints/transformer/best.pt --scenes 24 --seed 42 --anchor 60 --horizons 10 50 --output experiments/reproduction-counterfactual-24
.\.venv\Scripts\python.exe -m oracle.multiseed --dataset datasets/demo --seeds 1 2 3 4 5 --output experiments/multiseed/reproduction-five-seeds
```

Use a new output name for every run. The full fifteen-training study belongs in local
research, not CI. [Methods and work bounds](RELEASE_EXPERIMENTS.md) and
[measured release results](../RELEASE_1_0_REPORT.md) retain negative outcomes.
Family comparison reads the completed multi-seed output after **Refresh seed studies**.
