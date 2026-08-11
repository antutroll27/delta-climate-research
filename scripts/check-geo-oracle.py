#!/usr/bin/env python3
"""Verify the live geo pipeline still matches the frozen parity oracle.

`dump-parity-oracle.py` WRITES tests/fixtures/geo-oracle/oracle.json. Nothing
READ it. The fixture has been the stated gate on changing `target_grid` since it
was created -- "Kolkata's grid must stay byte-identical" -- but that gate was a
sentence in a spec, not a command anyone could run.

This is the command. It exists because Track A (deriving TARGET_CRS per city
instead of hardcoding UTM 45N) is about to change exactly the primitive the
oracle pins, and the failure mode there is silent: a shifted grid or a
mis-scaled temperature does not crash, it lands in published science.

WHAT IS AND IS NOT COVERED. `targetGrid` and `transformBounds` are checked, both
EXACTLY -- these are pure coordinate maths and there is no tolerance to argue
about. The `align` cases are NOT: they need the .bin rasters and a full rasterio
reprojection, which is a heavier check belonging to the Go port itself. Stated
here rather than left for someone to discover.

Run:  python3 scripts/check-geo-oracle.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, cast

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _ecostress import Bbox, TARGET_CRS, TARGET_RES, target_grid, transform_bounds  # noqa: E402

ORACLE = os.path.join(ROOT, "tests", "fixtures", "geo-oracle", "oracle.json")


def main() -> int:
    with open(ORACLE, encoding="utf-8") as fh:
        oracle = cast(dict[str, Any], json.load(fh))

    failures: list[str] = []

    # The oracle is only meaningful against the CRS and resolution it was frozen
    # at. A change here is legitimate during Track A, but it invalidates every
    # case below, so it must be loud rather than producing a wall of diffs.
    if oracle["targetCrs"] != TARGET_CRS:
        failures.append(f"targetCrs: oracle {oracle['targetCrs']} != live {TARGET_CRS} "
                        f"— regenerate the oracle and review the diff as a change "
                        f"to published science")
    if float(oracle["targetRes"]) != TARGET_RES:
        failures.append(f"targetRes: oracle {oracle['targetRes']} != live {TARGET_RES}")

    print(f"  oracle {os.path.relpath(ORACLE, ROOT)} · {TARGET_CRS} @ {TARGET_RES} m")

    print(f"\n  targetGrid — width, height and all six affine terms, exactly")
    for name, case in sorted(oracle["targetGrid"].items()):
        bbox = cast(Bbox, tuple(case["bbox4326"]))
        tf, w, h = target_grid(bbox)
        got = [tf.a, tf.b, tf.c, tf.d, tf.e, tf.f]
        ok = w == case["width"] and h == case["height"] and got == case["transform"]
        print(f"    {'ok  ' if ok else 'FAIL'} {name:<22} {w}x{h}")
        if not ok:
            failures.append(f"targetGrid[{name}]: {w}x{h} vs oracle "
                            f"{case['width']}x{case['height']}; transform {got} "
                            f"vs {case['transform']}")

    print(f"\n  transformBounds — the densify_pts=21 curve, exactly")
    for name, case in sorted(oracle["transformBounds"].items()):
        bounds = cast(Bbox, tuple(case["bounds4326"]))
        got_b = list(transform_bounds(case["src"], case["dst"], *bounds, densify_pts=21))
        ok = got_b == case["densify21"]
        # naive four-corner must still DIFFER where the oracle says it does, or the
        # densification has quietly stopped happening and nothing else would notice.
        delta = case.get("densifyDeltaM") or [0.0] * 4
        expects_delta = any(d != 0.0 for d in delta)
        print(f"    {'ok  ' if ok else 'FAIL'} {name:<22}"
              f"{'  (densification observable here)' if expects_delta else ''}")
        if not ok:
            failures.append(f"transformBounds[{name}]: {got_b} vs {case['densify21']}")

    if failures:
        print(f"\n  {len(failures)} MISMATCH — the geo pipeline has changed:")
        for f in failures:
            print(f"    · {f}")
        print("\n  If the change is intended, regenerate with "
              "scripts/dump-parity-oracle.py and review the diff.")
        return 1
    n = len(oracle["targetGrid"]) + len(oracle["transformBounds"])
    print(f"\n  {n} cases byte-identical — geo pipeline unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
