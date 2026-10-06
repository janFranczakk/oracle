"""Isolated, checkpoint-backed prediction worker. JSON in / out; no API state access."""

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from oracle.prediction.metrics import compare
from oracle.prediction.reference import replay_reference
from oracle.prediction.schema import ModelDescription, PredictionRequest
from oracle.prediction.uncertainty import measure_intervals
from oracle.world import Experiment, Frame


def forecast(checkpoint: Path, context: dict) -> dict:
    import torch

    from oracle.models.inference import LearnedDynamics
    from oracle.prediction.catalog import ModelCatalog
    from oracle.training.checkpoint import file_hash

    started = time.perf_counter()
    torch.set_num_threads(2)
    request = PredictionRequest.model_validate(context["request"])
    description = ModelDescription.model_validate(context["model"])
    current = ModelCatalog(checkpoint.parent.parent).describe(checkpoint.parent.name)
    if current != description:
        raise ValueError("The checkpoint changed during prediction. Refresh models and try again.")
    model = LearnedDynamics(checkpoint)
    if file_hash(checkpoint) != description.sha256:
        raise ValueError("The checkpoint changed while its weights were loaded")
    history = tuple(Frame.model_validate(frame) for frame in context["history"])
    experiment = Experiment.model_validate(context["experiment"])
    predicted = model.predict(history, None, request.horizon)
    # Validate copied model outputs too: model_copy intentionally does not run Pydantic validators.
    frames = [Frame.model_validate(f.model_dump()) for f in predicted.frames]
    actual = replay_reference(experiment, history[-1], description.sample_stride, request.horizon)
    metrics = compare(frames, actual, request.anchor_tick, experiment.origin.environment.dt)
    diagnostics = model.diagnostics(
        history, request.horizon, request.samples, request.sampling_seed
    )
    if diagnostics["uncertainty"]:
        diagnostics["uncertainty"]["measurement"] = measure_intervals(
            diagnostics["uncertainty"], actual
        )
    return {
        "schema": "oracle-prediction-v1",
        "source": "learned_model",
        "created_at": datetime.now(UTC).isoformat(),
        "anchor": {
            "generation": request.generation,
            "tick": request.anchor_tick,
            "revision": request.revision,
        },
        "anchor_frame": history[-1].model_dump(mode="json"),
        "model": description.model_dump(mode="json"),
        "model_version": model.version,
        "horizon": request.horizon,
        "frames": [f.model_dump(mode="json") for f in frames],
        "reference": {
            "source": "pymunk-7.2.0",
            "conditions": "held_at_anchor",
            "frames": [f.model_dump(mode="json") for f in actual],
        },
        "metrics": metrics,
        **diagnostics,
        "elapsed_seconds": time.perf_counter() - started,
        "experiment": experiment.model_dump(mode="json"),
        "observations": [f.model_dump(mode="json") for f in history],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    args = parser.parse_args()
    try:
        context = json.loads(sys.stdin.read(2 * 1024 * 1024))
        value = forecast(args.checkpoint, context)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError):
        # Local diagnostics stay on stderr, never expose paths or a stack trace in the product.
        import traceback

        traceback.print_exc(file=sys.stderr)
        value = {
            "error": "Checkpoint or rollout incompatible. Refresh models or shorten the horizon."
        }
    print(json.dumps(value, allow_nan=False))


if __name__ == "__main__":
    main()
