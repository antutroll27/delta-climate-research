#!/usr/bin/env python3
"""Compute the ISO city-indicator values we can honestly measure, and record the
ones we cannot.

WHY THIS EXISTS. The ISO 37120 family was written off earlier in this work as
unreachable "because the indicators need population data we do not have". That
was wrong, and only half-checked. ISO 37123:2019 -- the resilient-cities member
of the family, designed to be used alongside 37120 -- carries several indicators
whose denominator is CITY LAND AREA, not population:

    8.8  Percentage of city land area covered by tree canopy
    8.9  Percentage of city surface area covered with high-albedo materials
         contributing to the mitigation of urban heat islands

Both are measurable from rasters this site already ships, so both are published.

WHAT IS DELIBERATELY NOT PUBLISHED, and why, because an indicator set is only
credible if its omissions are as explicit as its values:

    8.1  Magnitude of urban heat island effects (ATMOSPHERIC). We model LAND
         SURFACE temperature. Surface UHI and atmospheric UHI are different
         quantities that diverge by many degrees in daytime sun. This is the
         indicator that looks most like our product and it is the one we most
         clearly cannot claim.
    8.2  Percentage of natural areas that have undergone ecological evaluation.
         No such evaluation exists for these wards.
    8.3  Territory undergoing ecosystem restoration. An administrative fact held
         by the municipality, not observable in imagery.
    21.1 Percentage of city area covered by publicly available hazard maps.
         Arguably 100 % -- our own heat map covers the whole study area -- which
         is exactly why it is excluded. An indicator a project satisfies by
         pointing at itself measures nothing.
    21.2 Pervious land and porous pavement as a percentage of city land area.
         Requires surface MATERIAL. We hold vegetation fraction and albedo;
         neither tells us whether a pavement drains.

THRESHOLD HONESTY. The publicly available ISO 37123 preview contains the
indicator titles and structure but not the body of 8.8.3 / 8.9.3, so the
standard's exact measurement protocol could not be read. Every threshold below
is therefore OUR stated interpretation, published with the value and reported at
alternative thresholds so a reader can see the sensitivity rather than take one
number on trust. This is alignment with a named indicator definition, not a
verified conformant measurement, and the artefact says so.

    python3 scripts/build-city-indicators.py
"""
from __future__ import annotations

import json
import os
from typing import Any

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "public", "heat-map", "data")
OUT = os.path.join(ROOT, "data", "indicators", "iso-city-indicators.json")
WARDS = ("ballygunge", "barrackpore", "baruipur")

#: Cross-file constant: must match CANOPY_HI in src/scripts/climate-engine/surface-raster.ts.
CANOPY_HI_M = 30.0

#: Tree canopy height threshold, metres. 3 m is the common convention in urban
#: tree-canopy assessment for separating tree crowns from shrubs and grass.
CANOPY_THRESHOLD_M = 3.0
CANOPY_SENSITIVITY_M = (2.0, 5.0)

#: "High albedo" threshold. 0.30 broadband reflectance is the usual cool-surface
#: cut-off; ordinary asphalt sits near 0.10 and a cool roof coating above 0.60.
ALBEDO_THRESHOLD = 0.30
ALBEDO_SENSITIVITY = (0.25, 0.35)


def _band(path: str, channel: int, lo: float, hi: float) -> "np.ndarray[Any, Any]":
    """Dequantise one 8-bit channel of a shipped PNG back to physical units."""
    arr = np.asarray(Image.open(path).convert("RGB"))[:, :, channel].astype(np.float64)
    return arr / 255.0 * (hi - lo) + lo


def ward_indicators(ward: str, albedo_range: tuple[float, float]) -> dict[str, Any]:
    canopy = _band(os.path.join(DATA, f"{ward}-canopy.png"), 0, 0.0, CANOPY_HI_M)
    albedo = _band(os.path.join(DATA, f"{ward}-surface.png"), 1, *albedo_range)
    if canopy.shape != albedo.shape:
        raise ValueError(f"{ward}: canopy {canopy.shape} vs surface {albedo.shape} -- grids must match")

    def pct(mask: "np.ndarray[Any, Any]") -> float:
        return round(float(np.mean(mask)) * 100.0, 2)

    return {
        "ward": ward,
        "gridCells": int(canopy.size),
        "iso37123_8_8": {
            "indicator": "Percentage of city land area covered by tree canopy",
            "standard": "ISO 37123:2019, 8.8",
            "value": pct(canopy >= CANOPY_THRESHOLD_M),
            "unit": "%",
            "threshold": {"canopyHeightM": CANOPY_THRESHOLD_M},
            "sensitivity": {f">={t} m": pct(canopy >= t) for t in CANOPY_SENSITIVITY_M},
            "method": "Fraction of grid cells whose canopy height model value meets the threshold.",
            "source": "Meta / WRI Canopy Height Model (CC BY 4.0), resampled to the ward analysis grid.",
        },
        "iso37123_8_9": {
            "indicator": "Percentage of city surface area covered with high-albedo materials "
                         "contributing to the mitigation of urban heat islands",
            "standard": "ISO 37123:2019, 8.9",
            "value": pct(albedo >= ALBEDO_THRESHOLD),
            "unit": "%",
            "threshold": {"broadbandAlbedo": ALBEDO_THRESHOLD},
            "sensitivity": {f">={t}": pct(albedo >= t) for t in ALBEDO_SENSITIVITY},
            "method": "Fraction of grid cells whose broadband albedo meets the threshold.",
            "source": "Sentinel-2 L2A surface reflectance, Liang (2001) broadband conversion.",
            "wardMeanAlbedo": round(float(np.mean(albedo)), 3),
            "maxAlbedo": round(float(np.max(albedo)), 3),
            "caveat": "Measures reflectance actually observed, not materials installed for cooling. "
                      "A bright bare roof and a deliberate cool roof are indistinguishable here.",
            "interpretation": "A value at or near zero is a MEASUREMENT, not a missing number. Ward-mean "
                              "broadband albedo here is 0.12-0.14 -- dark roofs and asphalt -- so almost no "
                              "surface reaches a cool-surface threshold. Read as the size of the cool-roof "
                              "opportunity rather than as an absent value.",
        },
    }


def main() -> int:
    with open(os.path.join(DATA, "surface-meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    lo, hi = meta["albedo_range"]

    doc: dict[str, Any] = {
        "status": "prototype",
        "standardFamily": "ISO 37120 / 37122 / 37123 city indicators",
        "scope": "Study wards only. These are ward-scale values; ISO indicators are defined at CITY scale, "
                 "so they are reported here as per-ward measurements using the standard's definitions, "
                 "not as city-wide indicator values for Kolkata.",
        "protocolCaveat": "The public ISO 37123:2019 preview carries the indicator titles and structure but "
                          "not the measurement clauses, so exact protocols could not be read. Thresholds below "
                          "are our stated interpretation and every value is reported at alternative thresholds. "
                          "This is alignment with a named indicator definition, not a verified conformant "
                          "measurement.",
        "published": [ward_indicators(w, (lo, hi)) for w in WARDS],
        "deliberatelyNotPublished": [
            {"standard": "ISO 37123:2019, 8.1",
             "indicator": "Magnitude of urban heat island effects (atmospheric)",
             "reason": "We model land SURFACE temperature. Surface and atmospheric urban heat island are "
                       "different quantities and diverge by many degrees in daytime sun. This is the "
                       "indicator closest to our product and the one we most clearly cannot claim."},
            {"standard": "ISO 37123:2019, 8.2",
             "indicator": "Percentage of natural areas that have undergone ecological evaluation",
             "reason": "An ecological evaluation is fieldwork by qualified ecologists, not something derivable "
                       "from satellite imagery. None has been carried out for these wards, and the canopy "
                       "raster we do hold says nothing about ecological condition or species composition."},
            {"standard": "ISO 37123:2019, 8.3",
             "indicator": "Territory undergoing ecosystem restoration as a percentage of total city area",
             "reason": "Restoration is an administrative fact -- which parcels are under an active programme -- "
                       "held by the municipality, not observable in imagery. A greening trend in the canopy "
                       "data would not distinguish a restoration scheme from ordinary growth."},
            {"standard": "ISO 37123:2019, 21.1",
             "indicator": "Percentage of city area covered by publicly available hazard maps",
             "reason": "Arguably 100 % because our own heat map covers the study area, which is precisely why "
                       "it is excluded. An indicator satisfied by pointing at oneself measures nothing."},
            {"standard": "ISO 37123:2019, 21.2",
             "indicator": "Pervious land and porous pavement as a percentage of city land area",
             "reason": "Requires surface material. We hold vegetation fraction and albedo; neither says "
                       "whether a pavement drains."},
            {"standard": "ISO 37120:2018, population-denominated indicators",
             "indicator": "Green area per 100 000 population, and similar",
             "reason": "No ward-level population figure is held, and inventing one would repeat the "
                       "fabricated-exposure error this standards pass exists to remove."},
        ],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")

    for w in doc["published"]:
        print(f"  {w['ward']:<12} canopy {w['iso37123_8_8']['value']:>5.1f}%   "
              f"high-albedo {w['iso37123_8_9']['value']:>5.1f}%")
    print(f"  {len(doc['deliberatelyNotPublished'])} indicators recorded as NOT published, with reasons")
    print(f"  wrote {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
