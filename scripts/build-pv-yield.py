#!/usr/bin/env python3
"""Per-building rooftop PV yield for a Kolkata ward -> data/calibration/pv-yield-<ward>.json

    python3 scripts/build-pv-yield.py --ward ballygunge
    python3 scripts/build-pv-yield.py --check    # re-derive and assert, no write

SCREENING, NOT BANKABLE, AND THE DISTINCTION IS NOT COSMETIC. A bankable yield needs a
P50/P90 pair built from a site-level uncertainty model, and NASA POWER publishes no
per-site uncertainty to build one from — only a global BSRN validation. No P90 can be
honestly derived here, so none is offered. What this produces is a screening estimate:
good enough to rank roofs and spot the badly shaded ones, not to size debt against.

WHAT IS MEASURED AND WHAT IS ASSUMED — the split matters more than any single number:

  MEASURED (ours)      inter-building shading, per building, from real footprints and
                       heights. Pre-registered, gated, PASSED at 5.14% mean / 28.3% of
                       roofs losing 5%+ (docs/.../2026-08-21-pv-shading-signtest-PREREG.md).
  MEASURED (external)  GHI, five whole years of NASA POWER hourly in local solar time.
  ASSUMED              the packing factor. One number, declared below, and EVERY yield
                       scales linearly with it. It is the weakest link in the chain and
                       it is deliberately a single named constant rather than something
                       buried in an expression, so the reader can see what it costs.

WHY pvlib IS USED HERE AND NOT IN THE SHADING TEST. measure-shadow-signtest.py records
the rule: pvlib's NREL SPA wants a real timestamp and a timezone, we hold solar time,
and converting back injects the LST/UTC error this pipeline already paid for once. So
solar POSITION still comes from our own Spencer series. But decomposition and
transposition are genuine radiative physics beyond a hand-rolled formula, and pvlib's
functions take solar position as plain arguments — no timestamps involved. That is the
line: pvlib for the physics, our convention for the clock.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from typing import Any

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
import _types  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "_shadowsig", os.path.join(HERE, "measure-shadow-signtest.py"))
assert _spec and _spec.loader
_shadowsig = importlib.util.module_from_spec(_spec)
sys.modules["_shadowsig"] = _shadowsig
_spec.loader.exec_module(_shadowsig)
solar_altaz = _shadowsig.solar_altaz

SOLAR_CACHE = os.path.expanduser("~/.cache/delta-climate/power-solar-hourly.json")
MET_CACHE = os.path.expanduser("~/.cache/delta-climate/power-hourly.json")
def shading_path(ward: str) -> str:
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-{ward}.json")


def out_path(ward: str) -> str:
    return os.path.join(ROOT, "data", "calibration", f"pv-yield-{ward}.json")

#: THE ASSUMED NUMBER. Fraction of gross footprint that ends up under module glass,
#: after obstructions (overhead water tank, stairwell headroom, parapet shadow, AC
#: units), inter-row spacing, maintenance access — and, in South Asia specifically,
#: the terrace's continued use for drying clothes, sitting out and ritual.
#:
#: 0.28 is Singh & Banerjee (2015), Solar Energy, measured on sample Mumbai buildings
#: (range 0.28-0.40, and they adopted the conservative end). It is the best-sourced
#: figure for a dense Indian city. It is NOT a Kolkata measurement — no published
#: Kolkata packing study exists — and it is a decade old, during which module
#: efficiency rose ~30%, which pushes the true figure UP, not down.
#:
#: EVERY kWh BELOW SCALES LINEARLY WITH THIS. Treat it as the dominant uncertainty.
PACKING_FACTOR = 0.28
#: The SAME study's full range. Kept as a pair rather than a note, because the packing
#: factor is the single largest uncertainty in every capacity figure we publish and it
#: enters LINEARLY — so the honest output is an interval, not a point with a caveat
#: attached in prose. Adopting 0.28 means our headline is the FLOOR of the published
#: range, not its centre: quoting it to a DISCOM understates the opportunity by up to
#: 43%, which is the safe direction to be wrong in, but only if we say so.
#:
#: NOTE what this interval is NOT. It is the spread of one Mumbai sample, so it carries
#: no Kolkata evidence at all; a Kolkata terrace with its water tanks and stair-head
#: rooms could fall outside it in either direction. It bounds our IMPORTED assumption,
#: not the truth. Replacing it needs a Kolkata roof measurement, which we do not have.
PACKING_RANGE = (0.28, 0.40)

#: MNRE / PM Surya Ghar planning rule: 10 m2 of SHADOW-FREE area per kWp. Note the
#: basis — it is defined on shadow-free area, so applying it to a gross footprint
#: double-counts nothing but deducts nothing either. The packing factor above is what
#: turns gross into usable; this then turns usable into capacity.
M2_PER_KWP = 10.0

#: Optimum fixed tilt for Kolkata, from the Global Solar Atlas (Solargis) at
#: 22.5726 N: 22 deg, facing due south.
TILT_DEG, AZIMUTH_DEG = 22.0, 180.0

#: Global Solar Atlas 2.0 technical report, SMALL RESIDENTIAL rooftop configuration:
#: 12.9% total losses, against 8.9% for the "theoretical" map layer everyone quotes.
#: The rooftop penalty is real - poorer ventilation, higher soiling (4.5% vs 3.5%),
#: inverter (4.1% vs 2.0%), availability (3.0% vs 0.0%). Using the theoretical figure
#: would overstate every rooftop in the ward by ~4 points.
SYSTEM_LOSS = 0.129

#: CELL TEMPERATURE, which the first version of this chain simply omitted — and that
#: omission put the answer at 1438 kWh/kWp/yr, ABOVE both independent references
#: instead of between them. In Kolkata it is not a rounding term: at 800 W/m2 on a
#: 26 C day the NOCT model puts the cell at 57 C, which is -11% on its own.
#:
#: NOCT model: T_cell = T_air + (NOCT - 20)/800 * POA, then a linear power
#: coefficient about the 25 C rating point. NOCT 51.2 C is the Global Solar Atlas
#: SMALL RESIDENTIAL figure — 5 C hotter than its ground-mount case, because a roof
#: ventilates badly. gamma -0.35%/C is the modern crystalline-silicon norm and sits
#: mid-range for the ALMM-listed modules actually sold in India.
NOCT_C = 51.2
GAMMA_PER_C = -0.0035

#: Sanity bracket for Kolkata rooftop specific yield, kWh/kWp/yr. GSA gives 1408 for
#: the theoretical config; loss-scaled to small-residential that is ~1346, and an
#: independently MEASURED 11.2 kWp rooftop at Bhubaneswar (same eastern-India monsoon
#: climate, ~370 km) recorded ~1340 with PR 0.78. Two independent routes landing
#: together is the strongest evidence available without a Kolkata ground station.
YIELD_MIN, YIELD_MAX = 1200.0, 1450.0


def specific_yield(lat: float) -> tuple[float, dict[str, Any]]:
    """Annual kWh per kWp for a fixed tilted array, from five years of POWER GHI."""
    import pvlib

    with open(SOLAR_CACHE) as fh:
        cache = json.load(fh)

    with open(MET_CACHE) as fh:
        met = json.load(fh)["properties"]["parameter"]["T2M"]
    # VERIFIED ALIGNED, not assumed: T2M peaks at hour 13 and GHI at hour 11, the
    # two-hour thermal lag that says both are on the same local-solar clock. Joining
    # a UTC temperature to an LST irradiance would be a silent 6-hour error.

    poa_by_year: list[float] = []
    dc_by_year: list[float] = []
    for year, params in sorted(cache.items()):
        poa = 0.0
        dc = 0.0
        for stamp, val in params["ALLSKY_SFC_SW_DWN"].items():
            ghi = float(val)
            if ghi <= 0:            # night, or POWER's -999 fill
                continue
            month, day, hour = int(stamp[4:6]), int(stamp[6:8]), int(stamp[8:10])
            import datetime as _dt
            doy = (_dt.date(int(year), month, day) - _dt.date(int(year) - 1, 12, 31)).days
            # POWER's hour IS local solar time, so our own solar position applies
            # directly — no timestamp, no timezone, no conversion to get wrong.
            alt, az = solar_altaz(hour + 0.5, doy, lat)
            if alt <= 0:
                continue
            zen = 90.0 - alt
            # POWER's own DNI/DHI do not close against its GHI (see solar-forcing.json),
            # so the split is DERIVED from GHI by Erbs rather than trusted from source.
            dec = pvlib.irradiance.erbs(ghi, zen, doy)
            dni, dhi = float(dec["dni"]), float(dec["dhi"])
            tot = pvlib.irradiance.get_total_irradiance(
                TILT_DEG, AZIMUTH_DEG, zen, az, dni, ghi, dhi,
                dni_extra=float(pvlib.irradiance.get_extra_radiation(doy)),
                model="haydavies")
            g_poa = float(tot["poa_global"])
            poa += g_poa
            # Cell temperature from the plane-of-array irradiance the module actually
            # sees, not from GHI — a tilted panel runs hotter than the horizontal.
            t_air = float(met.get(stamp, 27.0))
            if t_air < -900:                      # POWER fill
                t_air = 27.0
            t_cell = t_air + (NOCT_C - 20.0) / 800.0 * g_poa
            dc += g_poa * (1.0 + GAMMA_PER_C * (t_cell - 25.0))
        poa_by_year.append(poa / 1000.0)          # Wh/m2 -> kWh/m2
        dc_by_year.append(dc / 1000.0)

    poa_mean = float(np.mean(poa_by_year))
    dc_mean = float(np.mean(dc_by_year))
    y = dc_mean * (1.0 - SYSTEM_LOSS)             # kWh/kWp at the 1 kW/m2 STC rating
    return y, {
        "poa_kwh_m2_yr": round(poa_mean, 1),
        "poa_by_year": [round(v, 1) for v in poa_by_year],
        "temp_derate_pct": round((1 - dc_mean / poa_mean) * 100, 2),
        "noct_c": NOCT_C, "gamma_per_c": GAMMA_PER_C,
        "system_loss": SYSTEM_LOSS,
        "tilt_deg": TILT_DEG, "azimuth_deg": AZIMUTH_DEG,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    with open(shading_path(args.ward)) as fh:
        sh = json.load(fh)
    if sh["ward"] != args.ward:
        sys.exit(f"  shading artefact is for {sh['ward']}, not {args.ward} — rerun measure-pv-shading.py")
    if "per_building_loss" not in sh:
        sys.exit("  shading artefact has no per-building array — rerun measure-pv-shading.py")

    lat = _types.WARDS[args.ward].centre.lat
    y, meta = specific_yield(lat)
    print(f"  specific yield: {y:.0f} kWh/kWp/yr  (POA {meta['poa_kwh_m2_yr']} kWh/m2, "
          f"temp -{meta['temp_derate_pct']}%, other losses -{SYSTEM_LOSS*100:.1f}%)")

    # THE GATE. Two independent references bracket this; if the chain lands outside,
    # something in decomposition, transposition or losses is wrong and no per-building
    # number should be written.
    if not (YIELD_MIN <= y <= YIELD_MAX):
        sys.exit(f"  specific yield {y:.0f} is outside the sanity bracket "
                 f"{YIELD_MIN:.0f}-{YIELD_MAX:.0f} kWh/kWp/yr — the chain is wrong, refusing to write")
    print(f"  within the {YIELD_MIN:.0f}-{YIELD_MAX:.0f} bracket (GSA loss-scaled ~1346, "
          f"Bhubaneswar measured ~1340)")

    area = np.asarray(sh["per_building_area_m2"], dtype=float)
    loss = np.asarray(sh["per_building_loss"], dtype=float)
    usable = area * PACKING_FACTOR
    kwp = usable / M2_PER_KWP
    kwh = kwp * y * (1.0 - loss)

    print(f"\n  {len(area)} buildings · gross roof {area.sum()/1e4:.1f} ha "
          f"· usable {usable.sum()/1e4:.1f} ha at packing {PACKING_FACTOR}")
    print(f"  installable capacity : {kwp.sum()/1000:.2f} MWp")
    print(f"  annual generation    : {kwh.sum()/1e6:.2f} GWh/yr")
    lo, hi = PACKING_RANGE
    print(f"  ...at packing {lo}-{hi}  : {kwp.sum()/1000:.2f}-{kwp.sum()/1000/lo*hi:.2f} MWp, "
          f"{kwh.sum()/1e6:.2f}-{kwh.sum()/1e6/lo*hi:.2f} GWh/yr  (we quote the floor)")
    print(f"  lost to shading      : {(kwp*y).sum()/1e6 - kwh.sum()/1e6:.2f} GWh/yr "
          f"({loss.mean()*100:.2f}% mean)")

    if args.check:
        print("\n  --check: not written")
        return
    out = out_path(args.ward)
    with open(out, "w") as fh:
        json.dump({
            "ward": args.ward, "buildings": int(len(area)),
            "basis": "SCREENING ONLY. NASA POWER publishes no per-site uncertainty, so no "
                     "P50/P90 pair can be derived and none is offered. Ranks roofs; does not "
                     "size debt.",
            "measured": {"shading": sh["prereg"], "ghi": "NASA POWER, 5 y hourly, LST"},
            "assumed": {"packing_factor": PACKING_FACTOR,
                        "packing_source": "Singh & Banerjee 2015 (Solar Energy), sample Mumbai "
                                          "buildings, PVA 0.28-0.40, conservative end adopted. "
                                          "NOT a Kolkata measurement; no Kolkata study exists. "
                                          "EVERY yield scales linearly with this.",
                        "m2_per_kwp": M2_PER_KWP, "m2_per_kwp_source": "MNRE / PM Surya Ghar"},
            "specific_yield_kwh_kwp_yr": round(y, 1), **meta,
            # Stratified by installable size, because the all-roofs statistics are
            # carried by buildings nobody will ever fit a system to: the worst-shaded
            # roof in Ballygunge is a 16 m2 shed. Short and surrounded is one condition,
            # so small buildings are systematically the most overshadowed, and counting
            # them inflates anything we quote. Reported ALONGSIDE the pre-registered
            # all-roofs numbers, never instead of them — on this stratum barrackpore and
            # baruipur do NOT clear their own gate. See the PREREG addendum.
            "installable_ge_3kwp": {
                "n": int((kwp >= 3.0).sum()),
                "mean_shading_loss": round(float(loss[kwp >= 3.0].mean()), 4),
                "share_losing_5pct": round(float((loss[kwp >= 3.0] >= 0.05).mean()), 4)},
            # Linear in the packing factor, so the interval is exact rather than
            # sampled — two endpoints, no bootstrap. Bounds our IMPORTED assumption,
            # not the truth: it is one Mumbai sample's spread, with no Kolkata evidence.
            "totals_packing_range": {
                "packing_factor_range": list(PACKING_RANGE),
                "capacity_mwp": [round(float(kwp.sum()) / PACKING_FACTOR * pf / 1000, 3)
                                 for pf in PACKING_RANGE],
                "generation_gwh_yr": [round(float(kwh.sum()) / PACKING_FACTOR * pf / 1e6, 3)
                                      for pf in PACKING_RANGE]},
            "totals": {"gross_roof_ha": round(float(area.sum()) / 1e4, 2),
                       "usable_roof_ha": round(float(usable.sum()) / 1e4, 2),
                       "capacity_mwp": round(float(kwp.sum()) / 1000, 3),
                       "generation_gwh_yr": round(float(kwh.sum()) / 1e6, 3),
                       "shading_loss_gwh_yr": round(float((kwp * y).sum() - kwh.sum()) / 1e6, 3)},
            "per_building_kwp": [round(float(v), 3) for v in kwp],
            "per_building_kwh_yr": [round(float(v), 0) for v in kwh],
        }, fh, indent=2)
    print(f"\n  written to {os.path.relpath(out, ROOT)}")

    # A SECOND, SLIMMER COPY FOR THE BROWSER. data/calibration/ is not web-served, so
    # the card cannot read the file above; and it should not, since that file carries
    # provenance, assumptions and intervals the renderer has no use for. Three parallel
    # arrays, index-aligned to the ward file exactly as load_ward() now enforces.
    #
    # Rounded at the point of writing rather than at the point of display: kWp to 2 dp
    # and kWh to the nearest unit are already finer than a screening estimate can
    # justify, and rounding here keeps the payload honest about its own resolution
    # instead of shipping fifteen digits the method cannot support.
    web = os.path.join(ROOT, "public", "heat-map", "data", f"pv-{args.ward}.json")
    with open(web, "w") as fh:
        json.dump({
            "ward": args.ward,
            "kwp": [round(float(v), 2) for v in kwp],
            "kwh": [int(round(float(v))) for v in kwh],
            "loss": [round(float(v), 3) for v in loss],
            # Carried so the card can never present a screening number as a firm one,
            # and so a stale artifact is visible rather than silently assumed current.
            "specific_yield": round(y, 1),
            "packing_factor": PACKING_FACTOR,
            "basis": "screening estimate - NASA POWER irradiance, Mumbai packing factor, "
                     "no site uncertainty model, not bankable",
        }, fh, separators=(",", ":"))
    kb = os.path.getsize(web) / 1024
    print(f"  browser copy         : {os.path.relpath(web, ROOT)}  ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
