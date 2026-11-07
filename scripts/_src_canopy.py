"""Canopy trees from the Meta/WRI CHM v2 for a city after Bengaluru (Task A8).

Kolkata's placement rule, VERBATIM. The constants and the hash are not retyped here: they
are loaded from `fetch-canopy.py` (the hyphen forces importlib, as `fetch-bangalore.py`
does), so two cities placed by one rule stay comparable and a retune can only happen in one
file. `place_trees` is the same arithmetic as that file's `_generate` (and as Bengaluru's
`place_canopy`); the self-test requires it to reproduce `_generate` on a synthetic 140 x 140
grid, tree for tree.

SOURCE. CHM v2 (`dinov3_global_chm_v2_ml3`, CC BY 4.0), a COG in EPSG:3857 on a public
bucket, read anonymously with a WINDOWED read: the 100 MB tile is never downloaded.
`chm_path` refuses an area whose box touches a second zoom-10 tile (it would need a
mosaic); the Amsterdam square sits wholly inside tile 1202021101 (all four corners checked).

AMSTERDAM IS NOT A GRID-ALIGNED PROBLEM. The CHM is ~1.19 m native; the 10 m placement
grid is a block mean of a 1 m resample, exactly as Bengaluru does it.

Municipal tree inventory: NOT used at geometry tier (its pass-on clause, founder Q9).
"""
from __future__ import annotations

import importlib.util
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final, cast

import numpy as np
import numpy.typing as npt

import _city
import _src_overture as ovt
from _city import Area, CityBuildingsFile, CityCanopyFile, CityContextFile, CityTree

F32 = npt.NDArray[np.float32]

#: The spec's cover threshold, measured at ~1 m on the native raster, never on the 10 m
#: averages. Bengaluru's value (verified equal in the self-test).
COVER_H: Final = 3.0
CELL_M: Final = 10


@dataclass(frozen=True, slots=True)
class KolkataRule:
    """Kolkata's placement rule, read out of fetch-canopy.py."""
    hash01: Callable[[int, int, int, int], float]
    quadkey: Callable[[float, float, int], str]
    species: tuple[str, ...]
    min_tree_h: float
    density_max: int
    density_ref_h: float
    jitter: float
    bucket: str
    prefix: str
    zoom: int


def kolkata_rule() -> KolkataRule:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch-canopy.py")
    spec = importlib.util.spec_from_file_location("fetch_canopy", path)
    assert spec is not None and spec.loader is not None
    mod: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return KolkataRule(
        hash01=cast(Callable[[int, int, int, int], float], mod._hash01),
        quadkey=cast(Callable[[float, float, int], str], mod._quadkey),
        species=cast("tuple[str, ...]", mod.SPECIES),
        min_tree_h=float(mod.MIN_TREE_H), density_max=int(mod.DENSITY_MAX),
        density_ref_h=float(mod.DENSITY_REF_H), jitter=float(mod.JITTER),
        bucket=str(mod.CHM_BUCKET), prefix=str(mod.CHM_PREFIX), zoom=int(mod.CHM_ZOOM))


def chm_path(area: Area, rule: KolkataRule) -> str:
    """/vsis3/ path of the one tile that holds the whole square; refuses a straddle."""
    w, s, e, n = _city.bounds(area)
    keys = {rule.quadkey(la, lo, rule.zoom) for la in (s, n) for lo in (w, e)}
    if len(keys) != 1:
        raise SystemExit(f"{area.id}: the box touches CHM tiles {sorted(keys)}; this adapter reads one tile, mosaic it first")
    return f"/vsis3/{rule.bucket}/{rule.prefix}/chm/{keys.pop()}.tif"


def read_chm_metre(area: Area, path: str) -> F32:
    """The square at 1 m (size x size), north-up, metres. One windowed read of the COG."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
    west, south, east, north = _city.bounds(area)
    n = int(area.size_m)
    with rasterio.open(path) as src:
        l, b, r, t = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
        win = from_bounds(l, b, r, t, src.transform)
        arr = src.read(1, window=win, out_dtype="float32", out_shape=(n, n),
                       boundless=True, fill_value=0.0, resampling=Resampling.average)
    out = np.asarray(arr, dtype=np.float32)
    out[~np.isfinite(out)] = 0.0
    np.clip(out, 0.0, None, out=out)
    return out


def block_mean(a: F32, cell: int) -> F32:
    n = a.shape[0]
    assert n % cell == 0 and a.shape == (n, n), "the square must be a whole number of 10 m cells"
    g = n // cell
    return cast(F32, a.reshape(g, cell, g, cell).mean(axis=(1, 3)).astype(np.float32))


def place_trees(grid: F32, size_m: float, rule: KolkataRule,
                species: tuple[str, ...]) -> list[CityTree]:
    """Kolkata's `_generate` over a (g x g) height grid, north-up, drawing from `species`.

    `species` is the CITY's draw (`_city.Area.species_draw()`), not `rule.species`: that is Kolkata's
    tuple (neem, neem, gulmohar, palm) and put palms on Amsterdam's canals. Everything else is the
    rule verbatim; the self-test requires that, given Kolkata's own tuple, this reproduces
    `fetch-canopy.py _generate` tree for tree. The species index is the same hash draw, so a
    one-name draw changes only the label, never a position, height or count.
    """
    assert species, "a species draw cannot be empty"
    g = grid.shape[0]
    cell_m = size_m / g
    half = size_m / 2.0
    out: list[CityTree] = []
    for row in range(g):
        for col in range(g):
            h = float(grid[row, col])
            if h < rule.min_tree_h:
                continue
            count = min(rule.density_max, int(rule.density_max * h / rule.density_ref_h + 0.5))
            for k in range(count):
                jx = (rule.hash01(col, row, k, 0) - 0.5) * rule.jitter * cell_m
                jy = (rule.hash01(col, row, k, 1) - 0.5) * rule.jitter * cell_m
                out.append(CityTree(
                    x=round((col + 0.5) * cell_m - half + jx, 2),
                    y=round(half - (row + 0.5) * cell_m + jy, 2),
                    h=round(h, 1),
                    r=round(h * 0.35 * (0.9 + 0.2 * rule.hash01(col, row, k, 2)), 2),
                    species=species[int(rule.hash01(col, row, k, 3) * len(species))]))
    return out


def _inside_any(trees: list[CityTree], geoms: list[Any]) -> set[int]:
    from shapely.geometry import Point
    from shapely.strtree import STRtree
    if not geoms or not trees:
        return set()
    hit = STRtree(geoms).query([Point(t["x"], t["y"]) for t in trees], predicate="within")
    return {int(i) for i in np.asarray(hit)[0]} if len(hit) else set()


def drop_in_roads(trees: list[CityTree], ctx: CityContextFile) -> tuple[list[CityTree], int]:
    from shapely.geometry import LineString
    ribbons: list[Any] = []
    for r in ctx["roads"]:
        ln = r["line"]
        pts = [(ln[i], ln[i + 1]) for i in range(0, len(ln) - 1, 2)]
        if len(pts) >= 2:
            ribbons.append(LineString(pts).buffer(ovt.ROAD_WIDTH_M.get(r["cls"], 5.0) / 2.0, cap_style="flat"))
    gone = _inside_any(trees, ribbons)
    return [t for i, t in enumerate(trees) if i not in gone], len(gone)


def drop_in_buildings(trees: list[CityTree], bdoc: CityBuildingsFile) -> tuple[list[CityTree], int]:
    from shapely.geometry import Polygon
    polys: list[Any] = []
    for b in bdoc["b"]:
        p = b["p"]
        pts = [(p[i], p[i + 1]) for i in range(0, len(p) - 1, 2)]
        if len(pts) >= 3:
            polys.append(Polygon(pts))
    gone = _inside_any(trees, polys)
    return [t for i, t in enumerate(trees) if i not in gone], len(gone)


def build_canopy(area: Area, ctx: CityContextFile, bdoc: CityBuildingsFile) -> tuple[CityCanopyFile, str]:
    rule = kolkata_rule()
    path = chm_path(area, rule)
    chm = read_chm_metre(area, path)
    cover = float((chm >= COVER_H).mean())
    grid = block_mean(chm, CELL_M)
    draw = area.species_draw()
    cands = place_trees(grid, float(area.size_m), rule, draw)
    after_roads, in_roads = drop_in_roads(cands, ctx)
    kept, in_buildings = drop_in_buildings(after_roads, bdoc)
    doc = CityCanopyFile(
        city=area.city, area=area.id, sizeM=float(area.size_m), grid=int(grid.shape[0]),
        source=f"Meta/WRI global canopy height model v2 ({rule.prefix}), CC BY 4.0, "
               f"tile {path.rsplit('/', 1)[1].removesuffix('.tif')}",
        method="Kolkata fetch-canopy.py _generate: 10 m cells, 0..4 instances per cell scaling with "
               "height against a fixed 30 m reference, deterministic jitter. Tree COUNT is a display "
               "scaling, not a measurement; canopy HEIGHT is measured. Species is a display label, not a "
               f"measurement: drawn by hash01(col, row, kk, 3) over {list(draw)} (the city's draw, chosen by "
               f"Koppen class {area.koppen}; Kolkata's tuple has palms, a temperate city's does not). Trees "
               "inside a drawn carriageway or a building footprint are dropped.",
        densityRefM=rule.density_ref_h, minTreeH=rule.min_tree_h,
        coverFrac=round(cover, 4), coverThresholdM=COVER_H,
        candidates=len(cands), droppedInBuildings=in_buildings, droppedInRoads=in_roads,
        count=len(kept), trees=kept)
    return doc, path


def self_test() -> None:
    rule = kolkata_rule()
    assert (rule.min_tree_h, rule.density_max, rule.density_ref_h, rule.jitter) == (2.0, 4, 30.0, 0.80)
    assert rule.zoom == 10 and "dinov3_global_chm_v2" in rule.prefix
    assert ovt._bangalore_constant("COVER_H") == COVER_H, "cover threshold drifted from Bengaluru's"
    assert rule.species == _city.TROPICAL_SPECIES_DRAW, "_city's tropical draw drifted from fetch-canopy.py SPECIES"

    # place_trees == Kolkata's own _generate, tree for tree, on a synthetic 140 x 140 grid.
    spec = importlib.util.spec_from_file_location("fc", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch-canopy.py"))
    assert spec is not None and spec.loader is not None
    fc: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fc)
    rng = np.random.default_rng(7)
    grid = (rng.random((140, 140)) * 38.0).astype(np.float32)        # includes cells above the 30 m reference
    mine = place_trees(grid, 1400.0, rule, rule.species)
    theirs = fc._generate(fc.TEST_WARD, grid)
    assert len(mine) == len(theirs) > 1000, (len(mine), len(theirs))
    assert [dict(t) for t in mine] == theirs, "place_trees drifted from Kolkata's _generate"

    # block_mean: an exact 10 x 10 mean, north-up preserved.
    a = np.zeros((20, 20), dtype=np.float32)
    a[:10, 10:] = 8.0                                                # NE quadrant
    g = block_mean(a, 10)
    assert g.shape == (2, 2) and g[0, 1] == 8.0 and g[1, 0] == 0.0, g
    # NORTH CHECK: a tall cell in the NORTHERN row of the grid yields trees with y > 0.
    tall = np.zeros((4, 4), dtype=np.float32)
    tall[0, 2] = 20.0
    ts = place_trees(tall, 40.0, rule, rule.species)
    assert ts and all(t["y"] > 0 and t["x"] > 0 for t in ts), ts
    # THE TEMPERATE DRAW: same positions, heights and counts as Kolkata's draw on the same grid; only the label differs, and no palm.
    tropical = place_trees(grid, 1400.0, rule, _city.TROPICAL_SPECIES_DRAW)
    temperate = place_trees(grid, 1400.0, rule, _city.TEMPERATE_SPECIES_DRAW)
    assert len(temperate) == len(tropical) and all(
        (a["x"], a["y"], a["h"], a["r"]) == (b["x"], b["y"], b["h"], b["r"]) for a, b in zip(tropical, temperate, strict=True))
    assert {t["species"] for t in temperate} == {"broadleaf"} and {"palm", "neem", "gulmohar"} <= {t["species"] for t in tropical}
    assert all("palm" not in a.species_draw() for a in _city.AREAS.values() if a.koppen[:1] in ("C", "D"))
    print("_src_canopy self-test: ok (place_trees == fetch-canopy._generate on 19,600 cells)")
