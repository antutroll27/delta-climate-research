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
import sqlite3
import statistics
import sys
from typing import Any, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)

RAW = os.path.join(blr.DATA, "raw")
OVERTURE_PARQUET = os.path.join(RAW, "overture-buildings.parquet")

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

    tile = utglobus_tile(w)
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", default="all",
                    choices=("buildings", "heights", "terrain", "all"))
    ap.add_argument("--ward", default=None)
    a = ap.parse_args()
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
    if a.layer in ("heights", "all"):
        print("heights (Google Open Buildings 2.5D):")
        init_ee()
        for w in wards:
            compute_heights(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
