#!/usr/bin/env python3
"""
Attach meteorological forcing to each ECOSTRESS calibration scene.

    python3 scripts/fetch-met.py
    python3 scripts/fetch-met.py --check   # verify the committed CSV's stamps offline

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

TIME BASE. POWER hourly is stamped in Local Solar Time at the queried longitude,
so each scene's reading is found by converting the pass's own UTC instant to that
clock, date and hour together, in _power.power_stamp. The scene's local solar
HOUR is not enough on its own: joined to the UTC DATE, it read POWER a day early
for a pass after local midnight but before UTC midnight, which here is a night
pass, until the correction recorded in _power.py. The LST check below is a raised
error rather than an assert: under `python3 -O` asserts vanish, and every scene
would silently join to the wrong hour.

Output: data/calibration/met-forcing.csv
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import subprocess
import sys
from typing import TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _power  # noqa: E402  (path must be set first — the scripts are not a package)
import _types  # noqa: E402

ROOT = os.path.join(HERE, "..")
SCENES = os.path.join(ROOT, "data", "calibration", "ecostress-suhii.csv")
LANDSAT = os.path.join(ROOT, "data", "calibration", "landsat-ward-lst.json")
OUT = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
CACHE = os.path.expanduser("~/.cache/delta-climate/power-hourly.json")

LAT, LON = _power.POWER_LAT, _power.POWER_LON  # the one POWER query point; defined once, in _power.py
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
    utc: str
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
    utc: str
    power_stamp: str


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
            "utc": f'{r["date"]}T{r["time_utc"].rstrip("Z")}',
            "local_solar_hour": f'{r["hour_lst"]:.2f}',
            "view_delta": "", "usable_frac": "",
            "urban_mean": "", "rural_strict": "", "suhii": "",
        }))
    return sorted(by_pass.values(), key=lambda r: r["date"])


def _hour_gap(utc: str, local_solar_hour: str) -> float:
    """Hours between `utc` read on POWER's clock and a recorded local solar hour, mod 24."""
    t = dt.datetime.fromisoformat(utc.rstrip("Z")) + dt.timedelta(hours=LON / 15)
    return abs((t.hour + t.minute / 60 + t.second / 3600 - float(local_solar_hour) + 12) % 24 - 12)


def check() -> int:
    """Every committed forcing row read the POWER stamp its own UTC instant implies.

    Offline and cache-free, so CI can run it: it re-derives each row's stamp from the
    row's own `utc` column and compares. A row keyed the old way — UTC date plus local
    solar hour — fails here for every pass after local midnight but before UTC midnight.
    """
    name = os.path.relpath(OUT, ROOT)
    with open(OUT, newline="") as fh:
        rows = cast(list[_types.MetRow], list(csv.DictReader(fh)))
    if not rows:
        print(f"  {name} has no rows")
        return 1
    missing = [c for c in ("utc", "power_stamp") if c not in rows[0]]
    if missing:
        print(f"  {name} lacks {', '.join(missing)} — rebuild it")
        return 1
    bad = 0
    for r in rows:
        utc, got, where = r["utc"], r["power_stamp"], f"{r['date']} {r['phase']}"
        try:
            # a short row reads None and an empty cell "", neither of which is an instant
            want = _power.power_stamp(utc, LON) if utc else None
        except ValueError:
            want = None
        if want is None:
            print(f"  BAD UTC {where}: {utc!r} is not an ISO-8601 instant")
            bad += 1
        elif got != want:
            print(f"  WRONG STAMP {where}: the row read {got!r}, its UTC instant implies {want}")
            bad += 1
        # The stamp is only as good as `utc`, so pin `utc` to two columns the scene lists
        # wrote before this script ran: its UTC date, and its local solar hour (computed at
        # the scene's own meridian with seconds dropped, so a few minutes' slack; the
        # largest gap measured on the committed rows is 63 s).
        elif utc[:10] != r["date"] or _hour_gap(utc, r["local_solar_hour"]) > 0.1:
            print(f"  UTC DISAGREES {where}: utc {utc}, local solar hour {r['local_solar_hour']}")
            bad += 1
    if bad:
        print(f"  {bad} of {len(rows)} forcing rows fail")
        return 1
    print(f"  {len(rows)} forcing rows: every POWER stamp matches the row's own UTC instant")
    return 0


def main() -> None:
    with open(SCENES, newline="") as fh:
        rows_in = cast(list[SuhiiRow], list(csv.DictReader(fh)))
    scenes = [r for r in rows_in if r["status"] == "ok"]
    n_ecostress = len(scenes)
    # Landsat passes join through exactly the same UTC-instant path below. If
    # the two sources ever disagree about what `utc` means, this is where it
    # would show up as forcing attached to the wrong hour, which is why both go
    # through one loop rather than two.
    scenes = scenes + landsat_scenes()
    print(f"  scenes: {n_ecostress} ECOSTRESS + {len(scenes) - n_ecostress} Landsat "
          f"overpasses = {len(scenes)}")
    if not scenes:
        sys.exit("no usable scenes in the calibration CSV")

    dates = sorted(r["date"] for r in scenes)
    blob = power_hourly(dates[0].replace("-", ""), dates[-1].replace("-", ""))

    # A raised error, not an assert: `python3 -O` strips asserts, and the whole
    # join rests on this one invariant — _power.power_stamp converts each pass's
    # UTC instant to local solar time because that is the clock POWER stamps in.
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
        # The POWER stamp comes from the pass's own UTC instant, date and hour in one
        # calculation (_power.power_stamp). Building it from the scene's UTC DATE plus
        # its local solar HOUR read POWER 24 hours early for every pass after local
        # midnight but before UTC midnight — 20 of 97 rows, all at night (2026-09-23
        # audit, item 3).
        key = _power.power_stamp(s["utc"], LON)
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
            "utc": s["utc"], "power_stamp": key,
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
    ap = argparse.ArgumentParser(description="Attach NASA POWER hourly forcing to each calibration scene.")
    ap.add_argument("--check", action="store_true",
                    help="verify the committed CSV's POWER stamps offline; fetches and writes nothing")
    if ap.parse_args().check:
        sys.exit(check())
    main()
