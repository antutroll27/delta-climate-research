// tests/unit/obos-v2-area-facts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaFacts, formatHa } from '../../src/scripts/climate-engine/v2/area-facts.ts';

test('Ward 68 is its polygon: area from areaM2, outline north-up (spec C7)', () => {
  const mask = JSON.parse(readFileSync('public/heat-map/data/ballygunge-ward.json', 'utf8'));
  const f = areaFacts('ballygunge');
  assert.equal(f.kind, 'polygon');
  assert.equal(f.areaHa, mask.areaM2 / 1e4);
  assert.match(f.path, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
  assert.equal(formatHa(f.areaHa), (mask.areaM2 / 1e4).toFixed(1));
});

test('a study square is its footprint squared', () => {
  const f = areaFacts('baruipur');
  assert.equal(f.kind, 'square');
  assert.ok(f.areaHa > 0);
  assert.equal(f.path, 'M0 0H100V100H0Z');
  assert.equal(formatHa(196), '196');
});

test('an area with no ward row has no facts (Dubai)', () => {
  assert.equal(areaFacts('al-quoz'), null);
});
