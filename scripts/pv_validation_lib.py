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

Everything else is the chain's, by import and not by copy: `solar_altaz` (our own Spencer
series, on POWER's local-solar clock), Erbs for the beam/diffuse split, Hay-Davies for the
transposition, the NOCT cell-temperature model with the chain's NOCT and gamma, and the
chain's 12.9 % system loss. If any of those constants move in `build-pv-yield.py`, they
move here in the same run.

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
import subprocess
import sys
from typing import Any, Callable, Mapping, Sequence, TypedDict

import numpy as np
import pvlib
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

#: NASA POWER's fill value. POWER writes -999 for a missing daily figure; treating it as
#: a real zero would quietly bury a dark day inside a monthly total.
POWER_FILL = -900.0

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
    dni_extra = float(pvlib.irradiance.get_extra_radiation(doy))
    dc = 0.0
    for (alt, az), w in zip(pos, weights):
        if w <= 0.0:
            continue
        ghi = ghi_kwh_m2 * 1000.0 * w / total_w      # W/m2, mean over the hour
        zen = 90.0 - alt
        dec = pvlib.irradiance.erbs(ghi, zen, doy)
        tot = pvlib.irradiance.get_total_irradiance(
            tilt_deg, az_deg, zen, az, float(dec["dni"]), ghi, float(dec["dhi"]),
            dni_extra=dni_extra, model="haydavies")
        poa = float(tot["poa_global"])
        # Cell temperature from the PLANE-OF-ARRAY irradiance, as the chain does — a
        # tilted panel runs hotter than the horizontal it was measured on.
        t_cell = t_air_c + (NOCT_C - 20.0) / 800.0 * poa
        dc += poa * (1.0 + GAMMA_PER_C * (t_cell - 25.0))
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
        if ghi <= POWER_FILL or ghi <= 0.0:
            continue
        t_air = float(t2m_daily.get(day, 27.0))
        if t_air <= POWER_FILL:
            t_air = 27.0
        dc += day_dc_kwh_per_kwp(float(ghi), t_air, _doy(day), lat, tilt_deg, az_deg)
    return dc * (1.0 - SYSTEM_LOSS) * (1.0 - loss)


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
    payload: dict[str, Any] = json.loads(got.stdout)
    param = payload.get("properties", {}).get("parameter")
    if not param:
        sys.exit(f"  POWER returned no parameters: {json.dumps(payload)[:200]}")
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
    """The months an owner actually reported kWh for, from §5's `kwh_by_month` cell (a
    JSON list of [YYYY-MM, kWh] inside the CSV field)."""
    raw = row.get("kwh_by_month") or "[]"
    if isinstance(raw, str):
        parsed: Any = json.loads(raw)
    else:
        parsed = raw
    return [str(pair[0]) for pair in parsed]


def _declared_months(row: Mapping[str, Any]) -> list[str]:
    """The months the owner says the export COVERS (`months_covered`, 'YYYY-MM;...'),
    which is what a gap is measured against — a month present in the span but absent
    from `kwh_by_month` is the gap."""
    raw = str(row.get("months_covered") or "").strip()
    return [m.strip() for m in raw.split(";") if m.strip()]


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

    kwp_dc = _float_or_none(row.get("kwp_dc"))
    uncertainty = _float_or_none(row.get("capacity_uncertainty_pct"))
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


def _median(values: Sequence[float]) -> float:
    return float(np.median(np.asarray(values, dtype=float))) if values else float("nan")


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
    within_share = float(np.mean(within)) if within else 0.0
    mape = float(np.mean([abs(r - 1.0) for r in r_values])) if r_values else float("nan")
    q1, q3 = ((float(np.percentile(np.asarray(r_values, dtype=float), 25)),
               float(np.percentile(np.asarray(r_values, dtype=float), 75)))
              if r_values else (float("nan"), float("nan")))

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
        res = spearmanr(np.asarray(losses, dtype=float), np.asarray(shortfalls, dtype=float))
        rho, p_value = float(res.statistic), float(res.pvalue)
        skill = {"status": "declared", "n": len(losses), "rho": round(rho, 4),
                 "p": p_value, "method": "scipy.stats.spearmanr (exact ranks, two-sided)",
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
        "median_ratio": round(_median(r_values), 4),
        "iqr": [round(q1, 4), round(q3, 4)],
        "mape": round(mape, 4),
        "within_15pct_share": round(within_share, 4),
        "pass_mark": {"rule": f"at least {PASS_SHARE:.0%} of roofs within +/-{WITHIN_BAND:.0%}",
                      "passes": bool(within_share >= PASS_SHARE and n > 0)},
        "screened_ratios": {rid: round(scr[rid], 4) for rid in sorted(scr)},
        "screened_median_ratio": round(_median([scr[rid] for rid in sorted(scr)]), 4),
        "shading_skill": skill,
        "capacity": {
            "ratios": {rid: round(caps[rid], 4) for rid in sorted(caps)},
            "median": round(_median(c_values), 4),
            "share_above_floor": round(
                float(np.mean([1.0 if c > 1.0 else 0.0 for c in c_values])), 4)
            if c_values else 0.0,
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
