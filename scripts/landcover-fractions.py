#!/usr/bin/env python3
"""
Land-cover fractions for the SUHII urban and rural masks.

    python3 scripts/landcover-fractions.py

The physics fit predicts surface temperature from vegetation fraction, built
fraction and albedo. Those are DATA, not free parameters — inventing "urban" and
"rural" archetypes would let the solver absorb land-cover error into the physics
constants and report it as calibrated physics. That is the same failure the
solar-geometry fix avoided, so the fractions are measured from ESA WorldCover
inside exactly the GHS-SMOD masks the SUHII measurement used.

WorldCover v200 is a 2021 epoch and the fractions are treated as time-invariant
over the 2024-2026 calibration window. Kolkata is urbanising, so the built
fraction is a mild underestimate at the late end; the effect is small next to
the residuals being fitted and is recorded here rather than hidden.

Source: ESA WorldCover 10 m v200, CC BY 4.0, tile N21E087, on the public S3
bucket (no credentials).

Output: data/calibration/landcover-fractions.json
"""
import importlib.util, json, os, subprocess, sys

import numpy as np

HERE_ = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("suhii", os.path.join(HERE_, "ecostress-suhii.py"))
suhii = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(suhii)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "landcover-fractions.json")

WC_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
          "ESA_WorldCover_10m_2021_v200_N21E087_Map.tif")
WC = os.path.expanduser("~/.cache/delta-climate/worldcover/N21E087.tif")
SMOD = os.path.expanduser(
    "~/.cache/delta-climate/ghsl/GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0_R7_C27.tif")

BBOX = (88.00, 22.05, 88.85, 22.95)   # must match ecostress-suhii.py BBOX
# BBOX is already (west, south, east, north) = rasterio window(left, bottom, right, top)

URBAN = {30}
RURAL = {11, 12, 13}

# ESA WorldCover class -> (vegetation weight, built weight, albedo).
#
# Vegetation weight is the fraction of the cell that transpires; built weight is
# the fraction carrying anthropogenic heat and storage. Albedo values are the
# broadband white-sky midpoints tabulated for each cover type in Bonan (2016)
# "Ecological Climatology" Table 12.1 and the MODIS albedo climatology; they are
# cover-type typicals, not scene retrievals, and are held FIXED in the fit.
WC_CLASS = {
    10: ("Tree cover",            1.00, 0.00, 0.12),
    20: ("Shrubland",             0.75, 0.00, 0.18),
    30: ("Grassland",             0.80, 0.00, 0.20),
    40: ("Cropland",              0.85, 0.00, 0.18),
    50: ("Built-up",              0.10, 1.00, 0.15),
    60: ("Bare / sparse",         0.05, 0.00, 0.30),
    70: ("Snow and ice",          0.00, 0.00, 0.70),
    80: ("Permanent water",       0.00, 0.00, 0.06),
    90: ("Herbaceous wetland",    0.90, 0.00, 0.14),
    95: ("Mangroves",             1.00, 0.00, 0.12),
    100: ("Moss and lichen",      0.60, 0.00, 0.20),
}


def ensure_worldcover() -> str:
    if os.path.exists(WC):
        return WC
    os.makedirs(os.path.dirname(WC), exist_ok=True)
    print(f"  fetching WorldCover N21E087 (~80 MB) ...")
    r = subprocess.run(["curl", "-s", "--fail", "-L", WC_URL, "-o", WC])
    if r.returncode != 0:
        if os.path.exists(WC):
            os.remove(WC)
        sys.exit(f"WorldCover download failed (curl {r.returncode})")
    return WC


def main():
    if not os.path.exists(SMOD):
        sys.exit(f"GHS-SMOD tile not cached at {SMOD}")
    wc_path = ensure_worldcover()

    # Use the SAME aligner and target grid as the SUHII measurement, so the
    # fractions describe exactly the pixels the temperatures came from. Rolling
    # a second alignment by hand produced 4,201 km2 of "Urban Centre" — twice
    # Kolkata's entire metro area — because the tiles are far bigger than the
    # study window and the reprojection did not match.
    #
    # WorldCover is 10 m and the target grid is 70 m, so nearest-neighbour
    # subsamples one 10 m cell per 70 m cell. That is unbiased for estimating
    # class FRACTIONS over a mask of this size (~1.9 M cells), which is all that
    # is wanted here; it is not a dominant-class map.
    cover = suhii.align(wc_path, 0, "uint8")
    smod = suhii.align(SMOD, -200, "int16")

    out = {
        "source": "ESA WorldCover 10m v200 (2021), CC BY 4.0, tile N21E087",
        "grid": "aligned onto the same 70 m UTM 45N grid as the SUHII measurement, clipped to BBOX",
        "masks": "GHS-SMOD R2023A R7_C27; urban = class 30, rural = classes 11/12/13",
        "albedo_source": "Bonan (2016) Ecological Climatology Table 12.1 / MODIS albedo climatology",
        "note": "WorldCover is a 2021 epoch held time-invariant over the 2024-2026 window; "
                "Kolkata is urbanising, so built fraction is a mild underestimate at the late end.",
        "classes": {},
    }

    for label, codes in (("urban", URBAN), ("rural", RURAL)):
        mask = np.isin(smod, list(codes)) & (cover > 0)
        n = int(mask.sum())
        if n == 0:
            sys.exit(f"no {label} pixels — mask alignment is wrong")
        px = cover[mask]
        veg = built = alb = 0.0
        breakdown = {}
        for code, (name, v, b, a) in WC_CLASS.items():
            f = float((px == code).sum()) / n
            if f > 0.001:
                breakdown[name] = round(f, 4)
            veg += f * v
            built += f * b
            alb += f * a
        out["classes"][label] = {
            "pixels": n,
            "veg": round(veg, 4),
            "built": round(built, 4),
            "albedo": round(alb, 4),
            "cover_breakdown": dict(sorted(breakdown.items(), key=lambda kv: -kv[1])),
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    for label in ("urban", "rural"):
        c = out["classes"][label]
        print(f"  {label:<6} n={c['pixels']:>10,}  veg {c['veg']:.3f}  built {c['built']:.3f}  albedo {c['albedo']:.3f}")
        for k, v in list(c["cover_breakdown"].items())[:4]:
            print(f"            {k:<22} {v:6.1%}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
