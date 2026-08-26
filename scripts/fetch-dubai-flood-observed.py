"""Observed flood extent for Dubai, April 2024, from Landsat 8/9.

THE FIRST OBSERVATION THIS MODEL HAS EVER BEEN SCORED AGAINST. Everything in
validate-flood-stability.py measures REPRODUCIBILITY under terrain error, not
correctness. There is no gauge network for Dubai, and the "2024 flood districts"
list that circulates is Gulf News, September 2018 — a trap this repo already
walked into once. This is the only route to a real extent.

WHY LANDSAT AND NOT SAR. Sentinel-1 never flew the peak: only S1A was operating
(S1B failed 2021, S1C launched Dec 2024), giving 12-day revisit, and the
acquisitions bracket the event at 15 Apr and 24 Apr — a 9.5-day gap straight
through it. Copernicus EMS was never activated for the UAE. Copernicus GFM
structurally excludes deserts and urban areas in its own Product User Manual.
Landsat is what exists.

WHY CHANGE DETECTION AND NOT A THRESHOLD. Absolute water indices are unstable
here: measured, dry-season "permanent" water varies 54-97 km2 between cloud-free
scenes because of Gulf turbidity, sun glint and sabkha salt crust. Differencing
two dates cancels all three, because they are present in both. A fixed MNDWI
threshold would produce a confident number that means nothing.

THREE DATES, BECAUSE TWO ONLY TEST EXTENT.

    2024-03-18  LC09 160/043   0.11 % cloud   baseline, dry
    2024-04-19  LC09 160/043   0.03 % cloud   flood, 3 days after the rain
    2024-04-27  LC08 160/043   0.38 % cloud   recovery, 11 days after

THE BASELINE IS LANDSAT 9, DELIBERATELY. The obvious choice was 11 April, five
days before the rain — but that scene is Landsat 8 (OLI), and the flood scene is
Landsat 9 (OLI-2), so every difference would carry a cross-sensor term. Planetary
Computer also does not hold the 11 April row-043 scene at all; only Element84
lists it, behind requester-pays S3.

18 March is LC09 at 0.11 % cloud — SAME SENSOR as the flood scene, and the
cleanest pre-event scene of the twelve available. A month's separation is
immaterial on a hyper-arid surface, and it is unambiguously before the event
(3 April, also LC09, sits closer but at 2.92 % cloud and nearer the pre-event
rain; it is kept as a sensitivity check via --baseline).

The recovery scene is what lets us separate "the model is wrong" from "30 m
cannot see a flooded street". If modelled drainage tracks 19 -> 27 April even
where absolute extent disagrees, the physics is right and the sensor is coarse.

ROW 043 ALONE COVERS 100 % OF THE WINDOW — measured against the scene footprints,
because the AOI also intersects row 042 at 56 % and a naive search returns both.
Same path/row on all three dates means identical geometry and no reprojection
between them.

TWO ENDPOINTS, DELIBERATELY. Element84 is searched because it lists the 11 April
row-043 scene that Planetary Computer does not; MPC is read because Element84's
assets are all `storage:requester_pays` (S3, needs credentials) while MPC signs
anonymously over HTTPS with range requests.

CAVEATS THAT MUST REACH ANY SCORE COMPUTED FROM THIS.
  · Peak vs residual. The model reports PEAK depth during the storm; this is
    3 days later. Hong 2026 measured ~95 % of flooded area still wet at day 3,
    which is what makes it usable, but they are not the same quantity.
  · Cross-sensor, PARTLY DESIGNED OUT. Baseline and flood are both Landsat 9
    (OLI-2), so that pair carries no sensor term. The recovery scene is
    Landsat 8 (OLI) because no LC09 row-043 scene exists at that date, so the
    drainage comparison alone retains a residual cross-sensor bias.
  · Sub-pixel. At 30 m, water in a street between buildings does not register.
    The published work (Hong 2026) used 3 m PlanetScope with a trained
    classifier for exactly this reason.

    python3 scripts/fetch-dubai-flood-observed.py
    python3 scripts/fetch-dubai-flood-observed.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import SITES, Site, site_bounds  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "public", "flood-sim", "data")

E84 = "https://earth-search.aws.element84.com/v1/search"
MPC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
MPC_SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"

WRS_ROW = "043"          # covers 100 % of the window on its own — measured
BASELINE_DEFAULT = "2024-03-18"      # LC09, 0.11 % cloud — same sensor as the flood
BASELINE_ALT = "2024-04-03"         # LC09, 2.92 % cloud — sensitivity check
DATES = {
    "baseline": BASELINE_DEFAULT,
    "flood": "2024-04-19",
    "recovery": "2024-04-27",
}

# Collection-2 Level-2 surface reflectance is stored scaled; USGS documents
# these exact constants. Skipping them leaves DN in the tens of thousands and
# MNDWI still "works" by accident because it is a normalised ratio — which is
# precisely the kind of silent wrongness worth spelling out.
SR_SCALE, SR_OFFSET = 0.0000275, -0.2

# QA_PIXEL bit positions, Landsat Collection 2 Level-2.
QA_FILL, QA_DILATED, QA_CIRRUS, QA_CLOUD, QA_SHADOW, QA_SNOW, QA_CLEAR, QA_WATER = range(8)

# MNDWI rise that counts as newly-inundated. Not a water threshold — a CHANGE
# threshold, so the sabkha's own bright crust and the Gulf's turbidity cancel.
# 0.15 is deliberately conservative; the artefact also carries the raw delta so
# the cut can be re-argued without re-fetching 250 MB.
DELTA_MNDWI_WET = 0.15

LICENCE = "Public domain (USGS Landsat, no restrictions)"
ATTRIBUTION = ("Landsat 8-9 Collection 2 Level-2 surface reflectance courtesy of the "
               "U.S. Geological Survey. Accessed via Microsoft Planetary Computer.")


def search_scene(site: Site, date: str) -> dict[str, Any]:
    """Find the row-043 scene for one date. Element84 first — it lists more."""
    w, s, e, n = site_bounds(site)
    body = {"collections": ["landsat-c2-l2"], "bbox": [w, s, e, n],
            "datetime": f"{date}T00:00:00Z/{date}T23:59:59Z", "limit": 10}
    for url in (E84, MPC):
        try:
            r = requests.post(url, json=body, timeout=120)
            if r.status_code != 200:
                continue
            for f in r.json().get("features", []):
                if f["properties"].get("landsat:wrs_row") == WRS_ROW:
                    return dict(f)
        except requests.RequestException:
            continue
    raise SystemExit(f"no row-{WRS_ROW} Landsat scene found for {date}")


def mpc_asset(date: str, band: str) -> str:
    """Signed HTTPS href from Planetary Computer.

    Element84's own hrefs are s3://usgs-landsat/... with storage:requester_pays
    set on every asset, so they need AWS credentials. MPC signs anonymously.
    """
    r = requests.post(MPC, json={"collections": ["landsat-c2-l2"],
                                 "bbox": list(site_bounds(SITES["dubai-creek"])),
                                 "datetime": f"{date}T00:00:00Z/{date}T23:59:59Z",
                                 "limit": 10}, timeout=120)
    feats = [f for f in r.json().get("features", [])
             if f["properties"].get("landsat:wrs_row") == WRS_ROW]
    if not feats:
        raise SystemExit(f"Planetary Computer has no row-{WRS_ROW} scene for {date}")
    href = feats[0]["assets"][band]["href"]
    signed = requests.get(MPC_SIGN, params={"href": href}, timeout=60)
    signed.raise_for_status()
    return str(signed.json()["href"])


def read_band(site: Site, date: str, band: str, n: int) -> np.ndarray[Any, Any]:
    """One band, windowed to the site and resampled onto the analytical grid."""
    with rasterio.open(mpc_asset(date, band)) as src:
        w, s, e, nn = site_bounds(site)
        wl, sl, el, nl = transform_bounds("EPSG:4326", src.crs, w, s, e, nn)
        win = window_from_bounds(wl, sl, el, nl, src.transform)
        arr = src.read(1, window=win, out_shape=(n, n),
                       resampling=Resampling.bilinear).astype("float64")
    # rasterio's window read puts row 0 NORTH; the analytical grid is south-up.
    # This is the exact mismatch that left the terrain mirrored against its own
    # buildings until 2026-08-26 — see fetch-dubai-terrain.py.
    out: np.ndarray[Any, Any] = arr[::-1]
    return out


def scene_arrays(site: Site, date: str, n: int) -> dict[str, np.ndarray[Any, Any]]:
    """MNDWI, a validity mask, and QA's own water flag for one date."""
    green = read_band(site, date, "green", n) * SR_SCALE + SR_OFFSET
    swir = read_band(site, date, "swir16", n) * SR_SCALE + SR_OFFSET
    qa = read_band(site, date, "qa_pixel", n).astype("uint16")

    denom = green + swir
    mndwi = np.where(np.abs(denom) > 1e-6, (green - swir) / np.where(np.abs(denom) > 1e-6, denom, 1.0), np.nan)

    bad = (
        ((qa >> QA_FILL) & 1).astype(bool)
        | ((qa >> QA_DILATED) & 1).astype(bool)
        | ((qa >> QA_CIRRUS) & 1).astype(bool)
        | ((qa >> QA_CLOUD) & 1).astype(bool)
        | ((qa >> QA_SHADOW) & 1).astype(bool)
    )
    return {
        "mndwi": mndwi,
        "valid": (~bad) & np.isfinite(mndwi),
        "qaWater": ((qa >> QA_WATER) & 1).astype(bool),
    }


def build(site: Site) -> dict[str, Any]:
    n = site.grid_n
    scenes = {}
    for label, date in DATES.items():
        meta = search_scene(site, date)
        print(f"    {label:9s} {date}  {meta['id']}  "
              f"cloud {meta['properties'].get('eo:cloud_cover', 0):.2f} %")
        scenes[label] = scene_arrays(site, date, n)
        scenes[label]["id"] = meta["id"]

    base, flood, recov = scenes["baseline"], scenes["flood"], scenes["recovery"]

    # Cells usable in the pair that matters. A cloud on EITHER date makes the
    # difference meaningless, so validity is an AND, not an OR.
    usable = base["valid"] & flood["valid"]
    delta = np.where(usable, flood["mndwi"] - base["mndwi"], np.nan)

    # Permanent water: wet in QA on BOTH the baseline and the recovery scene.
    # Deriving it from the imagery rather than from elevation keeps this
    # independent of the terrain the model runs on — the whole point of a
    # validation source is that it does not share the model's assumptions.
    permanent = base["qaWater"] & recov["qaWater"]

    wet = np.where(usable, (delta > DELTA_MNDWI_WET) & ~permanent, False)

    usable_r = base["valid"] & recov["valid"]
    delta_r = np.where(usable_r, recov["mndwi"] - base["mndwi"], np.nan)
    wet_r = np.where(usable_r, (delta_r > DELTA_MNDWI_WET) & ~permanent, False)

    cell_km2 = (site.footprint_m / n) ** 2 / 1e6
    land = ~permanent
    return {
        "site": site.id,
        "source": "Landsat 8/9 Collection 2 Level-2 surface reflectance, WRS-2 path 160 row 043",
        "licence": LICENCE,
        "attribution": ATTRIBUTION,
        "method": (f"MNDWI change from {DATES['baseline']} to {DATES['flood']}, "
                   f"threshold +{DELTA_MNDWI_WET}; permanent water excluded via QA_PIXEL "
                   f"water flag set on both baseline and recovery"),
        "n": n,
        "cellM": round(site.footprint_m / n, 4),
        "footprintM": site.footprint_m,
        "centre": [site.lon, site.lat],
        "scenes": {k: {"date": DATES[k], "id": scenes[k]["id"]} for k in DATES},
        "deltaThreshold": DELTA_MNDWI_WET,
        "usableFraction": round(float(usable.mean()), 4),
        "permanentWaterFraction": round(float(permanent.mean()), 4),
        "floodedCells": int(wet.sum()),
        "floodedKm2": round(float(wet.sum()) * cell_km2, 3),
        "floodedFractionOfLand": round(float(wet.sum()) / max(int(land.sum()), 1), 5),
        "recoveryFloodedCells": int(wet_r.sum()),
        "recoveryKm2": round(float(wet_r.sum()) * cell_km2, 3),
        "limitation": (
            "Observed 3 days after the rain, not at peak; the model reports peak "
            "depth. At 30 m, water in streets between buildings is sub-pixel — "
            "published work on this event used 3 m PlanetScope with a trained "
            "classifier. Baseline is Landsat 8 OLI, flood is Landsat 9 OLI-2; "
            "Collection 2 harmonises them but a residual cross-sensor bias is "
            "possible. A low agreement score is therefore ambiguous between model "
            "error and sensor limit — the recovery scene is what separates them."
        ),
        "wet": [int(v) for v in wet.ravel()],
        "wetRecovery": [int(v) for v in wet_r.ravel()],
        "deltaMndwi": [None if not np.isfinite(v) else round(float(v), 4) for v in delta.ravel()],
    }


def check() -> int:
    fails: list[str] = []
    for sid, site in SITES.items():
        path = os.path.join(OUT_DIR, f"{sid}-flood-observed.json")
        if not os.path.exists(path):
            fails.append(f"{sid}: artefact missing — run without --check first")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        n = site.grid_n
        for key in ("wet", "wetRecovery", "deltaMndwi"):
            if len(d[key]) != n * n:
                fails.append(f"{sid}: {key} is {len(d[key])}, expected {n*n}")
        if d["usableFraction"] < 0.80:
            fails.append(f"{sid}: only {100*d['usableFraction']:.0f}% of cells are cloud-free "
                         f"on BOTH dates — the difference is mostly gaps")
        # Recovery must not exceed the flood scene. If it does, the change
        # detection is picking up something that is not drainage.
        if d["recoveryFloodedCells"] > d["floodedCells"]:
            fails.append(f"{sid}: recovery ({d['recoveryFloodedCells']:,}) wetter than the flood "
                         f"scene ({d['floodedCells']:,}) — that is not drainage")
        if d["floodedCells"] == 0:
            fails.append(f"{sid}: zero flooded cells — threshold or band mapping is wrong")
        if d["permanentWaterFraction"] > 0.60:
            fails.append(f"{sid}: {100*d['permanentWaterFraction']:.0f}% flagged permanent water "
                         f"— QA water bit is likely misread")
    if fails:
        for line in fails:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-flood-observed.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        print(f"  OK {sid}: {d['floodedKm2']} km2 flooded on {d['scenes']['flood']['date']}, "
              f"{d['recoveryKm2']} km2 remaining on {d['scenes']['recovery']['date']} "
              f"({100*d['usableFraction']:.0f}% usable, "
              f"{100*d['permanentWaterFraction']:.1f}% permanent water)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--baseline", default=BASELINE_DEFAULT,
                        help=f"pre-event date (default {BASELINE_DEFAULT}, alt {BASELINE_ALT})")
    args = parser.parse_args()
    if args.check:
        return check()
    DATES["baseline"] = args.baseline
    os.makedirs(OUT_DIR, exist_ok=True)
    for sid, site in SITES.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-flood-observed.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
