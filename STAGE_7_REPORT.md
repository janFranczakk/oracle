# Stage 7 report — Research platform

Stage 7 implements matched checkpoint comparisons, selectable test/OOD batches, persistent reports, JSON/CSV export and reversible checkpoint management. Work starts from reviewed Stage 6 commit `4090d8a` (PR #5), on `feature/research-platform`. [Requirements](docs/STAGE_7_REQUIREMENTS.md) · [Research protocol and reproduction](docs/RESEARCH.md).

## Implementation

- `backend/oracle/research/` owns bounded request schemas, the annotation registry, shared evaluation engine and subprocess supervision. `oracle.research_batch` provides the same engine to CLI callers.
- `training/evaluation.py` accepts an optional common history start. Its default retains previous single-model evaluation behavior. Different selected history lengths now share one-step targets and rollout anchors.
- `frontend/src/research/ComparisonDashboard.tsx`, `ComparisonResults.tsx`, `comparison.ts` and `comparison.css` add the fourth live Research tab: compatible checkpoint roster, controls, measured table/chart, persistent batch log, provenance and export.
- Version 0.7.0 identifies the new API/UI. Existing datasets, checkpoint metadata, both laboratories and earlier Research views retain their contracts. No new dependencies or lockfile changes.

Before evaluating, the worker verifies completed training, fixed weight hashes, exact dataset/normalizer/environment and observation-clock identity. All model/group results use shared schedule hashes. No training or physics evaluation is substituted for learned inference. Complete reports are published atomically; failed/interrupted work remains inspectable. API workers have a 15-minute deadline. Labels/pins/archive live separately from weights and do not remove models from either laboratory.

## Actual comparison

The production UI submitted `batch-fdcc13fb2fbd`: three existing checkpoints × held-out test and six OOD suites × horizons 1/5/10/20/50. All **21 model/group evaluations** completed in **4.8851 s** of engine elapsed time, excluding interpreter startup. The report is a local ignored artifact, not committed training data.

Dataset `ds-2cda3301ce8c3c5c`: seed 42, 24 train / 8 validation / 8 test / 4 episodes per OOD suite, 480 solver ticks per episode, stride 4, 30 Hz observations, gravity `(0, -9.81)`. Common history is four observations. Held-out test scored **936 shared one-step targets**, **24 rollout anchors** and **132 dynamic objects** at horizon 50. Each OOD suite has 468 one-step targets and 12 anchors; object counts differ across suites.

| Checkpoint | Parameters | Selected epoch | Seed | Test position MSE, m² | Test FDE +10, m | Test ADE +50, m | Test FDE +50, m | OOD macro FDE +50, m |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `stage3-mlp` | 43,144 | 22 | 7 | 0.003394 | 0.7933 | 1.9788 | 3.4069 | 3.4993 |
| `stage3-gru` | 43,400 | 28 | 7 | 0.001882 | 0.5961 | 1.5443 | 2.8032 | 3.0376 |
| `stage6-transformer` | 94,280 | 12 | 7 | 0.002964 | 0.8586 | 1.8431 | 3.2408 | 3.2424 |

OOD macro averages each selected suite's FDE equally. In this batch the GRU checkpoint has the lowest test and OOD macro FDE at +50. The Transformer has lower held-out-combination FDE (3.0281 m) than GRU (3.2120 m) and MLP (3.4160 m). Unseen-velocity +50 FDE is 5.4092 / 4.2180 / 5.2150 m respectively. Long-horizon and OOD drift remain substantial. These results do not establish architecture superiority or statistical significance: they evaluate one validation-selected checkpoint per family, with different parameter counts and selected epochs.

### Actual forward timing

| Checkpoint | Median, ms | Nearest-rank p95, ms |
| --- | ---: | ---: |
| MLP | 0.11425 | 0.12260 |
| GRU | 0.20225 | 0.20940 |
| Transformer | 0.40865 | 0.46980 |

Windows CPU, Python 3.12.14, PyTorch 2.14.1+cpu, two threads; batch 1, three warm-ups, ten calls on the same 12-object episode `test-in_distribution-00000-6d46660a`, anchor 3. Timing covers model forward only. Loading, I/O, startup, rollout and transport are excluded. Ten samples are descriptive and load-dependent; p95 here is the largest measured call.

### Artifact provenance

| Source | SHA-256 |
| --- | --- |
| Dataset content | `900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e` |
| Train normalizer | `05dd444ab5b6f63715253de5e40c6e714bc08cd111f9891d6544dd2e1ec693fb` |
| MLP weights | `f0a01d528ba51455896ee221595c39087d3b7b2e411deed73a61ee815ef123d4` |
| GRU weights | `af4edee75ab667fc7b920347bfc7f09ca0c3044d95a5cebea792e66870d67d2a` |
| Transformer weights | `cf168921303e3a9b95345f1ae1391aaf3812ceefc296ca335330bdcb8b804fcd` |

Re-running the fixed API request through CLI into `stage7-cli-repeat` reproduced all numeric group metrics and schedule hashes exactly in this runtime. Timing changed as expected. JSON downloaded from the browser equals the backend report. All **105 exported CSV rows** were checked against learned/reference metrics and source hashes. Full anchors and runtime are retained in JSON. Regenerating weights on another platform need not produce the same bytes or numeric results; see the Stage 3 / 6 recipes and [CLI protocol](docs/RESEARCH.md#cli-and-exports).

## Validation

- Backend: **156 tests passed**, including 15 research tests using real generated observations and trained MLP/GRU/Transformer weights. Differing histories 1/3/2 share exact targets/anchors/reference scores; repeated evaluation preserves numeric results. Tests also cover corruption and dataset mismatch, incomplete training, preserved output, single-worker lock, API publication/recreation, restart recovery, deadline termination, annotation persistence and traversal rejection.
- Ruff lint passed; formatting check passed for 64 files. One existing Starlette/httpx TestClient deprecation warning remains; no failed tests.
- Frontend: **74 tests passed**, including 11 comparison tests for configuration bounds, honest missing horizons, suite-level OOD aggregation and CSV values/escaping. ESLint, Prettier, strict TypeScript and production Vite build passed. Frozen dependency installation passed.
- Manual production-preview verification at **1440×900** and **1920×1080**: real batch submission/progress/completion; group and horizon changes; checkpoint label/pin/archive/restore; metadata and reports after reload; JSON/CSV download; invalid horizon rejection; incompatible dataset disables selection/launch and stays empty after refresh; selecting the same batch preserves its report. No page horizontal overflow or error alerts in the completed views.
- Earlier World model, Dataset engine and Lab views loaded during a browser spot check. Automated regression suites cover Prediction and Counterfactual behavior; Stage 7 does not repeat the complete Stage 4–6 manual scenario matrix.
- Hosted Linux backend, Windows backend and frontend CI are mandatory PR gates; their final results are recorded on the Pull Request. Local verification above is independent of hosted CI.

### Visual evidence

![Matched comparison at 1920×1080](docs/screenshots/stage7-comparison-1920.jpg)

[Comparison at 1440×900](docs/screenshots/stage7-comparison-1440.jpg) · [Unseen velocity chart, selected horizon +10 at 1440×900](docs/screenshots/stage7-ood-1440.jpg) · [Checkpoint label and reversible archival at 1920×1080](docs/screenshots/stage7-checkpoints-1920.jpg)

## Remaining limits and next work

This is a local, bounded research workflow: 2–4 checkpoints, up to eight horizons, one research worker per root, interactive datasets ≤256 episodes / ≤1200 ticks. The API watchdog applies to owned API workers; CLI checks the deadline between groups. File artifacts are not a transactional database, and archived models remain local. One pre-existing incompatible checkpoint entry was surfaced as unavailable during manual QA; its files were preserved.

Comparison is deterministic point evaluation. Multi-seed aggregation, confidence/significance tests, controlled training-budget studies, GPU/end-to-end benchmarks and calibration are future tasks. Stage 6 MC dropout remains explicitly uncalibrated. No mobile or exhaustive performance claim is made. Stage 8 planning through learned rollouts is the next separate feature, after review of this stage.
