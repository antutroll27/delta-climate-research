#!/usr/bin/env python3
"""Step one of the pre-registered rooftop study: PREDICT, before any measured kWh exists.

    python3 scripts/predict-pv-validation.py \
        --roster data/calibration/pv-validation-roster.csv \
        --out    data/calibration/pv-validation-predictions.json
    python3 scripts/predict-pv-validation.py --self-check    # offline, temp files, no network

THE ORDER OF OPERATIONS IS THE POINT (pre-registration §6.1). This file's output is
committed BEFORE `data/calibration/pv-validation-measured.csv` enters the repository, and
`measure-pv-validation.py` records the commit that carried it. A prediction written after
the answer is known is not a prediction, so this script REFUSES TO RUN when the measured
CSV already exists. The refusal is overridable — a re-run after a roster correction is a
real need — but only with `--i-know-measured-exists`, and the override is written into the
output as `predictions_after_measured: true`, where it stays, visible, in the published
result. There is no way to use the override quietly.

WHAT IS PREDICTED, per roof, per month, from the pre-registration §3:

  y_pred   AS BUILT. The chain's physics on NASA POWER *daily* GHI for the owner's own
           months and years, at the owner's stated tilt and azimuth, times (1 - loss_i)
           with loss_i the artefact's annual A1 shading loss for that building.
  y_scr    AS SCREENED. What the product actually prints: the chain's five-year
           climatology at 22 deg / 180 deg, times (1 - loss_i) — prorated onto the
           owner's months by the pinned seasonal shape, so statistic 4 compares a
           partial year with a partial year and not with a whole one.
  y_null   THE NULL. The chain's 22 deg / 180 deg array on THE OWNER'S OWN DAYS, with no
           shading at all. Statistic 3 asks whether our per-roof shading beats it, and
           that question is only fair if the null and the prediction stand on the same
           weather: a null built from the five-year climatology would carry an
           interannual irradiance term that r_i does not, so a sunny year would read as
           shading skill. Same POWER pull, same days, loss = 0 — nothing else.

WHOSE ROOFS. In-ward, index-matched roofs only: every roster row names a `building_idx`
into that ward's artefact, and a roof without one has no `kwp` and no `loss` to be
compared against. §4's near-ward class ("within 2 km of a ward boundary") was DROPPED by
amendment; there is no unindexed path through this script.

Per-MONTH values are written as well as totals, because the measured export may cover
fewer months than the roster declared and §3's ratios must then be formed on the months
the two have in COMMON — which is an exact sum over the months here, never a rescaling of
an annual number after the fact.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
import tempfile
from typing import Any, Mapping, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)

import _types                    # noqa: E402
import pv_validation_lib as lib  # noqa: E402

PREREG = os.path.join(ROOT, "docs", "superpowers", "specs",
                      "2026-09-07-pv-rooftop-validation-design.md")
MEASURED = os.path.join(ROOT, "data", "calibration", "pv-validation-measured.csv")
WEB_DIR = os.path.join(ROOT, "public", "heat-map", "data")
ROSTER = os.path.join(ROOT, "data", "calibration", "pv-validation-roster.csv")
OUT = os.path.join(ROOT, "data", "calibration", "pv-validation-predictions.json")

ROSTER_COLUMNS = ("roof_id", "ward", "building_idx", "tilt_deg", "azimuth_deg",
                  "months_covered")


def _month_bounds(months: Sequence[str]) -> tuple[str, str]:
    """POWER's daily window, 'YYYYMMDD' both ends, spanning first to last covered month."""
    first, last = min(months), max(months)
    y, m = int(last[0:4]), int(last[5:7])
    end = dt.date(y + (m // 12), (m % 12) + 1, 1) - dt.timedelta(days=1)
    return f"{first[0:4]}{first[5:7]}01", end.strftime("%Y%m%d")


def _read_roster(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.exit(f"  roster {path} has no rows")
    missing = [c for c in ROSTER_COLUMNS if c not in rows[0]]
    if missing:
        sys.exit(f"  roster is missing columns {missing} — see pre-registration §6.1")
    return rows


def _load_artefact(web_dir: str, ward: str, cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if ward not in cache:
        path = os.path.join(web_dir, f"pv-{ward}.json")
        if not os.path.exists(path):
            sys.exit(f"  no browser artefact for ward {ward} ({path}) — run build-pv-yield.py")
        with open(path, encoding="utf-8") as fh:
            cache[ward] = json.load(fh)
    return cache[ward]


def build(roster_path: str, out_path: str, *, web_dir: str = WEB_DIR,
          prereg_path: str = PREREG, measured_path: str = MEASURED,
          allow_measured: bool = False,
          ward_centre: Mapping[str, tuple[float, float]] | None = None) -> dict[str, Any]:
    """Read the roster, predict every roof, write the predictions file, return it."""
    if os.path.exists(measured_path) and not allow_measured:
        sys.exit(f"  {os.path.relpath(measured_path, ROOT)} already exists.\n"
                 "  The pre-registration (§6.1) says the predictions are written and "
                 "committed BEFORE any measured kilowatt-hour is in the repository.\n"
                 "  If this is a deliberate re-run, pass --i-know-measured-exists — it is "
                 "recorded in the output and published with the result.")

    rows = _read_roster(roster_path)
    artefacts: dict[str, dict[str, Any]] = {}
    roofs: list[dict[str, Any]] = []
    for row in rows:
        ward = row["ward"].strip()
        art = _load_artefact(web_dir, ward, artefacts)
        idx = int(row["building_idx"])
        if not 0 <= idx < len(art["kwp"]):
            sys.exit(f"  roof {row['roof_id']}: building_idx {idx} is outside "
                     f"{ward}'s {len(art['kwp'])} buildings")
        months = [m.strip() for m in row["months_covered"].split(";") if m.strip()]
        if not months:
            sys.exit(f"  roof {row['roof_id']}: months_covered is empty")
        tilt, azimuth = float(row["tilt_deg"]), float(row["azimuth_deg"])
        kwp = float(art["kwp"][idx])
        loss = float(art["loss"][idx])
        loss_strict = float(art["loss_strict"][idx])
        sy = float(art["specific_yield"])

        if ward_centre is not None:
            lat, lon = ward_centre[ward]
        else:
            centre = _types.WARDS[ward].centre
            lat, lon = float(centre.lat), float(centre.lon)
        start, end = _month_bounds(months)
        power = lib.power_daily(lat, lon, start, end)
        ghi_all = power["ALLSKY_SFC_SW_DWN"]
        t2m_all = power["T2M"]

        by_month: dict[str, dict[str, float]] = {}
        for month in sorted(months):
            key = month.replace("-", "")
            ghi = {d: v for d, v in ghi_all.items() if d.startswith(key)}
            t2m = {d: v for d, v in t2m_all.items() if d.startswith(key)}
            if not ghi:
                sys.exit(f"  roof {row['roof_id']}: POWER returned no days for {month}")
            # y_scr is the PRORATED PRINTED NUMBER — the five-year climatology the card
            # shows, cut to the owner's months by the pinned seasonal shape. Statistic 4
            # compares against exactly that, by design (§3, as amended): it judges what
            # the product says, not a re-run of it.
            share = lib.climatology_month_share(month)
            # y_null is NOT prorated. It runs the same model over the same days as
            # y_pred, at the screen's 22 deg / 180 deg with loss = 0, so the only
            # differences between them are the array and the shading — which is the
            # whole of statistic 3's question.
            by_month[month] = {
                "y_pred": round(lib.predict_roof(ghi, t2m, tilt, azimuth, lat, loss), 2),
                "y_scr": round(sy * (1.0 - loss) * share, 2),
                "y_null": round(lib.predict_roof(ghi, t2m, lib.TILT_DEG,
                                                 lib.AZIMUTH_DEG, lat, 0.0), 2),
                "days": len(ghi),
            }
        roofs.append({
            "roof_id": row["roof_id"], "ward": ward, "building_idx": idx,
            "tilt_deg": tilt, "azimuth_deg": azimuth,
            "months": sorted(months),
            "kwp": round(kwp, 2), "loss": round(loss, 3), "loss_strict": round(loss_strict, 3),
            "y_pred": round(sum(v["y_pred"] for v in by_month.values()), 2),
            "y_scr": round(sum(v["y_scr"] for v in by_month.values()), 2),
            "y_null": round(sum(v["y_null"] for v in by_month.values()), 2),
            "by_month": by_month,
        })

    out: dict[str, Any] = {
        "generated": dt.date.today().isoformat(),
        "prereg": os.path.relpath(prereg_path, ROOT),
        # The BLOB hash, not a commit: it identifies the exact bytes of the document these
        # predictions were made under, so a later amendment is detectable rather than
        # arguable.
        "prereg_blob_sha": lib.git_blob_hash(prereg_path),
        "roster": os.path.relpath(roster_path, ROOT),
        "roster_sha256": lib.sha256_of(roster_path),
        "artefacts": {ward: {"path": os.path.relpath(os.path.join(web_dir, f"pv-{ward}.json"), ROOT),
                             "sha256": lib.sha256_of(os.path.join(web_dir, f"pv-{ward}.json")),
                             "specific_yield": art["specific_yield"],
                             "packing_factor": art["packing_factor"]}
                      for ward, art in sorted(artefacts.items())},
        "model": {
            "irradiance": "NASA POWER daily ALLSKY_SFC_SW_DWN and T2M, cached under "
                          "data/calibration/power-daily/",
            "simplification": "daily GHI spread over the day in proportion to "
                              "sin(solar elevation); air temperature held at the daily "
                              "mean. Reproduces the hourly chain to +0.9 % — see "
                              "pv_validation_lib.py's docstring for the measurement.",
            "climatology_note": lib.CLIMATOLOGY_NOTE,
            "tilt_deg_screen": lib.TILT_DEG, "azimuth_deg_screen": lib.AZIMUTH_DEG,
            "system_loss": lib.SYSTEM_LOSS,
        },
        "predictions_after_measured": bool(os.path.exists(measured_path) and allow_measured),
        "roofs": roofs,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    return out


# ── the self-check ──────────────────────────────────────────────────────────


def _self_check() -> None:
    """This script's own I/O, end to end, on temp files with a synthetic POWER series.
    Nothing under data/ or public/ is read or written, and the network is unreachable
    because `lib.POWER_SOURCE` is set for the duration."""
    def synthetic(lat: float, lon: float, start: str, end: str) -> dict[str, dict[str, float]]:
        ghi: dict[str, float] = {}
        t2m: dict[str, float] = {}
        day = dt.date(int(start[0:4]), int(start[4:6]), int(start[6:8]))
        last = dt.date(int(end[0:4]), int(end[4:6]), int(end[6:8]))
        while day <= last:
            key = day.strftime("%Y%m%d")
            ghi[key] = lib.MONTHLY_GHI_KWH_M2_DAY[day.month - 1]
            t2m[key] = lib.MONTHLY_T2M_C[day.month - 1]
            day += dt.timedelta(days=1)
        return {"ALLSKY_SFC_SW_DWN": ghi, "T2M": t2m}

    lib.POWER_SOURCE = synthetic
    try:
        with tempfile.TemporaryDirectory() as tmp:
            web = os.path.join(tmp, "web")
            os.makedirs(web)
            with open(os.path.join(web, "pv-testville.json"), "w", encoding="utf-8") as fh:
                json.dump({"ward": "testville", "kwp": [7.3, 2.0], "kwh": [9470, 2600],
                           "loss": [0.10, 0.30], "loss_strict": [0.04, 0.20],
                           "specific_yield": 1313.8, "packing_factor": 0.28}, fh)
            roster = os.path.join(tmp, "roster.csv")
            with open(roster, "w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(ROSTER_COLUMNS)
                w.writerow(["A1", "testville", 0, 22.0, 180.0,
                            ";".join(f"2025-{m:02d}" for m in range(1, 7))])
                w.writerow(["A2", "testville", 1, 10.0, 135.0,
                            ";".join(f"2025-{m:02d}" for m in range(1, 13))])
            out = os.path.join(tmp, "predictions.json")
            got = build(roster, out, web_dir=web, prereg_path=PREREG,
                        measured_path=os.path.join(tmp, "measured.csv"),
                        ward_centre={"testville": (22.528, 88.3659)})

            assert os.path.exists(out), "the predictions file must be written"
            with open(out, encoding="utf-8") as fh:
                round_tripped: dict[str, Any] = json.load(fh)
            assert round_tripped == got, "what is returned must be what is written"
            assert got["predictions_after_measured"] is False
            a1, a2 = got["roofs"]
            assert len(a1["by_month"]) == 6 and len(a2["by_month"]) == 12
            assert a1["y_pred"] == round(sum(v["y_pred"] for v in a1["by_month"].values()), 2)
            # THE NULL IS THE MODEL, NOT THE CLIMATOLOGY. Recomputed here from the same
            # synthetic days, at 22 deg / 180 deg with loss = 0, it must match to the
            # rounding the file was written at — this is the check that y_null and y_pred
            # stand on the same weather.
            power = synthetic(22.528, 88.3659, "20250101", "20251231")
            for roof in (a1, a2):
                for month, values in roof["by_month"].items():
                    key = month.replace("-", "")
                    ghi = {d: v for d, v in power["ALLSKY_SFC_SW_DWN"].items()
                           if d.startswith(key)}
                    t2m = {d: v for d, v in power["T2M"].items() if d.startswith(key)}
                    want = round(lib.predict_roof(ghi, t2m, lib.TILT_DEG, lib.AZIMUTH_DEG,
                                                  22.528, 0.0), 2)
                    assert values["y_null"] == want, (roof["roof_id"], month,
                                                      values["y_null"], want)
            # A whole synthetic year of the pinned climatology, unshaded, IS the daily
            # model's own annual answer — 1325.7, the +0.91 % the library measures against
            # the chain's 1313.8. The null is the model's, not the artefact's.
            assert abs(a2["y_null"] - 1325.7) < 1.0, a2["y_null"]
            # y_scr, by contrast, IS the artefact's printed climatology prorated, and over
            # twelve months the prorating closes on itself.
            assert abs(a2["y_scr"] - 1313.8 * 0.70) < 0.5, a2["y_scr"]
            # Six months is NOT half a year: January-June carries the strong season, so
            # the null over them must be well above half. This is the whole reason the
            # seasonal shape is used instead of a day count.
            assert 0.52 < a1["y_null"] / a2["y_null"] < 0.60, a1["y_null"] / a2["y_null"]
            # The as-built roof (22/180, the screen's own array) should sit close to the
            # screened figure; the off-south, low-tilt roof should sit below its own.
            assert abs(a1["y_pred"] / a1["y_scr"] - 1.0) < 0.05, a1["y_pred"] / a1["y_scr"]
            assert a2["y_pred"] < a2["y_scr"], "10 deg facing south-east must lose to 22 deg south"
            assert got["artefacts"]["testville"]["sha256"], "artefact hash must be recorded"
            assert len(got["prereg_blob_sha"]) == 40 or got["prereg_blob_sha"] == "unavailable"

            # THE REFUSAL, and the override. With a measured CSV present the script exits;
            # with the override it runs and stamps the output.
            open(os.path.join(tmp, "measured.csv"), "w", encoding="utf-8").close()
            try:
                build(roster, out, web_dir=web, measured_path=os.path.join(tmp, "measured.csv"),
                      ward_centre={"testville": (22.528, 88.3659)})
                raise AssertionError("a measured CSV on disk must stop the predictor")
            except SystemExit:
                pass
            forced = build(roster, out, web_dir=web,
                           measured_path=os.path.join(tmp, "measured.csv"),
                           allow_measured=True,
                           ward_centre={"testville": (22.528, 88.3659)})
            assert forced["predictions_after_measured"] is True, \
                "the override must be recorded in the output, not only on the command line"
            print(f"  predict self-check: 2 roofs, y_null(12 mo) {a2['y_null']}, "
                  f"y_null(6 mo) {a1['y_null']}, refusal and override both exercised")
    finally:
        lib.POWER_SOURCE = None
    print("  self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--roster", default=ROSTER)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--i-know-measured-exists", action="store_true",
                    help="run even though the measured CSV exists; recorded in the output")
    ap.add_argument("--self-check", action="store_true",
                    help="offline: temp roster, temp artefact, synthetic POWER, no network")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    out = build(args.roster, args.out, allow_measured=args.i_know_measured_exists)
    print(f"  {len(out['roofs'])} roofs predicted from {os.path.relpath(args.roster, ROOT)}")
    for roof in out["roofs"]:
        print(f"    {roof['roof_id']:>8}  {roof['ward']:<12} {len(roof['months']):>2} mo  "
              f"y_pred {roof['y_pred']:>8.1f}  y_scr {roof['y_scr']:>8.1f}  "
              f"y_null {roof['y_null']:>8.1f}  kWp {roof['kwp']:>6.2f}")
    print(f"  written to {os.path.relpath(args.out, ROOT)}  "
          f"(prereg blob {out['prereg_blob_sha'][:10]})")
    if out["predictions_after_measured"]:
        print("  WARNING: written with --i-know-measured-exists; the result will say so.")


if __name__ == "__main__":
    main()
