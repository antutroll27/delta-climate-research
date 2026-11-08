"""
Measuring the Kolkata night-air table: VECC METAR air against NASA POWER T2M, air against air.

Used by build-night-air-table.py (writes data/night-air/vecc-night-air.json) and by the evidence
harness that scores the 49 night scenes. NEVER touches satellite LST: the table cannot be fitted
to the thing it is later tested on.

Inputs (the files the daytime-refit P2 used; IEM is public domain, credited in the page):
  IEM   vecc-raw.csv   station,valid,metar,tmpc,dwpc,relh,sknt   (valid = UTC, routine + SPECI)
  POWER kolkata.json   hourly point JSON, T2M at (22.55, 88.37), stamped in local solar time
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from typing import Final, TypedDict, cast

import _night_air as na
import _power

#: The span P2 downloaded; the table's window is stated, not implied.
WINDOW_START: Final = dt.date(2024, 1, 1)
WINDOW_END: Final = dt.date(2026, 5, 31)
#: A validation scene excludes every instant of its own night: this many hours either side.
EXCLUDE_HOURS: Final = 12.0
POWER_FILL: Final = -900.0


class PowerFile(TypedDict):
    properties: dict[str, dict[str, dict[str, float]]]


@dataclass(frozen=True)
class Instant:
    utc: dt.datetime
    air: na.Celsius        # VECC, whole degrees, parsed from the METAR text
    power: na.Celsius      # POWER T2M at the matched solar hour
    month: na.Month
    night: bool

    @property
    def diff(self) -> na.Kelvin:
        return na.Kelvin(self.air - self.power)


@dataclass(frozen=True)
class Load:
    instants: tuple[Instant, ...]
    n_reports: int
    n_no_temperature: int
    n_no_power: int
    n_outside_window: int
    n_text_vs_iem_mismatch: int


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_instants(iem_csv: str, power_json: str) -> Load:
    with open(power_json, encoding="utf-8") as fh:
        t2m = cast(PowerFile, json.load(fh))["properties"]["parameter"]["T2M"]
    out: list[Instant] = []
    n = no_t = no_p = outside = mism = 0
    with open(iem_csv, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            n += 1
            utc = na.parse_utc(r["valid"])
            if not WINDOW_START <= utc.date() <= WINDOW_END:
                outside += 1
                continue
            air = na.metar_temp_c(r["metar"])
            if air is None:
                no_t += 1
                continue
            if r["tmpc"] not in ("", "M") and abs(float(r["tmpc"]) - air) > 0.5:
                mism += 1          # IEM keeps tenths from the T-group; the product reads whole degrees
            p = t2m.get(_power.power_stamp(utc.isoformat(), na.POWER_LON))
            if p is None or p < POWER_FILL:
                no_p += 1
                continue
            out.append(Instant(utc=utc, air=na.Celsius(float(air)), power=na.Celsius(p),
                               month=na.ist_month(utc), night=na.is_night(utc)))
    return Load(tuple(out), n, no_t, no_p, outside, mism)


def excluded(utc: dt.datetime, centres: list[dt.datetime]) -> bool:
    w = dt.timedelta(hours=EXCLUDE_HOURS)
    return any(abs(utc - c) <= w for c in centres)


@dataclass(frozen=True)
class Built:
    offsets_k: tuple[na.Kelvin, ...]   # unrounded means; 0.0 where a month has no instant
    n: tuple[int, ...]


def build(instants: tuple[Instant, ...], centres: list[dt.datetime]) -> Built:
    """Per-month mean of VECC - POWER over night instants outside every excluded window."""
    s = [0.0] * na.MONTHS
    n = [0] * na.MONTHS
    for i in instants:
        if i.night and not excluded(i.utc, centres):
            s[i.month - 1] += i.diff
            n[i.month - 1] += 1
    return Built(tuple(na.Kelvin(s[m] / n[m] if n[m] else 0.0) for m in range(na.MONTHS)), tuple(n))


def rounded(b: Built) -> Built:
    """The shipped precision: 0.01 K."""
    return Built(tuple(na.Kelvin(round(x, 2)) for x in b.offsets_k), b.n)
