# Bengaluru: fallback air temperature, MG Road height cross-check, water lines, park size

**Date:** 2026-09-14 · **Branch:** `feat/bangalore-wards` · **Status:** agreed in brainstorm, awaiting written review

## The ask

Item 4 of the post-audit list, the Bengaluru data gaps:

1. The resilience score shows "inputs unavailable". **Out of scope here:** it gets its own spec next.
2. `fallbackTairC` and `parkRadiusM` were inherited from Kolkata and never measured.
3. MG Road is missing its water lines.
4. The UT-GLOBUS `Bangalore_1` tile was never fetched, so MG Road has no height cross-check.

The founder chose the order: quick wins, then water, then the resilience score. This spec covers the first two. Each decision below was taken with the founder, one question at a time.

## Constraints

- **Data.** Open data only, with licences that permit commercial consultancy use. No Google Earth.
- **Python.** Every `.py` passes strict mypy (`npm run typecheck`).
- **Tests.** No test counts until it has been seen failing against a deliberate break of what it covers.
- **Kolkata.** Kolkata is the production city. Any Kolkata output that moves is re-frozen on purpose, with before and after recorded.
- **Dubai.** Nothing Dubai goes on the main site. Dubai is only typed along where the registry shape requires it.
- **Git.** No push. Read `git log origin/main..HEAD` before any push decision.

## What was measured, and what it changed

- **The 32 °C fallback is wrong for most of the year.** IMD 1991–2020 normals put Bengaluru's mean daily high between 26.9 and 34.1 °C and its mean daily low between 16.1 and 22.1 °C.
  - A flat 32 °C runs up to 16 °C too hot at night.
  - Kolkata's own 32 °C matches its annual mean high (31.7 °C) but runs 5–18 °C too hot at night.
  - The fallback applies whenever there is no live reading, including on first load, not only when the feed is down (`heat-map-model.ts:539`).
- **The published accuracy band does not depend on the fallback.** Calibration uses observed air temperature from `data/calibration/met-forcing.csv` (`build-ward-observations.py`, `fit-ward-scale.py`). Only the plausibility scripts (`validate-model.mjs`, `geometry-sim-delta.mjs`) run with `live: null`.
- **The height cross-check cannot be re-run in its current form.** It lives inside `compute_heights` (`fetch-bangalore.py:1059`), which first recomputes every primary height through Earth Engine. The service account currently gets `403 USER_PROJECT_DENIED`.
- **Both UT-GLOBUS tiles are now on disk as real, verified files.** Both are gitignored, from Zenodo 11156602, data licence CC BY 4.0.
  - `Bangalore_1.gpkg`: 273,190,912 B, MD5 `6efdf6d8…`. 10,389 buildings in the MG Road box, all with a height.
  - `Bangalore_2.gpkg`: 214,093,824 B, CRC `6b14209e`, MD5 `2fa854a9…`. It replaces a dangling symlink.
- **Water lines are drawn only, never simulated.** `WATER_LAYER_ENABLED = false` because enabling it measured worse (r 0.3031 → 0.2544), and `rasterizeWardWater` reads polygons only.
  - The browser's `WaterData` has no line field, so the exporter drops every line: 26 / 37 / 29 across the three wards.
  - The water depth field is fixed at Kolkata's 1,520 m (`water-layer.ts:58`), so Bengaluru water beyond about 760 m from the ward centre loses its depth shading.
- **No open source gives defensible drain widths.** OSM has one width tag across 38 MG Road reaches; BBMP's 2022 KMLs carry drain order only.
  - About 40 % of reaches are culverts or tunnels. The cached Overture water parquet has only `id, subtype, class, geometry`, so it cannot tell which.
- **TVoE is a slope, not an area.** Li et al. 2022 fit `intensity = a·ln(area) + b` and define TVoE where the slope is 1, which makes TVoE = `a`. Its numeric value is the same whatever the area unit.
  - So "0.77 ha", and the 50 m pocket-park radius built on it, was never a measured size.
  - Kolkata's value cannot be reproduced from open data: Li hand-picked 90 parks in Google Earth, and OSM with Li's rules gives 28, none of them 5 ha or larger.
  - Bengaluru has 1–4 isolated parks above 5 ha under any rule, so a Bengaluru fit would very likely be inconclusive.

Full source notes: memory `bengaluru-open-data-verified`, and the research reports summarised under [Sources](#sources).

---

## 1. Fallback air temperature becomes a month × hour table, for every city

**Registry.** In `scope/registry.ts`, each city's `fallbackTairC: number` is replaced by `airNormals`:

```ts
interface AirNormals {
  readonly station: string;         // e.g. 'IMD Bengaluru City 43295'
  readonly period: string;          // '1991–2020'
  readonly source: string;          // citation of the IMD Climatological Tables
  readonly measured: boolean;       // false only for Dubai's placeholder
  readonly maxC: readonly number[]; // 12 values, Jan..Dec, mean daily maximum
  readonly minC: readonly number[]; // 12 values, Jan..Dec, mean daily minimum
}
```

| City | Station | `maxC` Jan–Dec | `minC` Jan–Dec |
|---|---|---|---|
| Bengaluru | IMD Bengaluru City 43295, 1991–2020 | 28.4 30.9 33.4 34.1 33.1 29.7 28.3 28.1 28.6 28.5 27.4 26.9 | 16.1 17.6 20.2 22.1 21.8 20.6 20.1 20.0 20.0 19.8 18.3 16.4 |
| Kolkata | IMD Kolkata (Alipore) 42807, 1991–2020 | 25.5 29.4 33.7 35.4 35.5 34.1 32.5 32.3 32.6 32.3 30.2 26.7 | 14.3 18.1 22.9 25.7 26.8 27.1 26.7 26.6 26.3 24.4 20.1 15.5 |
| Dubai | none, placeholder | 40 ×12 | 40 ×12, `measured: false` |

The source is IMD, *Climatological Tables of Observatories in India 1991–2020*: Bengaluru City pp. 133–138, Kolkata Alipore p. 209. The PDF states no licence, so the normals are cited as published facts. Registry comments carry the page references.

**The curve.** A pure function `fallbackTair(normals, clock)` maps month and hour to a temperature. It hits the month's minimum at 06:00 and its maximum at 14:00, with half-cosine segments between them:

- For 06:00 ≤ h < 14:00: `t = (h − 6) / 8`, `T = min + (max − min) · (1 − cos πt) / 2`.
- Otherwise: `t = ((h − 14 + 24) mod 24) / 16`, `T = max − (max − min) · (1 − cos πt) / 2`.

The diurnal shape is a standard assumption, not something in the tables, and the code comment says so. The function lives in `heat-map-model.ts` beside `currentParams`, which is already three-free and node-testable.

**Where the clock comes from.** `ScenarioState` gains a **required** `clock: { month: number; hour: number }`, where month is 1–12 and hour is 0 ≤ h < 24. It is required for the same reason `climate` is: a default would silently model the wrong moment. `currentParams` reads `L ? L.tAir : fallbackTair(s.climate.airNormals, s.clock)`.

The app sets the clock from the ward's local time. It uses `Intl.DateTimeFormat` with the city's registry `tz` (`WARD_TZ`: `Asia/Kolkata` for both Indian cities), the same source the ward clock already reads through `wardHour24` (`heat-map-app.ts:2302`):

| Mode | Hour | Month |
|---|---|---|
| "Now" (`sunNow` path) | current local hour | current local month |
| "13:00 Peak" | 13 | current local month |
| "22:00 Retained" | 22 | current local month |

A live reading always wins.

**Scripts.**
- `validate-model.mjs`, `geometry-sim-delta.mjs` and `dump-obos-golden.mjs` pass an explicit clock of month 4, hour 13, a hot-season canonical peak. Their results no longer depend on the run date.
- Their outputs are re-recorded, with before and after captured.
- A plausibility bar in `validate-model.mjs` that fails under the new temperature is reported and investigated, never silently loosened.

**Re-freezing.**
- The model self-check at `heat-map-model.ts:659,679,686–688` asserts table-derived values, not 32 and 40.
- `data/calibration/golden-params.json` is the one frozen output that reads the fallback. `scripts/dump-obos-golden.mjs` writes it and `tests/unit/obos-golden-params.test.mjs` checks it. It is regenerated deliberately, and the commit message records before and after. `data/calibration/golden-layers.json` does not read air temperature and must stay byte-identical.
- `obos-scope.test.mjs:305–308,324` assert the new shape.

**Tests.** Each is seen failing against a deliberate break.
- Every city's `maxC` and `minC` have 12 finite values with min < max, in a plausible range.
- The registry numbers equal the IMD table values above. This pins the transcription.
- The curve returns the minimum at 06:00 and the maximum at 14:00, and is continuous at both joins.
- A Bengaluru December 03:00 reading comes out cooler than a Bengaluru April 13:00 reading.
- Kolkata ≠ Bengaluru for the same clock.
- A missing `clock` is a compile error.

**Evidence.** Add a `docs/evidence/` entry for both stations. It records:
- that these are climatological means, not a forecast;
- that the last decade is warmer (GHCN-D `IN009010100` gives April 34.9 °C for 2016–2025 against 34.1 °C for 1991–2020);
- that Kempegowda Airport 43293 opened in 2014, so its "normal" must not be used.

It also records the licence traps, because they are why the IMD PDF is used as a published table and not a data feed: IMD Data Service Portal, NOAA GSOD, Open-Meteo.

---

## 2. MG Road height cross-check, run offline and recorded

**Refactor.**
- Lift the comparison block (`fetch-bangalore.py:1094–1122`) out into `cross_check(w, doc) -> None`. `compute_heights` keeps calling it, so its behaviour is unchanged.
- Add `--layer crosscheck`, which works entirely offline:
  1. Load the committed `data/bangalore/{ward}-buildings.json`.
  2. Delete any existing `hUt` and `flag` from every building.
  3. Run `cross_check`.
  4. Write the file back.
- It never imports `ee` and never changes `h`, `fill`, `heightSource`, `heightNote` or `fillFraction`.

**Guard.** If no covering tile is found and the file already holds a non-SKIPPED `crossCheck`, the command refuses (exit non-zero, message names the ward) rather than overwrite real evidence with "SKIPPED".

**Acceptance.**
1. Indiranagar and Whitefield reproduce their committed **match counts** exactly (2,274 and 2,532). Matching reads only footprint centroids, so this proves the re-fetched `Bangalore_2` tile is the one originally used.
   - **Amended 2026-09-14, measured.** The committed MAE and flag counts (3.12 m / 391, 3.13 m / 295) do **not** reproduce, and should not. They were written at `b740dbb` against the Google 2.5D heights. `1fec16e` then gave 1,941 Indiranagar and 1,430 Whitefield buildings OSM-measured heights. Re-running the same formula on the `b740dbb` heights gives 3.12 m / 391 and 3.13 m / 295 to the digit. The committed strings and per-building `flag`s were therefore stale.
   - All three wards are re-recorded against the shipped `h`: Indiranagar 2,274 matched, MAE 2.83 m, 302 flagged; Whitefield 2,532, 2.80 m, 178. The docs keep the superseded figures and say why they moved.
2. MG Road gets its first real result against `Bangalore_1`, recorded verbatim.
3. `python3 scripts/export-bangalore-obos.py` leaves every served `public/heat-map/data/*` Bengaluru ward file byte-identical. The exporter ships only `h`.

**Test.**
- `scripts/check-bangalore-artefacts.py` fails if any Bengaluru ward's `crossCheck` starts with "SKIPPED" or reports 0 matched.
- Prove it by pointing it at a copy with MG Road's cross-check reverted to SKIPPED, then restore.
- A unit-level check covers the guard: a SKIPPED result must not overwrite a real one.

**Docs.**
- `docs/evidence/known-limitations.md` §8 quotes the earlier sample MAEs (4.00 / 3.60 m). Replace them with the full-ward results for all three wards.
- `data-sources.md:508` currently reads "Bangalore_1 still to fetch". Record both tiles and their MD5s.
- Add the UT-GLOBUS caveats:
  - integer heights;
  - validated only on US cities (building RMSE 9.1 m);
  - no Indian validation, so `DISAGREE_M = 5` stays an advisory flag, never a correction.
- The 2026-09-10 spec states a 59 m margin at `Bangalore_1`'s east edge; the tile envelope suggests about 640 m. Re-measure against the tile's actual polygon extent and correct whichever is wrong.

---

## 3. MG Road's water lines, drawn as thin ribbons

**Data.**
- `fetch-bangalore.py` pulls Overture `base/water` with `source_tags` added (`id, subtype, class, geometry, source_tags`), pinned to release **2026-07-22.0** (confirmed on S3 on 2026-09-14). Overture keeps two releases.
- If 2026-07-22.0 is gone at implementation time, all water is re-pulled from the newest release in one pass, with polygon changes diffed and recorded. Releases are never mixed.
- Lines whose source tags carry `tunnel` (any value except `no`), `culvert`, or `covered=yes` are excluded as covered reaches.
- `export-bangalore-obos.py` writes the remaining lines into `{ward}-water.json` as `lines: { k: string; p: number[] }[]`, with `k` from subtype/class (`drain`, `stream`, `river`, `canal`) and `p` as ward-metre `[x, y, …]`.
- The file also gains:
  - `coveredDropped`, the count of excluded covered reaches, so the drop is visible outside stdout;
  - `fieldM`, the side of the box the file was clipped to (2800 for Bengaluru).
- The `source` string names OSM via Overture under ODbL.

**Types and loader.**
- `WaterData` becomes `{ polys: …; lines?: { k: string; p: number[] }[]; fieldM?: number }`.
- Kolkata's existing files have neither optional field and load unchanged.
- A missing or non-finite `fieldM` falls back to 1520, today's constant, which matches `CLIP_M*2` in `scripts/fetch-water.py`.

**Drawing.**
- The ribbon construction inside `road-ribbon.ts` `buildRoadMesh` (per-vertex draping, clamped mitre) is extracted into a shared pure `buildRibbonMesh(ways, halfWidthOf, groundAt, lift)`.
- `buildRoadMesh` becomes a thin wrapper, and its output for every shipped roads file stays byte-identical.
- `water-layer.ts` builds line ribbons with a half-width of 1.5 m, i.e. 3 m wide, the same `STREAM_WIDTH_M` the Blender scenes use.
  - Ribbons are draped per vertex, because a drain follows the land. Ponds stay level.
  - Ribbons are merged into the existing water mesh at the water surface height, above `ROAD_Y`, and share the water shader.
- The depth texture and `uFieldSize` use the file's `fieldM`, which fixes the missing depth shading beyond 760 m.
- The width is labelled illustrative in code and evidence.

**Solver.** Lines never enter the heat model. A test asserts the built raster is identical with and without `lines`.

**Tests.** Each is seen failing first.
1. The loader accepts files with and without `lines` / `fieldM`, and `fieldM` falls back correctly.
2. Road ribbons are byte-identical before and after the extraction.
3. The raster is unchanged by `lines`.
4. MG Road's served `lines` count and `coveredDropped` are pinned to what the re-pull measures.
5. A dev-server screenshot of MG Road shows the ribbons, and is viewed before the change is committed.

**Evidence.**
- OSM/Overture ODbL, including the share-alike note for derived databases.
- There are no defensible channel widths. The "22/16/6–9 ft" figures are blog-sourced.
- Legal buffers are not widths. The current rule is Gazette UDD 468 MNJ 2025(E), 15 Oct 2025: 15 / 10 / 5 m from the drain edge. The NGT's 50 / 35 / 25 m was set aside by the Supreme Court in *Mantri Techzone v Forward Foundation*, 5 Mar 2019.
- BBMP's primary/secondary/tertiary order was considered and not adopted: it is licence-uncertain, and its tertiary drains largely do not align with OSM outside MG Road.

---

## 4. Park size stays 50 m, with an honest justification

**No model change for either city.** `parkRadiusM` stays 50 for Kolkata and Bengaluru.

**What changes is the justification.** Every place that calls 50 m a measured efficient park size is rewritten to call it a **design default** (a pocket park of about 0.8 ha), and to state why the study behind it cannot stand as a measurement:
- `scope/registry.ts` comments, for Kolkata and Bengaluru;
- `docs/heat-map-intervention-model.md:156–171`;
- any code comment the plan finds that cites "TVoE".

The reasons recorded:
- **TVoE = `a` is a slope,** in °C per ln(area), and its value is the same in any area unit.
- **Li et al. 2022 is inconsistent with itself.** Its Table 7 and TVoE figures disagree (Bangkok 0.62 vs 0.42).
- **Kolkata's sample cannot be reproduced from open data.** Li's parks were hand-picked in Google Earth.

**Saved for later, not run.** The drafted pre-registration is saved to `docs/evidence/` as a dated, **not-run** method, so a future measurement is fixed in advance. It covers:
- Landsat C2 L2 winter scenes via Planetary Computer (SAS path `/token/landsat-c2-l2`);
- OSM parks with a WorldCover tree filter;
- Li's 18 × 30 m ring profile;
- a Kolkata gate;
- a placebo on built-up locations;
- a bootstrap confidence interval;
- a decision rule.

The more physical alternative is recorded beside it: cooling intensity by park-size band (0.1–0.25 / 0.25–1 / 1–5 ha), where Bengaluru has hundreds of parks.

**Evidence.**
- Li et al. 2022, 10.3389/fenvs.2022.1073914.
- Yu et al. 2017. Its correct DOI is **10.1016/j.ecolind.2017.07.002**; `…06.037` resolves to an unrelated paper.
- Shah, Garg & Mishra 2021, 10.1016/j.landurbplan.2021.104043 (Bengaluru cooling distance of 347 m, which is a distance, not a size).
- The Indian TVoE range as reported: 0.77 ha (Kolkata) to about 3 ha (Nagpur, secondary-verified).

---

## Out of scope

- **Bengaluru resilience score (DC-URS).** Next spec. Its inputs are now scoped: per-ward ECOSTRESS/Landsat thermal, Census 2011 houselisting and slum points, and a 198 → 369 ward crosswalk.
- **A visible uncertainty band where UT-GLOBUS disagrees.** Promised in the 2026-09-10 spec, still unbuilt.
- **Drawing tree species differently.** The founder is fine with this as is.
- **Drain widths from the 2010 SWD master plan drawing sheets.**

## Sources

| Source | Licence | Used for |
|---|---|---|
| IMD *Climatological Tables 1991–2020* (imdpune.gov.in) | none stated; cited as published facts | §1 normals |
| GHCN-Daily `IN009010100` | citation, no-warranty | §1 recent-decade cross-check only |
| UT-GLOBUS, Zenodo 11156602 | CC BY 4.0 (data) | §2 |
| Overture Maps `base/water` 2026-07-22.0 | ODbL (OSM-derived features) | §3 |
| Karnataka Gazette UDD 468 MNJ 2025(E) | public record | §3 evidence |
| Li et al. 2022; Yu et al. 2017; Shah et al. 2021 | CC BY / closed / closed | §4 evidence |
| Landsat C2 L2 via Planetary Computer; ESA WorldCover v200 | USGS public domain; CC BY 4.0 | §4 saved method only |

**Ruled out for commercial use:**
- IMD Data Service Portal
- NOAA GSOD/ISD for non-US stations (WMO Resolution 40)
- KGIS/KSRSAC
- LDA lake data
- CSTEP and ATREE heat indices (CC BY-NC)
- Open-Meteo free tier
