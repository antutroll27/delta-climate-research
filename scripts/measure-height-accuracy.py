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

EVERY EXCLUSION IS COUNTED (spec §5.4). Buildings too small to survive the 5 m
erosion, buildings crossed but under MIN_ROOF_PH, photons outside the ground
line's populated span (where `ground_line` returns NaN rather than extrapolating
flat), and any subset this script refused — all of them land in `excluded`.
Silent truncation reads as coverage.

SELECTION EFFECT, DISCLOSED. Erosion by the geolocation error deletes small
buildings outright, so the crossed set over-represents LARGE ones. The published
wording must say "along satellite transects", never "all buildings".
"""
from __future__ import annotations

import glob
import json
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
FILL_SEED = 11


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


def transect(sub: dict[str, Any], rings: list[list[float]]) -> tuple[I64, F64, dict[str, int]]:
    """One pass -> (per-photon eroded-footprint index, height above ground, ladder).

    Same three steps as the Task-3 diagnostic, in the same order: ground
    candidates are the photons OUTSIDE every footprint DILATED by the
    geolocation error, the two-pass ground line comes from those candidates
    alone, and roof photons are those inside footprints ERODED by it.

    The ground line is NaN outside its populated span, so `hag` is NaN there
    too. Those photons are dropped — `building_heights` drops them by itself,
    since every comparison against NaN is False — and the ladder COUNTS them,
    per spec §5.4."""
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
        "buildings_in_ward": len(rings),
        "buildings_survived_erosion": len(kept),
        "buildings_crossed": int(np.unique(ero[roof]).size),
    }
    return ero, hag, ladder


def fill_cohort(heights: list[float], rng: np.random.Generator) -> dict[str, Any]:
    """Win 2 (spec §5.3): what ICESat-2 makes of the buildings we ship at 2.5 m.

    Its own bar (MIN_FILL) and its own bootstrap CI, because its n is small and
    a CI borrowed from the main cohort would be read as covering it. The sorted
    heights are kept so `compute-far.py --icesat2-correction` can resample the
    cohort — a cohort-level correction, never a per-building edit."""
    d: dict[str, Any] = {"n": len(heights), "min_n": MIN_FILL}
    if len(heights) < MIN_FILL:
        d["verdict"] = "underpowered"
        return d
    fo = np.asarray(heights, dtype=np.float64)
    boots = np.median(fo[rng.integers(0, fo.size, (BOOTS, fo.size))], axis=1)
    d.update({
        "median_icesat2_m": round(float(np.median(fo)), 2),
        "understatement_m": round(float(np.median(fo)) - FILL_M, 2),
        "ci95_m": [round(float(np.quantile(boots, 0.025)), 2),
                   round(float(np.quantile(boots, 0.975)), 2)],
        "heights_m": [round(float(v), 2) for v in sorted(fo)],
        "verdict": "measured"})
    return d


def verdict(qb: dict[str, Any]) -> str:
    """Spec §5.3's pre-registered table, and nothing else.

    `validated` needs BOTH a sub-storey median bias and a CI inside ±2 storeys;
    `biased` needs a CI clear of zero AND a bias of at least a storey. Anything
    else is `inconclusive` — including the corners the table does not name (a
    sub-storey bias whose CI clears zero but not ±2 storeys, say). Naming a
    fifth outcome for those after seeing the data is exactly the re-tuning the
    pre-registration exists to prevent, so they fall to the honest one."""
    lo, hi = qb["median_ci95_m"]
    bias = float(qb["median_bias_m"])
    if abs(bias) < VALID_BIAS_M and -WIDE_CI_M < lo and hi < WIDE_CI_M:
        return "validated"
    if (lo > 0 or hi < 0) and abs(bias) >= VALID_BIAS_M:
        return "biased"
    return "inconclusive"


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
            # The §5.1 geoid gate lives in fetch-icesat2.py and every subset here
            # has already passed it; this script never re-runs it. But a subset
            # written before that rewrite cannot have passed it, and reading one
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
    fill_ours: list[float] = []
    per_ward: dict[str, Any] = {}
    n_crossed_pooled = 0
    for ward, (eros, hags) in sorted(pooled.items()):
        # Photons stacked across every pass of this ward BEFORE MIN_ROOF_PH, so a
        # building split 3/3 over two passes clears the bar as one building.
        ero = np.concatenate(eros)
        hag = np.concatenate(hags)
        est = _icesat2.building_heights(ero, hag)
        crossed = int(np.unique(ero[ero >= 0]).size)
        n_crossed_pooled += crossed
        heights = geom[ward][1]
        n_fill = 0
        for b, h in sorted(est.items()):
            ours.append(h)
            theirs.append(heights[b])
            if heights[b] == FILL_M:
                fill_ours.append(h)
                n_fill += 1
        per_ward[ward] = {
            "n_passes": len(eros), "n_crossed": crossed, "n_buildings": len(est),
            "n_below_min_roof_ph": crossed - len(est), "n_fill": n_fill}

    o = np.asarray(ours, dtype=np.float64)
    t = np.asarray(theirs, dtype=np.float64)
    n = int(o.size)
    summary: dict[str, Any] = {"n_buildings": n, "n_tracks": len(per_track),
                               "min_buildings": MIN_BUILDINGS}
    if n < MIN_BUILDINGS:
        # Deliberately no bias statistics below the bar. `quantile_bias` refuses
        # under 5 pairs outright, and between 5 and 29 its CI is wide and
        # unstable — publishing it beside an `underpowered` verdict would invite
        # quoting the number and dropping the verdict.
        summary["verdict"] = "underpowered"
    else:
        qb = _icesat2.quantile_bias(o, t, np.random.default_rng(SEED), boots=BOOTS)
        summary.update(qb)
        summary["verdict"] = verdict(qb)

    fill = fill_cohort(fill_ours, np.random.default_rng(FILL_SEED))

    offsets = [float(tr["dem_minus_laser_ground_m"]) for tr in per_track]
    excluded = {
        "buildings_in_ward": {w: len(geom[w][0]) for w in sorted(geom)},
        # The selection effect in one number: erosion by the geolocation error
        # deletes small buildings before the beam is even consulted.
        "buildings_survived_erosion": {tr["ward"]: tr["counts"]["buildings_survived_erosion"]
                                       for tr in per_track},
        "buildings_crossed_pooled": n_crossed_pooled,
        "buildings_below_min_roof_ph": n_crossed_pooled - n,
        "min_roof_photons": _icesat2.MIN_ROOF_PH,
        "erosion_m": _icesat2.ERODE_M,
        "roof_band_m": list(_icesat2.ROOF_BAND_M),
        "photons_outside_ground_span": sum(int(tr["counts"]["photons_outside_ground_span"])
                                           for tr in per_track),
        "roof_photons_outside_ground_span": sum(
            int(tr["counts"]["roof_photons_outside_ground_span"]) for tr in per_track),
        "subsets_rejected": rejected,
        "note": ("Buildings smaller than the 5 m erosion never enter, nor do "
                 f"crossed buildings under {_icesat2.MIN_ROOF_PH} roof photons; "
                 "photons outside the ground line's populated span are dropped "
                 "rather than measured against a flat extrapolation. The crossed "
                 "set therefore over-represents LARGE buildings — published "
                 "wording must say 'along satellite transects', not 'all "
                 "buildings'."),
    }
    terrain = {
        "dem_minus_laser_ground_m": round(float(np.median(offsets)), 2) if offsets else None,
        "n_tracks": len(offsets),
        "note": ("Measured, not gated (spec §5.1): the shipped relief surface "
                 "sits this far ABOVE decimetre-class laser ground. It is a "
                 "smoothed DSM by its own note, and it is used by nothing in the "
                 "heat model; the height comparison takes its ground line from "
                 "the photons, never from the DEM."),
    }

    out = {
        "summary": summary, "fill": fill, "per_ward": per_ward,
        "per_track": per_track, "excluded": excluded, "terrain": terrain,
        "note": ("Distributional comparison only — ATL03 geolocation (~3-5 m) "
                 "forbids per-building attribution, so the statistics compare "
                 "the two distributions' quantiles and no per-building height "
                 "is published. Verdicts and thresholds were pre-registered in "
                 "docs/superpowers/specs/2026-08-06-icesat2-height-validation-"
                 "design.md §5.3 before any of this was run. Photons are pooled "
                 "per building across repeat passes; n_buildings counts distinct "
                 "buildings."),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"\n  {len(per_track)} subsets used, {len(rejected)} rejected")
    for ward, v in per_ward.items():
        print(f"  {ward:<12} {v['n_passes']} pass(es), {v['n_crossed']} crossed, "
              f"{v['n_buildings']} cleared MIN_ROOF_PH={_icesat2.MIN_ROOF_PH} "
              f"({v['n_below_min_roof_ph']} did not), {v['n_fill']} at the 2.5 m fill")
    print(f"  n={n} distinct crossed buildings (bar {MIN_BUILDINGS})")
    if "median_bias_m" in summary:
        print(f"  median bias {summary['median_bias_m']:+.2f} m "
              f"(95% CI {summary['median_ci95_m']}), "
              f"p65 {summary['p65_bias_m']:+.2f} m (CI {summary['p65_ci95_m']}), "
              f"p90 {summary['p90_bias_m']:+.2f} m (CI {summary['p90_ci95_m']})")
        print(f"  paired permutation p={summary['perm_p']}  (KS D={summary['ks_d']})")
    print(f"  fill cohort: n={fill['n']}"
          + (f", median {fill['median_icesat2_m']} m, understates the 2.5 m fill "
             f"by {fill['understatement_m']} m (CI {fill['ci95_m']})"
             if fill["verdict"] == "measured" else
             f" — underpowered (bar {MIN_FILL})"))
    if terrain["dem_minus_laser_ground_m"] is not None:
        print(f"  measured, not gated: ward DEM sits "
              f"{terrain['dem_minus_laser_ground_m']:+.2f} m above laser ground")
    print(f"\n  VERDICT: {summary['verdict']}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
