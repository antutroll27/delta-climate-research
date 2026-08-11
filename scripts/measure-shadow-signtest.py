#!/usr/bin/env python3
"""PRE-REGISTERED SIGN TEST: does building shadow explain our DAY residuals?

The other half of the test that killed SVF. `measure-svf-signtest.py` rejected
the sky-view half outright (night mean r = -0.514, 0/50 scenes positive,
p = 1.8e-15) because our wards have no canyons -- SVF 0.82-0.92, sd 0.04-0.07.
**Shadow was never tested at all**, and it is a different quantity: it varies
with the sun as well as the geometry, so a low-rise ward that cannot make a
canyon can still make a long shadow at 07:00.

THE CLAIM UNDER TEST. `src/scripts/climate-engine/types.ts:9` governs the model:

    dT/dt = D grad^2 T + S(1-albedo)*sun - kRad*(T-Tsky) - L*veg - h*wind*(T-Tair) + Q*built
                          ^^^
`sun` is a SCALAR, so every cell receives the full beam. Real streets do not: a
cell in a building's shadow receives only diffuse. If that omission is real and
material it must show up as structure in the residuals we already hold.

THE DIRECTION, FIXED BEFORE ANY NUMBER WAS COMPUTED:

    The solver assumes shade = 0 everywhere, so it OVER-HEATS shadowed cells.
    Where shade is high the model should run TOO HOT -> residual (model - obs)
    POSITIVE. Where shade ~ 0 the assumption is correct -> residual ~ 0.

    => corr(shade, model - obs) > 0 by DAY.      PASS
       corr <= 0, or indistinguishable from 0.   FAIL -- the idea is dead.

    NOTE THE SIGN IS OPPOSITE TO SVF's, and for a physical reason: high SVF means
    MORE cooling the model omits (model too warm), while high shade means LESS
    heating the model wrongly applied (model also too warm). Both predicted
    positive, via different terms. Getting this backwards is the single easiest
    way to fake a pass, so it is written out here in full.

THE PLACEBO ARM, ALSO PRE-REGISTERED. The SVF test's fatal flaw was collinearity:
SVF correlates with `built` at r = -0.43..-0.84, so a raw correlation could not
separate "missing sky-view cooling" from "the Q*built term is mis-scaled". Shadow
has the same exposure -- tall buildings both shade and store heat. So:

    NIGHT scenes are scored against the SAME ward geometry's shadow field
    computed at LOCAL NOON on that date. At night there is no sun and no
    shading, so a real shadow effect must give ~ 0 here.

    => night |r| comparable to day  =>  we are measuring BUILDING DENSITY,
                                        not shading. The day result is void.

WHAT THIS DOES NOT DO. It changes no model, no constant and no published figure.
It reads the shipped surface rasters, the shipped heights and the cached
ECOSTRESS granules, and reports one correlation per scene.

Run:  python3 scripts/measure-shadow-signtest.py
      python3 scripts/measure-shadow-signtest.py --limit 20     (quick pass)
      python3 scripts/measure-shadow-signtest.py --self-check
"""
from __future__ import annotations

import argparse
import datetime as dt
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

# Same deliberate path-load as the SVF test: measure-spatial-accuracy.py owns the
# observed/modelled field construction and is the artefact the published SPATIAL
# figures come from. A sign test measured against a DIFFERENT model than the one
# we publish would be worthless.
_spec = importlib.util.spec_from_file_location(
    "_spatial", os.path.join(HERE, "measure-spatial-accuracy.py"))
assert _spec is not None and _spec.loader is not None
_spatial = importlib.util.module_from_spec(_spec)
sys.modules["_spatial"] = _spatial
_spec.loader.exec_module(_spatial)

# measure-svf-signtest.py owns build_dsm() and the sign-test statistics. Loaded by
# path for the same reason and reused rather than copied: two rasterisers that
# disagree about which way is north would make the two halves of this experiment
# incomparable, and the SVF one is already self-checked against a known canyon.
_svf_spec = importlib.util.spec_from_file_location(
    "_svf", os.path.join(HERE, "measure-svf-signtest.py"))
assert _svf_spec is not None and _svf_spec.loader is not None
_svf = importlib.util.module_from_spec(_svf_spec)
sys.modules["_svf"] = _svf
_svf_spec.loader.exec_module(_svf)

OUT = os.path.join(ROOT, "data", "calibration", "shadow-signtest.json")

#: Shared with the SVF test so the two halves are measured on identical geometry.
DSM_M: float = _svf.DSM_M
#: Same bar as the shipped spatial pass: below this a scene's correlation is noise.
MIN_CELLS: int = _svf.MIN_CELLS
#: Hard cap on the ray march, metres. A 40 m building at 10 deg elevation throws a
#: 227 m shadow, so the SVF test's 150 m would silently truncate the low-sun scenes
#: that matter most. Capped anyway because cost is linear and beyond this the
#: shadow has usually left the ward.
MAX_SEARCH_M = 400.0
#: Below this solar elevation the shadow length exceeds any sane search radius and
#: the atmosphere dominates anyway. Such scenes are reported and skipped, never
#: silently included with a truncated field.
MIN_SUN_ELEV_DEG = 5.0


def solar_altaz(hour: float, doy: int, lat: float) -> tuple[float, float]:
    """(altitude, azimuth) in DEGREES from LOCAL SOLAR hour. Azimuth is clockwise
    from north.

    The declination is Spencer (1971), copied in form from `_physics.solar_factor`
    on purpose: the sun in this test must be the same sun the model integrates,
    not a second opinion from another library. `local_solar_hour` is true solar
    time, so the hour angle is exactly (hour - 12) * 15 deg and no equation-of-time
    correction belongs here -- applying one would double-count.

    pvlib is deliberately NOT used for this. Its NREL SPA wants a real timestamp
    and a timezone; we hold solar time, and converting back would inject the very
    error the convention avoids. pvlib earns its place in Track F's irradiance
    transposition, where the physics is genuinely beyond us.
    """
    g = 2.0 * math.pi / 365.0 * (doy - 1)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
            - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
            - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    ha = math.radians((hour - 12.0) * 15.0)
    phi = math.radians(lat)
    sin_alt = (math.sin(phi) * math.sin(decl)
               + math.cos(phi) * math.cos(decl) * math.cos(ha))
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))
    # Azimuth measured from SOUTH, positive towards west, then rotated to north.
    gamma = math.atan2(math.sin(ha),
                       math.cos(ha) * math.sin(phi) - math.tan(decl) * math.cos(phi))
    az = (math.degrees(gamma) + 180.0) % 360.0
    return math.degrees(alt), az


def cast_shadow(dsm: F32, alt_deg: float, az_deg: float) -> F32:
    """Binary shadow mask from a surface model, 1 = shadowed.

    Shear-and-max along a SINGLE azimuth -- the same machinery as
    `_svf.sky_view_factor`, which sweeps 16 of them. A cell is shadowed when some
    obstruction towards the sun rises above the solar elevation line:

        shadow[i] = 1  iff  max_k (dsm[i + k*u] - dsm[i]) / (k*DSM_M) > tan(alt)

    where u points TOWARDS the sun. This is a top-down mask, which is what
    ECOSTRESS integrates: a roof cell has a high dsm and is rarely shadowed, while
    the ground beside a tower is. No separate roof/ground bookkeeping is needed.
    """
    n = dsm.shape[0]
    tan_alt = math.tan(math.radians(alt_deg))
    # Row 0 is NORTH and column 0 is WEST (see _svf.build_dsm), so a bearing
    # clockwise from north maps to (row, col) as (-cos, +sin).
    a = math.radians(az_deg)
    u_row, u_col = -math.cos(a), math.sin(a)

    reach = min(MAX_SEARCH_M, float(dsm.max()) / max(tan_alt, 1e-6))
    steps = max(1, int(round(reach / DSM_M)))
    shadowed = np.zeros_like(dsm, dtype=bool)
    for k in range(1, steps + 1):
        dr = int(round(k * u_row))
        dc = int(round(k * u_col))
        if dr == 0 and dc == 0:
            continue
        shifted = np.roll(np.roll(dsm, -dr, axis=0), -dc, axis=1)
        # np.roll wraps; a wrapped edge would invent an obstruction, so blank it.
        # Blanking to 0 can only LOWER the horizon, so it never fakes a shadow.
        if dr > 0:
            shifted[n - dr:, :] = 0.0
        elif dr < 0:
            shifted[:-dr, :] = 0.0
        if dc > 0:
            shifted[:, n - dc:] = 0.0
        elif dc < 0:
            shifted[:, :-dc] = 0.0
        dist = math.hypot(dr, dc) * DSM_M
        shadowed |= (shifted - dsm) > np.float32(tan_alt * dist)
    return shadowed.astype(np.float32)


def self_check() -> None:
    """Runnable checks on the geometry, independent of any climate data."""
    # --- solar geometry -------------------------------------------------------
    # Local solar noon in JANUARY at 22.55 N: the sun is SOUTH (azimuth ~180).
    alt, az = solar_altaz(12.0, 10, 22.55)
    assert abs(az - 180.0) < 1.0, f"January noon must be due south, got az {az:.1f}"
    assert 40.0 < alt < 50.0, f"January noon altitude out of range: {alt:.1f}"
    # MORNING sun is in the EAST, afternoon in the WEST.
    _, az_am = solar_altaz(8.0, 100, 22.55)
    _, az_pm = solar_altaz(16.0, 100, 22.55)
    assert 60.0 < az_am < 120.0, f"08:00 sun should be easterly, got {az_am:.1f}"
    assert 240.0 < az_pm < 300.0, f"16:00 sun should be westerly, got {az_pm:.1f}"
    # Altitude must agree with the model's own cos(zenith).
    for h, d in ((9.0, 50), (12.0, 172), (15.0, 300)):
        a, _ = solar_altaz(h, d, 22.55)
        assert abs(math.sin(math.radians(a)) - _physics.solar_factor(h, d)) < 1e-9, \
            "solar_altaz disagrees with _physics.solar_factor"

    # --- shadow casting -------------------------------------------------------
    # Flat ground casts nothing, at any sun.
    flat = np.zeros((40, 40), dtype=np.float32)
    assert float(cast_shadow(flat, 45.0, 180.0).sum()) == 0.0, "flat ground cannot shade"

    # A single tower must shade the side AWAY from the sun and only that side.
    tower = np.zeros((81, 81), dtype=np.float32)
    tower[38:43, 38:43] = 30.0
    # Sun due SOUTH (az 180) -> shadow falls NORTH -> towards row 0.
    s_south = cast_shadow(tower, 30.0, 180.0)
    north_half = float(s_south[:38, 36:45].sum())
    south_half = float(s_south[43:, 36:45].sum())
    assert north_half > 0.0, "a tower with the sun due south must shade to the north"
    assert south_half == 0.0, f"nothing may be shaded towards the sun, got {south_half}"
    # Sun due EAST (az 90) -> shadow falls WEST -> towards column 0.
    s_east = cast_shadow(tower, 30.0, 90.0)
    assert float(s_east[36:45, :38].sum()) > 0.0, "sun in the east must shade westward"
    assert float(s_east[36:45, 43:].sum()) == 0.0, "nothing may be shaded towards the sun"

    # A LOWER sun must cast a LONGER shadow -- the monotonicity the test rests on.
    lo = float(cast_shadow(tower, 15.0, 180.0).sum())
    hi = float(cast_shadow(tower, 60.0, 180.0).sum())
    assert lo > hi, f"low sun must shade more ({lo:.0f} !> {hi:.0f})"

    # And the length must be right, not merely ordered: h/tan(alt) at 30 deg on a
    # 30 m tower is 52 m ~ 10 cells beyond the footprint edge.
    col = s_south[:38, 40]
    reach_cells = int(col.sum())
    expect = 30.0 / math.tan(math.radians(30.0)) / DSM_M
    assert abs(reach_cells - expect) <= 2.0, \
        f"shadow length {reach_cells} cells != expected {expect:.1f}"

    # --- the real DSM ---------------------------------------------------------
    dsm = _svf.build_dsm("ballygunge", 1400.0)
    assert dsm.shape[0] == int(1400.0 / DSM_M), "DSM grid size wrong"
    assert float(dsm.max()) > 5.0, "no buildings rasterised — check the height join"
    frac = float(cast_shadow(dsm, 30.0, 135.0).mean())
    assert 0.0 < frac < 1.0, f"ward shadow fraction implausible: {frac:.3f}"
    print(f"  self-check OK (noon az {az:.1f}°, tower reach {reach_cells} cells "
          f"≈ {expect:.1f} expected, ballygunge shade at 30° = {frac:.1%})")


def _doy(date: str) -> int:
    return dt.date.fromisoformat(date).timetuple().tm_yday


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    self_check()
    if args.self_check:
        return 0

    print("\n  PRE-REGISTERED: corr(shade, model - obs) > 0 by DAY means the "
          "missing\n  shadow term is real. <= 0 or null kills it. NIGHT is the "
          "placebo arm\n  and must come back ~ 0, or we are measuring building "
          "density.\n")

    q_day, ratio, c, store = _spatial.live_constants()
    scenes, _lc, dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[:args.limit]
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped)")

    # The DSM is pure geometry, so it is built once per ward; only the sun moves.
    dsms: dict[str, F32] = {}
    layers: dict[str, dict[str, F32]] = {}
    grids: dict[str, tuple[int, int]] = {}
    for wid, w in _types.WARDS.items():
        _tf, W, H = target_grid(_types.ward_bounds(w))
        veg, alb = _spatial.surface_layers(wid)
        dsms[wid] = _svf.build_dsm(wid, float(w.footprint_m))
        grids[wid] = (W, H)
        layers[wid] = {
            "veg": _spatial.area_downsample(veg, H, W),
            "alb": _spatial.area_downsample(alb, H, W),
            "built": _spatial.area_downsample(_spatial.built_layer(wid), H, W),
        }
        print(f"  {wid:<13} grid {W}x{H} · DSM {dsms[wid].shape[0]}² "
              f"max {dsms[wid].max():.0f} m")

    tok = token()
    rows: list[dict[str, Any]] = []
    low_sun = 0
    for n, sc in enumerate(scenes, 1):
        doy = _doy(sc.date)
        for wid, w in _types.WARDS.items():
            # DAY uses the overpass sun. NIGHT is the placebo: the same geometry
            # lit at LOCAL NOON that day, which is a pure building-density proxy
            # because no sun was shining when the observation was made.
            hour = sc.hour if sc.phase == "day" else 12.0
            alt, az = solar_altaz(hour, doy, w.centre.lat)
            if alt < MIN_SUN_ELEV_DEG:
                low_sun += 1
                continue

            obs = _spatial.measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            lay = layers[wid]
            m = np.isfinite(obs)
            if int(m.sum()) < MIN_CELLS:
                continue

            W, H = grids[wid]
            shade_fine = cast_shadow(dsms[wid], alt, az)
            # Aggregate to the 70 m analysis grid BEFORE correlating. The shadow
            # PATTERN is sub-pixel against ECOSTRESS and is not validatable; only
            # the mean shadow FRACTION per observed pixel is.
            shade = _spatial.area_downsample(shade_fine, H, W)

            mod = _spatial.modelled_field(sc, lay["veg"], lay["alb"], lay["built"],
                                          q_day, ratio, c, store)
            o = obs[m].astype(np.float64)
            md = mod[m].astype(np.float64)
            # Residual of the PATTERN: the ward-mean bias is measure-accuracy.py's
            # business, and a constant offset carries no information about shadow.
            resid = (md - md.mean()) - (o - o.mean())
            sh = shade[m].astype(np.float64)
            ctrl = [lay["built"][m].astype(np.float64), lay["veg"][m].astype(np.float64)]
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid,
                "cells": int(m.sum()),
                "sun_alt_deg": round(alt, 2), "sun_az_deg": round(az, 2),
                "shade_mean": round(float(sh.mean()), 4),
                "shade_sd": round(float(sh.std()), 4),
                # PRE-REGISTERED statistic
                "r_shade_resid": _svf.pearson(sh, resid),
                # POST-HOC diagnostic — shadow is collinear with built, exactly as
                # SVF was. Reported, never substituted for the line above.
                "r_shade_resid_partial": _svf.partial_corr(sh, resid, ctrl),
                "r_shade_obs": _svf.pearson(sh, o),
            })
        if n % 10 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(rows)} ward-scenes")
    if low_sun:
        print(f"  {low_sun} ward-scenes skipped: sun below {MIN_SUN_ELEV_DEG}°")

    print(f"\n  PRE-REGISTERED statistic — raw corr(shade, model-obs)")
    print(f"  {'phase':<16} {'scenes':>7} {'mean r':>9} {'median r':>10} "
          f"{'% pos':>7} {'p':>9}  verdict")
    print("  " + "-" * 82)
    summary: dict[str, Any] = {}
    for phase in ("day", "night"):
        rs = [r["r_shade_resid"] for r in rows
              if r["phase"] == phase and not math.isnan(r["r_shade_resid"])]
        label = "day" if phase == "day" else "night (placebo)"
        if not rs:
            print(f"  {label:<16} {'-':>7}   (no scenes)")
            continue
        arr = np.array(rs, dtype=np.float64)
        pos = 100.0 * float((arr > 0).mean())
        p_two = _svf.sign_test_p(arr)
        if phase == "day":
            verdict = ("null — shadow explains nothing" if p_two >= 0.05
                       else "PASS — sign as pre-registered" if arr.mean() > 0
                       else "*** REJECTED: significant, WRONG SIGN ***")
        else:
            verdict = ("clean — no density confound" if p_two >= 0.05
                       else "*** CONFOUNDED: placebo fired ***")
        print(f"  {label:<16} {len(arr):>7} {arr.mean():>9.3f} {np.median(arr):>10.3f} "
              f"{pos:>6.0f}% {p_two:>9.2e}  {verdict}")
        par = np.array([r["r_shade_resid_partial"] for r in rows
                        if r["phase"] == phase
                        and not math.isnan(r["r_shade_resid_partial"])],
                       dtype=np.float64)
        summary[phase] = {"scenes": len(arr), "mean_r": float(arr.mean()),
                          "median_r": float(np.median(arr)), "pct_positive": pos,
                          "sign_test_p": p_two, "verdict": verdict,
                          "posthoc_partial_mean_r": float(par.mean()) if par.size else None,
                          "posthoc_partial_pct_positive":
                              100.0 * float((par > 0).mean()) if par.size else None,
                          "posthoc_partial_p": _svf.sign_test_p(par) if par.size else None}

    print(f"\n  POST-HOC — partial corr, built + veg regressed out (NOT the")
    print(f"  pre-registered test; shadow is collinear with both)")
    print(f"  {'phase':<16} {'mean r':>9} {'% pos':>7} {'p':>9}")
    print("  " + "-" * 46)
    for phase in ("day", "night"):
        sm = summary.get(phase)
        if not sm or sm["posthoc_partial_mean_r"] is None:
            continue
        label = "day" if phase == "day" else "night (placebo)"
        print(f"  {label:<16} {sm['posthoc_partial_mean_r']:>9.3f} "
              f"{sm['posthoc_partial_pct_positive']:>6.0f}% {sm['posthoc_partial_p']:>9.2e}")

    day = summary.get("day")
    night = summary.get("night")
    if day and night and day["sign_test_p"] < 0.05 and night["sign_test_p"] < 0.05:
        print("\n  *** BOTH ARMS SIGNIFICANT — the day result is NOT evidence for")
        print("      shadow. Shade and built are the same variable here. ***")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({
            "_what": "Pre-registered sign test: corr(shade, model-obs). Direction fixed "
                     "before measurement — POSITIVE by day means the missing shadow term "
                     "is real. Night is a placebo arm lit at local noon and must be null.",
            "method": {"dsm_m": DSM_M, "max_search_m": MAX_SEARCH_M,
                       "min_sun_elev_deg": MIN_SUN_ELEV_DEG,
                       "shadow_rule": "max_k (dsm[i+k*u] - dsm[i]) / (k*dsm_m) > tan(alt)",
                       "sun": "Spencer (1971) declination from local solar hour, "
                              "identical to _physics.solar_factor",
                       "residual": "(model - model.mean()) - (obs - obs.mean())",
                       "aggregation": "area_downsample to the 70 m ECOSTRESS grid "
                                      "BEFORE correlating"},
            "summary": summary, "rows": rows,
        }, fh, indent=2)
    print(f"\n  written {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
