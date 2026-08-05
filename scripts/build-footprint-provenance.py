"""Per-building footprint provenance -> public/heat-map/data/{ward}-provenance.json.

WHY THIS EXISTS. After the frame fix of 2026-08-05 our pipeline places a building
within 2.4 cm of the coordinate its source gave us. Every remaining metre of
positional error is therefore INHERITED, and we have no ground truth with which
to measure or correct it. What we can honestly do instead is say which footprints
are trustworthy — and Overture records that per building.

Measured over the shipped Ballygunge set (3,527 buildings, 100 % joined by GERS id):

    OpenStreetMap            2252   63.9%   human-traced
    Google Open Buildings    1065   30.2%   ML, confidence median 0.73
    Microsoft ML Buildings    210    6.0%   ML

CONFIDENCE IS NOT A PROPERTY OF THE SOURCE. Measured across all three wards:
Google publishes it on 100 % of rows everywhere (median 0.73-0.83); Microsoft
publishes it on 100 % in Barrackpore and Baruipur but 0 % in Ballygunge; OSM never
does, correctly, because a hand trace has no model confidence. Read it per row.
Assuming "Microsoft publishes none" would tell 1,378 of 1,588 Microsoft buildings
that, with the number sitting in the artefact.

AND THE WARDS ARE NOT EQUALLY MAPPED, which is the finding worth carrying to a
client: Barrackpore is 69.4 % hand-traced and Ballygunge 63.9 %, but BARUIPUR IS
1.1 % — essentially all model output. The three wards do not deserve the same
confidence and nothing on the page said so.

A reader looking at one building deserves to know which, because it is the
difference between "surveyed" and "inferred" — and nothing on screen said.

SHAPE. Row-indexed, parallel to the ward artefact's `b` array, because those rows
are bare numeric arrays with no room for a field. Additive: it touches no existing
artefact and moves no published number.

    python3 scripts/build-footprint-provenance.py
    python3 scripts/build-footprint-provenance.py --check
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "heat-map", "data")
RAW_DIR = os.path.join(ROOT, "data", "geometry", "raw")
FOOTPRINTS = os.path.join(ROOT, "data", "geometry")

#: Overture's dataset strings -> the short key the UI shows, and whether a human
#: drew it. `traced` is the distinction that matters to a reader; the dataset name
#: alone means nothing to anyone who has not read Overture's documentation.
DATASETS = {
    "OpenStreetMap": ("osm", True),
    "Google Open Buildings": ("google", False),
    "Microsoft ML Buildings": ("microsoft", False),
}


def build(ward_id: str) -> dict:
    fp_path = os.path.join(FOOTPRINTS, f"{ward_id}-footprints.json")
    fp = json.load(open(fp_path, encoding="utf-8"))

    raw = sorted(glob.glob(os.path.join(RAW_DIR, f"{ward_id}*.parquet")))
    if not raw:
        sys.exit(f"  no raw parquet for {ward_id} — data/geometry/raw/ is the source of truth "
                 f"for provenance and is committed; do not regenerate it to run this.")
    table = pq.read_table(raw[0], columns=["id", "sources"])
    lut = dict(zip(table.column("id").to_pylist(), table.column("sources").to_pylist()))

    src, conf, unknown = [], [], 0
    for row in fp["b"]:
        entry = lut.get(row["gers"])
        first = entry[0] if entry else None
        dataset = first.get("dataset") if first else None
        key, _traced = DATASETS.get(dataset, ("unknown", False))
        if key == "unknown":
            unknown += 1
        src.append(key)
        c = first.get("confidence") if first else None
        # -1 rather than null: the array is read straight into the UI and a
        # sentinel keeps it a plain number array. Absence is common and legitimate
        # -- see the per-source, per-ward coverage in the module docstring.
        conf.append(round(c, 3) if isinstance(c, (int, float)) else -1)

    counts: dict[str, int] = {}
    for k in src:
        counts[k] = counts.get(k, 0) + 1
    return {
        "ward": ward_id,
        "count": len(src),
        "unknown": unknown,
        "source": fp.get("source", ""),
        "note": ("Footprint provenance per building, row-indexed against {ward}.json's `b`. "
                 "`traced` sources were drawn by a human against imagery; the rest are model "
                 "output. -1 means the source published no confidence for THAT row, never "
                 "low confidence; coverage varies by source AND by ward."),
        "datasets": {k: {"key": v[0], "traced": v[1]} for k, v in DATASETS.items()},
        "counts": counts,
        "src": src,
        "confidence": conf,
    }


def out_path(ward_id: str) -> str:
    return os.path.join(OUT_DIR, f"{ward_id}-provenance.json")


def check() -> int:
    bad = 0
    for ward in _types.WARDS.values():
        path = out_path(ward.id)
        if not os.path.exists(path):
            print(f"  MISSING {os.path.relpath(path, ROOT)}"); bad += 1; continue
        doc = json.load(open(path, encoding="utf-8"))
        shipped = json.load(open(os.path.join(OUT_DIR, f"{ward.id}.json"), encoding="utf-8"))
        n = len(shipped["b"])
        if doc["count"] != n or len(doc["src"]) != n or len(doc["confidence"]) != n:
            print(f"  {ward.id}: provenance has {doc['count']} rows against {n} buildings — "
                  f"row-indexed arrays MUST stay parallel or the card names the wrong source")
            bad += 1
            continue
        if doc["unknown"]:
            print(f"  {ward.id}: {doc['unknown']} buildings have an unrecognised dataset — "
                  f"add it to DATASETS rather than letting the UI show 'unknown'")
            bad += 1
        share = {k: f"{v / n:.1%}" for k, v in doc["counts"].items()}
        print(f"  {ward.id}: {n} buildings — {share}")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        return 1 if check() else 0
    os.makedirs(OUT_DIR, exist_ok=True)
    for ward in _types.WARDS.values():
        doc = build(ward.id)
        with open(out_path(ward.id), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
            fh.write("\n")
        size = os.path.getsize(out_path(ward.id)) / 1024
        print(f"  {ward.id}: {doc['count']} buildings, {doc['counts']}, {size:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
