#!/usr/bin/env python3
"""Verify the Python canopy port still matches the shipped TypeScript.

`dump-canopy-oracle.mjs` runs the REAL browser functions -- `blendCanopyIntoVeg`,
`canopyHeightsFromPixels`, `resample` -- on fixed synthetic inputs and freezes the
answers in tests/fixtures/canopy-oracle/oracle.json. This is the other half: it runs
scripts/_canopy.py against that fixture and fails if they disagree.

WHY IT IS WIRED INTO `npm run test:py` RATHER THAN RUN ON REQUEST. The defect this
whole change closes (docs/evidence/known-limitations.md sec.1) was a silent divergence
between the render path and the validation path at exactly one function. It was
invisible for months because nothing compared them. Re-introducing that shape of
bug and relying on someone to remember a manual command would be the same mistake
with extra steps.

DIRECTION. TypeScript is the oracle. If this fails, the presumption is that the
PYTHON is wrong. Regenerating the fixture to make the check pass is only correct
when the browser behaviour changed deliberately -- and then the fixture diff is a
change to what the map draws and must be reviewed as one.

WHAT IS COVERED. Every branch of the blend, not just the happy path: the length
mismatch, `cSum <= 0` reached two different ways, and both [0,1] clamps in both
passes. The clamp cases additionally assert that they still BITE -- a clamp case
that quietly stopped clamping would keep passing while testing nothing.

Run:  python3 scripts/check-canopy-oracle.py
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

from _canopy import (  # noqa: E402
    blend_canopy_into_veg, canopy_heights_from_pixels, resample_bilinear,
)

ORACLE = os.path.join(ROOT, "tests", "fixtures", "canopy-oracle", "oracle.json")


#: Vegetation fraction tolerance. NOT bit-exact, deliberately: scripts/check-geo-oracle.py
#: records what bit-exact costs -- an identical call gave 2473252.5413628076 on macOS and
#: 2473252.541362808 on the Linux runner, and the gate failed for a reason that had nothing
#: to do with the pipeline. The same hazard is here in a different form: JavaScript sums a
#: Float32Array element by element, numpy sums it pairwise, and the two disagree in the last
#: places of the float64 accumulator that feeds `vMean`, `cMean` and `delta`.
#:
#: 1e-6 in a quantity bounded to [0,1] is ~16 float32 ulps near 1, which absorbs that, while
#: sitting ~4000x below the 1/255 = 3.9e-3 quantisation step of the PNG the field is decoded
#: from. Any disagreement this misses is smaller than one bit of the source data; any
#: disagreement that matters is orders of magnitude larger and still fails loudly.
EPS_VEG = 1e-6

#: Canopy height tolerance, in metres. Same argument scaled to a 0..30 m quantity: 1e-5 m
#: is 10 microns against a 30/255 = 0.118 m quantisation step.
EPS_M = 1e-5

#: Diagnostics (mean shift) are float64 reductions over the whole field, so they carry the
#: accumulated summation difference rather than a single rounding. Still ~5 orders below the
#: 1.9e-2 shift the clamp cases actually produce.
EPS_DIAG = 1e-9


def _worst(got: np.ndarray[Any, Any], want: list[float]) -> float:
    """Largest elementwise disagreement, or inf when the shapes already differ."""
    flat = np.asarray(got, dtype=np.float64).ravel()
    ref = np.asarray(want, dtype=np.float64)
    if flat.size != ref.size:
        return float("inf")
    return float(np.max(np.abs(flat - ref))) if ref.size else 0.0


def check_decode(oracle: dict[str, Any], failures: list[str]) -> int:
    """canopyHeightsFromPixels: the R-channel dequantisation and the N->S row flip."""
    cases = cast(dict[str, Any], oracle["canopyHeightsFromPixels"])
    print("\n  canopyHeightsFromPixels — R channel / 255 x hi, north-up PNG -> south-up grid")
    for name, case in sorted(cases.items()):
        data = np.asarray(case["rgba"], dtype=np.uint8)
        got = canopy_heights_from_pixels(data, int(case["n"]), float(case["hi"]))
        worst = _worst(got, case["heights"])
        ok = worst <= EPS_M
        print(f"    {'ok  ' if ok else 'FAIL'} {name:<22} {case['n']}x{case['n']}  worst {worst:.2e} m")
        if not ok:
            failures.append(f"canopyHeightsFromPixels[{name}]: worst disagreement {worst:.3e} m "
                            f"> {EPS_M:.0e} m")
    return len(cases)


def check_resample(oracle: dict[str, Any], failures: list[str]) -> int:
    """resample: the bilinear upsample that puts the canopy on the browser's 192 grid."""
    cases = cast(dict[str, Any], oracle["resample"])
    print("\n  resample — bilinear, (sourceN-1)/(targetN-1) scale")
    for name, case in sorted(cases.items()):
        src = np.asarray(case["source"], dtype=np.float32)
        got = resample_bilinear(src, int(case["sourceN"]), int(case["targetN"]))
        worst = _worst(got, case["out"])
        ok = worst <= EPS_VEG
        print(f"    {'ok  ' if ok else 'FAIL'} {name:<22} {case['sourceN']}->{case['targetN']}"
              f"  worst {worst:.2e}")
        if not ok:
            failures.append(f"resample[{name}]: worst disagreement {worst:.3e} > {EPS_VEG:.0e}")
    return len(cases)


def check_blend(oracle: dict[str, Any], failures: list[str]) -> int:
    """blendCanopyIntoVeg: every exit, both clamps, and the mean shift each produces."""
    cases = cast(dict[str, Any], oracle["blendCanopyIntoVeg"])
    print("\n  blendCanopyIntoVeg — all four exits, both [0,1] clamps")
    for name, case in sorted(cases.items()):
        veg = np.asarray(case["veg"], dtype=np.float32)
        canopy = np.asarray(case["canopy"], dtype=np.float32)
        got = blend_canopy_into_veg(veg, canopy, float(case["strength"]))
        worst = _worst(got, case["out"])
        ok = worst <= EPS_VEG

        # The early exits return the CALLER'S array in the TypeScript. A port that
        # returned a copy would still match elementwise, and would then diverge the
        # first time a caller relied on the aliasing. Checked, not assumed.
        want_input = bool(case["returnsInput"])
        is_input = got is veg
        if want_input != is_input:
            ok = False
            failures.append(f"blendCanopyIntoVeg[{name}]: returnsInput is {is_input}, "
                            f"oracle says {want_input}")

        # Mean shift, and the assertion that the clamp cases still bite. A clamp case
        # whose clamps stopped firing is a test that passes while testing nothing.
        diag = cast(dict[str, Any], case["diagnostics"])
        shift = float(np.asarray(got, np.float64).mean() - np.asarray(veg, np.float64).mean())
        if abs(shift - float(diag["meanShift"])) > EPS_DIAG:
            ok = False
            failures.append(f"blendCanopyIntoVeg[{name}]: mean shift {shift:.3e} vs oracle "
                            f"{float(diag['meanShift']):.3e}")
        clamped = int(diag["clampedHigh"]) + int(diag["clampedLow"])
        if "clamp" in name and clamped == 0:
            ok = False
            failures.append(f"blendCanopyIntoVeg[{name}]: named a clamp case but the oracle "
                            f"records zero clamped cells — the case no longer tests the clamp")

        print(f"    {'ok  ' if ok else 'FAIL'} {name:<22} n={case['n']:<4} s={case['strength']:<4}"
              f" worst {worst:.2e}  meanShift {shift:+.2e}"
              f"  clamped {diag['clampedHigh']}hi/{diag['clampedLow']}lo"
              f"{'  (early return)' if want_input else ''}")
        if worst > EPS_VEG:
            failures.append(f"blendCanopyIntoVeg[{name}]: worst disagreement {worst:.3e} "
                            f"> {EPS_VEG:.0e} — {case['why']}")
    return len(cases)


def main() -> int:
    if not os.path.exists(ORACLE):
        print(f"  {os.path.relpath(ORACLE, ROOT)} is missing — regenerate it with "
              f"`node --import tsx scripts/dump-canopy-oracle.mjs`")
        return 1
    with open(ORACLE, encoding="utf-8") as fh:
        oracle = cast(dict[str, Any], json.load(fh))

    print(f"  oracle {os.path.relpath(ORACLE, ROOT)} · canopyHi {oracle['canopyHi']} m "
          f"· shipped strength {oracle['shippedStrength']}")

    failures: list[str] = []
    n = (check_decode(oracle, failures)
         + check_resample(oracle, failures)
         + check_blend(oracle, failures))

    if failures:
        print(f"\n  {len(failures)} MISMATCH — scripts/_canopy.py no longer reproduces the "
              f"shipped TypeScript:")
        for f in failures:
            print(f"    · {f}")
        print("\n  The TypeScript is the oracle. Fix the Python. Regenerate the fixture with "
              "`node --import tsx scripts/dump-canopy-oracle.mjs` ONLY if the browser "
              "behaviour changed on purpose, and review that diff as a change to what the "
              "map draws.")
        return 1
    print(f"\n  {n} cases match to {EPS_VEG:.0e} veg / {EPS_M:.0e} m — the Python port is "
          f"the shipped canopy path")
    return 0


if __name__ == "__main__":
    sys.exit(main())
