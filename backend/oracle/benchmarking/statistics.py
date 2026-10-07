"""Equal-repeat sample statistics. Missing metrics stay missing, never become zero."""

import math
import statistics
from collections.abc import Iterable

# Two-sided t(.975), df=1..9, rounded to six decimals. NIST handbook table/method:
# https://www.itl.nist.gov/div898/handbook/prc/section2/prc221.htm
# https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
T975 = (12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157)
CI_METHOD = (
    "Two-sided Student t 95% interval for the mean: mean ± t(0.975,n-1)*s/sqrt(n); "
    "sample s uses n-1. Assumes independent seed repeats and approximately normal metric "
    "distribution, conditional on fixed dataset/configuration. Small n gives weak evidence. "
    "Undefined for n<2; not a prediction interval or MC-dropout calibration."
)


def summarize(values: Iterable[float | None], *, confidence: bool = False) -> dict:
    raw = list(values)
    numbers = [float(v) for v in raw if v is not None]
    if any(not math.isfinite(v) for v in numbers):
        raise ValueError("Cannot aggregate non-finite metrics")
    n = len(numbers)
    result = {
        "n": n,
        "missing": len(raw) - n,
        "mean": None,
        "std": None,
        "median": None,
        "min": None,
        "max": None,
        "mean_ci95": None,
    }
    if not n:
        return result
    mean = statistics.mean(numbers)
    std = statistics.stdev(numbers) if n > 1 else None
    result.update(
        mean=mean, std=std, median=statistics.median(numbers), min=min(numbers), max=max(numbers)
    )
    if confidence and 2 <= n <= 10:
        half = T975[n - 2] * std / math.sqrt(n)
        result["mean_ci95"] = [mean - half, mean + half]
    return result
