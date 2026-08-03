"""Overture parquet -> per-ward footprint sets in the instrument's local frame.

WHY OVERTURE. Measured 2026-08-04 (scripts/validate-geometry.py): it holds 3,530
buildings in the Ballygunge window against our shipped 2,048, with 12.1 % of its
buildings more than 20 m from anything we hold. It merges OSM + Google + Microsoft
under stable GERS ids, so our current source is one of its inputs -- this is a
superset, not a different opinion.

RELEASE IS PINNED. Two 2026 releases exist on the bucket; a glob double-counts.

FOOTPRINTS ONLY. Overture carries `height` on 0 of 3,591 buildings here (measured,
not assumed). Heights come from scripts/compute-heights.py and join on the GERS id.

    python3 scripts/fetch-buildings.py            # build all three wards
    python3 scripts/fetch-buildings.py --check    # assert over committed outputs
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys

import duckdb
from shapely import wkb as shapely_wkb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _types                                       # noqa: E402  (path set above)
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
RAW = os.path.join(ROOT, "data", "geometry", "raw")
OUT = os.path.join(ROOT, "data", "geometry")

RELEASE = "2026-07-22.0"
SIZE_M = 1400.0
SIMPLIFY_M = 0.5            # vertex tolerance in the LOCAL frame -- metres, not degrees
MIN_RING_M2 = 4.0           # smaller than any real building; drops slivers
RETRIEVED = "2026-08-04"

WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

#: Counts measured at acquisition. A +/-10 % tripwire: a future re-run drifting
#: past this means the raw parquet changed under the manifest. Filled on the
#: first run and pinned before commit.
EXPECT_COUNT: dict[str, int | None] = {
    "ballygunge": 3527, "barrackpore": 4702, "baruipur": 4538,
}


def to_local(lon: float, lat: float, ward: str) -> tuple[float, float]:
    """Degrees -> metres in the ward frame.

    y grows NORTHWARD, and the constants come from scripts/_types.m_per_deg --
    the same helper fetch-water.py and the roads fetcher use. Verified against
    the shipped footprints rather than assumed: matching Overture centroids to
    ours scores 8.1 m mean nearest under this convention and 13.9 m under the
    southward one. Getting this backwards mirrors every building about the ward's
    centre line, which is exactly how the first parity run failed.
    """
    clat, clon = WARDS[ward]
    mx, my = _types.m_per_deg(clat)
    return (lon - clon) * mx, (lat - clat) * my


def ward_rows(ward: str) -> tuple[list[dict], dict[str, int]]:
    """One ward's footprints: local-frame rings, GERS id, and lon/lat for Earth Engine."""
    con = duckdb.connect()
    rows: list[dict] = []
    skipped = {"not_polygon": 0, "tiny": 0, "outside": 0, "holes_dropped": 0}
    query = f"SELECT id, geometry FROM read_parquet('{RAW}/{ward}.parquet')"
    for gers, blob in con.execute(query).fetchall():
        geom = shapely_wkb.loads(bytes(blob))
        if geom.geom_type == "MultiPolygon":                 # keep the largest part
            geom = max(geom.geoms, key=lambda g: g.area)
        if geom.geom_type != "Polygon":
            skipped["not_polygon"] += 1
            continue
        if len(geom.interiors) > 0:
            skipped["holes_dropped"] += 1                    # counted, never silent
        lonlat = list(geom.exterior.coords)
        local = Polygon([to_local(lo, la, ward) for lo, la in lonlat])
        if abs(local.centroid.x) > SIZE_M / 2 or abs(local.centroid.y) > SIZE_M / 2:
            skipped["outside"] += 1                          # bbox caught a neighbour's edge
            continue
        local = local.simplify(SIMPLIFY_M, preserve_topology=True)
        if local.area < MIN_RING_M2:
            skipped["tiny"] += 1
            continue
        ring = [round(v, 1) for xy in local.exterior.coords[:-1] for v in xy]
        if len(ring) < 6:
            skipped["tiny"] += 1
            continue
        rows.append({
            "gers": gers,
            "p": ring,                                        # flat [x0,y0,...], metres
            "lonlat": [[round(lo, 6), round(la, 6)] for lo, la in lonlat],
        })
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
    if manifest["release"] != RELEASE:
        failures.append(f"release drifted: {manifest['release']} != {RELEASE}")
    for ward in WARDS:
        path = os.path.join(OUT, f"{ward}-footprints.json")
        if not os.path.exists(path):
            failures.append(f"{ward}: footprints missing")
            continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        ids = [r["gers"] for r in doc["b"]]
        if len(set(ids)) != len(ids):
            failures.append(f"{ward}: duplicate GERS ids -- the join to heights would be ambiguous")
        expect = EXPECT_COUNT.get(ward)
        if expect and not (0.9 * expect <= doc["count"] <= 1.1 * expect):
            failures.append(f"{ward}: count {doc['count']} vs measured {expect} -- parquet changed")
        for row in doc["b"]:
            if len(row["p"]) < 6 or len(row["p"]) % 2:
                failures.append(f"{ward}: malformed ring on {row['gers']}")
                break
            if any(abs(v) > SIZE_M / 2 + 60 for v in row["p"]):
                failures.append(f"{ward}: vertex escapes the window envelope on {row['gers']}")
                break
    for line in failures:
        print(f"  FAIL {line}")
    if not failures:
        total = sum(manifest["wards"][w]["count"] for w in WARDS)
        print(f"  {len(WARDS)} wards · {total:,} footprints · GERS unique · "
              f"rings well-formed · release {RELEASE}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()

    os.makedirs(OUT, exist_ok=True)
    manifest = {"release": RELEASE, "retrieved": RETRIEVED,
                "source": "Overture Maps Foundation (ODbL)", "wards": {}}
    for ward in WARDS:
        rows, skipped = ward_rows(ward)
        path = os.path.join(OUT, f"{ward}-footprints.json")
        doc = {
            "ward": ward, "release": RELEASE, "count": len(rows),
            "source": ("Overture Maps Foundation (ODbL) -- OSM + Google + Microsoft, "
                       "GERS-deduplicated"),
            "skipped": skipped, "b": rows,
        }
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        with open(path, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        manifest["wards"][ward] = {"count": len(rows), "sha256": digest, "skipped": skipped}
        print(f"  {ward:<12} {len(rows):>5} footprints · skipped {skipped}")
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=2) + "\n")
    return check()


if __name__ == "__main__":
    sys.exit(main())
