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


#: Instruments this fit is willing to pool.
#:
#: ONE SENSOR BY DEFAULT, AND THAT DEFAULT IS LOad-BEARING. ward-observations.json
#: carries ECOSTRESS and Landsat since the 2026-08-02 validation campaign, and
#: accuracy.ts names THIS script in its regeneration recipe. A loader that reads
#: every row would quietly refit the shipping calibration across two instruments
#: — and across two times of day, since Landsat is pinned near 10:30 while
#: ECOSTRESS drifts — at the same moment measure-accuracy.py reports that the
#: offset between them is not measurable on this archive (only 2 ECOSTRESS
#: overpasses fall in Landsat's window, against a minimum of 5).
#:
#: So "more evidence arrived" must never silently mean "the calibration moved".
#: Multi-sensor work opts in explicitly: load_rows(sensors=None).
DEFAULT_SENSORS: tuple[str, ...] = ("ecostress",)


def load_rows(sensors: tuple[str, ...] | None = DEFAULT_SENSORS) -> list[Row]:
    """Ward-scene rows for the fit. `sensors=None` disables the filter entirely.

    Rows written before the campaign have no `sensor` key and are ECOSTRESS by
    construction, so the default treats a missing key as such.
    """
    if not os.path.exists(OBS):
        sys.exit(f"{os.path.relpath(OBS, ROOT)} is missing — run "
                 f"`python3 scripts/build-ward-observations.py` first.")
    with open(OBS) as fh:
        raw = json.load(fh)["rows"]
    if sensors is not None:
        raw = [r for r in raw if r.get("sensor", "ecostress") in sensors]
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

    # CAPPED AT 1.0 — mirrors currentParams in heat-map-model.ts; see
    # docs/green-score-methodology.md 4.2.2. Uncapped this ramp raised ET without
    # limit as air dried, past the model's own 4 K vegetated-surface bar on six of
    # the 298 readings in this very archive. Training on a different shape than
    # the one that ships is not calibration, so the cap belongs in both places.
    L = p["l_et"] * _physics.evap_scale(r.rh)
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
    # THE HONEST BASELINE. A fits c to 1.40, which assertSkyLogic rejects — at
    # Kolkata humidity it makes the clear sky as warm as the air. Comparing a
    # candidate against a baseline that itself violates the physics flatters the
    # candidate. This is the shipping structure with every constant admissible,
    # and it is what any change has to beat.
    Cand("A2", "baseline, c held admissible at 1.24",
         ("q_day", "ratio"), (0.30, 0.50),
         (0.02, 0.15), (0.60, 1.50), False),
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
    # THE SHIPPABLE ONE. D and E both drive L_ET to 0.8, which is not a free
    # choice: types.ts records [0.40, 0.46] as the range that was believed to
    # satisfy BOTH the Kolkata park cool-island measurements and the physical
    # ceiling on what evapotranspiration can deliver, and validate-model.mjs
    # asserts a consequence of it. CAVEAT 2026-08-08: the park-cooling half of
    # that pair is WITHDRAWN — the paper is Li et al. 2022, not Mitra, and its
    # "4.83-8.07 C" is a cross-city range of maxima (8.07 Kolkata, 4.83 Bangkok),
    # not a Kolkata band, so the 0.40 lower end is unsupported. See
    # docs/green-score-methodology.md 4.2. The argument BELOW still holds on the
    # physical ceiling alone, which is what rejects 0.8. A fit that wants 0.8 is asking for roughly
    # twice the cooling ET can produce; adopting it would trade a calibration
    # failure for an unphysical constant, which is the same mistake in a nicer
    # suit. Held inside the defensible range, the rest is free to move.
    # RE-DERIVED 2026-08-09 (green-score-methodology 4.2.1). The [0.40, 0.46]
    # band cannot be reproduced from this model — park cooling is exactly
    # 15*L_eff, so even the old two-sided band maps to [0.383, 0.640] at rh 60.
    # The bounds below are therefore a DELIBERATE CONSERVATIVE CHOICE inside a
    # one-sided feasible region, not a derived interval. l_et rails to the upper
    # bound whatever it is set to, so this bound alone decides the shipped value.
    Cand("F", "storage + ratio open, ET held at the chosen conservative ceiling 0.46",
         ("q_day", "ratio", "c", "l_et", "release_base", "release_built"),
         (0.30, 0.30, 1.24, 0.43, 0.05, 0.05),
         (0.02, 0.01, 1.20, 0.40, 0.00, 0.00),
         (0.60, 1.50, 1.60, 0.46, 0.50, 0.50), True),
    # FULLY PHYSICAL. F keeps ET defensible but buys it by driving the coupling
    # ratio to 0.029, and that is unphysical in the other direction: linearised
    # radiative coupling is ~4*eps*sigma*T^3 ~ 6 W/m2K against a convective
    # 10-30, so kRad:h belongs in roughly 0.2-0.6. A fit is not "physical"
    # because the parameter you were watching stayed in range.
    #
    # So every constant is held inside its defensible range at once and the
    # storage term — the one mechanism that is genuinely missing rather than
    # mis-valued — is given room to do the work. If this cannot fit, that is a
    # real result: it means the remaining error is not reachable by any
    # admissible parameter set, and the honest move is to report the gap rather
    # than buy it with a constant nobody can defend.
    # c is bounded [1.23, 1.26], NOT the literature's [1.20, 1.40]. Two existing
    # invariants pin it: the clear sky must stay below air (fails at c >= 1.33 in
    # Kolkata humidity), and T_sky at 28/80 must land 19-21 C, a validated local
    # expectation that holds only in this narrow window. The fit wanted 1.40 and
    # was refused. The published range is global; local humidity is what binds.
    # c is NOT FITTED. Two invariants pin it to a 0.03-wide window (1.23-1.26)
    # and it is a literature constant validated against a Kolkata night
    # expectation, not a free parameter. Fitting inside a window that narrow just
    # produces another parameter resting on a bound and pretends it was chosen.
    # Held at the published 1.24.
    Cand("G", "storage free, ALL constants held physical",
         ("q_day", "ratio", "l_et", "release_base", "release_built"),
         (0.30, 0.40, 0.43, 0.10, 0.05),
         (0.02, 0.20, 0.40, 0.00, 0.00),
         (0.60, 0.60, 0.46, 1.20, 1.20), True),
]


#: Paired-bootstrap resamples behind the q_day plateau, and its pinned seed.
#: Unpinned randomness would make the artefact differ run to run; the repo
#: requires byte-stable outputs.
BOOT_B = 20000
BOOT_SEED = 20260813


def q_plateau(cand: Cand, rows: Sequence[Row]) -> dict[str, Any]:
    """The interval of q_day these observations CANNOT REJECT.

    WHY THIS EXISTS. tests/unit/heat-map-validation.test.mjs used to assert that
    the shipped Q equals this script's fitted q_day to 5e-4. That assertion has
    a premise — that the calibration identifies q_day to five-thousandths — and
    the premise is false. Correcting the stale built-footprint cache on
    2026-08-13 moved the free fit 0.419 -> 0.5175, a 23% swing, while in-sample
    RMSE moved 0.023 K and leave-one-ward-out moved 0.013 K. `built` fell 14% at
    the same time: ward means constrain the PRODUCT Q*built, not either factor.

    So the honest gate is not equality with the argmin. It is membership of the
    set the data cannot distinguish from the argmin — computed here by paired
    bootstrap over the ward-scenes, the same resampling measure-accuracy.py uses
    for its CIs. A q is admissible when the 95% CI of RMSE(q) - RMSE(q*)
    straddles zero.

    This is deliberately NOT a tolerance picked to admit the shipped value. It is
    a property of the observations, and it narrows on its own as the ECOSTRESS
    record grows. Once it narrows past the shipped Q, the test fails and the
    constant genuinely has to move.
    """
    qi = cand.names.index("q_day")
    names = tuple(n for n in cand.names if n != "q_day")
    keep = [i for i, n in enumerate(cand.names) if n != "q_day"]
    sub = Cand(cand.key, cand.label, names, tuple(cand.x0[i] for i in keep),
               tuple(cand.lo[i] for i in keep), tuple(cand.hi[i] for i in keep),
               cand.night_release)

    def resid_at(q: float) -> npt.NDArray[np.float64]:
        """Errors at q_day = q with every OTHER constant refitted — a profile,
        not a slice. Slicing at one fixed vector would understate how well the
        model can do at an off-optimum q, and so overstate identifiability."""
        saved = SHIP.copy()
        SHIP["q_day"] = q
        try:
            p = fit(sub, rows)
        finally:
            SHIP.clear()
            SHIP.update(saved)
        p["q_day"] = q
        return np.asarray([predict(p, r, cand.night_release) - r.lst for r in rows],
                          dtype=np.float64)

    grid = [round(cand.lo[qi] + i / 100, 2)
            for i in range(int(round((cand.hi[qi] - cand.lo[qi]) * 100)) + 1)]
    q_star = round(float(fit(cand, rows)["q_day"]), 4)

    rng = np.random.default_rng(BOOT_SEED)
    idx = rng.integers(0, len(rows), size=(BOOT_B, len(rows)))
    rmse_star = np.sqrt((resid_at(q_star)[idx] ** 2).mean(1))

    profile: list[dict[str, Any]] = []
    admissible: list[float] = []
    for q in grid:
        e = resid_at(q)
        d = np.sqrt((e[idx] ** 2).mean(1)) - rmse_star
        lo, hi = (float(v) for v in np.percentile(d, [2.5, 97.5]))
        ok = lo < 0.0 < hi
        profile.append({"q_day": q, "rmse_K": round(float(np.sqrt(np.mean(e ** 2))), 4),
                        "d_ci_lo_K": round(lo, 4), "d_ci_hi_K": round(hi, 4),
                        "admissible": ok})
        if ok:
            admissible.append(q)

    return {"what": "q_day values the ward-mean observations cannot distinguish from the best "
                    "fit: paired bootstrap of RMSE(q) - RMSE(q*), admissible when the 95% CI "
                    "straddles zero. NOT a hand-chosen tolerance.",
            "candidate": cand.key, "q_star": q_star,
            "bootstrap_B": BOOT_B, "seed": BOOT_SEED,
            "lo": min(admissible) if admissible else None,
            "hi": max(admissible) if admissible else None,
            "profile": profile}


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

    # The shipped constants come from candidate G, so G is the one whose q_day
    # identifiability the shipped Q has to be judged against.
    ship_cand = next(c for c in CANDIDATES if c.key == "G")
    plateau = q_plateau(ship_cand, rows)
    print(f"\n  q_day the observations CANNOT REJECT (candidate {plateau['candidate']}, "
          f"best fit {plateau['q_star']}): [{plateau['lo']}, {plateau['hi']}]")
    print("  Ward means constrain the product Q*built, not Q. A shipped Q inside this "
          "interval is not refuted by the data;\n  one outside it is.")

    with open(OUT, "w") as fh:
        json.dump({"note": "EXPERIMENT. Ward-scale calibration against ward-mean ECOSTRESS. "
                           "Not shipped until a human has read the out-of-sample column.",
                   "ship": False, "ward_scenes": len(rows), "wards": wards,
                   "meets_all_criteria": verdict, "candidates": results,
                   "q_identifiability": plateau}, fh, indent=2)
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
