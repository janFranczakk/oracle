"""Source histories -> learned futures -> separate Pymunk futures -> measured errors."""

import hashlib
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

from pydantic import Field, field_validator, model_validator

from oracle.benchmarking.artifacts import ExperimentOutput, write_csv
from oracle.benchmarking.scenarios import INTERVENTIONS, intervention
from oracle.benchmarking.statistics import summarize
from oracle.counterfactual.plans import capture_snapshot, materialize
from oracle.counterfactual.schema import AnchorRequest, Branch, Plan
from oracle.counterfactual.worker import execute
from oracle.datasets.sampling import sample_world
from oracle.datasets.schema import SamplingRanges
from oracle.datasets.storage import digest, write_json
from oracle.prediction.catalog import ModelCatalog
from oracle.prediction.metrics import compare
from oracle.session import Session
from oracle.world import Frame, StrictModel

METRICS = (
    "ade_m",
    "fde_m",
    "position_mse",
    "velocity_mse",
    "rotation_mae_rad",
    "contact_accuracy",
    "contact_balanced_accuracy",
)


class BenchmarkConfig(StrictModel):
    scenes: int = Field(default=24, ge=1, le=100)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    anchor_tick: int = Field(default=60, ge=0, le=600)
    horizons: list[int] = Field(default_factory=lambda: [10, 50], min_length=1, max_length=8)
    interventions: list[str] = Field(default_factory=lambda: list(INTERVENTIONS), min_length=1)
    deadline_seconds: int = Field(default=1800, ge=1, le=3600)

    @field_validator("horizons")
    @classmethod
    def valid_horizons(cls, values):
        if len(set(values)) != len(values) or any(not 1 <= h <= 120 for h in values):
            raise ValueError("Choose distinct horizons from 1 to 120")
        return sorted(values)

    @field_validator("interventions")
    @classmethod
    def valid_interventions(cls, values):
        if len(set(values)) != len(values) or any(v not in INTERVENTIONS for v in values):
            raise ValueError("Choose distinct supported intervention names")
        return values

    @model_validator(mode="after")
    def work_limit(self):
        if self.scenes * len(self.interventions) > 500:
            raise ValueError(
                "Limit is 500 source/intervention combinations; reduce scenes or cases"
            )
        return self


def source_seed(master: int, index: int) -> int:
    key = f"oracle-counterfactual-benchmark-v1:{master}:{index}".encode()
    return int.from_bytes(hashlib.sha256(key).digest()[:4], "big")


def source_plan(seed: int, tick: int) -> tuple[Session, Plan]:
    session = Session(sample_world(seed, SamplingRanges()))
    if tick:
        session.advance(tick)
    plan = capture_snapshot(
        session,
        AnchorRequest(generation=session.generation, revision=session.revision, anchor_tick=tick),
    )
    return session, plan


def aggregate(rows: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[(row["checkpoint_id"], row["intervention"], row["horizon"])].append(row)
    result = []
    for (model, case, horizon), values in groups.items():
        scored = [r for r in values if r["status"] == "evaluated"]
        result.append(
            {
                "checkpoint_id": model,
                "intervention": case,
                "horizon": horizon,
                "type": values[0]["type"],
                "units": values[0]["units"],
                "scenes": len(scored),
                "unsupported": len(values) - len(scored),
                "magnitude": summarize(r["magnitude"] for r in scored),
                "metrics": {
                    metric: summarize(r["metrics"][metric] for r in scored) for metric in METRICS
                },
            }
        )
    return result


def run_benchmark(
    checkpoints: list[Path],
    output: Path,
    config: BenchmarkConfig,
    progress: Callable[[dict], None] | None = None,
) -> dict:
    # Preflight before touching output. The CLI has no API launch route.
    if not 1 <= len(checkpoints) <= 3:
        raise ValueError("Choose one to three checkpoints")
    if len({p.resolve() for p in checkpoints}) != len(checkpoints):
        raise ValueError("Checkpoint paths must be distinct")
    from oracle.training.checkpoint import load_checkpoint
    from oracle.training.engine import runtime_identity
    from oracle.training.schema import TrainConfig

    loaded = []
    for path in checkpoints:
        if path.name != "best.pt":
            raise ValueError("Use validation-selected best.pt from a completed training run")
        description = ModelCatalog(path.parent.parent).describe(path.parent.name)
        _, metadata = load_checkpoint(path)
        loaded.append((path, description, metadata))
    if len({d.id for _, d, _ in loaded}) != len(loaded):
        raise ValueError("Checkpoint identifiers must be distinct")
    clocks = {
        (d.sample_stride, d.sample_dt, d.gravity, d.dataset_sha256, d.normalization_sha256)
        for _, d, _ in loaded
    }
    if len(clocks) != 1:
        raise ValueError(
            "Checkpoints must share dataset, normalizer, gravity and observation clock"
        )
    stride = loaded[0][1].sample_stride
    anchor = max(
        config.anchor_tick, max((d.architecture.history - 1) * stride for _, d, _ in loaded)
    )
    if anchor > 600 or anchor + max(config.horizons) * stride > 14400:
        raise ValueError("History/future exceeds benchmark clock bounds")
    # Conservative cap includes every solver substep, body and learned observation.
    work = (
        config.scenes
        * len(config.interventions)
        * len(loaded)
        * 64
        * (anchor + max(config.horizons) * stride)
    )
    if work > 100_000_000:
        raise ValueError("Benchmark exceeds the 100 million body-step work cap")
    seeds = [source_seed(config.seed, i) for i in range(config.scenes)]
    if len(set(seeds)) != len(seeds):
        raise ValueError("Derived world seeds collide; choose another master seed")
    store = ExperimentOutput(
        output,
        config.model_dump(mode="json"),
        config.scenes * len(config.interventions) * len(loaded),
        config.deadline_seconds,
    )
    runtime = runtime_identity(TrainConfig(threads=2))
    provenance = {
        "models": [
            {**d.model_dump(mode="json"), "training_seed": m["config"]["seed"]}
            for _, d, m in loaded
        ],
        "runtime": runtime,
        "world_seeds": seeds,
        "anchor_tick": anchor,
        "cpu_threads": 2,
        "body_step_cap": 100_000_000,
        "estimated_body_steps_upper_bound": work,
        "sampling_ranges": SamplingRanges().model_dump(mode="json"),
    }
    write_json(output / "provenance.json", provenance)
    rows, sources = [], []
    completed = 0
    try:
        for index, seed in enumerate(seeds):
            store.progress(completed, world=index)
            session, baseline = source_plan(seed, anchor)
            source = {
                "origin": session.origin.model_dump(mode="json"),
                "frame": baseline.snapshot.frame.model_dump(mode="json"),
                "events": [e.model_dump(mode="json") for e in session.events],
            }
            source_hash = digest(source)
            sources.append({"seed": seed, "sha256": source_hash, "source": source})
            for case in config.interventions:
                item = intervention(case, baseline.snapshot.frame)
                plan = baseline.model_copy(deep=True)
                branch = "baseline"
                if item.changes:
                    branch = "case"
                    plan = Plan.model_validate(
                        {
                            **plan.model_dump(mode="json"),
                            "branches": [
                                plan.branches[0].model_dump(mode="json"),
                                Branch(
                                    id=branch,
                                    name=case,
                                    parent_id="baseline",
                                    changes=list(item.changes),
                                ).model_dump(mode="json"),
                            ],
                        }
                    )
                preview = materialize(plan, branch)[0]
                for path, model, metadata in loaded:
                    store.progress(completed, world=index, intervention=case, model=model.id)
                    info = {
                        "world_seed": seed,
                        "source_sha256": source_hash,
                        "source_anchor": anchor,
                        "intervention": case,
                        "type": item.type,
                        "magnitude": item.magnitude,
                        "units": item.units,
                        "changes": [c.model_dump(mode="json") for c in item.changes],
                        "checkpoint_id": model.id,
                        "checkpoint_sha256": model.sha256,
                        "dataset_id": model.dataset_id,
                        "dataset_sha256": model.dataset_sha256,
                        "training_seed": metadata["config"]["seed"],
                        "objects": len(preview.objects),
                        "dynamic_objects": sum(not b.static for b in preview.objects),
                        "sample_stride": stride,
                        "sample_dt": model.sample_dt,
                    }
                    predictions = reality = None
                    if not item.unsupported:
                        context = {
                            "plan": plan.model_dump(mode="json"),
                            "branch_id": branch,
                            "request": {
                                "horizon": max(config.horizons),
                                "sample_stride": stride,
                                "model_id": model.id,
                            },
                            "model": model.model_dump(mode="json"),
                            "operation": "predict",
                        }
                        # Replay known past only. Generate the physical future afterwards.
                        predictions = execute(context, path)
                        reality = execute({**context, "operation": "reality"})
                    for horizon in config.horizons:
                        metrics = None
                        if predictions:
                            metrics = compare(
                                [Frame.model_validate(f) for f in predictions["frames"][:horizon]],
                                [Frame.model_validate(f) for f in reality["frames"][:horizon]],
                                anchor,
                                session.origin.environment.dt,
                            )["summary"]
                        row = {
                            **info,
                            "horizon": horizon,
                            "status": "unsupported" if item.unsupported else "evaluated",
                            "reason": item.unsupported,
                            "metrics": metrics,
                            "prediction_seconds": predictions["elapsed_seconds"]
                            if predictions
                            else None,
                            "reality_seconds": reality["elapsed_seconds"] if reality else None,
                        }
                        row["case_sha256"] = digest(
                            {
                                "source": source_hash,
                                "changes": info["changes"],
                                "checkpoint": model.sha256,
                                "horizon": horizon,
                                "stride": stride,
                                "intervention": case,
                            }
                        )
                        rows.append(row)
                    completed += 1
                    store.progress(completed)
                    if progress:
                        progress(store.status.copy())
            if session.engine.frame() != baseline.snapshot.frame:
                raise AssertionError("Benchmark modified its live source")
            write_json(output / "cases.json", {"cases": rows})
        aggregates = aggregate(rows)
        report = {
            "format": "oracle-counterfactual-benchmark-v1",
            "config": config.model_dump(mode="json"),
            "provenance": provenance,
            "sources": sources,
            "cases": rows,
            "aggregates": aggregates,
            "elapsed_seconds": time.perf_counter() - store.started,
            "protocol": "Equal-scene statistics; dynamic objects; periodic rotation; contact "
            "balanced accuracy null when either class is absent. All conditioning is exploratory: "
            "intervention_trained=false. Initial sampler ranges do not certify "
            "distribution membership.",
        }
        write_csv(
            output / "summary.csv",
            [
                {
                    "checkpoint_id": a["checkpoint_id"],
                    "intervention": a["intervention"],
                    "type": a["type"],
                    "horizon": a["horizon"],
                    "scenes": a["scenes"],
                    "unsupported": a["unsupported"],
                    "magnitude_mean": a["magnitude"]["mean"],
                    "magnitude_std": a["magnitude"]["std"],
                    "metric": metric,
                    **{k: v for k, v in stats.items() if k != "mean_ci95"},
                }
                for a in aggregates
                for metric, stats in a["metrics"].items()
            ],
        )
        write_csv(
            output / "cases.csv",
            [
                {
                    **{k: v for k, v in r.items() if k not in {"changes", "metrics"}},
                    **{m: r["metrics"][m] if r["metrics"] else None for m in METRICS},
                }
                for r in rows
            ],
        )
        store.finish(report)
        return report
    except Exception as error:
        store.fail(error)
        raise
