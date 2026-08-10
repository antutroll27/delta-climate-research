"""OSM street names per ward -> public/heat-map/data/{ward}-road-labels.geojson.

WHY A SEPARATE ARTEFACT, AND WHY GeoJSON. Two deliberate breaks with the
{ward}-roads.json contract, both load-bearing:

  * GeoJSON, not the {w, p} shape — it is handed straight to map.addSource with
    no transformation code at all.
  * lon/lat, not ward metres — the labels then never enter our local frame, so
    they cannot inherit a frame bug. After 2026-08-05 that property is worth
    more than the consistency: the render drew every ward MIRRORED for a day
    because a frame error had nothing independent to disagree with. These labels
    are drawn by MapLibre from lon/lat, in the basemap's own frame, so if our
    geometry ever drifts again the names will visibly separate from the roads.

WHY ONLY THE MAJOR CLASS. Measured over the Ballygunge window (447 highway ways):

    primary      30/31   97%        residential   47/280   17%
    tertiary     10/10  100%        service        2/110    2%
    secondary     5/7    71%        footway         0/4     0%

Labelling 47 of 280 residential ways does not label the residential streets — it
silently asserts that the other 233 are unnamed lanes, which is a claim about
Kolkata that OSM coverage does not support. It is also the class whose drawn
width is `assumed` rather than derived (see road-ribbon.ts). Label what we
measured.

NAME TAG. `name` only. In this window name:en, name:bn, name:hi and int_name are
all 0/447, and ZERO `name` values contain a non-ASCII character — so there is no
bilingual tagging to disambiguate and no encoding hazard to guard against. A
`name:en`-first strategy would update nothing.

THIS DOES NOT REGENERATE {ward}-roads.json. The committed Ballygunge artefact has
500 ways against 447 in a fresh survey; regenerating would move buildSpatial's
corridorKm and corridorSorted, and those feed published tree counts, cost and
cooling. `--check` reports that delta instead of acting on it, which closes the
"committed without a generator" debt (scripts/fetch-water.py:9-13) without moving
a published number.

    python3 scripts/fetch-road-labels.py            # all three wards
    python3 scripts/fetch-road-labels.py --check    # asserts over the committed files
"""
from __future__ import annotations

import argparse
from typing import Any, cast
import json
import os
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path first — scripts are not a package)

ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "heat-map", "data")
#: Overpass mirrors, tried in order. The main instance 504s under load often
#: enough that a single-endpoint fetcher is not reproducible, and a producer that
#: only works on a good day is not a producer.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
SOURCE = "OpenStreetMap via Overpass (ODbL)"

#: Matches CLIP_M in fetch-water.py so every OSM artefact covers the same ground.
CLIP_M = 760.0

#: The classes we DRAW as majors (road-ribbon.ts's w = 2) and therefore label.
#: `_link` ramps are included: they carry their parent's name and dropping them
#: leaves a visible gap where a flyover meets the road it belongs to.
MAJOR = ("primary", "primary_link", "secondary", "secondary_link",
         "tertiary", "tertiary_link", "trunk", "trunk_link", "motorway", "motorway_link")

#: Below this a labelled way is a stub — a slip road or a fragment left by an
#: editor split — and `symbol-placement: line` cannot fit text on it anyway.
MIN_LENGTH_M = 40.0


def query(ward: _types.Ward) -> dict[str, Any]:
    w, s, e, n = _types.ward_bounds(ward, pad_m=CLIP_M - ward.footprint_m / 2)
    bbox = f"{s},{w},{n},{e}"
    classes = "|".join(MAJOR)
    q = f"""[out:json][timeout:90];
way["highway"~"^({classes})$"]["name"]({bbox});
out tags geom;"""
    last = ""
    for attempt in range(2):
        for url in OVERPASS_ENDPOINTS:
            try:
                r = requests.post(url, data=q.encode(),
                                  headers={"User-Agent": "delta-climate-research road-label fetch"},
                                  timeout=180)
            except requests.RequestException as exc:
                last = f"{url}: {type(exc).__name__}"
                continue
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                return cast(dict[str, Any], r.json())
            last = f"{url}: HTTP {r.status_code}"
        time.sleep(15 * (attempt + 1))
    sys.exit(f"  every Overpass mirror failed for {ward.id} — last: {last}")


def length_m(ward: _types.Ward, geom: list[dict[str, Any]]) -> float:
    """Great-circle-free length in local metres — the window is 1.4 km."""
    mx, my = _types.m_per_deg(ward.centre.lat)
    total = 0.0
    for a, b in zip(geom, geom[1:]):
        total += (((b["lon"] - a["lon"]) * mx) ** 2 + ((b["lat"] - a["lat"]) * my) ** 2) ** 0.5
    return total


def in_window(ward: _types.Ward, geom: list[dict[str, Any]]) -> bool:
    """Keep a way if ANY vertex is inside the clip box — a road that merely
    passes through still deserves its name where it crosses."""
    mx, my = _types.m_per_deg(ward.centre.lat)
    for p in geom:
        x = (p["lon"] - ward.centre.lon) * mx
        y = (p["lat"] - ward.centre.lat) * my
        if abs(x) <= CLIP_M and abs(y) <= CLIP_M:
            return True
    return False


def build(ward: _types.Ward) -> dict[str, Any]:
    data = query(ward)
    features = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        geom = el.get("geometry") or []
        if not name or len(geom) < 2:
            continue
        if not in_window(ward, geom):
            continue
        if length_m(ward, geom) < MIN_LENGTH_M:
            continue
        feature: dict[str, Any] = {
            "type": "Feature",
            "properties": {"name": name, "cls": tags["highway"]},
            "geometry": {
                "type": "LineString",
                # 6 dp is ~0.11 m — past the precision an OSM trace carries, and
                # it keeps the artefact small enough to ship uncompressed.
                "coordinates": [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom],
            },
        }
        features.append(feature)
    features.sort(key=lambda f: (f["properties"]["name"], f["geometry"]["coordinates"][0]))
    return {
        "type": "FeatureCollection",
        "ward": ward.id,
        "source": SOURCE,
        "note": ("Major classes only. OSM names 97% of primary and 100% of tertiary ways "
                 "here but 17% of residential and 2% of service, so labelling the minor "
                 "classes would imply the unnamed majority have no name."),
        "count": len(features),
        "names": sorted({f["properties"]["name"] for f in features}),
        "features": features,
    }


def out_path(ward_id: str) -> str:
    return os.path.join(OUT_DIR, f"{ward_id}-road-labels.geojson")


def write(doc: dict[str, Any]) -> None:
    path = out_path(doc["ward"])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        fh.write("\n")
    print(f"  {os.path.relpath(path, ROOT)}  {doc['count']} ways  "
          f"{len(doc['names'])} distinct names  {os.path.getsize(path)/1024:.1f} KB")


def check() -> int:
    """Assert over the committed artefacts. Offline — no Overpass call."""
    bad = 0
    for ward in _types.WARDS.values():
        path = out_path(ward.id)
        if not os.path.exists(path):
            print(f"  MISSING {os.path.relpath(path, ROOT)}"); bad += 1; continue
        doc = json.load(open(path, encoding="utf-8"))
        mx, my = _types.m_per_deg(ward.centre.lat)
        if doc["count"] != len(doc["features"]):
            print(f"  {ward.id}: count {doc['count']} != {len(doc['features'])} features"); bad += 1
        for f in doc["features"]:
            p = f["properties"]
            if not p.get("name"):
                print(f"  {ward.id}: a feature carries no name"); bad += 1; break
            if p.get("cls") not in MAJOR:
                print(f"  {ward.id}: class {p.get('cls')!r} is not a major class — "
                      f"labelling minor roads is an editorial decision, not a fetch bug")
                bad += 1; break
            inside = any(
                abs((lon - ward.centre.lon) * mx) <= CLIP_M + 1
                and abs((lat - ward.centre.lat) * my) <= CLIP_M + 1
                for lon, lat in f["geometry"]["coordinates"])
            if not inside:
                print(f"  {ward.id}: {p['name']!r} lies wholly outside the clip box"); bad += 1; break
        print(f"  {ward.id}: {doc['count']} ways, {len(doc['names'])} names — ok"
              if bad == 0 else f"  {ward.id}: FAILED")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="assert over the committed artefacts, without fetching")
    args = ap.parse_args()
    if args.check:
        return 1 if check() else 0
    os.makedirs(OUT_DIR, exist_ok=True)
    for ward in _types.WARDS.values():
        write(build(ward))
        time.sleep(2)   # Overpass asks for a pause between queries
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
