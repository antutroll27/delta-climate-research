#!/usr/bin/env python3
"""
Fit the heat model at ward scale — the scale the product actually works at.

    python3 scripts/fit-ward-scale.py

WHAT CHANGED FROM fit-physics.py. Not the physics: the target. That script fits
two GHS-SMOD masks, and sampling them with Sentinel-2 showed they are the same
landscape (FVC 0.678 urban against 0.654 rural, the "urban" side marginally the
greener). Their 0.34 K temperature difference is the difference between delta
with villages and delta with crops, not an urban heat island. Meanwhile the
wards the product renders are FVC 0.31-0.45 and built 0.22-0.37 — twice as built
and half as vegetated as the mask named "urban".

So the old fit answered a question nobody asked and the answer was applied to a
different surface. Every constant pinned to a bound because no constant can make
a two-thirds-vegetated landscape behave like a city block.

This fits against ward-mean ECOSTRESS, with each ward's own measured FVC, albedo
and footprint coverage — the same three numbers the browser draws with.

TWO FAULTS ARE UNDER TEST, and they are independent:

  1. DAYTIME LEVEL. The old fit had no lever that could warm a heavily vegetated
     surface, because L_ET was held fixed at a value derived from park-interior
     cooling measurements. It is free here.

  2. NIGHT SIGN. Measured, the ward surface sits ABOVE air at night (+1.5 K, the
     nocturnal heat island — stored daytime heat discharging). The equilibrium
     model puts it 3.45 K BELOW, because `(kRad·tSky + h·wind·tAir)/(kRad+h·wind)`
     is a weighted mean of air and a sky 10-20 K colder, and nothing holds the
     surface up. No amount of tuning fixes a sign. It needs a term.

     `night_release` is that term: a heat flux out of the surface at night,
     scaled by thermal admittance. Built surfaces store more and release more,
     so it scales with built fraction, plus a floor because the measurement shows
     even the rural mask sits above air. This is the storage term (ΔQs) that a
     steady-state surface energy balance omits by construction.

CANDIDATES are cumulative so each line isolates one change. The criteria are the
same four as the mask-scale experiment, and were fixed before running:

  1. RMSE materially below the ward-scale baseline
  2. no parameter resting on a bound
  3. day and night bias both small — a model right on average by cancelling a
     hot phase against a cold one is not right
  4. it must hold up out of sample, by ward — fitting three wards and reporting
     the in-sample error would flatter any of these

Output: data/calibration/ward-scale-fit.json   (EXPERIMENT — carries ship:false
        until a human reads criterion 4 and agrees)
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable, Sequence
from typing import Any, NamedTuple

import numpy as np
import numpy.typing as npt
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402

ROOT = os.path.join(HERE, "..")
OBS = os.path.join(ROOT, "data", "calibration", "ward-observations.json")
OUT = os.path.join(ROOT, "data", "calibration", "ward-scale-fit.json")

PIN_TOL = 1e-3


class Row(NamedTuple):
    ward: str
    phase: str
    lst: float
    fvc: float
    albedo: float
    built: float
    tAir: float
    rh: float
    wind: float
    cloud: float
    sun: float
    weight: float


class Cand(NamedTuple):
    key: str
    label: str
    names: tuple[str, ...]
    x0: tuple[float, ...]
    lo: tuple[float, ...]
    hi: tuple[float, ...]
    night_release: bool


def load_rows() -> list[Row]:
    if not os.path.exists(OBS):
        sys.exit(f"{os.path.relpath(OBS, ROOT)} is missing — run "
                 f"`python3 scripts/build-ward-observations.py` first.")
    with open(OBS) as fh:
        raw = json.load(fh)["rows"]
    return [Row(ward=r["ward"], phase=r["phase"], lst=r["lst_mean_c"], fvc=r["fvc"],
                albedo=r["albedo"], built=r["built"], tAir=r["tAir"], rh=r["rh"],
                wind=r["wind"], cloud=r["cloud"], sun=r["sun"],
                # a ward-scene with 40 % clear cells is weaker evidence than a
                # clear one, exactly as in the mask-scale fit
                weight=math.sqrt(r["cell_frac"]))
            for r in raw]


def predict(p: dict[str, float], r: Row, night_release: bool) -> float:
    kRad = _physics.K_SUM * p["ratio"] / (1 + p["ratio"])
    h = _physics.K_SUM - kRad
    night = r.phase == "night"

    tSky = _physics.sky_temp(r.tAir, r.rh, r.cloud, p["c"])
    sun = 0.0 if night else r.sun * (1 - 0.6 * r.cloud)
    Q = p["q_day"] * (_physics.Q_NIGHT_RATIO if night else 1.0)
    k = kRad + h * r.wind
    pull = kRad * tSky + h * r.wind * r.tAir

    L = p["l_et"] * (0.6 + 0.6 * (1 - r.rh / 100))
    if night:
        dry = (Q * r.built + pull) / k
        headroom = (dry - _physics.dewpoint(r.tAir, r.rh)) / _physics.DEWPOINT_TAPER_K
        L = L * _physics.NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))

    stored = 0.0
    if night and night_release:
        # ΔQs: heat stored by day and released at night. Scales with thermal
        # admittance — concrete and asphalt store far more than a crop canopy —
        # so `release_built` rides on built fraction, and `release_base` is the
        # floor the measurement demands even where nothing is built.
        stored = p["release_base"] + p["release_built"] * r.built

    return (_physics.S_SOLAR * (1 - r.albedo) * sun + Q * r.built - L * r.fvc
            + stored + pull) / k


SHIP = {"q_day": 0.55, "ratio": 0.5, "c": 1.24, "l_et": _physics.L_ET,
        "release_base": 0.0, "release_built": 0.0}


def make_resid(cand: Cand, rows: Sequence[Row]
               ) -> Callable[[npt.NDArray[np.float64]], npt.NDArray[np.float64]]:
    def resid(x: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        p = dict(SHIP)
        p.update(dict(zip(cand.names, x)))
        return np.asarray([r.weight * (predict(p, r, cand.night_release) - r.lst) for r in rows],
                          dtype=np.float64)
    return resid


def fit(cand: Cand, rows: Sequence[Row]) -> dict[str, float]:
    out = least_squares(make_resid(cand, rows), np.asarray(cand.x0),
                        bounds=(np.asarray(cand.lo), np.asarray(cand.hi)), method="trf")
    p = dict(SHIP)
    p.update({n: float(v) for n, v in zip(cand.names, out.x)})
    return p


def score(cand: Cand, p: dict[str, float], rows: Sequence[Row]) -> dict[str, Any]:
    err = [predict(p, r, cand.night_release) - r.lst for r in rows]
    by = {ph: [e for e, r in zip(err, rows) if r.phase == ph] for ph in ("day", "night")}
    return {
        "rmse_K": round(float(np.sqrt(np.mean(np.square(err)))), 3),
        "bias_K": round(float(np.mean(err)), 3),
        "day_bias_K": round(float(np.mean(by["day"])), 3) if by["day"] else None,
        "night_bias_K": round(float(np.mean(by["night"])), 3) if by["night"] else None,
    }


CANDIDATES = [
    Cand("A", "ward-scale baseline (shipping structure)",
         ("q_day", "ratio", "c"), (0.30, 0.50, 1.24),
         (0.02, 0.15, 1.20), (0.60, 1.50, 1.40), False),
    Cand("B", "+ ET coefficient free",
         ("q_day", "ratio", "c", "l_et"), (0.30, 0.50, 1.24, 0.43),
         (0.02, 0.15, 1.20, 0.05), (0.60, 1.50, 1.40, 0.60), False),
    Cand("C", "+ nocturnal storage release",
         ("q_day", "ratio", "c", "l_et", "release_base", "release_built"),
         (0.30, 0.50, 1.24, 0.43, 0.05, 0.05),
         (0.02, 0.15, 1.20, 0.05, 0.00, 0.00),
         (0.60, 1.50, 1.40, 0.60, 0.50, 0.50), True),
    # The coupling-ratio bound is itself a hypothesis, and every fit so far has
    # railed against its LOWER limit — at mask scale and now at ward scale. The
    # solver is saying the surface is far more coupled to air than to sky. That is
    # what the measurement says too: the ward surface sits 1.4-2.1 K ABOVE air,
    # which a surface radiating freely to a sky 10-20 K colder cannot do. 0.15 was
    # chosen as "physically defensible" before any of that was known.
    Cand("D", "+ coupling-ratio bound opened",
         ("q_day", "ratio", "c", "l_et", "release_base", "release_built"),
         (0.30, 0.30, 1.24, 0.43, 0.05, 0.05),
         (0.02, 0.01, 1.20, 0.05, 0.00, 0.00),
         (0.60, 1.50, 1.60, 0.80, 0.50, 0.50), True),
    # And without the storage term, to show which of the two is doing the work.
    Cand("E", "+ ratio opened, NO storage term",
         ("q_day", "ratio", "c", "l_et"),
         (0.30, 0.30, 1.24, 0.43),
         (0.02, 0.01, 1.20, 0.05),
         (0.60, 1.50, 1.60, 0.80), False),
]


def main() -> None:
    rows = load_rows()
    wards = sorted({r.ward for r in rows})
    print(f"  {len(rows)} ward-scenes over {len(wards)} wards "
          f"({sum(r.phase == 'day' for r in rows)} day, "
          f"{sum(r.phase == 'night' for r in rows)} night)\n")

    results: list[dict[str, Any]] = []
    for cand in CANDIDATES:
        p = fit(cand, rows)
        s = score(cand, p, rows)
        pinned = [n for n, lo, hi in zip(cand.names, cand.lo, cand.hi)
                  if abs(p[n] - lo) < PIN_TOL or abs(p[n] - hi) < PIN_TOL]

        # CRITERION 4. Leave one ward out, fit on the other two, score the held-out
        # one. Three wards is a small jackknife, but a structure that only works
        # on the ward it saw is not a structure, and in-sample RMSE cannot tell
        # the difference.
        oos: list[float] = []
        for w in wards:
            tr = [r for r in rows if r.ward != w]
            te = [r for r in rows if r.ward == w]
            if not tr or not te:
                continue
            oos.append(score(cand, fit(cand, tr), te)["rmse_K"])

        results.append({"key": cand.key, "label": cand.label,
                        "fitted": {n: round(p[n], 4) for n in cand.names},
                        "pinned": pinned, **s,
                        "oos_rmse_K": round(float(np.mean(oos)), 3) if oos else None,
                        "oos_by_ward": {w: r for w, r in zip(wards, oos)}})

    print(f"  {'':4}{'candidate':<40}{'RMSE':>7}{'OOS':>7}{'day':>8}{'night':>8}{'pinned':>10}")
    for r in results:
        print(f"  {r['key']:<4}{r['label']:<40}{r['rmse_K']:>7.3f}{r['oos_rmse_K']:>7.3f}"
              f"{r['day_bias_K']:>8.2f}{r['night_bias_K']:>8.2f}"
              f"{(','.join(r['pinned']) or '—'):>10}")
    print()
    for r in results:
        print(f"  {r['key']}  {r['fitted']}")
        print(f"      out-of-sample by ward: {r['oos_by_ward']}")

    base = results[0]
    good = [r for r in results[1:]
            if not r["pinned"] and r["rmse_K"] < base["rmse_K"] - 0.2
            and abs(r["day_bias_K"]) < 1.0 and abs(r["night_bias_K"]) < 1.0
            and r["oos_rmse_K"] < base["oos_rmse_K"]]
    print()
    if good:
        best = min(good, key=lambda r: r["oos_rmse_K"])
        print(f"  MEETS EVERY CRITERION: {best['key']} — {best['label']}")
        print(f"  in-sample {base['rmse_K']} -> {best['rmse_K']} K, "
              f"out-of-sample {base['oos_rmse_K']} -> {best['oos_rmse_K']} K, nothing pinned.")
        verdict = best["key"]
    else:
        print("  NO candidate meets all four criteria.")
        verdict = None

    with open(OUT, "w") as fh:
        json.dump({"note": "EXPERIMENT. Ward-scale calibration against ward-mean ECOSTRESS. "
                           "Not shipped until a human has read the out-of-sample column.",
                   "ship": False, "ward_scenes": len(rows), "wards": wards,
                   "meets_all_criteria": verdict, "candidates": results}, fh, indent=2)
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
