"""Physical-unit comparison of independently produced frames, without a PyTorch dependency."""

import math

from oracle.world import Frame


def compare(predicted: list[Frame], actual: list[Frame], anchor_tick: int, dt: float) -> dict:
    if not predicted or len(predicted) != len(actual):
        raise ValueError("Rollouts must have the same non-empty horizon")
    identities = [body.id for body in actual[0].objects]
    dynamic = [body.id for body in actual[0].objects if not body.static]
    if not dynamic:
        raise ValueError("No dynamic objects to compare")
    totals = {
        identity: {
            "displacement": 0.0,
            "position_sq": 0.0,
            "velocity_sq": 0.0,
            "rotation": 0.0,
            "correct": 0,
        }
        for identity in dynamic
    }
    rows, counts = [], {"tp": 0, "tn": 0, "fp": 0, "fn": 0}
    for step, (p, a) in enumerate(zip(predicted, actual, strict=True), start=1):
        if p.tick != a.tick or any([body.id for body in f.objects] != identities for f in (p, a)):
            raise ValueError("Rollout ticks and object identities must match")
        entries = []
        position_sq = velocity_sq = rotation = 0.0
        for pb, ab in zip(p.objects, a.objects, strict=True):
            if ab.id not in totals:
                continue
            ps = (pb.position.x - ab.position.x) ** 2 + (pb.position.y - ab.position.y) ** 2
            vs = (pb.velocity.x - ab.velocity.x) ** 2 + (pb.velocity.y - ab.velocity.y) ** 2
            delta = pb.rotation - ab.rotation
            angle = abs(math.atan2(math.sin(delta), math.cos(delta)))
            contact, truth = pb.id in p.collisions, ab.id in a.collisions
            counts["tp" if contact and truth else "fp" if contact else "fn" if truth else "tn"] += 1
            total = totals[ab.id]
            total["displacement"] += math.sqrt(ps)
            total["position_sq"] += ps
            total["velocity_sq"] += vs
            total["rotation"] += angle
            total["correct"] += contact == truth
            total["fde"] = math.sqrt(ps)
            position_sq += ps
            velocity_sq += vs
            rotation += angle
            entries.append(
                {
                    "id": ab.id,
                    "displacement_m": math.sqrt(ps),
                    "velocity_error_m_s": math.sqrt(vs),
                    "rotation_error_rad": angle,
                    "predicted_contact": contact,
                    "actual_contact": truth,
                }
            )
        rows.append(
            {
                "step": step,
                "tick": a.tick,
                "seconds": (a.tick - anchor_tick) * dt,
                "displacement_m": sum(e["displacement_m"] for e in entries) / len(dynamic),
                "position_mse": position_sq / (2 * len(dynamic)),
                "velocity_mse": velocity_sq / (2 * len(dynamic)),
                "rotation_mae_rad": rotation / len(dynamic),
                "objects": entries,
            }
        )
    n, horizon = len(dynamic), len(rows)
    per_object = [
        {
            "id": identity,
            "ade_m": t["displacement"] / horizon,
            "fde_m": t["fde"],
            "position_mse": t["position_sq"] / (2 * horizon),
            "velocity_mse": t["velocity_sq"] / (2 * horizon),
            "rotation_mae_rad": t["rotation"] / horizon,
            "contact_accuracy": t["correct"] / horizon,
        }
        for identity, t in totals.items()
    ]
    positives, negatives = counts["tp"] + counts["fn"], counts["tn"] + counts["fp"]
    return {
        "horizons": rows,
        "objects": per_object,
        "summary": {
            "objects_scored": n * horizon,
            "ade_m": sum(t["displacement"] for t in totals.values()) / (n * horizon),
            "fde_m": rows[-1]["displacement_m"],
            "position_mse": sum(t["position_sq"] for t in totals.values()) / (2 * n * horizon),
            "velocity_mse": sum(t["velocity_sq"] for t in totals.values()) / (2 * n * horizon),
            "rotation_mae_rad": sum(t["rotation"] for t in totals.values()) / (n * horizon),
            "contact_accuracy": (counts["tp"] + counts["tn"]) / (n * horizon),
            "contact_balanced_accuracy": (counts["tp"] / positives + counts["tn"] / negatives) / 2
            if positives and negatives
            else None,
            "contact_counts": counts,
        },
    }
