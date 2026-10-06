"""Pure candidate generation and endpoint objective; no dynamics or model imports."""

import math

from oracle.counterfactual.plans import materialize
from oracle.counterfactual.schema import Branch, Change, ObjectPatch, Plan
from oracle.planning.schema import Goal, SearchRequest
from oracle.world import Frame, Vec2


def candidates(source: Plan, request: SearchRequest) -> tuple[Plan, list[dict]]:
    if source.snapshot.source.model_dump() != request.model_dump(
        include={"generation", "anchor_tick", "revision"}
    ):
        raise ValueError("Planning request does not match its frozen source")
    frame = source.snapshot.frame
    body = next((b for b in frame.objects if b.id == request.object_id), None)
    if body is None or body.static:
        raise ValueError("Choose a dynamic object from the captured source")
    if len(frame.objects) > 32 or 9 * request.horizon * len(frame.objects) > 32768:
        raise ValueError("Planning supports ≤32 objects and ≤32768 candidate object-steps")
    root = Branch(id="baseline", name="Unchanged velocity")
    branches, actions = [root], []
    offsets = [(0, 0)] + [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1) if x or y]
    for index, (dx, dy) in enumerate(offsets):
        velocity = Vec2(
            x=body.velocity.x + dx * request.velocity_delta,
            y=body.velocity.y + dy * request.velocity_delta,
        )
        if max(abs(velocity.x), abs(velocity.y)) > 100:
            raise ValueError("Candidate velocity components must stay within ±100 m/s")
        identity = "baseline" if index == 0 else f"action-{index:02d}"
        if index:
            branches.append(
                Branch(
                    id=identity,
                    name=f"Velocity offset {dx:+d}, {dy:+d}",
                    parent_id="baseline",
                    changes=[
                        Change(
                            kind="update",
                            object_id=body.id,
                            patch=ObjectPatch(velocity=velocity),
                        )
                    ],
                )
            )
        actions.append(
            {
                "id": identity,
                "velocity": velocity.model_dump(),
                "delta": {"x": dx * request.velocity_delta, "y": dy * request.velocity_delta},
                "velocity_change_m_s": math.hypot(dx, dy) * request.velocity_delta,
                "input_order": index,
            }
        )
    plan = Plan(id=source.id, snapshot=source.snapshot.model_copy(deep=True), branches=branches)
    for action in actions:
        materialize(plan, action["id"])
    return plan, actions


def distance(frame: Frame, identity: str, goal: Goal) -> float:
    body = next(b for b in frame.objects if b.id == identity)
    result = math.hypot(body.position.x - goal.x, body.position.y - goal.y)
    if not math.isfinite(result):
        raise ValueError("The goal objective became non-finite")
    return result


def rank(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (row["goal_distance_m"], row["velocity_change_m_s"], row["input_order"]),
    )
