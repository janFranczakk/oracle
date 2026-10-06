"""Plain-data sampling options and observed interval quality; never imports PyTorch."""

import math

from pydantic import Field, model_validator

from oracle.world import Frame, StrictModel


class SamplingOptions(StrictModel):
    samples: int = Field(default=0, ge=0, le=32)
    sampling_seed: int = Field(default=7, ge=0, le=2**32 - 1)

    @model_validator(mode="after")
    def minimum_samples(self):
        if 0 < self.samples < 8:
            raise ValueError("Use zero samples or 8–32 dropout paths")
        return self


def interval_scores(lower, upper, mean, std, truth) -> dict:
    """Each input is a sequence of xy pairs for dynamic object/step observations."""
    rows = list(zip(lower, upper, mean, std, truth, strict=True))
    if not rows:
        raise ValueError("Interval scoring needs dynamic observations")
    covered = [[lo[a] <= actual[a] <= hi[a] for a in (0, 1)] for lo, hi, _, _, actual in rows]
    widths = [[hi[a] - lo[a] for a in (0, 1)] for lo, hi, _, _, _ in rows]
    errors = [math.dist(center, actual) for _, _, center, _, actual in rows]
    spreads = [math.hypot(*spread) for _, _, _, spread, _ in rows]
    size = len(rows)
    average_error, average_spread = sum(errors) / size, sum(spreads) / size
    error_ss = sum((v - average_error) ** 2 for v in errors)
    spread_ss = sum((v - average_spread) ** 2 for v in spreads)
    denominator = math.sqrt(error_ss * spread_ss)
    correlation = (
        sum(
            (e - average_error) * (s - average_spread) for e, s in zip(errors, spreads, strict=True)
        )
        / denominator
        if denominator > 1e-15
        else None
    )
    return {
        "objects_scored": size,
        "coverage_x": sum(row[0] for row in covered) / size,
        "coverage_y": sum(row[1] for row in covered) / size,
        "coverage_xy": sum(all(row) for row in covered) / size,
        "width_x_m": sum(row[0] for row in widths) / size,
        "width_y_m": sum(row[1] for row in widths) / size,
        "mean_error_m": average_error,
        "spread_error_correlation": max(-1.0, min(1.0, correlation))
        if correlation is not None
        else None,
    }


def measure_intervals(distribution: dict, actual: list[Frame]) -> dict:
    values = {key: [] for key in ("lower", "upper", "mean", "std", "truth")}
    for estimate, frame in zip(distribution["steps"], actual, strict=True):
        if estimate["tick"] != frame.tick:
            raise ValueError("Interval and reality clocks must match")
        observed = {body.id: body for body in frame.objects}
        for body in estimate["objects"]:
            actual_body = observed[body["id"]]
            if actual_body.static:
                continue
            for key in ("lower", "upper", "mean", "std"):
                values[key].append(body[key])
            values["truth"].append([actual_body.position.x, actual_body.position.y])
    return interval_scores(**values)
