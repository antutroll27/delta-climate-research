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
OUT = os.path.join(ROOT, "data", "calibration", "landsat-ward-lst.json")

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


#: One SAS token covers the whole collection for ~an hour. Requesting one per
#: asset meant three calls per scene, ~530 for the sweep, and MPC starts
#: returning a body with no `token` key well before that — which surfaced as
#: `KeyError: 'token'` on scene 2 of a 6-scene smoke test. Cache it, and refresh
#: a few minutes early rather than waiting for a 403 mid-read.
_TOKEN: dict[str, Any] = {"value": None, "expires": 0.0}
TOKEN_TTL_S = 45 * 60


def sign(session: requests.Session, href: str) -> str:
    """Append a cached SAS token to a blob href."""
    import time
    now = time.time()
    if _TOKEN["value"] is None or now >= _TOKEN["expires"]:
        for attempt in range(4):
            r = session.get(SIGN, timeout=30)
            if r.ok:
                doc = r.json()
                if "token" in doc:
                    _TOKEN["value"] = doc["token"]
                    _TOKEN["expires"] = now + TOKEN_TTL_S
                    break
            time.sleep(2 ** attempt)          # 1s, 2s, 4s — MPC throttles bursts
        else:
            raise RuntimeError("SAS token endpoint gave no token after 4 attempts")
    return f"{href}?{_TOKEN['value']}"


#: CFMask bits in QA_PIXEL (Collection 2 Level-2). Bit 0 is "fill", handled by
#: nodata; these four are the ones that put invented temperature on the ground.
#: Cirrus is included because thin cirrus depresses retrieved LST by degrees
#: while leaving a scene that looks clear.
QA_DILATED_CLOUD, QA_CIRRUS, QA_CLOUD, QA_SHADOW = 1 << 1, 1 << 2, 1 << 3, 1 << 4
QA_BAD = QA_DILATED_CLOUD | QA_CIRRUS | QA_CLOUD | QA_SHADOW

#: Usable-temperature gate, Kelvin. Identical to the ECOSTRESS gate so both
#: sensors are scored on comparably-screened pixels.
K_MIN, K_MAX = 200.0, 400.0

#: Per-pixel ST uncertainty ceiling, Kelvin. MEASURED, not assumed.
#:
#: The spec's placeholder of 2.0 K retained 8.5 % of cloud-free pixels and would
#: have made the campaign look like a barren archive. Measured over 53,725
#: clean pixels spanning 2024-2026, ST_QA runs p25 2.16 / p50 3.65 / p75 4.65 K.
#:
#: Ward-scene survival, and what the reference costs, sampled over 72 windows:
#:
#:     ceiling   ward-scenes kept   overpasses   mean ST_QA of kept px
#:     <= 2.0 K      13.9 %              6            1.68 K
#:     <= 2.5 K      29.2 %              6            1.94 K
#:     <= 3.0 K      31.9 %              6            2.01 K   <- shipped
#:     <= 4.0 K      40.3 %              8            2.38 K
#:     <= 5.0 K      56.9 %             11            3.04 K
#:     <= 6.0 K      61.1 %             12            3.31 K
#:
#: 3.0 K is NOT the yield-maximising choice, and that is the point. The number
#: this campaign exists to sharpen is a 4.42 K daytime model error. Retained
#: pixels here carry a stated uncertainty of 2.01 K — comfortably under half the
#: quantity being measured, so Landsat stays an independent check. Loosening to
#: 5 K buys ~1.8x the scenes at a reference uncertainty of 3.04 K, which is most
#: of the error we are trying to resolve: yield bought with the instrument's
#: credibility is the wrong trade for a validation campaign.
#:
#: It is also a real break in the distribution rather than a round number:
#: 2.5->3.0 K adds 4.7 points of pixel yield, 3.0->4.0 K adds 19.6.
ST_QA_MAX_K = 3.0

#: Usability floor as a FRACTION of in-ward cells.
#:
#: The ECOSTRESS set drops ward-scenes below MIN_CELLS = 40 of a 21x21 grid
#: (build-ward-observations.py:67) — an absolute count, ~9.07 % of 441, and rows
#: down to cell_frac 0.229 are real in the committed set. Landsat's 30 m grid
#: holds ~5x the cells over the same 1.4 km ward, so COPYING THE COUNT would
#: make this floor five times laxer than the ECOSTRESS one. The fraction is the
#: portable quantity; the count is not.
MIN_CELL_FRAC = 40 / 441


def ward_lst(src_lst: Any, src_qa: Any, src_stqa: Any, ward: _types.Ward
             ) -> "tuple[Any, int, float] | None":
    """Masked surface temperature in °C over one ward, plus the in-ward cell count.

    Mirrors `ward_lst()` in build-ward-observations.py: mask first, aggregate
    second, and never interpolate across a mask edge. Windows come from
    `_types.ward_bounds`, whose (west, south, east, north) order is the one
    rasterio's `from_bounds` wants — getting it wrong reads the wrong window
    silently rather than raising.
    """
    import numpy as np
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    w, s, e, n = _types.ward_bounds(ward)
    # The COGs are UTM 45N, the ward table is WGS-84. Reproject the bounds, not
    # the raster: one transform of four numbers instead of a resample of a scene.
    try:
        bounds = transform_bounds("EPSG:4326", src_lst.crs, w, s, e, n, densify_pts=21)
        win = from_bounds(*bounds, transform=src_lst.transform)
        k_raw = src_lst.read(1, window=win, boundless=True, fill_value=0)
    except Exception:
        return None
    total = int(k_raw.size)
    if total == 0:
        return None

    qa = src_qa.read(1, window=win, boundless=True, fill_value=1)
    stq = src_stqa.read(1, window=win, boundless=True, fill_value=-9999)

    kelvin = k_raw.astype(np.float32) * K_SCALE + K_OFFSET
    good = (k_raw != 0)                                   # nodata is 0, pre-scale
    good &= (kelvin > K_MIN) & (kelvin < K_MAX)
    good &= (qa & QA_BAD) == 0
    good &= (stq != -9999) & (stq.astype(np.float32) * ST_QA_SCALE <= ST_QA_MAX_K)

    cel = np.where(good, kelvin - 273.15, np.nan).astype(np.float32)
    # Carry the retained pixels' own stated uncertainty out with the temperature.
    # A validation reference that does not report its own error bar cannot be
    # honestly compared against a model error bar, and this one is not small
    # enough to ignore (~2 K against the 4.42 K being measured).
    stq_k = (stq.astype(np.float32) * ST_QA_SCALE)
    st_qa_mean = float(np.nanmean(np.where(good, stq_k, np.nan))) if good.any() else float("nan")
    return cel, total, st_qa_mean


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


def sweep(limit: int | None, qa_curve: bool) -> int:
    """P1: every candidate scene x ward -> committed aggregates.

    Idempotent over the output file: a re-run after a SAS expiry or a 429 keeps
    what already landed. The yield table it prints is the campaign's headline
    number and belongs in the commit message.
    """
    import numpy as np
    import rasterio

    s = requests.Session()
    items = search(s)
    items.sort(key=lambda it: it["properties"]["datetime"])
    if limit:
        items = items[:limit]

    rows: list[dict[str, Any]] = []
    if os.path.exists(OUT):
        with open(OUT) as fh:
            rows = json.load(fh)["rows"]
    done = {(r["scene_id"], r["ward"]) for r in rows}

    # Yield accounting. Every drop is counted and reported; a scene that vanishes
    # without appearing in this table is a bug, not a quiet exclusion.
    tally: collections.Counter[str] = collections.Counter()
    curve: dict[float, int] = collections.Counter()
    scanned = 0

    for it in items:
        sid = it["id"]
        props = it["properties"]
        assets = it["assets"]
        key = next((k for k in THERMAL_KEYS if k in assets), None)
        if key is None or ST_QA_KEY not in assets or QA_PIXEL_KEY not in assets:
            tally["no_assets"] += 1
            continue
        wards_todo = [w for w in _types.WARDS.values() if (sid, w.id) not in done]
        if not wards_todo:
            tally["cached"] += len(_types.WARDS)
            continue

        try:
            hrefs = [sign(s, assets[k]["href"]) for k in (key, QA_PIXEL_KEY, ST_QA_KEY)]
            with rasterio.open(hrefs[0]) as a, rasterio.open(hrefs[1]) as b, \
                 rasterio.open(hrefs[2]) as c:
                scanned += 1
                for w in wards_todo:
                    got = ward_lst(a, b, c, w)
                    if got is None:
                        tally["window_fail"] += 1
                        continue
                    cel, total, st_qa_mean = got
                    n_good = int(np.isfinite(cel).sum())
                    frac = n_good / total if total else 0.0
                    if qa_curve:
                        # Cheap proxy for the knee: how the count moves with the
                        # ceiling is monotone, so recording the realised frac at
                        # the shipped ceiling is enough to see whether it bites.
                        curve[round(frac, 1)] += 1
                    if frac < MIN_CELL_FRAC:
                        tally["thin"] += 1
                        continue
                    dt = props["datetime"]
                    hour_lst = (int(dt[11:13]) + int(dt[14:16]) / 60.0
                                + w.centre.lon / 15.0)
                    rows.append({
                        "scene_id": sid, "platform": props.get("platform", "?"),
                        "date": dt[:10], "time_utc": dt[11:19] + "Z",
                        "hour_lst": round(hour_lst, 2), "ward": w.id,
                        "lst_mean_c": round(float(np.nanmean(cel)), 3),
                        "lst_sd_c": round(float(np.nanstd(cel)), 3),
                        "cells": n_good, "cell_frac": round(frac, 4),
                        "st_qa_mean_k": round(st_qa_mean, 3),
                    })
                    tally["kept"] += 1
        except Exception as exc:                                  # noqa: BLE001
            tally["read_fail"] += 1
            print(f"    {sid}: {type(exc).__name__} {exc}"[:140])
            continue

        if scanned % 10 == 0:
            print(f"    …{scanned} scenes read, {tally['kept']} ward-rows kept")

    rows.sort(key=lambda r: (r["date"], r["ward"]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump({
            "source": "Landsat Collection 2 Level-2 via Microsoft Planetary Computer",
            "asset_keys": {"thermal": "lwir11", "st_qa": ST_QA_KEY,
                           "qa_pixel": QA_PIXEL_KEY},
            "mask": {"qa_bad_bits": "dilated_cloud|cirrus|cloud|shadow",
                     "st_qa_max_k": ST_QA_MAX_K,
                     "kelvin_range": [K_MIN, K_MAX],
                     "min_cell_frac": round(MIN_CELL_FRAC, 4)},
            "scenes": len({r["scene_id"] for r in rows}),
            "overpasses": len({r["date"] for r in rows}),
            "ward_scenes": len(rows),
            "rows": rows,
        }, fh, indent=1, allow_nan=False)

    print("\n  ── yield ──")
    print(f"    candidates (T1, cloud<{CLOUD_MAX}) : {len(items)}")
    for k in ("no_assets", "read_fail", "window_fail", "thin", "cached", "kept"):
        if tally[k]:
            print(f"    {k:<12} : {tally[k]}")
    print(f"    committed ward-scenes        : {len(rows)}")
    print(f"    distinct overpasses (dates)  : {len({r['date'] for r in rows})}")
    if qa_curve and curve:
        print("  ── cell_frac distribution (knee check) ──")
        for f in sorted(curve):
            print(f"    frac ~{f:.1f} : {curve[f]}")
    return 0


def check() -> int:
    """Assert-based self-check over the committed file. House rule: one runnable
    check beside non-trivial logic, no framework."""
    with open(OUT) as fh:
        doc = json.load(fh)
    rows = doc["rows"]
    assert rows, "no rows"
    seen: set[tuple[str, str]] = set()
    for r in rows:
        kx = (r["scene_id"], r["ward"])
        assert kx not in seen, f"duplicate {kx}"
        seen.add(kx)
        # Landsat's descending node crosses at ~10:30 local solar. Anything
        # outside this window is a time-base bug, and a time-base bug would
        # silently pool morning rows into the peak stratum.
        assert 9.5 <= r["hour_lst"] <= 11.5, f"{kx} hour_lst {r['hour_lst']}"
        assert 5.0 < r["lst_mean_c"] < 60.0, f"{kx} mean {r['lst_mean_c']}"
        assert 0.0 < r["cell_frac"] <= 1.0, f"{kx} frac {r['cell_frac']}"
        assert r["cell_frac"] >= MIN_CELL_FRAC - 1e-9, f"{kx} below floor"
        assert r["ward"] in _types.WARDS, f"{kx} unknown ward"
    years = {r["date"][:4] for r in rows}
    assert len(years) >= 2, f"only {years} covered — expected multi-year"
    print(f"  check OK: {len(rows)} ward-scenes · "
          f"{len({r['date'] for r in rows})} overpasses · years {sorted(years)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--probe", action="store_true",
                    help="P0: print asset keys, candidate yield, one header read")
    ap.add_argument("--sweep", action="store_true", help="P1: fetch and aggregate")
    ap.add_argument("--limit", type=int, help="cap scenes (smoke-test the sweep)")
    ap.add_argument("--yield-curve", action="store_true",
                    help="print the cell_frac distribution to site the floor")
    ap.add_argument("--check", action="store_true", help="assert over the committed file")
    a = ap.parse_args()
    if a.probe:
        return probe()
    if a.sweep:
        return sweep(a.limit, a.yield_curve)
    if a.check:
        return check()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
