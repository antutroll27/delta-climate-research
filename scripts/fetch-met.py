#!/usr/bin/env python3
"""
Attach meteorological forcing to each ECOSTRESS calibration scene.

    python3 scripts/fetch-met.py

The calibration CSV records what the surface WAS; the model predicts surface
temperature GIVEN the atmosphere. Without air temperature, humidity and wind at
the moment of overpass there is nothing to fit against — so this joins NASA
POWER hourly meteorology onto every usable scene.

WHY NASA POWER. Free, no API key, and public domain — no attribution or
non-commercial clause. Open-Meteo's archive is easier still but its licence is
non-commercial, which rules it out for work Delta sells to municipalities.
ERA5 via Copernicus CDS is the other clean option but needs account
registration; POWER is MERRA-2 derived and adequate here.

RESOLUTION CAVEAT. POWER is ~0.5 deg (~50 km) — one grid cell over greater
Kolkata. That is the regional background, not a ward reading, which is exactly
the right quantity: the model takes regional air temperature as forcing and
generates the local anomaly itself. Feeding it a ward-level air temperature
would double-count the heat island.

TIME BASE. POWER hourly is stamped in Local Solar Time, and the calibration CSV
already carries local_solar_hour derived from centre longitude. The join is
therefore direct, with no timezone arithmetic to get wrong — which is why the
LST check below is a raised error rather than an assert: under `python3 -O`
asserts vanish, and every scene would silently join to the wrong hour.

Output: data/calibration/met-forcing.csv
"""
from __future__ import annotations

import csv
import datetime
import json
import os
import subprocess
import sys
from typing import TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path must be set first — the scripts are not a package)

ROOT = os.path.join(HERE, "..")
SCENES = os.path.join(ROOT, "data", "calibration", "ecostress-suhii.csv")
LANDSAT = os.path.join(ROOT, "data", "calibration", "landsat-ward-lst.json")
OUT = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
CACHE = os.path.expanduser("~/.cache/delta-climate/power-hourly.json")

LAT, LON = 22.55, 88.37                       # centre of the three-ward bbox
POWER_PARAMS = ("T2M", "RH2M", "WS2M", "CLOUD_AMT")
PARAMS = ",".join(POWER_PARAMS)               # one source for the request and the read
FILL_MAX = -900.0                             # POWER fill value is -999
URL = ("https://power.larc.nasa.gov/api/temporal/hourly/point"
       f"?parameters={PARAMS}&community=RE&longitude={LON}&latitude={LAT}"
       "&start={start}&end={end}&format=JSON")

# The output columns ARE the reader's contract: _types.MetRow is the row shape
# fit-physics.py reads back out of this file. Taking the header from it means a
# column added here cannot silently fail to appear there, and it means the header
# does not depend on there being a first row to inspect.
FIELDS: list[str] = list(_types.MetRow.__annotations__)


class SuhiiRow(TypedDict):
    """The columns of data/calibration/ecostress-suhii.csv this script joins onto.
    csv.DictReader output: every value is str, including the numbers."""
    date: str
    phase: str
    status: str
    local_solar_hour: str
    view_delta: str
    usable_frac: str
    urban_mean: str
    rural_strict: str
    suhii: str


class MetOutRow(TypedDict):
    """One row on the way OUT. The same columns as _types.MetRow, but the four
    POWER values are still numbers here — csv stringifies them on write, and
    _types.MetRow is what they look like coming back."""
    date: str
    phase: str
    local_solar_hour: str
    view_delta: str
    usable_frac: str
    urban_mean: str
    rural_strict: str
    suhii: str
    tAir: float
    rh: float
    wind: float
    cloud: float


class PowerHeader(TypedDict):
    time_standard: str
    start: str
    end: str


class PowerGeometry(TypedDict):
    coordinates: list[float]        # [lon, lat, elevation]


class PowerProperties(TypedDict):
    parameter: dict[str, dict[str, float]]      # name -> {YYYYMMDDHH: value}


class PowerBlob(TypedDict):
    """The POWER hourly point response. It echoes the request back — geometry,
    parameter list and span — which is what makes the cache checkable."""
    header: PowerHeader
    geometry: PowerGeometry
    parameters: dict[str, dict[str, str]]
    properties: PowerProperties


def cache_is_for(blob: PowerBlob, start: str, end: str) -> bool:
    """Does this cached blob answer THIS request?

    Validated against POWER's own echo of the request — geometry, parameter list
    and span all come back in the response — rather than against a span field we
    wrote next to it. The cache is a single fixed path, so with only the span
    checked, changing PARAMS or LAT/LON returned a stale blob unaltered and the
    run then failed downstream with a KeyError naming the parameter rather than
    the cache. Any malformed or older-format cache reads as a miss.
    """
    try:
        if blob["header"]["start"] != start or blob["header"]["end"] != end:
            return False
        lon, lat = blob["geometry"]["coordinates"][0], blob["geometry"]["coordinates"][1]
        if (lon, lat) != (LON, LAT):
            return False
        return sorted(blob["parameters"]) == sorted(POWER_PARAMS)
    except (KeyError, IndexError, TypeError):
        return False


def power_hourly(start: str, end: str) -> PowerBlob:
    """One request for the whole span — 49 separate calls would be rude and slow."""
    if os.path.exists(CACHE):
        with open(CACHE) as fh:
            cached = cast(PowerBlob, json.load(fh))
        if cache_is_for(cached, start, end):
            return cached
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    url = URL.format(start=start, end=end)
    out = subprocess.run(["curl", "-s", "--fail", url], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"POWER request failed (curl {out.returncode})")
    raw = json.loads(out.stdout)
    if not isinstance(raw, dict) or "properties" not in raw:
        sys.exit(f"POWER returned no data: {str(raw)[:200]}")
    blob = cast(PowerBlob, raw)
    with open(CACHE, "w") as fh:
        json.dump(blob, fh)
    return blob


def reading(param: dict[str, dict[str, float]], stamp: str) -> tuple[float, ...] | None:
    """The four POWER parameters at one LST stamp, or None if the hour is unusable.

    A stamp POWER has no value for, or answers with its -999 fill, drops the
    scene: a fill value would enter the fit as a real -999 °C observation.
    """
    values: list[float] = []
    for name in POWER_PARAMS:
        v = param[name].get(stamp)
        if v is None or v <= FILL_MAX:
            return None
        values.append(v)
    return tuple(values)


def landsat_scenes() -> list[SuhiiRow]:
    """Landsat overpasses, shaped like SUHII rows so the join below is unchanged.

    ONE ENTRY PER OVERPASS, not per ward-row. Three wards share a pass's forcing
    — POWER is a single point for the whole study area — so emitting three rows
    would triple the work and put three identical readings in the file.

    The SUHII-only columns (view_delta, urban_mean, suhii …) have no meaning for
    a Landsat pass and are written empty rather than zero: a zero SUHII is a
    measurement, an empty one is an absence, and downstream readers already
    treat these as strings.
    """
    if not os.path.exists(LANDSAT):
        return []
    with open(LANDSAT) as fh:
        rows = json.load(fh)["rows"]
    by_pass: dict[str, SuhiiRow] = {}
    for r in rows:
        # Key on the date, not the scene id: two WRS tiles can deliver the same
        # overpass as two items, and they share one forcing hour.
        by_pass.setdefault(r["date"], cast("SuhiiRow", {
            "date": r["date"], "phase": "day", "status": "ok",
            "local_solar_hour": f'{r["hour_lst"]:.2f}',
            "view_delta": "", "usable_frac": "",
            "urban_mean": "", "rural_strict": "", "suhii": "",
        }))
    return sorted(by_pass.values(), key=lambda r: r["date"])


def main() -> None:
    with open(SCENES, newline="") as fh:
        rows_in = cast(list[SuhiiRow], list(csv.DictReader(fh)))
    scenes = [r for r in rows_in if r["status"] == "ok"]
    n_ecostress = len(scenes)
    # Landsat passes join through exactly the same LST-rounding path below. If
    # the two sources ever disagree about what `local_solar_hour` means, this is
    # where it would show up as forcing attached to the wrong hour, which is why
    # both go through one loop rather than two.
    scenes = scenes + landsat_scenes()
    print(f"  scenes: {n_ecostress} ECOSTRESS + {len(scenes) - n_ecostress} Landsat "
          f"overpasses = {len(scenes)}")
    if not scenes:
        sys.exit("no usable scenes in the calibration CSV")

    dates = sorted(r["date"] for r in scenes)
    blob = power_hourly(dates[0].replace("-", ""), dates[-1].replace("-", ""))

    # A raised error, not an assert: `python3 -O` strips asserts, and the whole
    # timezone-free join rests on this one invariant.
    if blob["header"]["time_standard"] != "LST":
        sys.exit(f"POWER time base is {blob['header']['time_standard']!r}, not LST — "
                 f"the local-solar-hour join in this script is no longer valid")

    # POWER omits a parameter it cannot serve rather than erroring on it, so a
    # silently short response must stop the run here, where the cause is legible.
    param = blob["properties"]["parameter"]
    absent = [name for name in POWER_PARAMS if name not in param]
    if absent:
        sys.exit(f"POWER served no {', '.join(absent)} for this point and span — "
                 f"requested {PARAMS}, got {', '.join(sorted(param)) or 'nothing'}")

    rows: list[MetOutRow] = []
    missing = 0
    for s in scenes:
        # POWER keys are YYYYMMDDHH in local solar time; round the scene's solar
        # hour to the nearest stamp rather than truncating, so a 13:50 overpass
        # takes the 14:00 reading it is closest to. Rounding 23.84 up to 24 must
        # roll the DATE forward too, or the scene silently takes a reading 24
        # hours early.
        hour = int(round(float(s["local_solar_hour"])))
        day = datetime.date.fromisoformat(s["date"])
        if hour >= 24:
            hour, day = hour - 24, day + datetime.timedelta(days=1)
        key = day.strftime("%Y%m%d") + f"{hour:02d}"
        vals = reading(param, key)
        if vals is None:
            missing += 1
            continue
        t2m, rh2m, ws2m, cloud_pct = vals
        rows.append({
            "date": s["date"], "phase": s["phase"],
            "local_solar_hour": s["local_solar_hour"],
            "view_delta": s["view_delta"],
            "usable_frac": s["usable_frac"],
            "urban_mean": s["urban_mean"], "rural_strict": s["rural_strict"],
            "suhii": s["suhii"],
            "tAir": round(t2m, 2), "rh": round(rh2m, 2),
            "wind": round(ws2m, 2), "cloud": round(cloud_pct / 100, 3),
        })

    # Guarded BEFORE the file is opened. Opening for write truncates it to zero
    # bytes, so losing every scene — a stale cache, or POWER answering the whole
    # span with fill values — used to destroy the existing forcing file and only
    # then raise, on `rows[0]`.
    if not rows:
        sys.exit(f"every one of the {len(scenes)} scenes lost its POWER forcing — "
                 f"{os.path.relpath(OUT, ROOT)} left as it was")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    print(f"  {len(rows)} scenes with forcing ({missing} dropped for missing POWER data)")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")
    for ph in ("day", "night"):
        v = [r for r in rows if r["phase"] == ph]
        if v:
            t = [r["tAir"] for r in v]
            print(f"    {ph:<6} n={len(v):<3} tAir {min(t):.1f}–{max(t):.1f} °C")


if __name__ == "__main__":
    main()
