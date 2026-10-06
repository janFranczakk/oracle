# Learned rollout planning

Planning chooses a single velocity intervention using a learned dynamics model, then measures that choice in a separate physical experiment. [Stage 8 requirements](STAGE_8_REQUIREMENTS.md) · [Measured results](../STAGE_8_REPORT.md).

## Source and action protocol

Start from a paused live observation with matching generation, revision and tick. Capture its original scene and ordered edit journal through that tick. The worker replays this known past once to validate the snapshot and collect the checkpoint's real observation window. History starts at `anchor_tick - (history - 1) * sample_stride`; it must be at or after the most recent edit. Checkpoint gravity and observation clock must match the source. Future recorded edits are excluded. Search and verification leave live physics and its recording untouched.

Select a dynamic object and a terminal position goal `(x, y)` in metres. Goal bounds are x 0–24, y 0–14; tolerance is 0.05–3 m. The objective is Euclidean distance from the target object's predicted centre to the goal at the final observed step. It does not measure path feasibility, obstacle clearance, intermediate goals or arrival velocity.

The fixed grid contains nine candidates. `baseline` leaves velocity unchanged. `action-01` through `action-08` add the following component offsets to the captured velocity, in this order: `(-δ,-δ)`, `(-δ,0)`, `(-δ,+δ)`, `(0,-δ)`, `(0,+δ)`, `(+δ,-δ)`, `(+δ,0)`, `(+δ,+δ)`. δ is 0.1–15 m/s. Each resulting component must stay within ±100 m/s; invalid grids are rejected rather than clamped. All other object properties are preserved. Each nonbaseline action is one child of the unchanged root in a portable Counterfactual plan.

## Learned selection and explicit reality

Weights are verified against the completed catalog, loaded once and checked again after loading. The model runs on CPU with two threads, deterministic evaluation and dropout disabled. Each candidate uses Stage 5 `terminal_state_override_v1` conditioning: retain the real past and replace the last observed velocity with the candidate's value. The adapter rolls out autoregressively. **No Pymunk future is executed to generate, score or select candidates.**

Candidates sort by `(goal_distance_m, velocity_change_m_s, input_order)`. Equal goal distances prefer smaller Euclidean velocity change; remaining exact ties preserve grid order. There is no floating-point tie tolerance. The winner is the nearest endpoint among this finite grid, even if no candidate is predicted to reach tolerance. The report includes every target trajectory and the winner's full-world future.

**Run reality** is a separate explicit request. It uses the cached report's selected action, source, horizon and stride. Pymunk replays the source to restore solver caches, applies that action and executes the physical future. The response adds actual goal distance, goal attainment, signed `actual - predicted` distance error, target ADE/FDE and the existing all-body forecast metrics. It does not change candidate scores, selection or ranking. [Forecast metric definitions](PREDICTION.md#metrics).

Ordinary-episode checkpoints were not trained on interventions: `intervention_trained` remains false. Action conditioning is exploratory, and the model may respond incorrectly to velocity changes or drift substantially. Planning uses deterministic point forecasts, with uncertainty unset. Goal attainment is a prediction until explicitly measured. There is no global optimality, causal identification or calibrated confidence claim.

## UI and report lifecycle

Open **Planning** and select a completed checkpoint. Pause source playback and use **Record N ticks** when real history is missing. Set the object, goal, tolerance, horizon and grid step, then **Search learned futures**. Goal/settings collapse after a successful search so predicted and actual measurements remain visible. Amber marks the goal, violet learned futures, cyan the separately executed reality. The timeline renders exact returned observations; playback changes only this sampled cursor.

Changing goal, object, model, horizon or grid step hides the previous measured ranking/futures and disables reality/export until the controls match a stored report or a new search succeeds. Changing the live world after capture does not invalidate a frozen report; its source label retains the captured tick. Reports remain available when navigating workspaces in the same session. A browser reload starts a new live session and does not restore this transient planning state. Export important reports.

The backend retains up to two reports per session, ≤8 MiB each and ≤16 MiB globally, evicting the oldest as needed. Expired sessions discard their reports. A client can retain an evicted report for export, but server verification then returns a useful 404; use CLI with the export or search again. Planning does not add a persistent database or browser report library.

## API

| Method | Session path | Result |
| --- | --- | --- |
| POST | `/api/sessions/{sid}/planning/search` | Capture and run a learned search |
| GET | `/api/sessions/{sid}/planning/{report_id}` | Retrieve that session's cached report |
| POST | `/api/sessions/{sid}/planning/{report_id}/reality` | Verify the cached fixed winner; no action parameters accepted |

Search body:

```json
{
  "generation": "current-session-generation",
  "anchor_tick": 12,
  "revision": 0,
  "model_id": "stage3-gru",
  "object_id": "orb-01",
  "goal": {"x": 12, "y": 3, "tolerance_m": 0.5},
  "horizon": 50,
  "velocity_delta": 3
}
```

Source identity comes from the live session; illustrative identifiers are not reusable requests. Wrong owner/expired report returns 404; busy or stale/unpaused capture 409; invalid/incompatible input 422; missing ML dependencies 503. Search runs outside the API event loop in the shared prediction subprocess supervisor. Planning is bounded to 1–120 observed steps, ≤32 source objects and `9 * horizon * object_count ≤32768`. The source plus future must fit the 120-second recording limit. Supervisor limits are 45 seconds, 2 MiB input and 8 MiB output. Large valid configurations can still exceed time/output bounds. No dependency or existing checkpoint migration is required.

## CLI and exports

**Export planning report** downloads `oracle-planning-report-v1` JSON containing source/journal, goal/request, exact candidate actions/ranking, selected future, original and conditioned inputs, verified model provenance, runtime, elapsed engine time and optional separate reality/metrics. `search_sha256` hashes normalized plan/request/model description. Timestamps and elapsed times are excluded from numeric reproduction expectations. A fresh UI search captures a new plan ID and timestamp; its search hash therefore changes. Reproducing the same exported source preserves its identity/hash.

Copy the export into ignored `experiments/`, then use the matching completed checkpoint:

```powershell
.\.venv\Scripts\python.exe -m oracle.plan --input experiments/planning-export.json --checkpoint checkpoints/stage3-gru/best.pt --output experiments/planning-repeat.json
.\.venv\Scripts\python.exe -m oracle.plan --input experiments/planning-repeat.json --reality --output experiments/planning-verified.json
```

Search also accepts context JSON with `plan`, `request` and `model`. `--checkpoint` is required for search. Reality reads the fixed selected action from the report and needs no Torch or checkpoint. Existing output files are protected. CLI uses the same validated worker engine, but runs directly without the API's subprocess deadline/transport-size supervisor. Use trusted exported reports and verified local weights. Exact numeric equality was verified in the documented Windows CPU runtime; cross-platform weight regeneration or physics equality is not promised.
