#!/usr/bin/env python3
"""WSF3D building heights for a study area — the Dubai height source.

WHY THIS ONE. Four candidates were tested over Dubai's tower districts against
known building heights (Burj Khalifa 828 m, Princess Tower 414 m):

    WSF3D            0.78-1.20 x truth   <- TanDEM-X radar, a MEASUREMENT
    3D-GloBFP        0.17-0.41 x on towers, 2.15 x on low-rise
                     (XGBoost, regresses to the mean — wrong in both directions)
    Copernicus GLO-30  does not contain buildings at all: Downtown maxes at 34 m
                     and open desert reads HIGHER (97-124 m real dunes). Terrain.
    GlobalBuildingAtlas  best specs of any of them (3 m, RMSE 5.9 m Asia) and
                     ODbL-derived, so unusable in a commercial product.

WSF3D's residual under-estimate on towers is expected and correct: it is an ~87 m
cell average, so a tower's peak is averaged with its podium and the ground around
it. That cell size is also why it fits — it lands almost exactly on our 70 m
analysis grid and well inside the 208 m city-wide cell, so no downsampling
argument has to be made.

*** THE SCALE FACTOR IS THE TRAP. *** The GeoTIFF declares `scales: (0.1,)` with
`unit: m`: stored values are DECIMETRES. `rasterio.read()` does NOT apply band
scales. Reading raw gives 6672 m over Downtown, which looks like a broken dataset
and nearly got WSF3D discarded. `heights()` applies it and `_self_check` fails
loudly if that ever regresses.

No download needed: the global file is 2.14 GB but is a tiled GeoTIFF, so
/vsicurl range-reads only the window asked for.

    python3 scripts/fetch-wsf3d.py --bbox 54.85,24.75,55.65,25.45 --out dubai
    python3 scripts/fetch-wsf3d.py --self-check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import warnings

import numpy as np
import rasterio
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _ecostress import Bbox  # noqa: E402  (path must be set first — not a package)
from _types import F32  # noqa: E402

warnings.filterwarnings("ignore")

URL = ("/vsicurl/https://download.geoservice.dlr.de/WSF3D/files/global/"
       "WSF3D_V02_BuildingHeight.tif")
#: DLR, World Settlement Footprint 3D, CC-BY-4.0. Cite on any published figure.
ATTRIBUTION = "World Settlement Footprint 3D (WSF3D) © DLR, CC BY 4.0"
CACHE = os.path.expanduser("~/.cache/delta-climate/wsf3d")

#: Sanity band for a city block. Below this a cell holds no building; above it the
#: scale factor has almost certainly not been applied (raw decimetres).
MAX_PLAUSIBLE_M = 1000.0


def heights(bbox: Bbox, url: str = URL) -> tuple[F32, float]:
    """(height raster in METRES, cell size in metres) over `bbox`.

    Applies the band scale. Nodata and non-building cells come back as 0.0, not
    NaN: WSF3D's absence of a building is a real zero height, and propagating NaN
    would make every downstream mean skip the open ground that matters.
    """
    with rasterio.open(url) as src:
        scale = float(src.scales[0])
        a = src.read(1, window=from_bounds(*bbox, src.transform)).astype("float32")
        if src.nodata is not None:
            a = np.where(a == src.nodata, 0.0, a)
        cell_m = float(src.res[0]) * 111320.0
    out = np.maximum(a * np.float32(scale), np.float32(0.0)).astype(np.float32)
    if float(out.max()) > MAX_PLAUSIBLE_M:
        raise ValueError(
            f"WSF3D returned {out.max():.0f} m, above the {MAX_PLAUSIBLE_M:.0f} m "
            f"plausibility bound. The band scale ({scale}) is probably not being "
            f"applied — stored values are decimetres.")
    return out, cell_m


def _self_check() -> None:
    """Measured expectations over Dubai, so the scale trap cannot come back."""
    # Deira/Naif is genuinely low-rise. Raw decimetres would read ~480 here.
    a, cell = heights((55.3024, 25.2689, 55.3164, 25.2766))
    peak = float(a.max())
    assert 20.0 < peak < 80.0, \
        f"Deira/Naif peak {peak:.1f} m — expected 20-80 m; scale factor not applied?"
    assert 60.0 < cell < 120.0, f"cell size {cell:.0f} m — expected ~87 m"

    # Downtown holds the Burj Khalifa (828 m). An ~87 m cell average lands well
    # below the peak, but must still be unmistakably a tower.
    d, _ = heights((55.2645, 25.1848, 55.2891, 25.2049))
    dpeak = float(d.max())
    assert 400.0 < dpeak < 900.0, \
        f"Downtown peak {dpeak:.1f} m — expected 400-900 m for the Burj cell"
    assert dpeak > peak * 5, "Downtown must tower over Deira, and does not"
    assert float(a.min()) >= 0.0 and float(d.min()) >= 0.0, "heights cannot be negative"
    print(f"  fetch-wsf3d self-check OK (Deira {peak:.0f} m · Downtown {dpeak:.0f} m "
          f"· {cell:.0f} m cells)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bbox", default="", help="w,s,e,n in degrees")
    ap.add_argument("--out", default="", help="name under the cache dir")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check or not args.bbox:
        _self_check()
        return 0

    parts = [float(v) for v in args.bbox.split(",")]
    if len(parts) != 4:
        raise SystemExit("--bbox needs exactly w,s,e,n")
    bbox: Bbox = (parts[0], parts[1], parts[2], parts[3])

    a, cell = heights(bbox)
    built = a > 0.0
    print(f"  bbox {bbox}")
    print(f"  {a.shape[1]}x{a.shape[0]} cells @ ~{cell:.0f} m")
    print(f"  built cells {int(built.sum()):,} of {a.size:,} ({built.mean():.1%})")
    if built.any():
        v = a[built]
        print(f"  height  mean {v.mean():.1f} m · median {np.median(v):.1f} m · "
              f"p95 {np.percentile(v, 95):.1f} m · max {v.max():.1f} m")

    name = args.out or "area"
    os.makedirs(CACHE, exist_ok=True)
    np.save(os.path.join(CACHE, f"{name}-wsf3d.npy"), a)
    meta = {"_what": "WSF3D building height, METRES (band scale applied)",
            "source": URL.replace("/vsicurl/", ""), "attribution": ATTRIBUTION,
            "licence": "CC-BY-4.0", "bbox4326": list(bbox),
            "cell_m": round(cell, 1), "shape": list(a.shape),
            "max_m": round(float(a.max()), 1)}
    with open(os.path.join(CACHE, f"{name}-wsf3d.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    print(f"  -> {CACHE}/{name}-wsf3d.npy + .json")
    print(f"  {ATTRIBUTION}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
