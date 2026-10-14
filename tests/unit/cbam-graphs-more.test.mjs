import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

import {
  graphsModel, originCountries, originRow, originsFrom, originsKey, originsModel, phaseModel, plotCascade, plotOrigins, plotPhase, renderGraphs,
  sentenceCascade, sentenceOrigins, sentencePhase, ORIGINS_FLAT_SHARE, ORIGINS_SAME_SHARE,
} from '../../src/scripts/cbam-graphs.ts';
import { outlook, splitBetween } from '../../src/scripts/cbam-outlook.ts';
import { estimateFromPack, routesFor } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

/**
 * THE THREE FURTHER GRAPHS: why the count rises, how fast free allocation goes, and how the
 * default values differ by origin.
 *
 * Written before the code, on the lesson of the last audit: a title sentence decided from a
 * rounded or second-hand figure said something false on 1,608 lines. So each sentence is tested
 * here against the TRUE figures it describes, over every good and route the pack offers for
 * India, not against the chart and not against two examples.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const D = Decimal.clone({ precision: 60 });
const line = (over = {}) => ({
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect', ...over,
});
const modelOf = (input) => graphsModel(pack, input, outlook(pack, input));
const text = (html) => html.replace(/<\/?b>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const goodsAndRoutes = () => pack.classifications.flatMap((c) => routesFor(pack, c.code, 'IN', 2026).map((route) => [c.code, route]));
const CAUSE_WORDS = {
  markup: /come from the mark-up on (default values|the Commission's default value for electricity)/,
  factor: /come from the smaller share of free allocation retained/,
  benchmark: /come from the lower benchmark/,
};

/* ── why it rises ──────────────────────────────────────────────────────────── */

test('SWEEP, why it rises: the sentence names the largest cause, says when the benchmark adds nothing, and never splits what is not split', () => {
  let lines = 0, split = 0, withheld = 0, benchZero = 0, benchNonZero = 0; const wrong = [];
  for (const [cn, route] of goodsAndRoutes()) {
    const inputs = [line({ cn, route })];
    const probe = estimateFromPack(pack, line({ cn, route, verified: { directTco2ePerT: '1000' } }));
    if (probe.status === 'cscf_pending') {
      const perTonne = new D(probe.scenario.faaTco2e).div(100);
      for (const f of ['0.5', '1.004', '2']) inputs.push(line({ cn, route, verified: { directTco2ePerT: perTonne.times(f).toDecimalPlaces(6).toFixed() } }));
    }
    for (const input of inputs) {
      const m = modelOf(input);
      if (!m || typeof m === 'string') continue;
      lines += 1;
      const s = text(sentenceCascade(m)), where = `${cn}/${route} ${input.verified ? `verified ${input.verified.directTco2ePerT}` : 'defaults'}`;
      const view = outlook(pack, input);
      const first = view.years[0], last = view.years[view.years.length - 1];
      const rise = new D(last.certificates).minus(first.certificates);
      const truth = splitBetween(first, last);
      if (rise.isZero()) {
        withheld += 1;
        if (!/^The count does not change between/.test(s)) wrong.push(`${where}: no change, sentence "${s}"`);
        continue;
      }
      if (!truth) {
        withheld += 1;
        if (!/is not divided into causes/.test(s)) wrong.push(`${where}: no split, sentence "${s}"`);
        continue;
      }
      split += 1;
      const parts = { markup: new D(truth.moreEmissions), factor: new D(truth.factorPart), benchmark: new D(truth.benchmarkPart) };
      const largest = Object.entries(parts).sort((a, b) => b[1].cmp(a[1]))[0][0];
      if (!CAUSE_WORDS[largest].test(s)) wrong.push(`${where}: largest cause is ${largest}, sentence "${s}"`);
      // The strip's words: the benchmark is per route, so "for route (C)"; "for this good" only without one.
      const bm = first.benchmarks.length === 1 ? first.benchmarks[0] : null;
      const scope = bm && bm.route ? `for route ${bm.route}` : 'for this good';
      if (/The benchmark does not change/.test(s) && !s.includes(`The benchmark does not change ${scope}.`)) wrong.push(`${where}: benchmark scope should be "${scope}": "${s}"`);
      const saysBenchFlat = /The benchmark does not change/.test(s);
      if (parts.benchmark.isZero()) benchZero += 1; else benchNonZero += 1;
      if (saysBenchFlat !== parts.benchmark.isZero()) wrong.push(`${where}: benchmark part ${parts.benchmark}, sentence "${s}"`);
      // The legend draws no category that contributes nothing.
      const svg = plotCascade(m, 600).svg;
      for (const [key, part] of Object.entries(parts)) {
        if ((svg.includes(`data-cause="${key}"`)) !== !part.isZero()) wrong.push(`${where}: cause ${key} drawn=${svg.includes(`data-cause="${key}"`)} part=${part}`);
      }
    }
  }
  assert.ok(lines > 3000, `only ${lines} lines`);
  assert.ok(split > 1000 && withheld > 100 && benchZero > 100 && benchNonZero > 100,
    `the sweep must reach every kind: split ${split}, withheld ${withheld}, benchmark flat ${benchZero}, benchmark steps ${benchNonZero}`);
  assert.equal(wrong.length, 0, `${wrong.length} contradictions, e.g.\n${wrong.slice(0, 6).join('\n')}`);
});

test('why it rises, worked: welded tube and iron powder', () => {
  // Tube: 86.4 of 97.5825 is mark-up, 11.1825 the share retained, the benchmark does not move.
  assert.equal(text(sentenceCascade(modelOf(line()))),
    'Of the 97.6 extra certificates by 2028, 86.4 come from the mark-up on default values. The benchmark does not change for route (C).');
  // Iron powder (F): 50.8 mark-up, 10.95 share retained, 14.58 the 2028 benchmark step.
  assert.equal(text(sentenceCascade(modelOf(line({ cn: '72052100', route: '(F)' })))),
    'Of the 76.3 extra certificates by 2028, 50.8 come from the mark-up on default values.');
  // Verified figures: no mark-up, so the share retained leads.
  assert.equal(text(sentenceCascade(modelOf(line({ verified: { directTco2ePerT: '2.0' } })))),
    'Of the 11.2 extra certificates by 2028, 11.2 come from the smaller share of free allocation retained. The benchmark does not change for route (C).');
  // A floored line is not divided.
  assert.equal(text(sentenceCascade(modelOf(line({ verified: { directTco2ePerT: '1.0' } })))),
    'The count does not change between 2026 and 2028: free allocation covers all of the emissions counted.');
  // A benchmark step too small to print is still a step: never say it does not change.
  const m = modelOf(line({ cn: '72052100', route: '(F)' }));
  const sp = m.causes[m.causes.length - 1];
  m.causes[m.causes.length - 1] = { ...sp, benchmarkPart: '0.01' };
  assert.ok(!text(sentenceCascade(m)).includes('does not change'), 'a 0.01 benchmark part is not "no change"');
});

/* ── how fast free allocation goes ─────────────────────────────────────────── */

test('the phase-out is the pack\'s legislated schedule; only the years the engine computes are solid', () => {
  const phase = phaseModel(pack, modelOf(line()));
  assert.deepEqual(phase.rows.map((r) => [r.year, r.factor, r.computable]), [
    [2026, '0.975', true], [2027, '0.95', true], [2028, '0.90', true],
    [2029, '0.775', false], [2030, '0.515', false], [2031, '0.39', false], [2032, '0.265', false],
    [2033, '0.14', false], [2034, '0', false],
  ]);
  assert.equal(text(sentencePhase(phase)), 'Free allocation retained falls to zero in 2034. The steepest single step is 2030.');
  // No certificate count after 2028, anywhere on the card.
  const svg = plotPhase(phase, 600).svg;
  // No certificate COUNT anywhere on this card: the only mention is that none is computed.
  assert.doesNotMatch(text(svg) + svg, /\d[\d,.]* certificates/i);
  assert.match(svg, /legislated; no certificate count is computed here for this year/);
  assert.equal((svg.match(/data-computable="true"/g) ?? []).length, 3);
  assert.equal((svg.match(/data-computable="false"/g) ?? []).length, 6);
});

test('the phase-out sentence is decided from the schedule, whatever the schedule', () => {
  const mk = (pairs) => ({ rows: pairs.map(([year, factor], i) => ({ year, factor, computable: i < 3, locator: 'x' })) });
  // No zero in the schedule: it says where it ends, not that it reaches zero.
  assert.equal(text(sentencePhase(mk([[2026, '0.975'], [2027, '0.95'], [2028, '0.90'], [2029, '0.5']]))),
    'Free allocation retained falls to 50% by 2029. The steepest single step is 2029.');
  // A tie for the steepest step names the earlier year.
  assert.equal(text(sentencePhase(mk([[2026, '1'], [2027, '0.5'], [2028, '0'], [2029, '0']]))),
    'Free allocation retained falls to zero in 2028. The steepest single step is 2027.');
  // Every step in the shipped schedule, checked against the sentence's claim of the steepest.
  const rows = pack.cbamFactors;
  const drops = rows.slice(1).map((r, i) => [r.year, new D(rows[i].factor).minus(r.factor)]);
  const steepest = drops.reduce((a, b) => (b[1].greaterThan(a[1]) ? b : a));
  assert.match(sentencePhase(phaseModel(pack, modelOf(line()))), new RegExp(`steepest single step is ${steepest[0]}`));
});

/* ── origins ───────────────────────────────────────────────────────────────── */

test('SWEEP, origins: on EVERY good and route, the chart rule and every claim in the sentence follow the figures', () => {
  // Every claim is checked, not only which rule fired: who "the others" are and their range, the
  // shared figure and its count, and whether "little difference" is true of ALL the origins.
  let checked = 0, sharedSaid = 0, littleSaid = 0; const kinds = { chart: 0, flat: 0, few: 0 }; const wrong = [];
  const one = (v) => new D(v).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  const num = (t) => new D(t.replace(/,/g, ''));
  for (const [cn, route] of goodsAndRoutes()) {
    const input = line({ cn, route });
    const o = originsModel(pack, input);
    if (!o) continue;
    checked += 1;
    const where = `${cn}/${route}`;
    const values = o.rows.map((r) => new D(r.certificates));
    const min = D.min(...values), max = D.max(...values);
    const counts = {}; for (const v of values) counts[v.toFixed()] = (counts[v.toFixed()] ?? 0) + 1;
    const modal = Math.max(...Object.values(counts));
    const littleTrue = max.isZero() || max.minus(min).div(max).lessThan(ORIGINS_FLAT_SHARE);
    const kind = o.rows.length < 3 ? 'few' : littleTrue ? 'flat' : 'chart';
    kinds[kind] += 1;
    if (o.kind !== kind) wrong.push(`${where}: model says ${o.kind}, figures say ${kind}`);
    const s = text(sentenceOrigins(o));
    if (!/default values/.test(s)) wrong.push(`${where}: the sentence does not say these are default values`);
    if (/little difference|no difference/.test(s)) {
      littleSaid += 1;
      if (!littleTrue) wrong.push(`${where}: says little difference over a ${max.minus(min).div(max).times(100).toFixed(0)}% spread: "${s}"`);
    }
    const sh = s.match(/(\d+) of (\d+) origins carry the same figure(?: for this good)?, ([\d,.]+) certificates/);
    if (sh) {
      sharedSaid += 1;
      const [, k, n, v] = sh;
      const exact = o.rows.filter((r) => one(r.certificates).equals(num(v)) && new D(r.certificates).equals(o.mode.certificates));
      if (Number(n) !== o.rows.length) wrong.push(`${where}: says ${n} origins, there are ${o.rows.length}`);
      if (Number(k) !== modal || exact.length !== modal) wrong.push(`${where}: says ${k} share ${v}; the most sharing one figure is ${modal}`);
      if (modal * 2 < o.rows.length) wrong.push(`${where}: a shared figure named for under half the origins`);
      const others = o.rows.filter((r) => !new D(r.certificates).equals(o.mode.certificates));
      const om = s.match(/the other (\d+) run from ([\d,.]+) \(([^)]+)\) to ([\d,.]+) \(([^)]+)\)/)
        ?? s.match(/the other (\d+) are at ([\d,.]+)/) ?? s.match(/the other, ([^,]+), is at ([\d,.]+)/);
      if (!om) { wrong.push(`${where}: names a shared figure but not the others: "${s}"`); continue; }
      const oLo = D.min(...others.map((r) => new D(r.certificates))), oHi = D.max(...others.map((r) => new D(r.certificates)));
      const inOthers = (name, v) => others.some((r) => r.name === name && new D(r.certificates).equals(v));
      if (om[0].startsWith('the other,')) {
        if (others.length !== 1 || !inOthers(om[1], oLo) || !one(oLo).equals(num(om[2]))) wrong.push(`${where}: the one other is wrong: "${s}"`);
      } else {
        if (Number(om[1]) !== others.length) wrong.push(`${where}: says ${om[1]} others, there are ${others.length}`);
        if (!one(oLo).equals(num(om[2]))) wrong.push(`${where}: others' lowest is ${oLo}, says ${om[2]}`);
        if (om[3] && (!inOthers(om[3], oLo) || !inOthers(om[5], oHi) || !one(oHi).equals(num(om[4])))) wrong.push(`${where}: others' range wrong: "${s}"`);
        if (!om[3] && !oLo.equals(oHi)) wrong.push(`${where}: says the others share one figure; they run ${oLo} to ${oHi}`);
      }
      if (kind === 'chart' && !plotOrigins(o, 600, 'IN').svg.includes(`data-shared="${modal}"`)) wrong.push(`${where}: shared figure not marked on the chart`);
    } else if (kind !== 'few' && modal * 2 >= o.rows.length && modal < o.rows.length) {
      wrong.push(`${where}: ${modal} of ${o.rows.length} share one figure and the sentence does not say so`);
    } else if (kind !== 'few' && modal === o.rows.length) {
      if (!/all \d+ origins carry the same figure/.test(s)) wrong.push(`${where}: all origins equal, sentence "${s}"`);
    } else if (kind !== 'few') {
      const lowest = o.rows.filter((r) => new D(r.certificates).equals(min)).map((r) => r.name);
      const highest = o.rows.filter((r) => new D(r.certificates).equals(max)).map((r) => r.name);
      if (!lowest.some((n) => s.includes(n))) wrong.push(`${where}: lowest is ${lowest.join('/')}, sentence "${s}"`);
      if (!highest.some((n) => s.includes(n))) wrong.push(`${where}: highest is ${highest.join('/')}, sentence "${s}"`);
    }
    const own = o.rows.find((r) => r.country === 'IN');
    if (own && kind === 'chart' && !s.includes(`India is at ${new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(one(own.certificates).toNumber())}`)) wrong.push(`${where}: India's own figure not stated: "${s}"`);
  }
  assert.ok(checked > 400, `only ${checked} goods checked`);
  assert.ok(kinds.chart > 100 && kinds.flat > 5 && sharedSaid > 5, `the sweep must reach every kind: ${JSON.stringify(kinds)}, shared ${sharedSaid}`);
  console.log(`origins sweep: ${checked} goods and routes, ${JSON.stringify(kinds)}, shared figure named ${sharedSaid}, "little/no difference" said ${littleSaid}`);
  assert.equal(wrong.length, 0, `${wrong.length} contradictions, e.g.\n${wrong.slice(0, 6).join('\n')}`);
});

test('origins, audit reproductions: "the others" are only the origins off the shared figure, and "little difference" is said only when it is true', () => {
  // (a) 72026000: 34 of 49 share 149.8; Angola is one of them, so it is not one of "the others".
  const fm = originsModel(pack, line({ cn: '72026000', route: 'default' }));
  const offShared = fm.rows.filter((r) => !new D(r.certificates).equals(fm.mode.certificates));
  assert.equal(offShared.length, 15);
  const s = text(sentenceOrigins(fm));
  assert.doesNotMatch(s, /little difference/, 'from 149.8 to 443.5 is not little');
  assert.doesNotMatch(s, /Angola/, 'Angola carries the shared figure');
  assert.match(s, /34 of 49 origins carry the same figure for this good, 149\.8 certificates in 2026; the other 15 run from 208\.5 \([^)]+\) to 443\.5 \(Indonesia\)\./);
  assert.equal(fm.kind, 'chart', 'a wide spread is drawn');
  const fmSvg = plotOrigins(fm, 600, 'IN').svg;
  assert.match(fmSvg, /data-shared="34"/, 'with the shared figure marked');
  // The chart names the same extremes as the sentence: the others', not an origin on the shared figure.
  assert.match(fmSvg, /208\.5 <tspan[^>]*>[^<]+<\/tspan>/);
  assert.doesNotMatch(fmSvg, /<tspan[^>]*>Angola<\/tspan>/);
  // (b) hydrogen: 79 of 96 share 694.0, the others reach 0.0 and 2,434.2.
  const h2 = originsModel(pack, line({ cn: '28041000', route: 'default' }));
  const s2 = text(sentenceOrigins(h2));
  assert.doesNotMatch(s2, /little difference/);
  assert.match(s2, /79 of 96 origins carry the same figure for this good, 694\.0 certificates in 2026; the other 17 run from 0\.0 \(Mali\) to 2,434\.2 \(United States\)\./);
  assert.equal(h2.kind, 'chart');
});

test('origins, worked: welded tube spreads widely; aluminous cement mostly shares one figure, drawn with that figure marked', () => {
  const tube = originsModel(pack, line());
  assert.equal(tube.kind, 'chart');
  assert.equal(tube.rows.length, 27);
  assert.equal(text(sentenceOrigins(tube)),
    'On default values, 2026 certificates for this good run from 13.0 (United States) to 762.1 (Indonesia). India is at 329.8.');
  const cement = originsModel(pack, line({ cn: '25233000', route: 'default' }));
  // 143.5 to 182.0 is a 21% spread: not "little difference", so it is drawn, the 95 marked.
  assert.equal(cement.kind, 'chart');
  assert.equal(text(sentenceOrigins(cement)), 'On default values, 95 of 101 origins carry the same figure for this good, 153.4 certificates in 2026; the other 6 run from 143.5 (United States) to 182.0 (India). India is at 182.0.');
  assert.match(plotOrigins(cement, 600, 'IN').svg, /data-shared="95"/);
  // One or two origins: listed, never ranked.
  const few = { ...tube, kind: 'few', rows: tube.rows.slice(0, 2) };
  assert.match(text(sentenceOrigins(few)), /^On default values only 2 origins are published for this good and route: United States 13\.0, Canada [0-9.]+ certificates in 2026\.$/);
  // A spread under a tenth of the highest IS little difference: said in words, not drawn.
  const flat = { ...cement, kind: 'flat', rows: cement.rows.map((r) => ({ ...r, certificates: new D(r.certificates).equals(cement.mode.certificates) ? r.certificates : '150' })) };
  assert.equal(text(sentenceOrigins(flat)), 'On default values the origin makes little difference for this good: 95 of 101 origins carry the same figure, 153.4 certificates in 2026; the other 6 are at 150.0.');
  assert.doesNotMatch(plotOrigins(flat, 600, 'IN').svg, /class="cg-m"/, 'a flat spread is not drawn as if it mattered');
  // The page computes the rows a few at a time and in any order; the model is the same.
  const sliced = originCountries(pack, line()).reverse().map((c) => originRow(pack, line(), c)).filter(Boolean);
  assert.deepEqual(originsFrom(line(), sliced), tube);
  assert.equal(originsModel(pack, line({ date: 'not-a-date' })), null);
  // A verified line still compares default values, and says so.
  const verified = originsModel(pack, line({ verified: { directTco2ePerT: '2.0' } }));
  assert.equal(verified.usesVerified, true);
  assert.deepEqual(verified.rows.map((r) => r.certificates), tube.rows.map((r) => r.certificates), 'the comparison is of default values');
});

test('the origins key changes with EVERY input the computation reads, the mass first', () => {
  const base = line({ verified: { directTco2ePerT: '2.0', indirectTco2ePerT: '0.5' } });
  const changes = {
    cn: '72052100', country: 'CN', route: '(F)', massT: '250', date: '2027-03-15', emissionsScope: 'direct',
    verified: { directTco2ePerT: '2.1', indirectTco2ePerT: '0.5' },
  };
  // Every field of the input is covered: a field added later fails here until it is listed.
  assert.deepEqual(Object.keys(changes).sort(), Object.keys(base).sort());
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(originsKey({ ...base, [field]: value }), originsKey(base), `${field} must change the key`);
  }
  assert.notEqual(originsKey({ ...base, verified: { ...base.verified, indirectTco2ePerT: '0.6' } }), originsKey(base), 'a nested verified figure');
  assert.notEqual(originsKey({ ...base, verified: undefined }), originsKey(base), 'verified or not');
  assert.equal(originsKey({ ...base }), originsKey(base), 'the same line is the same key');
  // And the figures the key guards do depend on the mass.
  assert.notDeepEqual(originsModel(pack, line({ massT: '250' })).rows, originsModel(pack, line()).rows);
});

test('origins: the others when the shared figure is the HIGHEST, and when there is only one other', () => {
  const tube = originsModel(pack, line());
  const rows = (vals) => vals.map((v, i) => ({ country: `X${i}`, name: `Origin ${String.fromCharCode(65 + i)}`, certificates: v }));
  const top = originsFrom(line(), rows(['50', '80', '200', '200', '200', '200', '200']).map((r, i) => ({ ...r, country: i === 1 ? 'IN' : r.country })));
  assert.equal(top.kind, 'chart'); assert.equal(top.shared, true);
  assert.equal(text(sentenceOrigins(top)), 'On default values, 5 of 7 origins carry the same figure for this good, 200.0 certificates in 2026; the other 2 run from 50.0 (Origin A) to 80.0 (Origin B). Origin B is at 80.0.');
  assert.match(plotOrigins(top, 600, 'IN').svg, /data-shared="5"/);
  const one = originsFrom(line(), rows(['100', '300', '300', '300']));
  assert.equal(text(sentenceOrigins(one)), 'On default values, 3 of 4 origins carry the same figure for this good, 300.0 certificates in 2026; the other, Origin A, is at 100.0.');
  assert.ok(tube);
});

/* ── the section ───────────────────────────────────────────────────────────── */

test('the section carries the three new cards, and the origins card waits to be filled', () => {
  const m = modelOf(line());
  const html = renderGraphs(m, { chargedYear: null, priceText: '', secondText: '', open: {} },
    { steps: 600, cascade: 600, share: 280, markup: 280, charged: 280, cost: 280, phase: 600, origins: 600 }, phaseModel(pack, m));
  assert.deepEqual([...html.matchAll(/data-cg-card="(\w+)"/g)].map((x) => x[1]),
    ['steps', 'cascade', 'share', 'markup', 'charged', 'cost', 'phase', 'origins']);
  assert.match(text(html), /Comparing every origin's default value…/);
  assert.doesNotMatch(text(html), /\b(2029|2030|2031|2032|2033|2034)\b[^.]*certificates/);
});

/* ── the two audit leftovers ───────────────────────────────────────────────── */

test('a retry imports only this site\'s own built scripts; any other address means a reload', async () => {
  const { graphsRetryUrl } = await import('../../src/scripts/cbam-algos/cbam-app.ts');
  const origin = 'https://deltaclimate.earth';
  // Chromium's own wording, with the site's chunk.
  assert.equal(graphsRetryUrl('Failed to fetch dynamically imported module: https://deltaclimate.earth/_astro/cbam-graphs-dom.CF7QB653.js', origin),
    'https://deltaclimate.earth/_astro/cbam-graphs-dom.CF7QB653.js');
  // A retry's own failure carries the query it was given; the base address is what is kept.
  assert.equal(graphsRetryUrl('Failed to fetch dynamically imported module: https://deltaclimate.earth/_astro/x.js?retry=2', origin),
    'https://deltaclimate.earth/_astro/x.js');
  // Another origin, or this origin outside /_astro/: never imported.
  assert.equal(graphsRetryUrl('Failed to fetch dynamically imported module: https://evil.example/_astro/x.js', origin), 'foreign');
  assert.equal(graphsRetryUrl('Failed to fetch dynamically imported module: https://deltaclimate.earth/uploads/x.js', origin), 'foreign');
  assert.equal(graphsRetryUrl('Failed to fetch dynamically imported module: http://deltaclimate.earth/_astro/x.js', origin), 'foreign', 'not even the same host over another scheme');
  // No address at all (WebKit's wording): nothing to follow; the plain import is tried again.
  assert.equal(graphsRetryUrl('Importing a module script failed.', origin), null);
});
