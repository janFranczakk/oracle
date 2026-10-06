"""Object attention without identity embeddings, followed by per-object temporal attention."""

import torch
from torch import Tensor, nn

from oracle.models.schema import ModelConfig


class AttentiveHistory(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        width = config.embedding
        self.object_attention = nn.MultiheadAttention(
            width, config.heads, dropout=config.dropout, batch_first=True
        )
        self.object_norm = nn.LayerNorm(width)
        self.dropout = nn.Dropout(config.dropout)
        self.time = nn.Parameter(torch.empty(1, config.history, width))
        nn.init.normal_(self.time, std=0.02)
        # Construct independently: TransformerEncoder cloning otherwise starts layers identically.
        self.layers = nn.ModuleList(
            nn.TransformerEncoderLayer(
                width,
                config.heads,
                dim_feedforward=config.hidden * 2,
                dropout=config.dropout,
                batch_first=True,
            )
            for _ in range(config.layers)
        )
        self.project = nn.Linear(width, config.hidden)

    def forward(self, encoded: Tensor, mask: Tensor) -> tuple[Tensor, Tensor]:
        b, h, n, width = encoded.shape
        if n == 0 or torch.any(~mask.any(dim=1)):
            raise ValueError("Attention requires at least one valid object per scene")
        sequence = encoded.reshape(b * h, n, width)
        padding = ~mask[:, None, :].expand(b, h, n).reshape(b * h, n)
        attended, weights = self.object_attention(
            sequence, sequence, sequence, key_padding_mask=padding, need_weights=True
        )
        attended = self.object_norm(sequence + self.dropout(attended))
        attended = attended.reshape(b, h, n, width) * mask[:, None, :, None]
        temporal = attended.permute(0, 2, 1, 3).reshape(b * n, h, width) + self.time
        for layer in self.layers:
            temporal = layer(temporal)
        anchor_weights = weights.reshape(b, h, n, n)[:, -1] * mask[:, :, None]
        return self.project(temporal[:, -1]), anchor_weights
