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

REPEAT PASSES STACK PHOTONS, THEY DO NOT ADD BUILDINGS. Three reference ground
tracks cross the three wards and no granule can add a fourth (spec §3), so extra
passes revisit the SAME buildings. Photons are therefore pooled per building
across every pass of a ward before MIN_ROOF_PH is applied — which is precisely
the power repeat passes buy — and `n_buildings` counts DISTINCT buildings.
Concatenating each pass's estimates instead would let one building appear three
times and walk the pooled n toward the 30-building bar without a single new
building being measured.

THE PAIRED PERMUTATION TEST, NOT ks_2samp. `_icesat2.quantile_bias` returns
`perm_p`, not a KS p-value: the two samples are the same buildings measured
twice, so they are correlated and the two-sample KS null is false here. Measured
under H0 it rejected 0 times in 2,000 draws — it would have handed the model a
comfortable "no significant difference" no matter what the data said.

EVERY EXCLUSION IS COUNTED, AND ATTRIBUTED TO ITS OWN CAUSE (spec §5.4).
Buildings too small to survive the 5 m erosion, buildings crossed but under
MIN_ROOF_PH, buildings crossed with photons enough but pushed under the bar by
the roof band's 2.0 m FLOOR, roof photons dropped below and above that band,
photons outside the ground line's populated span (where `ground_line` returns
NaN rather than extrapolating flat), and any subset this script refused — all of
them land in `excluded`. Silent truncation reads as coverage, and so does a
truthful total filed under the wrong reason: a building with 40 roof photons all
below 2 m is not "too few photons", it is a building the floor removed, and the
two say opposite things about whether more passes would help.

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


def transect(sub: dict[str, Any], rings: list[list[float]]) -> tuple[I64, F64, dict[str, float]]:
    """One pass -> (per-photon eroded-footprint index, height above ground, ladder).

    Same three steps as the Task-3 diagnostic, in the same order: ground
    candidates are the photons OUTSIDE every footprint DILATED by the
    geolocation error, the two-pass ground line comes from those candidates
    alone, and roof photons are those inside footprints ERODED by it.

    The ground line is NaN outside its populated span, so `hag` is NaN there
    too. Those photons are dropped — `building_heights` drops them by itself,
    since every comparison against NaN is False — and the ladder COUNTS them,
    per spec §5.4.

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
    w = WARDS[sub["ward"]]
    ph = np.asarray(sub["ph"], dtype=np.float64)
    h_ortho = ph[:, 3]                     # column 3 is orthometric, 2 is ellipsoidal
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)

    dil, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil == -1
    g = _icesat2.ground_line(s, s[gnd], h_ortho[gnd])
    fin = np.isfinite(g)
    hag = h_ortho - g

    # The gate, re-run on THIS line. The median is over the finite line only, for
    # the same reason fetch-icesat2.py takes it that way: np.median of an array
    # holding one NaN is NaN, and check_geoid fails closed on NaN, so a single
    # out-of-span photon would reject good data for the wrong reason.
    ground_median = float(np.median(g[fin]))
    drift = ground_median - float(sub["groundMedianM"])
    if not abs(drift) <= GROUND_RECHECK_TOL_M:
        raise GroundLineDrift(
            f"recomputed ground median {ground_median:.3f} m differs from the "
            f"{sub['groundMedianM']} m this subset recorded when it passed the "
            f"§5.1 gate, by {drift:+.3f} m (tolerance {GROUND_RECHECK_TOL_M} m) "
            "— the photons or the committed footprints have moved under it, so "
            "the gate passed on a ground line this script no longer computes")
    _icesat2.check_geoid(ground_median, float(sub["geoidNM"]),
                         float(sub["granuleGeoidNM"]))

    ero, kept = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    roof = ero >= 0
    lo, hi = _icesat2.ROOF_BAND_M
    ladder = {
        "photons_in_subset": int(ph.shape[0]),
        "ground_candidates": int(gnd.sum()),
        "photons_outside_ground_span": int((~fin).sum()),
        "photons_in_eroded_footprints": int(roof.sum()),
        "roof_photons_outside_ground_span": int((roof & ~fin).sum()),
        "photons_in_roof_band": int((roof & (hag >= lo) & (hag <= hi)).sum()),
        # Both tails of the band, separately: the low one is the 2.0 m floor
        # deleting short buildings' evidence and it is the one that moves the
        # published bias, so recording only the in-band total hides it.
        "roof_photons_below_band": int((roof & fin & (hag < lo)).sum()),
        "roof_photons_above_band": int((roof & fin & (hag > hi)).sum()),
        "buildings_in_ward": len(rings),
        "buildings_survived_erosion": len(kept),
        "buildings_crossed": int(np.unique(ero[roof]).size),
        "ground_median_m": round(ground_median, 3),
        "ground_median_drift_m": round(drift, 3),
    }
    return ero, hag, ladder


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


def main() -> None:
    subs = sorted(glob.glob(os.path.join(SUB_DIR, "*.json")))
    if not subs:
        sys.exit("  no subsets in data/calibration/icesat2/ — run fetch-icesat2.py first")

    geom: dict[str, tuple[list[list[float]], list[float]]] = {}
    pooled: dict[str, tuple[list[I64], list[F64]]] = {}
    per_track: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []

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
            ero, hag, ladder = transect(sub, rings)
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
        pooled.setdefault(ward, ([], []))
        pooled[ward][0].append(ero)
        pooled[ward][1].append(hag)
        per_track.append({
            "file": name, "ward": ward, "date": sub["date"], "rgt": sub["rgt"],
            "beams": sub["beams"], "closest_m": sub["trackMinDistM"],
            "dem_minus_laser_ground_m": sub["demOffsetM"],
            "subset_counts": sub["counts"], "counts": ladder})
        print(f"  {name}: {ladder['buildings_crossed']} buildings crossed, "
              f"{ladder['photons_in_eroded_footprints']} roof photons, "
              f"{ladder['photons_outside_ground_span']} photons outside the "
              "ground line's span")

    ours: list[float] = []          # ICESat-2 p75 estimates, one per distinct building
    theirs: list[float] = []        # shipped artefact heights, the same buildings
    fill_rows: list[dict[str, Any]] = []
    per_ward: dict[str, Any] = {}
    cat: dict[str, tuple[I64, F64]] = {}      # pooled per ward, for floor_sensitivity
    n_crossed_pooled = 0
    causes_total = {"n_too_few_roof_ph": 0, "n_below_roof_band_floor": 0,
                    "n_outside_band_or_span": 0}
    lo_band, hi_band = _icesat2.ROOF_BAND_M
    for ward, (eros, hags) in sorted(pooled.items()):
        # Photons stacked across every pass of this ward BEFORE MIN_ROOF_PH, so a
        # building split 3/3 over two passes clears the bar as one building.
        ero = np.concatenate(eros)
        hag = np.concatenate(hags)
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
        causes = {"n_too_few_roof_ph": 0, "n_below_roof_band_floor": 0,
                  "n_outside_band_or_span": 0}
        for bi in crossed_ids:
            b = int(bi)
            v = hag[ero == b]
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
                 "against a flat extrapolation. The crossed set over-represents "
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
                 "reference ground tracks they re-fly — a repeat pass adds "
                 "photons to the same buildings, never a new transect."),
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
              f"{v['n_outside_band_or_span']} out of band/span), "
              f"{v['n_fill_crossed']} at the 2.5 m fill")
    print(f"  n={n} distinct crossed buildings (bar {MIN_BUILDINGS})")
    print(f"  roof photons: {excluded['roof_photons_in_band']} in band, "
          f"{excluded['roof_photons_below_band']} below the "
          f"{_icesat2.ROOF_BAND_M[0]} m floor, "
          f"{excluded['roof_photons_above_band']} above the ceiling, "
          f"{excluded['roof_photons_outside_ground_span']} outside the ground span")
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
    print(f"\n  VERDICT: {summary['verdict']}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
