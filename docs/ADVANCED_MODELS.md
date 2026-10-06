# Advanced models and uncertainty

## Architecture

`family="transformer"` uses the existing shared 22-feature object encoder. At each observed time, multi-head attention relates valid objects, including static context. Padding keys are masked and padding queries are zeroed. No object-index or identity embeddings are used, preserving permutation equivariance at deterministic evaluation. Per-object temporal Transformer layers then combine the history with learned time embeddings. Each layer is independently constructed. The decoder retains motion residuals and contact logits; static bodies persist. The loss, validation selection and training-only normalization are unchanged.

Default recipe: history 4, embedding/hidden 64, 4 heads, 2 temporal layers, dropout 0.10, AdamW lr 0.001, batch 64, seed 7, CPU / 2 threads. The configuration bounds heads to 1–8, layers to 1–4 and dropout to 0–0.5. Embedding must divide evenly into heads. Interactive training retains its existing limits. Dropout zero disables uncertainty sampling.

MLP/GRU parameter names, computations and weights are unchanged. Optional architecture fields have defaults; older checkpoints load without rewriting their hashes. Resume normalizes configuration defaults before comparison, while preserving optimizer, RNG and runtime checks. Versioned v1 report formats have additive `attention` and `uncertainty` fields; old requests default to deterministic forecasts.

## Probabilistic forecast

MC dropout approximates uncertainty in the learned model through stochastic network evaluations. It is inspired by [Gal and Ghahramani, 2016](https://arxiv.org/abs/1506.02142), and implemented with PyTorch [MultiheadAttention](https://docs.pytorch.org/docs/2.14/generated/torch.nn.MultiheadAttention.html), temporal encoder layers and [Dropout](https://docs.pytorch.org/docs/2.14/generated/torch.nn.Dropout.html). This implementation does not provide a fitted likelihood, aleatoric uncertainty or calibrated posterior probabilities.

`samples=0` preserves the point forecast. For a Transformer trained with nonzero dropout, `samples=8..32` activates attention and residual dropout for independent, batched autoregressive paths; every path consumes its own previous learned state. `sampling_seed` is a uint32. There is no simulator call or artificial output noise inside this sampler. RNG state and every module's training flag are restored even on failure. Reproducibility is limited to the tested runtime/platform.

The response contains `method="mc_dropout_autoregressive_v1"`, path count, seed, dropout rate, quantiles, `calibrated=false` and sampled-tick object statistics. Each object has `mean`, sample `std` (correction 1), `lower` (5th quantile), `upper` (95th quantile), each an `[x,y]` pair in metres. Full raw paths are omitted to keep responses bounded. Model/checkpoint/data provenance remains in the containing report. The deterministic eval path remains the existing point forecast and error chart; its position can differ from the MC mean. Rectangles show marginal x/y intervals and a dot shows the MC mean; a rectangle is not a joint 90% confidence region.

CPU requests retain the 45-second worker deadline, 2 MiB input / 8 MiB output and 120-step interactive horizon limits. The sampler additionally caps batch × paths × horizon × objects at 131072, rejecting oversized work explicitly. Static bodies have zero position spread. MLP/GRU do not gain invented intervals.

## Measurement

Every completed dropout Transformer run writes `uncertainty.json` alongside deterministic evaluation. The fixed protocol uses 16 paths, checkpoint seed plus anchor index per group, first/middle/last eligible anchors per episode, requested supported horizons, held-out test and each of six OOD suites. Each group records the exact anchors. No test/OOD result selects a checkpoint or fits calibration. Metrics score dynamic bodies only, at the stated endpoint horizon:

- Marginal observed x/y coverage, compared with nominal 0.90.
- Simultaneous x/y coverage, with no nominal joint guarantee.
- Mean x/y interval width in metres and MC-mean displacement error.
- Pearson correlation of radial standard deviation with MC-mean error, or null for a degenerate variance.

Interactive prediction measures these quantities across every future step against a separately replayed Pymunk reference. Counterfactual predictions contain only the stochastic distribution until a matching explicit reality run exists. Comparison requires the same branch hash, checkpoint, horizon and sampling clock. Coverage is added to that comparison; changing sampling settings does not change the branch itself.

Research displays coverage and width next to held-out error. Forecast panels display selected-body spread, observed coverage and the anchor object-attention matrix (head mean, dropout off). Attention values describe model computation; they are not a causal explanation. The matrix remains tied to the observed anchor when the future cursor changes.

## Reproduction

Using the documented activated backend environment (Windows: `.venv\Scripts\python.exe`):

```text
python -m oracle.train --dataset datasets/ds-2cda3301ce8c3c5c --output checkpoints/stage6-transformer --model transformer --epochs 35 --history 4 --seed 7
python -m oracle.evaluate checkpoints/stage6-transformer/best.pt --dataset datasets/ds-2cda3301ce8c3c5c --output experiments/stage6-evaluation.json --uncertainty
```

Supply `--config` JSON to training to change heads/layers/dropout. Existing output paths are protected. Checkpoints and generated datasets remain local ignored artifacts; regenerate the dataset using the Stage 3 documented configuration and verify its fingerprint. Stage 6 measured results and manual UI verification are in [the report](../STAGE_6_REPORT.md).
