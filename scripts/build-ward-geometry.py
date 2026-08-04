"""Footprints + chosen heights -> staged ward JSON. NOTHING here touches public/.

Schema-identical to the shipped files, so every consumer -- the 3D scene, the pick
registry, rasterizeWardBuilt, compute-far.py, Compare -- works unchanged. Shipping
is a separate, reviewed copy after the delta table (scripts/measure-geometry-deltas).

    python3 scripts/build-ward-geometry.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "data", "geometry")
STAGING = os.path.join(GEOM, "staging")
PUBLIC = os.path.join(ROOT, "public", "heat-map", "data")

WARDS = ("ballygunge", "barrackpore", "baruipur")

#: Google Open Buildings' published minimum AND its no-confident-height value.
#: compute-far.py matches it exactly for the same reason.
FLOOR_M = 2.5


def main() -> int:
    with open(os.path.join(GEOM, "height-method.json"), encoding="utf-8") as fh:
        verdict = json.load(fh)
    method = verdict["method"]
    with open(os.path.join(GEOM, "heights-overture.json"), encoding="utf-8") as fh:
        heights = json.load(fh)
    os.makedirs(STAGING, exist_ok=True)

    for ward in WARDS:
        with open(os.path.join(PUBLIC, f"{ward}.json"), encoding="utf-8") as fh:
            shipped = json.load(fh)
        with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
            foot = json.load(fh)
        by_id = {r["id"]: r for r in heights["wards"][ward]}
        rows, fills = [], 0
        for r in foot["b"]:
            h = by_id[r["gers"]]
            value = h[method]
            # 2.5 m IS THE FLOOR, not just the no-confidence marker. Google
            # publishes it as the dataset minimum, so a zonal statistic landing
            # BELOW it means the raster found no building under that footprint --
            # ~12 % of Overture rings, with plenty of pixels but near-zero values.
            # Those are OSM features Google's ML did not detect, not 0.1 m
            # buildings. Clamping to the floor and flagging them as fill is the
            # same treatment the no-confidence case gets, and it brings the fill
            # rate back in line with the shipped 4.0/6.5/10.8 %.
            is_fill = h["fill"] or value < FLOOR_M
            if is_fill:
                value = FLOOR_M
            fills += is_fill
            rows.append([value] + r["p"])
        doc = {
            "name": shipped["name"], "type": shipped["type"],
            "center": shipped["center"], "sizeM": shipped["sizeM"],
            "count": len(rows),
            "source": (f"Overture Maps Foundation {foot['release']} (ODbL; OSM + Google + "
                       f"Microsoft, GERS-deduplicated) | heights: Google Open Buildings "
                       f"2.5D Temporal (2023) via Earth Engine"),
            "heightsNote": (
                f"Heights: zonal {method} of Open Buildings 2.5D Temporal (2023 epoch, "
                f"~4 m) per Overture footprint. Method chosen against OSM building:levels "
                f"-- verdict UNDERPOWERED at {verdict['pairs']} matched pairs, so {method} "
                f"ships as the statistic measured to sit where the previous values sat; "
                f"the set is not independently validated. 2.5 m is Google's "
                f"no-confident-height fill AND the raster floor; {fills} buildings "
                f"sit on it, either unmeasured or reading below Google's "
                f"published minimum. CC BY 4.0 / ODbL."),
            "b": rows,
        }
        path = os.path.join(STAGING, f"{ward}.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        old_size = os.path.getsize(os.path.join(PUBLIC, f"{ward}.json"))
        print(f"  {ward:<12} {shipped['count']:>5} -> {len(rows):>5} buildings · "
              f"{fills:>3} fill · {old_size//1024:>4} -> {os.path.getsize(path)//1024:>4} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
