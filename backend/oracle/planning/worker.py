"""Only known-past replay enters search; selected-action reality is a separate operation."""

import argparse
import json
import math
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from oracle.counterfactual.conditioning import condition_history
from oracle.counterfactual.plans import branch_hash, digest, materialize
from oracle.counterfactual.schema import Plan
from oracle.counterfactual.worker import execute as counterfactual_execute
from oracle.counterfactual.worker import replay_source
from oracle.planning.schema import SearchRequest
from oracle.planning.search import candidates, distance, rank
from oracle.prediction.schema import ModelDescription
from oracle.session import MAX_TICKS


def search(context: dict, checkpoint: Path) -> dict:
    import torch

    from oracle.models.inference import LearnedDynamics
    from oracle.prediction.catalog import ModelCatalog
    from oracle.training.checkpoint import file_hash

    started = time.perf_counter()
    source = Plan.model_validate(context["plan"])
    request = SearchRequest.model_validate(context["request"])
    description = ModelDescription.model_validate(context["model"])
    if request.model_id != description.id:
        raise ValueError("Planning model does not match the request")
    if ModelCatalog(checkpoint.parent.parent).describe(checkpoint.parent.name) != description:
        raise ValueError("The checkpoint changed. Refresh models and search again.")
    plan, actions = candidates(source, request)
    env = plan.snapshot.experiment.origin.environment
    if not all(
        math.isclose(a, b, abs_tol=1e-12)
        for a, b in zip((env.gravity.x, env.gravity.y), description.gravity, strict=True)
    ) or not math.isclose(env.dt * description.sample_stride, description.sample_dt, abs_tol=1e-12):
        raise ValueError("Planning model has a different gravity or observation clock")
    tick, stride = plan.snapshot.frame.tick, description.sample_stride
    start = tick - (description.architecture.history - 1) * stride
    last_edit = max((e.tick for e in plan.snapshot.experiment.events), default=0)
    if start < last_edit:
        raise ValueError("Record more real history after the last edit before searching")
    if tick + request.horizon * stride > MAX_TICKS:
        raise ValueError("Planning exceeds the 120-second experiment limit")
    _, history = replay_source(plan, set(range(start, tick + 1, stride)))
    observations = tuple(history[t] for t in range(start, tick + 1, stride))
    torch.set_num_threads(2)
    model = LearnedDynamics(checkpoint)
    model.model.eval()
    if file_hash(checkpoint) != description.sha256:
        raise ValueError("The checkpoint changed while its weights were loaded")
    rows, winner, winner_key = [], None, None
    for action in actions:
        anchor, _ = materialize(plan, action["id"])
        inputs, conditioning = condition_history(observations, anchor)
        frames = model.predict(inputs, None, request.horizon).frames
        score = distance(frames[-1], request.object_id, request.goal)
        row = {
            **action,
            "goal_distance_m": score,
            "predicted_within_goal": score <= request.goal.tolerance_m,
            "trajectory": [
                {
                    "tick": f.tick,
                    "position": next(
                        b for b in f.objects if b.id == request.object_id
                    ).position.model_dump(),
                }
                for f in (anchor, *frames)
            ],
        }
        rows.append(row)
        key = score, action["velocity_change_m_s"], action["input_order"]
        if winner_key is None or key < winner_key:
            winner_key = key
            winner = {
                "format": "oracle-counterfactual-future-v1",
                "source": "learned_model",
                "plan_id": plan.id,
                "branch_id": action["id"],
                "branch_sha256": branch_hash(plan, action["id"]),
                "created_at": datetime.now(UTC).isoformat(),
                "anchor_frame": anchor.model_dump(mode="json"),
                "horizon": request.horizon,
                "sample_stride": stride,
                "sample_dt": description.sample_dt,
                "frames": [f.model_dump(mode="json") for f in frames],
                "model": description.model_dump(mode="json"),
                "model_version": model.version,
                "conditioning": conditioning,
                "observations": [f.model_dump(mode="json") for f in observations],
                "conditioned_inputs": [f.model_dump(mode="json") for f in inputs],
                "uncertainty": None,
                "comparison": None,
                "elapsed_seconds": time.perf_counter() - started,
            }
    assert winner is not None
    return {
        "format": "oracle-planning-report-v1",
        "id": plan.id,
        "created_at": datetime.now(UTC).isoformat(),
        "algorithm": "velocity_grid_endpoint_v1",
        "objective": "terminal_position_distance_m",
        "tie_break": "goal_distance_m, velocity_change_m_s, input_order",
        "point_forecast": "deterministic_eval",
        "selection_source": "learned_model_only",
        "plan": plan.model_dump(mode="json"),
        "request": request.model_dump(mode="json"),
        "model": description.model_dump(mode="json"),
        "search_sha256": digest(
            {
                "plan": plan.model_dump(mode="json"),
                "request": request.model_dump(),
                "model": description.model_dump(mode="json"),
            }
        ),
        "runtime": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "device": "cpu",
            "threads": 2,
        },
        "candidates": rank(rows),
        "selected_id": winner["branch_id"],
        "prediction": winner,
        "verification": None,
        "elapsed_seconds": time.perf_counter() - started,
    }


def execute(context: dict, checkpoint: Path | None = None) -> dict:
    if context["operation"] == "search":
        if checkpoint is None:
            raise ValueError("Planning requires verified learned weights")
        return search(context, checkpoint)
    if context["operation"] == "reality":
        return counterfactual_execute({**context, "operation": "reality"})
    raise ValueError("Unknown planning operation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(2 * 1024 * 1024 + 1)
        if len(raw.encode("utf-8")) > 2 * 1024 * 1024:
            raise ValueError("Planning input exceeds 2 MiB")
        result = execute(json.loads(raw), args.checkpoint)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
        import traceback

        traceback.print_exc(file=sys.stderr)
        result = {
            "error": str(exc)
            if type(exc) is ValueError
            else "Planning failed. Check the source, goal and checkpoint."
        }
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
