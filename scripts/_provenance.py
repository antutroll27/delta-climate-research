"""Per-layer data provenance — the "receipts" spine.

WHY THIS EXISTS. Building footprints already carry a per-building receipt
(`build-footprint-provenance.py` → `{ward}-provenance.json`), but every OTHER
layer's attribution is a single hand-typed sentence in `HeatMapStage.astro`
(the `.attr` div) with no machine-readable backing. A reader — or a sceptical
scientist, or an investor's technical advisor — cannot ask "where did THIS layer
come from?" of anything but a building. This module is the shared vocabulary for
a structured, checkable per-LAYER manifest that closes that gap.

Additive: it touches no existing artefact and moves no published number. The
facts it records are already committed elsewhere (the terrain/surface/footprint
artefacts and the on-screen credit line); this makes them one source of truth
the UI can turn into receipts.

MODELLED ON STANDARDS, deliberately, so it reads as an instrument: STAC Item
properties (source/instrument/datetime/cloud/gsd/licence), ISO 19115 for
`lineage` (how the layer was produced) and ISO 19157 for `confidence` (its
fitness for use). Naming the standards is itself a credibility signal.

STAC CAPTURE WITHOUT A NEW DEPENDENCY. `stac_fields()` lifts the receipt fields
straight out of a STAC Item's `properties` dict — the GeoJSON feature that
`_sentinel.py` / `fetch-landsat-lst.py` already parse from the search response.
No `pystac-client` dependency, and no change to which scenes are selected: a
fetcher that already holds the Items can enrich its record when it next runs.
"""
from __future__ import annotations

import json
import os
from typing import Literal, Mapping, NotRequired, TypedDict, cast

#: The receipts axis — distinct from `_types.Provenance` (which is the DC-URS
#: value provenance). `reference` = a contextual backdrop we neither measured nor
#: modelled (e.g. the basemap); `derived` = measured inputs transformed by us.
LayerKind = Literal["measured", "modelled", "derived", "reference"]

SCHEMA = "delta-layer-provenance/1 · STAC + ISO 19115 (lineage) / ISO 19157 (quality)"


class Licence(TypedDict):
    name: str
    url: NotRequired[str]


class LayerRecord(TypedDict):
    """One layer's receipt. Optional fields are omitted, never null, so the UI
    can test presence — a missing `cloudPct` means "not a scene-based product",
    not "cloud-free"."""
    id: str
    label: str
    kind: LayerKind
    source: str
    licence: Licence
    lineage: list[str]
    collection: NotRequired[str]
    instrument: NotRequired[str]
    resolution: NotRequired[str]
    vintage: NotRequired[str]
    cloudPct: NotRequired[float]
    confidence: NotRequired[str]


class LayerManifest(TypedDict):
    ward: str
    generated: str
    schema: str
    layers: list[LayerRecord]


def stac_fields(properties: Mapping[str, object]) -> dict[str, object]:
    """Receipt fields lifted from a STAC Item's ``properties`` (already parsed by
    the fetchers). Returns only the fields that are present, keyed to match
    `LayerRecord`, ready for a fetcher to merge into its record. Pure, defensive,
    no dependency."""
    out: dict[str, object] = {}
    dt = properties.get("datetime")
    if isinstance(dt, str) and len(dt) >= 10:
        out["vintage"] = dt[:10]
    cc = properties.get("eo:cloud_cover")
    if isinstance(cc, (int, float)) and not isinstance(cc, bool):
        out["cloudPct"] = round(float(cc), 1)
    gsd = properties.get("gsd")
    if isinstance(gsd, (int, float)) and not isinstance(gsd, bool):
        out["resolution"] = f"{gsd:g} m"
    platform = properties.get("platform")
    instruments = properties.get("instruments")
    if isinstance(platform, str):
        if isinstance(instruments, list):
            names = ", ".join(str(i) for i in instruments)
            out["instrument"] = f"{platform} / {names}" if names else platform
        else:
            out["instrument"] = platform
    return out


def manifest(ward: str, generated: str, layers: list[LayerRecord]) -> LayerManifest:
    return {"ward": ward, "generated": generated, "schema": SCHEMA, "layers": layers}


def dump(path: str, m: LayerManifest) -> None:
    """Byte-stable write (minified, trailing newline) to match every other served
    artefact so a regenerate is a no-op diff."""
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(m, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")


def load(path: str) -> LayerManifest:
    with open(path, encoding="utf-8") as fh:
        return cast(LayerManifest, json.load(fh))
