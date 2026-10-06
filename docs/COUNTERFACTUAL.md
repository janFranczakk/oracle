# Counterfactual Lab

Stage 5 adds immutable alternatives to a real observed world. Requirements: [Stage 5](STAGE_5_REQUIREMENTS.md). Verification: [report](../STAGE_5_REPORT.md).

## Source and branch semantics

Capture requires a paused session and its current generation, revision and tick. The snapshot deep-copies the complete original Experiment schema 1, truncates its journal / duration at the observed anchor, and keeps the actual anchor frame. It leaves the live recording, including any later recorded future, intact.

The root branch has no changes. Each child adds one to four ordered update / remove / add operations; all ancestors' operations run at the **same observed anchor tick**. A child never treats its parent's learned future as observations. Stored branches cannot be edited; create a child or sibling. Updating a body preserves identity; duplication / insertion requires a new identity. Removed identities cannot be reused in the same lineage.

Allowed patches cover position, velocity, mass, friction, restitution, rotation, angular velocity and applicable shape dimensions. Previewing a patch transforms recorded state only; it does not integrate dynamics. Pydantic bounds and pure materialization reject missing bodies, invalid graph structure, reused identifiers and unsafe solver inputs before execution.

## Learned conditioning

The policy is `terminal_state_override_v1`, applied to verified Stage 3 MLP / GRU weights. Source observations are rebuilt by replaying only the known past; sampling ends at the anchor. Require the checkpoint's real post-edit history, gravity and sampling clock.

- Existing identities retain their real earlier frames in a separate derived input window; the terminal frame receives the materialized intervention.
- Removed identities are projected out of the derived window.
- New identities receive explicitly **synthetic repeated anchor placeholders** in earlier derived input frames. These are conditioning inputs, never observations.
- The original observations and conditioned inputs are both exported, together with added / removed IDs and `intervention_trained: false`.

The existing direct `DynamicsModel.predict(history, intervention, ...)` contract still rejects opaque intervention arguments. The Counterfactual Lab supplies a separately documented derived window and calls the learned adapter with no direct intervention argument. This preserves the existing checkpoint format and avoids implying intervention-specific training. The adapter uses only actual learned weights for future dynamics; no Pymunk future or physical reference is supplied to it.

MLP / GRU / Transformer were trained on ordinary episodes, not intervention pairs. Forecasts can drift substantially, especially with new identities, large changes or long horizons. Dataset membership is not certified. Stage 6 optionally samples Transformer MC dropout paths and shows actual anchor attention weights. Neither calibrated confidence nor causal interpretation is implied. Matching explicit reality execution adds observed interval quality to the comparison; prediction alone contains no ground-truth measurement. See [advanced models](ADVANCED_MODELS.md).

## Explicit physical execution and measurements

**Predict future** and **Run reality** are independent requests. Reality reconstructs origin / journal through the anchor to recover Pymunk contact caches, applies all inherited edits in order, then advances the requested fixed solver ticks. The reality worker does not import Torch. Neither request mutates live physics or another branch.

Measured ADE / FDE and per-step / per-object errors appear only after both branch futures exist with matching source fingerprint, model hash, stride, sampled ticks and horizon. The metric formulas reuse [Prediction Lab](PREDICTION.md#metrics). Alternative comparisons pair common dynamic IDs and list unmatched bodies; a branch gap is a difference between alternatives, not prediction accuracy. Static bodies supply context, not displacement targets. The shared cursor displays exact returned sampled states; playback and rendering never integrate physics.

Overlay / split views share a camera. Draft previews hide prior futures and measurements until committed or discarded. Each saved branch retains its own computed futures. Editing / playing the live Lab does not invalidate an immutable counterfactual source.

## Storage, import and export

`oracle-counterfactual-plan-v1` contains a source snapshot and topologically ordered branch definitions. SHA-256 fingerprints bind the snapshot and ordered ancestry interventions; adding siblings does not change existing fingerprints. Store ownership follows the live session; expiration removes its plans and cached futures.

Save up to two plans in browser storage. Export `oracle-counterfactual-report-v1` to preserve the plan, actual computed frames, original observations, derived inputs, checkpoint / dataset / normalizer hashes and measured results. Import accepts a plan or the plan extracted from a report. The backend replays and validates its source before publication under a new plan ID. Imported measurements / frames are ignored; run fresh futures. Browser reloads create a new live session and require restoring the saved plan.

Plans are local research data, not persistent server accounts. Runtime limits: four active plans per owner (oldest evicted), 16 branches per plan, eight intervention levels, 16 operations per lineage, four per node, 64 bodies and 512 total source / lineage edits. Input is limited to 2 MiB, worker output to 8 MiB, import / export reports to 16 MiB. Cached future data has a global 16 MiB budget; eviction can require recomputing a pair before metrics become available. Stage 4 / 5 share one worker slot, a 45-second timeout and fresh CPU processes. The 120-second experiment clock still applies.

## API and compatibility

Under `/api/sessions/{sid}/counterfactual`:

| Endpoint | Behavior |
| --- | --- |
| `POST /capture` | Validate paused current anchor and return plan / previews / fingerprints |
| `POST /import` | Replay-validate a portable plan and assign new identity |
| `POST /{plan}/preview` | Validate draft changes and return a transformed anchor |
| `POST /{plan}/branches` | Append an immutable child and return updated description |
| `POST /{plan}/{branch}/predict` | Run verified model and return learned future / optional measurements |
| `POST /{plan}/{branch}/reality` | Execute isolated Pymunk future / optional measurements |

Capture takes generation / revision / anchor tick. Branch creation takes parent ID, name and changes. Execution takes horizon / sample stride; prediction additionally requires model ID. Busy / stale capture returns 409; incompatible input 422; expired owner / plan / branch 404; missing ML dependencies 503 for prediction only. Worker details are logged on the backend, not shown as stack traces in the product.

Backend / UI version is 0.5.0. Experiment schema 1, dataset / normalization / checkpoint schemas, Research and the live Prediction Lab remain compatible. No dependencies or migration were introduced. Counterfactual state is separate from the live observation store; only the existing busy indicator coordinates commands.
