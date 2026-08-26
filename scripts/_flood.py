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
    # THE COASTAL STRIP, and the boundary is physical rather than budgetary.
    #
    # 28.44 km at 30 m, centred to cover Downtown, Business Bay, the Creek, Deira,
    # Al Quoz, Dubai Hills, MBR City, Meydan, JVC, JVT, Al Furjan, Discovery
    # Gardens, Sports City, JLT, Internet/Media City, Dubai Marina, JBR, Palm
    # Jumeirah, Ras Al Khor and Dubai Creek Harbour.
    #
    # IT STOPS SHORT OF DUBAI SOUTH ON PURPOSE. Sampled over 7,857 SRTM points,
    # Dubai South and Al Maktoum sit ~35 m ABOVE Downtown some 25 km away — a
    # topographic HIGH that sheds toward the coast rather than a basin that
    # receives. It is a separate upper catchment, not an extension of this one.
    # Independently, the published Dubai HEC-RAS study puts >90 % of its study
    # area below 10 m amsl, which is almost exactly the coverage limit of the
    # DeltaDTM bare earth this pipeline routes on. The data boundary and the
    # flood boundary coincide.
    #
    # The economics agree with the physics: this strip holds 91.8 % of the
    # buildings of a box that also reached Dubai South, in 63 % of the area. The
    # southern band adds 8 % of buildings for 37 % of the area, and one
    # south-east quadrant runs at 3.5 buildings/km2. It is also the worst-mapped
    # part of any box — Dubai South is 62 % complete in OSM with ONE height on
    # 1,571 buildings, so including it would render a guess.
    "dubai-creek": Site("dubai-creek", 25.1540, 55.240, 28440.0, 948),
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
# OpenStreetMap heights via Overpass.
#
# THE ONLY PER-BUILDING HEIGHTS THAT EXIST FOR DUBAI. Microsoft GlobalML ships a
# `height` field that is -1.0 on all 241,667 UAE footprints, and Google Open
# Buildings 2.5D excludes every GCC state. OSM carries height or building:levels
# on 2,680 buildings in this window, 54 of them over 200 m.
#
# LICENCE, STATED PLAINLY: OSM is ODbL, which carries share-alike. GlobalML is
# CDLA-Permissive. Attaching ODbL heights to permissive footprints raises a
# derived-database question that has NOT been resolved here — this is fine for
# look development and internal renders, and needs a decision before anything
# ships. The artefact records which heights came from which source so the two
# can be separated again.
OVERPASS = "https://overpass-api.de/api/interpreter"

GLOBALML_LINKS = (
    "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
)


# DeltaDTM v1.1 (Pronk et al. 2024, Scientific Data, doi:10.1038/s41597-024-03091-9).
#
# CC BY 4.0 — COMMERCIALLY CLEAN, which is the whole reason it is here. The two
# obvious alternatives are not: FABDEM and FathomDEM are both CC BY-NC-SA,
# verified at their own licence records. DeltaDTM is a genuine bare-earth DTM at
# 30 m with a stated MAE of 0.43 m, and its tile N25E055 covers Dubai.
#
# It ships as continent archives; Asia.zip is 9.8 GB and the Dubai tile inside it
# is 4.6 MB. _remotezip.py pulls the one member over range requests. The file URL
# is a 4TU UUID rather than a stable path, so it is resolved from the article API
# at run time instead of being pinned here and rotting.
# GEDTM30 v1.2 — a TRUE 30 m bare-earth DTM, CC BY 4.0, commercial use fine.
# OpenGeoHub / Open-Earth-Monitor, random-forest fusion trained on ~30 billion
# ICESat-2 and GEDI ground returns. Peer-reviewed: PeerJ 13:e19673.
#
# WHY IT MATTERS HERE. DeltaDTM clips at 10 m MSL, so 37 % of this window's land
# has to be filled from somewhere. That filler was Copernicus GLO-30 — a SURFACE
# model, which serves buildings and vegetation as ground. Measured on our own
# window against DeltaDTM's 391,923 genuinely-measured cells:
#
#     Copernicus GLO-30 (DSM)   bias +1.61 m   MAE 1.78 m   RMSE 3.04 m
#     GEDTM30 v1.2 (DTM)        bias +1.12 m   MAE 1.49 m   RMSE 2.52 m
#
# Better on every metric, and it is bare earth by construction rather than by
# our own footprint-masking, which only ever reached 9.5 % of cells.
#
# ACCESS: Zenodo carries only a 240 m downsample. The 30 m product is a single
# 403 GiB global COG served with range requests and open CORS — a windowed read
# costs seconds. No login.
#
# The permissive alternatives were checked and are NOT usable: FABDEM and
# FathomDEM are both CC BY-NC-SA (verified via Zenodo's API, records 14511570
# and 14523356), and this is a commercial project.
GEDTM30_COG = ("https://s3.opengeohub.org/global/dtm/v1.2/"
               "gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif")
GEDTM30_LICENCE = "CC BY 4.0"
GEDTM30_ATTRIBUTION = (
    "GEDTM30 v1.2 (OpenGeoHub / Open-Earth-Monitor, Hengl et al., "
    "PeerJ 13:e19673) — CC BY 4.0"
)

DELTADTM_ARTICLE = "https://data.4tu.nl/v2/articles/21997565/files"
DELTADTM_ARCHIVE = "Asia.zip"
DELTADTM_LICENCE = "CC BY 4.0"
DELTADTM_ATTRIBUTION = (
    "DeltaDTM v1.1 © Pronk et al., TU Delft / 4TU.ResearchData (CC BY 4.0)"
)


def deltadtm_tile(lat: float, lon: float) -> str:
    """Member name inside the continent archive, e.g. DeltaDTM_v1_0_N25E055.tif."""
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"DeltaDTM_v1_0_{ns}{int(abs(lat)):02d}{ew}{int(abs(lon)):03d}"


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


# ── CTBUH-verified landmark heights ──────────────────────────────────────────
#
# The Council on Tall Buildings and Urban Habitat is the industry authority for
# tall-building heights, and its numbers disagree with OSM's on most of these.
# OSM frequently derives height from `building:levels` x 3.2 m, which is a floor
# -count approximation: Burj Khalifa came through at 521.6 m against a true 828.
#
# ARCHITECTURAL height is the figure used — to the architectural top, spire
# included, mast excluded. CTBUH publishes Architectural, To Tip and Highest
# Occupied and does NOT publish a roof height; any "roof height" quoted elsewhere
# comes from somewhere else. Independently corroborated by Wikidata (CC0), which
# returns 828.0 for Burj Khalifa from a separate lineage.
#
# Heights are FACTS, not creative expression, so a short reference table of
# published measurements carries no licence burden — unlike the OSM geometry
# these attach to.
#
# (name, lat, lon, architectural_height_m)
CTBUH_LANDMARKS: list[tuple[str, float, float, float]] = [
    ("Burj Khalifa",                    25.197321, 55.274250, 828.0),
    ("City Tower One",                  25.218996, 55.279163, 362.8),
    ("Gevora Hotel",                    25.212339, 55.277199, 356.2),
    ("JW Marriott Marquis Tower 1",     25.185940, 55.258430, 355.4),
    ("JW Marriott Marquis Tower 2",     25.185369, 55.257771, 355.4),
    ("Emirates Tower One",              25.217609, 55.283588, 354.6),
    ("Al Habtoor City Tower",           25.182184, 55.253124, 345.0),
    ("Safa Two",                        25.181339, 55.252186, 340.0),
    ("The A-Tower",                     25.210138, 55.273289, 334.0),
    ("Rose Rayhaan by Rotana",          25.211679, 55.276699, 333.0),
    ("Al Yaqoub Tower",                 25.216428, 55.279731, 328.0),
    ("The Index",                       25.207430, 55.277802, 326.0),
    ("Blue Tower (HHHR)",               25.221251, 55.280708, 317.6),
    ("Emirates Tower Two",              25.217621, 55.282318, 309.0),
    ("One Za'abeel The Tower",          25.227566, 55.291286, 301.4),
    ("The Tower Plaza Hotel",           25.217640, 55.278549, 294.0),
    ("The Tower (Union Properties)",    25.216789, 55.280102, 242.6),
    ("One Za'abeel The Residences",     25.227255, 55.292927, 238.3),
]


def window_key(s: Site) -> str:
    """Short hash of the study window, for cache filenames.

    CACHES WERE KEYED BY SITE ID ALONE, which is a silent-staleness trap: moving
    the window from 12 km to 28 km left every Overpass and Wikidata response on
    disk under the same name, so the fetchers would have re-served data for the
    OLD bbox with no error and no warning. Keying by the window means a site
    change simply misses the cache and re-fetches.
    """
    import hashlib
    w, so, e, n = site_bounds(s)
    return hashlib.sha1(f"{w:.5f},{so:.5f},{e:.5f},{n:.5f}".encode()).hexdigest()[:8]
