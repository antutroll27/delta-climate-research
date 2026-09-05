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
from typing import Any

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


_shading = _load("_pvshading", "measure-pv-shading.py")
_canopy = _load("_fetchcanopy", "fetch-canopy.py")
_yield = _load("_pvyield", "build-pv-yield.py")

#: LOCKED BY THE PRE-REGISTRATION (spec section 3 and Amendment A1).
GRID_M = 1.0            # a 1 m read costs ~2 s, and a 50 m2 roof is 50 pixels instead of 12
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
    assert dsm.shape[0] == dsm.shape[1], f"square grid required, got {dsm.shape}"
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


def mask_canopy(chm: F32, foot: BoolA) -> tuple[F32, float, float]:
    """Amendment A1 connectedness rule. Returns (masked canopy, share of on-roof canopy kept
    as overhang, share dropped as enclosed).

    Label the connected components of canopy > CANOPY_MIN_M. A component with ANY pixel
    outside every footprint (dilated by one pixel) is a tree rooted outside: kept whole,
    overhang included. A component enclosed entirely within footprints has no tree to belong
    to: a building the model misread as canopy, zeroed. Canopy at or below a roof's own height
    is harmless either way (DSM = max(building, canopy)), so the rule only bites where canopy
    over a roof stands above that roof."""
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
    denom = max(1, int(on_roof.sum()))
    kept = float((on_roof & rooted[lab]).sum()) / denom
    dropped = float((on_roof & enclosed).sum()) / denom
    return out, kept, dropped


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
    nb, nt = int((b & roof).sum()), int((t & roof).sum())
    assert 6 <= nb <= 18, f"building block shaded {nb} px, expected ~12"
    assert 39 <= nt <= 54, f"tree-only shaded {nt} px, expected ~45"
    assert not bool((b & t).any()), "a pixel was both building- and tree-shaded"
    npx = float(roof.sum())
    loss = float(total(np.asarray([nb / npx]), np.asarray([nt / npx]), TAU)[0])
    assert abs(loss - (12 + 0.7 * 45) / 400.0) < 0.02, f"composed loss {loss:.4f}"
    # 7. raising the array 2 m clears part of the building's shadow and none of the tree's reach
    b_r, t_r = classify(sh_b, sh_t, roof_h, RAISE_M)
    assert int((b_r & roof).sum()) < nb, "raising the array did not reduce building shading"
    assert int((t_r & roof).sum()) <= nt, "raising the array increased tree shading"

    # 8. the A1 connectedness rule: a blob enclosed in the footprint is dropped, a crown that
    #    straddles the edge is kept whole, and the two published fractions are exact
    chm = np.zeros((n, n), dtype=np.float32)
    chm[55:58, 55:58] = 9.0                    # 9 px, fully inside the roof: a misread building
    chm[66:74, 60:64] = 12.0                   # 8 x 4 = 32 px straddling the south edge: rows 66-69
    #                                            are on the roof (16 px), rows 70-73 are not
    masked, kept, dropped = mask_canopy(chm, roof)
    assert float(masked[55:58, 55:58].max()) == 0.0, "enclosed blob survived"
    assert float(masked[66:74, 60:64].min()) == 12.0, "a rooted crown was cut"
    assert abs(kept - 16 / 25) < 1e-9 and abs(dropped - 9 / 25) < 1e-9, f"fractions {kept:.3f} {dropped:.3f}"
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
    masked, kept, dropped = mask_canopy(chm, roof)
    assert float(masked[50:53, 50:53].max()) == 0.0 and dropped == 1.0 and kept == 0.0, \
        f"diagonal corner counted as rooted: kept {kept} dropped {dropped}"
    print("  self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    raise SystemExit("ward run not implemented yet")


if __name__ == "__main__":
    main()
