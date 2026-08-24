# Delta Climate Earth — 3D Digital Twin Standards & API Specification

## v1.0 — Certification Alignment and Interoperability Surface

**Document Status:** Internal specification + standards evidence pack component
**Version:** 1.0
**Derived From:** Master Blueprint v2.2 (2026-08-16), sections 3, 14–24
**Last Updated:** 2026-08-18
**Primary Use:** Standards alignment reference, API contract definition, certification roadmap, technical evidence packaging

---

> ## ⚠️ CORRECTIONS — 2026-08-18, verified against the repo before anything was built from this
>
> This document names itself "source of truth for standards claims" (last line). Five things in
> it did not survive a check against the code, and would have gone straight onto public pages:
>
> 1. **The API surface (§8) is not servable as written.** `astro.config.mjs` has no `output` and
>    no adapter — this is a **static build**, and `src/pages/api` does not exist. Every endpoint
>    in §8.1 returns *static JSON*, so they are built as **build-time files at the same URLs**
>    (`src/pages/api/**/*.json.ts` + `getStaticPaths`). No server, no adapter. Consequently §11.1's
>    rate limiting / query validation have no surface to apply to — read-only static JSON — and
>    that is stated on `/standards` rather than faked.
> 2. **§9.1's Ballygunge bbox `[88.3812, 22.5411, 88.4125, 22.5623]` is wrong** — ~2 km off and
>    2.5× too large. The real box, from `scripts/_types.py` `ward_bounds()`, is
>    **`(88.3591, 22.5217, 88.3727, 22.5343)`**. Ward ids in the data model are
>    `ballygunge | barrackpore | baruipur`; **`kmc_ward_068` appears nowhere in the repo.**
> 3. **§9.1's `physics_data` values are INVENTED** — `population_exposed_high_heat: 12500`,
>    `ac_energy_load_reduction_potential: "18%"`, `facade_glare_index: "HIGH"`. No artefact
>    produces them. They must not be reproduced in any payload; the unit test pins those field
>    names out. The real confidence payload is `accuracy.ts` (`bandK`, `n`, `confidence`,
>    `SPATIAL`, `HEIGHTS`).
> 4. **§12.1's source table is partly wrong and incomplete.** Google Open Buildings has **no Gulf
>    coverage**; **Open-Meteo is non-commercial** and was ruled out; canopy is **Meta/WRI CHM**,
>    not GEDI. **WSF3D (CC-BY-4.0, the locked Dubai height source) and 3D-GloBFP are absent.**
>    See the corrected §12.1 below. Attribution is **generated per ward** from
>    `public/heat-map/data/{ward}-provenance.json`, never hand-written (§12.2 retired).
> 5. **NGSI-LD and 3D Tiles are roadmap, not prototype.** A static file shaped like an NGSI-LD
>    entity is not an integration without a broker (§4.2's own gap), and §9.3's own note forbids
>    presenting the tileset sample as one. Both stay "roadmap" on `/standards`.
>
> What IS adopted verbatim: §2 (the aligned/compatible/compliant/certified ladder), §10, §10.4,
> §9.4's LST caveat, and §7's honest statuses.

---

# 1. Purpose and Scope

This document is the single reference for **how Delta Climate Earth's urban climate digital twin aligns with 3D city-model, geospatial, and smart-city standards**, and for **the API surface that demonstrates that alignment**.

It covers:

- the certification posture and the language permitted when describing it,
- the three standards categories the platform targets,
- the full alignment matrix with current status,
- every standards-facing API endpoint and its sample payload,
- the metadata, lineage, and confidence requirements that any certification claim depends on,
- API security, licensing, and attribution obligations,
- the readiness checklist and the roadmap from alignment to formal certification.

It does **not** cover product vision, city context, ETL internals, physics modules, or scenario UX. Those remain in the Master Blueprint.

---

# 2. Certification Posture

## 2.1 The Core Distinction

The platform is **standards-aligned**, not **standards-certified**.

| Term | Meaning | Applies Today |
|---|---|---|
| Aligned | Implements the data model, schema, or API pattern defined by a standard | Yes, for several standards |
| Compatible | Interoperates with a named ecosystem in testing | Partially, as prototype samples |
| Compliant | Meets every normative requirement of a standard | No |
| Certified | Formally assessed and approved by the standards body or authority | No |

Every external statement must sit in the first two rows unless a certificate exists.

## 2.2 Approved Public Statement

> Delta Climate Earth is a standards-aligned urban climate digital twin prototype. It demonstrates interoperability patterns using OGC geospatial formats, FIWARE NGSI-LD context models, ISO-inspired sustainability KPIs, and Dubai Pulse-compatible integration pathways. Formal certification, municipal approval, and production compliance are planned for later deployment phases.

## 2.3 Permitted Language

- "Designed to align with…"
- "Supports sample interoperability patterns…"
- "Demonstrates a roadmap toward…"
- "Prototype implementation…"
- "Planning-grade estimate…"
- "Subject to municipal validation…"
- "Standards alignment, not formal certification…"

## 2.4 Prohibited Language

Unless a verifiable certificate or written authority approval exists:

- "Certified."
- "Fully compliant."
- "Officially integrated with Dubai Pulse."
- "Approved by Dubai Municipality."
- "ISO certified platform."
- "Medically validated health impact."
- "Engineering-grade measurement."
- "Guaranteed heat reduction."

---

# 3. Standards Category 1 — Global Geospatial and 3D Interoperability

## 3.1 OGC CityGML / CityJSON

**Purpose:** Semantic 3D city models covering building, vegetation, transport, and terrain objects.

**Platform alignment:** Targets LOD1 and LOD2 building representations. CityJSON is the recommended lightweight demonstration format; full CityGML export is deferred.

**Endpoint:**

```txt
GET /api/wards/:id/cityjson
```

**Safe statement:**

> The platform demonstrates CityGML/CityJSON mapping for LOD1/LOD2 building models. Full CityGML export is planned for future versions.

**Certification gap:** No schema validation against the CityJSON 2.0 specification yet. Geometry boundaries and vertex arrays are unpopulated in the current sample.

---

## 3.2 OGC 3D Tiles

**Purpose:** Efficient streaming of large 3D datasets to the browser.

**Platform alignment:** Tile-based loading for 3D ward assets, with a tileset manifest per ward.

**Endpoint:**

```txt
GET /api/wards/:id/3d-tiles/tileset.json
```

**Safe statement:**

> The platform demonstrates a 3D Tiles streaming architecture. Production-level tile optimization is planned for future releases.

**Certification gap:** Bounding volumes must be verified in radians; geometric error values are placeholders; no production tiling pipeline in place.

---

## 3.3 OGC API — Features Patterns

**Purpose:** Standardized geospatial APIs for collections and features.

**Platform alignment:** Ward and building data exposed through GeoJSON-based collection endpoints following OGC API Features conventions.

**Endpoints:**

```txt
GET /api/collections/wards
GET /api/collections/wards/items
GET /api/collections/wards/items/:id
```

**Safe statement:**

> The API demonstrates OGC API Features-inspired patterns for ward and building data exchange.

**Certification gap:** Missing landing page, conformance declaration, and full CRS/paging parameter support required by the specification.

---

## 3.4 buildingSMART IFC / ISO 16739

**Purpose:** Building Information Modeling data exchange.

**Platform alignment:** Roadmap only. Future versions may accept IFC import so that proposed buildings can be tested for climate impact.

**Safe statement:**

> Future BIM/IFC integration pathway for proposed building climate impact testing.

---

# 4. Standards Category 2 — Smart-City and Digital Twin Frameworks

## 4.1 Gemini Principles

**Purpose:** Principles for open, secure, and interoperable digital twins.

**Platform alignment:** Governance approach draws on openness, interoperability, security, public value, and data governance.

**Safe statement:**

> The platform's governance approach is inspired by the Gemini Principles.

---

## 4.2 FIWARE / NGSI-LD

**Purpose:** Smart-city context data models and APIs.

**Platform alignment:** Sample NGSI-LD entities for building heat exposure and ward-level indicators.

**Endpoints:**

```txt
GET /api/ngsi-ld/entities
GET /api/ngsi-ld/entities/:id
```

**Safe statement:**

> Sample NGSI-LD-compatible entities are provided to demonstrate smart-city interoperability.

**Certification gap:** No context broker deployment; no subscription, temporal, or federation support.

---

## 4.3 ISO 37120 and ISO 37122

**Purpose:** Indicators for sustainable cities and smart cities.

**Platform alignment:** Platform outputs map to indicator categories inspired by these standards.

Mapped KPIs:

- population exposed to high heat,
- cool-roof intervention potential,
- tree canopy coverage,
- shaded public space,
- estimated cooling load reduction.

**Safe statement:**

> Platform outputs are mapped to urban sustainability indicator categories inspired by ISO 37120 and ISO 37122.

---

## 4.4 ISO 19650

**Purpose:** Information management using BIM.

**Platform alignment:** Future deployments may adopt ISO 19650-style practices for versioning, information exchange, data lineage, and project documentation.

**Safe statement:**

> Future deployments may adopt ISO 19650-style information management practices.

---

# 5. Standards Category 3 — Dubai / UAE / MENA Integration

## 5.1 Digital Dubai Authority / Dubai Pulse

**Purpose:** Dubai's official digital government and data ecosystem.

**Platform alignment:** Designed to support climate-resilience data exchange patterns that may align with Dubai Pulse-compatible ecosystems.

**Mandatory disclaimer:** Delta Climate Earth is not currently an official Dubai Pulse integration unless explicitly approved by the relevant authorities.

**Safe statement:**

> Designed to support integration with Dubai Pulse-compatible open data and smart-city ecosystems, subject to official review and approval.

---

## 5.2 Dubai Municipality GIS and BIM Context

**Purpose:** Urban planning, permitting, and development review.

**Platform alignment:** May support municipal planning workflows through ward heat maps, shadow reports, wind impact summaries, intervention prioritization, and building-level metadata.

**Safe statement:**

> The platform is designed to support planning workflows that may align with Dubai Municipality GIS and BIM requirements, subject to municipal validation.

---

## 5.3 UAE Data Governance

Relevant frameworks may include:

- Dubai Data Law No. 26 of 2015,
- UAE Personal Data Protection Law, Federal Decree-Law No. 45 of 2021,
- sector-specific data residency and security requirements.

**Platform position:** The prototype uses aggregated data, non-personal data, and ward-level or grid-level population estimates only. No household-level personal data is processed.

**Safe statement:**

> The prototype uses aggregated, non-personal urban data by default. Production deployments will undergo data governance and legal review.

---

# 6. Future Phase — East Asia Standards

Planned prior to Shenzhen expansion, after the initial prototype phase.

**Singapore / Virtual Singapore:** semantic 3D city models, CityGML/CityJSON alignment, high-precision geospatial integration, building-use semantics, planning analytics.

**China / Shenzhen CIM:** City Information Modeling patterns, BIM + GIS + IoT integration, large-scale tile streaming, local cloud deployment, Chinese-language metadata, smart-city command center integration.

**Safe statement:**

> East Asia standards alignment is planned for a future phase prior to Shenzhen deployment.

---

# 7. Standards Alignment Matrix

| Standard / Framework | Region | Purpose | Current Status | Demonstration Target |
|---|---|---|---|---|
| OGC CityGML / CityJSON | Global | Semantic 3D city models | Prototype planned | Sample CityJSON mapping |
| OGC 3D Tiles | Global | 3D streaming | Prototype planned | Sample tileset manifest |
| OGC API Features patterns | Global | Geospatial APIs | Prototype planned | GeoJSON collection endpoints |
| buildingSMART IFC / ISO 16739 | Global | BIM exchange | Not started | Roadmap only |
| Gemini Principles | UK / Western | Digital twin governance | Design alignment | Governance statement |
| FIWARE NGSI-LD | EU / Global | Smart-city context API | Prototype planned | Sample entities |
| ISO 37120 / 37122 | Global | City indicators | Planned | KPI mapping page |
| ISO 19650 | Global | BIM information management | Planned | Documentation roadmap |
| Dubai Pulse / DDA | Dubai | Digital city ecosystem | Planned alignment | Integration pathway page |
| Dubai Municipality GIS/BIM | Dubai | Municipal planning | Planned | Planning report concept |
| UAE Data Governance | UAE | Privacy and data compliance | Prototype policy pages | Governance pages |
| Virtual Singapore | Singapore | Semantic national twin | Future phase | Later phase |
| China CIM / Shenzhen | China | City Information Modeling | Future phase | Pre-Shenzhen |

---

# 8. API Surface

## 8.1 Endpoint Index

| Endpoint | Standard | Returns |
|---|---|---|
| `/api/standards` | — | Machine-readable alignment matrix |
| `/api/openapi.json` | OpenAPI | Full API description |
| `/api/collections/wards` | OGC API Features | Collection metadata |
| `/api/collections/wards/items` | OGC API Features | Ward feature collection (GeoJSON) |
| `/api/collections/wards/items/:id` | OGC API Features | Single ward feature (GeoJSON) |
| `/api/wards/:id/metadata` | — | Ward manifest, lineage, confidence |
| `/api/wards/:id/cityjson` | OGC CityJSON | LOD1/LOD2 semantic city model |
| `/api/wards/:id/3d-tiles/tileset.json` | OGC 3D Tiles | Tileset manifest |
| `/api/ngsi-ld/entities` | FIWARE NGSI-LD | Entity collection |
| `/api/ngsi-ld/entities/:id` | FIWARE NGSI-LD | Single entity |

## 8.2 Response Conventions

All endpoints should:

- serve over HTTPS only,
- return `application/json` (or `application/geo+json` for Features endpoints),
- declare CRS as `EPSG:4326` unless otherwise stated,
- include a `status: "prototype"` field or header where a payload is illustrative,
- carry confidence and lineage metadata alongside any derived value,
- validate all query parameters and reject unrecognized ones,
- be read-only in the prototype phase.

## 8.3 Supporting Public Pages

```txt
/standards
/data-sources
/data-governance
/privacy
/uncertainty
/attribution
/roadmap
```

---

# 9. Sample Payloads

All samples below are **illustrative only**. Production responses must be schema-validated before any certification claim.

## 9.1 Ward Manifest — `/api/wards/:id/metadata`

```json
{
  "schemaVersion": "0.4.0-audit-corrected",
  "status": "prototype",
  "crs": "EPSG:4326",
  "generatedAt": "2026-08-16T00:00:00Z",
  "standardsAlignment": {
    "ogcCityGMLCityJSON": "prototype_sample",
    "ogc3DTiles": "prototype_sample",
    "ogcAPIFeatures": "prototype_pattern",
    "fiwareNGSI_LD": "prototype_sample",
    "iso37122KPI": "mapping_planned",
    "dubaiPulse": "integration_pathway_documented",
    "buildingSMART_IFC": "roadmap_only"
  },
  "wards": {
    "kmc_ward_068": {
      "name": "Ballygunge, Kolkata",
      "bbox": [88.3812, 22.5411, 88.4125, 22.5623],
      "model_url": "https://cdn.deltaclimate.earth/assets/3d/wards/kmc_ward_068.glb",
      "cityjson_url": "/api/wards/kmc_ward_068/cityjson",
      "tileset_url": "/api/wards/kmc_ward_068/3d-tiles/tileset.json",
      "dataConfidence": {
        "buildingHeight": "medium",
        "landSurfaceTemperature": "medium",
        "vegetation": "low_to_medium",
        "population": "medium"
      },
      "physics_data": {
        "peak_solar_irradiance_w_m2": 820,
        "roof_albedo_avg": 0.15,
        "avg_canopy_height_m": 8.5,
        "population_exposed_high_heat": 12500
      }
    },
    "dubai_borough_01": {
      "name": "Dubai Urban Core",
      "bbox": [55.2600, 25.1900, 55.3000, 25.2200],
      "model_url": "https://cdn.deltaclimate.earth/assets/3d/wards/dubai_borough_01.glb",
      "cityjson_url": "/api/wards/dubai_borough_01/cityjson",
      "tileset_url": "/api/wards/dubai_borough_01/3d-tiles/tileset.json",
      "dataConfidence": {
        "buildingHeight": "medium_to_high",
        "landSurfaceTemperature": "medium",
        "vegetation": "low",
        "population": "medium"
      },
      "physics_data": {
        "peak_solar_irradiance_w_m2": 1050,
        "facade_glare_index": "HIGH",
        "ac_energy_load_reduction_potential": "18%"
      }
    }
  }
}
```

## 9.2 CityJSON — `/api/wards/:id/cityjson`

```json
{
  "type": "CityJSON",
  "version": "2.0",
  "transform": {
    "scale": [0.001, 0.001, 0.001],
    "translate": [88.3639, 22.5726, 0]
  },
  "metadata": {
    "identifier": "kmc_ward_068_sample_building",
    "referenceDate": "2026-08-16",
    "referenceSystem": "EPSG:4326",
    "lineage": {
      "source": "Overture Maps / OSM fallback",
      "confidence": "medium"
    }
  },
  "CityObjects": {
    "building_1042": {
      "type": "Building",
      "geometry": [
        {
          "type": "MultiSurface",
          "lod": "2",
          "boundaries": []
        }
      ],
      "attributes": {
        "height_m": 12.5,
        "height_source": "overture_maps",
        "roof_albedo": 0.15,
        "ward_id": "kmc_ward_068"
      }
    }
  },
  "vertices": []
}
```

**Validation notes:** `boundaries` and `vertices` are unpopulated in this sample. Production CityJSON must be validated against the 2.0 schema before publication.

## 9.3 3D Tiles Manifest — `/api/wards/:id/3d-tiles/tileset.json`

```json
{
  "asset": {
    "version": "1.1"
  },
  "geometricError": 500,
  "root": {
    "boundingVolume": {
      "region": [
        1.5423,
        0.3938,
        1.5431,
        0.3941,
        0,
        120
      ]
    },
    "geometricError": 100,
    "refine": "ADD",
    "content": {
      "uri": "kmc_ward_068_root.glb"
    }
  }
}
```

**Validation notes:**

- Region values must be correctly converted to radians.
- Production tilesets require a proper tiling pipeline with real geometric error values.
- This sample must not be presented as a fully optimized tileset.

## 9.4 NGSI-LD Entity — `/api/ngsi-ld/entities/:id`

```json
{
  "@context": [
    "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.6.jsonld"
  ],
  "id": "urn:ngsi-ld:BuildingHeatExposure:kmc-ward-068:building-1042",
  "type": "BuildingHeatExposure",
  "wardId": {
    "type": "Property",
    "value": "kmc_ward_068"
  },
  "surfaceTemperature": {
    "type": "Property",
    "value": 33.4,
    "unitCode": "CEL"
  },
  "roofAlbedo": {
    "type": "Property",
    "value": 0.15
  },
  "heightMeters": {
    "type": "Property",
    "value": 12.5
  },
  "heatRiskLevel": {
    "type": "Property",
    "value": "SEVERE"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [88.3639, 22.5726]
    }
  }
}
```

**Note:** `surfaceTemperature` is land surface temperature, not air temperature or human thermal comfort. Any consuming system must be told this explicitly.

---

# 10. Metadata, Lineage, and Confidence Requirements

Certification and municipal acceptance both depend on traceable data provenance. Every API response carrying a derived value must be able to answer: where did this come from, and how much do you trust it?

## 10.1 Confidence Levels

| Confidence | Meaning |
|---|---|
| High | Authoritative or directly measured source |
| Medium | Derived from reliable open dataset with reasonable coverage |
| Low | Estimated, interpolated, or incomplete source data |
| Unknown | Insufficient information to assess confidence |

## 10.2 Required Lineage Fields

```json
{
  "layer": "building_height",
  "source": "Overture Maps",
  "source_date": "2026-05-01",
  "processing": "Spatial join, OSM fallback, ward median fallback",
  "crs": "EPSG:4326",
  "confidence": "medium",
  "known_limitations": [
    "Missing height values in some areas",
    "Possible outdated OSM tags",
    "No drone validation"
  ]
}
```

## 10.3 Building-Level Metadata

```json
{
  "building_id": "kmc_ward_068_building_1042",
  "height_m": 12.5,
  "height_source": "overture_maps",
  "height_confidence": "medium",
  "levels_estimate": 4,
  "levels_source": "osm_fallback",
  "roof_material_estimate": "concrete",
  "albedo_estimate": 0.15,
  "vegetation_nearby_m2": 85.2,
  "last_updated": "2026-08-16"
}
```

## 10.4 Mandatory Uncertainty Statement

Every standards-facing surface — API documentation, `/standards`, `/uncertainty`, and any evidence pack — must carry:

> The platform provides planning-grade estimates based on open data and simplified physical models. Outputs are intended for scenario exploration and prioritization, not certified engineering, legal, or medical decision-making.

---

# 11. API Security and Access Control

## 11.1 Prototype Requirements

- read-only public endpoints,
- no personal data,
- aggregated population data only,
- query parameter validation,
- API request rate limiting,
- HTTPS everywhere,
- no exposure of internal infrastructure details.

## 11.2 Production Roadmap

- authentication,
- API keys,
- role-based access control,
- audit logs,
- data residency controls,
- secret management,
- rate limiting,
- CORS restrictions,
- monitoring and alerting.

## 11.3 Approved Statement

> The current prototype exposes read-only public demonstration endpoints. Production deployments will support authentication, role-based access control, audit logs, and data residency controls.

---

# 12. Licensing and Attribution Obligations

Any data served through a standards endpoint carries its source license with it. Attribution is a distribution requirement, not a courtesy.

## 12.1 Sources Requiring Attribution — CORRECTED 2026-08-18

The original table listed sources we do not ship and omitted ones we do. This is what the
artefacts actually carry, per city. Licences were verified from primary sources (see the WETEX
spec §8a and `docs/research/2026-08-11-open-source-physics-libraries.md`).

**Kolkata (shipped today)**

| Layer | Source | Licence |
|---|---|---|
| Building footprints | Overture Maps (OSM + Google + Microsoft, GERS-deduplicated) | ODbL-1.0 — attribution + share-alike; the Produced-Work vs Derivative-Database question is open (spec §8a) |
| Building heights | Google Open Buildings 2.5D Temporal (zonal p65) | CC BY 4.0 |
| Surface (veg fraction, albedo) | Sentinel-2 L2A via Earth Search STAC | Copernicus Sentinel data terms |
| Canopy / trees | Meta / WRI Canopy Height Map | CC BY 4.0 |
| Meteorological forcing | NASA POWER | NASA data policy (attribution recommended) |
| Live ambient readout | Met Norway (met.no) | NLOD / CC BY 4.0 |
| Thermal validation | ECOSTRESS L2T LSTE v002 via LP DAAC | NASA data policy |
| Height validation | ICESat-2 | NASA data policy |

**Dubai (in progress)**

| Layer | Source | Licence |
|---|---|---|
| Building footprints | Microsoft GlobalMLBuildingFootprints — taken direct, never via Overture | CDLA-Permissive-2.0 |
| Building polygons | 3D-GloBFP (heights NOT used — regress to the mean on towers) | CC BY 4.0 |
| **Building heights** | **WSF3D (DLR, TanDEM-X)** | **CC BY 4.0 — "World Settlement Footprint 3D (WSF3D) © DLR"** |
| Surface | Sentinel-2 L2A | Copernicus terms |
| Meteorological forcing | NASA POWER | NASA data policy |
| Thermal validation | ECOSTRESS | NASA data policy |

**Ruled out — do not attribute, do not use:** Open-Meteo (non-commercial), WAQI (non-commercial),
GlobalBuildingAtlas (ODbL-derived), Google Photorealistic 3D Tiles (ToS forbids analysis),
Cityweft (EULA forbids product integration), NASA GEDI (not used — CHM is Meta/WRI).

## 12.2 Attribution Text — RETIRED 2026-08-18

The hand-written paragraph that stood here would drift, and already had (it named Open-Meteo,
Google Open Buildings for Dubai, and GEDI). `/attribution` is **generated at build time** from
`public/heat-map/data/{ward}-provenance.json` and `surface-meta.json`, with licence strings held
in one map keyed by dataset name. **A dataset with no licence entry fails the build**, so a new
source cannot ship un-attributed.

## 12.3 Pre-Deployment Review

Before commercial or government deployment, review OSM ODbL obligations, Overture source licenses, CC BY attribution requirements, satellite data terms, and population data terms.

## 12.4 Legal Disclaimer

> This platform does not constitute legal, engineering, medical, or official municipal advice. Data governance, licensing, and compliance requirements should be reviewed by qualified legal counsel before production deployment.

---

# 13. Certification Readiness Checklist

## 13.1 Language and Claims

- [ ] No "certified" claims unless a certificate exists.
- [ ] No official Dubai Pulse integration claims.
- [ ] No medical or engineering guarantees.
- [ ] Standards matrix uses "alignment" status throughout.
- [ ] Land surface temperature clearly separated from human comfort in all API field descriptions.

## 13.2 API Surface

- [ ] `/api/standards` returns the current alignment matrix.
- [ ] `/api/openapi.json` describes every published endpoint.
- [ ] All OGC API Features endpoints return valid GeoJSON.
- [ ] CityJSON response validates against the 2.0 schema.
- [ ] 3D Tiles bounding volumes verified in radians.
- [ ] NGSI-LD entities resolve against the declared `@context`.
- [ ] Every derived value carries confidence and lineage metadata.

## 13.3 Governance

- [ ] `/standards`, `/data-sources`, `/data-governance`, `/privacy`, `/uncertainty`, `/attribution`, `/roadmap` are live.
- [ ] Uncertainty statement visible on every standards-facing page.
- [ ] All data sources attributed.
- [ ] Licences documented.
- [ ] Security basics documented.

---

# 14. Roadmap to Formal Certification

| Phase | Standards Objective |
|---|---|
| Phase 1 — Prototype | Sample endpoints live; alignment matrix published; uncertainty and attribution pages in place |
| Phase 2 — Municipal Pilot | Schema validation against OGC and NGSI-LD specifications; RBAC and API keys; validation against local sensor data |
| Phase 3 — Production Integration | Formal governance review; official integration discussions; optimized 3D Tiles; full CityGML/CityJSON export; IFC/BIM pathway; audit logs; data residency controls |
| Phase 4 — East Asia Expansion | Virtual Singapore alignment; Shenzhen CIM preparation; Chinese-language metadata; local cloud deployment |

---

# 15. Standards Evidence Pack

The one-page standards summary and technical evidence pack should contain:

1. Standards alignment matrix (section 7).
2. Endpoint index (section 8.1).
3. Sample CityJSON response (section 9.2).
4. Sample 3D Tiles manifest (section 9.3).
5. Sample NGSI-LD entity (section 9.4).
6. Ward manifest with confidence metadata (section 9.1).
7. ISO-inspired KPI mapping (section 4.3).
8. Dubai Pulse integration pathway statement (section 5.1).
9. Governance and security statement (section 11.3).
10. Uncertainty statement (section 10.4).

Live demo verification before presenting:

- [ ] Sample API endpoints respond.
- [ ] Standards page loads.
- [ ] Attribution page loads.
- [ ] No overclaiming language appears anywhere in the demo path.

---

# End of Standards & API Specification v1.0

Source of truth for standards claims and API contracts. Any change to an endpoint, payload, or alignment status must be reflected here before it appears in external material.