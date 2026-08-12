#!/usr/bin/env python3
"""
How far does blending the canopy at 140 land from the browser's 192-grid answer?

    python3 scripts/measure-canopy-blend-residual.py

SUPERSEDED IN PRODUCTION, KEPT AS EVIDENCE. The shipped blend strength went to 0 on
2026-08-12 (docs/evidence/known-limitations.md sec.1): the canopy raster no longer
enters the temperature solve, so this residual is identically zero for the shipped
configuration and `main()` refuses to overwrite the committed record with zeros. What
is committed was measured at strength 0.5 -- the configuration the question was about --
and it stays because it is the evidence that the sweep behind the strength-0 decision
was taken on a sound validation path. It becomes live again the moment anyone re-enables
the blend, which is exactly when to run this.

WHY THIS EXISTS. `surface_layers()` applies the shipped canopy blend, but at the
validation's own 140 grid rather than replaying the browser's 140 -> 192 -> blend
path. That was a deliberate simplification, and it was approved WITH A CONDITION: the
residual must be measured and published, not asserted to be small. The defect the whole
change closes is precisely a difference somebody assumed was negligible without
checking, so repeating that move here would be farcical.

WHAT IS COMPARED.

    laboratory   blend(veg140, canopy140, 0.5)                       <- what we score
    browser      blend(resample(veg140, 192), resample(canopy140, 192), 0.5)

Both are then brought to a common grid and differenced. Two common grids, because
they answer different questions:

    at 140    the finest grid either field is honestly resolved at, so this is the
              largest the disagreement can look.
    at 70 m   the ECOSTRESS grid the correlation is actually computed on (~21x21 per
              ward). This is the decision-relevant number: anything the area
              downsample averages away never reaches a published figure.

The 192 field is brought down by the same area-weighted resampler the validation
uses for every other layer (`measure-spatial-accuracy.area_downsample`) rather than
by a bilinear pass, so no extra smoothing is invented in the comparison itself.

THE CONTROL, without which the headline number is a lie. Most of a 140 -> 192 -> 140
difference is not the blend at all: it is the bilinear round trip, which smooths the
field whether or not anything is blended into it. So the SAME round trip is run on
the UNBLENDED veg field and reported alongside. That control also names a difference
that PRE-DATES this change and is not owned by it -- the browser has always solved on
a bilinearly upsampled veg field while the validation scored the 140 source, and
nobody is proposing to close that. Only the excess over the control is attributable
to blending at the wrong grid.

READING THE ANSWER. Two ways, because each has a weakness the other covers.

  * As a FRACTION of the blend's own effect (`residual_over_blend_change`). Unit-free,
    and immune to every conversion argument below. This is the headline: an
    approximation error that is a small fraction of the effect being approximated is
    a rounding detail; one comparable to it is a different model.
  * In KELVIN, via the model's veg term `-L * veg / k` (see `model_terms`), with the
    SHIPPING constants and the real near-nadir forcing. Comparable to the 0.26-0.36 K
    per-cell RMS the canopy v2 change produced -- but only roughly, and in the
    CONSERVATIVE direction: that benchmark came from the real solver, which diffuses
    the field at ~47 m, while this conversion is the raw equilibrium term with no
    diffusion. So the Kelvin figures here are an upper bound on what reaches a
    published number.

Reads only local artefacts: the two PNGs per ward and met-forcing.csv. No network,
no token, no dates -- the output is byte-stable.

Output: data/calibration/canopy-blend-residual.json
"""
from __future__ import annotations

import importlib.util
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

import _canopy  # noqa: E402
import _physics  # noqa: E402
import _types  # noqa: E402
from _ecostress import target_grid  # noqa: E402
from _sentinel import GRID as SURFACE_GRID  # noqa: E402

ROOT = os.path.join(HERE, "..")
SURFACE_DIR = os.path.join(ROOT, "public", "heat-map", "data")
OUT = os.path.join(ROOT, "data", "calibration", "canopy-blend-residual.json")

#: The browser's display grid. CANONICAL_GRID_N in src/scripts/climate-engine/types.ts.
DISPLAY_GRID = 192

#: The per-cell RMS the CHM v1 -> v2 canopy change itself moved the field by, measured
#: through the real solver on 2026-08-12 and recorded in known-limitations.md §1. The
#: residual is judged against this: an approximation that is a small fraction of the
#: effect being approximated is tolerable; one comparable to it is not.
CANOPY_CHANGE_RMS_K = (0.26, 0.36)


def _load_msa() -> Any:
    """Import measure-spatial-accuracy.py, whose hyphen makes it unimportable normally.

    Same hack as measure-shipped-amplitude.py and measure-shadow-signtest.py. We want
    ITS `area_downsample` and ITS `live_constants`, not copies: the point of this
    measurement is to describe the path the validation takes, and a private copy of
    the resampler could differ from the one the figures are produced with.
    """
    path = os.path.join(HERE, "measure-spatial-accuracy.py")
    spec = importlib.util.spec_from_file_location("_msa", path)
    if spec is None or spec.loader is None:
        sys.exit("  cannot import scripts/measure-spatial-accuracy.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_msa"] = mod
    spec.loader.exec_module(mod)
    return mod


def veg_from_surface_png(ward_id: str) -> npt.NDArray[np.float32]:
    """The unblended vegetation layer, north-up, exactly as surface_layers reads it."""
    path = os.path.join(SURFACE_DIR, f"{ward_id}-surface.png")
    if not os.path.exists(path):
        sys.exit(f"{os.path.relpath(path, ROOT)} is missing — run "
                 f"scripts/export-surface-rasters.py first.")
    a = np.asarray(Image.open(path)).astype(np.float32)
    return (a[:, :, 0] / 255.0).astype(np.float32)


def veg_coefficients() -> dict[str, dict[str, float]]:
    """L/k per phase, in K per unit vegetation fraction, over the scored scenes.

    Mirrors `measure-spatial-accuracy.model_terms`: the veg term of the field is
    `-L * veg / k` with `L = L_ET * evap_scale(rh)`, times NIGHT_ET_FRACTION at
    night, and `k = kRad + h * wind`. Both the median and the max are reported —
    the median is the typical scene, the max is the worst case a single scene can
    turn a given dveg into.
    """
    msa = _load_msa()
    _q_day, ratio, _c, _store = msa.live_constants()
    k_rad = _physics.K_SUM * ratio / (1 + ratio)
    h = _physics.K_SUM - k_rad
    scenes, _lc, _dropped = _physics.load(all_angles=False)

    out: dict[str, dict[str, float]] = {}
    for phase in ("day", "night"):
        vals: list[float] = []
        for sc in scenes:
            if sc.phase != phase:
                continue
            latent = _physics.L_ET * _physics.evap_scale(sc.rh)
            if phase == "night":
                latent *= _physics.NIGHT_ET_FRACTION
            vals.append(latent / (k_rad + h * sc.wind))
        out[phase] = {
            "n_scenes": len(vals),
            "median_K_per_veg": float(np.median(vals)) if vals else float("nan"),
            "max_K_per_veg": float(np.max(vals)) if vals else float("nan"),
        }
    return out


def main() -> None:
    # The committed record in data/calibration/canopy-blend-residual.json was measured at
    # strength 0.5, which is what shipped when the question was live. Since 2026-08-12 the
    # shipped strength is 0 (docs/evidence/known-limitations.md sec.1): the blend is an
    # identity, so both paths reduce to the resample control, every residual is exactly
    # zero, and the "excess over control" verdict is 0/0. Re-running would replace a real
    # measurement with a file full of zeros that still LOOKS like a measurement -- the
    # precise failure mode this script was written to prevent. So it refuses, loudly, and
    # says what to do instead.
    if _canopy.BLEND_STRENGTH == 0:
        print("  The shipped canopy blend strength is 0 — the blend is off and the canopy "
              "raster\n  is render-only, so there is no 140-vs-192 blend residual to measure: "
              "both paths\n  collapse onto the resample control and every number would be "
              "exactly zero.\n")
        print(f"  {os.path.relpath(OUT, ROOT)} is LEFT AS IT IS. It records the residual as "
              f"measured at\n  strength 0.5, which is the configuration the question was about, "
              f"and it is the\n  evidence that the sweep behind the strength-0 decision was "
              f"itself sound.\n")
        print("  To re-measure: set CANOPY_BLEND_STRENGTH in src/scripts/climate-engine/types.ts "
              "to the\n  strength you are proposing, regenerate the canopy oracle, and run this "
              "again. Do not\n  edit _canopy.BLEND_STRENGTH to force it — the parity oracle will "
              "fail, correctly.")
        return

    msa = _load_msa()
    coeff = veg_coefficients()
    print(f"  veg term sensitivity L/k (K per unit vegetation fraction):")
    for phase, c in coeff.items():
        print(f"    {phase:<6} median {c['median_K_per_veg']:.3f}  max {c['max_K_per_veg']:.3f}"
              f"   ({c['n_scenes']} near-nadir scenes)")

    wards: dict[str, Any] = {}
    print(f"\n  dveg RMS = |browser192 - lab140|. control = the same 140->192->grid round "
          f"trip on the UNBLENDED field")
    print(f"  {'ward':<13}{'grid':>13}{'dveg RMS':>10}{'control':>9}{'excess':>9}"
          f"{'blend eff':>10}{'excess/eff':>11}{'day K':>8}")

    for wid, w in _types.WARDS.items():
        canopy_path = os.path.join(SURFACE_DIR, f"{wid}-canopy.png")
        if not os.path.exists(canopy_path):
            print(f"  {wid:<13} no canopy raster — the browser skips the blend here too")
            wards[wid] = {"canopy": False}
            continue

        veg140 = veg_from_surface_png(wid)
        canopy140 = _canopy.load_canopy_north_up(canopy_path)
        if veg140.shape != canopy140.shape or veg140.shape[0] != SURFACE_GRID:
            sys.exit(f"{wid}: expected two {SURFACE_GRID}x{SURFACE_GRID} rasters, got "
                     f"{veg140.shape} and {canopy140.shape}")

        # The two paths.
        lab140 = _canopy.blend_canopy_into_veg(veg140, canopy140, _canopy.BLEND_STRENGTH)
        veg192 = _canopy.resample_bilinear(veg140.ravel(), SURFACE_GRID, DISPLAY_GRID)
        can192 = _canopy.resample_bilinear(canopy140.ravel(), SURFACE_GRID, DISPLAY_GRID)
        browser192 = _canopy.blend_canopy_into_veg(veg192, can192, _canopy.BLEND_STRENGTH)
        browser192 = browser192.reshape(DISPLAY_GRID, DISPLAY_GRID)

        # The ECOSTRESS grid the correlation is actually computed on.
        _tf, cols, rows = target_grid(_types.ward_bounds(w))

        # The control path: the unblended field through the identical round trip.
        control192 = veg192.reshape(DISPLAY_GRID, DISPLAY_GRID)

        grids: dict[str, Any] = {}
        for label, (out_h, out_w) in (("140", (SURFACE_GRID, SURFACE_GRID)),
                                      ("ecostress70m", (rows, cols))):
            def down(x: npt.NDArray[np.float32]) -> npt.NDArray[np.float64]:
                at_source = label == "140" and x.shape == (SURFACE_GRID, SURFACE_GRID)
                return np.asarray(x if at_source else msa.area_downsample(x, out_h, out_w),
                                  np.float64)

            a, b = down(lab140), down(browser192)
            base, ctl = down(veg140), down(control192)

            def rms_of(x: npt.NDArray[np.float64]) -> float:
                return float(np.sqrt(np.mean(x * x)))

            d = b - a
            rms = rms_of(d)
            # CONTROL: the same round trip with no blend anywhere. Whatever this costs
            # is the bilinear resample, not the placement of the blend.
            control_rms = rms_of(ctl - base)
            # In quadrature, because the two differences are largely independent
            # patterns; clipped at zero so a control that exceeds the total reads as
            # "nothing attributable" rather than as a negative length.
            excess = float(np.sqrt(max(0.0, rms * rms - control_rms * control_rms)))
            # How big is the change the blend makes at all, on this same grid? The
            # residual is only readable against it: 3% of the effect is a rounding
            # detail, 60% of it is a different model.
            change_rms = rms_of(a - base)
            grids[label] = {
                "cells": int(d.size),
                "dveg_rms": rms,
                "dveg_max_abs": float(np.max(np.abs(d))),
                "dveg_mean": float(d.mean()),
                "control_resample_only_rms": control_rms,
                "excess_over_control_rms": excess,
                "blend_change_rms": change_rms,
                "residual_over_blend_change": (rms / change_rms) if change_rms > 0 else float("nan"),
                "excess_over_blend_change": (excess / change_rms) if change_rms > 0 else float("nan"),
                "day_K_median": rms * coeff["day"]["median_K_per_veg"],
                "day_K_max": float(np.max(np.abs(d))) * coeff["day"]["max_K_per_veg"],
                "night_K_median": rms * coeff["night"]["median_K_per_veg"],
                "excess_day_K_median": excess * coeff["day"]["median_K_per_veg"],
            }
            g = grids[label]
            print(f"  {wid:<13}{label:>13}{g['dveg_rms']:>10.5f}"
                  f"{g['control_resample_only_rms']:>9.5f}{g['excess_over_control_rms']:>9.5f}"
                  f"{g['blend_change_rms']:>10.5f}{g['excess_over_blend_change']:>11.1%}"
                  f"{g['day_K_median']:>8.3f}")

        wards[wid] = {
            "canopy": True,
            "ward_mean_veg_unblended": float(veg140.mean()),
            "ward_mean_veg_blended_140": float(np.asarray(lab140, np.float64).mean()),
            "ward_mean_veg_blended_192": float(np.asarray(browser192, np.float64).mean()),
            "grids": grids,
        }

    scored = [w for w in wards.values() if w.get("canopy")]
    worst_70 = max((w["grids"]["ecostress70m"]["day_K_median"] for w in scored), default=0.0)
    worst_140 = max((w["grids"]["140"]["day_K_median"] for w in scored), default=0.0)
    # The verdict is taken on the UNIT-FREE ratio at the grid the figures are computed
    # on, and on the excess over the control -- the part this decision actually owns.
    worst_frac_70 = max((w["grids"]["ecostress70m"]["excess_over_blend_change"]
                         for w in scored), default=0.0)
    worst_excess_k_70 = max((w["grids"]["ecostress70m"]["excess_day_K_median"]
                             for w in scored), default=0.0)
    #: The share of the blend's own effect that the 140-grid approximation may consume
    #: before the simplification stops being a simplification. Chosen, not fitted: a
    #: fifth is the point at which an approximation starts to change conclusions rather
    #: than decimal places, and the number is stated here so the verdict is falsifiable
    #: rather than a judgement call made in prose.
    material_share = 0.20

    out: dict[str, Any] = {
        "question": "How far does blending the canopy into veg at the validation's 140 grid "
                    "land from the browser's 140->192->blend result, once both are on a "
                    "common grid?",
        "why": "surface_layers() blends at 140 rather than replaying the browser's 192 path. "
               "The design approved that simplification on condition the residual be measured "
               "and published rather than assumed small.",
        "method": "laboratory = blend(veg140, canopy140, 0.5); browser = "
                  "blend(resample(veg140,192), resample(canopy140,192), 0.5). Both brought to "
                  "a common grid with measure-spatial-accuracy.area_downsample (area-weighted, "
                  "exact for non-integer ratios), then differenced. Kelvin conversion is the "
                  "model's own veg term, L/k * dveg, with L and k from the shipping constants "
                  "and the near-nadir scene forcing.",
        "benchmark_K": {
            "canopy_v1_to_v2_per_cell_rms": list(CANOPY_CHANGE_RMS_K),
            "note": "The effect the whole canopy blend has on the field, measured through the "
                    "real solver. The 140-vs-192 residual is an approximation error INSIDE "
                    "that effect and must be a small fraction of it.",
        },
        "veg_term_sensitivity": coeff,
        "worst_case_K": {"at_140": worst_140, "at_ecostress_70m": worst_70,
                         "excess_over_control_at_ecostress_70m": worst_excess_k_70},
        "verdict": {
            "material_share_threshold": material_share,
            "worst_excess_over_blend_change_at_70m": worst_frac_70,
            "material": bool(worst_frac_70 > material_share),
        },
        "wards": wards,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    lo, hi = CANOPY_CHANGE_RMS_K
    print(f"\n  worst residual:")
    print(f"    at 140              {worst_140:.3f} K equilibrium-equivalent")
    print(f"    at ECOSTRESS 70 m   {worst_70:.3f} K, of which {worst_excess_k_70:.3f} K is in "
          f"excess of the resample control")
    print(f"    vs the {lo}-{hi} K the canopy blend itself moves the solved field: "
          f"{worst_70 / hi:.0%}-{worst_70 / lo:.0%} (upper bound; no diffusion in this "
          f"conversion)")
    print(f"    worst excess as a share of the blend's own effect at 70 m: {worst_frac_70:.1%} "
          f"(threshold {material_share:.0%})")
    if worst_frac_70 > material_share:
        print(f"\n  MATERIAL. Blending at 140 is not a rounding detail at the grid the "
              f"published figures are computed on. Revisit the decision: replay the "
              f"browser's 140->192 path in surface_layers() instead.")
    else:
        print(f"\n  NOT MATERIAL at the grid the published figures are computed on. The "
              f"disagreement is a resample-scale pattern and an ECOSTRESS cell is five "
              f"source cells wide, so the area downsample averages most of it away. It is "
              f"large at 140 and small where the figures are taken; the 140-grid decision "
              f"stands, and this script is the thing that has to be re-run if the grids, "
              f"the strength, or the canopy rasters change.")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
