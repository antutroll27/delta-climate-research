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
import sqlite3
import statistics
import sys
from typing import Any, Callable, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)

RAW = os.path.join(blr.DATA, "raw")
OVERTURE_PARQUET = os.path.join(RAW, "overture-buildings.parquet")

#: The context layers, all from the same Overture release and bucket as the
#: buildings and under the same ODbL. Each is one full-partition scan (~5 min),
#: cached once over the union bbox and sliced per ward from there.
CONTEXT_THEMES: dict[str, tuple[str, str, str]] = {
    "water":   ("base", "water", "id, subtype, class, geometry"),
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
            print(f"  {name:<8} cache present ({os.path.getsize(dst) / 1e6:.1f} MB)")
            continue
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
        for _id, subtype, cls, geom in tables["water"]:
            g = shp_transform(to_ward, shapely_wkb.loads(bytes(geom)))
            if not g.intersects(clip):
                continue
            g = g.intersection(clip)
            for r in rings(g):
                water.append({"cls": str(subtype or cls or "water"), "p": r})
            for ln in lines(g):
                water.append({"cls": str(subtype or cls or "stream"), "line": ln})

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
    print("  fetch-bangalore self-test OK")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", default="all",
                    choices=("buildings", "heights", "terrain", "context", "canopy",
                             "species", "crosscheck", "osm", "all"))
    ap.add_argument("--ward", default=None)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        _self_test()
        return 0
    wards = ward_list(a.ward)

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
    if a.layer in ("heights", "all"):
        print("heights (Google Open Buildings 2.5D):")
        init_ee()
        for w in wards:
            compute_heights(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
