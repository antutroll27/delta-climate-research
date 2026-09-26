# OBOS air quality — Kolkata live + 30-day history

**Date:** 2026-09-26 · **Status:** design approved in conversation; awaiting spec review
**Background:** the plan set in `docs/AQI/01–06` (untracked in the main checkout as of this date). This spec narrows it to the first release and records the decisions and measurements made on 2026-09-26.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Kolkata only** for the first release (Ballygunge, Baruipur, Barrackpore). Bengaluru is parked: no government station lies within any of its 3 km windows. |
| D2 | A station counts as covering a place when it lies inside that place's **3 km window** (`window_3km` in the heat-history vector file). The UI always states the distance ("Station 1.0 km from the Ballygunge centre") and never calls it the ward's own air. |
| D3 | Server boundary: one **TypeScript** Vercel Function, `api/air-quality.ts`, beside `api/live.js` and `api/climate-clock.js`, mounted in `devApiProxies()` for `npm run dev`. |
| D4 | Source: **OpenAQ v3**, government locations only; key server-side in `OPENAQ_API_KEY`. No WAQI, no low-cost sensors. |
| D5 | When the feed is late, the card shows the **last valid AQI, muted, with its age** for up to **7 days**; after that, "Government feed unavailable". |
| D6 | History = **last 30 days of daily CPCB AQI** plus **the last 24 h of PM2.5**, fetched from OpenAQ; no database. |
| D7 | Order of work: contract → UI previews on fixtures → server function. |

## 2. Measured facts the design rests on (2026-09-26)

- **Stations.** Ballygunge → OpenAQ `10918` (WBPCB-owned, CPCB-provided monitor; 22.53675 N, 88.36380 E; KMC Ward 69; 1.0 km from the OBOS centre; inside the 3 km window). Barrackpore → `3409509` SVSPA Campus (22.76056, 88.36176; 1.0 km; inside the 3 km window; reporting since 2025-02-18). Baruipur → no continuous government monitor.
- **Values are faithful but incomplete.** OpenAQ's raw 15-minute PM2.5 at Ballygunge equals the OpenCity archive of the same station reading for reading (checked on 2025-12-15; OpenCity stamps each reading at the IST end of its 15 minutes). **OpenAQ omits one of every four quarter-hours** (the one ending at IST :45), so its own `/hours` means differ from the full data by about 6 µg/m³ an hour. The function therefore averages **raw** readings into **IST clock hours** itself and never uses `/hours`.
- **Units: OpenAQ's labels are wrong on the active sensors.** Since 2025-02-18 the live Ballygunge sensors are labelled "ppb" for NO₂, SO₂ and CO, but their values equal OpenCity's native-unit archive exactly: NO₂ and SO₂ are **µg/m³** (38/38 identical on 2025-12-15) and CO is **mg/m³**; NOx labelled "ppb" is ppm. The older µg/m³-labelled sensors stopped in 2022. The function therefore uses a **verified per-sensor table** (sensor id → parameter → true unit), never OpenAQ's unit label, and never converts ppb. Barrackpore's units are inferred from the same feed and must be verified before release (register AQI-R31).
- **Outage.** Every CPCB monitor on OpenAQ (425 in India) stopped at 2026-09-24 17:30 UTC; data.gov.in's CPCB API returned 502/504 on the same day. The design must look right while the feed is down.

## 3. Contract (`src/lib/aqi/types.ts`, shared by function and UI)

```ts
type AqiState = 'live' | 'stale' | 'unavailable' | 'insufficient_data' | 'no_station';

interface AqiStation { id: string; name: string; owner: string; provider: string;
  lat: number; lon: number; distance_m: number; inside: 'window_3km' }

interface PollutantReading { parameter: 'pm25'|'pm10'|'no2'|'so2'|'co'|'o3'|'nh3';
  value: number | null; unit: 'ug_m3'|'mg_m3'; window_h: 24|8; hours_present: number;
  sub_index: number | null }

interface AqiResult { aqi: number; category: CpcbCategory; dominant: PollutantReading['parameter'];
  pollutants: PollutantReading[]; window_end_ist: string; algorithm: 'cpcb-aqi-1' }

type AirQualityResponse = { schema: 1; area_id: string; served_at: string; source: SourceNote } & (
  | { state: 'live'; station: AqiStation; result: AqiResult; observed_at: string }
  | { state: 'stale'; station: AqiStation; result: AqiResult; observed_at: string; age_h: number }
  | { state: 'unavailable'; station: AqiStation; last_observed_at: string | null }
  | { state: 'insufficient_data'; station: AqiStation; pollutants: PollutantReading[]; reasons: string[]; observed_at: string }
  | { state: 'no_station'; nearest_km: number | null });

interface HistoryResponse { area_id: string; days: { date_ist: string; aqi: number | null;
  category: CpcbCategory | null; reason?: string }[]; pm25_24h: { hour_ist: string; value: number | null }[] }

/** What `GET /api/air-quality?area=in/kolkata/ballygunge` returns. */
interface AirQualityPayload { current: AirQualityResponse; history: HistoryResponse | null }
```

Missing is `null`, never 0: a pollutant with no readings in its window carries `value: null`. Every state names the station (or its absence) and the source.

One fetch of 31 days serves both the current state and the history, so the endpoint returns both in one `AirQualityPayload`; `history` is `null` only when it cannot be built. Area ids use OBOS's existing `AreaKey` form (`in/kolkata/ballygunge`).

**State rules:** `live` when the newest raw reading is ≤ 2 h old and CPCB validity passes; `stale` when older than 2 h and ≤ 7 days; `unavailable` beyond 7 days or on upstream failure with no usable cache; `insufficient_data` when fresh but CPCB validity fails; `no_station` for Baruipur.

## 4. CPCB calculation (`src/lib/aqi/cpcb.ts`, pure)

- Sub-index by linear interpolation between CPCB breakpoints; overall AQI = **max** valid sub-index.
- Publishable only with ≥ 3 pollutants including PM2.5 or PM10, each with ≥ 16 valid hours in its window.
- PM2.5, PM10, NO₂, SO₂, NH₃: 24 h mean of IST-hour means. CO, O₃: 8 h treatment.
- **Gate before code:** the exact CO/O₃ convention (maximum of rolling 8 h means vs the latest 8 h mean) and the 16-hour rule's application per pollutant are reproduced from CPCB's official calculator workbook and fixed as golden fixtures.

## 5. UI

- **Right-panel block** (`#aqiBlock`, under the colour key, folded by default like `#solBlock`): the AQI number, CPCB category in words and colour, dominant pollutant, one line for station and distance, one for the IST observation time. Stale is muted with its age. AQI never enters the heat legend or the heat physics.
- **Left pane** (rail item **Air**, `data-pane="air"`, placed after Solar): current state as above; each pollutant with its value, unit and sub-index; a 30-day daily-AQI bar chart coloured by CPCB category (missing days drawn as gaps); the last 24 h of PM2.5 as a line; a method-and-source note (CPCB standard, "measured by WBPCB, via OpenAQ", 3 km rule).
- Every state has its own designed treatment; no state falls back to an empty number.

**Visual decisions (approved on the preview, 2026-09-26; `previews/aqi-kolkata/index.html` in the worktree):**
- Typography follows the other OBOS panes: Noplato Mono for headings, table and chart labels, AQI number. **Units are always set in Mona Sans** (`µg/m³`, `mg/m³`): the brand mono is capitals-only and would print "MG/M³".
- CPCB category colours, validated on the rail surface `#091416` (adjacent normal-vision ΔE ≥ 15.2, CVD ΔE ≥ 11.1, all ≥ 3:1 contrast): good `#2a8f6a`, satisfactory `#6fcf97`, moderate `#f2d03a`, poor `#f2912e`, very poor `#e0404f`, severe `#9b3fa0`. The category word is always printed; colour is never the only signal.
- **Stale label:** solid Swiss red `#da291c`, white Mona Sans 500, title case, the age bold with a wide separator: "Not Live · **43 h** Old". The AQI number is muted in the stale state.
- The pane repeats the card's state label; the 30-day chart draws days without an official AQI as hatched stubs with the reason in the tooltip; the 24 h PM2.5 line carries the 60 µg/m³ national 24-hour limit for scale.

## 6. Server function

- `GET /api/air-quality?area=in/kolkata/ballygunge`; the same response carries `history`. Unknown areas → 404; other methods → 405.
- Station registry in `src/lib/aqi/stations.ts` (three Kolkata entries), each assignment re-checked by a unit test against `window_3km` from the heat-history vector file.
- Upstream: OpenAQ with a 10 s timeout, one retry. Current view cached `s-maxage=600, stale-while-revalidate=1800`; history `s-maxage=3600` (completed days never change). Worst-case uncached history ≈ 7 sensors × 3 pages per area, kept under OpenAQ's 60 requests/minute by the cache.
- The key never reaches the browser, the logs or a response.

## 7. Testing

- CPCB module: every breakpoint edge, the max rule, the 3-pollutant/PM/16-hour rules, and the workbook golden fixtures.
- Hour-building: the dropped-quarter pattern, IST bucketing, and the ppb/µg/m³ sensor choice, from recorded OpenAQ fixtures.
- Each of the five states rendered from fixtures, and a real Ballygunge day (2025-12-15, cross-checked against OpenCity) as the realistic case.
- Existing gates stay green: `npm run check`, `npm run typecheck`, `npm run test:unit`, build.

## 8. Out of scope

Bengaluru; OBOS/ESP32 devices; a database or long archive; interpolated or painted ward surfaces; modelled AQ (Google, CAMS); data.gov.in as a live dependency (kept only as a later cross-check).
