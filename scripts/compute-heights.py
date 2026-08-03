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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _types                                       # noqa: E402  (path set above)

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

#: GATE A -- distribution parity. p50/p75/p90/mean per ward against the shipped
#: set. These are what FAR and the DC-URS exposure pillar consume; per-building
#: continuity never protected them and, measured, cannot be achieved (the shipped
#: rings are already simplified, so a different polygon samples different pixels).
DIST_TOL = 0.10

#: GATE C -- fill discipline. Shipped rates from compute-far.py's docstring. A
#: jump means footprints and the height raster have stopped agreeing about WHERE
#: buildings are: the signature of the mirroring bug that faked a finding once.
SHIPPED_FILL = {"ballygunge": 0.040, "barrackpore": 0.065, "baruipur": 0.108}
FILL_TOL = 0.03


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
    """Local metres -> degrees. Exact inverse of fetch-buildings.to_local.

    y is NORTHWARD. The first parity run used a southward inverse and mirrored
    every building about the ward centre line, which sampled a neighbour instead
    of the building itself -- 27 % within 2 m, at every statistic.
    """
    clat, clon = WARDS[ward]
    mx, my = _types.m_per_deg(clat)
    return [clon + x / mx, clat + y / my]


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
               .combine(ee.Reducer.percentile([65, 75]), sharedInputs=True)
               .combine(ee.Reducer.count(), sharedInputs=True))
    out = img.reduceRegions(fc, reducer, SCALE_M, tileScale=4).getInfo()
    rows = []
    for f in out["features"]:
        p = f["properties"]
        n_px = p.get("count") or 0
        mean, p65, p75 = p.get("mean"), p.get("p65"), p.get("p75")
        empty = not n_px or mean is None
        # Google writes 2.5 m where it has no confident height -- a VALUE, not an
        # absence. The first gate run tested for zero pixels instead and reported
        # 0 % fill everywhere against shipped rates of 4-11 %, which looked like a
        # data catastrophe and was a measurement bug. compute-far.py matches 2.5
        # exactly for the same reason: it is also the dataset minimum.
        no_confidence = (not empty) and abs((mean or 0) - FILL_M) < 0.05
        usable = not empty
        pick = lambda v: round(v, 1) if usable and v is not None else (
            round(mean, 1) if usable else FILL_M)
        rows.append({
            "id": p["fid"],
            "mean": round(mean, 1) if usable else FILL_M,
            "p65": pick(p65), "p75": pick(p75),
            "px": n_px,
            "fill": empty or no_confidence,
        })
    return rows


def gates(doc: dict, stat: str = "p65") -> int:
    """Three checks replacing one that was measured to be unreachable.

    A -- distribution parity: what the published numbers actually consume.
    C -- fill discipline: the runtime tripwire for a coordinate mismatch.
    B -- OSM accuracy: deferred to validate-heights.py --score (Task 3), which
         owns the ground truth and the method decision.
    """
    failures: list[str] = []
    print(f"  GATES (statistic: {stat})")
    for ward, rows in doc["wards"].items():
        with open(os.path.join(PUBLIC, f"{ward}.json"), encoding="utf-8") as fh:
            shipped = [b[0] for b in json.load(fh)["b"] if b[0] != FILL_M]
        new = [r[stat] for r in rows if not r["fill"]]
        if not new or not shipped:
            failures.append(f"{ward}: nothing comparable")
            continue

        for label, fn in (("p50", statistics.median),
                          ("p75", lambda v: statistics.quantiles(v, n=4)[2]),
                          ("p90", lambda v: statistics.quantiles(v, n=10)[8]),
                          ("mean", statistics.fmean)):
            was, now = fn(shipped), fn(new)
            drift = abs(now - was) / was if was else 1.0
            mark = "  <-- BREACH" if drift > DIST_TOL else ""
            print(f"    {ward:<12} {label:<5} {was:6.2f} -> {now:6.2f} m ({(now-was)/was:+6.1%}){mark}")
            if drift > DIST_TOL:
                failures.append(f"{ward} {label}: {drift:.1%} drift exceeds {DIST_TOL:.0%}")

        fill = sum(r["fill"] for r in rows) / len(rows)
        mark = "  <-- BREACH" if abs(fill - SHIPPED_FILL[ward]) > FILL_TOL else ""
        print(f"    {ward:<12} fill  {SHIPPED_FILL[ward]:.1%} -> {fill:.1%}{mark}")
        if abs(fill - SHIPPED_FILL[ward]) > FILL_TOL:
            failures.append(f"{ward}: fill {fill:.1%} vs shipped {SHIPPED_FILL[ward]:.1%} -- "
                            f"footprints and the height raster disagree about WHERE buildings are")

    for line in failures:
        print(f"  FAIL {line}")
    if failures:
        print("  Gate A breaches may be EXPLAINABLE (Overture adds ~5,200 mostly-small")
        print("  buildings, so a downward shift is predicted) -- argue it in the delta")
        print("  table, do not wave it through. A Gate C breach never is.")
    return 1 if failures else 0


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

    # The artefact is written BEFORE the gates run. The first attempt gated first
    # and returned early, discarding twenty minutes of Earth Engine measurement --
    # a failed gate must leave evidence to diagnose, not a clean slate.
    out_path = os.path.join(GEOM, f"heights-{mode}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
    fills = sum(sum(r["fill"] for r in rows) for rows in doc["wards"].values())
    total = sum(len(rows) for rows in doc["wards"].values())
    print(f"  -> {os.path.relpath(out_path, ROOT)} · {total:,} buildings · {fills} fill")
    return gates(doc) if mode == "overture" else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["parity", "overture"], required=True)
    return run(parser.parse_args().mode)


if __name__ == "__main__":
    sys.exit(main())
