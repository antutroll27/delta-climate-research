#!/usr/bin/env python3
"""
Shared Sentinel-2 access layer: STAC search, windowed COG reads, per-scene arrays.

WHY THIS FILE EXISTS — the same reason as _ecostress.py, _suhii.py and
_physics.py. `fetch-sentinel-composites.py` owns this logic and
`export-surface-rasters.py` needs it, but a hyphen makes the filename an illegal
module name, so the only way in was `importlib.util.spec_from_file_location` —
which turns the whole module into `Any` and re-executes its top level in a
second namespace. Every cross-script import in this repo is a real import; this
keeps it that way.

WHAT LIVES HERE. Search, the windowed reader, and the per-scene NDVI/albedo
arrays. NOT here: the reduction to ward scalars, which belongs to the composite
script, and the raster export, which belongs to the exporter. Two consumers want
the same measurement and different reductions of it — so the measurement is
shared and each reduction stays with its owner.

THE OFFSET RULE IS THE DELICATE PART. Sentinel-2's BOA_ADD_OFFSET is keyed on
PROCESSING BASELINE, not acquisition date, because the archive is reprocessed
and one 2021 acquisition can appear twice under two baselines needing opposite
treatment. Keying on date inflated Barrackpore's 2021 NDVI to 0.497 against
0.267-0.313 for every other year, and it read as a step change in land cover
that never happened. Having one copy of that rule is most of the point of this
file.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

CACHE = os.path.expanduser("~/.cache/delta-climate/sentinel")

STAC = "https://earth-search.aws.element84.com/v1/search"
COLLECTION = "sentinel-2-l2a"
MAX_CLOUD = 25
SCENES_PER_YEAR = 6          # spread across seasons; median-reduced

# FVC endmembers. NDVI of bare soil and of full canopy, the standard pair used
# with the source document's FVC definition (Carlson & Ripley 1997).
NDVI_BARE, NDVI_VEG = 0.05, 0.80

# Broadband albedo coefficients, exactly as the source document §3B specifies.
# This is a Liang (2001)-type narrowband-to-broadband conversion.
ALBEDO_W = {"blue": 0.356, "red": 0.130, "nir": 0.373, "swir16": 0.085, "swir22": 0.055}
BANDS = list(ALBEDO_W)

#: NO WARD TABLE HERE. There was one — a third copy of `_types.WARDS`, which
#: `dump-parity-oracle.py` already names as the known-diverged one and `_types`
#: own comment records had drifted 10-44 m: sub-pixel at ECOSTRESS's 70 m, four
#: pixels at Sentinel's 10 m. Its single consumer now reads `_types.WARDS`, which
#: is the only Python ward table carrying `footprint_m` — and a footprint is
#: exactly what this module can no longer do without.


def search(lat: float, lon: float, year: int) -> list[dict[str, Any]]:
    """Lowest-cloud scenes for one year, spread across the calendar."""
    d = 0.02   # ~2 km box around the ward centre
    body = json.dumps({
        "collections": [COLLECTION],
        "bbox": [lon - d, lat - d, lon + d, lat + d],
        "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": MAX_CLOUD}},
        "limit": 100,
    })
    r = subprocess.run(["curl", "-s", "--max-time", "90", "-H", "Content-Type: application/json",
                        "-d", body, STAC], capture_output=True, text=True)
    if r.returncode != 0:
        return []
    try:
        feats = json.loads(r.stdout).get("features", [])
    except json.JSONDecodeError:
        return []

    # spread across months rather than taking the N cleanest, which would all
    # cluster in the dry season and reintroduce exactly the bias we are avoiding
    by_month = defaultdict(list)
    for f in feats:
        by_month[f["properties"]["datetime"][5:7]].append(f)
    picked = []
    for mth in sorted(by_month):
        best = min(by_month[mth], key=lambda f: f["properties"].get("eo:cloud_cover", 100))
        picked.append(best)
    step = max(1, len(picked) // SCENES_PER_YEAR)
    return picked[::step][:SCENES_PER_YEAR]


# Sentinel-2 mixes resolutions: blue/red/nir are 10 m, the SWIR bands 20 m. Read
# every band onto one 10 m grid so they can be combined pixel-for-pixel.
def grid_for(footprint_m: int) -> int:
    """Cells per side at Sentinel-2's 10 m native posting.

    WAS `GRID = FOOTPRINT_M // 10`, a module constant baked at Kolkata's 1400 m.
    Bengaluru's wards are 2800 m and need 280, and the failure mode of getting
    this wrong is not an exception — it is a correctly-shaped array holding the
    wrong quarter of the ward.

    `int`, NOT `float`, and that choice is half the guard. `%` on a float is a
    trap in both directions: a footprint that arrived through JSON arithmetic as
    1400.0000000001 would raise here where it was meant to pass, and 1399.9999
    would pass a `% 10 != 0` test it should fail. A ward footprint is a whole
    number of metres — `_types.Ward.footprint_m` is already `int` — so demanding
    one lets mypy refuse a float at the call site, where a caller can convert
    deliberately, instead of deferring the question to a runtime remainder that
    is correct only by luck.
    """
    if footprint_m <= 0:
        raise ValueError(f"footprint {footprint_m} m is not a ward")
    if footprint_m % 10 != 0:
        raise ValueError(f"footprint {footprint_m} m is not a whole number of 10 m cells")
    return footprint_m // 10


def uniform_grid(wards: Iterable[_types.Ward]) -> int:
    """The one surface grid shared by a set of wards, or a refusal.

    Several Kolkata-only measurement scripts want "the" grid as a module-level
    constant — for a cache filename, an expected array shape, a default
    argument. They may keep one, but derived from the ward table and only for as
    long as that table holds a single footprint. The moment a 2800 m ward joins
    it, either answer is wrong for half the wards, and answering silently is the
    exact defect this module is being cured of.
    """
    sizes = {w.footprint_m for w in wards}
    if len(sizes) != 1:
        raise ValueError(
            f"no single surface grid for footprints {sorted(sizes)} m — this caller "
            f"assumes one ward size and must take the grid per ward instead")
    return grid_for(sizes.pop())


def read_window(href: str, lat: float, lon: float,
                footprint_m: int) -> npt.NDArray[np.float32] | None:
    """Read the ward window from a COG, resampled to the common grid.

    `footprint_m` HAS NO DEFAULT, deliberately. A default is precisely what made
    this Kolkata-only, and what it hides is not an exception: the window would
    still be square, still full of real reflectance, and still the wrong quarter
    of a 2800 m ward.
    """
    try:
        with rasterio.open(href) as src:
            # COGs are in UTM; transform the ward box into the scene CRS
            from rasterio.warp import transform_bounds
            n = grid_for(footprint_m)
            half = footprint_m / 2
            dlat = half / 110_540.0
            dlon = half / (111_320.0 * np.cos(np.radians(lat)))
            l, b, r_, t = transform_bounds("EPSG:4326", src.crs,
                                           lon - dlon, lat - dlat, lon + dlon, lat + dlat)
            win = from_bounds(l, b, r_, t, src.transform)
            arr = src.read(1, window=win, out_dtype="float32",
                           out_shape=(n, n),
                           boundless=True, fill_value=0,
                           resampling=rasterio.enums.Resampling.bilinear)
            return arr if arr.size else None
    except Exception:
        return None


def scene_arrays(feat: dict[str, Any], lat: float, lon: float, footprint_m: int
                 ) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float32]] | None:
    """Per-cell NDVI and albedo for one scene, `grid_for(footprint_m)` per side.

    Returns None if unreadable.

    THIS is the measurement. `scene_metrics` below is one reduction of it and the
    raster exporter is another; both must see identical masking, which is why
    there is one function and not two near-copies.
    """
    assets = feat["assets"]
    if not all(b in assets for b in BANDS):
        return None

    # BOA_ADD_OFFSET. Introduced at processing baseline 04.00; BEFORE that there is
    # no offset in the product at all, so there is nothing to remove.
    #
    # The gate must be on BASELINE, not on date. The archive is reprocessed, so a
    # 2021 acquisition appears twice — once as baseline 03.01 and again as a
    # reprocessed 05.00 — and the two need opposite treatment. Keying off the date
    # applied -0.1 to old-baseline scenes that never had it, and since a negative
    # offset RAISES NDVI (it shrinks the denominator), that inflated Barrackpore's
    # 2021 NDVI to 0.497 against 0.267-0.313 for every later year. It read as a
    # step change in land cover and was not one.
    props = feat["properties"]
    baseline = str(props.get("s2:processing_baseline", "99.99"))
    already = props.get("earthsearch:boa_offset_applied") is True
    offset = -1000.0 if (baseline >= "04.00" and not already) else 0.0

    refl = {}
    for b in BANDS:
        dn = read_window(assets[b]["href"], lat, lon, footprint_m)
        if dn is None:
            return None
        r = (dn + offset) / 10_000.0
        refl[b] = np.clip(r, 0, 1.5)

    valid = refl["nir"] + refl["red"] > 0.02          # drop nodata / deep shadow
    if valid.mean() < 0.5:
        return None

    ndvi = np.where(valid, (refl["nir"] - refl["red"]) / (refl["nir"] + refl["red"] + 1e-9), np.nan)
    albedo = np.where(valid, sum(w * refl[b] for b, w in ALBEDO_W.items()), np.nan)
    return ndvi.astype(np.float32), albedo.astype(np.float32)


def scene_metrics(feat: dict[str, Any], lat: float, lon: float,
                  footprint_m: int) -> tuple[float, float] | None:
    """Ward-median NDVI and albedo for one scene — scene_arrays, spatially reduced.

    The median, not the mean: one undetected cloud edge in a ward window moves a
    mean and barely touches a median.
    """
    got = scene_arrays(feat, lat, lon, footprint_m)
    if got is None:
        return None
    return float(np.nanmedian(got[0])), float(np.nanmedian(got[1]))


def _self_test() -> None:
    """Grid must derive from the ward, not from a module constant.

    Bengaluru's wards are 2800 m; at Kolkata's fixed 1400 m the window would be
    read a quarter of the size and silently mis-scaled onto a 140 grid.
    """
    assert grid_for(1400) == 140, grid_for(1400)
    assert grid_for(2800) == 280, grid_for(2800)
    try:
        grid_for(1234)
    except ValueError:
        pass
    else:
        raise AssertionError("a footprint that is not a whole number of 10 m cells must raise")

    # NO DEFAULT FOOTPRINT, ANYWHERE ON THE READ PATH. A default is how the
    # Kolkata bias would come back: every caller that forgot the argument would
    # keep working and keep reading 1400 m. The three functions that size a
    # window must each demand it, so the omission is a TypeError at the call
    # site rather than a quarter-ward raster nine steps downstream.
    import inspect
    for fn in (read_window, scene_arrays, scene_metrics):
        p = inspect.signature(fn).parameters.get("footprint_m")
        assert p is not None, f"{fn.__name__} does not take a footprint"
        assert p.default is inspect.Parameter.empty, (
            f"{fn.__name__} defaults its footprint to {p.default!r} — that is the bug")

    for gone in ("GRID", "FOOTPRINT_M"):
        assert gone not in globals(), f"{gone} is back as a module constant"

    print("  _sentinel: grid derives from the ward footprint")


if __name__ == "__main__":
    _self_test()
