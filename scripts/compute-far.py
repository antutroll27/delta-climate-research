#!/usr/bin/env python3
"""
Floor-Area Ratio per ward, for the DC-URS exposure pillar.

    python3 scripts/compute-far.py

FAR = total built floor area / land area. It is DC-URS's proxy for built
density, carrying 0.30 of the exposure pillar (dc-urs-source-of-truth.md §3).

FULLY OFFLINE. Uses the baked ward geometry already in the repo — Microsoft ML
footprints with Google Open Buildings 2.5D heights, the same file the 3D scene
renders from. No network, no credentials.

    public/heat-map/data/{ward}.json
      sizeM : ward footprint side, metres
      b     : [[height_m, x1, y1, x2, y2, …], …]  polygon vertices in metres,
              relative to the ward centre

STOREY HEIGHT. Floors are estimated as height / 3.2 m, floored at 1. The National
Building Code of India sets a 2.75 m minimum clear floor-to-ceiling height for
residential rooms; adding a slab and services puts a typical floor-to-floor at
roughly 3.0–3.3 m. 3.2 is the midpoint and is recorded as an ASSUMPTION, not a
measurement — it is the single largest source of uncertainty in this figure.

2.5 m IS A FILL VALUE, NOT A MEASUREMENT. Google Open Buildings writes 2.5 m
where it has no confident height. It is simultaneously the MINIMUM and the MODAL
height in all three wards — 4.0 % of Ballygunge's buildings, 6.5 % of
Barrackpore's, 10.8 % of Baruipur's — which is the signature of a default, not of
a real stock of uniformly 2.5 m buildings. Reporting min/median/max over it under
provenance "measured" would describe the fill, so those buildings are counted
separately and excluded from the height statistics.

Output: data/dc-urs/far.json

    python3 scripts/compute-far.py --icesat2-correction

A SENSITIVITY MODE, not a second way to compute FAR. It measures how far FAR
would move if the 2.5 m fill cohort were replaced by the height distribution
ICESat-2 actually measured over those buildings (spec §1 win 3, §5.3), and
writes data/calibration/far-icesat2-sensitivity.json. It never writes far.json
and never changes a shipped number.
"""
import argparse, json, os, statistics, sys
from typing import Any, NamedTuple, Sequence, TypedDict, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _types
from _types import FarFile, FarWard, WardId

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
# GEOM_DIR lets the geometry gate compute FAR over a STAGED candidate set.
# Defaults to the shipped path -- every existing caller is unaffected.
SHIPPED_GEOM = os.path.join(ROOT, "public", "heat-map", "data")
GEOM = os.environ.get("GEOM_DIR") or SHIPPED_GEOM
OUT = os.path.join(ROOT, "data", "dc-urs", "far.json")

# --icesat2-correction only.
HEIGHTS_SRC = os.path.join(ROOT, "data", "calibration", "icesat2-heights.json")
SENS_OUT = os.path.join(ROOT, "data", "calibration", "far-icesat2-sensitivity.json")

STOREY_M = 3.2          # assumption; see module docstring
MIN_FLOORS = 1

#: --icesat2-correction: seeded so the artefact is reproducible — a re-run must
#: not move ΔFAR. Same discipline as measure-height-accuracy.py's SEED.
FAR_SEED = 7
#: Spec §5.3 asks for ΔFAR across the storey bracket score-heights.py already
#: sweeps, so the reported shift cannot be an artefact of the 3.2 m assumption.
STOREY_TESTS = (2.9, 3.1, 3.3)
#: The self-check bar. far_baseline recomputed here must reproduce the committed
#: far.json to within this. It is a bug detector, NOT a tolerance to widen: the
#: two numbers come from the same data through the same helpers, so any daylight
#: between them means the sensitivity mode has drifted from ward_far.
BASELINE_TOL = 0.001

# Google Open Buildings' "no confident height" default; see module docstring.
# Matched exactly rather than with <=, because it is also the dataset minimum
# (verified: no building in any of the three wards sits below it), so a
# threshold test would only ever misclassify a genuine sub-2.5 m building.
FILL_HEIGHT_M = 2.5


class WardGeometry(TypedDict):
    """public/heat-map/data/{ward}.json — the baked 3D scene geometry."""
    sizeM: float
    b: list[list[float]]


def polygon_area(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Shoelace. Returns absolute area, so vertex winding does not matter."""
    n = len(xs)
    # xs and ys are the even and odd slices of one flat coordinate list, so an
    # even-length list leaves xs one longer than ys and ys[j] would IndexError
    # on the last vertex. Verified: zero such entries in the current data, which
    # is exactly why it must be a check and not an assumption.
    if n < 3 or n != len(ys):
        return 0.0
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(s) / 2.0


class WardBuildings(NamedTuple):
    """The buildings ward_far counts, at the areas and heights it counts them.

    Factored out so --icesat2-correction CANNOT drift from the shipped
    arithmetic: both modes consume this one admission pass, so an area formula
    or a skip rule can never live in one and not the other. The specific trap it
    closes is a sensitivity mode that silently keeps the degenerate and
    non-positive-height rows ward_far drops, and then reports a "baseline" FAR
    the shipped artefact never contained.

    `areas` and `heights` are index-aligned, in file order — the correction
    substitutes heights positionally, so that alignment is load-bearing.
    """
    land_m2: float
    areas: list[float]
    heights: list[float]
    degenerate: int
    nonpositive: int


def ward_buildings(path: str) -> WardBuildings:
    """Read one baked ward geometry and apply the admission rules, once."""
    with open(path) as fh:
        d = cast(WardGeometry, json.load(fh))
    side = float(d["sizeM"])

    areas: list[float] = []
    heights: list[float] = []
    degenerate = 0
    nonpositive = 0

    for b in d["b"]:
        h = float(b[0])
        coords = b[1:]
        xs = coords[0::2]
        ys = coords[1::2]
        a = polygon_area(xs, ys)
        if a <= 0:
            degenerate += 1
            continue
        # max(MIN_FLOORS, ...) would turn a zero or negative height into a
        # 1-storey building contributing its full footprint to the floor area —
        # a fabricated storey from a missing measurement. Skip it instead.
        if h <= 0:
            nonpositive += 1
            continue
        areas.append(a)
        heights.append(h)

    return WardBuildings(side * side, areas, heights, degenerate, nonpositive)


def floors_for(h: float, storey_m: float = STOREY_M) -> int:
    """Storeys for one building — the single definition both modes call."""
    return max(MIN_FLOORS, round(h / storey_m))


def far_of(w: WardBuildings, heights: Sequence[float],
           storey_m: float = STOREY_M) -> float:
    """FAR for one ward under an arbitrary height vector, w.areas-aligned.

    Accumulates in the same order as ward_far's loop over the same list, so
    passing `w.heights` reproduces the shipped FAR to the last bit rather than
    merely to a tolerance — which is what makes the baseline self-check in
    --icesat2-correction a real check and not a rounding coincidence.
    """
    floor_m2 = 0.0
    for a, h in zip(w.areas, heights):
        floor_m2 += a * floors_for(h, storey_m)
    return floor_m2 / w.land_m2


def ward_far(path: str) -> FarWard:
    w = ward_buildings(path)
    land_m2 = w.land_m2

    footprint_m2 = 0.0
    floor_m2 = 0.0
    heights: list[float] = []       # MEASURED heights only — fill excluded
    floors_seen: list[int] = []
    at_fill = 0

    for a, h in zip(w.areas, w.heights):
        floors = floors_for(h)
        footprint_m2 += a
        floor_m2 += a * floors
        floors_seen.append(floors)
        # FAR is unaffected by the fill: round(2.5 / 3.2) == 1 == MIN_FLOORS, so
        # a fill-height building contributes exactly the single storey it would
        # have contributed anyway. Only the height statistics are corrupted by
        # it, so only they exclude it.
        if h == FILL_HEIGHT_M:
            at_fill += 1
        else:
            heights.append(h)

    if not heights:
        raise SystemExit(f"{path}: every building carries the {FILL_HEIGHT_M} m fill "
                         f"height — there is no measured height distribution to report")

    return {
        "far": round(floor_m2 / land_m2, 4),
        "built_fraction": round(footprint_m2 / land_m2, 4),
        "buildings": len(floors_seen),
        "degenerate_polygons": w.degenerate,
        "land_m2": land_m2,
        "footprint_m2": round(footprint_m2),
        "floor_m2": round(floor_m2),
        # min/median/max describe the MEASURED buildings only. n_at_fill_value
        # and n_nonpositive are carried here, beside the statistics they were
        # removed from, so the exclusion is visible to anyone reading the block.
        "height_m": {
            "min": round(min(heights), 1), "median": round(statistics.median(heights), 1),
            "max": round(max(heights), 1),
            "n_measured": len(heights),
            "fill_value": FILL_HEIGHT_M,
            "n_at_fill_value": at_fill,
            "n_nonpositive": w.nonpositive,
        },
        "floors": {
            "median": statistics.median(floors_seen), "max": max(floors_seen),
        },
    }


def committed_far() -> dict[WardId, float]:
    """The FAR the repo actually ships, read back for the baseline self-check.

    Read from the artefact rather than recomputed: recomputing would compare the
    new code path against itself and pass no matter how far it had drifted.
    """
    if not os.path.exists(OUT):
        raise SystemExit(f"{os.path.relpath(OUT, ROOT)} not found — run "
                         "`python3 scripts/compute-far.py` first; the "
                         "sensitivity mode checks itself against it")
    with open(OUT) as fh:
        far = cast(FarFile, json.load(fh))
    return {w: float(v["far"]) for w, v in far["wards"].items()}


def icesat2_sensitivity() -> None:
    """ΔFAR if the 2.5 m fill cohort is drawn from ICESat-2 (spec §1 win 3, §5.3).

    COHORT-LEVEL, NEVER PER BUILDING. ATL03 horizontal geolocation (~3–5 m) is a
    large fraction of a 10–20 m Kolkata building, so spec §1 forbids attributing
    a photon to a named building. Each fill building therefore draws from the
    measured cohort's EMPIRICAL distribution with a seeded RNG; no building is
    told what its own height is, and nothing here edits a geometry artefact.

    UNDERPOWERED IS A FIRST-CLASS OUTCOME, not an error. If the fill cohort has
    not reached its n >= 10 bar, this writes a valid artefact saying no
    correction is computable — it does not fabricate a pool, and it does not
    fall back to the main cohort, whose buildings are the LARGE ones that
    survived 5 m erosion and are exactly the population the fill is not.

    THE BASELINE IS THE SELF-CHECK. `far_baseline` is recomputed here from the
    same geometry through the same helpers, then compared against the committed
    far.json. The two must agree to BASELINE_TOL; disagreement is a drift bug in
    this function, never a tolerance to relax.
    """
    # Imported here, not at module scope: the shipped FAR path has always been
    # pure-stdlib and offline, and a top-level numpy would make every caller of
    # the normal mode depend on a package it does not use.
    import numpy as np

    if not os.path.exists(HEIGHTS_SRC):
        raise SystemExit(f"{os.path.relpath(HEIGHTS_SRC, ROOT)} not found — run "
                         "`python3 scripts/measure-height-accuracy.py` first")
    with open(HEIGHTS_SRC) as fh:
        meas = cast(dict[str, Any], json.load(fh))
    fill = cast(dict[str, Any], meas.get("fill") or {})
    fill_verdict = str(fill.get("verdict", "underpowered"))
    pool = [float(v) for v in fill.get("heights_m") or []]
    # Both conditions, not just the verdict: a "measured" verdict with an empty
    # or absent heights_m would otherwise reach rng.choice and raise on an empty
    # array, turning a data problem into a crash instead of an honest artefact.
    computable = fill_verdict == "measured" and len(pool) > 0

    wards: list[WardId] = sorted(_types.WARDS)
    missing = [w for w in wards if not os.path.exists(os.path.join(GEOM, f"{w}.json"))]
    if missing:
        raise SystemExit(f"ward geometry missing in {GEOM}: {', '.join(missing)}")
    shipped = committed_far()
    absent = [w for w in wards if w not in shipped]
    if absent:
        raise SystemExit(f"{os.path.relpath(OUT, ROOT)} has no FAR for "
                         f"{', '.join(absent)} — nothing to check the baseline against")

    rng = np.random.default_rng(FAR_SEED)
    out_wards: dict[str, Any] = {}
    worst_diff = 0.0

    for w in wards:
        g = ward_buildings(os.path.join(GEOM, f"{w}.json"))
        base = far_of(g, g.heights)
        diff = abs(round(base, 4) - shipped[w])
        worst_diff = max(worst_diff, diff)
        n_fill = sum(1 for h in g.heights if h == FILL_HEIGHT_M)

        rec: dict[str, Any] = {
            "far_baseline": round(base, 4),
            "far_committed": shipped[w],
            "baseline_abs_diff": round(diff, 6),
            "buildings": len(g.heights),
            "n_at_fill_value": n_fill,
            "fill_fraction": round(n_fill / len(g.heights), 4) if g.heights else 0.0,
            "far_corrected": None,
            "delta_far": None,
            "delta_pct": None,
            "storey_bracket": {},
        }

        if computable and n_fill:
            draws = iter(float(v) for v in
                         rng.choice(np.asarray(pool, dtype=np.float64), size=n_fill))
            # Positional substitution over the SAME admitted list far_of scores,
            # so corrected and baseline differ in the fill heights and in
            # nothing else -- no re-read, no re-filter, no re-ordering.
            corrected = [next(draws) if h == FILL_HEIGHT_M else h for h in g.heights]
            corr = far_of(g, corrected)
            rec["far_corrected"] = round(corr, 4)
            rec["delta_far"] = round(corr - base, 4)
            rec["delta_pct"] = round(100.0 * (corr - base) / base, 2) if base > 0 else None
            # One draw, swept across the bracket: the storey height must not
            # change which buildings were resampled, only what they are worth.
            bracket: dict[str, Any] = {}
            for s in STOREY_TESTS:
                b_s = far_of(g, g.heights, s)
                c_s = far_of(g, corrected, s)
                bracket[f"{s:.1f}"] = {
                    "far_baseline": round(b_s, 4), "far_corrected": round(c_s, 4),
                    "delta_pct": round(100.0 * (c_s - b_s) / b_s, 2) if b_s > 0 else None,
                }
            rec["storey_bracket"] = bracket

        out_wards[w] = rec

    staged = os.path.abspath(GEOM) != os.path.abspath(SHIPPED_GEOM)
    passed = worst_diff <= BASELINE_TOL
    if not passed and not staged:
        raise SystemExit(
            f"BASELINE SELF-CHECK FAILED: recomputed far_baseline differs from "
            f"{os.path.relpath(OUT, ROOT)} by {worst_diff:.6f} > {BASELINE_TOL}. "
            "This mode has drifted from ward_far — fix the reconciliation, do "
            "NOT widen the tolerance.")
    if not passed:
        print(f"  !! WARNING: baseline differs from {os.path.relpath(OUT, ROOT)} "
              f"by {worst_diff:.6f} — expected, GEOM_DIR is staged at {GEOM}")

    note = [
        "Cohort-level sensitivity measurement. It does NOT change any shipped "
        "FAR: data/dc-urs/far.json is untouched by this mode.",
        "No per-building attribution (spec §1): each 2.5 m fill building draws "
        f"from the measured cohort's empirical distribution, seeded rng({FAR_SEED}), "
        "so the artefact is reproducible and no individual height is claimed.",
        f"far_baseline is recomputed from {os.path.relpath(GEOM, ROOT)} through the "
        f"same helpers as ward_far and checked against {os.path.relpath(OUT, ROOT)} "
        f"at {BASELINE_TOL}; that equality is what proves this mode did not drift.",
    ]
    if computable:
        note.append(
            "EXCHANGEABILITY ASSUMPTION, stated not hidden: the measured fill "
            "cohort comes only from the wards the ICESat-2 transects crossed, "
            "and it is applied to the fill in all three wards. That assumes the "
            "2.5 m fill population is exchangeable across wards. It is an "
            "assumption, not a measurement, and it is the largest uncertainty "
            "in the numbers below after the storey height.")
        note.append(
            "The crossed set over-represents LARGE buildings (5 m footprint "
            "erosion drops small ones), so the drawn pool is, if anything, "
            "biased high — read delta_pct as an upper bound on the shift.")
    else:
        note.append(
            f"NO CORRECTION COMPUTABLE: the fill cohort in "
            f"{os.path.relpath(HEIGHTS_SRC, ROOT)} is '{fill_verdict}' at "
            f"n={fill.get('n', 0)} (bar: n >= {fill.get('min_n', 10)}), so "
            "far_corrected is null. A pool was NOT invented and the main "
            "cohort was NOT substituted — its buildings are the large ones "
            "that survived erosion, which is precisely the population the fill "
            "is not. The baseline and the fill counts below are still real "
            "measurements; when the transect sweep powers the cohort, this same "
            "code path produces the correction with no change.")

    out: dict[str, Any] = {
        "source": "data/calibration/icesat2-heights.json (ICESat-2 ATL03 fill "
                  "cohort) against Google Open Buildings 2.5D heights on "
                  "Microsoft ML footprints",
        "method": "FAR recomputed with every height == 2.5 m replaced by a draw "
                  "from the measured fill cohort; all other heights, the "
                  "footprint areas, the land area and the storey rule are "
                  "ward_far's, unchanged",
        "verdict": "measured" if computable else "no_correction_computable",
        "fill_value_m": FILL_HEIGHT_M,
        "storey_m": STOREY_M,
        "storey_bracket_m": list(STOREY_TESTS),
        "seed": FAR_SEED,
        "fill_cohort": {
            "verdict": fill_verdict,
            "n": fill.get("n", 0),
            "min_n": fill.get("min_n"),
            "median_icesat2_m": fill.get("median_icesat2_m"),
            "understatement_m": fill.get("understatement_m"),
            "ci95_m": fill.get("ci95_m"),
        },
        "baseline_check": {
            "reference": os.path.relpath(OUT, ROOT),
            "geom_dir": os.path.relpath(GEOM, ROOT),
            "tolerance": BASELINE_TOL,
            "max_abs_diff": round(worst_diff, 6),
            "pass": passed,
        },
        "wards": out_wards,
        "note": " ".join(note),
    }

    os.makedirs(os.path.dirname(SENS_OUT), exist_ok=True)
    with open(SENS_OUT, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"  fill cohort: {fill_verdict}, n={fill.get('n', 0)}"
          + (f", median {fill.get('median_icesat2_m')} m" if computable else
             " — no correction computable, artefact says so"))
    print(f"  {'ward':<14}{'baseline':>10}{'shipped':>10}{'diff':>9}"
          f"{'corrected':>11}{'Δ%':>8}")
    for wname, v in out_wards.items():
        c_txt = "—" if v["far_corrected"] is None else f"{v['far_corrected']:.4f}"
        d_txt = "—" if v["delta_pct"] is None else f"{v['delta_pct']:+.2f}"
        print(f"  {wname:<14}{v['far_baseline']:>10.4f}{v['far_committed']:>10.4f}"
              f"{v['baseline_abs_diff']:>9.6f}{c_txt:>11}{d_txt:>8}")
    print(f"  baseline self-check: {'PASS' if passed else 'FAIL'} "
          f"(max |diff| {worst_diff:.6f} <= {BASELINE_TOL})")
    print(f"\n  written to {os.path.relpath(SENS_OUT, ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--icesat2-correction", action="store_true",
                    help="measure ΔFAR with the 2.5 m fill cohort resampled from "
                         "the measured ICESat-2 distribution; writes "
                         "data/calibration/far-icesat2-sensitivity.json and "
                         "leaves data/dc-urs/far.json untouched")
    args = ap.parse_args()
    if args.icesat2_correction:
        icesat2_sensitivity()
        return

    # The canonical list, NOT a directory glob. This used to enumerate every
    # *.json that was not -roads.json, which silently treated each new sibling
    # artefact -- water, terrain, dc-urs-inputs, surface-meta -- as a ward and
    # crashed on the first one whose shape it did not expect. Adding an exclusion
    # per artefact is a treadmill; naming the three wards is the answer.
    wards: list[WardId] = sorted(_types.WARDS)
    missing = [w for w in wards if not os.path.exists(os.path.join(GEOM, f"{w}.json"))]
    if missing:
        raise SystemExit(f"ward geometry missing in {GEOM}: {', '.join(missing)}")

    out: FarFile = {
        "source": "Microsoft ML Building Footprints (ODbL) + Google Open Buildings 2.5D heights (CC BY 4.0)",
        "method": "FAR = Σ(footprint area × floors) / land area; shoelace polygon area",
        "assumption": f"floors = round(height / {STOREY_M} m), min {MIN_FLOORS}. "
                      "3.2 m floor-to-floor is the midpoint of the 3.0–3.3 m typical range implied "
                      "by the National Building Code of India's 2.75 m minimum clear height plus "
                      "slab and services. This is the largest single uncertainty in FAR.",
        "provenance": "measured",
        "wards": {},
    }
    for w in wards:
        out["wards"][w] = ward_far(os.path.join(GEOM, f"{w}.json"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"  {'ward':<14}{'FAR':>7}{'built':>8}{'bldgs':>8}{'med h':>8}{'med flr':>9}")
    for w, v in out["wards"].items():
        print(f"  {w:<14}{v['far']:>7.2f}{v['built_fraction']:>8.2f}"
              f"{v['buildings']:>8}{v['height_m']['median']:>8.1f}{v['floors']['median']:>9.0f}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
