#!/usr/bin/env python3
"""
NASA POWER's hourly clock: the stamp an observation at a given UTC instant reads.

    python3 scripts/_power.py        # self-test

WHY THIS FILE EXISTS. POWER stamps its hourly data in LOCAL SOLAR TIME at the
queried longitude, as `YYYYMMDDHH`. fetch-met.py used to build that key from the
scene's UTC DATE plus its local solar HOUR, which is 24 hours early for every pass
after local midnight but before UTC midnight: on 2026-04-12 an ECOSTRESS pass at
23:28 UTC (05:22 local on the 13th) read 22.09 °C from `2026041205` instead of
24.68 °C from `2026041305`. 21 of the 97 forcing rows were affected, all at night
(2026-09-23 audit, item 3).

The date and the hour must come from ONE calculation on the real UTC instant, kept
here as a pure, importable module so every consumer shares one definition —
`fetch-met` is not an importable name.
"""
from __future__ import annotations

import datetime as dt
import sys
from typing import Final

#: The one NASA POWER point the Kolkata forcing is read at: the centre of the
#: three-ward bbox. POWER stamps its hours in local solar time AT THIS LONGITUDE.
POWER_LAT: Final = 22.55
POWER_LON: Final = 88.37


def power_stamp(iso_utc: str, lon: float) -> str:
    """The POWER `YYYYMMDDHH` stamp nearest `iso_utc` in local solar time at `lon`.

    `iso_utc` is an ISO-8601 instant in UTC, with or without a trailing `Z`, e.g.
    `2026-04-12T23:28:34`. Local solar time is UTC + lon/15 hours; the nearest hour
    is taken by adding 30 minutes and truncating, so 23:40 local reads the next
    day's 00 stamp — the date rolls with the hour, never separately.
    """
    t = dt.datetime.fromisoformat(iso_utc.rstrip("Z"))
    lst = t + dt.timedelta(hours=lon / 15.0)
    return (lst + dt.timedelta(minutes=30)).strftime("%Y%m%d%H")


def _self_test() -> None:
    cases = {
        # the pass that exposed the bug: 23:28 UTC is 05:22 local on the 13th
        "2026-04-12T23:28:34": "2026041305",
        # a day pass: UTC and local share a date (a Landsat overpass time)
        "2024-01-04T04:31:14Z": "2024010410",
        # 17:47 UTC is 23:40 local: it rounds up to 24:00, so the DATE rolls too
        "2026-06-26T17:47:00": "2026062700",
        # just before UTC midnight: 23:50 UTC is 05:43 local on the next day
        "2026-04-12T23:50:00": "2026041306",
        # just after UTC midnight: 00:10 UTC is 06:03 local, on the same date
        "2026-04-13T00:10:00": "2026041306",
    }
    for iso, want in cases.items():
        got = power_stamp(iso, POWER_LON)
        if got != want:
            raise SystemExit(f"power_stamp({iso!r}) = {got}, expected {want}")
    print(f"  _power self-test: {len(cases)} cases ok")


if __name__ == "__main__":
    _self_test()
    sys.exit(0)
