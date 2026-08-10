"""Meta/WRI 1 m Global Canopy Height Model -> {ward}-canopy.png + {ward}-trees.json.

WHAT THIS IS. The CHMv1 ("alsgedi_global_v6_float") canopy height map, published
by Meta Data for Good + World Resources Institute on AWS Open Data, gives the
one fact the Sentinel-derived `veg[]` field cannot: a measured VERTICAL canopy
height per metre, globally, at ~1 m resolution. NDVI-derived fractional
vegetation cover conflates grass, crops and tree canopy; this model does not.

SOURCE AND ACCESS (verified 2026-08-10). Bucket `s3://dataforgood-fb-data/`,
prefix `forests/v1/alsgedi_global_v6_float/`. Layout confirmed by fetching the
bucket's own index and inspecting it directly (not by trusting an unverified
blog write-up):
  - `tiles.geojson` at the prefix root: 56,145 features, each a rectangular
    polygon tagged `properties.tile` with a 9-digit string.
  - `chm/<tile>.tif`: the height raster for that polygon, one continuous
    GeoTIFF (EPSG:3857, ~1 m/px at 65536x65536 -- not internally tiled, so a
    windowed rasterio read is the only affordable access pattern).
The 9-digit `tile` values are standard Bing/Virtual-Earth QuadKeys at zoom 9 --
confirmed by computing the QuadKey for the ballygunge centre with the textbook
tile-XY + bit-interleave algorithm and matching it byte-for-byte against the
`tiles.geojson` polygon that contains that point (both gave `123133323`). So
`chm_href` computes the QuadKey from the ward centre rather than hardcoding a
tile id -- it generalises to any WARDS entry without a lookup table.

Anonymous access: no AWS account needed. `AWS_NO_SIGN_REQUEST=YES` in the
environment (see `main`'s docstring / the module run instructions) lets GDAL's
`/vsis3/` driver read the object unsigned; rasterio.open() handles the path
transparently.

    AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge
    python3 scripts/fetch-canopy.py --check     # local artefacts only, no network
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import Any, cast

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _types  # noqa: E402
from _types import WARDS, Ward  # noqa: E402

RETRIEVED = "2026-08-10"          # constant, not date.today() -- byte-stable regeneration
GRID = 140                        # served canopy grid (matches surface: FOOTPRINT_M // 10)
CANOPY_HI = 30.0                  # metres; quantisation ceiling for the PNG
MIN_TREE_H = 2.0                  # metres; below this a cell is not "canopy"
TARGET_SPACING_M = 12.0           # one tree per ~12 m cell of canopy (density cap)
DATA = os.path.join(HERE, "..", "public", "heat-map", "data")

#: CHMv1 bucket, verified 2026-08-10 against the registry's own tiles.geojson
#: index (56,145 features) fetched and inspected directly -- see module docstring.
CHM_BUCKET = "dataforgood-fb-data"
CHM_PREFIX = "forests/v1/alsgedi_global_v6_float"
CHM_ZOOM = 9                      # QuadKey length observed in tiles.geojson (9 digits)


def _quadkey(lat: float, lon: float, zoom: int) -> str:
    """Bing/Virtual-Earth QuadKey for (lat, lon) at `zoom`.

    Standard tile-XY + bit-interleave algorithm (Microsoft Bing Maps Tile
    System). Verified against the CHM index rather than assumed: computing this
    for the ballygunge centre reproduces the exact tile id
    (`123133323`) that `tiles.geojson` assigns to the polygon containing that
    point, at the zoom level (9) its tile ids happen to use.
    """
    lat_rad = math.radians(lat)
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    digits = []
    for i in range(zoom, 0, -1):
        mask = 1 << (i - 1)
        digit = 0
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def chm_href(ward: Ward) -> str:
    """/vsis3/ path of the Meta/WRI CHM COG tile covering this ward's centre.

    Computed, not hardcoded: the QuadKey for the ward centre at CHM_ZOOM. This
    is safe for a 1400 m ward window because at zoom 9 each tile spans roughly
    150 km on a side in this latitude band -- three orders of magnitude wider
    than the ward, so a window near a tile boundary is the only case that could
    straddle two tiles, and every current WARDS entry (verified for ballygunge)
    sits well inside a single tile.
    """
    qk = _quadkey(ward.centre.lat, ward.centre.lon, CHM_ZOOM)
    return f"/vsis3/{CHM_BUCKET}/{CHM_PREFIX}/chm/{qk}.tif"


def read_chm_grid(ward: Ward, n: int) -> npt.NDArray[np.float32] | None:
    """Windowed COG read of the CHM, reprojected to the ward box, regridded to n x n.

    Returns metres, north-up (row 0 = north), or None on any failure (callers skip)."""
    lat, lon = ward.centre.lat, ward.centre.lon
    half = ward.footprint_m / 2.0
    dlat = half / 110_540.0
    dlon = half / (111_320.0 * float(np.cos(np.radians(lat))))
    try:
        with rasterio.open(chm_href(ward)) as src:
            l, b, r, t = transform_bounds(
                "EPSG:4326", src.crs, lon - dlon, lat - dlat, lon + dlon, lat + dlat
            )
            win = from_bounds(l, b, r, t, src.transform)
            arr = src.read(
                1, window=win, out_dtype="float32", out_shape=(n, n),
                boundless=True, fill_value=0.0, resampling=Resampling.average,
            )
    except Exception:
        return None
    out = np.asarray(arr, dtype=np.float32)
    out[~np.isfinite(out)] = 0.0
    np.clip(out, 0.0, None, out=out)
    return out


def quantise(a: npt.NDArray[np.float32], hi: float) -> npt.NDArray[np.uint8]:
    q = np.clip(a / hi, 0.0, 1.0) * 255.0
    out: npt.NDArray[np.uint8] = np.round(q).astype(np.uint8)
    return out


def write_canopy_png(ward_id: str, grid_north_up: npt.NDArray[np.float32]) -> str:
    from PIL import Image
    ch = quantise(grid_north_up, CANOPY_HI)              # single channel, north-up
    rgb = np.dstack([ch, ch, ch])                        # grey PNG; TS reads R
    path = os.path.join(DATA, f"{ward_id}-canopy.png")
    Image.fromarray(rgb, mode="RGB").save(path, optimize=True)
    return path


def derive_trees(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """One tree per canopy cell, downsampled to ~TARGET_SPACING_M, ward-local metres (+y north)."""
    n = grid_north_up.shape[0]
    cell_m = ward.footprint_m / n
    step = max(1, int(round(TARGET_SPACING_M / cell_m)))
    half = ward.footprint_m / 2.0
    species_cycle = ("neem", "neem", "gulmohar", "palm")   # deterministic broadleaf-dominant mix
    trees: list[_types.TreeInstanceJSON] = []
    for row in range(0, n, step):
        for col in range(0, n, step):
            h = float(grid_north_up[row, col])
            if h < MIN_TREE_H:
                continue
            # cell centre -> ward-local metres; row 0 = north so +y decreases with row
            x = round((col + 0.5) * cell_m - half, 2)
            y = round(half - (row + 0.5) * cell_m, 2)
            sp = species_cycle[(row * 7 + col * 13) % len(species_cycle)]
            trees.append({"x": x, "y": y, "h": round(h, 1), "species": sp, "r": round(h * 0.35, 2)})
    return trees


def serialise(doc: dict[str, Any]) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


def build_ward(ward: Ward) -> None:
    grid = read_chm_grid(ward, GRID)
    if grid is None:
        raise SystemExit(f"CHM read failed for {ward.id}")
    write_canopy_png(ward.id, grid)
    trees = derive_trees(ward, grid)
    doc: _types.TreesFileJSON = {
        "ward": ward.id, "grid": GRID, "sizeM": float(ward.footprint_m),
        "retrieved": RETRIEVED, "trees": trees,
    }
    with open(os.path.join(DATA, f"{ward.id}-trees.json"), "w", encoding="utf-8") as fh:
        fh.write(serialise(cast("dict[str, Any]", doc)))
    print(f"{ward.id}: {len(trees)} trees, canopy grid {GRID}x{GRID}")


def check() -> None:
    """Re-read committed artefacts and assert invariants (fetch-terrain tripwire idiom).

    No network: only wards whose artefacts already exist on disk are checked, so
    this passes in an environment with no CHM access as long as nothing
    committed is malformed.
    """
    for wid in WARDS:
        tp = os.path.join(DATA, f"{wid}-trees.json")
        pp = os.path.join(DATA, f"{wid}-canopy.png")
        if not (os.path.exists(tp) and os.path.exists(pp)):
            continue  # only wards that have been built
        with open(tp, encoding="utf-8") as fh:
            doc = cast(_types.TreesFileJSON, json.load(fh))
        assert doc["ward"] == wid, f"{wid}: ward mismatch"
        assert doc["grid"] == GRID, f"{wid}: grid must be {GRID}"
        for t in doc["trees"]:
            assert MIN_TREE_H - 0.05 <= t["h"] <= CANOPY_HI + 5, f"{wid}: tree height out of range {t['h']}"
            assert abs(t["x"]) <= doc["sizeM"] / 2 + 1 and abs(t["y"]) <= doc["sizeM"] / 2 + 1, f"{wid}: tree outside ward"
            assert t["species"] in ("neem", "gulmohar", "palm"), f"{wid}: bad species {t['species']}"
    print("canopy artefacts OK")


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--check":
        check()
        return
    targets = [WARDS[a] for a in args] if args else [WARDS["ballygunge"]]
    for ward in targets:
        build_ward(ward)


if __name__ == "__main__":
    main()
