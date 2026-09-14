#!/usr/bin/env python3
"""
Per-cell vegetation and albedo rasters for the heat-map surface.

    python3 scripts/export-surface-rasters.py [--ward ID] [--years 2021 ... 2025]

WHY. The thermal model needs vegetation fraction and albedo FOR EVERY CELL of a
ward. Until now it invented them, in ward-raster.ts:

    const noise = 0.5 + 0.5 * stableGridNoise01(x, y);
    veg[index]    = vegetationBaseline * (1 - mask) * noise;
    albedo[index] = 0.32 - 0.12 * mask + 0.06 * noise;

That is a hash function. The physics consuming it is sound and the ward means
are measured, but the spatial pattern the model runs on was invented — a park
and a car park differed only by their hash.

Sentinel-2 measures both at 10 m, so the grid is the ward over 10 m and differs
per city: Kolkata's 1400 m wards give 140 x 140, Bengaluru's 2800 m give
280 x 280. fetch-sentinel-composites.py ALREADY computes these arrays for every
scene and then calls np.nanmedian on them, discarding 19,600 measured cells per
band to keep one number. This script keeps the array.

THE INVARIANT THAT MAKES THIS SAFE. The ward-level scalars in
data/dc-urs/inputs.json are what DC-URS scores on, and they are the numbers the
CEO's specification governs. This script MUST NOT change them. So the raster
carries the measured spatial PATTERN and is then rescaled so its ward reduction
reproduces the existing scalar exactly. Verified at the end of every run, and
again in TypeScript when the texture loads.

Pattern from measurement, level from the approved scalar. Anything else would
mean two different "measured albedo" values for one ward.

AND WHERE THERE IS NO APPROVED SCALAR, THE MEASURED LEVEL SHIPS AS MEASURED.
DC-URS scores Kolkata; Bengaluru has no entry in inputs.json and no specified
ward scalar to reproduce. So a Bengaluru raster is not rescaled at all, and its
entry below records `"level": "measured"` rather than a target. The alternative
— pinning to the nominal `veg` in src/data/cities.ts — would be actively
harmful: all three Bengaluru wards carry the same 0.344 there, so pinning would
force three different neighbourhoods to one vegetation mean and manufacture
precisely the uniform-raster failure this artefact exists to detect.

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

import _bangalore as blr  # noqa: E402
import _types  # noqa: E402

# One copy of the measurement, shared with fetch-sentinel-composites. A second
# copy of the BOA offset rule or the albedo coefficients would be a second thing
# to keep in step, and that rule has already caused one silent data defect.
from _sentinel import (  # noqa: E402
    NDVI_BARE, NDVI_VEG, grid_for, scene_arrays, search,
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

#: Albedo for a ward with no approved scalar whose composite is NaN EVERYWHERE —
#: `fill_gaps` reaches this only when not one cell in the ward is finite. The
#: mid-range urban value surface-raster.ts falls back to, for the same reason.
#: A ward that actually reached it would then fail the variance gate below.
FALLBACK_ALBEDO = 0.2

#: surface-meta.json, read back before it is written so a single-ward run merges
#: into the other five rather than replacing them.
OUT_META = os.path.join(OUT_DIR, "surface-meta.json")


def surface_wards() -> dict[str, _types.Ward]:
    """Every ward this exporter can build — Kolkata and Bengaluru, in one shape.

    THE TWO WARD TABLES ARE DIFFERENT NAMEDTUPLES WITH DIFFERENT TYPES.
    `_types.Ward` carries `footprint_m: int`; `_bangalore.Ward` carries
    `size_m: float` (2800.0), under a different name. `grid_for` demands an
    `int` deliberately — `%` on a float passes 1399.9999 and raises on
    1400.0000000001 — so the conversion has to happen somewhere, and it happens
    HERE, once, rather than as a bare `int()` at each call site where a
    truncation would read 279 cells of a 280-cell ward and never say so.
    """
    wards = dict(_types.WARDS)
    for w in blr.WARDS.values():
        if w.size_m != int(w.size_m):
            raise ValueError(
                f"{w.id}: ward size {w.size_m} m is not a whole number of metres, so it "
                f"has no exact 10 m grid — refusing to truncate it into one")
        wards[w.id] = _types.Ward(w.id, _types.LatLon(w.centre.lat, w.centre.lon), int(w.size_m))
    return wards


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
        for feat in search(lat, lon, y, ward.footprint_m):
            got = scene_arrays(feat, lat, lon, ward.footprint_m)
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
    ap.add_argument("--ward", default=None, help="one ward id; default is Kolkata's three")
    args = ap.parse_args()

    wards = surface_wards()
    # DEFAULTING TO KOLKATA IS DELIBERATE, not an oversight now that six wards
    # exist. A bare invocation has always meant "the three wards DC-URS scores",
    # and quietly widening it to six would re-composite Kolkata — ~150 network
    # reads a ward — and rewrite three committed artefacts nobody asked to touch.
    if args.ward is None:
        todo = dict(_types.WARDS)
    elif args.ward in wards:
        todo = {args.ward: wards[args.ward]}
    else:
        sys.exit(f"unknown ward {args.ward!r} — one of: {', '.join(sorted(wards))}")

    if not os.path.exists(INPUTS):
        sys.exit(f"{os.path.relpath(INPUTS, ROOT)} is missing — run build-dcurs-inputs.py first. "
                 f"The ward scalars it holds are what these rasters are pinned to.")
    with open(INPUTS) as fh:
        inputs = json.load(fh)["wards"]

    os.makedirs(OUT_DIR, exist_ok=True)

    # NO TOP-LEVEL `grid` / `footprint_m`. They were one number for the whole
    # file, which was true only while every ward was 1400 m. Bengaluru's are
    # 2800 m, so a single figure would be wrong for three of the six wards —
    # and wrong in the readable direction, since a reader takes a top-level key
    # as covering the file. It is stated PER WARD below instead, derived from
    # the registry so it cannot disagree with the raster it describes. Nothing
    # read the old pair: the browser takes the grid from the PNG's own width
    # (surface-raster.ts), and build-city-indicators.py reads only albedo_range.
    meta: dict[str, Any] = {
        "source": "Sentinel-2 L2A surface reflectance via Earth Search STAC; NDVI -> FVC "
                  "with the same NDVI_BARE/NDVI_VEG endpoints as the ward composite, "
                  "albedo via the source document's §3B band coefficients.",
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

    # MERGE, DO NOT REPLACE. A `--ward` run rebuilds ONE raster; every other
    # entry is a measurement that still stands, with its PNG still on disk
    # beside it. Writing a fresh file would silently unpublish five wards from
    # the STAC metadata that links this one.
    if os.path.exists(OUT_META):
        with open(OUT_META) as fh:
            meta["wards"] = json.load(fh).get("wards", {})

    for ward_id, ward in todo.items():
        n = grid_for(ward.footprint_m)
        rec = inputs.get(ward_id)
        # PIN ONLY WHERE THERE IS A SCALAR TO PIN TO. A Kolkata ward missing
        # from inputs.json is still a broken run and still refuses — that is the
        # original guard, narrowed to the wards it was written for. Bengaluru is
        # not scored by DC-URS and has no entry, so there is no approved level to
        # reproduce and the measured one ships. The module docstring records why
        # cities.ts's nominal 0.344 is not a stand-in for one.
        if rec is None and ward_id in _types.WARDS:
            sys.exit(f"{ward_id} is absent from inputs.json — cannot pin a raster to a scalar "
                     f"that does not exist.")
        targets = ((float(rec["fvc"]["value"]), float(rec["albedo"]["value"]))
                   if rec is not None else None)

        print(f"  {ward.id}  {ward.footprint_m} m → {n}×{n}"
              + ("" if targets is not None else "  (no DC-URS scalar — level is measured)"))
        ndvi, albedo_raw = composite(ward, args.years)

        # NDVI -> fractional vegetation cover, the same transform and the same
        # endpoints the ward scalar uses, so the two are the same quantity.
        fvc: npt.NDArray[np.float32] = np.clip(
            (fill_gaps(ndvi, NDVI_BARE) - NDVI_BARE) / (NDVI_VEG - NDVI_BARE), 0, 1
        ).astype(np.float32)
        albedo = fill_gaps(albedo_raw, FALLBACK_ALBEDO if targets is None else targets[1])

        if targets is not None:
            fvc = rescale_to(fvc, targets[0])
            albedo = rescale_to(albedo, targets[1])

        r = quantise(fvc, *VEG_RANGE)
        g = quantise(albedo, *ALBEDO_RANGE)
        rgb = np.dstack([r, g, np.zeros_like(r)])
        path = os.path.join(OUT_DIR, f"{ward_id}-surface.png")
        Image.fromarray(rgb, mode="RGB").save(path, optimize=True)

        # Measure what the BROWSER will see, which is the quantised value — not
        # the float we just computed. Quantisation is the last step that can
        # break the invariant, so it is the one that must be measured.
        veg_mean = float(dequantise(r, *VEG_RANGE).mean())
        alb_mean = float(dequantise(g, *ALBEDO_RANGE).mean())
        kb = os.path.getsize(path) / 1024
        entry: dict[str, Any] = {
            "grid": n,
            "footprint_m": ward.footprint_m,
            "veg_std": round(float(fvc.std()), 4),
            "albedo_std": round(float(albedo.std()), 4),
        }
        if targets is not None:
            fvc_target, albedo_target = targets
            entry |= {
                "level": "dc-urs-scalar",
                "fvc_target": round(fvc_target, 4),
                "albedo_target": round(albedo_target, 4),
                "fvc_quantised_err": round(abs(veg_mean - fvc_target), 6),
                "albedo_quantised_err": round(abs(alb_mean - albedo_target), 6),
            }
            print(f"    fvc {fvc_target:.4f} (err {abs(veg_mean - fvc_target):.2e}, "
                  f"sd {fvc.std():.3f}) · albedo {albedo_target:.4f} "
                  f"(err {abs(alb_mean - albedo_target):.2e}, sd {albedo.std():.3f}) · {kb:.1f} KB")
        else:
            entry |= {
                "level": "measured",
                "fvc_mean": round(veg_mean, 4),
                "albedo_mean": round(alb_mean, 4),
            }
            print(f"    fvc {veg_mean:.4f} measured (sd {fvc.std():.3f}) · "
                  f"albedo {alb_mean:.4f} measured (sd {albedo.std():.3f}) · {kb:.1f} KB")
        meta["wards"][ward_id] = entry

        # A raster with no spatial variance is a constant, and a constant is what
        # this script exists to replace. If a ward ever composites flat, that is
        # a masking failure, not a genuinely uniform square kilometre of city.
        if fvc.std() < 1e-3 and albedo.std() < 1e-3:
            sys.exit(f"{ward_id}: composite has no spatial variance — every cell identical. "
                     f"That is a masking failure, not a uniform ward.")

    # Backfill the per-ward grid onto entries written before it was stated per
    # ward. Taken from the registry rather than from the file, so it cannot
    # disagree with the raster it describes.
    for known_id in [i for i in meta["wards"] if i in wards]:
        meta["wards"][known_id]["grid"] = grid_for(wards[known_id].footprint_m)
        meta["wards"][known_id]["footprint_m"] = wards[known_id].footprint_m

    with open(OUT_META, "w") as fh:
        json.dump(meta, fh, indent=2)

    # ONLY THE PINNED WARDS HAVE AN INVARIANT TO VIOLATE. A measured-level ward
    # has no scalar to drift from, and `max()` over an empty sequence raises —
    # which is exactly what a Bengaluru-only run would have hit.
    errs = [max(w["fvc_quantised_err"], w["albedo_quantised_err"])
            for w in meta["wards"].values() if "fvc_quantised_err" in w]
    if errs:
        worst = max(errs)
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
