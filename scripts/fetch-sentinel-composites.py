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
Only the pixel window covering each ward is read, via HTTP range
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

WARD 68 (2026-10-02). For a ward with an administrative polygon
(scripts/_wardmask.py) each scene is reduced over the 10 m cells whose centre
lies inside the POLYGON — the same median, the same masking, only the cells
differ — and the ward record is built from those. The square's record is kept
under `square`. The per-ward cache is keyed by the window and the mask, so a
ward that moves can never be served the old window's annual medians.

Output: data/dc-urs/sentinel.json
"""
import argparse
import json
import os
import sys
from typing import cast

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
import _wardmask  # noqa: E402
# Search, the windowed reader and the per-scene arrays now live in _sentinel,
# shared with export-surface-rasters.py. This file owns one thing: the reduction
# of those arrays to the ward scalars DC-URS scores on.
# The ward table comes from _types, which is the only Python ward table that
# carries `footprint_m` — and the footprint is now required to size a read.
# _sentinel's own copy was a third one and is gone; see the note in its place.
from _sentinel import (  # noqa: E402
    ALBEDO_W, CACHE, MAX_CLOUD, NDVI_BARE, NDVI_VEG, SCENES_PER_YEAR,
    grid_for, scene_arrays, scene_metrics, search,
)

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "dc-urs", "sentinel.json")

def ward(name: str, lat: float, lon: float, footprint_m: int,
         years: list[int]) -> _types.SentinelWard:
    os.makedirs(CACHE, exist_ok=True)
    w = _types.WARDS[name]
    mask = _wardmask.mask_grid(w, grid_for(footprint_m), rows="north-up")
    # A ward without a polygon keeps its historical cache name, so its committed
    # medians stay reproducible from the cache that made them; a masked ward's
    # name carries its window and the mask, so a moved ward misses and refetches.
    key = name if mask is None else f"{name}-{footprint_m}m-{lat:.6f}-{lon:.6f}-polygon"
    cache = os.path.join(CACHE, f"{key}.json")
    if os.path.exists(cache):
        with open(cache) as fh:
            annual = json.load(fh)
    else:
        annual = {}

    for y in years:
        if str(y) in annual:
            continue
        feats = search(lat, lon, y, footprint_m)
        vals: list[tuple[float, float]] = []
        sq: list[tuple[float, float]] = []
        for f in feats:
            if mask is None:
                m = scene_metrics(f, lat, lon, footprint_m)
                if m:
                    vals.append(m)
                continue
            # ONE read per scene, reduced twice: the polygon and the square.
            got = scene_arrays(f, lat, lon, footprint_m)
            if got is None:
                continue
            ndvi_a, alb_a = got
            if not np.isfinite(ndvi_a[mask]).any():
                continue
            vals.append((float(np.nanmedian(ndvi_a[mask])), float(np.nanmedian(alb_a[mask]))))
            sq.append((float(np.nanmedian(ndvi_a)), float(np.nanmedian(alb_a))))
        if vals:
            annual[str(y)] = {
                "ndvi": float(np.median([v[0] for v in vals])),
                "albedo": float(np.median([v[1] for v in vals])),
                "scenes": len(vals),
            }
            if sq:
                annual[str(y)]["square_ndvi"] = float(np.median([v[0] for v in sq]))
                annual[str(y)]["square_albedo"] = float(np.median([v[1] for v in sq]))
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
    extra: dict[str, object] = {}
    if mask is not None:
        sq_ndvi = np.array([u["square_ndvi"] for u in used])
        sq_mean = float(sq_ndvi.mean())
        extra = {
            "domain": (f"KMC Ward {_wardmask.POLYGONS[name][1]} polygon "
                       f"({int(mask.sum()):,} of {mask.size:,} 10 m cells, by cell centre)"),
            "square": {
                "ndvi_mean": round(sq_mean, 4),
                "ndvi_std": round(float(sq_ndvi.std(ddof=1)), 4),
                "fvc": round(float(np.clip((sq_mean - NDVI_BARE) / (NDVI_VEG - NDVI_BARE), 0, 1)), 4),
                "albedo": round(float(np.median([u["square_albedo"] for u in used])), 4),
            },
        }
    rec: _types.SentinelWard = {
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
    if extra:
        rec["domain"] = str(extra["domain"])
        rec["square"] = cast(dict[str, float], extra["square"])
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=6)
    ap.add_argument("--ward", default=None)
    args = ap.parse_args()

    years = list(range(2026 - args.years, 2026))
    todo = {args.ward: _types.WARDS[args.ward]} if args.ward else _types.WARDS

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
    for wid, rec in todo.items():
        print(f"  {wid}:")
        out["wards"][wid] = ward(wid, rec.centre.lat, rec.centre.lon, rec.footprint_m, years)

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
