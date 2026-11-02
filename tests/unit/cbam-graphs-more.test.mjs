import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

import {
  graphsModel, originCountries, originRow, originsFrom, originsKey, originsModel, phaseModel,
  sentenceOrigins, sentencePhase, ORIGINS_FLAT_SHARE, ORIGINS_SAME_SHARE,
} from '../../src/scripts/cbam-graphs.ts';
import { originStrip, phaseColumns, renderWhy } from '../../src/scripts/cbam-ui/tiles-why.ts';
import { renderYearsWhy } from '../../src/scripts/cbam-ui/tiles-years.ts';
import { outlook, outlookWhy } from '../../src/scripts/cbam-outlook.ts';
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

/* ── why it rises ──────────────────────────────────────────────────────────── */

test('SWEEP, why it rises (moved from the cascade, D2): the benchmark is said not to change exactly when its part is zero, in its own scope, and a zero part draws no segment', () => {
  let lines = 0, split = 0, withheld = 0, benchZero = 0, benchNonZero = 0; const wrong = [];
  for (const [cn, route] of goodsAndRoutes()) {
    const inputs = [line({ cn, route })];
    const probe = estimateFromPack(pack, line({ cn, route, verified: { directTco2ePerT: '1000' } }));
    if (probe.status === 'cscf_pending') {
      const perTonne = new D(probe.scenario.faaTco2e).div(100);
      for (const f of ['0.5', '1.004', '2']) inputs.push(line({ cn, route, verified: { directTco2ePerT: perTonne.times(f).toDecimalPlaces(6).toFixed() } }));
    }
    for (const input of inputs) {
      const view = outlook(pack, input);
      if (!view) continue;
      lines += 1;
      const where = `${cn}/${route} ${input.verified ? `verified ${input.verified.directTco2ePerT}` : 'defaults'}`;
      const why = outlookWhy(view);
      if (why.kind !== 'split') {
        withheld += 1;
        if (view.split !== null) wrong.push(`${where}: a split exists and the tile withholds it`);
        continue;
      }
      split += 1;
      const bench = why.rows.find((r) => r.key === 'benchmark');
      const zero = new D(view.split.benchmarkPart).isZero();
      if (zero) benchZero += 1; else benchNonZero += 1;
      const saysFlat = /does not change/.test(bench.title);
      if (saysFlat !== zero) wrong.push(`${where}: benchmark part ${view.split.benchmarkPart}, title "${bench.title}"`);
      const first = view.years[0];
      const bm = first.benchmarks.length === 1 ? first.benchmarks[0] : null;
      const scope = bm && bm.route ? `for route ${bm.route}` : 'for this good';
      if (saysFlat && bm && !bench.title.includes(`Benchmark ${scope} does not change`)) wrong.push(`${where}: scope should be "${scope}": "${bench.title}"`);
      const html = renderYearsWhy(view);
      for (const [key, cls] of [['markup', 'cb-ol-s1'], ['factor', 'cb-ol-s2'], ['benchmark', 'cb-ol-s3']]) {
        const row = why.rows.find((r) => r.key === key);
        const drawn = html.includes(`${cls}" style="flex-grow`);
        if (drawn !== (!!row && !new D(row.value).isZero())) wrong.push(`${where}: ${key} drawn=${drawn}, part=${row?.value}`);
      }
    }
  }
  assert.ok(lines > 3000, `only ${lines} lines`);
  assert.ok(split > 1000 && withheld > 100 && benchZero > 100 && benchNonZero > 100,
    `the sweep must reach every kind: split ${split}, withheld ${withheld}, benchmark flat ${benchZero}, benchmark steps ${benchNonZero}`);
  assert.equal(wrong.length, 0, `${wrong.length} contradictions, e.g.\n${wrong.slice(0, 6).join('\n')}`);
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
  const svg = phaseColumns(phase);
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
      if (kind === 'chart' && !originStrip(o).includes(`data-shared="${modal}"`)) wrong.push(`${where}: shared figure not marked on the chart`);
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
  const fmSvg = originStrip(fm);
  assert.match(fmSvg, /data-shared="34"/, 'with the shared figure marked');
  // The chart names the same extremes as the sentence: the others', not an origin on the shared figure.
  assert.match(fmSvg, /208\.5<small>[^<]+<\/small>/);
  assert.doesNotMatch(fmSvg, /<small>Angola<\/small>/);
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
  assert.match(originStrip(cement), /data-shared="95"/);
  // One or two origins: listed, never ranked.
  const few = { ...tube, kind: 'few', rows: tube.rows.slice(0, 2) };
  assert.match(text(sentenceOrigins(few)), /^On default values only 2 origins are published for this good and route: United States 13\.0, Canada [0-9.]+ certificates in 2026\.$/);
  // A spread under a tenth of the highest IS little difference: said in words, not drawn.
  const flat = { ...cement, kind: 'flat', rows: cement.rows.map((r) => ({ ...r, certificates: new D(r.certificates).equals(cement.mode.certificates) ? r.certificates : '150' })) };
  assert.equal(text(sentenceOrigins(flat)), 'On default values the origin makes little difference for this good: 95 of 101 origins carry the same figure, 153.4 certificates in 2026; the other 6 are at 150.0.');
  assert.doesNotMatch(originStrip(flat), /class="cg-m"/, 'a flat spread is not drawn as if it mattered');
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
  assert.match(originStrip(top), /data-shared="5"/);
  const one = originsFrom(line(), rows(['100', '300', '300', '300']));
  assert.equal(text(sentenceOrigins(one)), 'On default values, 3 of 4 origins carry the same figure for this good, 300.0 certificates in 2026; the other, Origin A, is at 100.0.');
  assert.ok(tube);
});

test('the origin strip is zero-based: each dot sits at its value over the highest, and the own origin is marked', () => {
  const tube = originsModel(pack, line());
  const html = originStrip(tube);
  const dots = [...html.matchAll(/data-v="([^"]+)" data-country="([^"]+)" style="left:calc\(14px \+ \(100% - 28px\) \* ([0-9.]+)\)"/g)];
  assert.equal(dots.length, 27);
  const top = new D(tube.rows[tube.rows.length - 1].certificates);
  for (const [, v, , at] of dots) assert.equal(at, new D(v).div(top).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
  assert.equal((html.match(/class="cg-m b-me"/g) ?? []).length, 1, 'India, the line\'s own origin');
  assert.match(text(html), /^13\.0 United States → 762\.1 Indonesia India 329\.8/);
});

test('the phase columns: a column\'s height is the share retained, solid only where this line is computed', () => {
  const html = phaseColumns(phaseModel(pack, modelOf(line())));
  assert.deepEqual([...html.matchAll(/<b style="height:([0-9.]+)%"><\/b>/g)].map((x) => x[1]), ['97.5', '95', '90', '77.5', '51.5', '39', '26.5', '14', '0']);
  assert.equal((html.match(/class="cg-m b-ph b-ph-on"/g) ?? []).length, 3);
});

/* ── the section ───────────────────────────────────────────────────────────── */

test('the section carries the three new cards, and the origins card waits to be filled', () => {
  const m = modelOf(line());
  const html = renderWhy(m, { chargedYear: null, priceText: '', secondText: '', open: {} },
    { share: 280, markup: 280, charged: 280, cost: 280, phase: 600, origins: 600 }, phaseModel(pack, m));
  assert.deepEqual([...html.matchAll(/data-cg-card="(\w+)"/g)].map((x) => x[1]),
    ['share', 'charged', 'markup', 'phase', 'origins', 'cost']);
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

/* ── H2 (audit 2026-11-02): the Why view is bounded for any mass ── */

test('H2 (moved, D2): an absurd mass renders the whole Why view, bounded and quickly', () => {
  for (const massT of ['1e10', '1e15', '1e400']) {
    const t0 = Date.now();
    const m = modelOf(line({ massT }));
    if (!m || typeof m === 'string') continue;
    const html = renderWhy(m, { chargedYear: null, priceText: '', secondText: '', open: {} }, { cost: 600 }, phaseModel(pack, m));
    assert.ok(Date.now() - t0 < 2000, `${massT}: took ${Date.now() - t0} ms`);
    assert.ok(html.length < 200_000, `${massT}: ${html.length} bytes`);
    assert.equal((html.match(/<i( class="on")?><\/i>/g) ?? []).length, 100, `${massT}: the waffle is always 100 cells`);
  }
});
