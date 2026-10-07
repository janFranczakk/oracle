# ORACLE 1.0

## Scope

FINAL VALIDATION & RELEASE closes the existing Stages 1–8. No Stage 9, new model
family, physics engine, uncertainty technique or planning algorithm was introduced.
The pass adds bounded intervention evaluation, repeated training-seed evidence,
five real browser integration flows, targeted frontend refactoring and a protected demo.
Implementation is reviewed on `release/oracle-1.0`; `main` is not merged automatically.

## Architecture

Python owns Pymunk reality, datasets, training, inference and experiment state.
React/Pixi only render observations and returned futures. Versioned world, checkpoint,
counterfactual and planning contracts remain compatible. The benchmark reuses the
existing source capture, pure materialization, conditioned inference and reality worker;
multi-seed orchestration calls the existing trainer unchanged.

`ORACLE_DATA_ROOT` isolates generated artifacts without changing the code/subprocess
working directory. New family-report endpoints are read-only, checksum verified and
bounded by file/catalog size. There is no API for launching either heavy CLI study.

The largest UI coordinators retain their state ownership. Extracted hooks own behavior;
view components own presentation; forecast rendering retains its cache and layer order.
Line counts describe scope, not a quality score:

| Coordinator | Before / after lines | Extracted responsibility |
| --- | ---: | --- |
| App.tsx | 951 / 708 | Dialog UI and focus lifecycle |
| counterfactual/CounterfactualLab.tsx | 961 / 835 | Branch tree, provenance, serial tasks and saved-plan lifecycle |
| research/DatasetExplorer.tsx | 779 / 510 | Recorded episode observation and distribution charts |
| research/TrainingDashboard.tsx | 718 / 493 | Held-out evaluation and chart theme |
| rendering/WorldViewport.tsx | 606 / 536 | Cached forecast drawing layer |

## Machine Learning

Object-centric PyTorch MLP/GRU/Transformer use the existing 22-feature input, dynamic
motion residuals, contact logits, train-only normalization and autoregressive rollout.
Each checkpoint is selected on validation loss alone. Test/OOD are scored only after
selection. The release does not tune hyperparameters against the reported test results
or select a best training seed. All checkpoints were trained on ordinary episodes;
counterfactual inputs still identify `intervention_trained: false`.

## Dataset

Full research evidence uses `ds-2cda3301ce8c3c5c`, seed 42: 24 train, 8 validation,
8 test and 4 episodes per each of six OOD suites (64 total), 480 solver ticks per
episode, stride 4. Physics is 120 Hz; model observations are 30 Hz. Episode seeds
and splits are disjoint; static context is excluded from fitting normalization.
OOD labels describe initial conditions, not every later state under gravity.

Dataset SHA-256:
`900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e`.
Normalizer SHA-256:
`05dd444ab5b6f63715253de5e40c6e714bc08cd111f9891d6544dd2e1ec693fb`.
Eight test episodes and four per OOD suite remain a small evidence base.

## Prediction

Lab forecasts consume actual history, verify checkpoint/data/clock provenance and
render violet learned futures separately from cyan Pymunk reference. Reference replay
is independent and freezes anchor conditions. Neither forecast cursor controls live
physics. Manual demo validation at t12, h5 measured ADE 0.318 m / FDE 0.496 m;
this is a functional smoke example, not research-quality model performance.
Edits and playback invalidate stale forecasts; those contracts remain covered by tests.

## Counterfactual Benchmark

Executed 24 deterministic new procedural worlds, seed 42, source anchor t60 (0.5 s),
baseline plus 17 requested interventions, h10/h50. This is 432 world/intervention
combinations: 390 evaluated and 42 explicitly unsupported. Repeating three models
and two horizons produces 2,592 case rows (2,340 scored, 252 unsupported), 108
model/intervention/horizon aggregates and 756 metric-summary CSV rows.
Fourteen worlds lack a movable/removable ramp; translation, rotation and removal each
score ten worlds. Missing cases are not replaced or counted as zero error.

Single seed-7 validation-selected reference checkpoints are MLP epoch 22, GRU epoch 28,
Transformer epoch 12; exact weight hashes are in the evidence manifest. No architecture
superiority claim follows from this particular benchmark. Maximum horizons are rolled
out once and prefixes are scored. Dynamic-object ADE/FDE, position/velocity MSE,
periodic rotation MAE, contact accuracy and defined balanced accuracy use existing
physical-unit metrics. Scene aggregates weight worlds equally and retain sample std,
median/min/max/count, actual intervention magnitudes, skips and per-case provenance.

At h50 (1.667 s), measured mean ADE / FDE:

| Intervention | Scenes / skipped | MLP ADE / FDE (m) | GRU ADE / FDE (m) | Transformer ADE / FDE (m) |
| --- | ---: | ---: | ---: | ---: |
| baseline | 24 / 0 | 2.0748 / 3.3724 | 1.5607 / 2.8757 | 1.8212 / 2.9438 |
| mass_0.75 | 24 / 0 | 2.0793 / 3.3774 | 1.5507 / 2.8545 | 1.8232 / 2.9452 |
| mass_1.25 | 24 / 0 | 2.0710 / 3.3705 | 1.5713 / 2.8923 | 1.8236 / 2.9599 |
| mass_2 | 24 / 0 | 2.0460 / 3.3462 | 1.6156 / 2.9585 | 1.8289 / 2.9907 |
| velocity_0.75 | 24 / 0 | 2.0322 / 3.3119 | 1.5015 / 2.7477 | 1.7680 / 2.8777 |
| velocity_1.25 | 24 / 0 | 2.1232 / 3.3817 | 1.5924 / 2.8634 | 1.8762 / 2.9718 |
| velocity_1.5 | 24 / 0 | 2.1654 / 3.4804 | 1.6295 / 2.9057 | 1.9231 / 3.0444 |
| velocity_direction | 24 / 0 | 2.1564 / 3.3796 | 1.6621 / 2.8847 | 1.9914 / 3.0523 |
| friction_down | 24 / 0 | 2.0574 / 3.3720 | 1.5359 / 2.8150 | 1.8174 / 2.9716 |
| friction_up | 24 / 0 | 2.0853 / 3.3882 | 1.5530 / 2.8254 | 1.8135 / 2.9428 |
| restitution_down | 24 / 0 | 2.0130 / 3.2575 | 1.5289 / 2.8088 | 1.7839 / 2.8626 |
| restitution_up | 24 / 0 | 2.1299 / 3.4764 | 1.5988 / 2.9787 | 1.8575 / 3.0408 |
| static_translate | 10 / 14 | 2.0542 / 3.4636 | 1.6381 / 2.8280 | 1.9733 / 3.2250 |
| ramp_rotate | 10 / 14 | 2.0593 / 3.5023 | 1.6629 / 2.9498 | 1.9825 / 3.2207 |
| static_add | 24 / 0 | 2.2021 / 3.5762 | 1.7302 / 3.1823 | 1.9399 / 3.1654 |
| static_remove | 10 / 14 | 2.1245 / 3.5642 | 1.6407 / 2.8634 | 2.0297 / 3.3745 |
| dynamic_duplicate | 24 / 0 | 1.9074 / 3.1640 | 1.5258 / 2.8042 | 1.7210 / 2.8648 |
| dynamic_remove | 24 / 0 | 2.1565 / 3.5043 | 1.5149 / 2.8246 | 1.9390 / 3.2311 |

Short unchanged-baseline FDE10 is MLP 0.8387 m, GRU 0.6107 m, Transformer 0.9123 m;
by h50 these rise to 3.3724 / 2.8757 / 2.9438 m. Modest mass/material changes often
retain roughly baseline average error. That alone does not establish learned causal
mass response: many sampled trajectories do not strongly identify such effects.
Static addition increases GRU FDE50 from 2.8757 to 3.1823 m; direction/geometry and
structural changes remain uncertain, with multi-metre endpoint error. Scene subsets
for geometry differ, so their averages cannot be treated as paired full-suite effects.

Prediction replays only known past observations before inference. A test forbids
`PhysicsEngine.step` during the learned forecast. Reality is executed afterwards.
The complete measured numeric metrics, source SHA and case SHA repeated exactly
across two local full runs; timings/report digests vary. Final run elapsed 121.3 s.

[All aggregate metrics and counts](docs/results/release-counterfactual.csv),
[exact provenance](docs/results/release-provenance.json). Full per-case reports are
local under ignored `experiments/release-counterfactual-final-24/`, reproducible with
the documented CLI. Bounds: ≤500 combinations, ≤100 worlds, ≤3 models, ≤120 future
observations, two CPU threads, 100M estimated body-steps, cooperative deadline ≤3600 s.
Deadlines are checked between cases, not a hard OS interrupt inside inference.

## Multi-Seed Results

Executed all fifteen 35-epoch runs: seeds 1–5 for each existing family, fixed dataset,
history 4, embedding/hidden 64, batch 64, AdamW lr 0.001, contact weight 0.1,
CPU/two threads and horizons 1/5/10/20/50. Every group uses verified identical target
and anchor schedule hashes. Elapsed 722.4 s. Runs selected these validation epochs:
MLP 16/24/20/22/12; GRU 25/34/27/32/32; Transformer 18/17/14/15/9.

| Family (n=5) | Test ADE50 mean ± std (m) | Test FDE50 mean ± std (m) | 95% mean CI (m) | OOD macro FDE50 mean ± std (m) |
| --- | ---: | ---: | --- | ---: |
| MLP | 1.7915 ± 0.2197 | 3.1755 ± 0.3789 | [2.7051, 3.6459] | 3.5834 ± 0.8091 |
| GRU | 1.6994 ± 0.0586 | 3.0617 ± 0.1747 | [2.8449, 3.2786] | 3.1496 ± 0.1280 |
| TRANSFORMER | 1.9047 ± 0.1323 | 3.2409 ± 0.2612 | [2.9166, 3.5652] | 3.2901 ± 0.1671 |

| Family | Test FDE50 median | Min / max | OOD macro median | Min / max |
| --- | ---: | ---: | ---: | ---: |
| MLP | 3.0423 | 2.8516 / 3.7792 | 3.2088 | 2.9415 / 4.8242 |
| GRU | 3.0304 | 2.8420 / 3.3177 | 3.2093 | 2.9362 / 3.2586 |
| TRANSFORMER | 3.3019 | 2.9214 / 3.5965 | 3.3296 | 3.0672 / 3.5164 |

| Family | One-step position MSE mean ± std (m²) | One-step balanced contact accuracy | h50 balanced contact accuracy |
| --- | ---: | ---: | ---: |
| MLP | 0.003052 ± 0.000708 | 0.6970 ± 0.0105 | 0.5480 ± 0.0574 |
| GRU | 0.002515 ± 0.000376 | 0.6985 ± 0.0074 | 0.4907 ± 0.0503 |
| TRANSFORMER | 0.003230 ± 0.000377 | 0.6922 ± 0.0111 | 0.4810 ± 0.0353 |

Sample std uses ddof=1. The two-sided 95% interval for the **mean across training seeds**
is `mean ± t(.975,n−1) × s/√n` (n=5, df=4, t=2.776445). It assumes independent
seed repeats and approximately normal metrics conditional on this fixed dataset/recipe;
five repeats provide weak evidence. It is not an interval for future trajectories.
One repeat has no sample std/CI; undefined metrics remain missing. OOD macro FDE
first averages six suites within each seed, then aggregates the five independent repeats.

The test mean intervals overlap. GRU has lower observed mean FDE in this fixed study,
but there is no general family superiority or significance conclusion. Long-horizon
contact balanced accuracy is approximately chance for GRU/Transformer, an additional
failure beyond position drift. [All metric statistics](docs/results/release-seeds.csv)
retain mean/std/median/min/max/n/missing and mean CI; the Research family view reads
the same completed report rather than combining arbitrary single checkpoints.

## Uncertainty

MC-dropout 5–95% marginal position quantiles remain **uncalibrated**. No replacement
technique or calibration fit was added. Existing Stage 6 Transformer test h50 coverage
is x 2.27%, y 11.36%, joint 0%, with mean widths 0.4015 / 0.3595 m: severe undercoverage.
The dashboard still exposes those negative results. These are stochastic model-spread
quantiles, not a calibrated 90% confidence interval. Seed-study mean CIs measure a
different quantity and do not repair prediction calibration.

## Planning

Existing planning ranks baseline plus eight velocity offsets with deterministic learned
rollouts, then separately executes its fixed winner in Pymunk. It remains one-shot
search over nine actions, not a global planner, RL, sequential MPC or an optimal policy.
Other actions are not physically reranked. Manual h50 verification after a small live
mass edit selected action-08: predicted goal distance 3.802 m, actual 2.547 m,
target FDE 4.760 m, goal tolerance 0.5 m **not reached**. Editing goal x12→13 hid both
measurements, ranking and old trajectories, and disabled reality until a matching search.

## Testing

Local full backend: **185 passed**, including release metadata/OpenAPI consistency,
real tiny training/benchmark/seed studies,
artifact protection, deterministic provenance, missing metrics, isolation and existing
Stages 1–8 regression tests. Ruff check, Ruff format (87 files), `pip check` pass.
One existing Starlette/httpx deprecation warning remains visible; no failing test is hidden.
Frontend: frozen lockfile install, **89 Vitest tests**, ESLint, Prettier, strict app
TypeScript, strict E2E TypeScript and production Vite build pass.

All seven required workspaces plus Family comparison were manually exercised in the
production preview at **1440×900 and 1920×1080**. No horizontal document overflow or
visible fatal alert occurred; captured console errors/warnings were empty. Inspector
and Research scrolling remain usable within their panels. Scene dialog closes with Escape
and restores focus. [Manual matrix and screenshots](docs/RELEASE_BROWSER_QA.md).

## CI

The workflow retains Backend (ubuntu-latest), Backend (windows-latest), Frontend and
adds a separate **Browser E2E** job. Locked dependencies, pinned Actions and read-only
repository permissions remain. CI uses tiny real fixtures; it does not run the full
five-seed study or 432-combination benchmark. Failed E2E retains traces/screenshots/HTML
for seven days. All four hosted jobs passed on candidate revision `c3cd483` in
[CI run 37653244527](https://github.com/janFranczakk/oracle/actions/runs/37653244527)
before version promotion. Backend package/API and frontend package/UI now identify
1.0.0. The release PR retains the same four required CI gates after this promotion;
current revision results are recorded on [PR #8](https://github.com/janFranczakk/oracle/pull/8).

## E2E

Five Chromium smoke flows use the actual API, Pymunk and a deterministic trained GRU:
Main Lab connection/pause/step/select/edit; separate learned/reference forecast;
source capture/mass branch/save/live-world preservation; real Research routes;
nine-action planning with stale evidence removed after goal edits. No model output is
mocked. Latest full 1.0.0 run: **5 passed, 13.0 s**. One worker, retry only in CI;
owned backend 8012/preview 4182, isolated `.run/e2e` artifact root, no reuse of user servers.
[Local commands and fixture contract](docs/DEMO_AND_E2E.md).

## Performance

Measured Windows Python 3.12.14 / Torch 2.14.1+cpu / NumPy 2.5.2: full intervention
suite 121.3 s; fifteen seed runs 722.4 s; six-run CLI seed smoke 2.3 s. These timings
include real replay/training/evaluation/report work and are local observations,
not portable speed guarantees. Latest Vite build: 5.37 s; largest JavaScript chunks
index 360.71 kB (gzip 112.71), lazy LineChart 360.75 kB (gzip 105.57), lazy Research
66.26 kB (gzip 19.35). Research remains lazy and no chunk warning occurred. No new
browser FPS, mobile, memory soak or CUDA performance claim is made.

## Reproducibility

[Fast demo / E2E](docs/DEMO_AND_E2E.md), [full reproduction](docs/REPRODUCTION.md)
and [bounded experiment methods](docs/RELEASE_EXPERIMENTS.md) provide exact commands.
New output directories are required; partial/failed runs are preserved with status.
Dataset/checkpoint/config/source/schedule hashes bind results. Experiment report SHA
includes runtime measurements, so a repeated report may have a different digest even
when numerical predictions match. Deterministic claims are limited to the verified
CPU/runtime/platform; no cross-OS bitwise equivalence is promised.
Committed CSV summaries and their hashes in the provenance manifest preserve measured
review evidence. Generated datasets, weight binaries, full local experiments, logs and
environments remain ignored. CSV exports escape spreadsheet formula strings.

## Known Limitations

- Small procedural dataset; one fixed dataset/recipe in seed study; only 24 intervention
  source worlds and ten eligible geometry cases. No broad intervention-distribution guarantee.
- Autoregressive drift, weak h50 contact predictions and uncertain structural generalization.
  Added bodies still use explicitly synthetic repeated anchor inputs.
- Uncalibrated dropout with severe undercoverage; no confidence/safety certification.
- Local-only app, session-scoped runtime state, bounded browser libraries; export important work.
- Cooperative experiment deadlines, fresh-process inference latency; CUDA/mobile unverified.
- Protected demo is deliberately tiny and often worse than the constant-velocity reference.
- Original five coordinators remain nontrivial; this pass extracts responsibilities rather than
  rewriting architecture. CI branch-protection policy is documented, not proof of enforced settings.

## Research Integrity

Pymunk output is never labeled learned output. Inference sees observed/conditioned history,
never the physical future. Selection remains validation-only. All seeds and missing/skipped
cases are reported; negative results stay visible. Family variation is not causal identification;
Counterfactual Lab is controlled intervention conditioning and simulator-backed evaluation,
not causal inference. Seed mean CIs are distinct from uncalibrated MC-dropout intervals.
Learned planning is bounded approximate action ranking, not global optimality.

## Demo

`python -m oracle.setup_demo` creates 14 real episodes (seed 2026, 120 ticks, stride 4)
and a three-epoch GRU (seed 17, history 4, embedding/hidden 32), then publishes verified
`datasets/oracle-demo` and `checkpoints/oracle-demo/best.pt`. Actual demo selected epoch 3.
Compatible completed output is verified/reused without writing; partial or incompatible
destinations are rejected. Windows wrapper `scripts/setup_demo.ps1` uses the repo venv;
cross-platform Python entry point is equivalent. The independent smoke profile creates
ten episodes and a one-epoch GRU in `.run/e2e` for CI. No binary is committed or uploaded
as a release asset. Prediction, Counterfactual and Planning use real demo weights.

## Final Status

The requested implementation, real studies, protected demo, targeted refactor and local
automated/manual regression gates are complete. All four hosted candidate CI jobs passed
before promotion to 1.0.0. Version gates and review evidence are linked through PR #8.
The project is ready as a functional, reproducible and honestly evaluated portfolio project:
it predicts short controlled trajectories, measures intervention errors and compares seeds;
multi-metre long forecasts, uncertain contacts, uncalibrated uncertainty and bounded planning
prevent claims of reliable general physics, causal understanding or global goal solving.
No Stage 9 was created; no automatic merge or release publication is performed.
