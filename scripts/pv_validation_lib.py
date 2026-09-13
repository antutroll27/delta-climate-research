#!/usr/bin/env python3
"""The rooftop-validation laboratory: the daily-GHI yield model, the pre-registered
exclusions, and the pre-registered statistics.

    python3 scripts/pv_validation_lib.py --self-check     # offline, no network, no artefacts

WHAT THIS IS FOR. `docs/superpowers/specs/2026-09-07-pv-rooftop-validation-design.md`
is PRE-REGISTERED: §3 (the statistics), §4 (the exclusions) and §5 (the data template)
were fixed before a single measured kilowatt-hour existed. Everything below implements
those sections and nothing else. Changing a rule here is an amendment to that document,
dated, with what was known when it was made — not an edit.

WHY A DAILY MODEL AT ALL. The screen's chain (`build-pv-yield.py`) runs on five whole
years of NASA POWER *hourly* GHI. A recruited owner reports whole months, often only a
handful of them, in years the hourly cache does not cover; POWER's daily endpoint serves
any window, cheaply, one request per roof. So the roof-level prediction runs on daily GHI
and the chain's own physics.

THE SIMPLIFICATION, EXACTLY. Two things are assumed, and only two:

  1. THE DIURNAL SHAPE. The day's GHI total is spread across the day in proportion to
     sin(solar elevation) — i.e. the clearness index is held constant through the day.
     The real profile is not that smooth; cloud arrives at an hour, not uniformly.
  2. THE DIURNAL TEMPERATURE. Air temperature is held at the day's mean rather than
     following its own cycle, so the afternoon cell is modelled a little cool and the
     morning cell a little warm.

Everything else is the chain's BY IMPORT AND NOT BY COPY, and that is now literally
true: one timestep of Erbs, Hay-Davies and the NOCT temperature is `build-pv-yield.py`'s
own `step_dc`, called from here — the same function object its hourly loop runs. It used
to be a transcription of those four lines, which meant two versions of the physics that
could drift apart without either test noticing. `solar_altaz` (our own Spencer series, on
POWER's local-solar clock), the constants, and the 12.9 % system loss come the same way.

WHAT THE SIMPLIFICATION COSTS, MEASURED. Fed the chain's own five-year POWER record
aggregated to daily totals, this model returns 1325.3 kWh/kWp/yr against the chain's
1313.8 — **+0.88 %**. Fed the twelve-month climatology pinned below (the self-check's
case (a)) it returns 1325.7 — **+0.91 %**. Both are inside the 1 % the plan demands.

AND WHAT IT COSTS IF YOU FLATTEN FURTHER, also measured: a SINGLE constant daily GHI for
the whole year (4.340 kWh/m2/day, the same five-year mean) returns 1373.6 — **+4.55 %**.
The seasonal cycle is not decoration. Flattening it removes the monsoon's low-clearness
months, whose diffuse-heavy light transposes worst onto a 22 deg tilt, and the answer
drifts up by five times the tolerance. That is why the pinned climatology below has twelve
numbers and not one, and why the self-check uses it rather than a single flat value.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import warnings
from typing import Any, Callable, Mapping, Sequence, TypedDict

import numpy as np
from scipy.stats import spearmanr

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)


def _load_chain() -> Any:
    """`build-pv-yield.py` is hyphenated, so it is not an importable module name — the
    same `spec_from_file_location` route the chain itself uses to reach
    `measure-shadow-signtest.py`. It carries an `if __name__ == "__main__"` guard, so
    importing it runs no pipeline and touches no artefact."""
    spec = importlib.util.spec_from_file_location(
        "_pv_chain", os.path.join(HERE, "build-pv-yield.py"))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_pv_chain"] = mod
    spec.loader.exec_module(mod)
    return mod


_CHAIN = _load_chain()

# The chain's constants, BY IMPORT. Re-typed to float because everything reached
# through spec_from_file_location is `Any`, and `Any` silently defeats the checker.
TILT_DEG: float = float(_CHAIN.TILT_DEG)
AZIMUTH_DEG: float = float(_CHAIN.AZIMUTH_DEG)
SYSTEM_LOSS: float = float(_CHAIN.SYSTEM_LOSS)
NOCT_C: float = float(_CHAIN.NOCT_C)
GAMMA_PER_C: float = float(_CHAIN.GAMMA_PER_C)
PACKING_FACTOR: float = float(_CHAIN.PACKING_FACTOR)
PACKING_RANGE: tuple[float, float] = (float(_CHAIN.PACKING_RANGE[0]),
                                      float(_CHAIN.PACKING_RANGE[1]))
#: THE CHAIN'S CARD GATE, re-exported rather than re-typed. `build-pv-yield.py` owns the
#: rule that the card's yield band is validated only at n >= 25 (§6.3); this is that same
#: number, reached by import, so `measure-pv-validation.py` can gate on it without
#: minting a second copy. It is DELIBERATELY not SKILL_MIN_N below: the two 25s are two
#: different pre-registered decisions that happen to agree today, and an amendment to one
#: must not silently move the other.
VALIDATED_MIN_N: int = int(_CHAIN.VALIDATED_MIN_N)

#: Pre-registration §3, statistic 2: the accuracy claim passes at 80 % of roofs inside
#: +/-15 %. Both numbers are the pre-registration's, not tuning knobs.
WITHIN_BAND = 0.15
PASS_SHARE = 0.80
#: §3, statistic 3: the shading-skill test is DECLARED at n >= 25 and reported as
#: underpowered below it. Not "reported anyway with a caveat" — the spec allows two
#: outcomes and this is the boundary between them.
#:
#: THIS IS NOT THE CARD GATE. §6.3's "n >= 25 before the card's yield band is validated"
#: is a separate pre-registered decision, owned by `build-pv-yield.py` and re-exported
#: above as VALIDATED_MIN_N. They are equal today and nothing may assume they stay so.
SKILL_MIN_N = 25
#: §2/§4 and Q2: a roof carrying more than the top of the packing interval is a hard
#: failure of the geometry model for that roof. 0.40 / 0.28 = 1.428...
HARD_FAILURE_RATIO = PACKING_RANGE[1] / PACKING_RANGE[0]

#: The chain's Ballygunge answer, pinned. The self-check reads the ward artefact when it
#: is present and falls back to this, so the check still runs in a bare checkout.
CHAIN_SPECIFIC_YIELD_BALLYGUNGE = 1313.8
BALLYGUNGE_LAT = 22.528

#: NASA POWER's fill sentinel, tested the way the chain tests it (`< -900`, not
#: `== -999`: the API has served -999.0 and -999.00 both). POWER writes it for a missing
#: figure; treating it as a real zero would bury a dark day inside a monthly total.
POWER_FILL_BELOW: float = float(_CHAIN.POWER_FILL_BELOW)
#: The air temperature substituted for a day POWER did not measure. Re-exported from
#: build-pv-yield.py rather than re-typed: the chain substitutes the same 27 C on the
#: same reasoning (close to this cell's long-run mean, so a handful of days move nothing,
#: where a zero would put the cell 27 C cold and ADD yield), and if that judgement is ever
#: revised it must move in both models at once.
T_AIR_FALLBACK_C: float = float(_CHAIN.T_AIR_FALLBACK_C)

#: THE TWELVE-MONTH CLIMATOLOGY, aggregated from the chain's own five-year POWER hourly
#: cache (2020-2024, Ballygunge cell): mean daily GHI in kWh/m2/day and mean air
#: temperature in degC, by calendar month. Pinned rather than re-read, so the self-check
#: is offline and so this file states, in numbers a reader can check, the seasonal shape
#: the prorating below assumes. Re-derive with:
#:   sum of ALLSKY_SFC_SW_DWN per day / 1000, averaged by month, from
#:   ~/.cache/delta-climate/power-solar-hourly.json (and T2M from power-hourly.json).
MONTHLY_GHI_KWH_M2_DAY: tuple[float, ...] = (
    3.316, 4.268, 5.080, 5.669, 5.492, 4.518,
    4.485, 3.860, 4.006, 4.149, 3.953, 3.307)
MONTHLY_T2M_C: tuple[float, ...] = (
    24.30, 25.20, 26.21, 27.54, 27.16, 26.93,
    26.71, 26.46, 26.46, 26.24, 25.32, 24.45)

#: WHOSE CLIMATOLOGY. Ballygunge's POWER cell. The three wards span ~45 km, which moves
#: the annual total by a few per cent but barely moves its SEASONAL SHAPE — and only the
#: shape is used here, to prorate each ward's OWN annual specific yield onto the owner's
#: months. Named as an approximation rather than hidden: a ward-specific shape would need
#: three more POWER pulls for a correction smaller than the study's own spread.
CLIMATOLOGY_NOTE = ("seasonal shape from the Ballygunge POWER cell's 2020-2024 hourly "
                    "record; applied to each ward's own annual specific yield")


class RoofPrediction(TypedDict):
    """One roof, predicted, before any measured number exists (§6.1)."""
    y_pred: float          # as built: the owner's stated tilt/azimuth, their months, x (1 - loss)
    y_scr: float           # as screened: the chain's 22/180 climatology, prorated to their months
    y_null: float          # the null model: the ward's unshaded yield over the same months
    kwp: float             # the artefact's installable capacity at packing 0.28
    loss: float            # the artefact's annual A1 shading loss for this roof


class RoofMeasured(TypedDict):
    """One roof, as reported by its owner and reduced to §3's quantities."""
    y_meas: float          # sum of monthly kWh over the shared months, divided by P_i
    capacity_kwp: float    # P_i, the owner's stated installed DC capacity
    months: int            # how many months went into y_meas


# ── the model ───────────────────────────────────────────────────────────────


def _solar_altaz(hour: float, doy: int, lat: float) -> tuple[float, float]:
    """The chain's own solar position, on POWER's local-solar clock. No timestamp and no
    timezone is involved, which is exactly why the chain uses it (see its docstring)."""
    alt, az = _CHAIN.solar_altaz(hour, doy, lat)
    return float(alt), float(az)


def _doy(day: str) -> int:
    """'YYYYMMDD' -> day of year. POWER keys its daily series this way."""
    d = dt.date(int(day[0:4]), int(day[4:6]), int(day[6:8]))
    return (d - dt.date(d.year - 1, 12, 31)).days


def day_dc_kwh_per_kwp(ghi_kwh_m2: float, t_air_c: float, doy: int, lat: float,
                       tilt_deg: float, az_deg: float) -> float:
    """One day's DC output per kWp installed, BEFORE system losses and shading.

    The day's GHI total is spread over hourly steps in proportion to sin(elevation) —
    assumption 1 of the module docstring — and each step then runs the chain's physics
    unchanged: Erbs, Hay-Davies, NOCT."""
    if ghi_kwh_m2 <= 0.0:
        return 0.0
    hours = [h + 0.5 for h in range(24)]
    pos = [_solar_altaz(h, doy, lat) for h in hours]
    weights = [math.sin(math.radians(alt)) if alt > 0.0 else 0.0 for alt, _ in pos]
    total_w = sum(weights)
    if total_w <= 0.0:                       # polar night; unreachable at 22 N, cheap to hold
        return 0.0
    dc = 0.0
    for (alt, az), w in zip(pos, weights):
        if w <= 0.0:
            continue
        ghi = ghi_kwh_m2 * 1000.0 * w / total_w      # W/m2, mean over the hour
        # THE CHAIN'S OWN TIMESTEP, called not copied. Erbs, Hay-Davies, NOCT, gamma.
        dc += float(_CHAIN.step_dc(ghi, 90.0 - alt, az, t_air_c, doy, tilt_deg, az_deg))
    return dc / 1000.0


def predict_roof(ghi_daily: Mapping[str, float], t2m_daily: Mapping[str, float],
                 tilt_deg: float, az_deg: float, lat: float, loss: float) -> float:
    """kWh per kWp over the given days, at the given tilt and azimuth, after the chain's
    system loss and the roof's annual shading loss.

    `ghi_daily` and `t2m_daily` are keyed 'YYYYMMDD' — POWER's daily payload shape,
    unchanged. Fill values (-999) are skipped rather than counted as dark days: a day
    POWER did not measure is not a day the roof did not generate.

    NOTE, and it is §7's note too: `loss` is an ANNUAL shading figure applied to a
    possibly partial year. A roof measured only across the monsoon carries a small bias
    of unknown sign. Named, not corrected."""
    dc = 0.0
    for day, ghi in sorted(ghi_daily.items()):
        if ghi < POWER_FILL_BELOW or ghi <= 0.0:
            continue
        t_air = float(t2m_daily.get(day, T_AIR_FALLBACK_C))
        if t_air < POWER_FILL_BELOW:
            t_air = T_AIR_FALLBACK_C
        dc += day_dc_kwh_per_kwp(float(ghi), t_air, _doy(day), lat, tilt_deg, az_deg)
    return dc * (1.0 - SYSTEM_LOSS) * (1.0 - loss)


#: 'YYYY-MM', and nothing else. Checked at every read — the roster and the measured CSV
#: — because these strings reach three places where a malformed one does real damage:
#: the POWER request URL, the cache FILENAME under data/calibration/power-daily/, and the
#: month keys the two files are joined on. A row that says "Jan 2025" or "2025-13" must
#: be a named error at read time, not a silent no-match at score time or a stray path.
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def check_month(roof_id: str, field: str, month: str) -> str:
    if not MONTH_RE.match(month):
        sys.exit(f"  roof {roof_id}: {field} has {month!r}, which is not YYYY-MM")
    return month


def check_months(roof_id: str, field: str, months: Sequence[str]) -> list[str]:
    """Every month well-formed, and no month twice. A repeat in `kwh_by_month` would be
    silently last-wins in a dict — two different readings for one month, one of them
    thrown away without a word."""
    seen: set[str] = set()
    for month in months:
        check_month(roof_id, field, month)
        if month in seen:
            sys.exit(f"  roof {roof_id}: {field} lists {month} twice — "
                     "which reading is the real one is not something this can guess")
        seen.add(month)
    return list(months)


def check_unique_ids(rows: Sequence[Mapping[str, Any]], what: str) -> None:
    """One row per roof (§5). A duplicate id would be last-wins through every dict here,
    quietly dropping a roof from a study whose headline is its n."""
    seen: set[str] = set()
    for row in rows:
        rid = str(row.get("roof_id", "")).strip()
        if not rid:
            sys.exit(f"  {what} has a row with no roof_id")
        if rid in seen:
            sys.exit(f"  {what} lists roof {rid} twice — one row per roof (§5)")
        seen.add(rid)


def parse_number(roof_id: str, field: str, raw: Any, *, as_int: bool = False) -> float:
    """A number from a CSV cell, or an exit that NAMES THE ROOF AND THE FIELD. A bare
    ValueError from float() says what the text was but not whose it is, and a roster of
    thirty roofs then needs a bisect to find the one with a stray comma."""
    try:
        return float(int(str(raw).strip())) if as_int else float(str(raw).strip())
    except (TypeError, ValueError) as exc:
        sys.exit(f"  roof {roof_id}: {field} is {raw!r} — {exc}")


def parse_kwh_by_month(roof_id: str, raw: Any) -> dict[str, float]:
    """§5's `kwh_by_month` cell: a JSON list of [YYYY-MM, kWh] inside one CSV field. The
    single most hand-edited value in the study, so every way it can be wrong — not JSON,
    not a list, a pair that is not a pair, a month that is not a month, a month twice, a
    reading that is not a number — exits naming the roof."""
    if raw is None or str(raw).strip() == "":
        return {}
    try:
        parsed: Any = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        sys.exit(f"  roof {roof_id}: kwh_by_month is not JSON — {exc}")
    if not isinstance(parsed, list):
        sys.exit(f"  roof {roof_id}: kwh_by_month must be a list of [YYYY-MM, kWh] pairs")
    out: dict[str, float] = {}
    months: list[str] = []
    for pair in parsed:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            sys.exit(f"  roof {roof_id}: kwh_by_month has {pair!r}, "
                     "which is not a [YYYY-MM, kWh] pair")
        month = check_month(roof_id, "kwh_by_month", str(pair[0]))
        months.append(month)
        out[month] = parse_number(roof_id, f"kwh_by_month[{month}]", pair[1])
    check_months(roof_id, "kwh_by_month", months)
    return out


def _month_days(year: int, month: int) -> int:
    nxt = dt.date(year + (month // 12), (month % 12) + 1, 1)
    return (nxt - dt.date(year, month, 1)).days


def climatology_month_share(month: str) -> float:
    """The share of a climatological YEAR's yield that falls in one calendar month.

    Used to prorate the chain's ANNUAL specific yield — the number the product prints —
    onto the owner's months, so §3's statistic 4 (`y_meas / y_scr`) compares like with
    like instead of a partial year against a whole one. Built from the pinned twelve-month
    climatology at the chain's own 22 deg / 180 deg, so no network and no year-specific
    data enters. `month` is 'YYYY-MM'; the year matters only for February's length."""
    year, mon = int(month[0:4]), int(month[5:7])
    per_month: list[float] = []
    for m in range(1, 13):
        days = _month_days(year, m)
        mid = dt.date(year, m, 1) + dt.timedelta(days=days // 2)
        doy = (mid - dt.date(year - 1, 12, 31)).days
        per_month.append(days * day_dc_kwh_per_kwp(
            MONTHLY_GHI_KWH_M2_DAY[m - 1], MONTHLY_T2M_C[m - 1], doy,
            BALLYGUNGE_LAT, TILT_DEG, AZIMUTH_DEG))
    total = sum(per_month)
    return per_month[mon - 1] / total if total > 0.0 else 0.0


# ── NASA POWER daily, behind ONE function ───────────────────────────────────

#: THE SEAM. Every POWER daily read in this laboratory goes through `power_daily()`, and
#: `power_daily()` is the only place a network call can happen. Setting this to a callable
#: replaces the source wholesale, which is how all three self-checks run offline: they
#: inject a synthetic series and the network is never reached, not mocked-and-hoped.
POWER_SOURCE: Callable[[float, float, str, str], dict[str, dict[str, float]]] | None = None


def power_daily_cache_path(lat: float, lon: float, start: str, end: str) -> str:
    return os.path.join(ROOT, "data", "calibration", "power-daily",
                        f"{lat}_{lon}_{start}_{end}.json")


def power_daily(lat: float, lon: float, start: str, end: str) -> dict[str, dict[str, float]]:
    """{'ALLSKY_SFC_SW_DWN': {YYYYMMDD: kWh/m2/day}, 'T2M': {YYYYMMDD: degC}}, cached.

    Cached under data/calibration/power-daily/ and written atomically: a half-written
    cache is worse than none, and this is a pre-registered study whose inputs must be
    re-readable years later. curl rather than urllib for the same reason every other
    fetcher in scripts/ shells out — this Python's cert store fails POWER's chain."""
    if POWER_SOURCE is not None:
        return POWER_SOURCE(lat, lon, start, end)
    path = power_daily_cache_path(lat, lon, start, end)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            cached: dict[str, dict[str, float]] = json.load(fh)
        return cached
    url = ("https://power.larc.nasa.gov/api/temporal/daily/point"
           "?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE"
           f"&longitude={lon}&latitude={lat}&start={start}&end={end}&format=JSON")
    got = subprocess.run(["curl", "-s", "--fail", "--max-time", "180", url],
                         capture_output=True, text=True)
    if got.returncode != 0:
        sys.exit(f"  POWER daily request failed ({start}-{end}, curl {got.returncode})")
    try:
        payload: dict[str, Any] = json.loads(got.stdout)
    except json.JSONDecodeError as exc:
        # A truncated body, an HTML error page, a proxy notice. curl said 200; the bytes
        # are still not JSON, and a traceback here would name neither the window nor why.
        sys.exit(f"  POWER answered {start}-{end} with something that is not JSON "
                 f"({exc}); first bytes: {got.stdout[:120]!r}")
    param = payload.get("properties", {}).get("parameter")
    if not param:
        sys.exit(f"  POWER returned no parameters for {start}-{end}: "
                 f"{json.dumps(payload)[:200]}")
    for name in ("ALLSKY_SFC_SW_DWN", "T2M"):
        # Both, or neither is usable: the model joins irradiance to temperature day by
        # day, and a payload carrying only one of them would model every day at the
        # substituted air temperature without saying so.
        if name not in param:
            sys.exit(f"  POWER returned no {name} for {start}-{end} — asked for both "
                     "ALLSKY_SFC_SW_DWN and T2M")
    out: dict[str, dict[str, float]] = {
        "ALLSKY_SFC_SW_DWN": {k: float(v) for k, v in param["ALLSKY_SFC_SW_DWN"].items()},
        "T2M": {k: float(v) for k, v in param["T2M"].items()}}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    os.replace(tmp, path)
    return out


# ── §4, the exclusions ──────────────────────────────────────────────────────

#: §4, verbatim in rule form and in the order they are tested. First match owns the roof:
#: a tracker with four months is excluded as a tracker, and the count of exclusions
#: therefore sums to the number of roofs dropped, not to something larger.
EXCLUSION_RULES = ("tracker", "min_months_6", "outage_over_10pct",
                   "gaps_over_20pct", "capacity_unstated")
MIN_MONTHS = 6
MAX_OUTAGE_SHARE = 0.10
MAX_GAP_SHARE = 0.20
MAX_CAPACITY_UNCERTAINTY_PCT = 10.0


def _months_of(row: Mapping[str, Any]) -> list[str]:
    """The months an owner actually reported kWh for, validated on the way through."""
    return sorted(parse_kwh_by_month(str(row.get("roof_id", "?")), row.get("kwh_by_month")))


def _declared_months(row: Mapping[str, Any]) -> list[str]:
    """The months the owner says the export COVERS (`months_covered`, 'YYYY-MM;...'),
    which is what a gap is measured against — a month present in the span but absent
    from `kwh_by_month` is the gap."""
    rid = str(row.get("roof_id", "?"))
    raw = str(row.get("months_covered") or "").strip()
    return check_months(rid, "months_covered",
                        [m.strip() for m in raw.split(";") if m.strip()])


def _span_days(months: Sequence[str]) -> int:
    return sum(_month_days(int(m[0:4]), int(m[5:7])) for m in months)


def _float_or_none(value: Any) -> float | None:
    text = str(value).strip() if value is not None else ""
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def excluded_by(row: Mapping[str, Any]) -> str | None:
    """The §4 rule that excludes this roof, by name, or None if it is kept."""
    reported = _months_of(row)
    # A row with no `months_covered` falls back to the months it reported, and THE
    # CONSEQUENCE IS THAT SUCH A ROW CAN NEVER TRIP THE GAP RULE: measured against
    # itself, an export has no holes. That is the safe direction — a missing declaration
    # is a recruiter's omission, not evidence of a gap — but it does mean the gap rule
    # is only live for roofs whose owner said what the export was meant to cover.
    declared = _declared_months(row) or reported

    # tracker — THE COLUMN, and only the column: 'yes' excludes, 'no' and blank keep.
    # It used to also fire on the word "tracker" appearing anywhere in the free-text
    # `notes`, which excluded a recruiter who had written "not a tracker, fixed tilt" —
    # a valid roof, dropped, and INDISTINGUISHABLE in the result file from a real
    # tracker. An exclusion rule that reads prose is a rule whose input nobody can
    # audit; this one reads a field with three values and no others.
    tracker = str(row.get("tracker") or "").strip().lower()
    if tracker in ("yes", "y", "true", "1"):
        return "tracker"

    if len(reported) < MIN_MONTHS:
        return "min_months_6"

    # OUTAGE divides by the days of the REPORTED months — the days that actually
    # produced the kWh in `kwh_by_month`. Ten per cent of what was measured, not of what
    # was promised: an owner who exported six months and declared twelve is judged on the
    # six, or a short honest export would carry a threshold set by months it never had.
    outage = _float_or_none(row.get("outage_days_declared")) or 0.0
    reported_days = _span_days(reported)
    if reported_days > 0 and outage > MAX_OUTAGE_SHARE * reported_days:
        return "outage_over_10pct"

    # GAPS divides by the days of the DECLARED months (`months_covered`) — the span the
    # export claims to cover. That is the only denominator a hole can be measured
    # against: a missing month is by definition absent from the reported set, so
    # dividing by the reported days would make every export look gapless.
    declared_days = _span_days(declared)
    missing = [m for m in declared if m not in reported]
    if declared_days > 0 and _span_days(missing) > MAX_GAP_SHARE * declared_days:
        return "gaps_over_20pct"

    # A typo'd capacity ("5,4") is BAD INPUT, refused by roof id — never booked as the
    # pre-registered `capacity_unstated` exclusion, which is a published tally. Blank
    # stays blank (audit 2026-09-07).
    rid = str(row.get("roof_id", "?"))
    raw_kwp, raw_unc = row.get("kwp_dc"), row.get("capacity_uncertainty_pct")
    kwp_dc = None if raw_kwp in (None, "") or not str(raw_kwp).strip() else parse_number(rid, "kwp_dc", raw_kwp)
    uncertainty = None if raw_unc in (None, "") or not str(raw_unc).strip() else parse_number(rid, "capacity_uncertainty_pct", raw_unc)
    if kwp_dc is None or kwp_dc <= 0.0 or (
            uncertainty is not None and uncertainty > MAX_CAPACITY_UNCERTAINTY_PCT):
        return "capacity_unstated"
    return None


def apply_exclusions(
        rows: Sequence[Mapping[str, Any]]
) -> tuple[list[Mapping[str, Any]], dict[str, list[str]]]:
    """(kept rows, {rule name: [roof_id, ...]}). Every rule name in EXCLUSION_RULES is a
    key even when it excluded nobody, so the result file records that the rule RAN and
    found nothing — an absent key would be indistinguishable from an unimplemented rule."""
    kept: list[Mapping[str, Any]] = []
    by_rule: dict[str, list[str]] = {rule: [] for rule in EXCLUSION_RULES}
    for row in rows:
        rule = excluded_by(row)
        if rule is None:
            kept.append(row)
        else:
            by_rule[rule].append(str(row.get("roof_id", "?")))
    return kept, by_rule


# ── §3, the statistics ──────────────────────────────────────────────────────


def finite_or_none(value: float | None) -> float | None:
    """NaN and the infinities are not JSON. `json.dump` writes them as the bare tokens
    `NaN` and `Infinity`, which every strict parser — `JSON.parse` included — refuses, so
    a result file computed on zero roofs used to be unreadable by the very page meant to
    publish it. Every statistic goes through here on the way out, and `dump_json` below
    then writes with allow_nan=False so a missed one is an exception at write time rather
    than a broken file discovered in a browser."""
    if value is None or not math.isfinite(value):
        return None
    return value


def _strip_non_finite(obj: Any) -> Any:
    """`finite_or_none` applied to a whole nested structure, on the way to disk."""
    if isinstance(obj, dict):
        return {k: _strip_non_finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_strip_non_finite(v) for v in obj]
    # ints (counts, indices) pass through untouched: only a FLOAT can be non-finite,
    # and float(n) would publish "30.0 roofs" (review, 2026-09-07).
    if isinstance(obj, bool) or isinstance(obj, int) or not isinstance(obj, float):
        return obj
    return finite_or_none(float(obj))


def dump_json(obj: Any, path: str, *, indent: int | None = 2) -> None:
    """Write a result or a predictions file. Non-finite numbers become null first, and
    allow_nan=False makes any survivor raise here rather than ship."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(_strip_non_finite(obj), fh, indent=indent, allow_nan=False)


def _median(values: Sequence[float]) -> float | None:
    """None, not NaN, on an empty input — see finite_or_none. A study that scored no
    roofs has no median, and `null` is how a file says that."""
    if not values:
        return None
    return finite_or_none(float(np.median(np.asarray(values, dtype=float))))


def _round(value: float | None, places: int) -> float | None:
    return None if value is None else round(value, places)


def score(predictions: Mapping[str, RoofPrediction],
          measured: Mapping[str, RoofMeasured]) -> dict[str, Any]:
    """§3, exactly, over the roofs present in BOTH mappings.

    Q1 statistic 1: r_i = y_meas / y_pred (as built), with median, IQR and MAPE.
    Q1 statistic 2: the pass mark, 80 % of roofs inside +/-15 %. Two outcomes, no third.
    Q1 statistic 3: Spearman between the artefact's loss_i and the null shortfall,
                    DECLARED only at n >= 25.
    Q1 statistic 4: the median of y_meas / y_scr — the product's own printed number.
    Q2:             c_i = P_i / kwp_i, the share above our floor, and the hard failures
                    named by roof, not averaged away.

    MAPE's denominator is the PREDICTION, so it is exactly mean|r_i - 1| and the reader
    can recompute it from the ratios printed beside it."""
    ids = [rid for rid in sorted(predictions) if rid in measured]
    ratios = {rid: measured[rid]["y_meas"] / predictions[rid]["y_pred"]
              for rid in ids if predictions[rid]["y_pred"] > 0.0}
    scored = [rid for rid in ids if rid in ratios]
    r_values = [ratios[rid] for rid in scored]
    # `n` IS THE NUMBER OF ROOFS THE STATISTICS WERE COMPUTED ON, never the number that
    # matched a prediction. §8 says no accuracy figure is ever quoted without its n, and
    # that promise breaks the moment a published n sits beside a pass mark formed on
    # fewer roofs. `matched` carries the other count, separately, so the gap between them
    # is visible rather than absorbed.
    n = len(r_values)
    scr = {rid: measured[rid]["y_meas"] / predictions[rid]["y_scr"]
           for rid in ids if predictions[rid]["y_scr"] > 0.0}
    within = [1.0 if abs(r - 1.0) <= WITHIN_BAND else 0.0 for r in r_values]
    # An empty study has no share, no error and no spread — three nulls, not three zeros
    # and certainly not three NaNs. A zero within-share would read as "we measured, and
    # nothing was within 15 %", which is a finding rather than an absence of one.
    within_share = finite_or_none(float(np.mean(within))) if within else None
    mape = finite_or_none(float(np.mean([abs(r - 1.0) for r in r_values]))) if r_values else None
    q1, q3 = ((finite_or_none(float(np.percentile(np.asarray(r_values, dtype=float), 25))),
               finite_or_none(float(np.percentile(np.asarray(r_values, dtype=float), 75))))
              if r_values else (None, None))

    # Statistic 3. The null predicts every roof at the ward's UNSHADED yield; if our
    # per-roof shading has skill, the roofs we call shaded are the roofs that fall short
    # of it. Positive rho with p < 0.05, or nothing.
    losses = [predictions[rid]["loss"] for rid in ids if predictions[rid]["y_null"] > 0.0]
    shortfalls = [1.0 - measured[rid]["y_meas"] / predictions[rid]["y_null"]
                  for rid in ids if predictions[rid]["y_null"] > 0.0]
    skill: dict[str, Any]
    if len(losses) < SKILL_MIN_N:
        skill = {"status": "underpowered", "n": len(losses)}
    else:
        with warnings.catch_warnings():
            # scipy warns "An input array is constant" on exactly the degenerate case
            # handled two lines below. The result SAYS "degenerate" in a field a reader
            # can act on, which is a better channel than a warning on stderr.
            warnings.filterwarnings("ignore", message="An input array is constant")
            res = spearmanr(np.asarray(losses, dtype=float),
                            np.asarray(shortfalls, dtype=float))
        rho, p_value = float(res.statistic), float(res.pvalue)
        if not (math.isfinite(rho) and math.isfinite(p_value)):
            # Every roof carrying the SAME shading loss makes the rank correlation
            # undefined — scipy returns NaN — and a NaN under `status: "declared"` reads
            # as a test that ran and said nothing, which is worse than one that says it
            # could not run. There is no rho and no p here, so neither is written.
            skill = {"status": "degenerate", "reason": "no variance in loss",
                     "n": len(losses)}
        else:
            skill = {"status": "declared", "n": len(losses), "rho": round(rho, 4),
                     # 4 SIGNIFICANT figures, not 4 decimals: a real p of 5e-07 rounded to
                     # 4 dp is 0.0, which is not a p-value (review, 2026-09-07).
                     "p": float(f"{p_value:.4g}"),
                     "method": "scipy.stats.spearmanr (exact ranks, two-sided)",
                     "passes": bool(rho > 0.0 and p_value < 0.05)}

    # Q2. Owners install less than a roof can hold, so the SPREAD is the finding — but a
    # roof carrying more than the top of the packing interval is a failure of the geometry
    # model for that roof and is named.
    # Q2 runs over every MATCHED roof, not only the scored ones: c_i needs the owner's
    # capacity and the artefact's, and neither depends on a yield prediction existing.
    caps = {rid: measured[rid]["capacity_kwp"] / predictions[rid]["kwp"]
            for rid in ids if predictions[rid]["kwp"] > 0.0}
    c_values = [caps[rid] for rid in sorted(caps)]
    hard = [rid for rid in sorted(caps) if caps[rid] > HARD_FAILURE_RATIO]

    return {
        "n": n,
        "matched": len(ids),
        # The roofs behind `n` — the ones with a usable prediction. `matched_roof_ids` is
        # every roof that had both a prediction and a measurement, scored or not.
        "roof_ids": scored,
        "matched_roof_ids": ids,
        "ratios": {rid: round(ratios[rid], 4) for rid in sorted(ratios)},
        "median_ratio": _round(_median(r_values), 4),
        "iqr": [_round(q1, 4), _round(q3, 4)],
        "mape": _round(mape, 4),
        "within_15pct_share": _round(within_share, 4),
        "pass_mark": {"rule": f"at least {PASS_SHARE:.0%} of roofs within +/-{WITHIN_BAND:.0%}",
                      "passes": bool(within_share is not None
                                     and within_share >= PASS_SHARE and n > 0)},
        "screened_ratios": {rid: round(scr[rid], 4) for rid in sorted(scr)},
        "screened_median_ratio": _round(_median([scr[rid] for rid in sorted(scr)]), 4),
        "shading_skill": skill,
        "capacity": {
            "ratios": {rid: round(caps[rid], 4) for rid in sorted(caps)},
            "median": _round(_median(c_values), 4),
            "share_above_floor": _round(finite_or_none(
                float(np.mean([1.0 if c > 1.0 else 0.0 for c in c_values]))), 4)
            if c_values else None,
            "hard_failure_threshold": round(HARD_FAILURE_RATIO, 4),
            "hard_failures": hard,
        },
    }


def sha256_of(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def git_blob_hash(path: str) -> str:
    """`git hash-object` — the content hash the pre-registration is recorded by, so the
    result can be checked against the document that was registered, not a later edit."""
    got = subprocess.run(["git", "hash-object", path], capture_output=True, text=True,
                         cwd=ROOT)
    return got.stdout.strip() if got.returncode == 0 else "unavailable"


def git_is_dirty(path: str) -> bool:
    """Whether the file on disk differs from what HEAD holds. `git_commit_of` alone can
    say "committed" about a path whose working copy has since been edited — which for the
    predictions file is exactly the failure the pre-registration exists to prevent."""
    got = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", path],
                         capture_output=True, text=True, cwd=ROOT)
    return got.returncode != 0


def git_commit_of(path: str) -> str:
    """The commit that last touched a path — §6.2's record that the predictions were
    committed BEFORE the measured CSV existed."""
    got = subprocess.run(["git", "log", "-1", "--format=%H", "--", path],
                         capture_output=True, text=True, cwd=ROOT)
    commit = got.stdout.strip()
    return commit if got.returncode == 0 and commit else "uncommitted"


# ── the self-check ──────────────────────────────────────────────────────────


def _synthetic_year(ghi_by_month: Sequence[float], t2m_by_month: Sequence[float],
                    year: int) -> tuple[dict[str, float], dict[str, float]]:
    """A whole year of daily POWER-shaped series, held constant WITHIN each month at the
    pinned climatology. Twelve numbers, not one: the module docstring records what a
    single flat value costs (+4.55 %) and why the seasonal cycle stays."""
    ghi: dict[str, float] = {}
    t2m: dict[str, float] = {}
    for month in range(1, 13):
        for day in range(1, _month_days(year, month) + 1):
            key = f"{year:04d}{month:02d}{day:02d}"
            ghi[key] = ghi_by_month[month - 1]
            t2m[key] = t2m_by_month[month - 1]
    return ghi, t2m


def _chain_reference() -> float:
    """The chain's Ballygunge specific yield: read from its own browser artefact when
    present (so the check tracks the chain rather than a memory of it), else the pin."""
    path = os.path.join(ROOT, "public", "heat-map", "data", "pv-ballygunge.json")
    try:
        with open(path, encoding="utf-8") as fh:
            art: dict[str, Any] = json.load(fh)
        return float(art["specific_yield"])
    except (OSError, KeyError, ValueError, json.JSONDecodeError):
        return CHAIN_SPECIFIC_YIELD_BALLYGUNGE


def _self_check() -> None:
    # (a) THE REPRODUCTION. The daily model, fed the pinned twelve-month climatology at
    # the chain's own 22 deg / 180 deg with no shading, must land within 1 % of the
    # chain's hourly answer. This is the whole licence for using a daily model at all:
    # if it drifts, every y_pred below it is drifting too.
    ghi, t2m = _synthetic_year(MONTHLY_GHI_KWH_M2_DAY, MONTHLY_T2M_C, 2023)
    modelled = predict_roof(ghi, t2m, TILT_DEG, AZIMUTH_DEG, BALLYGUNGE_LAT, 0.0)
    reference = _chain_reference()
    err = modelled / reference - 1.0
    assert abs(err) <= 0.01, (
        f"daily model {modelled:.1f} vs chain {reference:.1f} kWh/kWp/yr "
        f"({err*100:+.2f} %) — outside the 1 % the plan allows; the daily "
        f"simplification has drifted from the hourly chain")
    print(f"  (a) daily model {modelled:.1f} vs chain {reference:.1f} kWh/kWp/yr "
          f"({err*100:+.2f} %)")

    # A shaded roof must fall exactly by its loss — the shading term is multiplicative and
    # nothing in the day loop may quietly re-apply or drop it.
    shaded = predict_roof(ghi, t2m, TILT_DEG, AZIMUTH_DEG, BALLYGUNGE_LAT, 0.20)
    assert abs(shaded - modelled * 0.80) < 1e-9, "the shading loss is not applied cleanly"
    # POWER's fill must be skipped, not counted as a dark day.
    filled = dict(ghi)
    filled["20230615"] = -999.0
    assert predict_roof(filled, t2m, TILT_DEG, AZIMUTH_DEG, BALLYGUNGE_LAT, 0.0) < modelled, \
        "a -999 fill day must be skipped, and skipping it must lower the total"

    # The twelve monthly shares are a partition of the year.
    shares = [climatology_month_share(f"2023-{m:02d}") for m in range(1, 13)]
    assert abs(sum(shares) - 1.0) < 1e-9, "the climatology month shares must sum to 1"
    assert shares[3] > shares[11], "April must out-yield December in Kolkata"

    # (b) THE STATISTICS. Five synthetic roofs whose ratios are exactly [0.9, 1.0, 1.1,
    # 1.2, 0.8]: median 1.0, three of five inside +/-15 %, MAPE 0.12, no hard failure.
    want = [0.9, 1.0, 1.1, 1.2, 0.8]
    preds: dict[str, RoofPrediction] = {}
    meas: dict[str, RoofMeasured] = {}
    for i, r in enumerate(want):
        rid = f"R{i}"
        preds[rid] = {"y_pred": 1000.0, "y_scr": 1100.0, "y_null": 1200.0,
                      "kwp": 10.0, "loss": 0.05 * i}
        meas[rid] = {"y_meas": 1000.0 * r, "capacity_kwp": 5.0, "months": 12}
    got = score(preds, meas)
    assert got["n"] == 5 and got["matched"] == 5, (got["n"], got["matched"])
    assert got["roof_ids"] == sorted(preds), got["roof_ids"]
    assert got["median_ratio"] == 1.0, got["median_ratio"]
    assert got["within_15pct_share"] == 0.6, got["within_15pct_share"]
    assert got["mape"] == 0.12, got["mape"]
    assert got["pass_mark"]["passes"] is False, "0.6 within-share must not clear the 80 % mark"
    assert got["capacity"]["hard_failures"] == [], got["capacity"]["hard_failures"]
    assert got["capacity"]["share_above_floor"] == 0.0, "0.5 of the floor is not above it"
    # Statistic 4 reads the SCREENED denominator, not the as-built one.
    assert got["screened_median_ratio"] == round(1000.0 / 1100.0, 4), got["screened_median_ratio"]
    # Statistic 3 is UNDERPOWERED at five roofs, and says so rather than reporting a rho.
    assert got["shading_skill"] == {"status": "underpowered", "n": 5}, got["shading_skill"]
    print(f"  (b) five synthetic roofs: median {got['median_ratio']}, within-15 "
          f"{got['within_15pct_share']}, MAPE {got['mape']}, skill "
          f"{got['shading_skill']['status']}")

    # n IS WHAT WAS SCORED. A sixth roof that matched but carries no usable prediction
    # must raise `matched` and leave `n` alone — otherwise a published "6 roofs" would
    # sit beside a within-15 share formed on five.
    preds_plus = dict(preds)
    meas_plus = dict(meas)
    preds_plus["R5"] = {"y_pred": 0.0, "y_scr": 1100.0, "y_null": 1200.0,
                        "kwp": 10.0, "loss": 0.0}
    meas_plus["R5"] = {"y_meas": 950.0, "capacity_kwp": 5.0, "months": 12}
    partial = score(preds_plus, meas_plus)
    assert partial["n"] == 5 and partial["matched"] == 6, (partial["n"], partial["matched"])
    assert "R5" not in partial["roof_ids"] and "R5" in partial["matched_roof_ids"]
    assert partial["within_15pct_share"] == got["within_15pct_share"], \
        "an unscoreable roof must not move a statistic it did not enter"
    # Q2 is a different question and DOES see it — capacity needs no yield prediction.
    assert "R5" in partial["capacity"]["ratios"], partial["capacity"]["ratios"]

    # The skill test DOES declare once n >= 25, and finds the signal when it is there.
    big_p: dict[str, RoofPrediction] = {}
    big_m: dict[str, RoofMeasured] = {}
    for i in range(SKILL_MIN_N):
        rid = f"S{i:02d}"
        loss = 0.01 * i
        big_p[rid] = {"y_pred": 1000.0, "y_scr": 1100.0, "y_null": 1200.0,
                      "kwp": 10.0, "loss": loss}
        big_m[rid] = {"y_meas": 1200.0 * (1.0 - loss), "capacity_kwp": 5.0, "months": 12}
    skill = score(big_p, big_m)["shading_skill"]
    assert skill["status"] == "declared" and skill["passes"] is True, skill
    assert skill["rho"] > 0.99, skill
    # a perfect monotone series gives p exactly 0.0 (an infinite t statistic), so the
    # rounding regression is caught on a NOISY series instead: rho below 1, p tiny but
    # positive, and NOT flattened to 0.0 the way 4-decimal rounding did (2026-09-07)
    assert skill["p"] >= 0.0, skill
    noisy_p: dict[str, RoofPrediction] = {}
    noisy_m: dict[str, RoofMeasured] = {}
    for k in range(25):
        rid = f"N{k}"
        loss = 0.30 * k / 24.0
        wiggle = 0.03 if k % 2 else -0.03
        noisy_p[rid] = {"y_pred": 1000.0, "y_scr": 1000.0, "y_null": 1200.0, "kwp": 10.0, "loss": loss}
        noisy_m[rid] = {"y_meas": 1200.0 * (1.0 - min(0.95, max(0.0, loss + wiggle))),
                        "capacity_kwp": 5.0, "months": 12}
    noisy = score(noisy_p, noisy_m)["shading_skill"]
    assert noisy["status"] == "declared" and noisy["passes"] is True, noisy
    assert 0.0 < noisy["p"] < 0.05, noisy

    # (c) THE EXCLUSIONS, by rule name. A four-month owner goes out on min_months_6.
    rows: list[Mapping[str, Any]] = [
        {"roof_id": "keep", "kwp_dc": "5.0", "months_covered": "2025-01;2025-02;2025-03;"
                                                                "2025-04;2025-05;2025-06",
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 7)]),
         "outage_days_declared": "2", "notes": ""},
        {"roof_id": "short", "kwp_dc": "5.0", "months_covered": "2025-01;2025-02;2025-03;2025-04",
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 5)]),
         "outage_days_declared": "0", "notes": ""},
        {"roof_id": "tracked", "kwp_dc": "5.0", "tracker": "yes", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "0", "notes": ""},
        # tracker = 'no' KEEPS the roof, and so does a blank column (the "keep" row
        # above has no `tracker` key at all).
        {"roof_id": "fixed", "kwp_dc": "5.0", "tracker": "no", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "0", "notes": ""},
        # THE REGRESSION. A recruiter's note that says the roof is NOT a tracker must not
        # exclude it. The rule reads the column; prose is not an input.
        {"roof_id": "prose", "kwp_dc": "5.0", "tracker": "", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "0", "notes": "not a tracker, fixed tilt, single-axis "
                                               "quote was declined"},
        {"roof_id": "dark", "kwp_dc": "5.0", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "60", "notes": ""},
        {"roof_id": "gappy", "kwp_dc": "5.0", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 9)]),
         "outage_days_declared": "0", "notes": ""},
        {"roof_id": "vague", "kwp_dc": "", "months_covered": ";".join(
            f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "0", "notes": ""},
        {"roof_id": "fuzzy", "kwp_dc": "5.0", "capacity_uncertainty_pct": "25",
         "months_covered": ";".join(f"2025-{m:02d}" for m in range(1, 13)),
         "kwh_by_month": json.dumps([[f"2025-{m:02d}", 500.0] for m in range(1, 13)]),
         "outage_days_declared": "0", "notes": ""},
    ]
    kept, by_rule = apply_exclusions(rows)
    assert [r["roof_id"] for r in kept] == ["keep", "fixed", "prose"], \
        [r["roof_id"] for r in kept]
    assert by_rule["min_months_6"] == ["short"], by_rule
    assert by_rule["tracker"] == ["tracked"], by_rule
    assert by_rule["outage_over_10pct"] == ["dark"], by_rule
    assert by_rule["gaps_over_20pct"] == ["gappy"], by_rule
    assert by_rule["capacity_unstated"] == ["vague", "fuzzy"], by_rule
    assert set(by_rule) == set(EXCLUSION_RULES), "every rule must appear, even at zero"
    assert sum(len(v) for v in by_rule.values()) == len(rows) - len(kept), \
        "first rule owns the roof — the exclusion counts must sum to the roofs dropped"
    print(f"  (c) exclusions: {', '.join(f'{k}={len(v)}' for k, v in by_rule.items())}")
    # A typo'd capacity is refused by roof id, not booked as capacity_unstated.
    import io, contextlib
    typo = dict(rows[0], roof_id="typo", kwp_dc="5,4")
    with contextlib.redirect_stderr(io.StringIO()):
        try:
            apply_exclusions([typo])
        except SystemExit as exc:
            assert "typo" in str(exc) and "kwp_dc" in str(exc), exc
        else:
            raise AssertionError("kwp_dc '5,4' must refuse, not exclude")

    # (d) A HARD FAILURE. c = 1.5 is above 0.40/0.28 = 1.43, so the roof is named.
    preds["R0"] = {"y_pred": 1000.0, "y_scr": 1100.0, "y_null": 1200.0,
                   "kwp": 10.0, "loss": 0.0}
    meas["R0"] = {"y_meas": 900.0, "capacity_kwp": 15.0, "months": 12}
    flagged = score(preds, meas)
    assert flagged["capacity"]["hard_failures"] == ["R0"], flagged["capacity"]
    assert flagged["capacity"]["ratios"]["R0"] == 1.5
    assert flagged["capacity"]["share_above_floor"] == 0.2, flagged["capacity"]
    assert 1.42 < flagged["capacity"]["hard_failure_threshold"] < 1.43
    print(f"  (d) c=1.5 flagged: {flagged['capacity']['hard_failures']} "
          f"(threshold {flagged['capacity']['hard_failure_threshold']})")

    # (e) NOTHING NON-FINITE MAY REACH A FILE. A study that scored no roofs has nulls,
    # not NaNs — and the file it writes must parse, because the page that publishes it
    # uses JSON.parse, which refuses the bare token NaN.
    empty = score({}, {})
    assert empty["n"] == 0 and empty["matched"] == 0, empty
    for key in ("median_ratio", "mape", "screened_median_ratio", "within_15pct_share"):
        assert empty[key] is None, (key, empty[key])
    assert empty["iqr"] == [None, None], empty["iqr"]
    assert empty["capacity"]["median"] is None and empty["capacity"]["share_above_floor"] is None
    assert empty["pass_mark"]["passes"] is False, "an empty study cannot pass"
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "empty.json")
        dump_json(empty, path)
        with open(path, encoding="utf-8") as fh:
            assert json.load(fh)["median_ratio"] is None
        # And the writer REFUSES a NaN that reached it some other way, rather than
        # writing a file no strict parser will read.
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"x": float("nan")}, fh, allow_nan=False)
            raise AssertionError("allow_nan=False must refuse a NaN")
        except ValueError:
            pass
        assert _strip_non_finite({"x": float("nan"), "y": [float("inf"), 1.0]}) == \
            {"x": None, "y": [None, 1.0]}
        # counts stay integers: the receipt must say "30 roofs", never "30.0"
        scrubbed = _strip_non_finite({"n": 30, "idx": 0, "ok": True, "r": 1.5})
        assert scrubbed == {"n": 30, "idx": 0, "ok": True, "r": 1.5} and isinstance(scrubbed["n"], int), scrubbed

    # (f) A DEGENERATE SPEARMAN IS NOT A DECLARED ONE. Twenty-five roofs all carrying the
    # same shading loss make the rank correlation undefined; scipy returns NaN and the
    # result must say it could not run, with no rho and no p to misread.
    flat_p: dict[str, RoofPrediction] = {}
    flat_m: dict[str, RoofMeasured] = {}
    for i in range(SKILL_MIN_N):
        rid = f"F{i:02d}"
        flat_p[rid] = {"y_pred": 1000.0, "y_scr": 1100.0, "y_null": 1200.0,
                       "kwp": 10.0, "loss": 0.10}
        flat_m[rid] = {"y_meas": 1000.0 + i, "capacity_kwp": 5.0, "months": 12}
    degenerate = score(flat_p, flat_m)["shading_skill"]
    assert degenerate == {"status": "degenerate", "reason": "no variance in loss",
                          "n": SKILL_MIN_N}, degenerate
    print(f"  (e) empty study -> nulls that parse; (f) flat loss -> {degenerate['status']}")

    # (g) BAD INPUT NAMES THE ROOF. Every one of these is an exit, not a traceback, and
    # every message carries the roof id.
    for bad, why in (
            ({"roof_id": "B1", "kwh_by_month": "not json"}, "not JSON"),
            ({"roof_id": "B2", "kwh_by_month": chr(39)}, "not a list"),
            ({"roof_id": "B3", "kwh_by_month": '[["2025-13", 5]]'}, "month 13"),
            ({"roof_id": "B4", "kwh_by_month": '[["Jan 2025", 5]]'}, "not YYYY-MM"),
            ({"roof_id": "B5", "kwh_by_month": '[["2025-01", 5], ["2025-01", 6]]'}, "twice"),
            ({"roof_id": "B6", "kwh_by_month": '[["2025-01", "lots"]]'}, "not a number"),
            ({"roof_id": "B7", "kwh_by_month": '[["2025-01"]]'}, "not a pair"),
            ({"roof_id": "B8", "kwh_by_month": "[]", "months_covered": "2025-1"}, "roster month")):
        try:
            excluded_by(bad)
            raise AssertionError(f"{why} must be refused, not accepted")
        except SystemExit as exc:
            assert bad["roof_id"] in str(exc), (why, str(exc))
    try:
        check_unique_ids([{"roof_id": "D"}, {"roof_id": "D"}], "the measured CSV")
        raise AssertionError("a duplicate roof_id must be refused")
    except SystemExit as exc:
        assert "D" in str(exc) and "twice" in str(exc), str(exc)
    try:
        parse_number("N1", "kwp_dc", "5,4")
        raise AssertionError("a stray comma must be refused")
    except SystemExit as exc:
        assert "N1" in str(exc) and "kwp_dc" in str(exc), str(exc)
    print("  (g) malformed cells refused by roof id: 8 shapes + duplicate id + bad number")

    # The seam: with POWER_SOURCE set, no network is reachable at all.
    global POWER_SOURCE
    POWER_SOURCE = lambda lat, lon, start, end: {  # noqa: E731
        "ALLSKY_SFC_SW_DWN": {"20250101": 4.0}, "T2M": {"20250101": 24.0}}
    assert power_daily(1.0, 2.0, "20250101", "20250101")["ALLSKY_SFC_SW_DWN"] == {"20250101": 4.0}
    POWER_SOURCE = None

    print("  self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-check", action="store_true",
                    help="offline: the model reproduction, the statistics, the exclusions")
    args = ap.parse_args()
    if not args.self_check:
        ap.error("this is a library; run --self-check, or import it from the two scripts")
    _self_check()


if __name__ == "__main__":
    main()
