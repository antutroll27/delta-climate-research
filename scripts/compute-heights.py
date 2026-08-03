"""Building heights from Google Open Buildings 2.5D Temporal, via Earth Engine.

TWO MODES, PARITY FIRST. The heights we ship today were produced by a pipeline
that was never committed -- the ward JSONs are baked artefacts nobody can
regenerate. Before this one may generate anything new it must REPRODUCE the
committed b[0] values over the CURRENT Microsoft footprints. A pipeline that
cannot recreate today's artefact has no business producing tomorrow's, and the
parity run doubles as the day-one smoke test of the Earth Engine IAM grant.

BOTH STATISTICS, ONE DECISION LATER. `mean` is today's method. `p75` is the
candidate fix for a suspected ~25 % low bias: averaging the 2.5D raster over a
footprint pulls in courtyards, annexes and shadow, which drags the mean down.
This script only MEASURES both; scripts/validate-heights.py --score picks the
winner from OSM evidence, and ships `mean` if the evidence is too thin.

FILL IS EXPLICIT. Where no confident pixel covers a footprint the height is 2.5
with "fill": true -- Google's own convention, carried openly rather than
silently becoming a 2.5 m building. compute-far.py already excludes these from
its height statistics for exactly this reason.

    export GOOGLE_APPLICATION_CREDENTIALS=~/.config/delta-climate/ee-service-account.json
    python3 scripts/compute-heights.py --mode parity      # must pass first
    python3 scripts/compute-heights.py --mode overture
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys

import ee

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "data", "geometry")
PUBLIC = os.path.join(ROOT, "public", "heat-map", "data")

COLLECTION = "GOOGLE/Research/open-buildings-temporal/v1"
EPOCH = ("2023-01-01", "2024-01-01")     # the epoch the shipped heightsNote names
SCALE_M = 4                              # the product's native ~4 m posting
PAGE = 300                               # features per reduceRegions call
FILL_M = 2.5

WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

#: Parity thresholds. Generous enough to absorb a different zonal implementation,
#: tight enough that a genuinely different METHOD cannot slip through.
PARITY_MEDIAN_M = 0.5
PARITY_WITHIN_2M = 0.90


def init_ee() -> None:
    """Credentials come from the environment, never a repo path, never printed."""
    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not key:
        raise SystemExit("  GOOGLE_APPLICATION_CREDENTIALS is not set")
    with open(key, encoding="utf-8") as fh:
        email = json.load(fh)["client_email"]
    ee.Initialize(ee.ServiceAccountCredentials(email, key))


def height_image() -> ee.Image:
    return (ee.ImageCollection(COLLECTION)
            .filterDate(*EPOCH).mosaic().select("building_height"))


def to_lonlat(x: float, y: float, ward: str) -> list[float]:
    """Local metres -> degrees. Exact inverse of fetch_buildings.to_local (y southward)."""
    clat, clon = WARDS[ward]
    return [clon + x / (111320.0 * math.cos(math.radians(clat))), clat - y / 110574.0]


def parity_features(ward: str) -> list[dict]:
    """Features from the CURRENTLY SHIPPED geometry; id is the row index."""
    with open(os.path.join(PUBLIC, f"{ward}.json"), encoding="utf-8") as fh:
        d = json.load(fh)
    feats = []
    for i, b in enumerate(d["b"]):
        ring = [to_lonlat(b[k], b[k + 1], ward) for k in range(1, len(b) - 1, 2)]
        if len(ring) < 3:
            continue
        ring.append(ring[0])                       # EE wants an explicit closing vertex
        feats.append({"id": str(i), "ring": ring, "shipped": b[0]})
    return feats


def overture_features(ward: str) -> list[dict]:
    with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
        d = json.load(fh)
    feats = []
    for r in d["b"]:
        ring = [list(pt) for pt in r["lonlat"]]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        feats.append({"id": r["gers"], "ring": ring})
    return feats


def reduce_page(img: ee.Image, feats: list[dict]) -> list[dict]:
    fc = ee.FeatureCollection([
        ee.Feature(ee.Geometry.Polygon([f["ring"]]), {"fid": f["id"]}) for f in feats
    ])
    reducer = (ee.Reducer.mean()
               .combine(ee.Reducer.percentile([75]), sharedInputs=True)
               .combine(ee.Reducer.count(), sharedInputs=True))
    out = img.reduceRegions(fc, reducer, SCALE_M, tileScale=4).getInfo()
    rows = []
    for f in out["features"]:
        p = f["properties"]
        n_px = p.get("count") or 0
        mean, p75 = p.get("mean"), p.get("p75")
        usable = bool(n_px) and mean is not None
        rows.append({
            "id": p["fid"],
            "mean": round(mean, 1) if usable else FILL_M,
            "p75": round(p75, 1) if usable and p75 is not None else (round(mean, 1) if usable else FILL_M),
            "px": n_px,
            "fill": not usable,
        })
    return rows


def run(mode: str) -> int:
    init_ee()
    img = height_image()
    doc = {"mode": mode, "collection": COLLECTION, "epoch": EPOCH[0][:4],
           "scale_m": SCALE_M, "wards": {}}
    for ward in WARDS:
        feats = parity_features(ward) if mode == "parity" else overture_features(ward)
        rows: list[dict] = []
        for i in range(0, len(feats), PAGE):
            rows += reduce_page(img, feats[i:i + PAGE])
            print(f"    {ward}: {min(i + PAGE, len(feats))}/{len(feats)}", flush=True)
        doc["wards"][ward] = rows

        if mode == "parity":
            shipped = {f["id"]: f["shipped"] for f in feats}
            deltas = [abs(r["mean"] - shipped[r["id"]]) for r in rows
                      if not r["fill"] and shipped[r["id"]] != FILL_M]
            if not deltas:
                print(f"  FAIL {ward}: no comparable buildings -- parity is untestable")
                return 1
            median = statistics.median(deltas)
            within = sum(1 for d in deltas if d <= 2.0) / len(deltas)
            print(f"  {ward:<12} PARITY n={len(deltas)} median |Δ|={median:.2f} m · "
                  f"within 2 m {within:.1%}", flush=True)
            if median > PARITY_MEDIAN_M or within < PARITY_WITHIN_2M:
                print(f"  FAIL {ward}: this pipeline does not reproduce the shipped heights.")
                print(f"       STOP -- the discrepancy IS the finding. Do not run --mode overture")
                print(f"       until it is understood (spec §3b).")
                return 1

    out_path = os.path.join(GEOM, f"heights-{mode}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
    fills = sum(sum(r["fill"] for r in rows) for rows in doc["wards"].values())
    total = sum(len(rows) for rows in doc["wards"].values())
    print(f"  -> {os.path.relpath(out_path, ROOT)} · {total:,} buildings · {fills} fill")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["parity", "overture"], required=True)
    return run(parser.parse_args().mode)


if __name__ == "__main__":
    sys.exit(main())
