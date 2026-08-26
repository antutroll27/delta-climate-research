"""Terrain-based flood susceptibility, and the baselines it must beat.

WHY THIS EXISTS. On 2026-08-26 the unsteady solver was scored against Landsat's
observed extent for the April 2024 event and lost to a one-line heuristic:

    at ~2 km districts:  full physics model  r = +0.008
                         inverted elevation  r = +0.460

A flood model that cannot beat "low ground gets wet" is subtracting information
from the terrain rather than adding physics to it. The terrain already carries
the signal; this module formalises it and — crucially — keeps the trivial
baselines alongside so any claim of improvement is a measured one.

THIS IS NOT A RETREAT FROM PHYSICS. It is a resolution argument. At 30 m on a
1.7 m/km slope, the sub-metre differences that decide which street floods sit
below the DEM's own noise floor, and water in a street between buildings is
sub-pixel. What survives at that resolution is WHERE WATER COLLECTS, which is a
terrain question. See BUILD-SPEC 3a: fill-spill was falsified here at CELL
scale, and that finding stands — but it was never tested at district scale,
where elevation demonstrably works. Different questions.

WHAT IS IMPLEMENTED, cheapest first, so the added complexity has to earn itself:

    elevation      -z. The control. Anything that cannot beat this is noise.
    depth_below    how far a cell sits below its local neighbourhood — captures
                   hollows that raw elevation misses on a tilted plane.
    twi            topographic wetness index, ln(a / tan b): the standard
                   terrain wetness measure, upslope area over local slope.
    hand           height above nearest drainage (Nobre et al. 2016), computed
                   against the sea mask as the drainage network — the physically
                   meaningful "how far above an outlet am I".

Every index returns HIGHER = MORE LIKELY TO FLOOD, so they score identically and
can be compared without sign bookkeeping.

    python3 scripts/flood_terrain_index.py --self-test
"""
from __future__ import annotations

import argparse
import sys
from typing import Any

import numpy as np
from scipy import ndimage


def elevation(z: np.ndarray[Any, Any], **_: Any) -> np.ndarray[Any, Any]:
    """The control: low ground is wet. One line, and it beat the solver."""
    out: np.ndarray[Any, Any] = -z
    return out


def depth_below(z: np.ndarray[Any, Any], radius_m: float = 480.0,
                cell: float = 30.0, **_: Any) -> np.ndarray[Any, Any]:
    """Metres below the local neighbourhood mean.

    Raw elevation confuses "low in absolute terms" with "low relative to
    surroundings". On a domain that ramps from 0 to 60 m, a 2 m hollow on high
    ground never registers against the coastal strip. This removes the regional
    trend and keeps the hollows, which is what actually ponds.
    """
    sigma = max(radius_m / cell / 2.0, 1.0)
    smooth = ndimage.gaussian_filter(z, sigma, mode="nearest")
    out: np.ndarray[Any, Any] = smooth - z
    return out


def twi(z: np.ndarray[Any, Any], cell: float = 30.0,
        **_: Any) -> np.ndarray[Any, Any]:
    """Topographic wetness index, ln(a / tan b).

    `a` is upslope contributing area per unit contour length, `b` local slope.
    Computed with a single-flow-direction accumulation on the filled surface —
    D8 rather than D-infinity, because at 30 m the extra dispersion of D-inf
    buys precision the DEM cannot support.

    The slope floor is not cosmetic: Dubai has genuinely flat cells, tan b -> 0
    sends TWI -> infinity, and a handful of infinities would dominate any
    correlation computed against it.
    """
    filled = _fill_sinks(z)
    acc = _flow_accumulate(filled) * (cell * cell)
    gy, gx = np.gradient(filled, cell)
    slope = np.maximum(np.hypot(gx, gy), 1e-4)      # floor: flat cells are real here
    out: np.ndarray[Any, Any] = np.log((acc / cell) / slope)
    return out


def hand(z: np.ndarray[Any, Any], drainage: np.ndarray[Any, Any] | None = None,
         **_: Any) -> np.ndarray[Any, Any]:
    """Height Above Nearest Drainage (Nobre et al. 2016), negated.

    Distance-transform form: for every cell, the elevation of the nearest
    drainage cell, subtracted from its own. Low HAND means close to an outlet in
    the vertical sense, which is the physically meaningful statement about flood
    exposure — more so than absolute elevation, because it is relative to where
    water can actually go.

    Uses the sea mask as the drainage network. That is the honest choice here:
    the UAE has NO permanent natural watercourses (verified — zero `waterway=*`
    in the window), so the coast IS the drainage network, and a synthetic stream
    network derived from flow accumulation on 30 m terrain would be the same
    noise BUILD-SPEC 3a already falsified.
    """
    if drainage is None or not drainage.any():
        return np.zeros_like(z)
    idx: Any = ndimage.distance_transform_edt(~drainage, return_indices=True)
    iy, ix = idx[1]
    out: np.ndarray[Any, Any] = -(z - z[iy, ix])
    return out


def _fill_sinks(z: np.ndarray[Any, Any], iters: int = 40) -> np.ndarray[Any, Any]:
    """Priority-flood-lite: raise pits to their lowest escape, iteratively.

    Not a full Barnes priority-flood. At 30 m on this terrain the depression
    field is sensor noise (BUILD-SPEC 3a), so an exact fill would be exact about
    something meaningless; this only needs to stop flow accumulation stalling.
    """
    f = z.copy()
    for _ in range(iters):
        nb = np.stack([np.roll(np.roll(f, dy, 0), dx, 1)
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                       if (dy, dx) != (0, 0)])
        lowest = nb.min(axis=0)
        raise_to = np.maximum(f, np.minimum(lowest, f + 100.0))
        raise_to[0, :] = f[0, :]; raise_to[-1, :] = f[-1, :]
        raise_to[:, 0] = f[:, 0]; raise_to[:, -1] = f[:, -1]
        if np.allclose(raise_to, f):
            break
        f = raise_to
    return f


def _flow_accumulate(z: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """D8 accumulation, cells drained. Processes cells HIGHEST first.

    Descending order is the whole algorithm: ascending only ever adds a cell's
    immediate upstream neighbours, so accumulation never grows past ~1 and the
    index it feeds is flat. That exact bug was found and fixed in this repo
    once already.
    """
    n = z.shape[0]
    acc = np.ones_like(z)
    order = np.argsort(z.ravel())[::-1]
    for flat in order:
        y, x = divmod(int(flat), n)
        best, by, bx = z[y, x], -1, -1
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < n and 0 <= nx < n and z[ny, nx] < best:
                    best, by, bx = z[ny, nx], ny, nx
        if by >= 0:
            acc[by, bx] += acc[y, x]
    return acc


# Signatures differ (hand needs a drainage network), so they are called with
# keywords only and the map is typed loosely on purpose.
INDICES: dict[str, Any] = {"elevation": elevation, "depthBelow": depth_below,
                           "twi": twi, "hand": hand}


def self_test() -> int:
    """Runnable checks on synthetic terrain with known answers."""
    fails: list[str] = []

    def a(ok: bool, msg: str) -> None:
        if not ok:
            fails.append(msg)

    n = 48
    ramp = np.tile(np.linspace(0.0, 20.0, n).reshape(n, 1), (1, n))   # row 0 low

    # 1. Every index must rank low ground above high ground on a plain ramp.
    drain = np.zeros((n, n), dtype=bool); drain[0, :] = True
    for name, fn in INDICES.items():
        v = fn(ramp, cell=30.0, drainage=drain)
        a(float(v[:8].mean()) > float(v[-8:].mean()),
          f"{name}: ranks high ground as more flood-prone on a simple ramp")

    # 2. depth_below must find a hollow that raw elevation cannot see, because
    #    the hollow sits on HIGH ground.
    pit = ramp.copy(); pit[36:40, 20:24] -= 3.0
    db = depth_below(pit, cell=30.0)
    a(float(db[36:40, 20:24].mean()) > float(db[10:14, 20:24].mean()),
      "depthBelow: a 3 m hollow on high ground does not outrank low flat ground")
    a(float(elevation(pit)[36:40, 20:24].mean()) < float(elevation(pit)[10:14, 20:24].mean()),
      "elevation: unexpectedly saw the high hollow — the premise of depthBelow is wrong")

    # 3. HAND must be flat where the surface is flat, whatever the drainage.
    flat = np.zeros((n, n))
    h = hand(flat, drain)
    a(float(np.ptp(h)) < 1e-9, "hand: varies over perfectly flat ground")

    # 4. Flow accumulation must actually accumulate. The ascending-order bug
    #    leaves max at ~9; a real ramp should concentrate far more than that.
    acc = _flow_accumulate(ramp)
    a(float(acc.max()) > n, f"flow accumulation peaked at {acc.max():.0f} on a {n}-row ramp "
                            f"— it is not accumulating downslope")

    for line in fails:
        print(f"  FAIL {line}")
    print(f"\n  {5 - len(fails)} of 5 check groups passed.")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.parse_args()
    return self_test()


if __name__ == "__main__":
    sys.exit(main())
