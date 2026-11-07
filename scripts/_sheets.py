"""The sheet table: Amsterdam's whole-city streaming lattice (city-streaming phase P1).

A SHEET is a 2.8 km square on ONE lattice in RD New (EPSG:28992), anchored so that Canal Ring
is sheet E4 and is not re-cut. This module owns the lattice maths and the committed table that
every other consumer reads:

    data/cities/amsterdam/sheets.json      the artefact (small, committed)
    src/data/sheets/amsterdam.ts           GENERATED from it, `as const`, so the scope registry's
                                           AreaKey keeps exact literal types. A JSON import widens
                                           every id to `string`; a generated literal does not.

Python emits, TypeScript reads, and a test pins the two (the instrument-and-laboratory rule).

    python3 scripts/_sheets.py --self-test      # pure maths, no data
    python3 scripts/_sheets.py --check          # committed table: shape, count, E4 anchor, TS == JSON
    taskpolicy -b python3 scripts/_sheets.py --emit [--fetch]
                                                # local: rebuild both files from the raw cache

ADDRESSING. Code = column letter A-J (west to east) + row 1-7 (north to south), as on a
topographic sheet index. Area id = `ams-<code>` ("ams-f4"); E4 keeps `canal-ring`.

THE BUILDING COUNT IS AN ESTIMATE, and is named `buildingsEst` so nobody reads it as exact. It is
the 3D BAG v20250903 tile index's `gpkg_nr_building` per tile, spread over each tile by AREA (a
uniform density inside a tile) and restricted to the municipal part of the sheet. Calibrated: it
gives 21,071 for E4 against the 21,342 Canal Ring ships (that figure also counts buildings
outside the municipality inside the square). The per-sheet exporter in phase P2 assigns each
building to one sheet by its centroid and replaces these numbers with exact ones.

SHIP RULE (founder D1, all 37): at least 500 estimated municipal buildings AND at least 10 % of
the sheet's area inside the municipality. CORE = at least 2,000 buildings, else EDGE. The
decisions are taken on the ROUNDED numbers the table records, so `--check` can re-derive them.

STADSDEEL. The name beside the code is the stadsdeel holding the largest share of the sheet's
municipal area. Gemeente Amsterdam's Kernregistratie gebieden is CC0 1.0 (see
docs/evidence/2026-11-07-amsterdam-stadsdelen-licence.md), so the names are shown. No geometry
from that source is redistributed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Final, Literal, NewType, TypedDict, cast

import requests
from pyproj import Transformer
from shapely.geometry import Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402

Kind = Literal["core", "edge"]
SkipReason = Literal["under-500-buildings", "under-10-percent-municipal"]
#: "F4". A NewType, not an alias: a bare string is also an id and a stadsdeel.
SheetCode = NewType("SheetCode", str)
#: "ams-f4", or "canal-ring" for E4.
SheetId = NewType("SheetId", str)

CITY: Final = "amsterdam"
SIZE_M: Final = 2800
#: South-west corner of Canal Ring's square, RD metres. The centre is Canal Ring's own
#: (52.3640 N, 4.8850 E) projected and rounded to 0.1 m, minus half a sheet.
CENTRE_E4_RD: Final = (120793.2, 486353.2)
ORIGIN_RD: Final = (CENTRE_E4_RD[0] - SIZE_M / 2, CENTRE_E4_RD[1] - SIZE_M / 2)
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


def rd_bounds(i: int, j: int) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) in RD metres, rounded to 0.1 m (the origin has one decimal)."""
    x0, y0 = ORIGIN_RD[0] + SIZE_M * i, ORIGIN_RD[1] + SIZE_M * j
    return (round(x0, 1), round(y0, 1), round(x0 + SIZE_M, 1), round(y0 + SIZE_M, 1))


def _from_rd() -> Transformer:
    return Transformer.from_crs(28992, 4326, always_xy=True)


def wgs84_envelope(i: int, j: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of the four projected RD corners. RD is rotated about 0.4 degrees
    from true north here, so a sheet is a slightly turned square in degrees and this is its ENVELOPE."""
    xmin, ymin, xmax, ymax = rd_bounds(i, j)
    t = _from_rd()
    pts = [t.transform(x, y) for x, y in ((xmin, ymin), (xmax, ymin), (xmin, ymax), (xmax, ymax))]
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    return (round(min(lons), 6), round(min(lats), 6), round(max(lons), 6), round(max(lats), 6))


def centre_lat_lon(i: int, j: int) -> tuple[float, float]:
    xmin, ymin, xmax, ymax = rd_bounds(i, j)
    lon, lat = _from_rd().transform((xmin + xmax) / 2, (ymin + ymax) / 2)
    return (round(lat, 6), round(lon, 6))


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
    rdBounds: list[float]
    wgs84Bounds: list[float]
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
            sheet = box(*rd_bounds(i, j))
            inside = sheet.intersection(municipality)
            if inside.area <= 0.0:
                continue
            shares = {name: sheet.intersection(g).area for name, g in districts.items()}
            out.append(Candidate(i, j, round(estimate_buildings(tiles, inside)),
                                 round(inside.area / sheet.area, 3), max(shares, key=lambda n: shares[n])))
    return out


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
            label=label_of(code, c.stadsdeel), rdBounds=list(rd_bounds(c.i, c.j)),
            wgs84Bounds=list(wgs84_envelope(c.i, c.j)), centre=Centre(lat=lat, lon=lon)))
    core = sum(1 for s in sheets if s["kind"] == "core")
    return SheetTable(
        city=CITY,
        lattice={"crs": "EPSG:28992", "sizeM": SIZE_M, "originRd": list(ORIGIN_RD), "columns": COLUMNS,
                 "rows": ROWS, "iOfColumnA": I_COLUMN_A, "jOfRow1": J_ROW_1,
                 "anchor": {"code": ANCHOR_CODE, "id": ANCHOR_ID, "centreRd": list(CENTRE_E4_RD)}},
        shipRule={"minBuildings": SHIP_MIN_BUILDINGS, "minMunicipalShare": SHIP_MIN_SHARE,
                  "coreMinBuildings": CORE_MIN_BUILDINGS},
        method=("buildingsEst = 3D BAG " + RELEASE + " tile-index gpkg_nr_building per tile, spread by area "
                "(uniform density inside a tile) over the municipal part of the sheet; an ESTIMATE, "
                "replaced by exact centroid counts in phase P2. municipalShare = share of the sheet inside "
                "the union of the nine current stadsdelen. stadsdeel = largest share of the sheet. "
                "wgs84Bounds = envelope of the four projected RD corners."),
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
        f"  crs: 28992, sizeM: {SIZE_M}, originRd: [{ORIGIN_RD[0]}, {ORIGIN_RD[1]}], columns: {_q(COLUMNS)}, rows: {ROWS},",
        f"  iOfColumnA: {I_COLUMN_A}, jOfRow1: {J_ROW_1},",
        f"  anchor: {{ code: {_q(ANCHOR_CODE)}, id: {_q(ANCHOR_ID)}, centreRd: [{CENTRE_E4_RD[0]}, {CENTRE_E4_RD[1]}] }},",
        "} as const;",
        "",
        "/** Shipping sheets, in reading order (row 1 to 7, column A to J). */",
        "export const AMSTERDAM_SHEETS = [",
    ]
    for s in t["sheets"]:
        out.append(
            f"  {{ id: {_q(s['id'])}, code: {_q(s['code'])}, i: {s['i']}, j: {s['j']}, kind: {_q(s['kind'])}, "
            f"buildingsEst: {s['buildingsEst']}, municipalShare: {s['municipalShare']}, "
            f"stadsdeel: {_q(s['stadsdeel'])}, label: {_q(s['label'])}, rdBounds: {_row(s['rdBounds'])}, "
            f"wgs84Bounds: {_row(s['wgs84Bounds'])}, centre: {{ lat: {s['centre']['lat']}, lon: {s['centre']['lon']} }} }},")
    out += ["] as const;", "", "/** Lattice cells that touch the municipality but do not ship, with the rule each failed. */",
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


def check_table(t: SheetTable, root: str = _city.ROOT) -> list[str]:
    bad: list[str] = []

    def need(ok: bool, msg: str) -> None:
        if not ok:
            bad.append(msg)

    sheets, skipped = t["sheets"], t["skipped"]
    need(len(sheets) == 37, f"expected 37 shipping sheets, found {len(sheets)}")
    need(len({s["id"] for s in sheets}) == len(sheets), "sheet ids are not unique")
    need(len({s["code"] for s in sheets} | {k["code"] for k in skipped}) == len(sheets) + len(skipped),
         "a code appears twice across shipping and skipped sheets")
    anchors = [s for s in sheets if s["code"] == ANCHOR_CODE]
    need(len(anchors) == 1 and anchors[0]["id"] == ANCHOR_ID and (anchors[0]["i"], anchors[0]["j"]) == (0, 0),
         "E4 must be exactly one sheet, id canal-ring, lattice cell (0, 0)")
    transformer = _from_rd()
    for s in sheets:
        tag = s["code"]
        need(ij_of(s["code"]) == (s["i"], s["j"]) and code_of(s["i"], s["j"]) == s["code"], f"{tag}: code and (i, j) disagree")
        need(s["id"] == id_of(SheetCode(s["code"])), f"{tag}: id {s['id']!r} is not the id the lattice assigns")
        need(s["rdBounds"] == list(rd_bounds(s["i"], s["j"])), f"{tag}: rdBounds are not the lattice square")
        need(s["wgs84Bounds"] == list(wgs84_envelope(s["i"], s["j"])), f"{tag}: wgs84Bounds are not the corner envelope")
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
    # E4 against Canal Ring's own centre, from the pipeline's Area: the anchor is the area's, not a copy of it.
    area = _city.AREAS["canal-ring"]
    x, y = _city.transformer_to_local_crs(area).transform(area.centre.lon, area.centre.lat)
    need(math.hypot(x - CENTRE_E4_RD[0], y - CENTRE_E4_RD[1]) < 0.1,
         f"E4 centre {CENTRE_E4_RD} is not Canal Ring's centre ({x:.2f}, {y:.2f}) to 0.1 m")
    need(abs(transformer.transform(*CENTRE_E4_RD)[1] - area.centre.lat) < 1e-5, "E4 centre latitude drifted from Canal Ring's")
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
    for rel, text in ((JSON_REL, render_json(table)), (TS_REL, render_ts(table))):
        os.makedirs(os.path.dirname(os.path.join(_city.ROOT, rel)), exist_ok=True)
        with open(os.path.join(_city.ROOT, rel), "w", encoding="utf-8") as fh:
            fh.write(text)
    t = table["totals"]
    print(f"wrote {JSON_REL} and {TS_REL}: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
          f"{t['buildingsEstShipping']} of {t['buildingsEstMunicipal']} estimated municipal buildings")


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
    assert rd_bounds(0, 3)[1] > rd_bounds(0, -3)[1] and rd_bounds(5, 0)[0] > rd_bounds(-4, 0)[0]
    # the anchor square is Canal Ring's, and neighbours share an edge exactly
    assert rd_bounds(0, 0) == (119393.2, 484953.2, 122193.2, 487753.2)
    assert rd_bounds(0, 0)[2] == rd_bounds(1, 0)[0] and rd_bounds(0, 0)[3] == rd_bounds(0, 1)[1]
    lat, lon = centre_lat_lon(0, 0)
    assert abs(lat - 52.3640) < 1e-5 and abs(lon - 4.8850) < 1e-5, (lat, lon)
    w, s, e, n = wgs84_envelope(0, 0)
    assert w < lon < e and s < lat < n
    # the rule
    assert skip_reason(499, 1.0) == "under-500-buildings" and skip_reason(500, 0.099) == "under-10-percent-municipal"
    assert skip_reason(500, 0.1) is None and kind_of(1999) == "edge" and kind_of(2000) == "core"
    # the estimate: whole tile, half tile, none
    tile = box(0, 0, 100, 100)
    assert estimate_buildings([(tile, 80)], box(-50, -50, 150, 150)) == 80.0
    assert estimate_buildings([(tile, 80)], box(0, 0, 50, 100)) == 40.0
    assert estimate_buildings([(tile, 80)], box(200, 200, 300, 300)) == 0.0
    # a toy city end to end: one district, one tile, E4 only
    district: Polygon = box(*rd_bounds(0, 0))
    toy = build_table(candidates([(box(*rd_bounds(0, 0)), 3000)], {"Toy": district}))
    assert [s["id"] for s in toy["sheets"]] == ["canal-ring"] and toy["sheets"][0]["label"] == "E4 · Canal Ring"
    assert toy["sheets"][0]["kind"] == "core" and toy["totals"]["shipping"] == 1
    assert render_json(toy) == render_json(cast("SheetTable", json.loads(render_json(toy))))
    assert render_ts(toy) == render_ts(cast("SheetTable", json.loads(render_json(toy))))
    print("scripts/_sheets.py: self-test passed (70-cell index bijection, E4 anchor, rule edges, estimate, toy city)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--fetch", action="store_true", help="with --emit: download the two inputs if not cached")
    args = ap.parse_args()
    if args.emit:
        emit(args.fetch)
    elif args.check:
        problems = check_table(load_table())
        if problems:
            for p in problems:
                print("FAIL", p)
            raise SystemExit(1)
        t = load_table()["totals"]
        print(f"scripts/_sheets.py --check: {t['shipping']} sheets ({t['core']} core, {t['edge']} edge), "
              f"JSON canonical, TS == JSON, E4 == canal-ring")
    else:
        _self_test()


if __name__ == "__main__":
    main()
