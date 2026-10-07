"""The published package and public API must identify the same release."""

import tomllib
from importlib.metadata import version
from pathlib import Path

from fastapi.testclient import TestClient

from oracle import __version__
from oracle.api import app


def test_package_metadata_and_openapi_identify_the_same_release():
    project = Path(__file__).resolve().parents[1] / "pyproject.toml"
    configured = tomllib.loads(project.read_text(encoding="utf-8"))["project"]["version"]
    assert version("oracle-physics-lab") == configured == __version__
    with TestClient(app) as client:
        assert client.get("/openapi.json").json()["info"]["version"] == configured
