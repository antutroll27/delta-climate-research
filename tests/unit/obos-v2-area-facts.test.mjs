// tests/unit/obos-v2-area-facts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaFacts, formatHa, showsAreaStamp } from '../../src/scripts/climate-engine/v2/area-facts.ts';

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

/* The title card's area stamp: a measured boundary is always drawn; a plain study square is drawn only where it always was (Kolkata,
   Bengaluru). Amsterdam's canal ring has no boundary and no new source, so it prints no grey box. */
test('the area stamp: polygon always, study square only in Kolkata and Bengaluru, never Amsterdam', () => {
  assert.equal(showsAreaStamp('in/kolkata/ballygunge', areaFacts('ballygunge')), true);
  for (const [key, id] of [['in/kolkata/baruipur', 'baruipur'], ['in/kolkata/barrackpore', 'barrackpore'], ['in/bengaluru/indiranagar', 'indiranagar']]) {
    assert.equal(areaFacts(id).kind, 'square', id);
    assert.equal(showsAreaStamp(key, areaFacts(id)), true, `${key} keeps its stamp`);
  }
  const ams = areaFacts('canal-ring');
  assert.equal(ams.kind, 'square');
  assert.equal(showsAreaStamp('nl/amsterdam/canal-ring', ams), false);
});
