"""Mirror and registration guards for a city after Bengaluru (Task A9).

    python3 scripts/check-city-frame.py --city amsterdam            # verify: committed data only, runs in CI
    taskpolicy -b python3 scripts/check-city-frame.py --city amsterdam --measure
                                                                    # local: also G5/G6 from the raw AHN rasters,
                                                                    # rewrites data/cities/<city>/frame-guard.json
    python3 scripts/check-city-frame.py --city amsterdam --fetch-landmarks
                                                                    # resolve guard G4's landmarks from Wikidata (P625)
    taskpolicy -b python3 scripts/check-city-frame.py --city amsterdam --measure --annotate-heights
                                                                    # write hCheck / flag into the buildings file

WHY EVERY GUARD COMPARES NORTH-UP AGAINST A MIRRORED COPY. A north-south mirror renders
perfectly: every building is closed, every height right, the count right, and the city is
reflected about its own centre line. It has happened on this project three times (Kolkata
footprints, Dubai terrain, Bengaluru's georeference), and each time every SYMMETRIC statistic
(counts, areas, heights, histograms) was unchanged. So each guard below pairs a statistic that
is asymmetric about y = 0 with independent evidence, and requires the north-up frame to match
that evidence while a deliberately mirrored copy (y -> -y about the centre) does not. A guard
that passes on both proves nothing, and the script says so.

TWO MODES, BECAUSE CI HAS NO RAW DATA. G5 (heights vs AHN nDSM) and G6 (terrain nodata mask)
need the 0.5 m AHN rasters, which live in the raw cache on OBOSLab and are never committed.
`--measure` computes them and records the result in frame-guard.json together with the sha256
of the committed files it measured. The default mode recomputes every guard that needs only
committed data (G1-G4, G7, G8) and, for G5/G6, requires that the recorded result still passes
AND still describes the committed files (hash match). A stale or failing record is a failure.

FRAME. x east / y NORTH, metres from the area centre (`_city.to_local`).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from collections.abc import Callable, Sequence
from typing import Any, Final, Literal, NamedTuple, TypedDict, cast

import numpy as np
import numpy.typing as npt
import shapely
from shapely.geometry import Polygon, box
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                                  # noqa: E402  (parity oracle for G1)
import _city                                              # noqa: E402
from _city import Area, CityBuilding, CityBuildingsFile, CityContextFile, CityTerrainFile   # noqa: E402

F32 = npt.NDArray[np.float32]
Status = Literal["pass", "fail", "recorded", "pending"]

USER_AGENT: Final = "obos-pipeline/1.0 (+https://deltaclimate.earth)"

# ── thresholds. Each was FIXED AFTER MEASURING (see frame-guard.json `measuredAt`); the plan's
# first-draft values are in the comments where they were tightened or loosened. ─────────────────
G1_MAX_DIFF_M: Final = 1e-9
G2_MAX_DIFF_M: Final = 0.05
G3_NORTH_MAX_SHARE: Final = 0.01
G3_MIRROR_MIN_RATIO: Final = 5.0
#: Tightened from 60 m (Amsterdam audit F8). Every landmark measures 0.0 m north-up (it sits INSIDE its footprint), so 15 m
#: is still loose against the data and leaves a margin of 15 m over a Wikidata coordinate that is only good to a few metres.
#: At 60 m a 180-degree rotation of the whole city (its Royal Palace measured 109.9 m from the nearest large footprint) was
#: the only case near the line; at 15 m every perturbation the audit built fails by 7x or more. G4 is the ONLY guard that
#: recomputes against an external absolute in CI when a mirror is applied to every layer at once (G3 and G7 are relative).
G4_NORTH_MAX_M: Final = 15.0
G4_MIRROR_MIN_M: Final = 100.0       # for EACH landmark; the plan's 200 m held for 3 of 4 (see G4_MIRROR_MEDIAN_M)
G4_MIRROR_MEDIAN_M: Final = 200.0    # ... and for the median of the four (measured 237 m)
# G5 IS A REGISTRATION TEST AND NEVER A HEIGHT ACCURACY (Amsterdam audit F7). It shows that the footprints are in the right
# place and the right way up: a mirrored copy samples different pixels (rho 0.981 north-up, 0.024 mirrored). It does not validate
# the heights: 17.5 % of the buildings take their height from AHN4, so for them it compares AHN4 with AHN4 gridded differently,
# and even AHN5 against AHN4 is one sensor programme and one p70 rule. NEVER QUOTE rho AS HEIGHT ACCURACY, in copy or in a
# brief. If a height claim is ever wanted, stratify rho by `b3_pw_bron`: the AHN5 subset is the quasi-independent epoch comparison.
G5_NORTH_MIN_RHO: Final = 0.8
G5_MIRROR_MAX_RHO: Final = 0.3
G5_MIN_PIXELS: Final = 8              # a footprint needs this many 1 m nDSM pixels to take part
G6_MIN_RATIO: Final = 2.0
G7_MIN_RATIO: Final = 2.0
DISAGREE_M: Final = float(_city.DISAGREE_M)


class Landmark(TypedDict):
    name: str
    qid: str
    lat: float
    lon: float
    minAreaM2: float
    url: str
    retrieved: str


class GuardRecord(TypedDict):
    id: str
    name: str
    evidence: str
    statistic: str
    rule: str
    status: Status
    north: float | None
    mirrored: float | None
    detail: dict[str, Any]


class FrameGuardFile(TypedDict):
    city: str
    area: str
    measuredAt: str
    inputs: dict[str, str]
    guards: list[GuardRecord]
    waterLevel: dict[str, Any]


#: Where the guards read and write when they are not run on the committed Canal Ring files. A SHEET build (scripts/_sheet_build.py)
#: points them at its own directories; None = the committed locations, so `--city amsterdam` behaves exactly as it always has.
DATA_DIR: str | None = None
PUBLIC_DIR: str | None = None
AHN_DIR: str | None = None


def data_root(area: Area) -> str:
    return DATA_DIR if DATA_DIR is not None else _city.data_dir(area.city)


def public_root() -> str:
    return PUBLIC_DIR if PUBLIC_DIR is not None else _city.PUBLIC


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def doc_path(area: Area, layer: str) -> str:
    return os.path.join(data_root(area), f"{area.id}-{layer}.json")


def load(area: Area, layer: str) -> Any:
    path = doc_path(area, layer)
    if not os.path.isfile(path):
        raise SystemExit(f"{path} is missing: run scripts/fetch-city.py --city {area.city} --layer {layer}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def ring_xy(p: list[float]) -> npt.NDArray[np.float64]:
    return np.asarray(p, dtype=np.float64).reshape(-1, 2)


def mirror_xy(a: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """y -> -y about the centre. The one deliberate mirror every guard compares against."""
    out = a.copy()
    out[:, 1] = -out[:, 1]
    return out


def polygons(b: list[CityBuilding], mirrored: bool) -> list[Polygon]:
    out: list[Polygon] = []
    for r in b:
        xy = ring_xy(r["p"])
        out.append(Polygon(mirror_xy(xy) if mirrored else xy).buffer(0))
    return out


def water_polys(ctx: CityContextFile, mirrored: bool) -> list[Polygon]:
    out: list[Polygon] = []
    for w in ctx["water"]:
        if "p" in w and w["p"]:
            xy = ring_xy(w["p"])
            out.append(Polygon(mirror_xy(xy) if mirrored else xy).buffer(0))
    return out


def record(gid: str, name: str, evidence: str, statistic: str, rule: str, status: Status,
           north: float | None, mirrored: float | None, **detail: Any) -> GuardRecord:
    return GuardRecord(id=gid, name=name, evidence=evidence, statistic=statistic, rule=rule,
                       status=status, north=north, mirrored=mirrored, detail=dict(detail))


# ── G1: the frame itself ───────────────────────────────────────────────────

def g1_frame_parity(area: Area) -> GuardRecord:
    # The oracle ward sits at the area's STANDARD PARALLEL, so its east scale is the area's (frame_lat); its north
    # scale is latitude-independent, and `shift` moves its origin back to the area's own centre latitude. With no
    # frame_lat the parallel IS the centre latitude, `shift` is exactly 0.0, and this is the oracle as it always was.
    fp = area.frame_parallel()
    bw = blr.Ward(area.id, area.name, blr.LatLon(fp, area.centre.lon), float(area.size_m))
    shift = (fp - area.centre.lat) * blr.m_per_deg(fp)[1]
    worst = 0.0
    dlon, dlat = 0.0125, 0.0125
    for i in range(-5, 6):
        for j in range(-5, 6):
            lon, lat = area.centre.lon + i * dlon / 5, area.centre.lat + j * dlat / 5
            ax, ay = _city.to_local(area, lon, lat)
            bx, by = blr.to_local(bw, lon, lat)
            worst = max(worst, abs(ax - bx), abs(ay - (by + shift)))
    # SIGN: a point 1 km north of the centre must have y ≈ +1000.
    _, y_north = _city.to_local(area, area.centre.lon, area.centre.lat + 1000.0 / 110_540.0)
    ok = worst < G1_MAX_DIFF_M and abs(y_north - 1000.0) < 1e-6
    return record("G1", "frame parity", "_bangalore.to_local (the proven frame)", "max abs diff over an 11 x 11 lattice, m",
                  f"< {G1_MAX_DIFF_M:g} m, and +y is NORTH", "pass" if ok else "fail", worst, None,
                  yOfPointKilometreNorth=round(y_north, 6))


# ── G2: each building's p agrees with its own lonlat ───────────────────────

def g2_ring_self_consistency(area: Area, b: list[CityBuilding]) -> GuardRecord:
    north = mirror = 0.0
    for r in b:
        ll = np.asarray(r["lonlat"], dtype=np.float64)
        loc = np.array([_city.to_local(area, lo, la) for lo, la in ll])
        p = ring_xy(r["p"])
        north = max(north, float(np.abs(loc - p).max()))
        mirror = max(mirror, float(np.abs(loc - mirror_xy(p)).max()))
    ok = north < G2_MAX_DIFF_M and mirror > 10 * G2_MAX_DIFF_M
    return record("G2", "ring self-consistency", "each building's own lonlat", "max abs diff p vs to_local(lonlat), m",
                  f"north-up < {G2_MAX_DIFF_M} m and the mirrored copy is far off", "pass" if ok else "fail",
                  north, mirror, buildings=len(b))


# ── G3: buildings vs Overture water ────────────────────────────────────────

def overlap_share(buildings: list[Polygon], water: list[Polygon]) -> float:
    """Share of the footprints' total area that lies on water. Only footprints that touch water are intersected
    (a spatial index first): intersecting all 21k against one big union is minutes, this is instant."""
    if not water:
        return 0.0
    union = shapely.union_all(water)
    barr = np.asarray(buildings, dtype=object)
    total = float(shapely.area(barr).sum())
    hit = np.unique(STRtree(water).query(barr, predicate="intersects")[0])
    over = float(shapely.area(shapely.intersection(barr[hit], union)).sum()) if hit.size else 0.0
    return over / total if total else 0.0


def g3_buildings_vs_water(area: Area, b: list[CityBuilding], ctx: CityContextFile) -> GuardRecord:
    n = overlap_share(polygons(b, False), water_polys(ctx, False))
    m = overlap_share(polygons(b, True), water_polys(ctx, False))
    ok = n <= G3_NORTH_MAX_SHARE and m >= G3_MIRROR_MIN_RATIO * max(n, 1e-6)
    return record("G3", "buildings vs water", "Overture water polygons (OSM canals; independent of BAG)",
                  "share of footprint area overlapping water",
                  f"north-up <= {G3_NORTH_MAX_SHARE:.0%} and mirrored >= {G3_MIRROR_MIN_RATIO:g}x north-up",
                  "pass" if ok else "fail", n, m, waterPolygons=len(water_polys(ctx, False)))


# ── G4: landmarks from Wikidata ────────────────────────────────────────────

#: (name, Wikidata id, minimum plausible footprint area in m2). The area is about 70 % of the BAG polygon that
#: contains the Wikidata point (measured 2026-11-06: 9,685 / 4,594 / 1,715 / 4,078 m2), rounded down. A looser
#: floor (the first draft used 1,000-2,500 m2) lets a mirrored point land beside SOME other large building in a
#: city this dense: Westerkerk's mirror was 38 m from one. The floor is what makes the mirrored test bite.
LANDMARK_QIDS: Final = (("Rijksmuseum", "Q190804", 6500.0), ("Royal Palace of Amsterdam", "Q1056152", 3200.0),
                        ("Westerkerk", "Q1130722", 1200.0), ("Concertgebouw", "Q849957", 2800.0))


def landmarks_path(area: Area) -> str:
    return os.path.join(_city.data_dir(area.city), "landmarks.json")


def fetch_landmarks(area: Area, today: str) -> None:
    """Resolve each landmark's WGS-84 point from Wikidata P625; record the QID, URL and date."""
    out: list[Landmark] = []
    for name, qid, min_area in LANDMARK_QIDS:
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "wbgetentities", "ids": qid, "props": "claims|labels", "format": "json"})
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            doc = json.load(resp)
        ent = doc["entities"][qid]
        label = ent["labels"].get("en", {}).get("value", "")
        val = ent["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
        lat, lon = float(val["latitude"]), float(val["longitude"])
        x, y = _city.to_local(area, lon, lat)
        half = area.size_m / 2.0
        print(f"  {qid} {label!r:32} P625 {lat:.5f}, {lon:.5f} -> local ({x:7.0f}, {y:7.0f})  inside={abs(x) <= half and abs(y) <= half}")
        if abs(x) > half or abs(y) > half:
            raise SystemExit(f"{name} lies outside the square: choose another landmark")
        out.append(Landmark(name=name, qid=qid, lat=lat, lon=lon, minAreaM2=min_area,
                            url=f"https://www.wikidata.org/wiki/{qid}", retrieved=today))
    with open(landmarks_path(area), "w", encoding="utf-8") as fh:
        json.dump({"source": "Wikidata P625 (coordinate location), CC0", "retrieved": today, "landmarks": out}, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {landmarks_path(area)}")


def nearest_large_m(polys: list[Polygon], areas: npt.NDArray[np.float64], x: float, y: float, min_area: float) -> float:
    big = [p for p, a in zip(polys, areas) if a >= min_area]
    tree = STRtree(big)
    i = tree.nearest(shapely.Point(x, y))
    return float(big[int(i)].distance(shapely.Point(x, y)))


def g4_landmarks(area: Area, b: list[CityBuilding]) -> GuardRecord:
    path = landmarks_path(area)
    if not os.path.isfile(path):
        raise SystemExit(f"{path} is missing: run --fetch-landmarks")
    with open(path, encoding="utf-8") as fh:
        lms = cast("list[Landmark]", json.load(fh)["landmarks"])
    polys = polygons(b, False)
    areas = shapely.area(np.asarray(polys, dtype=object))
    per: dict[str, dict[str, float]] = {}
    ok = True
    for lm in lms:
        x, y = _city.to_local(area, lm["lon"], lm["lat"])
        dn = nearest_large_m(polys, areas, x, y, lm["minAreaM2"])
        dm = nearest_large_m(polys, areas, x, -y, lm["minAreaM2"])
        per[lm["name"]] = {"northUpM": round(dn, 1), "mirroredM": round(dm, 1), "y": round(y, 1)}
        ok = ok and dn <= G4_NORTH_MAX_M and dm >= G4_MIRROR_MIN_M
    med = float(np.median([v["mirroredM"] for v in per.values()]))
    ok = ok and med >= G4_MIRROR_MEDIAN_M
    return record("G4", "landmarks", "Wikidata P625 for four landmarks (landmarks.json)",
                  "distance to the nearest footprint of plausible area, m",
                  f"north-up <= {G4_NORTH_MAX_M:g} m for EACH; mirrored >= {G4_MIRROR_MIN_M:g} m for each and a median >= {G4_MIRROR_MEDIAN_M:g} m",
                  "pass" if ok else "fail",
                  max(v["northUpM"] for v in per.values()), min(v["mirroredM"] for v in per.values()),
                  perLandmark=per, mirroredMedianM=round(med, 1), retrieved=min(lm["retrieved"] for lm in lms))


# ── G5 / G6: raw AHN rasters (local only) ──────────────────────────────────

class Grid(NamedTuple):
    """A north-up raster window in the source CRS."""
    transform: Any
    shape: tuple[int, int]


def ahn_raw() -> str:
    if AHN_DIR is not None:
        return AHN_DIR
    return os.path.join(os.path.expanduser("~"), ".cache", "delta-climate", "cities", "amsterdam", "raw", "ahn")


def read_downsampled(name: str, step: int) -> tuple[F32, Grid]:
    import rasterio
    with rasterio.open(os.path.join(ahn_raw(), name)) as src:
        h, w = src.height // step, src.width // step
        a = src.read(1, out_shape=(h, w)).astype(np.float32)        # nearest by default
        tr = src.transform * src.transform.scale(src.width / w, src.height / h)
    a[~np.isfinite(a)] = np.nan
    return a, Grid(tr, (h, w))


_TRANSFORMERS: dict[str, Any] = {}


def _transformer(area: Area) -> Any:
    """ONE pyproj transformer per area: building it costs ~15 ms and the guards project tens of thousands of rings."""
    if area.id not in _TRANSFORMERS:
        _TRANSFORMERS[area.id] = _city.transformer_to_local_crs(area)
    return _TRANSFORMERS[area.id]


def to_crs_xy(area: Area, xy_local: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """local metres -> source-CRS metres, through lon/lat (the frame IS degrees times a constant)."""
    mx, my = _city.frame_m_per_deg(area)
    lon = area.centre.lon + xy_local[:, 0] / mx
    lat = area.centre.lat + xy_local[:, 1] / my
    x, y = _transformer(area).transform(lon, lat)
    return np.column_stack([np.asarray(x), np.asarray(y)])


def crs_polygons(area: Area, polys: list[Polygon]) -> list[Polygon]:
    """Polygons (exteriors) from the local frame into the source CRS. ONE pyproj call for all the vertices: the guards project tens of
    thousands of rings several times (the controls), and a call per ring was minutes."""
    live = [p for p in polys if not p.is_empty]
    if not live:
        return []
    rings = [np.asarray(p.exterior.coords) for p in live]
    xy = to_crs_xy(area, np.concatenate(rings))
    cuts = np.cumsum([len(r) for r in rings])[:-1]
    return [Polygon(part) for part in np.split(xy, cuts)]


def burn(shapes: list[tuple[Polygon, int]], grid: Grid) -> npt.NDArray[np.int32]:
    """Rasterise (polygon, value) pairs onto the grid; 0 elsewhere."""
    from rasterio.features import rasterize
    from shapely.geometry import mapping
    return cast(npt.NDArray[np.int32], rasterize(
        [(mapping(g), v) for g, v in shapes if not g.is_empty], out_shape=grid.shape,
        transform=grid.transform, fill=0, dtype="int32"))


def rasterise_ids(geoms: list[Polygon], grid: Grid) -> npt.NDArray[np.int32]:
    return burn([(g, i + 1) for i, g in enumerate(geoms)], grid)


def fill_nearest(a: F32) -> F32:
    """Fill NaN with the nearest finite value (ground under a building = its surroundings)."""
    from scipy import ndimage
    bad = ~np.isfinite(a)
    if not bad.any():
        return a
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return cast(F32, a[tuple(idx)])


def p70_per_polygon(ids: npt.NDArray[np.int32], vals: F32, n: int, min_pixels: int = G5_MIN_PIXELS) -> npt.NDArray[np.float64]:
    out = np.full(n, np.nan)
    flat_ids, flat_v = ids.ravel(), vals.ravel()
    keep = (flat_ids > 0) & np.isfinite(flat_v)
    flat_ids, flat_v = flat_ids[keep], flat_v[keep]
    order = np.argsort(flat_ids, kind="stable")
    flat_ids, flat_v = flat_ids[order], flat_v[order]
    cuts = np.flatnonzero(np.diff(flat_ids)) + 1
    for grp_ids, grp in zip(np.split(flat_ids, cuts), np.split(flat_v, cuts)):
        if grp.size >= min_pixels:
            out[int(grp_ids[0]) - 1] = np.percentile(grp, 70)
    return out


def spearman(h: npt.NDArray[np.float64], n70: npt.NDArray[np.float64]) -> tuple[float, int]:
    from scipy.stats import spearmanr
    ok = np.isfinite(n70)
    return float(spearmanr(h[ok], n70[ok]).statistic), int(ok.sum())


_NDSM: dict[str, tuple[F32, Grid]] = {}


def ndsm_grid() -> tuple[F32, Grid]:
    """The AHN4 nDSM (DSM minus the nearest-filled DTM) at 1 m, read once per clip directory: the sheet rules rasterise several copies of
    the same buildings against it, and the fill (a distance transform of the whole square) is the cost."""
    key = ahn_raw()
    if key not in _NDSM:
        _NDSM.clear()
        dsm, grid = read_downsampled("dsm_05m_clip.tif", 2)
        dtm, _ = read_downsampled("dtm_05m_clip.tif", 2)
        _NDSM[key] = ((dsm - fill_nearest(dtm)).astype(np.float32), grid)
    return _NDSM[key]


def ndsm_p70(area: Area, b: list[CityBuilding], mirrored: bool) -> npt.NDArray[np.float64]:
    ndsm, grid = ndsm_grid()
    ids = rasterise_ids(crs_polygons(area, polygons(b, mirrored)), grid)
    return p70_per_polygon(ids, ndsm, len(b))


def g5_heights(area: Area, b: list[CityBuilding]) -> tuple[GuardRecord, npt.NDArray[np.float64]]:
    h = np.array([r["h"] for r in b], dtype=np.float64)
    n70 = ndsm_p70(area, b, False)
    m70 = ndsm_p70(area, b, True)
    rho_n, count_n = spearman(h, n70)
    rho_m, count_m = spearman(h, m70)
    dev = np.abs(h - n70)
    flagged = int(np.nansum(dev > DISAGREE_M))
    ok = rho_n >= G5_NORTH_MIN_RHO and rho_m <= G5_MIRROR_MAX_RHO
    return (record("G5", "heights vs AHN nDSM", "AHN4 dsm_05m - dtm_05m (ground under buildings filled from the nearest valid DTM), p70 inside each footprint",
                   "Spearman rho between 3D BAG h and nDSM p70",
                   f"north-up >= {G5_NORTH_MIN_RHO} and mirrored <= {G5_MIRROR_MAX_RHO}", "pass" if ok else "fail", rho_n, rho_m,
                   buildingsCompared=count_n, buildingsComparedMirrored=count_m,
                   flaggedOver=DISAGREE_M, flagged=flagged, medianAbsDevM=round(float(np.nanmedian(dev)), 2),
                   note="AHN4 (2020-22) vs AHN5-dominated 3D BAG heights: a one-to-three-year gap, so some disagreement is real change"),
            n70)


def g6_terrain(area: Area, b: list[CityBuilding], ctx: CityContextFile) -> GuardRecord:
    dtm, grid = read_downsampled("dtm_05m_clip.tif", 4)             # 2 m
    nodata = ~np.isfinite(dtm)
    half = area.size_m / 2.0
    square = crs_polygons(area, [box(-half, -half, half, half)])
    inside = burn([(square[0], 1)], grid).astype(bool)

    def jaccard(mirrored: bool) -> float:
        geoms = crs_polygons(area, polygons(b, mirrored) + water_polys(ctx, mirrored))
        vec = burn([(g, 1) for g in geoms], grid).astype(bool)
        a, c = nodata & inside, vec & inside
        return float((a & c).sum() / max(1, (a | c).sum()))

    n, m = jaccard(False), jaccard(True)
    ok = n >= G6_MIN_RATIO * m
    return record("G6", "terrain registration", "the AHN DTM nodata mask (no ground points under buildings or water)",
                  "Jaccard of the DTM nodata mask vs rasterised footprints + water at 2 m, inside the square",
                  f"north-up >= {G6_MIN_RATIO:g}x mirrored", "pass" if ok else "fail", n, m,
                  nodataShare=round(float(nodata[inside].mean()), 3))


def water_level_evidence(area: Area, ctx: CityContextFile) -> dict[str, Any]:
    """DTM beside the Overture water polygons: the water level seen from the ground model. Evidence, not a gate."""
    from scipy import ndimage
    dtm, grid = read_downsampled("dtm_05m_clip.tif", 2)             # 1 m
    geoms = crs_polygons(area, water_polys(ctx, False))
    wmask = rasterise_ids(geoms, grid) > 0
    bank = ndimage.binary_dilation(wmask, iterations=3) & ~wmask
    vals = dtm[bank & np.isfinite(dtm)]
    low = np.isfinite(dtm) & (dtm < -1.5)
    near = ndimage.binary_dilation(wmask, iterations=3)
    return {
        "bankDtmPixels": int(vals.size),
        "bankDtmMedianNapM": round(float(np.median(vals)), 2),
        "bankDtmP10NapM": round(float(np.percentile(vals, 10)), 2),
        "bankDtmP90NapM": round(float(np.percentile(vals, 90)), 2),
        "dtmBelowMinus1p5": int(low.sum()), "ofWhichWithin3mOfOvertureWater": int((low & near).sum()),
        "reference": "Amsterdam canals are held near NAP -0.40 m in summer (zomerpeil); that figure is NOT verified here, so this block records what the data say and gates nothing",
    }


# ── G7: the surface raster, through the browser's row order ────────────────

def read_surface(area: Area) -> npt.NDArray[np.float64]:
    from PIL import Image
    path = os.path.join(public_root(), f"{area.id}-surface.png")
    if not os.path.isfile(path):
        raise SystemExit(f"{path} is missing: run scripts/export-surface-rasters.py --ward {area.id}")
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return rgb[:, :, 0] / 255.0 * (1.0 - 0.0) + 0.0                 # R = vegetation fraction; VEG_RANGE is (0, 1)


def park_mask(area: Area, ctx: CityContextFile, n: int) -> npt.NDArray[np.bool_]:
    """North-up (row 0 = north) mask of cells whose centre is inside a park polygon."""
    parks = [Polygon(ring_xy(g["p"])).buffer(0) for g in ctx["green"] if g["cls"] == "park"]
    union = shapely.union_all(parks)
    cell = area.size_m / n
    cols = (np.arange(n) + 0.5) * cell - area.size_m / 2.0
    rows = area.size_m / 2.0 - (np.arange(n) + 0.5) * cell          # row 0 = NORTH: y decreases with the row index
    xx, yy = np.meshgrid(cols, rows)
    return cast(npt.NDArray[np.bool_], shapely.contains_xy(union, xx, yy))


def g7_surface(area: Area, ctx: CityContextFile) -> GuardRecord:
    veg = read_surface(area)
    mask = park_mask(area, ctx, veg.shape[0])

    def contrast(m: npt.NDArray[np.bool_]) -> float:
        return float(veg[m].mean() - veg[~m].mean())

    n, mir = contrast(mask), contrast(np.flipud(mask))
    ok = n > 0 and n >= G7_MIN_RATIO * max(mir, 1e-6)
    return record("G7", "surface raster", "Overture land_use park polygons (Vondelpark and others)",
                  "mean vegetation fraction inside parks minus outside, from the exported PNG (row 0 = north)",
                  f"north-up > 0 and >= {G7_MIN_RATIO:g}x mirrored", "pass" if ok else "fail", n, mir,
                  parkCells=int(mask.sum()), cells=int(mask.size))


# ── G8: export orientation ─────────────────────────────────────────────────

def g8_export(area: Area, terrain: CityTerrainFile) -> GuardRecord:
    path = os.path.join(public_root(), f"{area.id}-terrain.json")
    if not os.path.isfile(path):
        return record("G8", "export orientation", "the exported public terrain (row 0 = NORTH) vs the data file (row 0 = SOUTH)",
                      "exact equality after one flip", "equal; the unflipped compare must differ", "pending", None, None,
                      note="public terrain not exported yet (Task A10)")
    with open(path, encoding="utf-8") as fh:
        pub = json.load(fh)
    n = int(terrain["n"])
    datum = float(terrain["meanM"])
    # The exporter rounds with Python's round(); numpy's np.round differs at exact ties, so use the same function.
    rows = [[round(float(v) - datum, 2) for v in terrain["h"][r * n:(r + 1) * n]] for r in range(n)]
    expect = [v for row in reversed(rows) for v in row]            # ONE flip: row 0 SOUTH -> row 0 NORTH
    unflipped = [v for row in rows for v in row]
    flipped_equal = pub["h"] == expect
    unflipped_equal = pub["h"] == unflipped
    ok = flipped_equal and not unflipped_equal
    return record("G8", "export orientation", "data/…-terrain.json (row 0 = SOUTH) vs public/…-terrain.json (row 0 = NORTH)",
                  "exact equality after one flip", "equal; the unflipped compare must differ", "pass" if ok else "fail",
                  1.0 if flipped_equal else 0.0, 1.0 if unflipped_equal else 0.0,
                  flippedEqual=flipped_equal, unflippedEqual=unflipped_equal)


# ── the rules for SHEETS (P2b audit S1) ────────────────────────────────────
#
# G3, G5, G6 and G7 above were fitted to the dense Canal Ring. In a suburb, in the port or on new land they fail on base rates and stale
# reference data and not on misregistration (P2B-AUDIT, "Guards"). Each rule below is written so that the CANDIDATE (the sheet as built)
# must pass AND every control -- the same data mirrored, turned 180 degrees, turned 3 degrees, or shifted -- must FAIL THE SAME RULE.
# A guard that passes the controls too proves nothing, so a sheet passes only if the candidate does and the controls do not.

Xform = Callable[[npt.NDArray[np.float64]], npt.NDArray[np.float64]]
_TH = np.deg2rad(3.0)
_ROT3 = np.array([[np.cos(_TH), np.sin(_TH)], [-np.sin(_TH), np.cos(_TH)]])
IDENTITY: Final[Xform] = lambda a: a                                                    # noqa: E731
MIRROR: Final[Xform] = lambda a: a * np.array([1.0, -1.0])                              # noqa: E731
ROT180: Final[Xform] = lambda a: a * np.array([-1.0, -1.0])                             # noqa: E731
ROT3: Final[Xform] = lambda a: a @ _ROT3                                                # noqa: E731
SHIFT10E: Final[Xform] = lambda a: a + np.array([10.0, 0.0])                            # noqa: E731
SHIFT20E: Final[Xform] = lambda a: a + np.array([20.0, 0.0])                            # noqa: E731


def shift_xform(dx: float, dy: float) -> Xform:
    return lambda a: a + np.array([dx, dy])


def turn_xform(deg: float) -> Xform:
    """A turn of `deg` degrees about the centre (the sign convention of ROT3, which is turn_xform(3))."""
    t = np.deg2rad(deg)
    r = np.array([[np.cos(t), np.sin(t)], [-np.sin(t), np.cos(t)]])
    return lambda a: a @ r


G3V2_SHIFTS_M: Final = ((10.0, 0.0), (-10.0, 0.0), (0.0, 10.0), (0.0, -10.0), (20.0, 0.0), (-20.0, 0.0), (0.0, 20.0), (0.0, -20.0))
G3V2_MAX_SHARE: Final = 0.01
G3V2_SHIFT_MARGIN: Final = 0.95
G3V2_MIRROR_RATIO: Final = 1.5
G3V2_COINCIDENT_IOU: Final = 0.8
G3V2_MIN_WATER: Final = 3
G5V2_MIN_PRE_BUILDINGS: Final = 50
G5V2_MIN_RHO: Final = 0.8
G5V2_MIN_SHARE: Final = 0.6
G5V2_WITHIN_M: Final = 2.0
G6V2_MIN_KAPPA: Final = 0.5
#: THE FACTOR IS 2 AND MUST STAY 2. The tightest real sheet is H3 (north kappa 0.927 against a mirrored 0.323, ratio 2.87): its mirrored score is the
#: north-south symmetry of the IJmeer water lobe, not a misplacement (buildings-only mirrored kappa -0.009; Opus audit, CANAL-RING-FIX-AUDIT.md part B).
#: A factor of 3 would FAIL H3 (0.927 < 3 x 0.323 = 0.969); the old absolute ceiling (mirrored <= 0.2) failed H3 and H7 for the same reason.
#: Next tightest: H7 at 3.5, then 7+ for every other sheet.
G6V2_RATIO: Final = 2.0
#: The mirrored and 180-degree kappa are floored at this before the ratio, so a candidate is not failed for beating a control that is ~0.
G6V2_CONTROL_FLOOR: Final = 0.1
#: The candidate must be its OWN LOCAL OPTIMUM: strictly better than the same data shifted 10 or 20 m east or north (either sign) or turned 3 degrees
#: either way. This is what lets the guard see 10-20 m and 2-3 degree registration errors that the kappa LEVEL cannot (a 2 m mask of dense blocks keeps
#: kappa 0.6-0.7 under them), and what makes a shifted or turned copy handed in AS the sheet fail.
G6V2_TURNS_DEG: Final = (3.0, -3.0)
G7V2_MIN_WATER_SHARE: Final = 0.01
G7V2_MIN_R: Final = 0.2
G7V2_RATIO: Final = 1.5


def g6v2_ok(north: float, mirror: float, rot180: float, perturbed: Sequence[float]) -> bool:
    """G6's rule: kappa >= 0.5; at least 2x the larger of the mirrored and 180-degree kappa (floored at 0.1); and above every shifted and turned copy."""
    return (north >= G6V2_MIN_KAPPA and north >= G6V2_RATIO * max(mirror, rot180, G6V2_CONTROL_FLOOR)
            and all(north > p for p in perturbed))


def g3v2_ok(north: float, shifted: Sequence[float], mirrored: float) -> bool:
    """G3 rule on one candidate: the buildings' overlap with water is under 1 %, or is the OPTIMUM of the candidate's own +-10/20 m shifts
    (stale water that really lies under new land is flat there); and the candidate's own mirrored copy overlaps >= 1.5x more."""
    return (north <= G3V2_MAX_SHARE or north < G3V2_SHIFT_MARGIN * min(shifted)) and mirrored >= G3V2_MIRROR_RATIO * max(north, 1e-6)


def g5v2_ok(rho_pre: float, share_within: float) -> bool:
    """G5 rule on one candidate: rank correlation of 3D BAG height with the AHN4 nDSM over buildings that stood BEFORE the AHN4 survey, and the
    share of all compared buildings within 2 m of it."""
    return rho_pre >= G5V2_MIN_RHO and share_within >= G5V2_MIN_SHARE


def kappa(a: npt.NDArray[np.bool_], c: npt.NDArray[np.bool_], inside: npt.NDArray[np.bool_]) -> float:
    """Cohen's kappa between two masks inside a region: agreement beyond what their base rates alone give (a high nodata share inflates Jaccard)."""
    pa, pc = float(a[inside].mean()), float(c[inside].mean())
    po = float((a == c)[inside].mean())
    pe = pa * pc + (1 - pa) * (1 - pc)
    return (po - pe) / (1 - pe) if pe < 1.0 else 0.0


def g7v2_ok(north: float, mirrored: float, rot180: float) -> bool:
    """G7 rule on one candidate: correlation of the Overture water mask with -albedo is >= 0.2 and >= 1.5x that of its mirrored and turned copies."""
    return north >= G7V2_MIN_R and north >= G7V2_RATIO * max(mirrored, rot180)


def _polys(rows: list[CityBuilding], fn: Xform) -> list[Polygon]:
    return [Polygon(fn(ring_xy(r["p"]))).buffer(0) for r in rows]


def _transformed_rows(rows: list[CityBuilding], fn: Xform) -> list[CityBuilding]:
    return [cast(CityBuilding, {**r, "p": fn(ring_xy(r["p"])).ravel().tolist()}) for r in rows]


def _water_polys_v2(ctx: CityContextFile, rows: list[CityBuilding]) -> list[Polygon]:
    """Overture water polygons without the ones that ARE a building (a covered tank or a houseboat shell drawn as water: IoU > 0.8 with a footprint)."""
    wat = water_polys(ctx, False)
    if not wat or not rows:
        return wat
    foot = _polys(rows, IDENTITY)
    tree = STRtree(foot)
    keep: list[Polygon] = []
    for w in wat:
        if w.is_empty or w.area <= 0:
            continue
        coincident = False
        for k in tree.query(w, predicate="intersects"):
            inter = w.intersection(foot[int(k)]).area
            if inter / (w.area + foot[int(k)].area - inter) > G3V2_COINCIDENT_IOU:
                coincident = True
                break
        if not coincident:
            keep.append(w)
    return keep


def g3_v2(area: Area, rows: list[CityBuilding], ctx: CityContextFile) -> GuardRecord:
    """On a 1 m raster in the LOCAL frame (the controls are local transforms; a shift of 10 or 20 m is 10 or 20 whole pixels), which is also two
    orders of magnitude cheaper than 40 polygon intersections against a city-sized water union."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from shapely.geometry import mapping
    wat = _water_polys_v2(ctx, rows)
    dropped = len(water_polys(ctx, False)) - len(wat)
    if len(wat) < G3V2_MIN_WATER:
        return record("G3", "buildings vs water (v2 rule)", "-", "-", "-", "pending", None, None, note=f"{len(wat)} water polygons: no evidence")
    pad = 40
    n = int(area.size_m) + 2 * pad
    tf = from_origin(-area.size_m / 2.0 - pad, area.size_m / 2.0 + pad, 1.0, 1.0)
    wmask = rasterize([(mapping(w), 1) for w in wat], out_shape=(n, n), transform=tf, fill=0, dtype="uint8").astype(bool)

    def bmask(fn: Xform) -> npt.NDArray[np.bool_]:
        return rasterize([(mapping(p), 1) for p in _polys(rows, fn) if not p.is_empty], out_shape=(n, n), transform=tf, fill=0, dtype="uint8").astype(bool)

    def share(b: npt.NDArray[np.bool_]) -> float:
        return float((b & wmask).sum() / max(1, b.sum()))

    def stats(fn: Xform) -> tuple[float, float, float, bool]:
        b = bmask(fn)
        s0 = share(b)
        ss = [share(np.roll(np.roll(b, int(-dy), axis=0), int(dx), axis=1)) for dx, dy in G3V2_SHIFTS_M]       # +x east = +col, +y north = -row
        mir = share(bmask(lambda a: MIRROR(fn(a))))
        return s0, min(ss), mir, g3v2_ok(s0, ss, mir)

    n0, nmin, nmir, nok = stats(IDENTITY)
    controls = {name: stats(fn) for name, fn in (("mirror", MIRROR), ("rot180", ROT180), ("rot3deg", ROT3))}
    # GATING controls: mirror and rot180 (a 3-degree turn keeps most buildings off the water, so it passes the 1 % branch: recorded, not gated)
    ok = nok and not controls["mirror"][3] and not controls["rot180"][3]
    return record("G3", "buildings vs water (v2 rule)", "Overture water polygons without footprint-coincident ones (OSM; independent of BAG)",
                  "share of footprint area on water at 1 m; north-up, its +-10/20 m shifts and its mirrored copy",
                  f"north <= {G3V2_MAX_SHARE:.0%} or below 0.95x every shift, and mirrored >= {G3V2_MIRROR_RATIO}x; the mirrored and 180-degree candidates must FAIL the same rule (rot3deg is recorded)",
                  "pass" if ok else "fail", n0, nmir, minShift=round(nmin, 4), candidatePasses=nok, waterPolygons=len(wat), footprintCoincidentDropped=dropped,
                  controls={k: {"share": round(v[0], 4), "minShift": round(v[1], 4), "itsMirror": round(v[2], 4), "passesRule": v[3]} for k, v in controls.items()})


def g5_v2(area: Area, rows: list[CityBuilding], years: dict[str, int | None]) -> tuple[GuardRecord, npt.NDArray[np.float64]]:
    h = np.array([r["h"] for r in rows], dtype=np.float64)
    yr = np.array([(years.get(r["src_id"].split("#")[0]) or 9999) for r in rows])
    pre = yr < 2020

    def stats(fn: Xform) -> tuple[float, float, int, npt.NDArray[np.float64]]:
        n70 = ndsm_p70(area, rows if fn is IDENTITY else _transformed_rows(rows, fn), False)
        ok = np.isfinite(n70)
        sel = ok & pre
        rho = float(spearman(h[sel], n70[sel])[0]) if int(sel.sum()) >= G5V2_MIN_PRE_BUILDINGS else float("nan")
        share = float((np.abs(h - n70)[ok] < G5V2_WITHIN_M).mean()) if ok.any() else 0.0
        return rho, share, int(sel.sum()), n70

    rho, share, n_pre, n70 = stats(IDENTITY)
    if n_pre < G5V2_MIN_PRE_BUILDINGS:
        return (record("G5", "heights vs AHN nDSM (v2 rule)", "-", "-", "-", "pending", None, None,
                       note=f"{n_pre} buildings from before the AHN4 survey: under {G5V2_MIN_PRE_BUILDINGS}, no evidence"), n70)
    controls = {name: stats(fn)[:3] for name, fn in (("mirror", MIRROR), ("rot180", ROT180), ("shift10E", SHIFT10E))}
    cok = {k: (not np.isnan(v[0]) and g5v2_ok(v[0], v[1])) for k, v in controls.items()}
    ok = g5v2_ok(rho, share) and not any(cok.values())
    dev = np.abs(h - n70)
    return (record("G5", "heights vs AHN nDSM (v2 rule)",
                   "AHN4 dsm_05m - dtm_05m (ground under buildings filled from the nearest valid DTM), p70 inside each footprint",
                   "Spearman rho over buildings that stood before the AHN4 survey, and the share of all compared buildings within 2 m",
                   f"rho >= {G5V2_MIN_RHO} and share within {G5V2_WITHIN_M:g} m >= {G5V2_MIN_SHARE}; mirror, rot180 and a 10 m shift must FAIL the same rule",
                   "pass" if ok else "fail", rho, controls["mirror"][0], shareWithin2m=round(share, 3), buildingsPreAhn4=n_pre,
                   flaggedOver=DISAGREE_M, flagged=int(np.nansum(dev > DISAGREE_M)), medianAbsDevM=round(float(np.nanmedian(dev)), 2),
                   controls={k: {"rhoPre": None if np.isnan(v[0]) else round(v[0], 3), "shareWithin2m": round(v[1], 3), "passesRule": cok[k]}
                             for k, v in controls.items()},
                   note="AHN4 (2020-22) vs AHN5-dominated 3D BAG heights: buildings from 2020 on are not in the correlation (the nDSM cannot see them)"), n70)


def g6_v2(area: Area, rows: list[CityBuilding], ctx: CityContextFile) -> GuardRecord:
    dtm, grid = read_downsampled("dtm_05m_clip.tif", 4)             # 2 m
    nodata = ~np.isfinite(dtm)
    half = area.size_m / 2.0
    inside = burn([(crs_polygons(area, [box(-half, -half, half, half)])[0], 1)], grid).astype(bool)
    wat = [w for w in ctx["water"] if w.get("p")]

    def k(fn: Xform) -> float:
        geoms = crs_polygons(area, _polys(rows, fn) + [Polygon(fn(ring_xy(w["p"]))).buffer(0) for w in wat])
        vec = burn([(g, 1) for g in geoms], grid).astype(bool)
        return kappa(nodata, vec, inside)

    north = k(IDENTITY)
    mirror, rot180 = k(MIRROR), k(ROT180)
    perturbed = {f"turn{deg:+g}deg": k(turn_xform(deg)) for deg in G6V2_TURNS_DEG}
    perturbed |= {f"shift{dx:+g}E{dy:+g}N": k(shift_xform(dx, dy)) for dx, dy in G3V2_SHIFTS_M}
    best = max(perturbed.values())
    ok = g6v2_ok(north, mirror, rot180, list(perturbed.values()))
    return record("G6", "terrain registration (v2 rule)", "the AHN DTM nodata mask (no ground points under buildings or water)",
                  "Cohen's kappa of the DTM nodata mask vs rasterised footprints + water at 2 m, inside the square",
                  f"kappa >= {G6V2_MIN_KAPPA}; >= {G6V2_RATIO:g}x the larger of the mirrored and 180-degree kappa (floored at {G6V2_CONTROL_FLOOR}); "
                  "and above every copy shifted 10/20 m east or north (either sign) or turned 3 degrees either way (gated)",
                  "pass" if ok else "fail", north, mirror, nodataShare=round(float(nodata[inside].mean()), 3),
                  ratio=round(north / max(mirror, rot180, G6V2_CONTROL_FLOOR), 3), optimumMargin=round(north - best, 3),
                  controls={"mirror": round(mirror, 3), "rot180": round(rot180, 3), **{k_: round(v, 3) for k_, v in perturbed.items()}})


def g7_v2(area: Area, ctx: CityContextFile) -> GuardRecord:
    from PIL import Image
    path = os.path.join(public_root(), f"{area.id}-surface.png")
    if not os.path.isfile(path):
        raise SystemExit(f"{path} is missing: build the surface first")
    alb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)[:, :, 1] / 255.0 * 0.5
    n = alb.shape[0]
    wat = [Polygon(ring_xy(w["p"])).buffer(0) for w in ctx["water"] if w.get("p")]
    xs = (np.arange(n) + 0.5) * area.size_m / n - area.size_m / 2.0
    X, Y = np.meshgrid(xs, -xs)                                       # row 0 = NORTH
    m: npt.NDArray[Any] = np.asarray(shapely.contains_xy(shapely.union_all(wat), X, Y), dtype=np.float64) if wat else np.zeros((n, n))
    if float(m.mean()) < G7V2_MIN_WATER_SHARE:
        return record("G7", "surface raster (v2 rule)", "-", "-", "-", "pending", None, None,
                      note=f"water covers {m.mean():.1%} of the sheet: under {G7V2_MIN_WATER_SHARE:.0%}, nothing to correlate albedo with")

    def r(mm: npt.NDArray[Any]) -> float:
        return float(np.corrcoef(mm.ravel(), -alb.ravel())[0, 1])

    def ok_of(mm: npt.NDArray[Any]) -> tuple[float, float, float, bool]:
        a, b, c = r(mm), r(np.flipud(mm)), r(np.rot90(mm, 2))
        return a, b, c, g7v2_ok(a, b, c)

    a, b, c, nok = ok_of(m)
    controls = {"mirror": ok_of(np.flipud(m)), "rot180": ok_of(np.rot90(m, 2))}
    ok = nok and not any(v[3] for v in controls.values())
    return record("G7", "surface raster (v2 rule)", "Overture water polygons (OSM; independent of Sentinel-2)",
                  "correlation of the water mask with -albedo from the exported PNG (row 0 = north); north-up, mirrored, turned 180 degrees",
                  f"north >= {G7V2_MIN_R} and >= {G7V2_RATIO}x both copies; the mirrored and turned candidates must FAIL the same rule",
                  "pass" if ok else "fail", a, max(b, c), waterShare=round(float(m.mean()), 3), candidatePasses=nok,
                  controls={k: {"r": round(v[0], 3), "itsMirror": round(v[1], 3), "itsRot180": round(v[2], 3), "passesRule": v[3]} for k, v in controls.items()})


# ── driver ─────────────────────────────────────────────────────────────────

INPUT_LAYERS: Final = ("buildings", "terrain", "context")


def input_hashes(area: Area) -> dict[str, str]:
    return {f"{area.id}-{layer}.json": sha256_of(doc_path(area, layer)) for layer in INPUT_LAYERS}


def frame_guard_path(area: Area) -> str:
    """Canal Ring's record stays where it is; a sheet's lives beside its own artefacts, `<id>/frame-guard.json` (PLAN 6.1)."""
    if area.box is not None and area.id != "canal-ring":
        return os.path.join(data_root(area), area.id, "frame-guard.json")
    return os.path.join(data_root(area), "frame-guard.json")


def run_committed_guards(area: Area) -> list[GuardRecord]:
    b = cast(CityBuildingsFile, load(area, "buildings"))["b"]
    ctx = cast(CityContextFile, load(area, "context"))
    terrain = cast(CityTerrainFile, load(area, "terrain"))
    return [g1_frame_parity(area), g2_ring_self_consistency(area, b), g3_buildings_vs_water(area, b, ctx),
            g4_landmarks(area, b), g7_surface(area, ctx), g8_export(area, terrain)]


def annotate_heights(area: Area, n70: npt.NDArray[np.float64]) -> None:
    """hCheck = the nDSM p70, flag = |h - hCheck| > DISAGREE_M. NEVER blended into h."""
    path = doc_path(area, "buildings")
    doc = cast(CityBuildingsFile, load(area, "buildings"))
    flagged = 0
    for r, v in zip(doc["b"], n70):
        if np.isfinite(v):
            r["hCheck"] = round(float(v), 2)
            r["flag"] = abs(r["h"] - float(v)) > DISAGREE_M
            flagged += int(r["flag"])
        else:
            r["hCheck"], r["flag"] = None, False
    doc["crossCheck"] = (f"AHN4 nDSM p70 (guard G5): hCheck on {int(np.isfinite(n70).sum())} of {len(n70)} buildings, "
                         f"{flagged} flagged where |h - hCheck| > {DISAGREE_M:g} m; hCheck is never blended into h")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    print(f"annotated {len(n70)} buildings; flagged {flagged}")


def print_guard(g: GuardRecord) -> None:
    n = "—" if g["north"] is None else f"{g['north']:.4g}"
    m = "—" if g["mirrored"] is None else f"{g['mirrored']:.4g}"
    print(f"  {g['id']} {g['name']:<24} north-up {n:>10}   mirrored {m:>10}   {g['status'].upper()}   [{g['rule']}]")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", required=True, choices=["amsterdam"])
    ap.add_argument("--measure", action="store_true", help="also run G5/G6 from the raw AHN rasters and rewrite frame-guard.json")
    ap.add_argument("--annotate-heights", action="store_true", help="with --measure: write hCheck/flag into the buildings file")
    ap.add_argument("--fetch-landmarks", action="store_true", help="resolve G4's landmarks from Wikidata and write landmarks.json")
    args = ap.parse_args(argv)
    area = next(a for a in _city.AREAS.values() if a.city == args.city)

    if args.fetch_landmarks:
        import datetime
        fetch_landmarks(area, datetime.date.today().isoformat())
        return 0

    guards = run_committed_guards(area)
    water_level: dict[str, Any] = {}
    existing: FrameGuardFile | None = None
    if os.path.isfile(frame_guard_path(area)):
        with open(frame_guard_path(area), encoding="utf-8") as fh:
            existing = cast(FrameGuardFile, json.load(fh))

    if args.measure:
        b = cast(CityBuildingsFile, load(area, "buildings"))["b"]
        ctx = cast(CityContextFile, load(area, "context"))
        g5, n70 = g5_heights(area, b)
        guards.insert(4, g5)
        guards.insert(5, g6_terrain(area, b, ctx))
        water_level = water_level_evidence(area, ctx)
        if args.annotate_heights:
            annotate_heights(area, n70)
        import datetime
        out = FrameGuardFile(city=area.city, area=area.id, measuredAt=datetime.date.today().isoformat(),
                             inputs=input_hashes(area), guards=guards, waterLevel=water_level)
        with open(frame_guard_path(area), "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {frame_guard_path(area)}")
    else:
        if existing is None:
            raise SystemExit("frame-guard.json is missing: run with --measure once on a machine with the raw AHN cache")
        # G5 and G6 cannot be recomputed without the raw cache. Require the RECORDED result to pass
        # and to describe the files that are committed now.
        if existing["inputs"] != input_hashes(area) and not args.annotate_heights:
            stale = sorted(k for k, v in input_hashes(area).items() if existing["inputs"].get(k) != v)
            raise SystemExit(f"frame-guard.json is stale: {stale} changed since it was measured (re-run --measure)")
        recorded = [g for g in existing["guards"] if g["id"] in ("G5", "G6")]
        if {g["id"] for g in recorded} != {"G5", "G6"}:
            raise SystemExit("frame-guard.json has no G5/G6 record")
        guards[4:4] = recorded

    print(f"frame guards for {area.city}/{area.id}:")
    for g in guards:
        print_guard(g)
    failed = [g for g in guards if g["status"] == "fail"]
    if failed:
        print("\nFAIL: " + ", ".join(g["id"] for g in failed) + ". A mirrored or mis-registered frame looks exactly like this.")
        return 1
    pending = [g["id"] for g in guards if g["status"] == "pending"]
    print("\nok" + (f" ({', '.join(pending)} pending)" if pending else ": north-up matches the independent evidence and the mirrored copy does not"))
    return 0


def _self_test() -> None:
    """Offline unit checks of the helpers: orientation, p70 grouping, mirror."""
    xy = ring_xy([0.0, 1.0, 2.0, 3.0, 4.0, 5.0])
    assert mirror_xy(xy)[:, 1].tolist() == [-1.0, -3.0, -5.0] and xy[:, 1].tolist() == [1.0, 3.0, 5.0]
    ids = np.zeros((4, 4), dtype=np.int32)
    ids[:2, :] = 1
    ids[2:, :2] = 2
    vals = np.arange(16, dtype=np.float32).reshape(4, 4)
    got = p70_per_polygon(ids, vals, 2, min_pixels=1)
    assert abs(got[0] - np.percentile(vals[:2, :], 70)) < 1e-9 and abs(got[1] - np.percentile(vals[2:, :2], 70)) < 1e-9
    assert overlap_share([box(0, 0, 2, 2)], [box(1, 0, 3, 2)]) == 0.5 and overlap_share([box(0, 0, 1, 1)], []) == 0.0
    # G4's north-up tolerance must stay tight enough to fail a 180-degree rotation (109.9 m measured for the Royal Palace)
    # and must stay far below the mirrored side, or the guard stops discriminating.
    assert G4_NORTH_MAX_M == 15.0 and G4_NORTH_MAX_M < 109.9 / 5 and G4_NORTH_MAX_M * 5 < G4_MIRROR_MIN_M
    # G1 with a standard parallel: a SHEET far from E4's latitude (frame_lat = E4's) passes the parity oracle, and the oracle
    # DISCRIMINATES -- the same area with `frame_lat` ignored (east scale at its own latitude) fails it.
    import dataclasses
    from _city import Degrees, LatLon
    e4 = _city.AREAS["canal-ring"]
    sheet = dataclasses.replace(e4, id="ams-a1-selftest", centre=LatLon(e4.centre.lat + 3 * 0.025330197, e4.centre.lon - 4 * 0.041190547),
                                frame_lat=Degrees(e4.centre.lat))
    assert g1_frame_parity(sheet)["status"] == "pass"
    ignored = dataclasses.replace(sheet, frame_lat=None)
    assert g1_frame_parity(ignored)["status"] == "pass", "an area with no frame_lat is checked against its own latitude"
    real = _city.frame_m_per_deg
    _city.frame_m_per_deg = lambda a: _city.m_per_deg(a.centre.lat)          # a frame that drops frame_lat
    try:
        assert g1_frame_parity(sheet)["status"] == "fail", "G1 must catch a frame that ignores frame_lat"
    finally:
        _city.frame_m_per_deg = real
    _self_test_sheet_rules()
    print("check-city-frame self-test: ok")



def _self_test_sheet_rules() -> None:
    """The sheet rules (P2b audit S1) on a synthetic world, with their NEGATIVE CONTROLS: the same data mirrored, turned 180 degrees or shifted
    is handed to the very same guard as if it were the sheet, and that guard must FAIL it."""
    import dataclasses
    import tempfile

    import rasterio
    from PIL import Image
    from rasterio.transform import from_origin
    # the pure rules
    assert g3v2_ok(0.0, [0.4] * 8, 0.6) and g3v2_ok(0.05, [0.06, 0.07], 0.5) and not g3v2_ok(0.05, [0.04, 0.07], 0.5), "stale water: the optimum counts"
    assert not g3v2_ok(0.05, [0.06], 0.06) and not g3v2_ok(0.5, [0.5], 0.0), "the mirrored copy must overlap clearly more"
    assert g5v2_ok(0.9, 0.7) and not g5v2_ok(0.9, 0.46) and not g5v2_ok(0.79, 0.9)
    assert g7v2_ok(0.5, 0.3, 0.2) and not g7v2_ok(0.5, 0.4, 0.2) and not g7v2_ok(0.15, 0.0, 0.0)
    m = np.zeros((10, 10), dtype=bool)
    m[:5] = True
    ins = np.ones((10, 10), dtype=bool)
    assert kappa(m, m, ins) == 1.0 and kappa(m, ~m, ins) == -1.0 and abs(kappa(m, np.zeros_like(m), ins)) < 1e-12, "kappa discounts the base rate"
    # the world: a 300 m sheet at Canal Ring, 90 buildings of 8 m placed (not symmetric) in the north-east, a 'canal' in the south-west
    base = _city.AREAS["canal-ring"]
    area = dataclasses.replace(base, id="synthetic-guards", size_m=300)
    rng = np.random.default_rng(11)
    rows: list[CityBuilding] = []
    for k in range(90):
        cx, cy = float(rng.uniform(-40, 130)), float(rng.uniform(10, 130))
        rows.append(cast(CityBuilding, {"src_id": f"NL.IMBAG.Pand.{k:04d}", "p": [cx - 4, cy - 4, cx + 4, cy - 4, cx + 4, cy + 4, cx - 4, cy + 4],
                                        "lonlat": [], "h": float(rng.uniform(4, 30)), "hSource": "3dbag-p70", "quality": True, "hCheck": None, "flag": False}))

    def ring(x0: float, y0: float, x1: float, y1: float) -> list[float]:
        return [x0, y0, x1, y0, x1, y1, x0, y1]
    water: list[dict[str, Any]] = [{"cls": "canal", "p": ring(-140, -140 + 50 * k, 60, -100 + 50 * k)} for k in range(3)]                  # three polygons, south-west
    ctx = cast(CityContextFile, {"water": water, "green": [], "roads": [], "city": "", "area": "", "sizeM": 300.0, "release": "", "source": ""})
    years: dict[str, int | None] = {r["src_id"]: 1990 for r in rows}
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as td:
        os.makedirs(os.path.join(td, "ahn"))
        global DATA_DIR, PUBLIC_DIR, AHN_DIR
        saved = (DATA_DIR, PUBLIC_DIR, AHN_DIR)
        DATA_DIR, PUBLIC_DIR, AHN_DIR = td, td, os.path.join(td, "ahn")
        try:
            # the synthetic AHN4: a DTM of 0 m with NO DATA under every building and water polygon; a DSM that is the building's height there
            minx, miny, maxx, maxy = _city.bounds_local_crs(area, 30.0)
            tf = from_origin(float(np.floor(minx)), float(np.ceil(maxy)), 0.5, 0.5)
            shape = (int((np.ceil(maxy) - np.floor(miny)) / 0.5), int((np.ceil(maxx) - np.floor(minx)) / 0.5))
            grid = Grid(tf, shape)
            h_img = np.zeros(shape, dtype=np.float32)
            nod = np.zeros(shape, dtype=bool)
            for r in rows:
                g = crs_polygons(area, [Polygon(ring_xy(r["p"]))])[0]
                m_ = burn([(g, 1)], grid).astype(bool)
                h_img[m_] = r["h"]
                nod |= m_
            for w in water:
                nod |= burn([(crs_polygons(area, [Polygon(ring_xy(w["p"]))])[0], 1)], grid).astype(bool)
            dtm = np.where(nod, np.nan, 0.0).astype(np.float32)
            dsm = np.where(h_img > 0, h_img, np.where(nod, np.nan, 0.0)).astype(np.float32)
            for name, arr in (("dtm_05m_clip.tif", dtm), ("dsm_05m_clip.tif", dsm)):
                with rasterio.open(os.path.join(td, "ahn", name), "w", driver="GTiff", height=shape[0], width=shape[1], count=1, dtype="float32",
                                   crs="EPSG:28992", transform=tf, nodata=float("nan")) as dst:
                    dst.write(arr, 1)
            # the synthetic surface: albedo dark on water, light elsewhere, north-up
            n = 150
            xs = (np.arange(n) + 0.5) * 300.0 / n - 150.0
            X, Y = np.meshgrid(xs, -xs)
            wmask = shapely.contains_xy(shapely.union_all([Polygon(ring_xy(w["p"])) for w in water]), X, Y)
            alb = np.where(wmask, 0.05, 0.25)
            rgb = np.dstack([np.full((n, n), 80), np.round(alb / 0.5 * 255), np.zeros((n, n))]).astype(np.uint8)
            Image.fromarray(rgb).save(os.path.join(td, "synthetic-guards-surface.png"))
            Image.fromarray(rgb[::-1]).save(os.path.join(td, "mirrored-surface.png"))

            def xf(fn: Xform) -> list[CityBuilding]:
                return _transformed_rows(rows, fn)
            # G3: the sheet passes; the mirrored and the turned copies, handed in AS the sheet, fail
            assert g3_v2(area, rows, ctx)["status"] == "pass"
            assert g3_v2(area, xf(MIRROR), ctx)["status"] != "pass", "G3 must fail a mirrored copy"
            assert g3_v2(area, xf(ROT180), ctx)["status"] != "pass", "G3 must fail a copy turned 180 degrees"
            # a water polygon that IS a footprint (a covered tank) is dropped, not counted as water
            tank = {"cls": "water", "p": rows[0]["p"]}
            assert g3_v2(area, rows, cast(CityContextFile, {**ctx, "water": [*water, tank]}))["detail"]["footprintCoincidentDropped"] == 1
            # G5: heights vs the nDSM
            rec5, _ = g5_v2(area, rows, years)
            assert rec5["status"] == "pass" and rec5["detail"]["shareWithin2m"] > 0.95, rec5["detail"]
            for name, fn in (("mirror", MIRROR), ("rot180", ROT180), ("a 10 m shift", SHIFT10E)):
                bad, _ = g5_v2(area, xf(fn), years)
                assert bad["status"] != "pass", f"G5 must fail {name}: {bad['status']} {bad['detail']}"
            assert g5_v2(area, rows, {k: 2022 for k in years})[0]["status"] == "pending", "buildings from AHN4's year on are no evidence"
            # G6: kappa of the nodata mask
            rec6 = g6_v2(area, rows, ctx)
            assert rec6["status"] == "pass" and rec6["north"] is not None and rec6["north"] > 0.8, rec6
            # EVERY control copy, handed in AS the sheet, must fail the same rule: mirror, 180 degrees, +3 and -2 degrees, 10 m and 20 m east, 15 m north and 6 m
            # south (the last three are not on the rule's own perturbation lattice, so they test the optimum, not a memorised grid)
            for name, fn in (("mirror", MIRROR), ("rot180", ROT180), ("+3 degrees", turn_xform(3.0)), ("-2 degrees", turn_xform(-2.0)),
                             ("10 m east", SHIFT10E), ("20 m east", SHIFT20E), ("15 m north", shift_xform(0.0, 15.0)),
                             ("6 m south", shift_xform(0.0, -6.0))):
                got = g6_v2(area, xf(fn), cast(CityContextFile, {**ctx, "water": [{"cls": "canal", "p": fn(ring_xy(w["p"])).ravel().tolist()} for w in water]}))
                assert got["status"] != "pass", f"G6 must fail the {name} copy: {got['north']} {got['detail']}"
            # the rule itself, on the numbers of the two sheets that broke the old absolute ceiling (H3 and H7), and the factor-3 counterexample
            assert g6v2_ok(0.927, 0.323, -0.371, [0.791]), "H3 passes: its mirrored 0.323 is water symmetry, ratio 2.87"
            assert g6v2_ok(0.833, 0.238, 0.054, [0.536]), "H7 passes: ratio 3.5"
            assert not 0.927 >= 3.0 * 0.323, "a factor of 3 would fail H3 (0.927 < 0.969): the factor stays 2"
            assert not g6v2_ok(0.927, 0.323, -0.371, [0.95]), "a copy that beats the candidate means the candidate is not at its optimum"
            assert not g6v2_ok(0.49, 0.0, 0.0, []) and not g6v2_ok(0.6, 0.35, 0.0, []), "below 0.5, or under 2x the mirrored kappa: fail"
            assert g6v2_ok(0.6, 0.0, -0.4, []) and not g6v2_ok(0.15, 0.0, 0.0, []), "the 0.1 floor: a control at ~0 is compared as 0.1"
            # G7: the water mask against -albedo; the mirrored image handed in as the surface fails
            assert g7_v2(area, ctx)["status"] == "pass"
            os.replace(os.path.join(td, "synthetic-guards-surface.png"), os.path.join(td, "keep.png"))
            os.replace(os.path.join(td, "mirrored-surface.png"), os.path.join(td, "synthetic-guards-surface.png"))
            assert g7_v2(area, ctx)["status"] != "pass", "G7 must fail a mirrored surface"
        finally:
            DATA_DIR, PUBLIC_DIR, AHN_DIR = saved
    print("  sheet rules: G3/G5/G6/G7 pass the synthetic sheet and FAIL its mirrored, turned and shifted copies (G6: eight control copies)")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        _self_test()
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))
