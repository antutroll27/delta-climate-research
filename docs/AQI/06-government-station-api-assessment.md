# Government Station API Assessment

**Version:** 1.1  
**Research date:** 25 September 2026  
**Status:** Recommended source stack for the first AQI release  
**Scope:** CPCB, WBPCB and KSPCB government monitoring stations; no OBOS devices

## 1. Executive decision

Use **OpenAQ v3 as the operational API for government-station measurements** and
restrict accepted locations to known government providers and owners. Use the
official **CPCB data.gov.in API as the authority, station-discovery cross-check and
fallback**, but do not make it the only runtime dependency. Use **OpenCity's CKAN
API for historical backfill and test fixtures**, not for current readings.

This is the practical source hierarchy:

1. **OpenAQ v3** — timestamped measurements, hourly history, coordinates,
   completeness metadata and government owner/provider identity.
2. **CPCB via data.gov.in** — official nationwide hourly feed and commercial-use
   licensing under GODL-India, but a limited current schema and observed
   availability problems.
3. **OpenCity CKAN** — convenient 15-minute WBPCB/KSPCB archives through the end of
   2025; useful for backfill and tests, not live production status.
4. **State-board publications** — official human-readable validation material;
   currently unsuitable as a stable live JSON dependency.

“OpenAQ operational API” does not mean using crowdsourced instruments. The AQI function
must accept only locations whose metadata identifies an approved government owner
or provider, such as CPCB, WBPCB or KSPCB.

## 2. Ranked API matrix

| Rank | API | Government-station data | Time series | Authentication | Production role |
|---|---|---|---|---|---|
| 1 | OpenAQ v3 | Yes; provider/owner metadata identifies the government network | Raw, hourly and other aggregates with UTC/local periods and coverage | Free API key in `X-API-Key` | Primary live adapter |
| 2 | data.gov.in CPCB resource | Direct CPCB source | Advertised as hourly, but the current resource schema exposes only summary fields | data.gov.in API key | Authority, discovery, cross-check and degraded fallback |
| 3 | OpenCity CKAN DataStore | Republished CPCB/WBPCB/KSPCB observations | 15-minute and older hourly archives | No key for public reads | Backfill, fixtures and reconciliation |
| 4 | CPCB live portals | Direct CPCB | Human-facing live views | No documented public JSON contract found | Manual validation only |
| 5 | KSPCB air-quality page | Direct KSPCB | Monthly PDF reports | None | Monthly validation only |
| 6 | WBPCB hourly portal | Direct WBPCB | Intended hourly portal | Domain failed DNS during research | Do not depend on it |

## 3. API 1 — OpenAQ v3

### Why it is the best operational choice

OpenAQ exposes the information OBOS needs to make an honest station claim:

- location coordinates and station identity;
- instrument type, owner and provider;
- parameter, original unit and reported value;
- UTC and local observation periods;
- raw and hourly measurement endpoints;
- expected and observed counts for aggregates; and
- latest-reading and quality-flag endpoints.

Its official documentation states that `measurements` returns the original value
reported by the upstream provider and `hours` returns hourly means. This permits
OBOS to build CPCB 24-hour and 8-hour windows while retaining the source data.
See [OpenAQ measurements](https://docs.openaq.org/resources/measurements).

### Authentication and limits

Register an OpenAQ account and send the key only from the server-side AQI function:

```http
X-API-Key: ${OPENAQ_API_KEY}
```

The documented general-use allowance is currently 60 requests per minute and
2,000 per hour. Responses include rate-limit headers. See
[OpenAQ API keys](https://docs.openaq.org/using-the-api/api-key) and
[rate limits](https://docs.openaq.org/using-the-api/rate-limits).

### Relevant endpoints

```text
GET /v3/locations?coordinates={lat},{lon}&radius={metres}
GET /v3/locations/{location_id}
GET /v3/locations/{location_id}/sensors
GET /v3/locations/{location_id}/latest
GET /v3/sensors/{sensor_id}/measurements
GET /v3/sensors/{sensor_id}/hours
GET /v3/locations/{location_id}/flags
GET /v3/licenses/{license_id}
```

The location search radius is capped at 25 km. OBOS should search around each area,
then apply its own point-in-polygon and distance rules rather than treating the
closest result as automatically representative. See the
[OpenAQ locations operation](https://docs.openaq.org/api/operations/locations_get_v3_locations_get).

### Government-station allowlist

A discovered location is eligible only when all applicable checks pass:

1. stationary location with valid coordinates;
2. reference-grade or documented government monitor;
3. provider or owner belongs to the approved CPCB/WBPCB/KSPCB set;
4. source licence metadata permits the planned use;
5. latest measurement is within the freshness threshold; and
6. required pollutant sensors and window coverage are available.

Provider names must be normalized by stable provider/owner IDs after the initial
discovery. Do not accept a station because its display name merely contains “CPCB.”

### Verified Kolkata examples

| OpenAQ location | Government identity | Reporting evidence | OBOS treatment |
|---|---|---|---|
| `10918` — Ballygunge | Owner: West Bengal Pollution Control Board; provider: CPCB; government monitor | Reporting since 2 January 2020; current page reported recent updates on the research date | Direct candidate after boundary containment check |
| `3409509` — SVSPA Campus, Barrackpore | Owner: West Bengal Pollution Control Board; provider: CPCB; government monitor | Reporting since 18 February 2025; current page reported a recent update | Direct or nearby candidate after boundary containment check |

Evidence: [Ballygunge station](https://explore.openaq.org/locations/10918) and
[SVSPA Campus, Barrackpore](https://explore.openaq.org/locations/3409509).

No continuous government station has yet been verified for Baruipur. The API must
therefore return `no_station` unless live discovery produces a qualifying location.

### Terms and attribution gate

OpenAQ requires attribution to OpenAQ and to the original source where required.
It also states that users remain responsible for the underlying provider's terms
and must not scrape the Explorer interface. Use only the registered API or approved
exports. Retrieve and persist the API's licence record for every selected source.
See [OpenAQ terms of use](https://docs.openaq.org/about/terms).

## 4. API 2 — official CPCB feed through data.gov.in

### Resource

```text
Resource ID: 3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69
Base URL: https://api.data.gov.in/resource/{resource_id}
Granularity advertised by publisher: hourly
Publisher: Central Pollution Control Board, MoEFCC
Licence: Government Open Data License — India
```

Official catalogue:
[Real-time Air Quality Index from various locations](https://www.data.gov.in/resource/real-time-air-quality-index-various-locations).

Registered data.gov.in users can generate an API key. The official help page lists
API-key generation and API URL access as registered-user features. See
[data.gov.in help](https://www.data.gov.in/help).

### Intended request shape

```http
GET https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69
    ?api-key=${DATA_GOV_IN_API_KEY}
    &format=json
    &offset=0
    &limit=100
    &filters[city]=Kolkata
```

The TypeScript AQI function must URL-encode filters and keep the key server-side.
Validate the real response with a project-owned key before implementation; the live
probes performed during this assessment did not complete successfully.

### Current published fields

The resource metadata currently declares:

```text
country
state
city
station
latitude
longitude
pollutant_id
pollutant_min
pollutant_max
pollutant_avg
```

The declared schema omits an observation timestamp, explicit unit and definition of
the `min`, `max` and `avg` interval. Consequently, this response alone cannot prove
freshness or reconstruct the complete CPCB 24-hour/8-hour calculation windows.

### Reliability observation

On 25 September 2026, direct requests to the official endpoint produced a timeout,
HTTP 504 and HTTP 500 during separate small probes. This does not invalidate the
dataset, but it makes the endpoint unsuitable as OBOS's only live dependency.

Required controls:

- short connection/read timeouts;
- exponential backoff with a strict retry limit;
- last-known-good cache carrying its true observation age;
- circuit breaker after repeated upstream failures; and
- an OpenAQ adapter over the same government monitoring network.

## 5. API 3 — OpenCity CKAN archives

OpenCity republishes detailed CPCB/WBPCB/KSPCB station files through the standard
CKAN DataStore API. This is useful for building fixtures, reproducing rolling-window
calculations and backfilling recent history.

### Kolkata example

```text
Dataset: https://data.opencity.in/dataset/kolkata-hourly-air-quality-reports
Resource: ee55ee45-a774-4e91-81c7-6296d388e62d
API: https://data.opencity.in/api/3/action/datastore_search
     ?resource_id=ee55ee45-a774-4e91-81c7-6296d388e62d
     &limit=100
```

The Ballygunge resource contains 15-minute observations with timestamps and fields
for PM2.5, PM10, NO, NO2, NOx, NH3, SO2, CO, ozone and weather variables. A live API
probe found valid records through `2025-12-31T23:45:00`. It is therefore a detailed
archive, not a current September 2026 feed.

### Bengaluru archive

The [Bengaluru dataset](https://data.opencity.in/dataset/bengaluru-hourly-air-quality-reports)
contains station-specific KSPCB/CPCB resources, including BTM Layout, City Railway
Station, Hebbal, Hombegowda Nagar, Jayanagar, Kasturi Nagar, Peenya, RVCE
Mailasandra, Sanegurava Halli and Silk Board. Their coordinates and current status
still need to be obtained from live discovery before mapping them to Indiranagar,
MG Road or Whitefield.

### Use policy

- Use archive timestamps and source labels exactly as published.
- Do not call these resources live after their last observation date.
- Keep source attribution to the originating board and to OpenCity as distributor.
- Use them for calculation fixtures and trend views only after checking each
  resource's licence metadata.

## 6. State-board and CPCB portals

### CPCB

CPCB links to a Live Air Quality Index and live monitoring-station data from its
[air-quality data page](https://cpcb.gov.in/real-time-air-qulity-data/), but no stable,
documented public JSON contract was found for those interactive portals. OBOS should
not depend on reverse-engineered dashboard calls when an official data.gov.in API
and a documented OpenAQ API exist.

### KSPCB

The official [KSPCB air-quality page](https://kspcb.karnataka.gov.in/environmental-monitoring/air)
publishes current monthly CAAQMS and manual-monitoring PDFs. It exposes no documented
API on the page. Use the PDFs for periodic reconciliation and source audits, not as
the live application feed.

### WBPCB

The previously identified `aqmsdata.wbpcb.gov.in/hourly` host failed DNS resolution
during this assessment. No documented public WBPCB JSON API was found. Re-evaluate
it later, but do not put it on the runtime critical path now.

## 7. Server-function acquisition algorithm

### Station discovery

1. Query OpenAQ locations within 25 km of the OBOS area centre.
2. Filter to the approved government owner/provider IDs.
3. Reject mobile, stale, unlicensed or coordinate-less locations.
4. Apply point-in-polygon against the versioned OBOS area geometry.
5. Rank inside-area stations by completeness and freshness.
6. If none are inside, retain the nearest qualifying station as `nearby` with its
   distance; do not assign its AQI to the ward.
7. Cross-check station names and coordinates against data.gov.in whenever that feed
   is available.

### Measurement acquisition

1. Fetch location sensors and the required raw/hourly window from OpenAQ.
2. Normalize explicit source units while retaining the originals.
3. Require CPCB completeness rules before calculating an AQI.
4. Store or cache the raw inputs, source timestamps and algorithm version.
5. Return `insufficient_data`, `stale` or `source_unavailable` when applicable.
6. Reconcile a sample against CPCB and state-board reports; record discrepancies.

### Cache policy

- Location/station metadata: 24 hours, with background refresh.
- Latest measurements: 10–15 minutes.
- Historical rolling window: cache by sensor and window end for 15 minutes.
- Stale fallback: permitted only with the original observation time and a visible
  `stale` status.
- Negative coverage result: cache briefly, because networks can add stations.

## 8. Minimal first implementation

The first implementation slice should contain only:

```text
TypeScript Vercel Function at /api/air-quality
OpenAQ client
government provider/owner allowlist
station-to-area mapper
CPCB calculation module
GET /api/air-quality?area_id={area_id}
source/cross-check adapter for data.gov.in
structured cache and error states
```

Start with Ballygunge and Barrackpore. Baruipur should intentionally ship the
`no_station` state. Add Bengaluru only after current station coordinates have been
resolved against the three OBOS area geometries.

## 9. Release gates

- Project-owned OpenAQ and data.gov.in keys are provisioned as server-only Vercel
  environment variables.
- The selected OpenAQ location licence records allow the planned public use.
- Government provider/owner IDs are verified and covered by tests.
- CPCB calculation fixtures reproduce the official workbook.
- Station assignments are reproducible from a committed geometry version.
- The UI displays station name, owner, distance, standard, observation time and
  freshness.
- Provider outage tests prove that stale and unavailable states cannot appear as
  current clean air.
