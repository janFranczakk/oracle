"""Informational Stage 1 benchmark. Run with .venv/Scripts/python scripts/benchmark.py."""

import json
import platform
from time import perf_counter

from oracle.scenes import scene
from oracle.session import Session

session = Session(scene(42))
started = perf_counter()
for _ in range(4):
    session.advance(600)
simulation_time = perf_counter() - started
started = perf_counter()
session.seek(2000)
seek_time = perf_counter() - started
full_size = len(json.dumps(session.payload()).encode())
delta_size = len(json.dumps(session.payload(full=False)).encode())
print(
    json.dumps(
        {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "objects": 10,
            "ticks": 2400,
            "simulation_seconds": round(simulation_time, 4),
            "ms_per_tick_including_history": round(simulation_time / 2400 * 1000, 4),
            "seek_2000_ms": round(seek_time * 1000, 2),
            "full_payload_bytes": full_size,
            "transform_payload_bytes": delta_size,
        },
        indent=2,
    )
)
