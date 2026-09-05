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
from _flood import ring_area, ring_centroid  # noqa: E402


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


def grid_lookup(grid: dict[str, Any], index: dict[tuple[int, int, int], float],
                x: float, y: float, area: float) -> float | None:
    """Mirror of estimate_height's grid lookup. Widens by band, then by space."""
    if not index:
        return None
    cell = float(grid.get("cellM", 600.0))
    edges = [float(e) for e in (grid.get("bandEdges") or [500.0, 2000.0, 5000.0])]
    band = len(edges)
    for i, edge in enumerate(edges):
        if area < edge:
            band = i
            break
    gx, gy = int(x // cell), int(y // cell)
    for rad in (0, 1, 2, 3):
        same = sorted(index[(i, j, band)]
                      for i in range(gx - rad, gx + rad + 1)
                      for j in range(gy - rad, gy + rad + 1)
                      if (i, j, band) in index)
        if same:
            return same[len(same) // 2]
        anyb = sorted(index[(i, j, b)]
                      for i in range(gx - rad, gx + rad + 1)
                      for j in range(gy - rad, gy + rad + 1)
                      for b in range(len(edges) + 1) if (i, j, b) in index)
        if anyb:
            return anyb[len(anyb) // 2]
    return None


def check_grid(sid: str, doc: dict[str, Any]) -> list[str]:
    """Hold out the spatial grid the same way, and pin where it must NOT apply.

    THE GRID IS BUILT FROM EVERY MEASURED BUILDING, so a held-out building's own
    cell contains it and this understates the error. That is acceptable for a
    REGRESSION gate -- it compares two predictors on identical terms and catches
    the grid going wrong -- but it is not an accuracy estimate, and the honest
    numbers came from a proper hold-out during development: 20.76 m -> 11.58 m.
    """
    failures: list[str] = []
    grid = doc.get("heightGrid")
    if not grid:
        print(f"  skip {sid}: no heightGrid")
        return failures
    index = {(int(r[0]), int(r[1]), int(r[2])): float(r[3]) for r in grid.get("cells", [])}
    maxa = float(grid.get("maxArea", MIN_AREA))

    test = []
    for rec in doc["osmB"]:
        h = rec.get("h")
        if not h or levels_derived(float(h)):
            continue
        a = ring_area(rec["p"])
        if not (50.0 <= a < maxa) or not 1.5 <= float(h) <= 900.0:
            continue
        x, y = ring_centroid(rec["p"])
        test.append((x, y, a, float(h)))
    if len(test) < 50:
        print(f"  skip {sid}: only {len(test)} genuine tags below {maxa:.0f} m2")
        return failures

    g = statistics.mean(abs(global_prior(a) - h) for _, _, a, h in test)
    sp = statistics.mean(
        abs((grid_lookup(grid, index, x, y, a) or global_prior(a)) - h)
        for x, y, a, h in test)
    print(f"  {sid} grid: n={len(test):4d}  global {g:6.2f} m -> spatial {sp:6.2f} m  "
          f"({'better' if sp <= g else 'WORSE'})")
    if sp > g:
        failures.append(f"{sid}: the spatial grid is worse than the global curve")

    # THE TWO PRIORS MUST TILE THE RANGE WITH NO GAP AND NO OVERLAP. The grid is
    # consulted below maxArea and the fitted table at or above minArea; if those
    # ever drift apart, footprints in between silently fall through to the global
    # curve that both exist to replace, and nothing else would notice.
    table = doc.get("heightTable") or {}
    if table:
        table_min = float(table.get("minArea", 0.0))
        if abs(maxa - table_min) > 1e-9:
            failures.append(f"{sid}: heightGrid.maxArea {maxa:.0f} != heightTable.minArea "
                            f"{table_min:.0f} -- footprints between them fall through")
    return failures


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

        failures.extend(check_grid(sid, doc))

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    print("  height prior: spatial wins below the cut-off, the fitted table above it, "
          "and neither leaks into the other")
    return 0


if __name__ == "__main__":
    sys.exit(main())
