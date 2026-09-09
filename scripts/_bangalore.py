"""Shared vocabulary for the Bangalore ward pipeline.

WHY THIS IS SEPARATE FROM `_types.WARDS`, WHICH ALREADY HOLDS A WARD TABLE.
Measured before deciding: **41 scripts reference WARDS**, and a dozen of them
iterate `_types.WARDS.items()` with no city filter -- `_water.py:321`,
`build-provenance-manifest.py:223`, `compute-tra.py:191`, and so on. Adding three
Bengaluru wards to that dict would silently enlist every Kolkata thermal script
into work it has no data for. Four scripts also still carry private WARDS copies
(`_sentinel.py`, `compute-heights.py`, `ecostress-census.py`, `fetch-buildings.py`)
and three hard-code the ward tuple, so the registry is not yet one thing.

Making `WARDS` city-scoped is the right fix and it is specced -- see §10 of
`docs/superpowers/specs/2026-09-10-bangalore-obos-wards-design.md`. It is also a
refactor across 41 files, and the Blender scenes do not need it: they need
geometry, heights and terrain. So Bangalore stays self-contained here exactly as
Dubai does in `_flood.py`, and the registry merge happens once, deliberately,
when the solver port needs it.

THE FRAME. Site-local metres, x east / y north / z up. That is Blender's own
convention and the one the Kolkata footprints already use, so nothing is
transposed on the way into a scene. Getting y backwards mirrors every building
about the ward's centre line and still renders, which is how the Kolkata parity
run failed once and why `to_local` is written down once rather than per script.
"""
from __future__ import annotations

import math
import os
from typing import NamedTuple, TypedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")

#: Everything this pipeline writes. Kept out of `data/geometry/` so a Bangalore
#: artefact can never be picked up by a Kolkata script globbing that directory.
DATA = os.path.join(ROOT, "data", "bangalore")
SCENES = os.path.join(ROOT, "data", "bangalore", "scenes")

#: Pinned. Two 2026 releases exist on the bucket and a glob double-counts --
#: the same trap `fetch-buildings.py` documents for Kolkata.
OVERTURE_RELEASE = "2026-07-22.0"
OVERTURE_S3 = (f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}"
               "/theme=buildings/type=building/*")

#: Google Open Buildings 2.5D Temporal. The same collection Kolkata ships, so
#: the two cities' heights are comparable by construction.
GOOGLE_25D = "GOOGLE/Research/open-buildings-temporal/v1"

#: Where Google reports no confident pixel over a footprint. Google's own
#: convention, carried openly with `fill: true` rather than silently.
FILL_HEIGHT_M = 2.5

#: Below this a ring is a sliver, not a building.
MIN_RING_M2 = 4.0
#: Vertex tolerance in the LOCAL frame -- metres, not degrees.
SIMPLIFY_M = 0.5

#: Above this the two height sources are reported as disagreeing. NOT averaged
#: and NOT corrected: see §4 of the design spec. 5 m is roughly the p75 of the
#: measured |UT-GLOBUS - Google| difference at both cross-checked sites, so it
#: flags the tail rather than the bulk.
DISAGREE_M = 5.0


class LatLon(NamedTuple):
    lat: float
    lon: float


class Ward(NamedTuple):
    id: str
    name: str
    centre: LatLon
    size_m: float


#: The three wards, at the sizes and centres the design settled on.
#:
#: MG ROAD'S CENTRE IS NOT THE JUNCTION, AND THAT IS DELIBERATE. At the obvious
#: 77.6060 E the box ends at 77.5931 E and Vidhana Soudha -- the one building in
#: Bengaluru everybody recognises -- falls 271 m outside it. Re-measured at
#: 77.6030 E the box gains it and loses nothing: built fraction and both height
#: percentiles are identical to the first decimal, and it picks up 607 more
#: buildings. Every published MG Road figure is measured at this centre. Moving
#: it back would silently invalidate all of them.
WARDS: dict[str, Ward] = {
    "indiranagar": Ward("indiranagar", "Indiranagar", LatLon(12.9784, 77.6408), 2800.0),
    "mg-road":     Ward("mg-road", "MG Road / CBD", LatLon(12.9755, 77.6030), 2800.0),
    "whitefield":  Ward("whitefield", "Whitefield", LatLon(12.9698, 77.7500), 2800.0),
}


def m_per_deg(lat: float) -> tuple[float, float]:
    """(east, north) metres per degree, WGS-84 spherical approximation.

    Returned east-first to match the (lon, lat) ordering of every coordinate
    this pipeline touches. The two differ by ~3 % at Bengaluru's latitude, so
    transposing them yields a plausible wrong answer rather than an error.
    """
    return (111_320.0 * math.cos(math.radians(lat)), 110_540.0)


def bounds(w: Ward, pad_m: float = 0.0) -> tuple[float, float, float, float]:
    """(west, south, east, north) in EPSG:4326. rasterio's `from_bounds` order.

    Getting that order wrong reads the wrong window silently rather than
    raising, which is why this exists once rather than in each fetcher.
    """
    mx, my = m_per_deg(w.centre.lat)
    half = w.size_m / 2.0 + pad_m
    return (w.centre.lon - half / mx, w.centre.lat - half / my,
            w.centre.lon + half / mx, w.centre.lat + half / my)


def to_local(w: Ward, lon: float, lat: float) -> tuple[float, float]:
    """Degrees -> ward-local metres. +x east, +y NORTH."""
    mx, my = m_per_deg(w.centre.lat)
    return ((lon - w.centre.lon) * mx, (lat - w.centre.lat) * my)


def ring_area(p: list[float]) -> float:
    """Shoelace area of a flat [x0, y0, x1, y1, ...] ring, in square metres.

    Absolute, so winding order does not matter -- callers use this to reject
    slivers, not to decide orientation.
    """
    n = len(p) // 2
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        j = (i + 1) % n
        a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]
    return abs(a) / 2.0


def ring_centroid(p: list[float]) -> tuple[float, float]:
    """Area centroid of a flat ring, falling back to the vertex mean.

    THE FALLBACK IS NOT DEFENSIVE PADDING. A degenerate ring -- collinear
    vertices, or a duplicate-point polygon -- has zero shoelace area, and the
    area formula divides by it. Overture carries a few of these. The vertex mean
    is wrong by a metre or so on such a shape and correct enough to place it.
    """
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


# ── file contracts ──────────────────────────────────────────────────────────

class BlrBuilding(TypedDict):
    """One footprint in `data/bangalore/<ward>-buildings.json`.

    `p` is a FLAT ring in ward-local metres -- [x0, y0, x1, y1, ...] -- so it is
    reshaped (-1, 2), never zipped. `lonlat` is the same ring as [lon, lat]
    pairs: two representations of one polygon, kept because the pair is what let
    Kolkata's north-south mirror be settled numerically rather than by eye.

    `h` is the shipped height (Google 2.5D). `hUt` is the UT-GLOBUS cross-check
    where a tile covers the ward, and `flag` is set where the two differ by more
    than DISAGREE_M. The cross-check is NEVER blended into `h`.
    """
    gers: str
    p: list[float]
    lonlat: list[list[float]]
    h: float
    fill: bool
    hUt: float | None
    flag: bool


class BlrBuildingsFile(TypedDict):
    ward: str
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
    crossCheck: str
    b: list[BlrBuilding]


class BlrTerrainFile(TypedDict):
    ward: str
    sizeM: float
    n: int
    source: str
    minM: float
    maxM: float
    meanM: float
    #: Relief at GLO-30's NATIVE posting, before the bilinear downsample to `n`.
    #: Larger than maxM-minM by 2-4 m, measured. Both are correct for what they
    #: describe; quoting only the mesh range understates the terrain.
    reliefNativeM: float
    resampleNote: str
    #: Row-major, n*n, metres above the ellipsoid. Row 0 is the SOUTH edge, so
    #: the array reads the same way the local frame does (+y north). GLO-30
    #: rasters are north-up, so the reader must flip -- doing it here once is
    #: why the Dubai scene's N-S mirror cannot recur.
    h: list[float]
