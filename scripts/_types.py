"""
Shared vocabulary for the data-pipeline scripts.

WHY THE LEADING UNDERSCORE. The entrypoints are hyphenated — `fit-physics.py`,
`compute-far.py` — which are not valid module names, so four scripts currently
reach each other through `importlib.util.spec_from_file_location`. That hack
makes the imported module `Any`, so every cross-script call is unchecked: 17
`census.*` call sites in `ecostress-suhii.py` alone. A leading underscore keeps
this file out of the CLI namespace while making it a normal, checkable import.

WHAT BELONGS HERE. Vocabulary that more than one script needs, and the JSON file
contracts. Physics and fetching stay in their own scripts.

WHY TypedDict AND NOT dataclass. Every one of these shapes is written to or read
from JSON. A TypedDict *is* a dict at runtime — `json.dump` takes it unchanged
and no serialisation layer is needed. A dataclass would add `asdict()` on the way
out and a constructor on the way in for no gain, and the TypeScript frontend
reads these files directly, so the Python type should be the JSON.

WHAT THIS CANNOT DO. `cast(FarFile, json.load(fh))` is an assertion, not a
validation — it documents the contract and buys checking downstream, but it will
not catch a malformed file at runtime. That would need a schema library, which is
a heavier dependency than this pipeline warrants.
"""
from __future__ import annotations

import math
from typing import TypeAlias, Literal, NamedTuple, NotRequired, TypedDict

import numpy as np
import numpy.typing as npt

# ── numpy ───────────────────────────────────────────────────────────────────
#
# Four aliases, used on every signature. Never bare `np.ndarray` — under
# `disallow_any_generics` it errors, which is the point.
#
# Rank is deliberately NOT annotated. It reads badly, it evaporates through
# arithmetic (one multiply and `NDArray[tuple[int, int], ...]` becomes
# `tuple[Any, ...]`), and it would not have caught the bug that motivates the
# question: the Sentinel-2 10 m / 20 m mismatch was two rank-2 arrays of
# different EXTENT, and extents are not in the type system at all. That bug is
# prevented structurally — every band goes through one reader with a fixed
# `out_shape` — not by an annotation.
F64 = npt.NDArray[np.float64]
F32 = npt.NDArray[np.float32]
U8 = npt.NDArray[np.uint8]
I16 = npt.NDArray[np.int16]
Mask = npt.NDArray[np.bool_]

# ── vocabulary ──────────────────────────────────────────────────────────────

# NOT a Literal of the three ward ids, deliberately. src/data/wards.ts states the
# project's own rule: "Widening from three wards to all 144 KMC wards must be a
# change to this file alone — no script may hardcode a ward id or a count." A
# three-value Literal would write that violation into the type system. It is also
# already false: compute-far.py discovers wards from the filesystem.
#: west, south, east, north — degrees, EPSG:4326. Same alias as _ecostress.Bbox;
#: declared here so scripts that never touch rasterio can still name a bbox.
Bbox: TypeAlias = tuple[float, float, float, float]

WardId = str

Phase = Literal["day", "night"]
Provenance = Literal["measured", "modelled", "estimated", "placeholder"]


class LatLon(NamedTuple):
    lat: float
    lon: float


class MetresPerDegree(NamedTuple):
    """Named because the two values differ by under 1 % at Kolkata's latitude,
    so transposing them yields a plausible wrong answer rather than an error."""
    east: float
    north: float


class Ward(NamedTuple):
    id: WardId
    centre: LatLon
    footprint_m: int


# THE ward table. Mirrors src/data/wards.ts. Five scripts carried private copies
# of this and they had already diverged — ecostress-census.py used capitalised
# keys and coordinates 10–44 m away from the others. Sub-pixel at ECOSTRESS's
# 70 m, but four pixels at Sentinel's 10 m.
WARDS: dict[WardId, Ward] = {
    "ballygunge":  Ward("ballygunge",  LatLon(22.528,  88.3659), 1400),
    "baruipur":    Ward("baruipur",    LatLon(22.3654, 88.4319), 1400),
    "barrackpore": Ward("barrackpore", LatLon(22.7621, 88.3713), 1400),
}

# The study bbox for the thermal work: deliberately wider than the wards so it
# contains genuine rural hinterland for the urban-rural difference. Duplicated
# in two files with a "must match" comment, which is how they came to differ.
STUDY_BBOX: Bbox = (88.00, 22.05, 88.85, 22.95)


# ── geo helpers ─────────────────────────────────────────────────────────────
def m_per_deg(lat: float) -> MetresPerDegree:
    """Local metres-per-degree, WGS-84 spherical approximation.

    Good to well under 0.1 % over a few km. Three scripts open-coded this, two
    of them inline and in reciprocal form, one with numpy and two with math.
    """
    return MetresPerDegree(111_320.0 * math.cos(math.radians(lat)), 110_540.0)


def ward_bounds(w: Ward, pad_m: float = 0.0) -> tuple[float, float, float, float]:
    """(west, south, east, north) in EPSG:4326 around a ward centre.

    Returned in rasterio's `from_bounds` order. Getting that order wrong reads
    the wrong window silently rather than raising, which is why this exists once
    rather than four times.
    """
    mx, my = m_per_deg(w.centre.lat)
    half = w.footprint_m / 2 + pad_m
    return (w.centre.lon - half / mx, w.centre.lat - half / my,
            w.centre.lon + half / mx, w.centre.lat + half / my)


# ── file contracts ──────────────────────────────────────────────────────────
# Verified against the real files in data/dc-urs/ rather than assumed.

class Sourced[T](TypedDict):
    """Mirrors Sourced<T> in src/scripts/climate-engine/dc-urs-inputs.ts."""
    value: T
    source: Provenance
    vintage: NotRequired[str]
    cite: NotRequired[str]


class DcUrsWard(TypedDict):
    """The twelve indicators. camelCase because the TypeScript reads this file
    directly and the names must match DcUrsInputs field-for-field."""
    lstDayC: Sourced[float]
    lstNightC: Sourced[float]
    ruralBaseC: Sourced[float]
    popDensity: Sourced[float]
    far: Sourced[float]
    socioVuln: Sourced[float]
    fvc: Sourced[float]
    canopyFrac: Sourced[float]
    ndviMean: Sourced[float]
    ndviStd: Sourced[float]
    albedo: Sourced[float]
    distCoolM: Sourced[float]


class DcUrsInputsFile(TypedDict):
    generated: str
    engine: str
    note: str
    known_limitations: list[str]
    wards: dict[WardId, DcUrsWard]


class FarWard(TypedDict):
    far: float
    built_fraction: float
    buildings: int
    degenerate_polygons: int
    land_m2: float
    footprint_m2: float
    floor_m2: float
    height_m: dict[str, float]
    floors: dict[str, float]


class FarFile(TypedDict):
    source: str
    method: str
    assumption: str
    provenance: Provenance
    wards: dict[WardId, FarWard]


class Building(TypedDict):
    """One Overture footprint in `data/geometry/<ward>-footprints.json`.

    `p` is a FLAT ring in ward-local metres — [x0, y0, x1, y1, …], +y = north —
    so it is reshaped (-1, 2), never zipped. `lonlat` is the same ring as
    [lon, lat] PAIRS. Two representations of one polygon, and the pair that let
    the north-south mirror be settled numerically: `p` is what the renderer
    draws, `lonlat` is the independent ground truth it is checked against.
    """
    gers: str
    p: list[float]
    lonlat: list[list[float]]


class FootprintsSkipped(TypedDict):
    not_polygon: int
    tiny: int
    outside: int
    holes_dropped: int


class FootprintsFile(TypedDict):
    """Verified identical across all three ward files, 2026-08-09."""
    ward: WardId
    release: str
    count: int
    source: str
    skipped: FootprintsSkipped
    b: list[Building]


class TreeInstanceJSON(TypedDict):
    x: float      # ward-local metres, +x = east
    y: float      # ward-local metres, +y = north
    h: float      # tree height, metres (from CHM)
    species: str  # "neem" | "gulmohar" | "palm"
    r: float      # crown radius, metres


class TreesFileJSON(TypedDict):
    ward: str
    grid: int
    sizeM: float
    retrieved: str
    #: Provenance stamp -- the CHM prefix and density reference the artefact was
    #: generated with. fetch-canopy.py's check() asserts both against its live
    #: constants, so a stale artefact under a retuned fetcher fails loudly instead
    #: of passing every structural invariant (which it does: none of them depend on
    #: the source). asTreesFile in vegetation-layer.ts picks named fields and
    #: ignores the rest, so adding these needed no TS change.
    source: str
    densityRefM: float
    trees: list[TreeInstanceJSON]


class TraWard(TypedDict):
    tra: float
    median_dist_m: float
    max_dist_m: float
    refuge_cell_fraction: float
    refuge_patches_in_ward: int
    largest_patch_in_ward_ha: float
    refuge_patches_in_search_window: int
    min_patch_ha: float
    refuge_classes_present: dict[str, int]
    cells: int


class TraFile(TypedDict):
    source: str
    method: str
    refuge_definition: str
    why_not_osm: str
    caveat: str
    provenance: Provenance
    wards: dict[WardId, TraWard]


class SentinelYear(TypedDict):
    ndvi: float
    albedo: float
    scenes: int


class SentinelWard(TypedDict):
    ndvi_mean: float
    ndvi_std: float
    fvc: float
    albedo: float
    years: int
    scenes_total: int
    per_year: dict[str, SentinelYear]


class SentinelFile(TypedDict):
    source: str
    method: str
    fvc: str
    albedo: str
    baseline_offset: str
    provenance: Provenance
    years_requested: list[int]
    wards: dict[WardId, SentinelWard]


class PopWard(TypedDict):
    density: float
    population: int
    cells: int
    area_km2: float


class PopFile(TypedDict):
    source: str
    product: str
    vintage: str
    method: str
    caveat: str
    why_not_worldpop: str
    provenance: Provenance
    wards: dict[WardId, PopWard]


class SocioWard(TypedDict):
    """data/dc-urs/socio.json — SPECIFIED BEFORE ITS PRODUCER EXISTS.

    This is the one contract we get to write down rather than reverse-engineer.
    `hvi` is the 0–10 socio-economic heat vulnerability composite that fills
    `socioVuln`; the name difference between the two is an unforced translation
    step and the producer must not invent a third spelling.
    """
    hvi: float
    elderly_frac: float
    children_frac: float
    low_income_frac: float
    informal_frac: float


class SocioFile(TypedDict):
    source: str
    method: str
    vintage: str
    caveat: str
    provenance: Provenance
    wards: dict[WardId, SocioWard]


class MetRow(TypedDict):
    """One row of data/calibration/met-forcing.csv.

    EVERY VALUE IS str. This is csv.DictReader output, and typing these as float
    is the single most tempting mistake in this file — the numbers are numbers,
    but they arrive as text and must be coerced at the point of use.
    """
    date: str
    phase: str
    local_solar_hour: str
    view_delta: str
    usable_frac: str
    urban_mean: str
    rural_strict: str
    suhii: str
    tAir: str
    rh: str
    wind: str
    cloud: str


#: One ECOSTRESS acquisition measured for SUHII (scripts/ecostress-suhii.py).
#:
#: `total=False` because the row is built up as the measurement proceeds and
#: every early return is a legitimate partial: a scene that yields no usable LST
#: pixels has `status` and `reason` but no `suhii`, and a consumer that assumes
#: otherwise is the bug this type exists to catch. Only `date`, `phase`,
#: `status` and `reason` are set unconditionally.
#:
#: FUNCTIONAL SYNTAX, not the class form, because one key is `rural_+rural` —
#: not a valid Python identifier. That name is already the CSV column written by
#: build-calibration-set.py and read back by _physics.py, so it is a data
#: contract on disk, not a free choice. The three rural definitions it comes
#: from are fixed (RURAL_DEFS), which is what makes the six-key set closed and
#: worth typing at all.
SceneRow = TypedDict("SceneRow", {
    "date": str,
    "phase": str,
    "status": Literal["ok", "skipped", "error"],
    "reason": str,
    "utc": str,
    "local_solar_hour": float,
    "month": int,
    "tiles": str,
    "usable_frac": float,
    "valid_px": int,
    "water_px": int,
    "urban_mean": float,
    "urban_px": int,
    "suhii": float,
    "suhii_spread": float,
    # per rural definition — the spread across these three is `suhii_spread`,
    # and it is the honest uncertainty of the urban-extent product choice
    "rural_strict": float,
    "suhii_strict": float,
    "rural_+rural": float,
    "suhii_+rural": float,
    "rural_wide": float,
    "suhii_wide": float,
    # view-zenith control, only fetched for scenes that already cleared the bar
    "view_urban": float,
    "view_rural": float,
    "view_delta": float,
}, total=False)
