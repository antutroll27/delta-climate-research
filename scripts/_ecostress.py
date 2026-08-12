#!/usr/bin/env python3
"""
Shared ECOSTRESS access layer: CMR search, authenticated band fetch, target grid.

WHY THIS FILE EXISTS. These six functions lived in `ecostress-census.py`, and two
other scripts needed them. But that filename contains a hyphen, so it is not a
legal Python module name and `import ecostress-census` is a syntax error. Both
consumers worked around it the same way:

    _spec = importlib.util.spec_from_file_location("census", ".../ecostress-census.py")
    census = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(census)

That runs, and it costs every type the module has. `census` is `Any`, so
`census.fetch(...)` is an untyped call returning `Any`, and the `Any` spreads
into whatever it touches — a `str | None` that must be checked for None became
indistinguishable from a `str`. It also silently re-executes the module's
top-level code in a second namespace, so `ecostress-census.py` was being parsed
twice with two independent copies of its constants.

A hyphenated CLI script is fine. A hyphenated *library* is not. The shared parts
live here, importable and checked; the scripts keep their names and import it.

Auth: reads an Earthdata Login bearer token from
      ~/.config/delta-climate/earthdata-token (0600, never printed, never in git).
      Regenerate at urs.earthdata.nasa.gov; they last ~60 days.

Data gotchas encoded here (each cost real debugging time):
  * L2T v002 LST COGs are float32 KELVIN with NaN nodata. They are NOT uint16
    needing scale 0.02 — applying that yields ~ -267 C.
  * Mask with np.isfinite(), never `> threshold`: NaN comparisons are all False.
  * GDAL /vsicurl drops the auth header across LP DAAC's redirect and returns a
    misleading 404, so we curl the file down and open it locally.
  * The QC band's cloud bits (5&4) are UNSET in v002. Cloud must come from the
    separate cloud.tif, where 1 = cloudy.
  * Kolkata spans tiles 45QXE (south, incl. Baruipur) and 45QXF (north). They
    overlap ~9.8 km, so acquisitions are deduplicated by timestamp.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.parse
from typing import Any, TypeAlias

import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from rasterio.transform import from_origin
from rasterio.enums import Resampling  # canonical home; rasterio.warp only re-exports
from rasterio.warp import reproject, transform_bounds

#: A CMR UMM granule record. The schema is NASA's and deeply nested; the two
#: paths this code reads are asserted at their use sites rather than modelled in
#: full, which would be a large TypedDict that CMR is free to extend.
Granule: TypeAlias = dict[str, Any]

#: (timestamp, granules-at-that-timestamp). One acquisition, possibly split
#: across the two overlapping MGRS tiles.
Acquisition: TypeAlias = tuple[str, list[Granule]]

#: west, south, east, north — degrees, EPSG:4326
Bbox: TypeAlias = tuple[float, float, float, float]

BBOX: Bbox = (88.30, 22.36, 88.45, 22.77)     # all three ward centroids + margin
CACHE = os.path.expanduser("~/.cache/delta-climate/ecostress")
TOKEN_PATH = os.path.expanduser("~/.config/delta-climate/earthdata-token")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"

# Target grid. The two MGRS tiles share a CRS but not an origin, so window-reading
# each one gives different shapes and they cannot be combined. Reprojecting both
# onto one grid fixes that and handles the ~9.8 km overlap.
TARGET_RES = 70.0                  # native ECOSTRESS L2T resolution

#: A study area wider than this is not a city and UTM is the wrong projection for
#: it: a single zone's transverse Mercator is only honest a few degrees from its
#: central meridian, and 12 deg already reaches ~1.5 % scale error at the edge.
#: Both cities are far inside it — Kolkata's widest box is 0.85 deg, Dubai's urban
#: core 0.70 deg — and the oracle's deliberate 6 deg regression fixture still fits.
MAX_STUDY_WIDTH_DEG = 12.0


def utm_zone(lon: float) -> int:
    """UTM zone number containing a longitude. Zones are 6 deg wide from 180W."""
    return int((lon + 180.0) // 6.0) % 60 + 1


def utm_central_meridian(zone: int) -> float:
    """Central meridian of a UTM zone, degrees east."""
    return zone * 6.0 - 183.0


def target_crs(bbox: Bbox | None = None) -> str:
    """The UTM CRS a study area belongs in, DERIVED from its own centre.

    TRACK A. This was `TARGET_CRS = "EPSG:32645"`, hardcoded for Kolkata, and
    `target_grid` would happily project any bbox into it and return a plausible
    grid. Measured 2026-08-12: the Dubai urban core came back as 97.0 x 93.6 km
    against a true 70.5 x 66.7 km — inflated 37 % in x and 40 % in y, silently,
    because Dubai is five zones away. Deriving the CRS makes that unrepresentable
    rather than merely detected.

    KOLKATA MUST NOT MOVE. BBOX's centre longitude is 88.375, which derives to
    zone 45 — exactly the value that was hardcoded — so every existing grid,
    artefact and oracle case is byte-identical. That is not a happy accident to
    rely on quietly: `check-geo-oracle.py` compares the live CRS against the
    frozen one and fails loudly if this ever stops being true.

    Southern-hemisphere areas get the 327xx band. No city needs it today, but the
    alternative is silently projecting a southern city into a northern zone, which
    is the same class of bug this function exists to remove.
    """
    box = bbox or BBOX
    width = abs(box[2] - box[0])
    if width > MAX_STUDY_WIDTH_DEG:
        raise ValueError(
            f"target_crs: study area spans {width:.1f} deg of longitude, beyond the "
            f"{MAX_STUDY_WIDTH_DEG:.0f} deg where a single UTM zone stays honest. "
            f"A box this wide needs an equal-area or per-tile projection, not one "
            f"transverse Mercator.")
    band = 326 if (box[1] + box[3]) / 2.0 >= 0.0 else 327
    return f"EPSG:{band}{utm_zone((box[0] + box[2]) / 2.0):02d}"


#: Kolkata's CRS, kept as a module constant because the oracle, the census and the
#: parity dump are all Kolkata-scoped and read it directly. It is now DERIVED
#: rather than asserted, so it cannot drift from what target_grid actually uses.
TARGET_CRS = target_crs(BBOX)      # EPSG:32645 — UTM 45N, Kolkata

#: A granule is a real file, not a stub. LP DAAC serves an HTML error page on a
#: bad token, which is a few hundred bytes and would otherwise cache as success.
MIN_TIF_BYTES = 2000


def token() -> str:
    if not os.path.exists(TOKEN_PATH):
        sys.exit(f"No Earthdata token at {TOKEN_PATH}. Generate one at urs.earthdata.nasa.gov.")
    with open(TOKEN_PATH) as fh:
        return fh.read().strip()


def cmr_search(day_night: str, start: str, limit: int | None = None, end: str = "",
               bbox: Bbox | None = None) -> list[Acquisition]:
    """
    Distinct acquisitions, newest first, deduplicated across MGRS tiles.

    PAGINATES. An earlier version hardcoded page_size=200 and sliced [:limit]
    AFTER dedup, which silently truncated: the night query over 2024-2026 alone
    returns 369 granules. For a calibration sweep that is the worst possible
    failure — it biases the sample invisibly rather than erroring. `limit=None`
    means "every acquisition in range".

    A PAGE THAT FAILS NOW RAISES. curl returning non-zero, or a body that is not
    JSON, previously produced `items = []`, which is indistinguishable from "end
    of results" — so a network blip mid-sweep ended pagination early and returned
    a short list that looked complete. Truncation must not be silent; that is the
    whole point of the paginating rewrite.
    """
    seen: dict[str, list[Granule]] = {}
    after: str | None = None
    for page in range(50):                    # hard stop; 50 x 2000 >> any real query
        params = {
            "short_name": "ECO_L2T_LSTE", "version": "002",
            "bounding_box": ",".join(map(str, bbox or BBOX)),
            "temporal": f"{start}T00:00:00Z,{end + 'T00:00:00Z' if end else ''}",
            "day_night_flag": day_night, "page_size": "2000",
            "sort_key": "-start_date",
        }
        cmd = ["curl", "-s", "--fail", "-D", "-",
               "-H", "User-Agent: DeltaClimateResearch/1.0"]
        if after:
            cmd += ["-H", f"CMR-Search-After: {after}"]
        proc = subprocess.run(cmd + [f"{CMR}?{urllib.parse.urlencode(params)}"],
                              capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(
                f"CMR page {page + 1} failed (curl {proc.returncode}) after "
                f"{len(seen)} acquisitions. Refusing to return a partial list — "
                f"a short sweep that looks complete biases the sample invisibly.")
        head, sep, body = proc.stdout.partition("\r\n\r\n")
        if not sep:
            head, _, body = proc.stdout.partition("\n\n")
        after = next((ln.split(":", 1)[1].strip() for ln in head.splitlines()
                      if ln.lower().startswith("cmr-search-after:")), None)
        if not body.strip():
            raise RuntimeError(f"CMR page {page + 1} returned an empty body after "
                               f"{len(seen)} acquisitions — see above.")
        try:
            items: list[Granule] = json.loads(body).get("items", [])
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"CMR page {page + 1} was not JSON ({exc.msg}) after "
                               f"{len(seen)} acquisitions — see above.") from exc
        for it in items:
            u = it["umm"]
            seen.setdefault(
                u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:19], []).append(u)
        if not after or not items:
            break
    out = sorted(seen.items(), reverse=True)
    return out[:limit] if limit else out


def fetch(url: str | None, tok: str) -> str | None:
    """Download a band to the cache, or None. Never raises on a bad granule."""
    # band_url() returns None for an absent band; without this guard the very
    # next line raises AttributeError and kills a whole sweep.
    if not url:
        return None
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rsplit("/", 1)[-1])
    if os.path.exists(path) and os.path.getsize(path) > MIN_TIF_BYTES:
        return path
    rc = subprocess.run(
        ["curl", "-sL", "--fail", "-H", f"Authorization: Bearer {tok}",
         "-H", "User-Agent: DeltaClimateResearch/1.0", "-o", path, url],
        timeout=600).returncode
    if rc != 0 or not os.path.exists(path) or os.path.getsize(path) < MIN_TIF_BYTES:
        if os.path.exists(path):
            os.remove(path)
        return None
    return path


def band_url(granule: Granule, suffix: str) -> str | None:
    urls: list[dict[str, Any]] = granule.get("RelatedUrls", [])
    return next((str(u["URL"]) for u in urls
                 if str(u.get("URL", "")).startswith("https")
                 and str(u["URL"]).endswith(suffix)), None)


__all__ = ["BBOX", "CACHE", "CMR", "TARGET_CRS", "TARGET_RES", "TOKEN_PATH",
           "Acquisition", "Bbox", "Granule", "align", "band_url", "cmr_search",
           "fetch", "read_window", "target_crs", "target_grid", "token",
           "transform_bounds", "utm_zone"]


def target_grid(bbox: Bbox | None = None) -> tuple[Affine, int, int]:
    """(affine transform, width, height) of the grid this study area belongs on.

    The CRS comes from `target_crs(bbox)`, so a Dubai bbox gets UTM 40N and a
    Kolkata one gets 45N. `align` and `read_window` derive it from the SAME bbox —
    if any of the three used a different CRS the reprojection would still succeed
    and the array would still have the right shape, which is exactly the kind of
    failure that reaches published numbers.
    """
    box = bbox or BBOX
    l, b, r, t = transform_bounds("EPSG:4326", target_crs(box), *box, densify_pts=21)
    w = int(np.ceil((r - l) / TARGET_RES))
    h = int(np.ceil((t - b) / TARGET_RES))
    return from_origin(l, t, TARGET_RES, TARGET_RES), w, h


def align(path: str, nodata: float, dtype: str, bbox: Bbox | None = None,
          resampling: Resampling = Resampling.nearest) -> npt.NDArray[Any]:
    """
    Reproject one COG band onto the shared target grid.

    `resampling` defaults to nearest and should stay there for anything masked:
    interpolating across a cloud edge invents temperatures that were never
    measured, and the result looks entirely plausible.

    NDArray[Any], not a concrete element type: `dtype` is a caller-chosen string
    (float32 for LST, uint16 for QC, int16 for SMOD), so the element type is not
    knowable here without an overload per dtype literal — machinery the four
    call sites do not justify. The ARRAY structure is what matters: a misspelled
    method or a non-array use now fails the check, which bare `Any` never did.
    """
    tf, w, h = target_grid(bbox)
    dst = np.full((h, w), nodata, dtype=dtype)
    with rasterio.open(path) as src:
        reproject(source=rasterio.band(src, 1), destination=dst,
                  src_transform=src.transform, src_crs=src.crs,
                  dst_transform=tf, dst_crs=target_crs(bbox),
                  resampling=resampling, src_nodata=src.nodata, dst_nodata=nodata)
    return dst


def read_window(path: str, nodata: float = np.nan, dtype: str = "float32",
                bbox: Bbox | None = None) -> tuple[npt.NDArray[Any], Affine, rasterio.crs.CRS]:
    """align(), plus the grid it was aligned to. Returns (array, transform, crs)."""
    tf, _w, _h = target_grid(bbox)
    return (align(path, nodata, dtype, bbox), tf,
            rasterio.crs.CRS.from_string(target_crs(bbox)))


def _self_check() -> None:
    """ponytail: one runnable check — the grid must be square, north-up, and sized."""
    tf, w, h = target_grid()
    assert w > 0 and h > 0, "target grid has no extent"
    assert abs(tf.a - TARGET_RES) < 1e-9, f"pixel width {tf.a} != {TARGET_RES}"
    assert abs(tf.e + TARGET_RES) < 1e-9, f"grid is not north-up (e={tf.e})"
    # A bbox half the width must not produce a grid wider than the full one.
    l, b, r, t = BBOX
    _tf2, w2, _h2 = target_grid((l, b, (l + r) / 2, t))
    assert w2 < w, f"half-width bbox gave {w2} columns against {w} for the full bbox"

    # TRACK A — the CRS is derived, not hardcoded.
    assert utm_zone(88.36) == 45 and utm_zone(55.25) == 40, "UTM zone arithmetic"
    assert abs(utm_central_meridian(45) - 87.0) < 1e-9, "zone 45 central meridian is 87E"

    # THE INVARIANT THE WHOLE CHANGE RESTS ON: Kolkata must not move.
    assert target_crs() == "EPSG:32645", f"Kolkata moved to {target_crs()}"
    assert TARGET_CRS == "EPSG:32645", "the module constant must still be Kolkata's"

    # Dubai now gets its OWN zone instead of a distorted zone-45 grid.
    dubai: Bbox = (54.90, 24.85, 55.60, 25.45)
    assert target_crs(dubai) == "EPSG:32640", f"Dubai got {target_crs(dubai)}"
    # ...and the grid it produces is the true size. Projected into zone 45 this
    # returned 1385 x 1337 (97.0 x 93.6 km) against a true extent of ~70 x 67 km.
    _tf3, w3, h3 = target_grid(dubai)
    assert 990 < w3 < 1030 and 940 < h3 < 970, f"Dubai grid {w3}x{h3} is not ~70x67 km"

    # Southern hemisphere takes the 327xx band rather than being silently flipped.
    assert target_crs((-46.7, -23.6, -46.5, -23.4)) == "EPSG:32723", "Sao Paulo -> 23S"

    # A box too wide for one transverse Mercator must refuse rather than distort.
    try:
        target_crs((60.0, 20.0, 80.0, 30.0))            # 20 deg of longitude
    except ValueError as e:
        assert "12" in str(e), f"width guard message lost its threshold: {e}"
    else:
        raise AssertionError("a 20 deg-wide study area must not get a UTM grid")
    assert band_url({"RelatedUrls": [{"URL": "https://x/y_LST.tif"}]}, "_LST.tif")
    assert band_url({}, "_LST.tif") is None, "a granule with no bands must yield None"
    assert fetch(None, "tok") is None, "a missing band URL must not be fetched"
    print("  _ecostress self-check OK")


if __name__ == "__main__":
    _self_check()
