# Stage 8 report — Learned rollout planning

Stage 8 adds a terminal position goal, nine candidate velocity actions, learned rollout ranking and separate physical verification of the fixed winner. Work starts from reviewed Stage 7 commit `5730d30` (PR #6), on `feature/learned-rollout-planning`. [Requirements](docs/STAGE_8_REQUIREMENTS.md) · [Protocol, API and reproduction](docs/PLANNING.md).

## Implementation

- `backend/oracle/planning/` owns strict goal/request schemas, pure action generation, deterministic learned search, owner-scoped report storage and explicit reality measurement. `oracle.plan` provides portable CLI reproduction and separate reality execution.
- The existing Prediction supervisor adds a Planning worker entry point; Prediction, Counterfactual and Planning share its lock, 45-second deadline and input/output bounds. API startup and reality-only execution remain Torch-free.
- `frontend/src/planning/` adds a dedicated workspace: goal preview, checkpoint selection, real-history preparation, returned candidate ranking, exact sampled cursor, separate predicted/actual goal distances, provenance and report export. Goal/settings collapse after search; changed controls hide old measured evidence.
- `BranchViewport` gains optional goal and alternative-path layers using returned positions. Earlier callers retain their existing behavior. Version 0.8.0 identifies this stage. No new dependency, lockfile, dataset or checkpoint format change.

Search replays the known past once, validates compatible real history and completed checkpoint provenance, loads verified weights once with dropout disabled, and executes nine learned rollouts. It does not integrate any physical future before selection. Ties prefer smaller velocity change, then input order. Reality runs only after an explicit request, uses the fixed cached winner and cannot re-rank the candidates. Both operations preserve the live world.

## Actual planning experiment

The production UI searched existing `stage3-gru` weights from the seed-42 **incline** scene, paused at solver tick **12** (0.1 s), revision 0. Target `orb-01` starts the search at velocity `(2.4, -0.781)` m/s. Goal `(12, 3)` m, tolerance **0.5 m**, velocity grid step **3 m/s**, horizon **50 observations** at stride 4 / 30 Hz, or **1.6667 s** of future. The source contains ten objects, four dynamic. Model inputs are four real observations at ticks 0/4/8/12, with only terminal velocity overridden per candidate.

All nine candidates were scored by the real GRU checkpoint. Engine elapsed time was **0.25959 s**, excluding subprocess interpreter startup, HTTP transport and rendering. This is one observed local run, not a latency benchmark.

| Learned rank | Action | Absolute velocity, m/s | Predicted goal distance, m |
| ---: | --- | --- | ---: |
| 1 | `action-08` | `(5.4, 2.219)` | 3.800435 |
| 2 | `action-07` | `(5.4, -0.781)` | 4.016166 |
| 3 | `action-06` | `(5.4, -3.781)` | 4.214099 |
| 4 | `action-05` | `(2.4, 2.219)` | 6.065104 |
| 5 | `baseline` | `(2.4, -0.781)` | 6.394699 |
| 6 | `action-04` | `(2.4, -3.781)` | 6.715137 |
| 7 | `action-03` | `(-0.6, 2.219)` | 8.312624 |
| 8 | `action-02` | `(-0.6, -0.781)` | 8.650725 |
| 9 | `action-01` | `(-0.6, -3.781)` | 9.057312 |

No candidate was predicted to meet tolerance. Only after selection, **Run reality** explicitly executed `action-08` in Pymunk. The learned ranking stayed unchanged.

| Measurement | Actual result |
| --- | ---: |
| Predicted target endpoint, m | `(8.496555, 1.527185)` |
| Physical target endpoint, m | `(11.213123, 5.425758)` |
| Actual goal distance, m | 2.550192 |
| Actual minus predicted goal distance, m | -1.250243 |
| Target ADE, m | 2.076573 |
| Target FDE, m | 4.751696 |
| Goal reached within 0.5 m | **No** |

The selected prediction is substantially inaccurate under this intervention. The nearer actual goal distance is not evidence that this action is the best physical action: unselected actions were not physically evaluated. This experiment validates learned search and honest separate measurement, not successful control, causality, calibrated confidence or architecture superiority.

### Provenance and reproduction

Original exported report ID: `5ac0b996c3a74a6c8cd9066bc065c250`. Search SHA-256: `94c4ddd1cb94f7f60efe9b399089464090947943abb8ce1483771aa847809890`. Runtime: Windows, Python 3.12.14, PyTorch 2.14.1+cpu, two CPU threads. The report is a local ignored artifact; weights and generated data are not committed.

| Source | SHA-256 |
| --- | --- |
| GRU epoch-28 weights | `af4edee75ab667fc7b920347bfc7f09ca0c3044d95a5cebea792e66870d67d2a` |
| Dataset `ds-2cda3301ce8c3c5c` | `900bd5da5ed8a0b97b541f1a42669ffe3f4edbac86ee2f3bfe80e9d77cd5132e` |
| Train normalizer | `05dd444ab5b6f63715253de5e40c6e714bc08cd111f9891d6544dd2e1ec693fb` |

The browser's actual downloaded JSON was copied to `experiments/stage8-ui.json`. CLI search with `checkpoints/stage3-gru/best.pt` reproduced all nine numeric scores/trajectories, selection, original observations, conditioned inputs, winner frames and the search hash exactly. Separate CLI reality reproduced actual frames, goal distance and all forecast metrics exactly. Endpoint distances, target FDE and rank order were independently checked from the exported positions.

This verification found a real portability defect: browser JSON serialization converts integral floats to integers, and the initial hash used the raw model description. The worker now hashes the validated normalized description. A regression test serializes integral floats as integers before CLI reproduction. Timestamps/timings may change; new UI captures have fresh identities and therefore different hashes. Determinism remains limited to the verified runtime. [CLI recipe](docs/PLANNING.md#cli-and-exports).

## Validation

- Backend: **173 tests passed**, including 17 Planning cases exercising real generated data and trained MLP/GRU/Transformer checkpoints. Tests cover exact repeated numeric results/hash, learned-only selection, one known-past replay, baseline/ties, separate physical measurement without re-ranking, unchanged live state/weights, invalid/static targets, bounds, source/model mismatch, owner isolation/eviction/cleanup, API worker execution, missing post-edit history, shared-worker contention, Torch-free reality and CLI output protection/export reproduction.
- Ruff lint and formatting passed for 72 files; `pip check` passed. One existing Starlette/httpx TestClient deprecation warning remains; no failed tests.
- Frontend: **85 tests passed**, including 11 Planning cases for source/goal validation, malformed or out-of-range controls, paused/dynamic target requirements, changed-controls evidence hiding and exact sampled cursor bounds. ESLint, Prettier, strict TypeScript and production Vite build passed. Frozen dependency installation passed.
- Manual production-preview verification at **1440×900** and **1920×1080**: real-history preparation; actual GRU search/explicit reality; returned candidate ranking; automatic settings collapse; distinct predicted/actual scores; sampled cursor and future playback; goal editing hides old evidence and disables reality; out-of-bounds goal rejection; JSON download. Completed views have no page overflow or error alerts. Renderer error flags were checked.
- Additional UI searches ran existing Transformer and MLP weights at horizon 10. Planning report state survives workspace navigation in the same session. Lab, Counterfactual and Research views were spot-checked; automated regressions cover earlier workflows. This does not repeat the full Stage 1–7 manual matrix.
- Hosted Linux backend, Windows backend and frontend checks are mandatory PR gates. Their final results are recorded on the Pull Request separately from local validation.

### Visual evidence

![Learned ranking and explicit reality at 1920×1080](docs/screenshots/stage8-planning-1920.jpg)

[Predicted/actual measurements at 1440×900](docs/screenshots/stage8-planning-1440.jpg) · [Changed goal hides previous evidence at 1440×900](docs/screenshots/stage8-goal-1440.jpg)

## Remaining limits

This is one intervention at one frozen anchor, over a finite nine-action velocity grid. Position tolerance describes the terminal centre only. It does not optimize collision avoidance, energy, smoothness or a sequence of controls. The checkpoints retain Stage 5 exploratory conditioning and `intervention_trained: false`; no new intervention training was performed. Point forecasts have no calibrated uncertainty. Large valid requests may hit existing worker time/output limits.

Reports are bounded session memory, preserved across workspace navigation but not browser/API restart; export them for durable CLI use. API execution is supervised; direct CLI shares engine validation but not the API deadline or payload limits. No mobile, GPU or exhaustive performance claim is made. All eight original implementation stages now have reports; intervention datasets/training, sequential control and multi-seed planning evaluation are suitable separate future branches.
