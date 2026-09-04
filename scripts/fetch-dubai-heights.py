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
from _flood import (OVERPASS, SITES, Site, m_per_deg, query_key,  # noqa: E402
                    ring_area, site_bounds, window_key)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "flood-sim", "data")
CACHE = os.path.join(HERE, "..", "data", ".cache", "osm")
# STOREY HEIGHT WAS AN INDIAN CONSTANT AND IT UNDER-PREDICTED EVERY BUILDING.
#
# 3.2 m came from the National Building Code of India via scripts/compute-far.py,
# where it is honestly labelled an assumption for Kolkata. It was carried into
# Dubai unchanged. It is not an OSM convention either — the OSM wiki says 3 m.
#
# Measured against the 938 Dubai buildings that carry height and building:levels
# INDEPENDENTLY (see below):
#
#     rule                      bias      MAE     median rel err
#     3.2 x n  (this constant) -20.51 m  21.63 m      22.0 %
#     3.0 x n  (OSM wiki)      -25.21 m  26.10 m      26.8 %
#     4.0 x n                   -1.71 m   9.55 m       7.7 %
#     2.09 + 3.98 x n           -0.09 m   9.14 m       7.0 %
#
# TWO THIRDS OF THE DUAL-TAGGED SAMPLE IS CIRCULAR and had to be excluded: 38.7 %
# of Dubai buildings tagged with both have height EXACTLY levels x 4.0, 14.1 %
# x 5.0, 7.9 % x 3.0. Those are mapper assumptions, not measurements. Fitting on
# them produces a constant that agrees with itself — a first pass here reported
# MAE 4.49 m by doing exactly that. The numbers above use only the 938 that are
# genuinely independent.
#
# CORROBORATED INDEPENDENTLY. Dubai South's own Residential District Planning
# Regulations give max height and max floors per sub-zone; dividing them across
# zones Ha-He gives a mean of 3.99 m/floor against our regression's 3.98. Both
# documents define height the same way — finished sidewalk to top of roof
# parapet — which is also OSM `height` semantics.
#
# So there are TWO different numbers and mixing them biases everything:
#   · floor-to-floor, structural            ~3.8 m
#   · effective m/storey to reach roof top  ~4.0 m  (absorbs the taller ground
#     floor and the 0.9-1.1 m parapet)
# We render roofs, so we want the second.
#
# EXPECTED ERROR: about +/-9 m per building, and NO GULF VALIDATION STUDY EXISTS.
# The only lidar-validated figure anywhere is Biljecki et al. 2017 (Rotterdam,
# 1.6 m) which is European mid-rise and does not transfer. Above the constant,
# error is dominated by the tag itself: Biljecki, Chow & Lee 2023 audited
# building:levels globally against Street View and found 72.2 % exactly correct,
# 93.3 % within one level — and one level here is ~4 m.
METRES_PER_LEVEL = 4.0      # Dubai-measured; see above. NOT the OSM 3 m default.

# Per-use metres-per-storey. Values are our own Dubai regression on non-circular
# pairs unless noted; classes with too few independent samples inherit the
# default rather than inventing a number.
METRES_PER_LEVEL_BY_USE: dict[str, float] = {
    "apartments": 3.9,      # our fit 3.85; Dubai South zones Ha-He mean 3.99
    "residential": 3.9,
    "hotel": 4.4,           # our fit 4.41; Dubai South hotel zone G+7 / 36 m = 4.50
    "office": 4.3,          # our fit 4.29
    "commercial": 4.1,      # our fit 4.14
    "retail": 5.0,          # podium: Trakhees commercial centres clear 4.2-6.0 m
    "parking": 3.0,         # Trakhees covered parking clear 2.4-3.0 m
}

# LEVELS x ANYTHING IS THE WRONG MODEL FOR A SHED. One "storey" IS the building,
# so a multiplier cannot express it. Verified figures: JAFZA's own brochure says
# "Warehouses eaves height varies from 6m to 12m"; a Dubai South Grade-A facility
# is quoted at "usable eaves height of 16 metres"; Dubai South's MBR Aerospace
# Hub guidelines cap light-industrial warehouses at "G+1 / 8m". Our Dubai South
# median building is 16.8 m — a flat 3.2 rendered that as a 3.2 m shed.
WAREHOUSE_PRIOR_M: dict[str, float] = {
    "warehouse": 10.0,
    "industrial": 8.0,
    "hangar": 14.0,
    "shed": 6.0,
}

# WHAT EACH SITE IS EXPECTED TO CONTAIN. These were global assertions — "no
# building over 200 m, Dubai without a skyline is wrong" and "no part over 700 m,
# Burj Khalifa's tip is missing" — which are true of the Creek and false of Dubai
# South, where the median building is 16.8 m and there are no towers at all.
#
# A check that encodes one site's truth and fires on another is not a guard, it
# is a hardcoded assumption. Same defect as heightsPresent meaning two different
# things to two scripts. Sites declare what they should contain; the check reads
# the declaration instead of assuming Downtown.
SITE_EXPECT: dict[str, dict[str, float]] = {
    "dubai-creek": {"tallestM": 200.0, "tallestPartM": 700.0, "minOsmOutlines": 5000,
                    "minSuperseded": 1000, "minPartsCovered": 50},
    # Dubai South: DWC, Expo City, logistics. Measured 43,479 footprints, median
    # height 16.8 m, 7.8 % over 30 m, nothing over 133 m in 3D-GloBFP. Asking it
    # for a 200 m tower would be asking it to be somewhere else.
    "dubai-south": {"tallestM": 0.0, "tallestPartM": 0.0, "minOsmOutlines": 3000,
                    "minSuperseded": 0, "minPartsCovered": 0},
}
ATTRIBUTION = "Building heights © OpenStreetMap contributors (ODbL 1.0)"


def fetch_osm(site: Site) -> list[dict[str, Any]]:
    w, s, e, n = site_bounds(site)
    os.makedirs(CACHE, exist_ok=True)
    query = (
        f"[out:json][timeout:180];("
        f'way["building"]["height"]({s},{w},{n},{e});'
        f'way["building"]["building:levels"]({s},{w},{n},{e});'
        f'relation["building"]["height"]({s},{w},{n},{e}););'
        f"out tags center;"
    )
    # KEYED BY THE QUESTION AS WELL AS THE PLACE. Keying on the window alone meant
    # a widened query re-served the old, narrower response from disk: the new
    # clause returned nothing and nothing errored.
    path = os.path.join(CACHE, f"{site.id}-{window_key(site)}-{query_key(query)}-heights.json")
    if not os.path.exists(path):
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
    query = (
        f"[out:json][timeout:600];("
        f'way["building"]({s_},{w},{n},{e});'
        f'relation["building"]({s_},{w},{n},{e}););'
        f"out tags geom;"
    )
    path = os.path.join(CACHE,
                        f"{site.id}-{window_key(site)}-{query_key(query)}-osm-buildings.json")
    if not os.path.exists(path):
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
    query = (
        f"[out:json][timeout:300];("
        f'way["building:part"]({s_},{w},{n},{e});'
        f'relation["building:part"]({s_},{w},{n},{e}););'
        f"out tags geom;"
    )
    path = os.path.join(CACHE, f"{site.id}-{window_key(site)}-{query_key(query)}-parts.json")
    if not os.path.exists(path):
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
    use = str(tags.get("building", "yes")).lower()

    # Sheds first: their height comes from a prior, not from a storey count,
    # because a warehouse's single storey is the whole building.
    if use in WAREHOUSE_PRIOR_M:
        return WAREHOUSE_PRIOR_M[use]

    levels = tags.get("building:levels")
    if levels:
        try:
            n = float(levels)
        except ValueError:
            return None
        return n * METRES_PER_LEVEL_BY_USE.get(use, METRES_PER_LEVEL)
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
    # THE ARTEFACT MUST NOT SURVIVE ITS OWN REBUILD CLAIMING HEIGHTS IT NO LONGER
    # HAS. Rebuilding drops every per-record `hs` mark below, which discards the
    # whole Wikidata/CTBUH layer -- correctly, since it is applied afterwards by
    # fetch-dubai-wikidata.py. But the `wikidata` and `ctbuh` METADATA blocks used
    # to survive, so the file went on saying "32 CC0 heights attached" while
    # carrying none, and Burj Khalifa quietly returned to 652 m.
    #
    # Dropping them makes the loss visible: fetch-dubai-wikidata.py --check then
    # reports "no wikidata block yet" instead of passing over an empty claim.
    for stale in ("osmB", "parts", "partsCovered", "supersededByOsm",
                  "heightSources", "osmNote", "partsNote", "wikidata", "ctbuh"):
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
        # THE ARTEFACT HAD NO STABLE HANDLE ON A BUILDING. Records carried only
        # {p, roof, name}, so anything wanting to say "this footprint is the Burj
        # Al Arab" had to match on coordinates -- which, on long concave plans and
        # against approximate landmark points, silently picks the neighbour. It
        # put a 328 m height on a metro station during the investigation that led
        # here. `w12700546` is unambiguous and survives a re-fetch.
        rec: dict[str, Any] = {"id": f"{el['type'][0]}{el['id']}",
                               "p": flat, "roof": tags.get("roof:shape", "flat")}
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
        exp = SITE_EXPECT.get(sid, SITE_EXPECT["dubai-creek"])
        if exp["tallestM"] > 0 and not [b for b in real if b["h"] > exp["tallestM"]]:
            failures.append(f"{sid}: no building over {exp['tallestM']:.0f} m, and this site "
                            f"is declared to have one")
        osm_b = d.get("osmB", [])
        if len(osm_b) < exp["minOsmOutlines"]:
            failures.append(f"{sid}: only {len(osm_b)} OSM outlines, expected "
                            f"{exp['minOsmOutlines']:.0f}+ -- the fetch is short")
        if d.get("supersededByOsm", 0) < exp["minSuperseded"]:
            failures.append(f"{sid}: {d.get('supersededByOsm', 0)} superseded -- "
                            f"duplicates will render inside each other")
        parts = d.get("parts", [])
        if len(parts) < 200:
            failures.append(f"{sid}: only {len(parts)} massing parts -- the 3D fetch is failing")
        if d.get("osmPartsCovered", 0) < exp["minPartsCovered"]:
            failures.append(f"{sid}: only {d.get('osmPartsCovered', 0)} OSM outlines marked as "
                            f"part-covered -- towers will get a stub through them")
        if exp["tallestPartM"] > 0 and not any(p["h"] > exp["tallestPartM"] for p in parts):
            failures.append(f"{sid}: no part over {exp['tallestPartM']:.0f} m, and this site "
                            f"is declared to have one")
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
    parser.add_argument("--site", default=None,
                        help="build one site only (default: all)")
    args = parser.parse_args()
    if args.check:
        return check()
    wanted = {k: v for k, v in SITES.items() if args.site in (None, k)}
    if not wanted:
        raise SystemExit(f"unknown site {args.site!r}; have {list(SITES)}")
    for sid, site in wanted.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-buildings.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
