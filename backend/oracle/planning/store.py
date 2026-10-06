"""Owner-scoped search reports; reality measures a fixed winner without re-ranking."""

import json
from collections import OrderedDict

from oracle.counterfactual.plans import branch_hash
from oracle.counterfactual.schema import Plan
from oracle.planning.schema import SearchRequest
from oracle.planning.search import distance
from oracle.prediction.metrics import compare
from oracle.world import Frame


def verification(report: dict, reality: dict) -> dict:
    plan = Plan.model_validate(report["plan"])
    request = SearchRequest.model_validate(report["request"])
    prediction = report["prediction"]
    if (
        reality["source"] != "pymunk-7.2.0"
        or reality["plan_id"] != plan.id
        or reality["branch_id"] != report["selected_id"]
        or reality["branch_sha256"] != branch_hash(plan, report["selected_id"])
        or reality["horizon"] != request.horizon
        or reality["sample_stride"] != prediction["sample_stride"]
    ):
        raise ValueError("Reality does not match the fixed learned selection")
    actual = [Frame.model_validate(f) for f in reality["frames"]]
    predicted = [Frame.model_validate(f) for f in prediction["frames"]]
    metrics = compare(
        predicted, actual, plan.snapshot.frame.tick, plan.snapshot.experiment.origin.environment.dt
    )
    actual_distance = distance(actual[-1], request.object_id, request.goal)
    selected = next(c for c in report["candidates"] if c["id"] == report["selected_id"])
    target = next(row for row in metrics["objects"] if row["id"] == request.object_id)
    return {
        "reality": reality,
        "actual_goal_distance_m": actual_distance,
        "actual_within_goal": actual_distance <= request.goal.tolerance_m,
        "goal_distance_error_m": actual_distance - selected["goal_distance_m"],
        "target_error": target,
        "metrics": metrics,
        "selection_updated": False,
    }


class PlanningStore:
    def __init__(self):
        self.reports: OrderedDict[tuple[str, str], dict] = OrderedDict()

    def get(self, owner: str, identity: str) -> dict:
        return self.reports[(owner, identity)]

    def put(self, owner: str, report: dict) -> dict:
        payload = json.dumps(report, allow_nan=False).encode()
        if len(payload) > 8 * 1024 * 1024:
            raise ValueError("Planning report exceeds the 8 MiB storage limit")
        key = owner, report["id"]
        self.reports[key] = report
        self.reports.move_to_end(key)
        owned = [k for k in self.reports if k[0] == owner]
        while len(owned) > 2:
            del self.reports[owned.pop(0)]
        while sum(len(json.dumps(r).encode()) for r in self.reports.values()) > 16 * 1024 * 1024:
            self.reports.popitem(last=False)
        return report

    def discard_owner(self, owner: str):
        for key in list(self.reports):
            if key[0] == owner:
                del self.reports[key]


def reality_context(report: dict) -> dict:
    return {
        "operation": "reality",
        "plan": report["plan"],
        "branch_id": report["selected_id"],
        "request": {
            "horizon": report["request"]["horizon"],
            "sample_stride": report["prediction"]["sample_stride"],
        },
    }
