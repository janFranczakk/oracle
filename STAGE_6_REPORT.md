# Stage 6 report — Advanced world models

Implemented on `feature/advanced-world-models`, from reviewed `origin/main` (`8f373ed`, merged Stage 5 PR). Requirements: [Stage 6](docs/STAGE_6_REQUIREMENTS.md). Contract and reproduction: [Advanced models](docs/ADVANCED_MODELS.md). Application version: 0.6.0.

## Delivered behavior

- A real PyTorch Transformer relates objects through masked multi-head attention and combines their observed history through temporal attention. Static context and permutation equivariance are preserved; legacy MLP/GRU weight layouts are unchanged.
- Bounded, seeded MC dropout follows independent autoregressive learned paths. Reports expose actual position mean, sample standard deviation and 5th/95th marginal quantiles in metres, with checkpoint/data/sampling provenance. No physics or output-noise injection creates the distribution.
- Research displays test/OOD interval coverage and width beside deterministic errors. Prediction Lab and Counterfactual Lab render quantile rectangles, inspect selected-body spread and show actual anchor attention weights. Those weights are not causal explanations.
- Deterministic forecasts remain the point predictions. Counterfactual interval measurements appear only after matching explicit Pymunk reality execution. Existing source, journal, branch, replay and export behavior remains available.
- Automatic `uncertainty.json`, optional CLI `oracle.evaluate --uncertainty`, browser exports, configuration bounds, work caps, finite-value checks and failure cleanup are implemented.

Key modules: `models/attention.py`, `models/sampling.py`, `models/inference.py`, `training/uncertainty.py`, `prediction/uncertainty.py`, existing forecast workers and branch comparison store; frontend `ModelDiagnostics.tsx`, interval renderer, training dashboard and both laboratory panels.

## Real training and reproduction

Trained 35 epochs on the existing 64-episode dataset: 24 train / 8 validation / 8 test / 24 OOD, collection seed 42, 480 solver steps, stride 4 (30 Hz observations). Training seed 7; history 4; embedding/hidden 64; 4 heads; 2 temporal layers; dropout 0.10; AdamW lr 0.001; batch 64; CPU / 2 threads. Runtime: Windows, Python 3.12.14, PyTorch 2.14.1+cpu.

The model has **94,280 parameters**. Validation selected **epoch 12**, loss **0.1396542800**; test/OOD scores did not select weights or calibration. The complete training/evaluation run took 80.35 seconds on this local machine. No cross-machine performance or CUDA claim is made.

- Checkpoint SHA-256: `cf168921303e3a9b95345f1ae1391aaf3812ceefc296ca335330bdcb8b804fcd`.
- Dataset: `ds-2cda3301ce8c3c5c`, content SHA-256 `900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e`.
- Train normalizer SHA-256: `05dd444ab5b6f63715253de5e40c6e714bc08cd111f9891d6544dd2e1ec693fb`.
- A separate CLI evaluation reproduced both deterministic groups and the complete uncertainty report **exactly** in this runtime.
- Existing Stage 3 MLP/GRU checkpoints loaded without migration. Their original incline anchor-t12, 50-step measurements reproduced exactly: MLP ADE 2.6626606467 / FDE 4.8711935599 m; GRU ADE 2.2551665197 / FDE 4.1870189448 m.

Generated weights, datasets, run logs and JSON outputs remain ignored local artifacts. Reproduction commands are in the contract; repository evidence does not contain checkpoints or datasets.

## Held-out results

At 50 observation steps (1.667 seconds), dynamic bodies only. Three fixed eligible anchors per episode; 16 dropout paths per anchor. ADE/FDE score the deterministic forecast. Coverage and width score the MC distribution at the endpoint, not every preceding step. Nominal marginal coverage is 90%; simultaneous coverage has no 90% guarantee.

| Group | ADE / FDE m | CV FDE m | x / y coverage | Both covered | x / y width m | Objects scored |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Test | 1.8431 / 3.2408 | 7.8034 | 2.27% / 11.36% | 0.00% | 0.4015 / 0.3595 | 132 |
| Unseen mass | 1.7631 / 2.8373 | 7.7336 | 3.33% / 11.67% | 0.00% | 0.4233 / 0.2505 | 60 |
| Unseen velocity | 2.9721 / 5.2150 | 10.9447 | 4.76% / 11.11% | 1.59% | 0.4046 / 0.4998 | 63 |
| Unseen angle | 1.3965 / 2.4858 | 5.5760 | 5.56% / 1.85% | 0.00% | 0.3768 / 0.2466 | 54 |
| Unseen object count | 1.7117 / 2.9942 | 7.4129 | 5.30% / 9.85% | 0.76% | 0.3929 / 0.3362 | 132 |
| Unseen obstacles | 1.6667 / 2.8939 | 7.3969 | 4.76% / 10.71% | 0.00% | 0.3944 / 0.3987 | 84 |
| Held-out combination | 1.9841 / 3.0281 | 8.3934 | 3.17% / 11.11% | 0.00% | 0.3979 / 0.4255 | 63 |

**Severe undercoverage is a measured limitation.** Dropout spread is much narrower than model error. Even one-step test coverage is only 44.7% x / 35.6% y. These intervals must not be presented as reliable confidence or safety bounds. The constant-velocity baseline can outperform the learned model at shorter horizons (test h10 FDE 0.7020 versus 0.8586 m). No universal superiority or calibration is claimed.

## Automated validation

- Backend: **141 passed**, including attention padding/permutation/static context, nonzero attention gradients, actual weight optimization, exact Transformer resume, pre-Stage-6 MLP configuration resume, seeded sampling, RNG/mode restoration on success and failure, collapse of spread with zero motion weights, unsupported models/work bounds, marginal versus joint coverage, real worker exports and counterfactual measurement gating.
- Frontend: **63 passed**; legacy sampling remains disabled, seeds are validated, Transformer training config includes training-time dropout; previous forecast/branch/state/coordinate tests remain green.
- Ruff lint and formatting: passed (57 Python files). ESLint and Prettier: passed. Frozen pnpm lockfile install and `pip check`: passed. Strict TypeScript and production Vite build: passed.
- Final diff/credential/generated-file audit: passed. Dependency lockfiles and physics solver are unchanged.
- Hosted Linux backend, Windows backend and frontend checks are the final gate recorded on the Pull Request; local checks above are distinguished from hosted results.

Initial failures were resolved: the new synthetic normalization fixture had an incorrect provenance shape; two integration tests used a nonexistent store helper and assumed the old two-family catalog size. Sandbox temp/store restrictions were resolved by approved test/install execution outside the sandbox. The existing Starlette/httpx TestClient deprecation warning remains an unrelated dependency follow-up.

## Manual verification

Verified the production build at **1440×900** and **1920×1080**. Panels stay inside their boundaries with no document horizontal overflow; attention tables scroll internally. Learned quantile rectangles, deterministic ghosts and independent Pymunk futures retain distinct meaning. Selected-body spread follows the cursor, while attention remains tied to the observed anchor. No independent browser physics was added.

The real incline forecast at t12, seed 7, 16 paths and 50 steps produced ADE **2.263233 m**, FDE **4.000432 m**. Across 200 dynamic object/step observations, marginal coverage was **23.5% x / 12.0% y**, simultaneous coverage **1.0%**, mean interval width **0.304504 / 0.443173 m**. The downloaded browser JSON matched separately repeated trained inference, attention, metrics and distribution exactly.

Restored the saved five-branch Stage 5 plan through replay validation. `Mass ×2` with the Transformer showed sampling diagnostics without coverage before execution. A separate **Run reality** added measured coverage: **22.0% x / 10.0% y**, simultaneous **0.5%** across 200 observations; ADE **2.482776 m**, FDE **5.155319 m**. Split and overlay views retain sampled clocks and source t12. The downloaded report's interval measurement was independently recomputed exactly from its distribution and Pymunk frames.

Research displays validation selection, real losses, test/OOD interval tables and checkpoint provenance. Its downloaded evaluation JSON matched the independent CLI report exactly, including uncertainty and provenance. A one-epoch seed-19 Transformer run (`run-498c65e09e70`) completed through the UI, including deterministic and uncertainty evaluation, in 38.71 seconds. This smoke run is separate from the 35-epoch reported checkpoint.

Evidence: [Prediction 1440](docs/screenshots/stage6-prediction-1440.jpg), [attention 1920](docs/screenshots/stage6-attention-1920.jpg), [counterfactual 1440](docs/screenshots/stage6-counterfactual-1440.jpg), [counterfactual 1920](docs/screenshots/stage6-counterfactual-1920.jpg), [Research 1440](docs/screenshots/stage6-research-1440.jpg), [Research 1920](docs/screenshots/stage6-research-1920.jpg).

## Remaining boundaries

This is an object-state research model trained on a small controlled dataset. It does not estimate aleatoric noise, fit a likelihood, calibrate intervals, certify distribution membership or establish causal interpretation of attention. Counterfactual conditioning still uses ordinary-episode models and is exploratory. More data, intervention training and validation-only calibration should be separate research work; test/OOD evidence must stay untouched by fitting. CPU deadline/work bounds can reject large forecasts. Only the documented desktop viewports and CPU runtime were verified.

Branch: `feature/advanced-world-models`. Pull Request title: **feat: add Transformer dynamics and measured dropout uncertainty**. Stage 7 is not included; integration remains subject to review and CI.
