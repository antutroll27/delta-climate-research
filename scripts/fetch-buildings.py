"""Overture parquet -> per-ward footprint sets in the instrument's local frame.

WHY OVERTURE. Measured 2026-08-04 (scripts/validate-geometry.py): it holds 3,530
buildings in the Ballygunge window against our shipped 2,048, with 12.1 % of its
buildings more than 20 m from anything we hold. It merges OSM + Google + Microsoft
under stable GERS ids, so our current source is one of its inputs -- this is a
superset, not a different opinion.

RELEASE IS PINNED, PER WARD. Two 2026 releases exist on the bucket; a glob
double-counts. The pin is per ward since 2026-10-02: Ballygunge was re-acquired
for its KMC Ward 68 domain from 2026-09-23.1, because the 2026-07-22.0 release
the other two wards were built from NO LONGER EXISTS on the bucket. Barrackpore
and Baruipur keep their committed 2026-07-22.0 parquets and are not re-run.

WARD MEMBERSHIP IS INTERSECTS, DOMAIN ADMISSION IS CENTROID. A building enters
the domain when its centroid lies in the ward square (unchanged). For a ward
with an administrative polygon (scripts/_wardmask.py — Ballygunge = Ward 68) each
row also carries `inWard`: True when the footprint INTERSECTS the polygon. A
centroid test would drop a building the boundary street cuts through from the
ward it fronts on; intersects keeps it, and the founder's count of 2,207
buildings touching Ward 68 is an intersects count.

FOOTPRINTS ONLY. Overture carries `height` on 0 of 3,591 buildings here (measured,
not assumed). Heights come from scripts/compute-heights.py and join on the GERS id.

    python3 scripts/fetch-buildings.py            # build all three wards
    python3 scripts/fetch-buildings.py --ward ballygunge   # one ward, manifest merged
    python3 scripts/fetch-buildings.py --check    # assert over committed outputs
"""
from __future__ import annotations

import argparse
from typing import Any
import hashlib
import json
import math
import os
import sys

import duckdb
from shapely import wkb as shapely_wkb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _types                                       # noqa: E402  (path set above)
import _wardmask                                    # noqa: E402
from shapely.geometry import MultiPolygon, Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
RAW = os.path.join(ROOT, "data", "geometry", "raw")
OUT = os.path.join(ROOT, "data", "geometry")

#: Overture release each ward's raw parquet was downloaded from, and the day.
#: 2026-07-22.0 has since been withdrawn from the bucket, so it cannot be
#: re-downloaded -- the committed parquets ARE the record for those two wards.
RELEASES: dict[str, tuple[str, str]] = {
    "ballygunge": ("2026-09-23.1", "2026-10-02"),
    "barrackpore": ("2026-07-22.0", "2026-08-04"),
    "baruipur": ("2026-07-22.0", "2026-08-04"),
}
SIMPLIFY_M = 0.5            # vertex tolerance in the LOCAL frame -- metres, not degrees
MIN_RING_M2 = 4.0           # smaller than any real building; drops slivers

#: The ward table is _types.WARDS -- this script carried a private copy of the
#: centres, which is how a ward could move in one script and not the next.
WARDS = _types.WARDS

#: Counts measured at acquisition. A +/-10 % tripwire: a future re-run drifting
#: past this means the raw parquet changed under the manifest. Filled on the
#: first run and pinned before commit. Ballygunge re-pinned 2026-10-02 for the
#: 1800 m Ward 68 square (7,931 centroids measured in it before simplification).
EXPECT_COUNT: dict[str, int | None] = {
    "ballygunge": 7931, "barrackpore": 4702, "baruipur": 4538,
}

#: Ballygunge only: how many admitted footprints INTERSECT Ward 68 (measured
#: 2026-10-02 over the raw 2026-09-23.1 download: 2,207). Same +/-10 % tripwire.
EXPECT_IN_WARD: dict[str, int] = {"ballygunge": 2207}


def to_local(lon: float, lat: float, ward: str) -> tuple[float, float]:
    """Degrees -> metres in the ward frame.

    y grows NORTHWARD, and the constants come from scripts/_types.m_per_deg --
    the same helper fetch-water.py and the roads fetcher use. Verified against
    the shipped footprints rather than assumed: matching Overture centroids to
    ours scores 8.1 m mean nearest under this convention and 13.9 m under the
    southward one. Getting this backwards mirrors every building about the ward's
    centre line, which is exactly how the first parity run failed.
    """
    w = WARDS[ward]
    mx, my = _types.m_per_deg(w.centre.lat)
    return (lon - w.centre.lon) * mx, (lat - w.centre.lat) * my


def ward_rows(ward: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """One ward's footprints: local-frame rings, GERS id, and lon/lat for Earth Engine."""
    con = duckdb.connect()
    rows: list[dict[str, Any]] = []
    skipped = {"not_polygon": 0, "tiny": 0, "outside": 0, "holes_dropped": 0}
    size_m = float(WARDS[ward].footprint_m)
    boundary = _wardmask.polygon_lonlat(ward)            # None: no polygon, no inWard key
    query = f"SELECT id, geometry FROM read_parquet('{RAW}/{ward}.parquet')"
    for gers, blob in con.execute(query).fetchall():
        raw_geom = shapely_wkb.loads(bytes(blob))
        if isinstance(raw_geom, MultiPolygon):               # keep the largest part
            raw_geom = max(raw_geom.geoms, key=lambda g: g.area)
        if not isinstance(raw_geom, Polygon):
            skipped["not_polygon"] += 1
            continue
        geom: Polygon = raw_geom
        if len(geom.interiors) > 0:
            skipped["holes_dropped"] += 1                    # counted, never silent
        lonlat = list(geom.exterior.coords)
        local = Polygon([to_local(lo, la, ward) for lo, la in lonlat])
        if abs(local.centroid.x) > size_m / 2 or abs(local.centroid.y) > size_m / 2:
            skipped["outside"] += 1                          # bbox caught a neighbour's edge
            continue
        simplified = local.simplify(SIMPLIFY_M, preserve_topology=True)
        assert isinstance(simplified, Polygon), "simplify of a Polygon is a Polygon"
        local = simplified
        if local.area < MIN_RING_M2:
            skipped["tiny"] += 1
            continue
        ring = [round(v, 1) for xy in local.exterior.coords[:-1] for v in xy]
        if len(ring) < 6:
            skipped["tiny"] += 1
            continue
        row: dict[str, Any] = {
            "gers": gers,
            "p": ring,                                        # flat [x0,y0,...], metres
            "lonlat": [[round(lo, 6), round(la, 6)] for lo, la in lonlat],
        }
        if boundary is not None:
            # The UNSIMPLIFIED source ring against the polygon, both in lon/lat --
            # membership must not depend on the 0.5 m render simplification.
            row["inWard"] = bool(geom.intersects(boundary))
        rows.append(row)
    rows.sort(key=lambda r: r["gers"])                        # byte-stable order
    return rows, skipped


def check() -> int:
    failures: list[str] = []
    manifest_path = os.path.join(OUT, "manifest.json")
    if not os.path.exists(manifest_path):
        print("  MISSING manifest -- run without --check first")
        return 1
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    for ward in WARDS:
        release = RELEASES[ward][0]
        got = manifest["wards"].get(ward, {}).get("release")
        if got != release:
            failures.append(f"{ward}: manifest release {got} != pinned {release}")
        path = os.path.join(OUT, f"{ward}-footprints.json")
        if not os.path.exists(path):
            failures.append(f"{ward}: footprints missing")
            continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        if doc["release"] != release:
            failures.append(f"{ward}: footprints carry release {doc['release']} != {release}")
        ids = [r["gers"] for r in doc["b"]]
        if len(set(ids)) != len(ids):
            failures.append(f"{ward}: duplicate GERS ids -- the join to heights would be ambiguous")
        raw = manifest["wards"][ward].get("raw")
        if not raw:
            failures.append(f"{ward}: manifest has no raw parquet record")
        else:
            raw_abs = os.path.join(ROOT, raw["path"])
            if not os.path.exists(raw_abs):
                failures.append(f"{ward}: raw parquet missing at {raw['path']}")
            else:
                with open(raw_abs, "rb") as fh:
                    if hashlib.sha256(fh.read()).hexdigest() != raw["sha256"]:
                        failures.append(f"{ward}: raw parquet sha256 drift -- the download "
                                        f"changed under the manifest")
        expect = EXPECT_COUNT.get(ward)
        if expect and not (0.9 * expect <= doc["count"] <= 1.1 * expect):
            failures.append(f"{ward}: count {doc['count']} vs measured {expect} -- parquet changed")
        flagged = [r for r in doc["b"] if "inWard" in r]
        if _wardmask.has_polygon(ward):
            if len(flagged) != len(doc["b"]):
                failures.append(f"{ward}: {len(doc['b']) - len(flagged)} rows lack inWard")
            n_in = sum(1 for r in flagged if r["inWard"])
            want = EXPECT_IN_WARD.get(ward)
            if want and not (0.9 * want <= n_in <= 1.1 * want):
                failures.append(f"{ward}: {n_in} footprints touch the ward vs measured {want}")
        elif flagged:
            failures.append(f"{ward}: has no ward polygon but {len(flagged)} rows carry inWard")
        size_m = float(WARDS[ward].footprint_m)
        for row in doc["b"]:
            if len(row["p"]) < 6 or len(row["p"]) % 2:
                failures.append(f"{ward}: malformed ring on {row['gers']}")
                break
            if any(abs(v) > size_m / 2 + 60 for v in row["p"]):
                failures.append(f"{ward}: vertex escapes the window envelope on {row['gers']}")
                break
    for line in failures:
        print(f"  FAIL {line}")
    if not failures:
        total = sum(manifest["wards"][w]["count"] for w in WARDS)
        pins = ", ".join(f"{w} {RELEASES[w][0]}" for w in WARDS)
        print(f"  {len(WARDS)} wards · {total:,} footprints · GERS unique · "
              f"rings well-formed · releases: {pins}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--ward", choices=sorted(WARDS), default=None,
                        help="rebuild one ward and merge it into the manifest")
    args = parser.parse_args()
    if args.check:
        return check()

    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest: dict[str, Any] = {"source": "Overture Maps Foundation (ODbL)", "wards": {}}
    if args.ward and os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            prev = json.load(fh)
        # A manifest from before the per-ward pin carried ONE top-level release
        # and retrieved date, true of every ward in it; push them down.
        for w, rec in prev["wards"].items():
            rec.setdefault("release", prev.get("release"))
            rec.setdefault("retrieved", prev.get("retrieved"))
        manifest["wards"] = prev["wards"]
    for ward in ([args.ward] if args.ward else list(WARDS)):
        release, retrieved = RELEASES[ward]
        rows, skipped = ward_rows(ward)
        path = os.path.join(OUT, f"{ward}-footprints.json")
        doc: dict[str, Any] = {
            "ward": ward, "release": release, "count": len(rows),
            "source": ("Overture Maps Foundation (ODbL) -- OSM + Google + Microsoft, "
                       "GERS-deduplicated"),
            "skipped": skipped, "b": rows,
        }
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        with open(path, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        raw_path = os.path.join(RAW, f"{ward}.parquet")
        with open(raw_path, "rb") as fh:
            raw_digest = hashlib.sha256(fh.read()).hexdigest()
        manifest["wards"][ward] = {
            "release": release, "retrieved": retrieved,
            "count": len(rows), "sha256": digest, "skipped": skipped,
            # The chain is only as good as its first link. Pinning the derived
            # JSON while leaving the parquet unpinned means a changed download
            # produces a changed artefact with nothing to say which moved.
            "raw": {"path": os.path.relpath(raw_path, ROOT),
                    "sha256": raw_digest,
                    "bytes": os.path.getsize(raw_path)},
        }
        in_ward = sum(1 for r in rows if r.get("inWard"))
        extra = f" · {in_ward} touch the ward polygon" if _wardmask.has_polygon(ward) else ""
        print(f"  {ward:<12} {len(rows):>5} footprints · skipped {skipped}{extra}")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=2) + "\n")
    return check()


if __name__ == "__main__":
    sys.exit(main())
