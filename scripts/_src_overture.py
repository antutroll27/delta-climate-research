"""Overture context (water, green, roads) for a city after Bengaluru (Task A7).

Ported from `fetch-bangalore.py::build_context` with the same themes, the same columns,
the same green classes, the same road classes and the same culvert rule, so a Bengaluru
ward and an Amsterdam area are drawn from one vocabulary. The self-test READS the
Bengaluru constants out of that file (ast, no import: it is a 2,000-line script) and
requires equality, so the two cannot drift apart unseen.

CACHE FIRST. Overture releases leave the bucket within about three months (Bengaluru's has
already gone), so each theme is scanned once over the area's box, written to
`<raw>/overture-<release>-<name>.parquet` with an atomic .part rename, and everything after
that reads the cache. A cache whose columns differ from the ones wanted is rescanned: the
Bengaluru water cache once predated `source_tags` and would have drawn every culverted
drain as open water.

THE FRAME. Features are clipped to the area square AFTER projection into the local frame
(`_city.to_local`, x east / y NORTH), so a canal that crosses the square's edge keeps
exactly the part inside it.
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from typing import Any, Final, NamedTuple, cast

from shapely import wkb as shapely_wkb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box
from shapely.ops import transform as shp_transform

import _city
from _city import Area, CityContextFile, CityGreen, CityRoad, CityWater

#: Metres of box padding for the scan: features just outside the square still clip in.
SCAN_PAD_M: Final = 100.0


class Theme(NamedTuple):
    theme: str
    type: str
    columns: str


#: The context layers, exactly Bengaluru's (`fetch-bangalore.py::CONTEXT_THEMES`).
CONTEXT_THEMES: Final[dict[str, Theme]] = {
    "water":   Theme("base", "water", "id, subtype, class, geometry, source_tags"),
    "landuse": Theme("base", "land_use", "id, subtype, class, geometry"),
    "roads":   Theme("transportation", "segment", "id, subtype, class, geometry"),
}

#: Land-use classes drawn as green ground (Bengaluru's set, verified equal in the self-test).
GREEN_CLASSES: Final = frozenset({
    "park", "garden", "grass", "forest", "wood", "meadow", "recreation_ground", "cemetery",
    "golf_course", "orchard", "village_green", "nature_reserve", "greenfield", "plant_nursery"})

#: Carriageways only (Bengaluru's set, verified equal in the self-test).
ROAD_CLASSES: Final = frozenset({
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified",
    "living_street", "service", "pedestrian"})

#: Drawn carriageway widths, metres (Bengaluru's, verified equal in the self-test). The canopy layer
#: uses them to decide which trees stand in a road.
ROAD_WIDTH_M: Final[dict[str, float]] = {
    "motorway": 24.0, "trunk": 18.0, "primary": 14.0, "secondary": 11.0, "tertiary": 8.0,
    "residential": 6.0, "unclassified": 6.0, "living_street": 5.0, "service": 3.5, "pedestrian": 4.0}

#: The classes the browser draws at the major width (`w` = 2). Same as `export-bangalore-obos.py`.
MAJOR_ROAD_CLASSES: Final = frozenset({"primary", "secondary"})

MIN_POLYGON_M2: Final = 4.0
MIN_LINE_M: Final = 2.0
SOURCE: Final = ("OpenStreetMap contributors via Overture Maps (ODbL): base/water, base/land_use, "
                 "transportation/segment, clipped to the area box")


@dataclass(frozen=True, slots=True)
class ContextStats:
    water_polygons: int
    water_lines: int
    water_lines_covered: int
    green_polygons: int
    road_segments: int
    road_major: int
    #: raw features read from the cache, per theme
    scanned: dict[str, int]

    @property
    def major_share(self) -> float:
        return self.road_major / self.road_segments if self.road_segments else 0.0


def context_parquet(raw: str, name: str) -> str:
    return os.path.join(raw, f"overture-{_city.OVERTURE_RELEASE}-{name}.parquet")


def download_context(area: Area, raw: str) -> None:
    """One Overture scan per theme over the area's box + pad, cached with an atomic write."""
    import duckdb
    w, s, e, n = _city.bounds(area, SCAN_PAD_M)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    os.makedirs(raw, exist_ok=True)
    for name, th in CONTEXT_THEMES.items():
        dst = context_parquet(raw, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            have = [str(r[0]) for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{dst}')").fetchall()]
            want = [c.strip() for c in th.columns.split(",")]
            if have == want:
                print(f"  {name:<8} cache present ({os.path.getsize(dst) / 1e6:.2f} MB)")
                continue
            print(f"  {name:<8} cache columns {have} != {want} -- re-scanning")
        src = f"s3://overturemaps-us-west-2/release/{_city.OVERTURE_RELEASE}/theme={th.theme}/type={th.type}/*"
        print(f"  {name:<8} scanning {th.theme}/{th.type} ...", flush=True)
        part = dst + ".part"
        con.execute(f"""
            COPY (
              SELECT {th.columns}
              FROM read_parquet('{src}', hive_partitioning=1)
              WHERE bbox.xmin <= {e} AND bbox.xmax >= {w}
                AND bbox.ymin <= {n} AND bbox.ymax >= {s}
            ) TO '{part}' (FORMAT PARQUET)
        """)
        row = con.execute(f"SELECT COUNT(*) FROM read_parquet('{part}')").fetchone()
        assert row is not None
        os.replace(part, dst)
        print(f"  {name:<8} cached {row[0]:,} features")


def covered_reach(tags: dict[str, str] | None) -> bool:
    """True for a waterway reach that runs under a road or slab (OSM tunnel/culvert/covered)."""
    if not tags:
        return False
    return (tags.get("tunnel", "no") not in ("no", "")
            or tags.get("covered") == "yes"
            or "culvert" in tags)


def _rings(geom: Any) -> list[list[float]]:
    out: list[list[float]] = []
    for g in (geom.geoms if isinstance(geom, MultiPolygon) else [geom]):
        if not isinstance(g, Polygon) or g.is_empty or g.area < MIN_POLYGON_M2:
            continue
        flat: list[float] = []
        for x, y in g.exterior.coords[:-1]:
            flat.extend((round(x, 2), round(y, 2)))
        if len(flat) >= 6:
            out.append(flat)
    return out


def _lines(geom: Any) -> list[list[float]]:
    out: list[list[float]] = []
    for g in (geom.geoms if isinstance(geom, MultiLineString) else [geom]):
        if not isinstance(g, LineString) or g.is_empty or g.length < MIN_LINE_M:
            continue
        flat: list[float] = []
        for x, y in g.coords:
            flat.extend((round(x, 2), round(y, 2)))
        if len(flat) >= 4:
            out.append(flat)
    return out


def build_context(area: Area, raw: str) -> tuple[CityContextFile, ContextStats]:
    """Clip the cached water, green land-use and roads to the area square, in the local frame."""
    import duckdb
    con = duckdb.connect()
    tables: dict[str, list[Any]] = {
        name: con.execute(f"SELECT * FROM read_parquet('{context_parquet(raw, name)}')").fetchall()
        for name in CONTEXT_THEMES}
    half = area.size_m / 2.0
    clip = box(-half, -half, half, half)

    def to_area(x: float, y: float, z: float | None = None) -> tuple[float, ...]:
        return _city.to_local(area, x, y)

    water: list[CityWater] = []
    for _id, subtype, cls, geom, tags in tables["water"]:
        g = shp_transform(to_area, shapely_wkb.loads(bytes(geom)))
        if not g.intersects(clip):
            continue
        g = g.intersection(clip)
        for r in _rings(g):
            water.append({"cls": str(subtype or cls or "water"), "p": r})
        for ln in _lines(g):
            # CLASS FIRST for lines: Overture files a drain as subtype=canal, class=drain.
            water.append({"cls": str(cls or subtype or "stream"), "line": ln,
                          "covered": covered_reach(cast("dict[str, str] | None", tags))})

    green: list[CityGreen] = []
    for _id, subtype, cls, geom in tables["landuse"]:
        if str(cls) not in GREEN_CLASSES and str(subtype) not in GREEN_CLASSES:
            continue
        g = shp_transform(to_area, shapely_wkb.loads(bytes(geom)))
        if not g.intersects(clip):
            continue
        for r in _rings(g.intersection(clip)):
            green.append({"cls": str(cls or subtype), "p": r})

    roads: list[CityRoad] = []
    for _id, subtype, cls, geom in tables["roads"]:
        if str(subtype) != "road" or str(cls) not in ROAD_CLASSES:
            continue
        g = shp_transform(to_area, shapely_wkb.loads(bytes(geom)))
        if not g.intersects(clip):
            continue
        for ln in _lines(g.intersection(clip)):
            roads.append({"cls": str(cls), "line": ln})

    doc = CityContextFile(
        city=area.city, area=area.id, sizeM=float(area.size_m), release=_city.OVERTURE_RELEASE,
        source=SOURCE, water=water, green=green, roads=roads)
    lines = [x for x in water if "line" in x]
    stats = ContextStats(
        water_polygons=sum(1 for x in water if "p" in x), water_lines=len(lines),
        water_lines_covered=sum(1 for x in lines if x.get("covered")),
        green_polygons=len(green), road_segments=len(roads),
        road_major=sum(1 for r in roads if r["cls"] in MAJOR_ROAD_CLASSES),
        scanned={k: len(v) for k, v in tables.items()})
    return doc, stats


def validate_context_file(area: Area, doc: CityContextFile) -> list[str]:
    """Contract checks: release pinned, every vertex inside the square, polygons closed enough to draw."""
    bad: list[str] = []
    if doc["release"] != _city.OVERTURE_RELEASE:
        bad.append(f"release {doc['release']} != pinned {_city.OVERTURE_RELEASE}")
    lim = area.size_m / 2.0 + 0.01
    flats: list[tuple[str, int, list[float]]] = (
        [("water", i, x.get("p") or x.get("line") or []) for i, x in enumerate(doc["water"])]
        + [("green", i, x["p"]) for i, x in enumerate(doc["green"])]
        + [("roads", i, x["line"]) for i, x in enumerate(doc["roads"])])
    for kind, i, flat in flats:
        if len(flat) < 4 or len(flat) % 2:
            bad.append(f"{kind}[{i}]: {len(flat)} numbers")
            break
        if max(abs(v) for v in flat) > lim:
            bad.append(f"{kind}[{i}]: vertex outside the square")
            break
    return bad


def _bangalore_constant(name: str) -> object:
    """Read a module-level literal out of fetch-bangalore.py without importing the script."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch-bangalore.py")
    with open(path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name and node.value:
            return ast.literal_eval(node.value)
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise KeyError(name)


def self_test() -> None:
    assert _bangalore_constant("GREEN_CLASSES") == set(GREEN_CLASSES), "green classes drifted from Bengaluru's"
    assert _bangalore_constant("ROAD_CLASSES") == set(ROAD_CLASSES), "road classes drifted from Bengaluru's"
    assert _bangalore_constant("ROAD_WIDTH_M") == ROAD_WIDTH_M, "road widths drifted from Bengaluru's"
    assert set(ROAD_WIDTH_M) == set(ROAD_CLASSES), "every drawn road class has a width"
    blr_themes = cast("dict[str, tuple[str, str, str]]", _bangalore_constant("CONTEXT_THEMES"))
    assert {k: tuple(v) for k, v in CONTEXT_THEMES.items()} == blr_themes, "context themes drifted from Bengaluru's"
    # The culvert rule, Bengaluru's own cases.
    assert covered_reach({"tunnel": "culvert"}) and covered_reach({"culvert": "yes"})
    assert covered_reach({"covered": "yes"}) and covered_reach({"tunnel": "yes"})
    assert not covered_reach({"tunnel": "no"}) and not covered_reach({}) and not covered_reach(None)
    assert not covered_reach({"waterway": "canal"})
    assert _city.OVERTURE_RELEASE == "2026-10-21.0"
    # Clipping keeps only the part inside the square, in the NORTH-up frame.
    a = _city.AREAS["canal-ring"]
    poly = Polygon([(-5, 1390), (5, 1390), (5, 1500), (-5, 1500)])        # straddles the north edge
    inside = _rings(poly.intersection(box(-1400, -1400, 1400, 1400)))
    assert len(inside) == 1 and max(inside[0][1::2]) == 1400.0 and min(inside[0][1::2]) == 1390.0, inside
    assert not _rings(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])), "a 1 m2 sliver is dropped"
    assert _lines(LineString([(0, 0), (1, 0)])) == [] and _lines(LineString([(0, 0), (3, 0)])) == [[0, 0, 3, 0]]
    print(f"_src_overture self-test: ok (release {_city.OVERTURE_RELEASE}, area {a.id})")
