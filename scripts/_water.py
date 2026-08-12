#!/usr/bin/env python3
"""
Python port of the water rasterisation the BROWSER runs: OSM polygons -> `SimLayers.water`.

WHY THIS FILE EXISTS. `rasterWardBase` (src/scripts/climate-engine/ward-raster.ts)
does this, once, on every ward the map draws:

    const waterFraction = rasterizeWardWater(water, ward.sizeM, n);

and the solver reads that array twice -- `sim-ts.ts` boosts ventilation by
`0.65 * water[i]` and relaxes the cell toward `tAir - 1.5` with weight
`water[i] * 0.35`. Until 2026-08-13 the array was `new Float32Array(count)` and
nothing ever wrote it, so both terms collapsed to the identity and every pond in
three wards was solved as warm land.

No Python applied it either -- so the moment the browser started filling that layer,
the validation stack would have been scoring a different field from the one the map
renders. That is limitation #1 in docs/evidence/known-limitations.md, in a new place,
and the answer is the same one: port the operator, pin it to the TypeScript with an
oracle, and let the laboratory track the instrument automatically.

WHAT IS HERE. The shipped TypeScript that stands between `{ward}-water.json` on disk
and the `water[]` the solver reads:

    rasterize_ward_water  <- ward-raster.ts  rasterizeWardWater
                             (and, inlined into it, stampRing / pointInPolygon /
                              pointOnSegment / coverageFromBits)

NOT here: any physics, and any change to the rasterisation. This module is a mirror.
The TypeScript is the original and stays the original.

WHY THE BUILT LAYER IS NOT PORTED TOO, when the two share `stampRing` in the
TypeScript. `built` already has a better answer: scripts/export-built-raster.mjs runs
the REAL rasteriser and writes a cache the Python reads, so there is only ever one
implementation. Water cannot use that route -- measure-shipped-amplitude.py needs the
layer at 192 and measure-spatial-accuracy.py at 140, and a cache would freeze one
grid. The polygons are small (86 rings over three wards), so rasterising on demand is
cheap; the cost is this second implementation, and the oracle is what pays it.

THE ORACLE IS NOT OPTIONAL. tests/fixtures/water-oracle/oracle.json is generated from
the REAL shipped TypeScript by scripts/dump-water-oracle.mjs, and
scripts/check-water-oracle.py runs this module against it on every `npm run test:py`.
TypeScript is the oracle; this file must reproduce it, never the other way round.

ROW ORDER. `rasterize_ward_water` returns the SIM's south-up grid, exactly as the
TypeScript does -- `sampleY = -half + gridY * cellM`, so row 0 is the ward's SOUTH
edge. The Python validation stack is north-up throughout (see `built_layer` in
measure-spatial-accuracy.py for the flip that already exists and why), so
`water_north_up` is the named conversion. Both frames are in the API rather than
left to the caller to remember.
"""
from __future__ import annotations

import json
import math
import os
from typing import TypedDict, cast

import numpy as np
import numpy.typing as npt

F32 = npt.NDArray[np.float32]
F64 = npt.NDArray[np.float64]
Mask = npt.NDArray[np.bool_]

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "public", "heat-map", "data")


class WaterPoly(TypedDict):
    """One clipped outer ring. Mirrors `WaterData['polys'][n]` in heat-map-model.ts."""
    k: str          # 'water' | 'river' | 'pool' -- render-only; the physics ignores class
    p: list[float]  # flat [x, y, x, y, ...] in ward-centred metres, x east, y north


class WaterFile(TypedDict):
    """`{ward}-water.json`, as scripts/fetch-water.py writes it."""
    ward: str
    count: int
    source: str
    polys: list[WaterPoly]


#: Subsample offsets within a cell, in cell units. Mirrors SAMPLE_OFFSETS in
#: ward-raster.ts -- 2x2, deliberately analytical rather than Canvas-rasterised, so
#: the grid does not depend on a browser's antialiasing.
SAMPLE_OFFSETS: tuple[float, float] = (0.25, 0.75)

#: Subsample bitfield -> area fraction. Mirrors COVERAGE_BY_BITS in ward-raster.ts.
#: It is popcount/4 and is written out rather than computed for exactly that reason:
#: the TABLE is the shipped artefact, and a clever reimplementation is one transcription
#: error away from being a different rasteriser.
COVERAGE_BY_BITS: tuple[float, ...] = (
    0, 0.25, 0.25, 0.5, 0.25, 0.5, 0.5, 0.75, 0.25, 0.5, 0.5, 0.75, 0.5, 0.75, 0.75, 1,
)

#: Whether the layer this module builds reaches the SOLVER. Not a tunable here -- it is
#: read off the single shipped call site (WATER_LAYER_ENABLED in
#: src/scripts/climate-engine/types.ts), and changing it in this file would make the
#: laboratory score a layer the instrument does not apply. THAT IS MACHINE-CHECKED, not a
#: convention: the water parity oracle carries the TypeScript value as `shippedEnabled` and
#: scripts/check-water-oracle.py fails if this line disagrees with it. Fix the TypeScript
#: first; this follows.
#:
#: IT IS FALSE, AND THAT IS NOT A MISTAKE -- do not "finish the job" by setting it True.
#: The layer had been an unwritten `new Float32Array(count)` since the engine shipped, so
#: filling it looks like closing a gap, and the first measurement able to score it said
#: otherwise. Driving the REAL solver over 34 near-nadir scenes / 87 ward-scenes / 3 wards:
#:
#:     r_shipped   0.3031 -> 0.2544        spatial SD  1.345 K -> 1.514 K (observed 0.925)
#:     day         0.3883 -> 0.3593        over-draw   1.45x -> 1.64x
#:     night       0.2400 -> 0.1768
#:
#: and the loss scales with each ward's open water -- 0.72% / 1.30% / 4.88% coverage giving
#: -0.013 / -0.061 / -0.071 r -- which is what makes it a result about water rather than
#: noise. Spatial SD RISES, so this is not the canopy sweep's compression artefact in
#: another costume. The cause is legible: `sim-ts.ts`'s relaxation is a CLAMP at the
#: shipped dt, so a wet cell converges on `tAir - 1.5` whatever the energy balance says,
#: and that target is a daytime assumption applied at night, when water is the warmest
#: surface in the scene. Full argument in src/scripts/climate-engine/types.ts; before and
#: after in docs/heat-map-water-layer.md.
#:
#: `rasterize_ward_water` stays general and is still oracle-checked against the real
#: rasteriser, so this is reversible by one constant on the TypeScript side.
LAYER_ENABLED = False

#: Collinearity and bounds tolerance for the on-segment test, in metres. The bare
#: literal `1e-9` appears four times in `pointOnSegment`; it is one constant here so a
#: reader can see it is one decision. Do not "improve" it -- it decides whether a sample
#: sitting exactly on a shoreline counts as water, and the oracle pins that answer.
EPS_ON_SEGMENT = 1e-9


def _points_in_polygon(px: F64, py: F64, vx: F64, vy: F64) -> Mask:
    """Port of `pointInPolygon`, evaluated over a whole array of sample points.

    `px`/`py` are broadcast-compatible sample coordinates; `vx`/`vy` are the ring's
    vertices in order. Returns the inside mask, boundary INCLUSIVE.

    THE EARLY RETURN IS PRESERVED, not lost to vectorisation. The TypeScript returns
    `true` the moment `pointOnSegment` fires and never finishes the crossing parity for
    that point. Here every edge is evaluated for every point and the results combined as

        inside = any(on_segment) OR parity(all crossings)

    which is exactly equivalent: when the on-segment test fires the TS answer is `true`
    regardless of parity, and when it never fires the TS computes the full parity. The
    equivalence is not an approximation and the oracle's boundary cases check it.

    ARITHMETIC ORDER MATTERS and is transcribed literally. JavaScript evaluates
    `((bx - ax) * (y - ay)) / (by - ay) + ax` in float64; so does numpy, given the same
    parenthesisation. Rearranging it -- multiplying through, hoisting the reciprocal --
    would be algebraically identical and numerically not, and the disagreement would
    land exactly on the cells a shoreline passes through.
    """
    inside = np.zeros(np.broadcast(px, py).shape, dtype=bool)
    on_edge = np.zeros_like(inside)
    count = vx.size
    for current in range(count):
        previous = count - 1 if current == 0 else current - 1
        ax, ay = float(vx[previous]), float(vy[previous])
        bx, by = float(vx[current]), float(vy[current])

        # pointOnSegment: collinear within EPS, and inside the segment's bounding box.
        cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
        on_edge |= (
            (np.abs(cross) <= EPS_ON_SEGMENT)
            & (px >= min(ax, bx) - EPS_ON_SEGMENT) & (px <= max(ax, bx) + EPS_ON_SEGMENT)
            & (py >= min(ay, by) - EPS_ON_SEGMENT) & (py <= max(ay, by) + EPS_ON_SEGMENT)
        )

        # Crossing-number toggle. `by - ay` is zero only for a horizontal edge, and a
        # horizontal edge never satisfies `(ay > y) !== (by > y)`, so the quotient is
        # masked out wherever it is undefined -- but numpy computes the whole array
        # before masking, hence errstate rather than a branch.
        straddles = (ay > py) != (by > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            crossing = straddles & (px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
        inside ^= crossing
    return inside | on_edge


def _stamp_ring(sample_bits: npt.NDArray[np.uint8], flat: list[float], start: int,
                half: float, cell_m: float, n: int) -> None:
    """Port of `stampRing`: OR one ring's 2x2 subsamples into the shared bitfield.

    `start` is 0 for a water polygon's `p`. (The TypeScript passes 1 for a building
    row, whose leading element is the height; no Python caller needs that path, but the
    parameter is kept so the two functions read as the same function.)
    """
    xs: list[float] = []
    ys: list[float] = []
    index = start
    while index + 1 < len(flat):
        x, y = flat[index], flat[index + 1]
        if math.isfinite(x) and math.isfinite(y):
            xs.append(x)
            ys.append(y)
        index += 2
    if len(xs) < 3:
        return

    vx = np.asarray(xs, dtype=np.float64)
    vy = np.asarray(ys, dtype=np.float64)
    start_x = max(0, math.floor((min(xs) + half) / cell_m) - 1)
    end_x = min(n - 1, math.floor((max(xs) + half) / cell_m) + 1)
    start_y = max(0, math.floor((min(ys) + half) / cell_m) - 1)
    end_y = min(n - 1, math.floor((max(ys) + half) / cell_m) + 1)
    if start_x > end_x or start_y > end_y:
        return  # ring lies wholly outside the frame; the TS loops simply never run

    grid_x = np.arange(start_x, end_x + 1, dtype=np.float64)
    grid_y = np.arange(start_y, end_y + 1, dtype=np.float64)
    bit = 0
    for offset_y in SAMPLE_OFFSETS:
        sample_y = (-half + (grid_y + offset_y) * cell_m)[:, None]
        for offset_x in SAMPLE_OFFSETS:
            sample_x = (-half + (grid_x + offset_x) * cell_m)[None, :]
            hit = _points_in_polygon(sample_x, sample_y, vx, vy)
            sample_bits[start_y:end_y + 1, start_x:end_x + 1] |= hit * np.uint8(1 << bit)
            bit += 1


def rasterize_ward_water(polys: list[WaterPoly], size_m: float, n: int) -> F32:
    """Port of `rasterizeWardWater`: OSM rings -> per-cell water AREA FRACTION, SIM frame.

    Returns an (n, n) float32 array, row 0 = the ward's SOUTH edge, matching the
    TypeScript's row order. Values are quarters, because the sampling is 2x2.

    A FRACTION, NOT A MASK, and that is the contract the physics depends on: the solver
    multiplies by this number in both water terms, so a boolean would model a 12 m
    rooftop tank and a 200 m river reach as the same cell. Eighty-five per cent of these
    bodies are smaller than one ECOSTRESS pixel, so the fractions are mostly small and
    mostly what carries the signal.
    """
    if n <= 0:
        raise ValueError(f"ward raster size must be a positive integer, got {n}")
    half = size_m / 2
    cell_m = size_m / n
    sample_bits = np.zeros((n, n), dtype=np.uint8)
    for poly in polys:
        _stamp_ring(sample_bits, list(poly["p"]), 0, half, cell_m, n)
    table = np.asarray(COVERAGE_BY_BITS, dtype=np.float32)
    return table[sample_bits]


def water_north_up(polys: list[WaterPoly], size_m: float, n: int) -> F32:
    """The same coverage, re-expressed in the GEOSPATIAL north-up frame.

    Everything in the Python validation stack is north-up: the surface PNG is read
    unflipped, the ECOSTRESS target grid is north-up, and `built_layer` flips the
    TypeScript's south-up raster to join them. Water is the same layer in the same
    frame and takes the same flip, through one named conversion rather than a second
    rasteriser that happens to iterate rows the other way.
    """
    return np.flipud(rasterize_ward_water(polys, size_m, n)).copy()


def load_ward_water(ward_id: str, data_dir: str = DATA_DIR) -> list[WaterPoly]:
    """Read `{ward}-water.json`, or return no polygons if the ward ships none.

    A MISSING FILE IS NOT AN ERROR, matching the browser: `loadWard` catches the fetch
    and falls back to `{ polys: [] }`, which solves the ward as if it had no water. A
    MALFORMED file is a different matter and raises, because silently returning zero
    rings would restore the all-zero layer this module exists to end.
    """
    path = os.path.join(data_dir, f"{ward_id}-water.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        raw = cast(WaterFile, json.load(fh))
    polys = raw["polys"]
    if raw["count"] != len(polys):
        raise ValueError(f"{ward_id}-water.json says count={raw['count']} but carries "
                         f"{len(polys)} rings")
    return polys


def assert_water_port() -> None:
    """ponytail: one runnable check. Cheap invariants, no fixture, no files.

    The authoritative check is scripts/check-water-oracle.py against the real
    TypeScript. This one exists so an import-time smoke test can fail fast on the
    three things most likely to be broken by an edit here: the row flip, the area
    fraction, and the boundary-inclusive on-segment test.
    """
    # A square covering the NORTH-EAST quadrant of a 4 m ward on a 4x4 grid. Cells are
    # 1 m; the square spans x in [0,2], y in [0,2], so it fills the four cells whose
    # centres are positive in both axes -- and in the SIM frame those are the TOP rows.
    square: WaterPoly = {"k": "water", "p": [0.0, 0.0, 2.0, 0.0, 2.0, 2.0, 0.0, 2.0]}
    sim = rasterize_ward_water([square], 4.0, 4)
    assert sim.shape == (4, 4), sim.shape
    assert float(sim.sum()) == 4.0, f"a 2x2 m square in 1 m cells must cover 4.0, got {sim.sum()}"
    assert float(sim[3, 3]) == 1.0 and float(sim[0, 0]) == 0.0, "south-up rows are inverted"
    north = water_north_up([square], 4.0, 4)
    assert float(north[0, 3]) == 1.0 and float(north[3, 3]) == 0.0, "north-up flip is wrong"

    # Boundary inclusivity: a ring whose edge passes exactly through the subsample
    # points. Cell 0's subsamples sit at x = -1.75 and -1.25; an edge at x = -1.25
    # must count as inside, which is the `pointOnSegment` early return.
    edge: WaterPoly = {"k": "water", "p": [-2.0, -2.0, -1.25, -2.0, -1.25, 2.0, -2.0, 2.0]}
    on = rasterize_ward_water([edge], 4.0, 4)
    assert float(on[0, 0]) == 1.0, f"samples on the shoreline must count as water, got {on[0, 0]}"

    # Overlapping rings OR rather than sum: coverage is bounded by 1.
    twice = rasterize_ward_water([square, square], 4.0, 4)
    assert float(twice.max()) == 1.0 and float(twice.sum()) == 4.0, "overlaps double-counted"

    # Degenerate and out-of-frame rings contribute nothing.
    thin: WaterPoly = {"k": "water", "p": [0.0, 0.0, 1.0, 1.0]}
    far: WaterPoly = {"k": "water", "p": [900.0, 900.0, 950.0, 900.0, 950.0, 950.0]}
    assert float(rasterize_ward_water([thin, far], 4.0, 4).sum()) == 0.0

    print("  _water.py: row order, area fraction, shoreline inclusion, overlap, "
          "degenerate rings — all as the TypeScript")


def _cli() -> None:
    assert_water_port()
    import _types
    for wid, ward in _types.WARDS.items():
        polys = load_ward_water(wid)
        cov = rasterize_ward_water(polys, float(ward.footprint_m), 192)
        touched = int((cov > 0).sum())
        print(f"  {wid:<13} {len(polys):>3} rings · mean fraction {cov.mean():.5f} "
              f"· {touched} of {cov.size} cells wet ({100 * touched / cov.size:.2f}%)")


if __name__ == "__main__":
    _cli()
