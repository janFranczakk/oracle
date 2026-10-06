"""Separate prediction / explicit reality worker. Reality never loads PyTorch."""

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from oracle.counterfactual.conditioning import condition_history
from oracle.counterfactual.plans import branch_hash, materialize
from oracle.counterfactual.schema import ExecutionRequest, Plan
from oracle.physics import PhysicsEngine
from oracle.prediction.schema import ModelDescription
from oracle.session import MAX_TICKS
from oracle.world import Frame


def replay_source(
    plan: Plan, sample_ticks: set[int] | None = None
) -> tuple[PhysicsEngine, dict[int, Frame]]:
    experiment, anchor = plan.snapshot.experiment, plan.snapshot.frame
    engine = PhysicsEngine(experiment.origin)
    events = {}
    for event in experiment.events:
        events.setdefault(event.tick, []).append(event)
    history = {}
    for tick in range(anchor.tick + 1):
        for event in events.get(tick, []):
            engine.apply(event)
        if sample_ticks is not None and tick in sample_ticks:
            history[tick] = engine.frame()
        if tick < anchor.tick:
            engine.step()
    if engine.frame().objects != anchor.objects:
        raise ValueError("Snapshot does not match its source experiment replay")
    return engine, history


def execute(context: dict, checkpoint: Path | None = None) -> dict:
    started = time.perf_counter()
    plan = Plan.model_validate(context["plan"])
    operation = context["operation"]
    samples = None
    if operation == "predict":
        description = ModelDescription.model_validate(context["model"])
        tick, stride = plan.snapshot.frame.tick, description.sample_stride
        start = tick - (description.architecture.history - 1) * stride
        last_edit = max((e.tick for e in plan.snapshot.experiment.events), default=0)
        if start < last_edit:
            raise ValueError(
                "Snapshot has insufficient real history after its last edit. "
                "Capture a later source."
            )
        samples = set(range(start, tick + 1, stride))
    engine, history = replay_source(plan, samples)
    if operation == "validate":
        for branch in plan.branches:
            materialize(plan, branch.id)
        return {"valid": True}
    if operation not in {"predict", "reality"}:
        raise ValueError("Unknown counterfactual operation")
    branch_id = context["branch_id"]
    anchor, edits = materialize(plan, branch_id)
    request = ExecutionRequest.model_validate(context["request"])
    model_data = None
    if operation == "predict":
        import torch

        from oracle.models.inference import LearnedDynamics
        from oracle.prediction.catalog import ModelCatalog
        from oracle.training.checkpoint import file_hash

        if checkpoint is None:
            raise ValueError("Prediction requires verified model weights")
        torch.set_num_threads(2)
        description = ModelDescription.model_validate(context["model"])
        if description.id != request.model_id or request.sample_stride != description.sample_stride:
            raise ValueError("Prediction clock or model does not match the request")
        if ModelCatalog(checkpoint.parent.parent).describe(checkpoint.parent.name) != description:
            raise ValueError("The checkpoint changed. Refresh models and predict again.")
        env = plan.snapshot.experiment.origin.environment
        if (env.gravity.x, env.gravity.y) != description.gravity:
            raise ValueError("This model was trained with different gravity")
        model = LearnedDynamics(checkpoint)
        if file_hash(checkpoint) != description.sha256:
            raise ValueError("The checkpoint changed while its weights were loaded")
        stride = request.sample_stride
        observations = tuple(history[t] for t in range(start, anchor.tick + 1, stride))
        inputs, conditioning = condition_history(observations, anchor)
        if not any(not b.static for b in anchor.objects):
            raise ValueError("A learned forecast needs at least one dynamic object")
        if anchor.tick + request.horizon * stride > MAX_TICKS:
            raise ValueError("This future exceeds the 120-second experiment limit")
        predicted = model.predict(inputs, None, request.horizon)
        frames = [Frame.model_validate(f.model_dump()) for f in predicted.frames]
        model_data = description.model_dump(mode="json")
        diagnostics = model.diagnostics(
            inputs, request.horizon, request.samples, request.sampling_seed
        )
        extra = {
            **diagnostics,
            "model": model_data,
            "model_version": model.version,
            "conditioning": conditioning,
            "observations": [f.model_dump(mode="json") for f in observations],
            "conditioned_inputs": [f.model_dump(mode="json") for f in inputs],
        }
    else:
        if anchor.tick + request.horizon * request.sample_stride > MAX_TICKS:
            raise ValueError("This future exceeds the 120-second experiment limit")
        for event in edits:
            engine.apply(event)
        if engine.frame().objects != anchor.objects:
            raise ValueError("Physical intervention does not match the branch preview")
        frames = []
        for _ in range(request.horizon):
            contacts = set()
            for _ in range(request.sample_stride):
                frame = engine.step()
                contacts.update(frame.collisions)
            frames.append(frame.model_copy(update={"collisions": sorted(contacts)}))
        extra = {"conditions": "branch_interventions_at_source_anchor"}
    return {
        "format": "oracle-counterfactual-future-v1",
        "source": "learned_model" if operation == "predict" else "pymunk-7.2.0",
        "plan_id": plan.id,
        "branch_id": branch_id,
        "branch_sha256": branch_hash(plan, branch_id),
        "created_at": datetime.now(UTC).isoformat(),
        "anchor_frame": anchor.model_dump(mode="json"),
        "horizon": request.horizon,
        "sample_stride": request.sample_stride,
        "sample_dt": request.sample_stride * plan.snapshot.experiment.origin.environment.dt,
        "frames": [f.model_dump(mode="json") for f in frames],
        "uncertainty": None,
        "elapsed_seconds": time.perf_counter() - started,
        **extra,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("Counterfactual worker input exceeds 2 MiB")
        result = execute(json.loads(raw), args.checkpoint)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
        import traceback

        traceback.print_exc(file=sys.stderr)
        result = {
            "error": str(exc)
            if isinstance(exc, ValueError) and exc.__class__ is ValueError
            else "Counterfactual execution failed. Check the source and intervention values."
        }
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
