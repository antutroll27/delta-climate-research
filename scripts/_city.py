"""Shared vocabulary for the cities AFTER Bengaluru (Amsterdam, then Tokyo).

WHY A NEW MODULE AND NOT A THIRD `_bangalore.py`. `_types.WARDS` is referenced by
41 Kolkata scripts and `_bangalore.py` owns the Bengaluru pipeline, whose Overture
release is gone from the bucket, so it can no longer be re-run to prove a refactor
harmless. Both stay FROZEN (see `check-existing-cities-unchanged.py`). What every
later city shares is the frame, the file contracts, the data directories and the
Overture context scan; what differs is only the height source and the DEM, which
live in small adapters (`_src_3dbag.py`, `_src_dem.py`, ...).

THE FRAME IS NOT REINVENTED. `m_per_deg`, `bounds`, `to_local`, `ring_area` and
`ring_centroid` are the same arithmetic as `_bangalore.py`, and the self-test
(`python3 scripts/_city.py`) is a PARITY ORACLE: it imports `_bangalore` and requires
the two modules to agree to 1e-9 m at every Bengaluru centre and on 25 further
points. A mirror renders perfectly and shows in no symmetric statistic, which is why
`to_local` exists once, written down, rather than once per script.

THE FRAME. Site-local metres, x east / y NORTH / z up. `p` in a building row is a
FLAT ring [x0, y0, x1, y1, ...]. Terrain is stored row 0 = SOUTH (so it reads the
way the frame does) and the browser exporter flips it, because `terrain.ts` reads
row 0 = NORTH.

THE LOCAL CRS IS THE SOURCE'S, NOT THE FRAME'S. `Area.local_crs` is the metric CRS
the open data are published in (EPSG:28992 RD New for the Netherlands). pyproj is
called with `always_xy=True` everywhere: EPSG:4326 is lat/lon by authority and
pyproj silently follows that unless told otherwise, which swaps every coordinate.

    python3 scripts/_city.py        # self-test
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass
from typing import Final, Literal, NamedTuple, NewType, NotRequired, TypedDict

from pyproj import CRS, Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))

CityId = Literal["amsterdam", "tokyo"]
#: A length in metres. A NewType, not an alias: `float` metres and `float` degrees
#: otherwise pass each other's type checks.
Metres = NewType("Metres", float)

#: The Overture Maps release every city after Bengaluru is built on. MEASURED present in the
#: bucket on 2026-11-06 (the bucket lists only 2026-09-23.0, 2026-09-23.1 and 2026-10-21.0).
#: Releases leave the bucket within about three months, so `_src_overture` caches the clipped
#: parquet the moment it is scanned. Bengaluru's own pin stays in `_bangalore.py`.
OVERTURE_RELEASE: Final = "2026-10-21.0"

#: The fill convention shared with Kolkata and Bengaluru (Google reports no
#: confident pixel -> 2.5 m, carried openly with `hSource: "fill"`).
FILL_HEIGHT_M = Metres(2.5)
#: Below this a ring is a sliver, not a building.
MIN_RING_M2 = 4.0
#: Vertex tolerance in the LOCAL frame -- metres, not degrees.
SIMPLIFY_M = Metres(0.5)
#: Above this the height cross-check flags a building. NEVER blended into `h`.
DISAGREE_M = Metres(5.0)

#: The solver's terrain mesh edge (Bengaluru's).
TERRAIN_N = 96


class LatLon(NamedTuple):
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Area:
    id: str
    city: CityId
    name: str
    centre: LatLon
    size_m: int
    #: EPSG code of the metric CRS the city's open data are published in.
    local_crs: int


#: Tokyo's area is added by Phase B (Task B2). One area per entry, ids globally unique.
AREAS: dict[str, Area] = {
    "canal-ring": Area("canal-ring", "amsterdam", "Canal Ring", LatLon(52.3640, 4.8850), 2800, 28992),
}


# ── locations ──────────────────────────────────────────────────────────────

#: Committed, processed artefacts (small JSON). Raw downloads NEVER go here.
def data_dir(city: CityId) -> str:
    return os.path.join(ROOT, "data", "cities", city)


#: Raw downloads. `~/.cache/delta-climate` is a symlink onto OBOSLab, so this is
#: not the internal disk; it is never committed.
def raw_dir(city: CityId) -> str:
    return os.path.join(os.path.expanduser("~"), ".cache", "delta-climate", "cities", city, "raw")


PUBLIC = os.path.join(ROOT, "public", "heat-map", "data")


# ── the frame (same maths as _bangalore.py; parity-tested) ─────────────────

def m_per_deg(lat: float) -> tuple[float, float]:
    """(east, north) metres per degree, spherical approximation. East first."""
    return (111_320.0 * math.cos(math.radians(lat)), 110_540.0)


def bounds(a: Area, pad_m: float = 0.0) -> tuple[float, float, float, float]:
    """(west, south, east, north) in EPSG:4326 -- rasterio's `from_bounds` order."""
    mx, my = m_per_deg(a.centre.lat)
    half = a.size_m / 2.0 + pad_m
    return (a.centre.lon - half / mx, a.centre.lat - half / my,
            a.centre.lon + half / mx, a.centre.lat + half / my)


def to_local(a: Area, lon: float, lat: float) -> tuple[float, float]:
    """Degrees -> area-local metres. +x east, +y NORTH."""
    mx, my = m_per_deg(a.centre.lat)
    return ((lon - a.centre.lon) * mx, (lat - a.centre.lat) * my)


def ring_area(p: list[float]) -> float:
    """Absolute shoelace area of a flat ring, m2. For rejecting slivers, not orientation."""
    n = len(p) // 2
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]
    return abs(s) / 2.0


def ring_centroid(p: list[float]) -> tuple[float, float]:
    """Area centroid of a flat ring; vertex mean for a degenerate (zero-area) ring."""
    n = len(p) // 2
    if n < 3:
        return (sum(p[0::2]) / max(1, n), sum(p[1::2]) / max(1, n))
    a = cx = cy = 0.0
    for i in range(n):
        j = (i + 1) % n
        cross = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]
        a += cross
        cx += (p[2 * i] + p[2 * j]) * cross
        cy += (p[2 * i + 1] + p[2 * j + 1]) * cross
    if abs(a) < 1e-9:
        return (sum(p[0::2]) / n, sum(p[1::2]) / n)
    return (cx / (3.0 * a), cy / (3.0 * a))


def transformer_to_local_crs(a: Area) -> Transformer:
    """EPSG:4326 (lon, lat) -> the area's metric CRS (x, y). `always_xy`: the axis-order trap."""
    return Transformer.from_crs(4326, a.local_crs, always_xy=True)


def transformer_from_local_crs(a: Area) -> Transformer:
    """The area's metric CRS (x, y) -> EPSG:4326 (lon, lat)."""
    return Transformer.from_crs(a.local_crs, 4326, always_xy=True)


def bounds_local_crs(a: Area, pad_m: float = 0.0) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) in the source CRS covering the frame's box plus `pad_m`.

    The frame's box is a rectangle in degrees; in RD New it is a slightly rotated
    quadrilateral (grid convergence), so the CORNERS are projected and enveloped --
    never just the south-west and north-east pair.
    """
    w, s, e, n = bounds(a, pad_m)
    t = transformer_to_local_crs(a)
    pts = [t.transform(x, y) for x, y in ((w, s), (e, s), (w, n), (e, n))]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


# ── file contracts (TypedDict at the JSON boundary ONLY) ───────────────────

HSource = Literal["3dbag-p70", "plateau-measured", "plateau-lod1", "fill"]


class CityBuilding(TypedDict):
    """One footprint in `data/cities/<city>/<area>-buildings.json`.

    `p` is a FLAT local-frame ring (reshape (-1, 2), never zip). `lonlat` is the
    same ring in [lon, lat]: two representations of one polygon, kept because the
    pair is what lets a mirror be settled by numbers (guard G2). `hCheck` is an
    independent height (AHN nDSM) where one exists; `flag` is set where it differs
    by more than DISAGREE_M. It is NEVER blended into `h`.
    """
    src_id: str
    p: list[float]
    lonlat: list[list[float]]
    h: float
    hSource: HSource
    quality: bool
    hCheck: float | None
    flag: bool


class CityBuildingsFile(TypedDict):
    city: str
    area: str
    name: str
    centre: list[float]
    sizeM: float
    release: str
    retrieved: str
    count: int
    source: str
    heightSource: str
    heightNote: str
    fillFraction: float
    heightTiers: dict[str, int]
    #: Count of buildings by point-cloud source and acquisition year, e.g. {"ahn5-2023": 20000}.
    pointCloudMix: dict[str, int]
    crossCheck: str
    b: list[CityBuilding]


class CityTerrainFile(TypedDict):
    city: str
    area: str
    sizeM: float
    n: int
    source: str
    datum: str
    minM: float
    maxM: float
    meanM: float
    #: Relief at the DEM's NATIVE posting, before the area-average resample to `n`.
    reliefNativeM: float
    resampleNote: str
    #: Row-major, n*n, metres. Row 0 is the SOUTH edge (see the module header).
    h: list[float]


class CityWater(TypedDict):
    """A water feature: a polygon (`p`) OR an open centreline (`line` + `covered`), as Bengaluru's context."""
    cls: str
    p: NotRequired[list[float]]
    line: NotRequired[list[float]]
    covered: NotRequired[bool]


class CityGreen(TypedDict):
    cls: str
    p: list[float]


class CityRoad(TypedDict):
    cls: str
    line: list[float]


class CityContextFile(TypedDict):
    city: str
    area: str
    sizeM: float
    release: str
    source: str
    water: list[CityWater]
    green: list[CityGreen]
    roads: list[CityRoad]


class CityTree(TypedDict):
    x: float
    y: float
    h: float
    r: float
    species: str


class CityCanopyFile(TypedDict):
    city: str
    area: str
    sizeM: float
    grid: int
    source: str
    method: str
    densityRefM: float
    minTreeH: float
    #: share of 1 m CHM pixels at or above `coverThresholdM` over the whole square
    coverFrac: float
    coverThresholdM: float
    candidates: int
    droppedInBuildings: int
    droppedInRoads: int
    count: int
    trees: list[CityTree]


# ── self-test ──────────────────────────────────────────────────────────────

def _self_test() -> None:
    """(a) parity with _bangalore, (b) sign test, (c) CRS names, (d) round trips."""
    sys.path.insert(0, HERE)
    import _bangalore as blr                       # noqa: E402  (parity oracle only)

    # (a) PARITY ORACLE: every Bengaluru centre plus a 5 x 5 lattice of points.
    worst = 0.0
    checked = 0
    for bw in blr.WARDS.values():
        ca = Area(bw.id, "amsterdam", bw.name, LatLon(bw.centre.lat, bw.centre.lon), int(bw.size_m), 28992)
        for pad in (0.0, 50.0):
            ours, theirs = bounds(ca, pad), blr.bounds(bw, pad)
            worst = max(worst, max(abs(o - t) for o, t in zip(ours, theirs, strict=True)))
        for i in range(5):
            for j in range(5):
                lon = bw.centre.lon + (i - 2) * 0.004
                lat = bw.centre.lat + (j - 2) * 0.004
                ox, oy = to_local(ca, lon, lat)
                bx, by = blr.to_local(bw, lon, lat)
                worst = max(worst, abs(ox - bx), abs(oy - by))
                checked += 1
        assert m_per_deg(bw.centre.lat) == blr.m_per_deg(bw.centre.lat)
    # the same oracle on the other helpers, with one fixed ring
    ring = [0.0, 0.0, 10.0, 0.0, 10.0, 6.0, 0.0, 6.0]
    assert ring_area(ring) == blr.ring_area(ring) == 60.0
    assert ring_centroid(ring) == blr.ring_centroid(ring) == (5.0, 3.0)
    sliver = [0.0, 0.0, 1.0, 0.0, 2.0, 0.0]
    assert ring_centroid(sliver) == blr.ring_centroid(sliver)
    # metres here are metres of frame: 1e-9 m is the contract, in degrees terms ~1e-14.
    assert worst < 1e-9, f"frame drifted from _bangalore by {worst} m"

    # (b) SIGN TEST: the north-east corner of the box is (+half, +half); south-west (-half, -half).
    for a in AREAS.values():
        w, s, e, n = bounds(a)
        half = a.size_m / 2.0
        ne = to_local(a, e, n)
        sw = to_local(a, w, s)
        assert abs(ne[0] - half) < 1e-6 and abs(ne[1] - half) < 1e-6, (a.id, ne)
        assert abs(sw[0] + half) < 1e-6 and abs(sw[1] + half) < 1e-6, (a.id, sw)
        assert abs(to_local(a, a.centre.lon, a.centre.lat)[0]) < 1e-12

        # (d) the source CRS round-trips and 'north' is still north in it
        fwd, inv = transformer_to_local_crs(a), transformer_from_local_crs(a)
        x, y = fwd.transform(a.centre.lon, a.centre.lat)
        lon2, lat2 = inv.transform(x, y)
        assert abs(lon2 - a.centre.lon) < 1e-8 and abs(lat2 - a.centre.lat) < 1e-8
        _, y_north = fwd.transform(a.centre.lon, a.centre.lat + 0.001)
        _, y_south = fwd.transform(a.centre.lon, a.centre.lat - 0.001)
        assert y_north > y > y_south, "northing must increase northward (always_xy / axis-order guard)"
        mnx, mny, mxx, mxy = bounds_local_crs(a)
        assert mnx < x < mxx and mny < y < mxy
        # the envelope of a 2.8 km box is wider than 2.8 km (rotated quadrilateral), but not by much
        assert a.size_m <= (mxx - mnx) < a.size_m * 1.02, (mxx - mnx)

    # (c) CRS names resolve to what the plan says they are.
    assert CRS.from_epsg(28992).name == "Amersfoort / RD New"
    assert "Japan Plane Rectangular CS IX" in CRS.from_epsg(6677).name, CRS.from_epsg(6677).name
    assert CRS.from_epsg(6697).is_geographic
    assert all(a.local_crs in (28992, 6677) for a in AREAS.values())
    assert len({a.id for a in AREAS.values()}) == len(AREAS)

    print(f"_city self-test: ok -- parity with _bangalore to {worst:.2e} m over {checked} lattice points + "
          f"{len(blr.WARDS)} centres x2 pads; sign test and CRS round trips pass for {len(AREAS)} area(s); "
          f"EPSG:28992 = {CRS.from_epsg(28992).name!r}, EPSG:6677 = {CRS.from_epsg(6677).name!r}")


if __name__ == "__main__":
    _self_test()
