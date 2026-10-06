# Stage 7 — Research platform

Build on reviewed Stage 6 (`4090d8a`, merged PR #5) on `feature/research-platform`.

## Research contract

- Compare 2–4 verified completed checkpoints from the same dataset/content/normalizer/environment and observation clock. Support MLP, GRU and Transformer without changing their weights or training.
- Use the maximum selected history as the common observation start. Score identical one-step targets and first/middle/last rollout anchors in each selected test/OOD group, with identical supported horizons. Report omitted horizons and exact anchors; never silently compare different samples.
- Reuse existing physical-unit metrics and constant-velocity reference. Preserve group boundaries; report parameters, training seeds, selected epochs, hashes, history and runtime. Scores describe checkpoints, not architecture superiority or statistically significant effects.
- Benchmark actual warmed-up CPU model forward calls on the same single scene: batch size 1, fixed threads, median/p95 milliseconds, sample/shape and timing scope recorded. Exclude checkpoint loading and dataset I/O. Timing is machine-dependent.
- Run the checkpoint × group × horizon evaluation batch in a bounded subprocess, outside the API event loop. Keep progress, useful failure states and atomic complete reports. Preserve failed work; never overwrite completed jobs.

## Product

- Add a Research comparison workspace: checkpoint selection, test/OOD group and horizon controls, measured comparison table and shared-horizon chart, persisted batch log and JSON/CSV export.
- Add reversible checkpoint labels, pins and archival from comparison selection. Preserve weight files, training artifacts, existing Prediction/Counterfactual availability and original identities. Archived entries remain inspectable/restorable. Validate identifiers and annotation bounds.
- Keep previous Research training/data/roadmap views and both laboratories working. Use existing styling, internally scrolling tables and actual metrics; verify 1440×900 and 1920×1080.

## Definition of Done

- CLI and API share the evaluation engine. Meaningful tests cover matched samples across differing history windows, compatibility/corruption rejection, job isolation/publication/failure, checkpoint metadata persistence and report export semantics.
- No fitting on test/OOD; no simulator output masquerading as learned predictions; no invented confidence or rankings. Stage 6 uncertainty remains explicitly uncalibrated. Stage 8 planning is outside this change.
- Pass backend tests/Ruff, frontend tests/ESLint/Prettier/strict TypeScript/build, hosted CI on Linux/Windows/frontend, final diff audit. Record real batch measurements, manual evidence and limitations in `STAGE_7_REPORT.md`.
