"""Score modelled flood extent against Landsat-observed extent, April 2024.

THE FIRST TEST OF CORRECTNESS, not reproducibility. validate-flood-stability.py
answers "does the answer survive the terrain's error bar"; this one answers "is
the answer right". They are different questions and a good score on one implies
nothing about the other.

THE SCENARIO IS 142 mm, NOT 254.8 mm. The stability harness runs Al Ain's rain
(254.8 mm, Khatm Al Shakla) because that is the total Hussein et al. paired with
their measured 7.14 % runoff ratio. Dubai recorded ~142 mm on 16 April 2024.
Scoring a 1.74x storm against Dubai's own imagery would charge the model for rain
that never fell there — it would flood too much and read as model error.

WHAT IS COMPARED, AND WHY BOTH.

  PEAK     the model's headline output — maximum depth during the storm.
  RESIDUAL what is still standing when the 6 h simulation ends.

Landsat imaged 3 days after the rain. Neither modelled quantity is that: peak is
too early, residual is 6 h not 72 h. Peak is the fairer comparison only because
arid drainage is slow — Hong 2026 measured ~95 % of flooded area still submerged
at day 3. Residual is the like-for-like quantity but under-drains. Reporting both
and stating where they diverge is more honest than picking the flattering one.

SCORED AT DISTRICT SCALE FIRST. The model's claim, evidenced by the stability
harness, is district-scale: CSI 0.624 between equally-plausible terrains means
per-cell agreement is not on offer even against ITSELF. Scoring per-pixel against
observation would mostly re-measure that known limit. So the headline is a
coarse-grained comparison — flooded fraction per block — with per-pixel CSI
reported underneath as context, not as the verdict.

A LOW SCORE IS AMBIGUOUS, AND THE TIE-BREAK IS DECIDED IN ADVANCE. At 30 m,
water in a street between buildings is sub-pixel; the published work on this
event used 3 m PlanetScope with a trained classifier. So disagreement could be
model error OR sensor limit. The discriminator is DRAINAGE: if the modelled
recession tracks the observed 19 -> 27 April drop even where absolute extent
disagrees, the physics is right and the sensor is coarse.

    python3 scripts/validate-flood-extent.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flood_unsteady import runoff_field, sea_mask, simulate  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")

DUBAI_RAIN_MM = 142.0     # RMetS via Almansoori & Hong; Abdelalim gives 118.9 mm/24 h
WET_M = 0.10              # the access-disruption threshold from types.ts
BLOCK = 16                # 16 cells = 480 m — a city block, the district-scale unit


def confusion(model: np.ndarray[Any, Any], obs: np.ndarray[Any, Any]) -> dict[str, float]:
    """CSI / POD / FAR. FAR is the ratio form (Barnes et al. 2009), not 1-precision."""
    hit = float((model & obs).sum())
    miss = float((~model & obs).sum())
    false = float((model & ~obs).sum())
    return {
        "hits": hit, "misses": miss, "falseAlarms": false,
        "csi": hit / (hit + miss + false) if (hit + miss + false) else 0.0,
        "pod": hit / (hit + miss) if (hit + miss) else 0.0,
        "far": false / (hit + false) if (hit + false) else 0.0,
        "bias": (hit + false) / (hit + miss) if (hit + miss) else 0.0,
    }


def blockwise(a: np.ndarray[Any, Any], k: int) -> np.ndarray[Any, Any]:
    """Mean over k x k blocks — the district-scale view."""
    n = (a.shape[0] // k) * k
    out: np.ndarray[Any, Any] = a[:n, :n].reshape(n // k, k, n // k, k).mean(axis=(1, 3))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rain", type=float, default=DUBAI_RAIN_MM)
    ap.add_argument("--out", default=os.path.join(DATA, "..", "flood-extent-validation.json"))
    a = ap.parse_args()

    terr = json.load(open(os.path.join(DATA, "dubai-creek-terrain.json")))
    obsd = json.load(open(os.path.join(DATA, "dubai-creek-flood-observed.json")))
    n, cell = int(terr["n"]), float(terr["cellM"])
    if int(obsd["n"]) != n:
        print(f"  grid mismatch: terrain {n}, observed {obsd['n']}")
        return 1

    z = np.asarray(terr["h"], dtype="float64").reshape(n, n)
    bcr = np.asarray(terr["bcr"], dtype="float64").reshape(n, n)
    sink = sea_mask(z)
    obs = np.asarray(obsd["wet"], dtype=bool).reshape(n, n)
    obs_rec = np.asarray(obsd["wetRecovery"], dtype=bool).reshape(n, n)
    delta = np.asarray([np.nan if v is None else v for v in obsd["deltaMndwi"]],
                       dtype="float64").reshape(n, n)

    # Only score where BOTH sources have an opinion: land, and cloud-free on both
    # Landsat dates. Scoring over cells the satellite could not see would count
    # our own model against a gap.
    scored = (~sink) & np.isfinite(delta)
    print(f"  grid {n}x{n} @ {cell:.0f} m   scorable cells {scored.sum():,} "
          f"({scored.mean()*100:.1f} % of grid)")
    print(f"  rain {a.rain} mm — Dubai's own 16 Apr 2024 total, NOT the 254.8 mm Al Ain scenario\n")

    ro = runoff_field(a.rain, bcr)
    print(f"  runoff mean {ro.mean():.1f} mm; simulating...")
    peak, resid, steps, t = simulate(z, bcr, ro, cell=cell, sink=sink)
    print(f"  {steps:,} steps, {t/3600:.2f} h simulated\n")

    cell_km2 = (cell * cell) / 1e6
    report: dict[str, Any] = {
        "site": terr["site"], "rainMm": a.rain,
        "observed": {k: obsd["scenes"][k] for k in obsd["scenes"]},
        "observedKm2": obsd["floodedKm2"], "observedRecoveryKm2": obsd["recoveryKm2"],
        "scorableCells": int(scored.sum()),
    }

    for label, field in (("peak", peak), ("residual", resid)):
        mod = (field > WET_M) & scored
        o = obs & scored
        c = confusion(mod, o)
        mb, ob = blockwise(mod.astype("float64"), BLOCK), blockwise(o.astype("float64"), BLOCK)
        keep = blockwise(scored.astype("float64"), BLOCK) > 0.5
        r = float(np.corrcoef(mb[keep], ob[keep])[0, 1]) if keep.sum() > 2 else 0.0
        km2 = float(mod.sum()) * cell_km2
        report[label] = {
            "modelledKm2": round(km2, 3),
            "areaRatio": round(km2 / max(obsd["floodedKm2"], 1e-9), 3),
            **{k: round(v, 4) for k, v in c.items()},
            "blockCorrelation": round(r, 4),
            "blockSizeM": BLOCK * cell,
        }
        print(f"  {label.upper():9s} modelled {km2:6.2f} km2 vs observed {obsd['floodedKm2']:6.2f} km2"
              f"   ratio {km2/max(obsd['floodedKm2'],1e-9):.2f}")
        print(f"            per-cell  CSI {c['csi']:.3f}  POD {c['pod']:.3f}  FAR {c['far']:.3f}  bias {c['bias']:.2f}")
        print(f"            district  block-{BLOCK*int(cell)}m correlation r = {r:+.3f}\n")

    # THE TIE-BREAK, decided before the numbers were seen: does modelled recession
    # match observed recession, even if absolute extent does not?
    obs_drop = 1.0 - (obsd["recoveryKm2"] / max(obsd["floodedKm2"], 1e-9))
    mod_drop = 1.0 - (float(((resid > WET_M) & scored).sum())
                      / max(float(((peak > WET_M) & scored).sum()), 1e-9))
    report["recession"] = {
        "observedDropFraction": round(obs_drop, 4),
        "modelledPeakToResidualDrop": round(mod_drop, 4),
        "note": ("observed drop is 8 days (19->27 Apr); modelled drop is the 6 h "
                 "simulation window only, so the modelled figure should be SMALLER. "
                 "If it is larger, the solver is draining too fast."),
    }
    print(f"  RECESSION observed 19->27 Apr: {obs_drop*100:.1f} % of flooded area drained")
    print(f"            modelled peak->6 h:  {mod_drop*100:.1f} %   "
          f"({'plausible' if mod_drop < obs_drop else 'DRAINS TOO FAST — 6 h should not beat 8 days'})")

    json.dump(report, open(os.path.abspath(a.out), "w"), indent=2)
    print(f"\n  wrote {os.path.abspath(a.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
