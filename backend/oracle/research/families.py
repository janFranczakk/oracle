"""Read-only bounded catalog of completed CLI seed studies. No training imports or launches."""

import re
from pathlib import Path

from oracle.datasets.storage import digest, read_json


class FamilyStudies:
    def __init__(self, root: Path):
        self.root = root

    def detail(self, identity: str) -> dict:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
            raise ValueError("Invalid study identifier")
        directory = (self.root / identity).resolve()
        if not directory.is_relative_to(self.root.resolve()):
            raise ValueError("Study escapes its artifact root")
        path = directory / "report.json"
        status_path = directory / "status.json"
        if not path.resolve().is_relative_to(directory) or not status_path.resolve().is_relative_to(
            directory
        ):
            raise ValueError("Study files escape their artifact directory")
        if path.stat().st_size > 32 * 1024 * 1024 or status_path.stat().st_size > 16 * 1024:
            raise ValueError("Study exceeds catalog size bounds")
        status, report = read_json(status_path), read_json(path)
        if (
            status["status"] != "complete"
            or report["format"] != "oracle-multiseed-v1"
            or report["id"] != identity
            or digest(report) != status["report_sha256"]
        ):
            raise ValueError("Study is incomplete or its published report changed")
        return report

    def catalog(self) -> list[dict]:
        if not self.root.exists():
            return []
        results = []
        bytes_read = 0
        for directory in sorted(self.root.iterdir())[:100]:
            if not directory.is_dir():
                continue
            try:
                size = (directory / "report.json").stat().st_size
                if bytes_read + size > 32 * 1024 * 1024:
                    continue
                bytes_read += size
                report = self.detail(directory.name)
                results.append(
                    {
                        "id": report["id"],
                        "dataset_id": report["provenance"]["dataset"]["id"],
                        "families": [f["family"] for f in report["families"]],
                        "seeds": report["config"]["seeds"],
                        "elapsed_seconds": report["elapsed_seconds"],
                    }
                )
            except (OSError, ValueError, KeyError, TypeError):
                continue
        return results
