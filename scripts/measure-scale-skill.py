"""Does the model's spatial skill survive coarsening? -> data/calibration/scale-skill.json

THE QUESTION. Against ECOSTRESS our physics field scores r = 0.216 while a plain
vegetation map scores 0.238 — the model loses to one of its own inputs. The easy
excuse is "ECOSTRESS is 70 m and our model is 7.29 m, so the test cannot see what
the model does". That excuse does not survive contact: blur and geolocation error
attenuate BOTH candidate fields against the SAME observation. To first order it is
a shared penalty, so it explains why r is 0.22 rather than 0.6 — it does not
explain why physics < veg.

There is exactly one mechanism that breaks the symmetry, and this script tests it.

The two fields have different spatial spectra. The physics field is
built-fraction-driven: sharp edges, structure at 7-30 m. The vegetation field is
park- and waterbody-driven: structure at 50-300 m. A 70 m footprint and ~46 m of
residual registration error punish a fine-structured field far harder than a
smooth one. So the vegetation null may be winning simply because its signal lives
at scales the observation can still resolve.

THE TEST. Recompute both correlations after progressively coarsening BOTH fields
and the observation together, by integer block factors over the ECOSTRESS grid.

  * physics converges on or overtakes veg as scale coarsens
        -> the model's signal is real and the observation cannot see it at 70 m.
           A scale-qualified claim becomes defensible.
  * physics stays flat below veg at every scale
        -> the physics adds nothing spatially, at any scale. The support argument
           is dead and the "illustrative" label stands.

Either way the guessing stops. Note that r is expected to RISE with coarsening for
every field, because averaging suppresses noise — the informative quantity is the
GAP between physics and veg, not either curve's level.

Reuses measure-spatial-accuracy.py wholesale for scene selection, field assembly
and the observation, so the only thing that differs between the two scripts is the
aggregation. A reimplementation would drift, and the drift would look like a result.

    python3 scripts/measure-scale-skill.py
    python3 scripts/measure-scale-skill.py --ward ballygunge

The fields coarsened here are the EQUILIBRIUM ones (see measure-spatial-accuracy.py's
header). The conclusion -- the physics-minus-vegetation gap does not close with
scale -- is very unlikely to flip under the diffused field, because diffusion lifts
BOTH candidates: measure-shipped-amplitude.py found the shipped model at 0.303 and
vegetation through the same solver at 0.314, the same ordering. But it has not been
re-run on the shipped field, and that is worth stating rather than assuming.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import warnings
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
import _physics  # noqa: E402
from _ecostress import target_grid, token  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "scale-skill.json")

#: Block factors over the ~67 m ECOSTRESS grid. 1 is the current published test.
#: 7 leaves a 3x3 field, which is the smallest thing a correlation can be computed
#: over without being a coin toss — MIN_BLOCK_CELLS enforces that per scene.
FACTORS = (1, 2, 3, 5, 7)

#: Below this many valid coarse cells the correlation is noise, not a measurement.
MIN_BLOCK_CELLS = 9


def _load_sibling() -> Any:
    """Import measure-spatial-accuracy.py, whose name is not an identifier."""
    path = os.path.join(HERE, "measure-spatial-accuracy.py")
    spec = importlib.util.spec_from_file_location("_msa", path)
    if spec is None or spec.loader is None:
        sys.exit("  cannot import scripts/measure-spatial-accuracy.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_msa"] = mod
    spec.loader.exec_module(mod)
    return mod


def block_mean(a: npt.NDArray[np.float64], k: int) -> npt.NDArray[np.float64]:
    """Mean over k x k blocks, NaN-aware, dropping any ragged edge.

    NaN-aware matters: the observation is already masked for cloud and QC, and a
    block straddling the mask must average the cells it HAS rather than poison the
    whole block. Blocks with no valid cell come back NaN and are dropped by the
    common mask below."""
    if k == 1:
        return a
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    if h == 0 or w == 0:
        return np.empty((0, 0), dtype=np.float64)
    v = a[:h, :w].reshape(h // k, k, w // k, k)
    # An all-NaN block is expected wherever cloud/QC masked a whole region; it
    # comes back NaN and is dropped by the common mask. numpy warns anyway.
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Mean of empty slice")
        return np.nanmean(v, axis=(1, 3))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", help="restrict to one ward")
    args = ap.parse_args()

    msa = _load_sibling()
    q_day, ratio, c, store = msa.live_constants()
    print(f"  shipping constants: Q={q_day:.4f}  kRad/h={ratio}  brutsaert_c={c}  store={store}\n")

    scenes, _lc, _dropped = _physics.load(all_angles=False)
    wards = {k: v for k, v in _types.WARDS.items() if not args.ward or k == args.ward}
    tok = token()

    layers: dict[str, dict[str, npt.NDArray[np.float32]]] = {}
    cell_m: dict[str, float] = {}
    for wid, w in wards.items():
        _tf, W, H = target_grid(_types.ward_bounds(w))
        veg, alb = msa.surface_layers(wid)
        layers[wid] = {
            "veg": msa.area_downsample(veg, H, W),
            "alb": msa.area_downsample(alb, H, W),
            "built": msa.area_downsample(msa.built_layer(wid), H, W),
        }
        cell_m[wid] = w.footprint_m / max(W, H)
        print(f"  {wid:<13} grid {W}x{H} · ~{cell_m[wid]:.0f} m/cell")

    # factor -> list of per-ward-scene correlations
    acc: dict[int, dict[str, list[float]]] = {
        k: {"physics": [], "veg": [], "built": [], "cells": []} for k in FACTORS}

    scored = 0
    for n, sc in enumerate(scenes, 1):
        for wid, w in wards.items():
            obs = msa.measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            lay = layers[wid]
            if obs.shape != lay["veg"].shape:
                continue
            if int(np.isfinite(obs).sum()) < msa.MIN_CELLS:
                continue

            mod = msa.modelled_field(sc, lay["veg"], lay["alb"], lay["built"],
                                     q_day, ratio, c, store).astype(np.float64)
            o = obs.astype(np.float64)
            # veg enters NEGATED, exactly as the published null does: more
            # vegetation, cooler surface.
            fields = {"physics": mod,
                      "veg": -lay["veg"].astype(np.float64),
                      "built": lay["built"].astype(np.float64)}
            # NaN the observation's masked cells so block_mean can exclude them,
            # and mask the SAME cells in every candidate — a field scored on more
            # cells than another is not a comparison.
            invalid = ~np.isfinite(o)
            o_masked = o.copy()
            o_masked[invalid] = np.nan
            scored += 1

            for k in FACTORS:
                ob = block_mean(o_masked, k)
                if ob.size == 0:
                    continue
                good = np.isfinite(ob)
                if int(good.sum()) < MIN_BLOCK_CELLS:
                    continue
                ov = ob[good]
                for name, f in fields.items():
                    fm = f.copy()
                    fm[invalid] = np.nan          # identical mask, then identical blocking
                    fb = block_mean(fm, k)[good]
                    if not np.all(np.isfinite(fb)):
                        continue
                    acc[k][name].append(msa.pearson(fb, ov))
                acc[k]["cells"].append(float(good.sum()))
        if n % 5 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {scored} ward-scenes")

    print(f"\n  scale      m/cell   n   physics     veg    built    gap(phys-veg)")
    out: dict[str, Any] = {"factors": {}, "min_block_cells": MIN_BLOCK_CELLS}
    base = float(np.mean(list(cell_m.values())))
    for k in FACTORS:
        a = acc[k]
        if not a["physics"]:
            continue
        p, v, b = (float(np.mean(a[x])) for x in ("physics", "veg", "built"))
        cells = float(np.mean(a["cells"]))
        print(f"  x{k:<3}    {base * k:7.0f}  {len(a['physics']):>3}   "
              f"{p:6.3f}  {v:6.3f}  {b:6.3f}     {p - v:+.3f}")
        out["factors"][str(k)] = {
            "block": k, "approx_m": round(base * k, 1), "n": len(a["physics"]),
            "mean_cells": round(cells, 1),
            "r_physics": round(p, 4), "r_veg": round(v, 4), "r_built": round(b, 4),
            "gap_physics_minus_veg": round(p - v, 4),
        }

    gaps = [(f["approx_m"], f["gap_physics_minus_veg"]) for f in out["factors"].values()]
    if len(gaps) >= 2:
        first, last = gaps[0][1], gaps[-1][1]
        out["verdict"] = (
            "physics closes on veg as scale coarsens — consistent with the observation "
            "being unable to resolve the model's fine structure"
            if last > first + 0.02 else
            "the gap does NOT close with scale — the physics adds no spatial skill over "
            "vegetation at any scale the observation can see, and the support argument "
            "does not rescue it")
        print(f"\n  gap at {gaps[0][0]:.0f} m: {first:+.3f}   at {gaps[-1][0]:.0f} m: {last:+.3f}")
        print(f"  VERDICT: {out['verdict']}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
