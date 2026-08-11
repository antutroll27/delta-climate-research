"""Per-layer provenance manifest -> public/heat-map/data/{ward}-layers.json.

Assembles one machine-readable receipt per LAYER the twin renders or calibrates
on, from artefacts that are ALREADY committed (the terrain/surface/footprint
files) plus the fixed source facts that today live only in the hand-typed `.attr`
sentence of HeatMapStage.astro. No network, no credentials, no re-fetch — so it
runs anywhere and cannot move a published number or a scene selection.

Where a fetcher captures live STAC Item metadata (via `_provenance.stac_fields`)
it can later enrich a layer's `vintage`/`cloudPct`; until then those come from the
committed derived files (e.g. the Sentinel composite's year span).

    python3 scripts/build-provenance-manifest.py
    python3 scripts/build-provenance-manifest.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _provenance as prov  # noqa: E402
import _types  # noqa: E402
from _provenance import LayerKind, LayerRecord, Licence  # noqa: E402

ROOT = os.path.join(HERE, "..")
DATA = os.path.join(ROOT, "public", "heat-map", "data")
GEOMETRY = os.path.join(ROOT, "data", "geometry")
DCURS = os.path.join(ROOT, "data", "dc-urs")

#: Pinned so a regenerate is a no-op diff (same convention as fetch-terrain.py's
#: `retrieved`). Bump deliberately when the manifest's content actually changes.
GENERATED = "2026-08-10"

ODBL: Licence = {"name": "ODbL", "url": "https://opendatacommons.org/licenses/odbl/"}
CCBY4: Licence = {"name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/"}
COPERNICUS: Licence = {"name": "Copernicus Sentinel data (free, full & open)",
                       "url": "https://sentinels.copernicus.eu/web/sentinel/terms-conditions"}

#: The layer ids every ward manifest must carry — the drift guard checks this set.
EXPECTED = (
    "basemap", "footprints", "heights", "surface", "canopy", "terrain", "water", "roads", "lst", "ambient",
)


def _read(path: str) -> dict[str, object]:
    with open(path, encoding="utf-8") as fh:
        return cast("dict[str, object]", json.load(fh))


def _s(doc: dict[str, object], key: str, default: str = "") -> str:
    value = doc.get(key)
    return value if isinstance(value, str) else default


def layer(
    id_: str, label: str, kind: LayerKind, source: str, licence: Licence, lineage: list[str],
    *, collection: str | None = None, instrument: str | None = None, resolution: str | None = None,
    vintage: str | None = None, cloud_pct: float | None = None, confidence: str | None = None,
) -> LayerRecord:
    record: LayerRecord = {
        "id": id_, "label": label, "kind": kind, "source": source, "licence": licence, "lineage": lineage,
    }
    if collection is not None:
        record["collection"] = collection
    if instrument is not None:
        record["instrument"] = instrument
    if resolution is not None:
        record["resolution"] = resolution
    if vintage:
        record["vintage"] = vintage
    if cloud_pct is not None:
        record["cloudPct"] = cloud_pct
    if confidence is not None:
        record["confidence"] = confidence
    return record


def build(ward_id: str, sentinel: dict[str, object]) -> prov.LayerManifest:
    terrain = _read(os.path.join(DATA, f"{ward_id}-terrain.json"))
    fp_prov = _read(os.path.join(DATA, f"{ward_id}-provenance.json"))
    footprints = _read(os.path.join(GEOMETRY, f"{ward_id}-footprints.json"))

    counts = fp_prov.get("counts")
    count_note = ""
    if isinstance(counts, dict):
        parts = [f"{k}: {v}" for k, v in counts.items()]
        count_note = "per-source count — " + ", ".join(parts)
    release = _s(footprints, "release")

    sentinel_years = sentinel.get("years_requested")
    year_span = ""
    if isinstance(sentinel_years, list) and sentinel_years:
        year_span = f"{sentinel_years[0]}–{sentinel_years[-1]} composite"

    layers: list[LayerRecord] = [
        layer(
            "basemap", "Basemap", "reference",
            "OpenStreetMap, served by OpenFreeMap", ODBL,
            ["OSM vector tiles rendered by OpenFreeMap; contextual backdrop only, not a measured layer"],
        ),
        layer(
            "footprints", "Building footprints", "measured",
            _s(fp_prov, "source", "Overture Maps Foundation (ODbL)"), ODBL,
            [n for n in (
                "Overture GERS-deduplicated merge of OSM + Google + Microsoft",
                count_note,
                "placed within 2.4 cm of the source coordinate after the 2026-08-05 frame fix; "
                "residual positional error is inherited, not corrected",
            ) if n],
            collection="overture:buildings", vintage=release,
            confidence="per-building receipt in {ward}-provenance.json (human-traced vs model, "
                       "with the source's own confidence where published)",
        ),
        layer(
            "heights", "Building heights", "derived",
            "Google Open Buildings 2.5D Temporal", CCBY4,
            ["zonal-mean height per footprint from the 2.5D raster",
             "known ~17% low bias vs OSM levels (averaging pulls in courtyards/annexes); unvalidated, ground truth needs LiDAR"],
            collection="google:open-buildings-temporal", resolution="~4 m", vintage="2023 epoch",
            confidence="indicative; not independently validated (ICESat-2 cohort underpowered, n=28<30)",
        ),
        layer(
            "surface", "Vegetation & albedo", "measured",
            _s(sentinel, "source", "Sentinel-2 L2A via Earth Search STAC"), COPERNICUS,
            ["Sentinel-2 L2A surface reflectance via the Earth Search STAC API",
             "NDVI -> fractional vegetation cover; albedo via band coefficients",
             "each channel additively shifted so its ward mean equals the measured DC-URS scalar: "
             "the PATTERN is measured, the LEVEL is the approved input"],
            collection="sentinel-2-l2a", instrument="Sentinel-2 MSI", resolution="10 m",
            vintage=year_span, confidence="measured spatial pattern at the DC-URS-approved level",
        ),
        layer(
            "canopy", "Tree canopy height", "derived",
            "Meta / World Resources Institute 1 m Global Canopy Height Model", CCBY4,
            ["Meta+WRI 1 m canopy-height model (neural height regression on Maxar imagery, ~2018-2020 epoch)",
             "clipped to the 1400 m ward window and resampled (area-average) to the 140x140 served grid",
             "tree instances scattered from the canopy field (density-weighted by height against a fixed "
             "22 m reference so density is comparable BETWEEN wards, deterministic jitter; thin canopy "
             "left empty); heights measured, positions/species modelled"],
            collection="meta-wri:canopy-height", instrument="Maxar / CHM model",
            resolution="1 m", vintage="2018-2020 epoch",
            confidence="canopy extent/height indicative (MAE ~ few m); individual trees are modelled, not surveyed",
        ),
        layer(
            "terrain", "Terrain relief", "reference",
            _s(terrain, "source", "AWS Open Data terrain tiles (terrarium; SRTM-derived)"),
            {"name": _s(terrain, "licence", "public domain (SRTM/NASA)")},
            [n for n in (
                "terrarium z15 tiles cropped to the 1400 m window, ~40 m median-filtered, "
                "clamped to ±12 m, baked to a 128² heightfield",
                _s(terrain, "crossCheck"),
            ) if n],
            resolution="~30 m (SRTM class)", vintage=_s(terrain, "retrieved"),
            confidence=_s(terrain, "note",
                          "indicative broad-scale form; NOT surveyed ground and NOT used by the simulation"),
        ),
        layer(
            "water", "Water bodies", "measured",
            "OpenStreetMap via Overpass", ODBL,
            ["OSM natural=water / waterway polygons clipped to the ward window"],
        ),
        layer(
            "roads", "Roads & labels", "measured",
            "OpenStreetMap via Overpass", ODBL,
            ["OSM highway centrelines + street names clipped to the ward window"],
        ),
        layer(
            "lst", "Land-surface temperature (calibration)", "measured",
            "NASA ECOSTRESS + Landsat 8/9 C2 L2 (via Microsoft Planetary Computer)",
            {"name": "US Government public domain"},
            ["thermal reference the model is calibrated and validated against, not a rendered layer",
             "leave-one-overpass-out validation; bootstrap CIs over overpasses (see accuracy.ts)"],
            instrument="ECOSTRESS / Landsat TIRS", resolution="70 m (ECOSTRESS) / 100 m (Landsat TIRS)",
            vintage="ECOSTRESS 2019- ; Landsat 50-overpass campaign 2026-08",
            confidence="published per-phase accuracy bands with 95% CIs (accuracy.ts)",
        ),
        layer(
            "ambient", "Live ambient weather", "measured",
            "Met Norway locationforecast", CCBY4,
            ["live air temperature / wind / cloud forcing fetched per ward at runtime"],
            instrument="MET Nordic / ECMWF blend", confidence="measured, live (updates ~hourly)",
        ),
    ]
    return prov.manifest(ward_id, GENERATED, layers)


def out_path(ward_id: str) -> str:
    return os.path.join(DATA, f"{ward_id}-layers.json")


def check() -> int:
    bad = 0
    for ward in _types.WARDS.values():
        path = out_path(ward.id)
        if not os.path.exists(path):
            print(f"  MISSING {os.path.relpath(path, ROOT)}")
            bad += 1
            continue
        manifest = prov.load(path)
        ids = {layer_record["id"] for layer_record in manifest["layers"]}
        missing = [e for e in EXPECTED if e not in ids]
        if missing:
            print(f"  {ward.id}: manifest missing layers {missing}")
            bad += 1
            continue
        for record in manifest["layers"]:
            if not record["source"] or not record["licence"]["name"] or not record["lineage"]:
                print(f"  {ward.id}/{record['id']}: a receipt needs source + licence + lineage")
                bad += 1
        print(f"  {ward.id}: {len(manifest['layers'])} layers")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        return 1 if check() else 0
    sentinel = _read(os.path.join(DCURS, "sentinel.json"))
    for ward in _types.WARDS.values():
        manifest = build(ward.id, sentinel)
        prov.dump(out_path(ward.id), manifest)
        size = os.path.getsize(out_path(ward.id)) / 1024
        print(f"  {ward.id}: {len(manifest['layers'])} layers, {size:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
