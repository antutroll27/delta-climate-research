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


def fetch_osm_buildings(site: Site) -> list[dict[str, Any]]:
    """OSM building outlines WITH geometry, cached.

    Why not just heights any more: joining an OSM height onto a GlobalML
    footprint keeps GlobalML's SHAPE, and for anything complex that shape is
    wrong. Burj Khalifa measured 743 m2 in GlobalML against 7,572 m2 in OSM —
    the detector found roughly a tenth of the building. Taking OSM's outline as
    well fixes height and shape together, and GlobalML stays as the systematic
    base layer for the ~24,000 ordinary buildings OSM has not drawn.
    """
    w, s_, e, n = site_bounds(site)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{site.id}-osm-buildings.json")
    if not os.path.exists(path):
        query = (
            f"[out:json][timeout:600];("
            f'way["building"]({s_},{w},{n},{e});'
            f'relation["building"]({s_},{w},{n},{e}););'
            f"out tags geom;"
        )
        resp = requests.post(
            OVERPASS, data={"data": query}, timeout=900,
            headers={"User-Agent": "delta-climate-flood-sim/0.1 (build-time pipeline)"},
        )
        resp.raise_for_status()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(resp.text)
    with open(path, encoding="utf-8") as fh:
        elements: list[dict[str, Any]] = list(json.load(fh).get("elements", []))
    return elements


def point_in_ring(x: float, y: float, ring: list[float]) -> bool:
    """Even-odd test on a flat [x,y,...] ring."""
    inside = False
    n = len(ring) // 2
    j = n - 1
    for i in range(n):
        xi, yi = ring[i * 2], ring[i * 2 + 1]
        xj, yj = ring[j * 2], ring[j * 2 + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


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

    # IDEMPOTENCY. This script reads the artefact it writes, so a second run was
    # seeing its own previous marks and counting zero new coverage — the numbers
    # changed depending on how many times it had been run, which is the worst
    # kind of wrong because the first run looks right. Strip every derived field
    # before recomputing.
    for stale in ("osmB", "parts", "partsCovered", "supersededByOsm",
                  "heightSources", "osmNote", "partsNote"):
        doc.pop(stale, None)
    for b in doc["b"]:
        for stale in ("h", "hs", "name", "parts", "sup"):
            b.pop(stale, None)

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
    # ── OSM outlines: better geometry where it exists ────────────────────────
    osm_b: list[dict[str, Any]] = []
    for el in fetch_osm_buildings(site):
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        tags = el.get("tags", {})
        flat: list[float] = []
        for pt in geom:
            flat.append(round((pt["lon"] - site.lon) * mx, 2))
            flat.append(round((pt["lat"] - site.lat) * my, 2))
        rec: dict[str, Any] = {"p": flat, "roof": tags.get("roof:shape", "flat")}
        top = osm_height(tags)
        if top and top > 0:
            rec["h"] = round(top, 1)
        if tags.get("name"):
            rec["name"] = tags["name"]
        osm_b.append(rec)
    doc["osmB"] = osm_b

    # GlobalML footprints whose centroid sits inside an OSM outline are the SAME
    # building drawn twice. Drop ours, keep theirs — otherwise every landmark
    # gets a crude duplicate wedged inside the good geometry.
    osm_index: dict[tuple[int, int], list[int]] = {}
    for i, rec in enumerate(osm_b):
        xs, ys = rec["p"][0::2], rec["p"][1::2]
        for gx in range(int(min(xs) // CELL), int(max(xs) // CELL) + 1):
            for gy in range(int(min(ys) // CELL), int(max(ys) // CELL) + 1):
                osm_index.setdefault((gx, gy), []).append(i)
    superseded = 0
    for b in doc["b"]:
        xs, ys = b["p"][0::2], b["p"][1::2]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        for cand in osm_index.get((int(cx // CELL), int(cy // CELL)), ()):
            if point_in_ring(cx, cy, osm_b[cand]["p"]):
                b["sup"] = True
                superseded += 1
                break
    doc["supersededByOsm"] = superseded

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
        slab: list[float] = []
        for pt in geom:
            slab.append(round((pt["lon"] - site.lon) * mx, 2))
            slab.append(round((pt["lat"] - site.lat) * my, 2))
        parts.append({
            "p": slab, "h": round(top, 1), "min": round(low, 1),
            "roof": tags.get("roof:shape", "flat"),
        })
    doc["parts"] = parts

    # A footprint covered by parts must NOT also be extruded flat, or the tower
    # gets a stub through it. Mark by centroid containment.
    # Anything a part sits on must not ALSO be drawn as a plain extrusion —
    # neither the GlobalML footprint nor the OSM outline — or a stub runs
    # through the tower. Mark both layers.
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
        for cand in osm_index.get((int(cx // CELL), int(cy // CELL)), ()):
            if point_in_ring(cx, cy, osm_b[cand]["p"]):
                osm_b[cand]["parts"] = True
                break
    doc["partsCovered"] = covered
    doc["osmPartsCovered"] = sum(1 for r in osm_b if r.get("parts"))

    real = sum(1 for b in doc["b"] if b.get("hs") == "osm")
    doc["heightsPresent"] = True
    doc["heightSources"] = {"osm": real, "prior": len(doc["b"]) - real}
    doc["heightAttribution"] = ATTRIBUTION
    doc["heightLicence"] = "ODbL-1.0 (heights only; footprints remain CDLA-Permissive-2.0)"
    doc["osmNote"] = (
        f"{len(osm_b):,} OSM outlines carry better geometry than the ML-derived "
        f"footprints for the same buildings; {superseded:,} GlobalML footprints are "
        f"marked superseded and must not be drawn. GlobalML remains the systematic "
        f"base for everything OSM has not mapped."
    )
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
        osm_b = d.get("osmB", [])
        if len(osm_b) < 5000:
            failures.append(f"{sid}: only {len(osm_b)} OSM outlines -- the fetch is short")
        if d.get("supersededByOsm", 0) < 1000:
            failures.append(f"{sid}: {d.get('supersededByOsm', 0)} superseded -- "
                            f"duplicates will render inside each other")
        parts = d.get("parts", [])
        if len(parts) < 200:
            failures.append(f"{sid}: only {len(parts)} massing parts -- the 3D fetch is failing")
        if d.get("osmPartsCovered", 0) < 50:
            failures.append(f"{sid}: only {d.get('osmPartsCovered', 0)} OSM outlines marked as "
                            f"part-covered -- towers will get a stub through them")
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
        ob = d.get("osmB", [])
        roofs: dict[str, int] = {}
        for r in ob:
            roofs[r.get("roof", "flat")] = roofs.get(r.get("roof", "flat"), 0) + 1
        print(f"     OSM outlines: {len(ob):,} ({sum(1 for r in ob if r.get('h')):,} with height, "
              f"{d.get('supersededByOsm', 0):,} GlobalML superseded)")
        print(f"     roof shapes: {dict(sorted(roofs.items(), key=lambda kv: -kv[1])[:5])}")
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
