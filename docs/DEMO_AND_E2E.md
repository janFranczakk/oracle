# Demo and browser integration

Run commands from the repository root. Install locked Python/CPU ML and frontend
dependencies using [Quick Start](../README.md#quick-start--fast-demo).

## Protected real demo

```powershell
.\.venv\Scripts\python.exe -m oracle.setup_demo
# Equivalent Windows wrapper:
./scripts/setup_demo.ps1
```

Cross-platform entry point: `python -m oracle.setup_demo` in the active venv.
Default dataset: seed 2026, train/validation/test = 4/2/2, one episode for each of
six OOD suites, 120 solver ticks, stride 4. Actual model: GRU, seed 17, history 4,
embedding/hidden 32, three epochs, CPU/two threads, evaluation horizons 1/5/10/20.
Destinations: `datasets/oracle-demo` and `checkpoints/oracle-demo/best.pt`.
The model uses existing validation selection, never test/OOD selection.

Both destinations are verified before new work. Complete compatible artifacts are
reused without writing. Partial, incompatible or orphan checkpoint output is rejected;
existing files remain intact. Choose another `--root` for a conflicting destination.
Failures preserve partial evidence; they are not silently erased/resumed. The demo is
intentionally small and may be worse than constant velocity; it exercises real inference.

Two-terminal startup works on every supported Python/Node host:

```text
python -m uvicorn oracle.api:app --host 127.0.0.1 --port 8011
pnpm --dir frontend run dev
```

Open `http://127.0.0.1:5181`. Production: `pnpm --dir frontend run build`, then
`pnpm --dir frontend run preview` at port 4181, with backend still running.
For a custom artifact root, set `ORACLE_DATA_ROOT` for setup and backend; it changes
dataset/checkpoint/research/forecast storage, not source or subprocess cwd.

## Five real Playwright flows

```powershell
.\.venv\Scripts\python.exe -m oracle.setup_demo --root .run/e2e --profile smoke
pnpm --dir frontend run build
pnpm --dir frontend exec tsc --project tsconfig.e2e.json
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend run test:e2e
```

Linux CI installs Chromium with `playwright install --with-deps chromium`.
Windows defaults to `.venv/Scripts/python.exe`; elsewhere the active `python` is used.
Set `ORACLE_PYTHON` for another compatible interpreter. Locked test dependencies:
`@playwright/test` 1.63.0 and Node types 24.19.1.

Smoke fixture: ten episodes (train/val/test = 2/1/1 plus six OOD), 40 ticks,
seed 2026, stride 4; real one-epoch GRU, seed 17, history 2, embedding/hidden 16,
CPU/two threads and horizons 1/3/5. Distinct `oracle-e2e` paths are under ignored
`.run/e2e`, preserving user datasets/checkpoints.

Playwright owns backend 8012 and built preview 4182, refusing to reuse existing servers.
Stop a previous owned test rather than replacing an unrelated service. Normal dev
backend 8011/UI 5181 remain separate. Vite supports validated optional `ORACLE_API_PORT`.
One Chromium worker uses software WebGL, 1440×900, bounded timeouts and one CI retry.

1. Main Lab: real connection, pause/step, selection, mass edit and backend state.
2. Prediction: actual history/checkpoint inference, separate learned/reference frames,
   unchanged live world; no fake model or simulator output labeled prediction.
3. Counterfactual: source, mass intervention, immutable saved branch, unchanged live world.
4. Research: actual dataset/training/checkpoint/family routes and no fatal browser error.
5. Planning: nine learned candidates; goal edits hide stale evidence and disable reality.

Tests listen for page errors. Failures retain trace/screenshot and HTML report in ignored
`frontend/test-results` / `playwright-report`. Local viewer:
`pnpm --dir frontend exec playwright show-report`. CI uploads failure evidence for
seven days. Full release studies stay outside CI; backend tests use bounded tiny studies.

## Additional CLI smoke checks

After preparing demo, use new output names:

```powershell
python -m oracle.counterfactual_benchmark --checkpoint checkpoints/oracle-demo/best.pt --scenes 1 --anchor 12 --horizons 3 --interventions baseline mass_2 velocity_1.5 --output experiments/benchmark-smoke
```

Save plain `TrainConfig` JSON to a local ignored configuration file:

```json
{"epochs":1,"model":{"history":2,"embedding":16,"hidden":16},"threads":1,"horizons":[1,3]}
```

```powershell
python -m oracle.multiseed --dataset .run/e2e/datasets/oracle-e2e --seeds 1 2 --config smoke-config.json --output experiments/multiseed/smoke
```

Six tiny real trainings; their accuracy is not full research evidence.
