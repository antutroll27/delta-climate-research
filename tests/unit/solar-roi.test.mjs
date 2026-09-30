// tests/unit/solar-roi.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRoi, subsidyFor, degradationFactor,
  roofKwhPerKw, roofMaxKw, defaultSizeKw, suggestedSize, wardInput, roiCsv,
} from '../../src/scripts/climate-engine/solar-roi.ts';
import { SOLAR_COST } from '../../src/scripts/climate-engine/solar-cost.ts';

const S = (value) => ({ value, source: 'test fixture source', as_of: '2026-09-30' });
/* keep values integer-exact: paybackYear compares cumulative >= 0 exactly, and several goldens land on 0 */
/* A flat basis: no degradation, no upkeep, no inverter inside the horizon, so a
   payback is a division a reader can do in their head. */
const FLAT = {
  city: 'test',
  subsidy: { home: S({ perKwFirst2: 30000, perKwThird: 18000, cap: 78000 }), society: S({ perKw: 18000, capKw: 500 }) },
  costPerKw: S([60000, 60000]), tariff: S(10), surplusCreditPerKwh: S(4),
  degradation: S({ firstYear: 0, perYear: 0 }), upkeepPerYear: S(0),
  inverter: S({ year: 99, perKw: 0 }), horizonYears: S(25),
  sizingByUnits: S([{ maxUnits: 150, kw: [1, 2] }, { maxUnits: 300, kw: [2, 3] }, { maxUnits: null, kw: [3, null] }]),
};
const input = (over = {}) => ({ sizeKw: 3, kwhPerKw: [1000, 1000], owner: 'home', costPerKw: [60000, 60000],
  tariff: 10, unitsPerMonth: null, basis: FLAT, ...over });

test('subsidyFor: home 30k/kW to 2 kW, 18k for the 3rd, cap 78k; society 18k/kW to 500 kW; business none', () => {
  assert.equal(subsidyFor('home', 1, FLAT), 30000);
  assert.equal(subsidyFor('home', 2.5, FLAT), 69000);
  assert.equal(subsidyFor('home', 3, FLAT), 78000);
  assert.equal(subsidyFor('home', 10, FLAT), 78000);
  assert.equal(subsidyFor('society', 3, FLAT), 54000);
  assert.equal(subsidyFor('society', 600, FLAT), 9_000_000);
  assert.equal(subsidyFor('business', 3, FLAT), 0);
  /* the cap hides the 3 kW tier limit in FLAT, so lift it: kW past the third earn nothing */
  assert.equal(subsidyFor('home', 10, { ...FLAT, subsidy: { ...FLAT.subsidy, home: S({ perKwFirst2: 30000, perKwThird: 18000, cap: 1e9 }) } }), 78000);
});

test('golden: 3 kW home, 1,000 kWh/kW, 60k/kW, 10/kWh: cost 180k - 78k = 102k, 30k a year, pays back in year 4', () => {
  const r = computeRoi(input());
  assert.equal(r.status, 'ok');
  assert.equal(r.fast.upfront, 102000);
  assert.equal(r.fast.subsidy, 78000);
  assert.equal(r.fast.paybackYear, 4);        // 3 × 30k = 90k < 102k; 4 × 30k = 120k
  assert.equal(r.fast.net, 25 * 30000 - 102000);
  assert.equal(r.slow.paybackYear, 4);
});

test('golden: society pays back in year 5, business in year 6', () => {
  assert.equal(computeRoi(input({ owner: 'society' })).fast.paybackYear, 5);   // 126k upfront
  const biz = computeRoi(input({ owner: 'business' }));
  assert.equal(biz.fast.paybackYear, 6);                                         // 180k upfront, 6 × 30k = 180k
  assert.equal(biz.fast.net, 750000 - 180000);
});

test('golden, bill mode: 100 units a month, so 1,200 kWh at 10 and 1,800 surplus at 4 = 19.2k a year: year 6', () => {
  const r = computeRoi(input({ unitsPerMonth: 100 }));
  assert.equal(r.fast.years[0].value, 1200 * 10 + 1800 * 4);
  assert.equal(r.fast.paybackYear, 6);        // 5 × 19.2k = 96k < 102k
});

test('bill mode where surplus lapses (Kolkata): only the 1,200 self-used kWh earn anything', () => {
  const r = computeRoi(input({ unitsPerMonth: 100, basis: { ...FLAT, surplusCreditPerKwh: S(0) } }));
  assert.equal(r.fast.years[0].value, 12000);
});

test('golden: upkeep 1 % and an inverter in year 12', () => {
  const basis = { ...FLAT, upkeepPerYear: S(0.01), inverter: S({ year: 12, perKw: 10000 }) };
  const r = computeRoi(input({ sizeKw: 1, owner: 'business', costPerKw: [50000, 50000], basis }));
  assert.equal(r.fast.years[0].upkeep, 500);
  assert.equal(r.fast.years[11].inverter, 10000);
  assert.equal(r.fast.paybackYear, 6);         // 9,500 a year against 50,000
  assert.equal(r.fast.net, 25 * 9500 - 10000 - 50000);
});

test('degradation: year 1 loses firstYear, each later year perYear more', () => {
  const basis = { ...FLAT, degradation: S({ firstYear: 0.025, perYear: 0.007 }) };
  assert.equal(degradationFactor(1, basis), 0.975);
  assert.ok(Math.abs(degradationFactor(3, basis) - 0.975 * 0.993 ** 2) < 1e-12);
});

test('no payback within the horizon is a status, not a number', () => {
  const r = computeRoi(input({ owner: 'business', tariff: 1 }));
  assert.equal(r.status, 'no_payback');
  assert.equal(r.fast.paybackYear, null);
  assert.equal(r.fast.net, 25 * 3000 - 180000);
});

test('under 1 kW is too small: no scenarios at all', () => {
  const r = computeRoi(input({ sizeKw: 0.8 }));
  assert.deepEqual(r, { status: 'too_small', slow: null, fast: null });
});

test('the range: slow takes low yield and high cost, fast the opposite; pairs given either way round', () => {
  const r = computeRoi(input({ kwhPerKw: [1200, 800], costPerKw: [70000, 50000], owner: 'business' }));
  assert.equal(r.slow.years[0].kwh, 3 * 800);
  assert.equal(r.slow.upfront, 3 * 70000);
  assert.equal(r.fast.years[0].kwh, 3 * 1200);
  assert.equal(r.fast.upfront, 3 * 50000);
  assert.notEqual(r.fast.paybackYear, null);
  assert.notEqual(r.slow.paybackYear, null);
  assert.ok((r.fast.paybackYear ?? Infinity) <= (r.slow.paybackYear ?? Infinity));
  assert.ok(r.fast.net >= r.slow.net);
});

test('properties over a sweep: more subsidy never lengthens payback; bill mode never beats flat', () => {
  for (const size of [1, 2, 3, 5, 10]) for (const tariff of [4, 8, 12]) for (const kwh of [900, 1200, 1400]) {
    const base = { sizeKw: size, tariff, kwhPerKw: [kwh, kwh] };
    const biz = computeRoi(input({ ...base, owner: 'business' })).fast;
    const soc = computeRoi(input({ ...base, owner: 'society' })).fast;
    const home = computeRoi(input({ ...base, owner: 'home' })).fast;
    const yrs = (s) => s.paybackYear ?? Infinity;
    assert.ok(yrs(home) <= yrs(biz) && yrs(soc) <= yrs(biz), `size ${size} tariff ${tariff}`);
    const bill = computeRoi(input({ ...base, owner: 'home', unitsPerMonth: 150 })).fast;
    assert.ok(bill.net <= home.net + 1e-6, `bill mode out-earned flat at size ${size}`);
  }
});

test('payback means paid back AND stays paid back: an inverter that dips the cumulative below zero postpones it', () => {
  /* 1 kW business at 50k: 10k a year, so 0 at year 5; year 7 is 70k - 50k - 30k = -10k; year 8 is 0 again */
  const basis = { ...FLAT, inverter: S({ year: 7, perKw: 30000 }) };
  const r = computeRoi(input({ sizeKw: 1, owner: 'business', costPerKw: [50000, 50000], basis }));
  assert.equal(r.fast.years[4].cumulative, 0);
  assert.equal(r.fast.years[6].cumulative, -10000);
  assert.equal(r.fast.years[7].cumulative, 0);
  assert.equal(r.fast.paybackYear, 8);
});

test('invariant over both bases: paybackYear is null exactly when the horizon net is negative, and the cumulative never dips after it', () => {
  for (const basis of [FLAT, SOLAR_COST.kolkata]) for (const owner of ['home', 'society', 'business'])
    for (const size of [1, 2, 3, 5, 10]) for (const tariff of [4, 6, 8, 12]) for (const kwh of [700, 900, 1200, 1400])
      for (const unitsPerMonth of [null, 150]) {
        const r = computeRoi(input({ owner, sizeKw: size, tariff, kwhPerKw: [kwh, kwh], unitsPerMonth, basis }));
        for (const s of [r.slow, r.fast]) {
          const tag = `${basis.city} ${owner} ${size} kW tariff ${tariff} kwh ${kwh} units ${unitsPerMonth}`;
          assert.equal(s.paybackYear === null, s.net < 0, tag);
          if (s.paybackYear !== null) for (const y of s.years.slice(s.paybackYear - 1)) assert.ok(y.cumulative >= 0, `${tag} year ${y.year}`);
        }
      }
});

test("status 'ok' means the FAST scenario pays back; the SLOW one may still not", () => {
  /* 3 kW business at 60k = 180k. Slow: 500 kWh/kW at 4 = 6k a year, 150k in 25 years, never. Fast: 1,300 kWh/kW = 15.6k a year, 11 × = 171.6k < 180k, 12 × = 187.2k */
  const r = computeRoi(input({ owner: 'business', kwhPerKw: [500, 1300], tariff: 4 }));
  assert.equal(r.status, 'ok');
  assert.equal(r.slow.paybackYear, null);
  assert.equal(r.fast.paybackYear, 12);
});

const PV = { kwp: [7.3, 0.5], loss: [0.09, 0], loss_strict: [0.04, 0], packing_factor: 0.28,
  tiers: { yield_bracket_kwh_per_kwp: [1200, 1450], packing_range: [0.28, 0.40] },
  totals: { capacity_mwp: 17.494, generation_gwh_yr: 19.762, mean_loss_strict: 0.1282 } };

test('roofKwhPerKw: low yield under the headline loss, high yield under the strict floor', () => {
  const [lo, hi] = roofKwhPerKw(PV, 0);
  assert.ok(Math.abs(lo - 1200 * 0.91) < 1e-9);
  assert.ok(Math.abs(hi - 1450 * 0.96) < 1e-9);
});

test('roofMaxKw is the top of the published packing interval: 7.3 kW x 0.40 / 0.28', () => {
  assert.equal(roofMaxKw(PV, 0), 10.43);
});

test('the default size is min(3, max) in half-kW steps', () => {
  assert.equal(defaultSizeKw(10.43), 3);
  assert.equal(defaultSizeKw(2.3), 2);
});

test("defaultSizeKw below 1 kW is the caller's to refuse", () => {
  assert.equal(defaultSizeKw(0.7), 0.5);
});

test('suggestedSize follows the official sizing table', () => {
  assert.deepEqual(suggestedSize(100, FLAT), [1, 2]);
  assert.deepEqual(suggestedSize(150, FLAT), [1, 2]);
  assert.deepEqual(suggestedSize(151, FLAT), [2, 3]);
  assert.deepEqual(suggestedSize(900, FLAT), [3, null]);
  assert.deepEqual(suggestedSize(300, FLAT), [2, 3]);
});

test('wardInput: the capacity-weighted aggregate of the roofs\' own ranges, so never more optimistic than they are', () => {
  const w = wardInput(PV);
  assert.ok(Math.abs(w.sizeKw - 7.8) < 1e-9);
  const lo = (7.3 * 1200 * 0.91 + 0.5 * 1200 * 1) / 7.8;
  const hi = (7.3 * 1450 * 0.96 + 0.5 * 1450 * 1) / 7.8;
  assert.ok(Math.abs(w.kwhPerKw[0] - lo) < 1e-9);
  assert.ok(Math.abs(w.kwhPerKw[1] - hi) < 1e-9);
  /* a weighted average lies between the roofs it averages (1,092 and 1,200), nearer the bigger roof */
  const [a] = roofKwhPerKw(PV, 0);
  const [b] = roofKwhPerKw(PV, 1);
  assert.ok(w.kwhPerKw[0] > a && w.kwhPerKw[0] < b);
  assert.ok(w.kwhPerKw[0] - a < b - w.kwhPerKw[0]);
});

test('wardInput with no capacity is zero, not NaN', () => {
  assert.deepEqual(wardInput({ ...PV, kwp: [0, 0] }), { sizeKw: 0, kwhPerKw: [0, 0] });
});

test('roiCsv: one row per year, both scenarios, the assumptions on every row', () => {
  const r = computeRoi(input());
  const csv = roiCsv(r, 'Home · 3.0 kW');
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'year,kwh_slow,value_slow,cumulative_slow,kwh_fast,value_fast,cumulative_fast,upkeep_slow,upkeep_fast,inverter,assumptions');
  assert.equal(lines.length, 26);
  assert.ok(lines.slice(1).every((l) => l.endsWith(',"Home · 3.0 kW"')));
  assert.equal(roiCsv(computeRoi(input({ sizeKw: 0.5 })), 'x'), '');
  assert.ok(csv.endsWith('\n'));
  assert.equal(lines[1].split(',')[0], '1');
  assert.equal(lines[1].split(',')[1], '3000');   // 3 kW x 1,000 kWh/kW, no degradation in FLAT
  /* an embedded quote is doubled, and a comma inside the quotes stays in the last cell */
  const quoted = roiCsv(r, 'a "b", c').trim().split('\n').slice(1);
  assert.ok(quoted.every((l) => l.endsWith(',"a ""b"", c"')));
});
