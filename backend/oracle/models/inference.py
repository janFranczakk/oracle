"""Checkpoint-backed DynamicsModel adapter; never imports or calls the physics engine."""

import math
from pathlib import Path

import torch

from oracle.contracts import Intervention, Prediction
from oracle.datasets.schema import Normalization
from oracle.models.dynamics import ObjectDynamics
from oracle.training.checkpoint import load_checkpoint
from oracle.training.data import encode_frame
from oracle.training.evaluation import advance_history, raw_features
from oracle.world import Frame, Vec2


class LearnedDynamics:
    def __init__(self, checkpoint: Path):
        self.model: ObjectDynamics
        self.model, self.metadata = load_checkpoint(checkpoint)
        self.normalizer = Normalization.model_validate(self.metadata["normalization"])
        self.version = f"{checkpoint.parent.name}/epoch-{self.metadata['epoch']}"

    @torch.no_grad()
    def predict(
        self, history: tuple[Frame, ...], intervention: Intervention | None, horizon: int
    ) -> Prediction:
        if intervention is not None:
            raise ValueError("Use the Counterfactual Lab's explicit derived-history conditioning")
        count = self.model.config.history
        if len(history) < count or not 1 <= horizon <= 240:
            raise ValueError(
                "Provide the configured observation history and a horizon from 1 to 240"
            )
        history = history[-count:]
        stride = self.metadata["dataset"]["sample_stride"]
        if any(b.tick - a.tick != stride for a, b in zip(history[:-1], history[1:], strict=True)):
            raise ValueError("History sampling does not match the checkpoint observation clock")
        identities = [(b.id, b.shape, b.static) for b in history[-1].objects]
        if not identities or any(
            [(b.id, b.shape, b.static) for b in frame.objects] != identities for frame in history
        ):
            raise ValueError("History must preserve object identity, order and static context")
        dt = self.metadata["dataset"]["sample_dt"]
        gravity = tuple(self.metadata["dataset"]["gravity"])
        inputs = torch.stack([encode_frame(f, self.normalizer, gravity, dt) for f in history])[None]
        mask = torch.ones(1, len(identities), dtype=torch.bool)
        dynamic = torch.tensor([[not body.static for body in history[-1].objects]])
        previous = history[-1]
        frames = []
        for _ in range(horizon):
            output = self.model(inputs, mask, dynamic)
            raw = raw_features(output.features, self.normalizer)[0]
            if not torch.isfinite(raw).all():
                raise ValueError("Model rollout became non-finite")
            objects = []
            for index, body in enumerate(previous.objects):
                if body.static:
                    objects.append(body.model_copy(deep=True))
                    continue
                values = raw[index].tolist()
                angle = math.atan2(values[4], values[5])
                delta = math.atan2(math.sin(angle - body.rotation), math.cos(angle - body.rotation))
                objects.append(
                    body.model_copy(
                        update={
                            "position": Vec2(x=values[0], y=values[1]),
                            "velocity": Vec2(x=values[2], y=values[3]),
                            "rotation": body.rotation + delta,
                            "angular_velocity": values[6],
                        }
                    )
                )
            frame = Frame(
                tick=previous.tick + stride,
                objects=objects,
                collisions=[
                    body.id
                    for i, body in enumerate(objects)
                    if not body.static and output.contact_logits[0, i] >= 0
                ],
            )
            frames.append(frame)
            previous = frame
            inputs = advance_history(inputs, output.features, self.normalizer)
        return Prediction(tuple(frames), self.version)
