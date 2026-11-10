"""
The heat-map's surface-energy-balance model and its calibration observations.

WHY THIS FILE EXISTS. measure-accuracy.py needs fit-physics.py's `predict` and
`load`, and `fit-physics` is not an importable module name — so it reached them
through `importlib.util.spec_from_file_location`. That makes the imported module
`Any`: `fit.predict`, `fit.load` and `fit.VIEW_CUT` were all unchecked, a renamed
argument would have surfaced as a wrong number rather than an error, and the hack
itself produced four spurious `ModuleSpec | None` type errors. A leading
underscore keeps this file out of the CLI namespace while making it a normal,
checkable import.

WHAT IS HERE AND WHAT IS NOT. Here: the model — the equilibrium temperature, the
sky and dewpoint sub-models, the solar geometry, and the loader for the scenes it
is scored against. NOT here: fit-physics.py's start point, bounds, fitted values
and stop condition. Those are the fitting PROCEDURE; they change when the
calibration changes rather than when the physics does, and moving them would make
measure-accuracy.py silently depend on the fit's bounds. fit-physics.py remains
the documented entrypoint.

THE MODEL MIRRORS TypeScript. `eqCell`, `dewpointTaper` and `nightLatent` in
src/scripts/climate-engine/heat-map-model.ts are the shipping implementation;
this is the same arithmetic in Python so the constants can be fitted against
observation. Changing one without the other silently decalibrates the product.
"""
from __future__ import annotations

import csv
import datetime
import json
import math
import os
import sys
from typing import Literal, NamedTuple, TypedDict, cast

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path must be set first — the scripts are not a package)

ROOT = os.path.join(HERE, "..")
MET = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
LC = os.path.join(ROOT, "data", "calibration", "landcover-fractions.json")

# Fixed model constants, mirrored from src/scripts/climate-engine/types.ts.
S_SOLAR = 0.6
# NOT "the top of the [0.40, 0.46] band" — that band is a fossil of an earlier
# model and cannot be reproduced from this one (green-score-methodology 4.2.1).
# 0.46 is an admissible choice inside a ONE-SIDED feasible region whose ceiling is
# 0.640 at rh 60 (park bar) and 0.515 at rh 30 (vegetated-surface bar, which is
# the tighter of the two below ~35% rh). The fit rails l_et to whatever
# ceiling it is given, so this number is chosen, not fitted.
L_ET = 0.46

def evap_scale(rh: float) -> float:
    """Humidity gate on evapotranspiration, CAPPED AT 1.0.

    Mirrors evapScale() in src/scripts/climate-engine/heat-map-model.ts. See
    docs/green-score-methodology.md 4.2.2: uncapped, this ramp raised ET without
    limit as the air dried (1.2x at rh 0) while the 4 K vegetated-surface bar
    LOSES headroom as the sky dries. They crossed near 22% rh, and this project's
    own ward-observations archive records humidity down to 14.1%.

    ONE DEFINITION ON PURPOSE. The expression was copy-pasted across seven sites;
    capping only some would leave the offline analyses modelling different physics
    from the page they are meant to validate.
    """
    return min(1.0, 0.6 + 0.6 * (1 - rh / 100))

K_SUM = 0.01 + 0.05          # kRad + h at wind = 1; the RATIO is fitted, the sum is held

#: The forcing wind the model runs on, from a raw 10 m wind in m/s. Mirrors
#: `Math.min(2.5, Math.max(0.3, wind / 3))` in currentParams and
#: currentParamsForReference (src/scripts/climate-engine/heat-map-model.ts).
#: `h·wind` is the convective conductance, so `wind` here is a dimensionless
#: multiplier on `h`, not a speed: a third of the 10 m wind, clamped.
WIND_DIVISOR = 3.0
WIND_MIN = 0.3
WIND_MAX = 2.5


def model_wind(raw_ms: float) -> float:
    """The model's wind multiplier for a raw 10 m wind in m/s. Mirrors heat-map-model.ts.

    ONE DEFINITION ON PURPOSE, for the reason evap_scale() has one. Until
    2026-10-05 the transform lived inline in load(), and the Landsat rows in
    build-ward-observations.py were written from the CSV without it, so every
    Landsat ward-scene was scored at a raw m/s wind — about three times the
    convective cooling the page applies — while the ECOSTRESS rows beside them
    were scored at the page's value. That alone moved the published
    morning_landsat bias from +0.36 K to -2.49 K (since commit 4ce2585).
    `build-ward-observations.py --check` holds every observation row to this
    function and this function to the TypeScript.
    """
    return max(WIND_MIN, min(WIND_MAX, raw_ms / WIND_DIVISOR))

#: Nocturnal heat release, night only — the storage flux (ΔQs) a steady-state
#: balance omits. Mirrors STORE_NIGHT in types.ts. Without it the modelled night
#: surface sits BELOW air while the measurement puts it 2.10 K above; that is a
#: sign error and no constant fixes a sign.
STORE_NIGHT = 0.1043   # refitted 2026-08-09 after the sun-up bar; see types.ts
NIGHT_ET_FRACTION = 0.10
Q_NIGHT_RATIO = 0.5
DEWPOINT_TAPER_K = 1.0
#: cos z above which the product runs its DAYTIME branch. Mirrors SUN_LIT in
#: heat-map-model.ts. The branch is the product's own rule, `sunNow > SUN_LIT` at the
#: ward's latitude -- not the CMR Day/Night flag a satellite row happens to carry.
SUN_LIT = 0.05
VIEW_CUT = 0.75

# The two masks the SUHII measurement produced, and the five forcing variables a
# scene carries. Both are Literals rather than bare str because both are used as
# lookup keys: a typo becomes a type error instead of a KeyError at run time, or
# — worse — a silently skipped predictor.
Surface = Literal["urban", "rural"]
Forcing = Literal["tAir", "rh", "wind", "cloud", "sun"]


# ── file contract ───────────────────────────────────────────────────────────
class LandCoverClass(TypedDict):
    """One mask's land cover, from landcover-fractions.py. MEASURED, not fitted —
    letting the solver tune these would let it hide land-cover error inside the
    physics constants."""
    pixels: int
    veg: float
    built: float
    albedo: float
    cover_breakdown: dict[str, float]


class LandCoverClasses(TypedDict):
    urban: LandCoverClass
    rural: LandCoverClass


class LandCoverFile(TypedDict):
    """data/calibration/landcover-fractions.json."""
    source: str
    grid: str
    masks: str
    albedo_source: str
    note: str
    classes: LandCoverClasses


# ── scene ───────────────────────────────────────────────────────────────────
class Scene(NamedTuple):
    """One ECOSTRESS overpass joined to its NASA POWER forcing.

    A NamedTuple and not the dict this used to be: every field arrives from
    met-forcing.csv as text and is coerced exactly once, here, so nothing
    downstream has to remember which of `tAir` and `date` is a number.
    """
    date: str
    phase: _types.Phase
    hour: float
    sun: float
    tAir: float
    rh: float
    wind: float
    cloud: float
    w: float
    urban: float
    rural: float

    def forcing(self, name: Forcing) -> float:
        """Forcing variable by name, for the regression predictor sets in
        measure-accuracy.py. Spelled out rather than `getattr`, which returns Any
        and would let a mistyped predictor name through to a run-time crash."""
        if name == "tAir":
            return self.tAir
        if name == "rh":
            return self.rh
        if name == "wind":
            return self.wind
        if name == "cloud":
            return self.cloud
        return self.sun

    def observed(self, cls: Surface) -> float:
        """The measured surface temperature of one mask."""
        return self.urban if cls == "urban" else self.rural


class Prediction(NamedTuple):
    """Modelled equilibrium surface temperature for the two masks, °C."""
    urban: float
    rural: float

    def at(self, cls: Surface) -> float:
        return self.urban if cls == "urban" else self.rural


# ── physics ─────────────────────────────────────────────────────────────────
#
# Scalar in, scalar out. The expressions stay on np.* rather than `math` because
# they are the same ones the array-valued engine evaluates and numpy's exp/log
# are not guaranteed bit-identical to libm's.
#
# THE float() WRAPS ARE LOAD-BEARING FOR CHECKING, NOT FOR ARITHMETIC. numpy's
# ufunc stubs resolve to Any for scalar arguments, and mypy does not check calls
# on Any — so an Any escaping svp() would silently disable checking in every
# caller downstream. float() of an np.float64 is exact (both are IEEE doubles).
def svp(t: float) -> float:
    """Saturation vapour pressure, hPa. Magnus-Tetens."""
    return float(6.112 * np.exp(17.67 * t / (t + 243.5)))


def dewpoint(t: float, rh: float) -> float:
    """Dewpoint, °C, from air temperature and relative humidity."""
    g = np.log(np.maximum(1e-6, rh / 100)) + 17.67 * t / (t + 243.5)
    return float(243.5 * g / (17.67 - g))


def sky_temp(t: float, rh: float, cloud: float, c: float) -> float:
    """Effective sky temperature, °C. Brutsaert clear-sky emissivity with `c`
    fitted, linearly greyed towards 0.9 by cloud fraction."""
    tK = t + 273.15
    clear = c * (svp(t) * rh / 100 / tK) ** (1 / 7)
    eps = np.minimum(1, clear + 0.9 * (1 - clear) * cloud)
    return float(eps ** 0.25 * tK - 273.15)


def solar_factor(hour: float, doy: int, lat: float = 22.55) -> float:
    """cos(solar zenith), clamped at zero. Spencer (1971) declination."""
    g = 2 * math.pi / 365 * (doy - 1)
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g)
            - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
            - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    ha = np.radians((hour - 12) * 15)
    cz = (np.sin(np.radians(lat)) * np.sin(decl)
          + np.cos(np.radians(lat)) * np.cos(decl) * np.cos(ha))
    return float(np.maximum(0, cz))


#: Albedo of the fixed reference cell the dewpoint taper is evaluated on. Mirrors the
#: `0.18` in dewpointTaper(); its vegetation (0.6) is irrelevant because L is 0 there.
TAPER_REF_ALBEDO = 0.18


def dewpoint_taper(k: float, pull: float, t_air: float, rh: float,
                   sun: float, store: float) -> float:
    """The 0-1 factor that closes evapotranspiration as the surface reaches the dewpoint.

    Mirrors dewpointTaper() in heat-map-model.ts EXACTLY, and is the one definition night
    and day share. The reference cell is the product's fixed `eqCell(dry, 0.18, 0.6, 0)`:
    no ET, no built fabric, so it reduces to (S(1-a)sun + store + pull) / k. At night
    `sun` is 0 and that is (store + pull) / k; by day `store` is 0.

    By day it only bites in cold saturated air (Amsterdam, 0 C, RH 100 %, low sun: the
    greenest cell read -16 C, -9.1 K of it from ET); in Kolkata's daytime validation
    scenes it is inactive, so no calibrated number moves.

    The LIVE "now" view does change outside those scenes, in humid low-sun moments in every
    city (Kolkata monsoon mornings and evenings). The width stays at DEWPOINT_TAPER_K because
    the tightest validation scene has only 1.76 K of headroom: widening it would move a
    calibrated figure. See the doc comment on dewpointTaper() for the steepness cost.
    """
    surface = (S_SOLAR * (1 - TAPER_REF_ALBEDO) * sun + store + pull) / k
    headroom = (surface - dewpoint(t_air, rh)) / DEWPOINT_TAPER_K
    return min(1.0, max(0.0, headroom))


def night_latent(L: float, k: float, pull: float, t_air: float, rh: float,
                 store: float) -> float:
    """Night latent coefficient, K per unit vegetation. Mirrors nightLatent() in
    heat-map-model.ts EXACTLY, and is the one definition every offline site shares.

    `L` is the full-strength coefficient (`L_ET * evap_scale(rh)`). The taper is
    `dewpoint_taper` at sun = 0, evaluated on a FIXED reference cell. It is NOT the
    ward's own built fraction and it is NOT Q * built -- four Python copies used
    (Q*built + pull)/k and left `store` out, which put the reference cell up to
    0.52 K away from the one the product tapers on (humid Kolkata) and 0.18 K in
    Amsterdam.

    `store` is the nocturnal release at the reference cell (built = 0): the
    product's STORE_NIGHT, or whatever store the model being scored carries.
    """
    return L * NIGHT_ET_FRACTION * dewpoint_taper(k, pull, t_air, rh, 0.0, store)


def _eq(cover: LandCoverClass, sun: float, Q: float, L: float,
        pull: float, k: float, store: float = 0.0) -> float:
    """Equilibrium temperature of one mask, °C. Mirrors eqCell.

    `store` is zero by day and STORE_NIGHT at night — the same split eqCell
    makes via SimParams.store. Both sides must carry it or the Python mirror
    stops mirroring, which is the one thing this file exists to avoid.
    """
    a, v, b = cover["albedo"], cover["veg"], cover["built"]
    return (S_SOLAR * (1 - a) * sun + Q * b - L * v + store + pull) / k


def predict(sc: Scene, lc: LandCoverClasses,
            q_day: float, ratio: float, c: float) -> Prediction:
    """Equilibrium surface temperature for the urban and rural masks."""
    kRad = K_SUM * ratio / (1 + ratio)
    h = K_SUM - kRad
    night = sc.phase == "night"

    tAir, rh, wind, cloud = sc.tAir, sc.rh, sc.wind, sc.cloud
    tSky = sky_temp(tAir, rh, cloud, c)
    # 1 - 0.6*cloud IS DELIBERATE, for MODEL cloud (NASA POWER, met.no). Since
    # 2026-10-07 the TypeScript instrument applies Kasten & Czeplak (1980) to
    # STATION-observed cloud (airport METARs) and a rain-wetting term, neither
    # of which any calibration scene carries; swapping this line to K&C with the
    # fitted constants held moved morning_landsat RMSE 2.913 -> 3.170 K. See
    # docs/evidence/2026-10-07-observed-weather.md. Change only with a refit.
    sun = 0.0 if night else sc.sun * (1 - 0.6 * cloud)
    Q = q_day * (Q_NIGHT_RATIO if night else 1.0)

    k = kRad + h * wind
    pull = kRad * tSky + h * wind * tAir

    L = L_ET * evap_scale(rh)
    store = 0.0
    if night:
        store = STORE_NIGHT
        L = night_latent(L, k, pull, tAir, rh, store)
    else:
        L *= dewpoint_taper(k, pull, tAir, rh, sun, store)

    return Prediction(urban=_eq(lc["urban"], sun, Q, L, pull, k, store),
                      rural=_eq(lc["rural"], sun, Q, L, pull, k, store))


# ── observations ────────────────────────────────────────────────────────────
def _phase(raw: str) -> _types.Phase:
    """Widen met-forcing.csv's text to the two-valued Phase, or refuse.

    The phase decides whether the sun term and the ET taper apply at all, so an
    unrecognised value must stop the run rather than fall through to `day`.
    """
    if raw == "day":
        return "day"
    if raw == "night":
        return "night"
    raise ValueError(f"{MET}: phase {raw!r}, expected 'day' or 'night'")


def load(all_angles: bool) -> tuple[list[Scene], LandCoverClasses, int]:
    """The calibration scenes, their land cover, and how many scenes were dropped.

    NEAR-NADIR ONLY unless `all_angles`: urban-rural view_zenith delta correlates
    with SUHII at r = -0.322, p = 0.024 over the full set, so ~10 % of the signal
    is sensor geometry.
    """
    with open(LC) as fh:
        # cast, not validation: it documents the contract and buys checking
        # downstream, but a malformed file still fails at the point of use.
        lc = cast(LandCoverFile, json.load(fh))["classes"]
    with open(MET, newline="") as fh:
        rows = cast(list[_types.MetRow], list(csv.DictReader(fh)))

    scenes: list[Scene] = []
    dropped = 0
    for r in rows:
        # met-forcing.csv now carries two kinds of row. This loader builds
        # ECOSTRESS SUHII scenes — urban-minus-rural at a measured view angle —
        # and a Landsat pass is not one of those: it has no urban/rural mask pair
        # and no off-nadir angle to cut on (its whole swath is within 7.5 deg).
        # Skipping them EXPLICITLY beats letting `float("")` raise, which is how
        # this surfaced, and beats writing zeros into the file, which would have
        # fed the SUHII fit scenes that never measured a SUHII.
        if not r["view_delta"] or not r["rural_strict"]:
            dropped += 1
            continue
        if not all_angles and float(r["view_delta"]) > VIEW_CUT:
            dropped += 1
            continue
        d = datetime.date.fromisoformat(r["date"])
        hour = float(r["local_solar_hour"])
        scenes.append(Scene(
            date=r["date"],
            phase=_phase(r["phase"]),
            hour=hour,
            sun=solar_factor(hour, d.timetuple().tm_yday),
            tAir=float(r["tAir"]),
            rh=float(r["rh"]),
            wind=model_wind(float(r["wind"])),
            cloud=float(r["cloud"]),
            w=math.sqrt(float(r["usable_frac"])),
            urban=float(r["urban_mean"]),
            rural=float(r["rural_strict"]),
        ))
    return scenes, lc, dropped


def _self_test() -> None:
    """dewpoint_taper is 0 / linear / 1, night_latent is unchanged, and predict only moves
    where the surface is within the taper width of the dewpoint."""
    # A reference cell 0.5 K above the dewpoint tapers to half; below it to 0; 1 K+ above to 1.
    k, t_air, rh = 0.05, 10.0, 80.0
    dew = dewpoint(t_air, rh)
    def taper_at(offset: float) -> float:
        return dewpoint_taper(k, k * (dew + offset), t_air, rh, 0.0, 0.0)
    assert taper_at(-3.0) == 0.0 and taper_at(0.0) == 0.0
    assert math.isclose(taper_at(0.25), 0.25) and math.isclose(taper_at(0.5), 0.5)
    assert taper_at(DEWPOINT_TAPER_K) == 1.0 and taper_at(9.0) == 1.0

    # night_latent against the implementation it replaced, verbatim.
    def old_night_latent(L: float, k: float, pull: float, t_air: float, rh: float,
                         store: float) -> float:
        headroom = ((store + pull) / k - dewpoint(t_air, rh)) / DEWPOINT_TAPER_K
        return L * NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))
    for t in (-5.0, 5.0, 15.0, 30.0):
        for r in (40.0, 80.0, 95.0, 100.0):
            for st in (0.0, STORE_NIGHT):
                pull = 0.05 * (t - 3.0)
                assert night_latent(0.4, 0.05, pull, t, r, st) == old_night_latent(0.4, 0.05, pull, t, r, st)

    # predict: a normal Kolkata day scene equals the untapered arithmetic bit for bit.
    scenes, lc, _ = load(False)
    q_day, ratio, c = 0.6, 0.15, 1.4
    kRad = K_SUM * ratio / (1 + ratio)
    h = K_SUM - kRad
    def untapered(sc: Scene) -> Prediction:
        k_ = kRad + h * sc.wind
        pull_ = kRad * sky_temp(sc.tAir, sc.rh, sc.cloud, c) + h * sc.wind * sc.tAir
        sun_ = sc.sun * (1 - 0.6 * sc.cloud)
        L_ = L_ET * evap_scale(sc.rh)
        return Prediction(urban=_eq(lc["urban"], sun_, q_day, L_, pull_, k_),
                          rural=_eq(lc["rural"], sun_, q_day, L_, pull_, k_))
    days = [sc for sc in scenes if sc.phase == "day"]
    assert days and all(predict(sc, lc, q_day, ratio, c) == untapered(sc) for sc in days)

    # ...and cold saturated low sun is where it bites: ET closes, so the green mask warms.
    cold = days[0]._replace(tAir=0.0, rh=100.0, wind=0.33, cloud=0.0, sun=0.1)
    assert predict(cold, lc, q_day, ratio, c).rural > untapered(cold).rural
    print("  _physics self-test: ok")


if __name__ == "__main__":
    _self_test()
