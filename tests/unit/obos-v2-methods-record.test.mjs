// tests/unit/obos-v2-methods-record.test.mjs — OBOS v2 spec §4.9, H23 [H] (Track B, plan S7.3; A1 §2.4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allWardRecords, LICENCES } from '../../src/scripts/standards/ward-record.ts';
import { ACCURACY, SPATIAL, HEIGHTS } from '../../src/scripts/climate-engine/accuracy.ts';

const SRC = readFileSync('src/components/ClimateEngine/v2/MethodsCards.astro', 'utf8');
const CODE = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

test('Data & methods figures are the ward record\'s own (H23)', () => {
  assert.match(SRC, /allWardRecords\(\)/);
  assert.ok(!/\b0\.93\b|\b2,?207\b|\b7,?931\b|EPSG:32645/.test(SRC), 'a figure was typed in instead of read from the record');
  const r = allWardRecords().find((x) => x.id === 'ballygunge');
  assert.ok(r && r.boundary && r.boundary.areaM2 > 0 && r.provenance.footprints.byDataset.length > 0);
});

test('H23: every accuracy figure the card prints is read from accuracy.ts, none typed', () => {
  for (const k of ['ACCURACY.night.bandK', 'ACCURACY.night.n', 'ACCURACY.night.modelRmseK', 'ACCURACY.night.ceilingRmseK', 'ACCURACY.peak.bandK', 'ACCURACY.peak.n',
    'SPATIAL.rModel', 'SPATIAL.rVegOnly', 'SPATIAL.n', 'HEIGHTS.nBuildings', 'HEIGHTS.minBuildings', 'HEIGHTS.verdict', 'PEAK_EVIDENCE_BASIS', 'HEIGHTS_EVIDENCE_BASIS']) {
    assert.ok(CODE.includes(k), `MethodsCards does not read ${k}`);
  }
  /* the values themselves, as the unit-tested exports hold them, never appear as literals in the markup */
  for (const v of [ACCURACY.night.n, ACCURACY.peak.n, SPATIAL.n, HEIGHTS.nBuildings, ACCURACY.night.modelRmseK, ACCURACY.night.ceilingRmseK, ACCURACY.peak.modelRmseK, SPATIAL.rModel, SPATIAL.rVegOnly]) {
    assert.ok(!new RegExp(`(?<![\\w.{])${String(v).replace('.', '\\.')}(?![\\w}])`).test(CODE.replace(/\{[^{}]*\}/g, '')), `the figure ${v} is typed into MethodsCards`);
  }
});

test('the ward record sentence and the empty sentence are v1\'s, word for word', () => {
  assert.ok(/What is measured, the out-of-sample error and sample size, every source dataset with its licence, and the analysis CRS and bounding box\./.test(CODE.replace(/\s+/g, ' ')));
  assert.ok(/No record ships for \{s\.name\}\. The ward record states what was measured, with what error, from which datasets — and there is no measurement here to state\./.test(CODE.replace(/\s+/g, ' ')));
});

test('#report-link: exactly one, outside the per-sibling blocks, with v1\'s download attribute and href pattern', () => {
  assert.equal((CODE.match(/id="report-link"/g) ?? []).length, 1);
  assert.match(CODE, /<a class="[^"]*" id="report-link" href=\{`\/api\/wards\/\$\{scope\.area\.id\}\/metadata\.json`\} download>Download ward record ↓<\/a>/);
  const rec = CODE.indexOf('data-v2-record'), link = CODE.indexOf('id="report-link"');
  assert.ok(CODE.indexOf('</div>', rec) < link, 'the link sits inside a per-sibling block, so a switch would leave it behind');
});

test('receipts: v1\'s button words and ids, data areas only; no panel text is typed (the app fills it)', () => {
  assert.match(CODE, /id="srcBtn" type="button" aria-expanded="false" aria-controls="srcPanel">Data receipts ↗</);
  assert.match(CODE, /id="srcPanel" role="dialog" aria-label="Per-layer data provenance" hidden><\/div>/);
  assert.match(CODE, /scope\.area\.hasData &&/);
});

test('the ward brief link, and every licence a real https link', () => {
  assert.match(CODE, /<a class="cta" data-v2-brief href="\/heat-map\/brief\/">Open the ward brief →</, 'the brief link is marked so the binder can point it at THIS ward');
  for (const [name, l] of Object.entries(LICENCES)) assert.match(l.url, /^https:\/\//, `${name} has no https url`);
  assert.match(CODE, /Object\.entries\(LICENCES\)/);
  assert.match(CODE, /target="_blank" rel="noopener noreferrer"/);
  assert.match(CODE, /shareAlike/);
});

test('honesty words: "checked", never "validated"; no tier colour; no banned money word', () => {
  assert.ok(!/\bvalidated\b/i.test(CODE), 'the solar/accuracy tier word is "checked"');
  assert.ok(!/guarantee|ROI of/i.test(CODE));
});

test('F4 (B-S7 audit): no numeric literal hides inside a {…} expression, with or without a comment naming the export', () => {
  /* two or more digits, or a decimal: an index like `i > 0` is not a figure */
  const NUM = /(?<![\w.])(?:\d{2,}|\d+\.\d+)(?![\w])/;
  /* a literal in an expression, comments and the allowed forms removed; a Sym's pixel size is a prop, not a figure */
  const typed = (raw) => NUM.test(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/toFixed\(\d\)|1e6|1000/g, ''));
  const exprs = [...CODE.replace(/size=\{\d+\}/g, 'size=SZ').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  assert.ok(exprs.length > 10, 'the scan found the expressions');
  for (const raw of exprs) assert.ok(!typed(raw), `a number is typed inside {${raw}}`);
  /* the guard guards itself: the mutation that survived the first test (a figure typed beside a comment naming its export) is caught */
  assert.ok(typed('29 /* ACCURACY.peak.n */'), 'the scan must catch a typed figure beside a comment');
  assert.ok(typed("'0.93'.length + 2207"));
  assert.ok(!typed('ACCURACY.night.bandK.toFixed(1)') && !typed('(m2 / 1e6).toFixed(2)'));
});

test('F8: a unit never runs into its figure for a screen reader (a space before every <small> in a stat)', () => {
  for (const f of ['MethodsCards.astro', 'WeatherCards.astro']) {
    const src = readFileSync(`src/components/ClimateEngine/v2/${f}`, 'utf8');
    for (const m of src.matchAll(/(.)<small>/g)) assert.equal(m[1], ' ', `${f}: <small> follows "${m[1]}" with no space`);
  }
});

test('F9: the count grouping choice is recorded where it is made', () => {
  assert.match(SRC, /en-GB[\s\S]*100,000|100,000[\s\S]*en-GB/, 'MethodsCards records why en-GB and when it would differ from v1');
});
