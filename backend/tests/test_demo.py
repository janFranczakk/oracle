"""The integration fixture is real trained inference; existing artifacts remain untouched."""

import subprocess
import sys
from pathlib import Path

import pytest

from oracle.benchmarking.counterfactual import source_plan
from oracle.counterfactual.worker import execute
from oracle.datasets.storage import read_json, write_json
from oracle.models.inference import LearnedDynamics
from oracle.setup_demo import setup_demo


def test_smoke_demo_trains_real_checkpoint_reuses_identical_files_and_predicts(tmp_path):
    result = setup_demo(tmp_path, "smoke", lambda message: None)
    checkpoint = Path(result["checkpoint"])
    assert LearnedDynamics(checkpoint).model.config.family == "gru"
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    assert setup_demo(tmp_path, "smoke", lambda message: None) == result
    assert {p: p.read_bytes() for p in before} == before
    _, plan = source_plan(42, 12)
    prediction = execute(
        {
            "operation": "predict",
            "plan": plan.model_dump(mode="json"),
            "branch_id": "baseline",
            "model": result["model"],
            "request": {"model_id": "oracle-e2e", "horizon": 3, "sample_stride": 4},
        },
        checkpoint,
    )
    assert prediction["source"] == "learned_model"
    assert len(prediction["frames"]) == 3
    assert prediction["model"]["sha256"] == result["model"]["sha256"]
    manifest_path = Path(result["dataset"]) / "manifest.json"
    original = manifest_path.read_bytes()
    manifest = read_json(manifest_path)
    manifest["config"]["seed"] = 1
    write_json(manifest_path, manifest)
    with pytest.raises(ValueError, match="different configuration"):
        setup_demo(tmp_path, "smoke", lambda message: None)
    assert read_json(manifest_path)["config"]["seed"] == 1
    manifest_path.write_bytes(original)
    assert {p: p.read_bytes() for p in before} == before


def test_partial_demo_is_preserved_and_does_not_start_collection(tmp_path):
    checkpoint = tmp_path / "checkpoints/oracle-e2e"
    checkpoint.mkdir(parents=True)
    write_json(checkpoint / "status.json", {"status": "failed"})
    with pytest.raises(ValueError, match="no matching"):
        setup_demo(tmp_path, "smoke", lambda message: None)
    assert not (tmp_path / "datasets").exists()
    assert read_json(checkpoint / "status.json")["status"] == "failed"


def test_artifact_root_is_explicit_and_api_import_remains_torch_free(tmp_path):
    import os

    env = {**os.environ, "ORACLE_DATA_ROOT": str(tmp_path)}
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from oracle.api import predictions; "
            "from oracle.paths import PROJECT_ROOT, "
            "ARTIFACT_ROOT; print(ARTIFACT_ROOT); print(predictions.catalog.root); "
            "assert PROJECT_ROOT != ARTIFACT_ROOT; assert 'torch' not in sys.modules",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert str(tmp_path) in result.stdout
