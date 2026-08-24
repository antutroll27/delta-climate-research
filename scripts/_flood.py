"""Shared constants for the flood-simulator pipeline (Dubai P1a).

ONE SITE TABLE, ON PURPOSE. `_types.py`'s WARDS carries a comment recording that
five scripts held private copies of the ward table and had already diverged —
one of them by 44 m, four Sentinel pixels. The three flood fetchers (terrain,
buildings, heights) all need the same window, so it lives here once.

Frame convention matches the rest of the repo: x eastward, y northward, metres
from the site centre. See `_types.m_per_deg`.
"""
from __future__ import annotations

import math
from typing import NamedTuple, TypeAlias

Bbox: TypeAlias = tuple[float, float, float, float]
SiteId = str


class Site(NamedTuple):
    id: SiteId
    lat: float
    lon: float
    """Edge length of the square study window, metres."""
    footprint_m: float
    """Side of the analytical grid. 256 at ~30 m ≈ the 7.68 km window."""
    grid_n: int


# Dubai Creek — Deira north of the water, Bur Dubai south.
#
# WHY HERE. It is the recognisable core, it flooded in April 2024, and the creek
# puts real permanent water in frame so the renderer has to handle a shoreline
# rather than only puddles. Measured: 13,579 Microsoft GlobalML footprints in
# this window at 22.0 % built coverage — the same order as the Kolkata wards, so
# the twin's perf envelope carries over.
#
# NOT Al Ain, which is where the heaviest rain fell (254.8 mm, Khatm Al Shakla):
# GlobalML has NO coverage there. Quadkey 123023311 is absent from the UAE tile
# list, verified 2026-08-24. Any Al Ain work needs a different footprint source.
SITES: dict[SiteId, Site] = {
    "dubai-creek": Site("dubai-creek", 25.255, 55.305, 7680.0, 256),
}

# Copernicus DEM GLO-30, AWS Open Data mirror.
#
# ANONYMOUS, AND THE BUILD SPEC IS WRONG ABOUT THIS. BUILD-SPEC §2a says GLO-30
# needs "CDSE registration". It does not: this bucket serves the same COGs with
# no credentials and honours HTTP range requests, so a windowed read pulls a few
# hundred kB instead of a 100 MB tile. CDSE is still required for Sentinel-1.
COP_DEM_TILE = (
    "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
    "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif"
)

# Microsoft GlobalML building footprints, CDLA-Permissive-2.0.
#
# HOST CORRECTED 2026-08-24. Preflight §9 flag 9 says the hosting moved to
# `bfppub.blob.core.windows.net`; that 404s for this file. The live index is
# below, taken from the project README rather than from the flag.
GLOBALML_LINKS = (
    "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
)


def site_bounds(s: Site) -> Bbox:
    """(west, south, east, north) in EPSG:4326 — rasterio `from_bounds` order.

    That order is a silent-failure surface: wrong order reads the wrong window
    and returns data rather than raising, so it is written once.
    """
    mx, my = m_per_deg(s.lat)
    half = s.footprint_m / 2
    return (s.lon - half / mx, s.lat - half / my,
            s.lon + half / mx, s.lat + half / my)


def m_per_deg(lat: float) -> tuple[float, float]:
    """(east, north) metres per degree. Mirrors `_types.m_per_deg`."""
    return (111_320.0 * math.cos(math.radians(lat)), 110_540.0)


def dem_tile_url(lat: float, lon: float) -> str:
    """The GLO-30 1x1 degree tile containing a point."""
    return COP_DEM_TILE.format(
        ns="N" if lat >= 0 else "S", lat=int(math.floor(abs(lat))),
        ew="E" if lon >= 0 else "W", lon=int(math.floor(abs(lon))),
    )
