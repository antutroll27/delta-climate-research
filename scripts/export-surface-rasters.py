#!/usr/bin/env python3
"""
Per-cell vegetation and albedo rasters for the heat-map surface.

    python3 scripts/export-surface-rasters.py [--years 2021 2022 2023 2024 2025]

WHY. The thermal model needs vegetation fraction and albedo FOR EVERY CELL of a
1400 m ward. Until now it invented them, in ward-raster.ts:

    const noise = 0.5 + 0.5 * stableGridNoise01(x, y);
    veg[index]    = vegetationBaseline * (1 - mask) * noise;
    albedo[index] = 0.32 - 0.12 * mask + 0.06 * noise;

That is a hash function. The physics consuming it is sound and the ward means
are measured, but the spatial pattern the model runs on was invented — a park
and a car park differed only by their hash.

Sentinel-2 measures both at 10 m. Over a 1400 m ward that is 140 x 140 cells
against a 192 x 192 display grid — close enough to carry real structure.
fetch-sentinel-composites.py ALREADY computes these arrays for every scene and
then calls np.nanmedian on them, discarding 19,600 measured cells per band to
keep one number. This script keeps the array.

THE INVARIANT THAT MAKES THIS SAFE. The ward-level scalars in
data/dc-urs/inputs.json are what DC-URS scores on, and they are the numbers the
CEO's specification governs. This script MUST NOT change them. So the raster
carries the measured spatial PATTERN and is then rescaled so its ward reduction
reproduces the existing scalar exactly. Verified at the end of every run, and
again in TypeScript when the texture loads.

Pattern from measurement, level from the approved scalar. Anything else would
mean two different "measured albedo" values for one ward.

WHY NOT ECOSTRESS. It is the obvious candidate for a measured heat field and it
does not fit: L2T is 70 m, which is 20 x 20 cells over this ward against a
192 x 192 grid. Driving the display from it means a 10x upsample — visible
blocks, and no building-scale information because the source contains none.
ECOSTRESS is the right instrument for VALIDATING the field at 70 m, which is a
separate job (see docs/heat-map-feature.md).

Output: public/heat-map/data/<ward>-surface.png   (2 channels in RGB: R=veg, G=albedo)
        public/heat-map/data/surface-meta.json    (scale/offset per ward + provenance)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

# One copy of the measurement, shared with fetch-sentinel-composites. A second
# copy of the BOA offset rule or the albedo coefficients would be a second thing
# to keep in step, and that rule has already caused one silent data defect.
from _sentinel import (  # noqa: E402
    FOOTPRINT_M, GRID, NDVI_BARE, NDVI_VEG, scene_arrays, search,
)

ROOT = os.path.join(HERE, "..")
INPUTS = os.path.join(ROOT, "data", "dc-urs", "inputs.json")
OUT_DIR = os.path.join(ROOT, "public", "heat-map", "data")

#: Composited NDVI/albedo arrays, cached per ward. The fetch is ~150 windowed COG
#: reads per ward over the network and dominates the runtime; the arithmetic
#: after it takes milliseconds. Without this, tuning the rescale meant re-reading
#: every scene — which is how a clipping bug cost 40 minutes to re-test.
#: Delete this directory to force a genuine re-composite.
COMPOSITE_CACHE = os.path.expanduser("~/.cache/delta-climate/sentinel-surface")

#: Quantisation range for the 8-bit channels. Vegetation fraction is 0..1 by
#: definition. Albedo over land sits well inside 0..0.5 — a 0..1 range would
#: throw away half the available precision on values that cannot occur.
VEG_RANGE = (0.0, 1.0)
ALBEDO_RANGE = (0.0, 0.5)


def composite(ward: _types.Ward, years: list[int]) -> tuple[npt.NDArray[np.float32],
                                                            npt.NDArray[np.float32]]:
    """Per-cell median NDVI and albedo across every usable scene in `years`.

    Median across scenes, per cell — the same reducer the ward scalar uses, just
    applied before the spatial collapse instead of after. A mean would let one
    undetected cloud edge pull a cell several degrees' worth of albedo.
    """
    os.makedirs(COMPOSITE_CACHE, exist_ok=True)
    key = os.path.join(COMPOSITE_CACHE, f"{ward.id}-{min(years)}-{max(years)}.npz")
    if os.path.exists(key):
        cached = np.load(key)
        print(f"    {ward.id}: composite from cache ({os.path.relpath(key, os.path.expanduser('~'))})")
        return cached["ndvi"].astype(np.float32), cached["albedo"].astype(np.float32)

    lat, lon = ward.centre.lat, ward.centre.lon
    ndvis: list[npt.NDArray[np.float32]] = []
    albedos: list[npt.NDArray[np.float32]] = []
    for y in years:
        for feat in search(lat, lon, y):
            got = scene_arrays(feat, lat, lon)
            if got is None:
                continue
            ndvis.append(got[0])
            albedos.append(got[1])
        print(f"    {ward.id} {y}: {len(ndvis)} scenes cumulative")
    if len(ndvis) < 3:
        sys.exit(f"{ward.id}: only {len(ndvis)} usable scenes — refusing to build a "
                 f"surface raster that thin. A single-scene composite is one cloud mask "
                 f"away from a fabricated park.")
    # nanmedian over the scene axis; cells cloudy in EVERY scene stay NaN and are
    # filled below rather than silently becoming 0 (bare ground, and hot).
    ndvi_c = np.nanmedian(np.stack(ndvis), axis=0).astype(np.float32)
    albedo_c = np.nanmedian(np.stack(albedos), axis=0).astype(np.float32)
    np.savez_compressed(key, ndvi=ndvi_c, albedo=albedo_c, scenes=len(ndvis))
    return ndvi_c, albedo_c


def fill_gaps(a: npt.NDArray[np.float32], fallback: float) -> npt.NDArray[np.float32]:
    """Replace NaN with the finite median, or a fallback if nothing is finite.

    A NaN reaching the texture becomes 0 after quantisation, and 0 vegetation on
    a cell that is actually a cloudy park is a hot spot the model will render
    confidently. Named and explicit rather than a bare np.nan_to_num.
    """
    out = a.copy()
    finite = np.isfinite(out)
    out[~finite] = float(np.median(out[finite])) if finite.any() else fallback
    return out


def rescale_to(a: npt.NDArray[np.float32], target: float) -> npt.NDArray[np.float32]:
    """Shift the field so its CLIPPED ward mean equals `target`, preserving structure.

    THE INVARIANT. DC-URS scores on the ward scalar in inputs.json; that number
    is governed by the specification and must not move because a texture landed.
    So the measured pattern is kept and the level is pinned to the approved
    value.

    An ADDITIVE shift, not multiplicative. Scaling by target/mean would compress
    or stretch the contrast between a park and a roof — the exact signal this
    raster exists to carry — and it blows up when the mean is near zero. A shift
    moves the whole field and leaves every difference between two cells intact.

    THE OFFSET IS SOLVED, NOT COMPUTED, because clipping breaks the obvious
    arithmetic. `a + (target - a.mean())` then clipped to [0,1] does NOT have
    mean `target`: every cell the shift pushes below zero is clamped back to
    zero, and each clamp adds back the amount it was meant to remove. The error
    grows with variance and with how close the target sits to a bound —
    Barrackpore (sd 0.256, target 0.309) drifted 1.16e-3 and the invariant check
    rejected the run.

    mean(clip(a + off)) is monotonically non-decreasing in `off`, so bisection
    converges on the exact offset. 60 iterations takes a float to its precision
    floor and costs nothing next to the fetch.
    """
    lo, hi = -1.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if float(np.clip(a + mid, 0.0, 1.0).mean()) < target:
            lo = mid
        else:
            hi = mid
    out: npt.NDArray[np.float32] = np.clip(a + (lo + hi) / 2, 0.0, 1.0).astype(np.float32)
    return out


def quantise(a: npt.NDArray[np.float32], lo: float, hi: float) -> npt.NDArray[np.uint8]:
    q: npt.NDArray[np.uint8] = np.round(np.clip((a - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)
    return q


def dequantise(q: npt.NDArray[np.uint8], lo: float, hi: float) -> npt.NDArray[np.float32]:
    """Inverse of quantise — the arithmetic the TypeScript side must mirror."""
    v: npt.NDArray[np.float32] = (q.astype(np.float32) / 255.0) * (hi - lo) + lo
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=[2021, 2022, 2023, 2024, 2025])
    args = ap.parse_args()

    if not os.path.exists(INPUTS):
        sys.exit(f"{os.path.relpath(INPUTS, ROOT)} is missing — run build-dcurs-inputs.py first. "
                 f"The ward scalars it holds are what these rasters are pinned to.")
    with open(INPUTS) as fh:
        inputs = json.load(fh)["wards"]

    os.makedirs(OUT_DIR, exist_ok=True)
    meta: dict[str, Any] = {
        "source": "Sentinel-2 L2A surface reflectance via Earth Search STAC; NDVI -> FVC "
                  "with the same NDVI_BARE/NDVI_VEG endpoints as the ward composite, "
                  "albedo via the source document's §3B band coefficients.",
        "grid": GRID,
        "footprint_m": FOOTPRINT_M,
        "encoding": "PNG, R = vegetation fraction, G = albedo. value = ch/255 * (hi-lo) + lo",
        "veg_range": list(VEG_RANGE),
        "albedo_range": list(ALBEDO_RANGE),
        "invariant": "Each channel is additively shifted so its ward mean equals the measured "
                     "scalar in data/dc-urs/inputs.json. The PATTERN is measured; the LEVEL is "
                     "the approved DC-URS input. This is what lets the surface gain spatial "
                     "detail without moving any number the score reads.",
        "provenance": "measured",
        "wards": {},
    }

    for ward_id, ward in _types.WARDS.items():
        rec = inputs.get(ward_id)
        if rec is None:
            sys.exit(f"{ward_id} is absent from inputs.json — cannot pin a raster to a scalar "
                     f"that does not exist.")
        fvc_target = float(rec["fvc"]["value"])
        albedo_target = float(rec["albedo"]["value"])

        print(f"  {ward.id}")
        ndvi, albedo = composite(ward, args.years)

        # NDVI -> fractional vegetation cover, the same transform and the same
        # endpoints the ward scalar uses, so the two are the same quantity.
        fvc = np.clip((fill_gaps(ndvi, NDVI_BARE) - NDVI_BARE) / (NDVI_VEG - NDVI_BARE), 0, 1)
        albedo = fill_gaps(albedo, albedo_target)

        fvc = rescale_to(fvc.astype(np.float32), fvc_target)
        albedo = rescale_to(albedo.astype(np.float32), albedo_target)

        r = quantise(fvc, *VEG_RANGE)
        g = quantise(albedo, *ALBEDO_RANGE)
        rgb = np.dstack([r, g, np.zeros_like(r)])
        path = os.path.join(OUT_DIR, f"{ward_id}-surface.png")
        Image.fromarray(rgb, mode="RGB").save(path, optimize=True)

        # Report the error the BROWSER will see, which is the quantised value —
        # not the float we just computed. Quantisation is the last step that can
        # break the invariant, so it is the one that must be measured.
        veg_err = abs(float(dequantise(r, *VEG_RANGE).mean()) - fvc_target)
        alb_err = abs(float(dequantise(g, *ALBEDO_RANGE).mean()) - albedo_target)
        meta["wards"][ward_id] = {
            "fvc_target": round(fvc_target, 4),
            "albedo_target": round(albedo_target, 4),
            "fvc_quantised_err": round(veg_err, 6),
            "albedo_quantised_err": round(alb_err, 6),
            "veg_std": round(float(fvc.std()), 4),
            "albedo_std": round(float(albedo.std()), 4),
        }
        kb = os.path.getsize(path) / 1024
        print(f"    fvc {fvc_target:.4f} (err {veg_err:.2e}, sd {fvc.std():.3f}) · "
              f"albedo {albedo_target:.4f} (err {alb_err:.2e}, sd {albedo.std():.3f}) · {kb:.1f} KB")

        # A raster with no spatial variance is a constant, and a constant is what
        # this script exists to replace. If a ward ever composites flat, that is
        # a masking failure, not a genuinely uniform 1.4 km of Kolkata.
        if fvc.std() < 1e-3 and albedo.std() < 1e-3:
            sys.exit(f"{ward_id}: composite has no spatial variance — every cell identical. "
                     f"That is a masking failure, not a uniform ward.")

    with open(os.path.join(OUT_DIR, "surface-meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)

    worst = max(max(w["fvc_quantised_err"], w["albedo_quantised_err"])
                for w in meta["wards"].values())
    print(f"\n  worst ward-mean error after quantisation: {worst:.2e}")
    # 8-bit quantisation of a 0..1 range cannot do better than ~1/510 per cell,
    # and averaging 19,600 cells drives the MEAN error far below that. Anything
    # near the per-cell step means the shift or the encoding is wrong.
    if worst > 1e-3:
        sys.exit(f"invariant violated: a ward mean drifts {worst:.2e} from its DC-URS scalar. "
                 f"The raster must not move a number the score reads.")
    print(f"  written to {os.path.relpath(OUT_DIR, ROOT)}/")


if __name__ == "__main__":
    main()
