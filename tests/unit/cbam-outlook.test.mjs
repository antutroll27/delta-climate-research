import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

import {
  assumedCost, dateInYear, formatDecimal, formatPackDate, outlook, outlookPriceSlots, outlookYears,
  parseAssumedPrice, renderOutlook, renderOutlookWhy, renderOutlookYears, unpricedYears,
} from '../../src/scripts/cbam-outlook.ts';
import {
  estimateFromPack, routesFor,
} from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

/**
 * THE THREE-YEAR VIEW, against the real shipped pack — never a pasted copy of it.
 *
 * Two kinds of expected value appear below and they are kept apart on purpose.
 *   · HAND-DERIVED figures, for the lines the design names. They are typed here from the
 *     regulation's formula and the pack's rows, not read back from the module, so the module
 *     agreeing with them is evidence and not a tautology.
 *   · THE ENGINE'S OWN ANSWER, for everything else: the module must return what a direct
 *     estimateFromPack call returns at the same date, field for field. That is the rule that
 *     nothing is computed twice, checked rather than promised.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

const line = (over = {}) => ({
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15', ...over,
});
const figures = (view) => view.years.filter((y) => y.kind === 'figure');
const counts = (view) => view.years.map((y) => (y.kind === 'figure' ? y.certificates : null));
const flat = (html) => html.replace(/\s+/g, ' ');
const text = (html) => flat(html.replace(/<[^>]+>/g, ' ')).trim();
const D = Decimal.clone({ precision: 60 });

/* ── the years and the date ────────────────────────────────────────────────── */

test('the years are the pack\'s reporting years, read from the pack', () => {
  assert.deepEqual(outlookYears(pack), [2026, 2027, 2028]);
  // Not a constant in disguise: a pack covering one more year yields one more card.
  const wider = { ...pack, defaultValues: [...pack.defaultValues, { ...pack.defaultValues[0], reportingYear: 2029 }] };
  assert.deepEqual(outlookYears(wider), [2026, 2027, 2028, 2029]);
});

test('the date in another year keeps the month and day; 29 February becomes 28 February', () => {
  assert.equal(dateInYear('2026-03-15', 2028), '2028-03-15');
  assert.equal(dateInYear('2027-12-31', 2026), '2026-12-31');
  assert.equal(dateInYear('2028-02-29', 2028), '2028-02-29', 'a leap day stays in a leap year');
  assert.equal(dateInYear('2028-02-29', 2027), '2027-02-28');
  assert.equal(dateInYear('2028-02-29', 2026), '2026-02-28');
  assert.equal(dateInYear('2026-03-15T00:00:00.000Z', 2027), '2027-03-15', 'a timestamp resolves to its day');
  for (const bad of ['', 'not-a-date', '2027-1-15', '2027-13-01', '2027-02-30']) {
    assert.equal(dateInYear(bad, 2026), null, `${JSON.stringify(bad)} is not a date the engine reads`);
  }
});

test('no strip for an unreadable date, or a date in a year the default values do not cover', () => {
  for (const date of ['', 'not-a-date', '2027-1-15', '2025-12-31', '2029-01-01', '0001-01-01']) {
    assert.equal(outlook(pack, line({ date })), null, JSON.stringify(date));
  }
  assert.notEqual(outlook(pack, line({ date: '2026-01-01' })), null, 'the first covered day');
  assert.notEqual(outlook(pack, line({ date: '2028-12-31' })), null, 'the last covered day');
});

/* ── the worked example, derived by hand ───────────────────────────────────── */

test('welded tube 73063077, India, route (C), 100 t on default values: 329.8275 / 376.755 / 427.41', () => {
  // BY HAND, from the pack's rows and Dir 2003/87/EC Art 10a(1a):
  //   default value  4.320 tCO2e/t   (India sheet row 233), mark-up 10% / 20% / 30%
  //   benchmark      1.491 tCO2e/t   (IR (EU) 2025/2620 Annex, Column B, route (C)), both periods
  //   share retained 0.975 / 0.95 / 0.90
  //   2026: 100 × 4.320 × 1.10 = 475.2   − 100 × 1.491 × 0.975 = 145.3725  → 329.8275
  //   2027: 100 × 4.320 × 1.20 = 518.4   − 100 × 1.491 × 0.95  = 141.645   → 376.755
  //   2028: 100 × 4.320 × 1.30 = 561.6   − 100 × 1.491 × 0.90  = 134.19    → 427.41
  const view = outlook(pack, line());
  assert.deepEqual(counts(view), ['329.8275', '376.755', '427.41']);
  assert.deepEqual(figures(view).map((y) => y.embeddedTco2e), ['475.2', '518.4', '561.6']);
  assert.deepEqual(figures(view).map((y) => y.allocationTco2e), ['145.3725', '141.645', '134.19']);
  assert.deepEqual(figures(view).map((y) => y.factor), ['0.975', '0.95', '0.90']);
  assert.deepEqual(figures(view).map((y) => y.directMarkupPct), ['10', '20', '30']);
  assert.deepEqual(figures(view).map((y) => y.benchmarks.map((b) => b.value)), [['1.491'], ['1.491'], ['1.491']]);

  // The rise is 427.41 − 329.8275 = 97.5825. Mark-up: 561.6 − 475.2 = 86.4. Allocation:
  // 145.3725 − 134.19 = 11.1825, all of it the share retained (the benchmark does not move).
  assert.deepEqual(view.split, {
    firstYear: 2026, lastYear: 2028,
    rise: '97.5825', moreEmissions: '86.4', lessAllocation: '11.1825',
    factorPart: '11.1825', benchmarkPart: '0', emissionsCause: 'markup-default',
  });
  assert.equal(view.splitWithheld, null);

  // Price: 2026 Q1 is published at €75.36, so 329.8275 × 75.36 = 24,855.8004 → €24,855.80.
  // 2027 and 2028 carry pending rows with no value.
  assert.deepEqual(figures(view).map((y) => y.costEur), ['24855.80', null, null]);
  assert.deepEqual(figures(view).map((y) => y.price.status), ['published', 'pending', 'pending']);
  assert.deepEqual(unpricedYears(view), [2027, 2028]);
});

test('the other three lines the design names', () => {
  // Seamless line pipe: default 4.320, benchmark 1.383. Hot-rolled coil: default 4.280,
  // benchmark 1.370. Both route (C), where the benchmark is the same in both periods.
  assert.deepEqual(counts(outlook(pack, line({ cn: '73041910' }))), ['340.3575', '387.015', '437.13']);
  assert.deepEqual(counts(outlook(pack, line({ cn: '72083900' }))), ['337.225', '383.45', '433.1']);
});

test('a good whose benchmark steps down in the last period: iron powder 72052100, route (F)', () => {
  // BY HAND: default 2.540, mark-up 10/20/30 → 279.4 / 304.8 / 330.2.
  // Benchmark 1.460 for 2026–2027 and 1.298 for 2028–2030:
  //   allocation 100 × 1.460 × 0.975 = 142.35 ; × 0.95 = 138.7 ; 100 × 1.298 × 0.90 = 116.82
  //   counts 137.05 / 166.1 / 213.38, rise 76.33
  //   mark-up 330.2 − 279.4 = 50.8
  //   allocation 142.35 − 116.82 = 25.53, of which
  //     share retained 142.35 × (0.975 − 0.90) ÷ 0.975 = 10.95
  //     benchmark      25.53 − 10.95 = 14.58   (= (1.460 − 1.298) × 100 × 0.90)
  const view = outlook(pack, line({ cn: '72052100', route: '(F)' }));
  assert.deepEqual(counts(view), ['137.05', '166.1', '213.38']);
  assert.deepEqual(figures(view).map((y) => y.benchmarks[0].value), ['1.46', '1.46', '1.298']);
  assert.deepEqual(view.split, {
    firstYear: 2026, lastYear: 2028,
    rise: '76.33', moreEmissions: '50.8', lessAllocation: '25.53',
    factorPart: '10.95', benchmarkPart: '14.58', emissionsCause: 'markup-default',
  });
  const why = text(renderOutlookWhy(view));
  assert.match(why, /Why it rises by 76\.3 certificates by 2028/);
  assert.match(why, /Benchmark for route \(F\) falls in 2028 \(1\.46 → 1\.298\)/);
  assert.match(why, /\+50\.8/);
  assert.match(why, /\+11\.0/, '10.95 to one place, half up');
  assert.match(why, /\+14\.6/);
});

test('a good with no production route: aluminous cement 25233000', () => {
  // The route control offers it as 'default' and the Annex benchmark has no route.
  assert.ok(routesFor(pack, '25233000', 'IN', 2026).includes('default'), 'sanity: a route-independent good');
  const view = outlook(pack, line({ cn: '25233000', route: 'default' }));
  assert.equal(figures(view).length, 3);
  assert.deepEqual(figures(view).map((y) => y.benchmarks[0].route), ['', '', '']);
  assert.deepEqual(figures(view).map((y) => y.benchmarks[0].value), ['0.717', '0.717', '0.686']);
  assert.notEqual(view.split, null);
  assert.ok(new D(view.split.benchmarkPart).greaterThan(0), 'the benchmark step shows as its own part');
  // (0.717 − 0.686) × 100 t × 0.90 = 2.79
  assert.equal(view.split.benchmarkPart, '2.79');
  const why = text(renderOutlookWhy(view));
  assert.match(why, /Benchmark for this good falls in 2028 \(0\.717 → 0\.686\)/);
  assert.doesNotMatch(why, /for route/);
});

test('the same three counts whichever of the three years the entered date falls in', () => {
  const expected = ['329.8275', '376.755', '427.41'];
  for (const date of ['2026-03-15', '2027-03-15', '2028-03-15', '2026-11-30', '2028-02-29']) {
    const view = outlook(pack, line({ date }));
    assert.deepEqual(counts(view), expected, date);
    assert.deepEqual(view.years.map((y) => y.year), [2026, 2027, 2028], date);
    assert.equal(view.split.rise, '97.5825', date);
  }
  // A leap day is priced on 28 February in the other two years, and on itself in its own.
  assert.deepEqual(outlook(pack, line({ date: '2028-02-29' })).years.map((y) => y.date),
    ['2026-02-28', '2027-02-28', '2028-02-29']);
});

/* ── nothing computed twice ────────────────────────────────────────────────── */

test('every year\'s figures are the engine\'s own, field for field', () => {
  const inputs = [
    line(),
    line({ cn: '72052100', route: '(F)' }),
    line({ cn: '25233000', route: 'default' }),
    line({ cn: '2523100090', country: 'DZ', route: '(A)', emissionsScope: 'direct_and_indirect' }),
    line({ verified: { directTco2ePerT: '2.0' } }),
    line({ cn: '2523100090', country: 'DZ', route: '(A)', emissionsScope: 'direct_and_indirect',
      verified: { directTco2ePerT: '1.5' } }),
    line({ date: '2026-08-15', massT: '37.25' }),
  ];
  for (const input of inputs) {
    const view = outlook(pack, input);
    for (const y of view.years) {
      const e = estimateFromPack(pack, { ...input, date: y.date });
      assert.equal(y.kind === 'figure', e.status !== 'unavailable', `${input.cn} ${y.date}`);
      if (y.kind !== 'figure' || e.status === 'unavailable') continue;
      const fig = e.status === 'cscf_pending' ? e.scenario : e.figure;
      const where = `${input.cn} ${y.date}`;
      assert.equal(y.certificates, fig.certificates, where);
      assert.equal(y.costEur, fig.costEur, where);
      assert.equal(y.allocationTco2e, fig.faaTco2e, where);
      assert.equal(y.embeddedTco2e, fig.totalEmbeddedTco2e, where);
      assert.equal(y.indirectTco2e, fig.indirectTco2e, where);
      assert.equal(y.directTco2e, e.emissionsTco2e, where);
      assert.equal(y.factor, e.terms.cbamFactor, where);
      assert.equal(y.tier, e.stamp.tier, where);
      assert.equal(y.status, e.status, where);
      assert.equal(y.price.quarter, e.priceQuarter, where);
      assert.equal(y.price.priceEur, e.priceEur, where);
      assert.equal(y.price.status, e.priceStatus, where);
      assert.equal(y.price.locator, pack.prices.find((row) => row.quarter === e.priceQuarter).sourceLocator, where);
    }
  }
});

test('the mark-up shown is the one the engine applied: default × (1 + mark-up) × tonnes is its emissions figure', () => {
  // The percentage comes from the record the engine's own selector returns. This checks that
  // record is the one the engine priced with, on lines where the arithmetic is one product.
  for (const input of [line(), line({ cn: '72052100', route: '(F)' }), line({ cn: '25233000', route: 'default' })]) {
    for (const y of figures(outlook(pack, input))) {
      // Found here by hand rather than through the engine's selector: the published value for
      // this origin, route and year at the deepest code that covers the good (the Commission
      // publishes some goods at a shorter code than the benchmark's).
      const row = pack.defaultValues
        .filter((r) => input.cn.startsWith(r.scopeCode) && r.originCountry === input.country
          && r.productionRoute === input.route && r.emissionsType === 'direct'
          && r.reportingYear === y.year && r.cell.state === 'value')
        .sort((a, b) => b.scopeCode.length - a.scopeCode.length)[0];
      assert.ok(row, `${input.cn} ${y.year}: a published default value`);
      assert.equal(y.directMarkupPct, row.markupPct, `${input.cn} ${y.year}`);
      const expected = new D(row.cell.baseIntensity).times(new D(1).plus(new D(row.markupPct).div(100)))
        .times(input.massT);
      assert.ok(new D(y.directTco2e).equals(expected), `${input.cn} ${y.year}: ${y.directTco2e} vs ${expected}`);
    }
  }
});

test('corpus fact the mark-up label rests on: no default value changes its base figure between years', () => {
  // The strip calls the rise in emissions counted "the mark-up". That is the whole of it only
  // while the published base intensity is the same in every year, which is true of this pack
  // (measured here over every published value). If a later pack changes a base figure between
  // years, this fails and the label has to be revisited before it ships.
  const byKey = new Map();
  for (const r of pack.defaultValues) {
    if (r.cell.state !== 'value') continue;
    const key = `${r.scopeCode}|${r.originCountry}|${r.emissionsType}|${r.productionRoute}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(r.cell.baseIntensity);
  }
  assert.ok(byKey.size > 10_000, 'sanity: the sweep saw the corpus');
  assert.deepEqual([...byKey].filter(([, bases]) => bases.size > 1).map(([key]) => key), []);
});

/* ── the states ────────────────────────────────────────────────────────────── */

test('verified figures: the same emissions every year, no mark-up part, and no mark-up row', () => {
  // 2.0 tCO2e/t attested → 200 in every year. The count still rises, because less free
  // allocation is retained: 200 − 145.3725 = 54.6275 ; − 141.645 = 58.355 ; − 134.19 = 65.81.
  const view = outlook(pack, line({ verified: { directTco2ePerT: '2.0' } }));
  assert.deepEqual(counts(view), ['54.6275', '58.355', '65.81']);
  assert.deepEqual(figures(view).map((y) => y.embeddedTco2e), ['200', '200', '200']);
  assert.deepEqual(figures(view).map((y) => y.directMarkupPct), [null, null, null]);
  assert.equal(view.split.emissionsCause, 'none');
  assert.equal(view.split.moreEmissions, '0');
  assert.equal(view.split.factorPart, '11.1825');
  const html = renderOutlook(view);
  assert.doesNotMatch(html, /Mark-up/i, 'no mark-up is charged on an attested figure, so none is named');
  assert.doesNotMatch(html, /mark-up \d/i);
  assert.match(text(html), /your verified figures/);
  assert.match(text(html), /Free allocation retained falls from 97\.5% to 90%/);
});

test('verified direct figure with the Commission\'s electricity default: the mark-up part is the electricity default\'s', () => {
  // Algerian clinker, 1.5 t/t attested → 150 direct. Electricity default 0.04 t/t with
  // mark-up 10/20/30 → 4.4 / 4.8 / 5.2. Rise in emissions counted: 0.8.
  const view = outlook(pack, line({
    cn: '2523100090', country: 'DZ', route: '(A)', emissionsScope: 'direct_and_indirect',
    verified: { directTco2ePerT: '1.5' },
  }));
  assert.deepEqual(figures(view).map((y) => y.tier), Array(3).fill('verified-direct+default-indirect'));
  assert.deepEqual(figures(view).map((y) => y.indirectTco2e), ['4.4', '4.8', '5.2']);
  assert.deepEqual(figures(view).map((y) => y.directMarkupPct), [null, null, null]);
  assert.deepEqual(figures(view).map((y) => y.indirectMarkupPct), ['10', '20', '30']);
  assert.equal(view.split.emissionsCause, 'markup-electricity');
  assert.equal(view.split.moreEmissions, '0.8');
  const why = text(renderOutlookWhy(view));
  assert.match(why, /Mark-up on the Commission's default value for electricity rises from 10% to 30%/);
  assert.match(why, /With a verified electricity figure it no longer applies\./);
  assert.doesNotMatch(why, /Mark-up on default values/);
});

test('electricity in scope on default values: counts are the engine\'s, and the parts still sum', () => {
  // Algerian clinker route (A): 75.865 certificates in 2026 is the calculator's own long-pinned
  // figure for this line (124 direct ×1.10 = 136.4, electricity 4.4, allocation 64.935).
  const view = outlook(pack, line({
    cn: '2523100090', country: 'DZ', route: '(A)', emissionsScope: 'direct_and_indirect',
  }));
  assert.deepEqual(counts(view), ['75.865', '90.33', '106.46']);
  assert.deepEqual(figures(view).map((y) => y.indirectTco2e), ['4.4', '4.8', '5.2']);
  const s = view.split;
  assert.notEqual(s, null);
  assert.ok(new D(s.moreEmissions).plus(s.factorPart).plus(s.benchmarkPart).equals(s.rise));
  // (161.2 + 5.2) − (136.4 + 4.4) = 25.6 ; 64.935 − 59.94 = 4.995
  assert.equal(s.moreEmissions, '25.6');
  assert.equal(s.factorPart, '4.995');
  const rows = text(renderOutlook(view));
  assert.match(rows, /of which electricity receives no free allocation 4\.4 mark-up 10% 4\.8 mark-up 20% 5\.2 mark-up 30%/);
});

test('a route with no default value for the origin: every year carries the engine\'s reason, and there is no split', () => {
  const view = outlook(pack, line({ route: '(D)' }));
  assert.deepEqual(view.years.map((y) => y.kind), ['refused', 'refused', 'refused']);
  for (const y of view.years) {
    const e = estimateFromPack(pack, line({ route: '(D)', date: y.date }));
    assert.equal(y.reason, e.reason, 'verbatim');
    assert.equal(y.selector, `default/73063077/IN/(D)/${y.year}`);
  }
  assert.equal(view.split, null);
  assert.equal(view.splitWithheld, 'refused');
  const html = renderOutlook(view);
  assert.equal((html.match(/No estimate/g) ?? []).length, 3);
  assert.doesNotMatch(html, /cb-ol-n"/, 'a refused year shows no figure of any kind');
  assert.doesNotMatch(html, /Why it rises/);
  assert.doesNotMatch(html, /cb-ol-stack/);
  assert.match(html, /<details class="cb-ol-work" hidden>/, 'nothing to show the working of');
  assert.match(html, /<div class="cb-ol-price" hidden>/, 'and no cost for a price to fill');
});

test('free allocation above the emissions counted: the counts are shown and the split is withheld', () => {
  // 1.0 t/t attested → 100 tCO2e against 145.3725 of free allocation: the engine floors the
  // count at zero in every year. "More emissions + less allocation" would claim a rise of
  // 11.1825 certificates on a line whose count never moves.
  const view = outlook(pack, line({ verified: { directTco2ePerT: '1.0' } }));
  assert.deepEqual(counts(view), ['0', '0', '0']);
  assert.equal(view.split, null);
  assert.equal(view.splitWithheld, 'floor');
  assert.deepEqual(figures(view).map((y) => y.riseOnFirstPct), [null, null, null],
    'no percentage on a first-year count of zero');
  const html = renderOutlook(view);
  assert.doesNotMatch(html, /Why it rises|cb-ol-stack/);
  assert.match(text(html), /the count is held at zero and the change between years cannot be divided into causes/);

  // The floor in ONE year only is the sharper case: the count does rise, and the parts would
  // overstate it. 1.42 t/t → 142 against 145.3725 (floored), 141.645 (0.355), 134.19 (7.81).
  const partial = outlook(pack, line({ verified: { directTco2ePerT: '1.42' } }));
  assert.deepEqual(counts(partial), ['0', '0.355', '7.81']);
  assert.equal(partial.split, null, 'the identity fails by the 3.3725 the floor absorbed');
  assert.equal(partial.splitWithheld, 'floor');
});

test('the split identity holds for every line the strip splits, across the corpus', () => {
  // A sweep, so the identity is a property of the module and not of four chosen goods. Every
  // 7th good, four origins, every offered route, both scopes: the split is either exact or absent.
  let split = 0; let withheld = 0; let withStep = 0;
  pack.classifications.forEach((c, index) => {
    if (index % 7 !== 0) return;
    for (const country of ['IN', 'DZ', 'TR', 'OTHER']) {
      for (const route of routesFor(pack, c.code, country, 2026)) {
        for (const emissionsScope of ['direct', 'direct_and_indirect']) {
          const view = outlook(pack, { cn: c.code, country, route, massT: '100', date: '2027-06-30', emissionsScope });
          if (view.split === null) { withheld += 1; continue; }
          split += 1;
          const s = view.split;
          const where = `${c.code}/${country}/${route}/${emissionsScope}`;
          assert.ok(new D(s.moreEmissions).plus(s.factorPart).plus(s.benchmarkPart).equals(s.rise), where);
          assert.ok(new D(s.factorPart).plus(s.benchmarkPart).equals(s.lessAllocation), where);
          for (const part of [s.moreEmissions, s.factorPart, s.benchmarkPart]) {
            assert.ok(!new D(part).isNegative(), `${where}: no negative part`);
          }
          const f = figures(view);
          assert.ok(new D(f[2].certificates).minus(f[0].certificates).equals(s.rise), where);
          if (!new D(s.benchmarkPart).isZero()) withStep += 1;
        }
      }
    }
  });
  // Both arms walked, or the sweep proves nothing about one of them.
  assert.ok(split > 200, `only ${split} lines were split`);
  assert.ok(withheld > 0, 'no line had its split withheld');
  assert.ok(withStep > 0, 'no swept line had a benchmark step');
});

/* ── the visitor's own price ───────────────────────────────────────────────── */

test('the price box reads numbers the way the engine reads a mass, and wants more than zero', () => {
  assert.equal(parseAssumedPrice('80'), '80');
  assert.equal(parseAssumedPrice('82.5'), '82.5');
  assert.equal(parseAssumedPrice(' 80 '), '80');
  // Rounded once, to the cent, half up; that is the price shown and the price used.
  assert.equal(parseAssumedPrice('80.555'), '80.56');
  assert.equal(parseAssumedPrice('80.554'), '80.55');
  assert.equal(parseAssumedPrice('0.01'), '0.01');
  assert.equal(parseAssumedPrice('0.005'), '0.01');
  for (const bad of ['', '   ', '0', '0.00', '0.004', '-5', 'abc', '0x10', '1_000', '5.', '+80', 'NaN', 'Infinity',
    '1e9999999999999999']) {
    assert.equal(parseAssumedPrice(bad), null, JSON.stringify(bad));
  }
});

test('cost at an assumed price is the engine\'s own sum: fed a published price, it returns the engine\'s cost', () => {
  // The one figure on the strip the engine did not compute. Held to the engine's answer on
  // every line where the pack publishes a price, so the two cannot round differently.
  let checked = 0;
  pack.classifications.forEach((c, index) => {
    if (index % 5 !== 0) return;
    for (const massT of ['100', '37.25', '0.001', '999999.999']) {
      const route = routesFor(pack, c.code, 'IN', 2026)[0];
      if (!route) continue;
      for (const date of ['2026-03-15', '2026-06-30']) {
        const e = estimateFromPack(pack, { cn: c.code, country: 'IN', route, massT, date });
        if (e.status !== 'cscf_pending' || e.priceEur === null) continue;
        assert.equal(assumedCost(e.scenario.certificates, e.priceEur), e.scenario.costEur,
          `${c.code} ${massT} t ${date}`);
        checked += 1;
      }
    }
  });
  assert.ok(checked > 300, `only ${checked} priced lines were compared`);
  // Half up on a true tie, judged on the decimal: 0.125 × 1 = 0.125 → 0.13 (a float would give 0.12 or 0.13 by accident).
  assert.equal(assumedCost('0.125', '1'), '0.13');
  assert.equal(assumedCost('1.005', '1'), '1.01', '1.005 is not representable in binary; the decimal is rounded');
  assert.equal(assumedCost('376.755', '80'), '30140.40');
});

test('a typed price fills only the years with no published price, and never replaces a published one', () => {
  const view = outlook(pack, line());
  const none = text(renderOutlook(view));
  assert.match(none, /2026 329\.8 certificates €24,855\.80 price published, €75\.36/);
  assert.match(none, /2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q1 none published as at 14 Oct 2026/);
  assert.match(none, /2028 427\.4 certificates, \+29\.6% on 2026 Certificate price · imports in 2028-Q1 none published as at 14 Oct 2026/);

  const filled = text(renderOutlook(view, '80'));
  assert.match(filled, /2026 329\.8 certificates €24,855\.80 price published, €75\.36/,
    'the published year is untouched: still the engine\'s cost at the Commission\'s price');
  // 376.755 × 80 = 30,140.40 ; 427.41 × 80 = 34,192.80
  assert.match(filled, /2027 376\.8 certificates, \+14\.2% on 2026 €30,140\.40 at your assumed €80 · not a published price/);
  assert.match(filled, /2028 427\.4 certificates, \+29\.6% on 2026 €34,192\.80 at your assumed €80 · not a published price/);
  assert.doesNotMatch(filled, /€26,386|329\.8275 × 80/);
  assert.match(filled, /Cost price × certificates €24,855\.80 published €75\.36 €30,140\.40 your assumed €80 €34,192\.80 your assumed €80/);

  // Every place the visitor's number produces a figure says whose number it is.
  const html = renderOutlook(view, '80');
  const mine = html.match(/€30,140\.40[\s\S]{0,120}/g);
  assert.equal(mine.length, 2, 'the 2027 cost appears on the card and in the table');
  for (const m of mine) assert.match(m, /your assumed €80/);

  // An unusable entry fills nothing and says what is wanted.
  // AUDIT 4: a price with more decimals is used as shown. 376.755 × 80.56 = 30,351.38 (not ×80.555).
  const cents = text(renderOutlook(view, '80.555'));
  assert.match(cents, /€30,351\.38 at your assumed €80\.56/);
  assert.doesNotMatch(cents, /30,349\.50/);
  for (const bad of ['0', '-5', 'abc', '0.004']) {
    const t = text(renderOutlook(view, bad));
    assert.match(t, /2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q1 none published/, bad);
    assert.match(t, /Enter a price of at least €0\.01\./, bad);
    assert.doesNotMatch(t, /your assumed/, bad);
  }
});

test('the slots refilled while the visitor types are exactly what a full render holds', () => {
  const view = outlook(pack, line());
  for (const priceText of ['', '80', '82.5', 'abc']) {
    const html = renderOutlook(view, priceText);
    const slots = outlookPriceSlots(view, priceText);
    for (const [name, inner] of Object.entries(slots)) {
      assert.ok(html.includes(`data-ol="${name}">${inner}</`), `slot ${name} at ${JSON.stringify(priceText)}`);
    }
  }
});

test('when the entered date falls in a 2026 quarter with no published price, 2026 is fillable too', () => {
  // 2026-Q4: published in the first week of January 2027. (This was Q3 until the Q3 price was
  // published on 5 October 2026; see the next test.)
  const view = outlook(pack, line({ date: '2026-11-15' }));
  assert.deepEqual(unpricedYears(view), [2026, 2027, 2028]);
  const t = text(renderOutlook(view));
  assert.match(t, /2026 329\.8 certificates Certificate price · imports in 2026-Q4 none published as at 14 Oct 2026/);
  assert.match(t, /Fills the cost for 2026, 2027 and 2028, where no price is published for the import's quarter\./);
  // AUDIT 2, in the strip: a November shipment's 2026 card is about ITS quarter. "2026: none
  // published" was false while three other 2026 quarters have a price.
  assert.match(t, /2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q4 none published/);
  // Each pending row's own locator, once: the 2026 row's and the weekly-price sentence.
  assert.match(t, /Certificate price, 2026: EC certificate price table, 2026-Q4 \(not yet published\)\./);
  assert.match(t, /Certificate price, 2027 and 2028: From 2027 the Commission sets a weekly certificate price/);
});

test('a 2026-Q3 import is priced at the published Q3 price, EUR 82.32, and at no other quarter\'s', () => {
  // Read from the Commission's page on 2026-10-14: Q3 2026, published 5 October 2026, EUR 82.32.
  // 329.8275 certificates × 82.32 = 27,151.40 (27,151.39980 half up).
  const view = outlook(pack, line({ date: '2026-08-15' }));
  const y = view.years[0];
  assert.equal(y.price.quarter, '2026-Q3');
  assert.equal(y.price.status, 'published');
  assert.equal(y.price.priceEur, '82.32');
  assert.equal(y.costEur, '27151.40');
  assert.deepEqual(unpricedYears(view), [2027, 2028]);
  const t = text(renderOutlook(view));
  assert.match(t, /2026 329\.8 certificates €27,151\.40 price published, €82\.32/);
  assert.doesNotMatch(t, /75\.36|75\.28|24,855/, 'not at the Q1 or Q2 price');
});

/* ── the words ─────────────────────────────────────────────────────────────── */

test('the strip says "none published" with the pack\'s date, prints the pack\'s own sentence once, and forecasts nothing', () => {
  const view = outlook(pack, line());
  assert.equal(view.packDate, pack.generatedAt);
  assert.equal(formatPackDate(pack.generatedAt), '18 Aug 2026');
  const html = renderOutlook(view);
  const t = text(html);
  assert.match(t, /The same shipment, 2026 to 2028 Law as published · 18 Aug 2026/);

  // The weekly-price sentence is the pack row's own locator, whole, and appears once for the
  // two years that share it.
  const locator = pack.prices.find((row) => row.quarter === '2027-Q1').sourceLocator;
  assert.equal(locator, pack.prices.find((row) => row.quarter === '2028-Q1').sourceLocator);
  assert.equal(t.split(locator).length - 1, 1, 'the pending rows\' locator is printed exactly once');
  assert.match(t, /Certificate price, 2027 and 2028: From 2027 the Commission sets a weekly certificate price/);

  // What it must never say. A 2027 or 2028 row is not a quarterly price; nothing is forecast;
  // nobody is told what they will pay. ("Not a forecast" is the one permitted use of the word.)
  assert.doesNotMatch(t, /quarterly|Q[1-4] (certificate )?price|will pay|pay less|you will|expected|projected|predict|\byet\b/i);
  // The quarter appears only as the period the import falls in, the way the result card names it.
  assert.deepEqual([...new Set(t.match(/\S+ \S+ 20\d\d-Q[1-4]/g))], ['imports in 2027-Q1', 'imports in 2028-Q1']);
  assert.deepEqual(t.match(/forecast/gi), ['forecast'], 'only in "not a forecast"');
  assert.match(t, /It is your own assumption: not a forecast and not a published price\./);
  assert.match(t, /It stays on this page and is not saved, exported or sent\./);
  assert.match(t, /With verified emissions it no longer applies\./);
  assert.match(t, /Certificate counts assume no cross-sectoral correction/);
  assert.equal(t.split('cross-sectoral correction').length - 1, 1, 'the caveat is said once');
});

test('every number on the strip is one of the view\'s numbers, rounded from the exact decimal', () => {
  const view = outlook(pack, line());
  const f = figures(view);
  const cards = text(renderOutlookYears(view, null));
  // One decimal place, half up, on the decimal: 329.8275 → 329.8, 376.755 → 376.8, 427.41 → 427.4.
  for (const y of f) {
    const shown = new D(y.certificates).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    assert.ok(cards.includes(shown.toFixed(1)), `${y.year}: ${shown}`);
    // Judged against the TRUE value: the figure shown is within half a unit of the last place.
    assert.ok(shown.minus(y.certificates).abs().lessThanOrEqualTo('0.05'), `${y.year}`);
  }
  // The percentages are the rise on the first year: 47.0 / 329.8275 and 97.5825 / 329.8275.
  assert.ok(new D(f[1].riseOnFirstPct).minus(new D('46.9275').div('329.8275').times(100)).abs().lessThan('1e-40'));
  assert.ok(new D(f[2].riseOnFirstPct).minus(new D('97.5825').div('329.8275').times(100)).abs().lessThan('1e-40'));
  assert.match(cards, /\+14\.2% on 2026/);   // 14.2279
  assert.match(cards, /\+29\.6% on 2026/);   // 29.5859

  // The working table shows up to three places, as the result card above the strip does.
  const html = text(renderOutlook(view));
  assert.match(html, /Emissions counted, tCO₂e default value plus mark-up 475\.2 mark-up 10% 518\.4 mark-up 20% 561\.6 mark-up 30%/);
  assert.match(html, /Free allocation deducted, tCO₂e benchmark × share retained × tonnes −145\.373 1\.491 × 97\.5% −141\.645 1\.491 × 95% −134\.19 1\.491 × 90%/);
  assert.match(html, /Certificates to surrender 329\.828 376\.755 427\.41/);
  assert.match(html, /Cost price × certificates €24,855\.80 published €75\.36 — none published — none published/);

  // The bar's segments are the split's own values, not a second calculation.
  const bar = renderOutlookWhy(view).match(/flex-grow:([0-9.]+)/g).map((m) => m.slice('flex-grow:'.length));
  assert.deepEqual(bar, ['86.4', '11.1825'], 'the benchmark part is zero and draws no segment');
  assert.match(text(renderOutlookWhy(view)), /Benchmark for route \(C\) does not change by 2028.* 0\.0$/,
    'but its legend row is still there, saying so');
});

test('rounding is half up on the decimal, with thousands separators, and never prints a negative zero', () => {
  assert.equal(formatDecimal('329.8275', 3, false), '329.828', 'a tie at the fourth place rounds up');
  assert.equal(formatDecimal('329.8275', 1, true), '329.8');
  assert.equal(formatDecimal('0.25', 1, true), '0.3', 'half up, not half to even');
  assert.equal(formatDecimal('0.35', 1, true), '0.4', '0.35 is below 0.35 in binary; the decimal is what is rounded');
  assert.equal(formatDecimal('1234567.891', 2, true), '1,234,567.89');
  assert.equal(formatDecimal('134.19', 3, false), '134.19', 'trailing zeros trimmed when not fixed');
  assert.equal(formatDecimal('100', 1, true), '100.0');
  assert.equal(formatDecimal('-0.04', 1, true), '0.0', 'a value that rounds to zero carries no sign');
  assert.equal(formatDecimal('-12.34', 1, true), '−12.3');
});

test('the rendered strip escapes what it did not write', () => {
  // The reason and the locators are the engine's and the pack's strings; the price text is the
  // visitor's. None may reach innerHTML unescaped.
  const view = outlook(pack, line({ route: '(D)' }));
  view.years[0].reason = '<img src=x onerror=alert(1)> & "quoted"';
  const html = renderOutlook(view, '"><script>alert(1)</script>');
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});
