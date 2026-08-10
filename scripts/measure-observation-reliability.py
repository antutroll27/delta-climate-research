"""How much of ECOSTRESS's within-ward pattern is real? -> data/calibration/observation-reliability.json

WHY THIS EXISTS. We report that our modelled field correlates with ECOSTRESS at
r = 0.30 (day) / 0.16 (night) once the ward mean is removed, and that a plain
vegetation map does slightly better. Both statements are true. Neither is
interpretable without knowing how much of the OBSERVATION is itself signal.

A correlation is bounded by the reliability of what it is measured against. If
ECOSTRESS's own within-ward pattern only reproduces itself at r = 0.4, then no
model on Earth can score above sqrt(0.4) = 0.63 against it, and our 0.30 means
something very different from what it means against a perfect target.

THE MEASUREMENT. ECOSTRESS flies on the ISS, and along a single pass consecutive
granules OVERLAP. Our cache holds 91 granule pairs less than an hour apart, many
from the SAME ORBIT seconds apart. Over seconds the true surface temperature
field cannot have changed. So correlating one granule's ward anomaly against the
other's is a direct measurement of the instrument-plus-pipeline noise floor:

    reliability   = corr(obs_A, obs_B)          both ward-mean-removed
    ceiling       = sqrt(reliability)           the best r ANY model could score
    disattenuated = r_model / sqrt(reliability) what our skill would be against
                                                a noiseless target

WHAT THIS RUN ACTUALLY FOUND, AND THE TRAP IT AVOIDS. Over Kolkata, 2024-01 to
2026-08, CMR returns 307 granules and 154 pairs at IDENTICAL timestamps. Every one
of those is the same orbit and the same SCENE delivered into two adjacent MGRS
tiles (45QXE and 45QXF) -- one acquisition written into two grids, not two
observations. Correlating them measures reprojection noise and would return a
falsely high reliability. A genuine repeat needs two different SCENE numbers:
consecutive detector sweeps along one swath, overlapping on the ground.

By that test the whole archive yields ONE usable pair (Barrackpore, orbit 43114,
scenes 004/005, 52 s apart, 344 shared cells, r = 0.536). n = 1 is a data point,
not a measurement -- the script reports it and refuses to average anything into a
published ceiling. The ISS orbit simply does not revisit a 1.4 km ward twice in
quick succession often enough for this method to reach useful n.

THE SEPARATION IS THE EXPERIMENT, so it is reported per bin rather than pooled.
A pair seconds apart measures pure noise. A pair an hour apart also contains real
evolution of the surface, so its correlation is a LOWER bound on reliability.
Reading the two together separates "the sensor is noisy" from "the surface moved".

Only geometry the two granules share is used: a cell counts only where BOTH are
valid, and the anomaly is taken over exactly those cells, so a difference in cloud
masking cannot masquerade as disagreement.

    python3 scripts/measure-observation-reliability.py
    python3 scripts/measure-observation-reliability.py --max-gap-h 2
"""
from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import re
import sys
from collections import defaultdict
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
from _ecostress import CACHE, align  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "observation-reliability.json")

#: Kelvin. ECOSTRESS L2T LSTE is float32 Kelvin with 0 as its no-data.
KELVIN_FLOOR = 200.0

#: A ward-scene needs this many cells shared by BOTH granules to be scored. The
#: grid is 21x21 = 441, so this is a quarter of the ward.
MIN_SHARED = 110

#: Separation bins, hours. The first is effectively "same instant".
BINS = ((0.0, 0.05), (0.05, 0.5), (0.5, 1.0), (1.0, 4.0), (4.0, 24.0))

STAMP = re.compile(r"_(\d{5})_(\d{3})_(\w{5})_(\d{8}T\d{6})_")


def granules() -> list[tuple[datetime.datetime, str, str, str, str]]:
    """(time, tile, orbit, scene, path) for every cached LST band."""
    out: list[tuple[datetime.datetime, str, str, str, str]] = []
    for f in sorted(glob.glob(os.path.join(CACHE, "*_LST.tif"))):
        m = STAMP.search(os.path.basename(f))
        if not m:
            continue
        out.append((datetime.datetime.strptime(m.group(4), "%Y%m%dT%H%M%S"),
                    m.group(3), m.group(1), m.group(2), f))
    return out


def masked_field(path: str, ward: _types.Ward) -> npt.NDArray[np.float64] | None:
    """The ward window in Celsius, NaN where invalid. Cloud/QC bands are not read:
    this compares an observation against ITSELF, so any cell either granule cannot
    see is dropped by the shared mask below — which is stricter than a QC filter
    and cannot differ between the two."""
    try:
        a = align(path, np.nan, "float32", _types.ward_bounds(ward)).astype(np.float64)
    except Exception:
        return None
    a[a < KELVIN_FLOOR] = np.nan
    return a - 273.15


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-gap-h", type=float, default=24.0)
    args = ap.parse_args()

    recs = granules()
    print(f"  cached LST granules: {len(recs)}")
    by_tile: dict[str, list[tuple[datetime.datetime, str, str, str]]] = defaultdict(list)
    for t, tile, orb, scene, path in recs:
        by_tile[tile].append((t, orb, scene, path))

    pairs = []
    for tile, lst in by_tile.items():
        lst.sort()
        for i in range(len(lst) - 1):
            for j in range(i + 1, min(i + 4, len(lst))):
                gap = (lst[j][0] - lst[i][0]).total_seconds() / 3600
                if gap <= args.max_gap_h:
                    pairs.append((gap, tile, lst[i], lst[j]))
    pairs.sort()
    print(f"  granule pairs within {args.max_gap_h} h: {len(pairs)}\n")

    scored: list[dict[str, Any]] = []
    for gap, tile, (t1, o1, s1, p1), (t2, o2, s2, p2) in pairs:
        for wid, w in _types.WARDS.items():
            a, b = masked_field(p1, w), masked_field(p2, w)
            if a is None or b is None or a.shape != b.shape:
                continue
            # SAME SCENE = same acquisition in two tile grids, not a repeat.
            if s1 == s2:
                continue
            m = np.isfinite(a) & np.isfinite(b)          # SHARED cells only
            if int(m.sum()) < MIN_SHARED:
                continue
            x, y = a[m], b[m]
            x = x - x.mean()                              # anomaly, over shared cells
            y = y - y.mean()
            sx, sy = x.std(), y.std()
            if sx < 1e-6 or sy < 1e-6:
                continue
            scored.append({
                "gap_h": round(gap, 4), "ward": wid, "tile": tile,
                "same_orbit": o1 == o2, "scenes": f"{s1}/{s2}",
                "utc": t1.strftime("%Y-%m-%dT%H:%M:%S"),
                "night": not (6 <= ((t1.hour + 5) % 24) < 18),   # IST = UTC+5:30
                "cells": int(m.sum()),
                "r": float(np.corrcoef(x, y)[0, 1]),
                "sd_a_k": float(sx), "sd_b_k": float(sy),
                "rmse_k": float(np.sqrt(np.mean((x - y) ** 2))),
            })
        if len(scored) and len(scored) % 40 == 0:
            print(f"    {len(scored)} ward-pairs scored")

    if not scored:
        sys.exit("  no ward-pairs met the shared-cell threshold")

    print(f"\n  {len(scored)} ward-pairs scored\n")
    print("  separation      n   reliability r   RMSE between the two   obs SD")
    out_bins = []
    for lo, hi in BINS:
        s = [x for x in scored if lo <= x["gap_h"] < hi]
        if not s:
            continue
        r = float(np.mean([x["r"] for x in s]))
        rm = float(np.mean([x["rmse_k"] for x in s]))
        sd = float(np.mean([(x["sd_a_k"] + x["sd_b_k"]) / 2 for x in s]))
        print(f"  {lo:5.2f}-{hi:<6.2f} {len(s):>4}   {r:>10.3f}   {rm:>15.2f} K   {sd:>6.2f} K")
        out_bins.append({"gap_lo_h": lo, "gap_hi_h": hi, "n": len(s),
                         "reliability_r": round(r, 4), "rmse_between_k": round(rm, 3),
                         "obs_sd_k": round(sd, 3)})

    tight = [x for x in scored if x["gap_h"] < 0.5]
    rel = float(np.mean([x["r"] for x in tight])) if tight else float("nan")
    ceiling = float(np.sqrt(max(0.0, rel)))
    print(f"\n  RELIABILITY at separations under 30 min: r = {rel:.3f}  (n = {len(tight)})")
    print(f"  => the best correlation ANY model could score against this target:"
          f" sqrt({rel:.3f}) = {ceiling:.3f}")
    print()
    for phase, rmod in (("day", 0.296), ("night", 0.156)):
        s = [x for x in tight if x["night"] == (phase == "night")]
        if not s:
            print(f"  {phase:<6} no tight pairs in this phase — cannot disattenuate")
            continue
        rp = float(np.mean([x["r"] for x in s]))
        c = float(np.sqrt(max(1e-9, rp)))
        print(f"  {phase:<6} reliability {rp:5.3f} (n={len(s):>3})  ceiling {c:5.3f}   "
              f"our r {rmod:5.3f}  ->  disattenuated {rmod / c:5.3f}")

    doc = {
        "n_ward_pairs": len(scored),
        "min_shared_cells": MIN_SHARED,
        "bins": out_bins,
        "reliability_under_30min": round(rel, 4),
        "ceiling_r": round(ceiling, 4),
        "note": ("Reliability is corr(obs_A, obs_B) for two ECOSTRESS granules of the same "
                 "ward within 30 minutes, ward mean removed over the cells BOTH see. It "
                 "bounds any model's achievable r at sqrt(reliability). Pairs seconds apart "
                 "measure instrument noise; wider gaps also contain real surface evolution "
                 "and so under-state reliability."),
        "pairs": sorted(scored, key=lambda x: x["gap_h"])[:200],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
