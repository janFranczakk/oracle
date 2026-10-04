"""Headless Stage 1 runner: python -m oracle.experiment --seed 42 --steps 600."""

import argparse
from pathlib import Path

from oracle.scenes import scene
from oracle.session import Session


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a reproducible ground-truth experiment")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--steps", type=int, default=600)
    parser.add_argument("--scene", choices=["incline", "collision", "empty"], default="incline")
    parser.add_argument("--output", type=Path, default=Path("experiment.json"))
    args = parser.parse_args()
    if not 0 <= args.steps <= 14400:
        parser.error("steps must be between 0 and 14400")
    session = Session(scene(args.seed, args.scene))
    while session.engine.tick < args.steps:
        session.advance(min(600, args.steps - session.engine.tick))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(session.export().model_dump_json(indent=2), encoding="utf-8")
    print(f"Saved {args.steps} ticks of ground truth to {args.output}")


if __name__ == "__main__":
    main()
