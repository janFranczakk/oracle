"""Run a bounded CPU training-seed study using the existing training engine unchanged."""

import argparse
from pathlib import Path

from oracle.benchmarking.multiseed import MultiSeedConfig, run_study
from oracle.datasets.storage import read_json
from oracle.training.schema import TrainConfig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3, 4, 5])
    parser.add_argument(
        "--families",
        nargs="+",
        choices=["mlp", "gru", "transformer"],
        default=["mlp", "gru", "transformer"],
    )
    parser.add_argument("--config", type=Path, help="Existing TrainConfig JSON template")
    parser.add_argument("--deadline", type=int, default=3600)
    args = parser.parse_args()
    try:
        training = (
            TrainConfig.model_validate(read_json(args.config))
            if args.config
            else TrainConfig(epochs=35)
        )
        report = run_study(
            args.dataset,
            args.output,
            MultiSeedConfig(
                seeds=args.seeds,
                families=args.families,
                training=training,
                deadline_seconds=args.deadline,
            ),
            lambda s: print(
                f"{s['completed']}/{s['total']} | {s.get('run')} | {s['elapsed_seconds']:.1f}s",
                flush=True,
            ),
        )
    except (ValueError, OSError, RuntimeError, TimeoutError) as error:
        parser.exit(1, f"Seed study failed: {error}\n")
    print(f"Complete: {len(report['families'])} families in {args.output}")


if __name__ == "__main__":
    main()
