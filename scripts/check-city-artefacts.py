"""Every artefact OBOS fetches for a city after Bengaluru is present and coherent (Task A10).

    python3 scripts/check-city-artefacts.py --city amsterdam

THE SURFACE RASTER IS THE POINT, as in `check-bangalore-artefacts.py`: `loadSurfaceRaster`
returns null when it is missing and the area silently collapses to ONE uniform vegetation
value, the heat field driven by buildings alone, with no error anywhere. This gate refuses
that. It also refuses an empty layer (a context scan that returned nothing draws a city with no
water and no roads) and a terrain mesh of the wrong size.

IT DOES NOT CATCH A MIRROR. A mirror about a centred origin is invisible to every symmetric
statistic here. `check-city-frame.py` owns mirrors; this script owns presence, counts and shape.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city                                             # noqa: E402

REQUIRED = ("{a}.json", "{a}-roads.json", "{a}-water.json", "{a}-trees.json", "{a}-terrain.json", "{a}-surface.png")


def load(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def check_area(area: _city.Area) -> list[str]:
    fails: list[str] = []
    out = _city.PUBLIC
    for pattern in REQUIRED:
        path = os.path.join(out, pattern.format(a=area.id))
        if not os.path.isfile(path):
            fails.append(f"{area.id}: missing {os.path.basename(path)}")
        elif os.path.getsize(path) == 0:
            fails.append(f"{area.id}: {os.path.basename(path)} is empty")
    if fails:
        return fails

    b = load(os.path.join(out, f"{area.id}.json"))
    if abs(float(b["sizeM"]) - area.size_m) > 1e-6:
        fails.append(f"{area.id}: sizeM {b['sizeM']} != registry {area.size_m}")
    if b["count"] != len(b["b"]) or b["count"] == 0:
        fails.append(f"{area.id}: count {b['count']} vs {len(b['b'])} rows")
    for row in b["b"]:
        if len(row) < 7 or len(row) % 2 == 0 or row[0] < 0:
            fails.append(f"{area.id}: malformed building row {row[:5]}")
            break
    for name, key in (("roads", "ways"), ("water", "polys"), ("trees", "trees")):
        doc = load(os.path.join(out, f"{area.id}-{name}.json"))
        if not doc[key]:
            fails.append(f"{area.id}: {name} has no {key}")
    if load(os.path.join(out, f"{area.id}-roads.json"))["count"] != len(load(os.path.join(out, f"{area.id}-roads.json"))["ways"]):
        fails.append(f"{area.id}: roads count disagrees with its rows")

    t = load(os.path.join(out, f"{area.id}-terrain.json"))
    if len(t["h"]) != t["n"] ** 2 or t["exaggeration"] != 1.0 or t["confidence"] != "indicative":
        fails.append(f"{area.id}: terrain is not n*n, x1, indicative")
    if not any(abs(v) > 0.01 for v in t["h"]):
        fails.append(f"{area.id}: terrain is flat")

    a = np.asarray(Image.open(os.path.join(out, f"{area.id}-surface.png"))).astype(float)
    veg = a[:, :, 0] / 255.0
    if veg.shape[0] != area.size_m // 10:
        fails.append(f"{area.id}: surface grid {veg.shape} is not {area.size_m // 10} (10 m cells)")
    if float(veg.std()) < 0.01:
        fails.append(f"{area.id}: surface raster has no spatial variance (std {veg.std():.4f})")
    meta = load(os.path.join(out, "surface-meta.json"))["wards"].get(area.id)
    if meta is None or meta.get("level") != "measured":
        fails.append(f"{area.id}: surface-meta.json has no measured-level row")
    print(f"  {area.id:<12} {b['count']:6,} buildings · veg mean {veg.mean():.3f} std {veg.std():.3f} · "
          f"grid {veg.shape[0]}x{veg.shape[1]} · terrain n={t['n']}")
    return fails


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", required=True, choices=["amsterdam"])
    args = ap.parse_args(argv)
    fails: list[str] = []
    for a in (a for a in _city.AREAS.values() if a.city == args.city):
        fails += check_area(a)
    if fails:
        print("\n".join(f"  FAIL {f}" for f in fails))
        return 1
    print(f"\n  every {args.city} artefact present, sized and spatially varying")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
