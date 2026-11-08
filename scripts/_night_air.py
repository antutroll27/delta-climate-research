"""
The Kolkata night-air correction, Python mirror of src/lib/weather/night-air.ts.

    python3 scripts/_night_air.py        # self-test

WHAT IT IS. The live "Now" view is forced at night by Dum Dum (VECC) METAR air, but the model's
night constants and its +/-3.0 K band were earned on NASA POWER T2M, which at night is cooler than
the airport by a seasonal 0.2 to 3.6 K. The correction is a 12-month table of
(VECC air - POWER T2M), measured air against air over night instants and NEVER fitted to satellite
LST, subtracted from the airport reading when the sun is at or below SUN_LIT.

WHY A MIRROR. The TypeScript is the instrument; this is the lab's copy so the table can be built
and the 49 night scenes re-scored. check-night-air-parity.py holds the two to 1e-6 K.

THE THREE RULES, each the product's own:
  night   sun <= SUN_LIT, with sun = solar_factor(solar hour, UTC day of year, latitude): what
          heat-map-app.ts does for "Now" (wardSolarHour, dayOfYearUtc, solarElevationFactor).
  month   the calendar month in IST (UTC+5:30, fixed) of the instant.
  scope   the air temperature that enters the model, VECC only. RH, wind and the day branch are
          untouched; the air tile keeps the airport's reading.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Final, NewType, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402  (the scripts are not a package)

ROOT = os.path.normpath(os.path.join(HERE, ".."))
TABLE_PATH: Final = os.path.join(ROOT, "data", "night-air", "vecc-night-air.json")

Celsius = NewType("Celsius", float)   # an absolute air temperature
Kelvin = NewType("Kelvin", float)     # a temperature DIFFERENCE: a table entry, a correction
Month = NewType("Month", int)         # 1..12, IST calendar month

#: The one POWER point the Kolkata forcing is read at (scripts/_power.py POWER_LAT / POWER_LON).
POWER_LAT: Final = 22.55
POWER_LON: Final = 88.37
IST: Final = dt.timedelta(hours=5, minutes=30)
SUN_LIT: Final = _physics.SUN_LIT
MONTHS: Final = 12


class TableJson(TypedDict):
    """data/night-air/vecc-night-air.json (build-night-air-table.py). Only the fields read here."""
    icao: str
    offsets_k: list[float]
    n_instants: list[int]


@dataclass(frozen=True)
class NightAirTable:
    icao: str
    #: VECC air minus POWER T2M, mean over the month's night instants; index 0 = January.
    offsets_k: tuple[Kelvin, ...]
    n: tuple[int, ...]

    def __post_init__(self) -> None:
        if len(self.offsets_k) != MONTHS or len(self.n) != MONTHS:
            raise ValueError(f"{self.icao}: a night-air table has {MONTHS} months")

    def offset(self, month: Month) -> Kelvin:
        return self.offsets_k[month - 1]


def load_table(path: str = TABLE_PATH) -> NightAirTable:
    with open(path, encoding="utf-8") as fh:
        j = cast(TableJson, json.load(fh))
    return NightAirTable(icao=j["icao"], offsets_k=tuple(Kelvin(x) for x in j["offsets_k"]),
                         n=tuple(j["n_instants"]))


# ── the product's clock, as heat-map-app.ts reads it ─────────────────────────
def parse_utc(s: str) -> dt.datetime:
    """`2026-03-05T23:46:10Z`, `2026-03-05 23:46` or with an offset, as a naive UTC datetime."""
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T"))
    if t.tzinfo is not None:
        t = t.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return t


def solar_hour(utc: dt.datetime, lon: float) -> float:
    """wardSolarHour(): ((UTC hour of day + lon / 15) mod 24)."""
    h = utc.hour + utc.minute / 60 + utc.second / 3600 + utc.microsecond / 3.6e9
    return (h + lon / 15.0) % 24.0


def sun_at(utc: dt.datetime, lat: float = POWER_LAT, lon: float = POWER_LON) -> float:
    """cos z the product branches on: solarElevationFactor(wardSolarHour, dayOfYearUtc, lat)."""
    return _physics.solar_factor(solar_hour(utc, lon), utc.timetuple().tm_yday, lat)


def is_night(utc: dt.datetime, lat: float = POWER_LAT, lon: float = POWER_LON) -> bool:
    return sun_at(utc, lat, lon) <= SUN_LIT


def ist_month(utc: dt.datetime) -> Month:
    return Month((utc + IST).month)


def correction_k(table: NightAirTable, utc: dt.datetime, sun: float) -> Kelvin:
    """What is SUBTRACTED from the airport air: the month's offset at night, 0 by day."""
    return Kelvin(0.0) if sun > SUN_LIT else table.offset(ist_month(utc))


def corrected_air(table: NightAirTable, air: Celsius, utc: dt.datetime, sun: float) -> Celsius:
    return Celsius(air - correction_k(table, utc, sun))


# ── METAR text ───────────────────────────────────────────────────────────────
_TEMP: Final = re.compile(r"^(M?\d{2})/(M?\d{2}|//|XX)?$")
_STOP: Final = ("BECMG", "TEMPO", "NOSIG", "RMK")


def metar_temp_c(raw: str) -> int | None:
    """The temperature group of a METAR, as metar.ts reads it (first `TT/DD` before the trend)."""
    for tok in raw.split():
        if tok in _STOP:
            return None
        m = _TEMP.match(tok)
        if m:
            t = m.group(1)
            return -int(t[1:]) if t.startswith("M") else int(t)
    return None


def _self_test() -> None:
    cases = {"VECC 010000Z 01006KT 1500 BR NSC 13/11 Q1016 NOSIG": 13,
             "VECC 220330Z 02003KT 3000 HZ NSC M02/M05 Q1018 NOSIG": -2,
             "VECC 010000Z 00000KT 4000 HZ NSC //// Q1016": None,
             "VECC 010000Z 01006KT 1500 BR NSC 09/ Q1016": 9}
    for raw, want in cases.items():
        got = metar_temp_c(raw)
        if got != want:
            raise SystemExit(f"metar_temp_c({raw!r}) = {got}, expected {want}")
    # IST month: 18:30 UTC on 31 Jan is 00:00 IST on 1 Feb
    assert ist_month(parse_utc("2025-01-31T18:29:00Z")) == 1 and ist_month(parse_utc("2025-01-31T18:30:00Z")) == 2
    t = load_table()
    assert t.icao == "VECC" and len(t.offsets_k) == MONTHS
    night, day = parse_utc("2025-11-10T20:00:00Z"), parse_utc("2025-11-10T06:00:00Z")
    assert is_night(night) and not is_night(day)
    assert correction_k(t, day, sun_at(day)) == 0.0
    print("  _night_air self-test: ok")


if __name__ == "__main__":
    _self_test()
