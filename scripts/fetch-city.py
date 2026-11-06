"""Fetch one area of a city after Bengaluru and write its committed artefacts.

    taskpolicy -b python3 scripts/fetch-city.py --city amsterdam --layer buildings
    taskpolicy -b python3 scripts/fetch-city.py --city amsterdam --layer terrain
    taskpolicy -b python3 scripts/fetch-city.py --city amsterdam --layer context
    taskpolicy -b python3 scripts/fetch-city.py --city amsterdam --layer canopy   # needs buildings + context first
    python3 scripts/fetch-city.py --self-test            # offline, runs in `npm run test:py`

LAYERS IMPLEMENTED SO FAR: `buildings` (3D BAG, A5), `terrain` (AHN, A6) and `context` (Overture
water / green / roads, A7) and `canopy` (Meta/WRI CHM v2 trees, A8). The guards are
scripts/check-city-frame.py (A9); a layer that does nothing is
not offered. Raw downloads go to `_city.raw_dir(city)` (on OBOSLab, never committed);
processed JSON goes to `data/cities/<city>/` and is committed.

Kolkata and Bengaluru have their own frozen pipelines (`fetch-buildings.py`,
`fetch-bangalore.py`) and are not touched by this script.
"""
from __future__ import annotations

import argparse
import datetime
import itertools
import json
import os
import sys
from typing import cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city                                           # noqa: E402  (path set above)
import _src_3dbag as bag                               # noqa: E402
import _src_dem as dem                                 # noqa: E402
import _src_overture as ovt                            # noqa: E402
import _src_canopy as canopy                           # noqa: E402
from _city import Area, CityBuilding, CityBuildingsFile, CityTerrainFile   # noqa: E402

TODAY = datetime.date.today().isoformat()


def out_path(area: Area, layer: str) -> str:
    return os.path.join(_city.data_dir(area.city), f"{area.id}-{layer}.json")


def write_json(path: str, doc: object) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")


# ── buildings ──────────────────────────────────────────────────────────────

def fetch_buildings(area: Area) -> None:
    raw = os.path.join(_city.raw_dir(area.city), "3dbag")
    tiles = bag.list_tiles(area, raw)
    print(f"{len(tiles)} tiles of 3D BAG {bag.RELEASE} touch the box + {bag.TILE_PAD_M:.0f} m "
          f"({sum(t.n_buildings for t in tiles)} buildings in them)")
    paths = []
    for i, t in enumerate(tiles, 1):
        paths.append(bag.fetch_tile(t, raw))
        print(f"  [{i:2d}/{len(tiles)}] {t.tile_id}", flush=True)
    scratch = os.path.join(raw, "scratch")
    raws = itertools.chain.from_iterable(bag.read_tile(p, scratch) for p in paths)
    rows, st, mix = bag.build_rows(area, raws)
    _, op_desc, op_acc = bag.rd_transformer()
    hs = [r["h"] for r in rows]
    p50, p95 = bag.percentiles(hs, (50.0, 95.0))
    tiers: dict[str, int] = {}
    for r in rows:
        tiers[r["hSource"]] = tiers.get(r["hSource"], 0) + 1
    doc = CityBuildingsFile(
        city=area.city, area=area.id, name=area.name, centre=[area.centre.lat, area.centre.lon],
        sizeM=float(area.size_m), release=f"3D BAG {bag.RELEASE}", retrieved=TODAY, count=len(rows),
        source=(f"3D BAG (tudelft3d + 3DGI), {bag.RELEASE}, BAG footprints; heights from the AHN point clouds "
                "(AHN5 © Het Waterschapshuis, CC BY 4.0; AHN4 and AHN3, CC0), CC BY 4.0"),
        heightSource="3D BAG LoD1.2 roof 70th percentile minus ground level (NAP)",
        heightNote=bag.height_note(op_desc, op_acc),
        fillFraction=round(st.fill_rows / max(1, len(rows)), 4), heightTiers=tiers, pointCloudMix=mix,
        crossCheck="AHN nDSM cross-check not yet run (guard G5, Task A9)", b=rows)
    write_json(out_path(area, "buildings"), doc)
    size_mb = os.path.getsize(out_path(area, "buildings")) / 1e6
    print(f"\nwrote {out_path(area, 'buildings')} ({size_mb:.1f} MB)")
    print(f"  raw buildings read   {st.raw_buildings}   centroid inside square {st.inside_square}")
    print(f"  rows written         {st.rows}   (multi-part buildings split: {st.multipart_buildings})")
    print(f"  fill (2.5 m)         {st.fill_rows} = {st.fill_rows / max(1, st.rows):.4f}")
    print(f"  dropped < {_city.MIN_RING_M2:.0f} m2     {st.dropped_small}   empty part pieces {st.dropped_empty_piece}"
          f"   holes dropped {st.holes_dropped}   negative h clamped to 0: {st.clamped_negative}")
    print(f"  h p50 {p50:.2f} m  p95 {p95:.2f} m  max {max(hs):.2f} m  mean {sum(hs) / len(hs):.2f} m")
    print(f"  quality=false rows   {sum(1 for r in rows if not r['quality'])}")
    print(f"  height tiers         {tiers}")
    print(f"  point-cloud mix      {dict(sorted(mix.items()))}")
    print(f"  RD->WGS84 operation  {op_desc} (accuracy {op_acc:g} m)")


# ── terrain ────────────────────────────────────────────────────────────────

def post_ahn4_patches(area: Area) -> tuple[dem.GroundPatch, ...]:
    """Buildings that stand today but did not when AHN4 was flown, with 3D BAG's current ground at each.

    Needs the buildings file (its hCheck is half the evidence) and the raw 3D BAG tiles (the BAG
    construction year, the current ground and the exact RD footprint). Offline: both are cached.
    """
    bpath = out_path(area, "buildings")
    if not os.path.isfile(bpath):
        raise SystemExit(f"{bpath} is missing: run --layer buildings first (the terrain patch reads its hCheck)")
    with open(bpath, encoding="utf-8") as fh:
        rows = cast(CityBuildingsFile, json.load(fh))["b"]
    raw3d = os.path.join(_city.raw_dir(area.city), "3dbag")
    paths = sorted(os.path.join(raw3d, f) for f in os.listdir(raw3d) if f.endswith(".gpkg.gz"))
    scratch = os.path.join(raw3d, "scratch")
    seen: dict[str, bag.RawBuilding] = {}
    for rb in itertools.chain.from_iterable(bag.read_tile(p, scratch) for p in paths):
        seen.setdefault(rb.src_id, rb)
    years = {k: v.build_year for k, v in seen.items()}
    patches: list[dem.GroundPatch] = []
    for sid in sorted(dem.post_ahn4_ids(rows, years)):
        rb = seen[sid]
        if rb.ground_nap is None or rb.build_year is None:
            continue
        patches.append(dem.GroundPatch(sid, rb.footprint, rb.ground_nap, rb.build_year))
    return tuple(patches)


def fetch_terrain(area: Area) -> None:
    raw = os.path.join(_city.raw_dir(area.city), "ahn")
    patches = post_ahn4_patches(area)
    print(f"post-AHN4 buildings whose DTM is patched: {len(patches)} {[p.src_id[-8:] for p in patches]}")
    doc, report = dem.build_terrain(area, raw, TODAY, patches)
    write_json(out_path(area, "terrain"), doc)
    print(f"\nwrote {out_path(area, 'terrain')}")
    for line in report:
        print("  " + line)


# ── context ────────────────────────────────────────────────────────────────

def fetch_context(area: Area) -> None:
    raw = os.path.join(_city.raw_dir(area.city), "overture")
    ovt.download_context(area, raw)
    doc, st = ovt.build_context(area, raw)
    problems = ovt.validate_context_file(area, doc)
    assert not problems, problems
    write_json(out_path(area, "context"), doc)
    print(f"\nwrote {out_path(area, 'context')} ({os.path.getsize(out_path(area, 'context')) / 1e6:.2f} MB)")
    print(f"  Overture {_city.OVERTURE_RELEASE}; raw features read {st.scanned}")
    print(f"  water polygons {st.water_polygons}   water lines {st.water_lines} (covered {st.water_lines_covered})")
    print(f"  green polygons {st.green_polygons}   road segments {st.road_segments}")
    print(f"  major roads (primary+secondary) {st.road_major} = {st.major_share:.1%}   "
          f"(Kolkata 2.5-9.0 %, Bengaluru 3.7-13.7 %)")


# ── canopy ─────────────────────────────────────────────────────────────────

def read_doc(area: Area, layer: str) -> object:
    path = out_path(area, layer)
    if not os.path.isfile(path):
        raise SystemExit(f"{path} is missing: run --layer {layer} first (canopy drops trees inside buildings and roads)")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def fetch_canopy(area: Area) -> None:
    ctx = cast(_city.CityContextFile, read_doc(area, "context"))
    bdoc = cast(CityBuildingsFile, read_doc(area, "buildings"))
    doc, path = canopy.build_canopy(area, ctx, bdoc)
    write_json(out_path(area, "canopy"), doc)
    print(f"\nwrote {out_path(area, 'canopy')} ({os.path.getsize(out_path(area, 'canopy')) / 1e6:.2f} MB)")
    print(f"  CHM tile {path}")
    print(f"  cover >= {doc['coverThresholdM']:.0f} m at ~1 m: {doc['coverFrac']:.1%}")
    print(f"  candidates {doc['candidates']}  dropped in roads {doc['droppedInRoads']}  "
          f"dropped in buildings {doc['droppedInBuildings']}  kept {doc['count']}")
    mix: dict[str, int] = {}
    for t in doc["trees"]:
        mix[t["species"]] = mix.get(t["species"], 0) + 1
    print(f"  species {dict(sorted(mix.items()))}")


# ── self-test (offline) ────────────────────────────────────────────────────

def validate_buildings_file(area: Area, doc: CityBuildingsFile) -> list[str]:
    """Contract checks on a written buildings file: shape, h >= 0, every p inside the box + 50 m."""
    bad: list[str] = []
    lim = area.size_m / 2.0 + 50.0
    if doc["count"] != len(doc["b"]):
        bad.append(f"count {doc['count']} != len(b) {len(doc['b'])}")
    for i, b in enumerate(doc["b"]):
        if len(b["p"]) < 6 or len(b["p"]) % 2:
            bad.append(f"row {i}: ring has {len(b['p'])} numbers")
            break
        if len(b["lonlat"]) * 2 != len(b["p"]):
            bad.append(f"row {i}: lonlat and p disagree in length")
            break
        if b["h"] < 0:
            bad.append(f"row {i}: h {b['h']} < 0")
            break
        if max(abs(v) for v in b["p"]) > lim:
            bad.append(f"row {i}: vertex outside +-{lim:.0f} m")
            break
        if b["hSource"] not in ("3dbag-p70", "fill"):
            bad.append(f"row {i}: hSource {b['hSource']}")
            break
    if sum(doc["heightTiers"].values()) != doc["count"]:
        bad.append("heightTiers do not sum to count")
    return bad


def self_test() -> None:
    import shapely
    from shapely.geometry import Polygon

    area = _city.AREAS["canal-ring"]
    tr, op_desc, op_acc = bag.rd_transformer()
    assert op_acc <= 1.0, f"RD->WGS84 operation {op_desc!r} is coarser than 1 m ({op_acc})"

    # GeoPackage blob decoder: with and without an envelope, and a refusal of a non-GP blob.
    sq = Polygon([(120800, 486300), (120810, 486300), (120810, 486310), (120800, 486310)])
    wkb = shapely.to_wkb(sq)
    for env_ind, env_len in ((0, 0), (1, 32), (3, 48)):
        blob = b"GP" + bytes([0, 1 | (env_ind << 1)]) + (28992).to_bytes(4, "little") + b"\0" * env_len + wkb
        assert bag.gpkg_geometry(blob).equals(sq)
    try:
        bag.gpkg_geometry(b"XX" + b"\0" * 20)
    except ValueError:
        pass
    else:
        raise AssertionError("a non-GP blob must be refused")

    # Height rule: ordinary, insufficient point cloud, missing ground.
    part = bag.Part(0, sq, 10.5)
    def mk(ground: float | None, insufficient: bool) -> bag.RawBuilding:
        return bag.RawBuilding("x", sq, (part,), ground, True, insufficient, "ahn5", 2023)

    assert bag._roof_height(mk(0.5, False), part) == (10.0, "3dbag-p70")
    assert bag._roof_height(mk(0.5, True), part) == (2.5, "fill")
    assert bag._roof_height(mk(None, False), part) == (2.5, "fill")
    assert bag._roof_height(mk(0.5, False), None) == (2.5, "fill")

    # A square 10 m building at the RD image of the area centre, through the whole row path.
    cx, cy = _city.transformer_to_local_crs(area).transform(area.centre.lon, area.centre.lat)
    near = Polygon([(cx + 100, cy + 100), (cx + 112, cy + 100), (cx + 112, cy + 108), (cx + 100, cy + 108)])
    b = bag.RawBuilding("NL.IMBAG.Pand.test", near, (bag.Part(0, near, 9.5),), 0.5, True, False, "ahn5", 2023)
    rows, stats, mix = bag.build_rows(area, iter([b, b]))        # the duplicate must be dropped
    assert stats.raw_buildings == 1 and stats.rows == 1 and mix == {"ahn5-2023": 1}, stats
    r = rows[0]
    assert r["h"] == 9.0 and r["hSource"] == "3dbag-p70" and r["quality"] is True
    xs, ys = r["p"][0::2], r["p"][1::2]
    assert 12.0 - 1e-6 <= (max(xs) - min(xs)) <= 12.0 + 0.2 and 8.0 - 0.2 <= (max(ys) - min(ys)) <= 8.0 + 0.2, (xs, ys)
    # NORTH CHECK: the building was 100 m NORTH (and east) of the centre in RD; the local frame must agree.
    assert 90 < sum(ys) / len(ys) < 112 and 90 < sum(xs) / len(xs) < 115, (sum(xs) / 4, sum(ys) / 4)
    # G2 in miniature: each vertex's own lonlat reproduces p to < 0.05 m.
    for k, (lon, lat) in enumerate(r["lonlat"]):
        x, y = _city.to_local(area, lon, lat)
        assert abs(x - r["p"][2 * k]) < 0.05 and abs(y - r["p"][2 * k + 1]) < 0.05
    assert _city.ring_area(r["p"]) > 90.0

    # A footprint whose vertices carry Z (some tiles do) must give the same row as the 2-D one.
    near_z = Polygon([(x, y, 1.0) for x, y in near.exterior.coords])
    rz, _, _ = bag.build_rows(area, iter([bag.RawBuilding("z", near_z, (bag.Part(0, near, 9.5),), 0.5, True, False, "ahn5", 2023)]))
    assert rz[0]["p"] == r["p"], "a 3-D footprint changed the row"

    # A two-part building splits into two rows with their own heights; outside-the-square is clipped out.
    left = Polygon([(cx + 100, cy + 100), (cx + 106, cy + 100), (cx + 106, cy + 108), (cx + 100, cy + 108)])
    right = Polygon([(cx + 106, cy + 100), (cx + 112, cy + 100), (cx + 112, cy + 108), (cx + 106, cy + 108)])
    two = bag.RawBuilding("NL.IMBAG.Pand.two", near, (bag.Part(0, left, 5.5), bag.Part(1, right, 20.5)),
                          0.5, True, False, "ahn5", 2023)
    far = Polygon([(cx + 5000, cy), (cx + 5010, cy), (cx + 5010, cy + 10), (cx + 5000, cy + 10)])
    out = bag.RawBuilding("NL.IMBAG.Pand.far", far, (bag.Part(0, far, 9.5),), 0.5, True, False, "ahn5", 2023)
    rows2, st2, _ = bag.build_rows(area, iter([two, out]))
    assert st2.inside_square == 1 and st2.multipart_buildings == 1 and sorted(x["h"] for x in rows2) == [5.0, 20.0], st2

    # The committed file, when present, passes its own contract.
    path = out_path(area, "buildings")
    note = "no committed buildings file yet"
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            doc = cast(CityBuildingsFile, json.load(fh))
        problems = validate_buildings_file(area, doc)
        assert not problems, problems
        note = f"{doc['count']} buildings in the committed file satisfy the contract"
    tpath = out_path(area, "terrain")
    if os.path.isfile(tpath):
        with open(tpath, encoding="utf-8") as fh:
            tdoc = cast(CityTerrainFile, json.load(fh))
        problems = dem.validate_terrain_file(area, tdoc)
        assert not problems, problems
        note += f"; terrain file n={tdoc['n']} satisfies the contract"
    cpath = out_path(area, "context")
    if os.path.isfile(cpath):
        with open(cpath, encoding="utf-8") as fh:
            cdoc = cast(_city.CityContextFile, json.load(fh))
        problems = ovt.validate_context_file(area, cdoc)
        assert not problems, problems
        note += f"; context file ({len(cdoc['water'])} water, {len(cdoc['green'])} green, {len(cdoc['roads'])} roads) satisfies the contract"
    dem.self_test()
    ovt.self_test()
    canopy.self_test()
    print(f"fetch-city self-test: ok ({note}); RD->WGS84 '{op_desc}' accuracy {op_acc:g} m")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Fetch one area of a city after Bengaluru.")
    ap.add_argument("--self-test", action="store_true", help="offline checks; no network, no cache needed")
    ap.add_argument("--city", choices=["amsterdam"], help="city id")
    ap.add_argument("--layer", choices=["buildings", "terrain", "context", "canopy", "all"], default="all")
    ap.add_argument("--area", help="area id (default: every area of the city)")
    args = ap.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if not args.city:
        ap.error("--city is required (or use --self-test)")
    areas = [a for a in _city.AREAS.values() if a.city == args.city and (args.area in (None, a.id))]
    if not areas:
        ap.error(f"no area {args.area!r} in city {args.city!r}")
    for a in areas:
        if args.layer in ("buildings", "all"):
            fetch_buildings(a)
        if args.layer in ("terrain", "all"):
            fetch_terrain(a)
        if args.layer in ("context", "all"):
            fetch_context(a)
        if args.layer in ("canopy", "all"):
            fetch_canopy(a)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
