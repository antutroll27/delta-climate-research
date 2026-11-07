# Amsterdam's observed "now": Schiphol (EHAM), 2026-11-07

Extends `2026-10-07-observed-weather.md` to the Canal Ring. The method, the physics and the
founder's decisions are that document's; nothing in the model changed. Kolkata and Bengaluru
keep their stations, fixtures and the same physics. **One wording change reaches them, and it is intended**: a
report with fog (`FG`, `FZFG`) at VECC, VOBL or VOBG now reads "Fog" where it used to read sky words
("Overcast" from `VV001`), and the same for falling snow, which those airports never report. `BR`, `HZ`,
`FU`, `DU`, `SA` and shallow, patchy or partial fog (`MIFG`, `BCFG`, `PRFG`) keep the sky words
(unit tests on real VECC `BR` and `HZ` reports; the VECC fixture has no `FG`, so the fog case is a synthetic VECC-shaped report and the test says so).

## The station, and why

The Canal Ring ward centre is 52.3640 N, 4.8850 E (`src/data/cities.ts`). Every METAR station
aviationweather.gov serves inside 51.9-52.9 N, 4.2-5.6 E (checked live, 2026-11-07):

| Station | Distance from the ward centre |
|---|---|
| **EHAM Schiphol** | **8.4 km** |
| EHLE Lelystad | 44.4 km |
| EHQN Hollandse Kust Noord heliport | 53.1 km |
| EHRD Rotterdam The Hague | 54.6 km |

One station, EHAM. The next is five times farther and over open polder, so there is nothing to
rank (`rankStations` still runs; it has one entry). Station record: 52.315 N, 4.790 E, WMO 06240,
elevation -2 m, the coordinates the API files the reports against (a unit test pins them to the
fixture). Schiphol is 8 km from the ward (Dum Dum is 16 km from Ballygunge). Like Dum Dum it is an airport on the city's edge, so the
weather line still says conditions "may differ over the ward".

Reports are half-hourly (xx25 and xx55 UTC), so the 90-minute stale limit is again two missed reports.

## Reachability, measured

`api/metar.ts` was called through its own `handle`, with the real `fetch`, for `ids=EHAM`
(2026-11-07 15:25Z): upstream URL `https://aviationweather.gov/api/data/metar?ids=EHAM&format=json&hours=4`,
HTTP 200, 8 reports, `Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=1800`,
and the `User-Agent` the function sent was `delta-climate-research/1.0 (+https://deltaclimate.earth)`
(a site URL; no mailbox of any kind). The newest report parsed to
`METAR EHAM 071455Z 12004KT 9999 BKN035 07/04 Q1022 NOSIG` -> 14:55Z, 7 / 4 degrees, 1022 hPa, nothing unparsed.
(Vercel-side reachability of this feed was established for VECC/VOBL/VOBG on 2026-10-07; the
endpoint is the same.)

## What a European METAR does that the parser had to survive

Measured, not assumed: `tests/fixtures/metar/metar-eham-20261107T1500Z.{json,txt}` is 400 consecutive
real EHAM reports, 30 Oct 07:00Z to 7 Nov 15:00Z. **All 400 parse with a temperature and a pressure and
an empty `unparsed` list**, and temperature, dew point and pressure agree with the API's own decode.
What the 400 contain (counts) and how each is handled:

| Feature | Reports | Real example | Handling |
|---|---|---|---|
| CAVOK | 116 | `071355Z VRB02KT CAVOK 07/04 Q1022 NOSIG` | clear sky, 10 km, cloud 0 (existing rule) |
| NOSIG | most | `... BKN035 07/04 Q1022 NOSIG` | trend word ends the observation (existing) |
| TEMPO with precipitation | 40 | `030055Z ... BKN027 10/08 Q1032 TEMPO 7000 -RADZ BKN015` | **forecast, not applied**: no rain, cloud from the observed BKN027 |
| TEMPO with SHRA and TCU | 1 | `021555Z ... 12/08 Q1031 TEMPO 7000 -SHRA FEW025TCU` | no rain, no convective cloud |
| BECMG | 53 | `070725Z 09003KT 7000 NSC 00/00 Q1023 BECMG 8000` | ends the observation |
| Wind variation sector | 183 | `011425Z 29005KT 250V310 9999 ...` | skipped (existing) |
| Gust | 1 | `07015G25KT` | speed 15, gust 25 |
| `-DZRA` (two phenomena) | 14+ | `030455Z ... -DZRA SCT008 SCT010 BKN024 09/08 Q1031 TEMPO 6000 BKN008` | rain at the station |
| `REDZ` before TEMPO | 1 | `020155Z ... -DZRA ... 10/10 Q1031 REDZ TEMPO 6000 BKN005` | recent weather, trend ignored |
| RVR groups, `BCFG BR` | 18 | `312055Z 36002KT 1800 R18C/1200U R27/0650D ... BCFG BR NSC 06/06 Q1033` | RVR skipped, not read as visibility |
| Directional visibility `0600NW` | some | `010155Z ... 9999 0600NW R18C/1300N ...` | skipped |
| `M00/M01`, `M00/M00` | 3 | `070625Z ... NSC M00/M01 Q1023 NOSIG` | **was -0; now 0** (see below) |
| `COR` | 3 | `061425Z COR 07007KT CAVOK 09/05 Q1023 NOSIG` | corrected report, kept |
| Fog | 4 | `300825Z ... 0900 ... FG BKN001 BKN002 10/10 Q1032` | cloud and visibility read; weather line says Fog (new) |
| Q group | 400 | `Q1022` | hPa as written |

### Code changes

1. `signedC` in `src/lib/weather/metar.ts`: `M00` returned **negative zero** (`-Number('00')`),
   which `toLocaleString` prints as "-0". Three real Schiphol reports have it (an air frost reading).
   Fixed with `0 - x`. No Indian report has `M00`; nothing else changes.
2. `describeWeather` in `src/lib/weather/observed.ts`:
   - Falling snow, snow grains, ice pellets and hail at the station read "Light snow", "Moderate ice pellets",
     "Moderate small hail" (`GS`) and so on, instead of falling through to "Mostly cloudy". Blowing and drifting
     snow (`BLSN`, `DRSN`) are not snowfall and keep the sky words. Snow gets no wetting term and no "surfaces drying" note.
   - Fog (`FG`, `FZFG`) reads "Fog"; shallow `MI`, patchy `BC` and partial `PR` fog keep the sky words.
   - The "nearby" clause names what is nearby: `VCSH` showers (as before), `VCTS` thunderstorm (as before), `VCFG` fog, any
     other `VC` group plain "weather". It used to say "showers nearby" for all of them.
   - There is no real EHAM snow in the capture window, so the snow and hail tests edit one real report and say so.
3. `placeWords` (same file) and its callers (`weather-v2.ts`, `heat-map-app.ts`, two spans in `WeatherCards.astro`):
   the card said "8 km from the ward" and "may differ over the ward". The Canal Ring is a 2.8 km square across three
   stadsdelen, so Amsterdam now reads "8 km from the Canal Ring centre" and "may differ over the Canal Ring" (the same
   noun pattern as the air panel). Kolkata and Bengaluru keep "the ward" word for word: Kolkata's wards and
   Bengaluru's GBA wards are wards.
4. `fixed` (same file): a reading that rounds to zero prints 0 ("-0" came from `(-0.4).toFixed(0)` in the live
   readout, reachable through met.no or a feels-like just below zero).

Everything else is data: one row in `src/data/metar-stations.ts`.

## The page clock

`WARD_TZ` is `SCOPE.city.tz` (`Europe/Amsterdam`, `scope/registry.ts`), not a constant. The "now"
line, the report time on the Weather card, the dial and the month used for climatology all read
that zone; the sun comes from longitude, latitude and UTC (`wardSolarHour`, `refreshNowSun`), so
night is decided by the sun and not by the clock. Verified:

- The label is `CET` in winter and `CEST` in summer from the browser's ICU (en-GB), not "GMT+1";
  the `GMT+5:30 -> IST` rewrite touches nothing else.
- DST edges (2026-03-29 and 2026-10-25) land on the correct side in a unit test, which also pins
  the Weather card's "observed 14:55 UTC = 15:55 CET".
- e2e: the line reads `... at 15:55 CET` for the 14:55Z report.

## Credit (founder's decision, 2026-11-07: credit KNMI)

Who makes Schiphol's METAR: **KNMI**. Its page says it "produceert luchtvaartmeteorologische waarnemingen voor civiele
luchthavens in Nederland", METARs for flight planning and international distribution
(knmi.nl/nederland-nu/luchtvaart/luchtvaartmeteorologische-informatie, read 2026-11-07). At Schiphol the instrument
report is completed by an on-site observer (visibility, cloud type, weather), while Rotterdam, Groningen, Beek and
Lelystad are AUTO stations. LVNL (the air-traffic controller) appears on KNMI's page only as a flight-preparation link
and is not described as an observer. KNMI also publishes the same METARs on its Data Platform under CC BY 4.0
(dataplatform.knmi.nl/dataset/metar-1-0, which names KNMI as producer and states no attribution wording). **Not settled:**
LVNL's own eAIP GEN 3.5 (a search snippet says it names KNMI's Schiphol office as the observing provider) answered
HTTP 403 and was not read, so "LVNL does not observe" rests on KNMI's pages and not on that document.

OBOS reads the reports through NOAA's Aviation Weather Center (public domain), so the credit names both. One line in
`CITY_CREDITS.amsterdam`: "Airport observations (METAR), Schiphol: bron: KNMI, relayed by the NOAA Aviation Weather Center. KNMI is
not involved in this derived product and does not necessarily endorse its purport." (CC BY 4.0), carrying both halves of KNMI's
copyright wording as the normals line beside it does. `/attribution` lists no Amsterdam source (no 3D BAG, no KNMI normals),
so it has no city section to join; its one airport-observations sentence gained the same KNMI clause. Kolkata and Bengaluru
are unchanged.
