# Release validation experiments

These CLI tools measure existing models, not new product stages. Install the locked
CPU ML requirements from README first. Output directories must be new; interrupted
runs retain their configuration/status/partial evidence and are not silently resumed.
All generated `experiments/`, `datasets/` and `checkpoints/` remain ignored.

## Counterfactual benchmark

```powershell
python -m oracle.counterfactual_benchmark --checkpoint checkpoints/stage3-gru/best.pt --scenes 24 --seed 42 --horizons 10 50 --output experiments/counterfactual-24
```

Repeat `--checkpoint` for up to three completed, validation-selected `best.pt` artifacts
sharing dataset/normalizer/environment/clock. Default: 24 new procedural worlds and
18 cases (unchanged baseline plus 17 interventions), 432 world/intervention combinations.
Seed derivation uses the `oracle-counterfactual-benchmark-v1` namespace; origins and
actual anchor frames are saved. These are additional procedural validation worlds,
not the original dataset test split or a certified in-distribution intervention suite.

Supported cases: mass ×0.75/1.25/2; velocity ×0.75/1.25/1.5 and +90°; friction and
restitution halving/+0.2 (capped at one, exact delta recorded); static translation +1 m;
ramp rotation +15°; add/remove static obstacle; duplicate/remove dynamic body.
Geometry uses conservative rotated AABB separation and bounds. Missing obstacles,
zero-speed direction, invalid edits or unavailable placement are explicitly unsupported.
Every structural addition records its complete body state and deterministic placement.

Each learned forecast replays only known past observations, then applies the existing
synthetic history conditioning. A separate subsequent Pymunk execution supplies reality.
No physical future reaches inference. Score dynamic bodies with the existing prediction
metrics: ADE/FDE, component position/velocity MSE, periodic rotation MAE and contact accuracy.
Balanced accuracy is null unless both actual classes exist. Compare horizon prefixes of
one maximum-horizon forecast. CPU timing includes replay/loading/conditioning/inference
or separate replay/simulation, not an isolated warmed forward call.

`report.json`, `cases.json`, `cases.csv`, `summary.csv`, `config.json`, `provenance.json`
and atomic `status.json` retain source seeds/anchors, exact changes, weight/data hashes,
training seeds, clocks, object counts and runtime. Aggregates weight each evaluated scene
equally, with mean/sample std/median/min/max and explicit evaluated/unsupported counts.
Magnitude is retained per scene; material changes can have different actual deltas.

Bounds: 1–100 worlds, at most 500 world/intervention combinations, 1–3 models, 1–8 horizons
within 1–120 observations, source anchor ≤600 ticks, two inference threads, conservative
100 million body-step cap and ≤3600 s cooperative deadline (checked between cases).
For 100 worlds choose up to five `--interventions`; 100 × all 18 cases is rejected.
There is no heavy benchmark launch API.

## Training seed study

```powershell
python -m oracle.multiseed --dataset datasets/ds-2cda3301ce8c3c5c --seeds 1 2 3 4 5 --output experiments/multiseed/my-study
```

Defaults: MLP/GRU/Transformer, five seeds, 35 epochs, history four, embedding/hidden 64,
batch 64, lr 0.001, contact weight 0.1, CPU/two threads, horizons 1/5/10/20/50.
Use `--families`, `--seeds` or `--config` (plain `TrainConfig` JSON) to configure a small smoke.
The existing trainer is called unchanged; each run selects its best epoch on validation,
then evaluates fixed test/OOD anchors. Dataset and shared schedule hashes must match
across every family/seed or the entire study fails. Test/OOD never selects a winner.
All individual metrics/configurations/selected epochs/checkpoint hashes remain in JSON;
local weights are under the protected study's `runs/` directory.

Per family/group/horizon report mean, sample std (`ddof=1`), median, min, max and the
number of defined/missing seed metrics. OOD macro FDE first averages the six suites per
seed, then aggregates seeds; suites are not counted as independent seed repetitions.
The 95% interval concerns the **mean across training seeds**:
`mean ± t(.975, n−1) × sample_std / sqrt(n)`, for 2–10 defined repeats. This assumes
independent seed repetitions and an approximately normal metric distribution, conditional
on this fixed dataset/recipe. Small n is weak evidence. One repeat has no sample std/CI;
null contact metrics stay null. Intervals may cross zero; they are not clipped to imply
precision. [NIST method](https://www.itl.nist.gov/div898/handbook/prc/section2/prc221.htm),
[t table](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm).

Bounds: 1–3 existing families, 1–10 distinct seeds, CPU/≤2 threads, ≤120 epochs/run,
≤512 episodes/≤1200 ticks, ten million training-window cap, ≤14400 s cooperative deadline
checked between runs. CI uses two tiny seed repeats rather than the full study.
Research → Family comparison reads completed checksum-verified CLI reports under
`experiments/multiseed/`; single-checkpoint comparison remains separate.

Training-seed mean CIs are unrelated to Stage 6 MC-dropout 5–95% marginal quantiles.
Those remain **uncalibrated**, with severe measured undercoverage. Neither these studies
nor counterfactual conditioning demonstrate causal inference, calibrated confidence,
universal architecture superiority or globally optimal planning.
