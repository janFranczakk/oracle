"""Protected experiment output, atomic status, and spreadsheet-safe CSV exports."""

import csv
import time
from pathlib import Path

from oracle.datasets.storage import digest, write_json


class ExperimentOutput:
    def __init__(self, root: Path, config: dict, total: int, deadline: int):
        root.mkdir(parents=True, exist_ok=False)
        self.root = root
        self.started = time.perf_counter()
        self.deadline = deadline
        self.status = {"status": "running", "completed": 0, "total": total}
        write_json(root / "config.json", config)
        self.progress(0)

    def progress(self, completed: int, **extra):
        if time.perf_counter() - self.started > self.deadline:
            raise TimeoutError("Experiment exceeded its cooperative wall-time limit")
        self.status.update(
            completed=completed, elapsed_seconds=time.perf_counter() - self.started, **extra
        )
        write_json(self.root / "status.json", self.status)

    def finish(self, report: dict):
        self.progress(self.status["total"])
        write_json(self.root / "report.json", report)
        self.status.update(status="complete", report_sha256=digest(report))
        write_json(self.root / "status.json", self.status)

    def fail(self, error: Exception):
        self.status.update(
            status="failed", error=str(error), elapsed_seconds=time.perf_counter() - self.started
        )
        write_json(self.root / "status.json", self.status)


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        return

    def safe(value):
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    temporary = path.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows({k: safe(v) for k, v in row.items()} for row in rows)
    temporary.replace(path)
