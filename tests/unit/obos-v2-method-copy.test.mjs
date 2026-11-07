// tests/unit/obos-v2-method-copy.test.mjs — OBOS v2 H23 [H]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCURACY, NIGHT_AS_SHIPPED, TRANSITION_HOURS, TRANSITION_RMSE_K, SEASONAL_CAVEATS, SEASONAL_WARDS, seasonalCaveatLine } from '../../src/scripts/climate-engine/accuracy.ts';
import { checkedRows, caveatRows, transitionChip } from '../../src/scripts/climate-engine/v2/method-copy.ts';
import { heatAccuracyClaim } from '../../src/scripts/climate-engine/scope/accuracy-claim.ts';

test('every figure in "How this was checked" is the accuracy.ts export', () => {
  const rows = checkedRows();
  const n = ACCURACY.night, p = ACCURACY.peak;
  assert.deepEqual(rows.map((r) => r.k), ['Night', 'Day', 'Band']);
  assert.equal(rows[0].v, `±${n.bandK.toFixed(1)} °C over ${n.n} ward-scenes of NASA ECOSTRESS. Calibration-run error ${n.modelRmseK} K against a best possible ${n.ceilingRmseK} K. This calibrates the city-wide night level, not ward-to-ward differences.`);
  assert.equal(rows[1].v, `±${p.bandK.toFixed(1)} °C, indicative only: n = ${p.n}, an earlier evidence set.`);
  assert.equal(rows[2].v, `Covers the leave-one-overpass-out error (${n.looOverpassRmseK} K at night in the calibration run, ${NIGHT_AS_SHIPPED.looOverpassRmseK.toFixed(2)} K for the model as shipped), not the in-sample fit.`);
});

test('the dawn caveat quotes the chip the app prints, from the same constants', () => {
  assert.equal(transitionChip(), `Outside validation · ~±${TRANSITION_RMSE_K.toFixed(1)} °C at this hour`);
  const dawn = caveatRows()[0];
  assert.equal(dawn.k, 'Dawn');
  assert.ok(dawn.v.includes(`${String(TRANSITION_HOURS[0]).padStart(2, '0')}:00`));
  assert.ok(dawn.v.includes(`${TRANSITION_RMSE_K} K`));
  assert.ok(dawn.v.includes(transitionChip()));
  /* A-S3 audit F5: 7.54 K is a kept, cautious figure from the 2 Aug morning ECOSTRESS stratum, not "the window's score" (today's artefact reads 6.29 K) */
  assert.ok(dawn.v.includes(`OBOS keeps ${TRANSITION_RMSE_K} K for that window, the larger of its out-of-sample measurements of the morning ECOSTRESS stratum, because`));
  assert.ok(!/scored/.test(dawn.v), 'the dawn row claims the window "scored" a figure it was not measured on');
});

test('one season row per published caveat, worded by seasonalCaveatLine', () => {
  const season = caveatRows().filter((r) => r.k === 'Season');
  assert.equal(season.length, SEASONAL_CAVEATS.length);
  SEASONAL_CAVEATS.forEach((c, i) => assert.ok(season[i].v.includes(seasonalCaveatLine(c))));
});

/* A-S3 audit F7: a season row is shown only where seasonalCaveat() can ever apply (SEASONAL_WARDS); Bengaluru has none */
test('F7: season rows only for a ward the seasonal measurement covers', () => {
  for (const w of SEASONAL_WARDS) assert.equal(caveatRows(w).filter((r) => r.k === 'Season').length, SEASONAL_CAVEATS.length, w);
  assert.equal(caveatRows('mg-road').filter((r) => r.k === 'Season').length, 0, 'Bengaluru has no seasonal caveat');
  assert.equal(caveatRows('mg-road').length, 1, 'only the dawn row remains');
  assert.equal(caveatRows().filter((r) => r.k === 'Season').length, SEASONAL_CAVEATS.length, 'no area given: all rows (the Data & methods page)');
  const heat = readFileSync('src/components/ClimateEngine/v2/HeatCards.astro', 'utf8');
  assert.ok(heat.includes('figures.limits(scope.area.id)'), 'HeatCards must pass the area id');
});

/* The transition chip is the app's own sentence (applyConfidence prints figures.chip, scope/accuracy-claim.ts). If its wording moves, this copy must follow. */
test('the chip text equals what applyConfidence prints, word for word', () => {
  const printed = heatAccuracyClaim('validated').figures.chip('night', true, '').html.replace(/<\/?b>/g, '');
  assert.equal(printed, transitionChip());
});

/* H23: the file types no figure. Digits may appear only as formatting (toFixed(1), padStart(2), a minutes factor of 60). */
test('method-copy.ts holds no hand-typed figure', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/method-copy.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const literals = [...src.matchAll(/(?<![\w.$])\d+(?:\.\d+)?(?![\w])/g)].map((m) => m[0]);
  assert.deepEqual(literals.filter((x) => !['0', '1', '2', '60'].includes(x)), []);
});
