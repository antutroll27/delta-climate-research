// tests/unit/cbam-inputs-estimate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveThreshold, routesFor } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import {
  defaultOriginBasis, defaultTierSentence, renderDatePeriod, renderMassRuler, renderRouteSegments, segmentLabel,
  verifiedOnlyNote, verifiedOnlyRoutes,
} from '../../src/scripts/cbam-ui/inputs-estimate.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

test('verified-only routes are the ones the ENGINE refuses on defaults for want of a direct default', () => {
  const rs = routesFor(pack, '73063077', 'IN', 2026);
  assert.deepEqual(rs, ['(C)', '(D)', '(E)'], 'premise');
  assert.deepEqual([...verifiedOnlyRoutes(pack, '73063077', 'IN', 2026, rs)], ['(D)', '(E)']);
  const dz = routesFor(pack, '2523100090', 'DZ', 2026);
  assert.deepEqual([...verifiedOnlyRoutes(pack, '2523100090', 'DZ', 2026, dz)], ['(B)']);
});

test('the verified-only note names the routes and the origin, and is silent when there are none', () => {
  assert.equal(verifiedOnlyNote(['(D)', '(E)'], 'India'),
    '(D) and (E) price from verified figures only: no Commission default from India.');
  assert.equal(verifiedOnlyNote(['(B)'], 'Algeria'),
    '(B) prices from verified figures only: no Commission default from Algeria.');
  assert.equal(verifiedOnlyNote([], 'India'), '');
  assert.equal(segmentLabel('default'), 'Single route');
  assert.equal(segmentLabel('(C)'), '(C)');
});

const opt = (value, text, over = {}) => ({ value, text, selected: false, disabled: false, verifiedOnly: false, ...over });

test('segments: one radio per offered route, the pick checked, verified-only marked, roving tabindex', () => {
  const html = renderRouteSegments([
    opt('', 'Select a production route…', { disabled: true }),
    opt('(C)', '(C) Carbon steel · blast furnace / basic oxygen furnace', { selected: true }),
    opt('(D)', '(D) x', { verifiedOnly: true }),
  ]);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2, 'the placeholder is not a route');
  assert.match(html, /aria-checked="true" tabindex="0" data-value="\(C\)"/);
  assert.match(html, /class=" b-vo" aria-checked="false" tabindex="-1" data-value="\(D\)" aria-label="\(D\) x, verified figures only">\(D\)<i aria-hidden="true"><\/i>/);
});

test('segments: with nothing chosen, the first route takes the tab stop and none is checked', () => {
  const html = renderRouteSegments([opt('(A)', '(A)'), opt('(B)', '(B)')]);
  assert.doesNotMatch(html, /aria-checked="true"/);
  assert.match(html, /aria-checked="false" tabindex="0" data-value="\(A\)"/);
});

test('segments: a disabled select\'s reason is shown as text, escaped (audit M3)', () => {
  assert.equal(renderRouteSegments([opt('', 'no rules published for 2029')]),
    '<p class="b-help b-seg-empty">no rules published for 2029</p>');
  assert.match(renderRouteSegments([opt('', '<x>')]), /&lt;x&gt;/);
  assert.equal(renderRouteSegments([]), '');
});

test('the mass ruler: 0 to twice the threshold, the line\'s mass as the fill, nothing when no rule applies', () => {
  const t = resolveThreshold(pack, { cn: '2523100090', massT: '30', date: '2026-03-15' });
  assert.equal(t.thresholdT, '50', 'premise');
  const html = renderMassRuler(t);
  assert.ok(html.startsWith('<div class="b-thr" style="--fill:30.0%"><b></b><em></em></div>'));
  assert.ok(html.includes('<span>50 t de minimis · 2026</span>'));
  assert.match(renderMassRuler(resolveThreshold(pack, { cn: '2523100090', massT: '400', date: '2026-03-15' })), /--fill:100\.0%/);
  assert.equal(renderMassRuler(null), '');
  assert.equal(renderMassRuler(resolveThreshold(pack, { cn: '28041000', massT: '10', date: '2026-03-15' })), '', 'hydrogen');
});

test('the date caption: the engine\'s quarter and the pack\'s price, or "none published"', () => {
  assert.equal(renderDatePeriod(pack.prices, '2026-03-15'),
    '<div class="b-qtr" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i></div>'
    + '<p class="b-help">Certificate price · imports in 2026-Q1: €75.36</p>');
  assert.match(renderDatePeriod(pack.prices, '2026-08-03'), /<i><\/i><i><\/i><i class="on"><\/i><i><\/i>.*imports in 2026-Q3: €82\.32/);
  assert.match(renderDatePeriod(pack.prices, '2027-03-15'), /imports in 2027-Q1: none published<\/p>$/);
  assert.equal(renderDatePeriod(pack.prices, ''), '');
  assert.equal(renderDatePeriod(pack.prices, '2027-1-15'), '');
  assert.equal(renderDatePeriod(pack.prices, '2029-03-15'), '', 'no row: #cbDateNote speaks instead');
});

test('review 6 — from 2027 the price is weekly: the caption stays, the quarter strip is not drawn', () => {
  const html = renderDatePeriod(pack.prices, '2027-03-15');
  assert.doesNotMatch(html, /b-qtr/, 'four quarter segments would imply a quarterly price');
  assert.equal(html, '<p class="b-help">Certificate price · imports in 2027-Q1: none published</p>');
  assert.doesNotMatch(renderDatePeriod(pack.prices, '2028-12-31'), /b-qtr/);
  assert.match(renderDatePeriod(pack.prices, '2026-12-31'), /b-qtr/, 'premise: 2026 is quarterly');
});

/* The "Commission default + mark-up" card's sentence follows the origin (founder decision 3B,
   2026-11-03). Three sentences, chosen on the ENGINE's own originBasis, never a second reading of the pack. */
const OWN = 'The Commission\'s published value for this origin and route, with its mark-up.';
const RESIDUAL = 'The Commission\'s residual default for \u201COther Countries and Territories\u201D, not this origin\'s own, with its mark-up.';
const GENERIC = 'The Commission\'s published default value, with its mark-up.';

test('tier-card sentence: origin\'s own value, residual fallback, and not-yet-known', () => {
  assert.equal(defaultTierSentence('country'), OWN);
  assert.equal(defaultTierSentence('residual'), RESIDUAL);
  assert.equal(defaultTierSentence(null), GENERIC);
  for (const b of ['country', 'residual', null]) {
    assert.doesNotMatch(defaultTierSentence(b), /world[- ]average/i, 'a logged false claim');
  }
});

test('tier-card basis is asked of the engine: India own value; OTHER and an unlisted-origin fallback are residual', () => {
  assert.equal(defaultOriginBasis(pack, '73063077', 'IN', '(C)', 2026), 'country');
  assert.equal(defaultOriginBasis(pack, '73063077', 'OTHER', '(C)', 2026), 'residual');
  // a REAL country the Commission publishes no own value for on this good: the engine falls back
  assert.equal(defaultOriginBasis(pack, '2507008080', 'AE', 'default', 2026), 'residual');
  assert.equal(defaultTierSentence(defaultOriginBasis(pack, '2507008080', 'AE', 'default', 2026)), RESIDUAL);
});

test('tier-card basis is null (generic sentence) when there is nothing to ask, or the default refuses', () => {
  assert.equal(defaultOriginBasis(pack, '', 'IN', '(C)', 2026), null);
  assert.equal(defaultOriginBasis(pack, '73063077', '', '(C)', 2026), null);
  assert.equal(defaultOriginBasis(pack, '73063077', 'IN', '', 2026), null);
  assert.equal(defaultOriginBasis(pack, '73063077', 'IN', '(D)', 2026), null, 'no direct default: no basis to name');
  assert.equal(defaultOriginBasis(pack, 'not-a-cn', 'IN', '(C)', 2026), null);
});
