# Amsterdam: per-area air card and the modelled LKI (2026-11-09)

Evidence for `feat/ams-area-air`. Sources were read on 2026-11-08/09 (UTC clock 2026-11-08 20:36Z to 22:40Z).

## 1. Stations

Survey of all 30 Luchtmeetnet stations within 30 km of 52.37 N, 4.90 E with their published components: `tests/fixtures/aqi/nl/stations-survey-2026-11-09.json`
(identical, for that area, to the national list of 2026-11-06 in `stations-details.json`). Seven measure NO2, PM10, PM25 and O3: NL49014 Vondelpark, NL49012 Van Diemenstraat,
NL49003 Nieuwendammerdijk, NL49680 Almere-Boomgaardweg, NL10552 Haarlem, NL10444 De Zilk (regional; inside 20 km of three west-side centres only: 17.7 km from B5),
NL10641 Breukelen-A2 (traffic beside the A2: dropped by decision, not by rule). Per-area ladders (nearest first, true distance from that area's centre; ceiling 20 km);
re-derived independently (Python, same haversine) with 0 differences over the 32 areas:

| code | area id | ladder |
|---|---|---|
| D2 | ams-d2 | NL49012 4055 m · NL49014 6296 m · NL49003 7347 m · NL10552 13933 m |
| E2 | ams-e2 | NL49012 2751 m · NL49003 4886 m · NL49014 6241 m · NL10552 16576 m |
| F2 | ams-f2 | NL49003 3062 m · NL49012 3783 m · NL49014 7342 m · NL10552 19263 m |
| B3 | ams-b3 | NL10552 7737 m · NL49014 7838 m · NL49012 8577 m · NL49003 12378 m · NL10444 19906 m |
| C3 | ams-c3 | NL49014 5429 m · NL49012 5782 m · NL49003 9582 m · NL10552 10454 m |
| D3 | ams-d3 | NL49012 2987 m · NL49014 3627 m · NL49003 6787 m · NL10552 13204 m |
| E3 | ams-e3 | NL49012 204 m · NL49014 3532 m · NL49003 3992 m · NL10552 15970 m |
| F3 | ams-f3 | NL49003 1196 m · NL49012 2605 m · NL49014 5237 m · NL10552 18745 m |
| G3 | ams-g3 | NL49003 1599 m · NL49012 5400 m · NL49014 7617 m · NL49680 18536 m |
| H3 | ams-h3 | NL49003 4394 m · NL49012 8195 m · NL49014 10210 m · NL49680 15755 m |
| B4 | ams-b4 | NL49014 7131 m · NL10552 7477 m · NL49012 9052 m · NL49003 12697 m · NL10444 18608 m |
| C4 | ams-c4 | NL49014 4344 m · NL49012 6464 m · NL49003 9990 m · NL10552 10265 m |
| D4 | ams-d4 | NL49014 1594 m · NL49012 4156 m · NL49003 7349 m · NL10552 13056 m |
| E4 | canal-ring | NL49014 1362 m · NL49012 2895 m · NL49003 4885 m · NL10552 15849 m |
| F4 | ams-f4 | NL49003 3059 m · NL49012 3890 m · NL49014 4101 m · NL10552 18644 m |
| G4 | ams-g4 | NL49003 3237 m · NL49012 6125 m · NL49014 6887 m · NL49680 18489 m |
| H4 | ams-h4 | NL49003 5219 m · NL49012 8692 m · NL49014 9679 m · NL49680 15698 m |
| B5 | ams-b5 | NL49014 7492 m · NL10552 8235 m · NL49012 10305 m · NL49003 13605 m · NL10444 17666 m |
| C5 | ams-c5 | NL49014 4912 m · NL49012 8125 m · NL10552 10830 m · NL49003 11119 m |
| D5 | ams-d5 | NL49014 2791 m · NL49012 6441 m · NL49003 8822 m · NL10552 13507 m |
| E5 | ams-e5 | NL49014 2665 m · NL49012 5709 m · NL49003 6904 m · NL10552 16224 m |
| F5 | ams-f5 | NL49014 4698 m · NL49003 5757 m · NL49012 6273 m · NL10552 18965 m |
| G5 | ams-g5 | NL49003 5854 m · NL49014 7259 m · NL49012 7858 m · NL49680 18867 m |
| H5 | ams-h5 | NL49003 7144 m · NL49014 9949 m · NL49012 9989 m · NL49680 16140 m |
| E6 | ams-e6 | NL49014 5312 m · NL49012 8525 m · NL49003 9345 m · NL10552 17062 m |
| F6 | ams-f6 | NL49014 6573 m · NL49003 8532 m · NL49012 8912 m · NL10552 19688 m |
| G6 | ams-g6 | NL49014 8593 m · NL49003 8598 m · NL49012 10091 m · NL49680 19646 m |
| H6 | ams-h6 | NL49003 9524 m · NL49014 10961 m · NL49012 11828 m · NL49680 17042 m |
| I6 | ams-i6 | NL49003 11097 m · NL49014 13495 m · NL49012 13915 m · NL49680 14511 m |
| G7 | ams-g7 | NL49014 10529 m · NL49003 11378 m · NL49012 12562 m |
| H7 | ams-h7 | NL49003 12093 m · NL49014 12537 m · NL49012 13996 m · NL49680 18337 m |
| I7 | ams-i7 | NL49003 13368 m · NL49014 14805 m · NL49012 15800 m · NL49680 16010 m |

## 2. The modelled LKI endpoint

* A forecast product, not a measurement: the API docs say "current and predicted concentrations"; the independent check (`/Volumes/OBOSLab/research/ams-area-air/MODEL-ENDPOINT-CHECK.md`)
  reads the site's pages as RIVM, OPS + TREDM, 125 m, KNMI weather, about four runs a day. Not anchored to stations (model O3 0.0 against 15.9 measured).
* Rows are a FIXED run window (21 rows, 21:00Z to 17:00Z next day, byte-identical 21:34Z-22:37Z), `start`/`end` ignored; my own snapshots (every 5 min from 20:39Z) agree.
  One answer in eight (22:19Z) lacked the current hour. `tests/fixtures/aqi/nl/model-lki-samples-2026-11-08.json` holds the eight; tests pin the choice for each.
* Which row is now: luchtmeetnet.nl's own script, chunk `mijn-locatie-110b313d0e348113cdf2.js`:
  `e.find(e => dayjs(e.timestamp_measured).isSame(dayjs(), "hour"))` then `Math.ceil(n.value)`. Same rule here.
* Start or end of the hour: NOT settled by documentation. My comparison of the model row (first row at each hour) against the three stations' measured NO2, O3, PM10, 18 pairs over the
  hours 20Z and 21Z: closer under the START reading in 10, under the END reading in 8; MAE 9.42 vs 9.39 µg/m3. Inconclusive (the model is not anchored to the stations), so it is
  not used as evidence. The code follows the operator's script and never shows a row before its stamp.
* Rounding: "Decimale LKI-waarden worden naar bovenafgerond" (LKI page, `cms/pages`, recorded in `cms-pages-used.json`) and `Math.ceil` in the script. 3.46 is 4.
* Licence: CC BY-ND 4.0, same as the station data (Open data page covers the lat/lon values); same credit.

## 3. Station timestamps (point raised by the independent check)

Not changed. The check says a station label `T+00:00` is really the hour [T-1h, T) in true UTC. That is the reading the module already uses (end of hour = `timestamp_measured`,
the row's own `timestamp_measured_start`/`_end` differ by one hour, e.g. 12:00 and 13:00 for the label 13:00). The two readings coincide; the card's "Hour to" time is the same either way.

## 4. Request budget (audit B1), measured

`tests/unit/aqi-ams-budget.test.mjs` drives the real handler with a simulated clock and a fake upstream that counts every request; 32 areas polled every 10 s.
Busiest 5-minute window per instance: healthy cold start 40; outage (all 503), from cold 62, and 62 in the busiest window over 30 minutes; late publication (rows 3 h old) 62;
a due new hour (stations one hour behind) 56; model answer cut short every time 40; Luchtmeetnet answering 429 to everything 2. Designed ceiling 68
(6 stations once a minute = 30, their substance reads 6, 32 model locations once = 32). Before the fix an outage cost about 950 per 5 minutes per instance.
Per instance only: N warm instances multiply it. The 31 streamed ids are additionally served only where streaming is on.

## 5. Why the model line used to disappear after each hour (S4), and the fix

The first version cached the chosen row inside the area payload for 10 minutes and the judge dropped it when its hour ended, so for up to ~20 minutes after :00 the card
had no line. Now the whole run is cached and the row is chosen by the request's clock, so the line changes hour exactly at the boundary; it is absent only when the run
has no row for the current hour (then it is re-read, at most once per 5 minutes). The CDN header is capped at the end of the model's hour.
