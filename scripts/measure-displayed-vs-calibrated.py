#!/usr/bin/env python3
"""
Is the number the page DISPLAYS inside the band it publishes?

    python3 scripts/measure-displayed-vs-calibrated.py

WHY THIS EXISTS. Every published accuracy figure — the night ±3.0 K, the peak
±4.5 K, the 7.54 K transition — scores the CALIBRATED EQUATION: fit-ward-scale.py
`predict` at the ward's mean surface, which is the closed-form equilibrium
`(gain + kRad·tSky + h·wind·tAir) / (kRad + h·wind)`. The page does not show that.
It shows the field of `TsHeatSim` (or its GPU twin), whose convective term carries
a per-cell ventilation factor `max(0.15, 1 − 0.55·built + 0.65·water)` that the
calibration has never seen, plus lateral diffusion. A built cell sheds heat to the
air more slowly than the equation assumes, so the displayed ward mean runs warm of
the calibrated one, by an amount that grows with the ward's built fraction and with
how much convection matters (low wind, strong sun).

This measures it rather than estimating it: for every scored observation row it
drives the shipped solver through scripts/displayed-field-means.mjs (the app's own
layers, currentParams and Ward 68 polygon mask) and scores the displayed mean
against the same observation with the same statistics measure-accuracy.py
publishes, beside the calibrated figure.

THE CALIBRATED COLUMN MUST REPRODUCE THE PUBLISHED ONE, or the comparison is
between two harnesses rather than two fields. This script recomputes every
stratum's calibrated bias and RMSE with the published scorer and exits if they do
not match model-accuracy.json — so a drifted row set, a stale artefact or a changed
candidate cannot hide inside the "displayed" column.

NOTHING HERE CHANGES THE MODEL. It is evidence for a decision, not the decision.

Output: data/calibration/displayed-vs-calibrated.json
"""
from __future__ import annotations

import datetime as _dt
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
from types import ModuleType
from typing import Any, TypedDict

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402

ROOT = os.path.join(HERE, "..")
OBS = os.path.join(ROOT, "data", "calibration", "ward-observations.json")
FIT = os.path.join(ROOT, "data", "calibration", "ward-scale-fit.json")
ACC = os.path.join(ROOT, "data", "calibration", "model-accuracy.json")
OUT = os.path.join(ROOT, "data", "calibration", "displayed-vs-calibrated.json")
DRIVER = os.path.join(HERE, "displayed-field-means.mjs")

#: The calibrated column may differ from model-accuracy.json by rounding only.
REPRODUCE_TOL_K = 0.002

#: The published bands, as accuracy.ts ships them, and the stratum each covers.
#: Copied as LABELS for the report; the test (heat-map-accuracy) holds accuracy.ts.
BANDS: dict[str, tuple[str, float]] = {
    "night": ("night ±3.0 K (ACCURACY.night.bandK)", 3.0),
    "peak_ecostress": ("peak ±4.5 K (ACCURACY.peak.bandK, n=29 earlier set)", 4.5),
    "morning_ecostress": ("transition 7.54 K (TRANSITION_RMSE_K)", 7.54),
    "morning_landsat": ("peak ±4.5 K (10:30 sits outside TRANSITION_HOURS)", 4.5),
}

#: Kolkata's seasons, by month. Pre-monsoon is where the audit saw the model run hot.
SEASONS: dict[str, tuple[int, ...]] = {
    "winter (Dec-Feb)": (12, 1, 2),
    "pre-monsoon (Mar-Jun)": (3, 4, 5, 6),
    "monsoon (Jul-Sep)": (7, 8, 9),
    "post-monsoon (Oct-Nov)": (10, 11),
}


class Stats(TypedDict):
    n_scenes: int
    n_overpasses: int
    bias_K: float
    rmse_K: float
    loo_overpass_rmse_K: float | None


def _module(name: str, file: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    if spec is None or spec.loader is None:
        sys.exit(f"cannot import {file}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rmse(x: npt.NDArray[np.float64]) -> float:
    return math.sqrt(float(np.mean(x ** 2)))


def stats(e: npt.NDArray[np.float64], d: npt.NDArray[np.str_]) -> Stats:
    """Bias, RMSE and LOO-overpass RMSE exactly as measure-accuracy.py computes them:
    hold out a whole pass, remove the rest's mean bias, score the held-out rows."""
    passes = sorted(set(d.tolist()))
    loo: list[float] = []
    for p in passes:
        te = d == p
        tr = ~te
        if tr.sum() < 8:
            continue
        loo.extend((e[te] - e[tr].mean()).tolist())
    return {"n_scenes": int(e.size), "n_overpasses": len(passes),
            "bias_K": round(float(e.mean()), 3), "rmse_K": round(rmse(e), 3),
            "loo_overpass_rmse_K": round(rmse(np.asarray(loo)), 3) if loo else None}


def main() -> None:
    fws = _module("fws", "fit-ward-scale.py")
    macc = _module("macc", "measure-accuracy.py")
    with open(OBS) as fh:
        raw: list[dict[str, Any]] = json.load(fh)["rows"]
    with open(FIT) as fh:
        candidates = json.load(fh)["candidates"]
    with open(ACC) as fh:
        published = json.load(fh)["ward_scale"]["strata"]

    # The scored model, selected exactly as measure-accuracy.py selects it.
    shipped = [c for c in candidates
               if abs(c["fitted"].get("release_base", 0.0) - _physics.STORE_NIGHT) < 5e-4
               and abs(c["fitted"].get("l_et", 0.0) - _physics.L_ET) < 5e-4]
    if len(shipped) != 1:
        sys.exit(f"no single shipped candidate ({[c['key'] for c in shipped]})")
    night_release = shipped[0]["fitted"].get("release_base", 0.0) > 0
    params: dict[str, float] = dict(fws.SHIP)
    params.update(shipped[0]["fitted"])
    params["q_day"] = float(macc.shipped_q())

    rows = fws.load_rows(sensors=None)
    if len(rows) != len(raw):
        sys.exit("fit-ward-scale's loader and the artefact disagree on row count")
    obs = np.array([r.lst for r in rows], dtype=np.float64)
    calib = np.array([float(fws.predict(params, r, night_release)) for r in rows], dtype=np.float64)

    sensor = np.array([r.get("sensor", "ecostress") for r in raw])
    hour = np.array([float(r.get("hour", 0.0)) for r in raw])
    phase = np.array([r["phase"] for r in raw])
    date = np.array([r["date"] for r in raw])
    ward = np.array([r["ward"] for r in raw])
    month = np.array([int(r["date"][5:7]) for r in raw])
    is_day = phase == "day"
    eco, lan = sensor == "ecostress", sensor == "landsat"
    mm = float(macc.MORNING_MAX_HOUR)
    strata = {
        "night": phase == "night",
        "morning_ecostress": is_day & eco & (hour <= mm),
        "morning_landsat": is_day & lan & (hour <= mm),
        "peak_ecostress": is_day & eco & (hour > mm),
    }

    # 1 — the calibrated column reproduces the published one, or nothing is reported.
    for name, m in strata.items():
        s: dict[str, Any] = dict(stats(calib[m] - obs[m], date[m]))
        p = published[name]
        for k in ("bias_K", "rmse_K", "loo_overpass_rmse_K"):
            if abs(float(s[k] or 0.0) - float(p[k] or 0.0)) > REPRODUCE_TOL_K:
                sys.exit(f"  {name}.{k}: recomputed {s[k]} vs published {p[k]} "
                         f"— re-run measure-accuracy.py first; this harness must "
                         f"start from the published figures")
    print("  calibrated column reproduces model-accuracy.json on every stratum")

    # 2 — drive the shipped solver.
    req = [{"ward": r["ward"], "phase": r["phase"], "tAir": r["tAir"], "rh": r["rh"],
            "wind": r["wind"], "cloud": r["cloud"], "sun": r["sun"],
            "month": int(r["date"][5:7]), "hour": int(float(r.get("hour", 12.0)))}
           for r in raw]
    with tempfile.TemporaryDirectory() as tmp:
        ip, op = os.path.join(tmp, "rows.json"), os.path.join(tmp, "out.json")
        with open(ip, "w") as fh:
            json.dump({"rows": req}, fh)
        subprocess.run(["node", "--import", "tsx", DRIVER, ip, op], check=True, cwd=ROOT)
        with open(op) as fh:
            disp = json.load(fh)["rows"]
    settled = np.array([d["settled"] for d in disp], dtype=np.float64)
    first = np.array([d["first"] for d in disp], dtype=np.float64)
    eq_ts = np.array([d["eqTs"] for d in disp], dtype=np.float64)
    lit = np.array([bool(d["lit"]) for d in disp])
    mismatched_branch = int(np.sum(lit != is_day))

    def block(m: npt.NDArray[np.bool_]) -> dict[str, Any]:
        if not m.any():
            return {}
        return {
            "calibrated": stats(calib[m] - obs[m], date[m]),
            "displayed_settled": stats(settled[m] - obs[m], date[m]),
            "displayed_first_frame": stats(first[m] - obs[m], date[m]),
            # Decomposition of displayed − calibrated: the solver's own departure from
            # its undamped equation, and that equation's departure from the published
            # scorer (surface means on the solver grid, the app's night-ET taper).
            "solver_minus_equation_K": round(float(np.mean(settled[m] - eq_ts[m])), 3),
            "app_equation_minus_calibrated_K": round(float(np.mean(eq_ts[m] - calib[m])), 3),
            "displayed_minus_calibrated_K": round(float(np.mean(settled[m] - calib[m])), 3),
        }

    out_strata: dict[str, Any] = {}
    for name, m in strata.items():
        b = block(m)
        label, band = BANDS[name]
        loo = b["displayed_settled"]["loo_overpass_rmse_K"]
        rm = b["displayed_settled"]["rmse_K"]
        b["band"] = {"label": label, "K": band,
                     "displayed_rmse_within": rm <= band,
                     "displayed_loo_overpass_within": loo is not None and loo <= band,
                     # accuracy.ts's own rule: the band covers in-sample AND out-of-sample.
                     "holds": rm <= band and loo is not None and loo <= band}
        b["by_season"] = {s: blk for s, mo in SEASONS.items()
                          if (blk := block(m & np.isin(month, mo)))}
        w68 = m & (ward == "ballygunge")
        b["ward_68_only"] = block(w68)
        if b["ward_68_only"]:
            b["ward_68_only"]["by_season"] = {s: blk for s, mo in SEASONS.items()
                                              if (blk := block(w68 & np.isin(month, mo)))}
        out_strata[name] = b

    doc = {
        "note": "Displayed (shipped TsHeatSim field, ward mean; Ward 68 polygon-masked) vs "
                "calibrated (fit-ward-scale predict at the shipped constants, as "
                "model-accuracy.json scores it), same rows, same statistics. Evidence for "
                "a decision; nothing in the model was changed to produce it.",
        "generated": _dt.date.today().isoformat(),
        "rows": len(raw),
        "scored": params,
        "solver": {"settle": "advanced in 400-step chunks until the ward mean moved "
                             "< 1e-4 K; first_frame = RESET_BURST steps after reset",
                   "ventilation": "max(0.15, 1 - 0.55*built + 0.65*water); water layer off",
                   "rows_on_other_branch": mismatched_branch},
        "strata": out_strata,
    }
    with open(OUT, "w") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")

    print(f"\n  {'stratum':<19}{'n':>4} {'calibrated bias/RMSE/LOO':>27} "
          f"{'displayed bias/RMSE/LOO':>27}  band")
    for name, b in out_strata.items():
        c, d = b["calibrated"], b["displayed_settled"]
        print(f"  {name:<19}{c['n_scenes']:>4} "
              f"{c['bias_K']:+8.2f} {c['rmse_K']:7.2f} {c['loo_overpass_rmse_K']:7.2f}   "
              f"{d['bias_K']:+8.2f} {d['rmse_K']:7.2f} {d['loo_overpass_rmse_K']:7.2f}   "
              f"{b['band']['K']:.2f} {'holds' if b['band']['holds'] else 'FAILS'}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
