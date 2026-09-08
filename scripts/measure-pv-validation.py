#!/usr/bin/env python3
"""Step two of the pre-registered rooftop study: SCORE the predictions against real bills.

    python3 scripts/measure-pv-validation.py \
        --predictions data/calibration/pv-validation-predictions.json \
        --measured    data/calibration/pv-validation-measured.csv \
        --out         data/calibration/pv-validation-2026-10-01.json
    python3 scripts/measure-pv-validation.py --self-check     # offline, temp files

WHAT THIS DOES, AND ONLY THIS. It applies §4's exclusions by rule name, forms §3's
statistics over the months the measured export and the prediction have in COMMON, and
writes every one of them — including the ones that fail — into a dated result file
alongside the commit that carried the predictions. Then, and only if n >= 25, it asks
`build-pv-yield.py --validated` to write the card's `tiers.validated` slot. Below 25 it
prints why it did not, because a silent no-op is how a result quietly becomes a claim.

THE MONTHS THE TWO HAVE IN COMMON. An owner's export often covers fewer months than the
roster declared, and the ratio must not compare eleven measured months against a twelve
month prediction. The predictions file carries PER-MONTH values for exactly this reason,
so the comparison is an exact sum over the shared months on both sides — never an annual
figure rescaled after the fact.

WHAT IS NOT DONE HERE. No roof is dropped for being a poor fit, no statistic is chosen
after seeing the data, and nothing is re-run at a different tilt to see if it looks
better. §3 and §4 were fixed before recruitment; this script is their execution, and any
change to them is a dated amendment in the pre-registration, not an edit here.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from typing import Any, Mapping, Sequence

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)

import pv_validation_lib as lib  # noqa: E402

PREDICTIONS = os.path.join(ROOT, "data", "calibration", "pv-validation-predictions.json")
MEASURED = os.path.join(ROOT, "data", "calibration", "pv-validation-measured.csv")
CHAIN = os.path.join(HERE, "build-pv-yield.py")

#: §4's target and floor. Neither gates this script — the result is written whatever n is
#: — but both are recorded beside it so no number is ever read without its n.
TARGET_N = 30
PUBLICATION_FLOOR_N = 10

#: THE CARD GATE (§6.3), owned by the chain and imported, never re-typed here. It is 25,
#: and so is `lib.SKILL_MIN_N` (§3's shading-skill declaration) — but they are two
#: pre-registered decisions that merely agree today. This script gates the CARD on this
#: one, so an amendment moving the skill threshold cannot silently un-gate the card, or
#: the reverse. If they ever diverge, nothing here needs changing.
CARD_MIN_N: int = lib.VALIDATED_MIN_N


def _kwh_by_month(row: Mapping[str, Any]) -> dict[str, float]:
    """§5's `kwh_by_month` cell: a JSON list of [YYYY-MM, kWh] inside one CSV field."""
    raw = row.get("kwh_by_month") or "[]"
    parsed: Any = json.loads(raw) if isinstance(raw, str) else raw
    return {str(pair[0]): float(pair[1]) for pair in parsed}


def measure(predictions_path: str, measured_path: str, out_path: str, *,
            write_artefacts: bool = True) -> dict[str, Any]:
    with open(predictions_path, encoding="utf-8") as fh:
        pred_file: dict[str, Any] = json.load(fh)
    by_id: dict[str, dict[str, Any]] = {r["roof_id"]: r for r in pred_file["roofs"]}
    with open(measured_path, newline="", encoding="utf-8") as fh:
        rows: list[Mapping[str, Any]] = list(csv.DictReader(fh))

    kept, by_rule = lib.apply_exclusions(rows)

    preds: dict[str, lib.RoofPrediction] = {}
    meas: dict[str, lib.RoofMeasured] = {}
    months_used: dict[str, list[str]] = {}
    unscorable: dict[str, str] = {}
    wards: set[str] = set()
    for row in kept:
        rid = str(row["roof_id"])
        pred = by_id.get(rid)
        if pred is None:
            # NOT a §4 exclusion — §4's five rules are about the data, this is about the
            # roster. Recorded separately so the two can never be confused in the tally.
            unscorable[rid] = "no prediction was registered for this roof"
            continue
        measured_months = _kwh_by_month(row)
        shared = sorted(set(measured_months) & set(pred["by_month"]))
        if not shared:
            unscorable[rid] = "no month is shared with the prediction"
            continue
        capacity = float(row["kwp_dc"])
        preds[rid] = {
            "y_pred": sum(pred["by_month"][m]["y_pred"] for m in shared),
            "y_scr": sum(pred["by_month"][m]["y_scr"] for m in shared),
            "y_null": sum(pred["by_month"][m]["y_null"] for m in shared),
            "kwp": float(pred["kwp"]), "loss": float(pred["loss"])}
        meas[rid] = {"y_meas": sum(measured_months[m] for m in shared) / capacity,
                     "capacity_kwp": capacity, "months": len(shared)}
        months_used[rid] = shared
        wards.add(str(pred["ward"]))

    stats = lib.score(preds, meas)
    n = int(stats["n"])
    month_counts = [meas[rid]["months"] for rid in stats["roof_ids"]]
    median_months = float(np.median(np.asarray(month_counts, dtype=float))) if month_counts else 0.0

    result: dict[str, Any] = {
        "date": dt.date.today().isoformat(),
        "prereg": pred_file.get("prereg"),
        "prereg_blob_sha": pred_file.get("prereg_blob_sha"),
        "predictions": os.path.relpath(predictions_path, ROOT),
        # §6.1's receipt: the commit that carried the predictions into the repository. If
        # it reads "uncommitted", the predictions were not registered before this ran and
        # the result is not a pre-registered one.
        "predictions_commit": lib.git_commit_of(predictions_path),
        "predictions_after_measured": bool(pred_file.get("predictions_after_measured")),
        "measured": os.path.relpath(measured_path, ROOT),
        "measured_sha256": lib.sha256_of(measured_path),
        "wards": sorted(wards),
        "recruitment": {"rows_submitted": len(rows), "target_n": TARGET_N,
                        "publication_floor_n": PUBLICATION_FLOOR_N,
                        "meets_publication_floor": n >= PUBLICATION_FLOOR_N},
        "exclusions": {"by_rule": by_rule,
                       "rules": list(lib.EXCLUSION_RULES),
                       "total": sum(len(v) for v in by_rule.values()),
                       "unscorable_not_a_rule": unscorable},
        "months_used": months_used,
        "median_months": median_months,
        # §7, stated with the result and not in a footnote: the roofs that got solar are
        # the good roofs, so the sample flatters the screen; the artefact's shading loss
        # is annual and some roofs are measured across a season; soiling is not separable
        # from shading and is not corrected for.
        "known_biases": ["selection: recruited roofs are self-selected good roofs, and the "
                         "direction of that bias is towards flattering the screen",
                         "annual shading loss applied to partial years — small, sign unknown",
                         "soiling is not separable from shading and is not corrected"],
        **stats,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)

    result["card_slot_written"] = False
    if n >= CARD_MIN_N:
        if write_artefacts:
            for ward in sorted(wards):
                subprocess.run([sys.executable, CHAIN, "--validated", out_path,
                                "--ward", ward], check=True, cwd=ROOT)
        result["card_slot_written"] = True
    else:
        print(f"  tiers.validated NOT written: n={n}, and the pre-registration (§6.3) "
              f"validates the card's yield band only at n >= {CARD_MIN_N}. "
              "The card keeps saying it has not been compared to real rooftops.")
    return result


# ── the self-check ──────────────────────────────────────────────────────────


def _self_check() -> None:
    """This script's own I/O end to end, on temp files, with synthetic roofs whose answer
    is known. No artefact under public/ is written: `write_artefacts=False` holds the
    chain call back, and the n < 25 branch is exercised for real."""
    with tempfile.TemporaryDirectory() as tmp:
        months = [f"2025-{m:02d}" for m in range(1, 13)]
        roofs: list[dict[str, Any]] = []
        want = [0.9, 1.0, 1.1, 1.2, 0.8]
        for i, _ in enumerate(want):
            roofs.append({
                "roof_id": f"R{i}", "ward": "testville", "building_idx": i,
                "tilt_deg": 22.0, "azimuth_deg": 180.0, "months": months,
                "kwp": 10.0, "loss": 0.05 * i, "loss_strict": 0.02 * i,
                "y_pred": 1200.0, "y_scr": 1200.0, "y_null": 1200.0,
                "by_month": {m: {"y_pred": 100.0, "y_scr": 100.0, "y_null": 100.0,
                                 "days": 30} for m in months}})
        # A sixth roof, excluded by §4 before any statistic sees it.
        roofs.append({**roofs[0], "roof_id": "SHORT", "building_idx": 9})
        predictions = os.path.join(tmp, "predictions.json")
        with open(predictions, "w", encoding="utf-8") as fh:
            json.dump({"generated": "2026-09-07", "prereg": "spec.md",
                       "prereg_blob_sha": "0" * 40,
                       "predictions_after_measured": False, "roofs": roofs}, fh)

        measured = os.path.join(tmp, "measured.csv")
        with open(measured, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["roof_id", "ward", "building_idx", "kwp_dc", "months_covered",
                        "kwh_by_month", "outage_days_declared", "notes"])
            for i, r in enumerate(want):
                # P_i = 5 kWp on a 10 kWp roof for four roofs; the fifth carries 15 kWp,
                # which is c = 1.5 and a hard failure of the geometry model (§3, Q2).
                capacity = 15.0 if i == 0 else 5.0
                per_month = 1200.0 * r * capacity / 12.0
                w.writerow([f"R{i}", "testville", i, capacity, ";".join(months),
                            json.dumps([[m, per_month] for m in months]), 0, ""])
            # Four months only: excluded by min_months_6, by rule name.
            w.writerow(["SHORT", "testville", 9, 5.0, ";".join(months[:4]),
                        json.dumps([[m, 400.0] for m in months[:4]]), 0, ""])

        out = os.path.join(tmp, "result.json")
        got = measure(predictions, measured, out, write_artefacts=False)

        assert os.path.exists(out), "the result file must be written"
        with open(out, encoding="utf-8") as fh:
            written: dict[str, Any] = json.load(fh)
        assert written["n"] == 5, written["n"]
        # The pre-registered five: median, spread, MAPE, the pass mark, statistic 4.
        assert written["median_ratio"] == 1.0, written["median_ratio"]
        assert written["within_15pct_share"] == 0.6, written["within_15pct_share"]
        assert written["mape"] == 0.12, written["mape"]
        assert written["pass_mark"]["passes"] is False
        assert written["screened_median_ratio"] == 1.0, written["screened_median_ratio"]
        assert written["shading_skill"] == {"status": "underpowered", "n": 5}
        # §4, by rule name — and the excluded roof is not in the statistics.
        assert written["exclusions"]["by_rule"]["min_months_6"] == ["SHORT"], \
            written["exclusions"]["by_rule"]
        assert "SHORT" not in written["ratios"]
        # Q2's hard failure, named rather than averaged away.
        assert written["capacity"]["hard_failures"] == ["R0"], written["capacity"]
        assert written["capacity"]["ratios"]["R0"] == 1.5
        assert written["median_months"] == 12.0
        assert written["measured_sha256"] and written["predictions_commit"]
        # Below 25, the card's slot is NOT written and the reason is printed.
        assert got["card_slot_written"] is False, "n=5 must not write tiers.validated"

        # n IS WHAT WAS SCORED. A roof whose registered prediction is zero still MATCHES
        # a measurement — it just cannot form a ratio — so `matched` must rise and `n`
        # must not. A published n sitting beside a pass mark computed on fewer roofs is
        # exactly what §8 forbids.
        with open(predictions, encoding="utf-8") as fh:
            pf: dict[str, Any] = json.load(fh)
        pf["roofs"].append({**roofs[0], "roof_id": "ZERO", "building_idx": 8,
                            "y_pred": 0.0,
                            "by_month": {m: {"y_pred": 0.0, "y_scr": 100.0,
                                             "y_null": 100.0, "days": 30}
                                         for m in months}})
        zeroed = os.path.join(tmp, "predictions-zero.json")
        with open(zeroed, "w", encoding="utf-8") as fh:
            json.dump(pf, fh)
        with open(measured, encoding="utf-8") as fh:
            zrows = list(csv.DictReader(fh))
        zrows.append({**zrows[0], "roof_id": "ZERO", "building_idx": "8"})
        zmeasured = os.path.join(tmp, "measured-zero.csv")
        with open(zmeasured, "w", newline="", encoding="utf-8") as fh:
            dw0 = csv.DictWriter(fh, fieldnames=list(zrows[0].keys()))
            dw0.writeheader()
            dw0.writerows(zrows)
        counted = measure(zeroed, zmeasured, os.path.join(tmp, "result-zero.json"),
                          write_artefacts=False)
        assert counted["n"] == 5, counted["n"]
        assert counted["matched"] == 6, counted["matched"]
        assert "ZERO" not in counted["roof_ids"] and "ZERO" in counted["matched_roof_ids"]
        assert counted["within_15pct_share"] == written["within_15pct_share"], \
            "a roof that could not be scored must not move the pass mark"

        # The months the two have in COMMON: drop three months from one owner's export
        # and both sides must shorten together, leaving the ratio unchanged.
        with open(measured, encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        rows[1]["months_covered"] = ";".join(months[:9])
        rows[1]["kwh_by_month"] = json.dumps(
            [[m, 1200.0 * 1.0 * 5.0 / 12.0] for m in months[:9]])
        with open(measured, "w", newline="", encoding="utf-8") as fh:
            dw = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            dw.writeheader()
            dw.writerows(rows)
        shortened = measure(predictions, measured, out, write_artefacts=False)
        assert shortened["ratios"]["R1"] == 1.0, \
            ("a shorter export must shorten the prediction with it, not be compared "
             f"against a full year: {shortened['ratios']['R1']}")
        assert shortened["months_used"]["R1"] == months[:9]
        assert shortened["median_months"] == 12.0

        # And the n >= 25 branch: 25 roofs, all present, must report that it wrote the
        # slot (the chain call itself is held back — no artefact is touched by a test).
        # Enough roofs to trip BOTH 25s — the skill declaration and the card gate — so
        # the case keeps exercising both branches even if the two thresholds diverge by
        # amendment.
        enough = max(lib.SKILL_MIN_N, CARD_MIN_N)
        many: list[dict[str, Any]] = [{**roofs[0], "roof_id": f"S{i:02d}",
                                       "building_idx": i, "loss": 0.01 * i}
                                      for i in range(enough)]
        with open(predictions, "w", encoding="utf-8") as fh:
            json.dump({"generated": "2026-09-07", "prereg": "spec.md",
                       "prereg_blob_sha": "0" * 40,
                       "predictions_after_measured": False, "roofs": many}, fh)
        with open(measured, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["roof_id", "ward", "building_idx", "kwp_dc", "months_covered",
                        "kwh_by_month", "outage_days_declared", "notes"])
            for i in range(enough):
                per_month = 1200.0 * (1.0 - 0.01 * i) * 5.0 / 12.0
                w.writerow([f"S{i:02d}", "testville", i, 5.0, ";".join(months),
                            json.dumps([[m, per_month] for m in months]), 0, ""])
        full = measure(predictions, measured, out, write_artefacts=False)
        assert full["n"] == enough, full["n"]
        assert full["card_slot_written"] is True, "n >= CARD_MIN_N must write the slot"
        assert full["shading_skill"]["status"] == "declared", full["shading_skill"]
        assert full["shading_skill"]["passes"] is True, full["shading_skill"]
        # The five numbers the card gets are exactly the ones build-pv-yield.py will read.
        for key in ("n", "median_months", "screened_median_ratio", "within_15pct_share",
                    "date"):
            assert key in full, f"the card's --validated path reads {key}; it is missing"
        print(f"  measure self-check: n=5 -> median {written['median_ratio']}, within-15 "
              f"{written['within_15pct_share']}, MAPE {written['mape']}, "
              f"hard failures {written['capacity']['hard_failures']}; "
              f"n=25 -> skill rho {full['shading_skill']['rho']}, slot written")
    print("  self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--predictions", default=PREDICTIONS)
    ap.add_argument("--measured", default=MEASURED)
    ap.add_argument("--out", default=os.path.join(
        ROOT, "data", "calibration", f"pv-validation-{dt.date.today().isoformat()}.json"))
    ap.add_argument("--self-check", action="store_true",
                    help="offline: synthetic roofs whose answer is known, on temp files")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    r = measure(args.predictions, args.measured, args.out)
    print(f"  n = {r['n']} roofs scored, {r['exclusions']['total']} excluded "
          f"({', '.join(f'{k} {len(v)}' for k, v in r['exclusions']['by_rule'].items() if v) or 'none'})")
    print(f"  ratio (as built)     : median {r['median_ratio']}, IQR {r['iqr']}, "
          f"MAPE {r['mape']:.1%}")
    print(f"  within +/-15 %       : {r['within_15pct_share']:.0%} — "
          f"{'PASSES' if r['pass_mark']['passes'] else 'MISSES'} the 80 % mark")
    print(f"  ratio (as screened)  : median {r['screened_median_ratio']}  "
          "<- the number the card prints")
    skill = r["shading_skill"]
    print(f"  shading skill        : {skill['status']}"
          + (f", rho {skill['rho']}, p {skill['p']:.4g}" if skill["status"] == "declared" else ""))
    print(f"  capacity c = P/kwp   : median {r['capacity']['median']}, "
          f"{r['capacity']['share_above_floor']:.0%} above our floor, "
          f"hard failures {r['capacity']['hard_failures'] or 'none'}")
    print(f"  written to {os.path.relpath(args.out, ROOT)}")


if __name__ == "__main__":
    main()
