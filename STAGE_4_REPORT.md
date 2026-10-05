# Stage 4 — Prediction Lab

Stage 4 connects real Stage 3 checkpoint inference to the Lab. It implements learned ghost trajectories, independent Pymunk futures, measured errors, a separate forecast cursor and reproducible JSON exports. Requirement scope: [Stage 4 requirements](docs/STAGE_4_REQUIREMENTS.md). Protocol / semantics / limits: [Prediction specification](docs/PREDICTION.md).

## Implementation

- `backend/oracle/prediction/`: compatible completed checkpoint catalog, bounded request schemas, deep-copied real observation capture, isolated subprocess supervisor, replayed ground-truth reference and physical-unit metrics. `oracle/predict.py` runs inference without accessing API session state.
- `models/inference.py` remains the learned adapter; predictions come from its checkpoint weights. It does not import / call the simulator. Pymunk comparison replays origin / journal through the anchor, preserving solver caches, then holds conditions fixed and ignores later journal edits.
- `api.py` adds model catalog / session prediction endpoints and handles capacity / stale results. Session envelopes add generation identity and latest edit tick. Portable Experiment schema 1 remains unchanged. Model / dataset formats and normalization are preserved.
- `frontend/src/prediction/`: preparation, model / horizon selection, honest loading / failure states, compact results, Recharts displacement error, object inspection, full-horizon metrics / class counts / provenance and real JSON export. A separate forecast timeline controls preview only; layer toggles independently show learned ghosts, cyan Pymunk actual and amber displacement connectors.
- `WorldViewport.tsx` renders fading ghost body outlines, trajectories and cursor poses without physics integration. Existing observed trails, camera, editor and observation transport remain available. `state/lab.ts` rejects / clears stale forecasts. `App.tsx` provides Prediction / Object inspector tabs and updates selection telemetry reactively.
- App / backend version 0.4.0. No new dependencies, changed ML architecture or dataset / checkpoint migration.

## Actual measured Lab result

Windows, Python 3.12.14, Pymunk 7.2.0, PyTorch 2.14.1+cpu, two inference threads. Incline scene, seed 42, four dynamic bodies, anchor tick 12 after observing ticks 0 / 4 / 8 / 12; stride four, 50 future steps through tick 212 (1.667 s). Both models are validation-selected checkpoints from Stage 3 and use dataset `ds-2cda3301ce8c3c5c`.

| Metric | MLP / epoch 22 | GRU / epoch 28 |
| --- | ---: | ---: |
| ADE, m | 2.662661 | 2.255167 |
| FDE, m | 4.871194 | 4.187019 |
| Position MSE, m² | 5.931346 | 4.077456 |
| Velocity MSE, (m/s)² | 15.628810 | 11.478532 |
| Rotation MAE, rad | 0.427172 | 0.656181 |
| Contact accuracy | 58.5% | 72.0% |
| Contact balanced accuracy | 67.19% | 67.09% |
| Contact TP / TN / FP / FN | 14 / 103 / 79 / 4 | 11 / 133 / 49 / 7 |
| Observations scored | 200 | 200 |
| Request wall time, one local observation | 1.406 s | 1.388 s |
| Worker computation excluding torch import | 0.0488 s | 0.0570 s |

These measurements show substantial drift. GRU has lower positional error here, but higher rotation error and slightly lower balanced contact accuracy. No universal improvement, calibrated confidence or certified generalization is claimed. See [Stage 3 held-out / OOD results](STAGE_3_REPORT.md) for the separate research evaluation.

Verified checkpoint SHA-256:

- MLP: `f0a01d528ba51455896ee221595c39087d3b7b2e411deed73a61ee815ef123d4`
- GRU: `af4edee75ab667fc7b920347bfc7f09ca0c3044d95a5cebea792e66870d67d2a`

Local generated evidence lives in ignored `experiments/stage4-stage3-mlp-lab.json`, `experiments/stage4-stage3-gru-lab.json` and `.run/stage4-measurements.json`. Metrics were recalculated from the returned typed frames; reference frames were independently regenerated through replay. Full live world payloads before / after both requests were identical.

The browser-downloaded `oracle-stage3-gru-t12-prediction.json` (675,171 bytes) was parsed from Downloads and its predicted frames, reference frames, model metadata and metrics matched the corresponding API result exactly. Timestamps and session generations differ between independent requests and are not claimed to match.

## Automated verification

- **109 backend tests pass**: 90 existing tests and 19 new forecast tests. New coverage includes real trained MLP / GRU inference, subprocess / torch-free API boundary, solver contact-cache replay, ignored future edits, post-edit material / static geometry preservation, real-history requirements, gravity / clock compatibility, static-only scenes, horizon / experiment limits, invalid paths / missing provenance / corrupted weights, stale edit / seek / step / reset / scene / play responses, concurrent command responsiveness, busy capacity, timeout cleanup, missing ML dependencies and metric golden values / periodic angles / contact-class nulls.
- **42 frontend tests pass**: 31 existing tests and 11 new forecast tests for post-edit history, environment / clock mismatch, exact separate frame series, per-object pairing, bounded fading ghost sampling, cursor independence, session generation and stale state / delayed response invalidation.
- Ruff lint / formatting, ESLint, Prettier, frozen pnpm install, strict TypeScript and production build pass. `pip check` reports no broken requirements. TestClient emits the existing Starlette / httpx deprecation warning; it is not a failing check and no dependency was changed to conceal it.
- Production build keeps charts lazy: initial Lab JS about 353.5 kB, shared Recharts chunk about 360.8 kB, forecast chart adapter 1.4 kB. No oversized-chunk warning.
- Hosted GitHub Actions status is recorded in the Pull Request after the final push; local results above are separate from hosted checks.

## Browser verification

Verified the production Vite preview on port 4181 against the actual Python backend on port 8011 in the Codex in-app browser:

1. Prepare real observations at tick 0, then execute GRU and MLP forecasts from the same tick-12 anchor. Both match the independently measured errors above.
2. Scrub a 50-step GRU forecast to step 10: preview time +0.333 s while observed time remains 0.100 s / tick 12. Scrub back to the endpoint. No future observations are inserted into the recording.
3. Switch body inspection to `box-01`, independently toggle learned / error layers, verify the remaining legend identifies Pymunk actual, and restore the layers. Selection telemetry updates immediately.
4. Use the existing Object inspector to change block mass, apply it and return to Prediction. Forecast and its timeline disappear; 12 fresh solver ticks are required after the edit. Model selection survives tab navigation.
5. Resume / pause real physics: the prior forecast clears. Predict from a non-global-phase anchor (tick 51), then seek to tick 0: the forecast clears and preparation is required again.
6. Export actual report JSON and verify it against the API / independent metric recalculation. Check compact settings expansion, readable results, clear model attribution and explicit unestimated confidence.
7. Verify layouts at **1440×900** and **1920×1080**. Document width equals viewport width; world / inspector / chart / forecast controls have no horizontal overflow or panel overlap. Long measurement details scroll within the inspector. No exhaustive mobile / performance claim is made.

Review screenshots: [preparation at 1440](docs/screenshots/stage4-preparation-1440.jpg), [prediction at 1440](docs/screenshots/stage4-prediction-1440.jpg), [prediction at 1920](docs/screenshots/stage4-prediction-1920.jpg), [step-10 error inspection](docs/screenshots/stage4-error-inspection-1440.jpg). Screenshots show real learned / reference output, not a mockup. The final production browser flow recorded no console warnings or errors.

## Remaining scope

Uncertainty is unestimated; the API returns null and the UI says so. Inference loads a fresh subprocess per request and has a 45-second bound; persistent worker caching is a separate performance improvement. Checkpoints / generated reports remain local. The reference holds current conditions rather than replaying later recorded edits. Interventions, immutable counterfactual trees and conditional learned rollouts remain Stage 5; Transformer / ensembles / uncertainty remain Stage 6. Private-repository branch protection remains dependent on the existing GitHub plan; CI and review policy continue to apply.
