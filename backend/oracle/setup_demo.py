"""Prepare small real observations and validation-selected GRU weights without overwriting data."""

import argparse
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from oracle.datasets.engine import generate_dataset, verify_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import read_json, read_manifest
from oracle.models.schema import ModelConfig
from oracle.paths import ARTIFACT_ROOT
from oracle.prediction.catalog import ModelCatalog
from oracle.training.schema import TrainConfig


def setup_demo(
    root: Path, profile: Literal["demo", "smoke"] = "demo", progress: Callable[[str], None] = print
) -> dict:
    from oracle.training.checkpoint import load_checkpoint
    from oracle.training.engine import train

    if profile not in {"demo", "smoke"}:
        raise ValueError("Choose demo or smoke profile")
    tiny = profile == "smoke"
    data_config = DatasetConfig(
        seed=2026,
        train=2 if tiny else 4,
        validation=1 if tiny else 2,
        test=1 if tiny else 2,
        ood_per_suite=1,
        steps=40 if tiny else 120,
    )
    training = TrainConfig(
        seed=17,
        model=ModelConfig(
            family="gru",
            history=2 if tiny else 4,
            embedding=16 if tiny else 32,
            hidden=16 if tiny else 32,
        ),
        epochs=1 if tiny else 3,
        threads=2,
        horizons=[1, 3, 5] if tiny else [1, 5, 10, 20],
    )
    name = "oracle-e2e" if tiny else "oracle-demo"
    dataset, checkpoint = root / "datasets" / name, root / "checkpoints" / name
    # Verify both destinations before creating either. Partial/incompatible output stays intact.
    existing_dataset = dataset.exists() and any(dataset.iterdir())
    existing_checkpoint = checkpoint.exists() and any(checkpoint.iterdir())
    if existing_dataset:
        if read_manifest(dataset).config != data_config:
            raise ValueError("Existing demo dataset has different configuration; choose a new root")
        verify_dataset(dataset)
    if existing_checkpoint:
        if not existing_dataset:
            raise ValueError("Existing checkpoint has no matching demo dataset")
        _, meta = load_checkpoint(checkpoint / "best.pt")
        description = ModelCatalog(checkpoint.parent).describe(name)
        if (
            meta["config"] != training.model_dump(mode="json")
            or description.dataset_sha256 != read_manifest(dataset).content_sha256
        ):
            raise ValueError("Existing demo checkpoint is incompatible; choose a new root")
        if read_json(checkpoint / "status.json")["status"] != "complete":
            raise ValueError("Existing demo training is incomplete; choose a new root")
    if not existing_dataset:
        progress(f"Collecting real Pymunk observations: {data_config.total} episodes")
        generate_dataset(
            data_config, dataset, lambda s: progress(f"Dataset {s['completed']}/{s['total']}")
        )
    else:
        progress("Verified existing compatible dataset; reusing without writing")
    if not existing_checkpoint:
        progress(f"Training actual GRU weights: {training.epochs} epoch(s), seed {training.seed}")
        train(dataset, checkpoint, training)
    else:
        progress("Verified existing completed checkpoint; reusing without writing")
    description = ModelCatalog(checkpoint.parent).describe(name)
    progress(
        f"Ready: {description.id}, validation-selected epoch {description.epoch}; "
        "small demo, not a research-quality accuracy claim"
    )
    return {
        "dataset": str(dataset),
        "checkpoint": str(checkpoint / "best.pt"),
        "model": description.model_dump(mode="json"),
        "profile": profile,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ARTIFACT_ROOT)
    parser.add_argument("--profile", choices=["demo", "smoke"], default="demo")
    args = parser.parse_args()
    try:
        setup_demo(args.root.resolve(), args.profile, lambda text: print(text, flush=True))
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, f"Demo setup failed; existing files preserved: {error}\n")


if __name__ == "__main__":
    main()
