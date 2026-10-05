# Stage 3 — Learned World Model

Verified locally on 2026-10-05. Branch: `feature/learned-world-model`.

## Delivered

- Real PyTorch object-centric MLP and GRU baselines with a shared object encoder, masked scene context, learned motion residuals and contact-onset logits.
- Checksum-verified temporal windows, variable object counts, static context masks and strictly separated train / validation / test / OOD ownership.
- Seeded AdamW training, validation-selected best weights, measured epoch logs, checkpoint integrity checks and exact CPU resume in the verified runtime.
- One-step and free autoregressive evaluation at 1 / 5 / 10 / 20 / 50 observed steps, physical-unit metrics and an explicitly analytical constant-velocity reference.
- A checkpoint-backed `DynamicsModel` adapter that returns learned frames and never invokes physics.
- Research training controls, actual progress, loss curves, held-out groups, numeric horizon charts, checkpoint provenance and JSON evaluation export. One isolated interactive worker with a shared lock; no PyTorch import in the API process.

Important modules: `backend/oracle/models/`, `training/`, `train.py`, `evaluate.py`, `backend/tests/test_training.py`, `frontend/src/research/TrainingDashboard.tsx`, `training.ts` and `training.css`. [Training specification](docs/TRAINING.md) and [requirements](docs/STAGE_3_REQUIREMENTS.md) describe the contracts.

## Actual training evidence

Both formal baseline runs use the existing Stage 2 dataset `ds-2cda3301ce8c3c5c`: 64 episodes, 24 train / 8 validation / 8 test / 24 OOD, 480 solver ticks per episode, stride four (30 Hz observed frames). Dataset SHA-256 is `900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e`; normalizer SHA-256 is `05dd444ab5b6f63715253de5e40c6e714bc08cd111f9891d6544dd2e1ec693fb`.

Recipe: seed 7, 35 epochs, four observed history frames, encoder / hidden size 64, batch 64, AdamW lr 0.001, contact weight 0.1, CPU / two threads. There are 2,808 train and 936 validation windows. Test / OOD results were computed after validation-only selection; these results did not tune or select the model.

Runtime: Python 3.12.14, PyTorch 2.14.1+cpu, NumPy 2.5.2, Windows / AMD64. CUDA was unavailable. Elapsed training-engine times include verification, training and held-out evaluation, and exclude importing PyTorch / worker startup.

| Run | Parameters | Best validation epoch | Best validation objective | Train objective, epoch 1 → 35 | Engine elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| MLP | 43,144 | 22 | 0.143539 | 0.180126 → 0.113440 | 9.773 s |
| GRU | 43,400 | 28 | 0.140023 | 0.179304 → 0.114983 | 15.137 s |

Local best-weight hashes:

- MLP: `f0a01d528ba51455896ee221595c39087d3b7b2e411deed73a61ee815ef123d4`
- GRU: `af4edee75ab667fc7b920347bfc7f09ca0c3044d95a5cebea792e66870d67d2a`

These artifacts remain in ignored `checkpoints/stage3-mlp/` and `checkpoints/stage3-gru/`; generated weights and data are not committed. A fresh checkout reproduces the dataset and training using documented commands. Hashes identify this run, not a promise of identical serialized file bytes on another machine.

## Held-out test results

One-step metrics score all test windows; rollouts use 24 deterministic anchors across eight test episodes. Fifty observed steps equal 1.667 seconds. Position / velocity MSE average the two components; ADE / FDE measure Euclidean displacement in metres.

| Model | Position MSE, m² | Velocity MSE, (m/s)² | Rotation MAE, rad | One-step contact balanced accuracy | FDE 10, m | ADE 50, m | FDE 50, m |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 0.000474 | 1.643288 | 0.003601 | 50.0% | 0.702041 | 3.441830 | 7.803390 |
| MLP | 0.003394 | 0.848850 | 0.040865 | 70.2% | 0.793328 | 1.978849 | 3.406891 |
| GRU | 0.001882 | 0.830860 | 0.033474 | 71.4% | 0.596145 | 1.544273 | 2.803174 |

The learned models improve test velocity error and 50-step displacement compared with this limited reference. GRU also improves 10-step FDE. Both have worse one-step position and rotation error than constant velocity; MLP also has worse 10-step FDE. Lower validation objective is not evidence that every physical metric improves. Long-horizon errors of several metres remain material in a 24 × 14 m world.

## OOD results

Each suite uses four independently seeded episodes and 12 matched rollout anchors. These are single-seed baseline measurements, not confidence intervals or an exhaustive model comparison.

| Initial-condition shift | MLP velocity MSE | GRU velocity MSE | CV velocity MSE | MLP FDE 50, m | GRU FDE 50, m | CV FDE 50, m |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Unseen mass | 1.089168 | 1.138438 | 1.932783 | 3.477011 | 3.641327 | 7.733612 |
| Unseen velocity | 35.088837 | 2.472380 | 2.234217 | 5.409153 | 4.217970 | 10.944694 |
| Unseen angle | 0.756838 | 0.769908 | 1.475978 | 2.494521 | 2.039231 | 5.576012 |
| More objects | 1.004666 | 0.843386 | 1.634051 | 3.197566 | 2.401503 | 7.412866 |
| More obstacles | 1.078840 | 1.084874 | 1.531818 | 3.001603 | 2.713790 | 7.396868 |
| Held-out mass–speed combination | 0.887079 | 0.783537 | 1.644846 | 3.415976 | 3.212040 | 8.393418 |

The unseen-velocity suite exposes a major MLP failure: one-step velocity MSE reaches 35.09 versus the reference's 2.23. GRU also loses to that reference on this metric. Better 50-step displacement against a baseline that omits gravity does not establish robust extrapolation or accurate collision reasoning. The UI retains these poor results and undefined classification scores without hiding them.

## Inference timing

A local CPU microbenchmark used one test scene with 12 total objects, four history frames, two PyTorch threads, 20 warmups and 200 measured `no_grad` forward passes. Median / p95 were 0.160 / 0.183 ms for MLP and 0.288 / 0.414 ms for GRU. This measures only network forward execution; it excludes encoding, artifact loading, rollout loops, HTTP and rendering. It is not an end-to-end or cross-hardware latency guarantee.

## Automated validation

- **90 backend tests passed**: 69 existing regressions plus 21 Stage 3 cases. New tests exercise episode / split ownership, static and padding masks, object permutation equivariance, real parameter updates for both models, deterministic repeat and exact resume, preservation on invalid resume, artifact corruption / metadata / identity / finite checks, learned-output feedback without physics, metric units and periodic rotation, omitted horizons, repeated CLI evaluation, real API workers, concurrency, file locks, failed launch handling and withholding old evaluation while resuming.
- **31 frontend tests passed**, including ten training configuration / metric presentation / horizon matching cases.
- Ruff lint and formatting passed. ESLint and Prettier passed. Strict TypeScript and Vite production build passed. Splitting Research removed the introduced chunk-size warning: initial Lab application JS is about 336 kB, Research about 401 kB before compression.
- `pip check` passed. A separate API import probe confirmed that `torch` is absent from its imported modules.
- GitHub Actions now installs locked CPU ML dependencies for both Linux and Windows backend jobs. Hosted CI outcomes are available on the Stage 3 PR; local Windows checks do not substitute for those results.

One existing Starlette warning remains: its TestClient deprecates the pinned `httpx` path. Tests pass; upgrading the HTTP test stack should be a separate dependency task rather than an unrelated Stage 3 change.

## Manual verification

The local dev build and production preview were exercised in the in-app browser. Verified MLP / GRU run selection, real worker launch, initial blank metrics, live status / progress, completed evaluation, invalid seed errors, held-out group selection, 50-step OOD evaluation, checkpoint provenance and JSON export. An additional GRU UI run used seed 11 / 35 epochs, and the final production flow launched MLP seed 13 / four epochs; these are manual integration evidence, not substituted formal baseline results.

Checked **1440×900** and **1920×1080**. The three desktop columns remain separate, Research has no horizontal overflow, and its vertical scroll reveals the lower evaluation / checkpoint sections above the footer. Browser error / warning logs were empty in the production Research flow. Desktop screenshots are stored for review:

![Training at 1440×900](docs/screenshots/stage3-training-1440.jpg)

[1920×1080 training](docs/screenshots/stage3-training-1920.jpg) · [OOD / 50-step evaluation at 1440×900](docs/screenshots/stage3-evaluation-1440.jpg)

## Remaining boundaries

The small procedural dataset, one-step objective and pooled scene context limit generalization and contact reasoning. Larger datasets, multi-step objectives and relational architectures should be evaluated as separate research changes, retaining disjoint test / OOD ownership. No uncertainty method, CUDA validation, GPU speed claim or comprehensive mobile verification is included.

Checkpoint publication is atomic per file, not a multi-file transaction. UI cancellation / resume and automatic repair of abruptly abandoned worker status are future robustness work; CLI resume is available. One shared gravity environment is supported per collection. The Lab still has no connected prediction layer: ghost trajectories and per-object predicted-versus-actual visualization are Stage 4. Physics, datasets and replay remain compatible with Stages 1–2.

Proposed PR title: **feat: implement Stage 3 learned world models and training dashboard**.
