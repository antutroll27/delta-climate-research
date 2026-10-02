"""
The administrative boundary a ward's statistics are masked to.

WHY THIS EXISTS (2026-10-02). Until then every Kolkata "ward" was a 1400 m box
around a hand-picked centre, and every ward statistic was a statistic of the
box. Ballygunge's box held only part of KMC Ward 68 and parts of five
neighbours. The founder's decision: Ballygunge IS Ward 68. The compute domain
stays a square (the solver, the rasters and the 3D scene all want one), but
every number that is reported AS THE WARD'S is masked to the real polygon, and
buildings inside the square but outside the polygon stay only as context.

ONE POLYGON SOURCE. DataMeet's 141-ward KMC file (CC BY-SA 2.5 India), copied
unchanged into data/geometry/kmc-wards-around-ballygunge.geojson. A ward with
no entry in POLYGONS has no administrative boundary in this repo, and every
caller must then fall back to the square — explicitly, never by default: the
functions here return None for such a ward rather than the square, so a caller
cannot mistake "no polygon" for "the polygon is the square".

THE FRAME. Ward-local metres, x east and y north, from `_types.m_per_deg` about
the ward centre — the same frame as fetch-buildings.to_local and every
`{ward}-*.json` artefact.

THE TWO GRID CONVENTIONS, because they are opposite and both ship:
  * the SOLVER grid (ward-raster.ts) is SOUTH-up: cell (gx, gy) has its centre at
    (-half + (gx+0.5)*cell, -half + (gy+0.5)*cell) and lives at index gy*n + gx.
  * the served PNGs (surface, canopy) are NORTH-up: row 0 is the northern edge.
`mask_grid` takes the convention as a required keyword so a call site has to
say which one it means.
"""
from __future__ import annotations

import json
import os
from typing import Literal

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon, shape

import _types
from _types import Mask, Ward, WardId

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")

#: ward id -> (geojson path relative to the repo root, KMC ward number in it).
POLYGONS: dict[WardId, tuple[str, int]] = {
    "ballygunge": ("data/geometry/kmc-wards-around-ballygunge.geojson", 68),
}

#: The attribution every derivative of the polygon itself must carry.
LICENCE = "CC BY-SA 2.5 India"
ATTRIBUTION = ("Ward boundary: DataMeet Municipal_Spatial_Data, Kolkata/kolkata.geojson "
               "(KMC 141-ward scheme), commit cd528915e5f69c54b6d3ca858feb5ae56e3e7b3b; "
               "CC BY-SA 2.5 India")

RowOrder = Literal["south-up", "north-up"]


def has_polygon(ward_id: WardId) -> bool:
    return ward_id in POLYGONS


def polygon_lonlat(ward_id: WardId) -> Polygon | None:
    """The ward polygon in lon/lat, or None for a ward with no boundary here.

    DataMeet stores every ward as a MultiPolygon. Ward 68 has exactly one part;
    a ward with several would need the caller to decide what "the ward" means
    for a statistic, so that case refuses rather than silently keeping a part.
    """
    entry = POLYGONS.get(ward_id)
    if entry is None:
        return None
    rel, number = entry
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        doc = json.load(fh)
    hits = [f for f in doc["features"] if f["properties"].get("ward") == number]
    if len(hits) != 1:
        raise ValueError(f"{rel}: expected one feature for ward {number}, found {len(hits)}")
    geom = shape(hits[0]["geometry"])
    if isinstance(geom, MultiPolygon):
        if len(geom.geoms) != 1:
            raise ValueError(f"ward {number} has {len(geom.geoms)} parts — decide what the "
                             f"ward statistic means before masking to it")
        geom = geom.geoms[0]
    if not isinstance(geom, Polygon) or not geom.is_valid:
        raise ValueError(f"ward {number}: not a valid polygon")
    return geom


def to_local(ward: Ward, lon: float, lat: float) -> tuple[float, float]:
    """Degrees -> ward-local metres (x east, y NORTH). Same as fetch-buildings.to_local."""
    mx, my = _types.m_per_deg(ward.centre.lat)
    return (lon - ward.centre.lon) * mx, (lat - ward.centre.lat) * my


def polygon_local(ward: Ward) -> Polygon | None:
    """The ward polygon in ward-local metres, or None for a ward with no boundary."""
    g = polygon_lonlat(ward.id)
    if g is None:
        return None
    ring = [to_local(ward, lon, lat) for lon, lat in g.exterior.coords]
    holes = [[to_local(ward, lon, lat) for lon, lat in r.coords] for r in g.interiors]
    return Polygon(ring, holes)


def mask_grid(ward: Ward, n: int, *, rows: RowOrder) -> Mask | None:
    """n x n boolean grid over the ward square: True where the CELL CENTRE lies in the polygon.

    Centre inclusion, not area fraction: a mask is a yes/no answer per cell, and
    a cell half inside the ward is counted by where its centre falls, which is
    unbiased over a boundary several hundred cells long. Returns None for a ward
    with no polygon.
    """
    poly = polygon_local(ward)
    if poly is None:
        return None
    half = ward.footprint_m / 2.0
    cell = ward.footprint_m / n
    centres = -half + (np.arange(n, dtype=np.float64) + 0.5) * cell
    xs, ys = np.meshgrid(centres, centres)               # ys[0] = southern row
    inside = np.asarray(shapely.contains_xy(poly, xs, ys), dtype=np.bool_)
    if rows == "north-up":
        inside = inside[::-1, :]
    out: Mask = np.ascontiguousarray(inside)
    return out


def rle(mask: Mask) -> list[int]:
    """Run lengths of a flattened boolean mask, starting with a run of False.

    The first run may be 0 (when index 0 is inside). Sums to mask.size. Kept
    this simple on purpose so any reader can decode it in five lines.
    """
    flat = mask.ravel()
    runs: list[int] = []
    current = False
    count = 0
    for v in flat:
        if bool(v) == current:
            count += 1
        else:
            runs.append(count)
            current = not current
            count = 1
    runs.append(count)
    return runs


def unrle(runs: list[int], size: int) -> Mask:
    out: Mask = np.zeros(size, dtype=np.bool_)
    pos, value = 0, False
    for r in runs:
        if value:
            out[pos:pos + r] = True
        pos += r
        value = not value
    if pos != size:
        raise ValueError(f"run lengths sum to {pos}, expected {size}")
    return out


def _self_test() -> None:
    m = np.array([[False, True], [True, True]])
    assert rle(m) == [1, 3], rle(m)
    assert (unrle(rle(m), 4).reshape(2, 2) == m).all()
    z = np.array([[True, False]])
    assert rle(z) == [0, 1, 1], rle(z)
    assert (unrle(rle(z), 2).reshape(1, 2) == z).all()
    w = _types.WARDS["ballygunge"]
    poly = polygon_local(w)
    assert poly is not None
    minx, miny, maxx, maxy = poly.bounds
    half = w.footprint_m / 2
    # the founder's margin rule: at least 150 m between the ward and every edge
    margin = min(half + minx, half - maxx, half + miny, half - maxy)
    assert margin >= 150.0, f"Ward 68 sits {margin:.1f} m from the square's edge"
    s = mask_grid(w, 247, rows="south-up")
    nn = mask_grid(w, 247, rows="north-up")
    assert s is not None and nn is not None
    assert (s[::-1] == nn).all(), "north-up must be the row flip of south-up"
    frac = float(s.mean())
    area_frac = poly.area / w.footprint_m ** 2
    assert abs(frac - area_frac) < 0.01, (frac, area_frac)
    # the northern tip of Ward 68 is north of centre: it must land in the TOP rows
    # of a north-up grid and the BOTTOM rows of a south-up one is the mirror bug.
    north_rows = nn[: 247 // 4].sum()
    assert north_rows > 0 and s[-(247 // 4):].sum() == north_rows
    assert not has_polygon("barrackpore") and polygon_local(_types.WARDS["barrackpore"]) is None
    print(f"  _wardmask: Ward 68 {poly.area / 1e6:.4f} km² local, {frac:.1%} of the "
          f"{w.footprint_m} m square, margin {margin:.0f} m; rle round-trips")


if __name__ == "__main__":
    _self_test()
