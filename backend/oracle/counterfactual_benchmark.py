"""Bounded counterfactual benchmark CLI; requires existing real validation-selected weights."""

import argparse
from pathlib import Path

from oracle.benchmarking.counterfactual import BenchmarkConfig, run_benchmark
from oracle.benchmarking.scenarios import INTERVENTIONS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scenes", type=int, default=24)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--anchor", type=int, default=60)
    parser.add_argument("--horizons", type=int, nargs="+", default=[10, 50])
    parser.add_argument(
        "--interventions", nargs="+", choices=INTERVENTIONS, default=list(INTERVENTIONS)
    )
    parser.add_argument("--deadline", type=int, default=1800)
    args = parser.parse_args()
    try:
        config = BenchmarkConfig(
            scenes=args.scenes,
            seed=args.seed,
            anchor_tick=args.anchor,
            horizons=args.horizons,
            interventions=args.interventions,
            deadline_seconds=args.deadline,
        )
        report = run_benchmark(
            args.checkpoint,
            args.output,
            config,
            lambda s: print(
                f"{s['completed']}/{s['total']} | {s['elapsed_seconds']:.1f}s", flush=True
            ),
        )
    except (ValueError, OSError, RuntimeError, TimeoutError) as error:
        parser.exit(1, f"Benchmark failed: {error}\n")
    print(f"Complete: {len(report['cases'])} measured/unsupported rows in {args.output}")


if __name__ == "__main__":
    main()
