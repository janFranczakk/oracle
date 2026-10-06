"""Seed orchestration around unchanged validation-selected training; fixed evaluation schedule."""

import statistics
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator

from oracle.benchmarking.artifacts import ExperimentOutput, write_csv
from oracle.benchmarking.statistics import CI_METHOD, summarize
from oracle.datasets.engine import verify_dataset
from oracle.datasets.storage import digest, read_json, read_manifest, write_json
from oracle.training.schema import TrainConfig
from oracle.world import StrictModel


class MultiSeedConfig(StrictModel):
    families: list[Literal["mlp", "gru", "transformer"]] = Field(
        default_factory=lambda: ["mlp", "gru", "transformer"], min_length=1, max_length=3
    )
    seeds: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5], min_length=1, max_length=10)
    training: TrainConfig = Field(default_factory=lambda: TrainConfig(epochs=35))
    deadline_seconds: int = Field(default=3600, ge=1, le=14400)

    @field_validator("seeds")
    @classmethod
    def valid_seeds(cls, values):
        if len(values) != len(set(values)) or any(not 0 <= s <= 2**32 - 1 for s in values):
            raise ValueError("Training seeds must be distinct unsigned 32-bit integers")
        return values

    @model_validator(mode="after")
    def bounded(self):
        if len(self.families) != len(set(self.families)):
            raise ValueError("Model families must be distinct")
        if self.training.device != "cpu" or self.training.threads > 2 or self.training.epochs > 120:
            raise ValueError("Seed study supports CPU, at most two threads and 120 epochs per run")
        return self


def schedule(groups: dict) -> dict:
    return {
        name: digest(
            {
                "anchors": group["anchors"],
                "windows": group["windows"],
                "horizons": [r["horizon"] for r in group["rollout"]["learned"]],
                "omitted_horizons": group["omitted_horizons"],
                "sample_dt": group["sample_dt"],
            }
        )
        for name, group in groups.items()
    }


def flatten(groups: dict) -> dict[tuple, float | None]:
    values = {}
    for group, result in groups.items():
        for scope, rows in (
            ("one_step", [result["one_step"]["learned"]]),
            ("rollout", result["rollout"]["learned"]),
        ):
            for row in rows:
                horizon = row.get("horizon", 1)
                for metric, value in row.items():
                    if metric in {"horizon", "seconds", "objects_scored", "contact_counts"}:
                        continue
                    values[group, scope, horizon, metric] = value
    # Each seed supplies one equal-suite OOD FDE. Suites are not independent seed repeats.
    horizons = {
        h
        for (group, scope, h, metric) in values
        if group.startswith("ood/") and scope == "rollout" and metric == "fde_m"
    }
    for horizon in horizons:
        fdes = [
            v
            for (g, s, h, m), v in values.items()
            if g.startswith("ood/") and s == "rollout" and h == horizon and m == "fde_m"
        ]
        values["ood/macro", "rollout", horizon, "fde_m"] = statistics.mean(fdes)
    return values


def aggregate_family(runs: list[dict]) -> list[dict]:
    flattened = [flatten(r["evaluation"]["groups"]) for r in runs]
    if any(set(v) != set(flattened[0]) for v in flattened):
        raise ValueError("Runs do not have identical metric schedules")
    return [
        {
            "group": g,
            "scope": s,
            "horizon": h,
            "metric": m,
            "statistics": summarize([v[g, s, h, m] for v in flattened], confidence=True),
        }
        for g, s, h, m in flattened[0]
    ]


def run_study(
    dataset: Path,
    output: Path,
    config: MultiSeedConfig,
    progress: Callable[[dict], None] | None = None,
) -> dict:
    from oracle.datasets.schema import Split
    from oracle.training.checkpoint import load_checkpoint
    from oracle.training.data import SequenceDataset
    from oracle.training.engine import dataset_identity, runtime_identity, train

    verify_dataset(dataset)
    manifest = read_manifest(dataset)
    if manifest.config.total > 512 or manifest.config.steps > 1200:
        raise ValueError("Seed study supports at most 512 episodes and 1200 ticks per episode")
    windows = manifest.config.train * (
        manifest.config.steps // manifest.config.sample_stride + 1 - config.training.model.history
    )
    work = windows * config.training.epochs * len(config.families) * len(config.seeds)
    if windows < 1 or work > 10_000_000:
        raise ValueError("Seed study exceeds the ten million training-window work cap")
    identity = dataset_identity(
        SequenceDataset(dataset, Split.TRAIN, config.training.model.history)
    )
    store = ExperimentOutput(
        output,
        config.model_dump(mode="json"),
        len(config.families) * len(config.seeds),
        config.deadline_seconds,
    )
    provenance = {
        "dataset": identity,
        "runtime": runtime_identity(config.training),
        "training_window_cap": 10_000_000,
        "estimated_training_windows": work,
        "selection": "best validation objective only; test/OOD evaluated after selection",
        "confidence_method": CI_METHOD,
        "std_method": "sample standard deviation, ddof=1",
    }
    write_json(output / "provenance.json", provenance)
    grouped = defaultdict(list)
    schedules, completed = None, 0
    try:
        for family in config.families:
            for seed in config.seeds:
                name = f"{family}-seed-{seed}"
                store.progress(completed, run=name)
                if progress:
                    progress(store.status.copy())
                model = config.training.model.model_copy(update={"family": family})
                training = TrainConfig.model_validate(
                    {
                        **config.training.model_dump(mode="json"),
                        "seed": seed,
                        "model": model.model_dump(mode="json"),
                    }
                )
                root = output / "runs" / name
                started = time.perf_counter()
                train(dataset, root, training)
                _, metadata = load_checkpoint(root / "best.pt", identity)
                evaluation = read_json(root / "evaluation.json")
                current = schedule(evaluation["groups"])
                if schedules is not None and current != schedules:
                    raise ValueError("Seed/family evaluation changed the common anchor schedule")
                schedules = current
                if metadata["config"] != training.model_dump(mode="json"):
                    raise ValueError("Run provenance differs from requested training configuration")
                record = {
                    "id": name,
                    "family": family,
                    "seed": seed,
                    "checkpoint": str(Path("runs") / name / "best.pt"),
                    "checkpoint_sha256": read_json(root / "best.metadata.json")["sha256"],
                    "selected_epoch": metadata["epoch"],
                    "best_validation": metadata["best_validation"],
                    "config": training.model_dump(mode="json"),
                    "elapsed_seconds": time.perf_counter() - started,
                    "evaluation": evaluation,
                }
                grouped[family].append(record)
                completed += 1
                store.progress(completed, run=name)
                write_json(
                    output / "completed_runs.json",
                    {"runs": [r for rows in grouped.values() for r in rows]},
                )
                if progress:
                    progress(store.status.copy())
        families = [
            {
                "family": family,
                "seeds": config.seeds,
                "runs": grouped[family],
                "metrics": aggregate_family(grouped[family]),
            }
            for family in config.families
        ]
        report = {
            "format": "oracle-multiseed-v1",
            "id": output.name,
            "config": config.model_dump(mode="json"),
            "provenance": provenance,
            "schedule_sha256": schedules,
            "families": families,
            "elapsed_seconds": time.perf_counter() - store.started,
            "interpretation": "Repeated training seeds on one fixed dataset/configuration. "
            "No test/OOD selection, no architecture superiority or significance claim. "
            "MC dropout remains uncalibrated and is separate from the mean CI.",
        }
        rows = []
        for family in families:
            for entry in family["metrics"]:
                stats = entry["statistics"]
                ci = stats["mean_ci95"]
                rows.append(
                    {
                        "family": family["family"],
                        **{k: v for k, v in entry.items() if k != "statistics"},
                        **{k: v for k, v in stats.items() if k != "mean_ci95"},
                        "mean_ci95_lower": ci[0] if ci else None,
                        "mean_ci95_upper": ci[1] if ci else None,
                    }
                )
        write_csv(output / "summary.csv", rows)
        store.finish(report)
        return report
    except Exception as error:
        store.fail(error)
        raise
