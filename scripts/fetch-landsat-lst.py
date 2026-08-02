"""Landsat Collection-2 Level-2 surface temperature, aggregated per ward-scene.

The daytime accuracy figure rests on 12 ECOSTRESS overpasses, which puts a 95 %
confidence interval of 2.91-6.65 K around a published 4.42 K. That is the
constraint this script exists to relax: Landsat 8/9 add an independent
instrument on a fixed 8-day repeat, and more overpasses shrink the interval on
the number we publish.

WHY MICROSOFT PLANETARY COMPUTER AND NOT EARTHDATA. The ECOSTRESS path needs a
bearer token, and GDAL's /vsicurl drops the auth header across LP DAAC's
redirect (see _ecostress.py). MPC hands out a short-lived SAS token that lives
in the URL query string, so a plain rasterio open works and there is no header
to lose. No account, no new dependency: requests + rasterio, both already here.

TIME BASE. Landsat crosses at ~10:30 local solar, ECOSTRESS drifts across all
hours. 10:30 IS NOT 13:00 -- surface temperature climbs steeply through the
morning, so these rows are a MORNING stratum and must never be pooled into
`peak` without the measured offset that measure-accuracy.py computes. This
script only records `hour_lst`; the stratification is enforced downstream.

Run:
    python3 scripts/fetch-landsat-lst.py --probe   # P0: assets, yield, one header
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
from typing import Any

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path must be set first -- the scripts are not a package)

ROOT = os.path.join(HERE, "..")
CACHE = os.path.expanduser("~/.cache/delta-climate/landsat")

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"

#: Asset keys, CONFIRMED by the P0 probe against a real item rather than taken
#: from documentation. The spec guessed `ST_B10`/`st_qa`; MPC publishes neither.
#: The full 25-key asset list is in the P0 commit message.
#:
#:   lwir11    Surface Temperature Band          kelvin, scale 0.00341802, offset 149.0, nodata 0
#:   qa        Surface Temperature QA Band       kelvin, scale 0.01,       nodata -9999
#:   qa_pixel  Pixel QA (CFMask bitfield)        nodata 1
#:
#: THERMAL_KEYS stays a tuple because the catalogue has renamed thermal assets
#: before; the probe fails loudly with the real list rather than guessing.
THERMAL_KEYS = ("lwir11", "ST_B10", "temperature")
ST_QA_KEY = "qa"
QA_PIXEL_KEY = "qa_pixel"

#: From the catalogue's raster:bands, not hardcoded lore.
K_SCALE, K_OFFSET = 0.00341802, 149.0
ST_QA_SCALE = 0.01

#: Search window. Landsat 9 launched 2021; 2024-01-01 onward keeps the archive
#: contemporary with the ECOSTRESS set (earliest committed row 2024-01-05).
START = "2024-01-01T00:00:00Z"

#: Pre-filter only. Scene-level cloud says nothing about OUR 1.4 km ward -- a
#: 70 %-cloudy scene can be clear over Ballygunge. The real gate is per-pixel
#: CFMask in P1, so this is deliberately loose and merely avoids fetching COGs
#: that cannot possibly survive.
CLOUD_MAX = 80


def ward_bbox(pad_m: float = 2000.0) -> list[float]:
    """One bbox covering all three wards, padded.

    Searching per ward would triple the requests and return the same scenes:
    the wards span ~45 km and a Landsat tile is 185 km, so one search covers
    them all.
    """
    boxes = [_types.ward_bounds(w, pad_m=pad_m) for w in _types.WARDS.values()]
    return [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]


def search(session: requests.Session) -> list[dict[str, Any]]:
    """Every T1 Landsat 8/9 item over the study area, following `next` links.

    PAGINATION IS NOT OPTIONAL. The ECOSTRESS search shipped unpaginated and
    silently truncated at one page -- it is in the calibration file plan as a
    FIX. A truncated search here would look like a thin archive rather than a
    bug, so the loop is explicit and the page count is printed.
    """
    body: dict[str, Any] = {
        "collections": ["landsat-c2-l2"],
        "bbox": ward_bbox(),
        "datetime": f"{START}/..",
        "query": {
            "platform": {"in": ["landsat-8", "landsat-9"]},
            "landsat:collection_category": {"eq": "T1"},
            "eo:cloud_cover": {"lt": CLOUD_MAX},
        },
        "limit": 100,
    }
    items: list[dict[str, Any]] = []
    url, payload, pages = STAC, body, 0
    while url:
        r = session.post(url, json=payload, timeout=60)
        r.raise_for_status()
        doc = r.json()
        items.extend(doc.get("features", []))
        pages += 1
        nxt = next((l for l in doc.get("links", []) if l.get("rel") == "next"), None)
        if not nxt:
            break
        url = nxt["href"]
        # MPC returns the next page's body to POST back; fall back to the
        # original body merged with whatever the link carries.
        payload = nxt.get("body", payload)
    print(f"  STAC pages fetched: {pages}")
    return items


def sign(session: requests.Session, href: str) -> str:
    """Append a SAS token to a blob href. Tokens are short-lived by design."""
    tok = session.get(SIGN, timeout=30).json()["token"]
    return f"{href}?{tok}"


def probe() -> int:
    """P0: prove the access path and bracket the yield before building anything."""
    os.makedirs(CACHE, exist_ok=True)
    s = requests.Session()
    print(f"  bbox: {[round(v, 4) for v in ward_bbox()]}")
    items = search(s)
    if not items:
        print("  FAIL: search returned nothing -- check the collection id or bbox")
        return 1

    by_year: dict[str, int] = collections.Counter()
    by_plat: dict[str, int] = collections.Counter()
    pathrow: set[str] = set()
    for it in items:
        p = it["properties"]
        by_year[p["datetime"][:4]] += 1
        by_plat[p.get("platform", "?")] += 1
        pathrow.add(f'{p.get("landsat:wrs_path")}/{p.get("landsat:wrs_row")}')

    print(f"  items: {len(items)}")
    print(f"  by year:     {dict(sorted(by_year.items()))}")
    print(f"  by platform: {dict(sorted(by_plat.items()))}")
    print(f"  WRS path/row: {sorted(pathrow)}")

    first = items[0]
    assets = first.get("assets", {})
    print(f"  first item: {first['id']}  {first['properties']['datetime']}")
    print(f"  asset keys ({len(assets)}): {sorted(assets)}")

    key = next((k for k in THERMAL_KEYS if k in assets), None)
    if key is None:
        print(f"  FAIL: no thermal asset among {THERMAL_KEYS}.")
        print("        Set THERMAL_KEYS from the list above -- do NOT guess.")
        return 1
    print(f"  thermal asset key: {key!r}")
    for extra in (QA_PIXEL_KEY, ST_QA_KEY):
        if extra not in assets:
            print(f"  FAIL: required QA asset {extra!r} absent. Masking cannot be "
                  f"implemented as specified; re-key from the list above.")
            return 1
        print(f"  {extra}: present")

    # Per-ward coverage. Two WRS tiles (138/044, 138/045) intersect the study
    # area, so ITEMS OVERCOUNT OVERPASSES: one pass can deliver two items and a
    # ward can sit in both footprints. Distinct dates is the number that matters,
    # because the honest validation split is leave-one-OVERPASS-out.
    print("  ── per-ward coverage (scene bbox contains ward centre) ──")
    per: dict[str, set[str]] = {}
    for wid, w in _types.WARDS.items():
        hits = [it for it in items
                if it["bbox"][0] <= w.centre.lon <= it["bbox"][2]
                and it["bbox"][1] <= w.centre.lat <= it["bbox"][3]]
        per[wid] = {it["properties"]["datetime"][:10] for it in hits}
        print(f"    {wid:12} items={len(hits):3}  distinct dates={len(per[wid]):3}")
    allw = set.intersection(*per.values()) if per else set()
    print(f"    dates covering ALL three wards: {len(allw)}  "
          f"(ECOSTRESS day set, for scale: 12 overpasses / 29 ward-scenes)")

    # One real header read. Proves signing + rasterio + COG range access before
    # any loop exists to hide a failure inside.
    import rasterio
    href = sign(s, assets[key]["href"])
    with rasterio.open(href) as src:
        print(f"  header OK: crs={src.crs} res={src.res} dtype={src.dtypes[0]} "
              f"nodata={src.nodata} size={src.width}x{src.height}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--probe", action="store_true",
                    help="P0: print asset keys, candidate yield, one header read")
    a = ap.parse_args()
    if a.probe:
        return probe()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
