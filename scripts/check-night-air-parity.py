#!/usr/bin/env python3
"""
Hold the Python night-air correction (_night_air.py) to the TypeScript (night-air.ts) at 1e-6 K on
the 49 Kolkata night scenes the correction is scored on, plus probe instants for the edges (day,
dusk, the IST month turn).

    python3 scripts/check-night-air-parity.py

The TS side is tests/fixtures/night-air/ts-oracle.json (scripts/dump-night-air-parity.mjs; a
unit test fails if it is stale). Nothing here touches data/calibration.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Final, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _night_air as na  # noqa: E402

DIR: Final = os.path.join(na.ROOT, "tests", "fixtures", "night-air")
TOL_K: Final = 1e-6
TOL_SUN: Final = 1e-9


class Scene(TypedDict):
    rid: str
    lat: float
    utc: str
    air: float


class RowsFile(TypedDict):
    rows: list[Scene]


class OracleRow(TypedDict):
    rid: str
    month: int
    sun: float
    offsetK: float
    airUsed: float


class Probe(TypedDict):
    utc: str
    month: int
    sun: float
    offsetK: float


class Oracle(TypedDict):
    rows: list[OracleRow]
    probes: list[Probe]


def main() -> None:
    with open(os.path.join(DIR, "rows-night-49.json"), encoding="utf-8") as fh:
        scenes = cast(RowsFile, json.load(fh))["rows"]
    with open(os.path.join(DIR, "ts-oracle.json"), encoding="utf-8") as fh:
        ts = cast(Oracle, json.load(fh))
    table = na.load_table()
    if len(scenes) != 49 or len(ts["rows"]) != 49:
        sys.exit(f"expected 49 scenes, got {len(scenes)} / {len(ts['rows'])}")
    worst = 0.0
    for s, o in zip(scenes, ts["rows"]):
        if s["rid"] != o["rid"]:
            sys.exit(f"row order differs: {s['rid']} vs {o['rid']}")
        u = na.parse_utc(s["utc"])
        sun = na.sun_at(u, s["lat"])
        if na.ist_month(u) != o["month"] or abs(sun - o["sun"]) > TOL_SUN:
            sys.exit(f"{s['rid']}: month/sun differ: py {na.ist_month(u)}/{sun} ts {o['month']}/{o['sun']}")
        air = na.corrected_air(table, na.Celsius(s["air"]), u, sun)
        worst = max(worst, abs(na.correction_k(table, u, sun) - o["offsetK"]), abs(air - o["airUsed"]))
    for p in ts["probes"]:
        u = na.parse_utc(p["utc"])
        sun = na.sun_at(u)
        if na.ist_month(u) != p["month"] or abs(sun - p["sun"]) > TOL_SUN:
            sys.exit(f"probe {p['utc']}: month/sun differ")
        worst = max(worst, abs(na.correction_k(table, u, sun) - p["offsetK"]))
    # The twilight band (0 < sun <= SUN_LIT) must be probed on BOTH sides of the boundary: some probe
    # inside it with the offset on, and a lit neighbour with it off (audit m2).
    twi = [p for p in ts["probes"] if 0.0 < p["sun"] <= na.SUN_LIT]
    lit = [p for p in ts["probes"] if na.SUN_LIT < p["sun"] < 2 * na.SUN_LIT]
    if len(twi) < 4 or len(lit) < 2 or any(p["offsetK"] <= 0 for p in twi) or any(p["offsetK"] != 0 for p in lit):
        sys.exit(f"twilight probes missing or wrong: {len(twi)} inside, {len(lit)} just lit")
    if worst > TOL_K:
        sys.exit(f"night-air parity FAILED: worst {worst:.3e} K > {TOL_K:g} K")
    print(f"  night-air parity: {len(scenes)} scenes + {len(ts['probes'])} probes, worst {worst:.2e} K (<= {TOL_K:g})")


if __name__ == "__main__":
    main()
