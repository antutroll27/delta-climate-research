"""Do the shipped building heights survive ICESat-2, in distribution?
-> data/calibration/icesat2-heights.json

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §5.3.
The verdicts and their thresholds are PRE-REGISTERED there; this script
implements exactly those four (`validated`, `biased`, `inconclusive`,
`underpowered`) and must not grow a fifth because the data looked tempting.

    python3 scripts/measure-height-accuracy.py       # every committed subset

FULLY OFFLINE. It reads only committed artefacts — data/calibration/icesat2/*.json,
data/geometry/<ward>-footprints.json, public/heat-map/data/<ward>.json. No token,
no network, no granule: that is the whole reason the subsets are committed, and it
is what makes the verdict re-runnable by anyone, forever.

WHAT IS COMPARED, AND WHAT IS NOT. For every building the beam crossed (>= 5
photons inside its 5 m-eroded footprint, in the roof band) two numbers exist: the
ICESat-2 p75 height-above-ground and the shipped artefact height. The comparison
is between the two DISTRIBUTIONS' quantiles over that set — never between paired
per-building differences, and nothing per-building is published. ATL03's 3-5 m
geolocation error against a 10-20 m Kolkata building means any single photon may
have landed on the neighbour (spec §1), so per-building estimates exist only to
build the distribution.

PHOTONS ARE POOLED PER BUILDING, SO n COUNTS BUILDINGS AND NOT PASSES. A repeat
pass may revisit a building already in the cohort or land on new ones — beams
wander up to 726 m across-track between cycles, and Ballygunge's 12 passes
crossed 50 distinct buildings (spec §3, CORRECTION 2026-08-07; that wander is
why the 30-building bar was ever within reach). Either way the
photons of every pass of a ward are pooled per building before MIN_ROOF_PH is
applied — which is precisely the power repeat passes buy — and `n_buildings`
counts DISTINCT buildings. Concatenating each pass's estimates instead would let
one building appear three times and walk the pooled n toward the bar without a
single new building being measured.

THE PAIRED PERMUTATION TEST, NOT ks_2samp. `_icesat2.quantile_bias` returns
`perm_p`, not a KS p-value: the two samples are the same buildings measured
twice, so they are correlated and the two-sample KS null is false here. Measured
under H0 it rejected 0 times in 2,000 draws — it would have handed the model a
comfortable "no significant difference" no matter what the data said.

EVERY EXCLUSION IS COUNTED, AND ATTRIBUTED TO ITS OWN CAUSE (spec §5.4).
Buildings too small to survive the 5 m erosion, buildings crossed but under
MIN_ROOF_PH, buildings crossed with photons enough but pushed under the bar by
the roof band's 2.0 m FLOOR, buildings whose ground reference the POINTWISE
RELIEF GATE refused, roof photons dropped below and above the band, photons
outside the ground line's populated span (where `ground_line` returns NaN rather
than extrapolating flat) or over a refused window, and any subset this script
refused — all of them land in `excluded`. Silent truncation reads as coverage,
and so does a truthful total filed under the wrong reason: a building with 40
roof photons all below 2 m is not "too few photons", it is a building the floor
removed, and the two say opposite things about whether more passes would help.

THE GROUND REFERENCE ITSELF WAS THE DEFECT (spec §5.1, CORRECTION 2026-08-07).
This script first ran on 2026-08-06 and reported n=30 and `validated`. Overture
does not map every building, and where a 30 m ground window held nothing but
roof photons from an unmapped one, the two-pass line settled on that roof and
stayed there — 5 of 31 passes carried a ground line above +25 m, worst 84.68 m
in a ward whose ground is 3-6 m. §5.1's G1b was written for exactly that and
could not see it, because it tests the pass MEDIAN (4.46 m on the 84.68 m pass).
`ground_line` now refuses such windows pointwise and will not bridge across
them. n falls to 28, under the pre-registered bar, so the verdict is
`underpowered` and NO bias, CI or omnibus statistic is published. That is the
pre-registered outcome and it is not to be recovered by relaxing anything.

THE 2.0 m FLOOR IS MEASURED, NOT ASSUMED HARMLESS. It is an honest statement of
what this instrument resolves, so it does not move — but it deletes the low
photons of short buildings, which is a directional effect on the published bias.
`floor_sensitivity` re-runs the whole cohort at 1.0, 0.5 and 0.0 m offline and
records what the floor is worth, so the bias ships with the evidence that it is
not an artefact of the floor. The shipped path always uses ROOF_BAND_M.

SELECTION EFFECT, DISCLOSED. Erosion by the geolocation error deletes small
buildings outright, so the crossed set over-represents LARGE ones. The published
wording must say "along satellite transects", never "all buildings".
"""
from __future__ import annotations

import glob
import json
import math
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _types import WARDS  # noqa: E402

F64 = npt.NDArray[np.float64]
I64 = npt.NDArray[np.int64]

ROOT = os.path.join(HERE, "..")
SUB_DIR = os.path.join(ROOT, "data", "calibration", "icesat2")
OUT = os.path.join(ROOT, "data", "calibration", "icesat2-heights.json")

#: Spec §5.3: below this many DISTINCT crossed buildings the verdict is
#: `underpowered` — the honest `score-heights.py` outcome, again. It is a bar,
#: not a knob: reaching it by relaxing the erosion, the roof band or
#: MIN_ROOF_PH is the exact move this workstream exists to avoid.
MIN_BUILDINGS = 30
#: Spec §5.3: the fill cohort's own, smaller bar.
MIN_FILL = 10
#: Google Open Buildings writes exactly this where it has no confident height —
#: simultaneously the minimum and the modal height in all three wards
#: (465/3527, 597/4702, 629/4538). Exact equality is the cohort definition.
FILL_M = 2.5
#: Spec §5.3: one storey, the same bracket `score-heights.py` uses.
VALID_BIAS_M = _icesat2.STOREY_M
#: Spec §5.3: two storeys — the width a CI must beat to say `validated`.
WIDE_CI_M = 2.0 * _icesat2.STOREY_M
BOOTS = 10_000
#: Seeded so the artefact is reproducible; a re-run must not move the verdict.
SEED = 7
#: Roof-band floors the floor-sensitivity measurement re-runs the cohort at.
#: MEASUREMENT ONLY — the shipped statistic is always `_icesat2.ROOF_BAND_M`,
#: whose floor is `SENS_FLOORS_M[0]`. The block exists so a reader can see what
#: the floor is worth rather than take the note's word for it.
SENS_FLOORS_M = (_icesat2.ROOF_BAND_M[0], 1.0, 0.5, 0.0)
#: Pointwise relief allowances the method-stability sweep re-runs the cohort at,
#: metres. MEASUREMENT ONLY — the shipped line always uses
#: `_icesat2.GROUND_RELIEF_M`. The range brackets the wards' measured relief
#: (4.9-8.9 m spans) at the bottom and the shortest roof the gate must catch
#: (11 m) at the top, so a reader can see the choice is not load-bearing.
RELIEF_SWEEP_M = (6.0, 8.0, _icesat2.GROUND_RELIEF_M, 12.0, 15.0, 20.0)
#: Rolling ground-window widths the same sweep re-runs at, metres. MEASUREMENT
#: ONLY; the shipped line always uses `_icesat2.GROUND_WIN_M`. Recorded because
#: the answer is NOT stable to this one and a reader is owed that.
WIN_SWEEP_M = (_icesat2.GROUND_WIN_M, 50.0, 80.0, 120.0, 200.0)
#: How far the ground line recomputed here may sit from the `groundMedianM` the
#: subset recorded when it passed the §5.1 gate, metres. Both are the median of
#: the same two-pass line over the same photons and the same committed rings, so
#: they agree exactly up to the recorded value's 2 dp rounding (<= 0.005 m;
#: measured worst case 0.0048 m over all 31 subsets). 0.05 m is an order of
#: magnitude above that and two below the metre-class errors it guards — the
#: footprints having been regenerated under a subset, which would mean the gate
#: passed on a ground line this script no longer computes.
GROUND_RECHECK_TOL_M = 0.05


class GroundLineDrift(RuntimeError):
    """The ground line recomputed here is not the one the §5.1 gate passed.

    NOT a ValueError, deliberately: `main` catches ValueError to skip a subset
    whose granule is too thin, and this is the opposite situation — the subset is
    fine and the artefacts under it have moved. Skipping the affected passes
    would quietly re-run the whole comparison on ungated ground.
    """


def load_ward(ward: str) -> tuple[list[list[float]], list[float]]:
    """Footprint rings and shipped heights for one ward, index-aligned.

    `public/heat-map/data/<ward>.json` `b[i][0]` is the shipped height and
    `b[i][1:]` the same flat ring as `data/geometry/<ward>-footprints.json`
    `b[i]["p"]`. That alignment is the load-bearing assumption of this whole
    comparison and it is exactly the kind of thing that rots silently when
    either file is regenerated, so it is CHECKED rather than assumed: row
    counts, ring lengths, and every row's first vertex. A plain `assert` would
    vanish under `python3 -O`, which is why this raises."""
    with open(os.path.join(ROOT, "data", "geometry",
                           f"{ward}-footprints.json"), encoding="utf-8") as fh:
        fp = json.load(fh)["b"]
    with open(os.path.join(ROOT, "public", "heat-map", "data",
                           f"{ward}.json"), encoding="utf-8") as fh:
        pub = json.load(fh)["b"]
    if len(fp) != len(pub):
        raise ValueError(f"{ward}: {len(fp)} footprints vs {len(pub)} shipped "
                         "rows — index alignment is broken, every height would "
                         "be attributed to the wrong building")
    for i, (f, p) in enumerate(zip(fp, pub)):
        ring = f["p"]
        if len(p) - 1 != len(ring) or p[1] != ring[0] or p[2] != ring[1]:
            raise ValueError(
                f"{ward}: row {i} differs between the footprints and the "
                "shipped heights — index alignment is broken")
    return [f["p"] for f in fp], [float(p[0]) for p in pub]


def footprint_frame(sub: dict[str, Any], rings: list[list[float]]) -> dict[str, Any]:
    """The half of `transect` that does not depend on the ground line: along-track
    distance, ground candidates (outside every DILATED footprint), roof
    assignment (inside every ERODED one).

    Split out and cached because it is the expensive half — two shapely STRtree
    builds over 3,500-4,700 polygons per pass — and because it is invariant under
    the method-stability sweeps, which vary only the ground line. Re-running it
    per sweep row would multiply the script's runtime by the number of rows and
    return byte-identical answers."""
    w = WARDS[sub["ward"]]
    ph = np.asarray(sub["ph"], dtype=np.float64)
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    dil, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    ero, kept = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    return {
        "ward": sub["ward"],
        "s": _icesat2.along_track(x, y),
        "h_ortho": ph[:, 3],               # column 3 is orthometric, 2 is ellipsoidal
        "gnd": dil == -1,
        "ero": ero,
        "kept": kept,
        "n_photons": int(ph.shape[0]),
        "n_rings": len(rings),
    }


def transect(sub: dict[str, Any], fr: dict[str, Any],
             ) -> tuple[I64, F64, dict[str, float], npt.NDArray[np.bool_]]:
    """One pass -> (per-photon eroded-footprint index, height above ground, ladder,
    per-photon "the relief gate refused this photon's ground" mask).

    Same three steps as the Task-3 diagnostic, in the same order: ground
    candidates are the photons OUTSIDE every footprint DILATED by the
    geolocation error, the two-pass ground line comes from those candidates
    alone, and roof photons are those inside footprints ERODED by it. The first
    and third are `footprint_frame`'s job and arrive in `fr`.

    The ground line is NaN outside its populated span, and NaN over any window
    the pointwise relief gate refused (spec §5.1, CORRECTION 2026-08-07), so
    `hag` is NaN there too. Those photons are dropped — `building_heights` drops
    them by itself, since every comparison against NaN is False — and the ladder
    COUNTS them, per spec §5.4, under their two SEPARATE causes.

    THE §5.1 GATE IS RE-RUN HERE, against the line this function actually
    recomputes. It ran in `fetch-icesat2.py` when the subset was written, and
    every subset present has passed it — but it passed against the ground line
    of that day, and the gate is only as good as the line it saw. This function
    recomputes the line from the committed photons and the committed footprints,
    so if either has moved since, the recomputed line is ungated and nothing
    would have said so. `groundMedianM` was already sitting in every subset,
    unused. Two checks, both fatal: the recomputed median against the recorded
    one (GROUND_RECHECK_TOL_M), and `check_geoid` itself, so G1a and G1b hold for
    the line that produces the published heights and not merely for its
    ancestor."""
    s, h_ortho, gnd = fr["s"], fr["h_ortho"], fr["gnd"]
    gstats: dict[str, Any] = {}
    g = _icesat2.ground_line(s, s[gnd], h_ortho[gnd], stats=gstats)
    fin = np.isfinite(g)
    hag = h_ortho - g

    # The gate, re-run on THIS line. The median is over the finite line only, for
    # the same reason fetch-icesat2.py takes it that way: np.median of an array
    # holding one NaN is NaN, and check_geoid fails closed on NaN, so a single
    # out-of-span photon would reject good data for the wrong reason.
    ground_median = float(np.median(g[fin]))
    # THE DRIFT RECHECK COMPARES THE PRE-GATE MEDIAN, and must. The question it
    # asks is whether the photons or the committed footprints have moved under a
    # subset since it passed the §5.1 gate — a question about the DATA. Every
    # committed subset recorded the pre-gate median (the pointwise relief gate
    # did not exist on 2026-08-06), so comparing the post-gate line here would
    # fire on 9 of 31 subsets purely because the algorithm was corrected, and a
    # tolerance widened to absorb that would stop detecting the thing it exists
    # for. `groundMedianUngatedM` is the field newer subsets carry for exactly
    # this; older ones hold the same quantity in `groundMedianM`.
    recorded = float(sub.get("groundMedianUngatedM", sub["groundMedianM"]))
    drift = float(gstats["median_ungated_m"]) - recorded
    if not abs(drift) <= GROUND_RECHECK_TOL_M:
        raise GroundLineDrift(
            f"recomputed pre-gate ground median {gstats['median_ungated_m']:.3f} m "
            f"differs from the {recorded} m this subset recorded when it passed "
            f"the §5.1 gate, by {drift:+.3f} m (tolerance {GROUND_RECHECK_TOL_M} m) "
            "— the photons or the committed footprints have moved under it, so "
            "the gate passed on a ground line this script no longer computes")
    _icesat2.check_geoid(ground_median, float(sub["geoidNM"]),
                         float(sub["granuleGeoidNM"]))

    ero, kept = fr["ero"], fr["kept"]
    roof = ero >= 0
    lo, hi = _icesat2.ROOF_BAND_M
    # The two reasons a photon has no ground value, kept APART (spec §5.4). Both
    # show up as NaN in `g`, and both delete the photon, but they mean opposite
    # things: outside the span is a short track, over a gated window is an
    # unmapped building the relief gate refused to measure heights against. A
    # single total would have let this bug's own symptom read as coverage.
    span_lo, span_hi = gstats["span_m"]
    out_span = (s < span_lo) | (s > span_hi)
    over_gated = ~fin & ~out_span
    ladder = {
        "photons_in_subset": int(fr["n_photons"]),
        "ground_candidates": int(gnd.sum()),
        "photons_outside_ground_span": int(out_span.sum()),
        "ground_windows_populated": int(gstats["n_windows_populated"]),
        "ground_windows_gated": int(gstats["n_windows_gated"]),
        "photons_over_gated_ground_windows": int(over_gated.sum()),
        "photons_in_eroded_footprints": int(roof.sum()),
        "roof_photons_outside_ground_span": int((roof & out_span).sum()),
        "roof_photons_over_gated_ground_windows": int((roof & over_gated).sum()),
        "photons_in_roof_band": int((roof & (hag >= lo) & (hag <= hi)).sum()),
        # Both tails of the band, separately: the low one is the 2.0 m floor
        # deleting short buildings' evidence and it is the one that moves the
        # published bias, so recording only the in-band total hides it.
        "roof_photons_below_band": int((roof & fin & (hag < lo)).sum()),
        "roof_photons_above_band": int((roof & fin & (hag > hi)).sum()),
        "buildings_in_ward": int(fr["n_rings"]),
        "buildings_survived_erosion": len(kept),
        "buildings_crossed": int(np.unique(ero[roof]).size),
        "ground_median_m": round(ground_median, 3),
        "ground_median_ungated_m": round(float(gstats["median_ungated_m"]), 3),
        "ground_median_drift_m": round(drift, 3),
    }
    return ero, hag, ladder, over_gated


def wilson_ci95(k: int, n: int) -> tuple[float, float]:
    """95 % Wilson score interval for a proportion k/n.

    Not a bootstrap, which is what the rest of this script uses, because a
    bootstrap of a proportion is degenerate exactly where this cohort is likely
    to sit: resampling k=0 successes returns 0 every time, so the CI is [0, 0]
    and "no fill building shows roof evidence above 2.5 m" would publish as
    certainty at n=10. Wilson gives [0, 0.28] there — small n, honestly wide."""
    z = 1.959963984540054                  # the normal 97.5th percentile
    p = k / n
    den = 1.0 + z * z / n
    centre = (p + z * z / (2.0 * n)) / den
    half = z * math.sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n)) / den
    return max(0.0, centre - half), min(1.0, centre + half)


def fill_cohort(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Win 2 (spec §5.3, AMENDED 2026-08-07): of the crossed buildings we ship at
    the 2.5 m fill, what FRACTION show roof evidence above 2.5 m?

    NOT the original "cohort median minus 2.5 m = understatement". That statistic
    could not return zero by construction. The fill cohort is by definition the
    buildings Google could not measure — disproportionately SHORT ones — and the
    roof band's 2.0 m floor deletes photons below 2 m. So a fill building that is
    genuinely about 2.5 m tall has precisely the evidence that would vindicate
    the fill thrown away before the estimator runs: it either drops out of the
    cohort or keeps only its surviving upper tail, and the median comes out high
    either way. "Understatement" was manufactured by the floor, in the direction
    that flatters the finding. Measured on the committed subsets: building 2272
    is shipped at the fill, has 4 roof photons, and all 4 sit below 2 m — the
    instrument saying the fill is about right — and the old statistic deleted it.

    THE FLOOR DOES NOT MOVE. 2 m is an honest statement of what ICESat-2 resolves
    over a rooftop; lowering it to rescue this cohort would be tuning a threshold
    to get an answer, which is the move this whole workstream exists to avoid.
    The QUESTION moves instead, to one the instrument can answer without
    discarding evidence.

    EVERY CROSSED FILL BUILDING CONTRIBUTES, including those whose photons all
    sit low — they are a `no`, i.e. evidence FOR the fill, not a vanishing. So
    the per-building test is the spec's own §5.2.4 estimator, p75, taken over the
    building's roof photons with the floor removed and only the 120 m noise
    ceiling kept. MIN_ROOF_PH is deliberately NOT applied to the classification:
    it exists to make a height ESTIMATE meaningful (at n<5 the p75 leans on the
    single highest photon), and this is a yes/no about whether evidence above
    2.5 m exists at all. Thin buildings are counted as `n_below_min_roof_ph`
    beside the fraction rather than deleted, so a reader can see how much of the
    cohort rests on a handful of photons.

    A high fraction means the fill understates; a low one means it is broadly
    right. `n >= 10` (MIN_FILL) stays the bar, and below it the fraction is NOT
    published — the same discipline the main cohort applies to its bias, for the
    same reason: a number printed beside `underpowered` gets quoted without it.
    The §5.4 exclusion counts ARE published at any n.

    NO RESAMPLING POOL IS PUBLISHED (no `heights_m`). §5.3: `compute-far.py
    --icesat2-correction` must not resample a cohort whose distribution the floor
    has inflated, and the floor-free distribution is not the pre-registered
    statistic either — the amendment chose a proportion precisely because a
    floor-free median is dragged down by misclassified ground. FAR sensitivity
    therefore stays `no_correction_computable`, which is what §5.3 requires."""
    n = len(rows)
    d: dict[str, Any] = {
        "n": n, "min_n": MIN_FILL,
        "statistic": "fraction of crossed 2.5 m-fill buildings whose floor-free "
                     "p75 roof height exceeds 2.5 m",
        # §5.4, reported at any n: how much of this cohort the roof band's floor
        # and the photon bar take out of the MAIN comparison. The first is the
        # defect that invalidated the original statistic, in one number.
        "n_excluded_by_roof_band_floor": sum(
            1 for r in rows if r["excluded_by_floor"]),
        "n_below_min_roof_ph": sum(
            1 for r in rows if r["n_roof_ph"] < _icesat2.MIN_ROOF_PH),
        "roof_photons_below_band_floor": sum(int(r["n_below_floor"]) for r in rows),
        "roof_photons": sum(int(r["n_roof_ph"]) for r in rows),
    }
    if n < MIN_FILL:
        d["verdict"] = "underpowered"
        return d
    k = sum(1 for r in rows if r["p75_floor_free_m"] > FILL_M)
    lo, hi = wilson_ci95(k, n)
    d.update({
        "n_above_fill": k,
        "fraction_above_fill": round(k / n, 3),
        # Named for the statistic it belongs to. The old `ci95_m` bootstrapped
        # the cohort MEDIAN but sat beside `understatement_m` (= median - 2.5)
        # and was printed as its interval, so it published an interval that did
        # not contain its own point estimate.
        "fraction_above_fill_ci95": [round(lo, 3), round(hi, 3)],
        "verdict": "measured"})
    return d


def verdict(qb: dict[str, Any]) -> str:
    """Spec §5.3's pre-registered table, and nothing else.

    `validated` needs BOTH a sub-storey median bias and a CI inside ±2 storeys;
    `biased` needs a CI clear of zero AND a bias of at least a storey. Anything
    else is `inconclusive` — including the corners the table does not name (a
    sub-storey bias whose CI clears zero but not ±2 storeys, say). Naming a
    fifth outcome for those after seeing the data is exactly the re-tuning the
    pre-registration exists to prevent, so they fall to the honest one.

    `qb` MUST BE `quantile_bias`'s UNROUNDED output, never the 2 dp values the
    artefact carries. A true bias anywhere in [3.195, 3.2) presents as 3.20 and
    would trip the `|bias| >= 3.2 m` arm of `biased` at a value where §5.3 says
    the outcome is not `biased`. Rounding is a presentation step; the threshold
    is tested against the measurement."""
    lo, hi = qb["median_ci95_m"]
    bias = float(qb["median_bias_m"])
    if abs(bias) < VALID_BIAS_M and -WIDE_CI_M < lo and hi < WIDE_CI_M:
        return "validated"
    if (lo > 0 or hi < 0) and abs(bias) >= VALID_BIAS_M:
        return "biased"
    return "inconclusive"


def for_display(qb: dict[str, Any]) -> dict[str, Any]:
    """`quantile_bias`'s exact output, rounded for the artefact and the console.

    The ONLY place rounding happens. `verdict()` sees the exact values; this
    result is what gets written, so nothing downstream can read a threshold
    decision off a rounded number."""
    out: dict[str, Any] = {}
    for k, v in qb.items():
        if k.endswith("_bias_m"):
            out[k] = round(float(v), 2)
        elif k.endswith("_ci95_m"):
            out[k] = [round(float(x), 2) for x in v]
        elif k in ("ks_d", "perm_p"):
            out[k] = round(float(v), 4)
        else:
            out[k] = v
    return out


def cohort_at_floor(cat: dict[str, tuple[I64, F64]],
                    geom: dict[str, tuple[list[list[float]], list[float]]],
                    floor_m: float) -> tuple[F64, F64]:
    """The whole pooled cohort rebuilt with the roof band's floor moved.

    MEASUREMENT ONLY — see `floor_sensitivity`. The shipped cohort in `main` is
    built by the same code path at `_icesat2.ROOF_BAND_M`, never through here."""
    band = (floor_m, _icesat2.ROOF_BAND_M[1])
    ours: list[float] = []
    theirs: list[float] = []
    for ward, (ero, hag) in sorted(cat.items()):
        est = _icesat2.building_heights(ero, hag, band=band)
        for b, h in sorted(est.items()):
            ours.append(h)
            theirs.append(geom[ward][1][b])
    return (np.asarray(ours, dtype=np.float64),
            np.asarray(theirs, dtype=np.float64))


def floor_sensitivity(cat: dict[str, tuple[I64, F64]],
                      geom: dict[str, tuple[list[list[float]], list[float]]],
                      ) -> dict[str, Any]:
    """What the roof band's 2.0 m floor is worth to the published bias.

    The floor deletes photons below 2 m as street furniture and misclassified
    ground. That is honest about the instrument, and it is also directional: the
    buildings it hits are short ones, on both sides of the comparison, which
    pushes the median bias positive ("our heights understate"). Conservative for
    reaching `validated`, but under a `biased` verdict the published MAGNITUDE
    would be overstated (spec §5.3's main-cohort caveat).

    So it is measured rather than argued about. The cohort is rebuilt at 1.0,
    0.5 and 0.0 m — offline, from the same committed photons, in a second — and
    the three quantile biases are recomputed at each. Point estimates only, no
    bootstrap: the question is whether the floor MOVES the number, and a CI here
    would be read as a second opinion on the published one.

    Nothing in this block feeds the verdict. The floor stays at 2.0 m whatever
    it says; a floor chosen by the bias it produces is not a measurement."""
    rows: list[dict[str, Any]] = []
    qv = np.array([0.50, 0.65, 0.90])
    for f in SENS_FLOORS_M:
        o, t = cohort_at_floor(cat, geom, f)
        row: dict[str, Any] = {"floor_m": f, "n_buildings": int(o.size),
                               "shipped": f == _icesat2.ROOF_BAND_M[0]}
        if o.size:
            d = np.quantile(o, qv) - np.quantile(t, qv)
            row.update({"median_bias_m": round(float(d[0]), 2),
                        "p65_bias_m": round(float(d[1]), 2),
                        "p90_bias_m": round(float(d[2]), 2)})
        rows.append(row)
    return {
        "floors": rows,
        "note": ("Measured, not shipped: the cohort re-run with the roof band's "
                 f"floor at {', '.join(f'{f:g}' for f in SENS_FLOORS_M)} m. The "
                 "floor stays at 2.0 m — it is what this instrument resolves "
                 "over a rooftop, and lowering it to move a result would be "
                 "tuning a threshold for an answer. It is recorded because the "
                 "floor deletes short buildings' low photons and so acts on the "
                 "bias directionally; these rows show by how much."),
    }


def cohort_at_ground_line(frames: list[dict[str, Any]],
                          geom: dict[str, tuple[list[list[float]], list[float]]],
                          relief_m: float, win_m: float) -> tuple[F64, F64, int, int]:
    """The whole pooled cohort rebuilt with the ground line's own knobs moved:
    the pointwise relief allowance and the rolling window width.

    METHOD EVIDENCE ONLY. `main` never routes through here; it builds the shipped
    cohort through `transect` at `_icesat2.GROUND_RELIEF_M` and
    `_icesat2.GROUND_WIN_M`. The §5.1 rechecks are deliberately NOT re-run per
    row: they are properties of the committed subsets, already enforced once by
    `transect` on the shipped settings, and re-running them here would abort the
    sweep on a row rather than record it."""
    pooled: dict[str, tuple[list[I64], list[F64]]] = {}
    gated_windows = gated_photons = 0
    for fr in frames:
        s, h_ortho, gnd = fr["s"], fr["h_ortho"], fr["gnd"]
        gs: dict[str, Any] = {}
        try:
            g = _icesat2.ground_line(s, s[gnd], h_ortho[gnd],
                                     win_m=win_m, relief_m=relief_m, stats=gs)
        except ValueError:                       # too few windows at this width
            continue
        gated_windows += int(gs["n_windows_gated"])
        gated_photons += int(gs["photons_over_gated_windows"])
        pooled.setdefault(fr["ward"], ([], []))
        pooled[fr["ward"]][0].append(fr["ero"])
        pooled[fr["ward"]][1].append(h_ortho - g)
    ours: list[float] = []
    theirs: list[float] = []
    for ward, (eros, hags) in sorted(pooled.items()):
        est = _icesat2.building_heights(np.concatenate(eros), np.concatenate(hags))
        for b, h in sorted(est.items()):
            ours.append(h)
            theirs.append(geom[ward][1][b])
    return (np.asarray(ours, dtype=np.float64),
            np.asarray(theirs, dtype=np.float64), gated_windows, gated_photons)


def _sweep_row(o: F64, t: F64, extra: dict[str, Any]) -> dict[str, Any]:
    """One method-stability row: n, the pre-registered outcome at that n, and the
    point biases. No bootstrap and no CI — see `method_stability`."""
    qv = np.array([0.50, 0.65, 0.90])
    n = int(o.size)
    row: dict[str, Any] = {**extra, "n_buildings": n,
                           "meets_min_buildings": n >= MIN_BUILDINGS}
    if n:
        d = np.quantile(o, qv) - np.quantile(t, qv)
        row.update({"median_bias_m": round(float(d[0]), 2),
                    "p65_bias_m": round(float(d[1]), 2),
                    "p90_bias_m": round(float(d[2]), 2)})
    # The pre-registered table, unchanged, applied to each row. Below the bar it
    # short-circuits to `underpowered` exactly as `main` does; above it the CI
    # comes from the same BOOTS resamples and the same SEED, so a row's verdict
    # is the one the shipped rule would give. `perms=1` because the permutation
    # p-value never entered the verdict rule and 10,000 draws per row would be
    # a minute of arithmetic nobody reads.
    row["verdict"] = ("underpowered" if n < MIN_BUILDINGS else
                      verdict(_icesat2.quantile_bias(
                          o, t, np.random.default_rng(SEED),
                          boots=BOOTS, perms=1)))
    return row


def method_stability(frames: list[dict[str, Any]],
                     geom: dict[str, tuple[list[list[float]], list[float]]],
                     ) -> dict[str, Any]:
    """Whether the two ground-line choices DETERMINED the published outcome.

    THIS IS NOT A RESULT AND MUST NOT BE QUOTED AS ONE. Every number in it is a
    statistic of a cohort that does not reach MIN_BUILDINGS, and spec §5.3 says
    nothing below the bar is a finding. It is recorded for the opposite purpose:
    a reader auditing whether a constant was tuned until an answer appeared needs
    to see what the other values would have given, and a claim of stability that
    cannot be checked is worth nothing. `floor_sensitivity` is withheld under
    `underpowered` because it qualifies the SHIPPED bias — it is that statistic
    with a knob moved. These rows are about the CHOICES, not about the buildings.

    `relief_allowances` — the pointwise relief gate's allowance (§5.1 CORRECTION
    2026-08-07). The gate is what removed the contaminated ground reference, and
    removing it is what took n under the bar, so "did 10 m cause the
    `underpowered` verdict?" is the first question an auditor should ask. It did
    not: the outcome is identical everywhere in 6-20 m, a range whose lower end
    is below the wards' own measured relief spans and whose upper end is above
    the shortest roof the gate must catch.

    `ground_window_widths` — the rolling window (`GROUND_WIN_M`, 30 m). Recorded
    because the answer is uncomfortable and would be worse to leave undiscovered:
    the MEDIAN verdict is NOT stable to it, while the upper-distribution
    divergence is. That is a fact about how much this method can carry, and a
    reason the question is worth re-asking when more passes arrive — ICESat-2 is
    still flying these tracks and the beams wander, so new passes bring new
    buildings. It is not a reason to pick a width."""
    rel, win = [], []
    for r in RELIEF_SWEEP_M:
        o, t, gw, gp = cohort_at_ground_line(frames, geom, r, _icesat2.GROUND_WIN_M)
        rel.append(_sweep_row(o, t, {
            "relief_m": r, "shipped": r == _icesat2.GROUND_RELIEF_M,
            "windows_gated": gw, "photons_over_gated_windows": gp}))
    for wm in WIN_SWEEP_M:
        o, t, _gw, _gp = cohort_at_ground_line(
            frames, geom, _icesat2.GROUND_RELIEF_M, wm)
        win.append(_sweep_row(o, t, {
            "win_m": wm, "shipped": wm == _icesat2.GROUND_WIN_M}))
    return {
        "published": False,
        "relief_allowances": rel,
        "ground_window_widths": win,
        "note": ("METHOD EVIDENCE, NOT A RESULT — nothing in this block may be "
                 "quoted as a measured bias. Every row is a cohort below the "
                 "pre-registered MIN_BUILDINGS bar, and spec §5.3 admits no "
                 "statistic below it. The rows exist so that the two ground-line "
                 "constants can be audited rather than taken on trust. The relief "
                 "allowance does not move the outcome anywhere in 6-20 m, which "
                 "is the point: it was chosen from the wards' measured relief "
                 "(4.9-8.9 m spans in <ward>-terrain.json) and not from the "
                 "answer it gives. The window width DOES move the median verdict "
                 "while leaving the upper-distribution divergence roughly where "
                 "it is — recorded as a limit of the method and a reason to "
                 "re-ask when more passes arrive, never as a width to select."),
    }


def main() -> None:
    subs = sorted(glob.glob(os.path.join(SUB_DIR, "*.json")))
    if not subs:
        sys.exit("  no subsets in data/calibration/icesat2/ — run fetch-icesat2.py first")

    geom: dict[str, tuple[list[list[float]], list[float]]] = {}
    pooled: dict[str, tuple[list[I64], list[F64], list[Any]]] = {}
    per_track: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    frames: list[dict[str, Any]] = []          # kept for `method_stability` only

    for p in subs:
        name = os.path.basename(p)
        with open(p, encoding="utf-8") as fh:
            sub = json.load(fh)
        ward = sub["ward"]
        if "granuleGeoidNM" not in sub:
            # `transect` re-runs the §5.1 gate against the ground line it
            # recomputes, but G1a needs the granule's own geoid and a subset
            # written before that rewrite does not carry one. It cannot have
            # passed the gate then and cannot be re-gated now, and reading it
            # would import an ungated ~50 m geoid error into the verdict.
            rejected.append({"file": name, "reason": "no granuleGeoidNM — predates "
                                                     "the spec §5.1 geoid gate"})
            print(f"  {name}: REJECTED (predates the geoid gate)")
            continue
        if ward not in geom:
            geom[ward] = load_ward(ward)
        rings, _heights = geom[ward]
        try:
            fr = footprint_frame(sub, rings)
            ero, hag, ladder, gate_nan = transect(sub, fr)
        except _icesat2.RingError:
            # WHOLE-WARD GEOMETRY CORRUPTION, not a thin granule. A bare
            # `except ValueError` swallowed this and filed it under "too few
            # populated ground windows" — a per-pass data shortfall — so a
            # malformed ring in <ward>-footprints.json would have silently
            # dropped every subset of that ward and been reported as weather.
            raise
        except ValueError as exc:                 # too few populated ground windows
            rejected.append({"file": name, "reason": str(exc)})
            print(f"  {name}: REJECTED ({exc})")
            continue
        pooled.setdefault(ward, ([], [], []))
        pooled[ward][0].append(ero)
        pooled[ward][1].append(hag)
        pooled[ward][2].append(gate_nan)
        frames.append(fr)
        per_track.append({
            "file": name, "ward": ward, "date": sub["date"], "rgt": sub["rgt"],
            "beams": sub["beams"], "closest_m": sub["trackMinDistM"],
            "dem_minus_laser_ground_m": sub["demOffsetM"],
            "subset_counts": sub["counts"], "counts": ladder})
        print(f"  {name}: {ladder['buildings_crossed']} buildings crossed, "
              f"{ladder['photons_in_eroded_footprints']} roof photons, "
              f"{ladder['photons_outside_ground_span']} photons outside the "
              f"ground line's span, {ladder['ground_windows_gated']} ground "
              f"window(s) refused by the {_icesat2.GROUND_RELIEF_M:g} m relief "
              f"gate ({ladder['photons_over_gated_ground_windows']} photons)")

    ours: list[float] = []          # ICESat-2 p75 estimates, one per distinct building
    theirs: list[float] = []        # shipped artefact heights, the same buildings
    fill_rows: list[dict[str, Any]] = []
    per_ward: dict[str, Any] = {}
    cat: dict[str, tuple[I64, F64]] = {}      # pooled per ward, for floor_sensitivity
    n_crossed_pooled = 0
    causes_total = {"n_too_few_roof_ph": 0, "n_below_roof_band_floor": 0,
                    "n_ground_refused": 0, "n_outside_band_or_span": 0}
    lo_band, hi_band = _icesat2.ROOF_BAND_M
    for ward, (eros, hags, gnans) in sorted(pooled.items()):
        # Photons stacked across every pass of this ward BEFORE MIN_ROOF_PH, so a
        # building split 3/3 over two passes clears the bar as one building.
        ero = np.concatenate(eros)
        hag = np.concatenate(hags)
        gate_nan = np.concatenate(gnans)
        cat[ward] = (ero, hag)
        est = _icesat2.building_heights(ero, hag)
        crossed_ids = np.unique(ero[ero >= 0])
        crossed = int(crossed_ids.size)
        n_crossed_pooled += crossed
        heights = geom[ward][1]
        # WHY A CROSSED BUILDING DID NOT CONTRIBUTE, split by cause (spec §5.4).
        # The old single `n_below_min_roof_ph` blamed the photon count for every
        # one of them, so a building with 40 roof photons all sitting below the
        # 2.0 m floor was published as "too few photons" — which says more passes
        # would fix it, when in fact ICESat-2 measured it fine and the band
        # dropped it. The two exclusions mean opposite things and are counted
        # apart.
        # `n_ground_refused` is the same principle applied to this run's own
        # correction: a building whose roof photons lost their ground reference
        # to the pointwise relief gate is not "out of band", it is a building
        # standing where the ground could not be measured. More passes on the
        # same track would not fix it; mapping the missing buildings would.
        causes = {"n_too_few_roof_ph": 0, "n_below_roof_band_floor": 0,
                  "n_ground_refused": 0, "n_outside_band_or_span": 0}
        for bi in crossed_ids:
            b = int(bi)
            sel = ero == b
            v = hag[sel]
            n_gate_nan = int(gate_nan[sel].sum())
            vf = v[np.isfinite(v)]                 # NaN = outside the ground span
            free = vf[vf <= hi_band]               # floor removed, noise ceiling kept
            n_roof = int(v.size)
            if heights[b] == FILL_M:
                fill_rows.append({
                    "n_roof_ph": n_roof,
                    "n_below_floor": int((vf < lo_band).sum()),
                    # -inf, not NaN: a fill building with no usable roof photon
                    # is a `no` — absence of evidence above 2.5 m — and NaN would
                    # make the `> FILL_M` test False by accident rather than on
                    # purpose. Every crossed fill building must land somewhere.
                    "p75_floor_free_m": (float(np.quantile(free, 0.75))
                                         if free.size else -math.inf),
                    "excluded_by_floor": (b not in est
                                          and free.size >= _icesat2.MIN_ROOF_PH),
                })
            if b in est:
                ours.append(est[b])
                theirs.append(heights[b])
                continue
            if n_roof < _icesat2.MIN_ROOF_PH:
                causes["n_too_few_roof_ph"] += 1
            elif free.size >= _icesat2.MIN_ROOF_PH:
                causes["n_below_roof_band_floor"] += 1   # the floor removed it
            elif n_roof - n_gate_nan < _icesat2.MIN_ROOF_PH:
                causes["n_ground_refused"] += 1          # the relief gate did
            else:
                causes["n_outside_band_or_span"] += 1    # ceiling or NaN span
        for k, val in causes.items():
            causes_total[k] += val
        per_ward[ward] = {
            "n_passes": len(eros), "n_crossed": crossed, "n_buildings": len(est),
            "n_fill_crossed": sum(1 for b in crossed_ids
                                  if heights[int(b)] == FILL_M),
            "n_fill_measured": sum(1 for b in est if heights[b] == FILL_M),
            **causes}

    o = np.asarray(ours, dtype=np.float64)
    t = np.asarray(theirs, dtype=np.float64)
    n = int(o.size)
    n_rgts = len({str(tr["rgt"]) for tr in per_track})
    summary: dict[str, Any] = {"n_buildings": n,
                               # Passes and TRACKS are different facts and the
                               # old `n_tracks` reported the first as the second.
                               # Spec §3: a handful of reference ground tracks
                               # cross these wards and no granule can add one, so
                               # 31 passes are 31 revisits of n_rgts geometries.
                               "n_passes": len(per_track), "n_rgts": n_rgts,
                               "min_buildings": MIN_BUILDINGS}
    if n < MIN_BUILDINGS:
        # Deliberately no bias statistics below the bar. `quantile_bias` refuses
        # under 5 pairs outright, and between 5 and 29 its CI is wide and
        # unstable — publishing it beside an `underpowered` verdict would invite
        # quoting the number and dropping the verdict.
        summary["verdict"] = "underpowered"
        sens = None
    else:
        qb = _icesat2.quantile_bias(o, t, np.random.default_rng(SEED), boots=BOOTS)
        # The verdict is decided on the EXACT statistics and only then are they
        # rounded for publication. Rounding first put a true bias in
        # [3.195, 3.2) on the `biased` side of a 3.2 m threshold it is under.
        summary["verdict"] = verdict(qb)
        summary.update(for_display(qb))
        # Below the bar this stays absent for the same reason the biases do: it
        # IS bias statistics, and a sensitivity table beside `underpowered`
        # publishes the number the verdict withheld.
        sens = floor_sensitivity(cat, geom)

    fill = fill_cohort(fill_rows)

    excluded = {
        "buildings_in_ward": {w: len(geom[w][0]) for w in sorted(geom)},
        # The selection effect in one number: erosion by the geolocation error
        # deletes small buildings before the beam is even consulted.
        "buildings_survived_erosion": {tr["ward"]: tr["counts"]["buildings_survived_erosion"]
                                       for tr in per_track},
        "buildings_crossed_pooled": n_crossed_pooled,
        "buildings_not_measured": n_crossed_pooled - n,
        # ... and WHY, split by cause rather than all blamed on the photon count.
        **causes_total,
        "min_roof_photons": _icesat2.MIN_ROOF_PH,
        "erosion_m": _icesat2.ERODE_M,
        "roof_band_m": list(_icesat2.ROOF_BAND_M),
        "photons_outside_ground_span": sum(int(tr["counts"]["photons_outside_ground_span"])
                                           for tr in per_track),
        "roof_photons_outside_ground_span": sum(
            int(tr["counts"]["roof_photons_outside_ground_span"]) for tr in per_track),
        # THE POINTWISE RELIEF GATE'S OWN LEDGER (spec §5.1, CORRECTION
        # 2026-08-07). These photons are dropped, so §5.4 requires them counted,
        # and counted APART from the out-of-span ones above: those mean the track
        # was short, these mean an unmapped building filled a ground window with
        # roof photons and the line over it could not be trusted. Before the gate
        # existed these same photons were measured against a ground reference
        # standing on that roof — 5 of 31 passes carried a ground line above
        # +25 m, worst 84.68 m — and nothing counted anything.
        "ground_relief_m": _icesat2.GROUND_RELIEF_M,
        "ground_windows_populated": sum(int(tr["counts"]["ground_windows_populated"])
                                        for tr in per_track),
        "ground_windows_gated": sum(int(tr["counts"]["ground_windows_gated"])
                                    for tr in per_track),
        "passes_with_gated_ground_windows": sum(
            1 for tr in per_track if tr["counts"]["ground_windows_gated"]),
        "photons_over_gated_ground_windows": sum(
            int(tr["counts"]["photons_over_gated_ground_windows"]) for tr in per_track),
        "roof_photons_over_gated_ground_windows": sum(
            int(tr["counts"]["roof_photons_over_gated_ground_windows"])
            for tr in per_track),
        "roof_photons_in_band": sum(int(tr["counts"]["photons_in_roof_band"])
                                    for tr in per_track),
        # The floor's cost in photons, which the in-band total alone concealed.
        "roof_photons_below_band": sum(int(tr["counts"]["roof_photons_below_band"])
                                       for tr in per_track),
        "roof_photons_above_band": sum(int(tr["counts"]["roof_photons_above_band"])
                                       for tr in per_track),
        "subsets_rejected": rejected,
        "note": ("Buildings smaller than the 5 m erosion never enter, nor do "
                 f"crossed buildings under {_icesat2.MIN_ROOF_PH} roof photons "
                 "(n_too_few_roof_ph) — counted apart from those with photons "
                 "enough that the roof band's 2.0 m floor pushed under the bar "
                 "(n_below_roof_band_floor), because more passes would fix the "
                 "first and would not touch the second. Photons outside the "
                 "ground line's populated span are dropped rather than measured "
                 "against a flat extrapolation, and so are photons over a ground "
                 "window the pointwise relief gate refused — an unmapped building "
                 "can fill a 30 m window with roof photons and pin the ground "
                 "line tens of metres up (spec §5.1, CORRECTION 2026-08-07). The "
                 "two are counted apart because they say different things. The "
                 "crossed set over-represents "
                 "LARGE buildings — published wording must say 'along satellite "
                 "transects', not 'all buildings'."),
    }
    # PER DISTINCT RGT, not per pass. `demOffsetM` is a property of the ground
    # under a track, so medianing it over 31 passes of n_rgts tracks counts the
    # same ground over and over and reports a spread narrower than the evidence.
    by_rgt: dict[str, list[float]] = {}
    for tr in per_track:
        by_rgt.setdefault(str(tr["rgt"]), []).append(float(tr["dem_minus_laser_ground_m"]))
    rgt_meds = [round(float(np.median(v)), 2) for _, v in sorted(by_rgt.items())]
    per_rgt = {r: {"n_passes": len(by_rgt[r]),
                   "wards": sorted({tr["ward"] for tr in per_track
                                    if str(tr["rgt"]) == r}),
                   "dem_minus_laser_ground_m": med}
               for (r, med) in zip(sorted(by_rgt), rgt_meds)}
    terrain = {
        "dem_minus_laser_ground_m": round(float(np.median(rgt_meds)), 2) if rgt_meds else None,
        "n_rgts": n_rgts, "n_passes": len(per_track), "per_rgt": per_rgt,
        "note": ("Measured, not gated (spec §5.1): the shipped relief surface "
                 "sits this far ABOVE decimetre-class laser ground. The headline "
                 f"is the median over the {n_rgts} DISTINCT reference ground "
                 f"tracks, each of which is itself the median of that track's "
                 "passes — the 31 passes re-fly the same few ground tracks "
                 "(spec §3), so pooling them would weight one geometry by how "
                 "often it was re-flown. It is a smoothed DSM by its own note, "
                 "and it is used by nothing in the heat model; the height "
                 "comparison takes its ground line from the photons, never from "
                 "the DEM."),
    }

    out = {
        "summary": summary, "fill": fill, "per_ward": per_ward,
        "per_track": per_track, "excluded": excluded, "terrain": terrain,
        "floor_sensitivity": sens,
        "method_stability": method_stability(frames, geom),
        "note": ("Distributional comparison only — ATL03 geolocation (~3-5 m) "
                 "forbids per-building attribution, so the statistics compare "
                 "the two distributions' quantiles and no per-building height "
                 "is published. Verdicts and thresholds were pre-registered in "
                 "docs/superpowers/specs/2026-08-06-icesat2-height-validation-"
                 "design.md §5.3 before any of this was run — except the fill "
                 "cohort's statistic, amended 2026-08-07 and recorded in §5.3 "
                 "because the original could not return zero: the 2.0 m roof-"
                 "band floor deleted exactly the short buildings' evidence that "
                 "would have vindicated the fill. Photons are pooled per "
                 "building across repeat passes; n_buildings counts distinct "
                 "buildings, n_passes counts overpasses and n_rgts the distinct "
                 "reference ground tracks they re-fly. A repeat pass is not a "
                 "second row for the same building — its photons join that "
                 "building's pool — but nor is it confined to buildings already "
                 "in the cohort: beams wander up to 726 m across-track between "
                 "cycles (spec §3, CORRECTION 2026-08-07), which is why "
                 "Ballygunge's 12 passes crossed 50 distinct buildings. THIS RUN "
                 "SUPERSEDES THE 2026-08-06 ONE, which reported n=30 and a "
                 "`validated` verdict. That run's ground line was contaminated: "
                 "Overture does not map every building, and where a 30 m window "
                 "held nothing but roof photons from an unmapped one the two-pass "
                 "line settled on the roof — 5 of 31 passes carried a ground line "
                 "above +25 m, worst 84.68 m in a ward whose ground is 3-6 m. "
                 "Spec §5.1's G1b was written to catch that and could not, "
                 "because it tests the pass MEDIAN (4.46 m on that pass). The "
                 "gate is now applied pointwise (§5.1, CORRECTION 2026-08-07); "
                 "the marginal buildings it removes are the ones that had carried "
                 "n to the bar, so the honest n is below it and the pre-registered "
                 "outcome is `underpowered`. No bias, CI or omnibus statistic is "
                 "published at that verdict."),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"\n  {len(per_track)} passes used over {n_rgts} distinct reference "
          f"ground tracks, {len(rejected)} rejected")
    for ward, v in per_ward.items():
        print(f"  {ward:<12} {v['n_passes']} pass(es), {v['n_crossed']} crossed, "
              f"{v['n_buildings']} measured "
              f"({v['n_too_few_roof_ph']} under MIN_ROOF_PH="
              f"{_icesat2.MIN_ROOF_PH}, {v['n_below_roof_band_floor']} dropped by "
              f"the {_icesat2.ROOF_BAND_M[0]} m floor, "
              f"{v['n_ground_refused']} whose ground the relief gate refused, "
              f"{v['n_outside_band_or_span']} out of band/span), "
              f"{v['n_fill_crossed']} at the 2.5 m fill")
    print(f"  n={n} distinct crossed buildings (bar {MIN_BUILDINGS})")
    print(f"  roof photons: {excluded['roof_photons_in_band']} in band, "
          f"{excluded['roof_photons_below_band']} below the "
          f"{_icesat2.ROOF_BAND_M[0]} m floor, "
          f"{excluded['roof_photons_above_band']} above the ceiling, "
          f"{excluded['roof_photons_outside_ground_span']} outside the ground span")
    print(f"  relief gate ({_icesat2.GROUND_RELIEF_M:g} m, spec §5.1 CORRECTION "
          f"2026-08-07): {excluded['ground_windows_gated']} of "
          f"{excluded['ground_windows_populated']} ground windows refused across "
          f"{excluded['passes_with_gated_ground_windows']} of {len(per_track)} "
          f"passes, dropping {excluded['photons_over_gated_ground_windows']} "
          f"photons ({excluded['roof_photons_over_gated_ground_windows']} of them "
          "roof photons)")
    if "median_bias_m" in summary:
        print(f"  median bias {summary['median_bias_m']:+.2f} m "
              f"(95% CI {summary['median_ci95_m']}), "
              f"p65 {summary['p65_bias_m']:+.2f} m (CI {summary['p65_ci95_m']}), "
              f"p90 {summary['p90_bias_m']:+.2f} m (CI {summary['p90_ci95_m']})")
        print(f"  paired permutation p={summary['perm_p']}  (KS D={summary['ks_d']})")
    if sens is not None:
        print("  floor sensitivity (measured, the floor does not move):")
        for r in sens["floors"]:
            print(f"    floor {r['floor_m']:.1f} m{'*' if r['shipped'] else ' '} "
                  f"n={r['n_buildings']:<3} median {r['median_bias_m']:+.2f} "
                  f"p65 {r['p65_bias_m']:+.2f} p90 {r['p90_bias_m']:+.2f}")
    print(f"  fill cohort: {fill['n']} crossed fill buildings"
          + (f", {fill['n_above_fill']} show roof evidence above {FILL_M} m "
             f"= {fill['fraction_above_fill']:.0%} "
             f"(95% CI {fill['fraction_above_fill_ci95']})"
             if fill["verdict"] == "measured" else
             f" — underpowered (bar {MIN_FILL})")
          + f"; {fill['n_excluded_by_roof_band_floor']} of them excluded from the "
            f"main cohort by the {_icesat2.ROOF_BAND_M[0]} m floor, "
            f"{fill['n_below_min_roof_ph']} under MIN_ROOF_PH")
    if terrain["dem_minus_laser_ground_m"] is not None:
        print(f"  measured, not gated: ward DEM sits "
              f"{terrain['dem_minus_laser_ground_m']:+.2f} m above laser ground "
              f"(median over {n_rgts} distinct RGTs)")
    ms = out["method_stability"]
    print("  method stability (NOT results — every row is below the bar):")
    for r in ms["relief_allowances"]:
        print(f"    relief {r['relief_m']:>5.1f} m{'*' if r['shipped'] else ' '} "
              f"n={r['n_buildings']:<3} {r['verdict']}")
    for r in ms["ground_window_widths"]:
        print(f"    window {r['win_m']:>5.1f} m{'*' if r['shipped'] else ' '} "
              f"n={r['n_buildings']:<3} {r['verdict']}")
    print(f"\n  VERDICT: {summary['verdict']}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
