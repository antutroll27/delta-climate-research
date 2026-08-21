"""pvlib.irradiance — only the scalar surface build-pv-yield.py calls.

`erbs` and `get_total_irradiance` really return a dict of component arrays; called
with scalars they yield a mapping of float. Typed as Mapping[str, float] so that a
mistyped key ("poa_globl") is a mypy error rather than a KeyError at runtime.
"""
from typing import Mapping

def erbs(ghi: float, zenith: float, datetime_or_doy: int) -> Mapping[str, float]: ...

def get_total_irradiance(
    surface_tilt: float,
    surface_azimuth: float,
    solar_zenith: float,
    solar_azimuth: float,
    dni: float,
    ghi: float,
    dhi: float,
    *,
    dni_extra: float | None = ...,
    airmass: float | None = ...,
    albedo: float = ...,
    model: str = ...,
) -> Mapping[str, float]: ...

def get_extra_radiation(datetime_or_doy: int) -> float: ...
