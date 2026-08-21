"""Minimal local stubs for the pvlib surface this repo actually uses.

WHY THIS EXISTS. pvlib ships no py.typed marker and there is no types-pvlib, so mypy
would treat the whole library as Any — which mypy.ini argues against at length,
because calls on Any are never flagged and a typo'd method would sail straight
through. This pins only the three functions we call.

SCOPE IS DELIBERATELY TINY: GHI decomposition, plane-of-array transposition, and
extraterrestrial irradiance. pvlib's solar-position module is NOT stubbed, and that
absence is load-bearing — measure-shadow-signtest.py records why we do not use it
(its NREL SPA wants a real timestamp and a timezone; we hold local solar time, and
converting back injects the LST/UTC error this pipeline already paid for once). If a
future caller needs solar position, take it from `solar_altaz` / `_physics`, not from
here.

All three take and return plain floats in our usage — we call them scalar-wise from a
Python loop rather than handing pvlib a pandas frame, so the Series overloads pvlib
also supports are deliberately not modelled.

Verified against the real call sites 2026-08-21:
    scripts/build-pv-yield.py   irradiance.erbs(ghi, zenith, doy)
                                irradiance.get_total_irradiance(tilt, az, zen, sun_az,
                                                                dni, ghi, dhi,
                                                                dni_extra=, model=)
                                irradiance.get_extra_radiation(doy)
"""
from . import irradiance as irradiance

__all__ = ["irradiance"]
