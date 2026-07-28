#!/usr/bin/env python3
"""
Fractional vegetation cover of the SUHII urban and rural masks, from Sentinel-2.

    python3 scripts/measure-mask-fvc.py [--samples 16] [--years 2024 2025]

WHY. The calibration and the runtime feed DIFFERENT PHYSICAL QUANTITIES into the
same model parameter, and the gap is 2x on the most powerful term in the model.

    calibration  landcover-fractions.json `veg` = WorldCover CLASS fraction,
                 a class-weighted sum. Urban = 0.721.
    runtime      the browser's per-cell field = FVC from NDVI scaling,
                 (NDVI - 0.05) / (0.80 - 0.05). Ward values 0.309 - 0.447.

Those are not the same thing. A cropland pixel counts as ~1.0 of "vegetation
class" whether or not anything is growing on it; FVC asks how green it actually
is. The ET term is `-L·v`, so halving `v` moves the modelled surface by several
degrees — measured at 4.16 K on a daytime scene.

The consequence is that the published +/-3.5 / +/-5.0 K accuracy was measured on
a model fed v = 0.72, while the browser draws a field fed v = 0.33. Those are two
different models, and the one that was validated is not the one on screen. It is
also why the fit railed every parameter: at v = 0.72 the urban mask carries a
structural ~3 K cold bias that no coupling constant can remove.

So this measures the masks in the runtime's units, so that both sides finally
mean the same thing by "vegetation".

METHOD. The masks are ~3,400 and ~1,600 km2 — far too large to read at 10 m. FVC
is a mean, so it is estimated by sampling: N locations drawn from each mask,
each read as a 1400 m window through the SAME reader the ward composites use, so
a sampled FVC and a ward FVC are computed identically. The standard error over
samples is reported, because a mean without one invites treating 16 windows as
if they were the whole mask.

Sampling is DETERMINISTIC (fixed seed) — a calibration input that changes when
you re-run it is not a calibration input.

Output: data/calibration/mask-fvc.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.warp import transform_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
from _ecostress import align  # noqa: E402
from _sentinel import NDVI_BARE, NDVI_VEG, scene_arrays, search  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "mask-fvc.json")
SMOD = os.path.expanduser(
    "~/.cache/delta-climate/ghsl/GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0_R7_C27.tif")

#: Same class definitions as ecostress-suhii.py — urban is Urban Centre only,
#: rural is the three rural classes. Changing these here would silently compare
#: FVC of one geography against temperatures of another.
URBAN = {30}
RURAL = {11, 12, 13}

#: Deterministic. See the module note.
SEED = 20260729


def mask_centres(codes: set[int], n: int, rng: np.random.Generator
                 ) -> list[tuple[float, float]]:
    """`n` (lat, lon) points drawn from the cells of `codes` inside STUDY_BBOX."""
    if not os.path.exists(SMOD):
        sys.exit(f"GHS-SMOD tile not cached at {SMOD} — run scripts/ecostress-suhii.py once.")
    smod = align(SMOD, -200, "int16", bbox=_types.STUDY_BBOX)
    hit = np.isin(smod, list(codes))
    ys, xs = np.nonzero(hit)
    if len(ys) < n:
        sys.exit(f"only {len(ys)} cells match {sorted(codes)} — cannot draw {n} samples")

    # The aligned grid spans STUDY_BBOX in UTM; convert cell indices back to
    # lon/lat by linear interpolation across the bbox. Good to well under a
    # sample window at this scale, and the sample only needs to land inside the
    # right land-cover class.
    w, s, e, nth = _types.STUDY_BBOX
    h, wd = smod.shape
    pick = rng.choice(len(ys), size=n, replace=False)
    out: list[tuple[float, float]] = []
    for i in pick:
        lat = nth - (ys[i] + 0.5) / h * (nth - s)
        lon = w + (xs[i] + 0.5) / wd * (e - w)
        out.append((float(lat), float(lon)))
    return out


def window_fvc(lat: float, lon: float, years: list[int]) -> float | None:
    """Median FVC of one 1400 m window, identical arithmetic to the ward composite."""
    ndvis: list[npt.NDArray[np.float32]] = []
    for y in years:
        for feat in search(lat, lon, y):
            got = scene_arrays(feat, lat, lon)
            if got is not None:
                ndvis.append(got[0])
    if len(ndvis) < 2:
        return None
    ndvi = np.nanmedian(np.stack(ndvis), axis=0)
    finite = np.isfinite(ndvi)
    if finite.mean() < 0.5:
        return None
    fvc = np.clip((ndvi[finite] - NDVI_BARE) / (NDVI_VEG - NDVI_BARE), 0, 1)
    return float(np.mean(fvc))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--years", type=int, nargs="+", default=[2024, 2025])
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)
    lc_path = os.path.join(ROOT, "data", "calibration", "landcover-fractions.json")
    with open(lc_path) as fh:
        classfrac = json.load(fh)["classes"]

    result: dict[str, Any] = {
        "source": "Sentinel-2 L2A via Earth Search STAC, NDVI -> FVC with the same "
                  "NDVI_BARE/NDVI_VEG endpoints as the ward composites.",
        "why": "The calibration used WorldCover CLASS fractions and the runtime uses FVC. "
               "Feeding two different quantities to the same -L*v term made the validated "
               "model and the displayed model different models.",
        "seed": SEED, "samples_per_mask": args.samples, "years": args.years,
        "masks": {},
    }

    for label, codes in (("urban", URBAN), ("rural", RURAL)):
        pts = mask_centres(codes, args.samples, rng)
        vals: list[float] = []
        for i, (lat, lon) in enumerate(pts, 1):
            v = window_fvc(lat, lon, args.years)
            if v is not None:
                vals.append(v)
            print(f"    {label} {i:>3}/{len(pts)}  {lat:.4f},{lon:.4f}  "
                  f"{'FVC %.3f' % v if v is not None else 'no usable scenes'}")
        if len(vals) < 3:
            sys.exit(f"{label}: only {len(vals)} usable samples — too thin to call a mask mean")
        a = np.asarray(vals)
        result["masks"][label] = {
            "fvc_mean": round(float(a.mean()), 4),
            "fvc_sd": round(float(a.std(ddof=1)), 4),
            "fvc_stderr": round(float(a.std(ddof=1) / np.sqrt(len(a))), 4),
            "n_usable": len(a),
            "class_fraction_veg": classfrac[label]["veg"],
        }
        m = result["masks"][label]
        print(f"  {label}: FVC {m['fvc_mean']:.3f} +/- {m['fvc_stderr']:.3f} (n={m['n_usable']})"
              f"  vs class fraction {m['class_fraction_veg']:.3f}\n")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(result, fh, indent=2)

    u, r = result["masks"]["urban"], result["masks"]["rural"]
    print(f"  urban FVC {u['fvc_mean']:.3f} vs rural {r['fvc_mean']:.3f} "
          f"-> contrast {r['fvc_mean'] - u['fvc_mean']:+.3f}")
    print(f"  (class fractions gave a contrast of only "
          f"{r['class_fraction_veg'] - u['class_fraction_veg']:+.3f})")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
