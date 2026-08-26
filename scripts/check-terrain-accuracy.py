"""Score the terrain artefact against SURVEYED ground levels, not gazetteer guesses.

WHY THIS EXISTS. Terrain accuracy was being checked against whatever elevation a
search returned for a place name, and that method produced a false alarm: our
surface read 2.50 m at Dubai International against a "published 19.0 m", which
looked like a 16.5 m error. It was not. 62 ft / 18.9 m is OMDB's AERODROME
ELEVATION — by ICAO definition the highest point of the landing area. The ARP
itself sits at 3.3 m and the western airfield is surveyed at 1.5-2.4 m. The
terrain was right and the reference was wrong.

WHAT THESE NUMBERS ARE. The UAE AIP (GCAA) publishes an obstacle table per
aerodrome giving each obstacle's ELEVATION and its HEIGHT. Elevation minus height
is the surveyed ground level at a known lat/lon. That is real survey — better
than any gazetteer, gazetteer-DEM hybrid, or gridded product — and it is free.

TWO TRAPS THIS FILE ENCODES SO THEY ARE NOT RE-WALKED.

  · AERODROME ELEVATION IS A MAXIMUM, NOT A SITE LEVEL. DXB's runway thresholds
    span 3.3 m (12R) to 18.2 m (30L); DWC's span 35.1 m (12) to 52.0 m (30), a
    17 m fall across one airfield. Quoting "the airport is at X" against a DEM
    cell is meaningless. OurAirports lists DWC at 114 ft, which is its LOWEST
    threshold, not its elevation — a 17 m error in a widely-scraped source.

  · DUBAI MUNICIPALITY DATUM IS NOT MEAN SEA LEVEL. Dubai engineering drawings
    quote levels in DMD, and MSL = +1.08 m on DMD (Dubai Municipality Survey
    Dept, FIG Working Week 2011). So a site graded to "+2.5 m DMD" is ~1.4 m
    AMSL. Any Dubai ground level without a stated datum is ambiguous by ~1.1 m,
    which is a large share of the total relief in the coastal strip. AIP figures
    are AMSL and are safe to compare against our surface directly.

    Related: the UAE AIP gives geoid undulation as -112 ft (-34.1 m) at both
    airports. A DEM delivered in ELLIPSOIDAL heights would sit ~34 m below these
    orthometric values. Ours does not, and this check would scream if it did.

    python3 scripts/check-terrain-accuracy.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import Any

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")

TOLERANCE_M = 1.5     # DeltaDTM states MAE 0.43 m; 30 m cells straddle real relief

# (label, lon, lat, low, high) — surveyed ground band, metres AMSL.
# Derived from the UAE AIP OMDB obstacle table (elevation - height) and the
# Precision Approach Terrain Charts. Bands rather than points because a 30 m
# cell covers more ground than one surveyed mast.
AIP_GROUND: list[tuple[str, float, float, float, float]] = [
    ("DXB west airfield",    55.3550, 25.2600,  1.5,  2.4),
    ("DXB west airfield b",  55.3660, 25.2540,  1.5,  2.4),
    ("DXB central",          55.3750, 25.2490,  5.2,  7.3),
    ("Deira side buildings", 55.3363, 25.2747,  2.1,  2.1),
]


def sample(doc: dict[str, Any], lon: float, lat: float) -> float | None:
    n, foot = int(doc["n"]), float(doc["footprintM"])
    lon0, lat0 = doc["centre"]
    mlat = 110540.0
    mlon = 111320.0 * math.cos(math.radians(lat0))
    x, y = (lon - lon0) * mlon, (lat - lat0) * mlat
    if max(abs(x), abs(y)) > foot / 2:
        return None
    z = np.asarray(doc["h"], dtype="float64").reshape(n, n)
    fx = (x + foot / 2) / foot * (n - 1)
    fy = (y + foot / 2) / foot * (n - 1)
    return float(z[int(round(fy)), int(round(fx))])


def main() -> int:
    path = os.path.join(DATA, "dubai-creek-terrain.json")
    if not os.path.exists(path):
        print(f"  missing {path} — run fetch-dubai-terrain.py first")
        return 1
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)

    fails: list[str] = []
    tested = 0
    print(f"  {'location':22} {'ours':>7}  {'AIP surveyed':>14}   verdict")
    for name, lon, lat, lo, hi in AIP_GROUND:
        v = sample(doc, lon, lat)
        if v is None:
            print(f"  {name:22} {'--':>7}  outside the window — skipped")
            continue
        tested += 1
        ok = lo - TOLERANCE_M <= v <= hi + TOLERANCE_M
        if not ok:
            off = v - (lo + hi) / 2
            fails.append(f"{name}: {v:.2f} m against surveyed {lo:.1f}-{hi:.1f} m ({off:+.1f} m)")
        print(f"  {name:22} {v:7.2f}  {lo:6.1f}..{hi:<5.1f}   "
              f"{'OK' if ok else 'OFF by %+.1f m' % (v - (lo + hi) / 2)}")

    if not tested:
        print("\n  no reference points fell inside the window — nothing was checked")
        return 1
    if fails:
        print(f"\n  FAIL ({len(fails)} of {tested}):")
        for f in fails:
            print(f"    - {f}")
        print("\n  A whole-field offset near -34 m means an ellipsoidal-vs-orthometric")
        print("  mix-up; near +/-1.1 m, a DMD-vs-AMSL datum mix-up. See the docstring.")
        return 1
    print(f"\n  OK: {tested}/{tested} within {TOLERANCE_M} m of surveyed ground.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
