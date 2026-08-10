"""OSM water polygons per ward -> public/heat-map/data/{ward}-water.json.

WHY OSM AND NOT THE JAL SHAKTI CENSUS. The census (data.opencity.in) is 3,051
POINTS with zero polygons, all inside KMC: nearest record to Baruipur is 11.4 km
out, to Barrackpore 14.5 km. OSM carries actual polygon geometry over all three
wards. Geometry therefore comes from here; census attributes (depth/capacity)
can join later where they exist, which is Ballygunge only.

CONTRACT: mirrors {ward}-roads.json — {ward, count, source, polys:[{k, p:[x,y,..]}]}
in ward-centred metres (x east, y north), 1-decimal, consumed by the same loader
idiom. The roads artefacts were committed WITHOUT their generator (a standing
debt noted in docs/heat-map-implementation.md); this is the first committed OSM
fetcher, and regenerating roads through the same shape is possible later.

Rings are clipped to +/-CLIP_M so a river that continues for kilometres past the
study window cannot bloat the artefact; roads carry coordinates to ~755 m, so the
clip box deliberately sits past the 700 m half-width rather than at it.

    python3 scripts/fetch-water.py            # all three wards
    python3 scripts/fetch-water.py --check    # asserts over the committed files
"""
from __future__ import annotations

import argparse
from collections.abc import Callable
from typing import Any, cast
import json
import math
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
OVERPASS = "https://overpass-api.de/api/interpreter"
SOURCE = "OpenStreetMap via Overpass (ODbL)"

#: Half-width of the emitted frame, metres. Past the 700 m study half-width on
#: purpose — the roads artefacts carry vertices to ~755 m and the renderer lets
#: geometry run slightly past the window edge rather than shaving it flush.
CLIP_M = 760.0

#: Ring area floor after clipping, m². A 20 m² puddle is one ripple wide at this
#: scale and only adds vertices.
MIN_RING_M2 = 60.0

#: OSM tag -> the artefact's class key. Broad classes only; the renderer tints
#: rivers and still water differently and nothing else needs distinguishing.
def classify(tags: dict[str, str]) -> str:
    if tags.get("waterway") == "riverbank" or tags.get("water") in ("river", "canal"):
        return "river"
    if tags.get("leisure") == "swimming_pool":
        return "pool"
    return "water"


def query(ward: _types.Ward) -> dict[str, Any]:
    w, s, e, n = _types.ward_bounds(ward, pad_m=CLIP_M - ward.footprint_m / 2)
    bbox = f"{s},{w},{n},{e}"
    q = f"""[out:json][timeout:90];
(
  way["natural"="water"]({bbox});
  way["water"]({bbox});
  way["waterway"="riverbank"]({bbox});
  way["leisure"="swimming_pool"]({bbox});
  relation["natural"="water"]({bbox});
  relation["waterway"="riverbank"]({bbox});
);
out tags geom;"""
    r = requests.post(OVERPASS, data=q.encode(),
                      headers={"User-Agent": "delta-climate-research water fetch"},
                      timeout=120)
    r.raise_for_status()
    return cast(dict[str, Any], r.json())


def to_metres(ward: _types.Ward, lon: float, lat: float) -> tuple[float, float]:
    mx, my = _types.m_per_deg(ward.centre.lat)
    return ((lon - ward.centre.lon) * mx, (lat - ward.centre.lat) * my)


def ring_area(ring: list[tuple[float, float]]) -> float:
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def clip_box(ring: list[tuple[float, float]], half: float) -> list[tuple[float, float]]:
    """Sutherland–Hodgman against the square [-half, half]^2."""
    def clip_edge(pts: list[tuple[float, float]], inside: Callable[[tuple[float, float]], bool],
                  intersect: Callable[[tuple[float, float], tuple[float, float]], tuple[float, float]]) -> list[tuple[float, float]]:
        out: list[tuple[float, float]] = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(intersect(prev, cur))
        return out

    for axis, sign in ((0, 1), (0, -1), (1, 1), (1, -1)):
        if not ring:
            return []

        # For sign=+1: keep p[axis] <= half. For sign=-1: keep p[axis] >= -half.
        def inside2(p: tuple[float, float], a: int = axis, sg: int = sign, h: float = half) -> bool:
            return p[a] <= h if sg > 0 else p[a] >= -h

        def intersect(p: tuple[float, float], q: tuple[float, float], a: int = axis, sg: int = sign,
                      h: float = half) -> tuple[float, float]:
            b = h if sg > 0 else -h
            t = (b - p[a]) / (q[a] - p[a])
            return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))

        ring = clip_edge(ring, inside2, intersect)
    return ring


def stitch_outers(members: list[dict[str, Any]]) -> list[list[tuple[float, float]]]:
    """Join a relation's outer ways into closed rings by endpoint matching.

    Multipolygon outers arrive as arbitrary fragments. Greedy endpoint chaining
    is enough here: the fetch only needs rings good to ~0.1 m, and unmatched
    fragments are dropped loudly in the count rather than guessed at.
    """
    frags = []
    for m in members:
        if m.get("role") != "outer" or "geometry" not in m:
            continue
        pts = [(g["lon"], g["lat"]) for g in m["geometry"]]
        if len(pts) >= 2:
            frags.append(pts)
    rings, dropped = [], 0
    while frags:
        chain = frags.pop()
        progress = True
        while progress and chain[0] != chain[-1]:
            progress = False
            for i, f in enumerate(frags):
                if f[0] == chain[-1]:
                    chain += f[1:]; frags.pop(i); progress = True; break
                if f[-1] == chain[-1]:
                    chain += list(reversed(f[:-1])); frags.pop(i); progress = True; break
        if chain[0] == chain[-1] and len(chain) >= 4:
            rings.append(chain[:-1])
        else:
            dropped += 1
    if dropped:
        print(f"      (dropped {dropped} unclosed outer fragment(s))")
    return rings


def fetch_ward(ward: _types.Ward) -> dict[str, Any]:
    doc = query(ward)
    polys = []
    for el in doc.get("elements", []):
        tags = el.get("tags", {})
        k = classify(tags)
        rings: list[list[tuple[float, float]]] = []
        if el["type"] == "way" and "geometry" in el:
            pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                rings.append(pts[:-1])
        elif el["type"] == "relation":
            rings.extend(stitch_outers(el.get("members", [])))
        for ring in rings:
            m = [to_metres(ward, lon, lat) for lon, lat in ring]
            m = clip_box(m, CLIP_M)
            if len(m) >= 3 and ring_area(m) >= MIN_RING_M2:
                flat: list[float] = []
                for x, y in m:
                    flat += [round(x, 1), round(y, 1)]
                polys.append({"k": k, "p": flat})
    return {"ward": ward.id, "count": len(polys), "source": SOURCE, "polys": polys}


def check() -> int:
    ok = True
    for wid in _types.WARDS:
        path = os.path.join(OUT_DIR, f"{wid}-water.json")
        if not os.path.exists(path):
            print(f"  {wid}: MISSING"); ok = False; continue
        d = json.load(open(path))
        assert d["ward"] == wid and d["count"] == len(d["polys"])
        assert d["source"] == SOURCE
        area = 0.0
        for poly in d["polys"]:
            p = poly["p"]
            assert poly["k"] in ("water", "river", "pool")
            assert len(p) >= 6 and len(p) % 2 == 0
            assert all(abs(v) <= CLIP_M + 0.1 for v in p), "vertex escapes the clip box"
            ring = [(p[i], p[i + 1]) for i in range(0, len(p), 2)]
            area += ring_area(ring)
        print(f"  {wid}: {d['count']} polys · {area / 10_000:.2f} ha in frame")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    if ap.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for wid, ward in _types.WARDS.items():
        print(f"  {wid} …")
        data = fetch_ward(ward)
        out = os.path.join(OUT_DIR, f"{wid}-water.json")
        with open(out, "w") as fh:
            json.dump(data, fh, separators=(",", ":"))
        print(f"    {data['count']} polys -> {os.path.relpath(out, ROOT)} "
              f"({os.path.getsize(out):,} B)")
        time.sleep(2)   # be polite to Overpass
    return check()


if __name__ == "__main__":
    sys.exit(main())
