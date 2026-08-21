#!/usr/bin/env python3
"""Does inter-building shading matter for Kolkata rooftop PV?

    python3 scripts/measure-pv-shading.py            # ballygunge, the pre-registered ward
    python3 scripts/measure-pv-shading.py --ward baruipur

PRE-REGISTERED 2026-08-21 in docs/superpowers/specs/2026-08-21-pv-shading-signtest-PREREG.md,
committed BEFORE this script produced a number. Do not read the decision rule from here —
read it there, then run this.

WHAT IT DECIDES. Rooftop PV without shading is area x irradiance x efficiency, which anyone
can do in a spreadsheet. Shading-awareness is the only thing that would make ours ours, so
if it is negligible here Path A is a commodity calculation on unvalidated heights and should
stop. IEA-PVPS T13 reports most real projects assume 0% shading loss, so this is a genuine
gap in practice rather than a solved problem.

THE MODEL, and its two deliberate simplifications:
  * Roofs are FLAT and at the building's stated height. We hold one height per footprint and
    no pitch, so anything else would be invented. Defensible for Kolkata RCC terraces.
  * A caster shades a target only where it is TALLER than the target's roof. Shadow length at
    roof height h_t from a caster at h_c is (h_c - h_t)/tan(alt), and zero when h_c <= h_t —
    a ten-storey tower does not shade its own twin's roof, only the bungalow beside it.

THE SWEEP IS EXACT, NOT A HULL. The shadow of a translated polygon is its Minkowski sum with
the travel segment. Taking the convex hull of {poly, translated poly} instead would fill in
courtyards and L-shapes that are genuinely lit, inflating shading — the direction that would
manufacture a PASS. So the swept region is built as poly u translate(poly) u one quad per
exterior edge, which is the true swept area.

WEIGHTED BY MEASURED SUN, NOT GEOMETRY. Each sampled hour carries its real NASA POWER GHI
(local solar time, five-year mean). This matters because shading is worst at low sun and
Kolkata's low-sun months are also its monsoon months — geometric weighting alone would
overstate the annual loss by counting December mornings as if they were March.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from typing import Any

import numpy as np
from shapely.geometry.base import BaseGeometry
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.affinity import translate

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
import _types  # noqa: E402

# THE SAME SUN THE REST OF THE LABORATORY USES. measure-shadow-signtest.solar_altaz
# is Spencer (1971) on true solar time, matching _physics.solar_factor and sky.ts.
# pvlib is deliberately not used here for the reason that script already records:
# its NREL SPA wants a real timestamp and a timezone, we hold solar time, and
# converting back would inject exactly the LST/UTC error this pipeline just spent a
# commit eliminating. pvlib earns its place later, in the irradiance transposition.
_spec = importlib.util.spec_from_file_location(
    "_shadowsig", os.path.join(HERE, "measure-shadow-signtest.py"))
assert _spec and _spec.loader
_shadowsig = importlib.util.module_from_spec(_spec)
sys.modules["_shadowsig"] = _shadowsig
_spec.loader.exec_module(_shadowsig)
solar_altaz = _shadowsig.solar_altaz

SOLAR_CACHE = os.path.expanduser("~/.cache/delta-climate/power-solar-hourly.json")
def out_path(ward: str) -> str:
    """Per-ward, because a shared filename means the second run silently
    overwrites the first and the yield chain then joins the wrong ward."""
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-{ward}.json")

#: Sample day per month. The 21st sits near each solstice/equinox and away from
#: month boundaries, so twelve of them span the declination range evenly.
SAMPLE_DAY = 21
#: Below this sun altitude the shadow length explodes and POWER GHI is ~0 anyway.
MIN_ALT_DEG = 5.0
#: Above this share of the target's footprint, an "overlapping neighbour" is the same
#: structure digitised twice, not a building next door. 10% is well clear of polygon
#: precision noise (mean real overlap is ~0.1%) and well below a genuine annexe.
OVERLAP_TOL = 0.10
#: Google writes 2.5 m where it has no confident height — a VALUE, not an absence, and
#: also the raster minimum. Matches compute-heights.py, which is where these come from.
FILL_M = 2.5


def load_ward(ward: str) -> tuple[list[Polygon], np.ndarray]:
    """Footprints in ward-local metres (x EAST, y NORTH) and their heights."""
    with open(os.path.join(ROOT, "public", "heat-map", "data", f"{ward}.json")) as fh:
        raw = json.load(fh)
    polys: list[Polygon] = []
    heights: list[float] = []
    for rec in raw["b"]:
        h = float(rec[0])
        pts = [(float(rec[i]), float(rec[i + 1])) for i in range(1, len(rec) - 1, 2)]
        if len(pts) < 3:
            continue
        p = Polygon(pts)
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty or p.area <= 0:
            continue
        polys.append(p)
        heights.append(h)

    # POSITION IS THE ONLY JOIN KEY. The per-building arrays we emit are matched to
    # buildings downstream by ARRAY INDEX — there is no id in the ward file to key on.
    # So a single skipped footprint above would shift every later building by one and
    # hand each of them its neighbour's solar figures: wrong numbers, on the right
    # roofs, with nothing visibly broken to notice. That is the worst failure shape
    # available to us, so it is refused rather than handled.
    #
    # Both filters are currently dead code on all three wards (3527/4702/4538 in,
    # same out, zero dropped), which is exactly why this needs an assertion — a
    # filter that never fires is a filter nobody will remember when Overture is
    # refreshed. If one ever does fire, emit null for that building and carry the
    # index; do NOT quietly compact the array.
    if len(polys) != len(raw["b"]):
        raise SystemExit(
            f"{ward}: {len(raw['b']) - len(polys)} degenerate footprint(s) dropped, which would "
            f"desync every per-building array from the ward file. Emit a null for the bad "
            f"index instead of compacting.")
    return polys, np.asarray(heights, dtype=float)


def caster_heights(ward: str, stat: str, shipped: np.ndarray) -> np.ndarray:
    """Heights used for CASTING shadows. Receivers keep the shipped ward height.

    Joins the cached Earth Engine reduction by POSITION, which is safe only because
    heights-overture.json, <ward>-footprints.json and the ward file are all written in
    one order by the same pipeline. Verified rather than assumed: every shipped ward
    height equals its floored cached p65 exactly, across all 12,767 buildings. That
    equality is re-asserted below, so a reordering upstream fails loudly here instead
    of silently pairing each building with a stranger's height.
    """
    if stat == "p65":
        return shipped
    with open(os.path.join(ROOT, "data", "geometry", "heights-overture.json")) as fh:
        rows = json.load(fh)["wards"][ward]
    if len(rows) != len(shipped):
        raise SystemExit(f"{ward}: height cache has {len(rows)} rows, ward file has "
                         f"{len(shipped)} — refusing to join by position.")
    p65 = np.array([FILL_M if r["fill"] else max(float(r["p65"]), FILL_M) for r in rows])
    if not np.allclose(p65, shipped, atol=1e-6):
        raise SystemExit(f"{ward}: cached p65 does not reproduce the shipped ward "
                         f"heights, so the cache is stale or reordered — refusing.")
    return np.array([FILL_M if r["fill"] else max(float(r[stat]), FILL_M) for r in rows])


def sun_positions(lat: float) -> list[tuple[float, float, float]]:
    """(altitude_deg, azimuth_deg, ghi_weight) for every sampled daylight hour."""
    with open(SOLAR_CACHE) as fh:
        cache = json.load(fh)
    # Mean GHI per (month, day, hour) key across the five years, in LOCAL SOLAR TIME.
    by_key: dict[str, list[float]] = {}
    for year in cache.values():
        for stamp, val in year["ALLSKY_SFC_SW_DWN"].items():
            if float(val) < 0:            # POWER fill value
                continue
            by_key.setdefault(stamp[4:], []).append(float(val))

    out: list[tuple[float, float, float]] = []
    for month in range(1, 13):
        doy = (__import__("datetime").date(2023, month, SAMPLE_DAY)
               - __import__("datetime").date(2022, 12, 31)).days
        for hour in range(24):
            vals = by_key.get(f"{month:02d}{SAMPLE_DAY:02d}{hour:02d}")
            if not vals:
                continue
            ghi = float(np.mean(vals))
            if ghi <= 0:
                continue
            # POWER's hour IS local solar time — no conversion, which is the point.
            alt, az = solar_altaz(hour + 0.5, doy, lat)
            if alt < MIN_ALT_DEG:
                continue
            out.append((alt, az, ghi))
    return out


def swept(poly: Polygon, dx: float, dy: float) -> BaseGeometry:
    """Exact swept region of `poly` translated by (dx, dy) — Minkowski sum with the segment."""
    moved = translate(poly, dx, dy)
    parts: list[Polygon] = [poly, moved]
    ring = list(poly.exterior.coords)
    for (ax, ay), (bx, by) in zip(ring[:-1], ring[1:]):
        quad = Polygon([(ax, ay), (bx, by), (bx + dx, by + dy), (ax + dx, ay + dy)])
        if quad.is_valid and quad.area > 0:
            parts.append(quad)
    return unary_union(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    # WHICH PERCENTILE REPRESENTS A SHADOW CASTER. The shipped height is a zonal p65 of
    # the Open Buildings raster, chosen to represent a building as ONE number. But a
    # caster and a receiver want different numbers from the same distribution: what
    # blocks the sun is the top of the massing, while what carries panels is the typical
    # roof plane. Zonal statistics are known to understate towers, and understating a
    # caster understates shading — the same direction our height bias already runs.
    # p75 is what compute-heights.py already caches alongside p65, so this costs no
    # Earth Engine call. Default reproduces the shipped run exactly.
    #
    # MEASURED, AND THE HYPOTHESIS WAS WRONG. Running p75 casters against all three
    # wards moves mean shading by +0.01 / +0.01 / +0.04 pp and flips no verdict, on
    # either the all-roofs or the >=3 kWp population:
    #
    #   ward         all footprints          >=3 kWp roofs
    #   ballygunge   5.12 -> 5.13 % PASS     3.32 -> 3.33 % PASS
    #   barrackpore  1.66 -> 1.67 % PASS     1.22 -> 1.23 % FAIL
    #   baruipur     1.79 -> 1.83 % PASS     1.12 -> 1.15 % FAIL
    #
    # The reason is that shading is driven by the DIFFERENCE between caster and
    # receiver, and p75 lifts casters by only 0.27-0.62 m on average (1.31 m for
    # buildings over 15 m) against caster-receiver gaps of several metres. A third of
    # buildings do not move at all. So the percentile choice is NOT a lever on shading,
    # and the residual height bias — if it is real — lives in the raster, not in which
    # quantile we take from it. Kept as an instrument so the null is re-runnable,
    # not because it is expected to pay.
    ap.add_argument("--caster", choices=("p65", "p75"), default="p65",
                    help="percentile used for CASTER heights; receivers always use the "
                         "shipped ward height (p65). p65 = no change.")
    args = ap.parse_args()

    lat = _types.WARDS[args.ward].centre.lat
    polys, heights = load_ward(args.ward)
    h_cast = caster_heights(args.ward, args.caster, heights)
    n = len(polys)
    areas = np.asarray([p.area for p in polys])
    tree = STRtree(polys)
    suns = sun_positions(lat)
    total_w = sum(s[2] for s in suns)
    hmax = float(heights.max())

    print(f"  {args.ward}: {n} buildings · {len(suns)} sampled daylight hours "
          f"· heights {heights.min():.0f}-{hmax:.0f} m (median {np.median(heights):.0f})", flush=True)

    shaded_w = np.zeros(n)      # GHI-weighted shaded area, per building

    # WHY A GROUND-SHADOW PREFILTER. The first version buffered each target by
    # (hmax - h_t)/tan(alt) and queried the index — at 5 deg sun that radius is 914 m
    # inside a 1400 m ward, so nearly every building became a candidate and the same
    # spatial query ran 494,000 times. Killed after 7 minutes of full-CPU work with no
    # end in sight.
    #
    # Instead: cast every building's shadow ONTO THE GROUND once per sun position and
    # index those. A ground shadow is the LONGEST that building can throw, so anything
    # it fails to touch cannot be shaded at any roof height — the filter is
    # conservative and produces no false negatives. Only for the pairs it does return
    # is the exact shadow recomputed at the target's real roof height. Same answer,
    # O(n) sweeps per sun instead of O(n x candidates).
    for si, (alt, az, ghi) in enumerate(suns, 1):
        t = math.tan(math.radians(alt))
        # Shadows run AWAY from the sun. az is clockwise from north, so the horizontal
        # component TOWARD the sun is (sin az, cos az) in (east, north) and the shadow
        # is its negation.
        ux, uy = -math.sin(math.radians(az)), -math.cos(math.radians(az))

        ground: list[BaseGeometry] = []
        owner: list[int] = []
        for j in range(n):
            L = h_cast[j] / t
            if L <= 0:
                continue
            ground.append(swept(polys[j], ux * L, uy * L))
            owner.append(j)
        if not ground:
            continue
        gtree = STRtree(ground)

        for i in range(n):
            ht = heights[i]
            target = polys[i]
            hits = gtree.query(target)
            shadows = []
            for gi in hits:
                j = owner[int(gi)]
                if j == i or h_cast[j] <= ht:
                    continue
                # TWO REAL BUILDINGS CANNOT OCCUPY THE SAME GROUND, so a footprint
                # substantially overlapping the target is a digitising artefact —
                # Overture carrying one structure as two records, or a building and
                # its annexe drawn on top of each other. Treating the taller copy as
                # a caster shades the shorter one at every sun position: barrackpore
                # idx 4259 (970 m2 at 7.5 m, overlapped by an 8.8 m twin) came back
                # at exactly 100.0% loss, which is what exposed this.
                #
                # Measured prevalence before adding the guard: mean overlap 0.06-0.11%
                # of area, 0.7-2.2% of buildings above 1%, and ONE building above 50%
                # across all three wards. So this is a correctness fix for a handful of
                # roofs, not a rescue of the headline — and it moves the number DOWN,
                # away from flattering us.
                if polys[j].intersection(target).area > OVERLAP_TOL * target.area:
                    continue
                L = (heights[j] - ht) / t          # exact length at THIS roof height
                sh = swept(polys[j], ux * L, uy * L)
                if sh.intersects(target):
                    shadows.append(sh)
            if not shadows:
                continue
            inter = unary_union(shadows).intersection(target)
            if not inter.is_empty:
                shaded_w[i] += ghi * inter.area
        print(f"    [{si}/{len(suns)}] alt {alt:4.1f} deg", flush=True)

    loss = shaded_w / (areas * total_w)          # fraction of GHI-weighted roof-area shaded
    mean_loss = float(loss.mean())
    frac_over5 = float((loss >= 0.05).mean())

    print(f"\n  mean annual shading loss : {mean_loss*100:.2f}%")
    print(f"  buildings losing >= 5%   : {frac_over5*100:.1f}%")
    print(f"  median / p90 / max loss  : {np.median(loss)*100:.2f}% / "
          f"{np.percentile(loss,90)*100:.2f}% / {loss.max()*100:.2f}%")

    clause_a = mean_loss >= 0.030
    clause_b = frac_over5 >= 0.10
    verdict = "PASS" if (clause_a or clause_b) else "FAIL"
    print(f"\n  clause (a) mean >= 3.0%      : {clause_a}")
    print(f"  clause (b) >=10% lose >=5%   : {clause_b}")
    print(f"  PRE-REGISTERED VERDICT       : {verdict}")

    out = out_path(args.ward)
    with open(out, "w") as fh:
        json.dump({
            "prereg": "docs/superpowers/specs/2026-08-21-pv-shading-signtest-PREREG.md",
            "ward": args.ward, "buildings": n, "sun_hours_sampled": len(suns),
            "mean_loss_pct": round(mean_loss * 100, 3),
            "frac_losing_5pct": round(frac_over5, 4),
            "median_loss_pct": round(float(np.median(loss)) * 100, 3),
            "p90_loss_pct": round(float(np.percentile(loss, 90)) * 100, 3),
            "max_loss_pct": round(float(loss.max()) * 100, 3),
            "clause_a_mean_ge_3pct": bool(clause_a),
            "clause_b_10pct_lose_5pct": bool(clause_b),
            "verdict": verdict,
            # Per-building losses, so the yield chain can join on them. Rounded to
            # 4 dp: the geometry does not justify more, and it keeps the artefact
            # byte-stable across runs.
            "per_building_loss": [round(float(x), 4) for x in loss],
            "per_building_area_m2": [round(float(a), 1) for a in areas],
            "per_building_height_m": [round(float(h), 1) for h in heights],
            "height_bias_note": "Heights are unvalidated with a suspected LOW bias, so shadows "
                                "are too short and this figure UNDERSTATES shading. A PASS is "
                                "therefore safe; a FAIL means 'not detected with heights that "
                                "are probably too low', not 'shading does not matter'.",
        }, fh, indent=2)
    print(f"\n  written to {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    main()
