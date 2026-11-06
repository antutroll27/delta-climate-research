import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CITY_CREDITS, CITY_MAP_CREDIT, CITY_CREDIT_NOTE, joinMapCredits } from '../../src/data/city-credits.ts';
import { creditListHtml, creditNoteHtml } from '../../src/scripts/climate-engine/v2/credit-html.ts';
import { SENTINEL_CREDIT } from '../../src/scripts/climate-engine/v2/credits.ts';

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
    .replace(/^ {6}/, '');
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
  assert.match(html, /bron: KNMI\. KNMI is not involved/);
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
  assert.ok(o.includes('CITY_CREDITS[cityId]') && o.includes('SENTINEL_CREDIT'));
  assert.ok(!o.includes('Heights Google Open Buildings'), 'no city-specific line typed in the template any more');
  const data = o.indexOf('scope.area.hasData ? (<Fragment>');
  const html = o.indexOf('set:html={creditsHtml}');
  const none = o.indexOf('Nothing is mapped for this area yet.');
  assert.ok(data > 0 && html > data && none > html);
});
