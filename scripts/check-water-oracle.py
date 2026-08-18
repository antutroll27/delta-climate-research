#!/usr/bin/env python3
"""Verify the Python water port still matches the shipped TypeScript.

`dump-water-oracle.mjs` runs the REAL browser function -- `rasterizeWardWater` -- on
fixed synthetic rings and on the three shipped `{ward}-water.json` artefacts, and
freezes the answers in tests/fixtures/water-oracle/oracle.json. This is the other half:
it runs scripts/_water.py against that fixture and fails if they disagree.

WHY IT IS WIRED INTO `npm run test:py` RATHER THAN RUN ON REQUEST. This rasteriser
exists in two languages, which is the shape of defect docs/evidence/known-limitations.md
sec.1 records: one operator, two implementations, no comparison, months of a validation
stack scoring a field that never shipped. Adding a second implementation and then relying
on someone to remember a manual command would re-open that hole one level down.

AND IT MATTERS EVEN THOUGH THE LAYER IS CURRENTLY GATED OFF (sec.6). `check_shipped_
enabled` below is what makes the gate real: it fails if the browser and the laboratory
ever disagree about whether water is in the solve, which is the one way a future
re-enable could quietly become another unmeasured change.

DIRECTION. TypeScript is the oracle. If this fails, the presumption is that the PYTHON
is wrong. Regenerating the fixture to make the check pass is only correct when the
browser behaviour changed deliberately -- or when the water artefacts were re-fetched,
which moves the `wards` section and nothing else, and is a change to the ward rather
than to the code.

WHAT IS COVERED. The synthetic cases pin the arithmetic branch by branch: the
on-segment EPS that decides whether a shoreline sample is water, the zero denominator a
horizontal edge puts in the crossing test, concave parity, OR-not-sum on overlaps,
clamping for rings that run past the frame, the three ways a ring can be malformed, both
spellings of no-water-at-all, and a grid whose cells are not a whole number of metres.

The `wards` section covers what synthetic rings cannot: the 86 real OSM rings, at both
grids the laboratory uses. It compares ROW AND COLUMN MARGINALS rather than the fields
-- a flip reverses one, a transpose swaps them, an offset shifts them, a scale error
rescales them, and the fixture stays a twentieth of the size.

Run:  python3 scripts/check-water-oracle.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, cast

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _water import (  # noqa: E402
    LAYER_ENABLED, WaterPoly, load_ward_water, rasterize_ward_water,
)

ORACLE = os.path.join(ROOT, "tests", "fixtures", "water-oracle", "oracle.json")


#: Area-fraction tolerance. NOT bit-exact, deliberately, for the reason
#: scripts/check-geo-oracle.py records at length: an identical call gave
#: 2473252.5413628076 on macOS and 2473252.541362808 on the Linux runner, and the gate
#: failed for something that had nothing to do with the pipeline. The hazard here is
#: narrower -- the coverage values come out of a 16-entry lookup table, so they are
#: exact quarters and should agree to the bit -- but the SAMPLE COORDINATES that select
#: the table entry are `-half + (grid + offset) * cellM`, and a sample sitting within an
#: ulp of a shoreline is decided by the last place of that expression.
#:
#: 1e-6 in a quantity bounded to [0,1] is ~16 float32 ulps near 1. Anything this misses
#: is a single subsample flipping on one cell out of 36,864; anything that matters is a
#: quarter, 250,000x larger, and still fails loudly.
EPS_FRACTION = 1e-6

#: Marginals are sums of up to 192 fractions, so they carry the accumulated summation
#: difference rather than a single rounding. Still ~7 orders below the ~0.25 a single
#: misplaced subsample would move a row by.
EPS_MARGINAL = 1e-9


def _coord(value: float | str) -> float:
    """One ring coordinate out of the fixture, non-finite values included.

    JSON cannot carry NaN and `JSON.stringify` writes `null` for one, which would erase
    the distinction the malformed-ring case exists to test. The dump therefore writes
    non-finite coordinates as strings (see the fixture's `nonFiniteEncoding`); `float()`
    parses all three spellings back, so this is a decode, not a special case.
    """
    return float(value)


def _worst(got: np.ndarray[Any, Any], want: list[float]) -> float:
    """Largest elementwise disagreement, or inf when the shapes already differ."""
    flat = np.asarray(got, dtype=np.float64).ravel()
    ref = np.asarray(want, dtype=np.float64)
    if flat.size != ref.size:
        return float("inf")
    return float(np.max(np.abs(flat - ref))) if ref.size else 0.0


def check_synthetic(oracle: dict[str, Any], failures: list[str]) -> int:
    """rasterizeWardWater on fixed rings: every branch of the point-in-polygon test."""
    cases = cast(dict[str, Any], oracle["rasterizeWardWater"])
    print("\n  rasterizeWardWater — 2x2 supersampled rings -> per-cell area fraction")
    for name, case in sorted(cases.items()):
        raw = case["polys"]
        # `null` is a ward whose artefact failed to load. The TypeScript takes
        # `WaterData | null`; the Python takes the ring list the loader already
        # unwrapped, so the faithful equivalent of null is the empty list -- and
        # `load_ward_water` is what produces it, from a missing file.
        polys: list[WaterPoly] = [] if raw is None else [
            {"k": str(p["k"]), "p": [_coord(v) for v in p["p"]]} for p in raw
        ]
        got = rasterize_ward_water(polys, float(case["sizeM"]), int(case["n"]))
        worst = _worst(got, case["out"])
        ok = worst <= EPS_FRACTION

        # Totals, recomputed rather than trusted. A port that agreed elementwise but
        # counted wet cells differently would mean the two disagree about what zero is.
        wet = int((np.asarray(got) > 0).sum())
        area = float(np.asarray(got, dtype=np.float64).sum())
        if wet != int(case["wet"]) or abs(area - float(case["sum"])) > EPS_MARGINAL:
            ok = False
            failures.append(f"rasterizeWardWater[{name}]: wet {wet} / area {area:.4f} vs "
                            f"oracle {case['wet']} / {float(case['sum']):.4f}")

        print(f"    {'ok  ' if ok else 'FAIL'} {name:<30} {case['n']}²"
              f"  wet {wet:>4}  area {area:>7.2f}  worst {worst:.2e}")
        if worst > EPS_FRACTION:
            failures.append(f"rasterizeWardWater[{name}]: worst disagreement {worst:.3e} "
                            f"> {EPS_FRACTION:.0e} — {case['why']}")
    return len(cases)


def check_shipped_enabled(oracle: dict[str, Any], failures: list[str]) -> None:
    """The one thing the elementwise cases cannot check: whether the layer SHIPS.

    `shippedEnabled` is WATER_LAYER_ENABLED imported straight from types.ts by
    dump-water-oracle.mjs -- so this compares the laboratory's constant against the
    instrument's, not against a second hand-copied literal. Exact equality, no tolerance:
    these are two spellings of one decision.

    It is currently FALSE. The rasteriser is real, ported and pinned; the layer it builds
    does not enter the temperature solve, because the measurement said it should not. See
    _water.LAYER_ENABLED for the numbers.
    """
    shipped = bool(oracle["shippedEnabled"])
    agrees = LAYER_ENABLED == shipped
    print("\n  shipped gate — types.ts WATER_LAYER_ENABLED vs _water.LAYER_ENABLED")
    print(f"    {'ok  ' if agrees else 'FAIL'} {'parity':<30} TS {shipped}  ·  Python {LAYER_ENABLED}"
          f"{'   (water rasterised, NOT in the solve)' if agrees and not shipped else ''}")
    if not agrees:
        failures.append(
            f"shipped gate: types.ts ships {shipped} but scripts/_water.py's LAYER_ENABLED "
            f"is {LAYER_ENABLED}. The validation would score a water layer the browser does "
            f"not apply — the exact defect known-limitations.md sec.1 records, one layer "
            f"over. TypeScript is the oracle: change WATER_LAYER_ENABLED, re-run "
            f"`node --import tsx scripts/dump-water-oracle.mjs`, then follow here.")


def check_wards(oracle: dict[str, Any], failures: list[str]) -> int:
    """The real artefacts, at both grids, by row and column marginals."""
    wards = cast(dict[str, Any], oracle["wards"])
    print("\n  shipped wards — the 86 real OSM rings, row/column marginals at both grids")
    for ward, case in sorted(wards.items()):
        polys = load_ward_water(ward)
        if len(polys) != int(case["rings"]):
            failures.append(f"{ward}: the artefact now carries {len(polys)} rings, the "
                            f"oracle was frozen at {case['rings']} — re-fetching water is "
                            f"a legitimate reason, so regenerate the fixture and review "
                            f"the diff as a change to the ward")
            print(f"    FAIL {ward:<30} {len(polys)} rings vs oracle {case['rings']}")
            continue
        for grid, expect in sorted(cast(dict[str, Any], case["grids"]).items(),
                                   key=lambda kv: int(kv[0])):
            n = int(grid)
            got = rasterize_ward_water(polys, float(case["sizeM"]), n)
            rows = got.astype(np.float64).sum(axis=1)
            cols = got.astype(np.float64).sum(axis=0)
            worst = max(_worst(rows, expect["rowSums"]), _worst(cols, expect["colSums"]))
            wet = int((got > 0).sum())
            ok = worst <= EPS_MARGINAL and wet == int(expect["wet"])
            if not ok:
                failures.append(f"{ward} at {n}²: marginals disagree by {worst:.3e} "
                                f"(wet {wet} vs {expect['wet']}) — a flip, a transpose, a "
                                f"half-cell offset or a scale error all look like this")
            print(f"    {'ok  ' if ok else 'FAIL'} {ward:<24} {n:>4}²  wet {wet:>5}"
                  f"  mean fraction {float(expect['sum']) / (n * n):.5f}"
                  f"  worst {worst:.2e}")
    return len(wards)


def main() -> int:
    if not os.path.exists(ORACLE):
        print(f"  {os.path.relpath(ORACLE, ROOT)} is missing — regenerate it with "
              f"`node --import tsx scripts/dump-water-oracle.mjs`")
        return 1
    with open(ORACLE, encoding="utf-8") as fh:
        oracle = cast(dict[str, Any], json.load(fh))

    print(f"  oracle {os.path.relpath(ORACLE, ROOT)} · sim grid {oracle['simGrid']} "
          f"· surface grid {oracle['surfaceGrid']}")

    failures: list[str] = []
    check_shipped_enabled(oracle, failures)
    n = check_synthetic(oracle, failures) + check_wards(oracle, failures)

    if failures:
        print(f"\n  {len(failures)} MISMATCH — scripts/_water.py no longer reproduces the "
              f"shipped TypeScript:")
        for f in failures:
            print(f"    · {f}")
        print("\n  The TypeScript is the oracle. Fix the Python. Regenerate the fixture with "
              "`node --import tsx scripts/dump-water-oracle.mjs` ONLY if the browser "
              "behaviour changed on purpose, or the water artefacts were re-fetched — and "
              "review that diff as a change to what the solver treats as water.")
        return 1
    print(f"\n  {n} cases match to {EPS_FRACTION:.0e} area fraction — the Python port is "
          f"the shipped water rasteriser")
    return 0


if __name__ == "__main__":
    sys.exit(main())
