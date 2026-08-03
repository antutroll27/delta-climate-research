"""WBPCB hourly air quality -> one daily record per station.

WHY THIS EXISTS. One of the seven stations is Ballygunge, which is a ward the
heat model simulates. A multi-year MEASURED record standing beside a modelled
ward is the kind of evidence the accuracy work has been short of. This script
does the acquisition-side half: turn seven pivoted archives into one derived
file that a human can read and a test can assert against.

WHAT IT IS NOT EVIDENCE OF. Air quality is not temperature. This can speak to
co-exposure and to seasonality; it cannot validate a thermal model, and the
findings note says so in those words.

THE SOURCE IS A CALENDAR, NOT A TABLE. Each file is laid out for a spreadsheet
reader: a `Year,YYYY` marker, then per month a header row naming the 24 hours,
then one row per day whose first cell is the day number. So reading it is an
unpivot, and the day/month/year have to be carried across rows rather than read
from any single one.

HOURS PER DAY IS NOT OPTIONAL. A daily mean built from four readings is not a
daily mean, and without the count it is indistinguishable from one built from
twenty-four. Sparse days are emitted FLAGGED, never dropped — an invisible
exclusion is the failure mode this pipeline has been bitten by before.

    python3 scripts/build-aqi-daily.py            # derive
    python3 scripts/build-aqi-daily.py --check    # assert over the committed file
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
AQI_DIR = os.path.join(ROOT, "data", "opencity", "aqi")
OUT_PATH = os.path.join(ROOT, "data", "opencity", "aqi-daily.json")

#: Below this many readings a day is still emitted, but flagged. 18 of 24 is
#: three quarters — enough that a mean is not dominated by which hours survived.
MIN_HOURS_PER_DAY = 18

#: Station file stem -> the ward it sits in, or None. Exactly one non-None entry
#: is the point of the whole exercise, and --check asserts it stays that way.
STATION_WARD: dict[str, str | None] = {
    "ballygunge": "ballygunge",
    "bidhannagar": None,
    "fort-william": None,
    "jadavpur": None,
    "rabindra-bharati": None,
    "rabindra-sarobar": None,
    "victoria": None,
}

SPAN_FROM = dt.date(2017, 1, 1)
SPAN_TO = dt.date(2023, 12, 31)

MONTH_HEADER = re.compile(r"^([A-Za-z]+)-(\d{4})$")


# ── pure helpers ────────────────────────────────────────────────────────────

def parse_month_header(cell: str) -> tuple[int, int] | None:
    """'January-2017' -> (2017, 1). None when the cell is not a month header."""
    match = MONTH_HEADER.match((cell or "").strip())
    if not match:
        return None
    try:
        month = dt.datetime.strptime(match.group(1)[:3], "%b").month
    except ValueError:
        return None
    return int(match.group(2)), month


def parse_value(cell: str) -> float | None:
    """A reading, or None for the blanks that pepper the archives."""
    text = (cell or "").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    # Negatives are instrument faults, not clean air; absurd highs are the same.
    return value if 0 <= value <= 2000 else None


def summarise_day(day: dt.date, readings: list[float]) -> dict:
    """One day's record. `hours` travels with the mean, always."""
    return {
        "d": day.isoformat(),
        "mean": round(sum(readings) / len(readings), 1),
        "max": round(max(readings), 1),
        "hours": len(readings),
        "sparse": len(readings) < MIN_HOURS_PER_DAY,
    }


# ── reading ─────────────────────────────────────────────────────────────────

def read_station(path: str) -> tuple[list[dict], dict[str, int]]:
    """Unpivot one station file into daily records, plus counted exclusions."""
    days: list[dict] = []
    skipped = {"no_month_context": 0, "bad_day_number": 0, "empty_day": 0, "out_of_span": 0}
    year = month = None

    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.reader(handle):
            if not row:
                continue
            head = (row[0] or "").strip()

            header = parse_month_header(head)
            if header:
                year, month = header
                continue
            if head.lower() == "year" or not head or head == "\n":
                continue                                  # year marker / separator

            if not head.isdigit():
                continue                                  # the hour-name header row
            if year is None or month is None:
                skipped["no_month_context"] += 1
                continue

            try:
                day = dt.date(year, month, int(head))
            except ValueError:
                skipped["bad_day_number"] += 1            # e.g. 31 April
                continue
            if not (SPAN_FROM <= day <= SPAN_TO):
                skipped["out_of_span"] += 1
                continue

            readings = [v for v in (parse_value(c) for c in row[1:25]) if v is not None]
            if not readings:
                skipped["empty_day"] += 1
                continue
            days.append(summarise_day(day, readings))

    days.sort(key=lambda d: d["d"])
    return days, skipped


def build_station(path: str) -> dict:
    """One station's record, reporting coverage against ITS OWN span.

    NOT against the catalogue's advertised 2017-2023. Six of the seven stations
    do not reach 2017 — Ballygunge, the one that matters, begins 2019-08-01 — so
    a percentage measured against the advertised window reads as "this station is
    39 % broken" when the truth is "this station was installed later and has been
    reliable ever since". `first`/`last` travel alongside so the number can never
    be quoted without the window it belongs to.
    """
    stem = os.path.splitext(os.path.basename(path))[0]
    days, skipped = read_station(path)
    observed = (dt.date.fromisoformat(days[-1]["d"])
                - dt.date.fromisoformat(days[0]["d"])).days + 1 if days else 0
    return {
        "station": stem,
        "ward": STATION_WARD.get(stem),
        "first": days[0]["d"] if days else None,
        "last": days[-1]["d"] if days else None,
        "days": len(days),
        "span_days": observed,
        "coverage": round(len(days) / observed, 3) if observed else 0,
        "sparse_days": sum(1 for d in days if d["sparse"]),
        "skipped": skipped,
        "daily": days,
    }


def build_document() -> dict:
    paths = sorted(glob.glob(os.path.join(AQI_DIR, "*.csv")))
    stations = [build_station(p) for p in paths]
    return {
        "generated_by": "scripts/build-aqi-daily.py",
        "source": "West Bengal Pollution Control Board, via data.opencity.in",
        "licence": "Public Domain",
        "window": {
            "from": SPAN_FROM.isoformat(), "to": SPAN_TO.isoformat(),
            "note": "The FILTER applied, and the range the catalogue advertises — "
                    "not a coverage claim. Only rabindra-bharati reaches 2017; "
                    "read each station's own first/last/coverage instead.",
        },
        "min_hours_per_day": MIN_HOURS_PER_DAY,
        "unit": "as published — the catalogue does not state whether these are "
                "AQI points or ug/m3; treated as a relative index and never "
                "labelled with a unit downstream",
        "note": "Air quality, offered as co-exposure and seasonality evidence "
                "beside a thermal model — not as validation of it.",
        "stations": stations,
    }


def serialise(doc: dict) -> str:
    """Compact, like the other data artefacts.

    Indented, this file came out LARGER than the seven archives it derives from —
    ~11,700 day records is a lot of whitespace. The envelope stays readable
    because it is short; the daily arrays are data, not configuration.
    """
    return json.dumps(doc, separators=(",", ":")) + "\n"


# ── commands ────────────────────────────────────────────────────────────────

def check() -> int:
    if not os.path.exists(OUT_PATH):
        print("  MISSING derived file — run without --check first")
        return 1
    with open(OUT_PATH, encoding="utf-8") as handle:
        doc = json.load(handle)
    stations = doc["stations"]
    failures: list[str] = []

    if len(stations) != 7:
        failures.append(f"expected 7 stations, found {len(stations)}")

    in_ward = [s for s in stations if s["ward"]]
    if len(in_ward) != 1 or in_ward[0]["station"] != "ballygunge":
        # The whole "measured record beside a modelled ward" claim rests on this
        # one mapping. If it ever breaks it must break loudly, not decay into a
        # footnote nobody re-reads.
        failures.append(f"expected exactly one station in a modelled ward (ballygunge), "
                        f"got {[s['station'] for s in in_ward]}")

    for station in stations:
        for day in station["daily"]:
            if day["mean"] > day["max"]:
                failures.append(f"{station['station']} {day['d']}: mean exceeds max")
                break
            if not (SPAN_FROM.isoformat() <= day["d"] <= SPAN_TO.isoformat()):
                failures.append(f"{station['station']} {day['d']}: outside the stated span")
                break
            if day["sparse"] != (day["hours"] < MIN_HOURS_PER_DAY):
                failures.append(f"{station['station']} {day['d']}: sparse flag disagrees with hours")
                break

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1

    for station in stations:
        mark = "  <- modelled ward" if station["ward"] else ""
        print(f"    {station['station']:<20} {station['first']} -> {station['last']} · "
              f"{station['days']:>5} days · {station['coverage']:.0%} of its span · "
              f"{station['sparse_days']:>4} sparse{mark}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()

    doc = build_document()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        handle.write(serialise(doc))
    print(f"  {os.path.relpath(OUT_PATH, ROOT)} "
          f"({os.path.getsize(OUT_PATH):,} B)")
    return check()


if __name__ == "__main__":
    sys.exit(main())
