"""Build one SHEET of a tiled city: the per-sheet half of the whole-city batch (city-streaming P2b).

A sheet is a `_city.Area` made by `_sheets.sheet_area(i, j)`: its centre, E4's standard parallel (`frame_lat`) and its exact lattice box
(`box`). Every ingest below asks `_city.bounds(area)` and so gets the lattice's own floats (audit S4); every function here refuses an area
that is not such a sheet (`require_sheet`, audit B2: nothing may fall back to a centre and "cos of my own latitude").

What differs from Canal Ring's hand-run pipeline (`fetch-city.py`), and nothing else:

  * 3D BAG: the clip is the lattice's half-open lon/lat box (`_src_3dbag.build_rows`), tiles come from the city cache, and an
    implausible ground is repaired from the AHN4 ring (`repair_grounds`, switchable; Canal Ring's shipped file is ground-repaired too since #88).
  * AHN: read through a city-wide VRT over the 1 km cache (`_vrt`), audit S2.
  * CHM: through a VRT over both cached COGs, so the F column's straddle of lon 4.92187 E is no obstacle, audit S3.
  * Overture: the city-wide parquet, read once and pre-filtered per sheet.
  * Surface: Sentinel-2 crops REPROJECTED onto the sheet's own grid (`_sentinel.scene_arrays_box`), audit B1.

Outputs go where the caller says (`SheetOut`), so Canal Ring's committed files are never overwritten by an E4 test build.

    python3 scripts/_sheet_build.py     # self-test (offline, synthetic)
"""
from __future__ import annotations

import hashlib
import importlib.util
import itertools
import json
import os
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, NamedTuple, TypedDict, cast

import numpy as np
import numpy.typing as npt
from PIL import Image
from pyproj import Transformer
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402
import _sentinel  # noqa: E402
import _sheets  # noqa: E402
import _src_3dbag as bag  # noqa: E402
import _src_canopy as canopy  # noqa: E402
import _src_dem as dem  # noqa: E402
import _src_overture as ovt  # noqa: E402
import _vrt  # noqa: E402
from _city import Area, CityBuilding, CityBuildingsFile, CityCanopyFile, CityContextFile, CityTerrainFile  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
F32 = npt.NDArray[np.float32]
GuardStatus = Literal["pass", "fail", "recorded", "pending"]
SurfaceMode = Literal["reprojected", "none"]

#: Reflectance bands read for a surface, and the Earth Search item list the city crops were cut from.
SENTINEL_ITEMS: Final = "stac-selected-items.json"
MIN_SCENES: Final = 3


def city_raw() -> str:
    return os.path.join(_city.raw_dir(_sheets.CITY), "city")


def load_script(name: str) -> Any:
    """A hyphen-named script as a module (the repo's own idiom for scripts that other scripts reuse)."""
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), os.path.join(HERE, f"{name}.py"))
    assert spec is not None and spec.loader is not None
    mod: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@dataclass(frozen=True, slots=True)
class SheetOut:
    """Where one build writes. `data` gets `<id>-<layer>.json` and `<id>/`, `public` the browser files, `scratch` the clips and VRTs."""
    data: str
    public: str
    scratch: str


@dataclass(frozen=True, slots=True)
class SheetOptions:
    repair_ground: bool = True
    surface: SurfaceMode = "reprojected"
    #: Read the CHM the way Canal Ring's shipped canopy was (the one tile's COG, boundless: biased high, see `read_chm_metre`). Only the
    #: E4 byte-identity test sets it; every sheet reads the unbiased VRT.
    legacy_chm: bool = False
    #: The 'retrieved' date written into the documents. None = today. A byte-identity test passes the committed file's own.
    retrieved: str | None = None


class StepTime(NamedTuple):
    step: str
    seconds: float


class GuardSummary(TypedDict):
    id: str
    status: str
    north: float | None
    mirrored: float | None
    note: str


class BuildRecord(TypedDict):
    id: str
    code: str
    frameLat: float
    box: list[float]
    counts: dict[str, int]
    bytes: dict[str, int]
    groundRepair: dict[str, object]
    surface: dict[str, object]
    guards: list[GuardSummary]
    seconds: list[list[object]]
    wallSeconds: float


def require_sheet(area: Area) -> tuple[int, int]:
    """(i, j) of a sheet area, or a refusal. A sheet has E4's standard parallel and exactly its lattice box (audit B2/S4)."""
    if area.frame_lat is None or area.frame_parallel() != _sheets.FRAME_LAT:
        raise ValueError(f"{area.id}: not a sheet -- frame_lat {area.frame_lat!r} is not the lattice's {_sheets.FRAME_LAT}")
    if area.box is None:
        raise ValueError(f"{area.id}: not a sheet -- no lattice box")
    ij = _sheets.cell_of_point(area.centre.lon, area.centre.lat)
    if tuple(area.box) != _sheets.geo_bounds(*ij) or _city.bounds(area) != _sheets.geo_bounds(*ij):
        raise ValueError(f"{area.id}: box differs from the lattice cell {ij} (even one ulp is refused)")
    return ij


# ── city-wide readers ───────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class CityVrts:
    dtm: str
    dsm: str
    chm: str
    ahn_files: int


def build_vrts(scratch: str) -> CityVrts:
    """VRTs over the city's AHN blocks and its two CHM COGs, rebuilt each run (a header read per tile)."""
    raw = city_raw()
    ahn = os.path.join(raw, "ahn")
    names = sorted(os.listdir(ahn))
    out: dict[str, str] = {}
    for cov in ("dtm_05m", "dsm_05m"):
        files = [os.path.join(ahn, n) for n in names if n.startswith(cov + "_") and n.endswith(".tif")]
        out[cov] = os.path.join(scratch, "vrt", f"{cov}.vrt")
        _vrt.write_mosaic_vrt(out[cov], files)
    chm = [os.path.join(raw, "chm", n) for n in sorted(os.listdir(os.path.join(raw, "chm"))) if n.endswith(".tif")]
    chm_vrt = os.path.join(scratch, "vrt", "chm.vrt")
    _vrt.write_mosaic_vrt(chm_vrt, chm)
    return CityVrts(out["dtm_05m"], out["dsm_05m"], chm_vrt, len([n for n in names if n.endswith(".tif")]))


def tile_index() -> dict[str, tuple[Polygon, str]]:
    """tile_id -> (footprint in RD, path of its .gpkg.gz) from every WFS index saved in the city cache. A listed tile that is not
    on disk is an error at selection time, not here."""
    d = os.path.join(city_raw(), "3dbag")
    out: dict[str, tuple[Polygon, str]] = {}
    for name in sorted(os.listdir(d)):
        if name.startswith("tiles-") and name.endswith(".json"):
            with open(os.path.join(d, name), encoding="utf-8") as fh:
                doc = json.load(fh)
            for f in doc["features"]:
                tid = f["properties"]["tile_id"]
                out[tid] = (cast(Polygon, shape(f["geometry"])), os.path.join(d, tid.replace("/", "-") + ".gpkg.gz"))
    return out


def sheet_tiles(area: Area, index: dict[str, tuple[Polygon, str]]) -> list[str]:
    """Paths of the tiles that touch the sheet's box + TILE_PAD_M (sorted by tile id, as `list_tiles`), all required on disk."""
    minx, miny, maxx, maxy = _city.bounds_local_crs(area, bag.TILE_PAD_M)
    t = Transformer.from_crs(4326, area.local_crs, always_xy=True)
    w, s, e, n = _city.bounds(area, bag.TILE_PAD_M)
    ring = Polygon([t.transform(x, y) for x, y in _densify(w, s, e, n)])
    chosen = sorted(tid for tid, (g, _p) in index.items() if g.intersects(ring))
    assert minx < maxx and miny < maxy
    missing = [tid for tid in chosen if not os.path.isfile(index[tid][1])]
    if missing:
        raise SystemExit(f"{area.id}: 3D BAG tiles listed but not on disk: {missing}")
    return [index[tid][1] for tid in chosen]


def _densify(w: float, s: float, e: float, n: float, per: int = 16) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for k in range(per):
        pts.append((w + (e - w) * k / per, s))
    for k in range(per):
        pts.append((e, s + (n - s) * k / per))
    for k in range(per):
        pts.append((e - (e - w) * k / per, n))
    for k in range(per):
        pts.append((w, n - (n - s) * k / per))
    return pts


# ── documents ───────────────────────────────────────────────────────────────

def write_json(path: str, doc: object) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)
    return os.path.getsize(path)


def layer_path(out: SheetOut, area: Area, layer: str) -> str:
    return os.path.join(out.data, f"{area.id}-{layer}.json")


def memo_mosaic(read: dem.Mosaic) -> dem.Mosaic:
    """A mosaic reader that reads each coverage once (the buildings step and the terrain step both need it)."""
    cache: dict[str, tuple[F32, Any]] = {}

    def f(coverage: str, area: Area, raw: str) -> tuple[F32, Any]:
        if coverage not in cache:
            cache[coverage] = read(coverage, area, raw)
        return cache[coverage]
    return f


def post_ahn4_patches(rows: list[CityBuilding], raws: Sequence[bag.RawBuilding]) -> tuple[dem.GroundPatch, ...]:
    """`fetch-city.post_ahn4_patches`, from the raw buildings already in memory: the BAG construction year and the 3D BAG ground."""
    seen: dict[str, bag.RawBuilding] = {}
    for rb in raws:
        seen.setdefault(rb.src_id, rb)
    years = {k: v.build_year for k, v in seen.items()}
    patches: list[dem.GroundPatch] = []
    for sid in sorted(dem.post_ahn4_ids(rows, years)):
        rb = seen[sid]
        if rb.ground_nap is None or rb.build_year is None:
            continue
        patches.append(dem.GroundPatch(sid, rb.footprint, rb.ground_nap, rb.build_year))
    return tuple(patches)


class SurfaceResult(NamedTuple):
    fvc: F32
    albedo: F32
    scenes: int
    png_bytes: int
    dropped: tuple[tuple[str, str], ...]


def local_scene_items() -> list[dict[str, Any]]:
    with open(os.path.join(city_raw(), "sentinel", SENTINEL_ITEMS), encoding="utf-8") as fh:
        return cast("list[dict[str, Any]]", json.load(fh))


def sheet_composite(area: Area, items: Sequence[dict[str, Any]], sentinel_dir: str,
                    dropped: list[tuple[str, str]] | None = None) -> tuple[F32, F32, int]:
    """Per-cell median NDVI and albedo over the city's cached scenes, each REPROJECTED onto the sheet's own lon/lat grid.
    Every scene that is not used is appended to `dropped` as (scene id, why): unreadable (with the error) or under half valid."""
    require_sheet(area)
    n = _sentinel.grid_for(area.size_m)
    box = _city.bounds(area)
    ndvis: list[F32] = []
    albedos: list[F32] = []
    for feat in items:
        def href(band: str, _default: str, fid: str = feat["id"]) -> str:
            return os.path.join(sentinel_dir, f"{fid}_{band}.tif")
        failures = len(_sentinel.READ_FAILURES)
        got = _sentinel.scene_arrays_box(feat, box, n, href)
        if got is None:
            if dropped is not None:
                new = _sentinel.READ_FAILURES[failures:]
                dropped.append((feat["id"], f"unreadable: {new[0][1]}" if new else "under half of the cells valid"))
            continue
        ndvis.append(got[0])
        albedos.append(got[1])
    if len(ndvis) < MIN_SCENES:
        raise SystemExit(f"{area.id}: only {len(ndvis)} usable scenes -- refusing to build a surface that thin")
    return (np.nanmedian(np.stack(ndvis), axis=0).astype(np.float32), np.nanmedian(np.stack(albedos), axis=0).astype(np.float32), len(ndvis))


def build_surface(area: Area, png_path: str) -> SurfaceResult:
    """The sheet's surface PNG (R = vegetation fraction, G = albedo), at the MEASURED level (no DC-URS scalar to pin to)."""
    es = load_script("export-surface-rasters")
    dropped: list[tuple[str, str]] = []
    ndvi, albedo_raw, scenes = sheet_composite(area, local_scene_items(), os.path.join(city_raw(), "sentinel"), dropped)
    fvc = np.clip((es.fill_gaps(ndvi, _sentinel.NDVI_BARE) - _sentinel.NDVI_BARE) / (_sentinel.NDVI_VEG - _sentinel.NDVI_BARE), 0, 1).astype(np.float32)
    albedo = es.fill_gaps(albedo_raw, es.FALLBACK_ALBEDO)
    if fvc.std() < 1e-3 and albedo.std() < 1e-3:
        raise SystemExit(f"{area.id}: surface composite has no spatial variance -- a masking failure")
    r, g = es.quantise(fvc, *es.VEG_RANGE), es.quantise(albedo, *es.ALBEDO_RANGE)
    os.makedirs(os.path.dirname(png_path), exist_ok=True)
    Image.fromarray(np.dstack([r, g, np.zeros_like(r)]), mode="RGB").save(png_path, optimize=True)
    return SurfaceResult(fvc, albedo, scenes, os.path.getsize(png_path), tuple(dropped))


def centroids_in_sheet(raws: Sequence[bag.RawBuilding], area: Area) -> list[bool]:
    """Which raw buildings have their footprint centroid in the sheet's half-open lon/lat box (what `build_rows` keeps)."""
    if not raws:
        return []
    cx = np.array([r.footprint.centroid.x for r in raws])
    cy = np.array([r.footprint.centroid.y for r in raws])
    lon, lat = bag.rd_transformer()[0].transform(cx, cy)
    w, s_, e, n = _city.bounds(area)
    return [bool(v) for v in ((np.asarray(lon) >= w) & (np.asarray(lon) < e) & (np.asarray(lat) >= s_) & (np.asarray(lat) < n))]


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_documents(area: Area, b: CityBuildingsFile, ctx: CityContextFile, cp: CityCanopyFile, tr: CityTerrainFile) -> dict[str, dict[str, Any]]:
    """The browser JSON of a sheet, by file name: `export-city-obos.documents` from documents already in memory. Every sheet's
    record carries its frame's standard parallel as `frameLat` (audit S5): a record that forgot it would render with the sheet's
    own latitude and put a seam up to 4.8 m off with no test failing."""
    require_sheet(area)
    ex = load_script("export-city-obos")
    docs: dict[str, dict[str, Any]] = {
        f"{area.id}.json": ex.buildings_doc(area, b), f"{area.id}-roads.json": ex.roads_doc(area, ctx),
        f"{area.id}-water.json": ex.water_doc(area, ctx), f"{area.id}-trees.json": ex.trees_doc(area, cp, b["retrieved"]),
        f"{area.id}-terrain.json": ex.terrain_doc(area, tr)}
    assert area.frame_lat is not None                                      # require_sheet: no silent default
    docs[f"{area.id}.json"]["frameLat"] = float(area.frame_lat)
    return docs


# ── the build ───────────────────────────────────────────────────────────────

class Shared:
    """What every sheet of a batch reuses: the VRTs, the tile index, the city's Overture rows (read once)."""

    def __init__(self, scratch: str) -> None:
        self.vrts = build_vrts(scratch)
        self.index = tile_index()
        self._overture: dict[str, list[Any]] | None = None

    def overture(self) -> dict[str, list[Any]]:
        if self._overture is None:
            self._overture = ovt.read_tables(os.path.join(city_raw(), "overture"))
        return self._overture


def guard_note(g: dict[str, Any]) -> str:
    d = cast("dict[str, Any]", g.get("detail", {}))
    return str(d.get("note", ""))


def build_sheet(area: Area, out: SheetOut, shared: Shared, opt: SheetOptions, today: str) -> BuildRecord:
    """Buildings -> terrain -> context -> canopy -> surface -> export -> guards, for one sheet. Writes under `out`."""
    t_all = time.time()
    require_sheet(area)
    code = _sheets.code_of(*_sheets.cell_of_point(area.centre.lon, area.centre.lat))
    retrieved = opt.retrieved or today
    steps: list[StepTime] = []
    clip_dir = os.path.join(out.scratch, area.id, "ahn")
    os.makedirs(clip_dir, exist_ok=True)

    def timed(step: str, t0: float) -> None:
        steps.append(StepTime(step, round(time.time() - t0, 1)))
        print(f"    {area.id} {step}: {steps[-1].seconds}s", flush=True)

    # 1. buildings
    t0 = time.time()
    read_mosaic = memo_mosaic(dem.vrt_mosaic({"dtm_05m": shared.vrts.dtm, "dsm_05m": shared.vrts.dsm}))
    dtm, dtm_tf = read_mosaic("dtm_05m", area, clip_dir)
    dsm, _dsm_tf = read_mosaic("dsm_05m", area, clip_dir)
    timed("ahn mosaic + clips", t0)
    t0 = time.time()
    scratch_gz = os.path.join(out.scratch, area.id, "gz")
    raws = list(itertools.chain.from_iterable(bag.read_tile(p, scratch_gz) for p in sheet_tiles(area, shared.index)))
    try:
        os.rmdir(scratch_gz)
    except OSError:
        pass
    repair: bag.GroundReport | None = None
    if opt.repair_ground:
        raws, repair = bag.repair_grounds(raws, dtm, dtm_tf, dsm, centroids_in_sheet(raws, area))
    rows, st, mix = bag.build_rows(area, iter(raws))
    bdoc = bag.make_buildings_doc(area, rows, st, mix, retrieved)
    if repair is not None and repair.repaired:
        bdoc["heightNote"] += (f" GROUND PLAUSIBILITY: for {repair.repaired} building(s) 3D BAG's ground was more than {bag.GROUND_DROP_M:g} m below the "
                               f"median of the {bag.GROUND_MIN_NEIGHBOURS}+ buildings within {bag.GROUND_NEIGHBOUR_R_M:g} m (or, with fewer neighbours, a building "
                               f"older than the AHN4 survey whose AHN4 height agrees); their ground is the 5th percentile of the AHN4 DTM ring around the "
                               f"footprint (hSource '3dbag-p70-ahn4-ground'). Never raises a height; never leaves a part under {bag.MIN_REPAIRED_HEIGHT_M:g} m; "
                               f"never applied to buildings from {bag.AHN4_FLIGHT_YEAR} on.")
    timed("buildings (3D BAG)", t0)

    # 2. G5 annotate (hCheck / flag), which the terrain patch selection reads
    t0 = time.time()
    cf = load_script("check-city-frame")
    cf.DATA_DIR, cf.PUBLIC_DIR, cf.AHN_DIR = out.data, out.public, clip_dir
    years = {r.src_id: r.build_year for r in raws}
    g5, n70 = cf.g5_v2(area, rows, years)
    flagged = 0
    for r, v in zip(rows, n70, strict=True):
        if np.isfinite(v):
            r["hCheck"] = round(float(v), 2)
            r["flag"] = abs(r["h"] - float(v)) > cf.DISAGREE_M
            flagged += int(r["flag"])
        else:
            r["hCheck"], r["flag"] = None, False
    bdoc["crossCheck"] = (f"AHN4 nDSM p70 (guard G5): hCheck on {int(np.isfinite(n70).sum())} of {len(n70)} buildings, "
                          f"{flagged} flagged where |h - hCheck| > {cf.DISAGREE_M:g} m; hCheck is never blended into h")
    bdoc["b"] = rows
    sizes = {"buildings": write_json(layer_path(out, area, "buildings"), bdoc)}
    timed("G5 heights + annotate", t0)

    # 3. terrain (with the post-AHN4 pit patch the annotation enables)
    t0 = time.time()
    patches = post_ahn4_patches(rows, raws)
    tdoc, _report = dem.build_terrain(area, clip_dir, retrieved, patches, read_mosaic)
    sizes["terrain"] = write_json(layer_path(out, area, "terrain"), tdoc)
    timed("terrain (AHN)", t0)

    # 4. context + canopy
    t0 = time.time()
    tables = ovt.tables_in_box(shared.overture(), _city.bounds(area, ovt.SCAN_PAD_M))
    ctx, _cs = ovt.build_context(area, "", tables)
    assert not ovt.validate_context_file(area, ctx)
    sizes["context"] = write_json(layer_path(out, area, "context"), ctx)
    timed("context (Overture)", t0)
    t0 = time.time()
    if opt.legacy_chm:
        tile = canopy.chm_path(area, canopy.kolkata_rule()).rsplit("/", 1)[1]
        cdoc, _path = canopy.build_canopy(area, ctx, bdoc, chm_override=os.path.join(city_raw(), "chm", tile), boundless=True)
    else:
        cdoc, _path = canopy.build_canopy(area, ctx, bdoc, chm_override=shared.vrts.chm)
        cdoc["source"] = cdoc["source"].replace("tile chm.vrt", "tiles 1202021101 and 1202021110 (mosaic)")
    sizes["canopy"] = write_json(layer_path(out, area, "canopy"), cdoc)
    timed("canopy (CHM)", t0)

    # 5. surface
    surf: dict[str, object] = {"mode": opt.surface}
    if opt.surface == "reprojected":
        t0 = time.time()
        sr = build_surface(area, os.path.join(out.public, f"{area.id}-surface.png"))
        sizes["surface"] = sr.png_bytes
        surf |= {"scenes": sr.scenes, "scenesDropped": [list(d) for d in sr.dropped], "fvcMean": round(float(sr.fvc.mean()), 4), "albedoMean": round(float(sr.albedo.mean()), 4),
                 "fvcStd": round(float(sr.fvc.std()), 4), "albedoStd": round(float(sr.albedo.std()), 4)}
        timed("surface (reprojected Sentinel-2)", t0)

    # 6. browser documents
    t0 = time.time()
    for name, doc in export_documents(area, bdoc, ctx, cdoc, tdoc).items():
        path = os.path.join(out.public, name)
        os.makedirs(out.public, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")))
        sizes[name.removeprefix(area.id + "-").removesuffix(".json") or "export"] = os.path.getsize(path)
    timed("export", t0)

    # 7. guards
    t0 = time.time()
    guards = run_guards(area, cf, bdoc, ctx, tdoc, g5, opt.surface == "reprojected")
    timed("guards G1-G8", t0)
    for f in ("dtm_05m_clip.tif", "dsm_05m_clip.tif"):                       # my own scratch, ~160 MB per sheet
        p = os.path.join(clip_dir, f)
        if os.path.isfile(p):
            os.remove(p)
    return BuildRecord(
        id=area.id, code=code, frameLat=float(area.frame_lat or 0.0), box=list(_city.bounds(area)),
        counts={"buildings": len(rows), "rawBuildings": st.raw_buildings, "inBox": st.inside_square, "droppedSmall": st.dropped_small,
                "multipart": st.multipart_buildings, "invalidRepaired": st.invalid_repaired, "trees": cdoc["count"], "water": len(ctx["water"]),
                "green": len(ctx["green"]), "roads": len(ctx["roads"]), "hCheck": sum(1 for r in rows if r["hCheck"] is not None),
                "flagged": flagged, "postAhn4Patches": len(patches)},
        bytes=sizes,
        groundRepair=({} if repair is None else {
            "inSheet": repair.buildings, "checkedRing": repair.checked_ring, "repaired": repair.repaired, "widened": repair.widened,
            "maxLoweredM": round(repair.max_drop_m, 2), "outcomes": dict(repair.outcomes),
            "changes": [[i, round(o, 3), round(n, 3)] for i, o, n in repair.changes],
            "kept": [[i, why] for i, why in repair.kept]}),
        surface=surf, guards=guards, seconds=[[s.step, s.seconds] for s in steps], wallSeconds=round(time.time() - t_all, 1))


def landmarks_inside(area: Area, cf: Any) -> int:
    path = cf.landmarks_path(area)
    if not os.path.isfile(path):
        return 0
    w, s, e, n = _city.bounds(area)
    with open(path, encoding="utf-8") as fh:
        return sum(1 for lm in json.load(fh)["landmarks"] if w <= lm["lon"] < e and s <= lm["lat"] < n)


def run_guards(area: Area, cf: Any, b: CityBuildingsFile, ctx: CityContextFile, terrain: CityTerrainFile,
               g5: dict[str, Any], surface_built: bool) -> list[GuardSummary]:
    """G1-G8 for a sheet, written to `<data>/<id>/frame-guard.json` (G5/G6 measured here, from the clips). G3, G5, G6 and G7 use the sheet
    rules of check-city-frame (`*_v2`, P2b audit S1), each of which also runs its mirrored / turned / shifted controls and must see them
    FAIL. A guard with no evidence in this sheet (too little water, fewer than two Wikidata landmarks, too few pre-AHN4 buildings) is
    recorded `pending` with the reason, never forced to pass or fail on nothing."""
    rows = b["b"]
    recs: list[dict[str, Any]] = [cf.g1_frame_parity(area), cf.g2_ring_self_consistency(area, rows)]

    def pending(gid: str, name: str, why: str) -> dict[str, Any]:
        rec: dict[str, Any] = cf.record(gid, name, "-", "-", "-", "pending", None, None, note=why)
        return rec

    n_water = len([w for w in ctx["water"] if w.get("p")])
    recs.append(cf.g3_v2(area, rows, ctx))
    recs.append(cf.g4_landmarks(area, rows) if landmarks_inside(area, cf) >= 2 else
                pending("G4", "landmarks", "fewer than 2 Wikidata landmarks in this sheet; the city-level G4 over the assembled sheets covers it"))
    recs.append(g5)
    recs.append(cf.g6_v2(area, rows, ctx))
    recs.append(cf.g7_v2(area, ctx) if surface_built else pending("G7", "surface raster (v2 rule)", "no surface built"))
    recs.append(cf.g8_export(area, terrain))
    water_level = cf.water_level_evidence(area, ctx) if n_water >= 3 else {}
    doc = {"city": area.city, "area": area.id, "measuredAt": time.strftime("%Y-%m-%d"),
           "inputs": cf.input_hashes(area), "guards": recs, "waterLevel": water_level, "frameLat": float(area.frame_lat or 0.0)}
    write_json(cf.frame_guard_path(area), doc)
    return [GuardSummary(id=g["id"], status=str(g["status"]), north=g["north"], mirrored=g["mirrored"], note=guard_note(g)) for g in recs]


def _read_build(data: str, sheet_id: str) -> BuildRecord | None:
    path = os.path.join(data, sheet_id, "build.json")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return cast(BuildRecord, json.load(fh))


class Seam(NamedTuple):
    pair: str
    layer: str
    across: float          # mean |difference| of the two edge columns/rows that face each other across the seam
    within: float          # mean |difference| of the two outermost columns/rows INSIDE one sheet (the natural step)
    ratio: float


def _edge_ratio(a: npt.NDArray[np.float64], b: npt.NDArray[np.float64], axis: str) -> tuple[float, float]:
    """(across, within): a is the west/south sheet, b the east/north one; arrays are indexed [row, col]."""
    if axis == "ew":
        return float(np.abs(a[:, -1] - b[:, 0]).mean()), float(np.mean([np.abs(a[:, -1] - a[:, -2]).mean(), np.abs(b[:, 1] - b[:, 0]).mean()]))
    return float(np.abs(a[-1, :] - b[0, :]).mean()), float(np.mean([np.abs(a[-1, :] - a[-2, :]).mean(), np.abs(b[1, :] - b[0, :]).mean()]))


def seam_continuity(data: str, public: str, sheets: list[_sheets.SheetRow]) -> list[Seam]:
    """G10-DATA, the part of G10 that exists without the TypeScript halo bake: across every shared edge of two built sheets, the
    terrain mesh (96 x 96, row 0 = SOUTH) and the surface veg channel (280 x 280, row 0 = NORTH) should step no more than they
    step inside a sheet. A registration error (audit B1) shows as a ratio far above 1 in the surface."""
    by_cell = {(s["i"], s["j"]): s for s in sheets if os.path.isfile(os.path.join(public, f"{s['id']}-terrain.json"))}
    out: list[Seam] = []

    def terrain(sid: str) -> npt.NDArray[np.float64]:
        with open(os.path.join(data, f"{sid}-terrain.json"), encoding="utf-8") as fh:
            t = json.load(fh)
        return np.asarray(t["h"], dtype=np.float64).reshape(t["n"], t["n"])           # row 0 = SOUTH

    def veg(sid: str) -> npt.NDArray[np.float64] | None:
        p = os.path.join(public, f"{sid}-surface.png")
        return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)[:, :, 0] / 255.0 if os.path.isfile(p) else None   # row 0 = NORTH

    for (i, j), a in sorted(by_cell.items()):
        for di, dj, axis in ((1, 0, "ew"), (0, 1, "ns")):
            b = by_cell.get((i + di, j + dj))
            if b is None:
                continue
            tag = f"{a['code']}|{b['code']}"
            ta, tb = terrain(a["id"]), terrain(b["id"])
            c, w = _edge_ratio(ta, tb, axis)                                          # terrain: row 0 south, so b (north) is the later row
            out.append(Seam(tag, "terrain", c, w, c / w if w else float("inf")))
            va, vb = veg(a["id"]), veg(b["id"])
            if va is not None and vb is not None:
                # surface is north-up: for a north-south pair the NORTH sheet's last row meets the south sheet's first row
                c, w = _edge_ratio(va, vb, "ew") if axis == "ew" else _edge_ratio(vb, va, "ns")
                out.append(Seam(tag, "surface", c, w, c / w if w else float("inf")))
    return out


def aggregate(table: _sheets.SheetTable, data: str) -> dict[str, object]:
    """One small committed record of what the batch built: per sheet the counts, output sizes, wall time and guard statuses."""
    rows: list[dict[str, object]] = []
    anchor_row: dict[str, object] | None = None
    for s in table["sheets"]:
        if s["id"] == _sheets.ANCHOR_ID:
            # E4 is not built by the batch; the picker needs its DRAWN count, which is its shipped file's `count` (P2c)
            with open(os.path.join(_city.PUBLIC, "canal-ring.json"), encoding="utf-8") as fh:
                anchor_row = {"code": s["code"], "id": s["id"], "kind": s["kind"], "buildings": int(json.load(fh)["count"]), "anchor": True,
                              "source": "public/heat-map/data/canal-ring.json `count` (the shipped file; not built by the batch)"}
            continue
        rec = _read_build(data, s["id"])
        if rec is None:
            continue
        rows.append({"code": s["code"], "id": s["id"], "kind": s["kind"], "buildings": rec["counts"]["buildings"], "trees": rec["counts"]["trees"],
                     "groundRepaired": rec["groundRepair"].get("repaired", 0), "wallSeconds": rec["wallSeconds"],
                     "outputBytes": sum(rec["bytes"].values()), "guards": {g["id"]: g["status"] for g in rec["guards"]}})
    return {"city": _sheets.CITY, "frameLat": _sheets.FRAME_LAT, "built": len(rows), "of": len(table["sheets"]) - 1,
            "note": "E4 (Canal Ring) is never built into the repo's data dir: see build-city-sheets.py --e4-identity / --e4-new",
            "totals": {"wallSeconds": round(sum(float(cast(float, r["wallSeconds"])) for r in rows), 1),
                       "outputBytes": sum(int(cast(int, r["outputBytes"])) for r in rows)},
            "sheets": rows if anchor_row is None else [*rows, anchor_row]}


def cross_checks(table: _sheets.SheetTable) -> int:
    """Everything that needs more than one sheet: G9a on the rows that ingest EMITTED, G9b/c/d on the table, G10-data seams."""
    data, public = _city.data_dir(_sheets.CITY), _city.PUBLIC
    problems = _sheets.check_table(table)
    print(f"G9b/G9c/G9d (table): {'pass' if not problems else problems[:3]}")
    built = [(s, rec) for s in table["sheets"] if s["code"] != "E4" and (rec := _read_build(data, s["id"])) is not None]
    print(f"{len(built)} of {len(table['sheets']) - 1} non-anchor sheets built")
    scratch = os.path.join(_sheets.BAG_CITY_DIR, "scratch")
    b = _sheets.read_city_buildings(_sheets.BAG_CITY_DIR, scratch)
    lon, lat = _sheets.city_lonlat(b)
    ci, cj = _sheets.cells_of(lon, lat)
    cell = dict(zip(b.ids, zip(ci.tolist(), cj.tolist(), strict=True), strict=True))
    members: dict[tuple[int, int], int] = {}
    for c in cell.values():
        members[c] = members.get(c, 0) + 1
    seen: dict[str, str] = {}
    for s, rec in built:
        with open(os.path.join(data, f"{s['id']}-buildings.json"), encoding="utf-8") as fh:
            ids = {r["src_id"].split("#")[0] for r in json.load(fh)["b"]}
        wrong = [i for i in ids if cell.get(i) != (s["i"], s["j"])]
        dup = [i for i in ids if i in seen]
        for i in ids:
            seen[i] = s["code"]
        want = members.get((s["i"], s["j"]), 0)
        if wrong:
            problems.append(f"G9a {s['code']}: {len(wrong)} emitted buildings are not in this sheet's half-open cell, e.g. {wrong[:2]}")
        if dup:
            problems.append(f"G9a {s['code']}: {len(dup)} buildings already emitted by another sheet, e.g. {dup[:2]} (in {seen[dup[0]]})")
        if rec["counts"]["inBox"] != want:
            problems.append(f"G9a {s['code']}: ingest kept {rec['counts']['inBox']} buildings in the box, the partition says {want}")
        if len(ids) + rec["counts"]["droppedSmall"] < want:
            problems.append(f"G9a {s['code']}: {want - len(ids)} partition buildings missing from the file but only {rec['counts']['droppedSmall']} slivers dropped")
    print(f"G9a on the EMITTED rows: {len(seen)} distinct buildings in {len(built)} files, none twice, each in its own half-open cell; "
          f"ingest's in-box count equals the partition's for every built sheet: {not [p for p in problems if p.startswith('G9a')]}")
    seams = seam_continuity(data, public, [s for s, _ in built] + [s for s in table["sheets"] if s["code"] == "E4"])
    picks: list[tuple[str, Callable[[Seam], bool]]] = [
        ("new sheets only", lambda x: "E4" not in x.pair.split("|")),
        ("seams touching E4 (its surface is Canal Ring's shipped one)", lambda x: "E4" in x.pair.split("|"))]
    for label, pick in picks:
        for layer in ("terrain", "surface"):
            sel = [x for x in seams if x.layer == layer and pick(x)]
            if sel:
                r = sorted(x.ratio for x in sel)
                worst = max(sel, key=lambda x: x.ratio)
                print(f"G10-data {layer} [{label}]: {len(r)} seams, across/within ratio median {r[len(r) // 2]:.2f}, p90 {r[int(len(r) * 0.9)]:.2f}, "
                      f"max {worst.ratio:.2f} ({worst.pair})")
    for p in problems:
        print("FAIL", p)
    agg = aggregate(table, data)
    write_json(os.path.join(data, "sheets-build.json"), agg)
    print(f"wrote sheets-build.json: {agg['built']} sheets, totals {agg['totals']}")
    return 1 if problems else 0


# ── self-test ───────────────────────────────────────────────────────────────

def _self_test() -> None:
    import dataclasses as dc

    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    # S4: every ingest asks `_city.bounds`, and for every shipping sheet that IS the lattice's float tuple, to the last bit.
    table = _sheets.load_table()
    for s in table["sheets"]:
        a = _sheets.sheet_area(s["i"], s["j"])
        assert require_sheet(a) == (s["i"], s["j"])
        assert _city.bounds(a) == _sheets.geo_bounds(s["i"], s["j"]) == tuple(s["wgs84Bounds"]), s["code"]
        assert a.frame_lat == s["frameLat"] == _sheets.FRAME_LAT
    # a box that differs by one ulp, an area without frame_lat, an area without a box: all refused
    a = _sheets.sheet_area(1, 0)
    w, so, e, n = a.box or (0.0, 0.0, 0.0, 0.0)
    import math
    for bad in (dc.replace(a, box=(math.nextafter(w, 0.0), so, e, n)), dc.replace(a, box=(w, so, math.nextafter(e, 9.0), n)),
                dc.replace(a, frame_lat=None), dc.replace(a, box=None), _city.AREAS["canal-ring"]):
        try:
            require_sheet(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{bad.id} must be refused as a sheet")
    # S4: the ingest's own bounds object. Spy on `_city.bounds` while the real ingest functions run on synthetic data.
    seen: list[tuple[float, float, float, float]] = []
    real = _city.bounds

    def spy(area: Area, pad_m: float = 0.0) -> tuple[float, float, float, float]:
        got = real(area, pad_m)
        if pad_m == 0.0:
            seen.append(got)
        return got
    setattr(_city, "bounds", spy)
    try:
        for s in table["sheets"]:
            sa = _sheets.sheet_area(s["i"], s["j"])
            seen.clear()
            # AHN mesh grid
            dem.to_mesh(np.zeros((8, 8), dtype=np.float32), from_origin(0, 8, 1, 1), sa, 4, Resampling.average)
            # 3D BAG clip: a building at the sheet's centre is kept, one just outside is dropped, and the clip read `_city.bounds`
            tr = bag.rd_transformer()[0]
            cx, cy = Transformer.from_crs(4326, 28992, always_xy=True).transform(sa.centre.lon, sa.centre.lat)
            sq = Polygon([(cx, cy), (cx + 10, cy), (cx + 10, cy + 8), (cx, cy + 8)])
            rows, _, _ = bag.build_rows(sa, iter([bag.RawBuilding("x", sq, (bag.Part(0, sq, 9.5),), 0.5, True, False, "ahn5", 2023)]))
            assert len(rows) == 1 and tr is not None
            assert seen and all(b == _sheets.geo_bounds(s["i"], s["j"]) for b in seen), (s["code"], seen)
    finally:
        setattr(_city, "bounds", real)
    # run_guards returns EVERY guard G1-G8, in order, and records what has no evidence as pending (a slice once dropped G8 silently)
    import tempfile
    from types import SimpleNamespace

    def rec(gid: str, status: str = "pass") -> dict[str, Any]:
        return {"id": gid, "name": gid, "status": status, "north": 1.0, "mirrored": 0.0, "detail": {}}
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as td:
        stub = SimpleNamespace(
            g1_frame_parity=lambda a: rec("G1"), g2_ring_self_consistency=lambda a, r: rec("G2"), g3_v2=lambda a, r, c: rec("G3", "pending"),
            g4_landmarks=lambda a, r: rec("G4"), g6_v2=lambda a, r, c: rec("G6"), g7_v2=lambda a, c: rec("G7", "pending"),
            g8_export=lambda a, t: rec("G8"), record=lambda gid, name, ev, st, ru, status, n, m, **d: {**rec(gid, status), "detail": d},
            water_level_evidence=lambda a, c: {}, landmarks_path=lambda a: "/nonexistent",
            frame_guard_path=lambda a: os.path.join(td, "fg.json"), input_hashes=lambda a: {})
        bare = cast(Any, {"b": [], "retrieved": ""})
        got = run_guards(_sheets.sheet_area(2, 0), stub, bare, cast(Any, {"water": [], "green": []}), cast(Any, {}), rec("G5"), True)
        assert [g["id"] for g in got] == ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"], [g["id"] for g in got]
        assert {g["id"]: g["status"] for g in got} == {"G1": "pass", "G2": "pass", "G3": "pending", "G4": "pending", "G5": "pass", "G6": "pass",
                                                       "G7": "pending", "G8": "pass"}
    # a padded request (the Overture scan, the tile query, the AHN pad) grows the lattice box by exactly pad / (m per degree), never re-derives it
    for s in table["sheets"]:
        sa = _sheets.sheet_area(s["i"], s["j"])
        mx, my = _city.frame_m_per_deg(sa)
        w0, s0, e0, n0 = _sheets.geo_bounds(s["i"], s["j"])
        assert _city.bounds(sa, 50.0) == (w0 - 50.0 / mx, s0 - 50.0 / my, e0 + 50.0 / mx, n0 + 50.0 / my), s["code"]
    # no ingest module derives its own box: none of them spells the frame's constants or takes a cosine itself (they go through _city)
    import re
    for mod in ("_src_3dbag.py", "_src_dem.py", "_src_canopy.py", "_src_overture.py", "_sheet_build.py", "_vrt.py"):
        with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
            text = fh.read().split("def _self_test")[0]
        hits = re.findall(r"111_?320|110_?540|\bcos\(|(?<!frame_)m_per_deg\(", text)
        assert not hits, f"{mod} derives its own frame scale: {hits}"
    # the half-open clip: a centroid exactly on the shared meridian belongs to ONE sheet (the east one)
    west, east = _sheets.sheet_area(0, 0), _sheets.sheet_area(1, 0)
    lon_e = _sheets.lon_edge(1)
    lat_c = west.centre.lat
    x, y = Transformer.from_crs(4326, 28992, always_xy=True).transform(lon_e, lat_c)
    # move to the exact RD point whose WGS84 image is the seam (round trip), then test membership by the clip's own rule
    inv = Transformer.from_crs(28992, 4326, always_xy=True)
    lon_rt, _ = inv.transform(x, y)
    for a_, want in ((west, lon_rt < lon_e), (east, lon_rt >= lon_e)):
        w_, s_, e_, n_ = _city.bounds(a_)
        assert (w_ <= lon_rt < e_) == want
    # S5: a sheet's export record carries frameLat, and a build over a non-sheet is refused before it writes anything
    assert dc.replace(_sheets.sheet_area(2, 1), frame_lat=None).frame_lat is None
    try:
        export_documents(dc.replace(_sheets.sheet_area(2, 1), frame_lat=None), cast(Any, {}), cast(Any, {}), cast(Any, {}), cast(Any, {}))
    except ValueError:
        pass
    else:
        raise AssertionError("an export for an area without frame_lat must be refused")
    print(f"_sheet_build self-test: ok ({len(table['sheets'])} sheets: ingest bounds are the lattice's floats bit for bit; 1 ulp, no frame_lat, no box refused; half-open clip; S5)")


if __name__ == "__main__":
    _self_test()
