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

THE MODEL MIRRORS TypeScript. `eqCell` and `nightLatent` in
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

#: Nocturnal heat release, night only — the storage flux (ΔQs) a steady-state
#: balance omits. Mirrors STORE_NIGHT in types.ts. Without it the modelled night
#: surface sits BELOW air while the measurement puts it 2.10 K above; that is a
#: sign error and no constant fixes a sign.
STORE_NIGHT = 0.1081   # refitted 2026-08-09 under the capped evap ramp; see types.ts
NIGHT_ET_FRACTION = 0.10
Q_NIGHT_RATIO = 0.5
DEWPOINT_TAPER_K = 1.0
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
    sun = 0.0 if night else sc.sun * (1 - 0.6 * cloud)
    Q = q_day * (Q_NIGHT_RATIO if night else 1.0)

    k = kRad + h * wind
    pull = kRad * tSky + h * wind * tAir

    L = L_ET * evap_scale(rh)
    store = 0.0
    if night:
        # taper ET to zero as the surface approaches the dewpoint, matching
        # nightLatent() in heat-map-model.ts
        dry_veg = (Q * lc["rural"]["built"] + pull) / k
        headroom = (dry_veg - dewpoint(tAir, rh)) / DEWPOINT_TAPER_K
        L = L * NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))
        store = STORE_NIGHT

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
            wind=max(0.3, min(2.5, float(r["wind"]) / 3)),
            cloud=float(r["cloud"]),
            w=math.sqrt(float(r["usable_frac"])),
            urban=float(r["urban_mean"]),
            rural=float(r["rural_strict"]),
        ))
    return scenes, lc, dropped
