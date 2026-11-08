#!/usr/bin/env python3
"""
Build data/night-air/vecc-night-air.json: the 12-month VECC-minus-POWER night-air table.

    python3 scripts/build-night-air-table.py --iem vecc-raw.csv --power kolkata.json \
        --rows rows-p2.json --out data/night-air/vecc-night-air.json
    python3 scripts/build-night-air-table.py --check            # JSON == src/data/night-air-correction.ts

Air against air. The 50 night scenes of the Kolkata fit set are excluded from the input
(+/-12 h around each), so the table can be tested on them. See
docs/evidence/2026-11-08-kolkata-night-air-correction.md for the rules, fixed before the build.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from typing import Final, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _night_air as na  # noqa: E402
import _night_air_data as nd  # noqa: E402

TS_PATH: Final = os.path.join(na.ROOT, "src", "data", "night-air-correction.ts")


class RowsFile(TypedDict):
    rows: list[dict[str, object]]


def validation_centres(rows_path: str) -> tuple[list[dt.datetime], int]:
    with open(rows_path, encoding="utf-8") as fh:
        rows = cast(RowsFile, json.load(fh))["rows"]
    night = [r for r in rows if r["set"] == "kolkata-mmd-292" and r["stratum"] == "night" and r["admitted"]]
    return [na.parse_utc(str(r["utc"])) for r in night], len({str(r["date"]) for r in night})


def ts_table() -> tuple[list[float], list[int]]:
    """The offsets and n written in src/data/night-air-correction.ts (the `const VECC` entry)."""
    src = open(TS_PATH, encoding="utf-8").read()
    arrs = re.findall(r"\[([^\]]*)\]", src[src.index("const VECC"):])
    return ([float(x) for x in arrs[0].split(",") if x.strip()], [int(x) for x in arrs[1].split(",") if x.strip()])


def check() -> None:
    t = na.load_table()
    off, n = ts_table()
    if [float(x) for x in t.offsets_k] != off or list(t.n) != n:
        sys.exit(f"night-air table differs between {na.TABLE_PATH} and {TS_PATH}:\n  json {t.offsets_k} {t.n}\n  ts   {off} {n}")
    print(f"  night-air table: JSON and TS agree ({len(off)} months, n = {sum(n)})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--iem")
    ap.add_argument("--power")
    ap.add_argument("--rows", help="rows-p2.json (the validation scenes to exclude)")
    ap.add_argument("--out")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        check()
        return
    if not (a.iem and a.power and a.rows and a.out):
        ap.error("--iem, --power, --rows and --out are required")
    ld = nd.load_instants(a.iem, a.power)
    centres, n_dates = validation_centres(a.rows)
    ex = nd.rounded(nd.build(ld.instants, centres))
    full = nd.rounded(nd.build(ld.instants, []))
    night = [i for i in ld.instants if i.night]
    n_ex = sum(1 for i in night if nd.excluded(i.utc, centres))
    doc = {
        "schema": 1, "icao": "VECC", "city": "kolkata",
        "what": "mean(VECC METAR air - NASA POWER T2M) per IST month over night instants; the correction SUBTRACTS it from the airport air",
        "unit": "K", "months": "IST calendar month, index 0 = January",
        "offsets_k": [float(x) for x in ex.offsets_k], "n_instants": list(ex.n),
        "offsets_no_exclusion_k": [float(x) for x in full.offsets_k], "n_instants_no_exclusion": list(full.n),
        "max_abs_exclusion_effect_k": round(max(abs(x - y) for x, y in zip(ex.offsets_k, full.offsets_k)), 2),
        "night_rule": "sun <= SUN_LIT (0.05); sun = solar_factor(solar hour at 88.37E, UTC day of year, 22.55N)",
        "air": "whole-degree temperature parsed from the METAR text (what metar.ts reads)",
        "power_match": "_power.power_stamp(report utc, 88.37): nearest local-solar hour",
        "window": [nd.WINDOW_START.isoformat(), nd.WINDOW_END.isoformat()],
        "exclusion": {"rule": f"night instants within +/-{nd.EXCLUDE_HOURS:g} h of any validation night scene",
                      "scenes": len(centres), "dates": n_dates, "night_instants_dropped": n_ex,
                      "source": "tests/fixtures/daytime-refit/rows-p2.json kolkata-mmd-292, stratum night"},
        "counts": {"reports": ld.n_reports, "usable_instants": len(ld.instants), "night_instants": len(night),
                   "no_temperature": ld.n_no_temperature, "no_power": ld.n_no_power,
                   "outside_window": ld.n_outside_window, "iem_tenths_vs_text_over_half_degree": ld.n_text_vs_iem_mismatch},
        "inputs": {"iem/vecc-raw.csv": nd.sha256_file(a.iem), "power/kolkata.json": nd.sha256_file(a.power),
                   "rows-p2.json": nd.sha256_file(a.rows)},
        "licence": "IEM ASOS archive: public domain, attribution requested; NASA POWER: public domain",
        "built_by": "scripts/build-night-air-table.py",
        "never_fitted_to": "satellite LST",
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print(json.dumps({k: doc[k] for k in ("offsets_k", "n_instants", "offsets_no_exclusion_k", "n_instants_no_exclusion",
                                          "max_abs_exclusion_effect_k", "exclusion", "counts")}, indent=1))


if __name__ == "__main__":
    main()
