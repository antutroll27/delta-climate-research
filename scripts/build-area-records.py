"""Per-area records for Amsterdam's 31 streamed areas (city-streaming phase P2c).

An AREA is one sheet of the whole-city tiling (scripts/_sheets.py). Canal Ring is area E4 and stays hand-written in
src/data/cities.ts; the other 31 become real records here, from the sheet pipeline's own outputs, so the page can load
any of them without building a stand-in at runtime (audit P3b: "synthetic ward for every non-E4 area").

    python3 scripts/build-area-records.py --self-test      # the rules, on synthetic data; no files
    python3 scripts/build-area-records.py --check          # the committed records vs their derived files and the tables
    python3 scripts/build-area-records.py --check --sources  # also vs the local build outputs (build.json + surface PNGs)
    python3 scripts/build-area-records.py --emit           # local: read the build outputs, rewrite all three files

DATA, NOT HAND-WRITTEN TS. The one source of truth is `data/cities/amsterdam/area-records.json`. Two files are derived from it:

    src/data/sheets/amsterdam-areas.ts          GENERATED: the 31 WardRecords (cities.ts spreads them into the Amsterdam wards) and the
                                                per-area facts (drawn counts for all 32 areas, scenes, provenance, the name credit)
    public/heat-map/data/surface-meta.json      one `wards` row per area, in the shape Canal Ring's row has (grid, footprint_m, veg_std,
                                                albedo_std, level, fvc_mean, albedo_mean, sunElevationFloorDeg, scenes); other keys and
                                                other rows are never touched

WHAT A RECORD CARRIES. Name (the wijk the area is mostly in, data/cities/amsterdam/area-names.json, CC0 1.0), centre, `frameLat`
(the lattice standard parallel, E4's latitude, REQUIRED: a record that forgets it would silently render in its own-latitude frame,
audit P2a S5, so there is no default anywhere on this path), footprint 2800 m, the DRAWN building count (sheets-build.json /
the exported file's `count`, not the lattice count), the surface-meta row, and the provenance lines. `sheet: true` and
`drawable: false` for every area, and TILED_CITY_READY stays false: nothing here is reachable on production.

THE SURFACE ROW IS MEASURED THE WAY THE EXPORTER MEASURES IT: `fvc_mean` and `albedo_mean` are the means of the QUANTISED PNG (what the
browser decodes), `veg_std` and `albedo_std` the floats' standard deviations (the sheet build records them), `scenes` the composite's
usable scene count, `sunElevationFloorDeg` the area's own floor (40, as Canal Ring's).
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import importlib.util
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Final, Literal, NewType, TypedDict, cast

import numpy as np
import numpy.typing as npt
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402
import _sheets  # noqa: E402
from _sheets import Kind, SheetCode, SheetId  # noqa: E402

HERE: Final = os.path.dirname(os.path.abspath(__file__))
CITY: Final = "amsterdam"
RECORDS_REL: Final = os.path.join("data", "cities", CITY, "area-records.json")
NAMES_REL: Final = os.path.join("data", "cities", CITY, "area-names.json")
BUILD_RECORD_REL: Final = os.path.join("data", "cities", CITY, "sheets-build.json")
TS_REL: Final = os.path.join("src", "data", "sheets", f"{CITY}-areas.ts")
SURFACE_META_REL: Final = os.path.join("public", "heat-map", "data", "surface-meta.json")

#: The surface raster is the 10 m grid of the 2,800 m square, like Canal Ring's.
SURFACE_GRID: Final = 280
FOOTPRINT_M: Final = _sheets.SIZE_M
#: Canal Ring's own scene rule (Task A8): only scenes with the sun at least this high are composited.
SUN_FLOOR_DEG: Final = 40.0
MIN_SCENES: Final = 20
#: The quantised mean and the float mean of the same composite agree to this (one 8-bit step of albedo is 0.002).
QUANT_TOLERANCE: Final = 0.003
#: A neutral stand-in, like Canal Ring's (cities.ts: "`swatch` is a neutral stand-in for the founder's visual review").
SWATCH: Final = "radial-gradient(circle at 40% 40%,#6fcad6,#9fb98a 58%,#093a3e)"

#: A NewType per unit-bearing or role-bearing string, so a name cannot be passed where a zone is wanted.
AreaName = NewType("AreaName", str)
Stadsdeel = NewType("Stadsdeel", str)


# ── the typed records ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class SurfaceMeta:
    """One surface-meta.json `wards` row, in Canal Ring's key order."""
    grid: int
    footprint_m: int
    veg_std: float
    albedo_std: float
    level: Literal["measured"]
    fvc_mean: float
    albedo_mean: float
    sun_elevation_floor_deg: float
    scenes: int

    def row(self) -> dict[str, object]:
        return {"grid": self.grid, "footprint_m": self.footprint_m, "veg_std": self.veg_std, "albedo_std": self.albedo_std,
                "level": self.level, "fvc_mean": self.fvc_mean, "albedo_mean": self.albedo_mean,
                "sunElevationFloorDeg": self.sun_elevation_floor_deg, "scenes": self.scenes}


@dataclass(frozen=True)
class Counts:
    #: buildings in the exported file: what the area DRAWS
    drawn: int
    #: lattice buildings whose centroid is in the half-open box (sheets.json `buildings`)
    in_box: int
    #: those also inside the municipality (sheets.json `municipalBuildings`)
    municipal: int
    #: in-box buildings whose footprint is under the sliver floor (not drawn), and buildings emitted as more than one part
    dropped_small: int
    multipart: int
    trees: int
    water: int
    green: int
    roads: int


@dataclass(frozen=True)
class AreaRecord:
    id: SheetId
    code: SheetCode
    kind: Kind
    name: AreaName
    stadsdeel: Stadsdeel
    zone: str
    body: str
    lat: float
    lon: float
    #: REQUIRED, no default: the lattice standard parallel
    frame_lat: float
    footprint_m: int
    veg: float
    swatch: str
    sheet: Literal[True]
    drawable: Literal[False]
    counts: Counts
    surface: SurfaceMeta
    #: where the wijk name came from, as area-names.json states it
    name_source: str
    provenance: tuple[str, ...]


@dataclass(frozen=True)
class Anchor:
    """E4: hand-written in cities.ts, so it has no WardRecord here; the picker needs its name and DRAWN count."""
    id: SheetId
    code: SheetCode
    name: AreaName
    stadsdeel: Stadsdeel
    drawn: int
    trees: int


@dataclass(frozen=True)
class AreaRecords:
    city: str
    frame_lat: float
    #: area-names.json's credit line, and the digest of the file the names were read from
    name_credit: str
    names_sha256: str
    anchor: Anchor
    areas: tuple[AreaRecord, ...]


# ── what the build left behind, for one area ───────────────────────────────

@dataclass(frozen=True)
class Measured:
    drawn: int
    in_box: int
    dropped_small: int
    multipart: int
    trees: int
    water: int
    green: int
    roads: int
    scenes: int
    ground_repaired: int
    fvc_std: float
    albedo_std: float
    #: means of the QUANTISED PNG
    fvc_mean_q: float
    albedo_mean_q: float
    #: the float means from the build record, to check the quantised ones against
    fvc_mean_f: float
    albedo_mean_f: float
    png_grid: int
    frame_lat: float


class NameEntry(TypedDict):
    name: str
    stadsdeel: str
    source: str


class NamesDoc(TypedDict):
    credit: str
    areas: dict[str, NameEntry]


@dataclass(frozen=True)
class Inputs:
    table: _sheets.SheetTable
    names: NamesDoc
    names_sha256: str
    measured: dict[str, Measured]
    anchor_drawn: int
    anchor_trees: int


# ── pure rules ──────────────────────────────────────────────────────────────

def js_round3(x: float) -> float:
    """`Math.round(x * 1000) / 1000` as the TS tests compute it (half rounds up), so Python and TS agree on a half."""
    return math.floor(x * 1000 + 0.5) / 1000


def zone_of(stadsdeel: str, code: str) -> str:
    return f"{stadsdeel} · area {code}"


def body_of(stadsdeel: str) -> str:
    return f"Gemeente Amsterdam, stadsdeel {stadsdeel} (largest share of the area)"


def provenance_of(name: str, name_source: str, m: Measured) -> tuple[str, ...]:
    repaired = (f"3D BAG ground repaired for {m.ground_repaired} building(s) where it disagreed with its neighbours (rule recorded in the build record)"
                if m.ground_repaired else "no 3D BAG ground repaired")
    return (
        f"Footprints and heights: 3D BAG v20250903 (tudelft3d + 3DGI, CC BY 4.0), heights from AHN5/AHN4/AHN3; {repaired}",
        "Terrain: AHN4 DTM 0.5 m via PDOK (Het Waterschapshuis, CC0)",
        f"Surface: Sentinel-2 L2A, {m.scenes} scenes with the sun at least {SUN_FLOOR_DEG:.0f} degrees up, reprojected onto the area's own lon/lat grid; level measured",
        "Water, green and roads: Overture Maps (OpenStreetMap, ODbL); canopy: Meta / WRI (CC BY 4.0)",
        f"Name: {name} ({name_source})",
    )


def build_records(inp: Inputs) -> AreaRecords:
    """The records from the tables and the measurements. Raises on anything missing: there is no default for a field."""
    table = inp.table
    lattice_frame_lat = float(cast(float, table["lattice"]["frameLat"]))
    areas: list[AreaRecord] = []
    for s in table["sheets"]:
        if s["code"] == _sheets.ANCHOR_CODE:
            continue
        m = inp.measured.get(s["id"])
        if m is None:
            raise SystemExit(f"{s['id']}: no build outputs to make a record from")
        entry = inp.names["areas"].get(s["code"])
        if entry is None or not entry["name"].strip():
            raise SystemExit(f"{s['code']}: area-names.json has no name for it")
        if m.frame_lat != lattice_frame_lat:
            raise SystemExit(f"{s['id']}: the build used frameLat {m.frame_lat}, the lattice standard parallel is {lattice_frame_lat}")
        areas.append(AreaRecord(
            id=SheetId(s["id"]), code=SheetCode(s["code"]), kind=s["kind"], name=AreaName(entry["name"]), stadsdeel=Stadsdeel(s["stadsdeel"]),
            zone=zone_of(s["stadsdeel"], s["code"]), body=body_of(s["stadsdeel"]), lat=s["centre"]["lat"], lon=s["centre"]["lon"],
            frame_lat=lattice_frame_lat, footprint_m=FOOTPRINT_M, veg=js_round3(m.fvc_mean_q), swatch=SWATCH, sheet=True, drawable=False,
            counts=Counts(drawn=m.drawn, in_box=m.in_box, municipal=s["municipalBuildings"], dropped_small=m.dropped_small, multipart=m.multipart, trees=m.trees, water=m.water, green=m.green, roads=m.roads),
            surface=SurfaceMeta(grid=m.png_grid, footprint_m=FOOTPRINT_M, veg_std=m.fvc_std, albedo_std=m.albedo_std, level="measured",
                                fvc_mean=round(m.fvc_mean_q, 4), albedo_mean=round(m.albedo_mean_q, 4), sun_elevation_floor_deg=SUN_FLOOR_DEG, scenes=m.scenes),
            name_source=entry["source"], provenance=provenance_of(entry["name"], entry["source"], m)))
    a = inp.names["areas"][_sheets.ANCHOR_CODE]
    anchor = Anchor(id=_sheets.ANCHOR_ID, code=_sheets.ANCHOR_CODE, name=AreaName(a["name"]), stadsdeel=Stadsdeel(a["stadsdeel"]),
                    drawn=inp.anchor_drawn, trees=inp.anchor_trees)
    return AreaRecords(city=CITY, frame_lat=lattice_frame_lat, name_credit=inp.names["credit"], names_sha256=inp.names_sha256, anchor=anchor, areas=tuple(areas))


def problems(doc: AreaRecords, table: _sheets.SheetTable, names: NamesDoc, anchor_drawn: int) -> list[str]:
    """Every invariant a committed record set must hold, without any build output (CI can run this)."""
    out: list[str] = []
    lattice_frame_lat = float(cast(float, table["lattice"]["frameLat"]))
    want = [s for s in table["sheets"] if s["code"] != _sheets.ANCHOR_CODE]
    if [r.id for r in doc.areas] != [s["id"] for s in want]:
        out.append(f"the records are not the table's {len(want)} non-anchor sheets in reading order")
    if doc.frame_lat != lattice_frame_lat or lattice_frame_lat != _sheets.FRAME_LAT:
        out.append(f"document frameLat {doc.frame_lat} vs lattice {lattice_frame_lat} vs _sheets.FRAME_LAT {_sheets.FRAME_LAT}")
    seen: dict[str, str] = {}
    for r, s in zip(doc.areas, want, strict=False):
        tag = str(r.id)
        if r.frame_lat != lattice_frame_lat:
            out.append(f"{tag}: frameLat {r.frame_lat} is not the lattice standard parallel {lattice_frame_lat}")
        if (r.lat, r.lon) != (s["centre"]["lat"], s["centre"]["lon"]):
            out.append(f"{tag}: centre ({r.lat}, {r.lon}) is not the sheet table's")
        if r.footprint_m != FOOTPRINT_M or r.surface.footprint_m != FOOTPRINT_M or r.surface.grid != SURFACE_GRID:
            out.append(f"{tag}: footprint/grid {r.footprint_m}/{r.surface.footprint_m}/{r.surface.grid}")
        e = names["areas"].get(str(r.code))
        if e is None or r.name != e["name"] or r.name_source != e["source"]:
            out.append(f"{tag}: name/source is not area-names.json's")
        if str(r.name) in seen:
            out.append(f"{tag}: name {r.name!r} is also {seen[str(r.name)]}'s")
        seen[str(r.name)] = tag
        if r.kind != s["kind"] or r.stadsdeel != s["stadsdeel"] or r.zone != zone_of(s["stadsdeel"], s["code"]) or r.body != body_of(s["stadsdeel"]):
            out.append(f"{tag}: kind/stadsdeel/zone/body disagree with the table")
        if r.counts.in_box != s["buildings"] or r.counts.municipal != s["municipalBuildings"]:
            out.append(f"{tag}: in-box/municipal counts {r.counts.in_box}/{r.counts.municipal} vs the table {s['buildings']}/{s['municipalBuildings']}")
        # a building cut into parts is emitted one row per part, so drawn = in box - slivers + extra parts, and each multipart building adds at least one
        if r.counts.drawn < r.counts.in_box - r.counts.dropped_small + r.counts.multipart or r.counts.drawn <= 0:
            out.append(f"{tag}: drawn {r.counts.drawn} is less than {r.counts.in_box} in the box - {r.counts.dropped_small} slivers + {r.counts.multipart} multipart extras")
        if r.surface.scenes < MIN_SCENES or r.surface.sun_elevation_floor_deg != SUN_FLOOR_DEG or r.surface.level != "measured":
            out.append(f"{tag}: surface row scenes/floor/level {r.surface.scenes}/{r.surface.sun_elevation_floor_deg}/{r.surface.level}")
        if r.veg != js_round3(r.surface.fvc_mean) or not 0 < r.veg < 1:
            out.append(f"{tag}: veg {r.veg} is not the surface row's fvc_mean {r.surface.fvc_mean} to three places")
        if not 0 < r.surface.albedo_mean < 0.5:
            out.append(f"{tag}: albedo_mean {r.surface.albedo_mean}")
        if len(r.provenance) < 4 or r.swatch != SWATCH:
            out.append(f"{tag}: provenance/swatch")
    if doc.anchor.drawn != anchor_drawn or doc.anchor.code != _sheets.ANCHOR_CODE or doc.anchor.id != _sheets.ANCHOR_ID:
        out.append(f"anchor E4: drawn {doc.anchor.drawn} vs the shipped canal-ring.json count {anchor_drawn}")
    if doc.name_credit != names["credit"]:
        out.append("the name credit is not area-names.json's")
    return out


# ── JSON <-> records ────────────────────────────────────────────────────────

def to_json(doc: AreaRecords) -> dict[str, object]:
    def area(r: AreaRecord) -> dict[str, object]:
        return {"id": r.id, "code": r.code, "kind": r.kind, "name": r.name, "stadsdeel": r.stadsdeel, "zone": r.zone, "body": r.body,
                "lat": r.lat, "lon": r.lon, "frameLat": r.frame_lat, "footprintM": r.footprint_m, "veg": r.veg, "swatch": r.swatch,
                "sheet": r.sheet, "drawable": r.drawable,
                "counts": {"drawn": r.counts.drawn, "inBox": r.counts.in_box, "municipal": r.counts.municipal, "droppedSmall": r.counts.dropped_small,
                           "multipart": r.counts.multipart, "trees": r.counts.trees,
                           "water": r.counts.water, "green": r.counts.green, "roads": r.counts.roads},
                "surfaceMeta": r.surface.row(), "nameSource": r.name_source, "provenance": list(r.provenance)}
    a = doc.anchor
    return {"city": doc.city, "frameLat": doc.frame_lat,
            "note": "Generated by scripts/build-area-records.py. src/data/sheets/amsterdam-areas.ts and the sheet rows of public/heat-map/data/surface-meta.json derive from this file. E4 (Canal Ring) is hand-written in cities.ts; its entry here is for the picker.",
            "nameCredit": doc.name_credit, "namesSha256": doc.names_sha256,
            "anchor": {"id": a.id, "code": a.code, "name": a.name, "stadsdeel": a.stadsdeel, "drawn": a.drawn, "trees": a.trees,
                       "source": "public/heat-map/data/canal-ring.json `count` and canal-ring-trees.json (the shipped files)"},
            "areas": [area(r) for r in doc.areas]}


def serialise(doc: AreaRecords) -> str:
    return json.dumps(to_json(doc), indent=1, ensure_ascii=False) + "\n"


def _d(x: object) -> dict[str, Any]:
    if not isinstance(x, dict):
        raise SystemExit(f"expected an object, got {type(x).__name__}")
    return cast("dict[str, Any]", x)


def from_json(raw: object) -> AreaRecords:
    d = _d(raw)
    a = _d(d["anchor"])

    def one(x: object) -> AreaRecord:
        r, c, s = _d(x), _d(_d(x)["counts"]), _d(_d(x)["surfaceMeta"])
        if r["sheet"] is not True or r["drawable"] is not False:
            raise SystemExit(f"{r['id']}: an area record must be sheet: true, drawable: false (TILED_CITY_READY is false)")
        return AreaRecord(
            id=SheetId(r["id"]), code=SheetCode(r["code"]), kind=r["kind"], name=AreaName(r["name"]), stadsdeel=Stadsdeel(r["stadsdeel"]),
            zone=r["zone"], body=r["body"], lat=float(r["lat"]), lon=float(r["lon"]), frame_lat=float(r["frameLat"]), footprint_m=int(r["footprintM"]),
            veg=float(r["veg"]), swatch=r["swatch"], sheet=True, drawable=False,
            counts=Counts(drawn=int(c["drawn"]), in_box=int(c["inBox"]), municipal=int(c["municipal"]), dropped_small=int(c["droppedSmall"]),
                          multipart=int(c["multipart"]), trees=int(c["trees"]), water=int(c["water"]),
                          green=int(c["green"]), roads=int(c["roads"])),
            surface=SurfaceMeta(grid=int(s["grid"]), footprint_m=int(s["footprint_m"]), veg_std=float(s["veg_std"]), albedo_std=float(s["albedo_std"]),
                                level=s["level"], fvc_mean=float(s["fvc_mean"]), albedo_mean=float(s["albedo_mean"]),
                                sun_elevation_floor_deg=float(s["sunElevationFloorDeg"]), scenes=int(s["scenes"])),
            name_source=r["nameSource"], provenance=tuple(str(p) for p in r["provenance"]))
    return AreaRecords(city=d["city"], frame_lat=float(d["frameLat"]), name_credit=d["nameCredit"], names_sha256=d["namesSha256"],
                       anchor=Anchor(id=SheetId(a["id"]), code=SheetCode(a["code"]), name=AreaName(a["name"]), stadsdeel=Stadsdeel(a["stadsdeel"]),
                                     drawn=int(a["drawn"]), trees=int(a["trees"])),
                       areas=tuple(one(x) for x in d["areas"]))


# ── the generated TS ────────────────────────────────────────────────────────

def _q(s: str) -> str:
    """A TS single-quoted string literal."""
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render_ts(doc: AreaRecords) -> str:
    wards: list[str] = []
    facts: list[str] = []
    for r in doc.areas:
        wards.append(f"  {{ id: {_q(r.id)}, name: {_q(r.name)}, zone: {_q(r.zone)}, body: {_q(r.body)},\n"
                     f"    lat: {json.dumps(r.lat)}, lon: {json.dumps(r.lon)}, frameLat: {json.dumps(r.frame_lat)}, veg: {json.dumps(r.veg)}, footprintM: {r.footprint_m},\n"
                     f"    swatch: {_q(r.swatch)} }},")
        c = r.counts
        prov = ", ".join(_q(p) for p in r.provenance)
        facts.append(f"  {_q(r.id)}: {{ code: {_q(r.code)}, kind: {_q(r.kind)}, name: {_q(r.name)}, stadsdeel: {_q(r.stadsdeel)}, drawn: {c.drawn}, inBox: {c.in_box}, "
                     f"municipal: {c.municipal}, trees: {c.trees}, water: {c.water}, green: {c.green}, roads: {c.roads}, scenes: {r.surface.scenes},\n"
                     f"    provenance: [{prov}] }},")
    a = doc.anchor
    facts.append(f"  {_q(a.id)}: {{ code: {_q(a.code)}, kind: 'core', name: {_q(a.name)}, stadsdeel: {_q(a.stadsdeel)}, drawn: {a.drawn}, trees: {a.trees} }},")
    return (
        "/* GENERATED by scripts/build-area-records.py from data/cities/amsterdam/area-records.json. DO NOT EDIT.\n"
        "   tests/unit/amsterdam-area-records.test.mjs and `python3 scripts/build-area-records.py --check` hold this file byte-equal to what the\n"
        "   generator renders from the JSON. The 31 WardRecords are the ward-table rows of the streamed areas (Canal Ring, E4, stays hand-written in\n"
        "   cities.ts); every one carries `frameLat`, the lattice standard parallel: there is no default on this path (audit P2a S5). */\n\n"
        "import type { WardRecord } from '../cities.ts';\n\n"
        f"/** The credit area-names.json states for the wijk names (CC0 1.0: courtesy, not a duty). */\n"
        f"export const AMSTERDAM_NAME_CREDIT = {_q(doc.name_credit)};\n\n"
        "/** The streamed areas' ward-table rows, reading order, E4 excluded. */\n"
        "export const AMSTERDAM_AREA_WARDS: readonly WardRecord[] = [\n" + "\n".join(wards) + "\n];\n\n"
        "/** Per-area facts for all 32 areas. `drawn` is the building count the area DRAWS (the picker shows it); E4's is its shipped file's. */\n"
        "export const AMSTERDAM_AREA_FACTS = {\n" + "\n".join(facts) + "\n} as const;\n")


# ── surface-meta.json ───────────────────────────────────────────────────────

def merged_surface_meta(text: str, doc: AreaRecords) -> str:
    """surface-meta.json with every area's row set; everything else byte for byte (the file round-trips through json.dumps(indent=2))."""
    meta = cast("dict[str, Any]", json.loads(text))
    wards = cast("dict[str, Any]", meta["wards"])
    for r in doc.areas:
        wards[str(r.id)] = r.surface.row()
    return json.dumps(meta, indent=2)


# ── reading the world ───────────────────────────────────────────────────────

def read(root: str, rel: str) -> str:
    with open(os.path.join(root, rel), encoding="utf-8") as fh:
        return fh.read()


def load_names(root: str) -> tuple[NamesDoc, str]:
    text = read(root, NAMES_REL)
    return cast(NamesDoc, json.loads(text)), hashlib.sha256(text.encode("utf-8")).hexdigest()


def shipped_anchor(root: str) -> tuple[int, int]:
    pub = os.path.join("public", "heat-map", "data")
    drawn = int(json.loads(read(root, os.path.join(pub, "canal-ring.json")))["count"])
    trees = len(cast("list[object]", json.loads(read(root, os.path.join(pub, "canal-ring-trees.json")))["trees"]))
    return drawn, trees


def _dequantise(q: npt.NDArray[np.uint8], lo: float, hi: float) -> npt.NDArray[np.float32]:
    """The exporter's own `dequantise` (scripts/export-surface-rasters.py), checked equal in --sources by `_exporter()`."""
    v: npt.NDArray[np.float32] = (q.astype(np.float32) / 255.0) * (hi - lo) + lo
    return v


def _exporter() -> Any:
    spec = importlib.util.spec_from_file_location("export_surface_rasters", os.path.join(HERE, "export-surface-rasters.py"))
    assert spec is not None and spec.loader is not None
    mod: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_measured(root: str, area_id: str, ranges: tuple[tuple[float, float], tuple[float, float]]) -> Measured:
    data = os.path.join(root, "data", "cities", CITY, area_id, "build.json")
    with open(data, encoding="utf-8") as fh:
        b = cast("dict[str, Any]", json.load(fh))
    c, s = b["counts"], b["surface"]
    if s["mode"] != "reprojected":
        raise SystemExit(f"{area_id}: surface mode {s['mode']!r}, expected the reprojected reader")
    pub = os.path.join(root, "public", "heat-map", "data")
    with open(os.path.join(pub, f"{area_id}.json"), encoding="utf-8") as fh:
        exported = int(json.load(fh)["count"])
    if exported != c["buildings"]:
        raise SystemExit(f"{area_id}: build record says {c['buildings']} buildings, the exported file {exported}")
    img = np.asarray(Image.open(os.path.join(pub, f"{area_id}-surface.png")).convert("RGB"))
    veg = _dequantise(img[:, :, 0], *ranges[0])
    alb = _dequantise(img[:, :, 1], *ranges[1])
    return Measured(drawn=int(c["buildings"]), in_box=int(c["inBox"]), dropped_small=int(c["droppedSmall"]), multipart=int(c["multipart"]), trees=int(c["trees"]), water=int(c["water"]), green=int(c["green"]), roads=int(c["roads"]),
                    scenes=int(s["scenes"]), ground_repaired=int(b["groundRepair"].get("repaired", 0)), fvc_std=float(s["fvcStd"]), albedo_std=float(s["albedoStd"]),
                    fvc_mean_q=float(veg.mean()), albedo_mean_q=float(alb.mean()), fvc_mean_f=float(s["fvcMean"]), albedo_mean_f=float(s["albedoMean"]),
                    png_grid=int(img.shape[0]), frame_lat=float(b["frameLat"]))


def gather(root: str) -> Inputs:
    table = _sheets.load_table(root)
    names, sha = load_names(root)
    ex = _exporter()
    ranges = (cast("tuple[float, float]", tuple(ex.VEG_RANGE)), cast("tuple[float, float]", tuple(ex.ALBEDO_RANGE)))
    measured = {s["id"]: read_measured(root, s["id"], ranges) for s in table["sheets"] if s["code"] != _sheets.ANCHOR_CODE}
    drawn, trees = shipped_anchor(root)
    return Inputs(table=table, names=names, names_sha256=sha, measured=measured, anchor_drawn=drawn, anchor_trees=trees)


def quant_problems(inp: Inputs) -> list[str]:
    return [f"{k}: quantised means (fvc {m.fvc_mean_q:.4f}, albedo {m.albedo_mean_q:.4f}) vs the build record's floats ({m.fvc_mean_f:.4f}, {m.albedo_mean_f:.4f})"
            for k, m in inp.measured.items()
            if abs(m.fvc_mean_q - m.fvc_mean_f) > QUANT_TOLERANCE or abs(m.albedo_mean_q - m.albedo_mean_f) > QUANT_TOLERANCE or m.png_grid != SURFACE_GRID]


# ── commands ────────────────────────────────────────────────────────────────

def check(root: str, sources: bool) -> int:
    table = _sheets.load_table(root)
    names, sha = load_names(root)
    anchor_drawn, _ = shipped_anchor(root)
    doc = from_json(json.loads(read(root, RECORDS_REL)))
    bad = problems(doc, table, names, anchor_drawn)
    if doc.names_sha256 != sha:
        bad.append("namesSha256 is not the digest of area-names.json")
    if read(root, RECORDS_REL) != serialise(doc):
        bad.append(f"{RECORDS_REL} is not in canonical form (re-run --emit, or the file was edited by hand)")
    if read(root, TS_REL) != render_ts(doc):
        bad.append(f"{TS_REL} differs from what the generator renders from {RECORDS_REL}")
    meta = cast("dict[str, Any]", json.loads(read(root, SURFACE_META_REL)))["wards"]
    for r in doc.areas:
        if meta.get(str(r.id)) != r.surface.row():
            bad.append(f"{SURFACE_META_REL}: the {r.id} row is not the record's")
    if sources:
        inp = gather(root)
        again = build_records(inp)
        if serialise(again) != serialise(doc):
            bad.append("the records differ from a fresh read of the build outputs (build.json, surface PNGs, exported files)")
        bad += quant_problems(inp)
    for m in bad:
        print("  FAIL", m)
    if not bad:
        print(f"  {len(doc.areas)} area records + E4's drawn count {doc.anchor.drawn}: JSON, TS and surface-meta agree; every frameLat is {doc.frame_lat}"
              + ("; and equal to a fresh read of the build outputs" if sources else ""))
    return 1 if bad else 0


def emit(root: str) -> int:
    inp = gather(root)
    q = quant_problems(inp)
    if q:
        print("\n".join(f"  FAIL {m}" for m in q))
        return 1
    doc = build_records(inp)
    bad = problems(doc, inp.table, inp.names, inp.anchor_drawn)
    if bad:
        print("\n".join(f"  FAIL {m}" for m in bad))
        return 1
    for rel, text in ((RECORDS_REL, serialise(doc)), (TS_REL, render_ts(doc)), (SURFACE_META_REL, merged_surface_meta(read(root, SURFACE_META_REL), doc))):
        with open(os.path.join(root, rel), "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"  wrote {rel} ({len(text) / 1e3:.1f} kB)")
    return 0


def _self_test() -> None:
    table = _sheets.load_table()
    names, sha = load_names(_city.ROOT)
    fl = _sheets.FRAME_LAT

    def fake(s: _sheets.SheetRow, **kw: Any) -> Measured:
        base: dict[str, Any] = dict(drawn=s["buildings"] - 5 + 4, in_box=s["buildings"], dropped_small=5, multipart=3, trees=10, water=2, green=3, roads=4, scenes=23, ground_repaired=2, fvc_std=0.28,
                                    albedo_std=0.04, fvc_mean_q=0.3836, albedo_mean_q=0.1075, fvc_mean_f=0.3836, albedo_mean_f=0.1075, png_grid=SURFACE_GRID, frame_lat=fl)
        return Measured(**(base | kw))

    def inputs(**over: dict[str, Any]) -> Inputs:
        return Inputs(table=table, names=names, names_sha256=sha, anchor_drawn=21342, anchor_trees=1,
                      measured={s["id"]: fake(s, **over.get(s["id"], {})) for s in table["sheets"] if s["code"] != "E4"})

    doc = build_records(inputs())
    assert len(doc.areas) == 31 and not problems(doc, table, names, 21342), problems(doc, table, names, 21342)
    assert all(r.frame_lat == fl for r in doc.areas)
    # round trip: JSON -> records -> JSON, and the TS is a pure function of the records
    again = from_json(json.loads(serialise(doc)))
    assert again == doc and serialise(again) == serialise(doc) and render_ts(again) == render_ts(doc)
    # no silent default: a build at another standard parallel is refused when the records are made ...
    try:
        build_records(inputs(**{"ams-f4": {"frame_lat": 52.4}}))
    except SystemExit:
        pass
    else:
        raise AssertionError("a build at another frameLat must be refused")
    # ... and a record set carrying one is reported by `problems`
    odd = dataclasses.replace(doc, areas=(dataclasses.replace(doc.areas[0], frame_lat=doc.areas[0].lat),) + doc.areas[1:])
    assert any("frameLat" in p for p in problems(odd, table, names, 21342))
    # a missing name is refused, a duplicate name and a wrong veg are reported, E4's count must be the shipped one
    try:
        build_records(dataclasses.replace(inputs(), names=cast(NamesDoc, {"credit": "c", "areas": {}})))
    except (SystemExit, KeyError):
        pass
    else:
        raise AssertionError("a missing name must be refused")
    dup = dataclasses.replace(doc, areas=(dataclasses.replace(doc.areas[1], name=doc.areas[0].name),) + doc.areas[1:2] + doc.areas[2:])
    assert any("is also" in p or "not area-names" in p for p in problems(dup, table, names, 21342))
    badveg = dataclasses.replace(doc, areas=(dataclasses.replace(doc.areas[0], veg=0.5),) + doc.areas[1:])
    assert any("veg" in p for p in problems(badveg, table, names, 21342))
    assert any("anchor E4" in p for p in problems(doc, table, names, 21341))
    # more drawn than the box holds is impossible; a thin composite is refused by the rule
    assert any("drawn" in p for p in problems(build_records(inputs(**{"ams-f4": {"drawn": 5}})), table, names, 21342))
    assert any("scenes" in p for p in problems(build_records(inputs(**{"ams-f4": {"scenes": 12}})), table, names, 21342))
    # js_round3 rounds a half up like Math.round
    assert js_round3(0.3835) == 0.384 and js_round3(0.3834) == 0.383
    # the TS escapes an apostrophe
    assert _q("'t Kalfje") == "'\\'t Kalfje'"
    # the surface-meta merge leaves every other key and row byte for byte
    base = json.dumps({"source": "s", "wards": {"canal-ring": {"grid": 280}, "mg-road": {"grid": 280}}}, indent=2)
    merged = json.loads(merged_surface_meta(base, doc))
    assert merged["wards"]["canal-ring"] == {"grid": 280} and merged["wards"]["mg-road"] == {"grid": 280} and merged["source"] == "s"
    assert len(merged["wards"]) == 2 + 31 and list(merged["wards"])[:2] == ["canal-ring", "mg-road"]
    print("build-area-records self-test: ok")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--sources", action="store_true", help="with --check: also compare with the local build outputs")
    ap.add_argument("--emit", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        _self_test()
        return 0
    if args.emit:
        return emit(_city.ROOT)
    if args.check:
        return check(_city.ROOT, args.sources)
    ap.error("one of --self-test, --check, --emit")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
