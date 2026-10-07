"""Code location stays fixed; an explicit artifact root isolates demos and E2E runs."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT = Path(os.environ.get("ORACLE_DATA_ROOT", str(PROJECT_ROOT))).resolve()
