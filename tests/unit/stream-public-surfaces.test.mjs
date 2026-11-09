import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createAreaSurfaces, PAGE_AREA } from '../../src/scripts/climate-engine/streaming/area-surfaces.ts';
import { areaFromUrl, createPageFurniture, searchWithArea } from '../../src/scripts/climate-engine/streaming/area-page.ts';
import { parseAreaNames } from '../../src/scripts/climate-engine/streaming/loader-model.ts';
import { SHEETS, sheetKey } from '../../src/scripts/climate-engine/scope/sheets.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { heatAccuracyClaim, NOT_VALIDATED_LINE } from '../../src/scripts/climate-engine/scope/accuracy-claim.ts';
import { PUBLIC_AREA_KEYS, TILED_CITY_READY } from '../../src/scripts/climate-engine/scope/registry.ts';
import { areaPageIndexable } from '../../src/scripts/climate-engine/scope/public-routes.ts';
import { WARDS, PUBLISHED_CITIES } from '../../src/data/wards.ts';

/* PUBLIC STREAMING: EVERY SURFACE THAT ASSUMED ONE AREA. The page is Canal Ring's and every other area is `?area=F4` on it. For each surface, either it works for the
   open area or it says it does not yet; it never prints Canal Ring's numbers, files or name for another area. The table of decisions is in
   /Volumes/OBOSLab/research/city-streaming/PUBLIC-STATUS.md; each guard has a test here. heat-map-app.ts cannot be loaded by node, so its guards are read from its source. */

const NAMES = parseAreaNames(JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/area-names.json', import.meta.url), 'utf8')));
const surfaces = createAreaSurfaces(NAMES, 'Amsterdam');
const app = readFileSync(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
const FOREIGN = SHEETS.filter((s) => s.code !== PAGE_AREA);

test('the page\'s own area is Canal Ring (E4); the other 31 are foreign to it', () => {
  assert.equal(PAGE_AREA, 'E4');
  assert.equal(SHEETS.find((s) => s.code === 'E4').id, 'canal-ring');
  assert.equal(FOREIGN.length, 31);
  assert.equal(surfaces.isForeign('E4'), false);
  assert.ok(FOREIGN.every((s) => surfaces.isForeign(s.code)));
});

test('page title and description: name the open area, never Canal Ring, and keep the caveat', () => {
  for (const s of FOREIGN) {
    const name = surfaces.header(s.code).name;
    const title = surfaces.title(s.code), description = surfaces.description(s.code);
    assert.ok(title.includes(name) && title.includes(`Area ${s.code}`), title);
    assert.ok(description.includes(name), description);
    assert.ok(!/Canal Ring/.test(title + description), `${s.code} must not read as Canal Ring`);
    assert.ok(/not yet validated/.test(description), 'the description carries the heat-accuracy caveat');
    assert.ok(!/No measured heat artefacts ship/.test(description), 'the "registered, nothing ships" sentence is false for a streamed area');
  }
});

test('the other surfaces name the open area and withdraw cleanly', () => {
  for (const s of FOREIGN) {
    const name = surfaces.header(s.code).name;
    for (const sentence of [surfaces.record(s.code), surfaces.receipts(s.code), surfaces.solar(s.code)]) {
      assert.ok(sentence.includes(name), sentence);
      assert.ok(!/Canal Ring/.test(sentence), sentence);
      assert.ok(/\byet\b/.test(sentence), `"not yet", not "never": ${sentence}`);
    }
  }
  assert.match(surfaces.compareUnavailable, /not available for this area yet/i);
});

test('heat-map-app: the document meta of a streamed area leaves the URL tags alone (canonical and og:url stay on Canal Ring\'s query-free page)', () => {
  const fn = app.slice(app.indexOf('function updateDocumentMeta()'), app.indexOf('function updateScopeSwitcher()'));
  const foreign = fn.slice(0, fn.indexOf('const scope = resolve(state.ward);'));
  assert.match(foreign, /STREAM_ON \? foreignArea\(\) : null/);
  assert.match(foreign, /if \(of !== 'url'\)/, 'only title and description tags are written for a streamed area');
  assert.ok(!/areaPath\(/.test(foreign), 'a streamed area has no path of its own');
  assert.match(foreign, /return;/);
});

test('heat-map-app: Compare, the ward brief links and the record link are withdrawn for a streamed area, and restored for Canal Ring', () => {
  const cmp = app.slice(app.indexOf('function updateCompareHref()'), app.indexOf('/* ── instrument wiring ── */'));
  assert.match(cmp, /if \(STREAM_ON\) \{/);
  assert.match(cmp, /\[data-v2-brief\], \[data-v2-brief-link\]/);
  assert.match(cmp, /a\.removeAttribute\('href'\)/);
  assert.match(cmp, /a\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(cmp, /if \(foreign !== null\) return;/, 'a streamed area never gets a Compare query');
  assert.ok(cmp.indexOf('if (foreign !== null) return;') < cmp.indexOf('a: toLegacyWard(state.ward)'));
  const rep = app.slice(app.indexOf('function updateReportHref()'), app.indexOf('function updateAddressBar()'));
  assert.match(rep, /link\.toggleAttribute\('hidden', foreignArea\(\) !== null\)/);
});

test('heat-map-app: receipts and the solar pane say "not yet" for a streamed area without a fetch or a Canal Ring file', () => {
  const src = app.slice(app.indexOf('const renderSources = async () => {'), app.indexOf('const rows = manifest.layers.map'));
  assert.match(src, /foreignArea\(\)/);
  assert.ok(src.indexOf('streamSurfaces!.receipts(foreign)') < src.indexOf('await loadLayerManifest(state.ward)'), 'no manifest is fetched for a streamed area');
  assert.match(app, /foreign !== null \? streamSurfaces!\.solar\(foreign\)/);
});

test('every guard sits behind the compile-time flag, so a build without it keeps none of them', () => {
  const calls = app.split('\n').filter((l) => /foreignArea\(\)/.test(l) && !/^\s*(\/\*\*|const foreignArea = )/.test(l));
  assert.equal(calls.length, 5);
  for (const line of calls) assert.ok(/STREAM_ON/.test(line) || /const foreign = foreignArea\(\);/.test(line), line.trim());
  assert.match(app, /if \(STREAM_ON\) \{\s*\/\* COMPARE AND THE WARD BRIEF[\s\S]*const foreign = foreignArea\(\);/, 'the one bare call is inside an `if (STREAM_ON)` block');
  assert.match(app, /if \(link && STREAM_ON\) link\.toggleAttribute/);
});

test('the kill switch: ?stream=0 gives the classic page on a public build, and the dev build still needs ?stream=1', () => {
  const m = /const STREAM_ON = (\([^;]*\)\s*&& INITIAL_AREA[^;]*);/s.exec(app);
  assert.ok(m, 'the STREAM_ON expression is found');
  const decide = (env, area, search) => new Function('INITIAL_AREA', 'streamParam', `const e = ${JSON.stringify(env)}; return ${m[1].replaceAll('import.meta.env.', 'e.')};`)(area, () => new URLSearchParams(search).get('stream'));
  const CR = 'nl/amsterdam/canal-ring';
  // a build with neither flag: never
  assert.equal(decide({}, CR, '?stream=1'), false);
  assert.equal(decide({}, CR, ''), false);
  // public: on by default, off with ?stream=0, only on Canal Ring's page
  assert.equal(decide({ PUBLIC_OBOS_STREAM: '1' }, CR, ''), true);
  assert.equal(decide({ PUBLIC_OBOS_STREAM: '1' }, CR, '?area=F4'), true);
  assert.equal(decide({ PUBLIC_OBOS_STREAM: '1' }, CR, '?stream=0'), false);
  assert.equal(decide({ PUBLIC_OBOS_STREAM: '1' }, CR, '?stream=0&area=F4'), false);
  assert.equal(decide({ PUBLIC_OBOS_STREAM: '1' }, 'in/kolkata/ballygunge', ''), false);
  assert.equal(decide({ PUBLIC_OBOS_STREAM: 'true' }, CR, ''), false, 'only "1" is the flag');
  // dev: unchanged, ?stream=1 only
  assert.equal(decide({ PUBLIC_OBOS_STREAM_DEV: '1' }, CR, ''), false);
  assert.equal(decide({ PUBLIC_OBOS_STREAM_DEV: '1' }, CR, '?stream=1'), true);
  assert.equal(decide({ PUBLIC_OBOS_STREAM_DEV: '1' }, 'in/kolkata/ballygunge', '?stream=1'), false);
});

test('the dev tools exist only in a dev-flag build: the GL meter, the timings, ?streamtier=, window.__obosStream and the console warning', () => {
  assert.match(app, /const STREAM_TOOLS = import\.meta\.env\.PUBLIC_OBOS_STREAM_DEV === '1' && STREAM_ON;/);
  assert.match(app, /const glMeterReady = STREAM_TOOLS \?/);
  assert.match(app, /if \(STREAM_TOOLS\) \{\s*const asked = new URLSearchParams\(window\.location\.search\)\.get\('streamtier'\)/);
  assert.match(app, /if \(STREAM_TOOLS\) \(window as unknown as \{ __obosStream/);
  assert.match(app, /warn: STREAM_TOOLS \?/);
  for (const use of app.split('\n').filter((l) => /streamTimings\.(stage|commit|after|reset|rebuilds)/.test(l) && !/^\s*(\/\/|\*|const streamTimings)/.test(l))) assert.match(use, /STREAM_TOOLS/, use.trim());
});

test('the address carries the area and nothing that makes a second page: ?area=F4 round-trips, and the kill switch keeps whatever else is there', () => {
  assert.equal(areaFromUrl('?area=F4'), 'F4');
  assert.equal(areaFromUrl('?area=f4'), 'F4');
  assert.equal(areaFromUrl('?area=ZZ'), null);
  assert.equal(searchWithArea('', 'F4'), '?area=F4');
  assert.equal(searchWithArea('?stream=0', 'F4'), '?stream=0&area=F4');
  assert.match(app, /if \(STREAM_ON\) return;     \/\/ a streamed area has no page of its own/, 'the app never rewrites the address to a path a streamed area does not have');
  // the writer in the furniture is called with the area, and an old fake writer without `surfaces` is still valid
  const calls = [];
  const writer = { header() {}, areaSelect() {}, address() {}, surfaces: (c) => calls.push(c) };
  createPageFurniture({ loader: { command() {}, stage() {}, setFacts() {} }, picker: { update() {}, setDrawnCount() {} }, writer, names: NAMES, location: () => ({ pathname: '/p/', search: '', hash: '' }) }).areaShown('F4', 10);
  assert.deepEqual(calls, ['F4']);
});

test('SEO: no streamed area is a page, a sitemap entry, or an indexable duplicate of Canal Ring\'s', () => {
  assert.equal(TILED_CITY_READY, false);
  assert.ok(!PUBLIC_AREA_KEYS.some((k) => /\/ams-/.test(k)), 'no per-area page is generated for a streamed area');
  assert.equal(areaPageIndexable('/heat-map/nl/amsterdam/canal-ring/'), false, 'Canal Ring\'s page is noindex today, so ?area= URLs cannot be indexed either');
  assert.equal(areaPageIndexable('/heat-map/nl/amsterdam/ams-f4/'), false);
  const base = readFileSync(new URL('../../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.match(base, /const canonical = new URL\(Astro\.url\.pathname, Astro\.site\);/, 'the canonical is the pathname alone: a query never reaches it');
});

test('catalogue and downloads: no streamed area has a ward record, STAC, CityJSON, 3D Tiles or NGSI entry', () => {
  assert.ok(!PUBLISHED_CITIES.includes('amsterdam'));
  assert.ok(WARDS.every((w) => !SHEETS.some((s) => s.id === w.id)), 'those routes are generated from WARDS');
  for (const s of SHEETS) assert.equal(resolve(sheetKey(s)).area.publishes, false, s.code);
  // the one download link on the page that could name a streamed area is withdrawn (above); the solar CSV is hidden with the solar screen
  assert.match(app, /link\.setAttribute\('hidden', ''\);\s*return;/);
});

test('HONESTY: every streamed area carries the Amsterdam caveat, from the city, not from a per-area switch', () => {
  for (const s of SHEETS) {
    const scope = resolve(sheetKey(s));
    assert.equal(scope.city.id, 'amsterdam');
    const claim = heatAccuracyClaim(scope.tier, scope.city.id);
    assert.equal(claim.kind, 'none', s.code);
    assert.equal(claim.line, NOT_VALIDATED_LINE);
  }
  // the app writes it for the OPEN area from the registry's city tier, with no streaming branch in between
  assert.match(app, /const claim = heatAccuracyClaim\(resolve\(state\.ward\)\.tier, resolve\(state\.ward\)\.city\.id\);/);
  assert.match(app, /paintPatternNote\(heatAccuracyClaim\(resolve\(state\.ward\)\.tier, resolve\(state\.ward\)\.city\.id\)\);/);
});
