"""OSM building heights -> attached to the GlobalML footprint artefact.

WHY THIS EXISTS. There are no open per-building heights for Dubai. Microsoft
GlobalML ships a `height` field that is -1.0 on all 241,667 UAE footprints
(measured), and Google Open Buildings 2.5D excludes every GCC state. Without
this step every building is a guess from footprint area, and a guess cannot
produce Burj Khalifa: an area prior puts it around 25 m.

WHAT IT DOES. Pulls OSM ways carrying `height` or `building:levels` in the site
window, then matches each to the nearest GlobalML footprint whose bounding box
contains the OSM centroid. Matched buildings get a MEASURED height; the rest keep
the area prior. Both are labelled in the artefact so the renderer can badge them
differently and the provenance card can say how many of each.

LICENCE — UNRESOLVED, AND DELIBERATELY VISIBLE. OSM is ODbL (share-alike);
GlobalML is CDLA-Permissive. Attaching the former to the latter raises a
derived-database question this project has not decided. Fine for look
development. Needs an answer before anything ships, and `heightSource` per
building is what makes separating them again possible.

    python3 scripts/fetch-dubai-heights.py
    python3 scripts/fetch-dubai-heights.py --check
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import OVERPASS, SITES, Site, m_per_deg, site_bounds  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "flood-sim", "data")
CACHE = os.path.join(HERE, "..", "data", ".cache", "osm")
METRES_PER_LEVEL = 3.2      # OSM convention where only building:levels is tagged
ATTRIBUTION = "Building heights © OpenStreetMap contributors (ODbL 1.0)"


def fetch_osm(site: Site) -> list[dict[str, Any]]:
    w, s, e, n = site_bounds(site)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{site.id}-heights.json")
    if not os.path.exists(path):
        query = (
            f"[out:json][timeout:180];("
            f'way["building"]["height"]({s},{w},{n},{e});'
            f'way["building"]["building:levels"]({s},{w},{n},{e});'
            f'relation["building"]["height"]({s},{w},{n},{e}););'
            f"out tags center;"
        )
        # Overpass returns 406 to requests with no User-Agent. Identify the
        # tool, as their usage policy asks.
        resp = requests.post(
            OVERPASS, data={"data": query}, timeout=300,
            headers={"User-Agent": "delta-climate-flood-sim/0.1 (build-time pipeline)"},
        )
        resp.raise_for_status()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(resp.text)
    with open(path, encoding="utf-8") as fh:
        elements: list[dict[str, Any]] = list(json.load(fh).get("elements", []))
    return elements


def osm_height(tags: dict[str, str]) -> float | None:
    raw = tags.get("height")
    if raw:
        try:
            return float(str(raw).replace("m", "").strip())
        except ValueError:
            pass
    levels = tags.get("building:levels")
    if levels:
        try:
            return float(levels) * METRES_PER_LEVEL
        except ValueError:
            pass
    return None


def build(site: Site) -> dict[str, Any]:
    path = os.path.join(OUT_DIR, f"{site.id}-buildings.json")
    with open(path, encoding="utf-8") as fh:
        doc: dict[str, Any] = json.load(fh)
    mx, my = m_per_deg(site.lat)

    # Bucket footprints by a coarse grid so the join is not 2,680 x 26,206.
    CELL = 200.0
    buckets: dict[tuple[int, int], list[int]] = {}
    boxes: list[tuple[float, float, float, float]] = []
    for i, b in enumerate(doc["b"]):
        p = b["p"]
        xs = p[0::2]
        ys = p[1::2]
        box = (min(xs), min(ys), max(xs), max(ys))
        boxes.append(box)
        for gx in range(int(box[0] // CELL), int(box[2] // CELL) + 1):
            for gy in range(int(box[1] // CELL), int(box[3] // CELL) + 1):
                buckets.setdefault((gx, gy), []).append(i)

    heights: list[float | None] = [None] * len(doc["b"])
    names: list[str | None] = [None] * len(doc["b"])
    matched = unmatched = 0
    for el in fetch_osm(site):
        centre = el.get("center") or {}
        h = osm_height(el.get("tags", {}))
        if h is None or "lat" not in centre or h <= 0:
            continue
        x = (centre["lon"] - site.lon) * mx
        y = (centre["lat"] - site.lat) * my
        best = -1
        for cand in buckets.get((int(x // CELL), int(y // CELL)), ()):
            bx0, by0, bx1, by1 = boxes[cand]
            if bx0 <= x <= bx1 and by0 <= y <= by1:
                best = cand
                break
        if best < 0:
            unmatched += 1
            continue
        # keep the taller when two OSM records land on one footprint
        if heights[best] is None or h > (heights[best] or 0):
            heights[best] = round(h, 1)
            names[best] = el.get("tags", {}).get("name")
        matched += 1

    for i, b in enumerate(doc["b"]):
        if heights[i] is not None:
            b["h"] = heights[i]
            b["hs"] = "osm"
            if names[i]:
                b["name"] = names[i]
        else:
            b["hs"] = "prior"
    real = sum(1 for b in doc["b"] if b.get("hs") == "osm")
    doc["heightsPresent"] = True
    doc["heightSources"] = {"osm": real, "prior": len(doc["b"]) - real}
    doc["heightAttribution"] = ATTRIBUTION
    doc["heightLicence"] = "ODbL-1.0 (heights only; footprints remain CDLA-Permissive-2.0)"
    doc["heightsNote"] = (
        f"{real:,} of {len(doc['b']):,} buildings carry a MEASURED height from OSM "
        f"(height tag, or building:levels x {METRES_PER_LEVEL} m). The rest use a "
        f"footprint-area prior, which is fine for villas and useless for towers. "
        f"{unmatched:,} OSM records found no containing footprint."
    )
    return doc


def check() -> int:
    failures: list[str] = []
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        if not d.get("heightsPresent"):
            failures.append(f"{sid}: heights not attached")
            continue
        real = [b for b in d["b"] if b.get("hs") == "osm"]
        if len(real) < 500:
            failures.append(f"{sid}: only {len(real)} measured heights -- the join is failing")
        tall = [b for b in real if b["h"] > 200]
        if not tall:
            failures.append(f"{sid}: no building over 200 m -- Dubai without a skyline is wrong")
        if any(b["h"] > 1000 for b in real):
            failures.append(f"{sid}: a height over 1 km -- units are probably not metres")
        if "ODbL" not in d.get("heightLicence", ""):
            failures.append(f"{sid}: OSM heights present but ODbL not recorded")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        src = d["heightSources"]
        tallest = max((b for b in d["b"] if b.get("hs") == "osm"), key=lambda b: b["h"])
        print(f"  OK {sid}: {src['osm']:,} measured / {src['prior']:,} prior | "
              f"tallest {tallest['h']:.0f} m ({tallest.get('name', 'unnamed')})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    for sid, site in SITES.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-buildings.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
