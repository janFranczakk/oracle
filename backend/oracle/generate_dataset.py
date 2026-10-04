"""Headless dataset worker and CLI: python -m oracle.generate_dataset --help."""

import argparse
import sys
from pathlib import Path

from oracle.datasets.engine import dataset_id, generate_dataset
from oracle.datasets.schema import DatasetConfig
from oracle.datasets.storage import write_json


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Collect reproducible Pymunk ground-truth episodes"
    )
    parser.add_argument(
        "--config", type=Path, help="JSON DatasetConfig; overrides count / clock flags"
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--train", type=int, default=24)
    parser.add_argument("--validation", type=int, default=8)
    parser.add_argument("--test", type=int, default=8)
    parser.add_argument("--ood-per-suite", type=int, default=4)
    parser.add_argument("--steps", type=int, default=480)
    parser.add_argument("--sample-stride", type=int, default=4)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--progress", type=Path, help="Atomic status JSON for the local research UI"
    )
    args = parser.parse_args()
    total = 0
    try:
        config = (
            DatasetConfig.model_validate_json(args.config.read_bytes())
            if args.config
            else DatasetConfig(
                seed=args.seed,
                train=args.train,
                validation=args.validation,
                test=args.test,
                ood_per_suite=args.ood_per_suite,
                steps=args.steps,
                sample_stride=args.sample_stride,
            )
        )
        total = config.total
        root = args.output or Path("datasets") / dataset_id(config)

        def progress(value: dict) -> None:
            if args.progress:
                write_json(args.progress, {"status": "running", **value})

        manifest = generate_dataset(config, root, progress)
        if args.progress:
            write_json(
                args.progress,
                {
                    "status": "complete",
                    "phase": "ready",
                    "completed": total,
                    "total": total,
                    "dataset_id": manifest.id,
                },
            )
        print(f"{manifest.id}: {total} episodes · {sum(e.pairs for e in manifest.episodes)} pairs")
        print(f"Saved to {root.resolve()}")
        return 0
    except (ValueError, OSError) as exc:
        if args.progress:
            write_json(
                args.progress,
                {
                    "status": "failed",
                    "phase": "failed",
                    "completed": 0,
                    "total": total,
                    "error": "Dataset collection failed. Check worker logs.",
                },
            )
        print(f"Dataset generation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
