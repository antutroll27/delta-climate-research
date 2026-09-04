"""Hold-out test for the fitted height prior, plus the trap that invalidated the first one.

THE FIRST VERSION OF THIS TEST SCORED 100 % AND MEANT NOTHING. It held out all
"measured" heights -- but 76-81 % of those are `building:levels x 4.0`, and 57 %
of Dubai South is the single value 8.0 m. Predicting 8.0 scores perfectly on a
distribution that is a spike at 8.0, and proves nothing at all.

So the ground truth here is ONLY the genuine `height=` tags, identified by not
being an exact multiple of 4.0. That heuristic is imperfect -- a real 20 m
building tagged `height=20` is excluded -- but it errs toward a HARDER test,
which is the right direction for a check whose whole job is to stop a false
claim about accuracy.

    python3 scripts/check-height-prior.py
"""
from __future__ import annotations

import json
import math
import os
import random
import statistics
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
SITES = ("dubai-creek", "dubai-south")
MIN_AREA = 5000.0

sys.path.insert(0, HERE)
from _flood import ring_area  # noqa: E402


def global_prior(area: float) -> float:
    """The curve blender_dubai.py uses below the table's threshold."""
    return max(3.0, min(60.0, 3.0 + 9.0 * math.log10(1.0 + area / 100.0)))


def levels_derived(h: float) -> bool:
    return abs(h / 4.0 - round(h / 4.0)) < 1e-6


def fitted(table: dict[str, Any], area: float) -> float:
    """Mirror of estimate_height's table lookup, jitter aside."""
    if area >= float(table.get("minArea", MIN_AREA)):
        best: float | None = None
        for band in table.get("bands", []):
            if area >= float(band["minArea"]) and band.get("medianM") is not None:
                best = float(band["medianM"])
        if best is not None:
            return best
    return global_prior(area)


def main() -> int:
    failures: list[str] = []
    for sid in SITES:
        path = os.path.join(DATA, f"{sid}-buildings.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        table = doc.get("heightTable")
        if not table:
            # A site without a table is not a failure. The Creek deliberately has
            # none: the fitted prior wins it +1 %, and regenerating it to add one
            # would drag in ten days of unreviewed OSM edits to its footprints.
            print(f"  skip {sid}: no heightTable — using the global curve")
            continue

        obs = [(ring_area(r["p"]), float(r["h"])) for r in doc["osmB"]
               if r.get("h") and ring_area(r["p"]) >= MIN_AREA
               and 1.5 <= float(r["h"]) <= 900.0]
        truth = [t for t in obs if not levels_derived(t[1])]
        if len(truth) < 20:
            print(f"  skip {sid}: only {len(truth)} genuine height tags over "
                  f"{MIN_AREA:.0f} m2 — too few to test")
        else:
            random.seed(7)
            random.shuffle(truth)
            test = truth[int(len(truth) * 0.7):]
            g = statistics.mean(abs(global_prior(a) - h) for a, h in test)
            f = statistics.mean(abs(fitted(table, a) - h) for a, h in test)
            print(f"  {sid}: n={len(test):3d}  global {g:6.2f} m -> fitted {f:6.2f} m  "
                  f"({'better' if f <= g else 'WORSE'})")
            if f > g:
                failures.append(f"{sid}: the fitted prior is worse than the global curve")

        # BELOW the threshold the prior must be untouched, exactly. A table that
        # leaked downward would make small buildings worse, which is the half of
        # the measurement that said not to apply it there.
        for area in (100.0, 900.0, 4999.0):
            if abs(fitted(table, area) - global_prior(area)) > 1e-9:
                failures.append(f"{sid}: the table leaked below {MIN_AREA:.0f} m2 at {area:.0f}")

        # A thin band falls back to the nearest populated band BELOW, never to the
        # global curve -- that would undo the fix exactly where footprints are
        # largest and the curve is most wrong.
        for band in table["bands"]:
            if band.get("medianM") is not None:
                continue
            a = float(band["minArea"]) * 1.5
            if abs(fitted(table, a) - global_prior(a)) < 1e-9:
                failures.append(f"{sid}: thin band at {band['minArea']:.0f} m2 fell back to "
                                f"the global curve instead of the band below it")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    print("  height prior: fitted beats global above the threshold, and is inert below it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
