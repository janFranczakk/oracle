"""Evaluate real checkpoint weights against verified held-out observations."""

import argparse
from pathlib import Path

from oracle.datasets.schema import Split
from oracle.datasets.storage import write_json
from oracle.training.checkpoint import file_hash, load_checkpoint
from oracle.training.data import SequenceDataset
from oracle.training.engine import configure_runtime, dataset_identity
from oracle.training.evaluation import evaluate_model
from oracle.training.schema import TrainConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ORACLE learned dynamics")
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--uncertainty",
        action="store_true",
        help="Measure fixed 16-path dropout intervals on test/OOD",
    )
    args = parser.parse_args()
    model, value = load_checkpoint(args.checkpoint)
    config = TrainConfig.model_validate(value["config"])
    configure_runtime(config)
    data = SequenceDataset(args.dataset, Split.TRAIN, model.config.history)
    if dataset_identity(data) != value["dataset"]:
        parser.error("Checkpoint dataset identity or normalizer is incompatible")
    if args.output.exists():
        parser.error("Evaluation output already exists; choose another path")
    if args.uncertainty and (model.config.family != "transformer" or model.config.dropout <= 0):
        parser.error("Uncertainty evaluation requires a Transformer trained with dropout")
    result = evaluate_model(model.to(config.device), args.dataset, config.horizons, config.device)
    result.update(
        dataset=value["dataset"],
        selected_epoch=value["epoch"],
        model_version=f"{args.checkpoint.parent.name}/epoch-{value['epoch']}",
    )
    if args.uncertainty:
        from oracle.training.uncertainty import evaluate_uncertainty

        result["uncertainty"] = evaluate_uncertainty(
            model, args.dataset, config.horizons, config.seed, config.device
        )
        result["uncertainty"].update(
            dataset=value["dataset"],
            selected_epoch=value["epoch"],
            model_version=result["model_version"],
            checkpoint_sha256=file_hash(args.checkpoint),
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.output, result)
    print(
        f"Evaluated {len(result['groups'])} held-out groups with {value['parameters']} parameters"
    )


if __name__ == "__main__":
    main()
