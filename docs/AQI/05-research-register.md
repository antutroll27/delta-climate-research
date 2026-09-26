# AQI Research Register

**Version:** 1.2  
**Research cut-off:** 26 September 2026  
**Status:** Living register  
**Purpose:** Separate verified findings, working decisions and unresolved validation

## 1. Evidence-status vocabulary

| Status | Meaning |
|---|---|
| Verified | Checked against an authoritative source or the repository artefact |
| Research snapshot | Checked on the stated date; expected to change and must be refreshed |
| Decision | Agreed implementation direction based on current evidence |
| Open | Needs validation before the dependent feature ships |
| Superseded | Earlier repo assumption replaced by newer evidence |

## 2. Findings register

| ID | Status | Finding | Consequence |
|---|---|---|---|
| AQI-R01 | Verified | CPCB is the appropriate named AQI standard for Indian OBOS cities | Do not show US EPA AQI as the default Indian index |
| AQI-R02 | Verified | CPCB AQI is the maximum valid pollutant sub-index, subject to pollutant and completeness rules | Store sub-indices and dominant pollutant; do not average them |
| AQI-R03 | Verified | The repository contains seven historical WBPCB/OpenCity station archives and a daily derivation script | Preserve as historical evidence, not a live feed |
| AQI-R04 | Research snapshot | OpenAQ v3 exposes live station coordinates, timestamps, parameters, ownership and provider provenance | Use as the first live acquisition adapter and allowlist CPCB/WBPCB/KSPCB government monitors |
| AQI-R05 | Research snapshot | OpenAQ location `10918` represents Ballygunge and was reporting through WBPCB/CPCB | Validate current status and boundary containment at implementation time |
| AQI-R06 | Research snapshot | OpenAQ location `3409509` at SVSPA Campus provides newer Barrackpore-area coverage from around February 2025 | Supersedes the blanket “no Barrackpore station” assumption |
| AQI-R07 | Research snapshot | No continuous live CAAQMS source was verified for Baruipur; manual NAMP monitoring exists | Show no continuous live coverage unless discovery changes |
| AQI-R08 | Verified from supplied feed | WAQI station `A567541` is Sarsuna College, not Ballygunge | Do not map it to the Ballygunge ward |
| AQI-R09 | Verified from published terms | WAQI's public API terms do not support the planned commercial production use without an agreement | Exclude it from production despite permission to use the shared token |
| AQI-R10 | Research snapshot | data.gov.in's CPCB feed is commercially usable under GODL-India, but its advertised schema omits an observation timestamp, unit and averaging semantics; live probes also returned HTTP 500/504 | Retain as official fallback/cross-check, not the sole runtime dependency |
| AQI-R11 | Research snapshot | Google Air Quality can provide a modelled `ind_cpcb` estimate at much denser resolution | If used, publish it as a separate modelled layer after legal/attribution review |
| AQI-R12 | Verified from platform and repository evidence | Vercel deploys TypeScript functions from the existing project's `api` directory, and OBOS already uses this pattern for live weather and Climate Clock | Add AQI to the existing Astro/Vercel project rather than operating a separate FastAPI service |
| AQI-R13 | Verified from platform docs | Vercel Functions do not provide durable local storage | The live cached pilot needs no database; use managed PostgreSQL when durable history is introduced |
| AQI-R14 | Verified from platform docs | Hobby cron is too infrequent for hourly ingestion | Use on-demand reads with shared CDN caching first; add an external or upgraded scheduler only for durable archival |
| AQI-R15 | Decision | Shared TypeScript domain types plus runtime schema parsing form the type-safety boundary | The function and Astro UI share one response union; malformed upstream payloads must fail validation |
| AQI-R16 | Decision | Future first-party ESP32-S3 devices will use authenticated HTTPS batches for their initial pilot | Defer all device ingestion until the government-station product is validated; defer MQTT until fleet requirements justify it |
| AQI-R17 | Research snapshot | OpenCity's Kolkata and Bengaluru CKAN resources expose useful station history, but the verified Kolkata records end on 31 December 2025 | Use for research, fixtures and backfill; do not label it live |
| AQI-R18 | Research snapshot | CPCB and KSPCB publish monitoring pages and reports, but no stable documented state-board JSON API was verified; the tested WBPCB hourly host did not resolve | Avoid reverse-engineering dashboards; revisit official interfaces periodically |
| AQI-R19 | Verified 26 Sep | OpenAQ v3 rejects keyless requests (HTTP 401); the project key, stored server-side at `~/.config/delta-climate/openaq-key` for development, returns HTTP 200 | Every OpenAQ call needs `X-API-Key`; production uses the `OPENAQ_API_KEY` Vercel variable |
| AQI-R20 | Verified 26 Sep | Ballygunge `10918` sits at 22.53675 N, 88.36380 E (KMC Ward 69), 1.0 km from the OBOS centre, inside the 3 km window but 268 m outside the 1.4 km box | Covered under the 3 km-window rule |
| AQI-R21 | Verified 26 Sep | Barrackpore `3409509` (SVSPA Campus) sits at 22.76056 N, 88.36176 E, 1.0 km from the OBOS centre, inside the 3 km window but 302 m outside the 1.4 km box | Covered under the 3 km-window rule |
| AQI-R22 | Verified 26 Sep | OpenAQ's raw 15-minute PM2.5 for Ballygunge equals the OpenCity archive reading for reading (2025-12-15); OpenCity stamps each reading at its IST end time | OpenAQ passes WBPCB values through faithfully |
| AQI-R23 | Verified 26 Sep | OpenAQ omits one quarter-hour in four (the one ending at IST :45), so its `/hours` means differ from the full data by about 6 µg/m³ per hour (PM2.5, December 2025) | Build IST-hour means from raw readings; never use `/hours` |
| AQI-R24 | Verified 26 Sep | CO, NO₂ and SO₂ appear as two sensors each at Ballygunge (ppb and µg/m³) | Select sensors by unit for CPCB breakpoints |
| AQI-R25 | Research snapshot 26 Sep | All 425 CPCB-provided monitors on OpenAQ in India stopped at 2026-09-24 17:30 UTC; data.gov.in's CPCB API returned 504 after 60 s and 502 on retry | National outage upstream of OpenAQ; the UI must handle stale data; re-check before release |
| AQI-R26 | Verified 26 Sep | OpenAQ returns an empty licence list for both Kolkata locations | The licence and attribution gate is not closed by the API; confirm terms with OpenAQ and the provider |
| AQI-R27 | Verified 26 Sep | OpenCity's Ballygunge resource labels pressure "BP (mmHg)" but holds values near 1,010, which can only be hPa | Check every archive column's unit before use |
| AQI-R28 | Research snapshot 26 Sep | No government station lies inside the 3 km window of any Bengaluru area; the nearest live ones are 3.8–4.0 km away, and Whitefield has none within 8 km | Bengaluru parked for the first release |
| AQI-R29 | Research snapshot 26 Sep | KSPCB runs 13 manual NAMP stations in Bengaluru and publishes a monthly AQI for each (August 2026 report); TERI Domlur is 1.7 km from Indiranagar | Candidate monthly source when Bengaluru resumes; official coordinates still needed |
| AQI-R30 | Research snapshot 26 Sep | An AirGradient low-cost sensor in Koramangala reports live on OpenAQ under CC BY 4.0 | Not a government instrument; usable only as a separately labelled class, if ever |

## 3. Superseded assumptions

| Earlier assumption | Current position | Source of change |
|---|---|---|
| Barrackpore has no station | A newer continuous-monitoring candidate exists; exact assignment remains to be validated | Current OpenAQ station discovery |
| AQI provider key may be placed in a `PUBLIC_*` variable | All provider credentials remain in server-only Vercel environment variables | Same-project server-function decision and credential-security requirements |
| AQI requires a separate FastAPI deployment | A TypeScript Vercel Function in the existing Astro project supplies the required server boundary | Existing `api/*.js` pattern and reduced pilot operating scope |
| Three pollutants including one PM pollutant is the complete validity rule | Minimum observation-hours requirements also apply | CPCB method review |
| A WAQI URL supplied with permission is sufficient for production | Permission to use a token does not replace service licensing, and the supplied station is not Ballygunge | WAQI terms and feed identity check |
| City-wide station count can be fixed in product copy | Stations change; discover and report selected instruments dynamically | New Barrackpore station and inconsistent historical counts |
| OpenAQ's hourly aggregates can feed the CPCB calculation | Hourly means are built from raw readings in IST hours | AQI-R23 (26 Sep 2026) |
| The first release covers Kolkata and Bengaluru | Kolkata only; Bengaluru parked | AQI-R28, founder decision 26 Sep 2026 |
| Coverage is judged against the OBOS 1.4 km box | Coverage is judged against the 3 km window | Founder decision 26 Sep 2026; both Kolkata stations lie just outside the 1.4 km box |

## 4. Authoritative and supporting sources

### Standards and government data

- [CPCB National Air Quality Index](https://cpcb.nic.in/National-Air-Quality-Index/)
- [CPCB AQI final report](https://app.cpcbccr.com/ccr_docs/FINAL-REPORT_AQI_.pdf)
- [CPCB AQI calculator workbook](https://app.cpcbccr.com/ccr_docs/AQI-Calculator.xls)
- [Government Open Data License — India](https://data.gov.in/government-open-data-license-india)
- [OpenCity Kolkata hourly air-quality resource](https://data.opencity.in/dataset/kolkata-hourly-air-quality-reports/resource/ee55ee45-a774-4e91-81c7-6296d388e62d)
- [KSPCB air-quality reports (monthly CAAQMS and manual)](https://kspcb.karnataka.gov.in/environmental-monitoring/air)
- [CPCB NAMP manual network list](https://cpcb.gov.in/uploads/stations_namp.pdf)

### Provider and platform documentation

- [OpenAQ documentation](https://docs.openaq.org/)
- [WAQI API terms](https://aqicn.org/api/terms/)
- [Google Air Quality API overview](https://developers.google.com/maps/documentation/air-quality/overview)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel Cache-Control headers](https://vercel.com/docs/caching/cache-control-headers)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

### Repository evidence

- `docs/superpowers/specs/2026-08-13-aqi-overlay-design.md`
- `docs/evidence/data-sources.md`
- `docs/evidence/regulatory-and-licensing.md`
- `scripts/build-aqi-daily.py`
- `data/opencity/aqi-daily.json`
- `src/data/cities.ts`
- `api/live.js`
- `astro.config.mjs`
- `vercel.json`

## 5. Validation backlog

| Priority | Question | Required evidence | Blocks |
|---|---|---|---|
| P0 | Does the official workbook use the maximum of rolling 8-hour means for CO/O3, or another exact convention? | Reproduced workbook cases with documented inputs/outputs | CPCB engine |
| P0 | How is the 16-hour rule applied to each pollutant and partial window? | Official report/workbook interpretation and fixtures | CPCB engine |
| ~~P0~~ Done 26 Sep | ~~Are OpenAQ station coordinates inside the exact OBOS analysis boundaries?~~ Both Kolkata stations are inside their 3 km windows (AQI-R20, R21) | Versioned polygons and point-in-polygon output | — |
| P0 | Is the national CPCB feed back, and are the Kolkata stations reporting again? | A fresh `latest` reading from `10918` and `3409509` | Live display |
| P0 | What attribution/licence metadata does each chosen OpenAQ-origin provider require? | Recorded provider metadata and terms | Production release |
| P1 | What nearby radius is scientifically and product-appropriate? | Sensitivity analysis plus honest UX copy | Nearby-station UI |
| P2 | Which particulate and environmental sensors pass the bench/co-location evaluation? | BOM comparison and reference-monitor data | Future ESP32 field pilot |
| P2 | Which PostgreSQL provider/region minimizes latency and operational cost? | Small deployment benchmark and plan comparison | Future durable government-station history |
| P2 | Can Google modelled AQ be displayed with MapLibre under current terms? | Legal/terms review and attribution design | Optional modelled layer |
| P2 | When does HTTPS ingestion stop meeting fleet requirements? | Observed fleet throughput, reconnect and command requirements | MQTT/queue decision |

## 6. Change-control rule

When a dynamic fact changes, update this register and the affected product decision
in the same pull request. Do not silently update a station mapping, AQI algorithm or
licensing assumption in code alone. Changes to the calculation method require a new
algorithm version and reproducibility fixtures.
