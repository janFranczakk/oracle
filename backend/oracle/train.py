"""Headless training CLI; the API launches this same isolated worker."""

import argparse
import traceback
from contextlib import nullcontext
from pathlib import Path

from oracle.datasets.storage import read_json, write_json
from oracle.models.schema import ModelConfig
from oracle.training.schema import TrainConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ORACLE's learned object dynamics")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--model", choices=["mlp", "gru"], default="mlp")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--history", type=int, default=4)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--resume", type=Path)
    args = parser.parse_args()
    try:
        config = (
            TrainConfig.model_validate(read_json(args.config))
            if args.config
            else TrainConfig(
                model=ModelConfig(family=args.model, history=args.history, hidden=args.hidden),
                epochs=args.epochs,
                batch_size=args.batch_size,
                seed=args.seed,
                device=args.device,
            )
        )
        status_path = args.output / "status.json"
        interactive = status_path.exists() and read_json(status_path).get("interactive", False)
        guard = nullcontext()
        if interactive:
            from filelock import FileLock

            guard = FileLock(args.output.parent / ".training.lock", timeout=10)
        with guard:
            from oracle.training.engine import train

            status = train(args.dataset, args.output, config, args.resume)
        print(f"{status['id']}: complete; best validation epoch {status['best_epoch']}")
    except Exception:
        status_path = args.output / "status.json"
        if status_path.exists():
            status = read_json(status_path)
            if status.get("status") == "running":
                write_json(
                    status_path,
                    {
                        **status,
                        "status": "failed",
                        "phase": "failed",
                        "error": "Training failed. Inspect the local worker log or CLI output.",
                    },
                )
        traceback.print_exc()
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
