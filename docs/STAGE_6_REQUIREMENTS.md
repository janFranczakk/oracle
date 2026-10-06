# Stage 6 — Advanced world models

## Scope

- Add a permutation-equivariant Transformer with masked object attention and temporal attention. Static bodies remain context; padding cannot influence valid predictions.
- Preserve existing MLP/GRU checkpoints, deterministic forecasts, replay and branch conditioning.
- Train real weights with dropout and select the checkpoint using validation loss only.
- Offer seeded, bounded Monte Carlo dropout autoregressive forecasts. Export empirical mean, standard deviation and 5th/95th position quantiles in SI units with checkpoint, seed and sampling provenance.
- Keep the deterministic evaluation forecast as the existing point estimate. Intervals belong to the stochastic sample distribution, whose center can differ.
- Measure marginal x/y coverage, simultaneous x/y coverage and interval width against held-out test/OOD observations and separately executed Pymunk futures. Nominal 90% marginal intervals are not calibrated confidence or joint 90% regions.
- Show actual anchor object-attention weights and sampling diagnostics in the existing training, prediction and counterfactual workflows. Attention is a model weight, not a causal explanation.
- Bound CPU work and report unsupported or failed sampling explicitly. Legacy models do not acquire artificial uncertainty.

## Completion

Meaningful mask, permutation, gradient, sampling/reproducibility, legacy compatibility and API tests; all existing CI gates; browser verification at 1440×900 and 1920×1080; screenshots, measured research results and limitations in `STAGE_6_REPORT.md`; logical commits and a reviewed Pull Request.

No new physics implementation, intervention retraining, uncertainty calibration, formal safety certification or automatic merge is included.
