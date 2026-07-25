#!/usr/bin/env python3
"""
ECOSTRESS night-time LST census over the Kolkata study wards.

Answers: how many scenes are HONESTLY usable, once cloud and quality masks are
applied — not just how many exist. Then reports per-ward temperatures.

    python3 scripts/ecostress-census.py [--limit N] [--day] [--from YYYY-MM-DD]

Auth: reads an Earthdata Login bearer token from
      ~/.config/delta-climate/earthdata-token (0600, never printed, never in git).
      Regenerate at urs.earthdata.nasa.gov; they last ~60 days.

Why not Google Earth Engine: the GEE ECOSTRESS collection covers Los Angeles
only. Kolkata must come from NASA CMR + LP DAAC.

Data gotchas this script encodes (each cost real debugging time):
  * L2T v002 LST COGs are float32 KELVIN with NaN nodata. They are NOT uint16
    needing scale 0.02 — applying that yields ≈ −267 °C.
  * Mask with np.isfinite(), never `> threshold`: NaN comparisons are all False.
  * GDAL /vsicurl drops the auth header across LP DAAC's redirect and returns a
    misleading 404, so we curl the file down and open it locally.
  * The QC band's cloud bits (5&4) are UNSET in v002. NASA issued an alert that
    QC "does not account for clouds"; their own tutorial still ships v001 labels.
    Cloud must come from the separate cloud.tif, where 1 = cloudy.
  * Kolkata spans tiles 45QXE (south, incl. Baruipur) and 45QXF (north). They
    overlap ~9.8 km, so acquisitions are deduplicated by timestamp.
"""
import argparse, json, os, subprocess, sys, urllib.parse, warnings
from collections import defaultdict

import numpy as np
import rasterio
from rasterio.warp import transform_bounds, reproject, Resampling
from rasterio.transform import from_origin

warnings.filterwarnings("ignore")
np.seterr(all="ignore")

BBOX = (88.30, 22.36, 88.45, 22.77)          # all three ward centroids + margin
WARDS = {
    "Ballygunge":  (22.528, 88.366),
    "Baruipur":    (22.365, 88.432),
    "Barrackpore": (22.762, 88.371),
}
CACHE = os.path.expanduser("~/.cache/delta-climate/ecostress")
TOKEN_PATH = os.path.expanduser("~/.config/delta-climate/earthdata-token")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"

# QC bit fields, ECOSTRESS L2 User Guide v002 Table 6 (bit 0 = LSB)
QC_MANDATORY = {0: "produced by TES", 1: "produced, caveat", 2: "(unset)", 3: "NOT PRODUCED"}
QC_LST_ACC = {0: ">2 K poor", 1: "1.5-2 K marginal", 2: "1-1.5 K good", 3: "<1 K excellent"}


def token() -> str:
    if not os.path.exists(TOKEN_PATH):
        sys.exit(f"No Earthdata token at {TOKEN_PATH}. Generate one at urs.earthdata.nasa.gov.")
    return open(TOKEN_PATH).read().strip()


def cmr_search(day_night: str, start: str, limit: int, end: str = "") -> list:
    """Distinct acquisitions, newest first. Deduplicated across the two tiles."""
    params = {
        "short_name": "ECO_L2T_LSTE", "version": "002",
        "bounding_box": ",".join(map(str, BBOX)),
        "temporal": f"{start}T00:00:00Z,{end + 'T00:00:00Z' if end else ''}",
        "day_night_flag": day_night, "page_size": "200",
        "sort_key": "-start_date",
    }
    out = subprocess.run(
        ["curl", "-s", "-H", "User-Agent: DeltaClimateResearch/1.0",
         f"{CMR}?{urllib.parse.urlencode(params)}"],
        capture_output=True, text=True, timeout=180).stdout
    items = json.loads(out).get("items", [])
    by_time = defaultdict(list)
    for it in items:
        u = it["umm"]
        by_time[u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:19]].append(u)
    return sorted(by_time.items(), reverse=True)[:limit]


def fetch(url: str, tok: str) -> str | None:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rsplit("/", 1)[-1])
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return path
    rc = subprocess.run(
        ["curl", "-sL", "--fail", "-H", f"Authorization: Bearer {tok}",
         "-H", "User-Agent: DeltaClimateResearch/1.0", "-o", path, url],
        timeout=600).returncode
    if rc != 0 or not os.path.exists(path) or os.path.getsize(path) < 2000:
        if os.path.exists(path):
            os.remove(path)
        return None
    return path


def band_url(granule: dict, suffix: str) -> str | None:
    return next((u["URL"] for u in granule.get("RelatedUrls", [])
                 if u.get("URL", "").startswith("https") and u["URL"].endswith(suffix)), None)


# Fixed target grid. The two MGRS tiles share a CRS but not an origin, so
# window-reading each one gives different shapes and they cannot be combined.
# Reprojecting both onto one grid fixes that and handles the ~9.8 km overlap.
TARGET_CRS = "EPSG:32645"          # UTM 45N — Kolkata
TARGET_RES = 70.0                  # native ECOSTRESS L2T resolution


def target_grid():
    l, b, r, t = transform_bounds("EPSG:4326", TARGET_CRS, *BBOX, densify_pts=21)
    w = int(np.ceil((r - l) / TARGET_RES))
    h = int(np.ceil((t - b) / TARGET_RES))
    return from_origin(l, t, TARGET_RES, TARGET_RES), w, h


def read_window(path: str, nodata=np.nan, dtype="float32"):
    """Reproject a COG band onto the shared target grid. Returns (array, transform, crs)."""
    tf, w, h = target_grid()
    dst = np.full((h, w), nodata, dtype=dtype)
    with rasterio.open(path) as src:
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=tf, dst_crs=TARGET_CRS,
            resampling=Resampling.nearest,      # never interpolate across cloud edges
            src_nodata=src.nodata, dst_nodata=nodata,
        )
    return dst, tf, rasterio.crs.CRS.from_string(TARGET_CRS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--day", action="store_true", help="daytime instead of night")
    ap.add_argument("--from", dest="start", default="2024-01-01")
    ap.add_argument("--to", dest="end", default="", help="YYYY-MM-DD, exclusive")
    args = ap.parse_args()

    tok = token()
    flag = "day" if args.day else "night"
    acqs = cmr_search(flag, args.start, args.limit, args.end)
    span = f"{args.start} .. {args.end or 'now'}"
    print(f"ECOSTRESS L2T LSTE v002 · {flag} · {span} · Kolkata ward bbox")
    print(f"{len(acqs)} distinct acquisitions (tiles deduplicated)\n")
    print(f"{'acquired (UTC)':<18}{'raw%':>7}{'cloud%':>8}{'usable%':>9}{'mean':>7}{'min':>7}{'max':>7}   wards")
    print("-" * 104)

    usable, rows = 0, []
    for when, grans in acqs:
        # Evaluate each tile INDEPENDENTLY, then merge the results. Masking after
        # merging the raw bands is wrong: where a tile has no coverage its QC
        # reads as fill, and OR-ing "bad" across tiles condemns the whole scene.
        tf = crs = None
        merged_c = merged_raw = merged_cloud = None
        acc_hist = defaultdict(int)
        for g in grans:
            u_lst, u_cld, u_qc = (band_url(g, s) for s in ("_LST.tif", "_cloud.tif", "_QC.tif"))
            if not u_lst:
                continue
            p_lst = fetch(u_lst, tok)
            if not p_lst:
                continue
            a, t_, c_ = read_window(p_lst)
            if a is None:
                continue
            tf, crs = t_, c_

            raw_t = np.isfinite(a) & (a > 200) & (a < 400)
            cloud_t = np.zeros_like(raw_t)
            p = fetch(u_cld, tok) if u_cld else None
            if p is not None:
                cloud_t = read_window(p, nodata=255, dtype="uint16")[0] == 1   # 1 = cloudy

            qc_ok_t = np.ones_like(raw_t)
            p = fetch(u_qc, tok) if u_qc else None
            if p is not None:
                q = read_window(p, nodata=0xFFFF, dtype="uint16")[0]
                qc_ok_t = (q != 0xFFFF) & ((q & 0b11) == 0)     # mandatory QA == 00
                for k in range(4):
                    acc_hist[k] += int((raw_t & (q != 0xFFFF) & (((q >> 14) & 0b11) == k)).sum())

            good_t = raw_t & ~cloud_t & qc_ok_t
            c_t = np.where(good_t, a - 273.15, np.nan)
            if merged_c is None:
                merged_c, merged_raw, merged_cloud = c_t, raw_t, cloud_t & raw_t
            else:                                        # first valid pixel wins
                merged_c = np.where(np.isfinite(merged_c), merged_c, c_t)
                merged_raw |= raw_t
                merged_cloud |= (cloud_t & raw_t)
        if merged_c is None:
            continue

        raw, cloudy = merged_raw, merged_cloud
        good = np.isfinite(merged_c)
        celsius = merged_c
        if good.sum() < 50:
            print(f"{when[:16].replace('T',' '):<18}{100*raw.mean():>6.1f}%{100*cloudy.mean():>7.1f}%"
                  f"{100*good.mean():>8.1f}%      — below usable threshold")
            continue

        usable += 1
        v = celsius[np.isfinite(celsius)]
        reads = []
        for nm, (la, lo) in WARDS.items():
            x, y, _, _ = transform_bounds("EPSG:4326", crs, lo, la, lo, la)
            col, row = int((x - tf.c) / tf.a), int((y - tf.f) / tf.e)
            if 0 <= row < celsius.shape[0] and 0 <= col < celsius.shape[1] and np.isfinite(celsius[row, col]):
                reads.append(f"{nm[:4]} {celsius[row, col]:.1f}")
        print(f"{when[:16].replace('T',' '):<18}{100*raw.mean():>6.1f}%{100*cloudy.mean():>7.1f}%"
              f"{100*good.mean():>8.1f}%{v.mean():>7.1f}{v.min():>7.1f}{v.max():>7.1f}   {' · '.join(reads)}")
        rows.append((when, good.mean(), v.mean(), acc_hist))

    print("-" * 104)
    print(f"\n{usable} of {len(acqs)} acquisitions usable after cloud + quality masking")
    if rows:
        best = max(rows, key=lambda r: r[1])
        print(f"best coverage: {best[0][:16].replace('T',' ')} UTC — "
              f"{100*best[1]:.1f}% usable, mean {best[2]:.1f} °C")
        tot = defaultdict(int)
        for _, _, _, h in rows:
            for k, c in h.items():
                tot[k] += c
        s = sum(tot.values()) or 1
        print("\nLST accuracy across all usable pixels (QC bits 15&14):")
        for k in range(4):
            if tot[k]:
                print(f"  {QC_LST_ACC[k]:<20} {100*tot[k]/s:>6.1f}%")
    print(f"\ncache: {CACHE}")


if __name__ == "__main__":
    main()
