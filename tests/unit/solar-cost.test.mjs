// tests/unit/solar-cost.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { SOLAR_COST, costBasisFor, isComplete } from '../../src/scripts/climate-engine/solar-cost.ts';

const sourcedFields = (b) => [b.subsidy.home, b.subsidy.society, b.costPerKw, b.tariff, b.degradation,
  b.upkeepPctPerYr, b.inverter, b.horizonYears, b.sizingByUnits, b.surplusCreditPerKwh];

test('every Kolkata default carries a source and an as-of date', () => {
  const b = SOLAR_COST.kolkata;
  for (const f of sourcedFields(b)) {
    assert.ok(typeof f.source === 'string' && f.source.trim().length > 10, `unsourced value: ${JSON.stringify(f.value)}`);
    assert.match(f.as_of, /^\d{4}-\d{2}-\d{2}$/, `bad as_of on ${JSON.stringify(f.value)}`);
  }
  assert.equal(isComplete(b), true);
});

test('the subsidy is the official PM Surya Ghar structure (CFA PDF, 7 Mar 2024)', () => {
  const b = SOLAR_COST.kolkata;
  assert.deepEqual(b.subsidy.home.value, { perKwFirst2: 30000, perKwThird: 18000, cap: 78000 });
  assert.deepEqual(b.subsidy.society.value, { perKw: 18000, capKw: 500 });
  assert.match(b.subsidy.home.source, /CFA_structure20240307\.pdf/);
});

test('the default cost is a low-high pair; Kolkata surplus earns nothing (WBERC 2025, Regulation 81)', () => {
  const [lo, hi] = SOLAR_COST.kolkata.costPerKw.value;
  assert.ok(lo > 0 && lo <= hi);
  assert.equal(SOLAR_COST.kolkata.surplusCreditPerKwh.value, 0);
  assert.match(SOLAR_COST.kolkata.surplusCreditPerKwh.source, /81\/WBERC/);
  assert.match(SOLAR_COST.kolkata.surplusCreditPerKwh.source, /reset to zero/);
  assert.deepEqual(SOLAR_COST.kolkata.degradation.value, { firstYear: 0.03, perYear: 0.005 });
});

test('costBasisFor: a known city, or null; an incomplete basis is refused', () => {
  assert.equal(costBasisFor('kolkata'), SOLAR_COST.kolkata);
  assert.equal(costBasisFor('bengaluru'), null);
  const broken = { ...SOLAR_COST.kolkata, tariff: { ...SOLAR_COST.kolkata.tariff, source: '' } };
  assert.equal(isComplete(broken), false);
});

test('costBasisFor is fail-closed for inherited property names', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(costBasisFor(name), null, `costBasisFor(${name})`);
  }
});

test('every Kolkata value is pinned', () => {
  const b = SOLAR_COST.kolkata;
  assert.deepEqual(b.costPerKw.value, [55000, 65000]);
  assert.equal(b.tariff.value, 8);
  assert.equal(b.upkeepPctPerYr.value, 0.01);
  assert.deepEqual(b.inverter.value, { year: 10, perKw: 8000 });
  assert.equal(b.horizonYears.value, 25);
  assert.deepEqual(b.sizingByUnits.value, [
    { maxUnits: 150, kw: [1, 2] },
    { maxUnits: 300, kw: [2, 3] },
    { maxUnits: null, kw: [3, null] },
  ]);
});

test('costBasisFor refuses an incomplete REGISTERED basis', () => {
  SOLAR_COST.broken = {
    ...SOLAR_COST.kolkata,
    city: 'broken',
    tariff: { ...SOLAR_COST.kolkata.tariff, source: '' },
  };
  try {
    assert.equal(costBasisFor('broken'), null);
  } finally {
    delete SOLAR_COST.broken;
  }
  assert.equal(costBasisFor('broken'), null);
});

test('isComplete fails when ANY sourced field loses its source or has a bad date', () => {
  const b = SOLAR_COST.kolkata;
  const paths = [['subsidy', 'home'], ['subsidy', 'society'], ['costPerKw'], ['tariff'], ['surplusCreditPerKwh'],
    ['degradation'], ['upkeepPctPerYr'], ['inverter'], ['horizonYears'], ['sizingByUnits']];
  for (const path of paths) {
    for (const patch of [{ source: '' }, { as_of: 'soon' }]) {
      const copy = { ...b };
      if (path.length === 2) {
        copy[path[0]] = { ...b[path[0]], [path[1]]: { ...b[path[0]][path[1]], ...patch } };
      } else {
        copy[path[0]] = { ...b[path[0]], ...patch };
      }
      assert.equal(isComplete(copy), false, `${path.join('.')} with ${JSON.stringify(patch)}`);
    }
  }
});
