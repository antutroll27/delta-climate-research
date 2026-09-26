# OBOS Air Quality Intelligence

**Document set:** Product and engineering plan  
**Version:** 1.2  
**Date:** 26 September 2026  
**Status:** Kolkata first release built on branch `feat/aqi-kolkata`; not deployed  
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

### What shipped on the branch (not deployed)

The work is on branch `feat/aqi-kolkata`. It is **not merged, not pushed to production and not deployed**.

- `api/air-quality.ts` is a TypeScript Vercel Function. It reads `OPENAQ_API_KEY` on the server only. It fails closed with 503 and `no-store` when the key is missing, and it caches successful responses at the CDN (`s-maxage=600`, `stale-while-revalidate=1800`).
- `src/lib/aqi/` holds the logic:
  - the shared contract (`types.ts`);
  - the CPCB arithmetic `cpcb-aqi-1`, which follows CPCB's calculator (AQI-R40);
  - IST hour-building from raw quarter-hours;
  - the station registry, with verified per-sensor units;
  - the OpenAQ client, which sends the key only as a header;
  - the payload builder, covering the five states `live`, `stale`, `unavailable`, `insufficient_data` and `no_station`.
- OBOS has an **Air** rail section and pane, plus a right-panel block, for Ballygunge, Barrackpore and Baruipur. Baruipur shows `no_station`. A cached `live` payload is demoted to stale on the viewer's clock once it is more than 2 h old.
- Release gates on the branch head all pass: `npm run check`, `npm run typecheck`, `npm run test:py`, `npm run test:unit` (935 of 935) and `npm run build`. The key does not appear in any branch commit or in `dist/`.

| Area | Decision (26 Sep) |
|---|---|
| Scope | Ballygunge, Baruipur, Barrackpore. Bengaluru parked: no government station lies within any of its areas' 3 km windows |
| Station ↔ area rule | A station covers a place when it lies inside the place's **3 km window**; the distance is always shown |
| Server boundary | TypeScript Vercel Function `api/air-quality.ts` beside `api/live.js` (FastAPI considered and declined) |
| Feed late | Last valid AQI shown muted with its age for up to 7 days, then "Government feed unavailable" |
| History | The 30 complete IST days ending yesterday, as daily CPCB AQI, plus the last 24 h of PM2.5 the station reported, from OpenAQ; no database |
| Order of work | Contract → UI previews on fixtures → server function (done in that order) |

### Feed state observed on 26 September 2026

- **Every CPCB monitor in India stopped reporting to OpenAQ at 2026-09-24 17:30 UTC.** On the same day, data.gov.in's CPCB API returned 502/504. The outage was still in place on 26 September.
- As a result, **both stations are stale**. On the first live run, Ballygunge showed AQI 38 and Barrackpore AQI 34, both "Not Live · 45 h Old" (AQI-R41). If the outage passes 7 days (2026-10-01 17:30 UTC), both will show "Government feed unavailable". That is the designed behaviour, not a fault.
- Ballygunge (`10918`) and Barrackpore (`3409509`) are WBPCB monitors about 1.0 km from their OBOS centres, inside the 3 km windows. Baruipur has no station.
- OpenAQ's raw values match the OpenCity archive reading for reading, but its completeness varies. It was about 89 % of quarter-hours at Ballygunge over the 31 days before the outage (AQI-R42). Hourly means are built from raw data, never from OpenAQ's `/hours`.
- Both stations lost the same hours on 27–29 Aug 2026. The gap was upstream of OBOS (AQI-R45).
- A cold fetch takes about 7 s, and the CDN cache carries the load (AQI-R43).

### Founder actions before release

1. **Add `OPENAQ_API_KEY`** to the Vercel project's **Preview** and **Production** environments. Without it, the function returns 503 and the Air pane shows no data. Then confirm on the first Preview deployment that `/api/air-quality?area=in/kolkata/ballygunge` returns 200 (AQI-R44).
2. **Decide when to open the PR.** One option is to wait for the CPCB feed to resume so that `live` can be seen end to end. The other is to ship now, with the stale treatment showing.
3. **The repository is public.** Check that every document committed on this branch is fit to be public before the branch is pushed.

Details are in the [research register](./05-research-register.md), R19–R45.

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
