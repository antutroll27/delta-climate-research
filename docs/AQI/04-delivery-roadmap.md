# AQI Delivery Roadmap

**Version:** 1.2  
**Date:** 26 September 2026  
**Status:** Kolkata first release in design; Phase 0 open  
**Constraint:** One technical lead; ship government-station AQI before device work

## 1. Delivery strategy

Build the smallest complete path before expanding coverage:

```text
one verified source
→ one correct CPCB calculation
→ one typed area endpoint
→ one frontend card/marker
→ one resilient government-station release
→ one durable history
```

The first proof point is not the number of dashboard features. It is that OBOS can
trace a displayed reading from instrument and timestamp through a reproducible
calculation to a clear coverage claim.

### Status on 26 September 2026

- **Scope:** Kolkata only; Bengaluru parked. (Bengaluru added 5 Oct 2026 from CPCB's feed: register AQI-R51; a ward whose nearest monitor is silent falls back to the nearest reporting one, AQI-R52.)
- **Work order:** contract → UI previews on fixtures → server function.
- **Phase 0 progress:**
  - done: the OpenAQ key is provisioned; the Kolkata stations' coordinates are verified against a versioned geometry (the 3 km windows); the coverage classification is reviewed for all three areas.
  - open: the CPCB workbook fixtures, including the CO/O₃ 8-hour convention and the 16-hour rule; OpenAQ attribution and licence records (OpenAQ returns no licence for the two Kolkata locations); rotating the WAQI token.
- **Blocking live display, not development:** the national CPCB feed has been down since 2026-09-24 17:30 UTC.

## 2. Phase 0 — scientific and contractual closure

**Objective:** Remove ambiguity before application code depends on it.

Tasks:

- Transcribe CPCB pollutant and AQI breakpoints from the official workbook.
- Verify the exact 8-hour treatment for CO and O3 against workbook outputs.
- Verify the 16-hour completeness rule for every pollutant/window.
- Produce calculation fixtures at breakpoints, just below/above breakpoints,
  missing-data cases and dominant-pollutant changes.
- Confirm OpenAQ attribution, provider metadata and production-use terms.
- Rotate the exposed WAQI token and keep WAQI outside the production design.
- Fetch current coordinates/status for candidate Kolkata and Bengaluru stations.
- Version the OBOS area geometry used for point-in-polygon assignment.

Exit criteria:

- The calculation specification has no unresolved numerical ambiguity.
- Golden fixtures reproduce official CPCB examples/workbook values.
- Every selected live source has recorded licence and attribution requirements.
- Ballygunge, Barrackpore and Baruipur each have a reviewed coverage classification.

## 3. Phase 1 — typed AQI function

**Objective:** Deliver a correct server-function response for a single area.

Tasks:

- Create `api/air-quality.ts` and the shared `src/lib/aqi` TypeScript modules.
- Add server-only environment validation and a `GET`-only request boundary.
- Implement an OpenAQ v3 client with timeouts, runtime-validated responses and fixtures.
- Implement the pure CPCB calculation module.
- Implement station/area mapping and explicit coverage states.
- Add `GET /api/air-quality?area_id={area_id}`.
- Add structured logging, request IDs and upstream-error handling.
- Define and export the shared `AirQualityResponse` discriminated union.

Exit criteria:

- Unit tests cover every breakpoint and validity rule.
- Contract tests cover inside, nearby, insufficient, stale and unavailable states.
- No upstream secret reaches the browser, logs or response payload.
- A cached request remains within the OpenAQ pilot allowance under expected traffic.

## 4. Phase 2 — Astro integration

**Objective:** Make one live measurement understandable inside OBOS.

Tasks:

- Add one typed fetch wrapper around `/api/air-quality`.
- Add the area air-quality card and station marker.
- Display standard, source, observation time, freshness and dominant pollutant.
- Add honest `nearby`, `no_station`, `insufficient_data` and error states.
- Keep AQI out of the thermal simulation and heat legend.
- Add accessible text equivalents; do not rely on category colour alone.
- Add analytics events for feature use without collecting precise user location.

Exit criteria:

- The UI never represents a nearby station as a ward measurement.
- Empty and stale states are usable and visually tested.
- The page passes existing accessibility and production-build checks.
- A user can reach methodology and attribution from the displayed value.

## 5. Phase 3 — government-station history

**Objective:** Turn government-station snapshots into a reproducible recent history.

### Raw hourly archive of CPCB's feed: the relay's only write (archive live since 4 Oct 2026; the only write since the single-write redesign, Oct 2026)

The ingest (`api/air-quality-ingest.ts`) keeps CPCB's whole national feed (~500 stations,
including Bengaluru's, for which there is no other history source) once per hour. Since the
single-write redesign this archive is **the only object the relay writes**: the Air card's current
figure, city mean, Bengaluru ladders and US NowCast are all read back from it
(`src/lib/aqi/cpcb-archive.ts`).

- **Path:** `cpcb/archive/YYYY/MM/DD/HH.xml.gz` in the private Blob store `obos-cpcb-relay`.
  `YYYY/MM/DD HH` is the **IST** wall-clock hour of CPCB's own `lastupdate`, which CPCB
  stamps in IST. So 00:00 IST on 6 Oct is `2026/10/06/00`, although that instant is
  18:30 UTC on 5 Oct. IST has no daylight saving, so every key is unambiguous. Keys are built
  from UTC getters plus 5:30, so the server's own time zone never enters (tested under four TZs).
- **Contents:** the gzip the Pi relay sent, byte for byte (CPCB's XML unchanged), with
  `access: private`, `addRandomSuffix: false`, `contentType: application/gzip`. There are no
  public URLs.
- **Exactly one put per new hour**, `allowOverwrite: false`, only after the signature, size, gzip
  and parser checks have passed. Stored → 200 `new`. Already there → 200 `duplicate`: the put's
  own refusal, confirmed by a `head` (a Simple Operation, never a second Advanced one); a repeat
  the same warm instance already stored costs no operation at all. Any other failure → 503, and
  the Pi retries at its next 15-minute tick.
- **First write wins.** A newer `lastupdate` inside an hour already archived is answered
  `duplicate` and not stored. CPCB stamps on the hour, so this has not been seen; if it happens,
  the card shows that hour's first feed until the next hour.
- **A 20 s deadline on the put.** The Blob SDK retries a 5xx or network error up to 10 times with
  backoff (1, 2, 4, 8, 16 s ...) and only notices an abort at its next attempt, so the put is raced
  against the deadline: at 20 s the answer is 503 whatever the SDK is doing. That leaves ~10 s of
  the function's 30 s `maxDuration` for the body, gunzip, parse and a cold start, and answers
  inside the Pi's own 30 s client timeout.
- **No latest, no NowCast record.** `cpcb/latest.xml.gz` and `cpcb/hourly-pm.json` are no longer
  written or read. They were left in the store (deleting is free but unnecessary).
- **Reading "current":** the reader walks the IST hours from the one containing "now" back
  `LIVE_H` (2 h), so 3 `get`s, and serves the newest it finds; three hours are exactly
  enough, since anything older is past `LIVE_H` anyway. Within 15 minutes of the next IST hour it
  asks that hour first (4 gets), because the ingest accepts a `lastupdate` up to 15 minutes ahead. A 404 means "try the hour before"; a read
  error is a failure (the same OpenAQ fallback for Kolkata, `upstream_error` for Bengaluru), never
  treated as missing. These probes bypass the CDN (`useCache: false`), because a cached 404 could
  hide an hour written a minute ago and Vercel does not document 404 caching. A found hour is kept
  in-process, so a warm instance only re-asks hours newer than the one it holds.
- **NowCast** is rebuilt from the 11 archived hours before the current one. Those hours are
  settled and immutable, so they are read through the CDN (a cache HIT is not a Simple Operation)
  and kept in-process. A missing hour is a gap, as in the old record, and is asked again (at
  origin) at each refresh, so a late hour is taken just as the old record took it. A parity test
  feeds the same submissions through the old record's logic and the new read-back and requires
  identical NowCasts for every tracked station (`tests/unit/aqi-nowcast.test.mjs`).
- **No index:** a reader computes the path and `get`s it. `list()` is an Advanced Operation, so
  nothing lists.
- **Size:** one feed is about 43 KB gzipped, so 24 × 365 × 43 KB ≈ 0.38 GB a year with no
  pruning; Hobby's 1 GB lasts about 2.5 years.

**Operation budget (Vercel Hobby: 2,000 Advanced and 10,000 Simple Operations a month; past
either, Blob is BLOCKED for 30 days and the Air card goes down).** A 31-day month has 744 hours.

| | Before (archive + latest + NowCast record) | After (archive only) |
|---|---|---|
| Ingest, per new hour | 3 puts (Advanced) + 2 uncached reads (Simple) | 1 put (Advanced), 0 Simple |
| Ingest, per month | 2,232 Advanced (over the cap ~1 Nov) + 1,488 Simple | **744 Advanced** + 0 Simple |
| A repeated hour | 1 refused put + 1 head | 0 on a warm instance; 1 refused put + 1 head on a cold one |
| Reader, per 10-minute refresh | 2 uncached reads (latest + record) | 0–3 uncached probes + NowCast hours from the CDN |
| Reader, one instance busy all month (a refresh every 10 min) | ≤ 12/h ≈ 8,928 Simple | ≈ 4/h ≈ 3,000 Simple (bound 7/h ≈ 5,200) |

The reader estimate: CPCB's hour `H:00` reaches the archive about 15–40 minutes into hour `H`
(measured on production, 6 Oct: `lastupdate` 01:00 IST served at 01:37 IST). Until it lands, each
refresh probes it once (a 404); when it lands, one read; for the rest of the hour, nothing. The
NowCast hours cost a Simple Operation only on a CDN miss: about once per hour object per Blob CDN
region, shared by production and every Preview (same store, same URLs), so at most ~744 a month
in all. Each warm instance that refreshes all month adds its own ~3,000; Previews read the store
too (PR #49 set `AIR_CPCB_FEED`/`AIR_CPCB_SOURCE` on Preview), but an idle Preview costs nothing
and checking one is about one cold refresh (2–3 probes; the six areas share one read). So the
realistic total is a few thousand Simple Operations a month, under the 10,000 cap. Before, one
busy instance (8,928) plus the ingest (1,488) was already over it.

During a relay outage (the store answers, but nothing within 2 h, or the newest too old), the
handler does not ask again for 10 minutes (`RELAY_QUIET_RETRY_MS`; a store that cannot be read
keeps the 60 s retry). So an outage costs at most 6 attempts of 3–4 probes, about 20 Simple
Operations an hour per busy instance (before: up to 120), and every request in between, including
Bengaluru's uncached failure answers, is answered from the in-process memo with no store operation.
A recovered relay shows within 10 minutes, as any new hour does.

**Do not browse the store in the Vercel dashboard, and do not run `vercel blob list`**: every
listing, folder click and blob detail view is an Advanced Operation. Monitor usage from
Observability → Blob instead.

Tasks:

- Store normalized government-station readings and source metadata in PostgreSQL.
- Add bounded history queries and a retention policy.
- Record provider, owner, station, source licence and upstream observation time.
- Preserve raw upstream payload hashes for reproducibility and debugging.
- Add idempotent scheduled ingestion only after on-demand reads are stable.
- Cross-check sampled OpenAQ observations against the CPCB/data.gov.in feed and
  official state-board reports.

Exit criteria:

- A sampled chart point can be traced to its government instrument and raw input.
- Duplicate ingestion does not create duplicate observations.
- Gaps, stale values and upstream outages remain explicit.
- Recalculation under a new algorithm version does not overwrite prior results.

## 6. Phase 4 — operational tooling

**Objective:** Turn snapshots into a reliable longitudinal dataset.

Tasks:

- Add provider archival only at a cadence justified by the product.
- Add database backup and restore testing.
- Add data exports with provenance and licence fields.
- Add alert thresholds for upstream staleness and ingestion failure.

Exit criteria:

- A sampled chart point can be traced to raw input and algorithm version.
- Restore testing meets the documented recovery objective.
- Operational alerts distinguish provider failure, stale station data and invalid data.

## 7. Phase 5 — future sensors, scale and research readiness

**Objective:** Expand only after the pilot produces trustworthy evidence.

Possible work:

- Select, calibrate and deploy the first OBOS ESP32-S3 device in an under-covered
  area after the government-station release is stable.
- Implement the deferred telemetry and per-device authentication contract.
- Introduce managed MQTT/IoT infrastructure if fleet behaviour requires it.
- Add PostGIS spatial queries and more formal administrative boundaries.
- Evaluate a clearly labelled modelled layer where measurements are absent.
- Build calibrated exposure and intervention studies.
- Prepare anonymized, consent-aware datasets for external research.

ML/RL work begins only after a research protocol defines the target, causal limits,
training/validation split, geographic transfer test, baseline and safety constraints.
Sparse station data and early low-cost devices are not sufficient evidence for claims
about improving neighbourhood or population outcomes.

## 8. Pilot cost controls

The initial plan is intended to fit a constrained prototype budget.

| Component | Pilot approach | Spend trigger |
|---|---|---|
| Frontend | Existing Vercel project | Existing account limits become material |
| AQI server function | Existing Vercel project and TypeScript runtime | Reliability or runtime limits require a dedicated service |
| Live station data | OpenAQ free allowance with shared caching | Measured traffic approaches limits or commercial support is required |
| Database | None for the cached live pilot | Durable hourly history or audit requirements justify managed PostgreSQL |
| Scheduling | On-demand fetch with caching | Durable hourly external archive becomes a product requirement |
| IoT messaging | Deferred | The future device fleet needs persistent commands, fan-out or sustained high throughput |
| Monitoring | Platform logs plus minimal error monitoring | Operational pilot requires paging/SLA |

Spend first on source correctness, calculation validation and reliable station-area
mapping. Device hardware expenditure begins only after the government-station product
has been validated and the first deployment has a defined research purpose.

## 9. Acceptance metrics

### Data correctness

- 100% pass rate against approved CPCB golden fixtures.
- Every public reading includes source, time, unit and quality status.
- Zero silent conversions of missing readings to zero.

### Reliability

- API success rate and latency target set after one week of observed pilot traffic.
- Upstream ingestion success, missing hours and latest-observation age are visible internally.
- Provider, calculation and cache failures produce different, actionable states.

### Coverage honesty

- 100% of station assignments can be reproduced from a geometry version.
- Every external-boundary station displays distance and `nearby` status.
- No measured AQI polygon/interpolation ships in the pilot.

### Product learning

- Track which areas users inspect and whether they open methodology/history.
- Collect pilot-user interviews about decisions the feature changes.
- Measure repeat use; do not use raw social reach as evidence of data utility.

## 10. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Sparse or changing stations | Coverage claims become stale | Dynamic discovery, versioned assignments and explicit absence states |
| CPCB method implemented incorrectly | Misleading public AQI | Official workbook fixtures and pure calculation tests |
| Future low-cost sensor drift | First-party history becomes unreliable | Co-location, calibration records, QC flags and scheduled maintenance |
| Token exposed in frontend or logs | Abuse and provider suspension | Server-only Vercel variables, redaction and rotation |
| Serverless scheduling limits | Gaps in external history | On-demand cache first; dedicated scheduler only when needed |
| Single developer bottleneck | Excess scope reduces correctness | Strict phase gates and one-area-first scope |
| Modelled and measured values blended | False precision | Separate evidence classes and UI treatments |
| Early ML claims outrun evidence | Reputational and scientific risk | Research-readiness gate and held-out geographic evaluation |

## 11. Decisions still required

These questions do not block documentation, but each blocks the indicated phase:

1. **CPCB CO/O3 calculation interpretation** — blocks Phase 1 calculation code.
2. ~~Exact area geometry for station containment~~ — **decided 26 Sep 2026:** the
   3 km window around each OBOS centre.
3. **Initial sensor and reference/co-location access** — blocks the future Phase 5 device pilot.
4. **Managed PostgreSQL provider and region** — blocks durable history, not the live pilot.
5. ~~Public freshness threshold and nearby radius~~ — **decided 26 Sep 2026:** live
   when the newest reading is ≤ 2 h old; stale up to 7 days, then unavailable. A
   nearby radius is not needed for Kolkata; revisit it with Bengaluru.
6. **Retention period for raw device payloads** — blocks production data policy.
7. **Whether Google modelled AQ is legally compatible with the map and use case** —
   blocks only the optional modelled layer, not the measured pilot.
