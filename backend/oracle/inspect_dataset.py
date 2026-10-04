"""Verify all episodes and train-only statistics without importing a training framework."""

import argparse
import json
from pathlib import Path

from oracle.datasets.engine import iter_pairs, verify_dataset
from oracle.datasets.schema import Split


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify an ORACLE dataset and inspect a transition"
    )
    parser.add_argument("path", type=Path)
    parser.add_argument("--pair", choices=[s.value for s in Split])
    parser.add_argument("--normalized", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify_dataset(args.path), indent=2))
    if args.pair:
        print(
            json.dumps(
                next(iter_pairs(args.path, Split(args.pair), normalized=args.normalized)), indent=2
            )
        )


if __name__ == "__main__":
    main()
