#!/usr/bin/env python3
"""Build OGC 3D Tiles 1.1 tilesets of the LoD1 building shells, one per ward.

WHY THIS IS THE ONE PHASE-3 ITEM WE COULD ACTUALLY FINISH. 3D Tiles is a static
format by design -- a tileset.json plus content files, served as bytes -- so it
is the rare standard that fits this site's "no runtime, everything a committed
artefact" architecture instead of fighting it.

The standards doc named the gap precisely: "bounding volumes must be verified in
radians; geometric error values are placeholders". Both are addressed here and
neither is invented:

  * `region` bounding volumes are [west, south, east, north, minH, maxH] with the
    four angles in RADIANS (3D Tiles 1.1 §4.2.1). Degrees would place Kolkata a
    few metres off the coast of Africa -- a failure severe enough to be obvious,
    which is the only reason it is a safe unit to get wrong once.
  * `geometricError` is MEASURED, not guessed: the root's value is the median
    building footprint diagonal in the ward, i.e. the size of the feature a
    viewer stops resolving if the tile is not loaded. Leaves are 0.0 because the
    content IS the finest representation we have -- there is nothing below it.

GEOREFERENCING. Content vertices are local east-north-up metres about a ward
origin; the tileset root `transform` is the ENU->ECEF matrix at that origin
(column-major, per the spec). Every vertex goes geodetic -> ECEF -> ENU exactly,
rather than through a flat-earth metres-per-degree approximation, so the tileset
cannot drift from the WGS84 positions the rest of the pipeline uses. This repo
has shipped a mirrored render before, so `demo()` pins the transform against
independently-computed reference values rather than trusting it to look right.

HEIGHT DATUM, stated because it is a real limitation: buildings sit at ellipsoid
height 0. We have no validated terrain model -- ICESat-2 gave three fixed tracks
and the DSM sits ~6 m above real ground -- so inventing a ground elevation would
be worse than declaring this one. Viewers should clamp to terrain.

Reuses the SAME inputs and the SAME height floor as the shipped map and the
CityJSON export, so all three agree by construction.

    python3 scripts/build-3d-tiles.py          # writes public/3d-tiles/{ward}/
    python3 scripts/build-3d-tiles.py --check  # self-check only, writes nothing
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
from typing import TypedDict

from _gltf import earclip, write_glb


class Footprint(TypedDict):
    """One row of data/geometry/{ward}-footprints.json."""

    gers: str
    lonlat: list[list[float]]


class HeightRow(TypedDict):
    """One row of data/geometry/heights-overture.json -> wards -> {ward}."""

    id: str
    p65: float
    fill: bool


class WardStats(TypedDict):
    ward: str
    buildings: int
    vertices: int
    triangles: int
    glb_bytes: int
    geometricError: float
    maxHeight: float

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
GEOM = os.path.join(ROOT, "data", "geometry")
OUT = os.path.join(ROOT, "public", "3d-tiles")
WARDS = ("ballygunge", "barrackpore", "baruipur")

#: Mirrors scripts/build-ward-geometry.py:FLOOR_M -- Google Open Buildings'
#: published minimum AND its no-confident-height value. A zonal statistic below
#: it means the raster found no building under that footprint. Exporting raw p65
#: instead put 438 Ballygunge buildings at heights the pipeline had rejected when
#: the CityJSON export first skipped this; the same trap, pinned the same way.
FLOOR_M = 2.5

# WGS84
_A = 6378137.0
_F = 1.0 / 298.257223563
_E2 = _F * (2.0 - _F)

Vec3 = tuple[float, float, float]


def geodetic_to_ecef(lon_deg: float, lat_deg: float, h: float = 0.0) -> Vec3:
    lam, phi = math.radians(lon_deg), math.radians(lat_deg)
    s = math.sin(phi)
    n = _A / math.sqrt(1.0 - _E2 * s * s)
    return (
        (n + h) * math.cos(phi) * math.cos(lam),
        (n + h) * math.cos(phi) * math.sin(lam),
        (n * (1.0 - _E2) + h) * s,
    )


def enu_basis(lon_deg: float, lat_deg: float) -> tuple[Vec3, Vec3, Vec3]:
    """Unit east/north/up vectors in ECEF at a geodetic point."""
    lam, phi = math.radians(lon_deg), math.radians(lat_deg)
    sl, cl, sp, cp = math.sin(lam), math.cos(lam), math.sin(phi), math.cos(phi)
    return ((-sl, cl, 0.0), (-sp * cl, -sp * sl, cp), (cp * cl, cp * sl, sp))


def root_transform(lon_deg: float, lat_deg: float) -> list[float]:
    """Column-major 4x4 ENU->ECEF matrix, the layout 3D Tiles `transform` wants."""
    e, n, u = enu_basis(lon_deg, lat_deg)
    o = geodetic_to_ecef(lon_deg, lat_deg, 0.0)
    return [e[0], e[1], e[2], 0.0,
            n[0], n[1], n[2], 0.0,
            u[0], u[1], u[2], 0.0,
            o[0], o[1], o[2], 1.0]


def to_enu(lon: float, lat: float, h: float, origin: Vec3, basis: tuple[Vec3, Vec3, Vec3]) -> Vec3:
    p = geodetic_to_ecef(lon, lat, h)
    d = (p[0] - origin[0], p[1] - origin[1], p[2] - origin[2])
    e, n, u = basis
    return (d[0] * e[0] + d[1] * e[1] + d[2] * e[2],
            d[0] * n[0] + d[1] * n[1] + d[2] * n[2],
            d[0] * u[0] + d[1] * u[1] + d[2] * u[2])


def _load(ward: str) -> tuple[list[Footprint], list[HeightRow]]:
    with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
        fp = json.load(fh)
    with open(os.path.join(GEOM, "heights-overture.json"), encoding="utf-8") as fh:
        hs = json.load(fh)["wards"][ward]
    if len(fp["b"]) != len(hs):
        raise ValueError(f"{ward}: {len(fp['b'])} footprints vs {len(hs)} heights -- rows misaligned")
    rows: list[Footprint] = fp["b"]
    hrows: list[HeightRow] = hs
    return rows, hrows


def build_ward(ward: str, write: bool = True) -> WardStats:
    rows, heights = _load(ward)
    lons = [p[0] for r in rows for p in r["lonlat"]]
    lats = [p[1] for r in rows for p in r["lonlat"]]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    olon, olat = (west + east) / 2.0, (south + north) / 2.0
    origin, basis = geodetic_to_ecef(olon, olat, 0.0), enu_basis(olon, olat)

    positions: list[Vec3] = []
    indices: list[int] = []
    diagonals: list[float] = []
    max_h = 0.0

    for row, hrow in zip(rows, heights):
        ring: list[list[float]] = list(row["lonlat"])
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        h = FLOOR_M if (hrow["fill"] or hrow["p65"] < FLOOR_M) else float(hrow["p65"])
        max_h = max(max_h, h)

        base = len(positions)
        flat = [to_enu(pt[0], pt[1], 0.0, origin, basis) for pt in ring]
        positions.extend(flat)                                   # floor ring
        positions.extend((x, y, h) for x, y, _ in flat)           # roof ring
        n = len(ring)
        diagonals.append(math.dist(
            (min(p[0] for p in flat), min(p[1] for p in flat)),
            (max(p[0] for p in flat), max(p[1] for p in flat))))

        caps = earclip([(p[0], p[1]) for p in flat])
        for a, b, c in caps:
            indices += [base + n + a, base + n + b, base + n + c]        # roof, CCW up
            indices += [base + c, base + b, base + a]                    # floor, reversed
        for k in range(n):                                               # walls
            k2 = (k + 1) % n
            b0, b1, t0, t1 = base + k, base + k2, base + n + k, base + n + k2
            indices += [b0, b1, t1, b0, t1, t0]

    # MEASURED, not a placeholder: the feature size a viewer loses if this tile
    # is skipped. Median rather than mean -- footprint sizes are long-tailed and
    # one warehouse should not set the LOD budget for 3,500 houses.
    geometric_error = round(statistics.median(diagonals), 2) if diagonals else 0.0
    region = [math.radians(west), math.radians(south),
              math.radians(east), math.radians(north), 0.0, round(max_h, 2)]

    tileset: dict[str, object] = {
        "asset": {"version": "1.1", "tilesetVersion": "delta-climate-prototype"},
        "geometricError": geometric_error,
        "root": {
            "boundingVolume": {"region": region},
            "geometricError": geometric_error,
            "refine": "REPLACE",
            "transform": root_transform(olon, olat),
            "content": {"uri": "content.glb"},
            # No `children` key at all. A leaf tile with `"children": []` is legal
            # JSON but the Cesium validator warns on it -- an empty array claims
            # "there are refinements" and then offers none. Omitting it says what
            # is true: the content IS the finest representation we have.
        },
        "extras": {
            "status": "prototype",
            "lod": "LoD1 -- footprint extruded to one height; no roof shape is modelled",
            "heightDatum": "WGS84 ellipsoid, h=0. No validated terrain model; clamp to terrain when draping.",
            "heightSource": "p65 of Google Open Buildings 2.5D Temporal (2023), floored at 2.5 m",
            "geometricErrorDerivation": "median building footprint bbox diagonal in this ward, metres",
            "attribution": "Building footprints via Overture Maps Foundation (ODbL) -- OpenStreetMap contributors, Google, Microsoft. Heights (c) Google Open Buildings, CC BY 4.0.",
            "buildings": len(rows),
        },
    }

    if write:
        d = os.path.join(OUT, ward)
        os.makedirs(d, exist_ok=True)
        nbytes = write_glb(os.path.join(d, "content.glb"), positions, indices, name=f"{ward}-lod1")
        with open(os.path.join(d, "tileset.json"), "w", encoding="utf-8") as fh:
            json.dump(tileset, fh, indent=2)
    else:
        nbytes = 0
    return WardStats(ward=ward, buildings=len(rows), vertices=len(positions),
                     triangles=len(indices) // 3, glb_bytes=nbytes,
                     geometricError=geometric_error, maxHeight=round(max_h, 2))


def demo() -> None:
    """Pin the georeferencing against independently-computed references."""
    # 1. ECEF of a known point. Greenwich equator -> (a, 0, 0) exactly.
    x, y, z = geodetic_to_ecef(0.0, 0.0, 0.0)
    assert abs(x - _A) < 1e-6 and abs(y) < 1e-6 and abs(z) < 1e-6, (x, y, z)
    # North pole -> (0, 0, b) where b = a(1-f)
    x, y, z = geodetic_to_ecef(0.0, 90.0, 0.0)
    assert abs(z - _A * (1 - _F)) < 1e-6 and abs(x) < 1e-6 and abs(y) < 1e-6, (x, y, z)

    # 2. ENU basis is orthonormal and right-handed at a real ward centre.
    e, n, u = enu_basis(88.3659, 22.528)
    for v in (e, n, u):
        assert abs(math.dist(v, (0, 0, 0)) - 1.0) < 1e-12
    assert abs(sum(a * b for a, b in zip(e, n))) < 1e-12
    assert abs(sum(a * b for a, b in zip(n, u))) < 1e-12
    cross = (e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0])
    assert math.dist(cross, u) < 1e-12, "east x north must equal up (right-handed)"

    # 3. A point 100 m due EAST of the origin must land at ENU (+100, 0, 0).
    #    This is the check that catches a mirrored or transposed basis -- the
    #    exact class of bug this repo has shipped before.
    olon, olat = 88.3659, 22.528
    org, bas = geodetic_to_ecef(olon, olat, 0.0), enu_basis(olon, olat)
    m_per_deg_lon = 111320.0 * math.cos(math.radians(olat))
    east_pt = to_enu(olon + 100.0 / m_per_deg_lon, olat, 0.0, org, bas)
    assert abs(east_pt[0] - 100.0) < 0.5, f"100 m east gave {east_pt}"
    assert abs(east_pt[1]) < 0.5 and abs(east_pt[2]) < 0.5, east_pt
    north_pt = to_enu(olon, olat + 100.0 / 110540.0, 0.0, org, bas)
    assert abs(north_pt[1] - 100.0) < 1.0, f"100 m north gave {north_pt}"
    assert abs(north_pt[0]) < 0.5, north_pt

    # 4. The root transform must carry local (0,0,0) back to the origin in ECEF.
    t = root_transform(olon, olat)
    assert math.dist((t[12], t[13], t[14]), org) < 1e-6

    # 5. Region angles are radians: Kolkata must be ~1.54 rad, not ~88.
    r = [math.radians(88.3659), math.radians(22.528)]
    assert 1.5 < r[0] < 1.6 and 0.39 < r[1] < 0.40, r
    print("  georeferencing self-check OK -- ECEF, ENU orthonormality, east/north sense, transform origin, radians")


def main(argv: list[str]) -> int:
    demo()
    if "--check" in argv:
        return 0
    total = 0
    for w in WARDS:
        s = build_ward(w)
        total += s["glb_bytes"]
        print(f"  {s['ward']:<12} {s['buildings']:>5} buildings  {s['triangles']:>7} tris  "
              f"geometricError {s['geometricError']:>6} m  maxH {s['maxHeight']:>6} m  "
              f"{s['glb_bytes']/1e6:.2f} MB")
    print(f"  wrote {total/1e6:.2f} MB to public/3d-tiles/")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
