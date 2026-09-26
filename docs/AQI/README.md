# OBOS Air Quality Intelligence

**Document set:** Product and engineering plan  
**Version:** 1.2  
**Date:** 26 September 2026  
**Status:** First release scoped to Kolkata; design approved, implementation not started  
**Owners:** Delta Climate — OBOS product and engineering

## Purpose

This directory is the current plan for adding live air-quality intelligence from
government monitoring stations to OBOS. It consolidates the repo's earlier AQI
design, the live-source investigation, the ward-coverage findings, and the proposed
Astro/TypeScript server-function architecture. First-party ESP32 sensing remains
documented as a future extension and is outside the current release scope.

The plan has four goals:

1. show measured air quality without claiming more spatial precision than the
   monitoring network supports;
2. compute and label Indian AQI according to the CPCB standard;
3. establish a resilient API path over CPCB, WBPCB and KSPCB monitoring stations;
   and
4. preserve observations as a credible, provenance-rich data asset for later
   sustainability analysis and carefully validated ML work.

## Current state (26 September 2026)

The first release is **Kolkata only**, specified in
[`docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md`](../superpowers/specs/2026-09-26-aqi-kolkata-design.md).
Where that spec and these documents differ, the spec governs the first release.

| Area | Decision (26 Sep) |
|---|---|
| Scope | Ballygunge, Baruipur, Barrackpore. Bengaluru parked: no government station lies within any of its areas' 3 km windows |
| Station ↔ area rule | A station covers a place when it lies inside the place's **3 km window**; the distance is always shown |
| Server boundary | TypeScript Vercel Function `api/air-quality.ts` beside `api/live.js` (FastAPI considered and declined) |
| Feed late | Last valid AQI shown muted with its age for up to 7 days, then "Government feed unavailable" |
| History | Last 30 days of daily CPCB AQI plus the last 24 h of PM2.5, from OpenAQ; no database |
| Order of work | Contract → UI previews on fixtures → server function |

Verified on 26 September (details in the [research register](./05-research-register.md), R19–R30):

- The OpenAQ key works. Ballygunge (`10918`) and Barrackpore (`3409509`) are WBPCB monitors about 1.0 km from their OBOS centres, inside the 3 km windows. Baruipur has no station.
- OpenAQ's raw values match the OpenCity archive reading for reading, but OpenAQ omits one quarter-hour in four. Hourly means must be built from raw data, never from OpenAQ's `/hours`.
- **Every CPCB monitor in India stopped reporting to OpenAQ at 2026-09-24 17:30 UTC**, and data.gov.in's CPCB API returned 502/504. Nothing is live until the national feed resumes.

## Documents

| Document | Audience | Purpose |
|---|---|---|
| [01-product-and-data-plan.md](./01-product-and-data-plan.md) | Product, climate science, partnerships | Product behaviour, data-source decisions, ward coverage, CPCB method and claims policy |
| [02-system-architecture.md](./02-system-architecture.md) | Engineering, operations | Astro, TypeScript Vercel Functions, caching, security and optional persistence architecture |
| [03-api-and-device-contract.md](./03-api-and-device-contract.md) | Frontend, server functions, firmware | Proposed endpoints, shared TypeScript schemas and deferred ESP32 contract |
| [04-delivery-roadmap.md](./04-delivery-roadmap.md) | Founders, product, engineering | Phases, acceptance gates, cost controls, risks and open decisions |
| [05-research-register.md](./05-research-register.md) | Engineering, science, diligence | Verified findings, sources, superseded assumptions and validation backlog |
| [06-government-station-api-assessment.md](./06-government-station-api-assessment.md) | Engineering, product, diligence | Ranked government-station APIs, tested limitations, request shapes and implementation recommendation |

## Decision summary

| Area | Decision |
|---|---|
| Primary live measured-data source | OpenAQ v3, accessed only by the server-side AQI function |
| Regulatory standard in India | CPCB National AQI |
| Production server boundary | TypeScript Vercel Function in the existing Astro project |
| Initial deployment | The existing Vercel project; static Astro pages plus same-origin `/api` function |
| Frontend integration | Shared TypeScript types, runtime schemas and one typed fetch wrapper |
| Historical storage | None required for the live pilot; add managed PostgreSQL when durable history is justified |
| ESP32 transport | Deferred until after the government-station release |
| Map representation | Station markers and explicit coverage states; no unsupported ward-wide AQI surface |
| First-release scope | Kolkata only (decided 26 Sep 2026) |
| Area coverage rule | Station inside the place's 3 km window, distance always shown (decided 26 Sep 2026) |
| Missing live coverage | Display `no_station` or `insufficient_data`; never substitute zero or an invented value |
| External ingestion cadence | On-demand with caching during the pilot; scheduled archival added when justified |
| ML/RL use | Deferred until calibration, coverage, consent, provenance and evaluation gates are met |

## Relationship to earlier repository material

The earlier design at
[`docs/superpowers/specs/2026-08-13-aqi-overlay-design.md`](../superpowers/specs/2026-08-13-aqi-overlay-design.md)
remains valuable for its CPCB-first standard, non-interpolation rule, and separation
of air quality from the thermal solver. This document set supersedes its delivery
architecture and station-coverage snapshot where they conflict with newer findings.

In particular:

- the client-side `PUBLIC_*` token plan is replaced by server-only Vercel environment variables;
- OpenAQ is now the preferred live acquisition layer;
- Barrackpore has a newer continuous-monitoring candidate that must be evaluated
  dynamically rather than treated as permanently uncovered; and
- the CPCB completeness rule must include the minimum-hours test described in the
  official method, not only the three-pollutant rule.

The committed OpenCity material remains a historical archive:

- `data/opencity/aqi/*.csv`
- `data/opencity/aqi-daily.json`
- `scripts/build-aqi-daily.py`

Those files do not provide the proposed live feed and must not be presented as one.

## Documentation rules

- A measured value, a modelled estimate, and an OBOS device reading are separate
  data products and remain visibly labelled throughout the API and UI.
- Dynamic facts such as station count, provider limits and station operational
  status are revalidated before release; they are not copied into product claims.
- When durable archival is introduced, raw observations are retained alongside
  derived AQI values so calculations can be reproduced when standards or methods change.
- Every public value carries source, station or device identity, observation time,
  retrieval time, unit, averaging window and quality status.
- Air quality is a co-exposure layer. It does not enter the OBOS heat physics unless
  a separately reviewed scientific model establishes that relationship.
