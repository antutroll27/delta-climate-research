#!/usr/bin/env python3
"""
Hold the Python dewpoint taper (_physics.dewpoint_taper / night_latent) to the TypeScript
(dewpointTaper and the latent term of currentParams in heat-map-model.ts) at 1e-9, on a fixed grid
that straddles the dewpoint: air -5..30 C, RH 50..100 %, cloud 0 and 50 %, two winds, day sun
0.06..1 and night.

    python3 scripts/check-dewpoint-taper-parity.py

The TS side is tests/fixtures/dewpoint-taper/ts-oracle.json (scripts/dump-dewpoint-taper-parity.mjs;
a unit test fails if it is stale). Nothing here touches data/calibration.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Final, Literal, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _physics as ph  # noqa: E402

ORACLE: Final = os.path.join(HERE, "..", "tests", "fixtures", "dewpoint-taper", "ts-oracle.json")
TOL: Final = 1e-9
MIN_POINTS: Final = 200
#: The radiative/convective split and sky-emissivity constant the page ships (types.ts kRad 0.01,
#: skyTemperatureC default c 1.24). The fitted c in a lab scene is a different thing.
K_RAD: Final = 0.01
SKY_C: Final = 1.24
NIGHT_SHIFT_K: Final = 2.5   # the canonical night scenario's retained-night convention


class Point(TypedDict):
    kind: Literal["day", "night"]
    air: float
    rh: float
    cloud: float
    wind: float
    sunNow: float
    taper: float
    L: float


class Oracle(TypedDict):
    points: list[Point]


def python_side(pt: Point) -> tuple[float, float]:
    """(taper, L) as the Python lab computes them for this forcing."""
    h = ph.K_SUM - K_RAD
    wind = ph.model_wind(pt["wind"])
    cloud = pt["cloud"] / 100.0
    night = pt["kind"] == "night"
    t_air = pt["air"] - (NIGHT_SHIFT_K if night else 0.0)
    t_sky = ph.sky_temp(t_air, pt["rh"], cloud, SKY_C)
    k = K_RAD + h * wind
    pull = K_RAD * t_sky + h * wind * t_air
    full = ph.L_ET * ph.evap_scale(pt["rh"])
    if night:
        store = ph.STORE_NIGHT
        return (ph.dewpoint_taper(k, pull, t_air, pt["rh"], 0.0, store),
                ph.night_latent(full, k, pull, t_air, pt["rh"], store))
    sun = pt["sunNow"] * (1 - 0.6 * cloud)
    taper = ph.dewpoint_taper(k, pull, t_air, pt["rh"], sun, 0.0)
    return taper, full * taper


def main() -> None:
    with open(ORACLE, encoding="utf-8") as fh:
        pts = cast(Oracle, json.load(fh))["points"]
    if len(pts) < MIN_POINTS:
        sys.exit(f"expected at least {MIN_POINTS} points, got {len(pts)}")
    worst = 0.0
    partial = 0
    for pt in pts:
        taper, lat = python_side(pt)
        worst = max(worst, abs(taper - pt["taper"]), abs(lat - pt["L"]))
        partial += 0.0 < pt["taper"] < 1.0
    # The grid must actually straddle the dewpoint, day and night, or it proves nothing.
    for kind in ("day", "night"):
        sub = [p for p in pts if p["kind"] == kind]
        if not any(p["taper"] == 0.0 for p in sub) or not any(p["taper"] == 1.0 for p in sub) \
                or not any(0.0 < p["taper"] < 1.0 for p in sub):
            sys.exit(f"{kind}: grid does not span taper 0, partial and 1")
    if worst > TOL:
        sys.exit(f"dewpoint-taper parity FAILED: worst {worst:.3e} > {TOL:g}")
    print(f"  dewpoint-taper parity: {len(pts)} points ({partial} partial), worst {worst:.2e} (<= {TOL:g})")


if __name__ == "__main__":
    main()
