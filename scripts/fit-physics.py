#!/usr/bin/env python3
"""
Fit the heat-map's free physical constants against measured ECOSTRESS scenes.

    python3 scripts/fit-physics.py [--all-angles]

Three constants were never derived from anything — they were chosen to make the
picture look right. This fits them to observation instead:

    Q_day        anthropogenic heat flux, daytime
    kRad : h     radiative vs convective coupling ratio
    Brutsaert c  sky-emissivity coefficient

RESIDUALS ARE ON ABSOLUTES, NOT SUHII. Matching a difference while both sides
are wrong is not a fit — a model can nail SUHII with the urban and rural cells
each 5 K out. Urban and rural means enter the residual vector separately.

NEAR-NADIR ONLY by default. The view-angle control failed on the full set:
urban-rural view_zenith delta correlates with SUHII at r = -0.322, p = 0.024,
so ~10 % of the signal is sensor geometry. Restricting to <= 0.75 deg drops
that to -0.120 (not significant) and retains 36 scenes. --all-angles disables
the cut for comparison.

Land cover is DATA, from landcover-fractions.json — measured with WorldCover
inside the same SMOD masks the temperatures came from. Letting the solver tune
land cover would let it hide land-cover error inside the physics constants.

THE MODEL ITSELF LIVES IN _physics.py, so measure-accuracy.py can import it
rather than reach into this file. What stays here is the fitting PROCEDURE — the
start point, the bounds, and the stop condition — because those change when the
calibration changes rather than when the physics does. This file remains the
documented entrypoint; the docs invoke it by name.

Output: data/calibration/fitted-constants.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Sequence, TypedDict

import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402  (path must be set first — the scripts are not a package)
import _types  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "fitted-constants.json")

# (Q_day, kRad:h ratio, Brutsaert c) — the three free constants, in solver order.
Params = tuple[float, float, float]

X0: Params = (0.55, 0.5, 1.24)
LO: Params = (0.02, 0.15, 1.20)
HI: Params = (0.60, 1.50, 1.40)

NAMES = ("Q_day", "kRad_h_ratio", "brutsaert_c")
SPEC_BAR_K = 2.0        # the +/-2 K accuracy bar the product promises
PINNED_TOL = 1e-4       # how close to a bound counts as pinned


class FittedConstants(TypedDict):
    Q_day: float
    kRad_h_ratio: float
    brutsaert_c: float


class FittedBounds(TypedDict):
    Q_day: list[float]
    kRad_h_ratio: list[float]
    brutsaert_c: list[float]


class Residuals(TypedDict):
    rmse: float
    rmse_before_fit: float
    urban_bias: float
    rural_bias: float
    max_abs: float


class SuhiiSummary(TypedDict):
    modelled_median: float
    measured_median: float


class FittedConstantsFile(TypedDict):
    """data/calibration/fitted-constants.json."""
    fitted: FittedConstants
    bounds: FittedBounds
    scenes: int
    excluded: int
    near_nadir_only: bool
    view_cut_deg: float | None
    residuals_K: Residuals
    suhii_K: SuhiiSummary
    method: str
    land_cover: str
    pinned_to_bounds: list[str]
    ship: bool
    verdict: str


def as_params(p: Sequence[float] | _types.F64) -> Params:
    """The solver's parameter vector as three named floats.

    least_squares hands back an ndarray and is called with a tuple; both arrive
    here so the three constants are unpacked in exactly one place, in solver
    order. Transposing ratio and c would otherwise fit silently and wrongly.
    """
    return (float(p[0]), float(p[1]), float(p[2]))


def pinned(value: float, lo: float, hi: float) -> bool:
    """True when the solver parked a parameter on a bound — meaning the
    optimum is outside the admissible range and the structure, not the value,
    is what is wrong."""
    return abs(value - lo) < PINNED_TOL or abs(value - hi) < PINNED_TOL


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all-angles", action="store_true",
                    help="skip the near-nadir cut (for comparison only)")
    args = ap.parse_args()
    all_angles: bool = args.all_angles

    scenes, lc, dropped = _physics.load(all_angles)
    if len(scenes) < 12:
        sys.exit(f"only {len(scenes)} scenes after filtering — too few to fit")

    def resid(p: Sequence[float] | _types.F64) -> _types.F64:
        q_day, ratio, c = as_params(p)
        out: list[float] = []
        for sc in scenes:
            pr = _physics.predict(sc, lc, q_day, ratio, c)
            out.append(sc.w * (pr.urban - sc.urban))
            out.append(sc.w * (pr.rural - sc.rural))
        return np.array(out, dtype=np.float64)

    def report(p: Params, label: str) -> tuple[float, _types.F64, _types.F64]:
        urban_res: list[float] = []
        rural_res: list[float] = []
        for sc in scenes:
            pr = _physics.predict(sc, lc, *p)
            urban_res.append(pr.urban - sc.urban)
            rural_res.append(pr.rural - sc.rural)
        du = np.array(urban_res, dtype=np.float64)
        dr = np.array(rural_res, dtype=np.float64)
        rmse = math.sqrt(float(np.mean(np.concatenate([du, dr]) ** 2)))
        print(f"  {label:<10} urban bias {du.mean():+6.2f}  rural bias {dr.mean():+6.2f}  "
              f"RMSE {rmse:5.2f} K  max|res| {max(abs(du).max(), abs(dr).max()):5.2f} K")
        return rmse, du, dr

    print(f"  fitting {len(scenes)} scenes ({dropped} excluded)"
          f"{'' if all_angles else f' — near-nadir <= {_physics.VIEW_CUT}°'}")
    fit = least_squares(resid, X0, bounds=(LO, HI), method="trf")
    fitted = as_params(fit.x)
    q_day, ratio, c = fitted

    print()
    rmse0, _, _ = report(X0, "start")
    rmse1, du, dr = report(fitted, "fitted")
    print()
    print(f"  Q_day        {X0[0]:.3f} -> {q_day:.4f}   (bounds {LO[0]}–{HI[0]})")
    print(f"  kRad:h       {X0[1]:.3f} -> {ratio:.4f}   (bounds {LO[1]}–{HI[1]})")
    print(f"  Brutsaert c  {X0[2]:.3f} -> {c:.4f}   (bounds {LO[2]}–{HI[2]})")
    for label, v, lo, hi in (("Q_day", q_day, LO[0], HI[0]),
                             ("kRad:h", ratio, LO[1], HI[1]),
                             ("Brutsaert c", c, LO[2], HI[2])):
        if pinned(v, lo, hi):
            print(f"    WARNING: {label} pinned to its bound — the structure, not the value, is wrong")

    # SUHII implied by the fit vs measured
    ps = [_physics.predict(sc, lc, *fitted) for sc in scenes]
    mod_s = np.array([p.urban - p.rural for p in ps], dtype=np.float64)
    mea_s = np.array([sc.urban - sc.rural for sc in scenes], dtype=np.float64)
    print()
    print(f"  SUHII  modelled median {np.median(mod_s):+.2f}   measured median {np.median(mea_s):+.2f}")
    for ph in ("day", "night"):
        idx = [i for i, sc in enumerate(scenes) if sc.phase == ph]
        if idx:
            print(f"    {ph:<6} n={len(idx):<3} modelled {np.median(mod_s[idx]):+.2f}   "
                  f"measured {np.median(mea_s[idx]):+.2f}")

    ship = rmse1 <= SPEC_BAR_K
    result: FittedConstantsFile = {
        "fitted": {"Q_day": round(q_day, 4), "kRad_h_ratio": round(ratio, 4),
                   "brutsaert_c": round(c, 4)},
        "bounds": {"Q_day": [LO[0], HI[0]], "kRad_h_ratio": [LO[1], HI[1]],
                   "brutsaert_c": [LO[2], HI[2]]},
        "scenes": len(scenes), "excluded": dropped,
        "near_nadir_only": not all_angles,
        "view_cut_deg": None if all_angles else _physics.VIEW_CUT,
        "residuals_K": {
            "rmse": round(rmse1, 4), "rmse_before_fit": round(rmse0, 4),
            "urban_bias": round(float(du.mean()), 4), "rural_bias": round(float(dr.mean()), 4),
            "max_abs": round(float(max(abs(du).max(), abs(dr).max())), 4),
        },
        "suhii_K": {
            "modelled_median": round(float(np.median(mod_s)), 4),
            "measured_median": round(float(np.median(mea_s)), 4),
        },
        "method": "scipy least_squares TRF, bounded; residuals on urban AND rural absolutes, "
                  "weighted by sqrt(usable pixel fraction)",
        "land_cover": "data/calibration/landcover-fractions.json (fixed, not fitted)",
        "pinned_to_bounds": [n for n, v, lo, hi in
                             (("Q_day", q_day, LO[0], HI[0]),
                              ("kRad_h_ratio", ratio, LO[1], HI[1]),
                              ("brutsaert_c", c, LO[2], HI[2]))
                             if pinned(v, lo, hi)],
        "ship": ship,
        "verdict": ("within the +/-2 K spec bar" if ship else
                    "STOP CONDITION MET: RMSE exceeds the +/-2 K spec bar and parameters are "
                    "pinned to their bounds. These values must NOT be written into "
                    "DEFAULT_PARAMS -- the model structure is wrong, not its constants."),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")
    if not ship:
        print(f"\n  STOP CONDITION: RMSE {rmse1:.2f} K exceeds the spec's ±2 K. The structure is\n"
              f"  wrong, not the constants. Do not ship these values.")


if __name__ == "__main__":
    main()
