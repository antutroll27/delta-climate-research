"""Copernicus GLO-30 -> a bare-earth heightfield the flood solver can route on.

THE PROBLEM THIS EXISTS TO SOLVE. GLO-30 is a SURFACE model (TanDEM-X): rooftops
ride in the "ground". Measured over this window the raw DSM spans 49 m from -16
to +33 in a city that is genuinely flat -- that relief is buildings. Routing
water over it would pond rain ON ROOFTOPS and send it around structures it should
run through, so every depth the tool displayed would be wrong in a way no amount
of solver correctness could fix.

WHY NOT A MORPHOLOGICAL FILTER. The obvious fix -- grey opening wide enough to
swallow a building -- was measured and rejected. The p5-p95 span bottoms out near
a 200 m window, but the MEDIAN slides 4.15 -> 1.29 m on the way and reaches 0.00
by 450 m: a minimum-biased operator eats real ground with the buildings. And the
largest footprint here is 421 m across, so no window stripping it leaves terrain
behind.

WHAT IS DONE INSTEAD. The footprints are known independently, so buildings are
MASKED rather than guessed: fetch-dubai-buildings.py's rings are rasterised at 4x
supersampling (recovered coverage 21.8 % against a vector truth of 22.0 %), cells
over half covered are removed, and ground is interpolated beneath them from the
nearest unbuilt samples. The result is clamped to the DSM, because bare earth can
never sit above the surface model -- an invariant the first draft violated on
10,971 cells.

THE CEILING, STATED PLAINLY. At ~30 m the median 19 m building is SUB-PIXEL: it
was never resolved separately, so it cannot be removed. Measured, the mask strips
a median of 0.41 m and a maximum of 23 m -- it recovers the towers and the large
complexes and leaves small-building bias in the ground. Real urban pluvial models
use 1-5 m LiDAR. This is a 30 m screening surface and the artefact says so.

    python3 scripts/fetch-dubai-terrain.py            # build
    python3 scripts/fetch-dubai-terrain.py --check    # assert over the artefact
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import SITES, Site, dem_tile_url, site_bounds  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "flood-sim", "data")

SUPERSAMPLE = 4          # 4x4 subcells -> fractional building coverage per DEM cell
COVER_MASK = 0.5         # a cell is "building" once over half of it is covered
GROUND_SMOOTH_M = 90.0   # smoothing of the interpolated under-building surface
LICENCE = "Copernicus DEM — free, full and open (ESA / Copernicus Programme)"
ATTRIBUTION = "Contains modified Copernicus DEM data (GLO-30, DLR e.V. / Airbus DS)"


def read_dsm(site: Site) -> tuple[np.ndarray[Any, Any], tuple[float, float, float, float]]:
    """Windowed read of the GLO-30 COG. Range requests keep this to a few hundred kB."""
    bounds = site_bounds(site)
    with rasterio.open(dem_tile_url(site.lat, site.lon)) as ds:
        window = window_from_bounds(*bounds, ds.transform)
        dsm = ds.read(1, window=window).astype("float64")
    return dsm, bounds


def building_coverage(site: Site, shape: tuple[int, int],
                      bounds: tuple[float, float, float, float]) -> np.ndarray[Any, Any]:
    """Fractional building coverage per DEM cell, via supersampled rasterisation.

    all_touched=True was measured and rejected: it marks any cell a polygon
    grazes, which turned 22 % real coverage into 50 % masked cells. Supersampling
    recovers the true fraction (21.8 % vs 22.0 %) instead of over-claiming.
    """
    path = os.path.join(OUT_DIR, f"{site.id}-buildings.json")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} — run fetch-dubai-buildings.py first")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    shapes = [({"type": "Polygon", "coordinates": [b["lonlat"]]}, 1) for b in doc["b"]]
    h, w = shape
    fine = rasterize(
        shapes, out_shape=(h * SUPERSAMPLE, w * SUPERSAMPLE),
        transform=transform_from_bounds(*bounds, w * SUPERSAMPLE, h * SUPERSAMPLE),
        fill=0, all_touched=False,
    ).astype("float32")
    coarse: np.ndarray[Any, Any] = fine.reshape(h, SUPERSAMPLE, w, SUPERSAMPLE).mean(axis=(1, 3))
    return coarse


def to_bare_earth(dsm: np.ndarray[Any, Any], coverage: np.ndarray[Any, Any],
                  px_m: float) -> tuple[np.ndarray[Any, Any], np.ndarray[Any, Any], float]:
    """Mask buildings, interpolate ground beneath, clamp to the surface model."""
    mask = coverage > COVER_MASK
    if not mask.any():
        return dsm.copy(), mask, 0.0
    nearest = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    filled = dsm[tuple(nearest)]
    filled = ndimage.uniform_filter(filled, size=max(1, int(round(GROUND_SMOOTH_M / px_m))))
    dtm = np.where(mask, filled, dsm)
    # Bare earth is never above the surface it was measured from.
    dtm = np.minimum(dtm, dsm)
    span = float(ndimage.distance_transform_edt(mask).max() * px_m)
    return dtm, mask, span


def resample(field: np.ndarray[Any, Any], n: int) -> np.ndarray[Any, Any]:
    """Bilinear resample onto the square analytical grid."""
    h, w = field.shape
    yy = np.linspace(0, h - 1, n)
    xx = np.linspace(0, w - 1, n)
    grid = np.meshgrid(yy, xx, indexing="ij")
    return ndimage.map_coordinates(field, grid, order=1, mode="nearest")


def pc(a: np.ndarray[Any, Any], p: float) -> float:
    """Percentile as a plain float — json.dump refuses numpy scalars."""
    return float(np.percentile(a, p))


def build(site: Site) -> dict[str, Any]:
    dsm, bounds = read_dsm(site)
    px_m = site.footprint_m / dsm.shape[1]
    coverage = building_coverage(site, dsm.shape, bounds)
    dtm, mask, interp_span = to_bare_earth(dsm, coverage, px_m)

    removed = (dsm - dtm)[mask]
    grid = resample(dtm, site.grid_n)

    return {
        "site": site.id,
        "source": "Copernicus DEM GLO-30 (AWS Open Data mirror)",
        "licence": LICENCE,
        "attribution": ATTRIBUTION,
        "surface": "bare-earth estimate",
        "n": site.grid_n,
        "cellM": round(site.footprint_m / site.grid_n, 4),
        "footprintM": site.footprint_m,
        "centre": [site.lon, site.lat],
        "nativePxM": round(px_m, 2),
        "dsm": {"p5": pc(dsm, 5), "p50": pc(dsm, 50), "p95": pc(dsm, 95),
                "min": float(dsm.min()), "max": float(dsm.max())},
        "dtm": {"p5": pc(dtm, 5), "p50": pc(dtm, 50), "p95": pc(dtm, 95),
                "min": float(dtm.min()), "max": float(dtm.max())},
        "buildingMask": {
            "coverageMean": round(float(coverage.mean()), 4),
            "maskedCellFraction": round(float(mask.mean()), 4),
            "removedP50M": round(float(np.median(removed)), 3) if removed.size else 0.0,
            "removedP95M": round(pc(removed, 95), 3) if removed.size else 0.0,
            "removedMaxM": round(float(removed.max()), 3) if removed.size else 0.0,
            "maxInterpolationSpanM": round(interp_span, 1),
        },
        "limitation": (
            "GLO-30 is a surface model. Buildings are masked using independent "
            "GlobalML footprints, but at ~30 m the median 19 m building is "
            "sub-pixel and was never resolved separately, so small-building bias "
            "remains in the ground. Screening grade; not an engineering DTM."
        ),
        "h": [round(float(v), 3) for v in grid.ravel()],
    }


def check() -> int:
    failures: list[str] = []
    for sid, site in SITES.items():
        path = os.path.join(OUT_DIR, f"{sid}-terrain.json")
        if not os.path.exists(path):
            failures.append(f"{sid}: artefact missing -- run without --check first")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        n = site.grid_n
        if len(d["h"]) != n * n:
            failures.append(f"{sid}: expected {n*n} samples, found {len(d['h'])}")
        if d["dtm"]["max"] > d["dsm"]["max"] + 1e-6:
            failures.append(f"{sid}: bare earth rises above the surface model -- clamp broken")
        dsm_span = d["dsm"]["p95"] - d["dsm"]["p5"]
        dtm_span = d["dtm"]["p95"] - d["dtm"]["p5"]
        if dtm_span > dsm_span + 1e-6:
            failures.append(f"{sid}: masking INCREASED the span {dsm_span:.2f} -> {dtm_span:.2f} m")
        if d["buildingMask"]["maskedCellFraction"] > 2 * d["buildingMask"]["coverageMean"]:
            failures.append(
                f"{sid}: masked {100*d['buildingMask']['maskedCellFraction']:.0f}% of cells for "
                f"{100*d['buildingMask']['coverageMean']:.0f}% coverage -- rasterisation is over-claiming")
        finite = [v for v in d["h"] if v == v]
        if len(finite) != len(d["h"]):
            failures.append(f"{sid}: {len(d['h'])-len(finite)} non-finite samples in the heightfield")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-terrain.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        m = d["buildingMask"]
        print(f"  OK {sid}: {d['n']}^2 @ {d['cellM']} m | "
              f"DSM span {d['dsm']['p95']-d['dsm']['p5']:.2f} m -> DTM {d['dtm']['p95']-d['dtm']['p5']:.2f} m | "
              f"removed p50 {m['removedP50M']} m / max {m['removedMaxM']} m")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for sid, site in SITES.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-terrain.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
