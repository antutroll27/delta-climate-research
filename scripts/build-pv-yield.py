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

  MEASURED (ours)      shading, per building, from real footprints and heights AND the Meta/WRI
                       1 m canopy (v2, read at 0.5 m). Buildings-only was pre-registered, gated and
                       PASSED (2026-08-21); the tree term was added 2026-09-05 under its own
                       pre-registration and dominates: 17-18 pp of an 18.7-22 % total. Its largest
                       uncertainty is a MASK RULE, not a physical constant -- see the artefact's
                       levers block and known-limitations.md section 8.
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
import pvlib

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
    """The TREE-INCLUSIVE artefact (2026-09-05). The registered building-only artefact
    pv-shading-<ward>.json is kept as the record of that test and is no longer read here."""
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-trees-{ward}.json")


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

#: Air temperature when POWER has no reading for an hour (absent, or its -999 fill).
#: 27 C is close to this cell's long-run mean, so a handful of substituted hours move
#: nothing; a zero would put the cell 27 C cold and quietly ADD yield. Named here rather
#: than written inline twice because pv_validation_lib.py substitutes the same value on
#: the same reasoning, and the two must not drift apart.
T_AIR_FALLBACK_C = 27.0
#: POWER's fill sentinel is -999. Tested as `< POWER_FILL_BELOW` rather than `== -999`
#: because the API has served -999.0 and -999.00 both.
POWER_FILL_BELOW = -900.0

#: Sanity bracket for Kolkata rooftop specific yield, kWh/kWp/yr. GSA gives 1408 for
#: the theoretical config; loss-scaled to small-residential that is ~1346, and an
#: independently MEASURED 11.2 kWp rooftop at Bhubaneswar (same eastern-India monsoon
#: climate, ~370 km) recorded ~1340 with PR 0.78. Two independent routes landing
#: together is the strongest evidence available without a Kolkata ground station.
YIELD_MIN, YIELD_MAX = 1200.0, 1450.0


def step_poa_dc(ghi: float, zen: float, az: float, t_air: float, doy: int,
                tilt: float, azimuth: float) -> tuple[float, float]:
    """One timestep of the array model: (plane-of-array irradiance, DC output), both W/m2
    per kW/m2 of rating — i.e. before the system loss and before any shading.

    THIS IS THE ONLY COPY OF THE PHYSICS. It was inline in specific_yield()'s hourly loop
    until pv_validation_lib.py needed the same four steps for the daily model and copied
    them, which meant two versions of the decomposition, the transposition and the NOCT
    temperature that could silently disagree. The laboratory now calls this, so a change
    to the chain's physics reaches the validation model in the same commit or not at all.

    The four steps, in the order they must happen: Erbs splits GHI into beam and diffuse
    (POWER's own DNI/DHI do not close against its GHI — see solar-forcing.json); Hay-Davies
    transposes onto the tilted plane; the NOCT model puts the cell temperature at the
    plane-of-array irradiance the module actually sees, not at GHI; and gamma derates
    about the 25 C rating point."""
    if ghi <= 0.0:
        return 0.0, 0.0
    dec = pvlib.irradiance.erbs(ghi, zen, doy)
    dni, dhi = float(dec["dni"]), float(dec["dhi"])
    tot = pvlib.irradiance.get_total_irradiance(
        tilt, azimuth, zen, az, dni, ghi, dhi,
        dni_extra=float(pvlib.irradiance.get_extra_radiation(doy)),
        model="haydavies")
    poa = float(tot["poa_global"])
    t_cell = t_air + (NOCT_C - 20.0) / 800.0 * poa
    return poa, poa * (1.0 + GAMMA_PER_C * (t_cell - 25.0))


def step_dc(ghi: float, zen: float, az: float, t_air: float, doy: int,
            tilt: float, azimuth: float) -> float:
    """The DC half of step_poa_dc, for callers that do not accumulate POA separately —
    which is the laboratory. The pair exists so this chain can keep reporting its POA
    total (it is in the artefact, and the temperature derate is quoted against it)
    without computing the transposition twice."""
    return step_poa_dc(ghi, zen, az, t_air, doy, tilt, azimuth)[1]


def tiers_block(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    """The card's tier chip and how-sure ladder read this, not the raw constants —
    so the bracket, the packing range and the shading band the browser shows are
    always the ones this chain actually used, never a copy that can drift from them.

    `validated` is CARRIED FORWARD from `existing` — the tiers block of the browser
    file this run is about to overwrite — rather than reset to None every time.
    The pre-registration (§6.3) says that slot is written ONLY by
    measure-pv-validation.py, once n >= 25; a rebuild of the screen (a new shading
    pass, a packing-factor tweak) is not that event and must not silently
    un-validate a result that already exists. `existing` absent or unreadable, or
    carrying no `tiers`, a null `tiers`, no `validated` key, or a `validated` that
    is not a well-formed dict (no numeric `n`) — all of these mean there is
    nothing TRUSTWORTHY yet to carry, so the slot stays None rather than
    propagate a corrupt value forward forever."""
    raw_validated = ((existing or {}).get("tiers") or {}).get("validated")
    validated = (raw_validated if isinstance(raw_validated, dict)
                 and isinstance(raw_validated.get("n"), (int, float))
                 and not isinstance(raw_validated.get("n"), bool)
                 else None)
    return {
        "screened": True,
        "yield_bracket_kwh_per_kwp": [YIELD_MIN, YIELD_MAX],
        "packing_range": list(PACKING_RANGE),
        "shading_band": "loss_strict .. loss",
        "validated": validated,
    }


#: §6.3 of the rooftop pre-registration: the card's yield band is validated only at
#: n >= 25, and below that the card says "not yet compared to real rooftops". The
#: threshold lives here as well as in pv_validation_lib because THIS file is the only
#: writer of the slot — a caller cannot talk its way past it.
VALIDATED_MIN_N = 25


def validated_block(result: dict[str, Any]) -> dict[str, Any]:
    """The five numbers the card is allowed to print from a finished study, and no more.

    `median_ratio` is the SCREENED ratio (pre-registration §3, statistic 4) — measured
    generation against what the product actually printed, not against the re-tilted
    as-built prediction. The as-built ratio is the better test of the physics and it is
    in the result file; it is not what the card is comparing itself to."""
    return {
        "n": int(result["n"]),
        # The median months per roof, as an integer, because the card says "over N months"
        # and half a month is not something a sentence can carry honestly.
        "months": int(round(float(result["median_months"]))),
        "median_ratio": float(result["screened_median_ratio"]),
        "within_15pct_share": float(result["within_15pct_share"]),
        "date": str(result["date"]),
    }


def write_validated(result_path: str, ward: str) -> None:
    """Write `tiers.validated` into one ward's browser file from a finished result.

    THIS DOES NOT RE-RUN THE PHYSICS, deliberately. Re-deriving every roof would need the
    shading artefact and five years of POWER hourly, and would silently rewrite thousands
    of numbers as a side effect of recording a study's result. The slot is written through
    `tiers_block(existing)` — the same carry-forward path a normal rebuild uses — so the
    other four fields are rebuilt from this file's constants and cannot drift, and a
    malformed result is refused by that function's own guard rather than shipped."""
    with open(result_path) as fh:
        result: dict[str, Any] = json.load(fh)
    n = int(result.get("n", 0))
    if n < VALIDATED_MIN_N:
        sys.exit(f"  result has n={n}, below the pre-registered {VALIDATED_MIN_N} — "
                 "the card's yield band is not validated and this slot stays null (§6.3)")
    block = validated_block(result)
    web = os.path.join(ROOT, "public", "heat-map", "data", f"pv-{ward}.json")
    with open(web) as fh:
        art: dict[str, Any] = json.load(fh)
    art["tiers"] = tiers_block({"tiers": {"validated": block}})
    if art["tiers"]["validated"] is None:
        sys.exit(f"  the result's validated block was refused by tiers_block: {block}")
    with open(web, "w") as fh:
        json.dump(art, fh, separators=(",", ":"), allow_nan=False)
    print(f"  {os.path.relpath(web, ROOT)}: tiers.validated = {block}")


def _self_check() -> None:
    t = tiers_block()
    assert t["screened"] is True, "tiers.screened must be True until the study runs"
    # Pinned, not derived: if the bracket or the packing range ever moves, move
    # both the constant above and this literal in the same commit.
    assert t["yield_bracket_kwh_per_kwp"] == [1200.0, 1450.0], \
        "yield bracket pin does not match YIELD_MIN/YIELD_MAX — move both together"
    assert t["packing_range"] == [0.28, 0.40], \
        "packing range pin does not match PACKING_RANGE — move both together"
    assert t["validated"] is None, \
        "with no existing file, validated must start null — only measure-pv-validation.py sets it"

    # Carry-forward: a rebuild must not erase a validation result that measure-pv-
    # validation.py already wrote. Offline — this passes an "existing" dict
    # directly, it does not read the ward file from disk.
    fake_validated = {"n": 27, "months": 8, "median_ratio": 0.97,
                       "within_15pct_share": 0.81, "date": "2026-10-01"}
    carried = tiers_block({"tiers": {"validated": fake_validated}})
    assert carried["validated"] == fake_validated, \
        "a rebuild must carry an existing validated slot forward, not erase it"
    # And the other three fields are untouched by carry-forward — only validated moves.
    assert carried["screened"] is True and carried["packing_range"] == [0.28, 0.40]

    # A corrupt or half-written "validated" (a hand edit, a truncated write) must
    # NOT be carried forward as though it were trustworthy — it is treated the
    # same as absent, so the guard in heat-map-app.ts never has to see it.
    garbage = tiers_block({"tiers": {"validated": "yes"}})
    assert garbage["validated"] is None, \
        "a validated slot that is not a well-formed dict must not be carried forward"
    also_garbage = tiers_block({"tiers": {"validated": {"months": 8}}})
    assert also_garbage["validated"] is None, \
        "a validated slot with no numeric n must not be carried forward"
    assert tiers_block({"tiers": None})["validated"] is None, \
        "a null tiers block on the existing file must not raise"

    # --validated: the five numbers the card may print, and WHICH ratio is among them.
    # The screened one, never the as-built one — the card compares itself to what it
    # printed, and the two differ whenever a recruited roof is not at 22 deg south.
    block = validated_block({"n": 31, "median_months": 9.5, "screened_median_ratio": 0.94,
                             "median_ratio": 1.02, "within_15pct_share": 0.83,
                             "date": "2026-10-01"})
    assert block == {"n": 31, "months": 10, "median_ratio": 0.94,
                     "within_15pct_share": 0.83, "date": "2026-10-01"}, block
    assert tiers_block({"tiers": {"validated": block}})["validated"] == block, \
        "the block --validated writes must survive tiers_block's own guard"

    # The extracted physics: a dark step is zero on both outputs, a lit step is positive
    # on both, and step_dc IS step_poa_dc's second element — the laboratory calls one and
    # this chain calls the other, so they may never disagree.
    assert step_poa_dc(0.0, 30.0, 180.0, 27.0, 100, TILT_DEG, AZIMUTH_DEG) == (0.0, 0.0)
    poa, dcw = step_poa_dc(800.0, 30.0, 180.0, 27.0, 100, TILT_DEG, AZIMUTH_DEG)
    assert poa > 0.0 and 0.0 < dcw < poa, (poa, dcw)
    assert step_dc(800.0, 30.0, 180.0, 27.0, 100, TILT_DEG, AZIMUTH_DEG) == dcw
    # Hotter air must derate: gamma is negative and the NOCT model is monotonic in it.
    assert step_dc(800.0, 30.0, 180.0, 40.0, 100, TILT_DEG, AZIMUTH_DEG) < dcw

    print("  self-check: ok")


def specific_yield(lat: float) -> tuple[float, dict[str, Any]]:
    """Annual kWh per kWp for a fixed tilted array, from five years of POWER GHI."""
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
            t_air = float(met.get(stamp, T_AIR_FALLBACK_C))
            if t_air < POWER_FILL_BELOW:          # POWER fill
                t_air = T_AIR_FALLBACK_C
            # The four steps live in step_poa_dc, which the validation laboratory calls
            # too — one copy of the physics, not two.
            g_poa, g_dc = step_poa_dc(ghi, zen, az, t_air, doy, TILT_DEG, AZIMUTH_DEG)
            poa += g_poa
            dc += g_dc
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
    #: No default on the --validated path: that path WRITES a browser artefact, and a
    #: defaulted ward would quietly stamp a study's result onto Ballygunge because the
    #: operator forgot to say which ward it belongs to. The build path keeps the default.
    ap.add_argument("--ward", default=None)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                     help="offline: assert the tiers block round-trips, no artefacts read")
    ap.add_argument("--validated", metavar="RESULT_JSON",
                     help="write tiers.validated into --ward's browser file from a "
                          "finished measure-pv-validation.py result (n >= 25 only)")
    args = ap.parse_args()

    if args.self_check:
        _self_check()
        return

    if args.validated:
        if not args.ward:
            sys.exit("  --validated writes one ward's browser file and will not guess "
                     "which: pass --ward <id> as well")
        write_validated(args.validated, args.ward)
        return

    args.ward = args.ward or "ballygunge"

    with open(shading_path(args.ward)) as fh:
        sh = json.load(fh)
    if sh["ward"] != args.ward:
        sys.exit(f"  shading artefact is for {sh['ward']}, not {args.ward} — rerun measure-pv-tree-shading.py")
    for key in ("per_building_loss_total", "per_building_loss_buildings",
                "per_building_loss_trees", "per_building_loss_total_raised",
                "per_building_loss_total_strict", "per_building_area_m2"):
        if key not in sh:
            sys.exit(f"  shading artefact has no {key} — rerun measure-pv-tree-shading.py")
    if not (sh["cross_check"]["pass"] and sh["sanity"]["loss_rises_as_sun_falls"]["pass"]):
        sys.exit("  shading artefact failed its own sanity checks — refusing to build yield on it")

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
    loss = np.asarray(sh["per_building_loss_total"], dtype=float)
    loss_b = np.asarray(sh["per_building_loss_buildings"], dtype=float)
    loss_t = np.asarray(sh["per_building_loss_trees"], dtype=float)
    loss_raised = np.asarray(sh["per_building_loss_total_raised"], dtype=float)
    loss_strict = np.asarray(sh["per_building_loss_total_strict"], dtype=float)
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
            "measured": {"shading": sh["prereg"],
                         "shading_buildings_registered": "docs/superpowers/specs/2026-08-21-pv-shading-signtest-PREREG.md",
                         "canopy": "Meta/WRI CHM v2, 1 m, MAE 3.0 m, CC BY 4.0 — A1 connectedness mask, 0.5 m grid (A4)",
                         "ghi": "NASA POWER, 5 y hourly, LST"},
            "assumed": {"packing_factor": PACKING_FACTOR,
                        "packing_source": "Singh & Banerjee 2015 (Solar Energy), sample Mumbai "
                                          "buildings, PVA 0.28-0.40, conservative end adopted. "
                                          "NOT a Kolkata measurement; no Kolkata study exists. "
                                          "EVERY yield scales linearly with this.",
                        "m2_per_kwp": M2_PER_KWP, "m2_per_kwp_source": "MNRE / PM Surya Ghar",
                        "canopy_transmittance": sh["canopy"]["transmittance"],
                        "canopy_transmittance_band": sh["canopy"]["transmittance_band"]},
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
                "share_losing_5pct": round(float((loss[kwp >= 3.0] >= 0.05).mean()), 4),
                "mean_shading_loss_trees": round(float(loss_t[kwp >= 3.0].mean()), 4),
                "mean_shading_loss_buildings": round(float(loss_b[kwp >= 3.0].mean()), 4)},
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
    # provenance, assumptions and intervals the renderer has no use for. Seven parallel
    # arrays, index-aligned to the ward file exactly as load_ward() now enforces.
    #
    # Rounded at the point of writing rather than at the point of display: kWp to 2 dp
    # and kWh to the nearest unit are already finer than a screening estimate can
    # justify, and rounding here keeps the payload honest about its own resolution
    # instead of shipping fifteen digits the method cannot support.
    web = os.path.join(ROOT, "public", "heat-map", "data", f"pv-{args.ward}.json")
    # Read whatever is there NOW, before this run overwrites it, so tiers_block can
    # carry its "validated" slot forward instead of resetting it (see tiers_block's
    # docstring). Absent or unreadable is fine — that just means nothing to carry.
    existing_web: dict[str, Any] | None = None
    try:
        with open(web) as fh:
            existing_web = json.load(fh)
    except (OSError, json.JSONDecodeError):
        existing_web = None
    with open(web, "w") as fh:
        # Carried so the card can never present a screening number as a firm one, and so a
        # stale artefact is visible rather than silently assumed current.
        json.dump({
            "ward": args.ward,
            "kwp": [round(float(v), 2) for v in kwp],
            "kwh": [int(round(float(v))) for v in kwh],
            "loss": [round(float(v), 3) for v in loss],
            "loss_buildings": [round(float(v), 3) for v in loss_b],
            "loss_trees": [round(float(v), 3) for v in loss_t],
            "loss_raised": [round(float(v), 3) for v in loss_raised],
            "loss_strict": [round(float(v), 3) for v in loss_strict],
            "specific_yield": round(y, 1),
            "packing_factor": PACKING_FACTOR,
            "tiers": tiers_block(existing_web),
            # A5: the ward panel prints the laboratory's numbers, never re-derived in the browser
            "totals": {"capacity_mwp": round(float(kwp.sum()) / 1000, 3),
                       "capacity_mwp_range": [round(float(kwp.sum()) / PACKING_FACTOR * pf / 1000, 3) for pf in PACKING_RANGE],
                       "generation_gwh_yr": round(float(kwh.sum()) / 1e6, 3),
                       "shading_loss_gwh_yr": round(float((kwp * y).sum() - kwh.sum()) / 1e6, 3),
                       "mean_loss": round(float(loss.mean()), 4),
                       "mean_loss_strict": round(float(loss_strict.mean()), 4),
                       "mean_loss_trees": round(float(loss_t.mean()), 4),
                       "mean_loss_raised": round(float(loss_raised.mean()), 4)},
            "stratum": {"threshold_kwp": 3.0, "n": int((kwp >= 3.0).sum()),
                        "share_losing_5pct": round(float((loss[kwp >= 3.0] >= 0.05).mean()), 4),
                        "mean_loss": round(float(loss[kwp >= 3.0].mean()), 4)},
            "basis": "screening estimate - NASA POWER irradiance, Mumbai packing factor, canopy "
                     "shading from Meta/WRI CHM v2 (A1 mask, crowns 70% opaque, canopy heights carry the model's 3 m MAE, not propagated, 0.5 m grid), "
                     "no site uncertainty model, not bankable",
        }, fh, separators=(",", ":"))
    kb = os.path.getsize(web) / 1024
    print(f"  browser copy         : {os.path.relpath(web, ROOT)}  ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
