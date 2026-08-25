# Dubai data: what we use, what we refused, and why

Compiled 2026-08-25 from four research lanes plus direct probing. Every licence
below was read from a primary source. This exists so the next person does not
re-discover a reachable endpoint and assume reachable means permitted.

## In use

| Layer | Source | Licence | Share-alike? |
|---|---|---|---|
| Terrain (bare earth) | DeltaDTM v1.1 | CC BY 4.0 | no |
| Terrain (surface) | Copernicus GLO-30 | free, full and open | no |
| Ground texture | Sentinel-2 L2A TCI | Reg. EU 377/2014; Del. Reg. 1159/2013 | no |
| Landmark heights | CTBUH (published measurements) | facts, not expression | n/a |
| Building heights | Wikidata | CC0 1.0 | no |
| Footprints (base) | Microsoft GlobalML | CDLA-Permissive-2.0 | no |
| Outlines, 3D massing, heights | OpenStreetMap | **ODbL 1.0** | **yes** |
| Water, coast, beaches, roads, land use | OpenStreetMap | **ODbL 1.0** | **yes** |

## REFUSED — reachable but not licensed

### Dubai Development Authority ArcGIS (`gis.dda.gov.ae`)

**This is the single richest source found for what we lack, and we are not using
it.** Live ArcGIS Enterprise 12.0.0, anonymous, no token. The `DDA` folder is
open while every other folder returns 499. It serves `Plot` — 99,601 features
emirate-wide, **3,054 inside our study window** — with an attribute schema that
would answer several open questions at once:

    MAIN_LANDUSE, SUB_LANDUSE, LANDUSE_CATEGORY, MAX_HEIGHT_METERS,
    MAX_HEIGHT_FLOORS, MIN/MAX_PLOT_COVERAGE, GFA_SQM, CONSTRUCTION_STATUS,
    BUILDING_SETBACK_SIDE1-4, PODIUM_SETBACK_SIDE1-4

`MAIN_LANDUSE` is a real controlled vocabulary, which is exactly what OSM's
land-use tagging is not (measured: OSM gives 84.76 km2 residential against
2.17 km2 commercial — a blanket, not a zoning map).

**Why we refuse it.** The service carries no `licenseInfo`, no terms and no
`accessInformation` — only `copyrightText: "DCCA GIS"`. The portal's item search
returns zero. And DDA's site terms are not silent, they are prohibitive:

> "5.1 … all intellectual property rights … including … **database rights** …
> All rights not expressly granted are reserved."
> "5.2 … **You may not copy, modify, distribute, sell, or lease any part of the
> Sites.** … You may only access the Sites through the interfaces that we
> provide"

An open port is not a licence. This project ruled out FABDEM, FathomDEM and
TanDEM-X on licence grounds while they were technically downloadable; the same
rule applies to an endpoint that answers.

**What it IS good for: a data request.** We can now name the exact service,
folder, layer and fields we want. That is a far stronger ask than "do you have
zoning data".

## Dead ends, so nobody re-checks

- `gis.dubai.gov.ae`, `geohub.dubai.gov.ae`, `opendata.dubai.gov.ae`,
  `data.dubai.gov.ae`, `geoportal.abudhabi.ae` — **NXDOMAIN, do not exist**
- `dubaipulse.gov.ae` — resolves, TCP hangs from three networks. Metadata reads
  `License = notspecified`; a paid commercial tier exists. **Cannot be evaluated
  from outside the UAE, and it is the one portal whose terms might actually
  matter.** Needs an in-region check.
- Smart Dubai's ArcGIS Online subscription is **cancelled** (`SB_0006`)
- Dubai Municipality 3D buildings / zoning services — `499 Token Required`
- Dubai 2040 Urban Master Plan — **PDFs only**, no GIS layer exists publicly
- RTA — no GIS at all, zero AGOL items; `gis.rta.ae` unreachable
- `bayanat.ae` — cleanly CC BY 4.0 including commercial, but **zero Dubai geodata**
- MBRSC KhalifaSat 0.7 m mosaic — real, "free of charge" to entities, **no
  licence text published**. The one lead worth a warm-contact ask.

## No permissive road data exists

- **GRIP4** claims CC-0 while stating it is "based on many different sources
  (including OpenStreetMap)". Relicensing an ODbL derivative as CC-0 does not
  extinguish share-alike — that is licence laundering with someone else's
  signature on it. The same authors' Zenodo deposit says CC BY 4.0, so the two
  primary distributions disagree with each other. Delivered at 5 arcminutes
  (~8 km) and explicitly "not suitable for navigation".
- **gROADSv1** — temporal coverage ends 2010, for a city substantially rebuilt
  after 2005. Dead on arrival.
- **Overture** — measured 100 % ODbL on our bbox: all 36,499 road segments,
  45,417 buildings, 268 water, 2,850 land_use. Not an escape route. Its only
  permissive layer is `base/land_cover`, which is ESA WorldCover.

## The ODbL position

Share-alike attaches to a **Derivative Database**, not a **Produced Work**.
Rendered flood maps, depth fields and simulation outputs are Produced Works —
attribution, no database disclosure. **Publishing the geometry itself is what
triggers it.** That distinction is the whole decision, it is worth one hour of
legal review, and it is cheaper than any dataset substitution — because as the
sections above show, there is no substitute to buy.

## The gap that no licence fixes

**There is no tide gauge anywhere in the UAE.** PSMSL (1,618 stations) and
UHSLC (598) both return zero; the nearest is Bahrain, 483 km away. For a flood
simulator, the vertical datum and the surge boundary have no open local
observation. That is a limit on what the tool may claim, not a data-sourcing
problem.
