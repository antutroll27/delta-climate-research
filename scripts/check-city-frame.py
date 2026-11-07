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


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def doc_path(area: Area, layer: str) -> str:
    return os.path.join(_city.data_dir(area.city), f"{area.id}-{layer}.json")


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
    out: list[Polygon] = []
    for p in polys:
        if p.is_empty:
            continue
        out.append(Polygon(to_crs_xy(area, np.asarray(p.exterior.coords))))
    return out


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


def ndsm_p70(area: Area, b: list[CityBuilding], mirrored: bool) -> npt.NDArray[np.float64]:
    dsm, grid = read_downsampled("dsm_05m_clip.tif", 2)
    dtm, _ = read_downsampled("dtm_05m_clip.tif", 2)
    ndsm = (dsm - fill_nearest(dtm)).astype(np.float32)
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
    path = os.path.join(_city.PUBLIC, f"{area.id}-surface.png")
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
    path = os.path.join(_city.PUBLIC, f"{area.id}-terrain.json")
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


# ── driver ─────────────────────────────────────────────────────────────────

INPUT_LAYERS: Final = ("buildings", "terrain", "context")


def input_hashes(area: Area) -> dict[str, str]:
    return {f"{area.id}-{layer}.json": sha256_of(doc_path(area, layer)) for layer in INPUT_LAYERS}


def frame_guard_path(area: Area) -> str:
    return os.path.join(_city.data_dir(area.city), "frame-guard.json")


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
    print("check-city-frame self-test: ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        _self_test()
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))
