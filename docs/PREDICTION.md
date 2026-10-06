# Prediction Lab

Stage 4 connects the Stage 3 MLP / GRU adapter to the editable Lab. Prediction uses trained weights; the comparison uses a separately replayed Pymunk world. Both start from the same observed anchor. Neither changes the live recording or playhead.

## User flow

1. Choose **Lab → Prediction** and a completed local model. **Refresh trained models** discovers new checkpoints from Research / CLI.
2. Pause the world. If history is too short, **Record observations** explicitly advances real physics by the missing ticks. It does not repeat the initial frame or generate synthetic inputs.
3. Choose the horizon and **Predict future**. Settings collapse after completion to give measured results room; expand **Forecast settings** to change the model or horizon.
4. Scrub the violet **Forecast** timeline. Violet outlines are learned positions; cyan outlines are the independently executed physical reference. Amber connectors show position gaps at the selected future step. Fading ghosts and trajectory lines cover the full forecast.
5. Select a dynamic body in the viewport or **Inspect object**. The error chart shows mean displacement and, when selected, that object's displacement. Inspect velocity, periodic rotation and contact labels at the cursor, full-horizon ADE / FDE, checkpoint provenance and class counts.
6. **Export forecast & comparison** saves the real JSON report, including observations, experiment origin / edit journal, verified checkpoint and dataset fingerprints, both rollouts and metrics. Generated exports / weights remain local and ignored by Git.

The normal observation timeline still owns real recording playback. Playing, stepping, seeking, applying an edit, resetting, replacing the scene or restoring an experiment clears the forecast when its anchor becomes invalid. Camera / selection / layer toggles leave it intact. Draft object previews are uncommitted; apply the edit and record new observations before predicting its effects in this live workspace. [Stage 5 Counterfactual Lab](COUNTERFACTUAL.md) separately provides immutable branches and explicit derived-history conditioning.

## Ownership and clocks

`prediction/catalog.py` reads compatible completed `best.pt` descriptions without importing torch. `context.py` freezes deep-copied observations and the journal on the API event loop. `service.py` supervises a bounded subprocess through `asyncio.to_thread`; `oracle.predict` loads and verifies weights, runs `LearnedDynamics`, then independently calls `reference.py`. `metrics.py` scores physical-unit differences without a torch dependency. The API process stays free of torch imports.

The reference rebuilds the original Pymunk solver and applies journal events through the anchor, preserving contact caches. It ignores later recorded edits: conditions are held at the anchor. A simple body-transform clone would lose solver state. This future is explicitly identified as a physical reference, separate from learned output and from the live world's observed recording.

| Clock | Meaning |
| --- | --- |
| 120 Hz, `dt = 1/120 s` | Pymunk solver |
| 20 Hz | Live WebSocket observation stream |
| Checkpoint `sample_stride` solver ticks | Model history and autoregressive output sampling |
| `sample_dt = sample_stride / 120` | One learned observation step; 30 Hz for Stage 3 models |
| Pixi ticker | Rendering / observed interpolation, no dynamics integration |

Four history frames at stride four require 12 solver ticks, or 0.1 s, between the first and last real observation. The anchor need not be globally divisible by four: its history must have the correct consecutive spacing. History starts at or after the latest edit at / before the anchor. Gravity and sample clock must match the checkpoint. The default 50-step rollout covers 200 solver ticks / 1.667 s, and starts *after* the anchor.

## API and versioned report

`GET /api/prediction/models` returns compatible model descriptions, names of excluded incompatible / unfinished artifacts and whether torch is installed. Catalog metadata is provisional; inference verifies the weight SHA-256, tensor structure, normalization fingerprint, architecture and dataset provenance. Old prototype checkpoints without gravity metadata are excluded. No completed Stage 3 checkpoint migration is required.

`POST /api/sessions/{sid}/predict` accepts:

```json
{
  "model_id": "stage3-gru",
  "generation": "<current 32-character session generation>",
  "anchor_tick": 12,
  "revision": 0,
  "horizon": 50
}
```

The generation, tick and revision come from the current paused session payload. Live full / transform envelopes now include `generation` and `last_edit_tick`. Generation distinguishes resets / scene replacement / restored sessions even when tick and revision coincide; it is an ephemeral transport identity and does not change portable Experiment schema 1. Client and server reject delayed predictions for changed anchors. HTTP 409 covers stale state / busy capacity; 422 covers unavailable models, insufficient observations, incompatible environment or failed rollout; 503 covers missing ML dependencies.

The `oracle-prediction-v1` result identifies `source: learned_model`, `model_version`, full model / checkpoint description, anchor and anchor frame, predicted `frames`, and `reference: { source: pymunk-7.2.0, conditions: held_at_anchor, frames }`. It also includes horizon / per-object / aggregate metrics, `uncertainty: null`, real observed input history, frozen Experiment and creation time. `elapsed_seconds` measures worker forecast computation including checkpoint loading / reference replay, **excluding** Python process startup and torch import. Measure request wall time separately for UI latency.

## Metrics

Only dynamic objects are scored. Static geometry remains context; its poses / material properties are preserved. Predicted and actual frames must align by tick and object identity. No confidence scores are invented.

| Metric | Definition |
| --- | --- |
| Displacement | Euclidean position gap, metres, at each sampled future step |
| ADE | Mean displacement across all dynamic objects and future steps, excludes anchor |
| FDE | Mean displacement across dynamic objects at the final step |
| Position MSE | Mean squared x / y component error, m² |
| Velocity MSE | Mean squared vx / vy component error, (m/s)² |
| Selected velocity gap | Euclidean velocity difference, m/s |
| Rotation MAE / selected gap | Absolute periodic angular difference, radians, wrapped to ≤π |
| Contact accuracy | Correct dynamic-object onset classifications / scored object observations |
| Contact balanced accuracy | Mean positive recall and negative recall; null if either actual class is absent |

Pymunk contact onset IDs are unioned across the solver ticks between reference samples, matching the training sampling contract. They identify bodies involved in a contact, not object pairs or continuously touching bodies. The learned contact threshold is logit ≥0. Full-horizon TP / TN / FP / FN counts are exported and visible in measurement details. The chart's step-zero point is the known shared anchor with zero displacement, not an additional generated model output.

## Bounds and limitations

- One active prediction per local API process, 45-second worker timeout, CPU inference with two torch threads, horizon 1–120 observed steps, checkpoints ≤64 MiB. Scene / journal / recording limits remain 64 objects, 512 edits and 14,400 solver ticks. A horizon cannot exceed the experiment limit.
- Worker input is capped at 2 MiB; completed output is rejected above 8 MiB. Artifacts are read through the existing bounded JSON / verified checkpoint readers. Worker errors expose a readable message; diagnostic tracebacks are kept in backend logs.
- A fresh process loads torch / checkpoint on every request. This preserves process isolation and makes latency approximately 1.4 s in the measured small scene despite roughly 0.05 s of worker computation. Persistent model-worker caching is a separate performance task.
- The editable Lab is exploratory; training-distribution membership is not certified. The small Stage 3 models drift and can be wrong. These scene-specific measurements do not replace held-out test / OOD evaluation in Research.
- Uncertainty, ensembles, large-scale serving and mobile / GPU performance guarantees are outside this stage. Immutable intervention branches are implemented separately in [Stage 5](COUNTERFACTUAL.md). CPU Windows browser measurements and Linux / Windows repository CI coverage are reported separately.
