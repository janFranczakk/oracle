"""Seeded MC dropout paths; no simulator and no injected output noise."""

import torch
from torch import Tensor

from oracle.datasets.schema import Normalization
from oracle.models.dynamics import ObjectDynamics
from oracle.training.evaluation import advance_history, raw_features


@torch.no_grad()
def sample_positions(
    model: ObjectDynamics,
    inputs: Tensor,
    mask: Tensor,
    dynamic: Tensor,
    normalizer: Normalization,
    horizon: int,
    samples: int,
    seed: int,
) -> Tensor:
    """Return [batch, samples, horizon, objects, xy] in metres; restore modes and RNG."""
    if model.config.family != "transformer" or model.config.dropout <= 0:
        raise ValueError("MC dropout requires a Transformer trained with nonzero dropout")
    if not 8 <= samples <= 32 or not 1 <= horizon <= 240 or not 0 <= seed < 2**32:
        raise ValueError("Sampling requires 8–32 paths, 1–240 steps and a uint32 seed")
    b, _, n, _ = inputs.shape
    if b * samples * horizon * n > 131072:
        raise ValueError(
            "Sampling exceeds 131072 object steps; shorten the horizon or sample count"
        )
    modes = [(module, module.training) for module in model.modules()]
    devices = list(range(torch.cuda.device_count())) if inputs.is_cuda else []
    try:
        with torch.random.fork_rng(devices=devices):
            torch.manual_seed(seed)
            model.train()  # Includes attention-probability and residual dropout.
            history = inputs.repeat_interleave(samples, dim=0)
            valid = mask.repeat_interleave(samples, dim=0)
            moving = dynamic.repeat_interleave(samples, dim=0)
            positions = []
            for _ in range(horizon):
                output = model(history, valid, moving)
                raw = raw_features(output.features, normalizer)
                if not torch.isfinite(raw).all():
                    raise ValueError("Stochastic rollout became non-finite")
                positions.append(raw[..., :2])
                history = advance_history(history, output.features, normalizer)
            return torch.stack(positions, dim=1).reshape(b, samples, horizon, n, 2)
    finally:
        for module, training in modes:
            module.training = training


def position_statistics(paths: Tensor) -> dict[str, Tensor]:
    stats = {
        "mean": paths.mean(dim=1),
        "std": paths.std(dim=1, correction=1),
        "lower": torch.quantile(paths, 0.05, dim=1),
        "upper": torch.quantile(paths, 0.95, dim=1),
    }
    if any(not torch.isfinite(value).all() for value in stats.values()):
        raise ValueError("Position statistics became non-finite")
    return stats
