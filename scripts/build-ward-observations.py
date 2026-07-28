#!/usr/bin/env python3
"""
The ward-scale calibration set: ECOSTRESS over each ward, with its own surface.

    python3 scripts/build-ward-observations.py [--limit N]

WHY THIS EXISTS. The existing calibration fits the model against two GHS-SMOD
masks: an "urban" class covering 3,363 km2 and a "rural" class covering 1,568.
Sampling both with Sentinel-2 shows they are the same landscape — FVC 0.678
against 0.654, the urban side marginally the greener. Their measured temperature
difference is 0.34 K, and that is why: it is the difference between delta with
villages and delta with crops.

The product is not about that. It shows a 1400 m ward with FVC 0.31-0.45 and
asks how hot a block is. Calibrating on a two-thirds-vegetated landscape and
applying the result to a one-third-vegetated ward is fitting one question and
shipping the answer to another.

So this builds the calibration set at the scale the product works at: every
near-nadir scene x every ward, ECOSTRESS at its native 70 m inside the ward
footprint, paired with that ward's OWN measured surface — the same Sentinel-2
FVC and albedo the browser draws with, and the same footprint raster.

It trades 32 mask-pairs at the wrong scale for 81 ward-scenes at the right one.

WHY IT CACHES THE GRIDS AND NOT JUST THE MEANS. Reading these costs ~8 minutes
of network per pass. A calibration that expensive to evaluate does not get
iterated, and an un-iterated calibration is how constants end up pinned to their
bounds with nobody noticing. The full 21x21 grids are kept so the ward-mean fit
and the per-cell spatial check can both run from one download, instantly.

Output: data/calibration/ward-observations.npz   (grids + a parallel index)
        data/calibration/ward-observations.json  (readable index, no grids)
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

import _physics  # noqa: E402
import _types  # noqa: E402
from _ecostress import align, band_url, cmr_search, fetch, target_grid, token  # noqa: E402
from _sentinel import GRID as SURFACE_GRID  # noqa: E402

ROOT = os.path.join(HERE, "..")
SURFACE_DIR = os.path.join(ROOT, "public", "heat-map", "data")
BUILT_CACHE = os.path.expanduser("~/.cache/delta-climate/built")
OUT_NPZ = os.path.join(ROOT, "data", "calibration", "ward-observations.npz")
OUT_JSON = os.path.join(ROOT, "data", "calibration", "ward-observations.json")

VEG_RANGE = (0.0, 1.0)
ALBEDO_RANGE = (0.0, 0.5)

#: A ward is ~21x21 cells. Below this the ward mean is dominated by which cells
#: happened to be clear rather than by the ward.
MIN_CELLS = 40


def ward_surface(ward_id: str) -> tuple[float, float, float]:
    """(fvc, albedo, built) for one ward — the same values the browser runs on."""
    png = os.path.join(SURFACE_DIR, f"{ward_id}-surface.png")
    built_f = os.path.join(BUILT_CACHE, f"{ward_id}-built-{SURFACE_GRID}.f32")
    for p, how in ((png, "scripts/export-surface-rasters.py"),
                   (built_f, "npx tsx scripts/export-built-raster.mjs")):
        if not os.path.exists(p):
            sys.exit(f"missing {p} — run `{how}` first.")
    a = np.asarray(Image.open(png)).astype(np.float32)
    fvc = float((a[:, :, 0] / 255.0 * (VEG_RANGE[1] - VEG_RANGE[0]) + VEG_RANGE[0]).mean())
    alb = float((a[:, :, 1] / 255.0 * (ALBEDO_RANGE[1] - ALBEDO_RANGE[0]) + ALBEDO_RANGE[0]).mean())
    built = float(np.fromfile(built_f, dtype=np.float32).mean())
    return fvc, alb, built


def ward_lst(ward: _types.Ward, date: str, phase: str, tok: str
             ) -> npt.NDArray[np.float32] | None:
    """ECOSTRESS surface temperature over one ward, °C, NaN where unusable.

    Masking matches the SUHII measurement exactly — physical range, QC mandatory
    bits, the separate cloud band (v002's QC cloud bits are unset), and water.
    A different mask here would mean calibrating against different pixels than
    the ones the accuracy figures are scored on.
    """
    from datetime import date as _date, timedelta as _td
    bbox = _types.ward_bounds(ward)
    nxt = (_date.fromisoformat(date) + _td(days=1)).isoformat()
    try:
        acqs = cmr_search("night" if phase == "night" else "day", date, None, nxt, bbox=bbox)
    except Exception:
        return None
    if not acqs:
        return None

    lst: npt.NDArray[np.float32] | None = None
    for _t, grans in acqs:
        for g in grans:
            try:
                p_lst = fetch(band_url(g, "_LST.tif"), tok)
                if not p_lst:
                    continue
                a = align(p_lst, np.nan, "float32", bbox=bbox)
                good = np.isfinite(a) & (a > 200) & (a < 400)
                pq = fetch(band_url(g, "_QC.tif"), tok)
                if pq:
                    q = align(pq, 0xFFFF, "uint16", bbox=bbox)
                    good &= (q != 0xFFFF) & ((q & 0b11) == 0)
                pc = fetch(band_url(g, "_cloud.tif"), tok)
                if pc:
                    good &= align(pc, 255, "uint16", bbox=bbox) != 1
                pw = fetch(band_url(g, "_water.tif"), tok)
                if pw:
                    good &= align(pw, 0, "uint16", bbox=bbox) != 1
                cel = np.where(good, a - 273.15, np.nan).astype(np.float32)
                lst = cel if lst is None else np.where(np.isfinite(lst), lst, cel)
            except Exception:
                continue
    return lst


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    scenes, _lc, dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[:args.limit]
    tok = token()
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped) x {len(_types.WARDS)} wards\n")

    surf = {w: ward_surface(w) for w in _types.WARDS}
    for w, (f, a, b) in surf.items():
        print(f"  {w:<13} fvc {f:.3f}  albedo {a:.3f}  built {b:.3f}")
    print()

    rows: list[dict[str, Any]] = []
    grids: list[npt.NDArray[np.float32]] = []
    for n, sc in enumerate(scenes, 1):
        for wid, ward in _types.WARDS.items():
            g = ward_lst(ward, sc.date, sc.phase, tok)
            if g is None:
                continue
            m = np.isfinite(g)
            if int(m.sum()) < MIN_CELLS:
                continue
            fvc, alb, built = surf[wid]
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid,
                "lst_mean_c": round(float(np.nanmean(g)), 3),
                "lst_sd_c": round(float(np.nanstd(g)), 3),
                "cells": int(m.sum()), "cell_frac": round(float(m.mean()), 3),
                # the ward's own measured surface — what the browser draws with
                "fvc": round(fvc, 4), "albedo": round(alb, 4), "built": round(built, 4),
                # scene forcing, already coerced and solar-time matched by _physics
                "tAir": sc.tAir, "rh": sc.rh, "wind": sc.wind, "cloud": sc.cloud,
                "sun": round(sc.sun, 4), "hour": sc.hour,
            })
            # NaN is the masking signal and must survive to the cache; a
            # nan_to_num here would erase the distinction between "cloudy"
            # and "measured 0 °C".
            grids.append(g)
        if n % 5 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(rows)} ward-scenes")

    if not rows:
        sys.exit("no ward-scenes survived masking — nothing to calibrate against")

    stack = np.stack(grids)
    os.makedirs(os.path.dirname(OUT_NPZ), exist_ok=True)
    # The index rides along as JSON text, one row per grid, so the .npz is
    # self-describing — a bare array of grids with the pairing held in a
    # separate file is one rename away from silently mismatched rows.
    np.savez_compressed(OUT_NPZ, grids=stack,
                        index=np.array([json.dumps(r) for r in rows]))
    meta = {
        "note": "Ward-scale calibration set. Replaces the GHS-SMOD mask pairs, which "
                "sample a landscape (FVC 0.678 urban vs 0.654 rural) rather than the "
                "1400 m wards the product is about (FVC 0.31-0.45).",
        "scenes": len(scenes), "ward_scenes": len(rows),
        "grid_shape": list(stack.shape[1:]),
        "min_cells": MIN_CELLS,
        "rows": rows,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(meta, fh, indent=2)

    print(f"\n  {'ward':<13}{'n':>4}{'mean LST':>10}{'sd across scenes':>19}")
    for wid in _types.WARDS:
        v = [r["lst_mean_c"] for r in rows if r["ward"] == wid]
        if v:
            print(f"  {wid:<13}{len(v):>4}{np.mean(v):>10.2f}{np.std(v):>19.2f}")
    for ph in ("day", "night"):
        v = [r["lst_mean_c"] - r["tAir"] for r in rows if r["phase"] == ph]
        if v:
            print(f"  {ph:<13}{len(v):>4}{'':>10}  ward LST − air: {np.mean(v):+.2f} K")
    print(f"\n  written to {os.path.relpath(OUT_JSON, ROOT)} (+ .npz grids)")


if __name__ == "__main__":
    main()
