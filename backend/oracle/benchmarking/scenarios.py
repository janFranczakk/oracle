"""Deterministic interventions on known anchors. Geometry checks use no future physics."""

import math
from dataclasses import dataclass

from oracle.counterfactual.schema import Change, ObjectPatch
from oracle.world import BodyState, Frame, Shape, Vec2

INTERVENTIONS = (
    "baseline",
    "mass_0.75",
    "mass_1.25",
    "mass_2",
    "velocity_0.75",
    "velocity_1.25",
    "velocity_1.5",
    "velocity_direction",
    "friction_down",
    "friction_up",
    "restitution_down",
    "restitution_up",
    "static_translate",
    "ramp_rotate",
    "static_add",
    "static_remove",
    "dynamic_duplicate",
    "dynamic_remove",
)


@dataclass(frozen=True)
class Intervention:
    id: str
    type: str
    magnitude: float | None
    units: str
    changes: tuple[Change, ...] = ()
    unsupported: str | None = None


def bounds(body: BodyState) -> tuple[float, float, float, float]:
    if body.shape == Shape.CIRCLE:
        x = y = body.radius
    else:
        c, s = abs(math.cos(body.rotation)), abs(math.sin(body.rotation))
        x, y = (c * body.width + s * body.height) / 2, (s * body.width + c * body.height) / 2
    return body.position.x - x, body.position.y - y, body.position.x + x, body.position.y + y


def fits(body: BodyState, objects: list[BodyState]) -> bool:
    a = bounds(body)
    if not (0.25 <= a[0] < a[2] <= 23.75 and 0.25 <= a[1] < a[3] <= 13.75):
        return False
    for other in objects:
        if other.id == body.id:
            continue
        b = bounds(other)
        if a[0] < b[2] + 0.1 and a[2] + 0.1 > b[0] and a[1] < b[3] + 0.1 and a[3] + 0.1 > b[1]:
            return False
    return True


def place(body: BodyState, objects: list[BodyState]) -> BodyState | None:
    for y in (5, 8, 11, 2):
        for x in (12, 18, 6, 21, 3, 9, 15):
            candidate = body.model_copy(update={"position": Vec2(x=x, y=y)})
            if fits(candidate, objects):
                return candidate
    return None


def intervention(identity: str, frame: Frame) -> Intervention:
    if identity not in INTERVENTIONS:
        raise ValueError("Unknown intervention")
    kind = identity.split("_")[0]
    dynamic = next((b for b in frame.objects if not b.static), None)
    obstacle = next((b for b in frame.objects if b.static and b.id.startswith("obstacle-")), None)
    changes = []
    magnitude, units = None, "none"
    reason = None
    if identity == "baseline":
        return Intervention(identity, kind, 0, units)
    if dynamic is None:
        return Intervention(identity, kind, None, units, unsupported="No dynamic target")
    if kind in {"mass", "velocity"}:
        if identity == "velocity_direction":
            magnitude, units = math.pi / 2, "radians"
            velocity = Vec2(x=-dynamic.velocity.y, y=dynamic.velocity.x)
            if math.hypot(velocity.x, velocity.y) < 1e-9:
                reason = "Direction is undefined for zero velocity"
        else:
            magnitude, units = float(identity.split("_")[1]), "factor"
            velocity = Vec2(x=dynamic.velocity.x * magnitude, y=dynamic.velocity.y * magnitude)
        patch = {"mass": dynamic.mass * magnitude} if kind == "mass" else {"velocity": velocity}
        if kind == "mass" and not 0.05 <= patch["mass"] <= 100:
            reason = "Mass factor exceeds the supported bounds"
        if not reason:
            changes = [Change(kind="update", object_id=dynamic.id, patch=ObjectPatch(**patch))]
    elif kind in {"friction", "restitution"}:
        value = getattr(dynamic, kind)
        target = value / 2 if identity.endswith("down") else min(1, value + 0.2)
        magnitude, units = target - value, "absolute_delta"
        if abs(magnitude) < 1e-12:
            reason = "Material parameter already at the requested boundary"
        else:
            changes = [
                Change(kind="update", object_id=dynamic.id, patch=ObjectPatch(**{kind: target}))
            ]
    elif identity in {"static_translate", "ramp_rotate", "static_remove"}:
        kind = "geometry" if identity != "static_remove" else "structural"
        if obstacle is None:
            reason = "Source has no procedural static obstacle"
        elif identity == "static_remove":
            magnitude, units = -1, "objects"
            changes = [Change(kind="remove", object_id=obstacle.id)]
        else:
            magnitude, units = (
                (1, "metres") if identity == "static_translate" else (math.pi / 12, "radians")
            )
            patch = (
                {"position": Vec2(x=obstacle.position.x + 1, y=obstacle.position.y)}
                if identity == "static_translate"
                else {"rotation": obstacle.rotation + magnitude}
            )
            candidate = obstacle.model_copy(update=patch)
            if not fits(candidate, frame.objects):
                reason = "Edited geometry fails conservative bounds/overlap checks"
            else:
                changes = [Change(kind="update", object_id=obstacle.id, patch=ObjectPatch(**patch))]
    elif identity in {"static_add", "dynamic_duplicate"}:
        kind, magnitude, units = "structural", 1, "objects"
        if len(frame.objects) >= 64:
            reason = "Source already has 64 objects"
        else:
            body = (
                BodyState(
                    id="benchmark-obstacle",
                    label="Benchmark obstacle",
                    static=True,
                    shape=Shape.PLATFORM,
                    position=Vec2(),
                    width=2,
                    height=0.25,
                )
                if identity == "static_add"
                else dynamic.model_copy(
                    update={"id": "benchmark-clone", "label": "Benchmark duplicate"}
                )
            )
            if any(b.id == body.id for b in frame.objects):
                reason = "Reserved benchmark identity already exists"
            else:
                body = place(body, frame.objects)
                if body is None:
                    reason = "No conservative non-overlapping placement found"
                else:
                    changes = [Change(kind="add", object=body)]
    else:
        kind, magnitude, units = "structural", -1, "objects"
        if sum(not b.static for b in frame.objects) < 2:
            reason = "Removing the target would leave no dynamic object"
        else:
            changes = [Change(kind="remove", object_id=dynamic.id)]
    return Intervention(identity, kind, magnitude, units, tuple(changes), reason)
