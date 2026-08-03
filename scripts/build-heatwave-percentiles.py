"""IMD daily temperature, 1951-2024 -> the heatwave scenario's forcing.

WHY THIS EXISTS. The map's peak view forces from a live met.no reading, so on a
mild day it shows a mild city and the instrument has no way to answer "what does
a genuinely bad day look like here". The honest answer is not a looser colour
ramp, it is a real number: the 99th percentile of 74 years of measured daily
maxima. 38.4 C, from record, not from taste.

WHAT IT DOES NOT GIVE US. Air temperature only. There is no matching record of
heatwave-day humidity here, which is why the runtime holds today's VAPOUR
PRESSURE rather than its relative humidity (see shiftAirPreservingVapour in
src/scripts/climate-engine/sky.ts). Holding the ratio would invent the very
thing this file cannot supply.

The browser never sees the archive: 26,806 rows stay in data/opencity/ and a
~500 byte percentile table is what ships.

    python3 scripts/build-heatwave-percentiles.py            # download + derive
    python3 scripts/build-heatwave-percentiles.py --check    # re-derive, compare bytes
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CSV_PATH = os.path.join(ROOT, "data", "opencity", "imd-kolkata-daily.csv")
OUT_PATH = os.path.join(ROOT, "public", "heat-map", "data", "heatwave-percentiles.json")

SOURCE_URL = (
    "https://data.opencity.in/dataset/e57cd149-fd78-4853-80b8-47d3d082845e/"
    "resource/2f2fd6a8-cfad-4648-989c-08272d01982b/download/"
    "d95a278d-d655-414a-b791-f937c779b950.csv"
)
SOURCE = "India Meteorological Department, via data.opencity.in"
LICENCE = "Public Domain"

#: Constant, NOT date.today(). The artefact must regenerate byte-identically or
#: `--check` cannot tell a real data change from today's date moving.
RETRIEVED = "2026-08-03"

#: Counts measured on the 2026-08-03 download. These are assertions, not notes:
#: a different denominator means the CKAN resource changed underneath us and the
#: p99 that was reviewed is not the p99 that would ship.
EXPECT_TOTAL = 26_806
EXPECT_USABLE = 26_747

#: numpy's default. Named because switching to "nearest" moves p99 by ~0.2 K,
#: which is a silent change to a published scenario.
PCTL_METHOD = "linear"

#: Excel's day 1 is 1900-01-01 but it also believes 1900 was a leap year, so the
#: serial epoch that actually reproduces its dates is 1899-12-30.
EXCEL_EPOCH = dt.date(1899, 12, 30)

MISSING_MARKERS = ("-----", "")


# ── pure helpers ────────────────────────────────────────────────────────────

def parse_mixed_date(raw: str) -> dt.date | None:
    """One column, two formats: 26,803 dd-mm-yyyy rows and 3 Excel serials.

    The serials are a spreadsheet round-trip artefact in the published file.
    Dropping them silently is the ECOSTRESS pagination lesson repeating, so they
    are converted and then checked by the caller.
    """
    text = raw.strip()
    if not text:
        return None
    if text.isdigit():
        return EXCEL_EPOCH + dt.timedelta(days=int(text))
    try:
        return dt.datetime.strptime(text, "%d-%m-%Y").date()
    except ValueError:
        return None


def parse_temp(raw: str) -> float | None:
    """Daily max in C, or None for the file's missing markers."""
    text = raw.strip()
    if text in MISSING_MARKERS:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if -20 < value < 60 else None


def percentile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated percentile over an already-sorted list."""
    if not sorted_values:
        raise ValueError("no values")
    pos = (len(sorted_values) - 1) * q
    low = int(pos)
    high = min(low + 1, len(sorted_values) - 1)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (pos - low)


# ── reading ─────────────────────────────────────────────────────────────────

class Reading(dict):
    """A parsed row: {'date': date, 'tmax': float}."""


def read_temp_rows(path: str) -> tuple[list[Reading], dict[str, int]]:
    """Every row, split into usable readings and counted exclusions.

    Exclusions are counted by reason rather than skipped, so the printed summary
    can be compared against the numbers this file asserts.
    """
    rows: list[Reading] = []
    excluded = {"missing_temp": 0, "unparsed_date": 0}
    calendar: list[tuple[dt.date, bool]] = []   # (date, came_from_serial), file order
    total = 0

    with open(path, encoding="utf-8-sig") as handle:
        for record in csv.DictReader(handle):
            total += 1
            raw_date = record.get("Date", "")
            day = parse_mixed_date(raw_date)
            if day is None:
                excluded["unparsed_date"] += 1
                continue
            calendar.append((day, raw_date.strip().isdigit()))
            tmax = parse_temp(record.get("Temp Max", ""))
            if tmax is None:
                excluded["missing_temp"] += 1
                continue
            rows.append(Reading(date=day, tmax=tmax))

    _assert_serials_continue_the_calendar(calendar)
    excluded["total_rows"] = total
    return rows, excluded


def _assert_serials_continue_the_calendar(calendar: list[tuple[dt.date, bool]]) -> None:
    """Each converted serial must be exactly one day after the row before it.

    This is the epoch test, and it is deliberately strict. The three serials sit
    at the very end of the file, immediately after 19-06-2024, so a correct epoch
    yields 20, 21, 22 June with no gap. The two epochs people reach for by
    mistake — 1899-12-31 and 1900-01-01 — would each land a day or two off and
    are caught here; a wildly wrong one lands in 1900 and is caught twice over.
    Checking against the usable rows instead would NOT work: the last serial has
    no temperature, so it never reaches them.
    """
    for index, (day, from_serial) in enumerate(calendar):
        if not from_serial or index == 0:
            continue
        previous = calendar[index - 1][0]
        assert day == previous + dt.timedelta(days=1), (
            f"Excel serial converted to {day}, but the row before it is {previous} — "
            "the epoch is wrong")


# ── artefact ────────────────────────────────────────────────────────────────

def build_artefact(rows: list[Reading], excluded: dict[str, int]) -> dict:
    values = sorted(row["tmax"] for row in rows)
    days = [row["date"] for row in rows]
    return {
        "city": "Kolkata",
        "source": SOURCE,
        "licence": LICENCE,
        "retrieved": RETRIEVED,
        "span": {"from": min(days).isoformat(), "to": max(days).isoformat()},
        "rows": {"total": excluded["total_rows"], "usable": len(rows)},
        "method": PCTL_METHOD,
        "tmaxC": {
            "p50": round(percentile(values, 0.50), 1),
            "p95": round(percentile(values, 0.95), 1),
            "p99": round(percentile(values, 0.99), 1),
            "max": round(values[-1], 1),
        },
    }


def serialise(doc: dict) -> str:
    """Stable bytes: fixed key order from the dict, 2-space indent, trailing NL."""
    return json.dumps(doc, indent=2) + "\n"


def download_if_missing(path: str) -> None:
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    response = requests.get(SOURCE_URL, timeout=180)
    response.raise_for_status()
    with open(path, "wb") as handle:
        handle.write(response.content)
    print(f"  downloaded {os.path.getsize(path):,} B -> {os.path.relpath(path, ROOT)}")


def derive() -> tuple[dict, dict[str, int]]:
    rows, excluded = read_temp_rows(CSV_PATH)
    assert excluded["total_rows"] == EXPECT_TOTAL, (
        f"expected {EXPECT_TOTAL:,} rows, read {excluded['total_rows']:,} — the source "
        "moved, so the reviewed p99 is not the p99 this would ship")
    assert len(rows) == EXPECT_USABLE, (
        f"expected {EXPECT_USABLE:,} usable, got {len(rows):,}")
    return build_artefact(rows, excluded), excluded


# ── commands ────────────────────────────────────────────────────────────────

def check() -> int:
    if not os.path.exists(OUT_PATH):
        print("  MISSING artefact — run without --check first")
        return 1
    doc, _ = derive()
    on_disk = open(OUT_PATH, encoding="utf-8").read()
    if serialise(doc) != on_disk:
        print("  DRIFT: re-derived artefact differs from the committed bytes")
        return 1
    t = doc["tmaxC"]
    assert t["p50"] < t["p95"] < t["p99"] <= t["max"], "percentiles out of order"
    print(f"  byte-identical · p99 {t['p99']} C · "
          f"{doc['rows']['usable']:,}/{doc['rows']['total']:,} usable")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="re-derive and compare against the committed bytes")
    if parser.parse_args().check:
        return check()

    download_if_missing(CSV_PATH)
    doc, excluded = derive()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        handle.write(serialise(doc))

    print(f"  rows {excluded['total_rows']:,} · usable {doc['rows']['usable']:,} "
          f"· excluded {excluded['missing_temp']} missing temp, "
          f"{excluded['unparsed_date']} unparsed date")
    print(f"  tmax {doc['tmaxC']} -> {os.path.relpath(OUT_PATH, ROOT)}")
    return check()


if __name__ == "__main__":
    sys.exit(main())
