# Learned dynamics and training

Stage 3 learns transitions from verified Pymunk recordings. PyTorch inference never invokes the simulator. The editable Lab still shows ground truth; connecting ghost trajectories is Stage 4.

## Installation and commands

Install the base backend as described in README, then the pinned CPU ML environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-ml.lock.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/mlp --model mlp --epochs 35
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/gru --model gru --epochs 35
.\.venv\Scripts\python.exe -m oracle.evaluate checkpoints/gru/best.pt --dataset datasets/demo --output experiments/gru-evaluation.json
```

The CPU lock uses the official PyTorch wheel index, PyTorch 2.14.1+cpu and NumPy 2.5.2. The optional `backend[ml]` dependency group describes the ML requirements; the lock specifies the tested CPU build and transitive versions. Physics and dataset APIs can still start without importing PyTorch. Full Stage 3 tests require the ML dependencies.

CLI options include `--history`, `--hidden`, `--batch-size`, `--seed`, `--device` and a strict `--config` JSON TrainConfig. Config files contain the config directly; the published run's `config.json` wraps it with dataset identity. Device defaults to CPU. `--device cuda` requires a separately installed suitable CUDA PyTorch build; CUDA was not verified for this stage. Existing run directories and evaluation outputs are preserved; train refuses to overwrite a completed run.

To extend the same GRU run to 70 total epochs:

```powershell
.\.venv\Scripts\python.exe -m oracle.train --dataset datasets/demo --output checkpoints/gru --model gru --epochs 70 --resume checkpoints/gru/last.pt
```

Resume requires this run's `last.pt`, unchanged configuration except the larger epoch total, matching dataset / normalizer / observation clock and matching recorded PyTorch, Python, platform, device and thread settings. We tested bitwise-identical final CPU weights and identical per-epoch losses against uninterrupted training on the same machine. This does not promise determinism across hardware, software versions or operating systems; see [PyTorch reproducibility guidance](https://docs.pytorch.org/docs/2.14/notes/randomness.html).

## Object-centric architecture

Each observed object has 22 input features:

| Features | Representation |
| --- | --- |
| Position, velocity, sin / cos rotation, angular velocity, mass, friction, restitution, radius, width, height | 13 continuous values normalized with the exact train-only dataset normalizer |
| Shape | Five categorical indicators: circle, box, ramp, wall, platform |
| Static flag | One binary value |
| Environment | Gravity X / Y and the observed sample interval in seconds |

The shared two-layer SiLU object encoder produces a 64-dimensional embedding by default. A masked mean of object embeddings supplies scene context, concatenated to each object embedding. Padding never enters pooling or the loss. Shared weights preserve permutation equivariance and support different object counts.

The MLP flattens the history for each object independently and applies two temporal dense layers. The GRU processes each object's contextual embedding sequence. Both use a shared decoder with seven learned normalized motion residuals and a contact-onset logit. Dimensions, materials and static transforms are copied from the observed state. These copies represent immutable scene parameters, not hand-coded dynamics. There are no gravity integrators or collision rules in the learned predictor.

Default history is four observed frames at 30 Hz, not four solver ticks. Encoder and hidden sizes are configurable within bounded limits. Current datasets use one gravity environment; this version rejects mixed-gravity collections and binds that environment to checkpoints. Stage 6 adds masked object attention and per-object temporal Transformer layers; MLP/GRU retain pooled context. See [advanced models](ADVANCED_MODELS.md) for the dropout recipe and held-out interval protocol.

## Data ownership and optimization

Training verifies the whole dataset, checks episode hashes and refits the normalizer as an integrity check. Sequence windows remain within one episode and split. Validation, test and OOD never fit normalization or contact class weights. Static bodies provide context but are excluded from targets and metric denominators.

The objective is normalized motion MSE plus `0.1 × weighted contact BCE`. The contact positive weight is fitted on train windows only and capped at 20. AdamW uses learning rate 0.001, weight decay 0.0001 and gradient clipping at 1. Epoch shuffling uses a seeded generator; runtime setup enables deterministic algorithms. Validation objective alone chooses `best.pt`. `last.pt` contains the state after the latest epoch for resume. Epoch logs contain measured train / validation losses, motion loss, learning rate, batch count and elapsed times.

## Checkpoints and local worker

A run publishes `config.json`, `status.json`, `metrics.json`, `evaluation.json`, `best.pt`, `last.pt` and JSON metadata sidecars. API-launched runs additionally retain a local `worker.log`. Binary checkpoints include weights, AdamW state, epoch, best validation objective / epoch, RNG state, configuration, architecture schema, normalizer, dataset fingerprints, gravity, sample clock and runtime versions.

Checkpoint loading checks SHA-256, sidecar consistency, model and feature schema, normalizer fingerprint, strict tensor shapes and finite weights. It uses explicit `torch.load(..., weights_only=True, map_location='cpu')` with a 64 MiB file limit. The loader rejects another dataset identity when one is expected. Follow [PyTorch's loading guidance](https://docs.pytorch.org/docs/2.14/generated/torch.load.html): these checks are integrity measures for trusted local artifacts, not a sandbox for arbitrary untrusted checkpoint files.

Each individual file is published by atomic replacement, with retries for transient Windows reader locks. The collection of checkpoint, log and metadata files is not a transactional database. An abrupt power loss between publications may require recovery from the previous valid checkpoint. There is no UI cancellation / resume or automatic repair of abandoned status files; use the CLI and preserve artifacts for diagnosis. Checkpoints and data remain local and ignored by Git.

Research lists runs and polls progress, plots logged losses with Recharts, exposes test / validation / OOD groups, horizon-specific rollout metrics and recorded checkpoint provenance, and exports the actual evaluation JSON. Blank states contain no invented measurements or confidence. The optimization trace and evaluation sections scroll in the Research viewport; there is no horizontal overflow at the verified desktop sizes.

`POST /api/training/jobs` launches the same CLI in an isolated subprocess. `GET /api/training/runs` and `/api/training/runs/{id}` serve its catalog and artifacts. Interactive limits are 120 epochs, history ≤8, hidden ≤128 and datasets ≤256 episodes. A shared file lock permits one interactive training worker, including after API service recreation. Separate CLI experiments are user-managed. The sequence loader caps each split / suite at 2M object observations. Identifiers cannot escape the checkpoint root. Worker failures preserve logs and show a readable failed state.

## Evaluation definitions

Validation, test and each of six OOD suites are reported separately. The one-step evaluation teacher-forces all usable windows. Free rollouts use up to three deterministic anchors per episode: the first, middle and last history windows that fit the maximum supported horizon. Shorter horizons use the same anchors. Duplicate anchors are removed. Model selection never uses test or OOD.

| Metric | Definition |
| --- | --- |
| Position MSE, m² | Mean squared error across X and Y components of dynamic objects |
| Velocity MSE, (m/s)² | Mean squared error across velocity components |
| Rotation MAE, radians | Mean absolute wrapped angular difference in [0, π] |
| Contact accuracy | Correct contact-onset classification for a dynamic object in the sampled interval, threshold logit ≥0 |
| Balanced accuracy | Mean of sensitivity and specificity; null when either class is absent |
| Precision / recall | Reported with TP / TN / FP / FN; undefined ratios remain null |
| ADE, metres | Mean Euclidean position error across all rollout steps through the chosen horizon |
| FDE, metres | Mean Euclidean position error at the chosen endpoint |

Default horizons are 1, 5, 10, 20 and 50 **observed steps**, corresponding to 0.033, 0.167, 0.333, 0.667 and 1.667 s for 30 Hz data. Unsupported horizons are listed as omitted; no scores are invented. Chart X coordinates use actual numeric horizons. The UI contact score follows the chosen rollout horizon; one-step contact metrics remain available in exported JSON.

Rollout feeds learned outputs back into the model with immutable scene features retained. Sin / cos outputs are projected to a unit-circle representation before the next input; this is angular encoding, not a physics rule. A constant-velocity reference uses the same observations / anchors, extrapolates position and angle from current velocities, predicts no contact, and explicitly omits gravity and collisions. It is an analytical baseline, not an AI model or hidden simulator.

`LearnedDynamics` implements the existing `DynamicsModel` protocol from a verified checkpoint. It preserves object identity and sample ticks, rejects unsupported opaque interventions, and identifies the run / checkpoint epoch. Its deterministic prediction stays compatible; an additional diagnostics method returns real attention weights and optional Transformer MC dropout position statistics. Research evaluation uses tensors; the tested adapter decodes learned outputs to typed frames without calling physics. Completed dropout Transformer runs also publish test/OOD `uncertainty.json`, available in Research and through CLI `oracle.evaluate --uncertainty`.

Small procedural datasets and one-step training can produce substantial rollout drift and poor OOD performance. No universal improvement over the reference is claimed. [Stage 3 report](../STAGE_3_REPORT.md) records the measured baseline results and failures.
