"""Meta/WRI 1 m Global Canopy Height Model -> {ward}-canopy.png + {ward}-trees.json.

WHAT THIS IS. The CHMv1 ("alsgedi_global_v6_float") canopy height map, published
by Meta Data for Good + World Resources Institute on AWS Open Data, gives the
one fact the Sentinel-derived `veg[]` field cannot: a measured VERTICAL canopy
height per metre, globally, at ~1 m resolution. NDVI-derived fractional
vegetation cover conflates grass, crops and tree canopy; this model does not.

SOURCE AND ACCESS (verified 2026-08-10). Bucket `s3://dataforgood-fb-data/`,
prefix `forests/v1/alsgedi_global_v6_float/`. Layout confirmed by fetching the
bucket's own index and inspecting it directly (not by trusting an unverified
blog write-up):
  - `tiles.geojson` at the prefix root: 56,145 features, each a rectangular
    polygon tagged `properties.tile` with a 9-digit string.
  - `chm/<tile>.tif`: the height raster for that polygon, one continuous
    GeoTIFF (EPSG:3857, ~1 m/px at 65536x65536 -- not internally tiled, so a
    windowed rasterio read is the only affordable access pattern).
The 9-digit `tile` values are standard Bing/Virtual-Earth QuadKeys at zoom 9 --
confirmed by computing the QuadKey for the ballygunge centre with the textbook
tile-XY + bit-interleave algorithm and matching it byte-for-byte against the
`tiles.geojson` polygon that contains that point (both gave `123133323`). So
`chm_href` computes the QuadKey from the ward centre rather than hardcoding a
tile id -- it generalises to any WARDS entry without a lookup table.

Anonymous access: no AWS account needed. `AWS_NO_SIGN_REQUEST=YES` in the
environment (see `main`'s docstring / the module run instructions) lets GDAL's
`/vsis3/` driver read the object unsigned; rasterio.open() handles the path
transparently.

    AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge
    python3 scripts/fetch-canopy.py --check       # local artefacts only, no network
    python3 scripts/fetch-canopy.py --self-test   # pure placement logic, offline
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
from typing import Any, cast

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _types  # noqa: E402
from _types import WARDS, Ward  # noqa: E402

RETRIEVED = "2026-08-10"          # constant, not date.today() -- byte-stable regeneration
GRID = 140                        # served canopy grid (matches surface: FOOTPRINT_M // 10)
CANOPY_HI = 30.0                  # metres; quantisation ceiling for the PNG
MIN_TREE_H = 2.0                  # metres; below this a cell is not "canopy"
JITTER = 0.80                     # cell-size fraction for position jitter -- tuned live 2026-08-11, spec sec.2
DENSITY_MAX = 4                   # trees at a DENSITY_REF_H cell, scaling to 0 (gaps) -- tuned live 2026-08-11
#: Metres; the FIXED reference height the density scale is pinned to. Deliberately NOT
#: the ward's own tallest cell: normalising per ward makes "dense" mean a different
#: thing in every ward, and cross-ward comparison IS this twin's product. Measured
#: maxima are ballygunge 22 m, barrackpore 25 m, baruipur 20 m -- ward-relative scaling
#: therefore put barrackpore at 0.50 trees per canopy cell against ballygunge's 0.93,
#: not because it has less canopy but because TWO of its 6,069 cells clear 22 m and
#: dragged the whole ward's scale down. 22.0 is ballygunge's own measured max, chosen
#: so the CEO-tuned ballygunge artifact stays byte-identical while the other wards are
#: lifted onto its scale (0.93 / 0.73 / 0.85 measured after the change).
DENSITY_REF_H = 22.0
DATA = os.path.join(HERE, "..", "public", "heat-map", "data")

#: CHMv1 bucket, verified 2026-08-10 against the registry's own tiles.geojson
#: index (56,145 features) fetched and inspected directly -- see module docstring.
CHM_BUCKET = "dataforgood-fb-data"
CHM_PREFIX = "forests/v1/alsgedi_global_v6_float"
CHM_ZOOM = 9                      # QuadKey length observed in tiles.geojson (9 digits)


def _quadkey(lat: float, lon: float, zoom: int) -> str:
    """Bing/Virtual-Earth QuadKey for (lat, lon) at `zoom`.

    Standard tile-XY + bit-interleave algorithm (Microsoft Bing Maps Tile
    System). Verified against the CHM index rather than assumed: computing this
    for the ballygunge centre reproduces the exact tile id
    (`123133323`) that `tiles.geojson` assigns to the polygon containing that
    point, at the zoom level (9) its tile ids happen to use.
    """
    lat_rad = math.radians(lat)
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    digits = []
    for i in range(zoom, 0, -1):
        mask = 1 << (i - 1)
        digit = 0
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def chm_href(ward: Ward) -> str:
    """/vsis3/ path of the Meta/WRI CHM COG tile covering this ward's centre.

    Computed, not hardcoded: the QuadKey for the ward centre at CHM_ZOOM. This
    is safe for a 1400 m ward window because at zoom 9 each tile spans roughly
    150 km on a side in this latitude band -- three orders of magnitude wider
    than the ward, so a window near a tile boundary is the only case that could
    straddle two tiles, and every current WARDS entry (verified for ballygunge)
    sits well inside a single tile.
    """
    qk = _quadkey(ward.centre.lat, ward.centre.lon, CHM_ZOOM)
    return f"/vsis3/{CHM_BUCKET}/{CHM_PREFIX}/chm/{qk}.tif"


def _hash01(col: int, row: int, k: int, axis: int) -> float:
    """Deterministic [0,1) from instance identity -- splitmix64-style finalizer.

    NOT `random`/`Date` (repo rule: byte-stable artifacts). Keyed on the cell
    (col,row), the instance index within the cell (k), and which quantity is
    being drawn (axis: 0=x-jitter, 1=y-jitter, 2=radius, 3=species).

    The `(z >> 11) / 2**53` tail is the canonical splitmix64-to-double step, and
    it is deliberate: it keeps the top 53 bits (a double's whole mantissa) and
    divides by a power of two, so the division is EXACT -- no rounding, which is
    what makes the [0,1) upper bound provable and the result bit-identical on
    every platform and in any future Go/TS port. The tempting `z / 2**64` is
    wrong: its top 1024 inputs round UP to exactly 1.0 (witness col=
    8454462832853231296), and a 1.0 would make a `SPECIES[int(h * len(SPECIES))]`
    draw raise IndexError.
    """
    z = (col * 0x9E3779B97F4A7C15 + row * 0xBF58476D1CE4E5B9
         + k * 0x94D049BB133111EB + axis * 0xD6E8FEB86659FD93) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    z ^= z >> 31
    return (z >> 11) / 2**53


def read_chm_grid(ward: Ward, n: int) -> npt.NDArray[np.float32] | None:
    """Windowed COG read of the CHM, reprojected to the ward box, regridded to n x n.

    Returns metres, north-up (row 0 = north), or None on any failure (callers skip)."""
    lat, lon = ward.centre.lat, ward.centre.lon
    half = ward.footprint_m / 2.0
    dlat = half / 110_540.0
    dlon = half / (111_320.0 * float(np.cos(np.radians(lat))))
    try:
        with rasterio.open(chm_href(ward)) as src:
            l, b, r, t = transform_bounds(
                "EPSG:4326", src.crs, lon - dlon, lat - dlat, lon + dlon, lat + dlat
            )
            win = from_bounds(l, b, r, t, src.transform)
            arr = src.read(
                1, window=win, out_dtype="float32", out_shape=(n, n),
                boundless=True, fill_value=0.0, resampling=Resampling.average,
            )
    except Exception:
        return None
    out = np.asarray(arr, dtype=np.float32)
    out[~np.isfinite(out)] = 0.0
    np.clip(out, 0.0, None, out=out)
    return out


def quantise(a: npt.NDArray[np.float32], hi: float) -> npt.NDArray[np.uint8]:
    q = np.clip(a / hi, 0.0, 1.0) * 255.0
    out: npt.NDArray[np.uint8] = np.round(q).astype(np.uint8)
    return out


def write_canopy_png(ward_id: str, grid_north_up: npt.NDArray[np.float32]) -> str:
    from PIL import Image
    ch = quantise(grid_north_up, CANOPY_HI)              # single channel, north-up
    rgb = np.dstack([ch, ch, ch])                        # grey PNG; TS reads R
    path = os.path.join(DATA, f"{ward_id}-canopy.png")
    Image.fromarray(rgb, mode="RGB").save(path, optimize=True)
    return path


#: Phase-B seam (docs/superpowers/specs/2026-08-11-vegetation-placement-v2-design.md).
#: Exclusion mask (B1) and ETH gate (B3) slot in here as filter callables, in that
#: order; crown-detection (B4) swaps _generate(). Empty in Phase A.
#:
#: A filter takes (ward, grid, candidates), not candidates alone: B1 must RELOCATE a
#: candidate to the nearest free cell within ~1 cell radius, and B3 must thin n against
#: the grid rather than hard-zero it. Both need geometry derive_trees already holds, so
#: a list-only signature would force exactly the churn this seam exists to prevent.
#:
#: B2 (the parks density BOOST) cannot be a post-filter at ANY signature -- ADDING an
#: instance needs the cell identity (col,row,k) to key _hash01, which no longer exists
#: once candidates are a flat list. B2 must hook inside _generate().
FILTERS: tuple[Callable[[Ward, npt.NDArray[np.float32], list[_types.TreeInstanceJSON]],
                        list[_types.TreeInstanceJSON]], ...] = ()

SPECIES = ("neem", "neem", "gulmohar", "palm")   # deterministic broadleaf-dominant mix


def _generate(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """Redistributive jitter+density scatter (spec: model b, jitter 0.80, max 4).

    Per canopy cell: 0..DENSITY_MAX instances scaling with height against the FIXED
    DENSITY_REF_H reference, not the ward's own tallest cell -- a per-ward normaliser
    makes a given density mean a different thing in each ward, which corrupts the
    cross-ward comparison (thin canopy still -> honest gaps). The min() is load-bearing,
    not defensive: cells taller than the reference exist (barrackpore tops 25 m) and
    would otherwise break the count <= DENSITY_MAX invariant. int(v+0.5) not round():
    half-up matches the JS Math.round the parameters were visually tuned against.
    """
    n = grid_north_up.shape[0]
    cell_m = ward.footprint_m / n
    half = ward.footprint_m / 2.0
    trees: list[_types.TreeInstanceJSON] = []
    for row in range(n):
        for col in range(n):
            h = float(grid_north_up[row, col])
            if h < MIN_TREE_H:
                continue
            count = min(DENSITY_MAX, int(DENSITY_MAX * h / DENSITY_REF_H + 0.5))
            for k in range(count):
                jx = (_hash01(col, row, k, 0) - 0.5) * JITTER * cell_m
                jy = (_hash01(col, row, k, 1) - 0.5) * JITTER * cell_m
                # cell centre -> ward-local metres; row 0 = north so +y decreases with row
                x = round((col + 0.5) * cell_m - half + jx, 2)
                y = round(half - (row + 0.5) * cell_m + jy, 2)
                r = round(h * 0.35 * (0.9 + 0.2 * _hash01(col, row, k, 2)), 2)
                sp = SPECIES[int(_hash01(col, row, k, 3) * len(SPECIES))]
                trees.append({"x": x, "y": y, "h": round(h, 1), "species": sp, "r": r})
    return trees


def derive_trees(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """Tree instances for the render layer, in ward-local metres (+x east, +y north).

    Candidates from _generate(), then the Phase-B FILTERS (none in Phase A).
    """
    candidates = _generate(ward, grid_north_up)
    for f in FILTERS:
        candidates = f(ward, grid_north_up, candidates)
    return candidates


def serialise(doc: dict[str, Any]) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


def build_ward(ward: Ward) -> None:
    grid = read_chm_grid(ward, GRID)
    if grid is None:
        raise SystemExit(f"CHM read failed for {ward.id}")
    write_canopy_png(ward.id, grid)
    trees = derive_trees(ward, grid)
    doc: _types.TreesFileJSON = {
        "ward": ward.id, "grid": GRID, "sizeM": float(ward.footprint_m),
        "retrieved": RETRIEVED, "trees": trees,
    }
    with open(os.path.join(DATA, f"{ward.id}-trees.json"), "w", encoding="utf-8") as fh:
        fh.write(serialise(cast("dict[str, Any]", doc)))
    print(f"{ward.id}: {len(trees)} trees, canopy grid {GRID}x{GRID}")


def check() -> None:
    """Re-read committed artefacts and assert invariants (fetch-terrain tripwire idiom).

    No network: only wards whose artefacts already exist on disk are checked, so
    this passes in an environment with no CHM access as long as nothing
    committed is malformed.
    """
    for wid in WARDS:
        tp = os.path.join(DATA, f"{wid}-trees.json")
        pp = os.path.join(DATA, f"{wid}-canopy.png")
        if not (os.path.exists(tp) and os.path.exists(pp)):
            continue  # only wards that have been built
        with open(tp, encoding="utf-8") as fh:
            doc = cast(_types.TreesFileJSON, json.load(fh))
        assert doc["ward"] == wid, f"{wid}: ward mismatch"
        assert doc["grid"] == GRID, f"{wid}: grid must be {GRID}"
        for t in doc["trees"]:
            assert MIN_TREE_H - 0.05 <= t["h"] <= CANOPY_HI + 5, f"{wid}: tree height out of range {t['h']}"
            assert abs(t["x"]) <= doc["sizeM"] / 2 + 1 and abs(t["y"]) <= doc["sizeM"] / 2 + 1, f"{wid}: tree outside ward"
            assert t["species"] in set(SPECIES), f"{wid}: bad species {t['species']}"
        # v2 tripwires. Count FIRST: an empty ward also makes `off_lattice > 0/2` false,
        # so the lattice assert would fire first and misreport it as graph paper.
        assert 0 < len(doc["trees"]) <= 30_000, f"{wid}: implausible tree count {len(doc['trees'])}"
        # The lattice must be dead. Distance to the NEARER lattice line, because
        # `v % cell_m` alone is one-sided -- a tree 4 cm PAST a centre reads as 9.96 and
        # counts as off-lattice, so a collapse to +-7.5 cm jitter would pass unnoticed.
        cell_m = doc["sizeM"] / doc["grid"]
        off_lattice = 0
        for t in doc["trees"]:
            d = (t["x"] + doc["sizeM"] / 2 - cell_m / 2) % cell_m
            if min(d, cell_m - d) > 0.05:
                off_lattice += 1
        assert off_lattice > len(doc["trees"]) / 2, f"{wid}: trees still sit on the cell-centre lattice"
    print("canopy artefacts OK")


def _self_test() -> None:
    """Pure-logic invariants, offline (no artifacts, no network).

    Run: python3 scripts/fetch-canopy.py --self-test
    """
    # hash01: deterministic, in [0,1), sensitive to every key component
    a = _hash01(3, 7, 0, 0)
    # golden value: the hash IS the artifact contract -- if this moves, every tree moves
    assert a == 0.8508871035309332, "hash changed -- every tree in trees.json moves"
    assert a == _hash01(3, 7, 0, 0), "hash must be deterministic"
    assert 0.0 <= a < 1.0, "hash must be in [0,1)"
    keys = {(3, 7, 0, 0), (4, 7, 0, 0), (3, 8, 0, 0), (3, 7, 1, 0), (3, 7, 0, 1)}
    vals = {_hash01(*k) for k in keys}
    assert len(vals) == len(keys), "hash must differ across col/row/k/axis"
    # spread sanity: 1000 draws roughly uniform (no catastrophic clustering)
    draws = [_hash01(i, i * 31 + 1, 0, 0) for i in range(1000)]
    mean = sum(draws) / len(draws)
    assert 0.45 < mean < 0.55, f"hash draws should average ~0.5, got {mean:.3f}"
    # placement invariants on a synthetic ward-sized grid
    ward = WARDS["ballygunge"]
    n = GRID
    cell_m = ward.footprint_m / n
    grid = np.zeros((n, n), dtype=np.float32)
    grid[0, 0] = 30.0          # far over DENSITY_REF_H -> min() caps it at DENSITY_MAX
    grid[0, 1] = 2.0           # barely canopy -> 0 trees (the honest gap)
    grid[10, 10] = 15.0        # mid canopy -> 4*15/22 = 2.73 -> 3
    grid[20, 20] = 1.0         # below MIN_TREE_H -> skipped entirely
    grid[3, 40] = 25.0         # OFF-DIAGONAL: the only cell a row/col transposition moves.
                               # Also just over the 22 m reference, so it pins the cap at
                               # the boundary: 4*25/22 = 4.55 -> 5 uncapped, 4 capped.
    grid[30, 30] = 2.75        # exact tie: 4*2.75/22 = 0.5, where int(v+0.5)=1 but round(v)=0
    trees = derive_trees(ward, grid)
    assert trees == derive_trees(ward, grid), "derive_trees must be deterministic"
    def cell_of(t: _types.TreeInstanceJSON) -> tuple[int, int]:
        col = int((t["x"] + ward.footprint_m / 2) / cell_m)
        row = int((ward.footprint_m / 2 - t["y"]) / cell_m)
        return (min(col, n - 1), min(row, n - 1))
    by_cell: dict[tuple[int, int], int] = {}
    for t in trees:
        by_cell[cell_of(t)] = by_cell.get(cell_of(t), 0) + 1
    assert by_cell.get((0, 0)) == DENSITY_MAX, f"30 m cell must cap at {DENSITY_MAX}, got {by_cell.get((0, 0))}"
    assert (1, 0) not in by_cell, "h=2.0 cell must be a gap (redistributive count 0)"
    assert (20, 20) not in by_cell, "below MIN_TREE_H must stay empty"
    assert by_cell.get((10, 10)) == 3, "15 m against the 22 m reference at DENSITY_MAX=4 -> 3 trees"
    assert by_cell.get((40, 3)) == DENSITY_MAX, \
        "25 m tops the 22 m reference, so min() must cap it at 4 -- at (col=40,row=3), not its transpose"
    assert by_cell.get((30, 30)) == 1, "count rounds HALF-UP: int(0.5+0.5)=1, but round(0.5)=0"
    # jitter bounds: every instance stays within +-JITTER/2 of its cell centre
    half = ward.footprint_m / 2.0
    for t in trees:
        col, row = cell_of(t)
        cx = (col + 0.5) * cell_m - half
        cy = half - (row + 0.5) * cell_m
        assert abs(t["x"] - cx) <= JITTER * cell_m / 2 + 0.011, f"x jitter out of bounds at {t}"
        assert abs(t["y"] - cy) <= JITTER * cell_m / 2 + 0.011, f"y jitter out of bounds at {t}"
    # the lattice is dead: every drawn quantity must actually vary within one cell
    cell00 = [t for t in trees if cell_of(t) == (0, 0)]
    assert len({t["x"] for t in cell00}) > 1, "instances within a cell must not stack on one point"
    assert len({t["y"] for t in cell00}) > 1, "y must be jittered too, not just x"
    assert len({t["r"] for t in cell00}) > 1, "crown radius must vary per instance"
    # x and y must draw DIFFERENT hash axes: equal offsets would lay every cell's
    # instances along a 45-degree diagonal, which is the artifact this feature kills
    cx0, cy0 = 0.5 * cell_m - half, half - 0.5 * cell_m
    assert any(abs((t["x"] - cx0) - (t["y"] - cy0)) > 0.01 for t in cell00), \
        "x and y jitter must not share one hash axis"
    # one golden instance. Position IS the artifact contract (same reason as the golden
    # hash above), and only an asymmetric cell catches a (col,row) argument swap --
    # counts and bounds survive one, because both hashes are equally valid draws.
    gold = [t for t in trees if cell_of(t) == (40, 3)][0]
    assert (gold["x"], gold["y"]) == (-293.04, 661.5), f"golden placement moved: {gold}"
    # SPECIES is a CROSS-LANGUAGE contract. vegetation-layer.ts:3 declares
    # `type Species = 'neem' | 'gulmohar' | 'palm'`, and asTreesFile returns null on
    # anything else -- one unknown species rejects the WHOLE file, so the layer
    # silently vanishes rather than losing a tree. check() deliberately validates
    # artifacts against set(SPECIES), which leaves this the only site pinning the TS.
    assert set(SPECIES) == {"neem", "gulmohar", "palm"}, \
        "SPECIES changed -- update Species and asTreesFile in vegetation-layer.ts first"
    # species valid, and genuinely mixed rather than always SPECIES[0]
    assert all(t["species"] in set(SPECIES) for t in trees)
    assert len({t["species"] for t in trees}) > 1, "the species draw must vary per instance"
    # radius jitter stays within +-10% of h*0.35
    for t in trees:
        assert 0.9 * t["h"] * 0.35 - 0.01 <= t["r"] <= 1.1 * t["h"] * 0.35 + 0.01, f"radius out of band at {t}"
    # A low-canopy ward is no longer a special case: with a FIXED reference the counts do
    # not rescale, so a 4 m cell is 1 tree here exactly as it would be beside a 30 m one.
    #
    # And note MIN_TREE_H is now SEMANTIC ONLY, untestable by construction: count > 0
    # needs 4*h/22 >= 0.5, i.e. h >= 2.75 m, which is strictly ABOVE MIN_TREE_H = 2.0.
    # The density formula is uniformly the tighter of the two, so deleting the gate could
    # not change a single tree. It stays as the declaration of what counts as "canopy"
    # (and as the real guard if DENSITY_MAX or DENSITY_REF_H is ever retuned), not as
    # observable behaviour -- so there is nothing here to assert about it. Under the old
    # ward-relative divisor it WAS observable, which is what this probe used to test.
    low = np.zeros((n, n), dtype=np.float32)
    low[5, 5] = 4.0            # 4*4/22 = 0.73 -> 1 tree; being the ward max buys it nothing
    low[6, 6] = 1.5            # scrub: under MIN_TREE_H and under the 2.75 m density floor
    assert len(derive_trees(ward, low)) == 1, "a fixed reference must not rescale a low-canopy ward"
    # also the standing proof that dropping the old `if h_max < MIN_TREE_H` guard was
    # safe: with no division by data there is no zero to divide by, and an all-zero grid
    # still empties out because every cell simply fails the per-cell MIN_TREE_H test.
    assert derive_trees(ward, np.zeros((n, n), dtype=np.float32)) == [], "a bare grid must yield no trees"
    # the seam itself: derive_trees must RUN the filters, hand them the geometry, and
    # return what they hand back. Deleting the `for f in FILTERS` loop must fail here.
    global FILTERS
    def _keep_one(w: Ward, g: npt.NDArray[np.float32],
                  ts: list[_types.TreeInstanceJSON]) -> list[_types.TreeInstanceJSON]:
        assert w is ward and g is grid, "a filter must receive the ward and the grid, not just the list"
        return ts[:1]

    def _drop_all(w: Ward, g: npt.NDArray[np.float32],
                  ts: list[_types.TreeInstanceJSON]) -> list[_types.TreeInstanceJSON]:
        return []
    try:
        FILTERS = (_keep_one,)
        assert derive_trees(ward, grid) == trees[:1], "derive_trees must return the filters' output"
        FILTERS = (_keep_one, _drop_all)
        assert derive_trees(ward, grid) == [], "filters must chain, in order"
    finally:
        FILTERS = ()
    assert not FILTERS, "the self-test must leave the Phase-A seam empty"
    print("  fetch-canopy self-test OK")


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--self-test":
        _self_test()
        return
    if args and args[0] == "--check":
        check()
        return
    targets = [WARDS[a] for a in args] if args else [WARDS["ballygunge"]]
    for ward in targets:
        build_ward(ward)


if __name__ == "__main__":
    main()
