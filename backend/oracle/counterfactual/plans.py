"""Pure immutable branch materialization and owner-scoped bounded storage."""

import hashlib
import json
from collections import OrderedDict
from datetime import UTC, datetime
from uuid import uuid4

from oracle.counterfactual.schema import AnchorRequest, Branch, Change, CreateBranch, Plan, Snapshot
from oracle.prediction.metrics import compare
from oracle.session import Session
from oracle.world import EditEvent, Frame


def digest(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def capture_snapshot(session: Session, request: AnchorRequest) -> Plan:
    if (
        session.playing
        or session.generation != request.generation
        or session.engine.tick != request.anchor_tick
        or session.revision != request.revision
    ):
        raise RuntimeError("Pause the current world before capturing its snapshot")
    experiment = session.export()
    experiment.events = [e for e in experiment.events if e.tick <= experiment.playhead]
    experiment.duration = experiment.playhead
    return Plan(
        id=uuid4().hex,
        snapshot=Snapshot(
            created_at=datetime.now(UTC).isoformat(),
            source=request,
            experiment=experiment,
            frame=session.engine.frame().model_copy(deep=True),
        ),
        branches=[Branch(id="baseline", name="Observed baseline")],
    )


def lineage(plan: Plan, branch_id: str) -> list[Branch]:
    lookup = {b.id: b for b in plan.branches}
    result = []
    while branch_id is not None:
        if branch_id not in lookup:
            raise ValueError("This branch no longer exists")
        branch = lookup[branch_id]
        result.append(branch)
        branch_id = branch.parent_id
    return list(reversed(result))


def materialize(plan: Plan, branch_id: str) -> tuple[Frame, list[EditEvent]]:
    objects = {b.id: b.model_copy(deep=True) for b in plan.snapshot.frame.objects}
    used_ids = set(objects)
    events = []
    for branch in lineage(plan, branch_id):
        for change in branch.changes:
            if change.kind == "add":
                assert change.object is not None
                body = change.object.model_copy(deep=True)
                if body.id in used_ids:
                    raise ValueError("An added object must have a new identifier")
                used_ids.add(body.id)
            else:
                if change.object_id not in objects:
                    raise ValueError("An intervention refers to a missing object")
                body = objects[change.object_id]
                if change.kind == "update":
                    assert change.patch is not None
                    body = type(body).model_validate(
                        body.model_dump() | change.patch.model_dump(exclude_none=True)
                    )
            if change.kind == "remove":
                del objects[body.id]
                events.append(
                    EditEvent(tick=plan.snapshot.frame.tick, kind="remove", object_id=body.id)
                )
                continue
            if (
                max(abs(body.position.x), abs(body.position.y), abs(body.rotation)) > 1e6
                or max(abs(body.velocity.x), abs(body.velocity.y), abs(body.angular_velocity))
                > 1000
            ):
                raise ValueError(
                    "Intervention coordinates or velocities exceed the solver input range"
                )
            # Match PhysicsEngine.upsert insertion order, without constructing or running a solver.
            objects.pop(body.id, None)
            objects[body.id] = body
            if len(objects) > 64:
                raise ValueError("A branch supports up to 64 objects")
            events.append(EditEvent(tick=plan.snapshot.frame.tick, kind="upsert", object=body))
    if len(plan.snapshot.experiment.events) + len(events) > 512:
        raise ValueError("Source and branch edits exceed the experiment journal limit")
    return Frame(
        tick=plan.snapshot.frame.tick,
        objects=list(objects.values()),
        collisions=[] if events else plan.snapshot.frame.collisions.copy(),
    ), events


def branch_hash(plan: Plan, branch_id: str) -> str:
    return digest(
        {
            "snapshot": plan.snapshot.model_dump(mode="json"),
            "changes": [
                c.model_dump(mode="json") for b in lineage(plan, branch_id) for c in b.changes
            ],
        }
    )


def describe(plan: Plan) -> dict:
    return {
        "plan": plan.model_dump(mode="json"),
        "previews": {
            b.id: materialize(plan, b.id)[0].model_dump(mode="json") for b in plan.branches
        },
        "fingerprints": {b.id: branch_hash(plan, b.id) for b in plan.branches},
    }


def preview_change(plan: Plan, branch_id: str, changes: list[Change]) -> Frame:
    branch = Branch(id=uuid4().hex, name="Draft", parent_id=branch_id, changes=changes)
    draft = Plan.model_validate(plan.model_dump() | {"branches": [*plan.branches, branch]})
    return materialize(draft, branch.id)[0]


class PlanStore:
    def __init__(self):
        self.owners: dict[str, dict[str, Plan]] = {}
        self.futures: OrderedDict[tuple[str, str, str, str], dict] = OrderedDict()

    def discard_owner(self, owner: str) -> None:
        self.owners.pop(owner, None)
        for key in list(self.futures):
            if key[0] == owner:
                del self.futures[key]

    def record_future(self, owner: str, result: dict) -> dict | None:
        key = (owner, result["plan_id"], result["branch_id"], result["source"])
        self.futures[key] = result
        self.futures.move_to_end(key)
        while sum(len(json.dumps(f)) for f in self.futures.values()) > 16 * 1024 * 1024:
            self.futures.popitem(last=False)
        prefix = key[:3]
        prediction = self.futures.get((*prefix, "learned_model"))
        reality = self.futures.get((*prefix, "pymunk-7.2.0"))
        if (
            not prediction
            or not reality
            or any(
                prediction[k] != reality[k] for k in ("branch_sha256", "horizon", "sample_stride")
            )
        ):
            return None
        return {
            "model_sha256": prediction["model"]["sha256"],
            "branch_sha256": prediction["branch_sha256"],
            "metrics": compare(
                [Frame.model_validate(f) for f in prediction["frames"]],
                [Frame.model_validate(f) for f in reality["frames"]],
                prediction["anchor_frame"]["tick"],
                prediction["sample_dt"] / prediction["sample_stride"],
            ),
        }

    def get(self, owner: str, plan_id: str) -> Plan:
        return self.owners.get(owner, {})[plan_id].model_copy(deep=True)

    def put(self, owner: str, plan: Plan) -> dict:
        value = describe(plan)
        if len(json.dumps(plan.model_dump())) > 2 * 1024 * 1024:
            raise ValueError("This local plan exceeds the 2 MiB input limit")
        plans = self.owners.setdefault(owner, {})
        if plan.id not in plans and len(plans) >= 4:
            # Old sources remain exportable in the browser library; active server plans are bounded.
            evicted = next(iter(plans))
            plans.pop(evicted)
            for key in list(self.futures):
                if key[:2] == (owner, evicted):
                    del self.futures[key]
        plans[plan.id] = plan.model_copy(deep=True)
        return value

    def add(self, owner: str, plan_id: str, request: CreateBranch) -> dict:
        plan = self.get(owner, plan_id)
        branch = Branch(id=uuid4().hex, **request.model_dump())
        updated = Plan.model_validate(plan.model_dump() | {"branches": [*plan.branches, branch]})
        return self.put(owner, updated)
