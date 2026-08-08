#!/usr/bin/env python3
"""
Which structural change to the heat model resolves the pinned fit?

    python3 scripts/experiment-model-structure.py

WHY THIS IS A SEPARATE SCRIPT. `fit-physics.py` is the documented entrypoint and
its output carries a `ship` flag; it fits ONE structure — the shipping one. This
asks a different question: given that fitting the shipping structure failed with
every parameter against a bound, WHICH structure would not fail? That is an
experiment over candidate models, and it must not be able to write
fitted-constants.json or be mistaken for the calibration.

THE DIAGNOSIS THIS TESTS. The recorded failure is not random. Its shape is:

    urban bias   -0.92 K     both masks too COLD
    rural bias   -2.46 K     rural much more so
    SUHII         1.84 K modelled vs 0.34 K measured

The two masks are nearly identical in land cover — vegetation 0.72 urban against
0.80 rural — so the ONLY term that separates them is Q·built (0.162 vs 0.008).
At the shipping Q that term is worth +1.41 K of the +1.84 K modelled SUHII,
against 0.34 K measured.

So the model needs to be WARMER overall and LESS urban-hot. The three free
constants cannot do both:

    Q_day        warms by built fraction -> urban only. Makes SUHII worse.
    kRad:h, c    shift radiative coupling -> both masks roughly equally.

None of them can warm a high-vegetation surface selectively, and the surface is
73-80 % vegetated in both masks, cooled 5.2-5.7 K by the ET term. The solver
therefore ran Q up (warming urban, worsening SUHII), ran the coupling terms to
their limits, and still could not lift the rural mask. Every parameter pinned
because the one that could have fixed it — L_ET, the ET coefficient — was held
fixed at a value derived from PARK-INTERIOR cooling measurements and applied to
a mask-wide average, a tension the methodology already records as unresolved.

CANDIDATES, in increasing order of how much they change:

    A  baseline        the shipping structure, for reference
    B  +L_ET free      the missing lever, nothing else changed
    C  +S_SOLAR free   absorbed-solar scale as well
    D  B, ET saturating in vegetation rather than linear

D exists because linear-in-vegetation ET is the part that is physically weakest:
it says the 80th percent of vegetation cools exactly as much as the 10th, when
real evapotranspiration saturates once the surface is fully transpiring and
moisture-limited. It is the same shape of error as the linear intervention
response the intervention model already had to replace with a saturating curve.

WHAT WOULD MAKE A CANDIDATE THE ANSWER, decided before running so the criteria
cannot be fitted to the outcome:

  1. RMSE materially below the baseline's 3.755 K
  2. NO parameter resting on a bound
  3. modelled SUHII within a factor of ~2 of the measured 0.34 K
  4. urban and rural bias both small AND of comparable size — a model that is
     right on average by cancelling a hot mask against a cold one is not right

A candidate that improves RMSE while still pinning has not fixed the structure;
it has found a longer lever for the same wrong shape.
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
import _types  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "model-structure-experiment.json")

#: How close to a bound counts as pinned. The solver stops on its own tolerance,
#: so an exact equality test would miss a parameter that halted a hair inside.
PIN_TOL = 1e-3


class Cand(NamedTuple):
    key: str
    label: str
    names: tuple[str, ...]
    x0: tuple[float, ...]
    lo: tuple[float, ...]
    hi: tuple[float, ...]
    #: (params, scene, landcover, surface) -> modelled °C
    predict: Callable[[Sequence[float], _physics.Scene, Any, str], float]


def _terms(sc: _physics.Scene, ratio: float, c: float, q_day: float
           ) -> tuple[float, float, float, float]:
    """(sun, Q, k, pull) — the scene-level assembly shared by every candidate."""
    kRad = _physics.K_SUM * ratio / (1 + ratio)
    h = _physics.K_SUM - kRad
    night = sc.phase == "night"
    tSky = _physics.sky_temp(sc.tAir, sc.rh, sc.cloud, c)
    sun = 0.0 if night else sc.sun * (1 - 0.6 * sc.cloud)
    Q = q_day * (_physics.Q_NIGHT_RATIO if night else 1.0)
    k = kRad + h * sc.wind
    pull = kRad * tSky + h * sc.wind * sc.tAir
    return sun, Q, k, pull


def _et(sc: _physics.Scene, l_et: float, Q: float, k: float, pull: float,
        rural_built: float) -> float:
    """The ET coefficient for this scene, including the night taper."""
    L = l_et * _physics.evap_scale(sc.rh)
    if sc.phase == "night":
        dry_veg = (Q * rural_built + pull) / k
        headroom = (dry_veg - _physics.dewpoint(sc.tAir, sc.rh)) / _physics.DEWPOINT_TAPER_K
        L = L * _physics.NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))
    return L


def _eq(cover: Any, sun: float, Q: float, L: float, pull: float, k: float,
        s_solar: float, veg_term: float | None = None) -> float:
    v = cover["veg"] if veg_term is None else veg_term
    out: float = (s_solar * (1 - cover["albedo"]) * sun + Q * cover["built"]
                  - L * v + pull) / k
    return out


def make_predict(free: tuple[str, ...], saturating: bool = False, svf: bool = False
                 ) -> Callable[[Sequence[float], _physics.Scene, Any, str], float]:
    """Build a predictor whose free parameters are `free`, others at shipping values.

    `svf` adds a sky-view-factor split to the radiative term. The shipping model
    couples the surface to the cold sky as if it saw all of it, which is true for
    a field and false for a street: in a canyon most of the hemisphere is wall and
    canopy at roughly air temperature. Modelling that as
    `kRad·(svf·tSky + (1-svf)·tAir)` is the standard urban-canopy treatment and is
    the physically-named version of what the solver was trying to do by railing
    the coupling ratio.
    """
    ship = {"q_day": 0.55, "ratio": 0.5, "c": 1.24,
            "l_et": _physics.L_ET, "s_solar": _physics.S_SOLAR, "vsat": 0.5,
            "svf_urban": 1.0, "svf_rural": 1.0}

    def predict(p: Sequence[float], sc: _physics.Scene, lc: Any, surface: str) -> float:
        vals = dict(ship)
        vals.update(dict(zip(free, p)))
        sun, Q, k, pull = _terms(sc, vals["ratio"], vals["c"], vals["q_day"])
        if svf:
            kRad = _physics.K_SUM * vals["ratio"] / (1 + vals["ratio"])
            h = _physics.K_SUM - kRad
            f = vals["svf_urban"] if surface == "urban" else vals["svf_rural"]
            tSky = _physics.sky_temp(sc.tAir, sc.rh, sc.cloud, vals["c"])
            pull = kRad * (f * tSky + (1 - f) * sc.tAir) + h * sc.wind * sc.tAir
        L = _et(sc, vals["l_et"], Q, k, pull, lc["rural"]["built"])
        cover = lc[surface]
        veg = cover["veg"]
        if saturating:
            # Michaelis-Menten in vegetation: same value at v=0, saturating as
            # the surface becomes fully transpiring. vsat is the half-saturation
            # fraction, so the linear model is the vsat -> infinity limit.
            veg = veg / (veg + vals["vsat"]) * (1 + vals["vsat"])
        return _eq(cover, sun, Q, L, pull, k, vals["s_solar"], veg)

    return predict


CANDIDATES: list[Cand] = [
    Cand("A", "baseline — shipping structure",
         ("q_day", "ratio", "c"), (0.30, 0.50, 1.24),
         (0.02, 0.15, 1.20), (0.60, 1.50, 1.40), make_predict(("q_day", "ratio", "c"))),
    Cand("B", "+ ET coefficient free",
         ("q_day", "ratio", "c", "l_et"), (0.30, 0.50, 1.24, 0.43),
         (0.02, 0.15, 1.20, 0.05), (0.60, 1.50, 1.40, 0.60),
         make_predict(("q_day", "ratio", "c", "l_et"))),
    Cand("C", "+ ET and absorbed solar free",
         ("q_day", "ratio", "c", "l_et", "s_solar"), (0.30, 0.50, 1.24, 0.43, 0.60),
         (0.02, 0.15, 1.20, 0.05, 0.20), (0.60, 1.50, 1.40, 0.60, 1.20),
         make_predict(("q_day", "ratio", "c", "l_et", "s_solar"))),
    Cand("D", "+ ET free, saturating in vegetation",
         ("q_day", "ratio", "c", "l_et", "vsat"), (0.30, 0.50, 1.24, 0.43, 0.50),
         (0.02, 0.15, 1.20, 0.05, 0.05), (0.60, 1.50, 1.40, 0.60, 5.00),
         make_predict(("q_day", "ratio", "c", "l_et", "vsat"), saturating=True)),
    # The bound on the coupling ratio is itself a hypothesis. The solver railed
    # against its LOWER limit in every run, i.e. it wanted less sky and more air.
    Cand("E", "+ ET free, coupling-ratio bound opened",
         ("q_day", "ratio", "c", "l_et"), (0.30, 0.30, 1.24, 0.43),
         (0.02, 0.01, 1.20, 0.05), (0.60, 1.50, 1.40, 0.60),
         make_predict(("q_day", "ratio", "c", "l_et"))),
    # Same, but naming the mechanism instead of absorbing it into a lumped ratio.
    Cand("F", "+ ET free, sky-view factor per mask",
         ("q_day", "ratio", "c", "l_et", "svf_urban", "svf_rural"),
         (0.30, 0.50, 1.24, 0.43, 0.55, 0.95),
         (0.02, 0.15, 1.20, 0.05, 0.20, 0.60),
         (0.60, 1.50, 1.40, 0.60, 0.90, 1.00),
         make_predict(("q_day", "ratio", "c", "l_et", "svf_urban", "svf_rural"), svf=True)),
]


def run(cand: Cand, scenes: list[_physics.Scene], lc: Any) -> dict[str, Any]:
    def resid(p: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        out: list[float] = []
        for sc in scenes:
            for surface in ("urban", "rural"):
                # weight by sqrt(usable fraction), as fit-physics.py does — a
                # scene with 30 % clear pixels is weaker evidence than a clear one
                out.append(sc.w * (cand.predict([float(v) for v in p], sc, lc, surface)
                                   - sc.observed(surface)))
        return np.asarray(out, dtype=np.float64)

    fit = least_squares(resid, np.asarray(cand.x0), bounds=(np.asarray(cand.lo), np.asarray(cand.hi)),
                        method="trf")
    r = resid(fit.x)
    # Back to a plain list once, at the boundary, rather than widening every
    # predictor signature to accept both a Sequence and an ndarray.
    best: list[float] = [float(v) for v in fit.x]
    rmse = float(np.sqrt(np.mean(r ** 2)))

    ub = [cand.predict(best, sc, lc, "urban") - sc.observed("urban") for sc in scenes]
    rb = [cand.predict(best, sc, lc, "rural") - sc.observed("rural") for sc in scenes]
    suhii_mod = [cand.predict(best, sc, lc, "urban") - cand.predict(best, sc, lc, "rural")
                 for sc in scenes]
    suhii_obs = [sc.observed("urban") - sc.observed("rural") for sc in scenes]

    pinned = [n for n, v, lo, hi in zip(cand.names, best, cand.lo, cand.hi)
              if abs(v - lo) < PIN_TOL or abs(v - hi) < PIN_TOL]
    return {
        "key": cand.key, "label": cand.label,
        "fitted": {n: round(float(v), 4) for n, v in zip(cand.names, best)},
        "bounds": {n: [lo, hi] for n, lo, hi in zip(cand.names, cand.lo, cand.hi)},
        "pinned": pinned,
        "rmse_K": round(rmse, 3),
        "urban_bias_K": round(float(np.mean(ub)), 3),
        "rural_bias_K": round(float(np.mean(rb)), 3),
        "bias_spread_K": round(abs(float(np.mean(ub)) - float(np.mean(rb))), 3),
        "suhii_modelled_K": round(float(np.median(suhii_mod)), 3),
        "suhii_measured_K": round(float(np.median(suhii_obs)), 3),
    }


def main() -> None:
    scenes, lc, dropped = _physics.load(all_angles=False)
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped)\n")

    rows = [run(c, scenes, lc) for c in CANDIDATES]

    print(f"  {'':4}{'candidate':<34}{'RMSE':>7}{'urban':>8}{'rural':>8}{'spread':>8}"
          f"{'SUHII':>8}{'pinned':>9}")
    for r in rows:
        print(f"  {r['key']:<4}{r['label']:<34}{r['rmse_K']:>7.3f}{r['urban_bias_K']:>8.2f}"
              f"{r['rural_bias_K']:>8.2f}{r['bias_spread_K']:>8.2f}{r['suhii_modelled_K']:>8.2f}"
              f"{(','.join(r['pinned']) or '—'):>9}")
    print(f"  {'':38}{'':>7}{'':>8}{'':>8}{'':>8}{rows[0]['suhii_measured_K']:>8.2f}  <- measured\n")

    for r in rows:
        print(f"  {r['key']}  {r['fitted']}")

    base = rows[0]
    ok = [r for r in rows[1:]
          if not r["pinned"] and r["rmse_K"] < base["rmse_K"] - 0.2
          and abs(r["suhii_modelled_K"]) < 2 * max(0.1, abs(r["suhii_measured_K"])) + 0.4
          and r["bias_spread_K"] < base["bias_spread_K"]]
    print()
    if ok:
        best = min(ok, key=lambda r: r["rmse_K"])
        print(f"  MEETS EVERY CRITERION: {best['key']} — {best['label']}")
        print(f"  RMSE {base['rmse_K']} -> {best['rmse_K']} K, nothing pinned, "
              f"SUHII {best['suhii_modelled_K']} vs {best['suhii_measured_K']} measured.")
    else:
        print("  NO candidate meets all four criteria. Improving RMSE while still "
              "pinning means a longer lever on the same wrong shape, not a fix.")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump({"note": "EXPERIMENT ONLY — not a calibration, never shipped. "
                           "fit-physics.py remains the calibration entrypoint.",
                   "scenes": len(scenes), "candidates": rows}, fh, indent=2)
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
