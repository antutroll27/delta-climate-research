// tests/unit/cbam-tiles-estimate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import {
  chargeableSplit, renderEstimateIdle, renderEstimateThrown, renderEstimateTiles, tierTone,
} from '../../src/scripts/cbam-ui/tiles-estimate.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const est = (over) => estimateFromPack(pack, {
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15', ...over,
});
const tiles = (e, over = {}) => renderEstimateTiles({
  estimate: e, importDate: '2026-03-15', threshold: '', attestation: '', ...over,
});
const IDLE = 'Choose a good, origin, route, mass and import date to see the provisional exposure.';

test('chargeable share: net over total embedded, one decimal, and the rest is its complement', () => {
  assert.deepEqual(chargeableSplit('475.2', {
    faaTco2e: '145.3725', netTco2e: '329.8275', totalEmbeddedTco2e: '475.2',
    certificates: '329.8275', costEur: '24855.80', indirectTco2e: '0',
  }), { chargeablePct: '69.4', restPct: '30.6', floored: false });
});

test('the tiles for a priced default line: hero, bar, direct embedded, factor, provenance', () => {
  const html = tiles(est());
  assert.ok(html.includes('<div class="b-mega cb-fig"><span class="cb-n">329.828</span></div>'));
  assert.ok(html.includes('<span class="b-tag cb-cost">€24,855.80</span>'));
  assert.equal((html.match(/\bcb-n\b/g) ?? []).length, 1, '#cbOut .cb-n must stay one element');
  assert.equal((html.match(/\bcb-cost\b/g) ?? []).length, 1);
  assert.equal((html.match(/\bcb-fig\b/g) ?? []).length, 1);
  assert.ok(html.includes('style="--share:69.4%"'));
  assert.match(html, />69\.4<span class="b-u">%<\/span>/);
  assert.match(html, />30\.6<span class="b-u">%<\/span>/);
  assert.ok(html.includes('Embedded emissions (direct) · 475.2 tCO₂e'));
  assert.ok(html.includes('145.373 tCO₂e · CBAM factor 2026 0.975'));
  assert.ok(html.includes('329.828 tCO₂e'));
  assert.match(html, /class="chip bronze"><i><\/i>Commission default \+ mark-up</);
  assert.match(html, /b-fill-bronze/);
  assert.doesNotMatch(html, /b-fill-low/, '69.4 % holds its own text');
  assert.doesNotMatch(html, /exceeds the direct emissions/);
  assert.match(html, /Import of 15 Mar 2026/);
  assert.match(html, /<div data-deck><\/div>/, 'the deck slot is painted by paintOutlook');
  assert.doesNotMatch(html, /cb-ol-/, 'the deck must not collide with the strip\'s e2e hooks');
});

test('the engine floor is stated where it applied, and a low share draws the bar as a strip', () => {
  const e = estimateFromPack(pack, {
    cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '0.1' },
  });
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect', 'premise: mixed');
  assert.deepEqual(chargeableSplit(e.emissionsTco2e, e.scenario),
    { chargeablePct: '30.6', restPct: '69.4', floored: true });
  const html = tiles(e);
  assert.ok(html.includes('Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.'));
  assert.ok(html.includes('+ Indirect (electricity) · no free allocation · 4.4 tCO₂e'));
  assert.match(html, /b-fill-ink b-fill-low/, 'mixed tier is ink; 30.6 % is a strip');
  assert.match(html, /class="chip ink"><i><\/i>Verified direct \+ Commission indirect</);
});

test('nothing embedded: no share is invented', () => {
  const e = est({ verified: { directTco2ePerT: '0' } });
  assert.equal(e.scenario.totalEmbeddedTco2e, '0', 'premise');
  assert.equal(chargeableSplit(e.emissionsTco2e, e.scenario), null);
  const html = tiles(e);
  assert.ok(html.includes('style="--share:0%"'));
  assert.match(html, /<div class="b-mid">—<\/div>/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('tier tones follow the colour law', () => {
  assert.equal(tierTone('default+markup'), 'bronze');
  assert.equal(tierTone('actual-verified'), 'cyan');
  assert.equal(tierTone('verified-direct+default-indirect'), 'ink');
  const v = tiles(est({ route: '(D)', verified: { directTco2ePerT: '1.2' } }));
  assert.match(v, /class="chip cyan"><i><\/i>Verified actual</);
  assert.match(v, /b-fill-cyan/);
});

test('idle: the prompt sits in the hero as cb-idle, escaped, and no tile claims anything', () => {
  const html = renderEstimateIdle(IDLE);
  assert.ok(html.includes(`<p class="cb-idle">${IDLE}</p>`));
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /€/, /b-mid/, /b-fp/]) assert.doesNotMatch(html, re);
  assert.ok(renderEstimateIdle('<b>x</b> & y').includes('<p class="cb-idle">&lt;b&gt;x&lt;/b&gt; &amp; y</p>'));
});

test('thrown: "No estimate" and the message, escaped, with no figure', () => {
  const html = renderEstimateThrown('Bad <thing> & more');
  assert.match(html, /cb-tag unavail">No estimate</);
  assert.ok(html.includes('<p class="cb-reason">Bad &lt;thing&gt; &amp; more</p>'));
  assert.doesNotMatch(html, /\bcb-fig\b|\bcb-cost\b|tCO/);
});

test('a refusal keeps the hero, provenance and the reason, and draws no figure anywhere', () => {
  const e = est({ route: '(D)' });
  assert.equal(e.status, 'unavailable', 'premise: (D) has no direct default for India');
  const html = tiles(e);
  assert.ok(html.includes(`<p class="cb-reason">${e.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`));
  assert.match(html, /<span>Missing rule<\/span><code>default\/73063077\/IN\/\(D\)\/2026<\/code>/);
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /b-mid/, /€/]) assert.doesNotMatch(html, re);
  assert.match(html, /Provenance\./);
});

test('the threshold card goes first, whole; no card means no plate', () => {
  const card = '<section class="cb-card cb-thresh">X</section>';
  const html = tiles(est(), { threshold: card });
  assert.ok(html.startsWith(`<div class="b-s2 b-legacy cb-out">${card}</div>`));
  assert.doesNotMatch(tiles(est()), /b-legacy|cb-thresh/);
});

test('the attestation is placed whole, inside the hero', () => {
  const att = '<p class="cb-sub cb-attested">ATTESTED</p>';
  const html = tiles(est(), { attestation: att });
  const hero = /<section class="b-t b-hero[^"]*">[\s\S]*?<\/section>/.exec(html)[0];
  assert.ok(hero.includes(att));
});

test('the page ships the idle tiles as static markup, identical to renderEstimateIdle', () => {
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  const m = /<div id="cbOut" class="b-bento b-out">([\s\S]*?)<\/div>\s*<p class="cb-source" id="cbProv">/.exec(page);
  assert.ok(m, 'the page must carry #cbOut as <div id="cbOut" class="b-bento b-out"> followed by #cbProv');
  const norm = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  assert.equal(norm(m[1]), norm(renderEstimateIdle(IDLE)));
});
