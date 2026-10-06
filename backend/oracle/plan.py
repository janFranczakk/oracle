"""Reproduce a portable planning report, or explicitly verify its fixed selected action."""

import argparse
from pathlib import Path

from oracle.datasets.storage import read_json, write_json
from oracle.planning.store import reality_context, verification
from oracle.planning.worker import execute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, required=True, help="Planning report or search context JSON"
    )
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument(
        "--reality", action="store_true", help="Explicitly execute the selected action with Pymunk"
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a new report path")
    value = read_json(args.input)
    if args.reality:
        result = {**value, "verification": verification(value, execute(reality_context(value)))}
    else:
        if args.checkpoint is None:
            parser.error("Search requires --checkpoint with verified learned weights")
        result = execute({**value, "operation": "search"}, args.checkpoint)
    write_json(args.output, result)
    print(f"Selected {result['selected_id']} using learned endpoint distance")


if __name__ == "__main__":
    main()
