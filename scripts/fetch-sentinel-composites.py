#!/usr/bin/env python3
"""
Sentinel-2 vegetation and albedo inputs for DC-URS.

    python3 scripts/fetch-sentinel-composites.py [--years 6] [--ward ballygunge]

Produces, per ward:
    fvc         fractional vegetation cover, 0-1
    ndvi_mean   multi-year mean NDVI      ┐ together these give the
    ndvi_std    multi-year std of NDVI    ┘ Vegetation Stability Index
    albedo      broadband surface albedo, 0-1

NO CREDENTIALS. AWS earth-search STAC over the public `sentinel-cogs` bucket.
Only the ~140x140 pixel window covering each ward is read, via HTTP range
requests into the COGs, so the whole job moves a few MB rather than whole scenes.

SEASONALITY IS NOT OPTIONAL. Kolkata's NDVI swings hard between monsoon and dry
season — the same seasonal signal measured in the thermal work. A single scene
would report whichever season it happened to be taken in. So each YEAR is
reduced to a median over that year's usable scenes, and the reported value is the
median across years. Czekajlo et al. (2020), whose greenness score this pillar
descends from, used 33 years of annual composites for exactly this reason.

VSI needs a multi-year baseline, so ndvi_mean/ndvi_std are computed ACROSS YEARS,
not across scenes within a year. Year-to-year variation is persistence; within-
year variation is just the monsoon.

PROCESSING BASELINE. From 2022-01-25 Sentinel-2 L2A carries BOA_ADD_OFFSET =
-1000. Ignoring it inflates reflectance by 0.1 and would silently bias every
index computed from post-2022 scenes. Handled per scene from its own metadata.

Output: data/dc-urs/sentinel.json
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
# Search, the windowed reader and the per-scene arrays now live in _sentinel,
# shared with export-surface-rasters.py. This file owns one thing: the reduction
# of those arrays to the ward scalars DC-URS scores on.
from _sentinel import (  # noqa: E402
    ALBEDO_W, BANDS, CACHE, FOOTPRINT_M, GRID, MAX_CLOUD, NDVI_BARE, NDVI_VEG,
    SCENES_PER_YEAR, WARDS, read_window, scene_arrays, scene_metrics, search,
)

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "dc-urs", "sentinel.json")

def ward(name: str, lat: float, lon: float, years: list[int]) -> _types.SentinelWard:
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, f"{name}.json")
    if os.path.exists(cache):
        with open(cache) as fh:
            annual = json.load(fh)
    else:
        annual = {}

    for y in years:
        if str(y) in annual:
            continue
        feats = search(lat, lon, y)
        vals = []
        for f in feats:
            m = scene_metrics(f, lat, lon)
            if m:
                vals.append(m)
        if vals:
            annual[str(y)] = {
                "ndvi": float(np.median([v[0] for v in vals])),
                "albedo": float(np.median([v[1] for v in vals])),
                "scenes": len(vals),
            }
            print(f"    {name} {y}: {len(vals)} scenes  NDVI {annual[str(y)]['ndvi']:.3f}"
                  f"  albedo {annual[str(y)]['albedo']:.3f}")
        else:
            print(f"    {name} {y}: no usable scenes")
        with open(cache, "w") as fh:
            json.dump(annual, fh, indent=2)

    used = [annual[str(y)] for y in years if str(y) in annual]
    if len(used) < 3:
        sys.exit(f"{name}: only {len(used)} usable years — VSI needs a multi-year baseline. "
                 f"Refusing to emit a stability figure from too little history.")

    ndvis = np.array([u["ndvi"] for u in used])
    ndvi_mean = float(ndvis.mean())
    fvc = float(np.clip((ndvi_mean - NDVI_BARE) / (NDVI_VEG - NDVI_BARE), 0, 1))
    return {
        "ndvi_mean": round(ndvi_mean, 4),
        "ndvi_std": round(float(ndvis.std(ddof=1)), 4),
        "fvc": round(fvc, 4),
        "albedo": round(float(np.median([u["albedo"] for u in used])), 4),
        "years": len(used),
        "scenes_total": sum(u["scenes"] for u in used),
        # str(y), not y. json.dump silently stringifies int keys on write, so
        # the dict in memory was keyed by int and the identical dict read back
        # from disk was keyed by str — the round-trip was not an identity, and
        # any in-process consumer would miss on `per_year["2021"]`.
        "per_year": {str(y): _types.SentinelYear(
            ndvi=round(float(annual[str(y)]["ndvi"]), 4),
            albedo=round(float(annual[str(y)]["albedo"]), 4),
            scenes=int(annual[str(y)]["scenes"]),
        ) for y in years if str(y) in annual},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=6)
    ap.add_argument("--ward", default=None)
    args = ap.parse_args()

    years = list(range(2026 - args.years, 2026))
    todo = {args.ward: WARDS[args.ward]} if args.ward else WARDS

    out: _types.SentinelFile = {
        "source": "Sentinel-2 L2A via AWS earth-search STAC / public sentinel-cogs bucket (keyless)",
        "method": f"Per year, up to {SCENES_PER_YEAR} scenes spread across months with cloud < "
                  f"{MAX_CLOUD}%, median-reduced to one value per year. Reported NDVI is the mean "
                  f"across years; ndvi_std is the ACROSS-YEAR std, which is what VSI means by "
                  f"persistence. Within-year spread is just the monsoon.",
        "fvc": f"(NDVI - {NDVI_BARE}) / ({NDVI_VEG} - {NDVI_BARE}), clipped to [0,1] "
               f"(Carlson & Ripley 1997 endmembers)",
        "albedo": "source document §3B coefficients, a Liang (2001)-type narrowband-to-broadband "
                  "conversion: " + ", ".join(f"{w} {b}" for b, w in ALBEDO_W.items()),
        "baseline_offset": "BOA_ADD_OFFSET = -1000 applied for processing baseline 04.00 "
                           "(2022-01-25 onward); ignoring it would inflate reflectance by 0.1",
        "provenance": "measured",
        "years_requested": years,
        "wards": {},
    }
    for w, (lat, lon) in todo.items():
        print(f"  {w}:")
        out["wards"][w] = ward(w, lat, lon, years)

    if args.ward:                      # merge into an existing file
        if os.path.exists(OUT):
            with open(OUT) as fh:
                prev = json.load(fh)
            prev["wards"].update(out["wards"])
            out = prev
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"\n  {'ward':<14}{'NDVI':>8}{'sd':>8}{'FVC':>8}{'albedo':>9}{'yrs':>5}")
    for w, v in out["wards"].items():
        print(f"  {w:<14}{v['ndvi_mean']:>8.3f}{v['ndvi_std']:>8.3f}"
              f"{v['fvc']:>8.3f}{v['albedo']:>9.3f}{v['years']:>5}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
