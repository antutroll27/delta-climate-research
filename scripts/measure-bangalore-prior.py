"""Does a neighbourhood height prior beat Google's zonal p65 in Bengaluru?

WHY THIS IS A QUESTION AND NOT A PLAN. The spatial prior is the single biggest
accuracy win in this project's history: on Dubai it halved mean absolute error
over 152,942 buildings, 20.76 m -> 11.58 m. But Dubai and Bengaluru are not in
the same situation, and copying the method without re-testing it would be the
mistake this repo keeps writing down.

    Dubai:     87 % of outlines had NO measured height at all. The prior filled
               a void, and anything beats nothing.
    Bengaluru: EVERY building already carries a Google 2.5D height. The prior
               has to beat a real estimator, not an absence.

So this script measures rather than assumes, and it ships nothing. It answers
one question -- on buildings held out of the fit, is a neighbourhood prior
closer to the truth than Google? -- and prints the answer either way.

    python3 scripts/measure-bangalore-prior.py

TWO TRUTH SETS, BECAUSE ONE OF THEM IS A TRAP. Dubai's first hold-out scored
100 % and was worthless: it tested against heights that were 76-81 % storey-
derived, and 57 % of them were the single value 8.0 m, so predicting 8.0 was
perfect and proved nothing.

  A) STOREY-DERIVED (n is large). `building:levels` x the fitted 3.33 m. The
     storey COUNT is a genuine survey observation, and unlike Dubai's these are
     not a spike -- the distribution is checked and printed below before any
     result is believed.
  B) STATED HEIGHTS (n is small, and pure). OSM `height` tags: someone wrote a
     number in metres. Thin, but it is the only truth here that is not derived.

A prior that wins on both is worth shipping. A prior that wins only on (A) is
probably learning the survey's own habits, and is reported as such.
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)

#: Prior cell size. Dubai used 600 m over a much larger window; a 2.8 km ward
#: holds only 4x4 of those. 400 m gives 7x7 = 49 cells per ward, which is the
#: most spatial resolution the sample can carry without most cells being empty.
CELL_M = 400.0

#: Footprint area bands, m2. A 60 m2 shop and a 6,000 m2 mall in the same
#: 400 m cell are not the same prediction problem, and Dubai's prior banded for
#: exactly this reason.
BANDS = [0.0, 120.0, 400.0, 1500.0, 5000.0]

#: Share of the truth set used to FIT. The rest is never seen by the fit.
FIT_FRACTION = 0.70


def band_of(area: float) -> int:
    b = 0
    for i, edge in enumerate(BANDS):
        if area >= edge:
            b = i
    return b


def split_hash(gers: str) -> float:
    """Deterministic [0,1) from the building's own id.

    NOT `random`: the split must be identical on every run and on any machine,
    or two runs of this script are not comparable and the result is noise.
    """
    z = 0
    for ch in gers:
        z = (z * 1099511628211 + ord(ch)) & 0xFFFFFFFFFFFFFFFF
    z ^= z >> 33
    z = (z * 0xFF51AFD7ED558CCD) & 0xFFFFFFFFFFFFFFFF
    z ^= z >> 33
    return (z >> 11) / 2**53


class Row:
    __slots__ = ("x", "y", "area", "truth", "google", "kind")

    def __init__(self, x: float, y: float, area: float, truth: float,
                 google: float, kind: str) -> None:
        self.x, self.y, self.area = x, y, area
        self.truth, self.google, self.kind = truth, google, kind


def load_rows() -> list[Row]:
    rows: list[Row] = []
    for wid in blr.WARDS:
        path = os.path.join(blr.DATA, f"{wid}-buildings.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        for b in doc["b"]:
            src = str(b.get("hSource", ""))
            if src not in ("osm-height", "osm-levels"):
                continue
            g = b.get("hGoogle")
            if g is None or float(g) <= 0.0:
                continue                     # no Google estimate to compare against
            cx, cy = blr.ring_centroid(b["p"])
            rows.append(Row(cx, cy, blr.ring_area(b["p"]), float(b["h"]),
                            float(g), "stated" if src == "osm-height" else "storey"))
    return rows


def fit_prior(fit: list[Row]) -> dict[tuple[int, int, int], float]:
    cells: dict[tuple[int, int, int], list[float]] = {}
    for r in fit:
        key = (int(r.x // CELL_M), int(r.y // CELL_M), band_of(r.area))
        cells.setdefault(key, []).append(r.truth)
    return {k: statistics.median(v) for k, v in cells.items() if len(v) >= 3}


def predict(prior: dict[tuple[int, int, int], float], r: Row,
            fallback: float) -> float:
    """The prior's estimate, widening the search when a cell is empty.

    Same band first, then any band, then a wider ring -- a building whose own
    cell was never sampled should fall back to its neighbourhood rather than
    straight to a city-wide number.
    """
    gx, gy, bd = int(r.x // CELL_M), int(r.y // CELL_M), band_of(r.area)
    for rad in (0, 1, 2):
        same = [prior[(i, j, bd)]
                for i in range(gx - rad, gx + rad + 1)
                for j in range(gy - rad, gy + rad + 1)
                if (i, j, bd) in prior]
        if same:
            return statistics.median(same)
        anyb = [prior[(i, j, b)]
                for i in range(gx - rad, gx + rad + 1)
                for j in range(gy - rad, gy + rad + 1)
                for b in range(len(BANDS)) if (i, j, b) in prior]
        if anyb:
            return statistics.median(anyb)
    return fallback


def score(name: str, test: list[Row], predictor: Any) -> tuple[float, float]:
    errs = [abs(predictor(r) - r.truth) for r in test]
    mae = statistics.mean(errs)
    med = statistics.median(errs)
    print(f"    {name:<26} MAE {mae:6.2f} m   median |err| {med:6.2f} m")
    return mae, med


def run(rows: list[Row], label: str) -> str:
    if len(rows) < 40:
        print(f"  {label}: only {len(rows)} rows -- too few to hold out, skipped")
        return "skipped"
    fit = [r for r in rows if split_hash(f"{r.x:.1f},{r.y:.1f}") < FIT_FRACTION]
    test = [r for r in rows if r not in fit]
    # `r not in fit` is O(n^2) on identity; rebuild explicitly instead.
    fit_ids = {id(r) for r in fit}
    test = [r for r in rows if id(r) not in fit_ids]
    if len(test) < 15 or len(fit) < 25:
        print(f"  {label}: split gives fit={len(fit)} test={len(test)} -- too thin")
        return "skipped"

    hs = [r.truth for r in rows]
    uniq = len(set(round(h, 1) for h in hs))
    top = statistics.mode(round(h, 1) for h in hs)
    top_share = 100.0 * sum(1 for h in hs if abs(h - top) < 0.05) / len(hs)
    print(f"  {label}: n={len(rows)}  fit={len(fit)} test={len(test)}  "
          f"p50 {statistics.median(hs):.1f} m  {uniq} distinct values  "
          f"most common {top:.1f} m at {top_share:.1f} %")
    if top_share > 40.0:
        print(f"    WARNING: {top_share:.0f} % of the truth is one value. This is "
              f"the Dubai spike -- a hold-out here proves little.")

    prior = fit_prior(fit)
    globl = statistics.median([r.truth for r in fit])
    print(f"    prior cells with >=3 samples: {len(prior)}")
    g_mae, _ = score("Google zonal p65", test, lambda r: r.google)
    p_mae, _ = score(f"spatial prior ({CELL_M:.0f} m)", test,
                     lambda r: predict(prior, r, globl))
    c_mae, _ = score("city-wide median", test, lambda r: globl)
    best = min((g_mae, "google"), (p_mae, "prior"), (c_mae, "constant"))[1]
    delta = 100.0 * (g_mae - p_mae) / g_mae
    print(f"    -> best: {best}   prior vs Google: {delta:+.1f} % "
          f"({'prior wins' if p_mae < g_mae else 'GOOGLE WINS'})")
    return best


def cross_run(fit_rows: list[Row], test_rows: list[Row], label: str) -> str:
    """Fit on one truth set, test on a DIFFERENT one.

    For the stated-height buildings a 70/30 split leaves 12 to test on, which is
    not a measurement. But the storey-derived buildings are a separate
    population, so a prior fitted from them has never seen a stated height --
    no hold-out is needed and all of them can be tested.

    This is also the harder and more interesting question: can a prior learned
    from storey counts predict a number somebody actually wrote down?
    """
    if len(test_rows) < 20 or len(fit_rows) < 100:
        print(f"  {label}: fit={len(fit_rows)} test={len(test_rows)} -- too thin")
        return "skipped"
    prior = fit_prior(fit_rows)
    globl = statistics.median([r.truth for r in fit_rows])
    hs = [r.truth for r in test_rows]
    print(f"  {label}: fit={len(fit_rows)} (storey-derived)  test={len(test_rows)} "
          f"(stated)  test p50 {statistics.median(hs):.1f} m  "
          f"{len(set(round(h, 1) for h in hs))} distinct values")
    print(f"    prior cells with >=3 samples: {len(prior)}")
    g_mae, _ = score("Google zonal p65", test_rows, lambda r: r.google)
    p_mae, _ = score(f"spatial prior ({CELL_M:.0f} m)", test_rows,
                     lambda r: predict(prior, r, globl))
    c_mae, _ = score("city-wide median", test_rows, lambda r: globl)
    best = min((g_mae, "google"), (p_mae, "prior"), (c_mae, "constant"))[1]
    print(f"    -> best: {best}   prior vs Google: "
          f"{100.0 * (g_mae - p_mae) / g_mae:+.1f} % "
          f"({'prior wins' if p_mae < g_mae else 'GOOGLE WINS'})")
    return best


# ── the correction the error structure actually calls for ──────────────────

#: Google's value is binned by ITS OWN reading, because at prediction time the
#: true height is exactly what is not known. Edges chosen to keep every bin
#: populated in the fit split.
CORR_EDGES = [0.0, 6.0, 10.0, 16.0, 25.0, 40.0, 1e9]


def fit_correction(fit: list[Row]) -> dict[int, float]:
    """Median truth/google ratio per Google-value bin.

    THE MULTIPLIER IS A MEDIAN OF RATIOS, not a ratio of means: a handful of
    towers where Google reads a third of the truth would otherwise drag every
    bin up, which is the failure mode that makes a correction worse than the
    thing it corrects.
    """
    bins: dict[int, list[float]] = {}
    for r in fit:
        if r.google <= 0.0:
            continue
        b = max(i for i, e in enumerate(CORR_EDGES) if r.google >= e)
        bins.setdefault(b, []).append(r.truth / r.google)
    return {k: statistics.median(v) for k, v in bins.items() if len(v) >= 20}


def apply_correction(corr: dict[int, float], g: float) -> float:
    b = max(i for i, e in enumerate(CORR_EDGES) if g >= e)
    return g * corr.get(b, 1.0)


def linear_fit(fit: list[Row]) -> tuple[float, float]:
    """Least-squares truth = a*google + b, for comparison against the bins."""
    n = len(fit)
    sx = sum(r.google for r in fit)
    sy = sum(r.truth for r in fit)
    sxx = sum(r.google * r.google for r in fit)
    sxy = sum(r.google * r.truth for r in fit)
    den = n * sxx - sx * sx
    if abs(den) < 1e-9:
        return 1.0, 0.0
    a = (n * sxy - sx * sy) / den
    return a, (sy - a * sx) / n


def correction_run(rows: list[Row]) -> None:
    fit_ids = {id(r) for r in rows
               if split_hash(f"{r.x:.1f},{r.y:.1f}") < FIT_FRACTION}
    fit = [r for r in rows if id(r) in fit_ids and r.kind == "storey"]
    test_s = [r for r in rows if id(r) not in fit_ids and r.kind == "storey"]
    test_t = [r for r in rows if r.kind == "stated"]
    if len(fit) < 200 or len(test_s) < 50:
        print("  too thin to fit a correction")
        return
    corr = fit_correction(fit)
    a, b = linear_fit(fit)
    print(f"  fitted on {len(fit)} storey-derived buildings")
    print("  multiplier by Google-value bin:")
    for k in sorted(corr):
        lo = CORR_EDGES[k]
        hi = CORR_EDGES[k + 1] if k + 1 < len(CORR_EDGES) else float("inf")
        print(f"    google {lo:5.0f}-{hi if hi < 1e8 else 999:5.0f} m  x {corr[k]:.2f}")
    print(f"  linear fit: truth = {a:.3f} * google + {b:.2f}")
    for label, test in (("held-out storey-derived", test_s), ("stated heights", test_t)):
        if len(test) < 20:
            continue
        print(f"  -- {label} (n={len(test)}) --")
        g, _ = score("Google raw", test, lambda r: r.google)
        c, _ = score("binned multiplier", test,
                     lambda r: apply_correction(corr, r.google))
        l, _ = score("linear fit", test, lambda r: max(2.0, a * r.google + b))
        win = min((g, "raw"), (c, "binned"), (l, "linear"))[1]
        print(f"     -> best: {win}   binned vs raw: "
              f"{100.0 * (g - c) / g:+.1f} %   linear vs raw: "
              f"{100.0 * (g - l) / g:+.1f} %")


def main() -> int:
    rows = load_rows()
    if not rows:
        raise SystemExit("no measured rows -- run fetch-bangalore.py --layer osm first")
    print(f"loaded {len(rows)} buildings carrying measured evidence AND a Google value\n")
    print("A) STOREY-DERIVED truth (building:levels x fitted metres-per-storey)")
    a = run([r for r in rows if r.kind == "storey"], "storey-derived")
    print("\nB) STATED truth (OSM height tags -- not derived from anything)")
    b = cross_run([r for r in rows if r.kind == "storey"],
                  [r for r in rows if r.kind == "stated"], "stated")
    print("\nC) A HEIGHT-DEPENDENT CORRECTION, which is what the error structure")
    print("   actually calls for: Google's bias runs -0.68 m under 10 m and")
    print("   -27.09 m above 60 m. That is a property of the BUILDING, not of")
    print("   the neighbourhood, which is why a spatial prior could not help.")
    correction_run(rows)
    print()
    if a == b == "prior":
        print("VERDICT: the prior beats Google on both truth sets. Worth shipping.")
    elif a == "prior" and b != "prior":
        print("VERDICT: the prior wins only on storey-derived truth. That is the "
              "half most likely to reflect the survey's own habits rather than "
              "the city, so this is NOT enough to ship on.")
    elif a == "skipped" or b == "skipped":
        print("VERDICT: inconclusive -- one truth set was too thin to hold out.")
    else:
        print("VERDICT: Google is not beaten. The prior does not ship, and this "
              "is a real result: Bengaluru's 2.5D coverage is good enough that a "
              "neighbourhood median adds nothing. Dubai needed one because 87 % "
              "of it had no height at all.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
