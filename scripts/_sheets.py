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
    python3 scripts/_sheets.py --g9a            # G9a partition against the downloaded 3D BAG tiles (local only)
    taskpolicy -b python3 scripts/_sheets.py --emit [--fetch]
                                                # local: rebuild both files from the raw cache

ADDRESSING. Code = column letter A-J (west to east) + row 1-7 (north to south), as on a
topographic sheet index. Area id = `ams-<code>` ("ams-f4"); E4 keeps `canal-ring`.

THE BUILDING COUNT IS AN ESTIMATE, and is named `buildingsEst` so nobody reads it as exact. It is
the 3D BAG v20250903 tile index's `gpkg_nr_building` per tile, spread over each tile by AREA (a
uniform density inside a tile) and restricted to the municipal part of the sheet. Calibrated: it
gives 21,264 for E4 against the 21,342 Canal Ring ships (that figure also counts buildings
outside the municipality inside the box). The per-sheet exporter in phase P2 assigns each
building to one sheet by its WGS84 centroid in half-open boxes (G9a) and replaces these numbers with exact ones.

SHIP RULE (founder D1: every sheet that passes, not a fixed number): at least 500 estimated municipal
buildings AND at least 10 % of the sheet's area inside the municipality. CORE = at least 2,000
buildings, else EDGE. The decisions are taken on the ROUNDED numbers the table records, so `--check` can
re-derive them. The ship rule is applied to P2's EXACT counts once they exist; a sheet near 500 is inside the
estimate's noise.

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
from dataclasses import dataclass
from typing import Final, Literal, NewType, TypedDict, cast

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
SkipReason = Literal["under-500-buildings", "under-10-percent-municipal"]
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
COLUMNS: Final = "ABCDEFGHIJ"
ROWS: Final = 7
#: Lattice index of column A and of row 1. Canal Ring (E4) is (0, 0) by construction.
I_COLUMN_A: Final = -4
J_ROW_1: Final = 3
ANCHOR_CODE: Final = SheetCode("E4")
ANCHOR_ID: Final = SheetId("canal-ring")
ANCHOR_NAME: Final = "Canal Ring"

SHIP_MIN_BUILDINGS: Final = 500
SHIP_MIN_SHARE: Final = 0.10
CORE_MIN_BUILDINGS: Final = 2000

JSON_REL: Final = os.path.join("data", "cities", CITY, "sheets.json")
TS_REL: Final = os.path.join("src", "data", "sheets", f"{CITY}.ts")
RELEASE: Final = "v20250903"
MUNICIPALITY_TILES: Final = f"tiles-{RELEASE}-{CITY}-municipality.json"
STADSDELEN_FILE: Final = "stadsdelen.json"
STADSDELEN_URL: Final = "https://api.data.amsterdam.nl/v1/gebieden/stadsdelen/?_format=json&_pageSize=100"
#: Densification of a sheet's edges when it is projected into RD to intersect the municipality (points per side).
RD_EDGE_POINTS: Final = 16
#: The downloaded 3D BAG tiles of the whole municipality (local cache, never committed).
BAG_CITY_DIR: Final = os.path.join(os.path.expanduser("~"), ".cache", "delta-climate", "cities", CITY, "raw", "city", "3dbag")
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


def skip_reason(buildings: int, share: float) -> SkipReason | None:
    """None when the sheet ships; else the first rule it fails."""
    if buildings < SHIP_MIN_BUILDINGS:
        return "under-500-buildings"
    if share < SHIP_MIN_SHARE:
        return "under-10-percent-municipal"
    return None


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
    buildingsEst: int
    municipalShare: float
    stadsdeel: str
    label: str
    wgs84Bounds: list[float]
    rdQuad: list[float]
    centre: Centre


class SkippedRow(TypedDict):
    code: str
    i: int
    j: int
    buildingsEst: int
    municipalShare: float
    reason: SkipReason


class Totals(TypedDict):
    shipping: int
    core: int
    edge: int
    skipped: int
    buildingsEstShipping: int
    buildingsEstSkipped: int
    buildingsEstMunicipal: int


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
    share: float
    stadsdeel: str


def label_of(code: SheetCode, stadsdeel: str) -> str:
    return f"{code} · {ANCHOR_NAME if code == ANCHOR_CODE else stadsdeel}"


def estimate_buildings(tiles: list[tuple[BaseGeometry, int]], region: BaseGeometry) -> float:
    """Sum over tiles of count x (tile AND region area) / tile area: a uniform density inside a tile."""
    total = 0.0
    for geom, count in tiles:
        if geom.area > 0.0 and geom.intersects(region):
            total += count * geom.intersection(region).area / geom.area
    return total


def candidates(tiles: list[tuple[BaseGeometry, int]], districts: dict[str, BaseGeometry]) -> list[Candidate]:
    municipality = unary_union(list(districts.values()))
    out: list[Candidate] = []
    for j in range(J_ROW_1, J_ROW_1 - ROWS, -1):
        for i in range(I_COLUMN_A, I_COLUMN_A + len(COLUMNS)):
            sheet = rd_polygon(i, j)
            inside = sheet.intersection(municipality)
            if inside.area <= 0.0:
                continue
            shares = {name: sheet.intersection(g).area for name, g in districts.items()}
            out.append(Candidate(i, j, round(estimate_buildings(tiles, inside)),
                                 round(inside.area / sheet.area, 3), max(shares, key=lambda n: shares[n])))
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
        reason = skip_reason(c.buildings, c.share)
        if reason is not None:
            skipped.append(SkippedRow(code=code, i=c.i, j=c.j, buildingsEst=c.buildings,
                                      municipalShare=c.share, reason=reason))
            continue
        lat, lon = centre_lat_lon(c.i, c.j)
        sheets.append(SheetRow(
            id=id_of(code), code=code, i=c.i, j=c.j, kind=kind_of(c.buildings),
            buildingsEst=c.buildings, municipalShare=c.share, stadsdeel=c.stadsdeel,
            label=label_of(code, c.stadsdeel), wgs84Bounds=list(geo_bounds(c.i, c.j)),
            rdQuad=rd_quad(c.i, c.j), centre=Centre(lat=lat, lon=lon)))
    core = sum(1 for s in sheets if s["kind"] == "core")
    return SheetTable(
        city=CITY,
        lattice=lattice_dict(),
        shipRule={"minBuildings": SHIP_MIN_BUILDINGS, "minMunicipalShare": SHIP_MIN_SHARE,
                  "coreMinBuildings": CORE_MIN_BUILDINGS},
        method=("buildingsEst = 3D BAG " + RELEASE + " tile-index gpkg_nr_building per tile, spread by area "
                "(uniform density inside a tile) over the municipal part of the sheet; an ESTIMATE, "
                "replaced by exact WGS84-centroid counts in half-open boxes in phase P2. municipalShare = share of "
                "the sheet inside the union of the nine current stadsdelen. stadsdeel = largest share of the sheet. "
                "wgs84Bounds = the sheet's own lon/lat box (Canal Ring's, repeated); rdQuad = its four corners in "
                "RD New, informational."),
        sources=["3D BAG " + RELEASE + " BAG3D:tiles (CC BY 4.0, 3DBAG by tudelft3d and 3DGI)",
                 "Gemeente Amsterdam, Kernregistratie gebieden, stadsdelen (CC0 1.0)"],
        sheets=sheets, skipped=skipped,
        totals=Totals(shipping=len(sheets), core=core, edge=len(sheets) - core, skipped=len(skipped),
                      buildingsEstShipping=sum(s["buildingsEst"] for s in sheets),
                      buildingsEstSkipped=sum(s["buildingsEst"] for s in skipped),
                      buildingsEstMunicipal=sum(c.buildings for c in cands)))


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
            f"buildingsEst: {s['buildingsEst']}, municipalShare: {s['municipalShare']}, "
            f"stadsdeel: {_q(s['stadsdeel'])}, label: {_q(s['label'])}, wgs84Bounds: {_row(s['wgs84Bounds'])}, "
            f"rdQuad: {_row(s['rdQuad'])}, centre: {{ lat: {s['centre']['lat']}, lon: {s['centre']['lon']} }} }},")
    out += ["] as const;", "",
            "/** The ids alone (E4 included), so the registry's invariant check can read membership without the table's weight. */",
            "export const AMSTERDAM_SHEET_IDS = [" + ", ".join(_q(s["id"]) for s in t["sheets"]) + "] as const;", "",
            "/** Lattice cells that touch the municipality but do not ship, with the rule each failed. */",
            "export const AMSTERDAM_SKIPPED_SHEETS = ["]
    for k in t["skipped"]:
        out.append(f"  {{ code: {_q(k['code'])}, i: {k['i']}, j: {k['j']}, buildingsEst: {k['buildingsEst']}, "
                   f"municipalShare: {k['municipalShare']}, reason: {_q(k['reason'])} }},")
    out += [
        "] as const;", "",
        "/* The registry's area entries for every sheet EXCEPT E4, which is `canal-ring` and is written by hand in",
        "   registry.ts so that its live behaviour cannot change. `drawable: false` keeps all of these off every",
        "   route, sitemap and switcher; `sheet: true` keeps them out of the per-city area lists. Names and",
        "   descriptors are owned here, as Dubai's are owned by the registry: sheets are not in the ward table. */",
        "export const AMSTERDAM_SHEET_AREAS = {",
    ]
    for s in t["sheets"]:
        if s["id"] == ANCHOR_ID:
            continue
        out.append(f"  {_q(s['id'])}: {{ shipsData: false, drawable: false, sheet: true, name: {_q(s['label'])}, "
                   f"descriptor: {_q('sheet · ' + s['kind'] + ' · our tiling')} }},")
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
        need(skip_reason(s["buildingsEst"], s["municipalShare"]) is None, f"{tag}: ships but fails the ship rule")
        need(s["kind"] == kind_of(s["buildingsEst"]), f"{tag}: kind {s['kind']!r} disagrees with the core rule")
        need(s["label"] == label_of(SheetCode(s["code"]), s["stadsdeel"]), f"{tag}: label is not code + stadsdeel")
    for k in skipped:
        need(ij_of(k["code"]) == (k["i"], k["j"]), f"{k['code']}: skipped code and (i, j) disagree")
        need(skip_reason(k["buildingsEst"], k["municipalShare"]) == k["reason"], f"{k['code']}: skip reason is not the rule's")
    core = sum(1 for s in sheets if s["kind"] == "core")
    need(t["totals"] == Totals(
        shipping=len(sheets), core=core, edge=len(sheets) - core, skipped=len(skipped),
        buildingsEstShipping=sum(s["buildingsEst"] for s in sheets),
        buildingsEstSkipped=sum(s["buildingsEst"] for s in skipped),
        buildingsEstMunicipal=sum(s["buildingsEst"] for s in sheets) + sum(s["buildingsEst"] for s in skipped)),
        "totals do not add up")
    # E4's centre is Canal Ring's own, from the pipeline's Area: the anchor is the area's, not a copy of it.
    need((_ANCHOR_AREA.centre.lat, _ANCHOR_AREA.centre.lon) == (FRAME_LAT, LON0), "frame latitude is not Canal Ring's centre latitude")
    with open(os.path.join(root, JSON_REL), encoding="utf-8") as fh:
        need(fh.read() == render_json(t), f"{JSON_REL} is not in the generator's canonical form")
    try:
        with open(os.path.join(root, TS_REL), encoding="utf-8") as fh:
            need(fh.read() == render_ts(t), f"{TS_REL} differs from what the generator renders from the JSON")
    except FileNotFoundError:
        bad.append(f"{TS_REL} is missing")
    return bad


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


def read_tiles(path: str) -> list[tuple[BaseGeometry, int]]:
    with open(path, encoding="utf-8") as fh:
        doc = cast("dict[str, list[dict[str, dict[str, object]]]]", json.load(fh))
    return [(shape(f["geometry"]), cast(int, f["properties"]["gpkg_nr_building"])) for f in doc["features"]]


def emit(fetch: bool) -> None:
    web = _raw_web()
    tiles_path, sd_path = os.path.join(web, MUNICIPALITY_TILES), os.path.join(web, STADSDELEN_FILE)
    if fetch and not os.path.isfile(sd_path):
        _get(STADSDELEN_URL, None, sd_path)
    districts = read_districts(sd_path)
    if fetch and not os.path.isfile(tiles_path):
        minx, miny, maxx, maxy = unary_union(list(districts.values())).bounds
        _get("https://data.3dbag.nl/api/BAG3D/wfs", {
            "service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "BAG3D:tiles",
            "outputFormat": "json",
            "bbox": f"{minx - 50:.1f},{miny - 50:.1f},{maxx + 50:.1f},{maxy + 50:.1f},urn:ogc:def:crs:EPSG::28992"},
            tiles_path)
    table = build_table(candidates(read_tiles(tiles_path), districts))
    problems = check_lattice(table)
    if problems:
        raise SystemExit("\n".join(problems))
    for rel, text in ((JSON_REL, render_json(table)), (TS_REL, render_ts(table))):
        os.makedirs(os.path.dirname(os.path.join(_city.ROOT, rel)), exist_ok=True)
        with open(os.path.join(_city.ROOT, rel), "w", encoding="utf-8") as fh:
            fh.write(text)
    t = table["totals"]
    print(f"wrote {JSON_REL} and {TS_REL}: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
          f"{t['buildingsEstShipping']} of {t['buildingsEstMunicipal']} estimated municipal buildings")


# ── G9a: the partition (local only: needs the downloaded 3D BAG tiles) ─────

class PartitionReport(TypedDict):
    buildings: int
    inIndex: int
    outsideIndex: int
    multiCell: int
    perSheet: dict[str, int]
    inSkippedCells: dict[str, int]
    inNoSheetCells: int
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


def _read_centroids(gz_path: str, scratch: str) -> tuple[list[str], np.ndarray[tuple[int], np.dtype[np.float64]],
                                                         np.ndarray[tuple[int], np.dtype[np.float64]]]:
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


def partition(raw3d: str, scratch: str, shipped_ids: set[str], t: SheetTable) -> PartitionReport:
    """Assign every unique 3D BAG building to the sheet whose half-open WGS84 box holds its centroid (the same
    pyproj operation as ingest) and prove each lands in exactly one cell."""
    tr = bag.rd_transformer()[0]
    shipping = {(s["i"], s["j"]): s["code"] for s in t["sheets"]}
    skipped = {(k["i"], k["j"]): k["code"] for k in t["skipped"]}
    seen: set[str] = set()
    per_sheet: dict[str, int] = {}
    in_skipped: dict[str, int] = {}
    in_none = outside = multi = total = 0
    e4_box: dict[str, str] = {}
    for name in sorted(f for f in os.listdir(raw3d) if f.endswith(".gpkg.gz")):
        ids, xs, ys = _read_centroids(os.path.join(raw3d, name), scratch)
        lons, lats = tr.transform(xs, ys)
        for sid, lon, lat in zip(ids, lons, lats, strict=True):
            if sid in seen:                      # a building listed by two tiles counts once, as in ingest
                continue
            seen.add(sid)
            total += 1
            i, j = cell_of_point(float(lon), float(lat))
            holders = [(a, b) for a in (i - 1, i, i + 1) for b in (j - 1, j, j + 1) if _holds(a, b, lon, lat)]
            if len(holders) != 1 or holders[0] != (i, j):
                multi += 1
            try:
                code = code_of(i, j)
            except ValueError:
                outside += 1
                continue
            if (i, j) in shipping:
                per_sheet[code] = per_sheet.get(code, 0) + 1
                if (i, j) == (0, 0):
                    e4_box[sid] = name
            elif (i, j) in skipped:
                in_skipped[code] = in_skipped.get(code, 0) + 1
            else:
                in_none += 1
    only_box = sorted(set(e4_box) - shipped_ids)
    wanted = set(only_box)
    raws = [rb for name in sorted({e4_box[i] for i in only_box})
            for rb in bag.read_tile(os.path.join(raw3d, name), scratch) if rb.src_id in wanted]
    _, st, _ = bag.build_rows(_ANCHOR_AREA, iter(raws))
    return PartitionReport(
        buildings=total, inIndex=total - outside, outsideIndex=outside, multiCell=multi, perSheet=per_sheet,
        inSkippedCells=in_skipped, inNoSheetCells=in_none, e4Box=len(e4_box), e4Shipped=len(shipped_ids),
        e4OnlyInBox=only_box, e4OnlyShipped=sorted(shipped_ids - set(e4_box)),
        e4BoxOnlyIngest=(st.raw_buildings, st.inside_square, st.rows))


def shipped_canal_ring_ids() -> set[str]:
    """The BAG ids Canal Ring ships (a multi-part building is several rows `id#part`; the id is the part before '#')."""
    with open(os.path.join(_city.ROOT, "data", "cities", CITY, "canal-ring-buildings.json"), encoding="utf-8") as fh:
        doc = cast("dict[str, list[dict[str, object]]]", json.load(fh))
    return {cast(str, b["src_id"]).split("#")[0] for b in doc["b"]}


def run_g9a(raw3d: str) -> list[str]:
    if not os.path.isdir(raw3d):
        raise SystemExit(f"G9a needs the downloaded 3D BAG tiles; {raw3d} is absent (not an error on CI: pass no --g9a)")
    scratch = os.path.join(raw3d, "scratch")
    t = load_table()
    rep = partition(raw3d, scratch, shipped_canal_ring_ids(), t)
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
    return bad


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
    assert skip_reason(499, 1.0) == "under-500-buildings" and skip_reason(500, 0.099) == "under-10-percent-municipal"
    assert skip_reason(500, 0.1) is None and kind_of(1999) == "edge" and kind_of(2000) == "core"
    # the estimate: whole tile, half tile, none
    tile = box(0, 0, 100, 100)
    assert estimate_buildings([(tile, 80)], box(-50, -50, 150, 150)) == 80.0
    assert estimate_buildings([(tile, 80)], box(0, 0, 50, 100)) == 40.0
    assert estimate_buildings([(tile, 80)], box(200, 200, 300, 300)) == 0.0
    # a toy city end to end: one district, one tile, E4 only
    district: Polygon = rd_polygon(0, 0)
    toy = build_table(candidates([(rd_polygon(0, 0), 3000)], {"Toy": district}))
    assert [s["id"] for s in toy["sheets"]] == ["canal-ring"] and toy["sheets"][0]["label"] == "E4 · Canal Ring"
    assert toy["sheets"][0]["kind"] == "core" and toy["totals"]["shipping"] == 1
    assert check_lattice(toy) == []
    assert render_json(toy) == render_json(cast("SheetTable", json.loads(render_json(toy))))
    assert render_ts(toy) == render_ts(cast("SheetTable", json.loads(render_json(toy))))
    # G9b catches a seam that is off by one ulp, and an E4 that is not Canal Ring's box
    skew = cast("SheetTable", json.loads(render_json(build_table(candidates(
        [(rd_polygon(0, 0), 3000), (rd_polygon(1, 0), 3000)], {"Toy": unary_union([rd_polygon(0, 0), rd_polygon(1, 0)])})))))
    assert len(skew["sheets"]) == 2 and check_lattice(skew) == []
    skew["sheets"][1]["wgs84Bounds"][0] = math.nextafter(skew["sheets"][1]["wgs84Bounds"][0], 0.0)
    assert any("bit-equal" in p or "formula" in p for p in check_lattice(skew))
    skew["sheets"][0]["wgs84Bounds"][2] = math.nextafter(skew["sheets"][0]["wgs84Bounds"][2], 0.0)
    assert any("Canal Ring" in p for p in check_lattice(skew))
    print("scripts/_sheets.py: self-test passed (70-cell index bijection, E4 == Canal Ring's box, shared edges, "
          "half-open rule, rule edges, estimate, toy city, G9b negatives)")


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
        t = load_table()["totals"]
        print(f"scripts/_sheets.py --check: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
              f"G9b lattice (shared edges bit-equal, E4 box bit-equal to Canal Ring's), JSON canonical, TS == JSON")
    else:
        _self_test()


if __name__ == "__main__":
    main()
