# Stage 5 — Counterfactual Lab

Verified 2026-10-06 on Windows with the production frontend and actual Stage 3 checkpoints. [Requirements](docs/STAGE_5_REQUIREMENTS.md) · [Contract and limits](docs/COUNTERFACTUAL.md).

## Implemented behavior

Counterfactual Lab captures an immutable observed source and lets users preview / save alternative interventions in a bounded tree. Children inherit their parent's changes at the same original source tick. Model prediction and explicit physical execution are separate operations. Both leave the live session, its future recording and other branches untouched.

- `backend/oracle/counterfactual/`: strict source / graph / intervention schemas, pure state materialization, stable ancestry fingerprints, owner-scoped storage, derived-history conditioning and isolated replay / inference / reality workers. The API reuses the existing session lookup and shared bounded prediction supervisor.
- `frontend/src/counterfactual/`: independent branch store, tree navigation, intervention controls, exact sampled replay, shared camera, overlay / split comparison, error chart, object metrics, provenance, local plans and JSON import / export.
- `rendering/graphics.ts`: extracted existing body / ghost helpers for reuse. Existing Lab appearance, physics ownership, camera, editor, Research and Prediction Lab remain available.
- App / backend version 0.5.0. No dependency changes, new training architecture, checkpoint migration or Experiment schema 1 changes. Frontend Experiment typing now includes environment / journal fields already returned by the backend.

## Research boundary

The policy is `terminal_state_override_v1`. Real source observations are retained unchanged in the report. Existing bodies keep their real earlier inputs, while the terminal frame receives branch edits. Removed identities are projected out of the derived window; added identities use explicitly synthetic repeated anchor placeholders. The model is never given a Pymunk future. Only known past replay supplies original observations.

MLP / GRU were trained on ordinary episodes, not intervention pairs. This is an exploratory interface for conditional forecasts, not a claim of validated causal inference. Intervention-specific training, certified generalization, attention interpretation and uncertainty estimation are absent. Confidence / uncertainty remain null. New-body placeholders and long-horizon drift are material limitations.

## Actual measured results

Python 3.12.14, Pymunk 7.2.0, PyTorch 2.14.1+cpu, two inference threads. Incline scene, seed 42, anchor tick 12 with observations 0 / 4 / 8 / 12. Stride four, 50 future samples through tick 212, 1.667 s. Four dynamic bodies in the baseline. All rows use the same frozen source; metric formulas reuse Stage 4 and exclude the anchor / static bodies.

| Alternative | Model | ADE, m | FDE, m |
| --- | --- | ---: | ---: |
| Observed baseline | GRU, epoch 28 | 2.255167 | 4.187019 |
| `orb-01` mass 2.639 → 5.278 kg | GRU, epoch 28 | 2.394252 | 5.258401 |
| Child: inherited doubled mass, velocity ×1.5 | GRU, epoch 28 | 2.209038 | 4.112041 |
| New static wall at (12, 6), 0.3 × 5 m | GRU, epoch 28 | 2.081606 | 3.730544 |
| Duplicate `orb-02` offset 1.5 m, remove `orb-03` | GRU, epoch 28 | 2.090163 | 4.556307 |
| Observed baseline | MLP, epoch 22 | 2.662661 | 4.871194 |

The baseline reproduces Stage 4 exactly. Lower error on an alternative does not prove better causal reasoning: object sets / trajectories can differ, and these are single exploratory scenes. The child retains 5.278 kg and changes velocity to (3.6, −1.1715) m/s. Adding a static wall also changes the model's scene context. The cloned body is labeled synthetic in derived inputs; original observations retain `orb-03` and contain no clone.

Verified checkpoint SHA-256:

- GRU: `af4edee75ab667fc7b920347bfc7f09ca0c3044d95a5cebea792e66870d67d2a`
- MLP: `f0a01d528ba51455896ee221595c39087d3b7b2e411deed73a61ee815ef123d4`

Both checkpoints bind dataset `ds-2cda3301ce8c3c5c` and its train-only normalization. The browser exported a real 5,148,397-byte report containing all five GRU branch pairs. Independent execution regenerated **every learned frame and Pymunk frame exactly** in this runtime; derived inputs, conditioning metadata, branch hashes and recalculated metrics matched the export. Generated evidence is ignored: `experiments/stage5-browser-gru-report.json`, `experiments/stage5-mlp-baseline.json`, `.run/stage5-measurements.json`.

Recorded worker times for these individual browser requests were 1.053–1.114 s for GRU and 0.020–0.0255 s for reality. They include known-past replay and, for prediction, Torch import / inference; they exclude process startup / transport. These observations are not a throughput benchmark or directly comparable to Stage 4's timing interval.

## Automated validation

- **130 backend tests pass**: 109 existing and 21 Stage 5 cases. Coverage includes real trained MLP / GRU weights, original-history preservation, nested / sibling / owner isolation, frozen past capture with retained live future, exact edited Pymunk replay and contact caches, add / remove conditioning, no future solver steps during prediction, source tamper rejection, graph / identity / geometry / velocity bounds, stable fingerprints, 16-branch limit, metrics gating / recalculation, delayed prediction during live changes, Torch-free reality, missing Torch, shared busy capacity and timeout cleanup.
- **55 frontend tests pass**: 42 existing and 13 new cases. Coverage includes immutable preview transforms, nullable portable patches, tree ordering, branch selection / live-store isolation, exact cursor sampling, clock / horizon / identity pairing, fingerprint validation, measured-result gating and rejecting imported / mismatched results.
- Ruff lint / formatting, `pip check`, frozen pnpm install, ESLint, Prettier, strict TypeScript and production build pass. The existing Starlette / httpx TestClient deprecation warning remains visible; it does not fail checks. No dependency changes were made to suppress it.
- Counterfactual workspace is lazy-loaded: about 33.9 kB JS / 14.1 kB CSS. Main Lab JS about 354.5 kB; largest chart chunk about 360.8 kB. No oversized-chunk warning.
- Hosted Linux / Windows backend and frontend CI are separate from local verification. Their final status is recorded on the Pull Request after the branch push.

## Manual browser verification

Production preview on port 4181 against the real Python backend on 8011:

1. Empty state, disabled execution before capture, explicit recording of 12 real ticks, paused source capture and baseline GRU prediction. Error metrics remain unset before explicit reality execution.
2. Run reality, scrub the shared cursor and inspect actual GRU error. Toggle overlay / split and verify canvas dimensions follow the panel. A discovered resize / Pixi batch error was fixed before final production verification.
3. Preview doubled mass: the source is preserved, execution is disabled until save, and saved forecasts / metrics are hidden during the uncommitted draft. Create the branch and measure both futures.
4. Create a child with speed ×1.5. Verify inherited mass and the same tick-12 source. Create independent wall and clone / removal siblings; predict / execute all five alternatives. No original object is removed or duplicated in the live Lab.
5. Compare learned alternatives and Pymunk alternatives, then predicted / actual. Different object sets report one unmatched identity on each side and compute branch gaps only on common dynamic IDs. Verify checkpoint, normalizer and explicitly synthetic added-body provenance.
6. Return to live Lab: still tick 12, 10 original objects and original sphere mass. Advance live physics to tick 13; existing branch data remains tied to source tick 12. Run MLP on that immutable source and observe ADE 2.663 / FDE 4.871 m.
7. Save a plan, export actual JSON and independently verify its contents. File import of a tampered source returns a readable replay-mismatch error and preserves the active plan. Reload the app, restore the local five-branch plan into a new session, verify all old results are absent, then recompute the mass branch from the restored tick-12 source.
8. Verify **1440×900** and **1920×1080**. Document width equals viewport width; tree / central world / inspector have no horizontal overflow or overlap. Split canvases match their host dimensions; the inspector scrolls internally. Final production flows produced no JavaScript console warnings / errors. Mobile and sustained rendering performance were not exhaustively tested.

Screenshots: [empty](docs/screenshots/stage5-empty-1440.jpg), [intervention preview](docs/screenshots/stage5-preview-1440.jpg), [MLP baseline](docs/screenshots/stage5-baseline-1440.jpg), [predicted / actual at 1440](docs/screenshots/stage5-predicted-actual-1440.jpg), [branch comparison at 1920](docs/screenshots/stage5-branches-1920.jpg), [split verification at 1920](docs/screenshots/stage5-split-1920.jpg). These show real learned / physical output, not mockups.

## Remaining limitations

Plans / sessions are local, bounded and ephemeral on the server. Browser storage keeps two plans; exports preserve computed results, while restore / import requires recomputation. All branch edits occur at one frozen source tick; this is not a planning tree rooted in predicted observations. A shared fresh subprocess adds latency; caching / a persistent worker is separate performance work. Physical execution can reject extreme / overlapping edits despite preview support. Small baselines remain inaccurate and use synthetic history for inserted bodies. Stage 6 can introduce Transformer / attention and measured uncertainty; intervention-specific training requires a separately designed dataset / evaluation protocol. No automatic merge or deployment was performed.
