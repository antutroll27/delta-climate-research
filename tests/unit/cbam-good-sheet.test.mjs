// tests/unit/cbam-good-sheet.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sectorForCn } from '../../src/scripts/cbam-algos/cbam/sector.ts';
import {
  RESULT_LIMIT, SECTOR_CHIPS, goodCaption, renderGoodResults, renderSectorChips, searchGoods,
} from '../../src/scripts/cbam-ui/good-sheet.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const goods = pack.classifications;

test('five chips, one per sector the pack prices, in the spec\'s order; no electricity good exists', () => {
  assert.deepEqual(SECTOR_CHIPS.map((c) => c.label), ['Iron & steel', 'Aluminium', 'Cement', 'Fertilisers', 'Hydrogen']);
  const counts = Object.fromEntries(SECTOR_CHIPS.map((c) => [c.key, searchGoods(goods, '', c.key).length]));
  assert.deepEqual(counts, { iron_and_steel: 478, aluminium: 58, cement: 8, fertilisers: 27, hydrogen: 1 });
  assert.equal(goods.filter((g) => sectorForCn(g.code) === 'electricity').length, 0,
    'the sheet says "No electricity goods are priced here"; that must stay true of the pack');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), goods.length, 'every good sits under a chip');
});

test('a number searches codes by prefix; spaces and dots in a typed code are ignored', () => {
  const r = searchGoods(goods, '7306', null);
  assert.equal(r.length, 22);
  assert.ok(r.every((g) => g.code.startsWith('7306')));
  assert.deepEqual(searchGoods(goods, '2523 10', null).map((g) => g.code), ['2523100010', '2523100090']);
  assert.deepEqual(searchGoods(goods, '2523.10', null), searchGoods(goods, '252310', null));
});

test('words search descriptions: every word, any order, any case', () => {
  const r = searchGoods(goods, 'welded tube', null);
  assert.equal(r.length, 25);
  assert.ok(r.every((g) => /welded/i.test(g.description) && /tube/i.test(g.description)));
  assert.deepEqual(searchGoods(goods, '  TUBE   Welded ', null), r);
  assert.ok(r.some((g) => g.code === '73063077'));
});

test('a sector narrows the search, and an empty query lists the sector', () => {
  const steel = searchGoods(goods, 'welded tube', 'iron_and_steel');
  assert.ok(steel.every((g) => sectorForCn(g.code) === 'iron_and_steel'));
  assert.deepEqual(searchGoods(goods, '', 'hydrogen').map((g) => g.code), ['28041000']);
});

test('results: escaped, capped, the current code marked, and a no-match says what to try', () => {
  const tube = goods.find((g) => g.code === '73063077');
  const html = renderGoodResults([tube], '73063077');
  assert.ok(html.includes('data-code="73063077"'));
  assert.match(html, /class="b-res on"/);
  assert.ok(html.includes('&lt;= 168,3 mm'), 'the Commission\'s "<=" is escaped');
  assert.ok(html.includes('&quot;gas pipe&quot;'));
  const all = renderGoodResults(goods, '');
  assert.equal((all.match(/class="b-res(?: on)?"/g) ?? []).length, RESULT_LIMIT);
  assert.ok(all.includes(`Showing ${RESULT_LIMIT} of ${goods.length}. Narrow the search to see the rest.`));
  assert.match(renderGoodResults([], ''), /No good matches/);
});

test('the caption under #cbCn is the full CN description, or nothing for an unknown code', () => {
  assert.equal(goodCaption(goods, '73063077'), goods.find((g) => g.code === '73063077').description);
  assert.equal(goodCaption(goods, ' 73063077 '), goodCaption(goods, '73063077'));
  assert.equal(goodCaption(goods, '99999999'), '');
});

test('the chips render pressed state, and the page uses this renderer (one spelling)', () => {
  const html = renderSectorChips('cement');
  assert.equal((html.match(/<button /g) ?? []).length, 5);
  assert.match(html, /data-sector="cement" aria-pressed="true">Cement</);
  assert.match(html, /data-sector="iron_and_steel" aria-pressed="false">Iron &amp; steel</);
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  assert.match(page, /set:html=\{renderSectorChips\(null\)\}/, 'the sheet\'s chips come from this module');
});
