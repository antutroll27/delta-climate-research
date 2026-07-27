#!/usr/bin/env python3
"""
Floor-Area Ratio per ward, for the DC-URS exposure pillar.

    python3 scripts/compute-far.py

FAR = total built floor area / land area. It is DC-URS's proxy for built
density, carrying 0.30 of the exposure pillar (dc-urs-source-of-truth.md §3).

FULLY OFFLINE. Uses the baked ward geometry already in the repo — Microsoft ML
footprints with Google Open Buildings 2.5D heights, the same file the 3D scene
renders from. No network, no credentials.

    public/heat-map/data/{ward}.json
      sizeM : ward footprint side, metres
      b     : [[height_m, x1, y1, x2, y2, …], …]  polygon vertices in metres,
              relative to the ward centre

STOREY HEIGHT. Floors are estimated as height / 3.2 m, floored at 1. The National
Building Code of India sets a 2.75 m minimum clear floor-to-ceiling height for
residential rooms; adding a slab and services puts a typical floor-to-floor at
roughly 3.0–3.3 m. 3.2 is the midpoint and is recorded as an ASSUMPTION, not a
measurement — it is the single largest source of uncertainty in this figure.

2.5 m IS A FILL VALUE, NOT A MEASUREMENT. Google Open Buildings writes 2.5 m
where it has no confident height. It is simultaneously the MINIMUM and the MODAL
height in all three wards — 4.0 % of Ballygunge's buildings, 6.5 % of
Barrackpore's, 10.8 % of Baruipur's — which is the signature of a default, not of
a real stock of uniformly 2.5 m buildings. Reporting min/median/max over it under
provenance "measured" would describe the fill, so those buildings are counted
separately and excluded from the height statistics.

Output: data/dc-urs/far.json
"""
import json, os, statistics, sys
from typing import Sequence, TypedDict, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _types import FarFile, FarWard, WardId

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "public", "heat-map", "data")
OUT = os.path.join(ROOT, "data", "dc-urs", "far.json")

STOREY_M = 3.2          # assumption; see module docstring
MIN_FLOORS = 1

# Google Open Buildings' "no confident height" default; see module docstring.
# Matched exactly rather than with <=, because it is also the dataset minimum
# (verified: no building in any of the three wards sits below it), so a
# threshold test would only ever misclassify a genuine sub-2.5 m building.
FILL_HEIGHT_M = 2.5


class WardGeometry(TypedDict):
    """public/heat-map/data/{ward}.json — the baked 3D scene geometry."""
    sizeM: float
    b: list[list[float]]


def polygon_area(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Shoelace. Returns absolute area, so vertex winding does not matter."""
    n = len(xs)
    # xs and ys are the even and odd slices of one flat coordinate list, so an
    # even-length list leaves xs one longer than ys and ys[j] would IndexError
    # on the last vertex. Verified: zero such entries in the current data, which
    # is exactly why it must be a check and not an assumption.
    if n < 3 or n != len(ys):
        return 0.0
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(s) / 2.0


def ward_far(path: str) -> FarWard:
    with open(path) as fh:
        d = cast(WardGeometry, json.load(fh))
    side = float(d["sizeM"])
    land_m2 = side * side

    footprint_m2 = 0.0
    floor_m2 = 0.0
    heights: list[float] = []       # MEASURED heights only — fill excluded
    floors_seen: list[int] = []
    degenerate = 0
    at_fill = 0
    nonpositive = 0

    for b in d["b"]:
        h = float(b[0])
        coords = b[1:]
        xs = coords[0::2]
        ys = coords[1::2]
        a = polygon_area(xs, ys)
        if a <= 0:
            degenerate += 1
            continue
        # max(MIN_FLOORS, ...) would turn a zero or negative height into a
        # 1-storey building contributing its full footprint to the floor area —
        # a fabricated storey from a missing measurement. Skip it instead.
        if h <= 0:
            nonpositive += 1
            continue
        floors = max(MIN_FLOORS, round(h / STOREY_M))
        footprint_m2 += a
        floor_m2 += a * floors
        floors_seen.append(floors)
        # FAR is unaffected by the fill: round(2.5 / 3.2) == 1 == MIN_FLOORS, so
        # a fill-height building contributes exactly the single storey it would
        # have contributed anyway. Only the height statistics are corrupted by
        # it, so only they exclude it.
        if h == FILL_HEIGHT_M:
            at_fill += 1
        else:
            heights.append(h)

    if not heights:
        raise SystemExit(f"{path}: every building carries the {FILL_HEIGHT_M} m fill "
                         f"height — there is no measured height distribution to report")

    return {
        "far": round(floor_m2 / land_m2, 4),
        "built_fraction": round(footprint_m2 / land_m2, 4),
        "buildings": len(floors_seen),
        "degenerate_polygons": degenerate,
        "land_m2": land_m2,
        "footprint_m2": round(footprint_m2),
        "floor_m2": round(floor_m2),
        # min/median/max describe the MEASURED buildings only. n_at_fill_value
        # and n_nonpositive are carried here, beside the statistics they were
        # removed from, so the exclusion is visible to anyone reading the block.
        "height_m": {
            "min": round(min(heights), 1), "median": round(statistics.median(heights), 1),
            "max": round(max(heights), 1),
            "n_measured": len(heights),
            "fill_value": FILL_HEIGHT_M,
            "n_at_fill_value": at_fill,
            "n_nonpositive": nonpositive,
        },
        "floors": {
            "median": statistics.median(floors_seen), "max": max(floors_seen),
        },
    }


def main() -> None:
    wards: list[WardId] = sorted(
        f[:-5] for f in os.listdir(GEOM)
        if f.endswith(".json") and not f.endswith("-roads.json")
    )
    if not wards:
        raise SystemExit(f"no ward geometry in {GEOM}")

    out: FarFile = {
        "source": "Microsoft ML Building Footprints (ODbL) + Google Open Buildings 2.5D heights (CC BY 4.0)",
        "method": "FAR = Σ(footprint area × floors) / land area; shoelace polygon area",
        "assumption": f"floors = round(height / {STOREY_M} m), min {MIN_FLOORS}. "
                      "3.2 m floor-to-floor is the midpoint of the 3.0–3.3 m typical range implied "
                      "by the National Building Code of India's 2.75 m minimum clear height plus "
                      "slab and services. This is the largest single uncertainty in FAR.",
        "provenance": "measured",
        "wards": {},
    }
    for w in wards:
        out["wards"][w] = ward_far(os.path.join(GEOM, f"{w}.json"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"  {'ward':<14}{'FAR':>7}{'built':>8}{'bldgs':>8}{'med h':>8}{'med flr':>9}")
    for w, v in out["wards"].items():
        print(f"  {w:<14}{v['far']:>7.2f}{v['built_fraction']:>8.2f}"
              f"{v['buildings']:>8}{v['height_m']['median']:>8.1f}{v['floors']['median']:>9.0f}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
