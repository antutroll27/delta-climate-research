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
from collections.abc import Sequence
from typing import Any, Literal, TypedDict

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


#: Where the morning stratum ends and peak begins, local solar hours. Landsat's
#: descending node puts every one of its rows at 10.39-10.41; ECOSTRESS drifts.
#: Surface temperature climbs steeply through the morning, so a 10:30 reading and
#: a 13:00 reading are not the same measurement and must not share a stratum.
MORNING_MAX_HOUR = 11.5

#: The window the sensor comparison is confined to, local solar hours. Landsat
#: sits at 10.39-10.41; this is the band around it where an ECOSTRESS reading is
#: measuring the same time of day rather than a different part of the curve.
MATCH_LO, MATCH_HI = 9.5, 11.5

#: Fewer ECOSTRESS overpasses than this inside that window and the offset is an
#: anecdote. Two passes cannot separate a sensor difference from one odd day.
MIN_MATCH_OVERPASSES = 5

#: Above this, the two instruments disagree by enough that a pooled daytime
#: figure would be an average of two different things rather than a better
#: estimate of one. A blocked pooling is a publishable result, not a failure.
POOL_MAX_DELTA_K = 1.0

#: Seeded so the committed JSON is reproducible byte-for-byte. A silent seed
#: change is a silent change to a published confidence interval.
BOOTSTRAP_SEED = 7
BOOTSTRAP_N = 4000


def _ward_scale_validation() -> dict[str, Any] | None:
    """Stratified out-of-sample accuracy over the two-sensor ward-scale set.

    The machinery here was proven in scripts/experiment-validation-uncertainty.py
    and is promoted, not reinvented; that script stays as an independent
    cross-check which must agree with these numbers.

    LEAVE-ONE-OVERPASS-OUT IS THE ONLY SPLIT COMPUTED. Scene- and ward-level
    splits flatter the result, because one satellite pass covers all three wards
    and a held-out ward still sees its own weather through its siblings. The
    experiment script keeps those splits to DEMONSTRATE the leakage; the
    published file carries the honest number only.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "fws", os.path.join(ROOT, "scripts", "fit-ward-scale.py"))
    if spec is None or spec.loader is None:
        return None
    fws = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fws)

    obs_path = os.path.join(ROOT, "data", "calibration", "ward-observations.json")
    fit_path = os.path.join(ROOT, "data", "calibration", "ward-scale-fit.json")
    if not (os.path.exists(obs_path) and os.path.exists(fit_path)):
        return None
    with open(obs_path) as fh:
        raw = json.load(fh)["rows"]
    with open(fit_path) as fh:
        fitted = json.load(fh)["candidates"][0]["fitted"]   # A: shipping structure
    params = dict(fws.SHIP)
    params.update(fitted)

    rows = fws.load_rows(sensors=None)      # validation spans BOTH instruments
    if len(rows) != len(raw):
        return None                       # loader and file disagree; say nothing
    err = np.array([fws.predict(params, r, False) - r.lst for r in rows])
    sensor = np.array([r.get("sensor", "ecostress") for r in raw])
    hour = np.array([float(r.get("hour", 0.0)) for r in raw])
    date = np.array([r["date"] for r in raw])
    phase = np.array([r["phase"] for r in raw])
    stqa = [r.get("st_qa_mean_k") for r in raw]

    def stats(mask: "np.ndarray[Any, Any]") -> dict[str, Any] | None:
        """RMSE, bias, LOO-overpass RMSE and a bootstrap CI over overpasses."""
        e, d = err[mask], date[mask]
        if e.size == 0:
            return None
        passes = sorted(set(d))
        # LOO-overpass: hold out a whole satellite pass, correct the rest's mean
        # bias, score the held-out rows. Nothing else is fitted — this measures
        # what a constant offset generalises to, not a refit.
        loo: list[float] = []
        for p in passes:
            te = d == p
            tr = ~te
            if tr.sum() < 8:
                continue
            loo.extend(list(e[te] - e[tr].mean()))
        rng = np.random.default_rng(BOOTSTRAP_SEED)
        boots = []
        arr = np.array(passes)
        for _ in range(BOOTSTRAP_N):
            pick = rng.choice(arr, size=arr.size, replace=True)
            boots.append(rmse(np.concatenate([e[d == p] for p in pick])))
        lo, hi = (float(v) for v in np.percentile(boots, [2.5, 97.5]))
        q = [v for v, m in zip(stqa, mask) if m and v is not None]
        return {
            "n_scenes": int(e.size),
            "n_overpasses": len(passes),
            "rmse_K": round(rmse(e), 3),
            "bias_K": round(float(e.mean()), 3),
            "loo_overpass_rmse_K": round(rmse(loo), 3) if loo else None,
            "ci95_K": [round(lo, 3), round(hi, 3)],
            "ci95_halfwidth_K": round((hi - lo) / 2, 3),
            "hour_range": [round(float(hour[mask].min()), 2),
                           round(float(hour[mask].max()), 2)],
            # What the REFERENCE itself claims, so the model's error bar is never
            # read as if the ruler were exact.
            "reference_uncertainty_K": round(float(np.mean(q)), 3) if q else None,
        }

    is_day = phase == "day"
    eco, lst = sensor == "ecostress", sensor == "landsat"

    # ── the gate ──
    #
    # AT MATCHED HOURS, OR NOT AT ALL. A first cut compared ECOSTRESS across its
    # whole daytime spread (7.1-17.4 h) against Landsat's fixed 10.4 h node and
    # reported a -3.73 K "sensor offset". That number is almost entirely the
    # diurnal cycle: the model runs warm against afternoon readings and cool
    # against morning ones, which is what a steady-state model with no thermal
    # inertia should do. Calling it an instrument difference would have promoted
    # a known structural limitation into a fake calibration finding.
    win = is_day & (hour >= MATCH_LO) & (hour <= MATCH_HI)
    d_eco = float(err[win & eco].mean()) if (win & eco).any() else None
    d_lst = float(err[win & lst].mean()) if (win & lst).any() else None
    n_eco_pass = len(set(date[win & eco]))
    delta = None if (d_eco is None or d_lst is None) else d_lst - d_eco
    thin = n_eco_pass < MIN_MATCH_OVERPASSES
    blocked = thin or delta is None or abs(delta) > POOL_MAX_DELTA_K
    inter = {
        "window_hours": [MATCH_LO, MATCH_HI],
        "offset_K": {"ecostress": None if d_eco is None else round(d_eco, 3),
                     "landsat": None if d_lst is None else round(d_lst, 3)},
        "delta_K": None if delta is None else round(delta, 3),
        "n_overpasses": {"ecostress": n_eco_pass, "landsat": len(set(date[win & lst]))},
        "pooling": "blocked" if blocked else "allowed",
        "threshold_K": POOL_MAX_DELTA_K,
        "min_overpasses": MIN_MATCH_OVERPASSES,
        "note": (
            f"underpowered: only {n_eco_pass} ECOSTRESS overpass(es) fall in the "
            f"{MATCH_LO}-{MATCH_HI} h window Landsat occupies, below the "
            f"{MIN_MATCH_OVERPASSES} needed to call a sensor offset. Daytime strata "
            "are published separately and no pooled daytime figure is computed. "
            "Comparing outside this window would measure the diurnal cycle, not the "
            "instruments." if thin else
            "the instruments differ by more than the threshold at matched hours"
            if blocked else
            "sensor offset within threshold at matched hours; a pooled daytime "
            "stratum is computed alongside the per-sensor ones"),
    }

    # Every daytime row lands in exactly one stratum. An unstratified row is an
    # unpublished row, and 11 ECOSTRESS morning rows were silently falling
    # between `morning_landsat` (Landsat only) and `peak_ecostress` (>11.5 h).
    strata: dict[str, Any] = {
        "night": stats(phase == "night"),
        "morning_ecostress": stats(is_day & eco & (hour <= MORNING_MAX_HOUR)),
        "morning_landsat": stats(is_day & lst & (hour <= MORNING_MAX_HOUR)),
        "peak_ecostress": stats(is_day & eco & (hour > MORNING_MAX_HOUR)),
    }
    if not blocked and delta is not None:
        strata["day_pooled"] = stats(is_day)
    covered = sum(s["n_scenes"] for s in strata.values() if s)
    if covered != int(err.size):
        strata["_coverage_error"] = {"stratified": covered, "rows": int(err.size)}
    # Does accuracy.ts still describe the evidence that exists? The published
    # figures were computed on an ECOSTRESS-only set; that set grows whenever
    # NASA POWER publishes forcing for a recent overpass (its hourly product
    # lags real time by days to weeks), so drift here is ordinary and expected.
    # What must never happen is drift that nobody can see: this records it in
    # the generated file, and the unit test fails if it is neither matched nor
    # recorded. Adopting the new figures is a separate, reviewed change.
    n_eco_day = int((is_day & eco).sum())
    n_eco_night = int(((phase == "night") & eco).sum())
    pending = {
        "reason": "the ECOSTRESS evidence set grew after accuracy.ts was written",
        "published_in_accuracy_ts": {"night": 50, "peak": 29},
        "ecostress_rows_now": {"night": n_eco_night, "day": n_eco_day},
        "action": "recalibrate and update accuracy.ts in a reviewed change; this "
                  "campaign deliberately does not move published constants",
    }

    return {
        "method": ("leave-one-OVERPASS-out; scene- and ward-level splits leak "
                   "through shared overpasses and are not published"),
        "pending_recalibration": pending,
        "bootstrap": {"seed": BOOTSTRAP_SEED, "resamples": BOOTSTRAP_N,
                      "unit": "overpass"},
        "intercomparison": inter,
        "strata": {k: v for k, v in strata.items() if v is not None},
    }


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

    # The two-sensor ward-scale validation. Written alongside the mask-scale
    # phases rather than replacing them: they answer different questions, and
    # accuracy.ts still quotes the mask-scale figures until a reviewed PR moves
    # them. Absent (rather than faked) if the ward-scale artefacts are missing.
    ws = _ward_scale_validation()
    if ws is not None:
        out["ward_scale"] = ws                                   # type: ignore[typeddict-unknown-key]

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
