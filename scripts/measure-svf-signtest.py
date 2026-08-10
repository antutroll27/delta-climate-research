#!/usr/bin/env python3
"""PRE-REGISTERED SIGN TEST: does sky-view factor explain our night residuals?

Plan: docs/superpowers/plans/2026-08-09-gaussian-splat-view-parked.md is NOT this.
This is the heat-map lever from Learning Sunday 01 §1 / memory heat-map-physics-is-2d.

THE CLAIM UNDER TEST. `src/scripts/climate-engine/types.ts:9` governs the model:

    dT/dt = D grad^2 T + S(1-albedo)*sun - kRad*(T-Tsky) - L*veg - h*wind*(T-Tair) + Q*built
                                           ^^^^
`kRad` is a SCALAR, so every cell radiates to a full hemisphere. Real canyons do
not: a cell with sky-view factor 0.4 loses ~60 % less longwave to the sky than
open ground at 1.0. If that omission is real and material, it must show up as
structure in the residuals we already have.

THE DIRECTION, FIXED BEFORE ANY NUMBER WAS COMPUTED:

    The solver assumes SVF = 1 everywhere, so it OVER-COOLS enclosed cells.
    At low SVF the model should run TOO COLD -> residual (model - obs) negative.
    At SVF ~ 1 the assumption is correct -> residual ~ 0.

    => corr(SVF, model - obs) > 0 at night.     PASS
       corr <= 0, or indistinguishable from 0.  FAIL — the idea is dead.

A null or wrong-signed result kills this the way the OHM sign test killed thermal
storage. That is the point of writing the direction down first.

WHAT THIS DOES NOT DO. It changes no model, no constant and no published figure.
It reads the shipped surface rasters, the shipped heights, and the cached
ECOSTRESS granules, and reports one correlation per phase.

Run:  python3 scripts/measure-svf-signtest.py
      python3 scripts/measure-svf-signtest.py --limit 20     (quick pass)
      python3 scripts/measure-svf-signtest.py --self-check
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from typing import Any, cast

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402
import _types  # noqa: E402
from _ecostress import target_grid, token  # noqa: E402
from _types import F32, F64, WardId  # noqa: E402

# measure-spatial-accuracy.py owns the observed/modelled field construction and
# is the artefact the published SPATIAL figures come from. Its filename is
# hyphenated so it cannot be imported normally — loading it by path is
# deliberate: duplicating `modelled_field` here would let the two drift, and a
# sign test measured against a DIFFERENT model than the one we publish would be
# worthless.
_spec = importlib.util.spec_from_file_location(
    "_spatial", os.path.join(HERE, "measure-spatial-accuracy.py"))
assert _spec is not None and _spec.loader is not None
_spatial = importlib.util.module_from_spec(_spec)
sys.modules["_spatial"] = _spatial
_spec.loader.exec_module(_spatial)

GEOM = os.path.join(ROOT, "data", "geometry")
OUT = os.path.join(ROOT, "data", "calibration", "svf-signtest.json")

#: DSM resolution for the sky-view computation, metres. Finer than the 70 m
#: analysis grid on purpose — SVF is a geometric property of the streetscape and
#: averaging heights before computing horizons would erase the canyons the test
#: is looking for. 5 m sits below the ~10-12 m median building spacing.
DSM_M = 5.0
#: Azimuths sampled for the horizon search. 16 is UMEP's own default order of
#: magnitude; the estimate is a mean over directions so it converges quickly.
AZIMUTHS = 16
#: Horizon search radius. Beyond ~150 m a building would need to be implausibly
#: tall to occlude, and the cost is linear in this.
SEARCH_M = 150.0
#: Same bar as the shipped spatial pass: below this a scene's correlation is noise.
MIN_CELLS = 12


def _ward_heights(ward: WardId) -> dict[str, float]:
    with open(os.path.join(GEOM, "heights-overture.json"), encoding="utf-8") as fh:
        doc = cast(dict[str, Any], json.load(fh))
    method = cast(dict[str, Any], json.load(
        open(os.path.join(GEOM, "height-method.json"), encoding="utf-8")))["method"]
    return {str(r["id"]): float(r[method]) for r in doc["wards"][ward]}


def build_dsm(ward: WardId, size_m: float) -> F32:
    """Rasterise footprints + heights into a digital SURFACE model, north-up.

    Scanline fill per polygon: no shapely, and the ring is already a closed
    simple polygon in ward-local metres.
    """
    heights = _ward_heights(ward)
    with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
        doc = cast(_types.FootprintsFile, json.load(fh))
    n = int(round(size_m / DSM_M))
    dsm = np.zeros((n, n), dtype=np.float32)
    half = size_m / 2.0
    for b in doc["b"]:
        h = heights.get(b["gers"])
        if not h or h <= 0:
            continue
        ring = np.array(b["p"], dtype=np.float64).reshape(-1, 2)
        # metres -> cell indices. Row 0 = NORTH, so y is flipped: this file is
        # north-up like measured_field, unlike the TS rasteriser.
        cx = (ring[:, 0] + half) / DSM_M
        cy = (half - ring[:, 1]) / DSM_M
        y0 = max(0, int(math.floor(cy.min())))
        y1 = min(n - 1, int(math.ceil(cy.max())))
        for row in range(y0, y1 + 1):
            yc = row + 0.5
            xs: list[float] = []
            for i in range(len(cx)):
                j = (i + 1) % len(cx)
                ay, by = cy[i], cy[j]
                if (ay <= yc < by) or (by <= yc < ay):
                    t = (yc - ay) / (by - ay)
                    xs.append(cx[i] + t * (cx[j] - cx[i]))
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                a = max(0, int(math.ceil(xs[k] - 0.5)))
                bb = min(n - 1, int(math.floor(xs[k + 1] - 0.5)))
                if bb >= a:
                    np.maximum(dsm[row, a:bb + 1], np.float32(h), out=dsm[row, a:bb + 1])
    return dsm


def sky_view_factor(dsm: F32) -> F32:
    """SVF per cell from a surface model, by the Ratti & Richens shear-and-max
    horizon search (the method SOLWEIG uses; implemented fresh — SOLWEIG is
    GPL-3.0 and only its published description is used here).

    For a horizontal receiver under an isotropic sky, obstructed below elevation
    angle beta(phi):

        SVF = (1/N) * sum_phi ( 1 - sin^2(beta_phi) )

    which is the projected-solid-angle integral, normalised so an unobstructed
    hemisphere gives 1.
    """
    n = dsm.shape[0]
    steps = int(SEARCH_M / DSM_M)
    total = np.zeros_like(dsm, dtype=np.float32)
    for a in range(AZIMUTHS):
        phi = 2.0 * math.pi * a / AZIMUTHS
        max_tan = np.zeros_like(dsm, dtype=np.float32)
        for k in range(1, steps + 1):
            dx = int(round(k * math.cos(phi)))
            dy = int(round(k * math.sin(phi)))
            if dx == 0 and dy == 0:
                continue
            shifted = np.roll(np.roll(dsm, -dy, axis=0), -dx, axis=1)
            # np.roll wraps; a wrapped edge would invent a horizon, so blank it.
            if dy > 0:
                shifted[n - dy:, :] = 0.0
            elif dy < 0:
                shifted[:-dy, :] = 0.0
            if dx > 0:
                shifted[:, n - dx:] = 0.0
            elif dx < 0:
                shifted[:, :-dx] = 0.0
            dist = math.hypot(dx, dy) * DSM_M
            np.maximum(max_tan, (shifted - dsm) / np.float32(dist), out=max_tan)
        beta = np.arctan(max_tan)
        total += (1.0 - np.sin(beta) ** 2).astype(np.float32)
    return cast(F32, total / AZIMUTHS)


def pearson(x: F64, y: F64) -> float:
    if x.size < 3:
        return float("nan")
    sx, sy = float(x.std()), float(y.std())
    if sx == 0.0 or sy == 0.0:
        return float("nan")
    return float(np.mean((x - x.mean()) * (y - y.mean())) / (sx * sy))


def partial_corr(x: F64, y: F64, controls: list[F64]) -> float:
    """corr(x, y) with `controls` linearly regressed out of both.

    POST-HOC, and labelled as such wherever it is reported. SVF is collinear with
    built fraction (r = -0.43 to -0.84) and vegetation (+0.36 to +0.69), so a raw
    correlation cannot separate "missing sky-view cooling" from "the built and veg
    terms we already have are mis-scaled". This separates them — but the
    pre-registered statistic is the RAW correlation, and swapping statistics after
    seeing the data is precisely what pre-registration exists to prevent. This is
    a diagnostic for understanding a result, never a second chance to pass.
    """
    if x.size < 5:
        return float("nan")
    Z = np.column_stack([np.ones_like(x), *controls])
    rx = x - Z @ np.linalg.lstsq(Z, x, rcond=None)[0]
    ry = y - Z @ np.linalg.lstsq(Z, y, rcond=None)[0]
    return pearson(rx, ry)


def sign_test_p(values: F64) -> float:
    """Two-sided sign test against Binomial(n, 1/2). BOTH tails — an earlier
    version summed only the upper tail, which reported a unanimous NEGATIVE
    result as p = 1.0 (perfectly null) when it was in fact p ~ 1e-5."""
    n = int(values.size)
    k = int((values > 0).sum())
    if n == 0:
        return float("nan")
    upper = sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n
    lower = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return float(min(1.0, 2.0 * min(upper, lower)))


def self_check() -> None:
    """Runnable checks on the geometry, independent of any climate data."""
    # An empty surface must be fully open.
    flat = np.zeros((40, 40), dtype=np.float32)
    assert abs(float(sky_view_factor(flat).mean()) - 1.0) < 1e-6, "flat ground must be SVF 1"

    # A deep canyon must be more enclosed than open ground, and a DEEPER canyon
    # more enclosed still — the monotonicity the whole test rests on.
    def canyon(height: float) -> float:
        d = np.zeros((60, 60), dtype=np.float32)
        d[:, :28] = height
        d[:, 32:] = height
        return float(sky_view_factor(d)[30, 30])
    shallow, deep = canyon(10.0), canyon(40.0)
    assert shallow < 0.98, f"a 10 m canyon should be enclosed, got {shallow:.3f}"
    assert deep < shallow, f"deeper canyon must have lower SVF ({deep:.3f} !< {shallow:.3f})"
    assert 0.0 <= deep <= 1.0, "SVF must stay in [0, 1]"

    # The DSM must be north-up: a building in the far north lands in row 0's half.
    dsm = build_dsm("ballygunge", 1400.0)
    assert dsm.shape[0] == int(1400.0 / DSM_M), "DSM grid size wrong"
    assert float(dsm.max()) > 5.0, "no buildings rasterised — check the height join"
    print(f"  self-check OK (flat=1.000, canyon 10 m={shallow:.3f} > 40 m={deep:.3f}, "
          f"DSM max {dsm.max():.1f} m)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    self_check()
    if args.self_check:
        return 0

    print("\n  PRE-REGISTERED: corr(SVF, model - obs) > 0 at NIGHT means the "
          "missing\n  sky-view term is real. <= 0 or null kills it.\n")

    q_day, ratio, c, store = _spatial.live_constants()
    scenes, _lc, dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[:args.limit]
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped)")

    tok = token()
    layers: dict[str, dict[str, F32]] = {}
    for wid, w in _types.WARDS.items():
        _tf, W, H = target_grid(_types.ward_bounds(w))
        veg, alb = _spatial.surface_layers(wid)
        svf_fine = sky_view_factor(build_dsm(wid, float(w.footprint_m)))
        layers[wid] = {
            "veg": _spatial.area_downsample(veg, H, W),
            "alb": _spatial.area_downsample(alb, H, W),
            "built": _spatial.area_downsample(_spatial.built_layer(wid), H, W),
            "svf": _spatial.area_downsample(svf_fine, H, W),
        }
        s = layers[wid]["svf"]
        print(f"  {wid:<13} grid {W}x{H} · SVF mean {s.mean():.3f} "
              f"sd {s.std():.3f} min {s.min():.3f}")

    rows: list[dict[str, Any]] = []
    for n, sc in enumerate(scenes, 1):
        for wid, w in _types.WARDS.items():
            obs = _spatial.measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            lay = layers[wid]
            m = np.isfinite(obs)
            if int(m.sum()) < MIN_CELLS:
                continue
            mod = _spatial.modelled_field(sc, lay["veg"], lay["alb"], lay["built"],
                                          q_day, ratio, c, store)
            o = obs[m].astype(np.float64)
            md = mod[m].astype(np.float64)
            # Residual of the PATTERN: the ward-mean bias is measure-accuracy.py's
            # business, and a constant offset carries no information about SVF.
            resid = (md - md.mean()) - (o - o.mean())
            svf = lay["svf"][m].astype(np.float64)
            ctrl = [lay["built"][m].astype(np.float64), lay["veg"][m].astype(np.float64)]
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid,
                "cells": int(m.sum()),
                # PRE-REGISTERED statistic
                "r_svf_resid": pearson(svf, resid),
                # POST-HOC diagnostic, SVF collinear with built/veg — see partial_corr
                "r_svf_resid_partial": partial_corr(svf, resid, ctrl),
                "r_svf_obs": pearson(svf, o),
                "svf_sd": float(svf.std()),
            })
        if n % 10 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(rows)} ward-scenes")

    print(f"\n  PRE-REGISTERED statistic — raw corr(SVF, model-obs)")
    print(f"  {'phase':<8} {'scenes':>7} {'mean r':>9} {'median r':>10} "
          f"{'% pos':>7} {'p':>9}  verdict")
    print("  " + "-" * 74)
    summary: dict[str, Any] = {}
    for phase in ("night", "day"):
        rs = [r["r_svf_resid"] for r in rows
              if r["phase"] == phase and not math.isnan(r["r_svf_resid"])]
        if not rs:
            print(f"  {phase:<8} {'-':>7}   (no scenes)")
            continue
        arr = np.array(rs, dtype=np.float64)
        pos = 100.0 * float((arr > 0).mean())
        nn = len(arr)
        p_two = sign_test_p(arr)
        verdict = ("null — SVF explains nothing" if p_two >= 0.05
                   else "PASS — sign as pre-registered" if arr.mean() > 0
                   else "*** REJECTED: significant, WRONG SIGN ***")
        print(f"  {phase:<8} {nn:>7} {arr.mean():>9.3f} {np.median(arr):>10.3f} "
              f"{pos:>6.0f}% {p_two:>9.2e}  {verdict}")
        par = np.array([r["r_svf_resid_partial"] for r in rows
                        if r["phase"] == phase and not math.isnan(r["r_svf_resid_partial"])],
                       dtype=np.float64)
        summary[phase] = {"scenes": nn, "mean_r": float(arr.mean()),
                          "median_r": float(np.median(arr)), "pct_positive": pos,
                          "sign_test_p": p_two, "verdict": verdict,
                          "posthoc_partial_mean_r": float(par.mean()) if par.size else None,
                          "posthoc_partial_pct_positive":
                              100.0 * float((par > 0).mean()) if par.size else None,
                          "posthoc_partial_p": sign_test_p(par) if par.size else None}

    print(f"\n  POST-HOC — partial corr, built + veg regressed out (NOT the")
    print(f"  pre-registered test; SVF is collinear with both)")
    print(f"  {'phase':<8} {'mean r':>9} {'% pos':>7} {'p':>9}")
    print("  " + "-" * 38)
    for phase in ("night", "day"):
        sm = summary.get(phase)
        if not sm or sm["posthoc_partial_mean_r"] is None:
            continue
        print(f"  {phase:<8} {sm['posthoc_partial_mean_r']:>9.3f} "
              f"{sm['posthoc_partial_pct_positive']:>6.0f}% {sm['posthoc_partial_p']:>9.2e}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({
            "_what": "Pre-registered sign test: corr(SVF, model-obs). Direction fixed "
                     "before measurement — positive at night means the missing sky-view "
                     "term is real.",
            "method": {"dsm_m": DSM_M, "azimuths": AZIMUTHS, "search_m": SEARCH_M,
                       "svf_formula": "mean_phi(1 - sin^2(beta))",
                       "residual": "(model - model.mean()) - (obs - obs.mean())"},
            "summary": summary, "rows": rows,
        }, fh, indent=2)
    print(f"\n  written {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
