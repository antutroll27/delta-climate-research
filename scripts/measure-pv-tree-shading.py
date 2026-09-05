#!/usr/bin/env python3
"""Rooftop-PV shading with TREES -- raster shadow-casting on a 1 m surface model.

PRE-REGISTERED: docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md (+ Amendment A1),
committed before this script produced a number. Read it before changing any constant here;
every one of them is locked there and other values appear only in the sensitivity table.

WHAT IT DECIDES. measure-pv-shading.py casts shadows from BUILDINGS only. This pass adds the
measured Meta/WRI 1 m canopy (v2) as a caster, on the same sun samples with the same GHI
weights, and publishes per building: total loss, building-only, tree-only. The building-only
figure is cross-checked against the registered polygon run BEFORE a single tree is counted;
if they disagree by more than 1 pp of mean loss the run refuses to write.

THE MARCH (Ratti & Richens 2004; Lindberg & Grimmond 2011 -- the published algorithm, written
from the description; no GPL code). A pixel x at roof height h_i is shaded when, for some
k >= 1,
    DSM(x + k*s*step) - k*step*tan(alt) > h_i + EPS_M
with s the unit vector TOWARD the sun. Implemented as K vectorised shift-and-max passes.

WHY THE TREES FILE IS NOT USED. <ward>-trees.json is a render derivative: positions jittered
inside 10 m cells by a hash, radii from a formula. The measured object is the raster.

Run:
    AWS_NO_SIGN_REQUEST=YES python3 scripts/measure-pv-tree-shading.py --ward ballygunge
    python3 scripts/measure-pv-tree-shading.py --self-check      # synthetic scene, offline
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
import time
from typing import Any, Iterable, cast

import numpy as np
import numpy.typing as npt
from rasterio import features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
import _types  # noqa: E402

F32 = npt.NDArray[np.float32]
F64 = npt.NDArray[np.float64]
I32 = npt.NDArray[np.int32]
BoolA = npt.NDArray[np.bool_]


def _load(name: str, fname: str) -> Any:
    """Load a sibling script by path -- the pattern build-pv-yield.py already uses."""
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fname))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


#: LOCKED BY THE PRE-REGISTRATION (spec section 3 and Amendment A1).
GRID_M = 0.5            # A4: 1.0 m refused Baruipur's share gate (3.60 pp of 3.0) by pixelisation on the
                        # smallest roofs; 0.5 m for all wards, every other constant untouched
PAD_M = 200.0           # canopy read beyond the ward box: a 34 m crown at 10 deg throws 193 m
TAU = 0.30              # beam transmittance through an in-leaf crown, central
TAU_BAND = (0.20, 0.50)  # Wu, Lu & Lin 2025; Konarska et al. 2014
CHM_MAE_M = 3.0         # Brandt et al. v2 -- the "minus MAE" height scenario
CANOPY_MIN_M = 2.0      # what counts as a tree for the connectedness rule
EPS_M = 0.05            # strictly ABOVE the roof: equal heights do not shade
RAISE_M = 2.0           # elevated mounting structure scenario (A1)
CROSS_CHECK_MEAN_PP = 1.0    # raster buildings-only vs registered polygon: mean loss
CROSS_CHECK_SHARE_PP = 3.0   # ...and the share losing >= 5 %
PREREG = "docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md"


def out_path(ward: str) -> str:
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-trees-{ward}.json")


def polygon_path(ward: str) -> str:
    """The REGISTERED building-only artefact. Read for the cross-check; never written."""
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-{ward}.json")


def shadow_height(dsm: F32, alt_deg: float, az_deg: float, step_m: float) -> F32:
    """For every pixel, the tallest sightline any obstacle TOWARD the sun projects onto it.
    A receiver at height h is shaded iff shadow_height > h + EPS_M. -inf where nothing does.

    K shift-and-max passes: pass k reads the surface k pixels toward the sun and lowers it by
    k*step*tan(alt), the height a sightline at that slope has dropped by the time it arrives.
    Sub-pixel direction is handled by rounding k*s to integer offsets, as the papers do."""
    t = math.tan(math.radians(alt_deg))
    if t <= 0.0:
        # Unreachable through sun_positions (MIN_ALT_DEG filters), and "nothing shaded" would be
        # the anti-conservative answer for a sun on the horizon, so this fails loudly instead.
        raise ValueError(f"sun at or below the horizon: altitude {alt_deg} deg")
    # Unit vector TOWARD the sun in (east, north): azimuth is clockwise from north.
    sx, sy = math.sin(math.radians(az_deg)), math.cos(math.radians(az_deg))
    n = dsm.shape[0]
    # Square by construction (rasterise and read_chm_grid both produce n x n). A rectangle would
    # not raise: the column slices would stop at n and the right of the grid would silently
    # never shade (measured). So it is refused here rather than half-processed.
    if dsm.shape[0] != dsm.shape[1]:
        raise ValueError(f"square grid required, got {dsm.shape}")
    # The surface floor is 0 by construction (ground pixels are 0, canopy is clipped >= 0), so
    # max() alone bounds the reach. If terrain ever enters, this becomes max() - min().
    k_max = int(math.ceil(float(dsm.max()) / (step_m * t)))
    sh = np.full(dsm.shape, -np.inf, dtype=np.float32)
    for k in range(1, k_max + 1):
        dc = int(round(k * sx))            # east is +column
        dr = -int(round(k * sy))           # north is -row (row 0 = north)
        if abs(dc) >= n or abs(dr) >= n:
            break
        drop = np.float32(k * step_m * t)
        # value at (r, c) reads dsm[r + dr, c + dc]: the two slices below are that, clipped
        src = dsm[max(0, dr):n + min(0, dr), max(0, dc):n + min(0, dc)] - drop
        dst = sh[max(0, -dr):n + min(0, -dr), max(0, -dc):n + min(0, -dc)]
        np.maximum(dst, src, out=dst)
    return sh


def mask_canopy(chm: F32, foot: BoolA) -> tuple[F32, float, float, int]:
    """Amendment A1 connectedness rule. Returns (masked canopy, share of on-roof canopy kept
    as overhang, share dropped as enclosed).

    Label the connected components of canopy > CANOPY_MIN_M. A component with ANY pixel
    outside every footprint (dilated by one pixel) is a tree rooted outside: kept whole,
    overhang included. A component enclosed entirely within footprints has no tree to belong
    to: a building the model misread as canopy, zeroed. Canopy at or below a roof's own height
    is harmless either way (DSM = max(building, canopy)), so the rule only bites where canopy
    over a roof stands above that roof.

    Also returns the count of canopy pixels on footprints, so "no canopy on roofs" and "0 of
    many kept" are distinguishable in the artefact (A2)."""
    tree = chm > CANOPY_MIN_M
    # 8-connected, matching the labelling below (spec Amendment A2). The 4-connected default
    # left 29,885 px of Ballygunge footprint ring "outside", each able to flip a whole canopy
    # component to rooted -- a choice that leaned toward the prediction, so it is declared.
    foot_d = ndimage.binary_dilation(foot, structure=np.ones((3, 3), dtype=bool), iterations=1)
    lab, nlab = ndimage.label(tree, structure=np.ones((3, 3), dtype=bool))
    rooted = np.zeros(int(nlab) + 1, dtype=bool)
    rooted[np.unique(lab[tree & ~foot_d])] = True
    rooted[0] = False
    enclosed = tree & ~rooted[lab]
    on_roof = tree & foot
    out = chm.copy()
    out[enclosed] = 0.0
    on_roof_px = int(on_roof.sum())
    denom = max(1, on_roof_px)
    kept = float((on_roof & rooted[lab]).sum()) / denom
    dropped = float((on_roof & enclosed).sum()) / denom
    return out, kept, dropped, on_roof_px


def classify(sh_b: F32, sh_t: F32, roof_h: F32, raise_m: float) -> tuple[BoolA, BoolA]:
    """(shaded by a building, shaded by canopy only) for receivers at roof_h + raise_m."""
    b = sh_b > roof_h + raise_m + EPS_M
    t = (sh_t > roof_h + raise_m + EPS_M) & ~b
    return b, t


def total(loss_b: F64, loss_t: F64, tau: float) -> F64:
    """Total loss from its two parts: building shade blocks everything, canopy blocks 1 - tau."""
    return np.asarray(loss_b + (1.0 - tau) * loss_t, dtype=np.float64)


def day_groups(suns: list[tuple[float, float, float]]) -> list[list[int]]:
    """Indices grouped per sample day. sun_positions emits month by month, hour by hour, so a
    day ends when the azimuth swings back to morning (drops by more than 90 deg). Kolkata's
    summer sun passes north of zenith and its azimuth wraps UPWARD through 360 at noon, which
    this rule does not mistake for a new day."""
    groups: list[list[int]] = [[]]
    for i, (_alt, az, _w) in enumerate(suns):
        if groups[-1] and az < suns[groups[-1][-1]][1] - 90.0:
            groups.append([])
        groups[-1].append(i)
    return groups


def rasterise(polys: list[Polygon], heights: F64, n: int, frame_m: float,
              step_m: float) -> tuple[I32, F32]:
    """Pixel ownership (1-based building id, 0 = ground) and the building surface.

    Drawn ASCENDING by height so the tallest record owns a shared pixel: the raster form of
    the polygon pass's duplicate-footprint guard. A shorter twin under a full duplicate keeps no
    pixels and is reported by count; a partial overlap (an annexe) keeps its uncovered part."""
    tr = from_origin(-frame_m / 2.0, frame_m / 2.0, step_m, step_m)
    order = np.argsort(heights, kind="stable")
    shapes = ((polys[int(i)], int(i) + 1) for i in order)
    # The cast widens ONLY the geometry type: the rasterio stub asks for a Mapping, but rasterize
    # does `geom = getattr(geom, '__geo_interface__', None) or geom` (features.py:339, rasterio
    # 1.5.0), so a shapely Polygon is the documented input. Casting the argument rather than
    # converting the geometries keeps the runtime call exactly as measured. skip_invalid=False
    # because the default silently DROPS an invalid footprint into the pixel-less set.
    raw = features.rasterize(cast(Iterable[tuple[Any, float]], shapes), out_shape=(n, n),
                             transform=tr, fill=0, dtype="int32", skip_invalid=False)
    ids: I32 = np.asarray(raw, dtype=np.int32)
    dsm = np.zeros((n, n), dtype=np.float32)
    own = ids > 0
    dsm[own] = heights[ids[own] - 1].astype(np.float32)
    return ids, dsm


def run_ward(ward_id: str) -> None:
    t0 = time.time()
    # Loaded here, not at import: the self-check must stay independent of the sibling scripts,
    # or an unrelated break in one of them fails test:py with a confusing error.
    shading = _load("_pvshading", "measure-pv-shading.py")
    canopy_mod = _load("_fetchcanopy", "fetch-canopy.py")
    pv_yield = _load("_pvyield", "build-pv-yield.py")
    ward = _types.WARDS[ward_id]
    polys, heights_raw = shading.load_ward(ward_id)
    heights: F64 = np.asarray(heights_raw, dtype=np.float64)
    nb = len(polys)
    areas: F64 = np.asarray([p.area for p in polys], dtype=np.float64)
    with open(polygon_path(ward_id)) as fh:
        poly_art = json.load(fh)
    poly_loss: F64 = np.asarray(poly_art["per_building_loss"], dtype=np.float64)
    if len(poly_loss) != nb:
        raise SystemExit(f"{ward_id}: registered artefact has {len(poly_loss)} buildings, ward file {nb}")

    frame_m = float(ward.footprint_m) + 2.0 * PAD_M
    if not frame_m.is_integer():
        raise ValueError(f"frame must be a whole number of metres, got {frame_m}")
    n = int(round(frame_m / GRID_M))
    chm_read = canopy_mod.read_chm_grid(ward._replace(footprint_m=int(frame_m)), n)
    if chm_read is None:
        raise SystemExit(f"{ward_id}: CHM read failed (is AWS_NO_SIGN_REQUEST=YES set?)")
    chm: F32 = np.asarray(chm_read, dtype=np.float32)
    ids, dsm_b = rasterise(polys, heights, n, frame_m, GRID_M)
    foot = ids > 0
    chm_a1, kept_frac, dropped_frac, on_roof_px = mask_canopy(chm, foot)
    chm_strict = chm.copy()
    chm_strict[ndimage.binary_dilation(foot, structure=np.ones((3, 3), dtype=bool), iterations=1)] = 0.0
    dsm_t = np.maximum(dsm_b, chm_a1)                                     # central
    dsm_m = np.maximum(dsm_b, np.clip(chm_a1 - CHM_MAE_M, 0.0, None))     # canopy minus MAE
    dsm_s = np.maximum(dsm_b, chm_strict)                                 # strict mask

    roof_idx = np.flatnonzero(ids)
    roof_bid = ids.ravel()[roof_idx] - 1
    roof_h: F32 = heights[roof_bid].astype(np.float32)
    npix: F64 = np.bincount(roof_bid, minlength=nb).astype(np.float64)
    no_pixels = np.flatnonzero(npix == 0)
    print(f"  {ward_id}: {nb} buildings · grid {n}x{n} at {GRID_M} m (pad {PAD_M:.0f} m) "
          f"· {len(roof_idx):,} roof pixels · {len(no_pixels)} buildings without pixels", flush=True)
    print(f"  canopy on roofs: {on_roof_px:,} px · {kept_frac*100:.1f}% kept as overhang, "
          f"{dropped_frac*100:.1f}% dropped as enclosed", flush=True)

    suns = shading.sun_positions(ward.centre.lat)
    total_w = float(sum(s[2] for s in suns))
    keys = ("b", "b_r", "t", "t_r", "m", "s")
    acc: dict[str, F64] = {k: np.zeros(nb, dtype=np.float64) for k in keys}
    frac_by_sun: list[float] = []          # shaded roof fraction, central surface, per sun
    for si, (alt, az, ghi) in enumerate(suns, 1):
        sh_b = shadow_height(dsm_b, alt, az, GRID_M).ravel()[roof_idx]
        sh_t = shadow_height(dsm_t, alt, az, GRID_M).ravel()[roof_idx]
        sh_m = shadow_height(dsm_m, alt, az, GRID_M).ravel()[roof_idx]
        sh_s = shadow_height(dsm_s, alt, az, GRID_M).ravel()[roof_idx]
        b, t = classify(sh_b, sh_t, roof_h, 0.0)
        b_r, t_r = classify(sh_b, sh_t, roof_h, RAISE_M)
        _, m = classify(sh_b, sh_m, roof_h, 0.0)
        _, s = classify(sh_b, sh_s, roof_h, 0.0)
        for key, mask in (("b", b), ("b_r", b_r), ("t", t), ("t_r", t_r), ("m", m), ("s", s)):
            acc[key] += ghi * np.bincount(roof_bid[mask], minlength=nb)
        frac_by_sun.append(float((b | t).mean()))
        print(f"    [{si}/{len(suns)}] alt {alt:4.1f} deg · shaded {frac_by_sun[-1]*100:5.1f}%", flush=True)

    denom = np.where(npix > 0, npix * total_w, 1.0)

    def loss(key: str) -> F64:
        return np.asarray(acc[key] / denom, dtype=np.float64)

    l_b, l_b_r = loss("b"), loss("b_r")
    l_t, l_t_r, l_m, l_s = loss("t"), loss("t_r"), loss("m"), loss("s")
    # Buildings without pixels: a footprint lying wholly inside a taller neighbour's (measured:
    # none are exact duplicates, none are sub-pixel; barrackpore has one such). They take the
    # registered building-only figure, no tree term, and are listed by index. Arrays stay full
    # length so the index join holds. The raised scenario gets the same backfill, or its array
    # would read 0 on exactly those indices while the total reads the polygon value.
    l_b[no_pixels] = poly_loss[no_pixels]
    l_b_r[no_pixels] = poly_loss[no_pixels]

    central = total(l_b, l_t, TAU)
    raised = total(l_b_r, l_t_r, TAU)
    trees = central - l_b

    # SANITY 1 -- cross-check the raster buildings-only run against the registered polygon run,
    # on the buildings that have pixels. Fails closed: nothing is written.
    has = npix > 0
    mean_r, mean_p = float(l_b[has].mean()), float(poly_loss[has].mean())
    share_r, share_p = float((l_b[has] >= 0.05).mean()), float((poly_loss[has] >= 0.05).mean())
    mean_p_reg = float(poly_art["mean_loss_pct"]) / 100.0
    share_p_reg = float(poly_art["frac_losing_5pct"])
    cross_ok = (abs(mean_r - mean_p) * 100 <= CROSS_CHECK_MEAN_PP
                and abs(share_r - share_p) * 100 <= CROSS_CHECK_SHARE_PP)
    print(f"\n  cross-check buildings-only: raster {mean_r*100:.2f}% vs polygon {mean_p*100:.2f}% mean; "
          f"share>=5% {share_r*100:.1f}% vs {share_p*100:.1f}% -> {'PASS' if cross_ok else 'FAIL'}")
    # SANITY 3 -- loss rises as the sun falls. The registered wording ("monotone in altitude
    # within each sample day") cannot be tested literally: each day's altitudes are an exact
    # palindrome about solar noon (day 1: 11.6, 23.4, 33.8, 42.1, 46.8, 46.8, 42.1, ...), so equal
    # altitudes differ only by azimuth and any asymmetry in the built form breaks strict
    # monotonicity on a correct run. What is tested per day, and published as such (A3): the
    # shaded fraction at the lowest-altitude sample exceeds that at the highest, and the
    # correlation between altitude and shaded fraction is negative. A weak check by design: it
    # verifies the drop is wired the right way up; the east-west convention is pinned by the
    # self-check, not by this.
    days = day_groups(suns)
    mono_ok = True
    days_tested = 0
    for grp in days:
        if len(grp) < 3:
            continue
        days_tested += 1
        alts = np.asarray([suns[i][0] for i in grp])
        fr = np.asarray([frac_by_sun[i] for i in grp])
        if not (fr[int(alts.argmin())] > fr[int(alts.argmax())] and float(np.corrcoef(alts, fr)[0, 1]) < 0.0):
            mono_ok = False
    print(f"  loss rises as the sun falls ({days_tested}/{len(days)} days tested): {'PASS' if mono_ok else 'FAIL'}")
    # SANITY 2 and 4 are guaranteed by construction and asserted on the synthetic scene
    # (--self-check): isolation, and nothing at or below the roof shades it.

    # PREDICTIONS (spec section 5), evaluated and written, never adjusted.
    kwp = areas * float(pv_yield.PACKING_FACTOR) / float(pv_yield.M2_PER_KWP)
    big = kwp >= 3.0
    xc_big = {"polygon_mean_pct": round(float(poly_loss[big & has].mean()) * 100, 3),
              "raster_mean_pct": round(float(l_b[big & has].mean()) * 100, 3),
              "polygon_share_5pct": round(float((poly_loss[big & has] >= 0.05).mean()), 4),
              "raster_share_5pct": round(float((l_b[big & has] >= 0.05).mean()), 4),
              "note": "informational, not gated"}
    p1 = float(trees[big].mean()) > float(l_b[big].mean())
    # Exact, not approximate: central = l_b + 0.7 * l_t with l_t >= 0 (a bincount of a boolean
    # mask), and adding a non-negative is monotone in IEEE arithmetic.
    p2 = bool(np.all(central >= l_b)) and float(central.mean()) > float(l_b.mean())
    print(f"  P1 trees > buildings on >=3 kWp roofs: trees {trees[big].mean()*100:.2f}% vs "
          f"buildings {l_b[big].mean()*100:.2f}% -> {p1}")
    print(f"  P2 total never falls below buildings-only: {p2}")

    def stats(x: F64) -> dict[str, float]:
        return {"mean_pct": round(float(x.mean()) * 100, 3),
                "share_5pct": round(float((x >= 0.05).mean()), 4)}

    sens: list[dict[str, Any]] = []
    for tau in (TAU_BAND[0], TAU, TAU_BAND[1]):
        for name, lt in (("stated", l_t), ("minus_mae", l_m)):
            tot = total(l_b, lt, tau)
            sens.append({"tau": tau, "canopy_height": name, "mask": "a1",
                         "receiver": "roof", "mean_total_pct": stats(tot)["mean_pct"],
                         "share_5pct_total": stats(tot)["share_5pct"],
                         "mean_trees_pct": round(float((tot - l_b).mean()) * 100, 3)})
    tot = total(l_b, l_s, TAU)
    sens.append({"tau": TAU, "canopy_height": "stated", "mask": "strict", "receiver": "roof",
                 "mean_total_pct": stats(tot)["mean_pct"], "share_5pct_total": stats(tot)["share_5pct"],
                 "mean_trees_pct": round(float((tot - l_b).mean()) * 100, 3)})
    sens.append({"tau": TAU, "canopy_height": "stated", "mask": "a1", "receiver": "raised_2m",
                 "mean_total_pct": stats(raised)["mean_pct"], "share_5pct_total": stats(raised)["share_5pct"],
                 "mean_trees_pct": round(float((raised - l_b_r).mean()) * 100, 3)})

    # THE LEVERS, per ward, so the dominant uncertainty is a number and not a footnote (A3).
    strict_total = total(l_b, l_s, TAU)
    levers: dict[str, Any] = {
        "mask_a1_vs_strict_pp": round(float(central.mean() - strict_total.mean()) * 100, 3),
        "tau_band_pp": round(float(total(l_b, l_t, TAU_BAND[0]).mean() - total(l_b, l_t, TAU_BAND[1]).mean()) * 100, 3),
        "canopy_minus_mae_pp": round(float(central.mean() - total(l_b, l_m, TAU).mean()) * 100, 3),
        "raised_2m_pp": round(float(central.mean() - raised.mean()) * 100, 3),
        "overhang_share_of_tree_term": round(1.0 - float((strict_total - l_b).mean()) / max(1e-12, float(trees.mean())), 4),
    }
    levers["largest"] = max((k for k in levers if k.endswith("_pp")), key=lambda k: float(levers[k]))
    print(f"  levers (pp of mean total): {levers}")

    print(f"\n  CENTRAL: total {central.mean()*100:.2f}% (buildings {l_b.mean()*100:.2f}%, trees "
          f"{trees.mean()*100:.2f}%) · share>=5% {(central>=0.05).mean()*100:.1f}%")
    print(f"  >=3 kWp: total {central[big].mean()*100:.2f}% · share>=5% {(central[big]>=0.05).mean()*100:.1f}%")
    print(f"  raised 2 m: total {raised.mean()*100:.2f}%")
    if not (cross_ok and mono_ok):
        raise SystemExit("  a sanity check FAILED -- the result is void by pre-registration; nothing written")

    out = out_path(ward_id)
    with open(out, "w") as fh:
        json.dump({
            "prereg": PREREG,
            "ward": ward_id, "buildings": nb, "grid_m": GRID_M, "pad_m": PAD_M, "frame_px": n,
            "sun_hours_sampled": len(suns), "runtime_s": round(time.time() - t0, 1),
            "canopy": {"source": canopy_mod.CHM_PREFIX, "version": "v2", "mae_m": CHM_MAE_M,
                       "canopy_min_m": CANOPY_MIN_M, "connectivity": "8-connected (A2)",
                       "on_roof_px": on_roof_px,
                       "overhang_kept_frac": round(kept_frac, 4),
                       "enclosed_dropped_frac": round(dropped_frac, 4),
                       "transmittance": TAU, "transmittance_band": list(TAU_BAND),
                       "href": canopy_mod.chm_href(ward), "max_m": round(float(chm.max()), 2),
                       "nonzero_px": int((chm > 0).sum())},
            "buildings_without_pixels": int(len(no_pixels)),
            "buildings_without_pixels_idx": [int(i) for i in no_pixels],
            "per_building_loss_total": [round(float(v), 4) for v in central],
            "per_building_loss_buildings": [round(float(v), 4) for v in l_b],
            "per_building_loss_trees": [round(float(v), 4) for v in trees],
            "per_building_loss_total_raised": [round(float(v), 4) for v in raised],
            "per_building_area_m2": [round(float(a), 1) for a in areas],
            "per_building_height_m": [round(float(h), 1) for h in heights],
            "cross_check": {"polygon_mean_pct": round(mean_p * 100, 3), "raster_mean_pct": round(mean_r * 100, 3),
                            "abs_diff_pp": round(abs(mean_r - mean_p) * 100, 3),
                            "polygon_share_5pct": round(share_p, 4), "raster_share_5pct": round(share_r, 4),
                            "abs_diff_share_pp": round(abs(share_r - share_p) * 100, 3), "pass": cross_ok,
                            "polygon_mean_pct_registered": round(mean_p_reg * 100, 3),
                            "polygon_share_5pct_registered": round(share_p_reg, 4),
                            "population": "buildings with raster pixels; registered figures are over all buildings"},
            "sanity": {"cross_check": cross_ok,
                       "loss_rises_as_sun_falls": {
                           "test": "per sample day: shaded fraction at the lowest-altitude sample > at the "
                                   "highest, and r(altitude, shaded fraction) < 0",
                           "days": len(days), "days_tested": days_tested, "pass": mono_ok},
                       "isolation_and_below_roof": "asserted on the synthetic scene (--self-check)"},
            "shaded_frac_by_sun": [round(f, 5) for f in frac_by_sun],
            "sun_samples": [[round(a, 2), round(z, 2), round(g, 1)] for a, z, g in suns],
            "sensitivity": sens,
            "levers": levers,
            "stratum": {"packing_factor": float(pv_yield.PACKING_FACTOR), "m2_per_kwp": float(pv_yield.M2_PER_KWP),
                        "threshold_kwp": 3.0, "n": int(big.sum())},
            "cross_check_ge_3kwp": xc_big,
            "predictions": {
                "P1_trees_exceed_buildings_ge_3kwp": {"trees_mean_pct": round(float(trees[big].mean()) * 100, 3),
                                                      "buildings_mean_pct": round(float(l_b[big].mean()) * 100, 3),
                                                      "holds": p1},
                "P2_total_never_falls": {"holds": p2}},
            "gate_restated": {"all_roofs": stats(central), "ge_3kwp": stats(central[big]),
                              "registered_verdict_2026_08_21": poly_art["verdict"],
                              "note": "reported ALONGSIDE the registered building-only verdict, never as a re-registration"},
            "notes": {
                "height_bias": poly_art["height_bias_note"],
                "rounding": "per_building_loss_total, _buildings and _trees are rounded independently to 4 dp, "
                            "so total may differ from buildings + trees by 1e-4; read all three, never derive "
                            "one from the other two",
                "canopy": "A1 connectedness rule, 8-connected as declared in A2: rooted crowns kept whole, "
                          "enclosed misreads dropped; a misread touching a real crown survives, so the "
                          "strict-mask sensitivity row bounds it. Canopy heights carry the model's 3.0 m "
                          "MAE; only the minus-MAE scenario is run, so the shipped figure is not the upper bound."
                          " The mask rule is the dominant lever in continuous canopy -- see "
                          "levers.mask_a1_vs_strict_pp and levers.overhang_share_of_tree_term.",
                "raster_bias": "The raster reads LOW against the polygon sweep (thin shadow slivers lost to "
                               "pixelisation, roofs quantised to whole pixels) -- see cross_check; the share "
                               "gate is the tight one (A2).",
                "grid": "0.5 m per Amendment A4. At 1 m Baruipur failed the share gate: buildings-only "
                        "raster 8.0% vs polygon 11.6% (3.60 pp of 3.0) while the mean passed (0.47 pp); "
                        "Ballygunge and Barrackpore passed at 1 m (2.41 / 1.79 pp). A disclosed "
                        "buildings-only diagnostic at 0.5 m for Baruipur gave mean 0.32 pp, share 2.23 pp, "
                        "r 0.9759 before this run. Tolerances and predictions unchanged.",
                "edge": "buildings have no pad (no geometry outside the ward), canopy has 200 m; "
                        "shading is understated at the ward edge.",
            },
        }, fh, indent=2)
    print(f"\n  written to {os.path.relpath(out, ROOT)}  ({time.time() - t0:.0f} s)")


def _self_check() -> None:
    """A synthetic scene the spec (section 7) fixes in advance. Offline; no loaders."""
    n = 120
    step = 1.0
    ids = np.zeros((n, n), dtype=np.int32)
    ids[50:70, 50:70] = 1                      # a 20 x 20 m roof at 5 m; row 0 = north
    roof = ids > 0
    dsm_b = np.where(roof, 5.0, 0.0).astype(np.float32)
    roof_h = np.full((n, n), 5.0, dtype=np.float32)

    def tree(h: float, rows: slice) -> F32:
        chm = np.zeros((n, n), dtype=np.float32)
        chm[rows, 59:62] = h                   # a 3 m wide tree, 3 rows deep
        return chm

    alt, az = 30.0, 180.0                      # sun due SOUTH: shadows run NORTH, toward row 0

    # 1. a 20 m tree 10 m SOUTH of the roof shades (20-5)/tan30 = 26 m of it: the roof begins
    #    10 m north of the tree, so ~15-16 rows x 3 columns of roof are shaded
    sh = shadow_height(np.maximum(dsm_b, tree(20.0, slice(80, 83))), alt, az, step)
    shaded = (sh > roof_h + EPS_M) & roof
    assert 39 <= int(shaded.sum()) <= 54, f"20 m tree south of roof: {int(shaded.sum())} px, expected ~45"
    assert int(shaded[:, 59:62].sum()) == int(shaded.sum()), "shadow left the tree's columns"
    # 2. the same tree NORTH of the roof throws its shadow AWAY from it: nothing
    sh = shadow_height(np.maximum(dsm_b, tree(20.0, slice(37, 40))), alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "shadow pointed toward the sun"
    # 3. a 4 m tree south of a 5 m roof shades nothing: nothing lower than the roof shades it
    sh = shadow_height(np.maximum(dsm_b, tree(4.0, slice(80, 83))), alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "a caster below the roof shaded it"
    # 4. the roof alone: exactly zero (isolation)
    sh = shadow_height(dsm_b, alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "an isolated roof shaded itself"
    # 5. loss rises as the sun falls: the same tree at 15 deg reaches further than at 30 deg
    lo = shadow_height(np.maximum(dsm_b, tree(20.0, slice(80, 83))), 15.0, az, step)
    assert int(((lo > roof_h + EPS_M) & roof).sum()) > int(shaded.sum()), "loss did not rise as the sun fell"
    # 6. attribution and the loss formula: a 12 m BUILDING block due south of the roof's west
    #    columns scores 1.0 on the pixels it shades ((12-5)/tan30 = 12 m -> 2 roof rows x 6
    #    columns = 12 px), the tree's pixels score 1 - TAU, a pixel under both is building-shaded
    dsm_b2 = dsm_b.copy()
    dsm_b2[80:86, 50:56] = 12.0
    sh_b = shadow_height(dsm_b2, alt, az, step)
    sh_t = shadow_height(np.maximum(dsm_b2, tree(20.0, slice(80, 83))), alt, az, step)
    b, t = classify(sh_b, sh_t, roof_h, 0.0)
    n_b, n_t = int((b & roof).sum()), int((t & roof).sum())
    assert 6 <= n_b <= 18, f"building block shaded {n_b} px, expected ~12"
    assert 39 <= n_t <= 54, f"tree-only shaded {n_t} px, expected ~45"
    assert not bool((b & t).any()), "a pixel was both building- and tree-shaded"
    npx = float(roof.sum())
    loss = float(total(np.asarray([n_b / npx]), np.asarray([n_t / npx]), TAU)[0])
    assert abs(loss - (12 + 0.7 * 45) / 400.0) < 0.02, f"composed loss {loss:.4f}"
    # 7. raising the array 2 m clears part of the building's shadow and none of the tree's reach
    b_r, t_r = classify(sh_b, sh_t, roof_h, RAISE_M)
    assert int((b_r & roof).sum()) < n_b, "raising the array did not reduce building shading"
    assert int((t_r & roof).sum()) <= n_t, "raising the array increased tree shading"

    # 8. the A1 connectedness rule: a blob enclosed in the footprint is dropped, a crown that
    #    straddles the edge is kept whole, and the two published fractions are exact
    chm = np.zeros((n, n), dtype=np.float32)
    chm[55:58, 55:58] = 9.0                    # 9 px, fully inside the roof: a misread building
    chm[66:74, 60:64] = 12.0                   # 8 x 4 = 32 px straddling the south edge: rows 66-69
    #                                            are on the roof (16 px), rows 70-73 are not
    masked, kept, dropped, on_roof_px = mask_canopy(chm, roof)
    assert float(masked[55:58, 55:58].max()) == 0.0, "enclosed blob survived"
    assert float(masked[66:74, 60:64].min()) == 12.0, "a rooted crown was cut"
    assert abs(kept - 16 / 25) < 1e-9 and abs(dropped - 9 / 25) < 1e-9, f"fractions {kept:.3f} {dropped:.3f}"
    assert on_roof_px == 25, f"on-roof canopy count {on_roof_px}"
    # 9. day grouping: two synthetic days, the second starting with a morning azimuth
    groups = day_groups([(20.0, 100.0, 1.0), (50.0, 170.0, 1.0), (20.0, 250.0, 1.0),
                         (25.0, 95.0, 1.0), (55.0, 180.0, 1.0)])
    assert groups == [[0, 1, 2], [3, 4]], f"day groups {groups}"
    # 10. east-west is a separate axis and every case above sits at az 180, where the column
    #     offset is zero for every k. A mast under a sun due EAST must throw its shadow WEST,
    #     along its own row, and nowhere else. (A sign flip on the east term survived cases 1-9
    #     AND the ward cross-check gates, measured; this is the case that kills it.)
    mast = np.zeros((n, n), dtype=np.float32)
    mast[60, 60] = 20.0
    lit = np.argwhere(shadow_height(mast, 30.0, 90.0, step) > EPS_M)
    assert len(lit) > 0 and int(lit[:, 1].max()) < 60, "east sun did not shade westward"
    assert int(lit[:, 0].min()) == 60 and int(lit[:, 0].max()) == 60, "east-sun shadow left the mast's row"
    # 11. connectivity is declared (A2): dilation and labelling are BOTH 8-connected, so a blob
    #     whose only off-roof pixel touches the roof's corner diagonally is still enclosed.
    chm = np.zeros((n, n), dtype=np.float32)
    chm[49, 49] = 9.0                          # diagonal corner pixel, off the roof (rows/cols 50-69)
    chm[50:53, 50:53] = 9.0                    # the 9-px blob on the roof it connects to
    masked, kept, dropped, _ = mask_canopy(chm, roof)
    assert float(masked[50:53, 50:53].max()) == 0.0 and dropped == 1.0 and kept == 0.0, \
        f"diagonal corner counted as rooted: kept {kept} dropped {dropped}"
    #     ...and with one more pixel further out along the diagonal, the chain reaches OUTSIDE
    #     the dilated footprint, so the same blob is rooted and kept -- this pins the LABELLING's
    #     connectivity, which the first sub-case cannot (a 4-connected label would break the
    #     diagonal chain and drop it; measured to survive without this).
    chm[48, 48] = 9.0
    masked, kept, dropped, _ = mask_canopy(chm, roof)
    assert float(masked[50:53, 50:53].min()) == 9.0 and kept == 1.0 and dropped == 0.0, \
        f"diagonal chain not followed by the labelling: kept {kept} dropped {dropped}"
    print("  self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    run_ward(args.ward)


if __name__ == "__main__":
    main()
