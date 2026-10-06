"""Fixed protocol, first/middle/last held-out anchors; no calibration or test selection."""

from pathlib import Path

import torch

from oracle.datasets.schema import Split, Suite
from oracle.models.sampling import position_statistics, sample_positions
from oracle.prediction.uncertainty import interval_scores
from oracle.training.data import SequenceDataset, collate
from oracle.training.evaluation import raw_features


@torch.no_grad()
def evaluate_uncertainty(model, root: Path, horizons: list[int], seed: int, device="cpu") -> dict:
    groups = [("test", Split.TEST, None)] + [
        (f"ood/{suite.value}", Split.OOD, suite.value) for suite in Suite if suite != Suite.ID
    ]
    results = {}
    for label, split, suite in groups:
        data = SequenceDataset(root, split, model.config.history, suite)
        available = min(len(e.inputs) - data.history for e in data.episodes)
        supported = sorted(h for h in horizons if h <= available)
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
        # Chunk by scene so the same bounded sampler works on large offline datasets.
        collected = {
            h: {key: [] for key in ("lower", "upper", "mean", "std", "truth")} for h in supported
        }
        for index, sample in enumerate(samples):
            batch = collate([sample]).to(device)
            stats = position_statistics(
                sample_positions(
                    model,
                    batch.inputs,
                    batch.mask,
                    batch.dynamic,
                    data.normalizer,
                    maximum,
                    16,
                    (seed + index) % 2**32,
                )
            )
            episode, anchor = truths[index]
            for h in supported:
                for key in ("lower", "upper", "mean", "std"):
                    collected[h][key].extend(stats[key][0, h - 1, batch.dynamic[0]].cpu().tolist())
                collected[h]["truth"].extend(
                    raw_features(episode.inputs[anchor + h, :, :13], data.normalizer)[
                        episode.dynamic, :2
                    ].tolist()
                )
        results[label] = {
            "episodes": len(data.episodes),
            "anchors": anchors,
            "omitted_horizons": sorted(set(horizons) - set(supported)),
            "horizons": [
                {"horizon": h, "seconds": h * data.dt, **interval_scores(**collected[h])}
                for h in supported
            ],
        }
    return {
        "protocol": "oracle-uncertainty-evaluation-v1",
        "method": "mc_dropout_autoregressive_v1",
        "samples": 16,
        "seed": seed,
        "seed_rule": "base_plus_anchor_index_per_group_mod_uint32",
        "quantiles": [0.05, 0.95],
        "nominal_marginal_coverage": 0.9,
        "calibrated": False,
        "dropout": model.config.dropout,
        "groups": results,
    }
