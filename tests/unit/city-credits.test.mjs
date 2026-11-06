import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { transform } from '@astrojs/compiler-rs';
import { addAttribute, escapeHTML, unescapeHTML, HTMLString } from 'astro/runtime/server/index.js';

import { CITY_CREDITS, CITY_MAP_CREDIT, CITY_CREDIT_NOTE, joinMapCredits } from '../../src/data/city-credits.ts';
import { creditListHtml, creditNoteHtml } from '../../src/scripts/climate-engine/v2/credit-html.ts';
import { SENTINEL_CREDIT } from '../../src/scripts/climate-engine/v2/credits.ts';
import { creditsPanelHtml } from '../../src/scripts/climate-engine/v2/credit-html.ts';
import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

/* tests/fixtures/credits/overlays-original-lines.html is the seven <li> lines
   v2/Overlays.astro typed before credits became per-city data, cut from origin/main
   (f0eeaa5 lineage) verbatim, with the one Astro expression in it
   ({SENTINEL_CREDIT...}) left as written. Rendering the Kolkata/Bengaluru rows must
   reproduce it character for character once that expression is expanded. */

function originalWithSentinelExpanded() {
  const raw = readFileSync('tests/fixtures/credits/overlays-original-lines.html', 'utf8').replace(/\n$/, '');
  const expr = '<a href={SENTINEL_CREDIT.url ?? undefined} target="_blank" rel="noopener noreferrer">{SENTINEL_CREDIT.licence}</a>';
  assert.ok(raw.includes(expr) && raw.includes('{SENTINEL_CREDIT.lead}'), 'the fixture holds the Astro expressions');
  return raw
    .replace('{SENTINEL_CREDIT.lead}', SENTINEL_CREDIT.lead)
    .replace(expr, `<a href="${SENTINEL_CREDIT.url}" target="_blank" rel="noopener noreferrer">${SENTINEL_CREDIT.licence}</a>`)
    .replace(/^ {6}/, '')
    /* what `compressHTML` makes of the template's newline + indent between <li>s (proved against the real compiler below) */
    .replace(/\n\s*/g, ' ');
}

test('Kolkata and Bengaluru credits render byte-identical to the Overlays.astro lines they replaced', () => {
  const expected = originalWithSentinelExpanded();
  for (const city of ['kolkata', 'bengaluru']) {
    assert.equal(creditListHtml(CITY_CREDITS[city], SENTINEL_CREDIT), expected, city);
    assert.equal(CITY_MAP_CREDIT[city], null, `${city}: the map control is untouched`);
    assert.equal(creditNoteHtml(CITY_CREDIT_NOTE[city]), '', `${city}: nothing is appended to the panel`);
  }
});

test('the fixture really is the pre-change template (guards the guard)', () => {
  const raw = readFileSync('tests/fixtures/credits/overlays-original-lines.html', 'utf8');
  assert.equal(raw.split('\n').filter((l) => l.includes('<li>')).length, 7);
  assert.ok(raw.includes('Heights Google Open Buildings 2.5D'));
});

test('Amsterdam is credited for what it uses and says nothing false about Kolkata\'s stack', () => {
  const html = creditListHtml(CITY_CREDITS.amsterdam, SENTINEL_CREDIT);
  assert.match(html, /<a href="https:\/\/docs\.3dbag\.nl\/en\/copyright\/"[^>]*>© 3DBAG by tudelft3d and 3DGI<\/a>/);
  assert.match(html, /Modified: footprints of 3DBAG v2025\.09\.03 simplified to 0\.5 m; height = 70th-percentile roof minus ground level/);
  assert.match(html, /Heights: <a href="https:\/\/www\.ahn\.nl\/"[^>]*>AHN5<\/a>, Het Waterschapshuis<small><a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0/);
  assert.match(html, /Ground <a href="https:\/\/www\.ahn\.nl\/"[^>]*>AHN4<\/a> via PDOK, <span id="terrLab">indicative<\/span><small><a [^>]*>CC0/);
  assert.match(html, /Canopy © Meta \/ WRI<small><a [^>]*>CC BY 4\.0/);
  assert.match(html, /OpenStreetMap contributors via .*Overture Maps.*<small>ODbL/);
  assert.match(html, /\(bron: KNMI\)\. KNMI is not involved in this derived product and does not necessarily endorse its purport\./);
  assert.match(html, /Copernicus Sentinel/);
  for (const stale of ['Google Open Buildings', 'SRTM', 'Footprints © ']) assert.ok(!html.includes(stale), `Amsterdam must not carry "${stale}"`);
  assert.ok(!/TODO/.test(html + CITY_MAP_CREDIT.amsterdam + CITY_CREDIT_NOTE.amsterdam), 'the AHN5 wording is settled (AHN5-LICENCE.md)');
  assert.equal((html.match(/id="terrLab"/g) ?? []).length, 1, 'exactly one #terrLab for the app to fill');
});

test('3D BAG\'s map credit is in the map control with its link, AHN5 and the modification line', () => {
  const c = CITY_MAP_CREDIT.amsterdam;
  assert.ok(c.startsWith('<a href="https://docs.3dbag.nl/en/copyright/"'));
  assert.ok(c.includes('© 3DBAG by tudelft3d and 3DGI</a>'));
  assert.match(c, /Heights: <a [^>]*>AHN5<\/a>, Het Waterschapshuis \(<a [^>]*>CC BY 4\.0<\/a>\)/);
  assert.match(c, /Terrain: <a [^>]*>AHN4<\/a> \(CC0\) via PDOK/);
  assert.ok(c.endsWith('modified by Delta Climate'));
  assert.equal(joinMapCredits(null, null), null);
  assert.equal(joinMapCredits(c, null), c);
  assert.equal(joinMapCredits(null, 'w'), 'w');
  assert.equal(joinMapCredits('a', 'w'), 'a · w');
});

test('the Amsterdam note carries the no-endorsement statement', () => {
  const n = CITY_CREDIT_NOTE.amsterdam;
  assert.match(n, /Neither 3DBAG, TU Delft, 3DGI nor Het Waterschapshuis endorses this product\./);
  assert.match(creditNoteHtml(n), /^<li class="credit-note">/);
});

test('Overlays.astro renders the lines from data and keeps the Sentinel credit inside the data branch', () => {
  const o = readFileSync('src/components/ClimateEngine/v2/Overlays.astro', 'utf8');
  assert.ok(o.includes('creditsPanelHtml(scope.city.id') && o.includes('SENTINEL_CREDIT'));
  assert.ok(!/as CityId/.test(o), 'no cast: the registry type must catch a missing city');
  assert.ok(!o.includes('Heights Google Open Buildings'), 'no city-specific line typed in the template any more');
  const data = o.indexOf('scope.area.hasData ? (<Fragment>');
  const html = o.indexOf('set:html={creditsHtml}');
  const none = o.indexOf('Nothing is mapped for this area yet.');
  assert.ok(data > 0 && html > data && none > html);
});

/* F1 (Amsterdam audit): the credits were total over CITIES, not over the REGISTRY, and Dubai (registered, not drawable, absent from
   CITIES) threw in the build's prerender. Walk every registered area, Dubai included, through the same path Overlays.astro takes. */
test('every registered area, Dubai included, has a credits, map-credit and note row and renders without throwing', () => {
  const cities = new Set(AREA_KEYS.map((k) => splitKey(k).city));
  assert.ok(cities.has('dubai') && cities.has('amsterdam') && cities.has('kolkata'), 'the walk really covers the registry');
  for (const key of AREA_KEYS) {
    const scope = resolve(key);
    const id = scope.city.id;
    for (const [name, table] of [['CITY_CREDITS', CITY_CREDITS], ['CITY_MAP_CREDIT', CITY_MAP_CREDIT], ['CITY_CREDIT_NOTE', CITY_CREDIT_NOTE]]) {
      assert.ok(id in table, `${name} has no row for registered city "${id}" (${key})`);
    }
    const html = creditsPanelHtml(id, SENTINEL_CREDIT);
    assert.equal(typeof html, 'string', key);
    if (scope.area.hasData) assert.match(html, /Basemap/, `${key}: a drawable area credits its basemap`);
    assert.ok(joinMapCredits(CITY_MAP_CREDIT[id], null) === null || typeof joinMapCredits(CITY_MAP_CREDIT[id], null) === 'string');
  }
  for (const table of [CITY_CREDITS, CITY_MAP_CREDIT, CITY_CREDIT_NOTE]) {
    for (const id of Object.keys(table)) assert.ok(cities.has(id), `"${id}" has a row but is not a registered city`);
  }
});

test('joinMapCredits never lets an undefined through', () => {
  assert.equal(joinMapCredits(undefined, null), null);
  assert.equal(joinMapCredits(undefined, 'w'), 'w');
  assert.equal(joinMapCredits('a', undefined), 'a');
});

/* F2: the unit test above compares the string creditListHtml returns; the PAGE carries what the compiler makes of the template around
   it. Compile Overlays.astro as it is now and as origin/main had it, both in the compiler's compact mode (what `compressHTML: true`
   uses), run the compiled <ul> through Astro's own escaping helpers, and require the Kolkata and Bengaluru panels to be identical. */
const COMPILED_UL = /<ul> \$\{scope\.area\.hasData[\s\S]*?<\/ul>/;
async function renderedCreditsUl(source, filename, scope, creditsHtml) {
  const code = (await transform(source, { filename, compact: true })).code;
  const m = COMPILED_UL.exec(code);
  assert.ok(m, `${filename}: compiled credits list found`);
  const render = (strings, ...vals) => new HTMLString(strings.reduce((out, str, i) => out + str + (i < vals.length ? (vals[i] instanceof HTMLString ? vals[i] : escapeHTML(String(vals[i]))) : ''), ''));
  const fn = new Function('$$render', '$$renderComponent', '$$result', 'Fragment', '$$addAttribute', '$$unescapeHTML',
    'scope', 'SENTINEL_CREDIT', 'creditsHtml', `return $$render\`${m[0]}\`;`);
  return String(fn(render, (_r, _n, _c, _p, slots) => slots.default(), {}, null, addAttribute, unescapeHTML, scope, SENTINEL_CREDIT, creditsHtml));
}
function originMainOverlays() {
  return execFileSync('git', ['show', 'origin/main:src/components/ClimateEngine/v2/Overlays.astro'], { encoding: 'utf8' });
}

test('the compiled credits panel for Kolkata and Bengaluru is character-identical to origin/main\'s', async () => {
  const now = readFileSync('src/components/ClimateEngine/v2/Overlays.astro', 'utf8');
  const before = originMainOverlays();
  for (const key of ['in/kolkata/ballygunge', 'in/bengaluru/mg-road']) {
    const scope = resolve(key);
    assert.ok(scope.area.hasData, key);
    const old = await renderedCreditsUl(before, 'old/Overlays.astro', scope, '');
    const neu = await renderedCreditsUl(now, 'new/Overlays.astro', scope, creditsPanelHtml(scope.city.id, SENTINEL_CREDIT));
    assert.ok(old.includes('Heights Google Open Buildings 2.5D') && old.includes('id="attrWard"'), `${key}: the old render is the real panel`);
    assert.equal(neu, old, key);
  }
});

test('the compiled panel for a registered city without credits renders (Dubai is not drawable: "nothing mapped")', async () => {
  const now = readFileSync('src/components/ClimateEngine/v2/Overlays.astro', 'utf8');
  const scope = resolve('ae/dubai/creek');
  const out = await renderedCreditsUl(now, 'new/Overlays.astro', scope, creditsPanelHtml(scope.city.id, SENTINEL_CREDIT));
  assert.match(out, /Nothing is mapped for this area yet\./);
});
