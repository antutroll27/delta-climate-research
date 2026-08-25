"""Bare-earth terrain + building-coverage raster for the flood solver.

TERRAIN IS DeltaDTM, NOT GLO-30, AND THE REASON MATTERS. GLO-30 is a SURFACE
model: rooftops ride in the ground, and over this window it reports 11.52 m of
p5-p95 relief in a city whose real bare-earth relief is 2.83 m. Routing water on
it ponds rain ON rooftops. An earlier revision of this script masked buildings
out using independent footprints, which was the right thing to do and recovered
only part of the error -- at 30 m the median 19 m building is sub-pixel and was
never resolved separately, so it cannot be removed.

DeltaDTM v1.1 (Pronk et al. 2024, doi:10.1038/s41597-024-03091-9) is a genuine
bare-earth DTM, MAE 0.43 m, and CC BY 4.0 -- commercially clean, unlike FABDEM
and FathomDEM which are both CC BY-NC-SA.

WHAT SWITCHING TO IT DOES AND DOES NOT BUY. It fixes the ELEVATIONS, which
matters for absolute water level, coastal interaction and rendering. It does NOT
fix depression-based routing: measured, the depression field is slightly LESS
stable on DeltaDTM than on the masked GLO-30, because relief drops to 2.83 m
while the vertical error does not. Guth et al. 2024 (doi:10.3390/rs16173273)
predicted exactly this -- bare-earth DTMs "improve on elevation values, but they
do not improve overall on the source Copernicus DSM" for DERIVED grids. See
BUILD-SPEC §3a. The solver changed instead.

IT ALSO EMITS THE BUILDING-COVERAGE RATIO (BCR) per cell, because two corrections
the solver needs both key off it and neither belongs in the browser:
  · storage porosity phi = 1 - BCR -- water cannot occupy the building plan area
  · roof runoff -- roofs do not infiltrate, so runoff generation is BCR-weighted

DeltaDTM is clipped to land below ~10 m MSL, leaving ~17 % of this window empty.
Those cells are filled from the GLO-30 bare-earth estimate, datum-matched by a
median offset over the overlap so the two agree at the seam. The offset and the
filled fraction are both recorded rather than smoothed over.

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
import requests
from rasterio.features import rasterize
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import (DELTADTM_ARCHIVE, DELTADTM_ARTICLE, DELTADTM_ATTRIBUTION,  # noqa: E402
                    DELTADTM_LICENCE, SITES, Site, deltadtm_tile, dem_tile_url,
                    site_bounds)
from _remotezip import extract as zip_extract  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "flood-sim", "data")

SUPERSAMPLE = 4          # 4x4 subcells -> fractional building coverage per DEM cell
COVER_MASK = 0.5         # a cell is "building" once over half of it is covered
GROUND_SMOOTH_M = 90.0   # smoothing of the interpolated under-building surface
CACHE_DIR = os.path.join(ROOT, "data", ".cache", "deltadtm")
NODATA = -9999.0
LICENCE = "Copernicus DEM — free, full and open (ESA / Copernicus Programme)"
ATTRIBUTION = "Contains modified Copernicus DEM data (GLO-30, DLR e.V. / Airbus DS)"


def read_dsm(site: Site) -> tuple[np.ndarray[Any, Any], tuple[float, float, float, float]]:
    """Windowed read of the GLO-30 COG. Range requests keep this to a few hundred kB."""
    bounds = site_bounds(site)
    with rasterio.open(dem_tile_url(site.lat, site.lon)) as ds:
        window = window_from_bounds(*bounds, ds.transform)
        dsm = ds.read(1, window=window).astype("float64")
    return dsm, bounds


def read_deltadtm(site: Site) -> np.ndarray[Any, Any] | None:
    """Windowed read of the DeltaDTM bare-earth tile, cached on disk."""
    member = deltadtm_tile(site.lat, site.lon)
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{member}.tif")
    if not os.path.exists(path):
        files = requests.get(DELTADTM_ARTICLE, timeout=120).json()
        rows = files if isinstance(files, list) else files.get("files", [])
        url = next((f.get("download_url") or f.get("downloadUrl")
                    for f in rows if f.get("name") == DELTADTM_ARCHIVE), None)
        if url is None:
            return None
        with open(path, "wb") as fh:
            fh.write(zip_extract(url, member))
    with rasterio.open(path) as ds:
        return ds.read(1, window=window_from_bounds(*site_bounds(site), ds.transform)).astype("float64")


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
    # RASTERISE IN SITE-LOCAL METRES, not lon/lat. `p` is the flat local-metre
    # ring every footprint carries; `lonlat` is now kept only on the check
    # sample, so reading it here broke the moment that trim landed. Local metres
    # is also the better frame: the grid is defined in it, so this drops a
    # projection round-trip rather than merely working around the trim.
    half = site.footprint_m / 2.0
    shapes = []
    for b in doc["b"]:
        q = b["p"]
        ring = [(q[i], q[i + 1]) for i in range(0, len(q), 2)]
        if len(ring) >= 3:
            shapes.append(({"type": "Polygon", "coordinates": [ring]}, 1))
    h, w = shape
    fine = rasterize(
        shapes, out_shape=(h * SUPERSAMPLE, w * SUPERSAMPLE),
        transform=transform_from_bounds(-half, -half, half, half,
                                        w * SUPERSAMPLE, h * SUPERSAMPLE),
        fill=0, all_touched=False,
    ).astype("float32")
    # from_bounds puts row 0 at the NORTH edge; the height grid runs south-up,
    # so flip to match `h[]` rather than leaving a silent half-city offset.
    fine = fine[::-1]
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
    glo_dtm, mask, interp_span = to_bare_earth(dsm, coverage, px_m)

    delta = read_deltadtm(site)
    if delta is None or delta.shape != dsm.shape:
        raise SystemExit("DeltaDTM tile unavailable or misaligned — refusing to ship GLO-30 as bare earth")
    void = (delta <= NODATA + 1) | ~np.isfinite(delta)

    # Datum-match the GLO-30 fallback to DeltaDTM over the cells they share, so
    # the filled region does not step at the seam. Median, not mean: the overlap
    # contains residual building signal that would drag a mean.
    both = ~void
    offset = float(np.median(delta[both] - glo_dtm[both])) if both.any() else 0.0
    terrain = np.where(void, glo_dtm + offset, delta)

    removed = (dsm - glo_dtm)[mask]
    grid = resample(terrain, site.grid_n)
    bcr = resample(coverage.astype("float64"), site.grid_n).clip(0.0, 1.0)

    return {
        "site": site.id,
        "source": "DeltaDTM v1.1 (bare earth) with Copernicus GLO-30 fill above the 10 m MSL clip",
        "licence": f"{DELTADTM_LICENCE}; {LICENCE}",
        "attribution": f"{DELTADTM_ATTRIBUTION}. {ATTRIBUTION}",
        "surface": "bare earth (measured DTM, not a filtered surface model)",
        "n": site.grid_n,
        "cellM": round(site.footprint_m / site.grid_n, 4),
        "footprintM": site.footprint_m,
        "centre": [site.lon, site.lat],
        "nativePxM": round(px_m, 2),
        "dsm": {"p5": pc(dsm, 5), "p50": pc(dsm, 50), "p95": pc(dsm, 95),
                "min": float(dsm.min()), "max": float(dsm.max())},
        "dtm": {"p5": pc(terrain, 5), "p50": pc(terrain, 50), "p95": pc(terrain, 95),
                "min": float(terrain.min()), "max": float(terrain.max())},
        "deltadtm": {
            "voidFraction": round(float(void.mean()), 4),
            "gloFillOffsetM": round(offset, 3),
            "reliefP5P95M": round(pc(delta[both], 95) - pc(delta[both], 5), 3) if both.any() else 0.0,
        },
        "buildingMask": {
            "coverageMean": round(float(coverage.mean()), 4),
            "maskedCellFraction": round(float(mask.mean()), 4),
            "removedP50M": round(float(np.median(removed)), 3) if removed.size else 0.0,
            "removedP95M": round(pc(removed, 95), 3) if removed.size else 0.0,
            "removedMaxM": round(float(removed.max()), 3) if removed.size else 0.0,
            "maxInterpolationSpanM": round(interp_span, 1),
        },
        "limitation": (
            "Bare earth is measured (DeltaDTM, MAE 0.43 m) rather than filtered, but "
            "the cell is 30 m against a 19 m median building, so street-level flow "
            "paths are below the resolvable scale (Fewtrell et al. 2008). District-"
            "scale hotspots only; not an engineering DTM."
        ),
        "h": [round(float(v), 3) for v in grid.ravel()],
        "bcr": [round(float(v), 4) for v in bcr.ravel()],
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
        if len(d.get("bcr", [])) != n * n:
            failures.append(f"{sid}: bcr raster missing or wrong length")
        if any(v < 0.0 or v > 1.0 for v in d["bcr"]):
            failures.append(f"{sid}: bcr outside [0,1] -- it is a fraction, not a count")
        # Measured bare-earth relief must stay far below the surface model's.
        # If these converge, the DeltaDTM read silently fell back to GLO-30.
        dsm_span = d["dsm"]["p95"] - d["dsm"]["p5"]
        dtm_span = d["dtm"]["p95"] - d["dtm"]["p5"]
        if dtm_span > 0.6 * dsm_span:
            failures.append(f"{sid}: bare-earth span {dtm_span:.2f} m is too close to the DSM's "
                            f"{dsm_span:.2f} m -- is this really DeltaDTM?")
        if d["deltadtm"]["voidFraction"] > 0.5:
            failures.append(f"{sid}: DeltaDTM covers under half the window "
                            f"({100*(1-d['deltadtm']['voidFraction']):.0f}%) -- fill dominates")
        if abs(d["deltadtm"]["gloFillOffsetM"]) > 10.0:
            failures.append(f"{sid}: GLO-30 fill offset {d['deltadtm']['gloFillOffsetM']} m "
                            f"-- the two surfaces disagree about the datum")
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
        dd = d["deltadtm"]
        print(f"  OK {sid}: {d['n']}^2 @ {d['cellM']} m | DSM span {d['dsm']['p95']-d['dsm']['p5']:.2f} m "
              f"-> bare earth {d['dtm']['p95']-d['dtm']['p5']:.2f} m | "
              f"DeltaDTM covers {100*(1-dd['voidFraction']):.0f}%, fill offset {dd['gloFillOffsetM']} m | "
              f"mean BCR {m['coverageMean']}")
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
