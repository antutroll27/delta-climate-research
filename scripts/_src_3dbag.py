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
from collections.abc import Callable, Sequence
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
import _src_dem
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
    #: Multi-part buildings whose footprint/part intersection raised a GEOS topology error and was redone on `make_valid` copies.
    #: 0 for every area built before the sheets (a topology error there would have been an exception, not a count).
    invalid_repaired: int = 0


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
            mx, my = _city.m_per_deg(area.centre.lat)
            lon_c = area.centre.lon + x / mx
            lat_c = area.centre.lat + y / my
            ll = (lon_c, lat_c)
        lonlat.append([round(ll[0], 7), round(ll[1], 7)])
    return CityBuilding(src_id=src_id, p=flat, lonlat=lonlat, h=round(max(h, 0.0), 2), hSource=hsrc,
                        quality=quality, hCheck=None, flag=False)


def build_rows(area: Area, raws: Iterator[RawBuilding]) -> tuple[list[CityBuilding], BuildStats, dict[str, int]]:
    """Clip to the square by CENTROID, convert, apply the height rule. Returns rows + stats + point-cloud mix."""
    tr, _, _ = rd_transformer()
    half = area.size_m / 2.0
    seen: set[str] = set()
    rows: list[CityBuilding] = []
    mix: dict[str, int] = {}
    n_raw = n_in = multi = fill = clamped = small = empty_piece = holes = invalid = 0
    for b in raws:
        if b.src_id in seen:                                  # a building listed by two tiles
            continue
        seen.add(b.src_id)
        n_raw += 1
        c = b.footprint.centroid
        lon, lat = tr.transform(c.x, c.y)
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
                try:
                    inter = b.footprint.intersection(bp.geom)
                except shapely.errors.GEOSException:       # an invalid (self-touching) BAG or part ring: redo on repaired copies, and count it
                    inter = shapely.make_valid(b.footprint).intersection(shapely.make_valid(bp.geom))
                    invalid += 1
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
    stats = BuildStats(n_raw, n_in, len(rows), multi, fill, clamped, small, empty_piece, holes, invalid)
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


#: Buildings from this year on are NOT repaired from the AHN4 ring: the ring is the 2020-22 construction site (preload sand 2-4 m above the
#: finished polder), not the ground the building stands on. The same year `_src_dem.post_ahn4_ids` uses.
AHN4_FLIGHT_YEAR: Final = _src_dem.AHN4_FLIGHT_YEAR
#: A repair that would leave a building lower than this is refused: it is the repair that is wrong, not a 1 m building.
MIN_REPAIRED_HEIGHT_M: Final = 2.0
#: nDSM window around a footprint, and pixels it needs, for the AHN4 height check that backs a few-neighbours repair.
NDSM_PAD_M: Final = 20.0
NDSM_MIN_PIXELS: Final = 32

#: The outcome for one building. Only "repaired" changes a row.
GroundOutcome = Literal["ok", "fill", "ring-only", "post-ahn4", "no-ring", "not-lower", "below-2m", "few-neighbours-unconfirmed", "repaired"]


def ground_decision(own: float, neighbours: Sequence[float], ring: Sequence[float], fix_ring: Sequence[float], build_year: int | None,
                    roofs: Sequence[float], h_check: Callable[[], float | None]) -> tuple[GroundOutcome, float | None]:
    """What to do with one building's 3D BAG ground: (outcome, new ground when repaired). The audit's rule (P2B-AUDIT B1):

    * REPAIR ONLY WHEN THE NEIGHBOURS DISAGREE: at least `GROUND_MIN_NEIGHBOURS` buildings within `GROUND_NEIGHBOUR_R_M` whose median ground is more
      than `GROUND_DROP_M` above this one's. The AHN4 ring alone ("ring-only") repairs nothing: it is 2020-22 ground and 3D BAG's is mostly 2023.
    * With fewer neighbours the ring may repair only a building that stood BEFORE the AHN4 survey (BAG `build_year` < `AHN4_FLIGHT_YEAR`) and only if
      the AHN4 nDSM height check agrees better with the new height than with the old (`h_check()` is evaluated only then).
    * A building from `AHN4_FLIGHT_YEAR` on is never repaired from the ring.
    * The new ground is the 5th percentile of `fix_ring` (the ring, widened for a building packed into a block). It must be HIGHER than the old
      ground (a repair never makes a building taller) and leave every part at least `MIN_REPAIRED_HEIGHT_M` tall; otherwise the building is kept as it was.
    * No absolute NAP floor.
    """
    if not roofs:
        return "fill", None                                     # no roof evidence: the row is the 2.5 m fill whatever the ground
    enough = len(neighbours) >= GROUND_MIN_NEIGHBOURS
    by_neighbours = enough and own < float(np.median(neighbours)) - GROUND_DROP_M
    by_ring = len(ring) >= RING_MIN_CELLS and own < float(np.median(ring)) - GROUND_DROP_M
    if enough and not by_neighbours:
        return ("ring-only" if by_ring else "ok"), None
    if not enough and not by_ring:
        return "ok", None
    post = build_year is not None and build_year >= AHN4_FLIGHT_YEAR
    if post:
        return "post-ahn4", None
    if not enough and build_year is None:
        return "few-neighbours-unconfirmed", None
    if len(fix_ring) < RING_MIN_CELLS:
        return "no-ring", None
    fixed = float(np.percentile(fix_ring, 5))
    if fixed <= own:
        return "not-lower", None
    if min(roofs) - fixed < MIN_REPAIRED_HEIGHT_M:
        return "below-2m", None
    if not enough:
        hc = h_check()
        if hc is None or not abs(max(roofs) - fixed - hc) < abs(max(roofs) - own - hc):
            return "few-neighbours-unconfirmed", None
    return "repaired", fixed


def ndsm_p70(footprint: Polygon, dsm: npt.NDArray[np.float32], dtm: npt.NDArray[np.float32], tf: Affine) -> float | None:
    """AHN4 nDSM (DSM minus the nearest-filled DTM) 70th percentile inside a footprint, from a window around it; None if too few pixels."""
    from scipy import ndimage
    x0, y0, x1, y1 = footprint.bounds
    c0, c1 = max(0, int(np.floor((x0 - NDSM_PAD_M - tf.c) / tf.a))), min(dtm.shape[1], int(np.ceil((x1 + NDSM_PAD_M - tf.c) / tf.a)) + 1)
    r0, r1 = max(0, int(np.floor((tf.f - (y1 + NDSM_PAD_M)) / -tf.e))), min(dtm.shape[0], int(np.ceil((tf.f - (y0 - NDSM_PAD_M)) / -tf.e)) + 1)
    if c1 <= c0 or r1 <= r0:
        return None
    d, sf = dtm[r0:r1, c0:c1].copy(), dsm[r0:r1, c0:c1]
    bad = ~np.isfinite(d)
    if bad.all():
        return None
    if bad.any():
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        d = d[idx[0], idx[1]]
    cols, rows = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
    inside = shapely.contains_xy(footprint, tf.c + (cols + 0.5) * tf.a, tf.f + (rows + 0.5) * tf.e)
    vals = (sf - d)[inside]
    vals = vals[np.isfinite(vals)]
    return float(np.percentile(vals, 70)) if vals.size >= NDSM_MIN_PIXELS else None


class GroundReport(NamedTuple):
    """What `repair_grounds` did to the buildings IN SCOPE (a sheet's own buildings; the rest of the tiles only serve as neighbours)."""
    buildings: int               # buildings in scope
    checked_ring: int            # of those, the ones the DTM covered (a ring test was possible)
    repaired: int
    widened: int                 # repaired from a ring wider than RING_OUTER_M
    max_drop_m: float            # largest (new ground - old ground) in metres, i.e. how much a building came down
    outcomes: tuple[tuple[str, int], ...]                 # outcome -> count, for every outcome that occurred
    changes: tuple[tuple[str, float, float], ...]         # (id, old ground, new ground)
    kept: tuple[tuple[str, str], ...]                     # (id, outcome) of every in-scope building the rule looked at and did NOT repair, "ring-only" included


def repair_grounds(raws: Sequence[RawBuilding], dtm: npt.NDArray[np.float32], tf: Affine, dsm: npt.NDArray[np.float32] | None = None,
                   scope: Sequence[bool] | None = None) -> tuple[list[RawBuilding], GroundReport]:
    """Apply `ground_decision` to every building in `scope` (default all). Neighbours come from ALL `raws`, so a building on a sheet's edge
    has them; the ring and the nDSM check come from `dtm` / `dsm` (None: a few-neighbours repair can then never be confirmed).
    A repaired building is rewritten with `ground_fixed` set, which tags its rows `3dbag-p70-ahn4-ground`; the rest are returned as given."""
    out = list(raws)
    inside = list(scope) if scope is not None else [True] * len(raws)
    ok_idx = [k for k, b in enumerate(raws) if b.ground_nap is not None]
    cent = np.array([[raws[k].footprint.centroid.x, raws[k].footprint.centroid.y] for k in ok_idx], dtype=np.float64)
    ground = np.array([raws[k].ground_nap for k in ok_idx], dtype=np.float64)
    tree = cKDTree(cent) if len(ok_idx) else None
    minx, maxy = tf.c, tf.f
    maxx, miny = tf.c + dtm.shape[1] * tf.a, tf.f + dtm.shape[0] * tf.e
    in_scope = checked = repaired = widened = 0
    drop = 0.0
    counts: dict[str, int] = {}
    changes: list[tuple[str, float, float]] = []
    kept: list[tuple[str, str]] = []
    for n, k in enumerate(ok_idx):
        if not inside[k]:
            continue
        b = raws[k]
        in_scope += 1
        own = float(ground[n])
        assert tree is not None
        nb = [j for j in tree.query_ball_point(cent[n], GROUND_NEIGHBOUR_R_M) if j != n]
        x0, y0, x1, y1 = b.footprint.bounds
        covered = x0 - RING_OUTER_M > minx and x1 + RING_OUTER_M < maxx and y0 - RING_OUTER_M > miny and y1 + RING_OUTER_M < maxy
        ring = ring_cells(b.footprint, dtm, tf) if covered else np.empty(0, dtype=np.float64)
        checked += covered
        fix_ring, was_widened = ring, False
        if covered and len(ring) < RING_MIN_CELLS and len(nb) >= 0:
            for outer in RING_OUTER_STEPS_M[1:]:
                fix_ring = ring_cells(b.footprint, dtm, tf, outer)
                if len(fix_ring) >= RING_MIN_CELLS:
                    was_widened = True
                    break
        roofs = [] if b.insufficient else [p.roof_nap for p in b.parts if p.roof_nap is not None]
        def confirm(fp: Polygon = b.footprint) -> float | None:
            return ndsm_p70(fp, dsm, dtm, tf) if dsm is not None else None
        outcome, fixed = ground_decision(own, ground[nb].tolist(), ring.tolist(), fix_ring.tolist(), b.build_year, roofs, confirm)
        if outcome in ("ok", "fill"):
            continue
        counts[outcome] = counts.get(outcome, 0) + 1
        if fixed is None:
            kept.append((b.src_id, outcome))
            continue
        out[k] = dataclasses.replace(b, ground_nap=fixed, ground_fixed=True)
        repaired += 1
        widened += was_widened
        drop = max(drop, fixed - own)
        changes.append((b.src_id, own, fixed))
    return out, GroundReport(in_scope, checked, repaired, widened, drop, tuple(sorted(counts.items())), tuple(changes), tuple(kept))


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


# ── self-test ───────────────────────────────────────────────────────────────

def self_test() -> None:
    """Offline: the ground rule on synthetic buildings, every case the audit names (P2B-AUDIT B1)."""
    from rasterio.transform import from_origin
    ftf = from_origin(0.0, 400.0, 0.5, 0.5)                      # a 200 m x 200 m DTM, x 0..200, y 200..400

    def mkb(sid: str, x: float, ground: float | None, year: int | None = 1990, roof: float = 10.0, y: float = 300.0) -> RawBuilding:
        sq = Polygon([(x, y), (x + 10, y), (x + 10, y + 10), (x, y + 10)])
        return RawBuilding(sid, sq, (Part(0, sq, roof),), ground, True, False, "ahn5", 2023, build_year=year)

    def neighbours(ground: float, n: int = 6) -> list[RawBuilding]:           # all within 75 m of the building at x = 110
        return [mkb(f"n{k}", 40.0 + 11.0 * k, ground) for k in range(n)]

    def dtm_of(around: float, far: float | None = None) -> npt.NDArray[np.float32]:
        return np.full((400, 400), around if far is None else far, dtype=np.float32)

    def run(bad: RawBuilding, nb: list[RawBuilding], dtm: npt.NDArray[np.float32], dsm: npt.NDArray[np.float32] | None = None,
            ) -> tuple[RawBuilding, GroundReport]:
        out, rep = repair_grounds([*nb, bad], dtm, ftf, dsm)
        return out[-1], rep

    # 1. The audit's case, neighbour-backed: -6.729 among neighbours at +0.3 m, AHN4 ring at 0.0: repaired to the ring p5, tagged, 10 m tall.
    fixed, rep = run(mkb("bad", 110.0, -6.729), neighbours(0.3), dtm_of(0.0))
    assert fixed.ground_fixed and fixed.ground_nap == 0.0 and rep.repaired == 1 and abs(rep.max_drop_m - 6.729) < 1e-9, rep
    assert _roof_height(fixed, fixed.parts[0]) == (10.0, "3dbag-p70-ahn4-ground")
    # 2. A POLDER at -5.5 m NAP among neighbours at -5.3 and an AHN ring at -5.4 is NOT touched, whatever its absolute NAP.
    fixed, rep = run(mkb("deep", 110.0, -5.5), neighbours(-5.3), dtm_of(-5.4))
    assert not fixed.ground_fixed and rep.repaired == 0 and not rep.kept, rep   # the polder: not even looked at as a candidate
    fixed, rep = run(mkb("deeper", 110.0, -9.0), neighbours(-5.3), dtm_of(-5.4))
    assert fixed.ground_fixed and fixed.ground_nap is not None and abs(fixed.ground_nap + 5.4) < 1e-6, "3.7 m under a polder's neighbours IS implausible, even at -9 m NAP"
    # 3. WEESPERSLUIS-STYLE NEW BUILD: built 2022, own ground -1.15 = its neighbours', AHN4 ring (a 2020-22 building site) at +2.5: the
    # neighbours AGREE, so nothing is repaired; the ring alone repairs nothing.
    fixed, rep = run(mkb("new", 110.0, -1.15, year=2022), neighbours(-1.15), dtm_of(2.5))
    assert not fixed.ground_fixed and rep.repaired == 0 and dict(rep.kept).get("new") == "ring-only", rep
    # ... and a new build whose neighbours DO disagree is still not repaired from the (construction-site) ring
    fixed, rep = run(mkb("new2", 110.0, -6.7, year=2021), neighbours(0.3), dtm_of(0.0))
    assert not fixed.ground_fixed and dict(rep.kept).get("new2") == "post-ahn4", rep
    # 4. A RAISED STRUCTURE: own -6.8 like its neighbours, the ring on its plinth at +6.6: neighbours agree, no repair.
    fixed, rep = run(mkb("plinth", 110.0, -6.8), neighbours(-6.8), dtm_of(6.6))
    assert not fixed.ground_fixed and dict(rep.kept).get("plinth") == "ring-only", rep
    # 5. FEWER THAN 5 NEIGHBOURS: the ring may repair only a pre-AHN4 building whose AHN4 nDSM height agrees with the new height better.
    dsm_new = dtm_of(10.0)                                             # nDSM p70 10 m over a flat 0 m DTM: agrees with the repaired height
    dsm_old = dtm_of(16.7)                                             # nDSM 16.7 m: agrees with the OLD (too tall) height
    few = neighbours(0.3, 2)
    fixed, rep = run(mkb("a", 110.0, -6.7, year=1950), few, dtm_of(0.0), dsm_new)
    assert fixed.ground_fixed and rep.repaired == 1, rep
    fixed, rep = run(mkb("b", 110.0, -6.7, year=1950), few, dtm_of(0.0), dsm_old)
    assert not fixed.ground_fixed and dict(rep.kept).get("b") == "few-neighbours-unconfirmed", rep
    fixed, rep = run(mkb("c", 110.0, -6.7, year=2021), few, dtm_of(0.0), dsm_new)
    assert not fixed.ground_fixed and dict(rep.kept).get("c") == "post-ahn4", "never the ring for AHN4's year or later"
    fixed, rep = run(mkb("d", 110.0, -6.7, year=None), few, dtm_of(0.0), dsm_new)
    assert not fixed.ground_fixed and dict(rep.kept).get("d") == "few-neighbours-unconfirmed", "an unknown year is not 'before AHN4'"
    fixed, rep = run(mkb("e", 110.0, -6.7, year=1950), few, dtm_of(0.0), None)
    assert not fixed.ground_fixed, "without a DSM there is no confirmation"
    # 6. A result under 2 m is refused (roof 1.5 m above the new ground); 7. a repair never RAISES a height (ring p5 below the old ground).
    fixed, rep = run(mkb("low", 110.0, -6.7, roof=1.5), neighbours(0.3), dtm_of(0.0))
    assert not fixed.ground_fixed and dict(rep.kept).get("low") == "below-2m", rep
    fixed, rep = run(mkb("taller", 110.0, -6.7), neighbours(0.3), dtm_of(-8.0))
    assert not fixed.ground_fixed and dict(rep.kept).get("taller") == "not-lower", rep
    # 8. The ring widens for a building packed into a block, once; with no DTM at all the building is kept ('no-ring').
    packed = dtm_of(0.0)
    packed[int((400 - 316) / 0.5):int((400 - 294) / 0.5), int(104 / 0.5):int(126 / 0.5)] = np.nan
    fixed, rep = run(mkb("pk", 110.0, -6.7), neighbours(0.3), packed)
    assert fixed.ground_fixed and rep.widened == 1, rep
    fixed, rep = run(mkb("nr", 110.0, -6.7), neighbours(0.3), np.full((400, 400), np.nan, dtype=np.float32))
    assert not fixed.ground_fixed and dict(rep.kept).get("nr") == "no-ring", rep
    # 9. SCOPE: only buildings in scope are decided and counted; the others still serve as neighbours.
    allb = [*neighbours(0.3), mkb("bad", 110.0, -6.7), mkb("edge", 130.0, -6.7)]
    out, rep = repair_grounds(allb, dtm_of(0.0), ftf, None, [False] * 6 + [True, False])
    assert rep.buildings == 1 and rep.repaired == 1 and out[-1].ground_fixed is False and out[-2].ground_fixed, rep
    print("_src_3dbag self-test: ok (ground rule: neighbour-backed repair, polder untouched, new build / raised structure / ring-only kept, "
          "few-neighbours rule, <2 m refused, never taller, ring widening, scope)")
