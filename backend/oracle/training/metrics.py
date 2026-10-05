"""Physical-unit errors and contact-onset classification; no confidence claims."""

import torch
from torch import Tensor


class Scores:
    def __init__(self):
        self.count = 0
        self.position_sq = self.velocity_sq = self.rotation_abs = self.displacement = 0.0
        self.tp = self.tn = self.fp = self.fn = 0

    def add(
        self,
        predicted: Tensor,
        actual: Tensor,
        mask: Tensor,
        contact_logits: Tensor,
        contacts: Tensor,
    ) -> None:
        p, a = predicted[mask].double(), actual[mask].double()
        if not torch.isfinite(p).all():
            raise ValueError("Model rollout produced non-finite observations")
        count = len(p)
        self.count += count
        self.position_sq += (p[:, :2] - a[:, :2]).square().sum().item()
        self.velocity_sq += (p[:, 2:4] - a[:, 2:4]).square().sum().item()
        delta = torch.atan2(p[:, 4], p[:, 5]) - torch.atan2(a[:, 4], a[:, 5])
        self.rotation_abs += torch.atan2(torch.sin(delta), torch.cos(delta)).abs().sum().item()
        self.displacement += (p[:, :2] - a[:, :2]).norm(dim=-1).sum().item()
        predicted_contacts, truth = contact_logits[mask] >= 0, contacts[mask].bool()
        self.tp += (predicted_contacts & truth).sum().item()
        self.tn += (~predicted_contacts & ~truth).sum().item()
        self.fp += (predicted_contacts & ~truth).sum().item()
        self.fn += (~predicted_contacts & truth).sum().item()

    def result(self) -> dict:
        if not self.count:
            raise ValueError("No dynamic observations to score")
        positives, negatives = self.tp + self.fn, self.tn + self.fp
        return {
            "objects_scored": self.count,
            "position_mse": self.position_sq / (2 * self.count),
            "velocity_mse": self.velocity_sq / (2 * self.count),
            "rotation_mae_rad": self.rotation_abs / self.count,
            "displacement_m": self.displacement / self.count,
            "contact_accuracy": (self.tp + self.tn) / self.count,
            "contact_balanced_accuracy": (self.tp / positives + self.tn / negatives) / 2
            if positives and negatives
            else None,
            "contact_precision": self.tp / (self.tp + self.fp) if self.tp + self.fp else None,
            "contact_recall": self.tp / positives if positives else None,
            "contact_counts": {"tp": self.tp, "tn": self.tn, "fp": self.fp, "fn": self.fn},
        }
