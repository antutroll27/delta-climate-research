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
from rasterio.enums import Resampling
import requests
from rasterio.features import rasterize
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import (DELTADTM_ARCHIVE, DELTADTM_ARTICLE, DELTADTM_ATTRIBUTION,  # noqa: E402
                    DELTADTM_LICENCE, GEDTM30_ATTRIBUTION, GEDTM30_COG, m_per_deg,
                    GEDTM30_LICENCE, SITES, Site, deltadtm_tile, dem_tile_url,
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

# DELTADTM SATURATES; IT DOES NOT GO VOID. Verified against the source tile
# (DeltaDTM_v1_0_N25E055.tif): max value is exactly 10.0, nothing exceeds it,
# and 36.82 % of the tile IS exactly 10.0. The product covers coastal land
# below 10 m MSL and CLAMPS everything higher to the ceiling rather than
# marking it nodata.
#
# Testing only for -9999 therefore let a dead-flat mesa through as "measured
# bare earth": 36.34 % of this window's land sat at exactly 10.000 m. That is
# not a cosmetic problem — a plateau has zero gradient, so runoff on a third of
# the city could only move by numerical noise, and the GLO-30 fill the
# docstring promises never fired because those cells never looked empty.
#
# A genuine reading of exactly 10.000 m is indistinguishable from a clamped one,
# so both are refilled. At 30 m over this window that costs nothing real.
DELTADTM_CEILING_M = 10.0
LICENCE = "Copernicus DEM — free, full and open (ESA / Copernicus Programme)"
ATTRIBUTION = "Contains modified Copernicus DEM data (GLO-30, DLR e.V. / Airbus DS)"


def working_shape(site: Site) -> tuple[int, int]:
    """The one grid every raster source is resampled onto, at ~30 m.

    EVERY READER USED TO PICK ITS OWN. read_dsm took a GLO-30 tile by site
    CENTRE and read a window from it; read_deltadtm did the same for DeltaDTM.
    Both silently clip a window that crosses a 1-degree line, returning a
    smaller array rather than an error — and the shapes then have to match by
    luck. They matched for dubai-creek because that window sits inside one tile
    of each. Dubai South crosses two lines and needs FOUR tiles of each, and the
    mismatch surfaced as "DeltaDTM tile unavailable or misaligned", which is not
    what was wrong.
    """
    w, s, e, n = site_bounds(site)
    mx, my = m_per_deg(site.lat)
    return (int(round((n - s) * my / 30.0)), int(round((e - w) * mx / 30.0)))


def read_mosaic(urls: list[str], site: Site, shape: tuple[int, int],
                nodata: float) -> np.ndarray[Any, Any] | None:
    """Read every tile the window touches onto one grid, filling gaps.

    boundless=True so a tile that covers only part of the window contributes its
    part instead of failing; out_shape forces the common grid so no caller has to
    reconcile shapes afterwards.
    """
    out = np.full(shape, nodata, dtype="float64")
    got = False
    for url in urls:
        try:
            with rasterio.open(url) as ds:
                win = window_from_bounds(*site_bounds(site), ds.transform)
                part = ds.read(1, window=win, out_shape=shape, boundless=True,
                               fill_value=nodata,
                               resampling=Resampling.bilinear).astype("float64")
        except Exception as exc:                 # noqa: BLE001 — absent tile is not fatal
            print(f"    tile unavailable ({str(exc)[:60]}) — skipped")
            continue
        take = (out <= nodata + 1) & (part > nodata + 1)
        out[take] = part[take]
        got = True
    return out if got else None


def read_dsm(site: Site) -> tuple[np.ndarray[Any, Any], tuple[float, float, float, float]]:
    """GLO-30, mosaicked across every tile the window touches."""
    bounds = site_bounds(site)
    w, s, e, n = bounds
    urls = sorted({dem_tile_url(la, lo) for la in (s, n) for lo in (w, e)})
    shape = working_shape(site)
    dsm = read_mosaic(urls, site, shape, NODATA)
    if dsm is None:
        raise SystemExit("no Copernicus GLO-30 tile could be read for this window")
    print(f"    GLO-30: {len(urls)} tile(s) -> {shape[0]}x{shape[1]}, "
          f"{float((dsm > NODATA + 1).mean())*100:.1f} % with data")
    return dsm, bounds


def _deltadtm_path(member: str) -> str | None:
    """Local path for one DeltaDTM tile, downloading it if absent."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{member}.tif")
    if os.path.exists(path):
        return path
    files = requests.get(DELTADTM_ARTICLE, timeout=120).json()
    rows = files if isinstance(files, list) else files.get("files", [])
    url = next((f.get("download_url") or f.get("downloadUrl")
                for f in rows if f.get("name") == DELTADTM_ARCHIVE), None)
    if url is None:
        return None
    try:
        blob = zip_extract(url, member)
    except Exception:                      # noqa: BLE001 — a missing tile is not fatal
        return None
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


def read_deltadtm(site: Site) -> np.ndarray[Any, Any] | None:
    """Windowed read of DeltaDTM, MOSAICKED across every tile the window touches.

    DeltaDTM ships 1-degree tiles named by their SW corner. Resolving one tile
    from the site CENTRE silently clips any window that crosses a degree line —
    and Dubai South does, on two edges at once: its window spans lon
    54.98-55.26 and lat 24.80-25.06, so it needs N24E054, N24E055, N25E054 and
    N25E055. A single-tile read would have returned data rather than an error,
    which is the failure mode this repo keeps meeting.

    Tiles that do not exist (ocean-only squares are simply absent from the
    archive) are skipped rather than fatal; their area stays nodata and the
    GEDTM30 fill covers it.
    """
    w, s, e, n = site_bounds(site)
    members = sorted({deltadtm_tile(la, lo) for la in (s, n) for lo in (w, e)})
    paths = [p for p in (_deltadtm_path(m) for m in members) if p is not None]
    if not paths:
        return None
    target = read_mosaic(paths, site, working_shape(site), NODATA)
    if target is not None:
        print(f"    DeltaDTM: {len(paths)}/{len(members)} tile(s), "
              f"{float((target > NODATA + 1).mean())*100:.1f} % of the window has data")
    return target


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
    # BOTH FOOTPRINT SETS, NOT JUST GLOBALML. This mask does two jobs — it decides
    # which DSM cells are building rather than ground, and it becomes BCR, which
    # the solver uses for storage porosity and roof runoff. Using GlobalML alone
    # left 165,763 OSM outlines unmasked, and BUILD-SPEC records OSM as the better
    # UAE coverage of the two (GlobalML misses Al Ain entirely). Unmasked buildings
    # do not vanish: their height stays in the GLO-30 fill and is served as ground.
    #
    # Overlap is harmless here — rasterize() burns 1 for any covered subcell, so a
    # building present in both sources is counted once, not twice.
    shapes = []
    for key in ("b", "osmB"):
        for b in doc.get(key, []):
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
    # STAYS NORTH-UP. This used to flip here to "match h[]", but h[] was itself
    # north-up, so the flip created the mismatch it claimed to fix — and worse,
    # to_bare_earth() then masked a north-up DSM with a south-up coverage grid,
    # removing "buildings" from mirrored locations. Everything inside this module
    # is north-up (rasterio's own order); the flip to the south-west origin that
    # types.ts specifies happens once, at the artefact boundary in build().
    coarse: np.ndarray[Any, Any] = fine.reshape(h, SUPERSAMPLE, w, SUPERSAMPLE).mean(axis=(1, 3))
    return coarse


def read_gedtm30(site: Site, shape: tuple[int, int]) -> np.ndarray[Any, Any] | None:
    """Windowed read of GEDTM30 v1.2 — a true bare-earth DTM, CC BY 4.0.

    This replaces GLO-30 as the fill above DeltaDTM's 10 m ceiling. GLO-30 is a
    SURFACE model, so it served buildings and vegetation as ground across the
    37 % of this window's land that DeltaDTM cannot see. Scored on our own window
    against DeltaDTM's 391,923 measured cells, GEDTM30 wins on every metric
    (MAE 1.49 m vs 1.78 m, bias +1.12 m vs +1.61 m).

    One 403 GiB global COG with range requests, so a window costs ~8 s. Returns
    None rather than raising: the caller falls back to the masked GLO-30 path,
    which is worse but not wrong, and a network blip should not fail the build.
    """
    try:
        with rasterio.open(f"/vsicurl/{GEDTM30_COG}") as ds:
            window = window_from_bounds(*site_bounds(site), ds.transform)
            arr = ds.read(1, window=window, out_shape=shape,
                          resampling=rasterio.enums.Resampling.bilinear).astype("float64")
            nodata = ds.nodata
            scale = float(ds.scales[0]) if ds.scales else 1.0
    except Exception as exc:                       # noqa: BLE001 — any read failure falls back
        print(f"    GEDTM30 unavailable ({exc}); falling back to masked GLO-30")
        return None
    if nodata is not None:
        arr[arr == nodata] = np.nan
    arr *= scale
    return arr


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
    if delta is None:
        raise SystemExit("no DeltaDTM tile could be read — refusing to ship a DSM as bare earth")
    assert delta.shape == dsm.shape, (
        f"grid mismatch {delta.shape} vs {dsm.shape} — working_shape() is not "
        f"being honoured by one of the readers")
    water = (delta <= NODATA + 1) | ~np.isfinite(delta)
    ceiling = ~water & (delta >= DELTADTM_CEILING_M)
    land = ~water
    measured = land & ~ceiling
    void = water | ceiling

    # Datum-match the GLO-30 fallback to DeltaDTM over the cells they share, so
    # the filled region does not step at the seam. Median, not mean: the overlap
    # contains residual building signal that would drag a mean.
    # FILL FROM GEDTM30 WHERE AVAILABLE. It is bare earth by construction rather
    # than by our own footprint masking, which only ever reached 9.5 % of cells.
    ged = read_gedtm30(site, dsm.shape)
    fill_source = "GEDTM30 v1.2"
    if ged is None or not np.isfinite(ged).any():
        fill, fill_source = glo_dtm, "Copernicus GLO-30 (masked)"   # the fallback
    else:
        fill = np.where(np.isfinite(ged), ged, glo_dtm)
    both = ~void
    offset = float(np.median(delta[both] - fill[both])) if both.any() else 0.0
    terrain = np.where(void, fill + offset, delta)
    print(f"    fill above the 10 m ceiling: {fill_source}, datum offset {offset:+.3f} m")

    removed = (dsm - glo_dtm)[mask]
    # FLIP TO SOUTH-UP. rasterio hands back row 0 at the NORTH edge, and every
    # array above inherits that. `bcr` is already corrected on its way out of
    # rasterize(); `h` never was, so the two grids in this same artefact were
    # mirrored against each other, and both against the footprints.
    #
    # MEASURED, not reasoned: 293,608 building centroids were tested against the
    # sea mask derived from `h`. As stored, 36.57 % of Dubai's buildings stood in
    # the Persian Gulf; flipped, 0.45 %. Buildings are on land, so this is the
    # orientation. types.ts GridSpec fixes the convention -- "row-major from the
    # south-west corner, +y north" -- and `bcr` already obeyed it.
    #
    # This hid because the old surface was a flat 10 m mesa: a mirror of a
    # featureless plane looks identical. Fixing the DeltaDTM ceiling gave the
    # terrain real relief, which is what made it visible.
    grid = resample(terrain, site.grid_n)[::-1]
    bcr = resample(coverage.astype("float64"), site.grid_n).clip(0.0, 1.0)[::-1]

    return {
        "site": site.id,
        "source": "DeltaDTM v1.0 (bare earth, <=10 m MSL) with GEDTM30 v1.2 bare-earth fill at and above the 10 m ceiling",
        "licence": f"{DELTADTM_LICENCE}; {GEDTM30_LICENCE}; {LICENCE}",
        "attribution": f"{DELTADTM_ATTRIBUTION}. {GEDTM30_ATTRIBUTION}. {ATTRIBUTION}",
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
            "ceilingFraction": round(float((delta >= DELTADTM_CEILING_M).mean()), 4),
            # LAND-RELATIVE, and that distinction matters. A third of this window
            # is the Persian Gulf, where DeltaDTM has no land to measure — counting
            # that as "failed to cover" made a healthy build look broken.
            "measuredLandFraction": round(float(measured.sum() / max(land.sum(), 1)), 4),
            "landFillFraction": round(float(ceiling.sum() / max(land.sum(), 1)), 4),
            # WHAT ACTUALLY FILLED, not what was hoped. The check used to warn
            # about "falling back to GLO-30" while inferring it from a FRACTION —
            # but a high fill fraction is expected wherever DeltaDTM is saturated,
            # and says nothing about which source supplied it. Assert the source.
            "fillSource": fill_source,
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
        # WAS: bare-earth span must stay under 60 % of the DSM's, as a proxy for
        # "DeltaDTM actually loaded". That proxy died when the 10 m ceiling bug was
        # fixed: 37 % of LAND is legitimately GLO-30 fill now, and fill carries the
        # DSM's full relief, so the spans converge on a correct build. Retuning the
        # ratio would only have moved the goalposts, so it is replaced by a direct
        # test of the thing it was standing in for.
        # THE REAL RISK IS THE WRONG SOURCE, NOT A LOW FRACTION. DeltaDTM covers
        # coastal land below 10 m MSL; how much of a window that is depends on
        # where the window is, not on whether the pipeline worked. Dubai South is
        # inland high ground and DeltaDTM is 89.5 % saturated there, so 21 %
        # measured is correct rather than alarming. What must never happen is a
        # DSM being served as bare earth.
        fill_src = d["deltadtm"].get("fillSource", "")
        if fill_src and "GEDTM30" not in fill_src:
            failures.append(f"{sid}: fill came from {fill_src!r}, not GEDTM30 -- a surface "
                            f"model is being served as bare earth")
        floor = {"dubai-creek": 0.30, "dubai-south": 0.10}.get(sid, 0.30)
        if d["deltadtm"]["measuredLandFraction"] < floor:
            failures.append(f"{sid}: only {100*d['deltadtm']['measuredLandFraction']:.0f}% of LAND is "
                            f"measured DeltaDTM, below this site's {100*floor:.0f}% floor")
        # Bare earth is never above the surface it was derived from.
        if d["dtm"]["p95"] > d["dsm"]["p95"] + 0.01:
            failures.append(f"{sid}: bare earth p95 {d['dtm']['p95']:.2f} m exceeds the DSM's "
                            f"{d['dsm']['p95']:.2f} m -- that is not a ground surface")
        # WAS: voidFraction > 0.5. That counted the Persian Gulf, a third of this
        # window, as "DeltaDTM failed to cover" -- so a healthy build read as broken.
        # Fill is only meaningful as a fraction of LAND.
        cap = {"dubai-creek": 0.50, "dubai-south": 0.90}.get(sid, 0.50)
        if d["deltadtm"]["landFillFraction"] > cap:
            failures.append(f"{sid}: {100*d['deltadtm']['landFillFraction']:.0f}% of land is fill, "
                            f"above this site's {100*cap:.0f}% cap")

        # THE MIRROR GUARD. `h` came back from rasterio north-up while `bcr` was
        # flipped south-up, so the two grids in this artefact were mirrored against
        # each other and against every footprint. Measured at the time: 36.57 % of
        # Dubai's buildings stood in the Persian Gulf. Nothing caught it, because a
        # mirrored flat mesa looks exactly like an unmirrored one.
        #
        # Buildings are not built in the sea. If the two grids ever disagree about
        # which cells are water again, this fails loudly.
        hh = np.asarray(d["h"], dtype="float64").reshape(n, n)
        bb = np.asarray(d["bcr"], dtype="float64").reshape(n, n)
        lab, _ = ndimage.label(hh < 0.0)
        edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
        edge.discard(0)
        sea = np.isin(lab, list(edge))
        built = bb > 0.30
        if built.sum() > 100:
            drowned = float(sea[built].mean())
            if drowned > 0.05:
                failures.append(
                    f"{sid}: {100*drowned:.1f}% of built-up cells fall inside the sea derived from h "
                    f"-- h and bcr disagree about which way is north")
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
              f"DeltaDTM measures {100*dd['measuredLandFraction']:.0f}% of land, "
              f"fill {100*dd['landFillFraction']:.0f}% @ offset {dd['gloFillOffsetM']} m | "
              f"mean BCR {m['coverageMean']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--site", default=None,
                        help="build one site only (default: all)")
    args = parser.parse_args()
    if args.check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    wanted = {k: v for k, v in SITES.items() if args.site in (None, k)}
    if not wanted:
        raise SystemExit(f"unknown site {args.site!r}; have {list(SITES)}")
    for sid, site in wanted.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-terrain.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
