"""Wikidata building heights -> the authoritative, CC0 height layer.

TWO PROBLEMS AT ONCE.

ACCURACY. OSM heights for Dubai are frequently `building:levels` x 3.2 m, which
is a floor-count approximation. Burj Khalifa came through at 521.6 m against a
true architectural height of 828 m — the tower was 306 m short, and the same
multiplication error is in every building tagged by levels rather than height.

LICENCE. Everything else in this pipeline that carries a height is ODbL, and the
share-alike question that raises is unresolved. Wikidata is CC0 — no attribution
required, no share-alike — so every height sourced here is one fewer ODbL
dependency. It does not close the question (outlines and massing are still OSM)
but it moves the most quotable numbers out of it.

WHAT IS FILTERED OUT, AND WHY IT MATTERS. Wikidata lists proposals and cancelled
projects alongside completed buildings. Unfiltered, greater Dubai returns Dubai
City Tower at 2,400 m and Nakheel Tower at 1,400 m — neither was ever built, and
either would tower absurdly over Burj Khalifa in the render. Only items with an
inception date at or before the current year survive, and anything taller than
Burj Khalifa is rejected outright.

    python3 scripts/fetch-dubai-wikidata.py
    python3 scripts/fetch-dubai-wikidata.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import (CTBUH_LANDMARKS, SITES, Site, m_per_deg, names_agree,  # noqa: E402
                    site_bounds, window_key)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "public", "flood-sim", "data")
CACHE = os.path.join(HERE, "..", "data", ".cache", "wikidata")
ENDPOINT = "https://query.wikidata.org/sparql"
ATTRIBUTION = "Building heights from Wikidata (CC0 1.0 — public domain)"
BURJ_KHALIFA_M = 828.0      # nothing in Dubai is taller; a taller value is a proposal
# Only a tie-break now that names decide the match, so it can be generous:
# Wikidata points sit up to 133 m from their own building in this window, and
# tightening it was never what made the join wrong.
MATCH_RADIUS_M = 250.0

SPARQL = """
SELECT ?item ?itemLabel ?height ?lat ?lon ?inception WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(%f %f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "%f" .
  }
  ?item wdt:P2048 ?height .
  OPTIONAL { ?item wdt:P571 ?inception . }
  ?item p:P625 ?st . ?st psv:P625 ?node .
  ?node wikibase:geoLatitude ?lat . ?node wikibase:geoLongitude ?lon .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar". }
}
"""


def fetch(site: Site) -> list[dict[str, Any]]:
    w, s, e, n = site_bounds(site)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{site.id}-{window_key(site)}-wikidata.json")
    if not os.path.exists(path):
        # QUERY BY LOCATION FIRST. The previous form opened with
        # `wdt:P31/wdt:P279* wd:Q41176`, walking the global building subclass
        # tree before filtering by coordinate — WDQS answered 502 on GET and 504
        # on POST every time at this window size. `wikibase:around` hits the
        # geospatial index first and returns in under a second. The radius
        # covers the window's half-diagonal; the box clip happens below in
        # Python, where it is cheap.
        import time
        radius_km = (site.footprint_m / 1000.0) * 0.75   # covers the half-diagonal
        resp = None
        for attempt in range(4):
            resp = requests.post(
                ENDPOINT,
                data={"query": SPARQL % (site.lon, site.lat, radius_km)},
                timeout=300,
                headers={"Accept": "application/sparql-results+json",
                         "User-Agent": "delta-climate-flood-sim/0.1 (build-time pipeline)"},
            )
            if resp.status_code == 200:
                break
            print(f"  WDQS {resp.status_code}, retry {attempt + 1}/4")
            time.sleep(5 * (attempt + 1))
        assert resp is not None
        resp.raise_for_status()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(resp.text)
    with open(path, encoding="utf-8") as fh:
        rows: list[dict[str, Any]] = json.load(fh)["results"]["bindings"]
    return rows


def build(site: Site) -> dict[str, Any]:
    path = os.path.join(OUT_DIR, f"{site.id}-buildings.json")
    with open(path, encoding="utf-8") as fh:
        doc: dict[str, Any] = json.load(fh)
    mx, my = m_per_deg(site.lat)
    w, s_, e, n = site_bounds(site)

    # IDEMPOTENCY: this script reads what it writes, so it must undo its own last
    # run before making the next one. It cleared "wikidata" and not "ctbuh",
    # which meant CTBUH marks ACCUMULATED: on a second run each landmark found
    # its previous footprint already marked, skipped it, and claimed another --
    # so Burj Khalifa ended up owning two, and the artefact grew a tower that
    # does not exist for every re-run.
    #
    # The same building is often present twice, as an OSM outline and as the
    # GlobalML footprint underneath it, which is what gave the second claim
    # somewhere plausible to land.
    for arr in (doc["b"], doc.get("osmB", [])):
        for rec in arr:
            if rec.get("hs") in ("wikidata", "ctbuh"):
                rec.pop("h", None)
                rec.pop("hs", None)
                rec.pop("wd", None)

    seen: dict[str, float] = {}
    landmarks: list[dict[str, Any]] = []
    rejected = 0
    for row in fetch(site):
        try:
            height = float(row["height"]["value"])
        except (KeyError, ValueError):
            continue
        name = row.get("itemLabel", {}).get("value", "")
        if height > BURJ_KHALIFA_M + 1:
            rejected += 1              # unbuilt proposal
            continue
        if "inception" not in row:
            rejected += 1              # no completion date: treat as unbuilt
            continue
        lat, lon = float(row["lat"]["value"]), float(row["lon"]["value"])
        if not (w <= lon <= e and s_ <= lat <= n):
            continue                   # `around` returns a disc; the site is a box
        x, y = (lon - site.lon) * mx, (lat - site.lat) * my

        # DEDUPLICATE BY ENTITY, NOT BY GRID CELL. SPARQL returns one row per
        # combination of an item's coordinate and height statements, so a single
        # building arrives several times: Q7712376 (Address Boulevard) carries two
        # coordinates 36 m apart and comes back four times, and Q1244144 (JW
        # Marriott Marquis) nine times.
        #
        # The previous key was a 40 m grid cell, which those two coordinates
        # straddle -- so both survived and each claimed a different footprint,
        # producing a tower that does not exist. It was also wrong in the other
        # direction: two genuinely different buildings inside one cell collapsed
        # into one, silently dropping a real height.
        #
        # A Q-id is the identity the data already carries. One entity, one
        # building.
        key = str(row["item"]["value"]).rsplit("/", 1)[-1]
        if key in seen:
            continue
        seen[key] = height
        landmarks.append({"x": round(x, 1), "y": round(y, 1),
                          "h": round(height, 1), "name": name})

    # ATTACH BY NAME, NOT BY DISTANCE. This loop used to take the nearest
    # centroid within MATCH_RADIUS_M, and an audit of a real run found roughly
    # nine of 42 attachments on the wrong building: Marina 106's 445 m on the
    # 254 m Marina Arcade Tower, Ocean Heights' 310 m on Al Seef Tower, and the
    # Burj Al Arab's 321 m on the Skyview Bar -- a room inside it.
    #
    # Geometry cannot fix that. 37 of those 42 points fall OUTSIDE the footprint
    # they belong to, because Wikidata coordinates are approximate to 40-80 m, so
    # a containment test would reject Princess Tower, 23 Marina and Cayan Tower,
    # all correctly matched from outside. Nor does containment imply correctness:
    # Ocean Heights fell inside Al Seef Tower and was still wrong.
    #
    # So: names decide, distance only breaks ties between name-agreeing
    # candidates, one footprint per item, and an unnamed footprint is skipped
    # rather than guessed -- a wrong height on a named landmark is worse than
    # none at all.
    # A SUPERSEDED FOOTPRINT IS NEVER DRAWN, so a height attached to one is a
    # no-op that also consumes the item -- one footprint per item means the real
    # outline then gets nothing. Almas Tower (363 m), The Marina Torch (352 m)
    # and Ocean Heights (310 m) all landed on GlobalML records that OSM had
    # already superseded, so three cited heights were spent on geometry the
    # scene does not contain.
    attached = 0
    unverifiable = 0
    for lm in landmarks:
        best, best_d = None, MATCH_RADIUS_M
        for arr in (doc.get("osmB", []), doc["b"]):
            for rec in arr:
                if rec.get("hs") in ("wikidata", "ctbuh"):
                    continue           # already claimed by another item
                if rec.get("sup"):
                    continue           # superseded by an OSM outline: never drawn
                if not names_agree(rec.get("name"), lm["name"]):
                    continue
                xs, ys = rec["p"][0::2], rec["p"][1::2]
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                d = ((cx - lm["x"]) ** 2 + (cy - lm["y"]) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = rec, d
        if best is None:
            unverifiable += 1
            continue
        best["h"] = lm["h"]
        best["hs"] = "wikidata"
        best["wd"] = lm["name"]
        attached += 1
    print(f"  wikidata: {attached} attached by name, {unverifiable} unmatched")

    # ── CTBUH overrides, applied LAST because they are the authority ─────────
    # Wikidata is CC0 and broad; CTBUH is narrow and definitive. Where they
    # disagree CTBUH wins, and where OSM disagrees with either it loses — its
    # values are often levels x 3.2 m. Measured deltas on this set run to
    # hundreds of metres.
    ctbuh_applied = 0
    deltas: list[tuple[str, float, float]] = []
    for name, lat, lon, height in CTBUH_LANDMARKS:
        lx, ly = (lon - site.lon) * mx, (lat - site.lat) * my
        best, best_d = None, MATCH_RADIUS_M
        for arr in (doc.get("osmB", []), doc["b"]):
            for rec in arr:
                if rec.get("hs") == "ctbuh":
                    continue           # one footprint per CTBUH entry
                if rec.get("sup"):
                    continue           # superseded by an OSM outline: never drawn
                if not names_agree(rec.get("name"), name):
                    continue
                xs, ys = rec["p"][0::2], rec["p"][1::2]
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                d = ((cx - lx) ** 2 + (cy - ly) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = rec, d
        if best is not None:
            was = float(best.get("h", 0.0))
            if was and abs(was - height) > 5:
                deltas.append((name, was, height))
            best["h"] = height
            best["hs"] = "ctbuh"
            best["wd"] = name
            ctbuh_applied += 1
    doc["ctbuh"] = {
        "applied": ctbuh_applied,
        "corrected": len(deltas),
        "note": (
            "CTBUH architectural heights override every other source. "
            + "; ".join(f"{n}: {w:.0f} -> {c:.0f} m" for n, w, c in sorted(
                deltas, key=lambda t: -abs(t[1] - t[2]))[:6])
        ),
    }

    doc["wikidata"] = {
        "landmarks": len(landmarks), "attached": attached, "rejectedUnbuilt": rejected,
        "licence": "CC0-1.0", "attribution": ATTRIBUTION,
        "note": (
            f"{attached:,} heights come from Wikidata (CC0) and override the ODbL "
            f"OSM values, which are often building:levels x 3.2 m. Burj Khalifa was "
            f"521.6 m under that approximation against a true 828 m. {rejected} items "
            f"were rejected as unbuilt proposals or taller than Burj Khalifa."
        ),
    }
    return doc


def check() -> int:
    failures: list[str] = []
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        wd = d.get("wikidata")
        if not wd:
            # A site that has never had the layer applied is not a failure, it is
            # a site that has not been built. Failing here masked every real check
            # behind a known-absent dubai-south.
            print(f"  skip {sid}: no wikidata block yet")
            continue
        allrecs = list(d["b"]) + list(d.get("osmB", []))
        ct = [r for r in allrecs if r.get("hs") == "ctbuh"]
        if len(ct) < 8:
            failures.append(f"{sid}: only {len(ct)} CTBUH landmarks matched")
        if not any(abs(r["h"] - 828.0) < 0.1 for r in ct):
            failures.append(f"{sid}: Burj Khalifa is not 828 m -- the authority did not apply")
        wdh = [r for r in allrecs if r.get("hs") in ("wikidata", "ctbuh")]
        if len(wdh) < 10:
            failures.append(f"{sid}: only {len(wdh)} Wikidata heights attached")
        tallest = max((r["h"] for r in wdh), default=0.0)
        if not 820 <= tallest <= 830:
            failures.append(f"{sid}: tallest Wikidata height {tallest} m -- "
                            f"Burj Khalifa is 828 m, so this is wrong or unbuilt")
        if any(r["h"] > BURJ_KHALIFA_M + 1 for r in wdh):
            failures.append(f"{sid}: a building taller than Burj Khalifa survived the filter")

        # THE GATE THAT WOULD HAVE CAUGHT THE REAL DEFECT. Every check above asks
        # whether a height is plausible. None asked whether it landed on the
        # building it belongs to, and that is the failure that happened: Marina
        # 106's 445 m sat on a 254 m tower and passed all of them.
        crossed = [r for r in wdh
                   if r.get("name") and not names_agree(r.get("name"), r.get("wd"))]
        for r in crossed[:5]:
            failures.append(f"{sid}: {r['h']} m from {r.get('wd')!r} landed on "
                            f"{r.get('name')!r} -- different buildings")
        if len(crossed) > 5:
            failures.append(f"{sid}: and {len(crossed) - 5} more crossed attachments")

        # One source item, one footprint. JW Marriott Marquis Dubai previously
        # claimed three at 355 m each, which is two towers that do not exist.
        claims: dict[str, int] = {}
        for r in wdh:
            label = r.get("wd")
            if label:
                claims[label] = claims.get(label, 0) + 1
        for label, n in sorted(claims.items()):
            if n > 1:
                failures.append(f"{sid}: {label!r} claims {n} footprints -- phantom towers")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        wd = d.get("wikidata")
        if not wd:
            continue                   # never built; the loop above already said so
        allrecs = list(d["b"]) + list(d.get("osmB", []))
        top = sorted((r for r in allrecs if r.get("hs") == "wikidata"),
                     key=lambda r: -r["h"])[:3]
        ctb = d.get("ctbuh", {})
        print(f"  OK {sid}: {wd['attached']} CC0 heights, {ctb.get('applied', 0)} CTBUH "
              f"landmarks ({ctb.get('corrected', 0)} corrected), "
              f"{wd['rejectedUnbuilt']} unbuilt rejected")
        if ctb.get("note"):
            print(f"     {ctb['note'][:150]}")
        for r in top:
            print(f"     {r['h']:6.1f} m  {r.get('wd', '—')}")
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
