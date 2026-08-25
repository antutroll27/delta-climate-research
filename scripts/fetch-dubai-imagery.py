"""Sentinel-2 true-colour -> a draped satellite texture for the terrain.

WHY THIS AND NOT A PALETTE. Every colour in the scene up to now was chosen by
hand and defended by argument. A 10 m true-colour composite is measured: the
sabkha, the irrigated green, the sand, the water and the built fabric all arrive
correct without anyone deciding what shade Dubai is.

SCENE PICKED BY DUST, NOT CLOUD. Cloud cover is a useless discriminator here —
all 95 candidate scenes over this tile are under 3 % — while aerosol optical
thickness varies fivefold across the year (0.096 to 0.483). Winter is clear,
autumn is dusty. The pinned scene is the measured clearest.

LICENCE: free, full and open under Regulation (EU) 377/2014 and Delegated
Regulation 1159/2013 — reproduction, distribution, adaptation and combination
all permitted, commercial use included. Attribution string is mandatory and is
emitted into the artefact. This is one of the few layers here that is NOT ODbL.

    python3 scripts/fetch-dubai-imagery.py
    python3 scripts/fetch-dubai-imagery.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import SITES, Site, site_bounds  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "flood-sim", "data")
TEX = 2048

# Measured clearest scene over MGRS 40RCN: AOT 0.096, cloud 0.03 %.
SCENE = "S2B_40RCN_20251223_0_L2A"
TCI = ("/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
       "sentinel-s2-l2a-cogs/40/R/CN/2025/12/" + SCENE + "/TCI.tif")
ATTRIBUTION = "Contains modified Copernicus Sentinel data 2025"
LICENCE = "Copernicus free, full and open (Reg. EU 377/2014; Del. Reg. 1159/2013)"


def build(site: Site) -> dict[str, Any]:
    with rasterio.open(TCI) as ds:
        bounds = transform_bounds("EPSG:4326", ds.crs, *site_bounds(site))
        rgb = ds.read(window=from_bounds(*bounds, ds.transform), out_shape=(3, TEX, TEX))
    # Rows come north-down from the raster; the terrain grid runs south-up, so
    # flip once here rather than leaving every consumer to remember.
    img = np.transpose(rgb, (1, 2, 0))[::-1]
    path = os.path.join(OUT_DIR, f"{site.id}-imagery.png")
    Image.fromarray(img.astype("uint8"), "RGB").save(path, optimize=True)
    return {
        "site": site.id, "file": os.path.basename(path), "size": TEX,
        "scene": SCENE, "source": "Copernicus Sentinel-2 L2A true-colour (TCI)",
        "resolutionM": round(site.footprint_m / TEX, 2),
        "licence": LICENCE, "attribution": ATTRIBUTION,
        "note": ("Scene chosen by aerosol optical thickness, not cloud: cloud is "
                 "under 3 % on all candidates while AOT varies fivefold. This is "
                 "the measured clearest (AOT 0.096)."),
        "mean": [round(float(img[..., c].mean()), 1) for c in range(3)],
    }


def check() -> int:
    failures: list[str] = []
    for sid, site in SITES.items():
        meta = os.path.join(OUT_DIR, f"{sid}-imagery.json")
        png = os.path.join(OUT_DIR, f"{sid}-imagery.png")
        if not (os.path.exists(meta) and os.path.exists(png)):
            failures.append(f"{sid}: imagery missing")
            continue
        with open(meta, encoding="utf-8") as fh:
            d = json.load(fh)
        with Image.open(png) as im:
            if im.size != (TEX, TEX):
                failures.append(f"{sid}: texture is {im.size}, expected {TEX}^2")
            arr = np.asarray(im)
        # A blank or single-colour tile means the window missed the scene.
        if float(arr.std()) < 12:
            failures.append(f"{sid}: texture has almost no variation (std {arr.std():.1f}) "
                            f"-- the window probably missed the tile")
        if "Copernicus" not in d.get("attribution", ""):
            failures.append(f"{sid}: Sentinel data without the mandatory attribution string")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-imagery.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        print(f"  OK {sid}: {d['size']}^2 @ {d['resolutionM']} m/px | {d['scene']} | mean RGB {d['mean']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for sid, site in SITES.items():
        doc = build(site)
        with open(os.path.join(OUT_DIR, f"{sid}-imagery.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=1)
        print(f"  {sid}: {os.path.getsize(os.path.join(OUT_DIR, doc['file'])):,} B texture")
    return check()


if __name__ == "__main__":
    sys.exit(main())
