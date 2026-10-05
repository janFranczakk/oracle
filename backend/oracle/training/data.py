"""Checksum-verified temporal samples with split ownership and variable-object padding."""

from dataclasses import dataclass
from pathlib import Path

import torch
from torch import Tensor
from torch.utils.data import Dataset

from oracle.datasets.normalization import FEATURE_NAMES, features
from oracle.datasets.schema import Normalization, Split
from oracle.datasets.storage import read_episode, read_manifest, read_normalization
from oracle.world import Frame, Shape

SHAPES = list(Shape)


def encode_frame(frame: Frame, normalizer: Normalization, gravity: tuple, dt: float) -> Tensor:
    raw = torch.tensor([features(body) for body in frame.objects], dtype=torch.float32)
    mean, scale = torch.tensor(normalizer.mean), torch.tensor(normalizer.scale)
    values = (raw - mean) / scale
    categories = torch.zeros(len(frame.objects), len(SHAPES))
    for index, body in enumerate(frame.objects):
        categories[index, SHAPES.index(body.shape)] = 1
    static = torch.tensor([body.static for body in frame.objects], dtype=torch.float32)[:, None]
    environment = torch.tensor([*gravity, dt]).expand(len(frame.objects), -1)
    return torch.cat((values, categories, static, environment), dim=-1)


@dataclass
class SequenceEpisode:
    id: str
    split: str
    suite: str
    seed: int
    inputs: Tensor
    contacts: Tensor
    dynamic: Tensor
    object_ids: tuple[str, ...]


@dataclass
class Batch:
    inputs: Tensor
    targets: Tensor
    contacts: Tensor
    mask: Tensor
    dynamic: Tensor

    def to(self, device: str) -> "Batch":
        return Batch(*(value.to(device) for value in vars(self).values()))


class SequenceDataset(Dataset):
    """Windows are indexed inside verified episodes, never concatenated across boundaries."""

    def __init__(self, root: Path, split: Split, history: int, suite: str | None = None):
        self.manifest = read_manifest(root)
        self.normalizer = read_normalization(root, self.manifest)
        if self.normalizer.feature_names != FEATURE_NAMES:
            raise ValueError("Unsupported training feature schema")
        self.history = history
        self.dt = self.manifest.config.sample_stride / 120
        self.episodes = []
        self.windows = []
        self.gravity = None
        total_cells = 0
        for entry in self.manifest.episodes:
            if entry.split != split or (suite is not None and entry.suite.value != suite):
                continue
            episode = read_episode(root, entry)
            if len(episode.frames) <= history:
                raise ValueError("Episodes must be longer than the model history")
            total_cells += len(episode.frames) * len(episode.origin.objects)
            if total_cells > 2_000_000:
                raise ValueError(
                    "This local sequence loader supports at most 2M object observations"
                )
            gravity = episode.origin.environment.gravity
            environment = (gravity.x, gravity.y)
            if self.gravity is not None and self.gravity != environment:
                raise ValueError("This model version requires a shared gravity environment")
            self.gravity = environment
            inputs = torch.stack(
                [
                    encode_frame(f, self.normalizer, (gravity.x, gravity.y), self.dt)
                    for f in episode.frames
                ]
            )
            contacts = torch.tensor(
                [[obj.id in frame.collisions for obj in frame.objects] for frame in episode.frames],
                dtype=torch.float32,
            )
            dynamic = torch.tensor([not obj.static for obj in episode.origin.objects])
            self.episodes.append(
                SequenceEpisode(
                    entry.id,
                    entry.split.value,
                    entry.suite.value,
                    entry.seed,
                    inputs,
                    contacts,
                    dynamic,
                    tuple(obj.id for obj in episode.origin.objects),
                )
            )
            self.windows.extend(
                (len(self.episodes) - 1, end) for end in range(history, len(episode.frames))
            )
        if not self.windows:
            raise ValueError(f"No usable {split.value} sequences")

    def __len__(self):
        return len(self.windows)

    def __getitem__(self, index):
        episode_index, end = self.windows[index]
        episode = self.episodes[episode_index]
        return (
            episode.inputs[end - self.history : end],
            episode.inputs[end, :, :13],
            episode.contacts[end],
            episode.dynamic,
        )

    def contact_positive_weight(self) -> float:
        if any(e.split != Split.TRAIN for e in self.episodes):
            raise ValueError("Only train may fit contact class weights")
        positives = sum(e.contacts[self.history :, e.dynamic].sum().item() for e in self.episodes)
        count = sum((len(e.inputs) - self.history) * e.dynamic.sum().item() for e in self.episodes)
        return min(20.0, max(1.0, (count - positives) / max(1, positives)))


def collate(samples: list[tuple]) -> Batch:
    b, h = len(samples), samples[0][0].shape[0]
    n = max(sample[0].shape[1] for sample in samples)
    inputs = torch.zeros(b, h, n, samples[0][0].shape[-1])
    targets, contacts = torch.zeros(b, n, 13), torch.zeros(b, n)
    mask, dynamic = torch.zeros(b, n, dtype=torch.bool), torch.zeros(b, n, dtype=torch.bool)
    for i, (x, y, contact, moving) in enumerate(samples):
        count = x.shape[1]
        inputs[i, :, :count], targets[i, :count] = x, y
        contacts[i, :count], dynamic[i, :count], mask[i, :count] = contact, moving, True
    return Batch(inputs, targets, contacts, mask, dynamic)
