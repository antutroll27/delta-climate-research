"""3D BAG adapter: Dutch building footprints + per-building roof height.

SOURCE (verified 2026-11-06, see data/cities/amsterdam/sources.json): release
`v20250903` of 3D BAG (TU Delft 3D geoinformation group + 3DGI), CC BY 4.0. Per-tile
GeoPackages (`tiles/{x}/{y}/{z}/{x}-{y}-{z}.gpkg.gz`) are chosen over paging the API:
one WFS call lists the tiles that touch the box, each tile carries its own sha256.

WHAT A TILE HOLDS (measured on tile 10/428/718):
  * `pand`       -- one POLYGON per building (the BAG footprint), EPSG:7415 (RD + NAP);
                    no holes in the sample. Carries `b3_h_maaiveld` (ground, NAP),
                    `b3_kwaliteitsindicator`, `b3_pw_onvoldoende`, `b3_pw_bron`,
                    `b3_pw_datum`.
  * `lod12_2d`   -- one POLYGON per building PART, with `b3_h_70p` = the 70th percentile
                    of roof elevation (NAP). 703 buildings -> 705 parts: a building is cut
                    into parts only when underground parts require it.
The API's `b3_h_dak_70p` is the building-level form of `b3_h_70p`.

THE HEIGHT RULE. h = b3_h_70p - b3_h_maaiveld, both NAP metres. A building with ONE
part takes the whole BAG footprint. A building with several parts (0.3 % of the sample)
is emitted as one row per part -- the BAG footprint clipped to the part polygon -- because
the parts can differ by 10 m or more, and a max or a mean would be wrong for most of the
footprint either way. Null heights, or `b3_pw_onvoldoende`, take the shared 2.5 m fill and
are counted, never hidden.

THE LOCAL FRAME is `_city.to_local`. RD -> WGS84 goes through pyproj's default
EPSG:28992 -> EPSG:4326 operation; the operation actually used and its stated accuracy
are recorded in the output's `heightNote`.
"""
from __future__ import annotations

import dataclasses
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import struct
import time
from dataclasses import dataclass
from collections.abc import Sequence
from typing import Final, Iterator, Literal, NamedTuple, TypedDict, cast

import numpy as np
import numpy.typing as npt
import requests
import shapely
from rasterio.transform import Affine
from scipy.spatial import cKDTree
from pyproj import Transformer
from pyproj.transformer import AreaOfInterest, TransformerGroup
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

import _city
from _city import Area, CityBuilding, HSource

RELEASE: Final = "v20250903"
STORAGE: Final = "https://3dbag.fsn1.your-objectstorage.com"
WFS_URL: Final = "https://data.3dbag.nl/api/BAG3D/wfs"
USER_AGENT: Final = "obos-pipeline/1.0 (+https://deltaclimate.earth)"
LICENCE_CREDIT: Final = "© 3DBAG by tudelft3d and 3DGI (CC BY 4.0)"

#: Centroid rule for clipping to the square, and a pad for the tile query so a building
#: on the edge is never lost to a tile that was not fetched.
TILE_PAD_M: Final = 50.0


class WfsTileProps(TypedDict):
    tile_id: str
    gpkg_download: str
    gpkg_sha256: str
    gpkg_nr_building: int
    gpkg_file_ok: bool


@dataclass(frozen=True, slots=True)
class Tile:
    tile_id: str
    url: str
    sha256: str
    n_buildings: int

    @property
    def stem(self) -> str:
        return self.tile_id.replace("/", "-")


@dataclass(frozen=True, slots=True)
class Part:
    part_id: int
    geom: Polygon
    roof_nap: float | None


@dataclass(frozen=True, slots=True)
class RawBuilding:
    src_id: str
    footprint: Polygon                   # EPSG:28992, exterior + any holes
    parts: tuple[Part, ...]
    ground_nap: float | None
    quality: bool
    insufficient: bool                   # b3_pw_onvoldoende
    pc_source: str | None                # b3_pw_bron, e.g. "ahn5"
    pc_year: int | None                  # b3_pw_datum
    build_year: int | None = None        # oorspronkelijkbouwjaar (BAG): when it was first built
    ground_fixed: bool = False           # `ground_nap` was replaced by the AHN4 ring p5 (`repair_grounds`); sheets only


class BuildStats(NamedTuple):
    raw_buildings: int
    inside_square: int
    rows: int
    multipart_buildings: int
    fill_rows: int
    clamped_negative: int
    dropped_small: int
    dropped_empty_piece: int
    holes_dropped: int


# ── tiles ──────────────────────────────────────────────────────────────────

def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def list_tiles(area: Area, raw: str) -> list[Tile]:
    """Tiles of the release that intersect the area box + TILE_PAD_M, via WFS `BAG3D:tiles`."""
    minx, miny, maxx, maxy = _city.bounds_local_crs(area, TILE_PAD_M)
    cache = os.path.join(raw, f"tiles-{RELEASE}-{area.id}.json")
    if not os.path.isfile(cache):
        os.makedirs(raw, exist_ok=True)
        r = _session().get(WFS_URL, params={
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeNames": "BAG3D:tiles", "outputFormat": "json",
            "bbox": f"{minx:.1f},{miny:.1f},{maxx:.1f},{maxy:.1f},urn:ogc:def:crs:EPSG::28992",
        }, timeout=60)
        r.raise_for_status()
        with open(cache, "wb") as fh:
            fh.write(r.content)
    with open(cache, encoding="utf-8") as fh:
        doc = cast("dict[str, list[dict[str, WfsTileProps]]]", json.load(fh))
    tiles = [Tile(f["properties"]["tile_id"], f["properties"]["gpkg_download"],
                  f["properties"]["gpkg_sha256"], f["properties"]["gpkg_nr_building"])
             for f in doc["features"] if f["properties"]["gpkg_file_ok"]]
    if not tiles:
        raise SystemExit("WFS returned no tiles for the area")
    if not all(t.url.startswith(f"{STORAGE}/{RELEASE}/") for t in tiles):
        raise SystemExit(f"a tile URL is outside release {RELEASE}: refusing to mix releases")
    return sorted(tiles, key=lambda t: t.tile_id)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_tile(tile: Tile, raw: str) -> str:
    """Download one `.gpkg.gz` (skipped if present and its sha256 matches). Returns the path."""
    path = os.path.join(raw, f"{tile.stem}.gpkg.gz")
    if os.path.isfile(path) and sha256_file(path) == tile.sha256:
        return path
    part = path + ".part"
    with _session().get(tile.url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(part, "wb") as fh:
            # The server sets `Content-Encoding: gzip` on a file that IS a .gz, so requests'
            # transparent decoding would hand back the inflated GeoPackage and break the
            # sha256 the WFS publishes for the .gz. Read the raw bytes.
            for chunk in r.raw.stream(1 << 20, decode_content=False):
                fh.write(chunk)
    if sha256_file(part) != tile.sha256:
        os.remove(part)
        raise SystemExit(f"sha256 mismatch for {tile.url}")
    os.replace(part, path)
    time.sleep(0.25)                       # one polite request every quarter second
    return path


# ── GeoPackage reading (stdlib sqlite3 + shapely; no GDAL in this repo) ─────

_ENVELOPE_BYTES: Final = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def gpkg_geometry(blob: bytes) -> Polygon:
    """Decode a GeoPackage geometry BLOB (`GP` header + WKB) to a shapely Polygon."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry blob")
    flags = blob[3]
    if (flags >> 4) & 1:
        raise ValueError("empty geometry")
    env = (flags >> 1) & 7
    if env not in _ENVELOPE_BYTES:
        raise ValueError(f"bad envelope indicator {env}")
    # byte order of the HEADER is flags bit 0; the WKB carries its own. The header
    # fields we skip (srs_id int32 + envelope) are not needed.
    geom = shapely.from_wkb(blob[8 + _ENVELOPE_BYTES[env]:])
    if not isinstance(geom, Polygon):
        raise ValueError(f"expected Polygon, got {geom.geom_type}")
    return geom


def _year(v: float | None) -> int | None:
    return None if v is None else int(v)


def read_tile(gz_path: str, scratch: str) -> Iterator[RawBuilding]:
    """Unzip one tile into `scratch`, read it, delete the scratch copy."""
    os.makedirs(scratch, exist_ok=True)
    db_path = os.path.join(scratch, os.path.basename(gz_path)[:-3])
    with gzip.open(gz_path, "rb") as src, open(db_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            parts: dict[str, list[Part]] = {}
            for ident, deel, h70, blob in con.execute(
                    "SELECT identificatie, b3_pand_deel_id, b3_h_70p, geom FROM lod12_2d ORDER BY identificatie, b3_pand_deel_id"):
                parts.setdefault(cast(str, ident), []).append(
                    Part(int(deel), gpkg_geometry(cast(bytes, blob)), None if h70 is None else float(h70)))
            for (ident, blob, ground, qual, insufficient, bron, datum, bouwjaar) in con.execute(
                    "SELECT identificatie, geom, b3_h_maaiveld, b3_kwaliteitsindicator, b3_pw_onvoldoende, "
                    "b3_pw_bron, b3_pw_datum, oorspronkelijkbouwjaar FROM pand"):
                sid = cast(str, ident)
                yield RawBuilding(
                    src_id=sid, footprint=gpkg_geometry(cast(bytes, blob)),
                    parts=tuple(parts.get(sid, ())),
                    ground_nap=None if ground is None else float(ground),
                    quality=bool(qual), insufficient=bool(insufficient),
                    pc_source=None if bron is None else str(bron), pc_year=_year(datum),
                    build_year=_year(bouwjaar))
        finally:
            con.close()
    finally:
        os.remove(db_path)


# ── conversion to the local-frame contract ─────────────────────────────────

def rd_transformer() -> tuple[Transformer, str, float]:
    """(RD -> WGS84 transformer, operation description, stated accuracy in metres).

    The group's first member is the one `Transformer.from_crs` would pick; asking the
    group is the only way to read the accuracy BEFORE a point has been transformed.
    """
    aoi = AreaOfInterest(4.8, 52.3, 5.0, 52.4)
    group = TransformerGroup(28992, 4326, always_xy=True, area_of_interest=aoi)
    best = group.transformers[0]
    return best, best.description, float(best.accuracy)


def _roof_height(b: RawBuilding, part: Part | None) -> tuple[float, HSource]:
    """(h, hSource) for a building / part. Null evidence takes the shared fill."""
    roof = part.roof_nap if part is not None else None
    if b.insufficient or roof is None or b.ground_nap is None:
        return (float(_city.FILL_HEIGHT_M), "fill")
    return (roof - b.ground_nap, "3dbag-p70-ahn4-ground" if b.ground_fixed else "3dbag-p70")


def _local_ring(area: Area, tr: Transformer, ring: shapely.LinearRing | shapely.LineString,
                ) -> tuple[list[tuple[float, float]], dict[tuple[float, float], tuple[float, float]]]:
    """Exterior ring RD -> local metres (no closing vertex) + a local -> (lon, lat) lookup."""
    # Some tiles carry Z (x, y, z) vertices, some do not: take the first two ordinates only.
    pts = [(c[0], c[1]) for c in list(ring.coords)[:-1]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    lons, lats = tr.transform(list(xs), list(ys))
    local: list[tuple[float, float]] = []
    back: dict[tuple[float, float], tuple[float, float]] = {}
    for lon, lat in zip(lons, lats, strict=True):
        x, y = _city.to_local(area, lon, lat)
        key = (round(x, 3), round(y, 3))
        local.append(key)
        back[key] = (lon, lat)
    return local, back


def _row(area: Area, tr: Transformer, poly: Polygon, src_id: str, h: float, hsrc: HSource,
         quality: bool) -> CityBuilding | None:
    """One contract row, or None if the simplified ring is a sliver."""
    local, back = _local_ring(area, tr, poly.exterior)
    raw_poly = Polygon(local)
    fixed: Polygon | MultiPolygon = raw_poly if raw_poly.is_valid else raw_poly.buffer(0)
    lp = max(fixed.geoms, key=lambda g: g.area) if isinstance(fixed, MultiPolygon) else fixed
    simp = lp.simplify(float(_city.SIMPLIFY_M), preserve_topology=True)
    if not isinstance(simp, Polygon) or simp.is_empty or simp.area < _city.MIN_RING_M2:
        return None
    simp = orient(simp, 1.0)                                 # exterior counter-clockwise
    pts = list(simp.exterior.coords)[:-1]
    flat: list[float] = []
    lonlat: list[list[float]] = []
    for x, y in pts:
        flat += [round(x, 2), round(y, 2)]
        ll = back.get((round(x, 3), round(y, 3)))
        if ll is None:                                        # a vertex the simplifier created (buffer(0) only)
            mx, my = _city.frame_m_per_deg(area)
            lon_c = area.centre.lon + x / mx
            lat_c = area.centre.lat + y / my
            ll = (lon_c, lat_c)
        lonlat.append([round(ll[0], 7), round(ll[1], 7)])
    return CityBuilding(src_id=src_id, p=flat, lonlat=lonlat, h=round(max(h, 0.0), 2), hSource=hsrc,
                        quality=quality, hCheck=None, flag=False)


def build_rows(area: Area, raws: Iterator[RawBuilding]) -> tuple[list[CityBuilding], BuildStats, dict[str, int]]:
    """Clip to the square by CENTROID, convert, apply the height rule. Returns rows + stats + point-cloud mix.

    The clip is the closed local-frame square, except for a sheet (`area.box` set): its half-open lon/lat lattice cell, so a
    centroid on a seam belongs to exactly one sheet."""
    tr, _, _ = rd_transformer()
    half = area.size_m / 2.0
    seen: set[str] = set()
    rows: list[CityBuilding] = []
    mix: dict[str, int] = {}
    n_raw = n_in = multi = fill = clamped = small = empty_piece = holes = 0
    for b in raws:
        if b.src_id in seen:                                  # a building listed by two tiles
            continue
        seen.add(b.src_id)
        n_raw += 1
        c = b.footprint.centroid
        lon, lat = tr.transform(c.x, c.y)
        if area.box is not None:                              # a SHEET: the lattice's half-open box, the one G9a partitions by
            w, s, e, n = _city.bounds(area)
            if not (w <= lon < e and s <= lat < n):
                continue
        else:
            cx, cy = _city.to_local(area, lon, lat)
            if abs(cx) > half or abs(cy) > half:
                continue
        n_in += 1
        holes += len(b.footprint.interiors)
        key = f"{b.pc_source or 'none'}-{b.pc_year or 'none'}"
        mix[key] = mix.get(key, 0) + 1
        pieces: list[tuple[str, Polygon, Part | None]]
        if len(b.parts) <= 1:
            pieces = [(b.src_id, b.footprint, b.parts[0] if b.parts else None)]
        else:
            multi += 1
            pieces = []
            for bp in b.parts:
                inter = b.footprint.intersection(bp.geom)
                polys = [inter] if isinstance(inter, Polygon) else (
                    list(inter.geoms) if isinstance(inter, MultiPolygon) else [])
                polys = [g for g in polys if not g.is_empty]
                if not polys:
                    empty_piece += 1
                for k, g in enumerate(polys):
                    pieces.append((f"{b.src_id}#{bp.part_id}" + (f".{k}" if k else ""), g, bp))
        for sid, poly, part in pieces:
            h, hsrc = _roof_height(b, part)
            if h < 0.0:
                clamped += 1
            row = _row(area, tr, poly, sid, h, hsrc, b.quality)
            if row is None:
                small += 1
                continue
            fill += hsrc == "fill"
            rows.append(row)
    stats = BuildStats(n_raw, n_in, len(rows), multi, fill, clamped, small, empty_piece, holes)
    return rows, stats, mix


def percentiles(values: list[float], qs: tuple[float, ...]) -> list[float]:
    """Linear-interpolation percentiles (numpy's default), stdlib only, for the report."""
    v = sorted(values)
    out: list[float] = []
    for q in qs:
        k = (len(v) - 1) * q / 100.0
        lo = int(k)
        hi = min(lo + 1, len(v) - 1)
        out.append(v[lo] + (v[hi] - v[lo]) * (k - lo))
    return out


def height_note(op_desc: str, op_accuracy: float) -> str:
    return (f"Height = 70th-percentile roof elevation minus ground level, both NAP metres "
            f"(3D BAG {RELEASE}: lod12_2d b3_h_70p minus pand b3_h_maaiveld; ground is the 5th "
            f"percentile of AHN ground points within 4 m of the building). A building cut into parts "
            f"is emitted one row per part. Footprints: BAG polygons, exterior ring only, simplified to "
            f"{float(_city.SIMPLIFY_M)} m in the local frame, rings under {_city.MIN_RING_M2} m2 dropped, "
            f"clipped by centroid. Null heights or b3_pw_onvoldoende take the shared "
            f"{float(_city.FILL_HEIGHT_M)} m fill (hSource 'fill'). RD New to WGS84 via pyproj operation "
            f"'{op_desc}' (stated accuracy {op_accuracy:g} m). {LICENCE_CREDIT}; modified as stated.")


# ── ground plausibility (city-streaming P2b; sheets only, Canal Ring's shipped file is unchanged) ──────────────────────────

#: A ground this far below its reference is implausible. NOT an absolute NAP floor: Amsterdam's polders really do lie below -5 m, and
#: a building whose neighbours and AHN ring are at -5.3 m with its own ground at -5.5 m is fine.
GROUND_DROP_M: Final = 3.0
#: The neighbour reference: median `b3_h_maaiveld` of other buildings whose centroid is within this radius (at least `GROUND_MIN_NEIGHBOURS`).
GROUND_NEIGHBOUR_R_M: Final = 75.0
GROUND_MIN_NEIGHBOURS: Final = 5
#: The AHN4 ground ring, outside the footprint (the DTM has no data under a roof): inner and outer offset, and the cells it needs.
RING_INNER_M: Final = 0.5
RING_OUTER_M: Final = 4.0
#: A building packed into a block (the canal ring) may have fewer than RING_MIN_CELLS DTM cells within RING_OUTER_M, because the
#: neighbouring roofs are nodata. The ring is then WIDENED, step by step, to the first outer radius that has enough ground cells;
#: the verdict still uses the first ring that has any evidence, and the rule is unchanged.
RING_OUTER_STEPS_M: Final = (4.0, 8.0, 15.0, 25.0)
RING_MIN_CELLS: Final = 4

GroundVerdict = Literal["ok", "neighbours", "ring", "both"]


def ground_verdict(own: float, neighbours: Sequence[float], ring: Sequence[float]) -> GroundVerdict:
    """Is 3D BAG's ground for one building implausible? Evidence, in the audit's two forms (AMS-FOLLOWUPS-AUDIT.md):
    the ground is more than `GROUND_DROP_M` below the MEDIAN ground of the buildings within `GROUND_NEIGHBOUR_R_M` (needs at
    least `GROUND_MIN_NEIGHBOURS` of them), and/or more than `GROUND_DROP_M` below the MEDIAN of the AHN4 DTM ring around the
    footprint (needs at least `RING_MIN_CELLS` cells). A test without enough evidence says nothing; both silent is "ok"."""
    by_neighbours = len(neighbours) >= GROUND_MIN_NEIGHBOURS and own < float(np.median(neighbours)) - GROUND_DROP_M
    by_ring = len(ring) >= RING_MIN_CELLS and own < float(np.median(ring)) - GROUND_DROP_M
    return "both" if by_neighbours and by_ring else "neighbours" if by_neighbours else "ring" if by_ring else "ok"


def ring_cells(footprint: Polygon, dtm: npt.NDArray[np.float32], tf: Affine, outer: float = RING_OUTER_M) -> npt.NDArray[np.float64]:
    """AHN4 DTM values (NAP m) in the ring RING_INNER_M..`outer` outside a footprint (RD, same CRS as `dtm`); nodata dropped."""
    x0, y0, x1, y1 = footprint.bounds
    c0 = max(0, int(np.floor((x0 - outer - tf.c) / tf.a)))
    c1 = min(dtm.shape[1], int(np.ceil((x1 + outer - tf.c) / tf.a)) + 1)
    r0 = max(0, int(np.floor((tf.f - (y1 + outer)) / -tf.e)))
    r1 = min(dtm.shape[0], int(np.ceil((tf.f - (y0 - outer)) / -tf.e)) + 1)
    if c1 <= c0 or r1 <= r0:
        return np.empty(0, dtype=np.float64)
    cols, rows = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
    xs, ys = tf.c + (cols + 0.5) * tf.a, tf.f + (rows + 0.5) * tf.e
    inside = shapely.contains_xy(footprint.buffer(outer), xs, ys) & ~shapely.contains_xy(footprint.buffer(RING_INNER_M), xs, ys)
    vals = dtm[rows[inside], cols[inside]].astype(np.float64)
    finite: npt.NDArray[np.float64] = vals[np.isfinite(vals)]
    return finite


class GroundReport(NamedTuple):
    buildings: int
    checked_ring: int            # buildings the DTM covered (a ring test was possible)
    flagged: int
    by_neighbours: int
    by_ring: int
    repaired: int                # flagged and given the ring p5
    unrepairable: int            # flagged, but even the widest ring had too few cells to take a p5 from
    widened: int                 # repaired from a ring wider than RING_OUTER_M
    max_drop_m: float            # largest (new ground - old ground) in metres, i.e. how much taller a building was served
    changes: tuple[tuple[str, float, float], ...]    # (id, old ground, new ground)


def repair_grounds(raws: Sequence[RawBuilding], dtm: npt.NDArray[np.float32], tf: Affine) -> tuple[list[RawBuilding], GroundReport]:
    """Replace an implausible `ground_nap` by the AHN4 DTM ring's 5th percentile (the statistic 3D BAG itself uses for ground).

    Buildings whose ground fails `ground_verdict` and whose ring has `RING_MIN_CELLS` cells are rewritten with `ground_fixed`
    set, which tags their rows `3dbag-p70-ahn4-ground`; everything else is returned untouched. Neighbours are looked up among
    ALL the given buildings (a tile's worth, so a building on a sheet's edge has its neighbours), the ring only where the DTM
    covers the building. A flagged building with no usable ring keeps its ground and is counted in `unrepairable`."""
    out = list(raws)
    ok_idx = [k for k, b in enumerate(raws) if b.ground_nap is not None]
    cent = np.array([[raws[k].footprint.centroid.x, raws[k].footprint.centroid.y] for k in ok_idx], dtype=np.float64)
    ground = np.array([raws[k].ground_nap for k in ok_idx], dtype=np.float64)
    tree = cKDTree(cent) if len(ok_idx) else None
    minx, maxy = tf.c, tf.f
    maxx, miny = tf.c + dtm.shape[1] * tf.a, tf.f + dtm.shape[0] * tf.e
    checked = flagged = n_nb = n_ring = repaired = unrep = widened = 0
    drop = 0.0
    changes: list[tuple[str, float, float]] = []
    for n, k in enumerate(ok_idx):
        b = raws[k]
        own = float(ground[n])
        assert tree is not None
        nb = [j for j in tree.query_ball_point(cent[n], GROUND_NEIGHBOUR_R_M) if j != n]
        x0, y0, x1, y1 = b.footprint.bounds
        covered = x0 - RING_OUTER_M > minx and x1 + RING_OUTER_M < maxx and y0 - RING_OUTER_M > miny and y1 + RING_OUTER_M < maxy
        ring = ring_cells(b.footprint, dtm, tf) if covered else np.empty(0, dtype=np.float64)
        checked += covered
        verdict = ground_verdict(own, ground[nb].tolist(), ring.tolist())
        if verdict == "ok":
            continue
        flagged += 1
        n_nb += verdict in ("neighbours", "both")
        n_ring += verdict in ("ring", "both")
        if len(ring) < RING_MIN_CELLS:
            for outer in RING_OUTER_STEPS_M[1:]:
                ring = ring_cells(b.footprint, dtm, tf, outer) if covered else ring
                if len(ring) >= RING_MIN_CELLS:
                    widened += 1
                    break
        if len(ring) < RING_MIN_CELLS:
            unrep += 1
            continue
        fixed = float(np.percentile(ring, 5))
        out[k] = dataclasses.replace(b, ground_nap=fixed, ground_fixed=True)
        repaired += 1
        drop = max(drop, fixed - own)
        changes.append((b.src_id, own, fixed))
    return out, GroundReport(len(raws), checked, flagged, n_nb, n_ring, repaired, unrep, widened, drop, tuple(changes))


def make_buildings_doc(area: Area, rows: list[CityBuilding], st: BuildStats, mix: dict[str, int], retrieved: str,
                       cross_check: str = "AHN nDSM cross-check not yet run (guard G5, Task A9)") -> _city.CityBuildingsFile:
    """The `<area>-buildings.json` document (the one `fetch-city.py --layer buildings` writes), as data."""
    _, op_desc, _op_acc = rd_transformer()
    tiers: dict[str, int] = {}
    for r in rows:
        tiers[r["hSource"]] = tiers.get(r["hSource"], 0) + 1
    return _city.CityBuildingsFile(
        city=area.city, area=area.id, name=area.name, centre=[area.centre.lat, area.centre.lon],
        sizeM=float(area.size_m), release=f"3D BAG {RELEASE}", retrieved=retrieved, count=len(rows),
        source=(f"3D BAG (tudelft3d + 3DGI), {RELEASE}, BAG footprints; heights from the AHN point clouds "
                "(AHN5 © Het Waterschapshuis, CC BY 4.0; AHN4 and AHN3, CC0), CC BY 4.0"),
        heightSource="3D BAG LoD1.2 roof 70th percentile minus ground level (NAP)",
        heightNote=height_note(op_desc, _op_acc),
        fillFraction=round(st.fill_rows / max(1, len(rows)), 4), heightTiers=tiers, pointCloudMix=mix,
        crossCheck=cross_check, b=rows)
