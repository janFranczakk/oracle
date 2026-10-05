"""Teacher-forced one-step scoring and free autoregressive rollout on identical anchors."""

from pathlib import Path

import torch
from torch import Tensor
from torch.utils.data import DataLoader

from oracle.datasets.schema import Normalization, Split, Suite
from oracle.models.dynamics import ObjectDynamics
from oracle.training.data import SequenceDataset, collate
from oracle.training.metrics import Scores


def raw_features(values: Tensor, normalizer: Normalization) -> Tensor:
    return values * values.new_tensor(normalizer.scale) + values.new_tensor(normalizer.mean)


def normalized(values: Tensor, normalizer: Normalization) -> Tensor:
    return (values - values.new_tensor(normalizer.mean)) / values.new_tensor(normalizer.scale)


def constant_velocity(history: Tensor, dynamic: Tensor, normalizer: Normalization) -> Tensor:
    """Explicit analytical reference, never called an AI model; no gravity or collisions."""
    last = history[:, -1]
    raw = raw_features(last[..., :13], normalizer)
    dt = last[..., -1]
    future = raw.clone()
    future[..., :2] += raw[..., 2:4] * dt[..., None]
    angle = torch.atan2(raw[..., 4], raw[..., 5]) + raw[..., 6] * dt
    future[..., 4], future[..., 5] = torch.sin(angle), torch.cos(angle)
    return normalized(torch.where(dynamic[..., None], future, raw), normalizer)


def advance_history(history: Tensor, prediction: Tensor, normalizer: Normalization) -> Tensor:
    """Project angle representation onto its unit circle; this is encoding, not physics."""
    raw = raw_features(prediction, normalizer)
    direction = raw[..., 4:6]
    norm = direction.norm(dim=-1, keepdim=True)
    previous = raw_features(history[:, -1, :, :13], normalizer)[..., 4:6]
    raw[..., 4:6] = torch.where(norm > 1e-8, direction / norm.clamp_min(1e-8), previous)
    next_input = torch.cat((normalized(raw, normalizer), history[:, -1, :, 13:]), dim=-1)
    return torch.cat((history[:, 1:], next_input[:, None]), dim=1)


@torch.no_grad()
def evaluate_group(
    model: ObjectDynamics, data: SequenceDataset, horizons: list[int], device: str = "cpu"
) -> dict:
    model.eval()
    normalizer = data.normalizer
    learned_step, reference_step = Scores(), Scores()
    for batch in DataLoader(data, batch_size=128, collate_fn=collate):
        batch = batch.to(device)
        output = model(batch.inputs, batch.mask, batch.dynamic)
        actual = raw_features(batch.targets, normalizer)
        learned_step.add(
            raw_features(output.features, normalizer),
            actual,
            batch.dynamic,
            output.contact_logits,
            batch.contacts,
        )
        reference_step.add(
            raw_features(constant_velocity(batch.inputs, batch.dynamic, normalizer), normalizer),
            actual,
            batch.dynamic,
            torch.full_like(batch.contacts, -100),
            batch.contacts,
        )
    available = min(len(e.inputs) - data.history for e in data.episodes)
    supported = sorted(set(h for h in horizons if 1 <= h <= available))
    if not supported:
        raise ValueError("No evaluation horizon fits the recorded episodes")
    maximum = max(supported)
    anchors, samples, truths = [], [], []
    for episode in data.episodes:
        first, last = data.history - 1, len(episode.inputs) - maximum - 1
        for anchor in sorted({first, (first + last) // 2, last}):
            anchors.append({"episode_id": episode.id, "seed": episode.seed, "sample": anchor})
            samples.append(
                (
                    episode.inputs[anchor - data.history + 1 : anchor + 1],
                    episode.inputs[anchor, :, :13],
                    episode.contacts[anchor],
                    episode.dynamic,
                )
            )
            truths.append((episode, anchor))
    batch = collate(samples).to(device)
    learned_history, reference_history = batch.inputs, batch.inputs.clone()
    accumulated = {"learned": Scores(), "constant_velocity": Scores()}
    results = {"learned": [], "constant_velocity": []}
    for horizon in range(1, maximum + 1):
        actual = torch.zeros_like(batch.targets)
        contacts = torch.zeros_like(batch.contacts)
        for i, (episode, anchor) in enumerate(truths):
            n = len(episode.dynamic)
            actual[i, :n] = episode.inputs[anchor + horizon, :, :13].to(device)
            contacts[i, :n] = episode.contacts[anchor + horizon].to(device)
        output = model(learned_history, batch.mask, batch.dynamic)
        reference = constant_velocity(reference_history, batch.dynamic, normalizer)
        for name, predicted, logits in (
            ("learned", output.features, output.contact_logits),
            ("constant_velocity", reference, torch.full_like(contacts, -100)),
        ):
            score = Scores()
            p, a = raw_features(predicted, normalizer), raw_features(actual, normalizer)
            score.add(p, a, batch.dynamic, logits, contacts)
            accumulated[name].add(p, a, batch.dynamic, logits, contacts)
            if horizon in supported:
                result = score.result()
                results[name].append(
                    {
                        "horizon": horizon,
                        "seconds": horizon * data.dt,
                        **result,
                        "ade_m": accumulated[name].result()["displacement_m"],
                        "fde_m": result["displacement_m"],
                    }
                )
        learned_history = advance_history(learned_history, output.features, normalizer)
        reference_history = advance_history(reference_history, reference, normalizer)
    return {
        "episodes": len(data.episodes),
        "windows": len(data),
        "anchors": anchors,
        "sample_dt": data.dt,
        "omitted_horizons": sorted(set(horizons) - set(supported)),
        "one_step": {
            "learned": learned_step.result(),
            "constant_velocity": reference_step.result(),
        },
        "rollout": results,
    }


def evaluate_model(
    model: ObjectDynamics, root: Path, horizons: list[int], device: str = "cpu", progress=None
) -> dict:
    groups = [("validation", Split.VALIDATION, None), ("test", Split.TEST, None)]
    groups += [
        (f"ood/{suite.value}", Split.OOD, suite.value) for suite in Suite if suite != Suite.ID
    ]
    results = {}
    for index, (label, split, suite) in enumerate(groups):
        data = SequenceDataset(root, split, model.config.history, suite)
        results[label] = evaluate_group(model, data, horizons, device)
        if progress:
            progress(label, index + 1, len(groups))
    return {
        "protocol": "oracle-evaluation-v1",
        "source": "learned_model",
        "baseline": "constant_velocity",
        "groups": results,
    }
