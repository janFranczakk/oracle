"""Attention and actual stochastic autoregression, including numerical boundaries."""

import pytest
import torch
from pydantic import ValidationError

from oracle.datasets.normalization import FEATURE_NAMES
from oracle.datasets.schema import Normalization
from oracle.models.dynamics import ObjectDynamics
from oracle.models.sampling import position_statistics, sample_positions
from oracle.models.schema import ModelConfig
from oracle.prediction.uncertainty import SamplingOptions, interval_scores


def scene():
    torch.set_num_threads(1)
    torch.manual_seed(11)
    model = ObjectDynamics(ModelConfig(family="transformer", history=2, embedding=16, hidden=16))
    inputs = torch.randn(1, 2, 4, 22)
    mask = torch.tensor([[True, True, True, False]])
    dynamic = torch.tensor([[True, True, False, False]])
    normalizer = Normalization(
        feature_names=FEATURE_NAMES,
        mean=[0.0] * 13,
        scale=[1.0] * 13,
        constant_features=[],
        observations=1,
        source_episodes={},
    )
    return model, inputs, mask, dynamic, normalizer


def test_attention_masks_keys_and_queries_and_receives_training_gradients():
    model, inputs, mask, dynamic, _ = scene()
    model.eval()
    output = model(inputs, mask, dynamic)
    weights = output.object_attention
    assert weights is not None
    assert torch.equal(weights[:, :, 3], torch.zeros(1, 4))
    assert torch.equal(weights[:, 3], torch.zeros(1, 4))
    assert torch.allclose(weights[:, :3].sum(-1), torch.ones(1, 3))
    output.features[dynamic].square().sum().backward()
    gradient = model.temporal.object_attention.in_proj_weight.grad
    assert gradient is not None and torch.isfinite(gradient).all() and gradient.abs().sum() > 0
    with pytest.raises(ValueError, match="valid object"):
        model(inputs, torch.zeros_like(mask), torch.zeros_like(dynamic))


def test_mc_paths_reproduce_preserve_rng_modes_and_static_objects():
    model, inputs, mask, dynamic, normalizer = scene()
    model.eval()
    model.temporal.dropout.train()
    modes = [m.training for m in model.modules()]
    state = torch.get_rng_state().clone()
    paths = sample_positions(model, inputs, mask, dynamic, normalizer, 5, 16, 23)
    assert torch.equal(torch.get_rng_state(), state)
    assert [m.training for m in model.modules()] == modes
    assert torch.equal(paths, sample_positions(model, inputs, mask, dynamic, normalizer, 5, 16, 23))
    assert not torch.equal(
        paths, sample_positions(model, inputs, mask, dynamic, normalizer, 5, 16, 24)
    )
    stats = position_statistics(paths)
    assert torch.isfinite(paths).all() and paths.shape == (1, 16, 5, 4, 2)
    assert stats["std"][0, :, :2].max() > 0
    assert torch.equal(stats["std"][0, :, 2:], torch.zeros(5, 2, 2))
    assert torch.all(stats["lower"] <= stats["upper"])
    torch.nn.init.zeros_(model.decoder.weight)
    collapsed = sample_positions(model, inputs, mask, dynamic, normalizer, 5, 16, 23)
    assert position_statistics(collapsed)["std"].max() == 0


def test_sampling_bounds_and_legacy_models_do_not_invent_uncertainty():
    model, inputs, mask, dynamic, normalizer = scene()
    for count in (0, 7, 33):
        with pytest.raises(ValueError, match="8–32"):
            sample_positions(model, inputs, mask, dynamic, normalizer, 5, count, 7)
    legacy = ObjectDynamics(ModelConfig(history=2, embedding=16, hidden=16))
    with pytest.raises(ValueError, match="nonzero dropout"):
        sample_positions(legacy, inputs, mask, dynamic, normalizer, 5, 16, 7)
    with pytest.raises(ValueError, match="object steps"):
        sample_positions(
            model,
            inputs.expand(5, 2, 4, 22),
            mask.expand(5, 4),
            dynamic.expand(5, 4),
            normalizer,
            240,
            32,
            7,
        )
    with pytest.raises(ValidationError):
        SamplingOptions(samples=7)
    with pytest.raises(ValidationError):
        ModelConfig(family="transformer", embedding=17)


def test_marginal_and_joint_coverage_are_distinct_and_degenerate_correlation_is_null():
    score = interval_scores(
        [[0, 0], [0, 0]], [[2, 2], [2, 2]], [[1, 1]] * 2, [[0.5, 0.5]] * 2, [[1, 3], [3, 1]]
    )
    assert score["coverage_x"] == score["coverage_y"] == 0.5
    assert score["coverage_xy"] == 0
    assert score["width_x_m"] == score["width_y_m"] == 2
    assert score["spread_error_correlation"] is None


def test_sampling_failure_restores_rng_and_module_modes(monkeypatch):
    model, inputs, mask, dynamic, normalizer = scene()
    model.eval()
    modes = [module.training for module in model.modules()]
    rng = torch.get_rng_state().clone()
    original = model.forward
    calls = 0

    def failing(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic failure after dropout consumed random numbers")
        return original(*args)

    monkeypatch.setattr(model, "forward", failing)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        sample_positions(model, inputs, mask, dynamic, normalizer, 5, 16, 7)
    assert torch.equal(torch.get_rng_state(), rng)
    assert [module.training for module in model.modules()] == modes
