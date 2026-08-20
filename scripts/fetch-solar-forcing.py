#!/usr/bin/env python3
"""Hourly solar irradiance for the Kolkata wards -> the rooftop-PV chain.

    python3 scripts/fetch-solar-forcing.py            # fetch (cached) and summarise
    python3 scripts/fetch-solar-forcing.py --check    # assert the cache against the sanity bounds

WHY A SEPARATE FILE AND NOT `met-forcing.csv`. That artefact's columns ARE the reader's
contract -- `_types.MetRow` is what fit-physics.py reads back, and it feeds the PUBLISHED
accuracy figures. Rooftop PV is a new product output, not a correction to the heat model,
and it must not be able to perturb a number we publish. Same reasoning that kept the water
layer out of the solver.

WHY NASA POWER AND NOT PVGIS -- MEASURED, NOT ASSUMED (2026-08-20).
The design originally said PVGIS, on the published claim that its SARAH-3 satellite product
covers India and that satellite beats reanalysis. Both halves were checked and the first is
false HERE: PVGIS answers a SARAH request for Kolkata with

    "Location out of the spatial coverage of the radiation database selected.
     Please, select another database (PVGIS-ERA5)."

SARAH is Meteosat-based and 88.4 E sits past its usable disc, so PVGIS silently serves ERA5
REANALYSIS instead. Annual totals for Kolkata, against Solargis (the Global Solar Atlas
engine, and the bankable-tier reference):

    source            GHI      DNI      DHI    diffuse fraction
    Solargis        1681.7   1002.6    963.9        57%
    NASA POWER      1668.9   1057.3    850.8        51%     <- -0.8% / +5.5% / -11.7%
    PVGIS ERA5      1758.1   1873.7    586.6        33%     <- +87% DNI, -39% DHI

ERA5 gets the TOTAL roughly right and the direct/diffuse SPLIT badly wrong, which is exactly
the failure mode reanalysis has in hazy tropical air -- and the split is what a tilted-plane
transposition depends on. POWER (CERES/SRB satellite retrievals) tracks Solargis on all three
components. So POWER, on evidence.

DNI AND DHI ARE FETCHED FOR DIAGNOSIS ONLY — DO NOT FEED THEM TO A TRANSPOSITION.
POWER's three components DO NOT CLOSE. Testing GHI against DNI*cos(z) + DHI over 4,125
daylight hours of 2023, the reconstruction falls short by a median 7.9%, and the deficit
GROWS WITH SUN ELEVATION: -6% at 0-10 deg rising to -14.6% at 80-90 deg. At high sun
cos(z) ~ 1, so this is simply DNI + DHI failing to sum to GHI. It is not a time-offset
artefact (an offset scan is flat) and not the mid-hour approximation (integrating cos(z)
across the hour changes it by 0.1 pt). POWER derives the three by different algorithms and
never enforces closure.

Measured cost of getting this wrong: a 1 kWp array at 22 deg tilt yields 1225 kWh/kWp/yr on
the raw components against 1312 with the split derived from GHI — a 6.6% underestimate that
looks perfectly plausible in the annual total.

THE PIPELINE MUST THEREFORE USE GHI ONLY, and derive DNI/DHI with a decomposition model.
pvlib's Erbs and DIRINT agree to 1 kWh/kWp/yr here, so the choice is not load-bearing; Erbs
closes to +0.00% by construction and its DHI lands within 2% of Solargis against the raw
component's -9%.

NEITHER SUPPORTS A P90 CLAIM. POWER's own BSRN validation gives monthly bias -5.8% / RMSE 8.6%
(GEWEX SRB) and 0.03% / 5.7% (CERES SYN1deg), against an IEA-PVPS total budget of +/-3.2-7.3%
for a whole bankable assessment. Screening only. See the design note.

MULTI-YEAR ON PURPOSE. 2024 alone returns 1535 kWh/m2/yr against a climatological 1669 -- an
8% dimmer year. One year would bake in one year's weather; the spread across years is reported
instead, as measured interannual uncertainty rather than an assumed band.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CACHE = os.path.expanduser("~/.cache/delta-climate/power-solar-hourly.json")
OUT = os.path.join(ROOT, "data", "calibration", "solar-forcing.json")

#: Ward-set centroid. POWER's solar grid is ~0.5 deg, so all three wards resolve to the SAME
#: cell -- stated rather than hidden, because it means irradiance CANNOT differentiate wards.
#: Every ward-to-ward difference in the PV result comes from geometry and shading, not sun.
LAT, LON = 22.55, 88.37

#: Whole calendar years. POWER solar lags a few months, so the current year is excluded.
YEARS = (2020, 2021, 2022, 2023, 2024)

PARAMS = ("ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF")
FILL_MAX = -900.0                                  # POWER fill value is -999

#: PRE-REGISTERED SANITY BOUNDS, from independent sources, asserted by --check.
#: Global Solar Atlas (Solargis v2.2.68) for this point: GHI 1681.7, DNI 1002.6, DHI 963.9.
#: A source disagreeing by more than this is a bug or a changed dataset, not a finding.
GHI_BOUNDS = (1450.0, 1850.0)      # kWh/m2/yr, wide enough for real interannual spread
DIFFUSE_FRACTION_BOUNDS = (0.42, 0.62)   # Solargis says 0.57 for this monsoon-delta site


def _url(year: int) -> str:
    # time-standard PINNED, never defaulted. POWER's hourly default is LST today (its own
    # header says so), and LST is what we want -- the sun-position maths in sky.ts and pvlib
    # both take a LOCAL SOLAR hour. But a default is not a promise: if POWER ever flipped to
    # UTC, every hour label would shift ~6 h at this longitude and every modelled shadow
    # would point the wrong way, silently. Asked for explicitly, and asserted below.
    return ("https://power.larc.nasa.gov/api/temporal/hourly/point"
            f"?parameters={','.join(PARAMS)}&community=RE"
            f"&longitude={LON}&latitude={LAT}&time-standard=LST"
            f"&start={year}0101&end={year}1231&format=JSON")


def fetch(refresh: bool = False) -> dict[str, dict[str, dict[str, float]]]:
    """{year: {param: {YYYYMMDDHH: value}}}, cached. Never partially written."""
    if not refresh and os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as fh:
            cached: dict[str, dict[str, dict[str, float]]] = json.load(fh)
        if all(str(y) in cached for y in YEARS):
            return cached
    out: dict[str, dict[str, dict[str, float]]] = {}
    for year in YEARS:
        print(f"  fetching {year} ...", flush=True)
        # curl, not urllib: this Python's cert store fails POWER's chain, and every other
        # fetcher in scripts/ already shells out for exactly that reason (fetch-met.py:154).
        got = subprocess.run(["curl", "-s", "--fail", "--max-time", "180", _url(year)],
                             capture_output=True, text=True)
        if got.returncode != 0:
            sys.exit(f"  POWER request failed for {year} (curl {got.returncode})")
        payload: dict[str, Any] = json.loads(got.stdout)
        param = payload.get("properties", {}).get("parameter")
        if not param:
            sys.exit(f"  POWER returned no parameters for {year}: {json.dumps(payload)[:200]}")
        out[str(year)] = param
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".part"                          # atomic: a half-written cache is worse than none
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    os.replace(tmp, CACHE)
    return out


def annual(series: dict[str, float]) -> float:
    """kWh/m2/yr from hourly W/m2, skipping fills."""
    return sum(v for v in series.values() if v > FILL_MAX) / 1000.0


def summarise(data: dict[str, dict[str, dict[str, float]]]) -> dict[str, Any]:
    rows: list[dict[str, float]] = []
    for year in YEARS:
        p = data[str(year)]
        ghi, dni, dhi = (annual(p[k]) for k in PARAMS)
        rows.append({"year": float(year), "ghi": round(ghi, 1), "dni": round(dni, 1),
                     "dhi": round(dhi, 1),
                     "diffuse_fraction": round(dhi / ghi, 3) if ghi else 0.0})
    ghis = [r["ghi"] for r in rows]
    mean = sum(ghis) / len(ghis)
    return {
        "source": "NASA POWER hourly, community=RE (CERES SYN1deg / GEWEX SRB)",
        "point": {"lat": LAT, "lon": LON},
        "note": ("One ~0.5 deg POWER cell covers all three wards, so irradiance is IDENTICAL "
                 "between them: every ward-to-ward difference in PV yield comes from geometry "
                 "and shading. Screening only -- POWER publishes no per-site uncertainty, so "
                 "no P90 can be constructed from it."),
        "years": rows,
        "ghi_mean": round(mean, 1),
        "ghi_spread_pct": round((max(ghis) - min(ghis)) / mean * 100, 1),
        "units": "POWER returns Wh/m^2 per hour; summed and /1000 for kWh/m^2/yr",
        "time_standard": "LST (Local Solar Time), pinned in the request and asserted by --check",
        "reference_solargis": {"ghi": 1681.7, "dni": 1002.6, "dhi": 963.9,
                               "src": "Global Solar Atlas v2.2.68, queried 2026-08-20"},
        "components_do_not_close": {
            "median_error_pct": -7.9,
            "at_low_sun_pct": -6.0,
            "at_high_sun_pct": -14.6,
            "test": "GHI vs DNI*cos(zenith) + DHI, 4125 daylight hours of 2023",
            "consequence": ("DNI and DHI here are DIAGNOSTIC ONLY. Feeding them to a "
                            "tilted-plane transposition costs 6.6% on annual yield "
                            "(1225 vs 1312 kWh/kWp/yr at 22 deg tilt). The pipeline must "
                            "use GHI and derive the split — pvlib Erbs or DIRINT, which "
                            "agree here to 1 kWh/kWp/yr."),
        },
        "chain_validation": {
            "our_yield_on_power_2023": 1312,
            "gsa_rooftop_target": 1346,
            "our_yield_normalised_to_solargis_ghi": 1407,
            "warning": ("Landing inside the 1300-1350 target is PARTLY TWO ERRORS "
                        "CANCELLING. Normalise irradiance and the conversion runs +4.5% "
                        "optimistic against GSA's own loss model, while POWER's GHI runs "
                        "-6.7% low. Do not read the agreement as proof the chain is right; "
                        "~5% is the honest accuracy claim for screening."),
        },
        "known_bias": {
            "measured_vs_solargis_pct": -5.7,
            "power_published_bias_pct": -5.8,
            "source": "POWER's own BSRN validation, GEWEX SRB 4-IP monthly all-sky",
            "note": ("The -5.7% gap to Solargis matches POWER's OWN documented -5.8% SRB bias "
                     "to a tenth of a point, and sits 4.7 SE from the 5-year mean, so it is "
                     "systematic rather than sampling noise. DIRECTION MATTERS: this biases "
                     "yield LOW, while the unvalidated low building heights bias it HIGH by "
                     "understating neighbour shading. Do NOT treat those as cancelling — they "
                     "are independent errors that happen to point opposite ways, and either "
                     "could dominate. Report both."),
        },
    }


def peak_hour(series: dict[str, float]) -> int:
    """Hour label carrying the highest mean irradiance — the time base, measured."""
    by: dict[int, list[float]] = {}
    for stamp, value in series.items():
        if value > FILL_MAX:
            by.setdefault(int(stamp[-2:]), []).append(value)
    means = {h: sum(v) / len(v) for h, v in by.items()}
    return max(means, key=lambda h: means[h])


def check(summary: dict[str, Any], data: dict[str, dict[str, dict[str, float]]]) -> int:
    bad = 0
    # THE TIME BASE IS THE MOST DANGEROUS THING HERE, so it is measured rather than trusted.
    # Kolkata's solar noon is ~06:07 UTC. If these labels were UTC the peak would sit near
    # hour 06; in Local Solar Time it sits near 12. Anything else means POWER changed its
    # time base and every shadow this feeds is about to be six hours wrong.
    for year in YEARS:
        ph = peak_hour(data[str(year)]["ALLSKY_SFC_SW_DWN"])
        if not 11 <= ph <= 13:
            print(f"  ✖ {year}: peak irradiance at hour label {ph:02d}, expected 11-13 for "
                  f"Local Solar Time. POWER may have switched to UTC — DO NOT model shadows "
                  f"on this data until resolved."); bad += 1
    for row in summary["years"]:
        if not GHI_BOUNDS[0] <= row["ghi"] <= GHI_BOUNDS[1]:
            print(f"  ✖ {int(row['year'])} GHI {row['ghi']} outside {GHI_BOUNDS}"); bad += 1
        if not DIFFUSE_FRACTION_BOUNDS[0] <= row["diffuse_fraction"] <= DIFFUSE_FRACTION_BOUNDS[1]:
            print(f"  ✖ {int(row['year'])} diffuse fraction {row['diffuse_fraction']} "
                  f"outside {DIFFUSE_FRACTION_BOUNDS} — a bad direct/diffuse split is the "
                  f"failure that made us reject PVGIS-ERA5"); bad += 1
    print("  ✔ all years inside the pre-registered bounds" if not bad else f"  {bad} failure(s)")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="assert against the sanity bounds")
    ap.add_argument("--refresh", action="store_true", help="ignore the cache")
    args = ap.parse_args()

    summary = summarise(fetch(refresh=args.refresh))
    print(f"\n  {'year':>6}{'GHI':>9}{'DNI':>9}{'DHI':>9}{'diff frac':>11}")
    for row in summary["years"]:
        print(f"  {int(row['year']):>6}{row['ghi']:>9.1f}{row['dni']:>9.1f}"
              f"{row['dhi']:>9.1f}{row['diffuse_fraction']:>11.3f}")
    r = summary["reference_solargis"]
    print(f"  {'Solargis':>6}{r['ghi']:>9.1f}{r['dni']:>9.1f}{r['dhi']:>9.1f}"
          f"{r['dhi'] / r['ghi']:>11.3f}   <- independent reference")
    print(f"\n  mean GHI {summary['ghi_mean']} kWh/m2/yr, interannual spread "
          f"{summary['ghi_spread_pct']}%")

    if args.check:
        sys.exit(1 if check(summary, fetch()) else 0)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
        fh.write("\n")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
