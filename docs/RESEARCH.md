# Matched research experiments

Stage 7 adds **Research → Model comparison** and `oracle.research_batch`. Both evaluate fixed, completed MLP / GRU / Transformer checkpoints through the existing held-out scoring code. No optimization or new simulation runs occur during a comparison. [Requirements](STAGE_7_REQUIREMENTS.md) and [measured verification](../STAGE_7_REPORT.md).

## Shared evidence

Select 2–4 distinct checkpoints from the exact same dataset, content fingerprint, train-only normalizer, gravity and observation clock. The worker checks completed training status, submission-time weight SHA-256 and the full verified checkpoint metadata before evaluation. Labels are frozen when the batch is submitted. Archival only affects future comparison selection.

The common start is the **maximum selected history length**. Each model receives its own trained history window ending at the same observation. One-step scoring excludes earlier targets for every model. Rollouts share first / middle / last eligible anchors per episode, the maximum supported requested horizon and all shorter requested horizons. Duplicate anchors are removed. Each group records episode IDs, seeds, sample indices, target-window count and a schedule SHA-256; schedules must agree across models before publication.

Only held-out test and the six existing OOD suites are selectable. Train and validation never become comparison groups. Supported horizons are 1–120 observed steps, with up to eight distinct choices. Short episodes explicitly omit unsupported horizons; a group with no usable horizon fails the batch. Different groups retain independent anchors and sample counts.

Position / velocity MSE, wrapped rotation MAE, contact counts and rollout ADE / FDE retain the [training definitions](TRAINING.md#evaluation-definitions). The analytical constant-velocity reference scores the same targets and anchors. Static geometry is input context, not an error target. The chart contains only measured horizon points. Lines connect those points visually; intermediate horizon scores are not inferred. The OOD summary is the **unweighted mean of suite-level FDE** across the selected OOD groups at the selected horizon, rather than pooling objects from differently sized suites. No OOD selection yields an unavailable summary.

The `oracle-research-comparison-v1` report includes the request, common history, dataset identity, group schedules, complete learned/reference scores, checkpoint identity/hash, architecture, parameter count, selected epoch, training seed, weight-file size and runtime. Deterministic point forecasts use evaluation mode, with dropout off. Stage 6 stochastic interval measurement remains a separate explicitly uncalibrated protocol.

## Measured timing

All selected models receive the first scene of the first selected group at the common first anchor. Each receives its own history length. CPU forward timing uses batch size 1, fixed requested threads, three untimed warm-ups and ten timed calls. The report records median and nearest-rank p95 in milliseconds, episode, group, anchor and total input-object count. With ten calls, this p95 is the largest measured call.

The scope is `warmed_cpu_forward_only`: preparation, checkpoint loading, dataset I/O, worker startup, autoregressive rollout and API/browser transport are excluded. Timing is machine/load dependent and does not measure end-to-end latency. Overall batch elapsed time starts in the engine before verification and excludes interpreter startup. Evaluation defaults to two CPU threads; CLI/API permit 1–4.

## Workers, persistence and failures

`research/api.py` supervises one research subprocess outside the API event loop. A process-independent file lock serializes workers sharing an output root, including CLI workers and service recreation. Interactive datasets are limited to 256 episodes and 1200 solver ticks. The API kills its owned worker at a 15-minute deadline; the shared engine also checks this deadline between group evaluations. Separate CLI roots are user-managed and do not share a global lock or API watchdog.

`experiments/research/<batch-id>/` retains:

- `request.json`: fixed dataset path, model order, submission hashes/labels and configuration;
- `status.json`: starting/verifying/evaluating/complete/failed progress, model/group and useful error;
- `worker.log`: API worker diagnostics;
- `report.json`: atomically published after every selected model/group succeeds.

The API exposes a report only when status is complete. Failed or interrupted artifacts remain available for diagnosis; output directories with completed artifacts are never overwritten. After an API restart, a running status older than 30 seconds with no active worker lock becomes failed. A held lock preserves the active worker's state. The catalog serves the most recent 100 batches; individual older reports remain addressable by ID. Reports are local files, not a database or remote artifact store.

The API imports neither PyTorch nor filelock at startup. PyTorch loads in the worker. Filelock is imported lazily for launch/recovery. Existing collection, training and prediction workers retain their separate scopes; CPU contention can affect timing.

## Checkpoint notes

`research/registry.py` extends the existing verified `ModelCatalog`. Optional labels (up to 64 characters), pins and archive flags live in `checkpoints/.research/<original-id>.json`, separate from weights and training metadata. Pins reorder the comparison roster. Archive hides an entry from default comparison selection; **Show archived checkpoints → Inspect → Restore checkpoint** reverses it. Archive leaves Prediction Lab and Counterfactual Lab availability intact. Original IDs and hashes remain visible in reports. Invalid or incomplete entries are reported as unavailable. IDs, containment and annotation bounds are validated.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/research/checkpoints` | Verified checkpoint metadata, notes, unavailable entries and ML availability |
| POST | `/api/research/checkpoints/{id}/notes` | Replace label/pin/archive annotation |
| GET | `/api/research/batches` | Persistent status catalog |
| GET | `/api/research/batches/{id}` | Status and completed report, otherwise null report |
| POST | `/api/research/jobs` | Start a batch; 409 when a research worker is active |

Job example:

```json
{
  "dataset_id": "ds-2cda3301ce8c3c5c",
  "models": ["stage3-mlp", "stage3-gru", "stage6-transformer"],
  "horizons": [1, 5, 10, 20, 50],
  "groups": ["test", "ood/unseen_velocity"],
  "threads": 2
}
```

## CLI and exports

From the repository root in the documented Python environment (Windows: `.venv\Scripts\python.exe`):

```text
python -m oracle.research_batch --dataset datasets/ds-2cda3301ce8c3c5c --checkpoint checkpoints/stage3-mlp/best.pt --checkpoint checkpoints/stage3-gru/best.pt --checkpoint checkpoints/stage6-transformer/best.pt --output experiments/research/comparison-demo --horizons 1 5 10 20 50 --threads 2
```

The default groups are test and all six OOD suites. Supply `--groups test ood/unseen_velocity` to narrow the selection. Training must already have completed; use a new output directory for each run. Replay an API request without changing its checkpoint hashes:

```text
python -m oracle.research_batch --request experiments/research/<batch-id>/request.json --output experiments/research/comparison-repeat
```

JSON export is the complete backend report. CSV has one row per model/group/supported horizon, including learned/reference ADE/FDE, other rollout metrics, source identifiers/hashes and timing. Undefined contact ratios become empty fields. CSV quotes are escaped, and formula-leading text labels receive an apostrophe. JSON retains one-step metrics, full anchors and runtime details that are not flattened into CSV.

Existing dataset/checkpoint/evaluation/prediction/counterfactual formats require no migration. No dependencies were added. Checkpoint comparisons describe these weights on these finite samples. Architecture superiority, significance, calibrated uncertainty, multi-seed aggregation, training-budget control, GPU/end-to-end benchmarking and planning are not established by this workflow.
