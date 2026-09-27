# OBOS air quality — CPCB's published AQI as the current value

**Date:** 2026-09-27 · **Status:** approved; built on branch `feat/aqi-cpcb-feed` (Tasks 1–9), not merged
**Builds on:** `2026-09-26-aqi-kolkata-design.md` (shipped in PR #33). Everything there stands unless this document changes it.

## 1. Why

OBOS reads Kolkata's government monitors through OpenAQ. Since 2026-09-24 17:30 UTC the CPCB → OpenAQ relay has been down, so both Kolkata cards say "Not Live". CPCB's own stations never stopped: CPCB's public feed `https://airquality.cpcb.gov.in/caaqms/rss_feed` carried all 481 stations at 05:00 IST on 2026-09-27, with Ballygunge at AQI 38 and SVSPA Campus, Barrackpore at AQI 46.

## 2. Decisions (founder, 2026-09-27)

| # | Decision |
|---|---|
| D1 | The headline AQI is **CPCB's published station AQI** whenever the feed has it. OBOS's own calculation from OpenAQ is the fallback. |
| D2 | When the value comes from CPCB, the pollutant table shows **CPCB's sub-indices only** (24-h value, 24-h range, latest hour). No concentrations, and no concentrations inferred backwards from sub-indices. |
| D3 | The 30-day chart and the 24-h PM2.5 line **stay on OpenAQ**. An OBOS-owned archive of the CPCB feed (probably a dedicated PostgreSQL database) is future work, not part of this change. |
| D4 | When the CPCB feed fails (unreachable, malformed, or our station missing), the card **falls back to today's OpenAQ path**, labelled as computed by OBOS. |
| D5 | Architecture: **one endpoint, two independent sources** (`/api/air-quality`). |

## 3. What the feed is (measured 2026-09-27)

- **Transport.** XML, about 359 KB, 0.4–0.5 s. No key. It is served with `Cache-Control: no-store`. It accepts an identifying User-Agent (`delta-climate-research/1.0 (https://deltaclimate.earth)` → 200).
- **Shape.** `<Country><State><City><Station id="<name>" lastupdate="DD-MM-YYYY HH:MM:SS" latitude longitude>`, containing one `<Pollutant_Index id Min Max Avg Hourly_sub_index>` per pollutant (PM2.5, PM10, NO2, SO2, CO, OZONE, NH3) and one `<Air_Quality_Index Value Predominant_Parameter>`.
- **The numbers are sub-indices, not concentrations.** For every one of the 442 stations with a numeric AQI, `Value` equals the largest `Avg` across its pollutants, and `Predominant_Parameter` names that pollutant (442/442). CO's `Avg` (for example 20 at Ballygunge) only makes sense as a sub-index. Min/Max are the 24-h range of the sub-index, and `Hourly_sub_index` is the latest hour's.
- **CPCB applies its own publish rule.** 39 stations have `Value=""`. Every example inspected lacked valid PM2.5 and PM10. CPCB still lists their other sub-indices.
- **Dead stations are omitted.** Kasturi Nagar and City Railway Station (Bengaluru), both silent on OpenAQ, are absent from the feed.
- **`lastupdate` is feed-wide.** All 481 stations carry the same value, and it is in IST.
- **Update cadence and lag: measured, see AQI-R47.** Over 6 h (24 snapshots, 15 min apart, all HTTP 200) `lastupdate` advanced once an hour on the IST hour, and each update was first seen within 10 minutes of it, so a reading is at most about 70 minutes old. The 2 h live rule stands.
- **Stations can drop out while the feed is up.** The station count moved between 472 and 481, and SVSPA Campus, Barrackpore was absent for over 5 hours on 27 September (AQI-R47). A missing station falls back to OBOS's calculation (D4).
- **Licence.** Government of India data published by CPCB. OBOS credits it as "Source: CPCB".

## 4. Contract (`src/lib/aqi/types.ts`)

`SCHEMA` becomes `2`. Each current state that carries air data names its origin:

```ts
interface CpcbSubIndex { parameter: Pollutant; avg: number | null; min: number | null; max: number | null; hourly: number | null }

interface CpcbResult { origin: 'cpcb'; aqi: number; category: CpcbCategory; dominant: Pollutant;
  /** Window of the dominant pollutant's value: 8 for CO and O₃, 24 otherwise. */
  window_h: 24 | 8;
  subindices: CpcbSubIndex[] }

type AqiResult = (existing fields) & { origin: 'obos' };   // unchanged otherwise

// live / stale carry `result: CpcbResult | AqiResult`.
// insufficient_data carries either { origin:'obos', pollutants, reasons } (today's)
// or { origin:'cpcb', subindices, reasons }.
```

- **No `published_at` field.** The state's `observed_at` carries CPCB's `lastupdate` (converted from IST to ISO UTC), as it carries the last reading for origin obos.

- Category comes from `category(aqi)` in `cpcb.ts`, using the existing CPCB bands.
- `"NA"` and empty strings become `null`. A number must match `^\d+$`. Anything else rejects the station, which then falls back.
- **CDN overlap during deploys.** The browser validator (`isAirPayload`) accepts schema 1 as `origin: 'obos'`, because the CDN may serve pre-deploy payloads for up to about 40 minutes.

## 5. States (current value)

| Feed condition | State |
|---|---|
| Station present, numeric AQI, `lastupdate` ≤ 2 h before `now` | `live`, origin cpcb |
| Station present, numeric AQI, `lastupdate` 2 h – 7 days old | `stale`, origin cpcb, `age_h` from `lastupdate` |
| Station present, `Value=""` | `insufficient_data`, origin cpcb. Reasons come from the missing fields, e.g. "No valid PM2.5 or PM10 reading"; the card reads "CPCB published no AQI at …". |
| Feed unreachable, over 2 MB, unparseable, station missing, station moved, or `lastupdate` more than 7 days old | today's OpenAQ path (`buildPayload`), origin obos, with all existing states and reasons |
| Baruipur | `no_station` (unchanged) |

- **Station matching.** `stations.ts` gains `cpcb_name` for each station (`"Ballygunge, Kolkata - WBPCB"`, `"SVSPA Campus, Barrackpore - WBPCB"`). A feed station is accepted only if its name matches exactly **and** its coordinates are within 100 m of the registry position.
- **Parsing `lastupdate`.** It is read as IST with a fixed +05:30 offset. No time-zone database is involved: `obos-scope` forbids `Asia/Kolkata` in engine code.
- **Client-side demotion is unchanged.** A cached `live` older than 2 h renders as stale.

## 6. Server (`api/air-quality.ts` + new `src/lib/aqi/cpcb-feed.ts`)

- **`cpcb-feed.ts` (pure).** `parseFeed(xml) → FeedStation[]` and `pick(feed, station) → FeedStation | null`; `pick` also requires CPCB's AQI to be the largest `Avg`, held by the named pollutant (AQI-R47a), and otherwise returns null so the station falls back. It is a small strict reader for exactly the elements above: attribute values are read with entity decoding (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`), and no XML library is added. `fetchFeed({fetch, signal})` has an 8 s timeout, rejects bodies over 2 MB, and sends the identifying User-Agent.
- **Feed cache.** The whole parsed feed is cached in-process for 10 minutes and shared by both areas. Concurrent requests share one in-flight fetch. Failures are not cached.
- **Two sources, fetched in parallel.**
  - CPCB has its 8 s budget.
  - OpenAQ keeps its 20 s budget, but the response waits for OpenAQ only until CPCB has settled **plus a 1.5 s grace**.
  - If OpenAQ is still running, the response is sent with `history: null`, and the OpenAQ fetch continues under `waitUntil` from `@vercel/functions` (the one new dependency). When it finishes it fills the in-process raw cache, so the next request gets the chart.
  - If CPCB fails, the handler waits for OpenAQ as today, because OpenAQ is then the headline.
- **Caching.**
  - A response with CPCB current **and** history gets today's `OK_CACHE`.
  - A response with `history: null` gets `public, max-age=0, s-maxage=60`, so the CDN does not keep a chart-less answer for 10 minutes.
  - Full failures stay `no-store`.
- **No OpenAQ key.** CPCB's current value is still served, with `history: null` and the 60 s partial cache; OpenAQ is never called. Only when CPCB has no usable current value does a missing key give today's 503 with `no-store`.
- **Unchanged.** The key stays server-only, only `area` is accepted, `maxDuration` stays 30.

## 7. UI (`air-panel.ts`)

Approved on the preview `previews/aqi-cpcb/index.html` (git-ignored) on 2026-09-27.

- **Hero meta for origin cpcb.** "Led by **PM10** · CPCB published AQI · 24-hour average". It reads "8-hour maximum" when CO or O₃ leads.
- **Time line.** "Published by CPCB at **27 Sept 05:00 IST**". When stale, it adds "No update has reached us since." and uses the approved red chip and the muted number.
- **Pollutant table for origin cpcb.**
  - Header: "Pollutants · CPCB sub-indices".
  - Columns: Pollutant | 24-h sub-index (bar + number) | 24-h range | Latest hour.
  - Rows cover PM2.5, PM10, NO₂, SO₂, CO, O₃, NH₃. A `null` value shows "—".
  - Note: "Sub-indices on the AQI scale, as CPCB publishes them. The largest is the AQI. CPCB's feed carries no concentrations."
- **Origin obos (fallback).** Today's card, with the meta line "AQI computed by OBOS from OpenAQ (no current CPCB figure for this station)". Today's µg/m³ table is kept.
  - **The label is neutral about the cause.** It first read "(CPCB feed unreachable)", which the live run proved false: the feed was up but did not list Barrackpore (AQI-R47). The fallback can come from the feed being down, the station missing, a value more than 7 days old or stamped in the future, or the station moving more than 100 m, so the label names none of them.
- **`history: null`.** The chart area says "History is loading or unavailable; it comes from OpenAQ." It does not show an empty chart.
- **Validation and escaping.** `isAirPayload` validates the new shapes (every number finite or null, `origin` in its union), and every value goes through `num()` / `esc()` as today.

## 8. Testing

Each test is written first and proven with at least one mutation.

- **Parser, against a real fixture.** `tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz` is the full capture (481 stations, gzipped); edge cases (`NA`, blank AQI, `&amp;` names, malformed values) use small inline feeds.
  - It must give Ballygunge 38/PM10 and Barrackpore 46/PM10 with all 7 rows.
  - "NA" becomes null, and a blank AQI becomes insufficient with a reason.
  - Oversize, malformed, missing station and moved station (more than 100 m) each give a fallback.
- **The relied-on fact.** On the full-size fixture, for every station, `Value == max(Avg)` and `Predominant_Parameter == argmax`.
- **Freshness.** Tests at the 2 h and 7 d boundaries, with `lastupdate` parsed as IST under `TZ=UTC` and `TZ=America/New_York`.
- **Independence matrix.** CPCB ok / OpenAQ slow; CPCB ok / OpenAQ fails; CPCB fails / OpenAQ ok; both fail. Each checks the state, the origin, `history`, `Cache-Control`, and that `waitUntil` is called only when OpenAQ was cut off.
- **Labels.** A CO- or O₃-led card says 8-hour maximum, and any other says 24-hour average.
- **UI.** The CPCB table contains no `µg/m³` or `mg/m³`. The fallback shows the OBOS label. Schema-1 payloads still validate.
- **Gates.** `npm run check`, `typecheck`, `test:py`, `test:unit`, `build`, a real `vercel build`, and screenshots of every state.
- **Preview.** The PR's Preview is queried through `vercel curl` for all three areas.
- **Audit.** An independent audit runs before merge.

## 9. Out of scope

- The OBOS archive of the CPCB feed (future; PostgreSQL).
- Bengaluru and Baruipur. No CPCB station lies within their 3 km windows: the nearest are Hombegowda Nagar at 4.3 km from MG Road, 7.1 km from Indiranagar and 15 km from Whitefield; Baruipur's nearest is Jadavpur at 16 km.
- Any change to the 30-day chart's method.
- Modelled air quality.
