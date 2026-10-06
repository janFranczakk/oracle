"""Derived intervention inputs: never claim modified history is an observed episode."""

from oracle.world import Frame


def condition_history(history: tuple[Frame, ...], anchor: Frame) -> tuple[tuple[Frame, ...], dict]:
    original_ids = {body.id for body in history[-1].objects}
    ids = {body.id for body in anchor.objects}
    added, removed = sorted(ids - original_ids), sorted(original_ids - ids)
    conditioned = []
    for frame in history[:-1]:
        lookup = {body.id: body for body in frame.objects}
        conditioned.append(
            Frame(
                tick=frame.tick,
                objects=[
                    lookup.get(body.id, body).model_copy(deep=True) for body in anchor.objects
                ],
                collisions=[i for i in frame.collisions if i in ids],
            )
        )
    conditioned.append(anchor.model_copy(deep=True))
    return tuple(conditioned), {
        "method": "terminal_state_override_v1",
        "added_ids": added,
        "removed_ids": removed,
        "added_history": "synthetic_repeated_anchor_placeholders" if added else None,
        "removed_history": "identity_projection" if removed else None,
        "intervention_trained": False,
        "uncertainty": None,
    }
