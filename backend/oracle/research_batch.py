"""Headless matched-checkpoint batch; API and CLI share the same research engine."""

import argparse
from pathlib import Path

from filelock import FileLock

from oracle.datasets.storage import read_json, read_manifest, write_json
from oracle.research.engine import run_batch
from oracle.research.schema import GROUPS, BatchRequest
from oracle.training.checkpoint import file_hash


def main():
    parser = argparse.ArgumentParser(
        description="Compare fixed checkpoints on matched test/OOD samples"
    )
    parser.add_argument("--request", type=Path, help="API-generated immutable batch input")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--checkpoint", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--horizons", type=int, nargs="+", default=[1, 5, 10, 20, 50])
    parser.add_argument("--groups", nargs="+", choices=GROUPS, default=GROUPS)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    if args.request:
        payload = read_json(args.request)
        dataset = Path(payload["dataset"])
        request = BatchRequest.model_validate(payload["request"])
        entries = payload["checkpoints"]
    else:
        if not args.dataset:
            parser.error("Supply --dataset and at least two --checkpoint paths")
        dataset = args.dataset
        request = BatchRequest(
            dataset_id=read_manifest(dataset).id,
            models=[p.parent.name for p in args.checkpoint],
            horizons=args.horizons,
            groups=args.groups,
            threads=args.threads,
        )
        if args.output.exists() and any(args.output.iterdir()):
            parser.error("Output is not empty; choose a new batch directory")
        entries = [
            {"id": p.parent.name, "path": str(p.resolve()), "sha256": file_hash(p)}
            for p in args.checkpoint
        ]
        args.output.mkdir(parents=True, exist_ok=True)
        write_json(
            args.output / "request.json",
            {
                "request": request.model_dump(),
                "dataset": str(dataset.resolve()),
                "checkpoints": entries,
            },
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(args.output.parent / ".research.lock", timeout=5):
        report = run_batch(dataset, args.output, request, entries)
    print(
        f"Compared {len(report['models'])} checkpoints across {len(request.groups)} matched groups"
    )


if __name__ == "__main__":
    main()
