#!/usr/bin/env python3
"""
Does the heat map put the hot spots in the RIGHT PLACES?

    python3 scripts/measure-spatial-accuracy.py [--limit N] [--ward NAME]

WHY THIS EXISTS. Every figure in src/scripts/climate-engine/accuracy.ts is a
WARD-MEAN error: how far the model's average temperature sits from ECOSTRESS's
average over the same 1400 m box. That says nothing about whether the pattern
INSIDE the ward is right — and the pattern is what a municipal officer reads the
map for. A model that gets the ward mean perfect and puts every hot spot in the
wrong block would score identically to one that gets both right.

So this measures the other thing: with the ward mean removed from both sides,
how well does the modelled field correlate with the measured one, cell by cell,
at ECOSTRESS's native 70 m?

THE NULL MODELS ARE THE POINT. A correlation on its own is unreadable — r = 0.45
sounds respectable until you learn that "buildings are hot, everything else is
cool" scores 0.44 on the same scenes. Every run therefore scores three
predictors on identical cells:

    physics    the shipping model — solar, sky, wind, ET, per-cell veg/albedo/built
    built      built fraction alone, the trivial predictor
    veg        vegetation fraction alone, sign-flipped

If `physics` does not beat both, the physics is adding nothing to the spatial
pattern over what a footprint map already tells you, and the honest thing is to
say so rather than publish the correlation on its own.

METHOD, and its limits:
  * Near-nadir scenes only, matching the published figures — urban-rural
    view_zenith delta correlates with SUHII at r = -0.322, so ~10 % of the raw
    signal is sensor geometry rather than surface.
  * Both fields are CENTRED per scene before correlating. Ward-mean bias is
    already measured by measure-accuracy.py; leaving it in here would let a
    model with the right average score well on pattern it does not have.
  * Cells are dropped where ECOSTRESS is cloudy, low-quality, water, or NaN. A
    scene needs MIN_CELLS surviving to be scored at all.
  * The model is evaluated at EQUILIBRIUM, cell by cell, with no lateral
    diffusion. The shipping engine relaxes a diffusive field toward this same
    equilibrium, so this is the model's target state, not a separate model — but
    it means measured advection between adjacent cells is unmodelled here and
    counts against the score.

Output: data/calibration/spatial-accuracy.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
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
OUT = os.path.join(ROOT, "data", "calibration", "spatial-accuracy.json")

#: Encoding of the exported surface PNG — must mirror export-surface-rasters.py.
VEG_RANGE = (0.0, 1.0)
ALBEDO_RANGE = (0.0, 0.5)

#: A ward is ~21 x 21 cells at 70 m, so a scene with only a handful of clear
#: cells gives a correlation that is mostly noise. Twelve is already generous;
#: below it the scene is recorded as skipped rather than averaged in.
MIN_CELLS = 12


def surface_layers(ward_id: str) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float32]]:
    """Per-cell vegetation and albedo at the Sentinel grid, decoded from the PNG.

    Read back from the SHIPPED texture rather than recomputed from the composite
    cache: this is what the browser actually runs on, quantisation included, so
    validating anything else would validate a model nobody uses.
    """
    path = os.path.join(SURFACE_DIR, f"{ward_id}-surface.png")
    if not os.path.exists(path):
        sys.exit(f"{os.path.relpath(path, ROOT)} is missing — run "
                 f"scripts/export-surface-rasters.py first.")
    a = np.asarray(Image.open(path)).astype(np.float32)
    veg = a[:, :, 0] / 255.0 * (VEG_RANGE[1] - VEG_RANGE[0]) + VEG_RANGE[0]
    alb = a[:, :, 1] / 255.0 * (ALBEDO_RANGE[1] - ALBEDO_RANGE[0]) + ALBEDO_RANGE[0]
    return veg.astype(np.float32), alb.astype(np.float32)


def built_layer(ward_id: str) -> npt.NDArray[np.float32]:
    """Building coverage at the Sentinel grid, from the canonical TS rasteriser."""
    path = os.path.join(BUILT_CACHE, f"{ward_id}-built-{SURFACE_GRID}.f32")
    if not os.path.exists(path):
        sys.exit(f"{os.path.relpath(path, os.path.expanduser('~'))} is missing — run "
                 f"`npx tsx scripts/export-built-raster.mjs` first. It is written by the "
                 f"TypeScript rasteriser on purpose; a Python reimplementation would drift "
                 f"and the drift would look like the model failing validation.")
    a = np.fromfile(path, dtype=np.float32)
    return a.reshape(SURFACE_GRID, SURFACE_GRID)


def area_downsample(src: npt.NDArray[np.float32], out_h: int, out_w: int) -> npt.NDArray[np.float32]:
    """Area-weighted mean of `src` onto an out_h x out_w grid over the same extent.

    NOT a block mean: 140 does not divide by 21, so fixed blocks would drop or
    double-count a row of source cells and shift the whole field by a fraction of
    an output cell. A fractional-overlap weighting is exact for any ratio, which
    matters because a half-cell shift against ECOSTRESS is a real correlation
    penalty invented by the resampler.
    """
    def weights(n_src: int, n_out: int) -> npt.NDArray[np.float64]:
        edges = np.linspace(0, n_src, n_out + 1)
        w = np.zeros((n_out, n_src))
        for j in range(n_out):
            lo, hi = edges[j], edges[j + 1]
            first, last = int(np.floor(lo)), int(np.ceil(hi))
            for i in range(first, min(last, n_src)):
                w[j, i] = max(0.0, min(hi, i + 1) - max(lo, i))
            total = w[j].sum()
            if total > 0:
                w[j] /= total
        return w

    wy = weights(src.shape[0], out_h)
    wx = weights(src.shape[1], out_w)
    return (wy @ src.astype(np.float64) @ wx.T).astype(np.float32)


def measured_field(ward: _types.Ward, date: str, phase: str, tok: str
                   ) -> npt.NDArray[np.float32] | None:
    """ECOSTRESS surface temperature over one ward, °C, NaN where unusable.

    Same masking as the SUHII measurement — physical range, QC mandatory bits,
    the separate cloud band (the QC cloud bits are unset in v002), and water.
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
                # first valid pixel wins, matching the SUHII compositor
                lst = cel if lst is None else np.where(np.isfinite(lst), lst, cel)
            except Exception:
                continue
    return lst


def modelled_field(sc: _physics.Scene, veg: npt.NDArray[np.float32],
                   alb: npt.NDArray[np.float32], built: npt.NDArray[np.float32],
                   q_day: float, ratio: float, c: float, store: float) -> npt.NDArray[np.float32]:
    """Equilibrium surface temperature per cell, °C.

    The scalar assembly below is `_physics.predict` with the two land-cover masks
    replaced by arrays — same constants, same order of operations. The physics
    itself stays in `_physics._eq`, evaluated here on arrays via the identical
    expression, so this cannot drift into being a second model.
    """
    kRad = _physics.K_SUM * ratio / (1 + ratio)
    h = _physics.K_SUM - kRad
    night = sc.phase == "night"

    tSky = _physics.sky_temp(sc.tAir, sc.rh, sc.cloud, c)
    sun = 0.0 if night else sc.sun * (1 - 0.6 * sc.cloud)
    Q = q_day * (_physics.Q_NIGHT_RATIO if night else 1.0)
    k = kRad + h * sc.wind
    pull = kRad * tSky + h * sc.wind * sc.tAir

    L = _physics.L_ET * (0.6 + 0.6 * (1 - sc.rh / 100))
    if night:
        # The ET taper keys off the ward's mean built fraction, matching
        # nightLatent()'s use of a single rural reference rather than a per-cell
        # dewpoint — see the note in heat-map-model.ts.
        dry_veg = (Q * float(built.mean()) + pull) / k
        headroom = (dry_veg - _physics.dewpoint(sc.tAir, sc.rh)) / _physics.DEWPOINT_TAPER_K
        L = L * _physics.NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))

    stored = store if night else 0.0
    field: npt.NDArray[np.float32] = (
        (_physics.S_SOLAR * (1 - alb) * sun + Q * built - L * veg + stored + pull) / k
    ).astype(np.float32)
    return field


def live_constants() -> tuple[float, float, float, float]:
    """(Q, kRad/h ratio, Brutsaert c, nocturnal storage) as the browser runs them.

    Parsed from the TypeScript rather than duplicated here. A second copy of
    these numbers is a second thing to update, and the whole point of this
    measurement is that it describes the SHIPPING model — a stale copy would
    quietly make it describe something else.
    """
    src = os.path.join(ROOT, "src", "scripts", "climate-engine")
    with open(os.path.join(src, "types.ts")) as fh:
        text = fh.read()
    block = text[text.index("DEFAULT_PARAMS"):]
    block = block[:block.index("};")]
    vals: dict[str, float] = {k: float(v) for k, v in re.findall(r"(\w+):\s*([0-9.]+)", block)}
    for need in ("Q", "kRad", "h"):
        if need not in vals:
            sys.exit(f"could not read {need} from DEFAULT_PARAMS — the shape of "
                     f"types.ts changed and this parser must follow it.")
    with open(os.path.join(src, "sky.ts")) as fh:
        m = re.search(r"skyTemperatureC\([^)]*c\s*=\s*([0-9.]+)", fh.read())
    if not m:
        sys.exit("could not read the Brutsaert coefficient default from sky.ts")
    st = re.search(r"STORE_NIGHT\s*=\s*([0-9.]+)", text)
    if not st:
        sys.exit("could not read STORE_NIGHT from types.ts — the model gained a "
                 "nocturnal storage term and this measurement must include it, or it "
                 "scores a model the browser does not run.")
    return vals["Q"], vals["kRad"] / vals["h"], float(m.group(1)), float(st.group(1))


def model_terms(sc: _physics.Scene, veg: npt.NDArray[np.float32],
                alb: npt.NDArray[np.float32], built: npt.NDArray[np.float32],
                q_day: float, ratio: float) -> dict[str, npt.NDArray[np.float32]]:
    """The three spatially-varying terms of the field, each already divided by k.

    Same assembly as `modelled_field`, split rather than summed, so each term is
    in the same units (K) as the field it contributes to and their standard
    deviations are directly comparable.
    """
    kRad = _physics.K_SUM * ratio / (1 + ratio)
    h = _physics.K_SUM - kRad
    night = sc.phase == "night"
    sun = 0.0 if night else sc.sun * (1 - 0.6 * sc.cloud)
    Q = q_day * (_physics.Q_NIGHT_RATIO if night else 1.0)
    k = kRad + h * sc.wind
    L = _physics.L_ET * (0.6 + 0.6 * (1 - sc.rh / 100))
    if night:
        L = L * _physics.NIGHT_ET_FRACTION
    return {
        "solar_albedo": (_physics.S_SOLAR * (1 - alb) * sun / k).astype(np.float32),
        "built": (Q * built / k).astype(np.float32),
        "veg": (-L * veg / k).astype(np.float32),
    }


def pearson(x: npt.NDArray[np.float64], y: npt.NDArray[np.float64]) -> float:
    """Correlation of two already-finite vectors, or NaN if either is constant."""
    xc, yc = x - x.mean(), y - y.mean()
    denom = math.sqrt(float((xc * xc).sum()) * float((yc * yc).sum()))
    return float((xc * yc).sum() / denom) if denom > 0 else float("nan")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N scenes (0 = all)")
    ap.add_argument("--ward", default="", help="restrict to one ward")
    args = ap.parse_args()

    # THE SHIPPING CONSTANTS, NOT THE FITTED ONES. data/calibration/
    # fitted-constants.json carries `ship: false`, all three parameters pinned to
    # their bounds, and the verdict "the model structure is wrong, not its
    # constants". Validating that set would measure a model the site does not
    # run — this pass exists to describe what a visitor actually sees, so it
    # reads DEFAULT_PARAMS from src/scripts/climate-engine/types.ts and
    # skyTemperatureC's default from sky.ts.
    q_day, ratio, c, store = live_constants()
    print(f"  shipping constants: Q={q_day}  kRad/h={ratio}  brutsaert_c={c}  store={store}\n")

    scenes, _lc, dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[:args.limit]
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped on view angle / no rural)\n")

    wards = {k: v for k, v in _types.WARDS.items() if not args.ward or k == args.ward}
    tok = token()

    # Per-ward layers, downsampled once to the ECOSTRESS grid.
    layers: dict[str, dict[str, npt.NDArray[np.float32]]] = {}
    for wid, w in wards.items():
        _tf, W, H = target_grid(_types.ward_bounds(w))
        veg, alb = surface_layers(wid)
        layers[wid] = {
            "veg": area_downsample(veg, H, W),
            "alb": area_downsample(alb, H, W),
            "built": area_downsample(built_layer(wid), H, W),
        }
        print(f"  {wid:<13} ECOSTRESS grid {W}x{H} · veg sd {layers[wid]['veg'].std():.3f}"
              f" · built sd {layers[wid]['built'].std():.3f}")

    rows: list[dict[str, Any]] = []
    for n, sc in enumerate(scenes, 1):
        for wid, w in wards.items():
            obs = measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            lay = layers[wid]
            if obs.shape != lay["veg"].shape:
                sys.exit(f"{wid} {sc.date}: ECOSTRESS grid {obs.shape} does not match the "
                         f"surface grid {lay['veg'].shape} — the two are supposed to come "
                         f"from the same ward_bounds().")
            m = np.isfinite(obs)
            if int(m.sum()) < MIN_CELLS:
                continue

            mod = modelled_field(sc, lay["veg"], lay["alb"], lay["built"], q_day, ratio, c, store)
            o = obs[m].astype(np.float64)
            terms = model_terms(sc, lay["veg"], lay["alb"], lay["built"], q_day, ratio)
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid, "cells": int(m.sum()),
                # the three predictors, scored on identical cells
                "r_physics": pearson(mod[m].astype(np.float64), o),
                "r_built": pearson(lay["built"][m].astype(np.float64), o),
                "r_veg": pearson(-lay["veg"][m].astype(np.float64), o),
                # anomaly RMSE: error remaining once the ward-mean bias, which
                # measure-accuracy.py already reports, is taken out
                "anomaly_rmse_k": float(np.sqrt(np.mean(
                    ((mod[m] - mod[m].mean()) - (o - o.mean())) ** 2))),
                "observed_sd_k": float(o.std()),
                # Per-term skill and per-term spatial amplitude. The pair is what
                # makes the result actionable: a term that dominates the variance
                # while carrying no correlation is diluting the terms that do.
                **{f"r_term_{k}": pearson(v[m].astype(np.float64), o) for k, v in terms.items()},
                **{f"sd_term_{k}": float(v.std()) for k, v in terms.items()},
            })
        if n % 5 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(rows)} ward-scenes scored")

    if not rows:
        sys.exit("no ward-scene pairs survived masking — nothing to report")

    def agg(phase: str | None, key: str) -> float:
        vals = [r[key] for r in rows
                if (phase is None or r["phase"] == phase) and not math.isnan(r[key])]
        return float(np.mean(vals)) if vals else float("nan")

    out: dict[str, Any] = {
        "method": "Pearson correlation between the modelled equilibrium field and ECOSTRESS "
                  "L2T LSTE v002, per ward per scene, at the sensor's native 70 m. Both "
                  "fields centred on their own ward mean first, so this measures PATTERN "
                  "only — ward-mean error is reported separately by measure-accuracy.py.",
        "why_null_models": "r on its own is unreadable. `built` is the trivial predictor "
                           "(buildings are hot); `veg` is vegetation, sign-flipped. If the "
                           "physics does not beat both, it is adding nothing spatially that "
                           "a footprint map does not already say.",
        "limits": "Equilibrium, no lateral diffusion, so real advection between adjacent "
                  "cells counts against the model. Near-nadir scenes only. A ward is ~21x21 "
                  "cells at 70 m, so per-scene r is noisy; the aggregate is the figure.",
        "scenes": len(scenes),
        "ward_scenes_scored": len(rows),
        "overall": {k: agg(None, k) for k in ("r_physics", "r_built", "r_veg", "anomaly_rmse_k")},
        "by_phase": {p: {k: agg(p, k) for k in
                         ("r_physics", "r_built", "r_veg", "anomaly_rmse_k")}
                     for p in ("day", "night")},
        "terms": {t: {"r": agg(None, f"r_term_{t}"), "spatial_sd_k": agg(None, f"sd_term_{t}")}
                  for t in ("solar_albedo", "built", "veg")},
        "constants": {"note": "DEFAULT_PARAMS from types.ts + sky.ts — what ships, NOT "
                              "fitted-constants.json, which carries ship:false",
                      "Q": q_day, "kRad_over_h": ratio, "brutsaert_c": c,
                      "store_night": store},
        "rows": rows,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"\n  {'':14}{'physics':>9}{'built':>9}{'veg':>9}{'anom RMSE':>11}{'n':>6}")
    for label, ph in (("overall", None), ("day", "day"), ("night", "night")):
        n = len([r for r in rows if ph is None or r["phase"] == ph])
        print(f"  {label:<14}{agg(ph,'r_physics'):>9.3f}{agg(ph,'r_built'):>9.3f}"
              f"{agg(ph,'r_veg'):>9.3f}{agg(ph,'anomaly_rmse_k'):>10.2f}K{n:>6}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")

    print(f"\n  {'term':<16}{'r':>8}{'spatial SD (K)':>16}")
    for t in ("solar_albedo", "built", "veg"):
        print(f"  {t:<16}{agg(None, f'r_term_{t}'):>8.3f}{agg(None, f'sd_term_{t}'):>16.2f}")

    beat = agg(None, "r_physics") - max(agg(None, "r_built"), agg(None, "r_veg"))
    if beat > 0.05:
        print(f"\n  Physics beats the best null by {beat:+.3f} r — it is carrying "
              f"spatial information the surface layers alone do not.")
    else:
        print(f"\n  Physics does NOT beat the best null ({beat:+.3f} r). Read the term "
              f"table above: the term with the largest spatial SD is what the map's "
              f"within-ward pattern actually shows, and if its r is near zero then "
              f"that pattern is not measurably real. Do not describe the within-ward "
              f"detail as validated.")


if __name__ == "__main__":
    main()
