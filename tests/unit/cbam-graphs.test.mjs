import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

import {
  assumedRange, chargedCells, chargedKind, chargedLegend, costParts, graphsModel, pctHonest, secondNote,
  secondUsable, tableCharged, plotCharged, plotCost, plotMarkup, plotShare,
  plotSteps, renderGraphs, scaleFromZero, sentenceCharged, sentenceCost, sentenceMarkup,
  sentenceShare, sentenceSteps,
} from '../../src/scripts/cbam-graphs.ts';
import { assumedCost, outlook } from '../../src/scripts/cbam-outlook.ts';
import { estimateFromPack, routesFor } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

/**
 * THE GRAPHS, against the real shipped pack.
 *
 * Three things are held here. The MODEL: every figure is the outlook's or one more engine call's,
 * checked against hand-derived values for the lines the design names and against the engine
 * directly for the rest. The SENTENCES: each is the title of its chart, so it is tested on the
 * edge cases a real line seldom produces (no change, a fall, a rise too small to show) as well
 * as on real lines. The DRAWING: lengths are proportional to values on a zero-based scale, and
 * the two cards that must carry no rounded mark carry none.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const D = Decimal.clone({ precision: 60 });
const line = (over = {}) => ({
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect', ...over,
});
const modelOf = (input) => graphsModel(pack, input, outlook(pack, input));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const WIDTHS = { steps: 600, share: 280, markup: 280, charged: 280, cost: 280 };
const STATE = () => ({ chargedYear: null, priceText: '', secondText: '', open: {} });
const TUBE = modelOf(line());

/* ── the model ─────────────────────────────────────────────────────────────── */

test('welded tube: the model is the outlook\'s figures plus what the mark-up adds', () => {
  // BY HAND (see cbam-outlook.test.mjs for the counts): default 4.320 t/t, benchmark 1.491.
  // With the base value entered as verified there is no mark-up: 100 × 4.32 = 432 in every year.
  //   432 − 145.3725 = 286.6275 ; 432 − 141.645 = 290.355 ; 432 − 134.19 = 297.81
  // so the mark-up adds 43.2 / 86.4 / 129.6, which is 10%, 20% and 30% of 432.
  assert.deepEqual(TUBE.years.map((y) => y.certificates), ['329.8275', '376.755', '427.41']);
  assert.deepEqual(TUBE.years.map((y) => y.certificatesAtBase), ['286.6275', '290.355', '297.81']);
  assert.deepEqual(TUBE.years.map((y) => y.markupAdds), ['43.2', '86.4', '129.6']);
  assert.deepEqual(TUBE.years.map((y) => y.markupPct), ['10', '20', '30']);
  assert.deepEqual(TUBE.years.map((y) => y.stepRise), [null, '46.9275', '50.655']);
  // Charged share: 329.8275 ÷ 475.2 = 69.408…% ; 427.41 ÷ 561.6 = 76.105…%
  assert.deepEqual(TUBE.years.map((y) => y.chargedPct.slice(0, 7)), ['69.4081', '72.6765', '76.1057']);
  // 86.4 ÷ 97.5825 = 88.540…%
  assert.equal(TUBE.split.markupSharePct.slice(0, 7), '88.5404');
  assert.deepEqual(TUBE.split, { rise: '97.5825', markup: '86.4', factor: '11.1825', benchmark: '0', markupSharePct: TUBE.split.markupSharePct });
  assert.equal(TUBE.usesDefault, true);
  // The shipment's own quarter in each year, and a cost only where that quarter has a published
  // price: 329.8275 × 75.36 for 2026 Q1. The Q2 price belongs to other shipments and is not here.
  assert.deepEqual(TUBE.years.map((y) => [y.priceQuarter, y.priceEur, y.costEur]),
    [['2026-Q1', '75.36', '24855.80'], ['2027-Q1', null, null], ['2028-Q1', null, null]]);
  assert.equal('published' in TUBE, false, 'no list of other quarters\' costs is carried');
});

test('"the base value as verified" is the engine\'s own answer to exactly that question', () => {
  for (const input of [line(), line({ cn: '72052100', route: '(F)' }), line({ cn: '25233000', route: 'default' }),
    line({ cn: '2523100090', country: 'DZ', route: '(A)' })]) {
    const m = modelOf(input);
    const view = outlook(pack, input);
    m.years.forEach((y, i) => {
      const date = view.years[i].date;
      const direct = pack.defaultValues
        .filter((r) => input.cn.startsWith(r.scopeCode) && r.originCountry === input.country && r.productionRoute === input.route
          && r.emissionsType === 'direct' && r.reportingYear === y.year && r.cell.state === 'value')
        .sort((a, b) => b.scopeCode.length - a.scopeCode.length)[0];
      const indirect = pack.defaultValues
        .filter((r) => input.cn.startsWith(r.scopeCode) && r.originCountry === input.country && r.productionRoute === input.route
          && r.emissionsType === 'indirect' && r.reportingYear === y.year && r.cell.state === 'value')
        .sort((a, b) => b.scopeCode.length - a.scopeCode.length)[0];
      const verified = { directTco2ePerT: direct.cell.baseIntensity };
      if (indirect) verified.indirectTco2ePerT = indirect.cell.baseIntensity;
      const e = estimateFromPack(pack, { ...input, date, verified });
      assert.equal(e.stamp.tier, 'actual-verified', `${input.cn} ${y.year}: priced with no default at all`);
      assert.equal(y.certificatesAtBase, e.scenario.certificates, `${input.cn} ${y.year}`);
      assert.ok(new D(y.markupAdds).equals(new D(y.certificates).minus(e.scenario.certificates)), `${input.cn} ${y.year}`);
      assert.ok(!new D(y.markupAdds).isNegative(), `${input.cn} ${y.year}: a mark-up never subtracts`);
    });
  }
});

test('every other figure in the model is the outlook\'s, untouched', () => {
  const input = line({ cn: '72052100', route: '(F)' });
  const view = outlook(pack, input), m = modelOf(input);
  m.years.forEach((y, i) => {
    const o = view.years[i];
    assert.deepEqual([y.year, y.certificates, y.embeddedTco2e, y.allocationTco2e, y.costEur, y.priceEur, y.riseOnFirstPct],
      [o.year, o.certificates, o.embeddedTco2e, o.allocationTco2e, o.costEur, o.price.priceEur, o.riseOnFirstPct]);
  });
  assert.deepEqual([m.split.rise, m.split.markup, m.split.factor, m.split.benchmark], ['76.33', '50.8', '10.95', '14.58']);
  assert.equal(m.packDate, pack.generatedAt);
});

test('states: nothing to model, a refused line, verified figures, a mixed line, a floored line', () => {
  // No outlook at all: an unreadable date, or a year the data does not cover.
  assert.equal(graphsModel(pack, line({ date: '2029-03-15' }), outlook(pack, line({ date: '2029-03-15' }))), null);
  assert.equal(graphsModel(pack, line({ date: '' }), null), null);
  // A route with no default value: every year refused.
  assert.equal(modelOf(line({ route: '(D)' })), 'no-estimate');

  // Verified figures: no default is used, so the mark-up adds nothing, and no engine call is
  // made to find that out (the count at "base" IS the count).
  const verified = modelOf(line({ verified: { directTco2ePerT: '2.0' } }));
  assert.equal(verified.usesDefault, false);
  assert.deepEqual(verified.years.map((y) => y.markupAdds), ['0', '0', '0']);
  assert.deepEqual(verified.years.map((y) => y.markupPct), [null, null, null]);
  assert.deepEqual(verified.years.map((y) => y.certificatesAtBase), verified.years.map((y) => y.certificates));
  assert.equal(verified.split.markup, '0');
  assert.equal(verified.split.markupSharePct, '0.000000');

  // Verified direct with the Commission's electricity default: the mark-up is on the electricity
  // alone. Base 0.04 t/t × 100 t = 4 ; with mark-up 4.4 / 4.8 / 5.2 → adds 0.4 / 0.8 / 1.2.
  const mixed = modelOf(line({ cn: '2523100090', country: 'DZ', route: '(A)', verified: { directTco2ePerT: '1.5' } }));
  assert.equal(mixed.usesDefault, true);
  assert.deepEqual(mixed.years.map((y) => y.markupAdds), ['0.4', '0.8', '1.2']);
  assert.deepEqual(mixed.years.map((y) => y.markupPct), ['10', '20', '30']);

  // Free allocation above the emissions counted: the count is floored, the split withheld.
  const floored = modelOf(line({ verified: { directTco2ePerT: '1.0' } }));
  assert.equal(floored.split, null);
  assert.deepEqual(floored.years.map((y) => y.chargedPct), ['0.000000', '0.000000', '0.000000']);
});

/* ── the sentences ─────────────────────────────────────────────────────────── */

const synthetic = (certs, over = {}) => ({
  massT: '100', packDate: pack.generatedAt, usesDefault: true, split: null,
  years: certs.map((c, i) => ({
    year: 2026 + i, certificates: c, embeddedTco2e: '500', allocationTco2e: '100', costEur: null, priceEur: null,
    priceQuarter: `${2026 + i}-Q1`,
    markupPct: '10', certificatesAtBase: c, markupAdds: '0', chargedPct: '50.000000',
    stepRise: i ? new D(c).minus(certs[i - 1]).toFixed() : null,
    riseOnFirstPct: i && !new D(certs[0]).isZero() ? new D(c).minus(certs[0]).div(certs[0]).times(100).toFixed() : null,
  })),
  ...over,
});

test('the year-by-year sentence never contradicts the line: a rise, no change, a fall, a tiny change, a zero start', () => {
  assert.equal(text(sentenceSteps(TUBE)), 'The same 100 t needs 29.6% more certificates in 2028 than in 2026.');
  assert.equal(text(sentenceSteps(synthetic(['200', '200', '200']))), 'The same 100 t needs the same certificates in 2028 as in 2026.');
  assert.equal(text(sentenceSteps(synthetic(['200', '190', '150']))), 'The same 100 t needs 25.0% fewer certificates in 2028 than in 2026.');
  // 0.04% would print as "0.0% more": said in certificates instead.
  assert.equal(text(sentenceSteps(synthetic(['200', '200', '200.08']))), 'The same 100 t needs 0.08 more certificates in 2028 than in 2026.');
  // From zero there is no percentage.
  assert.equal(text(sentenceSteps(synthetic(['0', '0.355', '7.81']))), 'The same 100 t needs 7.8 more certificates in 2028 than in 2026.');
  assert.doesNotMatch(sentenceSteps(synthetic(['200', '200', '200.08'])), /0\.0%/);
  // A real floored-then-rising line agrees with its own counts.
  const partial = modelOf(line({ verified: { directTco2ePerT: '1.42' } }));
  assert.equal(text(sentenceSteps(partial)), 'The same 100 t needs 7.8 more certificates in 2028 than in 2026.');
  // The mass is printed as a number, through the same formatter as every other figure.
  assert.match(sentenceSteps(synthetic(['1', '2', '3'], { massT: '1e2' })), /The same 100 t needs/);
  assert.match(sentenceSteps(synthetic(['1', '2', '3'], { massT: '987654321' })), /The same 987,654,321 t needs/);
  assert.match(sentenceSteps(synthetic(['1', '2', '3'], { massT: '0.001' })), /The same 0\.001 t needs/);
  // Thousands separators in a large percentage, as the strip prints it.
  assert.match(sentenceSteps(synthetic(['4', '40', '79'])), /<b>1,875\.0% more<\/b>/);
  // And anything that is not a number is escaped, never interpreted.
  assert.doesNotMatch(sentenceSteps(synthetic(['1', '2', '3'], { massT: '<b>9</b>' })), /<b>9<\/b> t/);
});

test('the mark-up sentences say what applies, and never that anyone will pay less', () => {
  assert.equal(text(sentenceMarkup(TUBE)), 'On default values the mark-up adds 129.6 certificates in 2028. It no longer applies with verified data.');
  assert.equal(text(sentenceShare(TUBE)), 'of the rise to 2028 is the mark-up on default values. It no longer applies with verified data.');
  const verified = modelOf(line({ verified: { directTco2ePerT: '2.0' } }));
  assert.equal(text(sentenceMarkup(verified)), 'No mark-up is applied to this line: the figures are your own verified ones.');
  assert.equal(text(sentenceShare(verified)), 'of the rise to 2028 is mark-up. These are your verified figures, so none is applied.');
  const floored = modelOf(line({ verified: { directTco2ePerT: '1.0' } }));
  assert.equal(text(sentenceShare(floored)), 'The change to 2028 is not divided into causes for this line.');
  // A line on defaults whose mark-up is the same in every year (1% rows): it adds, but explains none of the rise.
  const flat = synthetic(['100', '110', '120'], { split: { rise: '20', markup: '0', factor: '20', benchmark: '0', markupSharePct: '0.000000' } });
  assert.equal(text(sentenceShare(flat)), 'of the rise to 2028 is mark-up. The mark-up on this line does not change.');
  assert.equal(text(sentenceMarkup(flat)), 'The mark-up adds no certificates to this line in 2028.');
  // A real amount too small for one decimal place is never printed as "0.0".
  const tiny = synthetic(['1', '1', '1']);
  tiny.years[2].markupAdds = '0.0013';
  assert.equal(text(sentenceMarkup(tiny)), 'On default values the mark-up adds under 0.1 certificates in 2028. It no longer applies with verified data.');
  assert.doesNotMatch(plotMarkup(tiny, 280, 'u').svg, /\+0\.0</);
  for (const s of [sentenceMarkup(TUBE), sentenceShare(TUBE), sentenceMarkup(verified), sentenceShare(verified)]) {
    assert.doesNotMatch(s, /pay less|will pay|save|cheaper|forecast/i);
  }
});

test('the charged sentence is decided from the certificates and the free allocation, not from the cells', () => {
  assert.equal(chargedCells('76.105769'), 76);
  assert.equal(chargedCells('64.5'), 65, 'half up on the decimal');
  assert.equal(chargedCells('0.4'), 0);
  assert.equal(chargedCells('99.6'), 100);
  assert.equal(chargedCells('130'), 100, 'never more than the grid holds');
  assert.equal(pctHonest('0'), '0.0%');
  assert.equal(pctHonest('0.04'), 'under 0.1%');
  assert.equal(pctHonest('0.4'), '0.4%');
  assert.equal(pctHonest('99.96'), 'over 99.9%');
  assert.equal(pctHonest('100'), '100.0%');
  assert.equal(text(sentenceCharged(TUBE, 2)), 'In 2028, certificates cover 76 of every 100 tonnes of emissions counted. Free allocation covers the other 24.');
  assert.equal(text(sentenceCharged(TUBE, 0)), 'In 2026, certificates cover 69 of every 100 tonnes of emissions counted. Free allocation covers the other 31.');
  // Exactly none: the engine floored the count at zero.
  const floored = modelOf(line({ verified: { directTco2ePerT: '1.0' } }));
  assert.equal(chargedKind(floored.years[2]), 'none');
  assert.equal(text(sentenceCharged(floored, 2)), 'In 2028, free allocation covers all of the emissions counted. No certificates are due.');
  // Exactly all: certificates equal the emissions counted.
  const all = synthetic(['500', '500', '500'], {});
  all.years.forEach((y) => { y.chargedPct = '100.000000'; });
  assert.equal(chargedKind(all.years[1]), 'all');
  assert.equal(text(sentenceCharged(all, 1)), 'In 2027, certificates cover all of the emissions counted.');
  // A share that ROUNDS to none or to all is neither.
  const sliver = synthetic(['2', '2', '2']); sliver.years.forEach((y) => { y.chargedPct = '0.400000'; });
  assert.equal(chargedKind(sliver.years[0]), 'some');
  assert.equal(text(sentenceCharged(sliver, 0)), 'In 2026, certificates cover under 1 of every 100 tonnes of emissions counted (0.4%). Free allocation covers the rest.');
  const nearly = synthetic(['498', '498', '498']); nearly.years.forEach((y) => { y.chargedPct = '99.600000'; });
  assert.equal(text(sentenceCharged(nearly, 0)), 'In 2026, certificates cover almost all of the emissions counted (99.6%). Free allocation covers the rest.');
  const none = synthetic(['0', '0', '0']);
  none.years.forEach((y) => { y.chargedPct = null; });
  assert.equal(text(sentenceCharged(none, 0)), 'No emissions are counted on this line in 2026.');
});

test('the cost sentence: nothing typed, one price, a range; always the visitor\'s, never a forecast', () => {
  assert.deepEqual(assumedRange('', ''), []);
  assert.deepEqual(assumedRange('80', ''), ['80']);
  assert.deepEqual(assumedRange('', '90'), [], 'a second price alone draws nothing: the strip shows no cost either');
  assert.deepEqual(assumedRange('abc', '90'), []);
  assert.deepEqual(assumedRange('100', '60'), ['60', '100'], 'in order, whichever box holds which');
  assert.deepEqual(assumedRange('80', '80.0'), ['80'], 'the same price twice is one price');
  assert.deepEqual(assumedRange('abc', '-5'), []);
  assert.deepEqual(assumedRange('0', '70'), []);
  // Rounded once, to the cent, and that is the price used: 80.555 is 80.56 everywhere.
  assert.deepEqual(assumedRange('80.555', ''), ['80.56']);
  assert.deepEqual(assumedRange('0.004', ''), [], 'less than one cent is not a price');
  assert.deepEqual(assumedRange('80.561', '80.564'), ['80.56'], 'two prices equal to the cent are one price');
  assert.match(text(sentenceCost(TUBE, assumedRange('80.555', ''))), /At your own €80\.56 a certificate, 2028 comes to €34,432\./);

  assert.equal(text(sentenceCost(TUBE, [])), 'No certificate price is published for imports in 2027-Q1 or 2028-Q1. Type your own price above to see a cost.');
  // 427.41 × 80 = 34,192.80 ; × 60 = 25,644.60 ; × 100 = 42,741.00
  assert.equal(text(sentenceCost(TUBE, ['80'])), 'At your own €80 a certificate, 2028 comes to €34,193. That price is yours: no price is published for imports in 2027-Q1 or 2028-Q1.');
  assert.equal(text(sentenceCost(TUBE, ['60', '100'])), 'At your own €60 to €100 a certificate, 2028 comes to €25,645 to €42,741. That range is yours: no price is published for imports in 2027-Q1 or 2028-Q1.');
  for (const s of [sentenceCost(TUBE, []), sentenceCost(TUBE, ['80']), sentenceCost(TUBE, ['60', '100'])]) {
    assert.doesNotMatch(s, /forecast|expected|will cost|will pay|quarterly|\byet\b|Q[1-4] price/i);
  }
});

/* ── the drawing ───────────────────────────────────────────────────────────── */

test('a zero-based scale: equal values draw equal, and nothing is drawn from a truncated axis', () => {
  const s = scaleFromZero(200, 100);
  assert.equal(s(0), 0);
  assert.equal(s(200), 100);
  assert.equal(s(50), 25);
  assert.equal(scaleFromZero(0, 100)(0), 0, 'an all-zero line does not divide by zero');
});

test('the stepped line: heights proportional to the counts, three exact values on the marks', () => {
  const svg = plotSteps(TUBE, 600).svg;
  const marks = [...svg.matchAll(/data-v="([^"]+)"[\s\S]*?data-h="([^"]+)"/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(marks.map((m) => m[0]), ['329.8275', '376.755', '427.41']);
  const k = marks.map(([v, h]) => h / Number(v));
  assert.ok(Math.max(...k) / Math.min(...k) - 1 < 1e-4, 'height ÷ value is one constant');
  assert.match(text(svg), /329\.8 .*376\.8 \+46\.9 .*427\.4 \+50\.7/);
  assert.match(text(svg), /€24,855\.80 published €75\.36/);
  assert.equal((text(svg).match(/none published/g) ?? []).length, 2);
  assert.match(text(svg), /none published for 2027-Q1 imports .*none published for 2028-Q1 imports/);
});

test('NO ROUNDED MARK on the stepped line or the cost rows: no circle, no radius above 1, no round end', () => {
  const pieces = [plotSteps(TUBE, 600).svg, plotSteps(TUBE, 300).svg,
    plotCost(TUBE, 420, []).svg, plotCost(TUBE, 420, ['80']).svg, plotCost(TUBE, 260, ['60', '100']).svg];
  for (const svg of pieces) {
    assert.doesNotMatch(svg, /<circle|<ellipse/, 'no circular mark');
    assert.deepEqual((svg.match(/rx="([^"]+)"/g) ?? []).filter((r) => Number(/"(.+)"/.exec(r)[1]) > 1), [], 'no radius above 1');
    assert.doesNotMatch(svg, /linecap="round"|linejoin="round"/, 'flat ends and square corners');
    assert.doesNotMatch(svg, /cg-halo|blur/, 'nothing blurred');
  }
});

test('the capsules: length is what the mark-up adds, and a verified line draws no capsule', () => {
  const svg = plotMarkup(TUBE, 280, 'u').svg;
  const marks = [...svg.matchAll(/data-v="([^"]+)"[\s\S]*?data-y1="([^"]+)" data-y0="([^"]+)"/g)].map((m) => [m[1], Number(m[3]) - Number(m[2])]);
  assert.deepEqual(marks.map((m) => m[0]), ['43.2', '86.4', '129.6']);
  const k = marks.map(([v, len]) => len / Number(v));
  assert.ok(Math.max(...k) / Math.min(...k) - 1 < 1e-3, 'capsule length ÷ mark-up added is one constant');
  assert.match(text(svg), /\+43\.2 .*\+86\.4 .*\+129\.6/);

  const verified = modelOf(line({ verified: { directTco2ePerT: '2.0' } }));
  const quiet = plotMarkup(verified, 280, 'u').svg;
  assert.doesNotMatch(quiet, /<rect class="cg-halo"|fill="url\(#u\)"/, 'no capsule where no mark-up is applied');
  assert.equal((quiet.match(/<circle/g) ?? []).length, 3, 'the three counts are still marked');
  assert.match(text(quiet), /54\.6 .*no mark-up .*58\.4 .*65\.8/);
  assert.doesNotMatch(text(quiet), /\+0\.0/);
});

test('the arc: its fraction is the share, and it is empty when there is nothing to show', () => {
  const svg = plotShare(TUBE, 280, 'u').svg;
  assert.equal(/data-t="([^"]+)"/.exec(svg)[1], '0.88540');
  assert.equal(/data-v="([^"]+)"/.exec(svg)[1], TUBE.split.markupSharePct);
  const verified = modelOf(line({ verified: { directTco2ePerT: '2.0' } }));
  assert.doesNotMatch(plotShare(verified, 280, 'u').svg, /data-t=/, 'a share of zero draws no arc');
  const floored = modelOf(line({ verified: { directTco2ePerT: '1.0' } }));
  assert.doesNotMatch(plotShare(floored, 280, 'u').svg, /data-t=/);
});

test('the cost rows: the shipment\'s own published cost, the visitor\'s price only when typed, on one euro scale', () => {
  // Nothing typed: the one published cost that is this shipment's (2026 Q1) and nothing else.
  const empty = plotCost(TUBE, 420, []).svg;
  assert.equal((empty.match(/data-cg="published"/g) ?? []).length, 1);
  assert.doesNotMatch(empty, /data-xlo=/, 'no assumed mark before a price is typed');
  assert.equal((text(empty).match(/none published/g) ?? []).length, 2);

  const one = plotCost(TUBE, 420, ['80']).svg;
  const range = plotCost(TUBE, 420, ['60', '100']).svg;
  assert.equal((one.match(/data-xlo=/g) ?? []).length, 3);
  // The exact costs are on the marks: certificates × price, by the engine's own expression.
  const values = [...range.matchAll(/data-v="([0-9.]+\|[0-9.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, TUBE.years.map((y) => `${assumedCost(y.certificates, '60')}|${assumedCost(y.certificates, '100')}`));
  assert.deepEqual(values, ['19789.65|32982.75', '22605.30|37675.50', '25644.60|42741.00']);
  // One scale: segment length ÷ euros is constant across the rows, and the published tick sits
  // where that same scale puts it.
  const segs = [...range.matchAll(/data-xlo="([^"]+)" data-xhi="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const k = segs.map(([a, b], i) => (b - a) / (Number(assumedCost(TUBE.years[i].certificates, '100')) - Number(assumedCost(TUBE.years[i].certificates, '60'))));
  assert.ok(Math.max(...k) / Math.min(...k) - 1 < 1e-3);
  const zero = segs[0][0] - k[0] * Number(assumedCost(TUBE.years[0].certificates, '60'));
  const tick = Number(/data-x="([^"]+)"/.exec(range)[1]);
  assert.ok(Math.abs((tick - zero) / k[0] - 24855.80) < 2, 'the published cost on the same scale');
  // Where no price is published, the visitor's mark is dashed; where one is, it is solid.
  const dashed = [...range.matchAll(/<rect[^>]*data-xlo[^>]*>/g)].map((m) => /stroke-dasharray/.test(m[0]));
  assert.deepEqual(dashed, [false, true, true]);
  // The published 2026 cost is never moved by the visitor's price.
  for (const svg of [empty, one, range]) assert.match(svg, /data-v="24855\.80"/);
});

test('the second price box does nothing, and says why, until the first price exists', () => {
  const alone = { ...STATE(), secondText: '90' };
  assert.equal(secondUsable(alone), false);
  assert.equal(secondNote(alone), 'Type your first price in the box above. This one then makes a range.');
  const html = renderGraphs(TUBE, alone, WIDTHS);
  assert.match(html, /<input id="cgSecond"[^>]*value="90" disabled \/>/);
  assert.doesNotMatch(html, /data-xlo=|At your own|38,467/, 'no cost is drawn that the strip does not show');
  assert.match(text(html), /No certificate price is published for imports in 2027-Q1 or 2028-Q1\. Type your own price above/);
  const both = { ...STATE(), priceText: '80', secondText: '90' };
  assert.equal(secondUsable(both), true);
  assert.doesNotMatch(renderGraphs(TUBE, both, WIDTHS), /id="cgSecond"[^>]* disabled/);
  assert.match(text(renderGraphs(TUBE, both, WIDTHS)), /At your own €80 to €90 a certificate/);
});

/* ── the section ───────────────────────────────────────────────────────────── */

test('the section: five cards, each with a sentence, a table and a text alternative', () => {
  const html = renderGraphs(TUBE, STATE(), WIDTHS);
  assert.deepEqual([...html.matchAll(/data-cg-card="(\w+)"/g)].map((m) => m[1]), ['steps', 'share', 'markup', 'charged', 'cost']);
  assert.equal((html.match(/<svg[^>]*role="group" aria-label="[^"]+"/g) ?? []).length, 5, 'every plot has a text alternative');
  assert.equal((html.match(/class="cg-tbl cg-closed"/g) ?? []).length, 5, 'every card has a table, closed to begin with');
  assert.equal((html.match(/<h4 class="cg-t"/g) ?? []).length, 5);
  // 3 years + the arc + 3 capsules + the waffle + the shipment's one published cost.
  assert.equal((html.match(/class="cg-m" tabindex="0" role="img" aria-label="[^"]+"/g) ?? []).length, 9, 'every mark is focusable and named');
  const t = text(html);
  assert.match(t, /88\.5 % of the rise to 2028 is the mark-up on default values/);
  assert.match(t, /A real verified figure can be higher or lower than that base\./);
  assert.match(t, /Your price is your assumption, not a forecast\. It stays on this page\./);
  assert.match(t, /Certificate price for imports in 2027-Q1 and 2028-Q1: none published · as at 18 Aug 2026\./);
  // The cards that were not approved are not here.
  assert.doesNotMatch(t, /origin matter|free allocation go|2034|Why does it rise/i);
  // Words this page never uses about a price or a saving. "not a forecast" is the one permitted use.
  assert.doesNotMatch(t, /will pay|pay less|you will|expected price|predict|quarterly|\byet\b|\+0\b(?!\.)/i);
  assert.deepEqual(t.match(/forecast/gi), ['forecast']);
  // The cost card starts EMPTY: no example range, no assumed figure.
  assert.doesNotMatch(html, /data-xlo=|your assumed|€60|€100/);
  assert.match(html, /<input id="cgSecond"[^>]*value="" disabled/);
});

test('the section with prices: the strip\'s price and the second price are one range, and a table follows', () => {
  const state = { ...STATE(), priceText: '100', secondText: '60', open: { cost: true } };
  const html = renderGraphs(TUBE, state, WIDTHS);
  const t = text(html);
  assert.match(t, /At your own €60 to €100 a certificate, 2028 comes to €25,645 to €42,741\. That range is yours/);
  assert.match(t, /Year Imports in At your €60 At your €100 Published 2026 2026-Q1 €19,789\.65 €32,982\.75 €24,855\.80 at €75\.36 2027 2027-Q1 €22,605\.30 €37,675\.50 none published 2028 2028-Q1 €25,644\.60 €42,741\.00 none published/);
  assert.match(html, /<div class="cg-tbl" id="cgTbl-cost" data-cg="table" tabindex="0" role="region" aria-label="Table: What would it cost at my own price\?">/,
    'an open table stays open across a redraw, and its scroll box is reachable and named');
  // costParts is what the page refills while a price is typed; it is exactly what a full render holds.
  const parts = costParts(TUBE, WIDTHS.cost, state);
  assert.ok(html.includes(parts.plot) && html.includes(parts.table) && html.includes(parts.title));
});

test('refused and reduced states say so in words and draw nothing false', () => {
  const none = renderGraphs('no-estimate', STATE(), WIDTHS);
  assert.match(text(none), /Nothing to draw: this line has no estimate in any year\./);
  assert.doesNotMatch(none, /<svg|data-cg-card/);
  assert.match(text(renderGraphs('some-years-refused', STATE(), WIDTHS)), /no estimate in at least one year/);

  const verified = text(renderGraphs(modelOf(line({ verified: { directTco2ePerT: '2.0' } })), STATE(), WIDTHS));
  assert.match(verified, /0\.0 % of the rise to 2028 is mark-up\. These are your verified figures, so none is applied\./);
  assert.match(verified, /No mark-up is applied to this line: the figures are your own verified ones\./);
  assert.match(verified, /The ring is the count from your verified figures\./);
  assert.doesNotMatch(verified, /Commission's base value/);

  const floored = text(renderGraphs(modelOf(line({ verified: { directTco2ePerT: '1.0' } })), STATE(), WIDTHS));
  assert.match(floored, /— The change to 2028 is not divided into causes for this line\./);
  assert.match(floored, /free allocation covers all of the emissions counted\. No certificates are due\./);
  assert.match(floored, /The same 100 t needs the same certificates in 2028 as in 2026\./);
});

test('what the visitor typed is escaped wherever it lands', () => {
  const html = renderGraphs(TUBE, { ...STATE(), priceText: '80', secondText: '"><script>x</script>' }, WIDTHS);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
});

/* ── audit findings 1 and 2: the sentence is decided from the true values ──── */

const truthKind = (y) => {
  const cert = new D(y.certificates), emb = new D(y.embeddedTco2e);
  if (emb.isZero()) return 'no-emissions';
  if (cert.isZero()) return 'none';
  if (cert.equals(emb)) return 'all';
  return 'some';
};
const sentenceKind = (s) => (/No emissions are counted/.test(s) ? 'no-emissions'
  : /No certificates are due/.test(s) ? 'none'
    : /certificates cover <b>all<\/b>/.test(s) ? 'all' : 'some');

test('AUDIT 1: "no certificates are due" is said only when none are, and "all" only when all are', () => {
  // The auditor's reproductions. Certificates ARE due on each of these lines; the charged share
  // is under half a per cent, so it rounds to no filled cell.
  const brazil = modelOf({ cn: '72071980', country: 'BR', route: '(C)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '1.335356' } });
  assert.ok(new D(brazil.years[0].certificates).greaterThan(0), 'sanity: certificates are due in 2026');
  assert.equal(chargedCells(brazil.years[0].chargedPct), 0, 'sanity: and they round to no cell');
  assert.doesNotMatch(sentenceCharged(brazil, 0), /No certificates are due|covers <b>all<\/b>/);
  assert.match(text(sentenceCharged(brazil, 0)), /In 2026, certificates cover under 1 of every 100 tonnes of emissions counted \(0\.4%\)\. Free allocation covers the rest\./);

  const india = modelOf({ cn: '72061000', country: 'IN', route: '(C)', massT: '10000', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '1.16386' } });
  assert.ok(new D(india.years[2].certificates).greaterThan(0), 'sanity: certificates are due in 2028');
  assert.doesNotMatch(sentenceCharged(india, 2), /No certificates are due/);

  // The mirror: free allocation still covers part of it, so "all" is false.
  const high = modelOf({ cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '289.8' } });
  assert.ok(new D(high.years[2].allocationTco2e).greaterThan(0));
  assert.equal(chargedCells(high.years[2].chargedPct), 100, 'sanity: it rounds to a full grid');
  assert.doesNotMatch(sentenceCharged(high, 2), /cover <b>all<\/b>/);
  assert.match(text(sentenceCharged(high, 2)), /In 2028, certificates cover almost all of the emissions counted \(99\.[0-9]%\)\. Free allocation covers the rest\./);
});

test('AUDIT 1, swept: sentence, cells, legend and table agree in kind with the certificates and the free allocation', () => {
  // Every good and every route offered for India, at verified figures chosen around the free
  // allocation, where the charged share is near nothing, and far above it, where it is near
  // everything. For each year of each line the four things a visitor reads are compared with
  // the TRUE values, never with each other.
  // 1.0002 leaves a charged share near 0.02%, small enough to print as "0.0%" if it were rounded;
  // 1.004 one that rounds to no cell; 250 one that rounds to a full grid; 0.5 a floored line.
  const factors = ['0.5', '1.0002', '1.004', '1.5', '250'];
  let lines = 0, years = 0, edge = 0; const wrong = [];
  for (const c of pack.classifications) {
    for (const route of routesFor(pack, c.code, 'IN', 2026)) {
      const probe = estimateFromPack(pack, line({ cn: c.code, route, verified: { directTco2ePerT: '1000' } }));
      if (probe.status !== 'cscf_pending') continue;
      const perTonne = new D(probe.scenario.faaTco2e).div(100);
      if (perTonne.isZero()) continue;
      for (const f of factors) {
        const input = line({ cn: c.code, route, verified: { directTco2ePerT: perTonne.times(f).toDecimalPlaces(6).toFixed() } });
        const m = modelOf(input);
        if (!m || typeof m === 'string') continue;
        lines += 1;
        const tableRows = tableCharged(m).rows;
        m.years.forEach((y, i) => {
          years += 1;
          const truth = truthKind(y), where = `${c.code}/${route} ×${f} ${y.year}`;
          if (chargedKind(y) !== truth) wrong.push(`${where}: chargedKind ${chargedKind(y)}, truth ${truth}`);
          const said = sentenceKind(sentenceCharged(m, i));
          if (said !== truth) { wrong.push(`${where}: sentence says ${said}, truth is ${truth}`); return; }
          if (truth === 'no-emissions') return;
          const filled = chargedCells(y.chargedPct), s = text(sentenceCharged(m, i));
          if (filled === 0 && truth !== 'none') { edge += 1; if (!/under 1 of every 100/.test(s)) wrong.push(`${where}: no filled cell, certificates due, and the sentence does not say so`); }
          if (filled === 100 && truth !== 'all') { edge += 1; if (!/almost all/.test(s)) wrong.push(`${where}: full grid, free allocation applies, and the sentence does not say so`); }
          const legend = text(chargedLegend(m, i));
          if (/surrender 0\.0%/.test(legend) !== (truth === 'none')) wrong.push(`${where}: legend "${legend}" against truth ${truth}`);
          if (/surrender 100\.0%/.test(legend) !== (truth === 'all')) wrong.push(`${where}: legend "${legend}" against truth ${truth}`);
          const cell = String(tableRows.find((r) => r[0] === y.year)?.[4] ?? '');
          if ((cell === '0.0%') !== (truth === 'none') || (cell === '100.0%') !== (truth === 'all')) wrong.push(`${where}: table says "${cell}" against truth ${truth}`);
        });
      }
    }
  }
  assert.ok(lines > 1500, `only ${lines} lines swept`);
  assert.ok(edge > 100, `only ${edge} edge cases met; the sweep must reach the rounding boundary`);
  assert.equal(wrong.length, 0, `${wrong.length} of ${years} line-years contradict the figures, e.g.\n${wrong.slice(0, 5).join('\n')}`);
});

test('AUDIT 2: a shipment in a quarter with no published price is told so about ITS quarter, and is shown no other quarter\'s cost', () => {
  for (const date of ['2026-11-30', '2027-07-01']) {
    const m = modelOf(line({ date }));
    const q = date === '2026-11-30' ? 'Q4' : 'Q3';
    const html = renderGraphs(m, STATE(), WIDTHS), t = text(html);
    // Published 2026 prices exist (Q1 and Q2), so nothing may say that none is published for 2026.
    assert.doesNotMatch(t, /published for 2026, 2027 and 2028|no 2026, 2027 or 2028 price|for 2026, 2027 and 2028: none/, date);
    assert.match(t, new RegExp(`No certificate price is published for imports in 2026-${q}, 2027-${q} or 2028-${q}\\. Type your own price above to see a cost\\.`), date);
    assert.match(t, new RegExp(`Certificate price for imports in 2026-${q}, 2027-${q} and 2028-${q}: none published · as at 18 Aug 2026\\.`), date);
    // No published price applies to this shipment, so no published cost is drawn or tabled for it.
    assert.doesNotMatch(html, /data-cg="published"/, `${date}: another quarter's price is not this shipment's cost`);
    assert.doesNotMatch(t, /24,855\.80|24,829\.41|75\.36|75\.28|published €/, date);
    assert.doesNotMatch(html, /€[0-9,.]+ for this shipment/, date);
    assert.equal((t.match(/none published/g) ?? []).length >= 3, true, date);
    const priced = text(renderGraphs(m, { ...STATE(), priceText: '80' }, WIDTHS));
    assert.match(priced, new RegExp(`That price is yours: no price is published for imports in 2026-${q}, 2027-${q} or 2028-${q}\\.`), date);
  }
  // A first-quarter shipment: its own quarter's published cost, and only that one.
  const q1 = renderGraphs(TUBE, STATE(), WIDTHS);
  assert.equal((q1.match(/data-cg="published"/g) ?? []).length, 1, 'one published mark: the shipment\'s own quarter');
  assert.match(q1, /data-tip="Imports in 2026-Q1: published €75\.36\n€24,855\.80 for this shipment"/);
  assert.doesNotMatch(q1, /24829\.41|24,829\.41/, 'the Q2 price is not this shipment\'s');
  assert.match(text(q1), /No certificate price is published for imports in 2027-Q1 or 2028-Q1\./);
});
