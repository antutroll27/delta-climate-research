#!/usr/bin/env python3
"""
Python port of the canopy path the BROWSER runs: PNG decode, resample, blend.

WHY THIS FILE EXISTS. `rasterWardBase` (src/scripts/climate-engine/ward-raster.ts)
does this, once, on every ward the map draws:

    if (canopy) veg = blendCanopyIntoVeg(veg, resample(canopy.height, canopy.n, n), 0.5);

No Python applied it. So the validation stack scored a vegetation field that has
never shipped -- documented as limitation #1 in docs/evidence/known-limitations.md
and found because the accuracy output was byte-identical across a canopy change
that nearly doubled the height field. That identity was a tautology, not evidence.

WHAT IS HERE. The three shipped TypeScript functions that stand between a canopy
PNG on disk and the `veg[]` the solver reads:

    canopy_heights_from_pixels  <- surface-raster.ts canopyHeightsFromPixels
    resample_bilinear           <- surface-raster.ts resample
    blend_canopy_into_veg       <- ward-raster.ts    blendCanopyIntoVeg

NOT here: any physics, and any change to the blend. This module is a mirror. The
TypeScript is the original and stays the original.

THE ORACLE IS NOT OPTIONAL. One equation now has two implementations, which drift
silently. tests/fixtures/canopy-oracle/oracle.json is generated from the REAL
shipped TypeScript by scripts/dump-canopy-oracle.mjs, and scripts/check-canopy-
oracle.py runs this module against it on every `npm run test:py`. TypeScript is the
oracle; this file must reproduce it, never the other way round.

ROW ORDER. `canopy_heights_from_pixels` flips north-up PNG rows into the sim's
south-up grid, exactly as the browser does. That flip has already been a real bug
in this repo (surface-raster.ts records corr(veg, built) = +0.071 unflipped vs
-0.398 flipped -- only the negative one is physical), so both frames are named in
the API rather than left to the caller to remember.
"""
from __future__ import annotations

import os
from typing import cast

import numpy as np
import numpy.typing as npt
from PIL import Image

F32 = npt.NDArray[np.float32]

#: Quantisation ceiling for canopy height, in metres.
#: CROSS-FILE CONSTANT: must match CANOPY_HI in scripts/fetch-canopy.py (the writer)
#: and in src/scripts/climate-engine/surface-raster.ts (the browser's reader). If any
#: one of the three moves alone, every dequantised height silently rescales.
CANOPY_HI = 30.0

#: The strength `rasterWardBase` passes. Not a tunable here -- it is read off the single
#: shipped call site (CANOPY_BLEND_STRENGTH in src/scripts/climate-engine/types.ts), and
#: changing it in this file would make the laboratory score a blend the instrument does not
#: apply. THAT IS MACHINE-CHECKED, not a convention: the canopy parity oracle carries the
#: TypeScript value as `shippedStrength` and scripts/check-canopy-oracle.py fails if this
#: line disagrees with it. Fix the TypeScript first; this follows.
#:
#: IT IS ZERO, AND THAT IS NOT A MISTAKE -- do not "restore" 0.5. It shipped at 0.5 from
#: 2026-08-10 until 2026-08-12, unmeasured the whole time because no Python applied it (see
#: docs/evidence/known-limitations.md sec.1). The first sweep that could measure it -- 34
#: near-nadir ECOSTRESS scenes, 87 ward-scenes, all three wards -- was monotonic against us:
#:
#:     strength      0.00     0.15     0.25     0.50 (was shipped)
#:     r_physics   0.2154   0.2145   0.2129   0.2076
#:     r_veg       0.2380   0.2321   0.2245   0.1987
#:     anom RMSE   1.8358   1.8308   1.8251   1.8061
#:
#: The only metric it improved is an artefact: RMSE falls because the veg term's spatial SD
#: falls (0.64 -> 0.61), largely through the operator's own [0,1] clamps, and the model
#: already draws ~2x the observed spatial SD -- error reduced by compressing an over-drawn
#: amplitude, not by getting the pattern right. At 0.5 the implied tree:grass veg ratio was
#: 4.9-8.1x against the 2-4x of Schwaab et al. 2021 (Nat Commun 12:6763), while raw NDVI FVC
#: is in band at 2.0-2.7x. And the operator is exactly scale-invariant in height -- the
#: target `vMean * h_i / hMean` cancels magnitude -- so it never used canopy height, only the
#: canopy pattern, which is the thing it degrades.
#:
#: The blend therefore no longer enters the temperature solve at all; the canopy raster is
#: render-only. `blend_canopy_into_veg` stays general and is still oracle-checked at 0, 0.5
#: and 1.0, so this is reversible by one constant on the TypeScript side.
BLEND_STRENGTH = 0.0


def canopy_heights_from_pixels(data: npt.NDArray[np.uint8], n: int,
                               hi: float = CANOPY_HI) -> F32:
    """Port of `canopyHeightsFromPixels`: RGBA bytes -> heights in metres, SIM frame.

    `data` is an RGBA byte buffer of length n*n*4, in the PNG's own north-up row
    order -- the same buffer `getImageData` hands the browser. Returns a FLAT
    float32 array of length n*n in the simulation's south-up row order, because
    that is what the TypeScript returns and the parity oracle compares against.

    The arithmetic, transcribed:

        src = (row * n + col) * 4        // PNG row 0 = NORTH
        dst = (n - 1 - row) * n + col    // sim grid row 0 = SOUTH
        height[dst] = (data[src] / 255) * hi

    R channel only. G and B are unused by the browser and are ignored here too.
    """
    if data.size != n * n * 4:
        raise ValueError(f"canopy pixel buffer is {data.size} bytes, expected {n * n * 4} "
                         f"for a {n}x{n} RGBA image")
    red = data.reshape(n, n, 4)[:, :, 0].astype(np.float64) / 255.0 * hi
    # np.flipud IS the `(n - 1 - row)` above: north-up rows become south-up rows.
    return cast(F32, np.flipud(red).astype(np.float32).ravel())


def load_canopy_sim_frame(path: str, hi: float = CANOPY_HI) -> F32:
    """Decode a `{ward}-canopy.png` to an (n, n) height field in the SIM's frame.

    Mirrors `loadCanopyRaster`: the file is opened as RGBA so the byte layout is
    the one `getImageData` produces (the artefacts on disk are 3-channel RGB, and
    the browser's canvas adds the alpha channel before the decoder ever sees them).
    Square by construction -- a non-square texture means the exporter changed shape
    without its readers following, which would skew every sample silently.
    """
    with Image.open(path) as im:
        rgba = im.convert("RGBA")
        w, h = rgba.size
        if w != h:
            raise ValueError(f"{os.path.basename(path)} is {w}x{h}, not square")
        data = np.asarray(rgba, dtype=np.uint8)
    return cast(F32, canopy_heights_from_pixels(data.ravel(), w, hi).reshape(w, w))


def load_canopy_north_up(path: str, hi: float = CANOPY_HI) -> F32:
    """The same heights, re-expressed in the PNG's own NORTH-UP frame.

    The Python validation stack works north-up throughout: the surface PNG is read
    unflipped, and the ECOSTRESS target grid is north-up too (measure-spatial-
    accuracy.py's `built_layer` documents why `built` is the layer that gets flipped
    there, not the others). So a geospatial caller needs the browser's heights with
    the browser's flip undone.

    The round trip through the sim frame is DELIBERATE and must not be "optimised"
    into a direct read. There is exactly one decode of this PNG in Python, it is the
    oracle-checked port, and this function is a named frame conversion on top of it.
    A second, flip-free decoder is precisely how the two frames drifted apart the
    last time.
    """
    return np.flipud(load_canopy_sim_frame(path, hi)).copy()


def resample_bilinear(source: F32, source_n: int, target_n: int) -> F32:
    """Port of surface-raster.ts `resample`: bilinear, flat in, flat out.

    Only the residual measurement needs this -- the validation path blends at its
    own 140 grid, where no resample happens. It lives here because it is the other
    half of the shipped call site, and reproducing the browser's 192-grid answer to
    measure how far 140 lands from it is only meaningful if this matches too. So it
    is oracle-checked alongside the blend rather than written ad hoc.
    """
    src = np.ascontiguousarray(source, dtype=np.float32).reshape(source_n, source_n)
    scale = (source_n - 1) / max(1, target_n - 1)
    idx = np.arange(target_n, dtype=np.float64) * scale
    i0 = np.minimum(source_n - 1, np.floor(idx).astype(np.int64))
    i1 = np.minimum(source_n - 1, i0 + 1)
    frac = idx - i0
    # Separable: interpolate along x for the two bracketing rows, then along y.
    # Same operation order as the TS (x first, then y), so the rounding agrees.
    top = src[np.ix_(i0, i0)] * (1 - frac) + src[np.ix_(i0, i1)] * frac
    bottom = src[np.ix_(i1, i0)] * (1 - frac) + src[np.ix_(i1, i1)] * frac
    out = top * (1 - frac)[:, None] + bottom * frac[:, None]
    return cast(F32, out.astype(np.float32).ravel())


def blend_canopy_into_veg(veg: F32, canopy: F32, strength: float = BLEND_STRENGTH) -> F32:
    """Port of ward-raster.ts `blendCanopyIntoVeg`. Shape-preserving.

    Redistributes vegetation toward measured canopy height without moving the ward
    mean. Every branch of the original is reproduced, including the two that make it
    only APPROXIMATELY mean-neutral:

      * length mismatch    -> the input is returned UNCHANGED (TS returns the same
                              reference). Callers that would rather hear about a
                              shape mismatch must check before calling; this
                              function's job is to be the TypeScript.
      * cSum <= 0          -> unchanged. Reached by an all-zero canopy, and also by
                              any field whose values sum to zero or below.
      * two [0,1] clamps   -> the first bounds the nudged value, the second bounds
                              the re-centred one. The SECOND is why the mean is only
                              approximately preserved: mass clipped off at a bound
                              cannot be given back. Do not simplify either away --
                              the operator's near-neutrality is a measured property
                              of this exact sequence, not an algebraic identity.

    Accumulation is float64 over float32 storage, matching JavaScript: a Float32Array
    element widens to a double on read, and the stored result rounds back to float32.
    """
    v = np.ascontiguousarray(veg, dtype=np.float32).ravel()
    c = np.ascontiguousarray(canopy, dtype=np.float32).ravel()
    count = v.size
    # TS compares `canopy.length !== veg.length` on flat arrays; element count is the
    # faithful equivalent for arrays that may arrive here 2-D.
    if c.size != count or count == 0:
        return veg
    v_sum = float(v.sum(dtype=np.float64))
    c_sum = float(c.sum(dtype=np.float64))
    if c_sum <= 0:
        return veg
    v_mean, c_mean = v_sum / count, c_sum / count
    v64 = v.astype(np.float64)
    target = v_mean * (c.astype(np.float64) / c_mean)
    out = np.clip(v64 + strength * (target - v64), 0.0, 1.0).astype(np.float32)
    o_sum = float(out.sum(dtype=np.float64))
    delta = (v_sum - o_sum) / count
    out = np.clip(out.astype(np.float64) + delta, 0.0, 1.0).astype(np.float32)
    return cast(F32, out.reshape(np.shape(veg)))


def assert_canopy_port() -> None:
    """ponytail: one runnable check. Cheap invariants, no fixture, no files.

    The authoritative check is scripts/check-canopy-oracle.py against the real
    TypeScript. This one exists so an import-time smoke test can fail fast on the
    two things most likely to be broken by an edit here: the row flip and the
    early returns.
    """
    def ok(cond: bool, msg: str) -> None:
        if not cond:
            raise AssertionError(f"_canopy: {msg}")

    # Row flip. Reds are 255 in the north-west pixel only, so an unflipped decode
    # puts the tall cell at index 0 and a flipped one at index n*(n-1).
    n = 2
    px = np.zeros(n * n * 4, dtype=np.uint8)
    px[0] = 255                       # PNG row 0 (north), col 0 -> sim row 1
    h = canopy_heights_from_pixels(px, n, 30.0)
    ok(abs(float(h[2]) - 30.0) < 1e-4, "north-west pixel must land in the sim's TOP row")
    ok(float(h[0]) == 0.0, "sim row 0 is SOUTH and must stay empty here")

    # Early returns must return the input, not a blended copy.
    veg = np.full(9, 0.3, dtype=np.float32)
    ok(blend_canopy_into_veg(veg, np.zeros(4, np.float32)) is veg, "length mismatch returns input")
    ok(blend_canopy_into_veg(veg, np.zeros(9, np.float32)) is veg, "cSum <= 0 returns input")
    ok(blend_canopy_into_veg(veg, np.full(9, -1.0, np.float32)) is veg, "negative cSum returns input")

    # Redistribution with the mean held: tall canopy on one half must pull veg there.
    canopy = np.concatenate([np.full(8, 10.0, np.float32), np.zeros(8, np.float32)])
    flat = np.full(16, 0.3, dtype=np.float32)
    out = blend_canopy_into_veg(flat, canopy, 0.5)
    ok(abs(float(out.mean()) - 0.3) < 1e-6, "ward mean must be preserved")
    ok(float(out[:8].sum()) > float(out[8:].sum()), "vegetation must shift toward tall canopy")
    ok(bool(((out >= 0.0) & (out <= 1.0)).all()), "output must stay in [0,1]")

    # A constant field must survive the resample unchanged, and corners must be kept.
    ok(bool(np.allclose(resample_bilinear(np.full(16, 0.25, np.float32), 4, 8), 0.25, atol=1e-6)),
       "resampling a constant must not change it")
    ramp = resample_bilinear(np.asarray([0, 1, 2, 3], np.float32), 2, 3)
    ok(abs(float(ramp[0])) < 1e-6 and abs(float(ramp[8]) - 3.0) < 1e-6, "corners preserved")
    ok(abs(float(ramp[4]) - 1.5) < 1e-6, "centre of a 2x2 ramp is the mean of its corners")

    print("  _canopy port self-check OK")


if __name__ == "__main__":
    assert_canopy_port()
