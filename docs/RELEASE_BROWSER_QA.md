# Release browser verification

Production Vite preview 4181, real backend 8011, Windows desktop in-app Chromium.
Checks at 1440×900 and 1920×1080 after targeted refactoring. Screenshots show real
observed/learned/measured data. Some panels are scrolled to the verified measurement;
internal scrolling is intentional. Candidate badges remain 0.8.0 pending hosted CI.

| Workspace | Exercised behavior | 1440×900 | 1920×1080 |
| --- | --- | --- | --- |
| Main Lab | Select orb-01; mass 2.64→2.65; apply/step; scene dialog Escape returns focus | [View](screenshots/release-lab-1440.jpg) | [View](screenshots/release-lab-1920.jpg) |
| Prediction | Real history t12; oracle-demo h5; separate ghosts/reference; toggle and independent cursor | [View](screenshots/release-prediction-1440.jpg) | [View](screenshots/release-prediction-1920.jpg) |
| Counterfactual | Restore five-branch plan via replay validation; imported scores discarded; predict mass ×2, separate reality, split/provenance | [View](screenshots/release-counterfactual-1440.jpg) | [View](screenshots/release-counterfactual-1920.jpg) |
| Dataset Explorer | Real 64-episode collection; t0→t4; select specimen 02; train-only normalization | [View](screenshots/release-dataset-1440.jpg) | [View](screenshots/release-dataset-1920.jpg) |
| Training Dashboard | Transformer losses; test/OOD switch; h50; severe dropout undercoverage retained | [View](screenshots/release-training-1440.jpg) | [View](screenshots/release-training-1920.jpg) |
| Checkpoint comparison | Existing three-model/seven-group batch; select unseen-mass OOD; fixed scores/anchors | [View](screenshots/release-comparison-1440.jpg) | [View](screenshots/release-comparison-1920.jpg) |
| Family comparison | Actual fifteen-run report; mean/std/CI; equal-suite OOD macro; schedule/epoch provenance | [View](screenshots/release-families-1440.jpg) | [View](screenshots/release-families-1920.jpg) |
| Planning | Nine-action search; fixed-winner reality; goal not reached; x12→13 removes old evidence/disables reality | [View](screenshots/release-planning-1440.jpg) | [View](screenshots/release-planning-1920.jpg) |

Every captured state had document width equal to requested viewport width and no
visible fatal alert. No captured console error/warning occurred. Panels, timelines,
charts and split scenes were visually inspected without overlap. Five automated E2E
separately cover actual backend mutations/live-world isolation. Mobile, other-browser
and exhaustive interaction coverage are not claimed.

The final candidate refresh was also checked at both sizes: small nonzero seed
variation stays visible, CI assumptions/interpretation precede the detailed metric
table, and About describes all eight stages and uncalibrated uncertainty. About fits
both viewports; Escape closes it and restores focus to its launcher. No console
warning/error was captured during this refresh.
