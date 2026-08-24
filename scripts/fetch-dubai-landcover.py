"""OSM landcover -> water, coast, beaches, greenery, land use and roads.

WHY. The scene had terrain and buildings and nothing else: no Creek, no Gulf, no
beaches, no parks, no roads. Dubai without its water is unrecognisable — the
Creek is the reason the city is where it is, and the coastline is the entire
subject of a flood tool. This is the layer that turns a massing model into a
place.

Everything here is OSM and therefore ODbL. That is the same unresolved
share-alike question the heights and outlines already carry (see
fetch-dubai-heights.py); this widens it rather than introducing it, and each
class records its source so the layers can be dropped individually.

    python3 scripts/fetch-dubai-landcover.py
    python3 scripts/fetch-dubai-landcover.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import OVERPASS, SITES, Site, m_per_deg, site_bounds  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "flood-sim", "data")
CACHE = os.path.join(HERE, "..", "data", ".cache", "osm")
ATTRIBUTION = "Landcover © OpenStreetMap contributors (ODbL 1.0)"

# Road width by class, metres. Carriageway only — Sheikh Zayed Road is wider
# than this in reality but its OSM way is one of several parallel ways.
ROAD_WIDTH = {
    "motorway": 24.0, "trunk": 20.0, "primary": 16.0, "secondary": 12.0,
    "tertiary": 9.0, "residential": 7.0, "unclassified": 6.0,
    "motorway_link": 8.0, "trunk_link": 8.0, "primary_link": 7.0,
}


def query(site: Site) -> str:
    w, s, e, n = site_bounds(site)
    box = f"{s},{w},{n},{e}"
    clauses = [
        f'way["natural"="water"]({box});',
        f'way["waterway"="riverbank"]({box});',
        f'way["landuse"="reservoir"]({box});',
        f'relation["natural"="water"]({box});',
        f'way["natural"="coastline"]({box});',
        f'way["natural"="beach"]({box});',
        f'way["leisure"="park"]({box});',
        f'way["leisure"="golf_course"]({box});',
        f'way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"]({box});',
        f'way["landuse"~"^(commercial|retail|industrial|residential)$"]({box});',
        f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link)$"]({box});',
    ]
    return f"[out:json][timeout:600];({''.join(clauses)});out tags geom;"


def fetch(site: Site) -> list[dict[str, Any]]:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{site.id}-landcover.json")
    if not os.path.exists(path):
        resp = requests.post(
            OVERPASS, data={"data": query(site)}, timeout=900,
            headers={"User-Agent": "delta-climate-flood-sim/0.1 (build-time pipeline)"},
        )
        resp.raise_for_status()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(resp.text)
    with open(path, encoding="utf-8") as fh:
        elements: list[dict[str, Any]] = list(json.load(fh).get("elements", []))
    return elements


def classify(tags: dict[str, str]) -> str | None:
    if tags.get("natural") == "coastline":
        return "coastline"
    if tags.get("natural") == "beach":
        return "beach"
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" \
            or tags.get("landuse") == "reservoir":
        return "water"
    if tags.get("leisure") == "golf_course":
        return "golf"
    if tags.get("leisure") == "park" or tags.get("landuse") in {
            "grass", "forest", "meadow", "recreation_ground", "village_green"}:
        return "green"
    if tags.get("landuse") in {"commercial", "retail", "industrial", "residential"}:
        return f"zone:{tags['landuse']}"
    if tags.get("highway"):
        return "road"
    return None


def build(site: Site) -> dict[str, Any]:
    mx, my = m_per_deg(site.lat)
    layers: dict[str, list[dict[str, Any]]] = {}
    counts: dict[str, int] = {}
    for el in fetch(site):
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        tags = el.get("tags", {})
        kind = classify(tags)
        if kind is None:
            continue
        flat: list[float] = []
        for pt in geom:
            flat.append(round((pt["lon"] - site.lon) * mx, 2))
            flat.append(round((pt["lat"] - site.lat) * my, 2))
        rec: dict[str, Any] = {"p": flat}
        if kind == "road":
            rec["w"] = ROAD_WIDTH.get(tags.get("highway", ""), 6.0)
            rec["cls"] = tags.get("highway")
        if tags.get("name"):
            rec["name"] = tags["name"]
        layers.setdefault(kind, []).append(rec)
        counts[kind] = counts.get(kind, 0) + 1

    return {
        "site": site.id,
        "source": "OpenStreetMap",
        "licence": "ODbL-1.0",
        "attribution": ATTRIBUTION,
        "centre": [site.lon, site.lat],
        "footprintM": site.footprint_m,
        "counts": counts,
        "layers": layers,
    }


def check() -> int:
    failures: list[str] = []
    for sid in SITES:
        path = os.path.join(OUT_DIR, f"{sid}-landcover.json")
        if not os.path.exists(path):
            failures.append(f"{sid}: artefact missing")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        c = d["counts"]
        # Dubai Creek and the Gulf are the reason this layer exists.
        if c.get("water", 0) < 5:
            failures.append(f"{sid}: only {c.get('water', 0)} water polygons -- "
                            f"the Creek and the Gulf are the whole point")
        if c.get("road", 0) < 500:
            failures.append(f"{sid}: {c.get('road', 0)} roads -- Sheikh Zayed Road is missing")
        if "ODbL" not in d["licence"]:
            failures.append(f"{sid}: OSM data without ODbL recorded")
        for kind, recs in d["layers"].items():
            if any(len(r["p"]) < 4 for r in recs):
                failures.append(f"{sid}: a degenerate {kind} geometry")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-landcover.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        pretty = ", ".join(f"{k} {v:,}" for k, v in sorted(d["counts"].items(), key=lambda kv: -kv[1]))
        print(f"  OK {sid}: {pretty}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for sid, site in SITES.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-landcover.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
