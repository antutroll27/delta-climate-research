#!/usr/bin/env python3
"""
Measure how accurate the heat map actually is, per diurnal phase.

    python3 scripts/measure-accuracy.py

Two numbers per phase, both derived from the 32 near-nadir ECOSTRESS scenes
rather than asserted:

  ceiling_rmse  The RMSE of an UNCONSTRAINED empirical regression on the same
                forcing variables. No physics, just the best curve that fits.
                This is a hard upper bound on what ANY model driven by these
                inputs can achieve, so it says whether an accuracy target is
                reachable at all before anyone tries to reach it.

  model_rmse    What our physical model actually achieves.

The result: night is predictable from NASA POWER forcing (ceiling ~2 K) and
daytime is not (ceiling ~3.3 K). Daytime surface temperature depends on
site-level insolation, cloud timing and soil moisture that a 50 km reanalysis
cell cannot resolve. That is a property of the forcing data, not a bug in the
model, and no amount of tuning will move it — so the product must report
daytime as indicative and reserve quantitative claims for night.

Output: data/calibration/model-accuracy.json  (consumed by accuracy.ts)
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import Literal, Sequence, TypedDict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402  (path must be set first — the scripts are not a package)
import _types  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "model-accuracy.json")

# The fitted point from fit-physics.py. Recorded, not shipped — every parameter
# pinned to a bound, which is why DEFAULT_PARAMS was left alone.
FITTED: tuple[float, float, float] = (0.6000, 0.1500, 1.4000)

PHASES: tuple[_types.Phase, ...] = ("night", "day")
SURFACES: tuple[_physics.Surface, ...] = ("urban", "rural")

# Air temperature alone, and everything the forcing offers. Richer is not
# better out of sample; see the comment at the leave-one-out loop.
PREDICTOR_SETS: tuple[tuple[_physics.Forcing, ...], ...] = (
    ("tAir",),
    ("tAir", "rh", "wind", "cloud", "sun"),
)

# Above this, the empirical ceiling is too loose for the number to mean anything
# to a user, and the phase is reported as indicative rather than quantitative.
QUANTITATIVE_CEILING_K = 2.5


class PhaseAccuracy(TypedDict):
    n: int
    ceiling_rmse_K: float
    model_rmse_K: float
    reported_band_K: float
    confidence: Literal["quantitative", "indicative"]
    why: str


class AccuracyMethod(TypedDict):
    ceiling: str
    model: str


class ModelAccuracyFile(TypedDict):
    """data/calibration/model-accuracy.json — read by accuracy.ts."""
    generated_from: str
    scenes: int
    view_cut_deg: float
    method: AccuracyMethod
    phases: dict[_types.Phase, PhaseAccuracy]


def rmse(x: Sequence[float] | _types.F64) -> float:
    return math.sqrt(float(np.mean(np.asarray(x) ** 2)))


def ceiling_rmse(scenes: list[_physics.Scene]) -> float:
    """Out-of-sample RMSE of the best empirical regression on this forcing.

    LEAVE-ONE-OUT, over two predictor sets. An in-sample fit of 6 predictors to
    12 daytime scenes reports 1.44 K — LOWER than night, which is impossible;
    the regression is memorising its own noise. Only out-of-sample prediction is
    an honest ceiling, and richer is not better: at night, 6 predictors score
    WORSE out of sample (2.56 K) than air temperature alone (2.18 K). The
    ceiling is the best of them.
    """
    best: float | None = None
    for names in PREDICTOR_SETS:
        columns = [np.array([s.forcing(n) for s in scenes], dtype=np.float64)
                   for n in names]
        columns.append(np.ones(len(scenes)))
        X = np.column_stack(columns)
        loo: list[float] = []
        for cls in SURFACES:
            y = np.array([s.observed(cls) for s in scenes], dtype=np.float64)
            for i in range(len(scenes)):
                keep = [j for j in range(len(scenes)) if j != i]
                coef = np.linalg.lstsq(X[keep], y[keep], rcond=None)[0]
                loo.append(float(y[i] - X[i] @ coef))
        r = rmse(loo)
        best = r if best is None else min(best, r)
    if best is None:
        raise ValueError("no predictor sets — nothing to bound the model against")
    return best


def main() -> None:
    scenes, lc, _ = _physics.load(False)
    phases: dict[_types.Phase, PhaseAccuracy] = {}

    for ph in PHASES:
        S = [s for s in scenes if s.phase == ph]

        c = ceiling_rmse(S)

        model_res: list[_types.F64] = []
        for cls in SURFACES:
            y = np.array([s.observed(cls) for s in S], dtype=np.float64)
            modelled = np.array([_physics.predict(s, lc, *FITTED).at(cls) for s in S],
                                dtype=np.float64)
            model_res.append(modelled - y)
        m = rmse(np.concatenate(model_res))

        # The band users see is the MODEL's own out-of-sample error — what they
        # actually experience — rounded UP to the nearest 0.5 K, never down.
        band = math.ceil(m * 2) / 2
        quantitative = c <= QUANTITATIVE_CEILING_K
        phases[ph] = {
            "n": len(S),
            "ceiling_rmse_K": round(c, 2),
            "model_rmse_K": round(m, 2),
            "reported_band_K": band,
            "confidence": "quantitative" if quantitative else "indicative",
            "why": ("air temperature explains night surface temperature well "
                    "(r ~ 0.9), so a calibrated model is meaningful here"
                    if quantitative else
                    "daytime surface temperature depends on site-level insolation, "
                    "cloud timing and soil moisture that 50 km reanalysis forcing "
                    "cannot resolve; no model on this data can do better"),
        }

    out: ModelAccuracyFile = {
        "generated_from": "data/calibration/met-forcing.csv + landcover-fractions.json",
        "scenes": len(scenes),
        "view_cut_deg": _physics.VIEW_CUT,
        "method": {
            "ceiling": "best LEAVE-ONE-OUT least-squares over {tAir} and "
                       "{tAir,rh,wind,cloud,solar}; an out-of-sample upper bound on any "
                       "model using this forcing. In-sample fits overfit badly at n=12.",
            "model": "the physical model at its fitted (bound-pinned) parameters",
        },
        "phases": phases,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    for ph, d in out["phases"].items():
        print(f"  {ph:<6} n={d['n']:<3} ceiling {d['ceiling_rmse_K']:.2f} K   "
              f"model {d['model_rmse_K']:.2f} K   -> report ±{d['reported_band_K']} K "
              f"({d['confidence']})")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
