"""Shared object encoder, masked scene context and replaceable temporal learned dynamics."""

from dataclasses import dataclass

import torch
from torch import Tensor, nn

from oracle.models.attention import AttentiveHistory
from oracle.models.schema import INPUT_FEATURES, MOTION_FEATURES, ModelConfig


@dataclass
class DynamicsOutput:
    features: Tensor
    contact_logits: Tensor
    object_attention: Tensor | None = None


class ObjectDynamics(nn.Module):
    """Permutation-equivariant object predictions; padded objects never influence context."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.encoder = nn.Sequential(
            nn.Linear(INPUT_FEATURES, config.embedding),
            nn.SiLU(),
            nn.Linear(config.embedding, config.embedding),
            nn.SiLU(),
        )
        temporal_input = config.embedding * 2
        if config.family == "mlp":
            self.temporal = nn.Sequential(
                nn.Linear(temporal_input * config.history, config.hidden),
                nn.SiLU(),
                nn.Linear(config.hidden, config.hidden),
                nn.SiLU(),
            )
        elif config.family == "gru":
            self.temporal = nn.GRU(temporal_input, config.hidden, batch_first=True)
        else:
            self.temporal = AttentiveHistory(config)
        self.decoder = nn.Linear(config.hidden, MOTION_FEATURES + 1)
        # Small learned residuals start near persistence, without encoding any dynamics rule.
        nn.init.normal_(self.decoder.weight, std=0.001)
        nn.init.zeros_(self.decoder.bias)

    def forward(self, history: Tensor, mask: Tensor, dynamic: Tensor) -> DynamicsOutput:
        if history.ndim != 4 or history.shape[1] != self.config.history:
            raise ValueError("Expected [batch, configured history, objects, features]")
        if history.shape[-1] != INPUT_FEATURES or mask.shape != (
            history.shape[0],
            history.shape[2],
        ):
            raise ValueError("Incompatible features or object mask")
        if dynamic.shape != mask.shape or torch.any(dynamic & ~mask):
            raise ValueError("Dynamic targets must belong to valid objects")
        b, h, n, _ = history.shape
        encoded = self.encoder(history) * mask[:, None, :, None]
        attention = None
        if self.config.family == "transformer":
            latent, attention = self.temporal(encoded, mask)
        else:
            context = encoded.sum(2, keepdim=True) / mask.sum(1).clamp_min(1)[:, None, None, None]
            sequence = torch.cat((encoded, context.expand(-1, -1, n, -1)), dim=-1)
            sequence = sequence.permute(0, 2, 1, 3).reshape(b * n, h, -1)
            if self.config.family == "mlp":
                latent = self.temporal(sequence.flatten(1))
            else:
                _, hidden = self.temporal(sequence)
                latent = hidden[-1]
        decoded = self.decoder(latent).reshape(b, n, -1)
        last = history[:, -1, :, :13]
        motion = last[..., :MOTION_FEATURES] + decoded[..., :MOTION_FEATURES]
        motion = torch.where(dynamic[..., None], motion, last[..., :MOTION_FEATURES])
        result = torch.cat((motion, last[..., MOTION_FEATURES:]), dim=-1)
        return DynamicsOutput(result * mask[..., None], decoded[..., -1] * mask, attention)

    @property
    def parameters_count(self) -> int:
        return sum(parameter.numel() for parameter in self.parameters())
