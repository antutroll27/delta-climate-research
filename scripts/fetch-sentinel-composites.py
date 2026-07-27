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
import argparse, json, os, subprocess, sys
from collections import defaultdict

import numpy as np
import rasterio
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "dc-urs", "sentinel.json")
CACHE = os.path.expanduser("~/.cache/delta-climate/sentinel")

STAC = "https://earth-search.aws.element84.com/v1/search"
COLLECTION = "sentinel-2-l2a"
MAX_CLOUD = 25
SCENES_PER_YEAR = 6          # spread across seasons; median-reduced
FOOTPRINT_M = 1400

# FVC endmembers. NDVI of bare soil and of full canopy, the standard pair used
# with the source document's FVC definition (Carlson & Ripley 1997).
NDVI_BARE, NDVI_VEG = 0.05, 0.80

# Broadband albedo coefficients, exactly as the source document §3B specifies.
# This is a Liang (2001)-type narrowband-to-broadband conversion.
ALBEDO_W = {"blue": 0.356, "red": 0.130, "nir": 0.373, "swir16": 0.085, "swir22": 0.055}
BANDS = list(ALBEDO_W)

WARDS = {
    "ballygunge":  (22.528,  88.3659),
    "baruipur":    (22.3654, 88.4319),
    "barrackpore": (22.7621, 88.3713),
}


def search(lat: float, lon: float, year: int) -> list:
    """Lowest-cloud scenes for one year, spread across the calendar."""
    d = 0.02   # ~2 km box around the ward centre
    body = json.dumps({
        "collections": [COLLECTION],
        "bbox": [lon - d, lat - d, lon + d, lat + d],
        "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": MAX_CLOUD}},
        "limit": 100,
    })
    r = subprocess.run(["curl", "-s", "--max-time", "90", "-H", "Content-Type: application/json",
                        "-d", body, STAC], capture_output=True, text=True)
    if r.returncode != 0:
        return []
    try:
        feats = json.loads(r.stdout).get("features", [])
    except json.JSONDecodeError:
        return []

    # spread across months rather than taking the N cleanest, which would all
    # cluster in the dry season and reintroduce exactly the bias we are avoiding
    by_month = defaultdict(list)
    for f in feats:
        by_month[f["properties"]["datetime"][5:7]].append(f)
    picked = []
    for mth in sorted(by_month):
        best = min(by_month[mth], key=lambda f: f["properties"].get("eo:cloud_cover", 100))
        picked.append(best)
    step = max(1, len(picked) // SCENES_PER_YEAR)
    return picked[::step][:SCENES_PER_YEAR]


# Sentinel-2 mixes resolutions: blue/red/nir are 10 m, the SWIR bands 20 m. Read
# every band onto one 10 m grid so they can be combined pixel-for-pixel.
GRID = FOOTPRINT_M // 10          # 140 x 140


def read_window(href: str, lat: float, lon: float):
    """Read the ward window from a COG, resampled to the common grid."""
    try:
        with rasterio.open(href) as src:
            # COGs are in UTM; transform the ward box into the scene CRS
            from rasterio.warp import transform_bounds
            half = FOOTPRINT_M / 2
            dlat = half / 110_540.0
            dlon = half / (111_320.0 * np.cos(np.radians(lat)))
            l, b, r_, t = transform_bounds("EPSG:4326", src.crs,
                                           lon - dlon, lat - dlat, lon + dlon, lat + dlat)
            win = from_bounds(l, b, r_, t, src.transform)
            arr = src.read(1, window=win, out_dtype="float32",
                           out_shape=(GRID, GRID),
                           boundless=True, fill_value=0,
                           resampling=rasterio.enums.Resampling.bilinear)
            return arr if arr.size else None
    except Exception:
        return None


def scene_metrics(feat: dict, lat: float, lon: float):
    """NDVI and albedo arrays for one scene, or None if unreadable."""
    assets = feat["assets"]
    if not all(b in assets for b in BANDS):
        return None

    # BOA_ADD_OFFSET. Introduced at processing baseline 04.00; BEFORE that there is
    # no offset in the product at all, so there is nothing to remove.
    #
    # The gate must be on BASELINE, not on date. The archive is reprocessed, so a
    # 2021 acquisition appears twice — once as baseline 03.01 and again as a
    # reprocessed 05.00 — and the two need opposite treatment. Keying off the date
    # applied -0.1 to old-baseline scenes that never had it, and since a negative
    # offset RAISES NDVI (it shrinks the denominator), that inflated Barrackpore's
    # 2021 NDVI to 0.497 against 0.267-0.313 for every later year. It read as a
    # step change in land cover and was not one.
    props = feat["properties"]
    baseline = str(props.get("s2:processing_baseline", "99.99"))
    already = props.get("earthsearch:boa_offset_applied") is True
    offset = -1000.0 if (baseline >= "04.00" and not already) else 0.0

    refl = {}
    for b in BANDS:
        dn = read_window(assets[b]["href"], lat, lon)
        if dn is None:
            return None
        r = (dn + offset) / 10_000.0
        refl[b] = np.clip(r, 0, 1.5)

    valid = refl["nir"] + refl["red"] > 0.02          # drop nodata / deep shadow
    if valid.mean() < 0.5:
        return None

    ndvi = np.where(valid, (refl["nir"] - refl["red"]) / (refl["nir"] + refl["red"] + 1e-9), np.nan)
    albedo = sum(w * refl[b] for b, w in ALBEDO_W.items())
    albedo = np.where(valid, albedo, np.nan)
    return float(np.nanmedian(ndvi)), float(np.nanmedian(albedo))


def ward(name: str, lat: float, lon: float, years: list[int]) -> dict:
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
        "per_year": {y: {k: round(v, 4) if isinstance(v, float) else v
                         for k, v in annual[str(y)].items()}
                     for y in years if str(y) in annual},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=6)
    ap.add_argument("--ward", default=None)
    args = ap.parse_args()

    years = list(range(2026 - args.years, 2026))
    todo = {args.ward: WARDS[args.ward]} if args.ward else WARDS

    out = {
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
