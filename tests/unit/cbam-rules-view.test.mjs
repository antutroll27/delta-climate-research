// tests/unit/cbam-rules-view.test.mjs — the Rules & sources view (spec §5.6) and the D4 count.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { estimateFromPack, selectFactorFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { sectorForCn } from '../../src/scripts/cbam-algos/cbam/sector.ts';
import { renderNotYetPublished, renderRulePack, renderSources } from '../../src/scripts/cbam-ui/tiles-rules.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pack = JSON.parse(read('../../public/cbam/estimator-pack.json'));
const page = read('../../src/pages/cbam/cbam-calculator.astro').replace(/\s+/g, ' ');

/**
 * D4 (spec §11), MEASURED, not typed. Counts the offered goods with at least one production route
 * that has a published 2026 direct default value somewhere, yet whose estimate refuses with a
 * benchmark/ selector: the Commission publishes no Column B benchmark the engine can match, and
 * the engine refuses rather than borrow a nearby one. Origins are pre-filtered from the 2026
 * direct default rows whose scope prefixes the good, then confirmed through the engine's own
 * selectFactorFromPack (a full sweep of every origin gives the same answer; measured 2 Nov 2026:
 * 28 goods, 56 good-route pairs, all iron and steel). A regenerated pack that moves the count turns
 * this red, and the footnote is then rewritten with the new figure.
 */
function benchmarkGaps() {
  const DATE = '2026-03-15';
  const rows = pack.defaultValues.filter((r) => r.reportingYear === 2026 && r.emissionsType === 'direct');
  const goods = new Set();
  let pairs = 0;
  for (const { code } of pack.classifications) {
    const byRoute = new Map();
    for (const r of rows) if (code.startsWith(r.scopeCode)) {
      if (!byRoute.has(r.productionRoute)) byRoute.set(r.productionRoute, new Set());
      byRoute.get(r.productionRoute).add(r.originCountry);
    }
    for (const [route, origins] of byRoute) {
      const origin = [...origins].sort().find((o) => selectFactorFromPack(pack, { cn: code, country: o, route, massT: '100', date: DATE }));
      if (!origin) continue;
      const e = estimateFromPack(pack, { cn: code, country: origin, route, massT: '100', date: DATE });
      if (e.status === 'unavailable' && e.selector?.startsWith('benchmark/')) { goods.add(code); pairs += 1; }
    }
  }
  const sectors = new Map();
  for (const c of goods) sectors.set(sectorForCn(c), (sectors.get(sectorForCn(c)) ?? 0) + 1);
  return { goods: goods.size, pairs, sectors };
}

test('D4: the method footnote prints the measured count, of the pack\'s own good count', () => {
  const m = benchmarkGaps();
  assert.ok(m.goods > 0, 'sanity: the sweep found the known gap (72052100 on (C))');
  assert.deepEqual([...m.sectors.keys()], ['iron_and_steel'],
    `the footnote says every such good is iron and steel; the pack now says ${JSON.stringify([...m.sectors])}. Rewrite the clause.`);
  assert.ok(page.includes(`— ${m.goods} of ${pack.classifications.length} offered goods have at least one such route, and all ${m.goods} are iron and steel.`),
    `the footnote must print ${m.goods} of ${pack.classifications.length}, measured from the pack`);
  assert.ok(!page.includes('183 of 574'), 'the stale count is gone');
});

const S = 'f6af39aed68a4cb332b9dbdf4233ed35b6ca1165cc67f69f1240992f97d7cfdf';

test('renderRulePack: the pack\'s identity, dated, and its snapshot drawn as dots', () => {
  const html = renderRulePack(pack, S);
  assert.match(html, new RegExp(`<p class="b-t-sub num">${pack.identity.id}</p>`));
  assert.match(html, new RegExp(`<div class="b-mid num">${pack.identity.version}</div>`));
  assert.match(html, new RegExp(`<dt>Supersedes</dt><dd class="num">${pack.identity.supersedes}</dd>`));
  assert.match(html, /<dt>Valid from<\/dt><dd class="num">1 Jan 2026<\/dd>/);
  assert.match(html, /<dt>Law as published<\/dt><dd class="num">18 Aug 2026<\/dd>/);
  assert.match(html, new RegExp(`<dt>Basis</dt><dd class="num">${pack.identity.regulatoryBasis.join(' · ')}</dd>`));
  assert.match(html, /class="b-fp/);
  assert.match(html, /Snapshot f6af39aed68a4cb3…/);
  assert.doesNotMatch(renderRulePack(pack, ''), /b-fp|Snapshot/, 'no snapshot yet, no dots');
});

test('renderNotYetPublished: every pending CSCF year and price row, from the pack, never typed', () => {
  const html = renderNotYetPublished(pack);
  const pendingCscf = pack.cscf.filter((r) => r.status === 'pending');
  const pendingPrices = pack.prices.filter((r) => r.status === 'pending');
  assert.ok(pendingCscf.length && pendingPrices.length, 'sanity: the shipped pack owes both');
  for (const r of pendingCscf) assert.ok(html.includes(r.sourceLocator), r.sourceLocator);
  for (const loc of new Set(pendingPrices.map((r) => r.sourceLocator))) assert.ok(html.includes(loc.replace(/&/g, '&amp;')), loc);
  assert.match(html, new RegExp(`Cross-sectoral correction factor, ${pendingCscf[0].year} to ${pendingCscf.at(-1).year}\\.`));
  assert.match(html, /Certificate price, 2026-Q4\./);
  assert.match(html, /Certificate price, 2027-Q1 to 2028-Q4\./);
  assert.match(html, /a floor/, 'the CSCF item says which way the unknown can move the figure');
  // IR 2025/2548: the 2027/28 price is WEEKLY. The pack's own locator says so, and nothing here may
  // re-describe it as quarterly.
  assert.match(html, /weekly certificate price/);
  assert.doesNotMatch(html, /quarterly/i);
});

test('renderNotYetPublished: nothing pending, nothing claimed', () => {
  assert.match(renderNotYetPublished({ cscf: [], prices: [] }), /Nothing the rule pack depends on is unpublished\./);
});

test('renderSources: every source, its legal status and retrieval date, linked only over http(s)', () => {
  const html = renderSources(pack.sources);
  assert.equal((html.match(/<li>/g) ?? []).length, pack.sources.length);
  assert.match(html, new RegExp(`<p class="b-t-sub">${pack.sources.length}, with legal status and retrieval date\\.</p>`));
  for (const s of pack.sources) {
    assert.ok(html.includes(`<span class="chip">${s.legalStatus}</span>`), s.id);
  }
  assert.match(html, /Retrieved 14 Oct 2026/);
  const evil = renderSources([{ ...pack.sources[0], url: 'javascript:alert(1)', title: '<i>t</i>' }]);
  assert.doesNotMatch(evil, /href=/, 'a non-http URL is never a link');
  assert.doesNotMatch(evil, /<i>t<\/i>/, 'titles are escaped');
});
