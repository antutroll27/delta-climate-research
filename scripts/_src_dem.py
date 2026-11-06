"""AHN terrain adapter (Task A6): DTM/DSM from PDOK's WCS, resampled to the solver mesh.

SOURCE (verified 2026-11-06, data/cities/amsterdam/sources.json): PDOK
`https://service.pdok.nl/rws/ahn/wcs/v1_0`, WCS 2.0.1, coverages `dtm_05m` and `dsm_05m`,
0.5 m, EPSG:28992, metres above NAP, float32 with nodata 3.4028234663852886e+38, CC0.
The service abstract says the CURRENT AHN is version 4 (flown 2020-2022). That is NOT the
2023 AHN5 vintage 3D BAG mostly takes its heights from, so a height comparison between the
two (guard G5) spans a one-to-three-year gap.

LIMITS: a request may be at most 4000 x 4000 pixels (2 km at 0.5 m), so the box is fetched
in <= 1 km tiles. The DTM has NO DATA under buildings and over water (ground-classified
points only), and the DSM has none over water; both masks are kept for guard G6.

ORIENTATION. The raster is north-up in RD New, but RD's grid north is rotated about 0.4
degrees from true north at Amsterdam (about 20 m over 2.8 km), so the mesh is not cut out
of the raster by array slicing: it is `rasterio.warp.reproject`-ed (average) onto a
regular grid in EPSG:4326 whose bounds are `_city.bounds(area)`. That grid is uniform in
the local frame by construction (the frame IS degrees times a constant). Reproject gives
row 0 = NORTH; the stored mesh is flipped once, here, to row 0 = SOUTH like Bengaluru's.
"""
from __future__ import annotations

import math
import os
import time
from typing import Final

import numpy as np
import numpy.typing as npt
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.transform import Affine, from_bounds, from_origin
from rasterio.warp import reproject
from scipy import ndimage

import _city
from _city import Area, CityTerrainFile

WCS_URL: Final = "https://service.pdok.nl/rws/ahn/wcs/v1_0"
USER_AGENT: Final = "obos-pipeline/1.0 (+https://deltaclimate.earth)"
PIXEL_M: Final = 0.5
TILE_M: Final = 1000.0
PAD_M: Final = 50.0
SOURCE: Final = "AHN DTM 0.5 m (Rijkswaterstaat et al., PDOK WCS dtm_05m), CC0"
DATUM: Final = "NAP"
#: What the service writes for 'no data'. Compared exactly, because it is a float32 maximum.
WCS_NODATA: Final = float(np.float32(3.4028234663852886e+38))

F32 = npt.NDArray[np.float32]


def _grid_extent(area: Area) -> tuple[float, float, float, float]:
    """RD envelope of the area + pad, snapped OUTWARD to the 0.5 m pixel lattice."""
    minx, miny, maxx, maxy = _city.bounds_local_crs(area, PAD_M)
    return (math.floor(minx / PIXEL_M) * PIXEL_M, math.floor(miny / PIXEL_M) * PIXEL_M,
            math.ceil(maxx / PIXEL_M) * PIXEL_M, math.ceil(maxy / PIXEL_M) * PIXEL_M)


def _tile_boxes(ext: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    minx, miny, maxx, maxy = ext
    nx, ny = math.ceil((maxx - minx) / TILE_M), math.ceil((maxy - miny) / TILE_M)
    return [(minx + i * TILE_M, miny + j * TILE_M, min(minx + (i + 1) * TILE_M, maxx), min(miny + (j + 1) * TILE_M, maxy))
            for j in range(ny) for i in range(nx)]


def fetch_tile(coverage: str, box: tuple[float, float, float, float], raw: str) -> str:
    x0, y0, x1, y1 = box
    path = os.path.join(raw, f"{coverage}_{int(x0)}_{int(y0)}.tif")
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    r = requests.get(WCS_URL, headers={"User-Agent": USER_AGENT}, timeout=300, params={
        "service": "WCS", "version": "2.0.1", "request": "GetCoverage", "coverageId": coverage,
        "format": "image/tiff", "subset": [f"x({x0:g},{x1:g})", f"y({y0:g},{y1:g})"]})
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/tiff"):
        raise SystemExit(f"WCS {coverage} {box}: HTTP {r.status_code} {r.text[:300]}")
    os.makedirs(raw, exist_ok=True)
    with open(path + ".part", "wb") as fh:
        fh.write(r.content)
    os.replace(path + ".part", path)
    time.sleep(0.5)
    return path


def mosaic(coverage: str, area: Area, raw: str) -> tuple[F32, Affine]:
    """The whole box as one north-up float32 array in RD (nodata -> NaN), written to `raw` as a clip."""
    ext = _grid_extent(area)
    minx, miny, maxx, maxy = ext
    cols, rows = round((maxx - minx) / PIXEL_M), round((maxy - miny) / PIXEL_M)
    out = np.full((rows, cols), np.nan, dtype=np.float32)
    transform = from_origin(minx, maxy, PIXEL_M, PIXEL_M)
    for box in _tile_boxes(ext):
        with rasterio.open(fetch_tile(coverage, box, raw)) as src:
            a = src.read(1).astype(np.float32)
            a[a == WCS_NODATA] = np.nan
            # The server snaps to its own lattice; place by the tile's own transform, not by assumption.
            c0 = round((src.transform.c - minx) / PIXEL_M)
            r0 = round((maxy - src.transform.f) / PIXEL_M)
            if abs(src.transform.a - PIXEL_M) > 1e-9 or abs(src.transform.e + PIXEL_M) > 1e-9:
                raise SystemExit(f"{coverage} tile resolution {src.transform.a}, expected {PIXEL_M}")
            h, w = a.shape
            out[r0:r0 + h, c0:c0 + w] = a[: rows - r0, : cols - c0]
    clip = os.path.join(raw, f"{coverage}_clip.tif")
    with rasterio.open(clip, "w", driver="GTiff", height=rows, width=cols, count=1, dtype="float32",
                       crs="EPSG:28992", transform=transform, nodata=float("nan"), compress="deflate") as dst:
        dst.write(out, 1)
    return out, transform


def to_mesh(a: F32, transform: Affine, area: Area, n: int, resampling: Resampling) -> F32:
    """Reproject an RD raster onto an n x n EPSG:4326 grid over `_city.bounds(area)`. Row 0 = NORTH."""
    w, s, e, nn = _city.bounds(area)
    dst = np.full((n, n), np.nan, dtype=np.float32)
    reproject(source=a, destination=dst, src_transform=transform, src_crs="EPSG:28992",
              dst_transform=from_bounds(w, s, e, nn, n, n), dst_crs="EPSG:4326",
              src_nodata=float("nan"), dst_nodata=float("nan"), resampling=resampling)
    return dst


def fill_nearest(mesh: F32) -> tuple[F32, int]:
    """Replace NaN cells by the value of the nearest valid cell. Returns (filled, n_filled)."""
    bad = np.isnan(mesh)
    n_bad = int(bad.sum())
    if n_bad == 0:
        return mesh, 0
    if n_bad == mesh.size:
        raise SystemExit("terrain mesh has no valid cell at all")
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return mesh[idx[0], idx[1]].astype(np.float32), n_bad


def build_terrain(area: Area, raw: str, retrieved: str) -> tuple[CityTerrainFile, list[str]]:
    n = _city.TERRAIN_N
    dtm, tf = mosaic("dtm_05m", area, raw)
    dsm, _ = mosaic("dsm_05m", area, raw)
    valid = ~np.isnan(dtm)
    native = dtm[valid]
    p = np.percentile(native, [0.1, 50.0, 99.9]).tolist()
    relief_native = float(native.max() - native.min())

    mesh_north = to_mesh(dtm, tf, area, n, Resampling.average)
    filled_north, n_filled = fill_nearest(mesh_north)
    mesh_south = np.flipud(filled_north)                                  # row 0 = SOUTH, once, here

    vals = mesh_south.reshape(-1)
    doc = CityTerrainFile(
        city=area.city, area=area.id, sizeM=float(area.size_m), n=n, source=SOURCE, datum=DATUM,
        minM=round(float(vals.min()), 3), maxM=round(float(vals.max()), 3), meanM=round(float(vals.mean()), 3),
        reliefNativeM=round(relief_native, 3),
        resampleNote=(f"Mesh is {n}x{n} over {area.size_m} m: area-average of valid 0.5 m DTM pixels per cell "
                      f"(rasterio.warp.reproject, Resampling.average, onto a regular EPSG:4326 grid over the frame's "
                      f"box; RD grid north is rotated ~0.4 degrees from true north). The DTM has no data under "
                      f"buildings or over water; {n_filled} of {n * n} cells had no valid pixel at all and take "
                      f"their nearest valid neighbour. For the mesh only: the nodata mask is kept for guard G6. "
                      f"Heights are NAP metres and may be negative. AHN version served: 4 (flown 2020-2022). "
                      f"Row 0 is the SOUTH edge."),
        h=[round(float(v), 3) for v in vals])
    n_dsm_valid = int((~np.isnan(dsm)).sum())
    report = [
        f"DTM mosaic {dtm.shape[1]}x{dtm.shape[0]} px; valid {valid.mean():.4f} (nodata share {1 - valid.mean():.4f}); "
        f"DSM valid {n_dsm_valid / dsm.size:.4f}",
        f"native DTM (NAP m): min {native.min():.3f}  p0.1 {p[0]:.3f}  median {p[1]:.3f}  p99.9 {p[2]:.3f}  max {native.max():.3f}",
        f"mesh {n}x{n}: min {doc['minM']}  max {doc['maxM']}  mean {doc['meanM']}  relief(native) {doc['reliefNativeM']}  "
        f"cells filled {n_filled}",
        f"negative mesh cells: {int((vals < 0).sum())} of {vals.size} ({(vals < 0).mean():.3f})",
    ]
    return doc, report


def validate_terrain_file(area: Area, doc: CityTerrainFile) -> list[str]:
    bad: list[str] = []
    n = doc["n"]
    if n != _city.TERRAIN_N or len(doc["h"]) != n * n:
        bad.append(f"n={n}, len(h)={len(doc['h'])}")
    if doc["datum"] != DATUM or doc["sizeM"] != area.size_m:
        bad.append("datum or sizeM")
    if not all(math.isfinite(v) for v in doc["h"]):
        bad.append("non-finite height")
    if doc["h"] and (abs(min(doc["h"]) - doc["minM"]) > 1e-6 or abs(max(doc["h"]) - doc["maxM"]) > 1e-6):
        bad.append("min/max disagree with h")
    return bad


def self_test() -> None:
    """Offline: grid snapping, the mesh orientation contract, nearest fill."""
    area = _city.AREAS["canal-ring"]
    ext = _grid_extent(area)
    assert all(abs(v / PIXEL_M - round(v / PIXEL_M)) < 1e-9 for v in ext), ext
    boxes = _tile_boxes(ext)
    assert all((b[2] - b[0]) <= TILE_M and (b[3] - b[1]) <= TILE_M for b in boxes)
    assert sum((b[2] - b[0]) * (b[3] - b[1]) for b in boxes) == (ext[2] - ext[0]) * (ext[3] - ext[1])
    assert max((b[2] - b[0]) / PIXEL_M for b in boxes) <= 4000          # the WCS MAXSIZE

    # ORIENTATION: a synthetic RD raster whose height rises NORTHWARD must give a mesh whose
    # LAST rows (row n-1) are the highest after the flip-to-south-first the builder applies.
    x0, y0, x1, y1 = ext
    cols, rows = round((x1 - x0) / PIXEL_M), round((y1 - y0) / PIXEL_M)
    ramp = np.linspace(y1 - y0, 0.0, rows, dtype=np.float32)[:, None] * np.ones((1, cols), dtype=np.float32) / 100.0
    # row 0 of `ramp` is the NORTH edge of the raster and carries the LARGEST value: height grows to the north.
    tf = from_origin(x0, y1, PIXEL_M, PIXEL_M)
    north_up = to_mesh(ramp, tf, area, 24, Resampling.average)
    south_first = np.flipud(north_up)
    col = south_first[:, 12]
    assert np.all(np.diff(col) > 0), "heights rising northward must rise with the row index when row 0 is SOUTH"
    assert north_up[0, 12] > north_up[-1, 12]

    holey = np.arange(16, dtype=np.float32).reshape(4, 4)
    holey[1:3, 1:3] = np.nan
    filled, k = fill_nearest(holey)
    assert k == 4 and not np.isnan(filled).any() and filled[0, 0] == 0.0
    print("_src_dem self-test: ok (0.5 m lattice, <= 4000 px tiles, northward ramp -> row 0 = SOUTH after the flip, nearest fill)")
