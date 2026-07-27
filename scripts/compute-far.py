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

Output: data/dc-urs/far.json
"""
import json, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "public", "heat-map", "data")
OUT = os.path.join(ROOT, "data", "dc-urs", "far.json")

STOREY_M = 3.2          # assumption; see module docstring
MIN_FLOORS = 1


def polygon_area(xs, ys) -> float:
    """Shoelace. Returns absolute area, so vertex winding does not matter."""
    n = len(xs)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(s) / 2.0


def ward_far(path: str) -> dict:
    with open(path) as fh:
        d = json.load(fh)
    side = float(d["sizeM"])
    land_m2 = side * side

    footprint_m2 = 0.0
    floor_m2 = 0.0
    heights, floors_seen = [], []
    degenerate = 0

    for b in d["b"]:
        h = float(b[0])
        coords = b[1:]
        xs = coords[0::2]
        ys = coords[1::2]
        a = polygon_area(xs, ys)
        if a <= 0:
            degenerate += 1
            continue
        floors = max(MIN_FLOORS, round(h / STOREY_M))
        footprint_m2 += a
        floor_m2 += a * floors
        heights.append(h)
        floors_seen.append(floors)

    return {
        "far": round(floor_m2 / land_m2, 4),
        "built_fraction": round(footprint_m2 / land_m2, 4),
        "buildings": len(heights),
        "degenerate_polygons": degenerate,
        "land_m2": land_m2,
        "footprint_m2": round(footprint_m2),
        "floor_m2": round(floor_m2),
        "height_m": {
            "min": round(min(heights), 1), "median": round(statistics.median(heights), 1),
            "max": round(max(heights), 1),
        },
        "floors": {
            "median": statistics.median(floors_seen), "max": max(floors_seen),
        },
    }


def main():
    wards = sorted(
        f[:-5] for f in os.listdir(GEOM)
        if f.endswith(".json") and not f.endswith("-roads.json")
    )
    if not wards:
        raise SystemExit(f"no ward geometry in {GEOM}")

    out = {
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
