# Final validation & release

Release branch: `release/oracle-1.0`, based on reviewed Stage 1–8 (`bc9cf18`).
This closes the existing product; it is not Stage 9.

The audit found reusable, separate learned/reality counterfactual workers, physical-unit
metrics, validation-selected training and common held-out evaluation schedules. Extend
those boundaries rather than adding physics, model families or a new planner.

1. Add a deterministic, bounded CLI counterfactual benchmark, exact interventions,
   explicit unsupported cases, checkpoint/data provenance and JSON/CSV aggregation.
2. Orchestrate unchanged training across seeds; report per-run evidence and family
   sample statistics on fixed data/configuration/anchors. Keep test/OOD out of selection.
3. Add five real browser smoke flows and a separate CI job with a small trained fixture.
4. Extract coherent frontend responsibilities while preserving state ownership/design.
5. Add a protected cross-platform demo setup and concise portfolio quick start.
6. Run all existing gates, release smoke experiments and desktop manual regression;
   record actual positive/negative evidence in `RELEASE_1_0_REPORT.md`.

Research experiments remain CLI-only. Defaults are deliberately bounded; CI runs tiny
integration experiments, not the full research study. Generated data/weights/reports
remain ignored. A family mean confidence interval concerns repeated training seeds,
not trajectory uncertainty. MC dropout remains uncalibrated, with measured undercoverage.

Version 1.0 requires local gates and hosted Linux/Windows/backend/frontend/browser CI.
Use logical commits, review the complete diff and prepare a PR without merging it.
