# Regenerable Geometry Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unregenerable baked ward geometry with an Overture-footprint + Earth-Engine-height pipeline, measure every downstream delta, and stop for user review before anything ships.

**Architecture:** Five offline scripts in sequence: acquire footprints (DuckDB + shapely) → EE heights with a parity oracle over the CURRENT geometry first → method decision from OSM evidence → bake to staging → one delta table. Nothing under `public/` changes in this plan; the ship step is a separate approval after the table is reviewed.

**Contract:** [`../specs/2026-08-04-geometry-pipeline-design.md`](../specs/2026-08-04-geometry-pipeline-design.md)

**Tech Stack:** Python 3.12 (duckdb 1.5.5, shapely 2.1.2, requests, earthengine-api — the one new install), Node 24 `--experimental-strip-types` for the sim delta runner (the `validate-model.mjs` pattern).

**Security, restated because this task touches the key:** the EE key stays at `~/.config/delta-climate/ee-service-account.json` (0600), read only via `GOOGLE_APPLICATION_CREDENTIALS`. Never referenced by repo path, never printed, never committed. The machine needs `SSL_CERT_FILE=$(python3 -m certifi)` for anything urllib-based.

---

### Task 0: Preconditions (10 min, fails fast)

- [ ] **Step 1: Install and authenticate EE**

```bash
python3 -m pip install earthengine-api
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/delta-climate/ee-service-account.json
export SSL_CERT_FILE=$(python3 -m certifi)
python3 - <<'PY'
import json, os, ee
info = json.load(open(os.environ["GOOGLE_APPLICATION_CREDENTIALS"]))
ee.Initialize(ee.ServiceAccountCredentials(info["client_email"], os.environ["GOOGLE_APPLICATION_CREDENTIALS"]))
img = ee.ImageCollection("GOOGLE/Research/open-buildings-temporal/v1") \
        .filterDate("2023-01-01", "2024-01-01").mosaic().select("building_height")
probe = img.reduceRegion(ee.Reducer.mean(), ee.Geometry.Point([88.3659, 22.528]).buffer(200), 4)
print("  EE OK — height near Ballygunge centre:", probe.getInfo())
PY
```

Expected: a number (metres). **A permission error here is the spec's day-one stop**: the missing IAM grant blocks this collection. Stop, report, and draft the grant request — nothing else in this plan can proceed.

- [ ] **Step 2: Confirm the Overture parquets** (re-download if the scratchpad copies died with the session)

```bash
export SSL_CERT_FILE=$(python3 -m certifi)
mkdir -p data/geometry/raw
for W in "ballygunge 88.359092,22.521669,88.372708,22.534331" \
         "barrackpore 88.364523,22.755769,88.378077,22.768431" \
         "baruipur 88.425100,22.359069,88.438700,22.371731"; do
  set -- $W
  [ -f data/geometry/raw/$1.parquet ] || python3 -m overturemaps download \
    --release=2026-07-22.0 --bbox=$2 -f geoparquet --type=building \
    -o data/geometry/raw/$1.parquet
done
ls -la data/geometry/raw/
```

Expected: three parquets, Ballygunge ~550 KB. (~8 min each if downloading — the metadata walk is the cost.)

---

### Task 1: `scripts/fetch-buildings.py` — footprints

**Files:**
- Create: `scripts/fetch-buildings.py`
- Creates at runtime: `data/geometry/{ward}-footprints.json`, `data/geometry/manifest.json`

- [ ] **Step 1: Write the script**

```python
"""Overture parquet -> per-ward footprint sets in the instrument's local frame.

WHY OVERTURE. Measured 2026-08-04 (scripts/validate-geometry.py): it holds 3,530
buildings in the Ballygunge window against our shipped 2,048, with 12.1 % of its
buildings more than 20 m from anything we hold. It merges OSM + Google + Microsoft
under stable GERS ids, so our current source is one of its inputs.

RELEASE IS PINNED. Two 2026 releases exist on the bucket; a glob double-counts.

FOOTPRINTS ONLY. Overture carries height on 0 of 3,591 buildings here (measured).
Heights come from scripts/compute-heights.py, joined on the GERS id.

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
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
RAW = os.path.join(ROOT, "data", "geometry", "raw")
OUT = os.path.join(ROOT, "data", "geometry")

RELEASE = "2026-07-22.0"
SIZE_M = 1400.0
SIMPLIFY_M = 0.5            # vertex tolerance in the LOCAL frame — metres, not degrees
MIN_RING_M2 = 4.0           # smaller than any real building; drops slivers
RETRIEVED = "2026-08-04"

WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

#: Counts measured at acquisition. ±10 % tripwire: a future re-run drifting past
#: this means the raw parquet changed under the manifest.
EXPECT_COUNT = {"ballygunge": 3530, "barrackpore": None, "baruipur": None}
# barrackpore/baruipur: None until first run prints them; then pin the numbers
# here and in the manifest before committing (the plan's step 3 does this).


def to_local(lon: float, lat: float, ward: str) -> tuple[float, float]:
    """Degrees -> metres in the ward frame. y grows SOUTHWARD (the house rule)."""
    clat, clon = WARDS[ward]
    x = (lon - clon) * 111320.0 * math.cos(math.radians(clat))
    y = (clat - lat) * 110574.0
    return x, y


def ward_rows(ward: str) -> tuple[list[dict], dict]:
    """One ward's footprints: local-frame rings + GERS + lon/lat rings for EE."""
    con = duckdb.connect()
    q = f"""SELECT id, geometry FROM read_parquet('{RAW}/{ward}.parquet')"""
    rows, skipped = [], {"not_polygon": 0, "tiny": 0, "outside": 0, "holes_dropped": 0}
    for gers, wkb in con.execute(q).fetchall():
        geom = shapely_wkb.loads(bytes(wkb))
        if geom.geom_type == "MultiPolygon":            # keep the largest part
            geom = max(geom.geoms, key=lambda g: g.area)
        if geom.geom_type != "Polygon":
            skipped["not_polygon"] += 1
            continue
        if len(geom.interiors) > 0:
            skipped["holes_dropped"] += 1               # counted, not silent
        lonlat = list(geom.exterior.coords)
        local = Polygon(to_local(lo, la, ward) for lo, la in lonlat)
        cx, cy = local.centroid.x, local.centroid.y
        if abs(cx) > SIZE_M / 2 or abs(cy) > SIZE_M / 2:
            skipped["outside"] += 1                     # bbox caught neighbours' edges
            continue
        local = local.simplify(SIMPLIFY_M, preserve_topology=True)
        if local.area < MIN_RING_M2:
            skipped["tiny"] += 1
            continue
        ring = [round(v, 1) for xy in local.exterior.coords[:-1] for v in xy]
        rows.append({
            "gers": gers,
            "p": ring,                                   # flat [x0,y0,…], metres
            "lonlat": [[round(lo, 6), round(la, 6)] for lo, la in lonlat],
        })
    rows.sort(key=lambda r: r["gers"])                   # byte-stable order
    return rows, skipped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    if ap.parse_args().check:
        return check()
    manifest = {"release": RELEASE, "retrieved": RETRIEVED, "wards": {}}
    for ward in WARDS:
        rows, skipped = ward_rows(ward)
        path = os.path.join(OUT, f"{ward}-footprints.json")
        doc = {"ward": ward, "release": RELEASE, "count": len(rows),
               "source": "Overture Maps Foundation (ODbL) — OSM + Google + Microsoft, GERS-deduplicated",
               "skipped": skipped, "b": rows}
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        with open(path, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        manifest["wards"][ward] = {"count": len(rows), "sha256": sha, "skipped": skipped}
        print(f"  {ward:<12} {len(rows):>5} footprints · skipped {skipped}")
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=2) + "\n")
    return check()


def check() -> int:
    failures = []
    with open(os.path.join(OUT, "manifest.json"), encoding="utf-8") as fh:
        man = json.load(fh)
    if man["release"] != RELEASE:
        failures.append(f"release drifted: {man['release']} != {RELEASE}")
    for ward in WARDS:
        path = os.path.join(OUT, f"{ward}-footprints.json")
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        gers = [r["gers"] for r in d["b"]]
        if len(set(gers)) != len(gers):
            failures.append(f"{ward}: duplicate GERS ids")
        expect = EXPECT_COUNT.get(ward)
        if expect and not (0.9 * expect <= d["count"] <= 1.1 * expect):
            failures.append(f"{ward}: count {d['count']} vs measured {expect} — parquet changed")
        for r in d["b"][:2000]:
            if len(r["p"]) < 6 or len(r["p"]) % 2:
                failures.append(f"{ward}: malformed ring on {r['gers']}"); break
            if any(abs(v) > SIZE_M / 2 + 60 for v in r["p"]):
                failures.append(f"{ward}: vertex escapes the window envelope on {r['gers']}"); break
    for line in failures:
        print(f"  FAIL {line}")
    if not failures:
        print(f"  {len(WARDS)} wards · GERS unique · rings well-formed · release {RELEASE}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run** — `python3 scripts/fetch-buildings.py`
Expected: three count lines (Ballygunge ~3,4xx after the centroid filter — slightly under 3,530 because bbox-caught neighbours drop), `--check` green.

- [ ] **Step 3: Pin the two unmeasured counts** — copy the printed barrackpore/baruipur counts into `EXPECT_COUNT`, re-run `--check`, confirm green.

- [ ] **Step 4: Byte-stability** — run twice, `shasum data/geometry/*-footprints.json` identical.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-buildings.py data/geometry/manifest.json data/geometry/*-footprints.json
git commit -m "feat(geometry): Overture footprints in the ward frame, release-pinned, GERS-keyed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(`data/geometry/raw/*.parquet` stays untracked if >50 MB total; the manifest's sha256 pins content either way. Check size before deciding; if small, commit them.)

---

### Task 2: `scripts/compute-heights.py` — EE, parity first

**Files:**
- Create: `scripts/compute-heights.py`
- Creates at runtime: `data/geometry/heights-parity.json`, `data/geometry/heights-overture.json`

- [ ] **Step 1: Write the script**

```python
"""Building heights from Google Open Buildings 2.5D Temporal, via Earth Engine.

TWO MODES, PARITY FIRST. The heights we ship today were produced by a pipeline
that was never committed. Before this one may generate anything new, it must
REPRODUCE the committed b[0] values over the CURRENT Microsoft footprints:
median |delta| <= 0.5 m and >= 90 % of buildings within 2 m (fill-flagged rows
excluded). A pipeline that cannot recreate today's artefact has no business
producing tomorrow's. Parity also smoke-tests the IAM grant on day one.

BOTH STATISTICS. mean is today's method; p75 is the candidate fix for the
suspected ~25 % low bias (zonal-mean over a footprint pulls in courtyards,
annexes, shadow). scripts/validate-heights.py picks the winner from OSM
evidence; this script just measures both.

FILL IS EXPLICIT. Where no confident pixel covers the footprint the height is
2.5 with "fill": true -- Google's convention, carried openly.

    export GOOGLE_APPLICATION_CREDENTIALS=~/.config/delta-climate/ee-service-account.json
    python3 scripts/compute-heights.py --mode parity
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
SCALE_M = 4                              # the product's native ~4 m
PAGE = 400                               # features per reduceRegions call
FILL_M = 2.5

WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

PARITY_MEDIAN_M = 0.5
PARITY_WITHIN_2M = 0.90


def init_ee() -> None:
    key = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]      # never a repo path
    email = json.load(open(key))["client_email"]
    ee.Initialize(ee.ServiceAccountCredentials(email, key))


def height_image() -> ee.Image:
    return (ee.ImageCollection(COLLECTION)
            .filterDate(*EPOCH).mosaic().select("building_height"))


def to_lonlat(x: float, y: float, ward: str) -> list[float]:
    """Local metres -> degrees. Inverse of fetch-buildings.to_local (y southward)."""
    clat, clon = WARDS[ward]
    return [clon + x / (111320.0 * math.cos(math.radians(clat))),
            clat - y / 110574.0]


def parity_features(ward: str) -> list[dict]:
    """Features from the CURRENT shipped geometry, id = row index."""
    d = json.load(open(os.path.join(PUBLIC, f"{ward}.json")))
    feats = []
    for i, b in enumerate(d["b"]):
        ring = [to_lonlat(b[k], b[k + 1], ward) for k in range(1, len(b) - 1, 2)]
        feats.append({"id": str(i), "ring": ring, "shipped": b[0]})
    return feats


def overture_features(ward: str) -> list[dict]:
    d = json.load(open(os.path.join(GEOM, f"{ward}-footprints.json")))
    return [{"id": r["gers"], "ring": r["lonlat"]} for r in d["b"]]


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
        rows.append({
            "id": p["fid"],
            "mean": round(p["mean"], 1) if n_px else FILL_M,
            "p75": round(p["p75"], 1) if n_px else FILL_M,
            "px": n_px,
            "fill": n_px == 0,
        })
    return rows


def run(mode: str) -> int:
    init_ee()
    img = height_image()
    out_path = os.path.join(GEOM, f"heights-{mode}.json")
    doc = {"mode": mode, "collection": COLLECTION, "epoch": EPOCH[0][:4],
           "scale_m": SCALE_M, "wards": {}}
    for ward in WARDS:
        feats = parity_features(ward) if mode == "parity" else overture_features(ward)
        rows = []
        for i in range(0, len(feats), PAGE):
            rows += reduce_page(img, feats[i:i + PAGE])
            print(f"  {ward}: {min(i + PAGE, len(feats))}/{len(feats)}", flush=True)
        doc["wards"][ward] = rows
        if mode == "parity":
            shipped = {f["id"]: f["shipped"] for f in feats}
            deltas = [abs(r["mean"] - shipped[r["id"]])
                      for r in rows if not r["fill"] and shipped[r["id"]] != FILL_M]
            med = statistics.median(deltas)
            within = sum(1 for d in deltas if d <= 2.0) / len(deltas)
            print(f"  {ward}: PARITY median |d|={med:.2f} m · within 2 m {within:.1%}")
            if med > PARITY_MEDIAN_M or within < PARITY_WITHIN_2M:
                print(f"  FAIL {ward}: the pipeline does not reproduce the shipped heights."
                      f" STOP — the discrepancy IS the finding. Investigate before Overture mode.")
                return 1
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"  -> {os.path.relpath(out_path, ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=["parity", "overture"], required=True)
    return run(ap.parse_args().mode)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Parity run** — `python3 scripts/compute-heights.py --mode parity`
Expected: three `PARITY median |d|=…` lines, all under thresholds. **If any ward fails: STOP the plan.** The discrepancy is the deliverable; report it. (~3 × 6 pages ≈ 15–25 min of EE calls.)

- [ ] **Step 3: Production run** — `python3 scripts/compute-heights.py --mode overture`
Expected: `heights-overture.json` with mean/p75/px/fill per GERS id.

- [ ] **Step 4: Commit** (both artefacts + script; heights files are a few hundred KB)

```bash
git add scripts/compute-heights.py data/geometry/heights-*.json
git commit -m "feat(geometry): EE height pipeline -- parity against shipped heights proven, both statistics measured

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The method decision — extend `scripts/validate-heights.py`

**Files:**
- Modify: `scripts/validate-heights.py` (add `--score` mode; keep the existing probe)
- Creates at runtime: `data/geometry/height-method.json`

- [ ] **Step 1: Add the scoring mode** — append to the file:

```python
# ── --score mode: pick mean vs p75 from every OSM building:levels tag ─────────
# Overpass etiquette learned the hard way: one request per ward, 30 s apart,
# results cached to disk so a rerun never refetches.

import time

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                     "data", "geometry", "osm-levels-cache.json")
METHOD_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                          "data", "geometry", "height-method.json")
MIN_PAIRS = 8          # below this the test is underpowered and mean ships
MATCH_M = 12.0
STOREY_TESTS = (2.9, 3.1, 3.3)


def levels_cached() -> dict:
    if os.path.exists(CACHE):
        return json.load(open(CACHE))
    out = {}
    for ward, (lat, lon) in WARDS.items():
        out[ward] = fetch_levels(lat, lon)      # the existing function above
        json.dump(out, open(CACHE, "w"))        # cache after EVERY ward
        time.sleep(30)
    return out


def score() -> int:
    heights = json.load(open(os.path.join(os.path.dirname(CACHE), "heights-overture.json")))
    foot = {w: json.load(open(os.path.join(os.path.dirname(CACHE), f"{w}-footprints.json")))
            for w in WARDS}
    pairs = []          # (levels, mean, p75)
    for ward, els in levels_cached().items():
        by_gers = {r["id"]: r for r in heights["wards"][ward]}
        cents = []
        for r in foot[ward]["b"]:
            xs, ys = r["p"][0::2], r["p"][1::2]
            cents.append((sum(xs) / len(xs), sum(ys) / len(ys), r["gers"]))
        lat, lon = WARDS[ward]
        for e in els:
            c = e.get("center") or {}
            if "lat" not in c:
                continue
            try:
                lv = float(str(e["tags"]["building:levels"]).split(";")[0])
            except (KeyError, ValueError):
                continue
            if not (1 <= lv <= 60):
                continue
            x = (c["lon"] - lon) * 111320.0 * math.cos(math.radians(lat))
            y = (lat - c["lat"]) * 110574.0
            best = min(cents, key=lambda t: (t[0] - x) ** 2 + (t[1] - y) ** 2)
            if math.hypot(best[0] - x, best[1] - y) > MATCH_M:
                continue
            h = by_gers.get(best[2])
            if h and not h["fill"]:
                pairs.append((lv, h["mean"], h["p75"]))

    verdict = {"pairs": len(pairs), "min_pairs": MIN_PAIRS, "tests": {}}
    if len(pairs) < MIN_PAIRS:
        verdict["method"] = "mean"
        verdict["reason"] = f"underpowered: {len(pairs)} pairs < {MIN_PAIRS} — mean ships, hypothesis stays open"
    else:
        for spm in STOREY_TESTS:
            verdict["tests"][str(spm)] = {
                "mean_ratio": round(statistics.median(m / (lv * spm) for lv, m, _ in pairs), 3),
                "p75_ratio": round(statistics.median(p / (lv * spm) for lv, _, p in pairs), 3),
            }
        # winner: median ratio nearer 1.0 at the central storey height, and the
        # verdict must not FLIP across the bracket — if it does, underpowered.
        wins = ["p75" if abs(t["p75_ratio"] - 1) < abs(t["mean_ratio"] - 1) else "mean"
                for t in verdict["tests"].values()]
        verdict["method"] = wins[1] if len(set(wins)) == 1 else "mean"
        verdict["reason"] = ("consistent winner across storey bracket" if len(set(wins)) == 1
                             else "winner flips across storey bracket — underpowered, mean ships")
    json.dump(verdict, open(METHOD_OUT, "w"), indent=2)
    print(json.dumps(verdict, indent=2))
    return 0
```

Wire `--score` into the existing `__main__` argument handling (`if "--score" in sys.argv: sys.exit(score())` above the existing probe body).

- [ ] **Step 2: Run** — `python3 scripts/validate-heights.py --score`
Expected: a verdict JSON naming `method`, `pairs`, ratios per storey constant, and a reason. Whatever it says is the answer — the plan does not second-guess it.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-heights.py data/geometry/height-method.json data/geometry/osm-levels-cache.json
git commit -m "feat(geometry): height method decided by every OSM levels tag in the three wards

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `scripts/build-ward-geometry.py` — bake to staging

**Files:**
- Create: `scripts/build-ward-geometry.py`
- Creates at runtime: `data/geometry/staging/{ward}.json`

- [ ] **Step 1: Write it**

```python
"""Footprints + chosen heights -> staged ward JSON. NOTHING here touches public/.

The output is schema-identical to the shipped files, so every consumer -- the 3D
scene, the pick registry, rasterizeWardBuilt, compute-far, Compare -- works
unchanged. The ship step (after the user reviews the delta table) is a copy.

    python3 scripts/build-ward-geometry.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "data", "geometry")
STAGING = os.path.join(GEOM, "staging")
PUBLIC = os.path.join(ROOT, "public", "heat-map", "data")

WARDS = ("ballygunge", "barrackpore", "baruipur")


def main() -> int:
    method = json.load(open(os.path.join(GEOM, "height-method.json")))["method"]
    heights = json.load(open(os.path.join(GEOM, "heights-overture.json")))
    os.makedirs(STAGING, exist_ok=True)
    for ward in WARDS:
        shipped = json.load(open(os.path.join(PUBLIC, f"{ward}.json")))
        foot = json.load(open(os.path.join(GEOM, f"{ward}-footprints.json")))
        by_gers = {r["id"]: r for r in heights["wards"][ward]}
        b = []
        fills = 0
        for r in foot["b"]:
            h = by_gers[r["gers"]]
            fills += h["fill"]
            b.append([h[method]] + r["p"])
        doc = {
            "name": shipped["name"], "type": shipped["type"],
            "center": shipped["center"], "sizeM": shipped["sizeM"],
            "count": len(b),
            "source": (f"Overture Maps Foundation {foot['release']} (ODbL; OSM + Google "
                       f"+ Microsoft, GERS-deduplicated) | heights: Google Open Buildings "
                       f"2.5D Temporal via Earth Engine"),
            "heightsNote": (f"Heights: zonal {method} of Open Buildings 2.5D Temporal "
                            f"(2023 epoch, ~4 m) per Overture footprint; method chosen "
                            f"against OSM building:levels (see data/geometry/"
                            f"height-method.json). 2.5 m is the no-confident-height "
                            f"fill ({fills} buildings here). CC BY 4.0 / ODbL."),
            "b": b,
        }
        path = os.path.join(STAGING, f"{ward}.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        print(f"  {ward:<12} {len(b):>5} buildings · {fills} fill · {os.path.getsize(path):,} B "
              f"(shipped: {shipped['count']} · {os.path.getsize(os.path.join(PUBLIC, ward + '.json')):,} B)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run** — expect three lines with new counts (~3.4k/…/…) and byte sizes beside the shipped ones.
- [ ] **Step 3: Byte-stability** — run twice, shasums identical.
- [ ] **Step 4: Commit** (`scripts/build-ward-geometry.py` + `data/geometry/staging/`).

---

### Task 5: The delta gate

**Files:**
- Modify: `scripts/export-built-raster.mjs:38` — dir override, one line
- Modify: `scripts/compute-far.py:43` — same, via env
- Create: `scripts/measure-geometry-deltas.py`
- Creates at runtime: `data/calibration/geometry-replacement.json`

- [ ] **Step 1: The two overrides**

`export-built-raster.mjs:38`:
```js
  const GEOM_DIR = process.env.GEOM_DIR ?? 'public/heat-map/data';
  const data = JSON.parse(readFileSync(`${GEOM_DIR}/${ward}.json`, 'utf8'));
```

`compute-far.py:43`:
```python
GEOM = os.environ.get("GEOM_DIR") or os.path.join(ROOT, "public", "heat-map", "data")
```

Both default to today's behaviour; `npm run verify` must stay green after this step alone.

- [ ] **Step 2: The sim delta runner** — create `scripts/geometry-sim-delta.mjs`:

```js
/**
 * Ward-mean equilibrium under canonical forcing, shipped vs staged geometry.
 *
 * Layers are FLAT at the measured ward means (surface = null) deliberately: the
 * only thing that differs between the two runs is the built raster, so the
 * delta isolates the footprint effect. Compare's pinned pairs are built from
 * this same sim, so these deltas are Compare's deltas.
 *
 * Invocation mirrors scripts/validate-model.mjs (same import style, same
 * stepping loop — lift the equilibrium loop from there verbatim).
 *
 *   node --experimental-strip-types scripts/geometry-sim-delta.mjs
 */
import { readFileSync } from 'node:fs';
const M = await import('../src/scripts/climate-engine/heat-map-model.ts');
const R = await import('../src/scripts/climate-engine/ward-raster.ts');

const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];
const inputs = JSON.parse(readFileSync('public/heat-map/data/dc-urs-inputs.json', 'utf8')).wards;

for (const ward of WARDS) {
  const means = { fvc: inputs[ward].fvc, albedo: inputs[ward].albedo };
  if (means.fvc == null || means.albedo == null) throw new Error(`${ward}: means missing`);
  for (const [tag, dir] of [['shipped', 'public/heat-map/data'], ['staged', 'data/geometry/staging']]) {
    const d = JSON.parse(readFileSync(`${dir}/${ward}.json`, 'utf8'));
    const base = R.rasterWardBase(d, means, null);
    // …equilibrium loop lifted from validate-model.mjs: currentParams at peak
    // and night (live: null), step to convergence, record the ward-mean °C…
    // print one line per (ward, tag, phase): `${ward} ${tag} peak 44.83`
  }
}
```

The commented section is filled by copying `validate-model.mjs`'s stepping loop
(read it first: `sed -n '40,120p' scripts/validate-model.mjs`) — same params, same
convergence rule, so the deltas are comparable to every number that harness has
ever printed.

- [ ] **Step 3: The orchestrator** — `scripts/measure-geometry-deltas.py`:

```python
"""Every downstream number, shipped vs staged, in one table. THE PLAN STOPS HERE.

    python3 scripts/measure-geometry-deltas.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
STAGING = os.path.join(ROOT, "data", "geometry", "staging")
OUT = os.path.join(ROOT, "data", "calibration", "geometry-replacement.json")
WARDS = ("ballygunge", "barrackpore", "baruipur")


def run(cmd: list[str], env_extra: dict | None = None) -> str:
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(cmd, cwd=ROOT, env=env, check=True,
                          capture_output=True, text=True).stdout


def built_means(geom_dir: str | None) -> dict:
    env = {"GEOM_DIR": geom_dir} if geom_dir else None
    out = run(["node", "scripts/export-built-raster.mjs"], env)
    # the script prints `ward mean 0.xxxx` lines; parse them
    means = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] in WARDS:
            means[parts[0]] = float(parts[-1])
    return means


def far(geom_dir: str | None) -> dict:
    env = {"GEOM_DIR": geom_dir} if geom_dir else None
    run([sys.executable, "scripts/compute-far.py"], env)
    return json.load(open(os.path.join(ROOT, "data", "dc-urs", "far.json")))["wards"]


def main() -> int:
    before = {"built": built_means(None), "far": far(None)}
    after = {"built": built_means(STAGING), "far": far(STAGING)}
    far_restore = far(None)          # leave far.json as shipped — the gate only measures
    sim = run(["node", "--experimental-strip-types", "scripts/geometry-sim-delta.mjs"])

    table = {"note": "shipped vs staged; nothing ships until this is reviewed", "wards": {}}
    for w in WARDS:
        sizes = [os.path.getsize(os.path.join(ROOT, "public", "heat-map", "data", f"{w}.json")),
                 os.path.getsize(os.path.join(STAGING, f"{w}.json"))]
        table["wards"][w] = {
            "built_mean": [before["built"].get(w), after["built"].get(w)],
            "far": [before["far"][w]["far"], after["far"][w]["far"]],
            "bytes": sizes,
        }
    table["sim_output"] = sim.splitlines()
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(table, indent=2) + "\n")

    print(f"\n  {'ward':<13}{'built before':>13}{'after':>9}{'FAR before':>12}{'after':>9}{'KB':>10}")
    for w, t in table["wards"].items():
        print(f"  {w:<13}{t['built_mean'][0]:>13.4f}{t['built_mean'][1]:>9.4f}"
              f"{t['far'][0]:>12.2f}{t['far'][1]:>9.2f}"
              f"{t['bytes'][0]//1024:>6}->{t['bytes'][1]//1024}")
    print("\n  sim (canonical forcing, flat means — isolates the footprint effect):")
    for line in table["sim_output"]:
        print(f"    {line}")
    print(f"\n  -> {os.path.relpath(OUT, ROOT)}")
    print("  FAR is the only geometry-fed DC-URS input (0.30 of exposure), so the")
    print("  score delta follows from the FAR delta; the exact recomputed score is")
    print("  part of the SHIP checklist, not this gate.")
    print("  STOP. Review this table before anything ships (spec §3e).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Verify the overrides changed nothing by default** — `npm run verify` green.
- [ ] **Step 5: Run the gate** — `python3 scripts/measure-geometry-deltas.py`
Expected: the table, the JSON artefact, and the STOP line. Check `far.json` is byte-identical to shipped (the restore call).
- [ ] **Step 6: Commit** (overrides + both scripts + `data/calibration/geometry-replacement.json`).

---

### Task 6: Guard tests

**Files:**
- Create: `tests/unit/geometry-staging.test.mjs`

- [ ] **Step 1: Write it**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];

test('staged geometry is schema-identical to shipped and richer, never poorer', async () => {
  for (const w of WARDS) {
    const shipped = JSON.parse(await readFile(join(ROOT, `public/heat-map/data/${w}.json`), 'utf8'));
    const staged = JSON.parse(await readFile(join(ROOT, `data/geometry/staging/${w}.json`), 'utf8'));
    assert.deepEqual(Object.keys(staged).sort(), Object.keys(shipped).sort(),
      `${w}: schema drifted — a consumer would break`);
    assert.ok(staged.count > shipped.count,
      `${w}: replacement lost buildings (${staged.count} <= ${shipped.count})`);
    assert.equal(staged.count, staged.b.length);
    for (const row of staged.b) {
      assert.ok(row[0] >= 2.5 && row[0] <= 200, `${w}: implausible height ${row[0]}`);
      assert.ok(row.length >= 7 && row.length % 2 === 1, `${w}: malformed row`);
    }
  }
});

test('the shipped artefacts were not touched by the pipeline', async () => {
  // The whole point of staging: nothing ships until the delta table is reviewed.
  // If this fails, a script wrote where only the ship step may.
  const { execSync } = await import('node:child_process');
  const dirty = execSync('git status --porcelain public/heat-map/data/', { cwd: ROOT })
    .toString().trim().split('\n').filter(l => /ballygunge|barrackpore|baruipur/.test(l))
    .filter(l => !/terrain/.test(l));
  assert.deepEqual(dirty.filter(Boolean), [], `shipped ward JSON modified before review: ${dirty}`);
});

test('the delta table exists and covers every ward', async () => {
  const t = JSON.parse(await readFile(join(ROOT, 'data/calibration/geometry-replacement.json'), 'utf8'));
  for (const w of WARDS) {
    assert.ok(t.wards[w], `${w} missing from the delta table`);
    assert.ok(t.wards[w].built_mean.every(Number.isFinite), `${w}: built means incomplete`);
  }
});
```

- [ ] **Step 2: Run** — green. **Step 3:** full `npm run verify` — green (the new test rides along).
- [ ] **Step 4: Commit.**

---

## THE PLAN ENDS AT THE STOP

Shipping — staging → `public/`, DC-URS regeneration, Compare contract-doc updates, attribution line (`Footprints © Overture Maps Foundation`), `validate-geometry.py` after-photo, `measure-accuracy.py` re-run if the built deltas demand it, the ±0.49 K hard stop — is **deliberately not in this plan.** It happens only after the user reviews `data/calibration/geometry-replacement.json`, and it gets its own checklist at that point, informed by what the table says.

## What could go wrong

| symptom | response |
|---|---|
| Task 0 EE probe → permission error | The known IAM gap. Stop; draft the grant request; nothing proceeds |
| Parity fails on any ward | **Full stop — the discrepancy is the finding.** Do not run Overture mode |
| EE pages time out / quota | PAGE 400 → 200; `tileScale` 4 → 8; resume by ward (heights file written per run) |
| Overpass 429 again | Cache file means rerun never refetches finished wards; 30 s spacing |
| `height-method.json` says underpowered | Mean ships; hypothesis stays open — that IS the designed outcome |
| Overture count tripwire fires | Parquet changed under the manifest; re-download release-pinned and diff |
| far.json left dirty by the gate | The restore call re-runs compute-far on shipped; `git status` must be clean |
| `far.json` per-ward field is not literally `"far"` | Read `data/dc-urs/far.json` once before Task 5 and fix the key in `measure-geometry-deltas.py` — a 10-second check, not a design change |

## Sequencing

Task 0 → 1 → 2(parity STOP-check) → 2(overture) → 3 → 4 → 5 → 6, strictly. One commit per task, verify green on every commit. `accuracy.ts` untouched throughout.
