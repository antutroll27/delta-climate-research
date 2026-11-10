import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  currentParams, rampBounds, rampWords, RAMP_WORDS_MIN,
} from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { REGISTRY } from '../../src/scripts/climate-engine/scope/registry.ts';

const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const NL = resolve('nl/amsterdam/canal-ring').climate;
const IN = resolve('in/kolkata/ballygunge').climate;
const BLR = resolve('in/bengaluru/indiranagar').climate;
const AE = resolve('ae/dubai/creek').climate;
const forcing = (climate, over) => currentParams({
  live: { tAir: 20, rh: 60, wind: 2, cloud: 50, feels: 20, ...over.live }, phase: over.phase ?? 'peak',
  path: '2025', climate, iv: IV, sunNow: over.sunNow ?? null, clock: { month: 1, hour: 13 },
});
const COLD = (c) => forcing(c, { live: { tAir: -1, cloud: 10 }, phase: 'night', sunNow: 0 });
const HOT = (c) => forcing(c, { live: { tAir: 38, cloud: 5 }, phase: 'peak' });

/* ── the floor travels registry -> resolve -> ClimateConstants ── */
test('the registry declares the floor for the Netherlands only; every other country is null, not a number', () => {
  assert.equal(REGISTRY.nl.rampHotFloorC, 25);
  assert.equal(REGISTRY.in.rampHotFloorC, null);
  assert.equal(REGISTRY.ae.rampHotFloorC, null);
  assert.equal(NL.rampHotFloorC, 25);
  assert.equal(IN.rampHotFloorC, null);
  assert.equal(BLR.rampHotFloorC, null);
  assert.equal(AE.rampHotFloorC, null);
});

/* ── (a) Netherlands, cold forcing ── */
test('(a) a freezing Amsterdam morning: hi is lifted to the floor, lo is unchanged', () => {
  const p = COLD(NL);
  const bare = rampBounds(p);
  assert.ok(bare[1] < 25, `the unfloored hi must be under the floor for this to test anything (got ${bare[1]})`);
  const floored = rampBounds(p, NL.rampHotFloorC);
  assert.equal(floored[1], 25);
  assert.equal(floored[0], bare[0]);
});

/* ── (b) Netherlands, hot forcing ── */
test('(b) a hot Amsterdam day (natural hi above the floor) is unchanged', () => {
  const p = HOT(NL);
  const bare = rampBounds(p);
  assert.ok(bare[1] > 25, `the unfloored hi must be over the floor (got ${bare[1]})`);
  assert.deepEqual(rampBounds(p, NL.rampHotFloorC), bare);
});

/* ── (c) India unchanged, bit for bit ── */
test('(c) India: with no floor, rampBounds returns exactly the unfloored pair, cold or hot', () => {
  const cases = [
    COLD(IN), HOT(IN), COLD(BLR), HOT(BLR),
    forcing(IN, { live: { tAir: 14, cloud: 20 }, phase: 'night', sunNow: 0 }),
    forcing(IN, { live: { tAir: 27, rh: 90, cloud: 90 }, phase: 'night', sunNow: 0 }),
    forcing(BLR, { live: { tAir: 19, cloud: 40 }, phase: 'night', sunNow: 0 }),
    forcing(IN, { live: { tAir: 33 }, phase: 'peak' }),
  ];
  for (const p of cases) {
    const bare = rampBounds(p);
    for (const floor of [IN.rampHotFloorC, BLR.rampHotFloorC, AE.rampHotFloorC, null, undefined]) {
      const got = rampBounds(p, floor);
      assert.ok(Object.is(got[0], bare[0]) && Object.is(got[1], bare[1]),
        `India/null floor changed the ramp: ${got} vs ${bare}`);
    }
  }
  // and the cold Indian night really is under 25, i.e. a blanket floor WOULD have moved it
  assert.ok(rampBounds(forcing(BLR, { live: { tAir: 19, cloud: 40 }, phase: 'night', sunNow: 0 }))[1] < 25);
});

/* ── (d) degenerate span ── */
test('(d) a degenerate natural span with a floor still returns hi > lo, and never hi below the floor', () => {
  const p = COLD(NL);
  // strong exchange, no sun, no storage: every cell sits near air temperature, so the span collapses
  const flat = { ...p, h: 5, sun: 0, Q: 0, store: 0 };
  const [flo, fhi] = rampBounds(flat);
  assert.ok(Math.abs((fhi - flo) - 1) < 1e-9, `the guard path must be the one under test (span ${fhi - flo})`);
  for (const floor of [25, 0, flo + 0.2, fhi, -50]) {
    for (const q of [p, flat]) {
      const [a, b] = rampBounds(q, floor);
      assert.ok(b > a, `hi must exceed lo (got ${a}, ${b})`);
      assert.ok(b >= floor, `hi must not sit below the floor ${floor} (got ${b})`);
    }
  }
  assert.equal(rampBounds(flat, 25)[0], flo);
});

/* ── (e) words rule ── */
test('(e) the legend words: relative below 35 C, absolute at 35 and above', () => {
  assert.equal(RAMP_WORDS_MIN, 35);
  assert.equal(rampWords(25), 'rel');
  assert.equal(rampWords(34.99), 'rel');
  assert.equal(rampWords(-3), 'rel');
  assert.equal(rampWords(35), 'abs');
  assert.equal(rampWords(48), 'abs');
});

test('a floored Amsterdam night reads relative; a hot Amsterdam day reads absolute', () => {
  assert.equal(rampWords(rampBounds(COLD(NL), NL.rampHotFloorC)[1]), 'rel');
  assert.equal(rampWords(rampBounds(HOT(NL), NL.rampHotFloorC)[1]), 'abs');
});

/* ── the app wiring and the markup ── */
test('syncRamp passes the scope floor and writes the words attribute beside the numbers', () => {
  const src = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.match(src, /M\.rampBounds\(p, state\.climate\.rampHotFloorC\)/);
  assert.match(src, /M\.rampWords\(ramp\[1\]\)/);
  assert.match(src, /querySelectorAll\('\[data-ramp-words\]'\)/);
});

test('both legend files carry the relative pair beside the five words, hidden by default, and F10 still holds', () => {
  const order = (html) => [...html.matchAll(/<i class="hk h(\d)"><\/i>/g)].map((m) => m[1]).join('');
  for (const f of ['TempCard.astro', 'HeatCards.astro']) {
    const html = readFileSync(`src/components/ClimateEngine/v2/${f}`, 'utf8');
    assert.equal(order(html), '12345', `${f}: the five swatches must stay h1..h5`);
    assert.ok(html.includes('data-ramp-words="abs"'), `${f}: ships in the absolute state`);
    assert.ok(/rk-abs/.test(html) && /rk-rel/.test(html), `${f}: both rows present`);
    assert.match(html, /<i class="hk hc"><\/i>Cooler<\/span><span><i class="hk hw"><\/i>Warmer</);
  }
  const css = readFileSync('src/styles/obos-v2/atoms.css', 'utf8');
  assert.match(css, /\[data-ramp-words\]:not\(\[data-ramp-words="rel"\]\) \.rk-rel/);
  assert.match(css, /\[data-ramp-words="rel"\] \.rk-abs/);
  assert.ok(!/@keyframes/.test(css.slice(css.indexOf('legend words'), css.indexOf('legend words') + 600)));
});
