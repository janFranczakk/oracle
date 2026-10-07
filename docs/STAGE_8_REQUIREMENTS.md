# Stage 8 — Learned rollout planning

Start from reviewed Stage 7 (`5730d30`, PR #6) on `feature/learned-rollout-planning`.

- Capture an immutable paused source with sufficient real checkpoint-clock history.
- Set a dynamic object's terminal position goal and tolerance in metres.
- Search a finite nine-action velocity grid: unchanged baseline plus eight velocity offsets at the captured anchor. Keep actions bounded and record the exact candidates.
- Rank candidates only by real deterministic learned rollout endpoint distance, then smaller velocity change and input order. Load verified weights once. Never use a Pymunk future to generate candidates, rank them or choose the winner.
- Preserve the Stage 5 explicit terminal-state conditioning and its `intervention_trained: false` limitation. Restrict planning to a single velocity change, not sequential control, causal claims or optimality beyond this grid.
- Separately verify the fixed winner with an explicit **Run reality** request. Replay known past for solver caches, apply the chosen action and score actual endpoint distance, target error and full forecast error. Keep the learned ranking unchanged; leave the live world untouched.
- Reuse the bounded prediction supervisor and existing counterfactual replay/rendering contracts. Limit horizon/work/input/output, validate owner/source/model identity, preserve useful failure/empty/loading states and avoid loading Torch in API startup or reality-only workers.
- Provide a goal-centred Planning workspace with returned trajectories, candidate ranking, goal preview, a sampled cursor, separate predicted/actual measurements and a provenance-rich export. Support headless search/reproduction and explicit reality verification.
- Preserve all earlier workspaces, datasets and checkpoint formats; add no dependency unless necessary.
- Add meaningful tests for learned-only selection, baseline/tie handling, real checkpoint execution, conditioning, model/source corruption, bounds, owner isolation and separate reality measurement. Pass complete backend/frontend gates and hosted CI; verify 1440×900 and 1920×1080, screenshots and [Stage 8 report](../STAGES_1_8_REPORT.md#stage-8-report--learned-rollout-planning).
