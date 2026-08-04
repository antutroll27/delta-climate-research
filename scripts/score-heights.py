"""Task 3 — score our height statistics against the only ground truth that exists.

OSM `building:levels` is hand-surveyed. It is the ONLY external check available for
Kolkata: Overture carries `height` on zero buildings here, and no free DEM resolves
building tops. So this decides two things at once:

  1. WHICH STATISTIC SHIPS -- mean, p65 or p75, whichever lands nearest the truth.
  2. WHETHER THE NEW HEIGHTS ARE RIGHT AT ALL -- Task 2's Gate A breached upward
     (p90 +12.5/+14.1/+8.7 %) and half of that is explained by Microsoft merging
     towers into blobs. The other half is not. If OSM agrees the buildings are
     tall, the rise is a correction; if it does not, the pipeline inflates and we
     have caught it before anything shipped.

STOREY HEIGHT IS AN ASSUMPTION, SO IT IS BRACKETED. Indian urban floor-to-floor
runs ~3.0-3.3 m; every verdict is computed at 2.9, 3.1 and 3.3, and a winner that
flips across that bracket is reported as underpowered rather than declared.

UNDERPOWERED IS AN OUTCOME, NOT A FAILURE. Below MIN_PAIRS the statistic nearest
the shipped values (p65, measured) ships and the artefact records that the test
could not decide. An honest "we could not check this" beats a method change
justified by four buildings.

    python3 scripts/score-heights.py
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
GEOM = os.path.join(ROOT, "data", "geometry")
CACHE = os.path.join(GEOM, "osm-levels-cache.json")
OUT = os.path.join(GEOM, "height-method.json")

sys.path.insert(0, HERE)
import _types                                        # noqa: E402  (path set above)

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "delta-climate-research height validation"}
PAUSE_S = 30                                         # Overpass etiquette; 429 once was enough

WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}
SIZE_M = 1400.0
MATCH_M = 12.0                                       # same building, not its neighbour
MIN_PAIRS = 8
STOREY_TESTS = (2.9, 3.1, 3.3)
CANDIDATES = ("mean", "p65", "p75")
DEFAULT_STAT = "p65"                                 # measured to sit where the shipped values do


def fetch_levels(ward: str, lat: float, lon: float) -> list[dict]:
    d_lat = (SIZE_M / 2) / 110540.0
    d_lon = (SIZE_M / 2) / (111320.0 * math.cos(math.radians(lat)))
    query = (f'[out:json][timeout:90];way["building"]["building:levels"]'
             f'({lat-d_lat},{lon-d_lon},{lat+d_lat},{lon+d_lon});out center tags;')
    response = requests.post(OVERPASS, data={"data": query}, timeout=120, headers=UA)
    response.raise_for_status()
    return response.json().get("elements", [])


def levels_cached() -> dict[str, list[dict]]:
    """Cached per ward: a rerun must never refetch what already arrived."""
    cache: dict[str, list[dict]] = {}
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as fh:
            cache = json.load(fh)
    for i, (ward, (lat, lon)) in enumerate(WARDS.items()):
        if ward in cache:
            continue
        if i:
            time.sleep(PAUSE_S)
        cache[ward] = fetch_levels(ward, lat, lon)
        with open(CACHE, "w", encoding="utf-8") as fh:     # write after EVERY ward
            json.dump(cache, fh)
    return cache


def collect_pairs() -> list[dict]:
    """(levels, our heights) for every OSM-tagged building we can match."""
    with open(os.path.join(GEOM, "heights-overture.json"), encoding="utf-8") as fh:
        heights = json.load(fh)["wards"]
    pairs: list[dict] = []
    for ward, elements in levels_cached().items():
        with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
            footprints = json.load(fh)["b"]
        by_id = {r["id"]: r for r in heights[ward]}
        centroids = []
        for row in footprints:
            xs, ys = row["p"][0::2], row["p"][1::2]
            centroids.append((sum(xs) / len(xs), sum(ys) / len(ys), row["gers"]))
        lat, lon = WARDS[ward]
        mx, my = _types.m_per_deg(lat)
        for element in elements:
            centre = element.get("center") or {}
            if "lat" not in centre:
                continue
            try:
                levels = float(str(element["tags"]["building:levels"]).split(";")[0])
            except (KeyError, ValueError):
                continue
            if not 1 <= levels <= 60:
                continue
            x = (centre["lon"] - lon) * mx
            y = (centre["lat"] - lat) * my
            best = min(centroids, key=lambda c: (c[0] - x) ** 2 + (c[1] - y) ** 2)
            if math.hypot(best[0] - x, best[1] - y) > MATCH_M:
                continue
            row = by_id.get(best[2])
            if not row or row["fill"]:
                continue
            pairs.append({"ward": ward, "levels": levels,
                          **{stat: row[stat] for stat in CANDIDATES}})
    return pairs


def decide(pairs: list[dict]) -> dict:
    verdict: dict = {"pairs": len(pairs), "min_pairs": MIN_PAIRS,
                     "storey_tests": list(STOREY_TESTS), "tests": {}}
    if len(pairs) < MIN_PAIRS:
        verdict["method"] = DEFAULT_STAT
        verdict["reason"] = (f"underpowered: {len(pairs)} matched pairs < {MIN_PAIRS}. "
                             f"{DEFAULT_STAT} ships because it sits where the shipped "
                             f"values were measured to sit; the heights remain "
                             f"independently unvalidated.")
        return verdict

    winners = []
    for storey in STOREY_TESTS:
        row = {}
        for stat in CANDIDATES:
            ratios = [p[stat] / (p["levels"] * storey) for p in pairs]
            row[stat] = round(statistics.median(ratios), 3)
        verdict["tests"][str(storey)] = row
        winners.append(min(CANDIDATES, key=lambda s: abs(row[s] - 1)))

    if len(set(winners)) == 1:
        verdict["method"] = winners[0]
        verdict["reason"] = "consistent winner across the storey bracket"
    else:
        verdict["method"] = DEFAULT_STAT
        verdict["reason"] = (f"winner flips across the storey bracket {winners} -- "
                             f"the sample cannot separate the candidates; "
                             f"{DEFAULT_STAT} ships")
    verdict["shipped_ratio"] = verdict["tests"][str(STOREY_TESTS[1])][verdict["method"]]
    return verdict


def main() -> int:
    pairs = collect_pairs()
    verdict = decide(pairs)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(verdict, indent=2) + "\n")

    print(f"  matched pairs: {len(pairs)} (need {MIN_PAIRS})")
    for ward in WARDS:
        n = sum(1 for p in pairs if p["ward"] == ward)
        print(f"    {ward:<12} {n}")
    if verdict["tests"]:
        print(f"\n  {'storey':<9}" + "".join(f"{s:>9}" for s in CANDIDATES))
        for storey, row in verdict["tests"].items():
            print(f"  {storey + ' m':<9}" + "".join(f"{row[s]:>9.3f}" for s in CANDIDATES))
        print("\n  (ratio = ours / OSM-implied. 1.000 is agreement; <1 understates.)")
    print(f"\n  METHOD: {verdict['method']}  --  {verdict['reason']}")
    if pairs:
        tall = [p for p in pairs if p["levels"] >= 6]
        if tall:
            print(f"\n  the question Gate A hangs on -- buildings OSM says are 6+ storeys (n={len(tall)}):")
            for p in sorted(tall, key=lambda q: -q["levels"])[:8]:
                print(f"    {p['ward']:<12} OSM {p['levels']:>4.0f} storeys "
                      f"(~{p['levels']*3.1:>5.1f} m) · ours p65 {p['p65']:>5.1f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
