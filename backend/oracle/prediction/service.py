"""One bounded inference subprocess at a time; the API stays free of torch and solver work."""

import json
import logging
import subprocess
import sys
import threading
from pathlib import Path

from oracle.prediction.catalog import ModelCatalog


class PredictionService:
    def __init__(self, root: Path):
        self.catalog = ModelCatalog(root)
        self.lock = threading.Lock()

    def run(self, context: dict) -> dict:
        checkpoint = self.catalog.checkpoint(context["model"]["id"])
        return self._execute(context, ["-m", "oracle.predict", "--checkpoint", str(checkpoint)])

    def run_counterfactual(self, context: dict) -> dict:
        args = ["-m", "oracle.counterfactual.worker"]
        if context["operation"] == "predict":
            checkpoint = self.catalog.checkpoint(context["model"]["id"])
            args.extend(["--checkpoint", str(checkpoint)])
        return self._execute(context, args)

    def _execute(self, context: dict, args: list[str]) -> dict:
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("Another prediction is running. Try again when it finishes.")
        try:
            payload = json.dumps(context, allow_nan=False)
            if len(payload.encode("utf-8")) > 2 * 1024 * 1024:
                raise ValueError("Worker input exceeds the 2 MiB execution limit")
            result = subprocess.run(
                [sys.executable, *args],
                input=payload,
                text=True,
                encoding="utf-8",
                capture_output=True,
                timeout=45,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            if result.returncode or len(result.stdout) > 8 * 1024 * 1024:
                raise ValueError(
                    "The prediction worker failed. Check model compatibility and try again."
                )
            value = json.loads(result.stdout)
            if "error" in value:
                logging.getLogger(__name__).warning("Prediction worker: %s", result.stderr[:4000])
                raise ValueError(value["error"])
            return value
        except subprocess.TimeoutExpired as exc:
            raise ValueError(
                "Prediction exceeded 45 seconds. Try a shorter horizon or smaller scene."
            ) from exc
        finally:
            self.lock.release()
