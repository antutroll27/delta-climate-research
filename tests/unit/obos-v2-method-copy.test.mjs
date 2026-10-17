// tests/unit/obos-v2-method-copy.test.mjs — OBOS v2 H23 [H]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCURACY, TRANSITION_HOURS, TRANSITION_RMSE_K, SEASONAL_CAVEATS, seasonalCaveatLine } from '../../src/scripts/climate-engine/accuracy.ts';
import { checkedRows, caveatRows, transitionChip } from '../../src/scripts/climate-engine/v2/method-copy.ts';

test('every figure in "How this was checked" is the accuracy.ts export', () => {
  const rows = checkedRows();
  const n = ACCURACY.night, p = ACCURACY.peak;
  assert.deepEqual(rows.map((r) => r.k), ['Night', 'Day', 'Band']);
  assert.equal(rows[0].v, `±${n.bandK.toFixed(1)} °C over ${n.n} ward-scenes of NASA ECOSTRESS. Error ${n.modelRmseK} K against a best possible ${n.ceilingRmseK} K.`);
  assert.equal(rows[1].v, `±${p.bandK.toFixed(1)} °C, indicative only: n = ${p.n}, an earlier evidence set.`);
  assert.equal(rows[2].v, `Covers the leave-one-overpass-out error (${n.looOverpassRmseK} K at night), not the in-sample fit.`);
});

test('the dawn caveat quotes the chip the app prints, from the same constants', () => {
  assert.equal(transitionChip(), `Outside validation · ~±${TRANSITION_RMSE_K.toFixed(1)} °C at this hour`);
  const dawn = caveatRows()[0];
  assert.equal(dawn.k, 'Dawn');
  assert.ok(dawn.v.includes(`${String(TRANSITION_HOURS[0]).padStart(2, '0')}:00`));
  assert.ok(dawn.v.includes(`${TRANSITION_RMSE_K} K`));
  assert.ok(dawn.v.includes(transitionChip()));
});

test('one season row per published caveat, worded by seasonalCaveatLine', () => {
  const season = caveatRows().filter((r) => r.k === 'Season');
  assert.equal(season.length, SEASONAL_CAVEATS.length);
  SEASONAL_CAVEATS.forEach((c, i) => assert.ok(season[i].v.includes(seasonalCaveatLine(c))));
});

/* The transition chip is the app's own sentence (heat-map-app.ts applyConfidence). If the app's wording moves, this copy must follow. */
test('the chip text equals what applyConfidence prints, word for word', () => {
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.ok(app.includes('`Outside validation · ${fig(`~±${TRANSITION_RMSE_K.toFixed(1)} °C`)} at this hour${seasonChip}`'), 'the app\'s transition chip changed');
});

/* H23: the file types no figure. Digits may appear only as formatting (toFixed(1), padStart(2), a minutes factor of 60). */
test('method-copy.ts holds no hand-typed figure', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/method-copy.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const literals = [...src.matchAll(/(?<![\w.$])\d+(?:\.\d+)?(?![\w])/g)].map((m) => m[0]);
  assert.deepEqual(literals.filter((x) => !['0', '1', '2', '60'].includes(x)), []);
});
