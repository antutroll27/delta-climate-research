"""OSM heights AND 3D massing -> attached to the GlobalML footprint artefact.

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

BUILDING PARTS ARE THE REAL FIND. A footprint plus one height can only ever
extrude to a prism, and for a tower that is wrong in a way no amount of shading
hides: GlobalML's Burj Khalifa footprint is 743 m2 against a true ~7,575 m2
Y-plan, so it rendered as a 27 m needle 522 m tall.

OSM's Simple 3D Buildings schema fixes both halves. `building:part` elements
carry their own outline, `height` and `min_height`, so a tower is described as a
stack of slabs — and stacking them reproduces the SETBACKS. Burj Khalifa has 41
parts stepping 105 -> 130 -> 160 -> 200 -> 235 -> 270 -> 315 -> 360 -> 405 ->
460 m with the cross-section shrinking as it rises. Measured across this window:
809 parts, 761 with usable heights, max 828 m (the true tip), 140 over 200 m,
174 carrying min_height, and real roof shapes (flat, skillion, dome, pyramidal).

That is LOD2-ish massing for the landmarks, for free, under the licence already
in play for heights.

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


def fetch_parts(site: Site) -> list[dict[str, Any]]:
    """OSM `building:part` elements with full geometry, cached."""
    w, s_, e, n = site_bounds(site)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{site.id}-parts.json")
    if not os.path.exists(path):
        query = (
            f"[out:json][timeout:300];("
            f'way["building:part"]({s_},{w},{n},{e});'
            f'relation["building:part"]({s_},{w},{n},{e}););'
            f"out tags geom;"
        )
        resp = requests.post(
            OVERPASS, data={"data": query}, timeout=420,
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
    # ── 3D massing parts ─────────────────────────────────────────────────────
    parts: list[dict[str, Any]] = []
    for el in fetch_parts(site):
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        tags = el.get("tags", {})
        top = osm_height(tags)
        if top is None or top <= 0:
            continue
        try:
            low = float(str(tags.get("min_height", "0")).replace("m", "").strip())
        except ValueError:
            low = 0.0
        if top <= low:
            continue
        flat: list[float] = []
        for pt in geom:
            flat.append(round((pt["lon"] - site.lon) * mx, 2))
            flat.append(round((pt["lat"] - site.lat) * my, 2))
        parts.append({
            "p": flat, "h": round(top, 1), "min": round(low, 1),
            "roof": tags.get("roof:shape", "flat"),
        })
    doc["parts"] = parts

    # A footprint covered by parts must NOT also be extruded flat, or the tower
    # gets a stub through it. Mark by centroid containment.
    covered = 0
    for pt in parts:
        px, py = pt["p"][0::2], pt["p"][1::2]
        cx, cy = sum(px) / len(px), sum(py) / len(py)
        for cand in buckets.get((int(cx // CELL), int(cy // CELL)), ()):
            bx0, by0, bx1, by1 = boxes[cand]
            if bx0 <= cx <= bx1 and by0 <= cy <= by1:
                if not doc["b"][cand].get("parts"):
                    doc["b"][cand]["parts"] = True
                    covered += 1
                break
    doc["partsCovered"] = covered

    real = sum(1 for b in doc["b"] if b.get("hs") == "osm")
    doc["heightsPresent"] = True
    doc["heightSources"] = {"osm": real, "prior": len(doc["b"]) - real}
    doc["heightAttribution"] = ATTRIBUTION
    doc["heightLicence"] = "ODbL-1.0 (heights only; footprints remain CDLA-Permissive-2.0)"
    doc["partsNote"] = (
        f"{len(parts):,} OSM building:part slabs give real 3D massing — setbacks, "
        f"overhangs and roof shapes — for {covered:,} footprints. Those footprints "
        f"are drawn from their parts instead of extruded flat, which is what makes "
        f"a tower look like a tower rather than a prism."
    )
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
        parts = d.get("parts", [])
        if len(parts) < 200:
            failures.append(f"{sid}: only {len(parts)} massing parts -- the 3D fetch is failing")
        if not any(p["h"] > 700 for p in parts):
            failures.append(f"{sid}: no part over 700 m -- Burj Khalifa's tip is missing")
        if any(p["h"] <= p["min"] for p in parts):
            failures.append(f"{sid}: a part with top at or below its base")
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
        parts = d.get("parts", [])
        print(f"  OK {sid}: {src['osm']:,} measured / {src['prior']:,} prior | "
              f"tallest {tallest['h']:.0f} m ({tallest.get('name', 'unnamed')})")
        print(f"     3D massing: {len(parts):,} parts over {d.get('partsCovered', 0):,} "
              f"footprints | tallest part {max(p['h'] for p in parts):.0f} m")
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
