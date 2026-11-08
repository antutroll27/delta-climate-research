"""The sheet table: Amsterdam's whole-city streaming lattice (city-streaming phase P1, graticule rework).

A SHEET is Canal Ring's own lon/lat box, repeated across the city. The lattice is a GRATICULE, not the
RD New grid: sheet (i, j) is the box

    lon in [LON0 + (i - 1/2) * dLon, LON0 + (i + 1/2) * dLon)      lat likewise with j, dLat

where (LON0, LAT0) is Canal Ring's centre and dLon, dLat are the width and height of
`_city.bounds(AREAS["canal-ring"])`. So E4 = (0, 0) IS Canal Ring's box, bit for bit, and every other
sheet is a translation of it. The frame's standard parallel is E4's latitude for EVERY sheet (`frameLat`),
so two sheets' local frames differ by an exact translation of (2800 di, 2800 dj) local metres: seams are
shared meridians and parallels, with no gap, no overlap and no sideways shift. Nothing rotates. RD New
(EPSG:28992) stays the INGEST CRS only: 3D BAG and the stadsdelen arrive in it, and `rdQuad` records where
each sheet's four corners fall in it (informational: a sheet is not an RD square, it is a slightly turned
quadrilateral there). See /Volumes/OBOSLab/research/city-streaming/P1-AUDIT.md section 2.

LOCAL-METRE SCALE. The frame carries a +0.66 % north-south offset (110,540 m/deg against a true
~111,270 at 52.4 N) in every city today, and a sheet's true east-west size varies +-0.17 % with its row
(2,801 m in row 1 to 2,811 m in row 7 on the ground). Both are scale offsets of the local metre, not seam
errors. DO NOT "fix" the 110,540: that would re-cut Canal Ring and every live ward.

This module owns the lattice maths and the committed table that every other consumer reads:

    data/cities/amsterdam/sheets.json      the artefact (small, committed)
    src/data/sheets/amsterdam.ts           GENERATED from it, `as const`, so the scope registry's
                                           AreaKey keeps exact literal types. A JSON import widens
                                           every id to `string`; a generated literal does not.

Python emits, TypeScript reads, and a test pins the two (the instrument-and-laboratory rule).

    python3 scripts/_sheets.py --self-test      # pure maths, no data
    python3 scripts/_sheets.py --check          # committed table: shape, rule, G9b lattice, E4 == Canal Ring, TS == JSON
    python3 scripts/_sheets.py --g9a            # G9a partition against the downloaded 3D BAG tiles (local only);
                                                # also requires the recorded exact counts to equal the recount
    taskpolicy -b python3 scripts/_sheets.py --emit [--fetch]
                                                # local: rebuild both files from the raw cache (exact counts)

ADDRESSING. Code = column letter A-J (west to east) + row 1-7 (north to south), as on a
topographic sheet index. Area id = `ams-<code>` ("ams-f4"); E4 keeps `canal-ring`.

THE BUILDING COUNTS ARE EXACT (phase P2a; P1's `buildingsEst` was a tile-index estimate and is gone). Every
3D BAG v20250903 building in the 227 downloaded city tiles is assigned, once (a building listed by two tiles
counts once, as in ingest), to the sheet whose HALF-OPEN WGS84 box holds its footprint centroid (the same
pyproj operation as ingest, G9a). Two numbers per sheet:

    buildings           every building whose centroid is in the box: what the sheet carries (D9: those outside
                        the municipality are drawn dimmed, as context)
    municipalBuildings  those whose centroid is ALSO inside the municipality (the union of the nine current
                        stadsdelen): the number the ship rule reads

SHIP RULE (founder D1: every sheet that passes, not a fixed number): at least 500 MUNICIPAL buildings. CORE = at
least 2,000 municipal buildings, else EDGE. (Phase P2b dropped the earlier extra condition "and at least 10 % of the
sheet's area inside the municipality": it wrongly dropped B5, 1,279 municipal buildings on 4.2 % of its area, a
sheet holding more buildings than five shipping edge sheets. `municipalShare` is still recorded, as information.)
The decisions are taken on the numbers the table records, so `--check` re-derives them without any raw data.

STADSDEEL. The name beside the code is the stadsdeel holding the largest share of the sheet's
municipal area. Gemeente Amsterdam's Kernregistratie gebieden is CC0 1.0 (see
docs/evidence/2026-11-07-amsterdam-stadsdelen-licence.md), so the names are shown. No geometry
from that source is redistributed.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import shutil
import sqlite3
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Literal, NamedTuple, NewType, TypedDict, cast

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402
import _src_3dbag as bag  # noqa: E402

Kind = Literal["core", "edge"]
SkipReason = Literal["under-500-buildings"]
#: "F4". A NewType, not an alias: a bare string is also an id and a stadsdeel.
SheetCode = NewType("SheetCode", str)
#: "ams-f4", or "canal-ring" for E4.
SheetId = NewType("SheetId", str)

CITY: Final = "amsterdam"
SIZE_M: Final = 2800
#: Canal Ring is the anchor: sheet E4, lattice cell (0, 0), and its box IS the lattice cell.
_ANCHOR_AREA: Final = _city.AREAS["canal-ring"]
#: The standard parallel of EVERY sheet's frame (the one new frame parameter, plumbed in phase P2).
FRAME_LAT: Final = _ANCHOR_AREA.centre.lat
LON0: Final = _ANCHOR_AREA.centre.lon
M_PER_DEG_LON: Final = _city.m_per_deg(FRAME_LAT)[0]
M_PER_DEG_LAT: Final = _city.m_per_deg(FRAME_LAT)[1]
#: Half a sheet in degrees, computed EXACTLY as `_city.bounds` computes it (half / m-per-deg), and the width
#: as its exact double, so edge(0) and edge(1) reproduce Canal Ring's west and east to the last bit.
_HALF_LON: Final = (SIZE_M / 2.0) / M_PER_DEG_LON
_HALF_LAT: Final = (SIZE_M / 2.0) / M_PER_DEG_LAT
D_LON: Final = 2.0 * _HALF_LON
D_LAT: Final = 2.0 * _HALF_LAT
#: The solver grid of one sheet (the admitted pair 384 over 2,800 m) and the halo P0 chose (60 cells = 437.5 m, a 4x margin at
#: the production calm floor): the solve grid is 384 + 2 x 60 = 504 over 3,675 m. G9d works on exactly these cells.
GRID_N: Final = 384
HALO_CELLS: Final = 60
CELL_M: Final = SIZE_M / GRID_N
#: G9c: two frames' images of one seam point differ by exactly one sheet, within a millimetre; G9d: matching cell corners, degrees.
G9C_POINTS: Final = 1000
G9C_TOLERANCE_M: Final = 1e-3
G9D_TOLERANCE_DEG: Final = 1e-9
COLUMNS: Final = "ABCDEFGHIJ"
ROWS: Final = 7
#: Lattice index of column A and of row 1. Canal Ring (E4) is (0, 0) by construction.
I_COLUMN_A: Final = -4
J_ROW_1: Final = 3
ANCHOR_CODE: Final = SheetCode("E4")
ANCHOR_ID: Final = SheetId("canal-ring")
ANCHOR_NAME: Final = "Canal Ring"

SHIP_MIN_BUILDINGS: Final = 500
CORE_MIN_BUILDINGS: Final = 2000

JSON_REL: Final = os.path.join("data", "cities", CITY, "sheets.json")
TS_REL: Final = os.path.join("src", "data", "sheets", f"{CITY}.ts")
RELEASE: Final = "v20250903"
STADSDELEN_FILE: Final = "stadsdelen.json"
STADSDELEN_URL: Final = "https://api.data.amsterdam.nl/v1/gebieden/stadsdelen/?_format=json&_pageSize=100"
#: Densification of a sheet's edges when it is projected into RD to intersect the municipality (points per side).
RD_EDGE_POINTS: Final = 16
#: The downloaded 3D BAG tiles of the whole municipality (local cache, never committed).
BAG_CITY_DIR: Final = os.path.join(os.path.expanduser("~"), ".cache", "delta-climate", "cities", CITY, "raw", "city", "3dbag")
#: The centroid table read from those tiles (ids + RD centroids), cached so a recount takes seconds, not minutes.
CENTROID_CACHE: Final = os.path.join(os.path.dirname(BAG_CITY_DIR), f"centroids-{RELEASE}.npz")
USER_AGENT: Final = "obos-pipeline/1.0 (+https://deltaclimate.earth)"


# ── lattice maths ──────────────────────────────────────────────────────────

def code_of(i: int, j: int) -> SheetCode:
    """(i, j) -> "F4". Raises outside the A-J x 1-7 index."""
    col, row = i - I_COLUMN_A, J_ROW_1 - j + 1
    if not (0 <= col < len(COLUMNS) and 1 <= row <= ROWS):
        raise ValueError(f"lattice cell ({i}, {j}) is outside the sheet index")
    return SheetCode(f"{COLUMNS[col]}{row}")


def ij_of(code: str) -> tuple[int, int]:
    """"F4" -> (i, j). The exact inverse of `code_of`."""
    if len(code) != 2 or code[0] not in COLUMNS or not code[1].isdigit() or not 1 <= int(code[1]) <= ROWS:
        raise ValueError(f"{code!r} is not a sheet code (column A-J + row 1-{ROWS})")
    return COLUMNS.index(code[0]) + I_COLUMN_A, J_ROW_1 - (int(code[1]) - 1)


def id_of(code: SheetCode) -> SheetId:
    return ANCHOR_ID if code == ANCHOR_CODE else SheetId(f"ams-{code.lower()}")


def lon_edge(k: int) -> float:
    """The k-th meridian of the lattice. ONE formula for every sheet: the east edge of column i and the west
    edge of column i + 1 are both lon_edge(i + 1), so a shared edge is the same float, not two that agree.
    (k - 0.5) is exact, and 0.5 * D_LON is exactly Canal Ring's half-width in degrees."""
    return LON0 + (k - 0.5) * D_LON


def lat_edge(k: int) -> float:
    """The k-th parallel. See `lon_edge`."""
    return FRAME_LAT + (k - 0.5) * D_LAT


def geo_bounds(i: int, j: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) in EPSG:4326, the sheet's half-open box [west, east) x [south, north)."""
    return (lon_edge(i), lat_edge(j), lon_edge(i + 1), lat_edge(j + 1))


def centre_lat_lon(i: int, j: int) -> tuple[float, float]:
    """The sheet's frame origin: Canal Ring's centre translated by (i, j) whole sheets."""
    return (FRAME_LAT + j * D_LAT, LON0 + i * D_LON)


def cell_of_point(lon: float, lat: float) -> tuple[int, int]:
    """The (i, j) whose half-open box holds the point. Exact: the guess is corrected against the edges."""
    i, j = math.floor((lon - lon_edge(0)) / D_LON), math.floor((lat - lat_edge(0)) / D_LAT)
    while lon < lon_edge(i):
        i -= 1
    while lon >= lon_edge(i + 1):
        i += 1
    while lat < lat_edge(j):
        j -= 1
    while lat >= lat_edge(j + 1):
        j += 1
    return (i, j)


def _to_rd() -> Transformer:
    return Transformer.from_crs(4326, 28992, always_xy=True)


def rd_quad(i: int, j: int) -> list[float]:
    """The four corners in RD metres, rounded to 0.1 m: SW, SE, NE, NW as x, y pairs. INFORMATIONAL: a sheet
    is a graticule box, so in RD it is a quadrilateral turned about 0.4 degrees, not a 2.8 km RD square."""
    w, s_, e, n = geo_bounds(i, j)
    t = _to_rd()
    out: list[float] = []
    for lon, lat in ((w, s_), (e, s_), (e, n), (w, n)):
        x, y = t.transform(lon, lat)
        out += [round(x, 1), round(y, 1)]
    return out


def rd_polygon(i: int, j: int, per_side: int = RD_EDGE_POINTS) -> Polygon:
    """The sheet's box projected into RD with each edge densified, for intersecting RD-delivered data."""
    w, s_, e, n = geo_bounds(i, j)
    t = _to_rd()
    pts: list[tuple[float, float]] = []
    for k in range(per_side):
        pts.append((w + (e - w) * k / per_side, s_))
    for k in range(per_side):
        pts.append((e, s_ + (n - s_) * k / per_side))
    for k in range(per_side):
        pts.append((e - (e - w) * k / per_side, n))
    for k in range(per_side):
        pts.append((w, n - (n - s_) * k / per_side))
    return Polygon([t.transform(x, y) for x, y in pts])


def kind_of(buildings: int) -> Kind:
    return "core" if buildings >= CORE_MIN_BUILDINGS else "edge"


def skip_reason(municipal_buildings: int) -> SkipReason | None:
    """None when the sheet ships; else the rule it fails."""
    return "under-500-buildings" if municipal_buildings < SHIP_MIN_BUILDINGS else None


# ── the table (typed at the JSON boundary) ─────────────────────────────────

class Centre(TypedDict):
    lat: float
    lon: float


class SheetRow(TypedDict):
    id: str
    code: str
    i: int
    j: int
    kind: Kind
    buildings: int
    municipalBuildings: int
    municipalShare: float
    stadsdeel: str
    label: str
    wgs84Bounds: list[float]
    rdQuad: list[float]
    centre: Centre
    #: The standard parallel of this sheet's frame: E4's latitude for EVERY sheet (S5: stated on the record, so a
    #: consumer never falls back to the sheet's own latitude, which puts a seam up to 4.8 m off).
    frameLat: float


class SkippedRow(TypedDict):
    code: str
    i: int
    j: int
    buildings: int
    municipalBuildings: int
    municipalShare: float
    reason: SkipReason


class Totals(TypedDict):
    shipping: int
    core: int
    edge: int
    skipped: int
    buildingsShipping: int
    municipalBuildingsShipping: int
    municipalBuildingsSkipped: int
    municipalBuildingsCity: int


class SheetTable(TypedDict):
    city: str
    lattice: dict[str, object]
    shipRule: dict[str, object]
    method: str
    sources: list[str]
    sheets: list[SheetRow]
    skipped: list[SkippedRow]
    totals: Totals


@dataclass(frozen=True, slots=True)
class Candidate:
    """One lattice cell that touches the municipality, before the ship rule."""
    i: int
    j: int
    buildings: int
    municipal: int
    share: float
    stadsdeel: str


def label_of(code: SheetCode, stadsdeel: str) -> str:
    return f"{code} · {ANCHOR_NAME if code == ANCHOR_CODE else stadsdeel}"


class CellCount(NamedTuple):
    """Exact counts for one lattice cell: every building with its centroid in the box, and those also municipal."""
    buildings: int
    municipal: int


F64 = np.ndarray[tuple[int], np.dtype[np.float64]]
I64 = np.ndarray[tuple[int], np.dtype[np.int64]]
BoolArr = np.ndarray[tuple[int], np.dtype[np.bool_]]
F64x4 = np.ndarray[tuple[int, int, int, int], np.dtype[np.float64]]


def cells_of(lon: F64, lat: F64) -> tuple[I64, I64]:
    """Vectorised `cell_of_point`: the (i, j) of each point's half-open box. The same formula, the same float
    operations, then corrected against the edges, so it agrees with the scalar function bit for bit."""
    i = np.floor((lon - lon_edge(0)) / D_LON).astype(np.int64)
    j = np.floor((lat - lat_edge(0)) / D_LAT).astype(np.int64)
    for _ in range(4):
        i = np.where(lon < LON0 + (i - 0.5) * D_LON, i - 1, i)
        i = np.where(lon >= LON0 + (i + 0.5) * D_LON, i + 1, i)
        j = np.where(lat < FRAME_LAT + (j - 0.5) * D_LAT, j - 1, j)
        j = np.where(lat >= FRAME_LAT + (j + 0.5) * D_LAT, j + 1, j)
    return i, j


def count_cells(lon: F64, lat: F64, municipal: BoolArr) -> dict[tuple[int, int], CellCount]:
    """Exact per-cell counts: each point lands in exactly one half-open box."""
    i, j = cells_of(lon, lat)
    keys, inverse = np.unique(np.column_stack([i, j]), axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    total = np.bincount(inverse, minlength=len(keys))
    muni = np.bincount(inverse, weights=municipal.astype(np.float64), minlength=len(keys))
    return {(int(k[0]), int(k[1])): CellCount(int(t), int(round(m))) for k, t, m in zip(keys, total, muni, strict=True)}


def candidates(counts: dict[tuple[int, int], CellCount], districts: dict[str, BaseGeometry]) -> list[Candidate]:
    """The lattice cells that touch the municipality, with their exact counts, municipal share and stadsdeel."""
    municipality = unary_union(list(districts.values()))
    out: list[Candidate] = []
    for j in range(J_ROW_1, J_ROW_1 - ROWS, -1):
        for i in range(I_COLUMN_A, I_COLUMN_A + len(COLUMNS)):
            sheet = rd_polygon(i, j)
            inside = sheet.intersection(municipality)
            if inside.area <= 0.0:
                continue
            shares = {name: sheet.intersection(g).area for name, g in districts.items()}
            c = counts.get((i, j), CellCount(0, 0))
            out.append(Candidate(i, j, c.buildings, c.municipal, round(inside.area / sheet.area, 3),
                                 max(shares, key=lambda n: shares[n])))
    return out


def lattice_dict() -> dict[str, object]:
    return {"kind": "graticule", "ingestCrs": "EPSG:28992", "sizeM": SIZE_M, "frameLat": FRAME_LAT,
            "mPerDegLon": M_PER_DEG_LON, "mPerDegLat": M_PER_DEG_LAT, "dLon": D_LON, "dLat": D_LAT,
            "anchorBox": list(geo_bounds(0, 0)), "columns": COLUMNS, "rows": ROWS,
            "iOfColumnA": I_COLUMN_A, "jOfRow1": J_ROW_1,
            "anchor": {"code": ANCHOR_CODE, "id": ANCHOR_ID, "centre": {"lat": FRAME_LAT, "lon": LON0}}}


def build_table(cands: list[Candidate]) -> SheetTable:
    sheets: list[SheetRow] = []
    skipped: list[SkippedRow] = []
    for c in cands:
        code = code_of(c.i, c.j)
        reason = skip_reason(c.municipal)
        if reason is not None:
            skipped.append(SkippedRow(code=code, i=c.i, j=c.j, buildings=c.buildings, municipalBuildings=c.municipal,
                                      municipalShare=c.share, reason=reason))
            continue
        lat, lon = centre_lat_lon(c.i, c.j)
        sheets.append(SheetRow(
            id=id_of(code), code=code, i=c.i, j=c.j, kind=kind_of(c.municipal),
            buildings=c.buildings, municipalBuildings=c.municipal, municipalShare=c.share, stadsdeel=c.stadsdeel,
            label=label_of(code, c.stadsdeel), wgs84Bounds=list(geo_bounds(c.i, c.j)),
            rdQuad=rd_quad(c.i, c.j), centre=Centre(lat=lat, lon=lon), frameLat=FRAME_LAT))
    core = sum(1 for s in sheets if s["kind"] == "core")
    return SheetTable(
        city=CITY,
        lattice=lattice_dict(),
        shipRule={"minBuildings": SHIP_MIN_BUILDINGS, "coreMinBuildings": CORE_MIN_BUILDINGS},
        method=("buildings = EXACT count of unique 3D BAG " + RELEASE + " buildings whose footprint centroid (RD, "
                "projected to WGS84 as ingest does) lies in the sheet's half-open lon/lat box; municipalBuildings = "
                "those also inside the union of the nine current stadsdelen, the number the ship rule reads. "
                "municipalShare = share of "
                "the sheet inside that union. stadsdeel = largest share of the sheet. "
                "frameLat = the standard parallel of every sheet's frame (E4's latitude); "
                "wgs84Bounds = the sheet's own lon/lat box (Canal Ring's, repeated); rdQuad = its four corners in "
                "RD New, informational."),
        sources=["3D BAG " + RELEASE + " BAG3D:tiles (CC BY 4.0, 3DBAG by tudelft3d and 3DGI)",
                 "Gemeente Amsterdam, Kernregistratie gebieden, stadsdelen (CC0 1.0)"],
        sheets=sheets, skipped=skipped,
        totals=Totals(shipping=len(sheets), core=core, edge=len(sheets) - core, skipped=len(skipped),
                      buildingsShipping=sum(s["buildings"] for s in sheets),
                      municipalBuildingsShipping=sum(s["municipalBuildings"] for s in sheets),
                      municipalBuildingsSkipped=sum(s["municipalBuildings"] for s in skipped),
                      municipalBuildingsCity=sum(c.municipal for c in cands)))


# ── rendering (deterministic: the check compares bytes) ────────────────────

def _row(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(", ", ": "))


def render_json(t: SheetTable) -> str:
    lines = ["{"]
    for key in ("city", "lattice", "shipRule", "method", "sources"):
        lines.append(f'  "{key}": {_row(t[key])},')
    lines.append('  "sheets": [\n' + ",\n".join(f"    {_row(r)}" for r in t["sheets"]) + "\n  ],")
    lines.append('  "skipped": [\n' + ",\n".join(f"    {_row(r)}" for r in t["skipped"]) + "\n  ],")
    lines.append(f'  "totals": {_row(t["totals"])}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def _q(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render_ts(t: SheetTable) -> str:
    """The generated module. `as const` throughout: the registry derives AreaKey from it."""
    out = [
        "/* GENERATED by scripts/_sheets.py --emit from data/cities/amsterdam/sheets.json. DO NOT EDIT.",
        "   tests/unit/amsterdam-sheets.test.mjs and `python3 scripts/_sheets.py --check` hold this file",
        "   byte-equal to what the generator renders from the JSON. `as const` is the point: the scope registry",
        "   spreads AMSTERDAM_SHEET_AREAS into its literal, and AreaKey stays an exact union of ids. */",
        "",
        "export const AMSTERDAM_SHEET_LATTICE = {",
        f"  kind: 'graticule', ingestCrs: 'EPSG:28992', sizeM: {SIZE_M}, frameLat: {FRAME_LAT!r},",
        f"  mPerDegLon: {M_PER_DEG_LON!r}, mPerDegLat: {M_PER_DEG_LAT!r}, dLon: {D_LON!r}, dLat: {D_LAT!r},",
        f"  anchorBox: {_row(list(geo_bounds(0, 0)))}, columns: {_q(COLUMNS)}, rows: {ROWS},",
        f"  iOfColumnA: {I_COLUMN_A}, jOfRow1: {J_ROW_1},",
        f"  anchor: {{ code: {_q(ANCHOR_CODE)}, id: {_q(ANCHOR_ID)}, centre: {{ lat: {FRAME_LAT!r}, lon: {LON0!r} }} }},",
        "} as const;",
        "",
        "/** Shipping sheets, in reading order (row 1 to 7, column A to J). */",
        "export const AMSTERDAM_SHEETS = [",
    ]
    for s in t["sheets"]:
        out.append(
            f"  {{ id: {_q(s['id'])}, code: {_q(s['code'])}, i: {s['i']}, j: {s['j']}, kind: {_q(s['kind'])}, "
            f"buildings: {s['buildings']}, municipalBuildings: {s['municipalBuildings']}, municipalShare: {s['municipalShare']}, "
            f"stadsdeel: {_q(s['stadsdeel'])}, label: {_q(s['label'])}, wgs84Bounds: {_row(s['wgs84Bounds'])}, "
            f"rdQuad: {_row(s['rdQuad'])}, centre: {{ lat: {s['centre']['lat']}, lon: {s['centre']['lon']} }}, frameLat: {s['frameLat']!r} }},")
    out += ["] as const;", "",
            "/** The ids alone (E4 included), so the registry's invariant check can read membership without the table's weight. */",
            "export const AMSTERDAM_SHEET_IDS = [" + ", ".join(_q(s["id"]) for s in t["sheets"]) + "] as const;", "",
            "/** Lattice cells that touch the municipality but do not ship, with the rule each failed. */",
            "export const AMSTERDAM_SKIPPED_SHEETS = ["]
    for k in t["skipped"]:
        out.append(f"  {{ code: {_q(k['code'])}, i: {k['i']}, j: {k['j']}, buildings: {k['buildings']}, "
                   f"municipalBuildings: {k['municipalBuildings']}, municipalShare: {k['municipalShare']}, reason: {_q(k['reason'])} }},")
    out += [
        "] as const;", "",
        "/* The registry's area entries for every sheet EXCEPT E4, which is `canal-ring` and is written by hand in",
        "   registry.ts so that its live behaviour cannot change. `drawable: false` keeps all of these off every",
        "   route, sitemap and switcher; `sheet: true` keeps them out of the per-city area lists. Names and",
        "   descriptors are NOT here: since city-streaming P2c every sheet has a row in the ward table",
        "   (src/data/sheets/amsterdam-areas.ts, spread into cities.ts), and resolve() refuses an area that names itself in both places. */",
        "export const AMSTERDAM_SHEET_AREAS = {",
    ]
    for s in t["sheets"]:
        if s["id"] == ANCHOR_ID:
            continue
        out.append(f"  {_q(s['id'])}: {{ shipsData: false, drawable: false, sheet: true }},")
    out += ["} as const;", ""]
    return "\n".join(out)


# ── checks on the committed table (CI has no raw data) ─────────────────────

def load_table(root: str = _city.ROOT) -> SheetTable:
    with open(os.path.join(root, JSON_REL), encoding="utf-8") as fh:
        return cast("SheetTable", json.load(fh))


def check_lattice(t: SheetTable) -> list[str]:
    """G9b: the lattice. Every sheet's box is recomputed from its integer (i, j) with the one formula, the shared
    edges of every adjacent pair are BIT-EQUAL floats, and E4's box is bit-equal to Canal Ring's own."""
    bad: list[str] = []
    boxes: dict[tuple[int, int], list[float]] = {}
    for s in t["sheets"]:
        boxes[(s["i"], s["j"])] = s["wgs84Bounds"]
        if tuple(s["wgs84Bounds"]) != geo_bounds(s["i"], s["j"]):
            bad.append(f"G9b {s['code']}: wgs84Bounds are not the lattice formula's box for ({s['i']}, {s['j']})")
        w, so, e, n = s["wgs84Bounds"]
        if not (w < e and so < n):
            bad.append(f"G9b {s['code']}: degenerate box")
    for (i, j), b in boxes.items():
        east = boxes.get((i + 1, j))
        if east is not None and not (b[2] == east[0] and b[1] == east[1] and b[3] == east[3]):
            bad.append(f"G9b ({i}, {j}) | ({i + 1}, {j}): the shared meridian or the parallels are not bit-equal")
        north = boxes.get((i, j + 1))
        if north is not None and not (b[3] == north[1] and b[0] == north[0] and b[2] == north[2]):
            bad.append(f"G9b ({i}, {j}) / ({i}, {j + 1}): the shared parallel or the meridians are not bit-equal")
    anchor = boxes.get((0, 0))
    canal = _city.bounds(_ANCHOR_AREA)
    if anchor is None or tuple(anchor) != canal:
        bad.append(f"G9b E4 box {anchor} is not bit-equal to Canal Ring's _city.bounds {canal}")
    if t["lattice"] != lattice_dict():
        bad.append("lattice block is not what the generator computes (frame latitude, steps or anchor box drifted)")
    return bad


def check_table(t: SheetTable, root: str = _city.ROOT) -> list[str]:
    bad: list[str] = list(check_lattice(t))

    def need(ok: bool, msg: str) -> None:
        if not ok:
            bad.append(msg)

    sheets, skipped = t["sheets"], t["skipped"]
    need(len(sheets) > 0, "no shipping sheets")
    need(len({s["id"] for s in sheets}) == len(sheets), "sheet ids are not unique")
    need(len({s["code"] for s in sheets} | {k["code"] for k in skipped}) == len(sheets) + len(skipped),
         "a code appears twice across shipping and skipped sheets")
    anchors = [s for s in sheets if s["code"] == ANCHOR_CODE]
    need(len(anchors) == 1 and anchors[0]["id"] == ANCHOR_ID and (anchors[0]["i"], anchors[0]["j"]) == (0, 0),
         "E4 must be exactly one sheet, id canal-ring, lattice cell (0, 0)")
    for s in sheets:
        tag = s["code"]
        need(ij_of(s["code"]) == (s["i"], s["j"]) and code_of(s["i"], s["j"]) == s["code"], f"{tag}: code and (i, j) disagree")
        need(s["id"] == id_of(SheetCode(s["code"])), f"{tag}: id {s['id']!r} is not the id the lattice assigns")
        need(len(s["rdQuad"]) == 8 and all(abs(a - b) <= 0.2 for a, b in zip(s["rdQuad"], rd_quad(s["i"], s["j"]), strict=True)),
             f"{tag}: rdQuad is not the projected box (0.2 m)")
        need((s["centre"]["lat"], s["centre"]["lon"]) == centre_lat_lon(s["i"], s["j"]), f"{tag}: centre is not the sheet centre")
        need(s.get("frameLat") == FRAME_LAT, f"{tag}: frameLat {s.get('frameLat')!r} is not the lattice's standard parallel {FRAME_LAT!r} (S5: no silent default)")
        need(skip_reason(s["municipalBuildings"]) is None, f"{tag}: ships but fails the ship rule")
        need(s["kind"] == kind_of(s["municipalBuildings"]), f"{tag}: kind {s['kind']!r} disagrees with the core rule")
        need(0 <= s["municipalBuildings"] <= s["buildings"], f"{tag}: municipal buildings exceed the buildings in the box")
        need(s["label"] == label_of(SheetCode(s["code"]), s["stadsdeel"]), f"{tag}: label is not code + stadsdeel")
    for k in skipped:
        need(ij_of(k["code"]) == (k["i"], k["j"]), f"{k['code']}: skipped code and (i, j) disagree")
        need(skip_reason(k["municipalBuildings"]) == k["reason"], f"{k['code']}: skip reason is not the rule's")
        need(0 <= k["municipalBuildings"] <= k["buildings"], f"{k['code']}: municipal buildings exceed the buildings in the box")
    core = sum(1 for s in sheets if s["kind"] == "core")
    need(t["totals"] == Totals(
        shipping=len(sheets), core=core, edge=len(sheets) - core, skipped=len(skipped),
        buildingsShipping=sum(s["buildings"] for s in sheets),
        municipalBuildingsShipping=sum(s["municipalBuildings"] for s in sheets),
        municipalBuildingsSkipped=sum(s["municipalBuildings"] for s in skipped),
        municipalBuildingsCity=sum(s["municipalBuildings"] for s in sheets) + sum(s["municipalBuildings"] for s in skipped)),
        "totals do not add up")
    # E4's centre is Canal Ring's own, from the pipeline's Area: the anchor is the area's, not a copy of it.
    need((_ANCHOR_AREA.centre.lat, _ANCHOR_AREA.centre.lon) == (FRAME_LAT, LON0), "frame latitude is not Canal Ring's centre latitude")
    bad += check_frames(t)[0]
    with open(os.path.join(root, JSON_REL), encoding="utf-8") as fh:
        need(fh.read() == render_json(t), f"{JSON_REL} is not in the generator's canonical form")
    try:
        with open(os.path.join(root, TS_REL), encoding="utf-8") as fh:
            need(fh.read() == render_ts(t), f"{TS_REL} differs from what the generator renders from the JSON")
    except FileNotFoundError:
        bad.append(f"{TS_REL} is missing")
    return bad


# ── G9c / G9d: the frames and the cells (pure maths: these run in --check, on CI) ─────

FrameFactory = Callable[[int, int], _city.Area]


def sheet_area(i: int, j: int) -> _city.Area:
    """The pipeline Area whose frame sheet (i, j) is cut and solved in: its centre, and the ONE standard parallel
    (E4's latitude) every sheet shares. E4's is Canal Ring's own area, field for field in the frame."""
    code = code_of(i, j)
    lat, lon = centre_lat_lon(i, j)
    return _city.Area(id_of(code), CITY, ANCHOR_NAME if code == ANCHOR_CODE else code, _city.LatLon(lat, lon), SIZE_M,
                      _ANCHOR_AREA.local_crs, _ANCHOR_AREA.koppen, _ANCHOR_AREA.min_sun_elevation_deg,
                      frame_lat=_city.Degrees(FRAME_LAT), box=geo_bounds(i, j))


class FrameReport(NamedTuple):
    """What G9c and G9d measured: the worst deviations, so the gate prints a number and not just 'ok'."""
    pairs: int
    seam_points: int
    worst_translation_m: float
    cells: int
    worst_corner_deg: float


def _seam_points(a: tuple[int, int], b: tuple[int, int]) -> list[tuple[float, float]]:
    """G9C_POINTS points along the seam between adjacent cells a and b (an edge: evenly along it; a diagonal pair: its
    one shared corner), in lon/lat, taken from the lattice's own shared edges."""
    (i, j), (k, m) = a, b
    if i != k and j != m:                                       # diagonal: the shared corner
        return [(lon_edge(max(i, k)), lat_edge(max(j, m)))]
    if i != k:                                                  # east-west neighbours: the shared meridian
        lon = lon_edge(max(i, k))
        return [(lon, lat_edge(j) + (lat_edge(j + 1) - lat_edge(j)) * n / (G9C_POINTS - 1)) for n in range(G9C_POINTS)]
    lat = lat_edge(max(j, m))                                   # north-south neighbours: the shared parallel
    return [(lon_edge(i) + (lon_edge(i + 1) - lon_edge(i)) * n / (G9C_POINTS - 1), lat) for n in range(G9C_POINTS)]


def check_seam_frames(pairs: list[tuple[tuple[int, int], tuple[int, int]]], factory: FrameFactory) -> tuple[list[str], int, float]:
    """G9c. Every seam point maps through BOTH sheets' frames to coordinates exactly one sheet apart: (+-2800, 0) or
    (0, +-2800) or (+-2800, +-2800) at a corner, within a millimetre; and every frame's standard parallel is E4's."""
    bad: list[str] = []
    worst = 0.0
    points = 0
    for a, b in pairs:
        fa, fb = factory(*a), factory(*b)
        for tag, f in ((a, fa), (b, fb)):
            if f.frame_parallel() != FRAME_LAT:
                bad.append(f"G9c {code_of(*tag)}: frame_lat {f.frame_parallel()} is not E4's {FRAME_LAT}")
        want = ((b[0] - a[0]) * SIZE_M, (b[1] - a[1]) * SIZE_M)        # b's origin, in a's frame
        for lon, lat in _seam_points(a, b):
            ax, ay = _city.to_local(fa, lon, lat)
            bx, by = _city.to_local(fb, lon, lat)
            err = max(abs((ax - bx) - want[0]), abs((ay - by) - want[1]))
            worst = max(worst, err)
            points += 1
            if err > G9C_TOLERANCE_M:
                bad.append(f"G9c {code_of(*a)} | {code_of(*b)}: a seam point is {err:.6f} m off an exact "
                           f"({want[0]:+.0f}, {want[1]:+.0f}) m translation (lon {lon!r}, lat {lat!r})")
                break
    return bad, points, worst


def _cell_corners(f: _city.Area, rows: range, cols: range) -> F64x4:
    """Lon/lat of the four corners of cells (r, c) of sheet frame `f`: shape (len(rows), len(cols), 4, 2). r counts north
    from the south edge, c east from the west edge; indices outside 0..GRID_N-1 are the cells of the halo."""
    mx, my = _city.frame_m_per_deg(f)
    r = np.asarray(list(rows), dtype=np.float64)[:, None]
    c = np.asarray(list(cols), dtype=np.float64)[None, :]
    out = np.empty((len(rows), len(cols), 4, 2), dtype=np.float64)
    for k, (dx, dy) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        x = -SIZE_M / 2.0 + (c + dx) * CELL_M + 0.0 * r
        y = -SIZE_M / 2.0 + (r + dy) * CELL_M + 0.0 * c
        out[:, :, k, 0] = f.centre.lon + x / mx
        out[:, :, k, 1] = f.centre.lat + y / my
    return out


def check_halo_cells(pairs: list[tuple[tuple[int, int], tuple[int, int]]], factory: FrameFactory) -> tuple[list[str], int, float]:
    """G9d. Cell (r, c) of sheet B and the cell of sheet A it is the halo of have the same lon/lat corners to 1e-9 degrees.
    For each ordered pair the block of A's HALO_CELLS-deep halo that lies over B is compared with B's own cells."""
    bad: list[str] = []
    worst = 0.0
    cells = 0
    n, h = GRID_N, HALO_CELLS
    for a, b in pairs:
        di, dj = b[0] - a[0], b[1] - a[1]
        # A's halo over B: columns n..n+h-1 for an east neighbour, -h..-1 for a west one, the whole span otherwise (and rows alike)
        cols_a = range(n, n + h) if di == 1 else range(-h, 0) if di == -1 else range(n)
        rows_a = range(n, n + h) if dj == 1 else range(-h, 0) if dj == -1 else range(n)
        cols_b = range(cols_a.start - di * n, cols_a.stop - di * n)
        rows_b = range(rows_a.start - dj * n, rows_a.stop - dj * n)
        ca = _cell_corners(factory(*a), rows_a, cols_a)
        cb = _cell_corners(factory(*b), rows_b, cols_b)
        err = float(np.abs(ca - cb).max())
        worst = max(worst, err)
        cells += ca.shape[0] * ca.shape[1]
        if err > G9D_TOLERANCE_DEG:
            bad.append(f"G9d {code_of(*a)}'s halo over {code_of(*b)}: matching cell corners differ by {err:.3e} degrees "
                       f"(limit {G9D_TOLERANCE_DEG:g})")
    return bad, cells, worst


def adjacent_pairs(cells: list[tuple[int, int]]) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    """Every ordered-once pair of shipping cells that touch, edge or corner (a halo reaches the diagonal neighbour too)."""
    have = set(cells)
    out: list[tuple[tuple[int, int], tuple[int, int]]] = []
    for (i, j) in sorted(cells):
        for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
            if (i + di, j + dj) in have:
                out.append(((i, j), (i + di, j + dj)))
    return out


def check_frames(t: SheetTable, factory: FrameFactory = sheet_area) -> tuple[list[str], FrameReport]:
    """G9c + G9d over the committed table's shipping sheets (and E4's frame IS Canal Ring's)."""
    cells = [(s["i"], s["j"]) for s in t["sheets"]]
    pairs = adjacent_pairs(cells)
    bad_c, points, worst_m = check_seam_frames(pairs, factory)
    # each direction on its own: A's halo extended over B, and B's halo extended over A
    bad_d, n_cells, worst_deg = check_halo_cells([*pairs, *[(b, a) for a, b in pairs]], factory)
    bad = [*bad_c, *bad_d]
    e4 = factory(0, 0)
    if (_city.frame_m_per_deg(e4) != _city.frame_m_per_deg(_ANCHOR_AREA) or _city.bounds(e4) != _city.bounds(_ANCHOR_AREA)
            or e4.centre != _ANCHOR_AREA.centre):
        bad.append("G9c E4's frame is not Canal Ring's own (m/deg, centre or bounds differ)")
    return bad, FrameReport(len(pairs), points, worst_m, n_cells, worst_deg)


# ── raw inputs (local only) ────────────────────────────────────────────────

def _raw_web() -> str:
    return os.path.join(_city.raw_dir(CITY), "web")


def _get(url: str, params: dict[str, str] | None, dest: str) -> None:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    r = s.get(url, params=params, timeout=90)
    r.raise_for_status()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(r.content)


def read_districts(path: str) -> dict[str, BaseGeometry]:
    with open(path, encoding="utf-8") as fh:
        doc = cast("dict[str, dict[str, list[dict[str, object]]]]", json.load(fh))
    rows = doc["_embedded"]["stadsdelen"]
    out = {str(r["naam"]): shape(cast("dict[str, object]", r["geometrie"])) for r in rows if r["eindGeldigheid"] is None}
    if len(out) != 9:
        raise SystemExit(f"expected the nine current stadsdelen, got {sorted(out)}")
    return out


def municipality_of(districts: dict[str, BaseGeometry]) -> BaseGeometry:
    return unary_union(list(districts.values()))


@dataclass(frozen=True, slots=True)
class CityBuildings:
    """Every unique 3D BAG building of the downloaded city tiles: id, the tile that listed it first, centroid in RD."""
    ids: list[str]
    tile: np.ndarray[tuple[int], np.dtype[np.int32]]
    tiles: list[str]
    x: F64
    y: F64


def _read_centroids(gz_path: str, scratch: str) -> tuple[list[str], F64, F64]:
    """(ids, centroid x, centroid y in RD) of every `pand` in one tile. Only what the partition needs."""
    os.makedirs(scratch, exist_ok=True)
    db_path = os.path.join(scratch, os.path.basename(gz_path)[:-3])
    with gzip.open(gz_path, "rb") as src, open(db_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT identificatie, geom FROM pand").fetchall()
        finally:
            con.close()
    finally:
        os.remove(db_path)
    ids = [cast(str, r[0]) for r in rows]
    geoms = np.empty(len(rows), dtype=object)
    for n, r in enumerate(rows):
        geoms[n] = bag.gpkg_geometry(cast(bytes, r[1]))
    cen = shapely.centroid(geoms)
    return ids, shapely.get_x(cen), shapely.get_y(cen)


def read_city_buildings(raw3d: str, scratch: str, cache: str | None = CENTROID_CACHE) -> CityBuildings:
    """Read every tile (sorted by name) and keep each building once, from the first tile that lists it, as ingest does.
    The result is cached beside the tiles, keyed by the tile names and sizes, so a recount takes seconds."""
    names = sorted(f for f in os.listdir(raw3d) if f.endswith(".gpkg.gz"))
    key = json.dumps([[n, os.path.getsize(os.path.join(raw3d, n))] for n in names])
    if cache is not None and os.path.isfile(cache):
        z = np.load(cache, allow_pickle=False)
        if str(z["key"]) == key:
            return CityBuildings(ids=[str(v) for v in z["ids"]], tile=z["tile"], tiles=names, x=z["x"], y=z["y"])
    seen: set[str] = set()
    ids: list[str] = []
    tile: list[int] = []
    xs: list[F64] = []
    ys: list[F64] = []
    for t_index, name in enumerate(names):
        tid, tx, ty = _read_centroids(os.path.join(raw3d, name), scratch)
        keep = np.zeros(len(tid), dtype=bool)
        for n_, sid in enumerate(tid):                      # first listing wins; a repeat inside one tile counts once too
            if sid not in seen:
                seen.add(sid)
                keep[n_] = True
        ids += [sid for sid, k in zip(tid, keep, strict=True) if k]
        tile += [t_index] * int(keep.sum())
        xs.append(tx[keep])
        ys.append(ty[keep])
    out = CityBuildings(ids=ids, tile=np.array(tile, dtype=np.int32), tiles=names,
                        x=np.concatenate(xs).astype(np.float64), y=np.concatenate(ys).astype(np.float64))
    if cache is not None:
        np.savez(cache, key=np.array(key), ids=np.array(ids), tile=out.tile, x=out.x, y=out.y)
    return out


def city_lonlat(b: CityBuildings) -> tuple[F64, F64]:
    """The centroids in WGS84, through the same pyproj transformer ingest uses."""
    lons, lats = bag.rd_transformer()[0].transform(b.x, b.y)
    return np.asarray(lons, dtype=np.float64), np.asarray(lats, dtype=np.float64)


def municipal_mask(b: CityBuildings, municipality: BaseGeometry) -> BoolArr:
    return np.asarray(shapely.contains_xy(municipality, b.x, b.y), dtype=np.bool_)


def exact_counts(b: CityBuildings, municipality: BaseGeometry) -> dict[tuple[int, int], CellCount]:
    lon, lat = city_lonlat(b)
    return count_cells(lon, lat, municipal_mask(b, municipality))


def emit(fetch: bool) -> None:
    web = _raw_web()
    sd_path = os.path.join(web, STADSDELEN_FILE)
    if fetch and not os.path.isfile(sd_path):
        _get(STADSDELEN_URL, None, sd_path)
    districts = read_districts(sd_path)
    if not os.path.isdir(BAG_CITY_DIR):
        raise SystemExit(f"exact counts need the downloaded city tiles; {BAG_CITY_DIR} is absent (fetch-city first)")
    buildings = read_city_buildings(BAG_CITY_DIR, os.path.join(BAG_CITY_DIR, "scratch"))
    try:
        os.rmdir(os.path.join(BAG_CITY_DIR, "scratch"))
    except OSError:
        pass
    counts = exact_counts(buildings, municipality_of(districts))
    table = build_table(candidates(counts, districts))
    city_municipal = sum(c.municipal for c in counts.values())
    if table["totals"]["municipalBuildingsCity"] != city_municipal:
        raise SystemExit(f"municipal buildings in cells that touch the municipality ({table['totals']['municipalBuildingsCity']}) "
                         f"differ from all municipal buildings ({city_municipal}): a candidate cell is missing")
    problems = check_lattice(table)
    if problems:
        raise SystemExit("\n".join(problems))
    for rel, text in ((JSON_REL, render_json(table)), (TS_REL, render_ts(table))):
        os.makedirs(os.path.dirname(os.path.join(_city.ROOT, rel)), exist_ok=True)
        with open(os.path.join(_city.ROOT, rel), "w", encoding="utf-8") as fh:
            fh.write(text)
    t = table["totals"]
    print(f"wrote {JSON_REL} and {TS_REL}: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
          f"{t['municipalBuildingsShipping']} of {t['municipalBuildingsCity']} municipal buildings "
          f"({len(buildings.ids)} unique 3D BAG buildings in the city tiles)")


# ── G9a: the partition (local only: needs the downloaded 3D BAG tiles) ─────

class PartitionReport(TypedDict):
    buildings: int
    inIndex: int
    outsideIndex: int
    multiCell: int
    perSheet: dict[str, int]
    inSkippedCells: dict[str, int]
    inNoSheetCells: int
    #: code -> (buildings in the box, municipal ones) for EVERY cell of the index that holds a building
    perCell: dict[str, CellCount]
    e4Box: int
    e4Shipped: int
    e4OnlyInBox: list[str]
    e4OnlyShipped: list[str]
    #: of the box-only ids: (read by the ingest, kept by its local-frame clip, rows it emits). Rows must be 0.
    e4BoxOnlyIngest: tuple[int, int, int]


def _holds(i: int, j: int, lon: float, lat: float) -> bool:
    """Is the point in the sheet's HALF-OPEN box [west, east) x [south, north)?"""
    w, so, e, n = geo_bounds(i, j)
    return w <= lon < e and so <= lat < n


def multi_cell_points(lon: F64, lat: F64) -> int:
    """How many points are held by other than EXACTLY one half-open box: each point's own cell must hold it, and none
    of the eight around it may. (The partition property G9b's bit-equal edges are supposed to buy, tested on data.)"""
    i, j = cells_of(lon, lat)
    bad = np.zeros(len(lon), dtype=bool)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ii, jj = i + di, j + dj
            holds = ((lon >= LON0 + (ii - 0.5) * D_LON) & (lon < LON0 + (ii + 0.5) * D_LON)
                     & (lat >= FRAME_LAT + (jj - 0.5) * D_LAT) & (lat < FRAME_LAT + (jj + 0.5) * D_LAT))
            bad |= holds != (di == 0 and dj == 0)
    return int(bad.sum())


def partition(raw3d: str, scratch: str, shipped_ids: set[str], t: SheetTable, municipality: BaseGeometry | None) -> PartitionReport:
    """Assign every unique 3D BAG building to the sheet whose half-open WGS84 box holds its centroid (the same
    pyproj operation as ingest) and prove each lands in exactly one cell."""
    b = read_city_buildings(raw3d, scratch)
    lon, lat = city_lonlat(b)
    muni = municipal_mask(b, municipality) if municipality is not None else np.zeros(len(lon), dtype=np.bool_)
    shipping = {(s["i"], s["j"]): s["code"] for s in t["sheets"]}
    skipped = {(k["i"], k["j"]): k["code"] for k in t["skipped"]}
    multi = multi_cell_points(lon, lat)
    per_sheet: dict[str, int] = {}
    in_skipped: dict[str, int] = {}
    per_cell: dict[str, CellCount] = {}
    in_none = outside = 0
    for (i, j), c in count_cells(lon, lat, muni).items():
        try:
            code = code_of(i, j)
        except ValueError:
            outside += c.buildings
            continue
        per_cell[code] = c
        if (i, j) in shipping:
            per_sheet[code] = c.buildings
        elif (i, j) in skipped:
            in_skipped[code] = c.buildings
        else:
            in_none += c.buildings
    ci, cj = cells_of(lon, lat)
    in_e4 = (ci == 0) & (cj == 0)
    e4_box = {b.ids[n]: b.tiles[int(b.tile[n])] for n in np.flatnonzero(in_e4)}
    only_box = sorted(set(e4_box) - shipped_ids)
    wanted = set(only_box)
    raws = [rb for name in sorted({e4_box[i] for i in only_box})
            for rb in bag.read_tile(os.path.join(raw3d, name), scratch) if rb.src_id in wanted]
    _, st, _ = bag.build_rows(_ANCHOR_AREA, iter(raws))
    total = len(b.ids)
    return PartitionReport(
        buildings=total, inIndex=total - outside, outsideIndex=outside, multiCell=multi, perSheet=per_sheet,
        inSkippedCells=in_skipped, inNoSheetCells=in_none, perCell=per_cell, e4Box=len(e4_box), e4Shipped=len(shipped_ids),
        e4OnlyInBox=only_box, e4OnlyShipped=sorted(shipped_ids - set(e4_box)),
        e4BoxOnlyIngest=(st.raw_buildings, st.inside_square, st.rows))


def shipped_canal_ring_ids() -> set[str]:
    """The BAG ids Canal Ring ships (a multi-part building is several rows `id#part`; the id is the part before '#')."""
    with open(os.path.join(_city.ROOT, "data", "cities", CITY, "canal-ring-buildings.json"), encoding="utf-8") as fh:
        doc = cast("dict[str, list[dict[str, object]]]", json.load(fh))
    return {cast(str, b["src_id"]).split("#")[0] for b in doc["b"]}


def recorded_count_problems(rep: PartitionReport, t: SheetTable, municipal_known: bool) -> list[str]:
    """The table's exact counts must equal a fresh recount of the downloaded tiles, cell for cell."""
    bad: list[str] = []
    for row in [*t["sheets"], *t["skipped"]]:
        got = rep["perCell"].get(row["code"], CellCount(0, 0))
        if got.buildings != row["buildings"]:
            bad.append(f"G9a {row['code']}: table says {row['buildings']} buildings, the tiles hold {got.buildings}")
        if municipal_known and got.municipal != row["municipalBuildings"]:
            bad.append(f"G9a {row['code']}: table says {row['municipalBuildings']} municipal buildings, the tiles hold {got.municipal}")
    return bad


def run_g9a(raw3d: str) -> list[str]:
    if not os.path.isdir(raw3d):
        raise SystemExit(f"G9a needs the downloaded 3D BAG tiles; {raw3d} is absent (not an error on CI: pass no --g9a)")
    scratch = os.path.join(raw3d, "scratch")
    t = load_table()
    sd_path = os.path.join(_raw_web(), STADSDELEN_FILE)
    municipality = municipality_of(read_districts(sd_path)) if os.path.isfile(sd_path) else None
    rep = partition(raw3d, scratch, shipped_canal_ring_ids(), t, municipality)
    try:
        os.rmdir(scratch)
    except OSError:
        pass
    shipping = sum(rep["perSheet"].values())
    skipped = sum(rep["inSkippedCells"].values())
    print(f"G9a: {rep['buildings']} unique 3D BAG buildings; {rep['inIndex']} in the A-J x 1-7 index, "
          f"{rep['outsideIndex']} outside it")
    print(f"     in shipping sheets {shipping}; in skipped cells {skipped} {dict(sorted(rep['inSkippedCells'].items()))}; "
          f"in index cells that do not touch the municipality {rep['inNoSheetCells']}")
    print(f"     buildings held by other than exactly one half-open box: {rep['multiCell']}")
    print(f"     E4 box holds {rep['e4Box']}; Canal Ring ships {rep['e4Shipped']} ids; "
          f"only in the box {len(rep['e4OnlyInBox'])}; only in the shipped file {len(rep['e4OnlyShipped'])}")
    read, kept, rows = rep["e4BoxOnlyIngest"]
    print(f"     the {len(rep['e4OnlyInBox'])} box-only ids through Canal Ring's own ingest: {read} read, {kept} inside its "
          f"local-frame square, {rows} rows emitted ({kept - rows} dropped as slivers under {_city.MIN_RING_M2} m2)")
    bad: list[str] = []
    if rep["multiCell"]:
        bad.append(f"G9a: {rep['multiCell']} buildings are not in exactly one sheet")
    if shipping + skipped + rep["inNoSheetCells"] + rep["outsideIndex"] != rep["buildings"]:
        bad.append("G9a: per-sheet counts do not sum to the city count")
    if rep["e4OnlyShipped"]:
        bad.append(f"G9a: {len(rep['e4OnlyShipped'])} shipped Canal Ring ids are outside E4's box, e.g. {rep['e4OnlyShipped'][:3]}")
    if rep["e4OnlyInBox"] and (rows != 0 or read != len(rep["e4OnlyInBox"])):
        bad.append(f"G9a: {len(rep['e4OnlyInBox'])} E4-box ids are not in Canal Ring's file and its ingest does NOT drop them "
                   f"({rows} rows emitted), e.g. {rep['e4OnlyInBox'][:3]}")
    print(f"     E4 box ids minus the ingest's sliver drops == Canal Ring's shipped ids: "
          f"{not rep['e4OnlyShipped'] and rows == 0 and read == len(rep['e4OnlyInBox'])}")
    recount = recorded_count_problems(rep, t, municipality is not None)
    print(f"     the table's exact counts equal this recount for all {len(t['sheets']) + len(t['skipped'])} cells"
          f"{' (municipal counts too)' if municipality is not None else ' (buildings only: no stadsdelen file for the municipal ones)'}: "
          f"{not recount}")
    return bad + recount


# ── self-test: pure maths, no data ─────────────────────────────────────────

def _self_test() -> None:
    # the index is a bijection on A-J x 1-7
    seen: set[str] = set()
    for j in range(J_ROW_1, J_ROW_1 - ROWS, -1):
        for i in range(I_COLUMN_A, I_COLUMN_A + len(COLUMNS)):
            c = code_of(i, j)
            assert ij_of(c) == (i, j) and c not in seen
            seen.add(c)
    assert len(seen) == 70
    assert code_of(0, 0) == "E4" and ij_of("E4") == (0, 0) and ij_of("A1") == (-4, 3) and ij_of("J7") == (5, -3)
    assert id_of(SheetCode("E4")) == "canal-ring" and id_of(SheetCode("F4")) == "ams-f4"
    for bad in ("K1", "A0", "A8", "E", "E44", "e4", ""):
        try:
            ij_of(bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad!r} must not be a sheet code")
    # north is up, east is right: row 1 is the northernmost, column A the westernmost
    assert geo_bounds(0, 3)[1] > geo_bounds(0, -3)[1] and geo_bounds(5, 0)[0] > geo_bounds(-4, 0)[0]
    # E4 IS Canal Ring's box, bit for bit (not merely the same centre), and neighbours share an edge exactly
    assert geo_bounds(0, 0) == _city.bounds(_ANCHOR_AREA)
    for i, j in ((-4, 3), (-1, -2), (0, 0), (3, 1), (5, -3)):
        assert geo_bounds(i, j)[2] == geo_bounds(i + 1, j)[0] and geo_bounds(i, j)[3] == geo_bounds(i, j + 1)[1]
        assert geo_bounds(i, j)[1] == geo_bounds(i + 1, j)[1] and geo_bounds(i, j)[0] == geo_bounds(i, j + 1)[0]
    lat, lon = centre_lat_lon(0, 0)
    assert (lat, lon) == (_ANCHOR_AREA.centre.lat, _ANCHOR_AREA.centre.lon)
    w, s, e, n = geo_bounds(0, 0)
    assert w < lon < e and s < lat < n
    # a sheet is 2,800 m in the shared frame (standard parallel = E4's latitude) in every row and column
    for i, j in ((-4, 3), (5, -3), (2, 2)):
        gw, gs, ge, gn = geo_bounds(i, j)
        assert abs((ge - gw) * M_PER_DEG_LON - SIZE_M) < 1e-6 and abs((gn - gs) * M_PER_DEG_LAT - SIZE_M) < 1e-6
    # the half-open rule: a point on a shared edge belongs to the cell on its east/north, never to both
    assert cell_of_point(lon_edge(1), lat_edge(0) + 1e-9) == (1, 0) and cell_of_point(lon_edge(1) - 1e-12, lat_edge(0) + 1e-9) == (0, 0)
    assert cell_of_point(lon_edge(0) + 1e-9, lat_edge(1)) == (0, 1) and cell_of_point(lon_edge(0) + 1e-9, lat_edge(0)) == (0, 0)
    assert cell_of_point(lon, lat) == (0, 0) and cell_of_point(*reversed(centre_lat_lon(-4, 3))) == (-4, 3)
    # the rule
    assert skip_reason(499) == "under-500-buildings" and skip_reason(500) is None and kind_of(1999) == "edge" and kind_of(2000) == "core"
    # exact counts: the vectorised cell lookup equals the scalar one bit for bit, edges and corners included
    rng = np.random.default_rng(7)
    gl, gt = np.meshgrid(np.array([lon_edge(k) for k in range(-4, 7)]), np.array([lat_edge(k) for k in range(-3, 5)]))
    lons = np.concatenate([rng.uniform(lon_edge(-5), lon_edge(7), 400), gl.ravel()])        # random points + every edge crossing
    lats = np.concatenate([rng.uniform(lat_edge(-4), lat_edge(5), 400), gt.ravel()])
    ci, cj = cells_of(lons, lats)
    for k in range(len(lons)):
        assert (int(ci[k]), int(cj[k])) == cell_of_point(float(lons[k]), float(lats[k])), (k, lons[k], lats[k])
    assert multi_cell_points(lons, lats) == 0, "every point, edges included, is held by exactly one half-open box"
    # count_cells: three in E4 (two municipal), one in F4, one on E4/F4's shared meridian (belongs to F4: half-open)
    cl = np.array([LON0, LON0 + 0.001, LON0 - 0.001, LON0 + D_LON, lon_edge(1)])
    ct = np.array([FRAME_LAT, FRAME_LAT + 0.001, FRAME_LAT - 0.001, FRAME_LAT, FRAME_LAT + 0.01])
    cm = np.array([True, True, False, True, False])
    got = count_cells(cl, ct, cm)
    assert got == {(0, 0): CellCount(3, 2), (1, 0): CellCount(2, 1)}, got
    # a toy city end to end: one district, E4 only, exact counts
    district: Polygon = rd_polygon(0, 0)
    toy = build_table(candidates({(0, 0): CellCount(3200, 3000)}, {"Toy": district}))
    assert [s["id"] for s in toy["sheets"]] == ["canal-ring"] and toy["sheets"][0]["label"] == "E4 · Canal Ring"
    assert toy["sheets"][0]["kind"] == "core" and toy["totals"]["shipping"] == 1 and toy["sheets"][0]["buildings"] == 3200
    assert check_lattice(toy) == []
    assert render_json(toy) == render_json(cast("SheetTable", json.loads(render_json(toy))))
    assert render_ts(toy) == render_ts(cast("SheetTable", json.loads(render_json(toy))))
    # the ship rule is read off the MUNICIPAL count: 5000 buildings in the box but 499 municipal does not ship
    assert build_table(candidates({(0, 0): CellCount(5000, 499)}, {"Toy": district}))["totals"]["shipping"] == 0
    # G9b catches a seam that is off by one ulp, and an E4 that is not Canal Ring's box
    skew = cast("SheetTable", json.loads(render_json(build_table(candidates(
        {(0, 0): CellCount(3000, 3000), (1, 0): CellCount(3000, 3000)}, {"Toy": unary_union([rd_polygon(0, 0), rd_polygon(1, 0)])})))))
    assert len(skew["sheets"]) == 2 and check_lattice(skew) == []
    skew["sheets"][1]["wgs84Bounds"][0] = math.nextafter(skew["sheets"][1]["wgs84Bounds"][0], 0.0)
    assert any("bit-equal" in p or "formula" in p for p in check_lattice(skew))
    skew["sheets"][0]["wgs84Bounds"][2] = math.nextafter(skew["sheets"][0]["wgs84Bounds"][2], 0.0)
    assert any("Canal Ring" in p for p in check_lattice(skew))
    # G9c / G9d on a 3 x 3 block (edges, corners, both diagonals), and their NEGATIVES: each broken frame must be caught
    import dataclasses
    block = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    block_union = unary_union([rd_polygon(i, j) for i, j in block])
    nine = build_table(candidates({c: CellCount(3000, 3000) for c in block}, {"Toy": block_union}))
    assert len(nine["sheets"]) == 9
    ok, rep = check_frames(nine)
    assert ok == [] and rep.pairs == 20 and rep.seam_points == 12 * G9C_POINTS + 8 and rep.worst_translation_m < 1e-6 and rep.worst_corner_deg < 1e-12, (ok[:2], rep)

    def shifted(cell: tuple[int, int], dlon: float, dlat: float) -> FrameFactory:
        def f(i: int, j: int) -> _city.Area:
            a = sheet_area(i, j)
            return dataclasses.replace(a, centre=_city.LatLon(a.centre.lat + dlat, a.centre.lon + dlon)) if (i, j) == cell else a
        return f
    own_lat: FrameFactory = lambda i, j: dataclasses.replace(sheet_area(i, j), frame_lat=None)           # noqa: E731
    bad_own = check_frames(nine, own_lat)[0]
    assert any(m.startswith("G9c") and "frame_lat" in m for m in bad_own) and any("m off an exact" in m for m in bad_own), \
        "G9c must catch sheets that each use their own latitude"
    assert any(m.startswith("G9d") for m in check_frames(nine, own_lat)[0]), "G9d must catch it too (cells do not line up across a latitude change)"
    one_cell = check_frames(nine, shifted((0, 1), 0.0, CELL_M / M_PER_DEG_LAT))[0]
    assert any(m.startswith("G9c") for m in one_cell) and any(m.startswith("G9d") for m in one_cell), "a one-cell slip is caught by both"
    micro = check_frames(nine, shifted((1, 0), 1e-8, 0.0))[0]                                            # 0.7 mm of east-west slip
    assert micro and all(m.startswith("G9d") for m in micro), f"0.7 mm passes G9c's millimetre and must fail G9d's 1e-9 degrees: {micro[:2]}"
    sub_nano = check_frames(nine, shifted((1, 0), 4e-10, 0.0))[0]                                         # 4e-10 deg: inside both limits
    assert sub_nano == [], "a slip inside both tolerances is not a failure"
    wrong_e4 = check_frames(nine, shifted((0, 0), 0.0, 3e-9))[0]
    assert any("Canal Ring's own" in m for m in wrong_e4), "E4's frame must be Canal Ring's, bit for bit"
    print("scripts/_sheets.py: self-test passed (70-cell index bijection, E4 == Canal Ring's box, shared edges, "
          "half-open rule, rule edges, exact counts and the vectorised cell lookup, toy city, G9b/G9c/G9d negatives)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--g9a", action="store_true",
                    help="local only: every 3D BAG building in exactly one sheet; E4's ids == Canal Ring's shipped ids")
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--fetch", action="store_true", help="with --emit: download the two inputs if not cached")
    args = ap.parse_args()
    if args.emit:
        emit(args.fetch)
    elif args.g9a:
        problems = run_g9a(BAG_CITY_DIR)
        if problems:
            for p in problems:
                print("FAIL", p)
            raise SystemExit(1)
        print("G9a: passed")
    elif args.check:
        problems = check_table(load_table())
        if problems:
            for p in problems:
                print("FAIL", p)
            raise SystemExit(1)
        table = load_table()
        t = table["totals"]
        fr = check_frames(table)[1]
        print(f"scripts/_sheets.py --check: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
              f"G9b lattice (shared edges bit-equal, E4 box bit-equal to Canal Ring's), "
              f"G9c frames ({fr.pairs} neighbour pairs, {fr.seam_points} seam points, worst {fr.worst_translation_m:.2e} m off an exact "
              f"sheet translation, limit {G9C_TOLERANCE_M:g}), G9d cells ({fr.cells} halo cells, worst corner {fr.worst_corner_deg:.2e} deg, "
              f"limit {G9D_TOLERANCE_DEG:g}), JSON canonical, TS == JSON")
    else:
        _self_test()


if __name__ == "__main__":
    main()
