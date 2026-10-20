// tests/unit/obos-v2-weather-panel.test.mjs — OBOS v2 spec §4.5, H22 [H] (Track B, plan S7.2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseMetar } from '../../src/lib/weather/metar.ts';
import { decodeRows, rainMemory, wardTime, weatherSource } from '../../src/scripts/climate-engine/v2/weather-panel.ts';

const FIX = JSON.parse(readFileSync('tests/fixtures/metar/metar-20261007T0609Z.json', 'utf8'));
const REF = Date.parse('2026-10-07T06:09:00.000Z');
const VECC = parseMetar(FIX.find((r) => r.icaoId === 'VECC').rawOb, REF);

test('decode: every recognised group in words, whole degrees, nothing invented', () => {
  const rows = decodeRows(VECC, 'Asia/Kolkata');
  const text = rows.map((r) => `${r.code}=${r.text}`).join('\n');
  assert.match(text, /070600Z=observed 06:00 UTC = 11:30 IST/);
  assert.match(text, /05004KT=wind from 050° at 4 knots/);
  assert.match(text, /3200=visibility 3,200 m/);
  assert.match(text, /-RA=light rain/);
  assert.match(text, /SCT018=scattered cloud at 1,800 ft/);
  assert.match(text, /FEW025CB=few cloud at 2,500 ft, cumulonimbus/);
  assert.match(text, /31\/23=air 31 °C, dew point 23 °C/);
  assert.match(text, /Q1015=sea-level pressure 1015 hPa/);
});

test('decode: groups the parser did not recognise are said, not hidden', () => {
  const m = { ...VECC, unparsed: ['ZZZ9'] };
  assert.ok(decodeRows(m, 'Asia/Kolkata').some((r) => r.code === 'ZZZ9' && r.text === 'not recognised, dropped'));
});

test('rain memory: the span is the reports held, never an asserted window', () => {
  const r = rainMemory([VECC], 'Asia/Kolkata');
  assert.equal(r.cells.length, 1);
  assert.equal(r.since, '11:30 IST');
  assert.equal(r.wetCount, 1);
  assert.deepEqual(r.cells[0], { time: '11:30 IST', tempC: 31, wet: true });
  assert.equal(rainMemory([], 'Asia/Kolkata').since, null);
});

test('wardTime matches the app\'s istLike (heat-map-app.ts:2992)', () => {
  assert.equal(wardTime('2026-10-07T06:00:00Z', 'Asia/Kolkata'), '11:30 IST');
});

test('E5: paintWeatherLine publishes the observation it painted, and only adds', () => {
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  const fn = app.slice(app.indexOf('function paintWeatherLine'), app.indexOf('function paintLive'));
  assert.match(fn, /document\.dispatchEvent\(new CustomEvent\('obos:observed', \{ detail: \{ observed, reports: /);
});

/* THE SOURCE RULE (founder, 17 Oct; spec correction, A-S3 audit F1): the kind chip and the solid/outlined symbol follow the ACTUAL source.
   Only a fresh airport METAR (the app's `observed`, which is non-null only inside METAR_STALE_MIN) is OBSERVED with a solid symbol. */
test('source: a fresh airport report is observed and solid; the Met Norway fallback is a forecast and outlined; no reading claims nothing', () => {
  assert.deepEqual(weatherSource(true, true), { kind: 'observed', chip: 'observed', solid: true });
  assert.deepEqual(weatherSource(false, true), { kind: 'forecast', chip: 'forecast', solid: false });
  assert.deepEqual(weatherSource(false, false), { kind: 'none', chip: 'no reading', solid: false });
  /* A-S4 audit F8: an observation with no number is claimed as nothing (Track A's stricter rule, now THE rule for both screens) */
  assert.deepEqual(weatherSource(true, false), { kind: 'none', chip: 'no reading', solid: false });
});

test('markup: WeatherCards never wears "observed" or a solid mark before a report says so', () => {
  const src = readFileSync('src/components/ClimateEngine/v2/WeatherCards.astro', 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  /* the chip is written by the script from weatherSource(); its server-rendered default is the unproven state */
  assert.match(src, /data-wx="chip"[^>]*>no reading</, 'the weather-now chip must start as "no reading"');
  assert.ok(!/class="kind measured"[^>]*>\s*observed\s*</.test(src), 'a static "observed" chip is a claim made before any report');
  /* every symbol that depends on the source exists in both forms, toggled by data-wx-src */
  assert.ok(/data-wx-src="observed"/.test(src) && /data-wx-src="forecast"/.test(src), 'the solid and outlined air-temperature marks must both exist');
  assert.ok(!/\b(validated|guarantee)\b/i.test(src));
});

test('the bound script writes the chip and the mark from weatherSource, not from the card\'s own words', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/weather-v2.ts', 'utf8');
  assert.match(src, /weatherSource\(/);
  assert.match(src, /data-wx-src/);
  assert.match(src, /obos:observed/);
});

test('F2/F3/F8 (B-S7 audit): the no-report sentence is v1\'s truth, no invented precision line, the dew source is named', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/weather-v2.ts', 'utf8');
  assert.ok(src.includes('`No airport report in the last ${METAR_STALE_MIN} minutes.`'), 'F2: the sentence must not claim a report exists');
  assert.ok(!/older than/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), 'F2: "older than" claims a report');
  assert.ok(!/to a tenth of a degree/.test(src), 'F3: an invented precision line');
  assert.match(src, /set\('tfoot', ''\)/, 'F3: the forecast branch leaves the temperature foot empty');
  assert.ok(src.includes("'from the Met Norway forecast'"), 'F8: humidity under an observed chip that is met.no\'s says so');
});

test('F5 (B-S7 audit): the pane\'s sub-index bars are ink, not a band colour with no band word', () => {
  const css = readFileSync('src/styles/obos-v2/screens/air.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /#airPane \.si i \{[^}]*background: var\(--ink-3\) !important/);
});

test('F8 (B-S7 audit): the forecast state does not describe rings that are not drawn', () => {
  const css = readFileSync('src/styles/obos-v2/screens/weather.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\[data-v2-card="rain"\] \.hrs:empty ~ \.foot \{ display: none; \}/);
});

test('F6 (B-S7 audit): the solar binder was a recorded request (b-01) and now lives in solar-v2.ts, with no TODO left behind', () => {
  // Repo files only: the recorded request itself (requests/b-01-solar-binder.md) lives in the OBOSLab hub, which CI cannot see.
  assert.ok(existsSync('src/scripts/climate-engine/v2/solar-v2.ts'), 'b-01 applied: solar-v2.ts');
  for (const f of ['weather-v2.ts', 'solar-v2.ts'])
    assert.ok(!/TODO\(request b-01\)/.test(readFileSync(`src/scripts/climate-engine/v2/${f}`, 'utf8')), `${f}: no TODO(request b-01) left behind`);
});

test('F1 (B-S7 audit): the brief link mirrors the app\'s own Compare query', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/solar-v2.ts', 'utf8');   // b-01: moved out of weather-v2.ts
  assert.match(src, /a\[data-rail="analysis"\]/);
  assert.match(src, /\/heat-map\/compare\/[\s\S]*\/heat-map\/brief\//);
  assert.match(src, /data-v2-brief/);
});
