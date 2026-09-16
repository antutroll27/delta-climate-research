"""Fetch the Bangalore ward geometry the Blender scenes are built from.

Three layers, one script, because all three are the same question asked of
different servers: what is inside this 2.8 km box?

    python3 scripts/fetch-bangalore.py --layer buildings
    python3 scripts/fetch-bangalore.py --layer heights
    python3 scripts/fetch-bangalore.py --layer terrain
    python3 scripts/fetch-bangalore.py --layer all --ward indiranagar

ONE S3 SCAN, NOT THREE. Overture's building parquet is global and a bbox filter
still costs a full scan of the partition -- measured at 300 s for a single ward.
The three wards span 18.7 km of longitude between them, so the whole set is
pulled once over their union bbox into a local parquet and sliced from there.
Re-running is then free, which matters because the slicing rules are the part
likely to need adjusting.

HEIGHTS MATCH KOLKATA EXACTLY. Zonal p65 of Google Open Buildings 2.5D Temporal
at the product's native 4 m posting, 2023 epoch, with an explicit 2.5 m fill
where no confident pixel covers a footprint -- the same statistic and the same
fill convention `compute-heights.py` ships for Kolkata. Two cities computed the
same way are comparable; two cities computed differently are two projects.

THE CROSS-CHECK IS A FLAG, NOT A CORRECTION. Where a UT-GLOBUS tile covers the
ward, its height is attached as a second field and buildings whose two estimates
differ by more than 5 m are flagged. It is never blended into the shipped height:
averaging two sources with no Indian ground truth manufactures a number neither
one states, and hides the disagreement exactly where it is most informative.

    export GOOGLE_APPLICATION_CREDENTIALS=~/.config/delta-climate/ee-service-account.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import importlib.util
import shutil
import sqlite3
import statistics
import subprocess
import sys
import zipfile
from typing import Any, Callable, Literal, Mapping, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)

RAW = os.path.join(blr.DATA, "raw")
OVERTURE_PARQUET = os.path.join(RAW, "overture-buildings.parquet")

# ── DC-URS inputs (spec 2026-09-14-bengaluru-resilience-score-design.md) ────────
GEO_CACHE = os.path.expanduser("~/.cache/delta-climate")
#: GHSL tile covering all three wards, CONFIRMED 2026-09-15: the SMOD tile's
#: bounds contain every ward centre (class 30, Urban Centre). R8_C25 does not exist.
GHS_TILE = "R8_C26"
#: Constrained WorldPop, CHOSEN OVER GHS-POP after a Census 2011 check of all 198 BBMP
#: wards (spec amendment 2026-09-15): GHS-POP misplaced ~2.7 M people in the south-east.
WORLDPOP_URL = ("https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/IND/v1/"
                "100m/constrained/ind_pop_2025_CN_100m_R2025A_v1.tif")
GHS_SMOD_URL = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_SMOD_GLOBE_R2023A/"
                "GHS_SMOD_E2020_GLOBE_R2023A_54009_1000/V2-0/tiles/"
                f"GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0_{GHS_TILE}.zip")
#: WorldCover tiles are 3 deg squares named by their south-west corner; HTTP 200 confirmed.
WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_N12E075_Map.tif")
SENTINEL_YEARS = [2021, 2022, 2023, 2024, 2025]

#: The rural reference box: 0.8 x 0.8 deg around the three wards, inside GHSL
#: tile R8_C26 and under _ecostress.MAX_STUDY_WIDTH_DEG (12), so one UTM zone (43N).
RURAL_BBOX = (77.22, 12.57, 78.02, 13.37)
ECOSTRESS_START = "2018-07-01"
#: LP DAAC may still be ingesting the most recent scenes, and a scene that
#: arrives late changes an orbit's EARLIEST timestamp -- which is that orbit's
#: `done` key (see group_by_orbit). Stopping the search this many days short of
#: today means a re-run never discovers an earlier sibling of an orbit already
#: recorded under its (previously earliest, now second) timestamp, which would
#: double-count the orbit across a resume.
ECOSTRESS_SETTLE_DAYS = 14

#: The context layers, all from the same Overture release and bucket as the
#: buildings and under the same ODbL. Each is one full-partition scan (~5 min),
#: cached once over the union bbox and sliced per ward from there.
CONTEXT_THEMES: dict[str, tuple[str, str, str]] = {
    "water":   ("base", "water", "id, subtype, class, geometry, source_tags"),
    "landuse": ("base", "land_use", "id, subtype, class, geometry"),
    "roads":   ("transportation", "segment", "id, subtype, class, geometry"),
}

#: Land-use classes drawn as green ground. Everything else stays bare, so a
#: golf course reads as green and a car park does not.
GREEN_CLASSES = {"park", "garden", "grass", "forest", "wood", "meadow",
                 "recreation_ground", "cemetery", "golf_course", "orchard",
                 "village_green", "nature_reserve", "greenfield", "plant_nursery"}

#: Road classes that are drawn, i.e. carriageways. Footways, paths, steps and
#: cycleways are real but at 2.8 km they are clutter, not information.
ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary",
                "residential", "unclassified", "living_street", "service",
                "pedestrian"}

#: Drawn carriageway widths, metres. MUST MATCH ROAD_WIDTH_M in
#: blender_bangalore.py -- the canopy layer uses these to decide which trees
#: stand in a road, and the scene uses them to draw it. If the two drift, trees
#: are removed from a strip that is not where the road is drawn.
ROAD_WIDTH_M = {"motorway": 24.0, "trunk": 18.0, "primary": 14.0,
                "secondary": 11.0, "tertiary": 8.0, "residential": 6.0,
                "unclassified": 6.0, "living_street": 5.0, "service": 3.5,
                "pedestrian": 4.0}

#: GLO-30 is a 1x1 degree COG grid. Bengaluru sits in N12/E077.
GLO30 = ("/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"
         "Copernicus_DSM_COG_10_N12_00_E077_00_DEM/"
         "Copernicus_DSM_COG_10_N12_00_E077_00_DEM.tif")

#: Terrain mesh resolution. 2800 / 96 = 29.2 m, which is as close to GLO-30's
#: native 30 m posting as a round number gets. DELIBERATELY NOT 384: that is the
#: solver's grid, and resampling terrain up to it would quadruple the file for
#: interpolation, not information. Blender subdivides if a scene wants it.
TERRAIN_N = 96

#: The scene also gets a WIDER terrain, at the same ~29 m posting, so a render
#: does not end in a hard silhouette against the sky at the ward boundary. This
#: is real GLO-30 either way -- the alternative, an invented apron, would put
#: fabricated landform in a picture whose argument is that the terrain is
#: measured. Buildings still stop at the ward edge; only the ground continues.
CONTEXT_MULT = 3.0
CONTEXT_N = 288

#: Google's own epoch naming, matching the shipped Kolkata heightsNote.
EPOCH = ("2023-01-01", "2024-01-01")
SCALE_M = 4
PAGE = 300

#: UT-GLOBUS tiles, if present. Not committed -- 204 MB each -- so an absent
#: file is a RECORDED SKIP, never a silent absence. See the tile trap in §4 of
#: the design spec: Bangalore_2 covers Indiranagar and Whitefield, and MG Road
#: at 77.6030 E needs Bangalore_1, which is a separate download.
UTGLOBUS_DIRS = [
    os.environ.get("UTGLOBUS_DIR", ""),
    os.path.join(RAW, "utglobus"),
]


def ward_list(only: str | None) -> list[blr.Ward]:
    if only:
        if only not in blr.WARDS:
            raise SystemExit(f"unknown ward {only!r}; have {sorted(blr.WARDS)}")
        return [blr.WARDS[only]]
    return list(blr.WARDS.values())


def union_bounds() -> tuple[float, float, float, float]:
    """One bbox containing every ward, for the single Overture scan."""
    boxes = [blr.bounds(w) for w in blr.WARDS.values()]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


# ── buildings ───────────────────────────────────────────────────────────────

def download_overture() -> None:
    """Pull the union bbox from Overture's S3 parquet into a local file.

    Skipped if the local file already exists -- this is a 5-minute scan of a
    global dataset, not something to repeat while iterating on the slicing.
    """
    import duckdb

    # A ZERO-BYTE FILE IS NOT A CACHE. duckdb creates the output before it has
    # anything to put in it, so a scan killed part-way leaves a valid-looking
    # path that every later run would skip -- producing three empty wards and no
    # error. Size-check, and write through a .part file so this cannot recur.
    if os.path.exists(OVERTURE_PARQUET) and os.path.getsize(OVERTURE_PARQUET) > 0:
        mb = os.path.getsize(OVERTURE_PARQUET) / 1e6
        print(f"  overture cache present ({mb:.1f} MB) -- delete to re-fetch")
        return

    os.makedirs(RAW, exist_ok=True)
    w, s, e, n = union_bounds()
    print(f"  scanning Overture {blr.OVERTURE_RELEASE} over "
          f"{w:.4f},{s:.4f} -> {e:.4f},{n:.4f} (one full-partition scan, ~5 min)")
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    part = OVERTURE_PARQUET + ".part"
    con.execute(f"""
        COPY (
          SELECT id, names.primary AS name, geometry
          FROM read_parquet('{blr.OVERTURE_S3}', hive_partitioning=1)
          WHERE bbox.xmin BETWEEN {w} AND {e}
            AND bbox.ymin BETWEEN {s} AND {n}
        ) TO '{part}' (FORMAT PARQUET)
    """)
    rows = con.execute(
        f"SELECT COUNT(*) FROM read_parquet('{part}')").fetchone()
    assert rows is not None
    if rows[0] == 0:
        raise SystemExit("Overture returned 0 buildings -- check the release pin "
                         "and the union bbox before retrying")
    os.replace(part, OVERTURE_PARQUET)
    print(f"  cached {rows[0]:,} buildings -> {OVERTURE_PARQUET}")


def build_footprints(wards: list[blr.Ward]) -> None:
    """Assign every cached building to the ward that contains its centroid.

    ONE PASS, NOT ONE PER WARD. The cache holds ~102k buildings for the whole
    metro strip and each ring has to be parsed from WKB to find its centroid
    anyway, so parsing once and dispatching to three ward buckets costs a third
    of what three filtered passes would.

    IT ALSO REMOVES THE bbox COLUMN AS A DEPENDENCY, which is the bug this
    replaces: the cache is written with `SELECT id, name, geometry`, so a SQL
    filter on `bbox.xmin` binds against a column that is not there. That failed
    loudly here, but the same shape -- filtering on a column the cache happens to
    carry -- is exactly how a silent partial result gets shipped.

    THE CENTROID IS THE ARBITER, not the bounding box. A building straddling a
    ward edge belongs to exactly one ward, and using its SW corner would pull in
    everything up to one building-width outside on two sides.
    """
    import duckdb
    from shapely import wkb as shapely_wkb
    from shapely.geometry import MultiPolygon, Polygon

    con = duckdb.connect()
    rows = con.execute(
        f"SELECT id, geometry FROM read_parquet('{OVERTURE_PARQUET}')").fetchall()
    print(f"  {len(rows):,} cached buildings -> {len(wards)} wards")

    out: dict[str, list[blr.BlrBuilding]] = {w.id: [] for w in wards}
    skipped: dict[str, dict[str, int]] = {
        w.id: {"not_polygon": 0, "tiny": 0, "holes_dropped": 0} for w in wards}
    outside_all = 0

    for gers, geom in rows:
        shp = shapely_wkb.loads(bytes(geom))
        if isinstance(shp, MultiPolygon):
            # Largest part only. A MultiPolygon building is an Overture merge
            # artefact; drawing every part double-counts its footprint.
            shp = max(shp.geoms, key=lambda g: g.area)
        if not isinstance(shp, Polygon):
            continue
        coords = list(shp.exterior.coords[:-1])
        if len(coords) < 3:
            continue
        clon = sum(c[0] for c in coords) / len(coords)
        clat = sum(c[1] for c in coords) / len(coords)

        home: blr.Ward | None = None
        for w in wards:
            half = w.size_m / 2.0
            x, y = blr.to_local(w, clon, clat)
            if abs(x) <= half and abs(y) <= half:
                home = w
                break
        if home is None:
            outside_all += 1
            continue

        if shp.interiors:
            skipped[home.id]["holes_dropped"] += 1
        flat: list[float] = []
        for lon, lat in coords:
            x, y = blr.to_local(home, float(lon), float(lat))
            flat.extend((round(x, 2), round(y, 2)))
        if blr.ring_area(flat) < blr.MIN_RING_M2:
            skipped[home.id]["tiny"] += 1
            continue

        out[home.id].append({
            "gers": str(gers), "p": flat,
            "lonlat": [[round(float(lon), 7), round(float(lat), 7)]
                       for lon, lat in coords],
            "h": 0.0, "fill": True, "hUt": None, "flag": False,
        })

    os.makedirs(blr.DATA, exist_ok=True)
    for w in wards:
        doc: blr.BlrBuildingsFile = {
            "ward": w.id, "name": w.name,
            "centre": [w.centre.lat, w.centre.lon], "sizeM": w.size_m,
            "release": blr.OVERTURE_RELEASE, "retrieved": "2026-09-10",
            "count": len(out[w.id]),
            "source": "Overture Maps Foundation (ODbL) -- OSM + Google + "
                      "Microsoft, GERS-deduplicated",
            "heightSource": "(not yet computed -- run --layer heights)",
            "heightNote": "", "fillFraction": 1.0,
            "crossCheck": "(not yet run)", "b": out[w.id],
        }
        path = os.path.join(blr.DATA, f"{w.id}-buildings.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {w.id:<12} {len(out[w.id]):6,} buildings  "
              f"skipped {skipped[w.id]}")
    print(f"  {outside_all:,} cached buildings fell outside every ward "
          f"(expected -- the cache spans the strip between them)")


# ── context: water, green, roads ────────────────────────────────────────────

def context_parquet(name: str) -> str:
    return os.path.join(RAW, f"overture-{name}.parquet")


def download_context() -> None:
    """Three more Overture scans, each cached with the same atomic .part write."""
    import duckdb
    w, s, e, n = union_bounds()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    for name, (theme, typ, cols) in CONTEXT_THEMES.items():
        dst = context_parquet(name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            # A CACHE IS ONLY VALID FOR THE COLUMNS IT WAS SCANNED WITH. The water
            # cache predates `source_tags`, and reusing it would silently draw every
            # culverted drain as open water.
            have = [r[0] for r in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{dst}')").fetchall()]
            want = [c.strip() for c in cols.split(",")]
            if have == want:
                print(f"  {name:<8} cache present ({os.path.getsize(dst) / 1e6:.1f} MB)")
                continue
            print(f"  {name:<8} cache columns {have} != {want} -- re-scanning")
        os.makedirs(RAW, exist_ok=True)
        src = (f"s3://overturemaps-us-west-2/release/{blr.OVERTURE_RELEASE}"
               f"/theme={theme}/type={typ}/*")
        print(f"  {name:<8} scanning {theme}/{typ} (~5 min) ...", flush=True)
        part = dst + ".part"
        con.execute(f"""
            COPY (
              SELECT {cols}
              FROM read_parquet('{src}', hive_partitioning=1)
              WHERE bbox.xmin <= {e} AND bbox.xmax >= {w}
                AND bbox.ymin <= {n} AND bbox.ymax >= {s}
            ) TO '{part}' (FORMAT PARQUET)
        """)
        rows = con.execute(f"SELECT COUNT(*) FROM read_parquet('{part}')").fetchone()
        assert rows is not None
        os.replace(part, dst)
        print(f"  {name:<8} cached {rows[0]:,} features")


def covered_reach(tags: dict[str, str] | None) -> bool:
    """True for a waterway reach that runs under a road or slab (OSM tunnel/culvert/covered).

    Such a reach is real but invisible from above, so it is not drawn; the exporter
    counts it as `coveredDropped` rather than losing it silently. About 40 % of MG
    Road's reaches are culverts or tunnels (Overpass, 2026-09-14).
    """
    if not tags:
        return False
    return (tags.get("tunnel", "no") not in ("no", "")
            or tags.get("covered") == "yes"
            or "culvert" in tags)


def build_context(wards: list[blr.Ward]) -> None:
    """Clip water, green land-use and roads to each ward box, in the local frame.

    CLIPPED, NOT CENTROID-FILTERED. Buildings belong to one ward and a centroid
    test is right for them. A lake, a park or an arterial road crosses ward
    edges as a matter of course, and keeping or dropping it whole would either
    spill kilometres past the island or delete the half that is inside. Every
    feature is intersected with the box, so what is drawn is exactly the part
    that is in the ward.
    """
    import duckdb
    from shapely import wkb as shapely_wkb
    from shapely.geometry import (LineString, MultiLineString, MultiPolygon,
                                  Polygon, box)
    from shapely.ops import transform as shp_transform

    con = duckdb.connect()
    tables: dict[str, list[Any]] = {
        name: con.execute(
            f"SELECT * FROM read_parquet('{context_parquet(name)}')").fetchall()
        for name in CONTEXT_THEMES}
    for name, rows in tables.items():
        print(f"  {name:<8} {len(rows):,} cached features")

    for w in wards:
        half = w.size_m / 2.0
        clip = box(-half, -half, half, half)

        # Bound per iteration and called synchronously inside it, so the loop
        # variable is safe to close over; the annotation is what shapely's
        # transform() stub demands, not the Any a nested helper would default to.
        def to_ward(x: float, y: float, z: float | None = None) -> tuple[float, ...]:
            return blr.to_local(w, x, y)

        def rings(geom: Any) -> list[list[float]]:
            out: list[list[float]] = []
            parts = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
            for g in parts:
                if not isinstance(g, Polygon) or g.is_empty or g.area < 4.0:
                    continue
                flat: list[float] = []
                for x, y in g.exterior.coords[:-1]:
                    flat.extend((round(x, 2), round(y, 2)))
                if len(flat) >= 6:
                    out.append(flat)
            return out

        def lines(geom: Any) -> list[list[float]]:
            out: list[list[float]] = []
            parts = (geom.geoms if isinstance(geom, MultiLineString) else [geom])
            for g in parts:
                if not isinstance(g, LineString) or g.is_empty or g.length < 2.0:
                    continue
                flat: list[float] = []
                for x, y in g.coords:
                    flat.extend((round(x, 2), round(y, 2)))
                if len(flat) >= 4:
                    out.append(flat)
            return out

        water: list[dict[str, Any]] = []
        for _id, subtype, cls, geom, tags in tables["water"]:
            g = shp_transform(to_ward, shapely_wkb.loads(bytes(geom)))
            if not g.intersects(clip):
                continue
            g = g.intersection(clip)
            for r in rings(g):
                water.append({"cls": str(subtype or cls or "water"), "p": r})
            for ln in lines(g):
                # CLASS FIRST for lines: Overture files a drain as subtype=canal,
                # class=drain, and "drain" is the fact worth keeping.
                water.append({"cls": str(cls or subtype or "stream"), "line": ln,
                              "covered": covered_reach(cast("dict[str, str] | None", tags))})

        green: list[dict[str, Any]] = []
        for _id, subtype, cls, geom in tables["landuse"]:
            if str(cls) not in GREEN_CLASSES and str(subtype) not in GREEN_CLASSES:
                continue
            g = shp_transform(to_ward, shapely_wkb.loads(bytes(geom)))
            if not g.intersects(clip):
                continue
            for r in rings(g.intersection(clip)):
                green.append({"cls": str(cls or subtype), "p": r})

        roads: list[dict[str, Any]] = []
        for _id, subtype, cls, geom in tables["roads"]:
            if str(subtype) != "road" or str(cls) not in ROAD_CLASSES:
                continue
            g = shp_transform(to_ward, shapely_wkb.loads(bytes(geom)))
            if not g.intersects(clip):
                continue
            for ln in lines(g.intersection(clip)):
                roads.append({"cls": str(cls), "line": ln})

        doc = {
            "ward": w.id, "sizeM": w.size_m, "release": blr.OVERTURE_RELEASE,
            "source": "Overture Maps Foundation (ODbL): base/water, base/land_use, "
                      "transportation/segment, clipped to the ward box",
            "water": water, "green": green, "roads": roads,
        }
        with open(os.path.join(blr.DATA, f"{w.id}-context.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {w.id:<12} water {len(water):4d}  green {len(green):4d}  "
              f"roads {len(roads):5,}")


# ── OSM measured heights and cited landmarks ────────────────────────────────

#: Named buildings whose height is a PUBLISHED FACT, with the source named per
#: row. This is the Dubai `heightSource` pattern: a height is a fact and facts
#: are not copyrightable, and a hand-entered list of six landmarks comes nowhere
#: near the bulk-extraction limit that database right actually protects.
#:
#: WHY THIS TIER HAS TO EXIST. Measured against these six, the zonal p65 that
#: ships today reads UB Tower at 18.2 m against a cited 123 m. The statistic is
#: not slightly low on towers, it collapses on them: a tower's Overture footprint
#: is its PLOT, so two thirds of the pixels inside it are podium, forecourt and
#: car park, and the 65th percentile of that is podium height.
#:
#: (name, lat, lon, height_m, source). Matched to the nearest footprint of at
#: least MIN_LANDMARK_AREA within LANDMARK_SNAP_M -- never by name, because
#: Overture's `names.primary` is absent on most of these.
CITED_HEIGHTS: list[tuple[str, float, float, float, str]] = [
    ("UB Tower", 12.97287, 77.595848, 123.0, "CTBUH 13883"),
    ("UB City Concord Tower", 12.97250, 77.59620, 115.0, "CTBUH 13884"),
    ("UB City Canberra Tower", 12.97270, 77.59650, 105.0, "CTBUH 13885"),
    ("Subhas Chandra Bose Tower", 12.97406, 77.609894, 106.0,
     "CTBUH 4991; Wikipedia infobox agrees"),
    ("Vidhana Soudha", 12.9796, 77.5906, 45.7, "Wikipedia infobox, 150 ft"),
    ("M. Chinnaswamy Stadium", 12.9789, 77.5997, 30.0,
     "stadium roof line, estimated -- flagged as such, not cited"),
]
LANDMARK_SNAP_M = 90.0
MIN_LANDMARK_AREA = 800.0

#: A building this short is not a building. 1,682 footprints across the three
#: wards carry a "measured" height under 1 m, which is the same p65 collapse
#: seen on the towers, at the other end. Below this the height is refused and
#: the fill convention applies instead, so the artefact never states a
#: half-metre building as a measurement.
MIN_CREDIBLE_H = 2.0

#: Overpass mirrors, tried in order. The main instance returned HTTP 504 on
#: two of four ward queries during this build, and the Bangalore probe earlier
#: lost 7 of 12 requests to rate limiting. One endpoint is not a data source,
#: it is a single point of failure.
OVERPASS = ("https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter")


def overpass_heights(w: blr.Ward) -> list[dict[str, Any]]:
    """OSM buildings in the ward carrying `height` or `building:levels`.

    `out center tags` rather than full geometry: the centroid is all that is
    needed to match a footprint we already hold, and it is a fraction of the
    payload. Overpass rate-limits hard, so this backs off rather than failing
    the run -- the Bangalore probe lost 7 of 12 requests on the first attempt.
    """
    import ssl
    import time
    import urllib.parse
    import urllib.request
    import certifi

    west, south, east, north = blr.bounds(w)
    q = (f'[out:json][timeout:180];('
         f'way["building"]["building:levels"]({south},{west},{north},{east});'
         f'way["building"]["height"]({south},{west},{north},{east});'
         f'relation["building"]["building:levels"]({south},{west},{north},{east});'
         f'relation["building"]["height"]({south},{west},{north},{east}););'
         f'out center tags;')
    ctx = ssl.create_default_context(cafile=certifi.where())
    last = ""
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "delta-climate-obos/1.0"})
            with urllib.request.urlopen(req, timeout=240, context=ctx) as r:
                doc = json.loads(r.read())
            return [e for e in doc.get("elements", []) if "center" in e or "lat" in e]
        except Exception as exc:                       # noqa: BLE001 -- see docstring
            last = f"{url.split('/')[2]}: {exc}"
            print(f"    overpass retry {attempt + 1}/6 ({last})", flush=True)
            time.sleep(6.0 + 5.0 * attempt)
    raise SystemExit(f"Overpass failed for {w.id} after 6 tries -- last {last}")


def parse_height(tags: dict[str, str]) -> float | None:
    """OSM `height`, metres. Returns None for anything not plainly numeric.

    Values arrive as "45", "45 m", "45.5m" and occasionally as feet-and-inches
    (`12'6"`), which is refused rather than guessed at.
    """
    raw = tags.get("height", "").strip().lower().replace("meter", "").replace("metres", "")
    raw = raw.replace("m", "").strip()
    try:
        v = float(raw)
    except ValueError:
        return None
    return v if 1.5 <= v <= 900.0 else None


def parse_levels(tags: dict[str, str]) -> float | None:
    raw = tags.get("building:levels", "").strip()
    try:
        v = float(raw)
    except ValueError:
        return None
    return v if 1.0 <= v <= 200.0 else None


#: A "storey" below this is not reliably a storey. MEASURED: fitting over every
#: building that carries both tags gives 3.93 m, and the sample that produces it
#: is contaminated by monumental low-rise -- Karnataka High Court at 25 m over
#: 2 floors (12.50 m per floor), Ambaji at 40 m over 2 (20.00), Vidhana Soudha at
#: 30 m over 4 (7.50). Those are double-height civic halls, and they are real,
#: but applying their ratio to 1,872 ordinary apartment blocks makes every one of
#: them 18 % too tall. Excluding them the fit is 3.33 m and STABLE: the median
#: does not move between a 3-storey and a 10-storey cut-off.
MIN_FIT_STOREYS = 5.0


def fit_storey_metres(rows: list[tuple[float, float]]) -> tuple[float, int]:
    """Metres per storey, FITTED from local buildings carrying both tags.

    Kolkata assumes 3.2 m and Dubai 4.0 m, and the Dubai work recorded that
    importing Kolkata's Indian constant into the Gulf cost a 20 % bias. Rather
    than import either into Bengaluru, this fits the ratio here -- but only from
    buildings tall enough that a storey means a storey (see MIN_FIT_STOREYS).

    The MEDIAN, not the mean: the mean over the same sample is 3.47 m against a
    median of 3.33, because a handful of high-ceilinged outliers survive even the
    storey cut-off. A median is what a contaminated sample calls for.
    """
    ratios = sorted(h / lv for h, lv in rows
                    if lv >= MIN_FIT_STOREYS and 1.5 <= h <= 900.0)
    if len(ratios) < 8:
        return 3.2, len(ratios)
    return round(statistics.median(ratios), 2), len(ratios)


def apply_osm_heights(w: blr.Ward, els: list[dict[str, Any]],
                      storey_m: float, n_fit: int) -> None:
    """Layer measured OSM heights and cited landmarks over the Google baseline.

    PRECEDENCE, best evidence first:
      cited      a published figure for a named building
      osm-height an OSM `height` tag -- a stated measurement
      osm-levels `building:levels` x a locally fitted metres-per-storey
      google     the zonal p65 that every building starts with
      fill       Google had no confident pixel, or the p65 was not credible

    Google's value is NEVER discarded -- it moves to `hGoogle` -- so the
    disagreement between the tiers stays measurable after the fact.
    """
    from shapely.geometry import Point, Polygon
    from shapely.strtree import STRtree

    path = os.path.join(blr.DATA, f"{w.id}-buildings.json")
    with open(path, encoding="utf-8") as fh:
        doc = cast(dict[str, Any], json.load(fh))
    bs = doc["b"]

    polys = []
    for b in bs:
        p = b["p"]
        pts = [(p[i], p[i + 1]) for i in range(0, len(p) - 1, 2)]
        polys.append(Polygon(pts) if len(pts) >= 3 else Point(0, 0).buffer(0.01))
    tree = STRtree(polys)
    cents = [blr.ring_centroid(b["p"]) for b in bs]

    for b, (cx, cy) in zip(bs, cents):
        b.setdefault("hGoogle", float(b["h"]))
        b["hSource"] = "fill" if b["fill"] else "google"
        # The p65 collapse at the short end: refuse it rather than state it.
        if not b["fill"] and float(b["h"]) < MIN_CREDIBLE_H:
            b["h"], b["fill"], b["hSource"] = blr.FILL_HEIGHT_M, True, "fill"

    def match(lat: float, lon: float, min_area: float, snap: float) -> int | None:
        x, y = blr.to_local(w, lon, lat)
        hits = tree.query(Point(x, y), predicate="within")
        for i in hits:
            if blr.ring_area(bs[int(i)]["p"]) >= min_area:
                return int(i)
        best, bd = None, snap
        for i, (cx, cy) in enumerate(cents):
            d = math.hypot(cx - x, cy - y)
            if d < bd and blr.ring_area(bs[i]["p"]) >= min_area:
                best, bd = i, d
        return best

    n_h = n_lv = 0
    for e in els:
        t = e.get("tags", {})
        c = e.get("center") or e
        idx = match(float(c["lat"]), float(c["lon"]), 12.0, 25.0)
        if idx is None:
            continue
        h, lv = parse_height(t), parse_levels(t)
        # THE NAME IS KEPT WHEREVER OSM HAS ONE, not only on cited landmarks.
        # It was dropped at first, and the cost showed up in the scene: 44
        # Whitefield buildings of 8 storeys or more carry a name in OSM and not
        # one reached the artefact, so a ward full of recognisable towers had
        # nothing selectable in it. A name is evidence too.
        if t.get("name"):
            bs[idx]["name"] = str(t["name"])
        if h is not None:
            bs[idx]["h"], bs[idx]["fill"] = round(h, 2), False
            bs[idx]["hSource"] = "osm-height"
            if lv is not None:
                bs[idx]["levels"] = lv
            n_h += 1
        elif lv is not None:
            bs[idx]["h"], bs[idx]["fill"] = round(lv * storey_m, 2), False
            bs[idx]["hSource"] = "osm-levels"
            bs[idx]["levels"] = lv
            n_lv += 1

    n_cited = 0
    for name, lat, lon, h, src in CITED_HEIGHTS:
        if not (blr.bounds(w)[0] <= lon <= blr.bounds(w)[2]
                and blr.bounds(w)[1] <= lat <= blr.bounds(w)[3]):
            continue
        idx = match(lat, lon, MIN_LANDMARK_AREA, LANDMARK_SNAP_M)
        if idx is None:
            print(f"    cited {name}: NO footprint within {LANDMARK_SNAP_M:.0f} m "
                  f"-- skipped, not invented")
            continue
        was = float(bs[idx]["h"])
        was_src = str(bs[idx].get("hSource", "?"))
        # A CITED HEIGHT OVERRIDES AN OSM ONE, AND THE DISAGREEMENT IS KEPT.
        # Measured on UB City: CTBUH gives Concorde 115 m over 20 floors and
        # Canberra 105 m over 18, i.e. 5.75 and 5.83 m per floor, which no
        # office building has. OSM tags both at 60 m, i.e. 3.00 and 3.33 --
        # ordinary. The likeliest reading is that CTBUH measures the podium
        # too while the floor count is tower-only, but that is a guess, so the
        # registry value ships and the conflict is published rather than
        # silently resolved. Same rule as the UT-GLOBUS cross-check.
        if was_src == "osm-height" and was > 0 and abs(h - was) / max(h, was) > 0.20:
            bs[idx]["heightConflict"] = {
                "cited": h, "osm": round(was, 2), "citedSource": src,
                "note": "cited ships; OSM's own tag disagrees by more than 20 %"}
            print(f"    CONFLICT {name:<24} cited {h:.1f} m vs OSM {was:.1f} m "
                  f"-- cited ships, both recorded")
        bs[idx]["h"], bs[idx]["fill"] = h, False
        bs[idx]["hSource"], bs[idx]["heightSourceCite"] = "cited", src
        bs[idx]["name"] = name
        n_cited += 1
        print(f"    cited {name:<28} {was:6.1f} -> {h:6.1f} m  ({src})")

    doc["storeyMetres"] = storey_m
    doc["storeyFitN"] = n_fit
    doc["heightTiers"] = {
        "cited": n_cited, "osm-height": n_h, "osm-levels": n_lv,
        "google": sum(1 for b in bs if b["hSource"] == "google"),
        "fill": sum(1 for b in bs if b["hSource"] == "fill"),
    }
    doc["heightNote"] = (
        f"Heights, best evidence first: cited published figures ({n_cited}), OSM "
        f"height tags ({n_h}), OSM building:levels x {storey_m} m fitted from "
        f"{n_fit} local buildings of at least {MIN_FIT_STOREYS:.0f} storeys "
        f"carrying both tags ({n_lv}), else zonal p65 of "
        f"Open Buildings 2.5D at ~{SCALE_M} m. A p65 under {MIN_CREDIBLE_H} m is "
        f"refused as not credible and falls back to the {blr.FILL_HEIGHT_M} m "
        f"fill. Google's value is kept on every building as hGoogle.")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} storey {storey_m} m (fit n={n_fit})  "
          f"cited {n_cited}  osm-height {n_h}  osm-levels {n_lv}  "
          f"google {doc['heightTiers']['google']:,}  fill {doc['heightTiers']['fill']:,}")


# ── canopy ──────────────────────────────────────────────────────────────────

#: Meta / WRI canopy height model on AWS Open Data, read anonymously. v1 is
#: PRIMARY for Bangalore, as the design spec pins it: the research pass found
#: v2 nearly doubles cover at every Bangalore site (61 % for Indiranagar is not
#: credible), and Kolkata's own fetch-canopy.py characterises v2 as better at
#: HOW TALL, not at WHERE. Placement is a where question. Both are measured
#: here so the choice carries numbers rather than a memory of them.
CHM_BUCKET = "dataforgood-fb-data"
CHM_V1 = ("forests/v1/alsgedi_global_v6_float", 9)
CHM_V2 = ("forests/v2/global/dinov3_global_chm_v2_ml3", 10)

#: KOLKATA'S PLACEMENT CONSTANTS, VERBATIM. 10 m cells (Kolkata: 140 over 1400 m,
#: here 280 over 2800 m), 0..4 instances per cell scaling with height against a
#: FIXED 30 m reference, positions jittered deterministically. Two cities placed
#: by the same rule are comparable; retuning any of these here would quietly make
#: "tree density" mean something different in each city.
CANOPY_GRID = 280
MIN_TREE_H = 2.0
DENSITY_MAX = 4
DENSITY_REF_H = 30.0
JITTER = 0.80
#: The spec's cover threshold, measured at ~1 m on the native raster, never on
#: the 10 m averages -- averaging blurs a threshold.
COVER_H = 3.0


def _kolkata_canopy() -> Any:
    """Load fetch-canopy.py as a module so its hash and quadkey are REUSED.

    Not copied: the jitter hash is what makes a Kolkata tree scatter and a
    Bangalore one the same procedure, and a copy drifts the day someone edits
    one of them. The hyphen in the file name forces importlib; the result is
    typed at the two call sites with cast rather than left as Any.
    """
    spec = importlib.util.spec_from_file_location(
        "fetch_canopy", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "fetch-canopy.py"))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _kolkata_module(file_name: str, module_name: str) -> Any:
    """Load one of Kolkata's hyphenated scripts so its measurement is REUSED, not copied."""
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(os.path.dirname(os.path.abspath(__file__)), file_name))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def looks_like_raster_or_zip(head: bytes) -> bool:
    """A TIFF (either byte order) or a ZIP; anything else is an error page, not data."""
    return head in (b"II*\x00", b"MM\x00*", b"PK\x03\x04")


def cached_download(url: str, dst: str) -> str:
    """Download once into the shared cache; an atomic rename means a partial file never counts."""
    if os.path.exists(dst):
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".part"
    rc = subprocess.run(["curl", "-s", "--fail", "-L", "--max-time", "1800", "-o", tmp, url]).returncode
    if rc != 0 or not os.path.exists(tmp):
        raise SystemExit(f"download failed (curl {rc}): {url}")
    with open(tmp, "rb") as fh:
        head = fh.read(4)
    if not looks_like_raster_or_zip(head):
        os.remove(tmp)
        raise SystemExit(f"download is not a TIFF or ZIP (got {head!r}): {url}")
    os.replace(tmp, dst)
    return dst


def tif_from_zip(zip_path: str) -> str:
    out = zip_path[:-4] + ".tif"
    if os.path.exists(out):
        return out
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        with z.open(name) as src, open(out + ".part", "wb") as dst:
            shutil.copyfileobj(src, dst)
    os.replace(out + ".part", out)
    return out


def edge_weights(lo: float, hi: float, start: int, n: int) -> Any:
    """Fraction of each of n unit pixels, starting at index `start`, that lies inside [lo, hi)."""
    import numpy as np
    edges = start + np.arange(n + 1, dtype=np.float64)
    return np.clip(np.minimum(edges[1:], hi) - np.maximum(edges[:-1], lo), 0.0, 1.0)


def worldpop_box_density(w: blr.Ward, tif: str) -> tuple[float, int]:
    """People per km2 over EXACTLY the ward box.

    WorldPop is on a geographic grid, so the box edges run along pixel rows and
    columns and each edge pixel is weighted by the fraction of it inside the box.
    Kolkata's fetch-worldpop.py summed a whole projected ENVELOPE but divided by the
    box area, which inflates density (Indiranagar 20,028 vs 16,026 on GHS-POP).
    """
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    west, south, east, north = blr.bounds(w)
    with rasterio.open(tif) as src:
        t = src.transform
        c0f, c1f = (west - t.c) / t.a, (east - t.c) / t.a
        r0f, r1f = (north - t.f) / t.e, (south - t.f) / t.e
        c0, c1 = int(np.floor(c0f)), int(np.ceil(c1f))
        r0, r1 = int(np.floor(r0f)), int(np.ceil(r1f))
        if not (0 <= c0 and c1 <= src.width and 0 <= r0 and r1 <= src.height):
            raise SystemExit(f"{w.id}: ward box runs outside {tif}")
        arr = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype("float64")
        nodata = src.nodata
    if nodata is not None:
        arr = np.where(arr == nodata, 0.0, arr)
    arr = np.where(np.isfinite(arr) & (arr > 0), arr, 0.0)
    weight = np.outer(edge_weights(r0f, r1f, r0, r1 - r0), edge_weights(c0f, c1f, c0, c1 - c0))
    total = float((arr * weight).sum())
    return round(total / (w.size_m / 1000.0) ** 2, 1), round(total)


def chm_path(w: blr.Ward, prefix: str, zoom: int, quadkey: Callable[[float, float, int], str]) -> str:
    return f"/vsis3/{CHM_BUCKET}/{prefix}/chm/{quadkey(w.centre.lat, w.centre.lon, zoom)}.tif"


def read_chm_metre(w: blr.Ward, path: str) -> Any:
    """The ward box at 1 m (2800 x 2800), north-up, metres. numpy float32.

    ONE READ PER PRODUCT. The 1 m array is used twice: the cover fraction is
    measured on it, and the 10 m placement grid is a 10x10 block mean of it.
    The v1 tile is a 65536-wide untiled monolith where any window costs whole
    rows, so a second read for the coarse grid would double the transfer.
    """
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
    # THE v1 TILE IS STORED IN ONE-ROW STRIPS, 65,536 pixels wide and untiled,
    # so a window costs whole rows and minutes per ward. The obvious remedy --
    # GDAL_HTTP_MERGE_CONSECUTIVE_RANGES, GDAL_HTTP_MULTIRANGE and an 8 MB
    # CPL_VSIL_CURL_CHUNK_SIZE -- was MEASURED on a 300 x 300 window of this
    # tile: 12.3 s at the defaults, 22.7 s tuned. Slower. It is not applied,
    # and this note exists so the next person does not re-apply it on the
    # same reasoning.
    west, south, east, north = blr.bounds(w)
    n = int(w.size_m)
    with rasterio.open(path) as src:
        l, b, r, t = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
        win = from_bounds(l, b, r, t, src.transform)
        arr = src.read(1, window=win, out_dtype="float32", out_shape=(n, n),
                       boundless=True, fill_value=0.0, resampling=Resampling.average)
    out = np.asarray(arr, dtype=np.float32)
    out[~np.isfinite(out)] = 0.0
    np.clip(out, 0.0, None, out=out)
    return out


def place_canopy(grid: Any, size_m: float,
                 hash01: Callable[[int, int, int, int], float],
                 species: tuple[str, ...]) -> list[dict[str, Any]]:
    """Kolkata's `_generate` over a CANOPY_GRID x CANOPY_GRID height grid, species INCLUDED.

    WAS INLINE IN build_canopy WITH SPECIES OMITTED ("verbatim in logic, species
    omitted"), which is why every Bengaluru tree rendered as neem. The draw is the
    same `hash01(col, row, kk, 3)` Kolkata uses, keyed on the cell identity that
    exists only here -- once candidates are a flat list it is gone.
    """
    cell_m = size_m / CANOPY_GRID
    half = size_m / 2.0
    cands: list[dict[str, Any]] = []
    for row in range(CANOPY_GRID):
        for col in range(CANOPY_GRID):
            h = float(grid[row, col])
            if h < MIN_TREE_H:
                continue
            count = min(DENSITY_MAX, int(DENSITY_MAX * h / DENSITY_REF_H + 0.5))
            for kk in range(count):
                jx = (hash01(col, row, kk, 0) - 0.5) * JITTER * cell_m
                jy = (hash01(col, row, kk, 1) - 0.5) * JITTER * cell_m
                x = round((col + 0.5) * cell_m - half + jx, 2)
                y = round(half - (row + 0.5) * cell_m + jy, 2)
                r = round(h * 0.35 * (0.9 + 0.2 * hash01(col, row, kk, 2)), 2)
                sp = species[int(hash01(col, row, kk, 3) * len(species))]
                cands.append({"x": x, "y": y, "h": round(h, 1), "r": r, "species": sp})
    return cands


def recover_species(tree: dict[str, Any], size_m: float,
                    hash01: Callable[[int, int, int, int], float],
                    species: tuple[str, ...]) -> str:
    """The species `place_canopy` would have drawn for an already-placed tree.

    For canopy files written before the draw was restored. The canopy height model
    is an untiled S3 monolith read over the network, so re-placing is minutes per
    ward; the placement is deterministic, so the cell is recovered instead:

    - col/row from the position: jitter is bounded at JITTER (0.8) of a cell, so a
      tree never leaves its cell.
    - kk by matching the stored x/y to 1 cm against each candidate draw.
    - ties (two kk landing within 1 cm) broken by the stored radius, which is drawn
      from the same hash.

    Measured on the shipped wards: 59,184 of 59,184 recovered uniquely.
    """
    cell_m = size_m / CANOPY_GRID
    half = size_m / 2.0
    col = int((tree["x"] + half) / cell_m)
    row = int((half - tree["y"]) / cell_m)
    hits: list[int] = []
    for kk in range(DENSITY_MAX):
        jx = (hash01(col, row, kk, 0) - 0.5) * JITTER * cell_m
        jy = (hash01(col, row, kk, 1) - 0.5) * JITTER * cell_m
        if (abs(round((col + 0.5) * cell_m - half + jx, 2) - tree["x"]) < 0.011
                and abs(round(half - (row + 0.5) * cell_m + jy, 2) - tree["y"]) < 0.011):
            hits.append(kk)
    if len(hits) > 1:
        # tree["h"] is rounded to 0.1 m in the file, but r was computed from the
        # unrounded height: that rounding can move r by up to
        # 0.05 * 0.35 * 1.1 ~= 0.019, plus the 0.011 x/y tolerance ~= 0.030.
        hits = [kk for kk in hits
                if abs(round(tree["h"] * 0.35 * (0.9 + 0.2 * hash01(col, row, kk, 2)), 2)
                       - tree["r"]) < 0.030]
    if len(hits) != 1:
        raise ValueError(f"cannot recover the cell of tree {tree} (candidates {hits})")
    return species[int(hash01(col, row, hits[0], 3) * len(species))]


def backfill_species(w: blr.Ward) -> None:
    """Write the species draw into an existing {ward}-canopy.json, offline."""
    kc = _kolkata_canopy()
    hash01 = cast(Callable[[int, int, int, int], float], kc._hash01)
    species = cast(tuple[str, ...], kc.SPECIES)
    path = os.path.join(blr.DATA, f"{w.id}-canopy.json")
    with open(path, encoding="utf-8") as fh:
        doc = cast(dict[str, Any], json.load(fh))
    mix: dict[str, int] = {}
    for t in doc["trees"]:
        t["species"] = recover_species(t, float(w.size_m), hash01, species)
        mix[t["species"]] = mix.get(t["species"], 0) + 1
    doc["method"] = str(doc["method"]).replace(
        "Species not assigned.",
        "Species drawn as Kolkata's: hash01(col, row, kk, 3) over its SPECIES tuple.")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} species {dict(sorted(mix.items()))}", flush=True)


def build_canopy(w: blr.Ward) -> None:
    import numpy as np
    from shapely.geometry import Point, Polygon
    from shapely.strtree import STRtree

    kc = _kolkata_canopy()
    quadkey = cast(Callable[[float, float, int], str], kc._quadkey)
    hash01 = cast(Callable[[int, int, int, int], float], kc._hash01)

    p1 = chm_path(w, CHM_V1[0], CHM_V1[1], quadkey)
    p2 = chm_path(w, CHM_V2[0], CHM_V2[1], quadkey)
    print(f"  {w.id:<12} reading v1 tile ...", flush=True)
    m1 = read_chm_metre(w, p1)
    print(f"  {w.id:<12} reading v2 tile ...", flush=True)
    m2 = read_chm_metre(w, p2)
    cover1 = float((m1 >= COVER_H).mean())
    cover2 = float((m2 >= COVER_H).mean())
    print(f"  {w.id:<12} cover >= {COVER_H:.0f} m: v1 {100 * cover1:5.1f} %   v2 {100 * cover2:5.1f} %",
          flush=True)

    # 10 m placement grid from the 1 m array. Reshape is exact because size_m
    # is a multiple of CANOPY_GRID, and the assert keeps it that way.
    n = int(w.size_m)
    k = n // CANOPY_GRID
    assert k * CANOPY_GRID == n, "ward size must be a whole number of 10 m cells"
    grid = m1.reshape(CANOPY_GRID, k, CANOPY_GRID, k).mean(axis=(1, 3))

    # ── Kolkata's _generate, with Kolkata's species draw (see place_canopy) ──
    species = cast(tuple[str, ...], kc.SPECIES)
    cands = place_canopy(grid, w.size_m, hash01, species)

    # ── drop candidates standing inside a building, or in a carriageway ──
    # Kolkata records ~30 % of its rendered trees on rooftops OR IN ROADS as
    # known limitation 2 and defers the fix. Both halves are closed here,
    # because both layers are already in hand.
    #
    # The road half was measured before it was fixed: 3,843 of Indiranagar's
    # trees (14.0 %), 3,754 of MG Road's (13.1 %) and 1,215 of Whitefield's
    # (10.1 %) stood inside a drawn carriageway. That is the canopy model
    # reading a tree-lined street as canopy over the whole street, which at
    # 1 m resolution is what an overhanging crown looks like from above.
    #
    # Both counts are kept rather than just subtracted: they measure how far
    # the canopy model disagrees with the building and road layers, which is
    # worth knowing on its own.
    rpath = os.path.join(blr.DATA, f"{w.id}-context.json")
    dropped_road = 0
    if os.path.exists(rpath) and cands:
        from shapely.geometry import LineString
        with open(rpath, encoding="utf-8") as fh:
            ctx = json.load(fh)
        ribbons = []
        for r in ctx.get("roads", []):
            ln = r.get("line") or []
            pts = [(ln[i], ln[i + 1]) for i in range(0, len(ln) - 1, 2)]
            if len(pts) >= 2:
                ribbons.append(LineString(pts).buffer(
                    ROAD_WIDTH_M.get(str(r.get("cls")), 5.0) / 2.0,
                    cap_style="flat"))
        if ribbons:
            rtree = STRtree(ribbons)
            rpts = [Point(c["x"], c["y"]) for c in cands]
            rhit = rtree.query(rpts, predicate="within")
            rin = set(int(i) for i in np.asarray(rhit)[0]) if len(rhit) else set()
            kept0 = [c for i, c in enumerate(cands) if i not in rin]
            dropped_road = len(cands) - len(kept0)
            cands = kept0

    bpath = os.path.join(blr.DATA, f"{w.id}-buildings.json")
    dropped = 0
    if os.path.exists(bpath) and cands:
        with open(bpath, encoding="utf-8") as fh:
            bdoc = cast(blr.BlrBuildingsFile, json.load(fh))
        polys = []
        for b in bdoc["b"]:
            p = b["p"]
            pts = [(p[i], p[i + 1]) for i in range(0, len(p) - 1, 2)]
            if len(pts) >= 3:
                polys.append(Polygon(pts))
        tree = STRtree(polys)
        pts_geom = [Point(c["x"], c["y"]) for c in cands]
        hit = tree.query(pts_geom, predicate="within")
        inside = set(int(i) for i in np.asarray(hit)[0]) if len(hit) else set()
        kept = [c for i, c in enumerate(cands) if i not in inside]
        dropped = len(cands) - len(kept)
    else:
        kept = cands

    doc = {
        "ward": w.id, "sizeM": w.size_m, "grid": CANOPY_GRID,
        "source": f"Meta/WRI global canopy height model v1 ({CHM_V1[0]}), "
                  f"CC BY 4.0, tile {quadkey(w.centre.lat, w.centre.lon, CHM_V1[1])}",
        "coverFrac": {"v1": round(cover1, 4), "v2": round(cover2, 4),
                      "thresholdM": COVER_H, "note":
                      "v1 is shipped; v2 measured alongside per the design spec. "
                      "Cover is the share of 1 m pixels at or above the threshold."},
        "method": "Kolkata fetch-canopy.py _generate: 10 m cells, 0..4 instances "
                  "per cell scaling with height against a fixed 30 m reference, "
                  "deterministic jitter. Tree COUNT is a display scaling, not a "
                  "measurement; canopy HEIGHT is measured. Species drawn as "
                  "Kolkata's: hash01(col, row, kk, 3) over its SPECIES tuple.",
        "densityRefM": DENSITY_REF_H, "minTreeH": MIN_TREE_H,
        "candidates": len(cands) + dropped_road, "droppedInBuildings": dropped,
        "droppedInRoads": dropped_road,
        "count": len(kept), "trees": kept,
    }
    with open(os.path.join(blr.DATA, f"{w.id}-canopy.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} trees {len(kept):,}  dropped {dropped:,} in buildings, "
          f"{dropped_road:,} in roads", flush=True)


# ── heights ─────────────────────────────────────────────────────────────────

def init_ee() -> None:
    import ee
    cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.path.expanduser(
        "~/.config/delta-climate/ee-service-account.json")
    if not os.path.exists(cred):
        raise SystemExit(f"no Earth Engine credentials at {cred}")
    with open(cred, encoding="utf-8") as fh:
        sa = json.load(fh)
    ee.Initialize(ee.ServiceAccountCredentials(sa["client_email"], cred))


def height_image() -> Any:
    import ee
    col = (ee.ImageCollection(blr.GOOGLE_25D)
           .filterDate(EPOCH[0], EPOCH[1]))
    return col.select("building_height").mosaic()


def utglobus_tile(w: blr.Ward) -> str | None:
    """A UT-GLOBUS gpkg whose extent covers this ward, or None.

    Checked by actually reading the tile's extent rather than trusting its name.
    That is the whole point: the shortlist changed once during design, MG Road
    moved into a different tile, and the cross-check returned zero buildings --
    which reads as "no disagreement" rather than "no data" unless something
    looks.
    """
    import rasterio.warp
    west, south, east, north = blr.bounds(w)
    for d in UTGLOBUS_DIRS:
        if not d or not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".gpkg"):
                continue
            path = os.path.join(d, fn)
            try:
                con = sqlite3.connect(path)
                row = con.execute(
                    "SELECT min_x, min_y, max_x, max_y FROM gpkg_contents "
                    "WHERE table_name='GLOBUS'").fetchone()
                con.close()
            except sqlite3.Error:
                continue
            if not row:
                continue
            # gpkg_contents is in the layer's own CRS (EPSG:32643 here).
            tr = rasterio.warp.transform(
                "EPSG:4326", "EPSG:32643", [west, east], [south, north])
            xs, ys = tr[0], tr[1]
            if (row[0] <= xs[0] and xs[1] <= row[2]
                    and row[1] <= ys[0] and ys[1] <= row[3]):
                return path
    return None


def utglobus_heights(w: blr.Ward, path: str) -> dict[tuple[int, int], float]:
    """UT-GLOBUS heights indexed by rounded local-metre centroid.

    Uses the gpkg's rtree index, so the 774k-row table is never scanned and no
    WKB is parsed -- the index alone carries the bounding boxes we need.

    ZERO AND THE 492 m MAXIMUM ARE ARTEFACTS. The city-wide minimum is 0.0 m and
    the maximum 492 m against a real tallest of ~160 m. Both are dropped here
    rather than at the comparison, so a zero can never be read as flat ground.
    """
    import rasterio.warp
    tr = rasterio.warp.transform(
        "EPSG:4326", "EPSG:32643", [w.centre.lon], [w.centre.lat])
    xs, ys = tr[0], tr[1]
    cx, cy, half = xs[0], ys[0], w.size_m / 2.0
    con = sqlite3.connect(path)
    rows = con.execute(
        "SELECT (r.minx+r.maxx)/2, (r.miny+r.maxy)/2, g.height "
        "FROM rtree_GLOBUS_geom r JOIN GLOBUS g ON g.fid = r.id "
        "WHERE r.minx >= ? AND r.maxx <= ? AND r.miny >= ? AND r.maxy <= ? "
        "AND g.height IS NOT NULL",
        (cx - half, cx + half, cy - half, cy + half)).fetchall()
    con.close()

    mx, my = blr.m_per_deg(w.centre.lat)
    out: dict[tuple[int, int], float] = {}
    back = rasterio.warp.transform(
        "EPSG:32643", "EPSG:4326", [r[0] for r in rows], [r[1] for r in rows])
    lons, lats = back[0], back[1]
    for (_ux, _uy, h), lon, lat in zip(rows, lons, lats):
        if not (0.0 < float(h) < 200.0):
            continue
        x = (lon - w.centre.lon) * mx
        y = (lat - w.centre.lat) * my
        out[(round(x / 5.0), round(y / 5.0))] = float(h)
    return out


def crosscheck_would_erase(existing: str, tile: str | None) -> bool:
    """True when recording a cross-check now would replace real evidence with a skip."""
    return tile is None and bool(existing) and not existing.startswith("SKIPPED")


def cross_check(w: blr.Ward, doc: blr.BlrBuildingsFile, tile: str | None) -> None:
    """Attach UT-GLOBUS heights as `hUt` and `flag`, and write `crossCheck`.

    NEVER TOUCHES `h`. The cross-check is a flag, not a correction: two sources that
    disagree by more than DISAGREE_M are marked, never blended. Split out of
    compute_heights so it can run without Earth Engine (see run_crosscheck).

    Resets hUt/flag on every building FIRST, unconditionally -- both compute_heights
    and run_crosscheck may call this on a doc that already carries a prior
    cross-check, and a skip (tile is None) must not leave stale flags standing: no
    comparison exists, so None/False is the honest state.
    """
    bs = doc["b"]
    for b in bs:
        b["hUt"] = None
        b["flag"] = False
    if tile:
        ut = utglobus_heights(w, tile)
        mx, my = 0, 0
        diffs: list[float] = []
        for b in bs:
            cx, cy = blr.ring_centroid(b["p"])
            hu = ut.get((round(cx / 5.0), round(cy / 5.0)))
            if hu is None:
                continue
            mx += 1
            b["hUt"] = hu
            if not b["fill"] and abs(hu - b["h"]) > blr.DISAGREE_M:
                b["flag"] = True
                my += 1
            if not b["fill"]:
                diffs.append(abs(hu - b["h"]))
        mae = statistics.mean(diffs) if diffs else 0.0
        doc["crossCheck"] = (
            f"UT-GLOBUS {os.path.basename(tile)}: {mx:,} of {len(bs):,} matched, "
            f"MAE {mae:.2f} m, {my:,} flagged >{blr.DISAGREE_M:.0f} m. "
            "Flag only -- never blended into h.")
        print(f"  {w.id:<12} cross-check {mx:,} matched, MAE {mae:.2f} m, "
              f"{my:,} flagged")
    else:
        doc["crossCheck"] = (
            "SKIPPED -- no UT-GLOBUS tile covering this ward was found. "
            "This is a recorded skip, not an absence of disagreement.")
        print(f"  {w.id:<12} cross-check SKIPPED (no covering tile)")


def run_crosscheck(w: blr.Ward) -> None:
    """--layer crosscheck: re-run the UT-GLOBUS comparison on COMMITTED heights, offline.

    WHY THIS EXISTS. The comparison lived only inside compute_heights, which first
    re-reduces every footprint through Earth Engine -- so recording MG Road's check
    meant re-deriving (and possibly moving) every shipped height, on an account that
    now returns 403. This reads the committed file and changes only hUt, flag and
    crossCheck.
    """
    path = os.path.join(blr.DATA, f"{w.id}-buildings.json")
    with open(path, encoding="utf-8") as fh:
        doc = cast(blr.BlrBuildingsFile, json.load(fh))
    tile = utglobus_tile(w)
    existing = str(doc.get("crossCheck", ""))
    if crosscheck_would_erase(existing, tile):
        raise SystemExit(
            f"{w.id}: no UT-GLOBUS tile found, and the file already holds a real cross-check "
            f"({existing[:60]}...). Refusing to overwrite evidence with a skip.")
    cross_check(w, doc, tile)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))


def compute_heights(w: blr.Ward) -> None:
    import ee

    path = os.path.join(blr.DATA, f"{w.id}-buildings.json")
    if not os.path.exists(path):
        raise SystemExit(f"no footprints for {w.id} -- run --layer buildings first")
    with open(path, encoding="utf-8") as fh:
        doc = cast(blr.BlrBuildingsFile, json.load(fh))

    img = height_image()
    reducer = ee.Reducer.percentile([65])
    bs = doc["b"]
    print(f"  {w.id:<12} reducing {len(bs):,} footprints at {SCALE_M} m ...")

    filled = 0
    for start in range(0, len(bs), PAGE):
        page = bs[start:start + PAGE]
        feats = [ee.Feature(ee.Geometry.Polygon([b["lonlat"]]), {"i": start + k})
                 for k, b in enumerate(page)]
        got = img.reduceRegions(
            collection=ee.FeatureCollection(feats), reducer=reducer,
            scale=SCALE_M, tileScale=4).getInfo()
        by_i = {f["properties"]["i"]: f["properties"].get("p65")
                for f in got["features"]}
        for k, b in enumerate(page):
            v = by_i.get(start + k)
            if v is None or not math.isfinite(float(v)) or float(v) <= 0.0:
                b["h"], b["fill"] = blr.FILL_HEIGHT_M, True
                filled += 1
            else:
                b["h"], b["fill"] = round(float(v), 2), False
        done = min(start + PAGE, len(bs))
        print(f"    {done:6,}/{len(bs):,}", end="\r", flush=True)
    print()

    cross_check(w, doc, utglobus_tile(w))

    doc["heightSource"] = "Google Open Buildings 2.5D Temporal v1 (2023 epoch)"
    doc["heightNote"] = (
        f"Heights: zonal p65 of Open Buildings 2.5D Temporal at ~{SCALE_M} m per "
        f"Overture footprint. Where no confident pixel covers a footprint the "
        f"height is {blr.FILL_HEIGHT_M} m with fill=true (Google's convention).")
    doc["fillFraction"] = round(filled / max(1, len(bs)), 4)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} fill {100 * filled / max(1, len(bs)):.1f}%")


# ── terrain ─────────────────────────────────────────────────────────────────

def build_terrain(w: blr.Ward, context: bool = False) -> None:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    span = w.size_m * (CONTEXT_MULT if context else 1.0)
    n_out = CONTEXT_N if context else TERRAIN_N
    pad = (span - w.size_m) / 2.0
    west, south, east, north = blr.bounds(w, pad_m=pad)
    with rasterio.open(GLO30) as ds:
        win = from_bounds(west, south, east, north, ds.transform)
        arr = ds.read(1, window=win, out_shape=(n_out, n_out),
                      resampling=Resampling.bilinear).astype(float)
        # NATIVE relief, read at GLO-30's own posting. Resampling to TERRAIN_N
        # is bilinear, which CLIPS THE TAILS: measured, the 96x96 mesh reports
        # 2-4 m less relief than the raster does. Both numbers are correct for
        # what they describe, and publishing only the mesh's would look like a
        # disagreement with the relief figures in the design spec.
        nat = ds.read(1, window=win).astype(float)
        nat = nat[nat > -1000.0]
        relief_native = float(nat.max() - nat.min()) if nat.size else 0.0

    # GLO-30 IS NORTH-UP: row 0 is the northern edge. The local frame has +y
    # north, so row 0 must become the SOUTH edge. Flipping here, once, is why
    # the N-S mirror that shipped for a day in the Dubai terrain cannot recur.
    arr = np.flipud(arr)
    arr[arr < -1000.0] = float(np.nanmedian(arr[arr >= -1000.0]))

    doc: blr.BlrTerrainFile = {
        "ward": w.id, "sizeM": span, "n": n_out,
        "source": "Copernicus GLO-30 DEM (ESA/Airbus, free and open, "
                  "commercial use permitted)",
        "minM": round(float(arr.min()), 2), "maxM": round(float(arr.max()), 2),
        "meanM": round(float(arr.mean()), 2),
        "reliefNativeM": round(relief_native, 2),
        "resampleNote": (
            f"Mesh is {n_out}x{n_out} over {span:.0f} m, bilinear from GLO-30's "
            f"native ~30 m posting. minM/maxM describe the MESH; reliefNativeM is "
            f"the raster's own range, larger because bilinear clips tails."),
        "h": [round(float(v), 2) for v in arr.ravel()],
    }
    os.makedirs(blr.DATA, exist_ok=True)
    suffix = "-terrain-context" if context else "-terrain"
    with open(os.path.join(blr.DATA, f"{w.id}{suffix}.json"), "w",
              encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    label = "context" if context else "terrain"
    print(f"  {w.id:<12} {label:<8} {n_out}x{n_out} over {span:.0f} m  "
          f"{doc['minM']:.1f}-{doc['maxM']:.1f} m  mesh relief "
          f"{doc['maxM'] - doc['minM']:.1f} m (native {relief_native:.1f} m)")


def build_dcurs_static(wards: list[blr.Ward]) -> None:
    """--layer dcurs-static: the four non-thermal DC-URS inputs, per ward, into one file."""
    import rasterio
    import _dcurs_blr as dc
    import _types
    pop_tif = cached_download(WORLDPOP_URL, os.path.join(GEO_CACHE, "worldpop", os.path.basename(WORLDPOP_URL)))
    wc_tif = cached_download(WORLDCOVER_URL, os.path.join(GEO_CACHE, "worldcover", "N12E075.tif"))
    cf = _kolkata_module("compute-far.py", "compute_far")
    ct = _kolkata_module("compute-tra.py", "compute_tra")
    fsc = _kolkata_module("fetch-sentinel-composites.py", "fetch_sentinel_composites")
    out: dc.StaticFile = {
        "generated": "fetch-bangalore.py --layer dcurs-static",
        "ghsPop": WORLDPOP_URL,
        "worldCover": WORLDCOVER_URL,
        "sentinel": f"earth-search sentinel-2-l2a via _sentinel.py, years {SENTINEL_YEARS}",
        "wards": {},
    }
    for w in wards:
        density, population = worldpop_box_density(w, pop_tif)
        with open(os.path.join(blr.DATA, f"{w.id}-buildings.json"), encoding="utf-8") as fh:
            storey = float(json.load(fh)["storeyMetres"])
        wb = cf.ward_buildings(os.path.join(blr.ROOT, "public", "heat-map", "data", f"{w.id}.json"))
        far = round(float(cf.far_of(wb, wb.heights, storey)), 4)
        tw = _types.Ward(w.id, _types.LatLon(w.centre.lat, w.centre.lon), int(w.size_m))
        with rasterio.open(wc_tif) as src:
            dist = round(float(ct.ward_tra(src, tw)["median_dist_m"]), 1)
        sw = fsc.ward(f"blr-{w.id}", w.centre.lat, w.centre.lon, int(w.size_m), SENTINEL_YEARS)
        out["wards"][w.id] = {
            "popDensity": density, "population": population, "far": far, "storeyM": storey,
            "distCoolM": dist, "ndviMean": float(sw["ndvi_mean"]), "ndviStd": float(sw["ndvi_std"]),
            "ndviYears": int(sw["years"]),
        }
        print(f"  {w.id:<12} pop {density:,.0f}/km2 · FAR {far} (storey {storey} m) · "
              f"refuge {dist:.0f} m · NDVI {sw['ndvi_mean']} ± {sw['ndvi_std']} ({sw['years']} yr)")
    with open(dc.STATIC_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)


def box_mask(tf: Any, width: int, height: int,
             west: float, south: float, east: float, north: float) -> Any:
    """(height, width) bool array, True for pixels whose row AND column fall inside the box.

    `target_grid`'s affine is north-up, so rows run from the NORTH edge down and
    columns from the WEST edge: (west, north) is the box's first (row, col) and
    (east, south) its last, inclusive -- the same convention worldpop_box_density
    uses for its own row/column arithmetic. That arithmetic went untested until a
    code review caught it (a north/south flip there moves real totals by well
    under 1 %, invisible to any sanity range); this is the same shape of risk on
    the ECOSTRESS grid, pulled out as a pure function so it can be pinned directly
    rather than only through a population number three steps downstream.

    CLAMPED, NOT WRAPPED. A raw negative index (a box reaching west or north of
    the grid) handed straight to a numpy slice wraps around from the far edge
    instead of refusing, which reads as a plausible mask over the wrong pixels.
    Each bound is clamped into [0, dim-1] independently, so an out-of-range edge
    is pulled to the grid boundary rather than silently relocated.
    """
    import numpy as np
    from rasterio.transform import rowcol
    r0, c0 = cast(tuple[int, int], rowcol(tf, west, north))
    r1, c1 = cast(tuple[int, int], rowcol(tf, east, south))
    r0c, r1c = max(0, min(r0, height - 1)), max(0, min(r1, height - 1))
    c0c, c1c = max(0, min(c0, width - 1)), max(0, min(c1, width - 1))
    m = np.zeros((height, width), dtype=bool)
    m[r0c:r1c + 1, c0c:c1c + 1] = True
    return m


#: G2 pre-run gate: the expected mask size, (2800 m / 70 m)**2, and how far a
#: mask's centre pixel may sit from the ward's true centre before the run refuses.
DCURS_MASK_PX = (1300, 1900)
DCURS_MASK_OFFSET_M = 150.0


def dcurs_mask_report(tf: Any, width: int, height: int, crs: str,
                      wards: list[blr.Ward]) -> dict[str, Any]:
    """Build and gate every ward's mask on the rural grid, entirely offline.

    Runs before any CMR search or download: it costs nothing, and it is the
    guard that stops a mis-built mask (say, a north/south rowcol swap) before
    the 22-hour run rather than after it. Two checks, neither of which a
    sanity range on the final numbers would catch on its own:

      - the pixel count must be close to (2800 / 70)**2 ~= 1600, so a mask that
        is empty, doubled, or reading the wrong axis is refused outright;
      - the mask's own centre pixel, converted back to lon/lat, must sit within
        DCURS_MASK_OFFSET_M of the ward's registered centre -- catching a mask
        that has the right SIZE but is shifted, e.g. by a swapped row/column.

    Returns the built masks, keyed by ward id, for the caller to reuse.
    """
    import numpy as np
    from rasterio.warp import transform, transform_bounds
    lo, hi = DCURS_MASK_PX
    masks: dict[str, Any] = {}
    for w in wards:
        west, south, east, north = transform_bounds("EPSG:4326", crs, *blr.bounds(w), densify_pts=21)
        m = box_mask(tf, width, height, west, south, east, north)
        n = int(m.sum())
        if not (lo <= n <= hi):
            raise SystemExit(f"{w.id}: mask has {n} px, expected {lo}-{hi} (~1600) -- "
                             f"refusing to run dcurs-lst with a mis-built ward mask")
        rows, cols = np.nonzero(m)
        row_c, col_c = float(rows.mean()) + 0.5, float(cols.mean()) + 0.5
        x, y = tf * (col_c, row_c)
        lons, lats = cast(tuple[list[float], list[float]],
                          transform(crs, "EPSG:4326", [x], [y]))
        mx, my = blr.m_per_deg(w.centre.lat)
        d = math.hypot((lons[0] - w.centre.lon) * mx, (lats[0] - w.centre.lat) * my)
        if d > DCURS_MASK_OFFSET_M:
            raise SystemExit(f"{w.id}: mask centre is {d:.0f} m from the ward centre, "
                             f"beyond the {DCURS_MASK_OFFSET_M:.0f} m gate -- refusing to "
                             f"run dcurs-lst with a mis-built ward mask")
        masks[w.id] = m
        print(f"  mask {w.id}: {n} px, centre offset {d:.0f} m", flush=True)
    return masks


def group_by_orbit(acqs: list[tuple[str, list[dict[str, Any]]]]
                   ) -> list[tuple[str, list[dict[str, Any]]]]:
    """Merge acquisitions that `cmr_search` split, but that are one orbital pass.

    `cmr_search` groups granules by their exact `BeginningDateTime`, but
    ECOSTRESS captures an orbit as a sequence of scenes a few seconds apart, and
    RURAL_BBOX (0.8 deg) is wide enough that one pass over it can cross a scene
    boundary -- surfacing as two or more separate "acquisitions" at slightly
    different timestamps, which would otherwise count as extra, weaker rows
    instead of the one wide-coverage row they actually are.

    Regrouped by ORBIT instead: a granule's GranuleUR carries it as the 4th
    underscore-separated field, e.g.
    `ECOv002_L2T_LSTE_31137_030_45QXE_20240102T162318_0711_01` -> `31137`
    (index 3). Each orbit's group is keyed by the EARLIEST of its timestamps,
    and granules are de-duplicated by GranuleUR -- the same granule can appear
    twice if a network retry re-lists a page. Returned newest first, like
    `cmr_search` itself.
    """
    by_orbit: dict[str, tuple[str, dict[str, dict[str, Any]]]] = {}
    for utc, grans in acqs:
        for g in grans:
            ur = str(g["GranuleUR"])
            orbit = ur.split("_")[3]
            prev_utc, prev_grans = by_orbit.get(orbit, (utc, {}))
            by_orbit[orbit] = (min(prev_utc, utc), prev_grans)
            by_orbit[orbit][1][ur] = g
    out = [(utc, list(grans.values())) for utc, grans in by_orbit.values()]
    out.sort(key=lambda t: t[0], reverse=True)
    return out


#: The three ECOSTRESS band results a granule can yield. ABSENT means
#: `band_url` found no such band for this granule -- a normal fact, e.g. an
#: older granule with no water mask. FAILED means the band's URL existed but
#: the download stalled or was truncated, or the file would not warp -- a
#: TRANSIENT problem that must not be recorded as if the band were absent.
BandStatus = Literal["ok", "absent", "failed"]


def band(eco: Any, tok: str, g: dict[str, Any], suffix: str, nodata: float,
        dtype: str) -> tuple[BandStatus, Any]:
    """Fetch and align one ECOSTRESS band, telling ABSENT apart from FAILED (see BandStatus).

    `eco.fetch` can raise `subprocess.TimeoutExpired` on a stalled curl and
    leave a partial file bigger than `MIN_TIF_BYTES` sitting at exactly the
    path it would have returned -- `eco.align` then raises on that file every
    time, forever, on every future run. The header check catches the same
    failure when curl exits 0 on a truncated body.

    On any such FAILURE the file at this band's cache path is removed
    UNCONDITIONALLY -- not only when this acquisition created it. The path is
    derived from this granule's own URL, so a file already sitting there is
    corrupt or truncated from some earlier attempt and is never useful to
    anything else; leaving it in place would fail this same acquisition again
    on every future run. (This function does not need to know what predates
    this acquisition -- only the per-acquisition sweep of brand-new files, in
    `run_dcurs_lst`, consults `before`, to avoid deleting a file that predates
    this acquisition and is still good.)

    `eco` is untyped (`Any`) deliberately: this is called with the real
    `_ecostress` module in production and with a small fake module in
    `_self_test`, so it can be pinned without a live token or network.
    """
    import rasterio.errors
    url = eco.band_url(g, suffix)
    if url is None:
        return "absent", None
    path = os.path.join(eco.CACHE, url.rsplit("/", 1)[-1])
    ok = False
    arr: Any = None
    try:
        p = eco.fetch(url, tok)
        if p is not None:
            with open(p, "rb") as fh:
                head = fh.read(4)
            if looks_like_raster_or_zip(head):
                arr = eco.align(p, nodata, dtype, bbox=RURAL_BBOX)
                ok = True
    except (subprocess.TimeoutExpired, rasterio.errors.RasterioError, OSError):
        ok = False
    if not ok:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        return "failed", None
    return "ok", arr


def resume_mismatch(doc: Mapping[str, Any]) -> str | None:
    """A reason to refuse resuming from an existing dcurs-lst scenes file, or None.

    An existing scenes file records the `rural_bbox` and `start` it was built
    with. If RURAL_BBOX or ECOSTRESS_START has since changed, rows measured
    under the old settings and rows measured under the new ones would mix
    silently in the same file. JSON round-trips floats, so `rural_bbox` is
    compared as a list, not against the RURAL_BBOX tuple directly.
    """
    old_bbox = list(doc["rural_bbox"])
    if old_bbox != list(RURAL_BBOX):
        return (f"the existing scenes file was built with rural_bbox={old_bbox}, but RURAL_BBOX is "
                f"now {list(RURAL_BBOX)}; move the old scenes file aside, or restore RURAL_BBOX to "
                "match it, before resuming")
    if doc["start"] != ECOSTRESS_START:
        return (f"the existing scenes file was built with start={doc['start']!r}, but ECOSTRESS_START "
                f"is now {ECOSTRESS_START!r}; move the old scenes file aside, or restore "
                "ECOSTRESS_START to match it, before resuming")
    return None


def run_dcurs_lst(wards: list[blr.Ward]) -> None:
    """--layer dcurs-lst: one row per ECOSTRESS acquisition, all wards and the rural reference.

    RESUMABLE: rows are saved every 10 acquisitions PROCESSED and on any exit
    (including an error), and a re-run skips what is recorded. DISK-BOUNDED:
    each acquisition's newly downloaded bands are deleted once measured, so the
    cache never holds more than one scene.

    DO NOT RUN A KOLKATA ECOSTRESS SCRIPT CONCURRENTLY WITH THIS LAYER. They
    share `eco.CACHE`, and this layer deletes every file that appears there
    during one acquisition's processing -- including a Kolkata download that
    happens to land mid-window.
    """
    import datetime as dt
    import numpy as np
    import _dcurs_blr as dc
    import _ecostress as eco

    # G2 gate, offline and first: the pure target grid is all this needs, so a
    # mis-built mask is caught before the GHS-SMOD download, the token check, or
    # a single CMR search.
    crs = eco.target_crs(RURAL_BBOX)
    tf, width, height = eco.target_grid(RURAL_BBOX)
    masks = dcurs_mask_report(tf, width, height, crs, wards)

    # Loading and checking any existing scenes file is also offline and pure --
    # a re-run with a changed RURAL_BBOX or ECOSTRESS_START is refused here,
    # before the GHS-SMOD download or the token check, for the same reason as
    # the G2 gate above: fail on what is cheap to check before what is not.
    if os.path.exists(dc.LST_PATH):
        with open(dc.LST_PATH, encoding="utf-8") as fh:
            doc = cast(dc.ScenesFile, json.load(fh))
        mismatch = resume_mismatch(doc)
        if mismatch is not None:
            raise SystemExit(mismatch)
    else:
        doc = {"source": ("NASA ECOSTRESS ECO_L2T_LSTE v002 via CMR/LP DAAC; rural reference = "
                          "GHS-SMOD R2023A tile R8_C26 classes 11/12/13"),
               "rural_bbox": list(RURAL_BBOX), "start": ECOSTRESS_START, "rows": [], "skipped": []}
    done = {f"{r['phase']} {r['utc']}" for r in doc["rows"]} | set(doc["skipped"])

    smod_tif = tif_from_zip(cached_download(
        GHS_SMOD_URL, os.path.join(GEO_CACHE, "ghsl", os.path.basename(GHS_SMOD_URL))))
    tok = eco.token()

    smod = eco.align(smod_tif, -200, "int16", bbox=RURAL_BBOX)

    def save() -> None:
        # I1: write through a .part file and rename, so a crash mid-write can
        # never leave a truncated JSON that the next run cannot parse.
        part = dc.LST_PATH + ".part"
        with open(part, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        os.replace(part, dc.LST_PATH)

    #: (suffix, nodata, dtype) for the three masks a granule's LST needs. A
    #: granule missing any one of them cannot be trusted unmasked, so it is
    #: dropped whole rather than merged in with a silently disabled filter.
    mask_bands = (("_QC.tif", 0xFFFF, "uint16"), ("_cloud.tif", 255, "uint16"),
                  ("_water.tif", 0, "uint16"))

    def process(grans: list[dict[str, Any]]) -> tuple[str, Any, Any]:
        """One acquisition's granules -> ("complete" | "incomplete", cel, view).

        A FAILED band anywhere makes the whole acquisition "incomplete": the
        caller records nothing and retries it on the next run. An ABSENT LST
        band means that granule has no data and is skipped. An ABSENT mask
        band means that granule's LST cannot be used unmasked, so the whole
        granule is dropped -- not silently merged in unmasked.
        """
        cel: Any = None
        view: Any = None
        for g in grans:
            lst_status, lst_k = band(eco, tok, g, "_LST.tif", np.nan, "float32")
            if lst_status == "failed":
                return "incomplete", None, None
            if lst_status == "absent":
                continue
            mask_arrays: dict[str, Any] = {}
            drop_granule = False
            for suffix, nodata, dtype in mask_bands:
                st, arr = band(eco, tok, g, suffix, nodata, dtype)
                if st == "failed":
                    return "incomplete", None, None
                if st == "absent":
                    drop_granule = True
                    break
                mask_arrays[suffix] = arr
            if drop_granule:
                continue
            c = dc.granule_celsius(lst_k, mask_arrays["_QC.tif"],
                                   mask_arrays["_cloud.tif"], mask_arrays["_water.tif"])
            cel = dc.first_finite(cel, c)
            v_status, v = band(eco, tok, g, "_view_zenith.tif", np.nan, "float32")
            if v_status == "failed":
                return "incomplete", None, None
            if v_status == "ok":
                view = dc.first_finite(view, v)
        return "complete", cel, view

    no_lst_in_a_row = 0
    processed = 0                          # I3: saves are counted on this, not on the CMR list index
    # Stop short of today: LP DAAC may still be ingesting the most recent
    # scenes, and a late-arriving one would change an already-recorded orbit's
    # earliest timestamp -- its `done` key -- causing a resumed run to record
    # it a second time under the new, earlier key. See ECOSTRESS_SETTLE_DAYS.
    end = (dt.date.today() - dt.timedelta(days=ECOSTRESS_SETTLE_DAYS)).isoformat()
    for phase in ("day", "night"):
        try:
            acqs = group_by_orbit(eco.cmr_search(phase, ECOSTRESS_START, None, end, bbox=RURAL_BBOX))
            print(f"  {phase}: {len(acqs)} acquisitions since {ECOSTRESS_START}", flush=True)

            def checkpoint(idx: int = 0) -> None:
                # Robustness fix: save/print every 10 PROCESSED acquisitions --
                # complete OR incomplete -- so a stretch of server throttling
                # (all incomplete) is not silently unsaved for hours.
                if processed % 10 == 0:
                    save()
                    print(f"    {phase} {idx}/{len(acqs)} · {processed} processed · "
                          f"{len(doc['rows'])} rows", flush=True)

            for idx, (utc, grans) in enumerate(acqs, 1):
                key = f"{phase} {utc}"
                if key in done:
                    continue
                before: set[str] = set(os.listdir(eco.CACHE)) if os.path.isdir(eco.CACHE) else set()
                try:
                    status, cel, view = process(grans)
                finally:
                    # measured, then dropped: the disk never holds more than one scene
                    if os.path.isdir(eco.CACHE):
                        for f in set(os.listdir(eco.CACHE)) - before:
                            try:
                                os.remove(os.path.join(eco.CACHE, f))
                            except FileNotFoundError:
                                pass
                processed += 1
                if status == "incomplete":
                    no_lst_in_a_row += 1
                    checkpoint(idx)
                    if no_lst_in_a_row >= 5:
                        raise SystemExit(
                            "5 acquisitions in a row could not be downloaded completely "
                            f"(expired Earthdata token at {eco.TOKEN_PATH}, or server "
                            "throttling); progress is saved, fix and re-run")
                    continue
                no_lst_in_a_row = 0
                if cel is None or not bool(np.isfinite(cel).any()):
                    doc["skipped"].append(key)
                else:
                    doc["rows"].append(dc.scene_row(utc, phase, cel, view, smod, masks))
                done.add(key)
                checkpoint(idx)
        finally:
            # C1: any exception -- including a CMR RuntimeError or the SystemExit
            # above -- persists progress before it propagates.
            save()
    th = dc.thermal(doc["rows"], [w.id for w in wards])
    first = next(iter(th.values()))
    print(f"  shared clear scenes: {first['dayScenes']} day, {first['nightScenes']} night "
          f"(gate {dc.MIN_SHARED_SCENES} per phase)")


def _self_test() -> None:
    """Offline: the backfill must reproduce the source fix exactly."""
    import numpy as np
    from types import SimpleNamespace
    kc = _kolkata_canopy()
    hash01 = cast(Callable[[int, int, int, int], float], kc._hash01)
    species = cast(tuple[str, ...], kc.SPECIES)
    assert (JITTER, DENSITY_MAX, DENSITY_REF_H, MIN_TREE_H) == (
        kc.JITTER, kc.DENSITY_MAX, kc.DENSITY_REF_H, kc.MIN_TREE_H), \
        "Bengaluru's placement constants must equal Kolkata's, or its species draw is not Kolkata's"
    size_m = float(CANOPY_GRID * 10)
    grid = np.zeros((CANOPY_GRID, CANOPY_GRID), dtype=np.float32)
    grid[0, 0] = 30.0
    grid[3, 40] = 25.0
    grid[10, 10] = 15.0
    grid[150, 200] = 8.0
    grid[279, 279] = 22.5
    grid[9, 270] = 30.0
    placed = place_canopy(grid, size_m, hash01, species)
    assert placed == kc._generate(SimpleNamespace(footprint_m=size_m), grid), \
        "place_canopy must equal Kolkata's _generate on the same grid, species included"
    assert placed, "the probe grid must place trees"
    assert {t["species"] for t in placed} <= set(species)
    assert len({t["species"] for t in placed}) > 1, "the species draw must vary, not always neem"
    for t in placed:
        stripped = {k: v for k, v in t.items() if k != "species"}
        assert recover_species(stripped, size_m, hash01, species) == t["species"], \
            f"backfill disagrees with the source draw at {t}"
    try:
        recover_species({"x": 3.0, "y": 3.0, "h": 5.0, "r": 1.0}, size_m, hash01, species)
    except ValueError:
        pass
    else:
        raise AssertionError("a tree no placement could have produced must be refused, not guessed")
    real = "UT-GLOBUS Bangalore_2.gpkg: 2,274 of 14,867 matched, MAE 3.12 m"
    skip = "SKIPPED -- no UT-GLOBUS tile covering this ward was found."
    assert crosscheck_would_erase(real, None), "a missing tile must not overwrite real evidence"
    assert not crosscheck_would_erase(real, "/tiles/Bangalore_2.gpkg"), "a present tile may re-run"
    assert not crosscheck_would_erase(skip, None), "a skip may be re-recorded as a skip"
    assert not crosscheck_would_erase("", None), "a file with no cross-check may record a skip"

    stale_doc = cast(blr.BlrBuildingsFile, {
        "b": [{"hUt": 12.0, "flag": True}, {"hUt": 12.0, "flag": True}]})
    cross_check(next(iter(blr.WARDS.values())), stale_doc, None)
    assert all(b["hUt"] is None and b["flag"] is False for b in stale_doc["b"]), \
        "a skipped cross-check must reset stale hUt/flag, not leave them standing"
    assert str(stale_doc["crossCheck"]).startswith("SKIPPED"), \
        "cross_check(tile=None) must record a skip"
    assert covered_reach({"tunnel": "culvert"}), "a culvert is covered"
    assert covered_reach({"tunnel": "yes"}), "a tunnel is covered"
    assert covered_reach({"covered": "yes"}), "covered=yes is covered"
    assert covered_reach({"culvert": "yes"}), "a culvert key is covered"
    assert not covered_reach({"tunnel": "no"}), "tunnel=no is open"
    assert not covered_reach({"waterway": "drain"}), "an untagged drain is open"
    assert not covered_reach(None), "no tags is open"
    ew = edge_weights(0.5, 2.25, 0, 3)
    assert [round(float(x), 6) for x in ew] == [0.5, 1.0, 0.25], \
        f"edge pixels are weighted by the fraction inside the box, got {list(ew)}"
    assert float(edge_weights(0.0, 3.0, 0, 3).sum()) == 3.0, "a box on pixel edges counts whole pixels"

    for good in (b"II*\x00", b"MM\x00*", b"PK\x03\x04"):
        assert looks_like_raster_or_zip(good), f"{good!r} is a TIFF or ZIP header"
    assert not looks_like_raster_or_zip(b"<htm"), "an HTML error page must never be cached"

    # worldpop_box_density's index arithmetic, pinned against a brute-force
    # overlap sum that shares no code with it. A north/south row flip moves the
    # real ward totals by well under 1 %, which no sanity range can see.
    import tempfile
    import rasterio
    from rasterio.transform import from_origin
    with tempfile.TemporaryDirectory() as td:
        synth = os.path.join(td, "synthetic.tif")
        vals = np.array([[100.0 * r + c + 1 for c in range(10)] for r in range(10)], dtype=np.float32)
        vals[0, 0] = -99999.0
        with rasterio.open(synth, "w", driver="GTiff", width=10, height=10, count=1,
                           dtype="float32", crs="EPSG:4326", nodata=-99999,
                           transform=from_origin(77.0, 13.0, 0.01, 0.01)) as dst:
            dst.write(vals, 1)
        probe = blr.Ward("probe", "Probe", blr.LatLon(12.969, 77.043), 3000.0)
        west, south, east, north = blr.bounds(probe)
        assert 77.0 < west < east < 77.1 and 12.9 < south < north < 13.0, \
            "the probe box must sit well inside the synthetic raster"
        expected = 0.0
        for r in range(10):
            for c in range(10):
                pw, pe = 77.0 + c * 0.01, 77.0 + (c + 1) * 0.01
                pn, ps = 13.0 - r * 0.01, 13.0 - (r + 1) * 0.01
                ox = max(0.0, min(pe, east) - max(pw, west))
                oy = max(0.0, min(pn, north) - max(ps, south))
                v = float(vals[r, c])
                expected += (0.0 if v == -99999.0 else v) * ox * oy / (0.01 * 0.01)
        _, total_people = worldpop_box_density(probe, synth)
        assert abs(total_people - round(expected)) <= 1, \
            f"box sum {total_people} disagrees with the brute-force overlap sum {expected:.2f}"
        off = blr.Ward("off", "Off", blr.LatLon(12.99, 77.095), 3000.0)
        try:
            worldpop_box_density(off, synth)
        except SystemExit:
            pass
        else:
            raise AssertionError("a ward box running off the raster must be refused, not zero-filled")

    # box_mask: pinned against a HAND-COMPUTED expected rectangle on a known grid,
    # not against box_mask's own arithmetic re-run -- a self-check that only
    # reruns the code under test cannot catch a mistake shared by both runs.
    grid_tf = from_origin(700000.0, 1450000.0, 70.0, 70.0)
    # west=700140 -> col 2, north=1449790 -> row 3, east=700490 -> col 7, south=1449370 -> row 9.
    m_in = box_mask(grid_tf, 20, 20, 700140.0, 1449370.0, 700490.0, 1449790.0)
    expect_in = np.zeros((20, 20), dtype=bool)
    expect_in[3:10, 2:8] = True
    assert bool((m_in == expect_in).all()), \
        "box_mask must be True on rows 3-9 (from the north edge down), cols 2-7 (from the west edge)"

    # Partly off-grid on both the west and north sides: west -> col -5, north -> row 1,
    # east -> col 3, south -> row 15. A negative column handed straight to a numpy
    # slice WRAPS from the far edge instead of refusing -- this must clamp to col 0.
    m_off = box_mask(grid_tf, 20, 20, 699650.0, 1448950.0, 700210.0, 1449930.0)
    expect_off = np.zeros((20, 20), dtype=bool)
    expect_off[1:16, 0:4] = True
    assert bool((m_off == expect_off).all()), \
        "an off-grid box must be CLAMPED to the grid edge, not wrapped around it"

    # group_by_orbit: two scenes of the SAME orbit (field [3] of GranuleUR) must
    # merge into one group keyed by the EARLIEST timestamp, with both granules
    # kept; a different orbit must stay its own group; a repeated GranuleUR
    # (e.g. a re-listed CMR page) must not be double-counted.
    def _gran(ur: str) -> dict[str, Any]:
        return {"GranuleUR": ur}

    acqs_orbit = [
        ("2024-01-02T16:25:18", [_gran("ECOv002_L2T_LSTE_31137_031_45QXE_20240102T162518_0711_01")]),
        ("2024-01-02T16:23:18", [_gran("ECOv002_L2T_LSTE_31137_030_45QXE_20240102T162318_0711_01")]),
        ("2024-01-02T15:10:00", [_gran("ECOv002_L2T_LSTE_31140_012_45QXE_20240102T151000_0711_01")]),
    ]
    grouped = group_by_orbit(acqs_orbit)
    by_utc = dict(grouped)
    assert len(grouped) == 2, f"one orbit split into two scenes must merge: got {grouped}"
    assert len(by_utc["2024-01-02T16:23:18"]) == 2, \
        "both same-orbit scenes must land in one group"
    assert "2024-01-02T16:25:18" not in by_utc, \
        "the merged group must be keyed by the EARLIEST scene, not the later one"
    assert len(by_utc["2024-01-02T15:10:00"]) == 1, "a different orbit must stay its own group"
    assert [utc for utc, _ in grouped] == sorted(by_utc, reverse=True), \
        "groups must come back newest first, like cmr_search"

    dup = [("2024-02-01T00:00:00",
           [_gran("ECOv002_L2T_LSTE_99999_001_45QXE_20240201T000000_0711_01"),
            _gran("ECOv002_L2T_LSTE_99999_001_45QXE_20240201T000000_0711_01")])]
    assert len(group_by_orbit(dup)[0][1]) == 1, "a repeated GranuleUR must not be double-counted"

    # band(): a FAILURE must remove the file at the band's cache path
    # UNCONDITIONALLY, even one that predates this acquisition -- the path is
    # unique to this granule+band, so a corrupt leftover there can never be
    # useful to anything else, and leaving it in place would fail this same
    # acquisition again on every future run. `eco` is faked so this runs with
    # no network and no token.
    class _FakeEcoStalledFetch:
        CACHE = ""                     # set to a real tempdir just below

        @staticmethod
        def band_url(g: dict[str, Any], suffix: str) -> str | None:
            return "https://example.test/granule_LST.tif"

        @staticmethod
        def fetch(url: str, tok: str) -> str | None:
            raise subprocess.TimeoutExpired(cmd="curl", timeout=600)

        @staticmethod
        def align(p: str, nodata: float, dtype: str, bbox: Any) -> Any:
            raise AssertionError("align must not be reached when fetch itself raised")

    with tempfile.TemporaryDirectory() as td:
        _FakeEcoStalledFetch.CACHE = td
        corrupt = os.path.join(td, "granule_LST.tif")
        with open(corrupt, "wb") as fh:
            fh.write(b"leftover bytes from a stalled curl in an earlier run")
        status, arr = band(_FakeEcoStalledFetch, "tok", {}, "_LST.tif", float("nan"), "float32")
        assert status == "failed" and arr is None, (status, arr)
        assert not os.path.exists(corrupt), \
            "a pre-existing corrupt file at the band's cache path must be removed on FAILURE " \
            "unconditionally, whether or not it predates this acquisition"

    # resume_mismatch(): a resumed scenes file must have been built with today's
    # RURAL_BBOX and ECOSTRESS_START, or the run must refuse to mix old and new rows.
    matching_doc = {"rural_bbox": list(RURAL_BBOX), "start": ECOSTRESS_START}
    assert resume_mismatch(matching_doc) is None, "matching settings must not refuse a resume"

    changed_start = {"rural_bbox": list(RURAL_BBOX), "start": "2020-01-01"}
    msg = resume_mismatch(changed_start)
    assert msg is not None and "2020-01-01" in msg and ECOSTRESS_START in msg, \
        f"a changed start must refuse and name both values: {msg}"

    changed_bbox = {"rural_bbox": [0.0, 0.0, 1.0, 1.0], "start": ECOSTRESS_START}
    msg2 = resume_mismatch(changed_bbox)
    assert msg2 is not None and "0.0" in msg2 and str(RURAL_BBOX[0]) in msg2, \
        f"a changed rural_bbox must refuse and name both values: {msg2}"

    print("  fetch-bangalore self-test OK")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", default="all",
                    choices=("buildings", "heights", "terrain", "context", "canopy",
                             "species", "crosscheck", "osm", "dcurs-static", "dcurs-lst", "all"))
    ap.add_argument("--ward", default=None)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        _self_test()
        return 0
    wards = ward_list(a.ward)
    if a.layer in ("dcurs-static", "dcurs-lst") and a.ward:
        raise SystemExit("the dcurs layers measure all three wards together; drop --ward")

    if a.layer in ("buildings", "all"):
        print("buildings (Overture):")
        download_overture()
        build_footprints(wards)
    if a.layer in ("terrain", "all"):
        print("terrain (Copernicus GLO-30):")
        for w in wards:
            build_terrain(w)
            build_terrain(w, context=True)
    if a.layer in ("context", "all"):
        print("context (Overture water / land_use / segment):")
        download_context()
        build_context(wards)
    if a.layer in ("osm", "all"):
        # AFTER heights: this layer OVERRIDES the Google baseline where better
        # evidence exists, so it cannot run before the baseline is there.
        #
        # THE STOREY CONSTANT IS FITTED ONCE, ACROSS ALL THREE WARDS. Fitted per
        # ward it was 3.2 m in Indiranagar from six buildings -- too thin to fit,
        # so it silently fell back to Kolkata's imported constant -- against
        # 4.16 m from twenty-five in MG Road. One city-wide figure with a real
        # sample beats one ward guessing and another importing.
        print("measured heights (OSM tags + cited landmarks):")
        fetched = {}
        rows: list[tuple[float, float]] = []
        for w in wards:
            print(f"  {w.id:<12} querying Overpass ...", flush=True)
            fetched[w.id] = overpass_heights(w)
            for e in fetched[w.id]:
                t = e.get("tags", {})
                h, lv = parse_height(t), parse_levels(t)
                if h is not None and lv is not None:
                    rows.append((h, lv))
        storey_m, n_fit = fit_storey_metres(rows)
        print(f"  storey height fitted city-wide: {storey_m} m from {n_fit} "
              f"buildings carrying both height and building:levels")
        for w in wards:
            apply_osm_heights(w, fetched[w.id], storey_m, n_fit)
    if a.layer in ("canopy", "all"):
        print("canopy (Meta/WRI CHM v1, v2 measured alongside):")
        for w in wards:
            build_canopy(w)
    if a.layer == "species":
        print("species (backfill Kolkata's draw into existing canopy files, offline):")
        for w in wards:
            backfill_species(w)
    if a.layer == "crosscheck":
        print("cross-check (UT-GLOBUS against committed heights, offline):")
        for w in wards:
            run_crosscheck(w)
    if a.layer == "dcurs-static":
        print("DC-URS static inputs (WorldPop, FAR, WorldCover refuge, Sentinel-2 NDVI):")
        build_dcurs_static(wards)
    if a.layer == "dcurs-lst":
        print("DC-URS surface temperature (ECOSTRESS, scenes shared by all three wards):")
        run_dcurs_lst(wards)
    if a.layer in ("heights", "all"):
        print("heights (Google Open Buildings 2.5D):")
        init_ee()
        for w in wards:
            compute_heights(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
