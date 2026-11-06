import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import {
  heatAccuracyClaim, heightsNote, NOT_VALIDATED_LINE,
} from '../../src/scripts/climate-engine/scope/accuracy-claim.ts';
import * as ACC from '../../src/scripts/climate-engine/accuracy.ts';
import * as COPY from '../../src/scripts/climate-engine/v2/method-copy.ts';

/* A HEAT-ACCURACY BAND IS A CLAIM ABOUT A CITY, AND THE CITY'S TIER IS WHERE THE
 * CLAIM IS SAID. The ± figures in accuracy.ts were measured against ECOSTRESS over
 * three KOLKATA wards. They were printed on Bengaluru wards (tier `geometry`:
 * "the physics has not been evidenced here") because the readout gated them on dry
 * weather (`M.outsideValidation`), never on `scope.tier`.
 *
 * THE DESIGN IS A CAPABILITY, NOT A CONVENTION. heatAccuracyClaim(tier) returns the
 * figures ONLY on its `band` variant (`claim.figures`), so TypeScript refuses a read
 * on any other path, and this file bans every other route to them: a raw import of
 * an accuracy.ts / method-copy.ts figure, an alias or namespace import, a re-export,
 * a raw field read (bandK, rModel ...) and a hand-typed copy of the chip words. An
 * earlier version exempted a whole file once it called the gate anywhere, which let
 * a second, ungated render in the same file through. */

const read = (p) => readFileSync(p, 'utf8');
const BENGALURU = AREA_KEYS.filter((k) => k.startsWith('in/bengaluru/'));
const KOLKATA = AREA_KEYS.filter((k) => k.startsWith('in/kolkata/'));

test('the fixtures are what they claim: Kolkata is validated, Bengaluru is geometry', () => {
  assert.ok(KOLKATA.length === 3 && BENGALURU.length === 3);
  for (const k of KOLKATA) assert.equal(resolve(k).tier, 'validated', k);
  for (const k of BENGALURU) assert.equal(resolve(k).tier, 'geometry', k);
});

test('a validated ward may show a band; every other tier gets one honest line instead', () => {
  for (const k of KOLKATA) {
    const c = heatAccuracyClaim(resolve(k).tier);
    assert.equal(c.kind, 'band', k);
    assert.ok(c.figures && typeof c.figures.chip === 'function', `${k}: the band claim carries the figures`);
    assert.equal(c.footLine, 'Satellite-checked surface temperature, not air temperature.');
  }
  for (const tier of ['zone', 'geometry']) {
    const c = heatAccuracyClaim(tier);
    assert.equal(c.kind, 'none', tier);
    assert.equal(c.line, 'Heat accuracy not yet validated for this city');
    assert.equal(c.line, NOT_VALIDATED_LINE);
    assert.equal(c.footLine, 'Modelled surface temperature, not air temperature.');
    assert.ok(!/[±]/.test(c.line + c.detail), `${tier}: the replacement copy must carry no band`);
    assert.match(c.detail, /Kolkata/, `${tier}: say where the bands WERE measured`);
    assert.equal('figures' in c, false, `${tier}: a non-validated claim must not carry the figures`);
    assert.ok(!/\d/.test(JSON.stringify(c)), `${tier}: no digit survives in the replacement copy`);
  }
  for (const k of BENGALURU) assert.equal(heatAccuracyClaim(resolve(k).tier).kind, 'none', k);
});

test('the gate fails closed on a tier it does not know', () => {
  for (const t of ['platinum', undefined, null, '']) {
    const c = heatAccuracyClaim(t);
    assert.equal(c.kind, 'none');
    assert.equal('figures' in c, false);
  }
});

/* ───────────────────────── the leak scanner ─────────────────────────
   scanSource(path, src) -> string[] of offences. The repo walk and the synthetic
   fixtures below share it, so a fixture that stops failing means the scanner went
   blind, not that the repo got safer. */

/** Drop comments, keep strings (a string is where a hand-typed band lives). JS and
 *  block comments in every file; HTML comments in .astro. A ' or " string ends at the
 *  newline, because an apostrophe in .astro prose must not swallow the rest of the file. */
function stripComments(src, ext, blankQuoted = false) {
  let out = '';
  let i = 0;
  let str = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (str) {
      /* blankQuoted: a '...' or "..." string holds text, never code, so a word scan may skip it
         (a licence note that says "see HEIGHTS" is not a read). Template literals can hold code. */
      const blank = blankQuoted && str !== '`' && c !== str && c !== '\n';
      out += blank ? ' ' : c;
      if (c === '\\') { out += blank ? ' ' : (d ?? ''); i += 2; continue; }
      if (c === str || (c === '\n' && str !== '`')) str = null;
      i += 1; continue;
    }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop; continue;
    }
    if (ext === '.astro' && src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end < 0 ? src.length : end + 3;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop; continue;
    }
    if (c === '"' || c === '\'' || c === '`') str = c;
    out += c; i += 1;
  }
  return out;
}

/* Runtime exports that carry no accuracy figure. EVERYTHING ELSE exported by
   accuracy.ts or method-copy.ts is a figure by default: a new export is banned until
   someone argues it neutral here, so the list can only grow by a reviewed line. */
const NEUTRAL = new Set([
  'isTransitionHour',   // a clock predicate: which hours are the dawn window
  'TRANSITION_HOURS',   // the window's edges, not an error figure
  'unmeasuredNote',     // resilience-score copy, about unmeasured indicators
  'monthSpan',          // month-range formatting
  'assertAccuracyLogic',
]);
const FIGURE_EXPORTS = [...Object.keys(ACC), ...Object.keys(COPY)].filter((n) => !NEUTRAL.has(n));
/* Fields of the measured records. A raw read of one is a render of a figure. */
const FIGURE_FIELDS = ['bandK', 'rModel', 'rVegOnly', 'modelRmseK', 'ceilingRmseK', 'looOverpassRmseK'];
const BANNED_WORDS = new RegExp(`(?<![\\w$])(?:${[...FIGURE_EXPORTS, ...FIGURE_FIELDS].join('|')})(?![\\w$])`, 'g');

/* A hand-typed copy of what the chip or the ledger says. Narrow on purpose: "±45°"
   and "n=3" appear elsewhere in src for reasons that have nothing to do with accuracy. */
const LITERALS = [
  [/±\s*\d+(?:\.\d+)?\s*(?:°\s*C|K\b)/, 'a hand-typed ± band'],
  [/\bn\s?=\s?\d{2,}/, 'a hand-typed sample size'],
  [/\bCalibrated\b/, 'the "Calibrated" chip word'],
  [/\bSatellite-checked\b/, 'the "Satellite-checked" claim'],
];

const SOURCE_MODULE = /(?:^|\/)(?:accuracy|method-copy)(?:\.[tj]s)?$|(?:^|\/)data\/calibration\//;
const MODULE_REF = /\b(import|export)\s+(type\s+)?((?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+(?:\s*,\s*\{[^}]*\})?))\s*from\s*['"]([^'"]+)['"]/g;
const BARE_JSON_IMPORT = /\bimport\s+\w+\s+from\s*['"]([^'"]+)['"]/g;

function scanSource(path, src) {
  const code = stripComments(src, extname(path));
  const hits = [];
  for (const m of code.matchAll(MODULE_REF)) {
    const [, kind, typeOnly, clause, from] = m;
    if (!SOURCE_MODULE.test(from)) continue;
    if (typeOnly) continue; // a type carries no figure
    if (kind === 'export') { hits.push(`${path}: re-exports from ${from}`); continue; }
    if (/^\*/.test(clause)) { hits.push(`${path}: namespace import of ${from}`); continue; }
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    const defaultPart = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (defaultPart) hits.push(`${path}: default import from ${from}`);
    for (const spec of named.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (/^type\s/.test(spec)) continue;
      const name = spec.split(/\s+as\s+/)[0].trim();
      if (!NEUTRAL.has(name)) hits.push(`${path}: imports ${name} from ${from}${/\sas\s/.test(spec) ? ` (aliased: ${spec})` : ''}`);
    }
  }
  for (const m of code.matchAll(BARE_JSON_IMPORT)) {
    if (/(?:^|\/)data\/calibration\//.test(m[1])) hits.push(`${path}: reads the calibration artefact ${m[1]}`);
  }
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (SOURCE_MODULE.test(m[1])) hits.push(`${path}: dynamic import of ${m[1]}`);
  }
  /* .astro prose is full of apostrophes that are not quotes, so it is scanned unblanked */
  const wordCode = extname(path) === '.astro' ? code : stripComments(src, extname(path), true);
  for (const w of new Set(wordCode.match(BANNED_WORDS) ?? [])) hits.push(`${path}: reads ${w} outside the claim`);
  for (const [re, what] of LITERALS) if (re.test(code)) hits.push(`${path}: ${what}`);
  return hits;
}

/* The seven synthetic leaks from the independent audit of PR #75 (guard-probe.mjs),
   then the rest of what it named, then the other ways round. */
const LEAKS = {
  'a new file printing transitionChip()': "import { transitionChip } from './method-copy.ts';\nel.textContent = transitionChip();",
  'a new file printing TRANSITION_RMSE_K': "import { TRANSITION_RMSE_K } from '../accuracy.ts';\nel.textContent = `~±${TRANSITION_RMSE_K} K`;",
  'a new file hard-coding the chip': "el.textContent = 'Calibrated · ±3.0 °C · n=50';",
  'a gate that is only mentioned in a comment': "// heatAccuracyClaim(tier) not needed here\nimport { ACCURACY } from '../accuracy.ts'; el.textContent = ACCURACY.night.bandK;",
  'a second ungated render in a file that already calls the gate': "const c = heatAccuracyClaim(t);\nfoo.textContent = `±${ACCURACY.night.bandK}`;",
  'an aliased import': "import { SPATIAL as S } from './accuracy'; el.title = S.note;",
  'the plain baseline': "import { ACCURACY } from '../accuracy.ts'; x = ACCURACY.night.bandK;",
  'PEAK_CHIP_BASIS': "import { PEAK_CHIP_BASIS } from '../accuracy.ts'; el.textContent = PEAK_CHIP_BASIS;",
  'seasonalCaveatLine': "import { seasonalCaveatLine } from '../accuracy.ts'; el.textContent = seasonalCaveatLine(c);",
  'seasonalCaveatDetail via a multi-line import': "import {\n  isTransitionHour,\n  seasonalCaveatDetail,\n} from '../accuracy.ts';",
  'a hand-typed ±4.5 K': "el.title = 'the band is ±4.5 K';",
  'a hand-typed ±3.0 in a template': 'el.title = `band ±3.0 K`;',
  'Satellite-checked': "el.textContent = 'Satellite-checked surface temperature';",
  'a namespace import': "import * as A from '../accuracy.ts'; el.textContent = A.bandLabel('night');",
  'a re-export': "export { ACCURACY } from '../accuracy.ts';",
  'a dynamic import': "const m = await import('../accuracy.ts');",
  'a raw read of the calibration artefact': "import fit from '../../data/calibration/model-accuracy.json' with { type: 'json' };",
  'a .astro frontmatter import': "---\nimport { checkedRows } from '../v2/method-copy.ts';\n---\n<ul>{checkedRows().map((r) => <li>{r.v}</li>)}</ul>",
  'a .js file': "import { HEIGHTS } from './accuracy.js'; x = HEIGHTS.note;",
};

test('the scanner catches every synthetic leak (the audit\'s seven, and more)', () => {
  for (const [what, src] of Object.entries(LEAKS)) {
    const ext = what.includes('.astro') ? '.astro' : what.includes('.js') ? '.js' : '.ts';
    assert.ok(scanSource(`fixture${ext}`, src).length > 0, `the scanner MISSED: ${what}`);
  }
});

test('the scanner leaves honest code alone', () => {
  const clean = [
    /* comments only MENTION a figure, in any comment style */
    "// ACCURACY.night.bandK is ±3.0 K, n=50, 'Calibrated'\nconst x = 1;",
    '/* transitionChip() and SPATIAL.rModel live in accuracy.ts */\nconst y = 2;',
    'const z = 3; // seasonalCaveatLine() says Calibrated · ±3.0 °C',
    "const claim = heatAccuracyClaim(tier);\nif (claim.kind === 'band') el.textContent = claim.figures.chip('night', false, '').html;",
    /* a neutral export, a type-only import */
    "import { isTransitionHour, TRANSITION_HOURS } from './accuracy';\nimport type { PhaseAccuracy } from './accuracy';\nimport { type SeasonalCaveat } from './accuracy';",
    /* unrelated ± and n= */
    "const bearing = '±45°'; const n=3;",
    /* a URL in a string must not open a comment */
    "const u = 'https://example.com/a'; const ok = 1;",
  ];
  for (const src of clean) assert.deepEqual(scanSource('fixture.ts', src), [], src);
  /* the stripper is string-aware: a figure after a URL on the same line is still seen */
  assert.ok(scanSource('fixture.ts', "const u = 'https://x.test'; el.textContent = 'Calibrated';").length > 0);
  /* an apostrophe in .astro prose must not hide a later leak */
  assert.ok(scanSource('fixture.astro', "<p>it's fine</p>\n<p>Calibrated</p>").length > 0);
  /* an HTML comment is a comment in .astro */
  assert.deepEqual(scanSource('fixture.astro', '<!-- Calibrated ±3.0 °C -->\n<p>ok</p>'), []);
});

/* WHERE THE FIGURES MAY LIVE. These files ARE the measurement, the gate, or pages
   about the Kolkata study itself; every other file under src goes through the claim. */
const ALLOWED = new Map([
  ['src/scripts/climate-engine/accuracy.ts', 'the measurements themselves'],
  ['src/scripts/climate-engine/v2/method-copy.ts', 'pure copy; reached only through the claim (this test bans any other importer)'],
  ['src/scripts/climate-engine/scope/accuracy-claim.ts', 'the gate, and the only caller of the two files above'],
  ['src/pages/uncertainty.astro', 'a page about the Kolkata ECOSTRESS study, city-independent by design'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|astro)$/.test(name)) out.push(p);
  }
  return out;
}

test('every accuracy figure under src is reached through heatAccuracyClaim(tier).figures', () => {
  const files = walk('src');
  assert.ok(files.length > 200, 'the walk found the source tree');
  const exts = new Set(files.map((f) => extname(f)));
  for (const e of ['.ts', '.astro']) assert.ok(exts.has(e), `the walk covers ${e}`);
  for (const f of ALLOWED.keys()) assert.ok(files.includes(f), `the allow-list names a file that exists: ${f}`);
  const offences = files.filter((f) => !ALLOWED.has(f)).flatMap((f) => scanSource(f, read(f)));
  assert.deepEqual(offences, [], 'these files print an accuracy figure without the claim');
});

test('the three live consumers branch on the claim before they touch a figure', () => {
  const app = read('src/scripts/climate-engine/heat-map-app.ts');
  assert.match(app, /heatAccuracyClaim\(resolve\(state\.ward\)\.tier\)/, 'heat-map-app reads the CURRENT ward\'s tier (a closure over the boot scope would go stale)');
  const conf = /function applyConfidence\(\)[\s\S]*?\n  \}\n/.exec(app)?.[0] ?? '';
  assert.ok(conf.includes("claim.kind === 'none'"), 'applyConfidence must branch on the claim');
  assert.ok(conf.indexOf("claim.kind === 'none'") < conf.indexOf('claim.figures'), 'the gate comes BEFORE any figure is read');
  const refresh = /function refreshStats[\s\S]*?applyConfidence\(\);/.exec(app)?.[0] ?? '';
  assert.match(refresh, /claim\.kind !== 'band'/, '#lst .band is gated on the claim, not only on dry weather');
  const methods = read('src/components/ClimateEngine/v2/MethodsCards.astro');
  assert.match(methods, /heatAccuracyClaim\(scope\.tier\)/);
  assert.match(methods, /claim\.kind === 'band'/, 'the "How sure" ledger needs the tier, not just a ward record');
  const heat = read('src/components/ClimateEngine/v2/HeatCards.astro');
  assert.match(heat, /heatAccuracyClaim\(scope\.tier\)/);
});

/* KOLKATA, BYTE FOR BYTE. The chip, the tooltips, the season note and the pattern note
   moved into the claim; these are the OLD templates spelled out from the measured records. */
test('Kolkata keeps its chip, tooltip and pattern words byte for byte', () => {
  const F = heatAccuracyClaim('validated').figures;
  const fig = (t) => `<b>${t}</b>`;
  const n = ACC.ACCURACY.night, p = ACC.ACCURACY.peak;
  assert.deepEqual(F.chip('night', false, ''), { html: `Calibrated · ${fig(`±${n.bandK.toFixed(1)} °C`)} · ${fig(`n=${n.n}`)}`, confidence: 'quantitative' });
  assert.deepEqual(F.chip('peak', false, ''), { html: `Indicative only · ${fig(`±${p.bandK.toFixed(1)} °C`)} · ${fig(`n=${p.n}`)} · ${ACC.PEAK_CHIP_BASIS}`, confidence: 'indicative' });
  assert.deepEqual(F.chip('night', true, ' · dry-season warm'), { html: `Outside validation · ${fig(`~±${ACC.TRANSITION_RMSE_K.toFixed(1)} °C`)} at this hour · dry-season warm`, confidence: 'indicative' });
  assert.equal(F.chip('night', false, ' · s').html, `Calibrated · ${fig(`±${n.bandK.toFixed(1)} °C`)} · ${fig(`n=${n.n}`)} · s`);
  assert.equal(F.chip('peak', false, ' · s').html, `Indicative only · ${fig(`±${p.bandK.toFixed(1)} °C`)} · ${fig(`n=${p.n}`)} · ${ACC.PEAK_CHIP_BASIS} · s`);
  for (const ph of ['night', 'peak']) {
    assert.equal(F.tooltip(ph, false, 'S'), `S${ACC.ACCURACY[ph].note}\n\n${ACC.SPATIAL.note}`);
    assert.equal(F.band(ph), ACC.bandLabel(ph));
  }
  assert.equal(F.tooltip('night', true, 'S'),
    'S' + 'Sunrise to mid-morning is the one window neither published figure '
    + `covers. Scored out-of-sample it reaches ${ACC.TRANSITION_RMSE_K.toFixed(2)} K — the surface is `
    + 'still releasing stored heat while the sun is already loading it, and a '
    + 'steady-state model cannot represent a system that far from equilibrium.'
    + `\n\n${ACC.SPATIAL.note}`);
  assert.deepEqual(F.pattern, { text: `Block pattern illustrative · r ${ACC.SPATIAL.rModel.toFixed(2)}`, title: ACC.SPATIAL.note });
  const s = F.season('ballygunge', 4, 'night', false);
  const c = ACC.seasonalCaveat('ballygunge', 4, 'night', false);
  assert.deepEqual(s, { line: ACC.seasonalCaveatLine(c), detail: ACC.seasonalCaveatDetail(c), chip: ` · ${c.reader.toLowerCase()} warm`, tip: `${ACC.seasonalCaveatDetail(c)}\n\n` });
  assert.equal(F.season('ballygunge', 10, 'night', false), null);
  assert.deepEqual(F.howChecked(), COPY.checkedRows());
  assert.deepEqual(F.limits('ballygunge'), COPY.caveatRows('ballygunge'));
  /* the methods ledger, as MethodsCards printed it */
  const L = F.ledger, sp = ACC.SPATIAL, h = ACC.HEIGHTS;
  assert.equal(L.night, `calibrated · ±${n.bandK.toFixed(1)} °C · n = ${n.n} · model error ${n.modelRmseK} K · ceiling ${n.ceilingRmseK} K`);
  assert.equal(L.peak, `indicative · ±${p.bandK.toFixed(1)} °C · n = ${p.n}. ${ACC.PEAK_EVIDENCE_BASIS}`);
  assert.deepEqual([L.patternR, L.patternVegR, L.patternN, L.patternNote], [sp.rModel.toFixed(2), sp.rVegOnly.toFixed(2), sp.n, sp.note]);
  assert.equal(L.heights, `${h.nBuildings} of ${h.minBuildings} buildings needed · ${h.verdict}. ${ACC.HEIGHTS_EVIDENCE_BASIS}`);
});

/* ───────────── L1: the standards record must not leak a band by publication ─────────────
   ward-record.ts and ngsi-ld.ts were allow-listed as "Kolkata only" because
   PUBLISHED_CITIES happens to be ['kolkata']. Publishing Bengaluru (wards.ts, Task 7)
   would have put Kolkata's bandK, n and rModel in /api/wards/<bengaluru>/metadata.json
   and in its NGSI-LD entity, with every test green. */
const { PUBLISHED_CITIES, WARDS } = await import('../../src/data/wards.ts');
const { wardRecord, confidenceFor, hasHeatBand } = await import('../../src/scripts/standards/ward-record.ts');
const { wardEntity, entityFromRecord } = await import('../../src/scripts/standards/ngsi-ld.ts');
const { CITY_OF } = await import('../../src/data/cities.ts');

const BAND_KEYS = /"(?:bandK|n|rModel|rVegOnly|modelRmseK|ceilingRmseK|night|peak|spatial|heights|surfaceTemperatureBand|surfaceTemperatureTier|validationSampleSize)"/;
const tierOfWard = (id) => {
  const k = AREA_KEYS.find((x) => splitKey(x).area === id && splitKey(x).city === CITY_OF[id]);
  return k ? resolve(k).tier : undefined;
};

test('L1: no published city that is not `validated` gets a band in its ward record or NGSI-LD entity', () => {
  assert.ok(Array.isArray(PUBLISHED_CITIES) && PUBLISHED_CITIES.length > 0, 'PUBLISHED_CITIES is exported and non-empty');
  for (const w of WARDS) {
    if (tierOfWard(w.id) === 'validated') continue;
    assert.equal(hasHeatBand(wardRecord(w).confidence), false, `${w.id}: the ward record carries a band on a non-validated tier`);
    assert.doesNotMatch(JSON.stringify(wardEntity(w)), BAND_KEYS, `${w.id}: the NGSI-LD entity carries a band on a non-validated tier`);
  }
});

test('L1: the same holds when the tier is the only thing that changes (what publishing Bengaluru would do)', () => {
  const kolkata = WARDS.find((w) => tierOfWard(w.id) === 'validated');
  assert.ok(kolkata, 'a validated published ward to borrow');
  const real = wardRecord(kolkata);
  assert.equal(hasHeatBand(real.confidence), true, 'a validated ward keeps its band');
  for (const tier of ['zone', 'geometry', undefined, 'unheard-of']) {
    const conf = confidenceFor(tier);
    assert.equal(hasHeatBand(conf), false, String(tier));
    assert.equal(conf.line, NOT_VALIDATED_LINE);
    assert.doesNotMatch(JSON.stringify(conf), BAND_KEYS, `${tier}: the confidence block`);
    const record = JSON.stringify({ ...real, confidence: conf });
    assert.ok(!/"(?:bandK|rModel|rVegOnly|modelRmseK|ceilingRmseK)"/.test(record), `${tier}: the record`);
    const entity = JSON.stringify(entityFromRecord(kolkata, { ...real, confidence: conf }));
    assert.doesNotMatch(entity, /surfaceTemperatureBand|surfaceTemperatureTier|validationSampleSize/, `${tier}: the NGSI-LD entity`);
  }
  /* Kolkata output is unchanged: all three properties, in the old order, before @context */
  const e = Object.keys(wardEntity(kolkata));
  assert.deepEqual(e.slice(-4), ['surfaceTemperatureBand', 'surfaceTemperatureTier', 'validationSampleSize', '@context']);
  assert.deepEqual(real.confidence, confidenceFor('validated'));
});

/* ───────────── HEIGHTS.note is a Kolkata ICESat-2 statement ─────────────
   The building-height tooltip printed "ICESat-2 could not confirm our heights..." on
   every city, Bengaluru included, which was never checked. */
test('the ICESat-2 height-validation tooltip is Kolkata\'s alone', () => {
  assert.equal(heightsNote('kolkata'), ACC.HEIGHTS.note);
  assert.match(heightsNote('kolkata'), /ICESat-2/);
  const cities = new Set(AREA_KEYS.map((k) => splitKey(k).city));
  assert.ok(cities.has('bengaluru') && cities.has('kolkata'));
  for (const c of cities) if (c !== 'kolkata') assert.equal(heightsNote(c), null, c);
  for (const c of ['', 'unknown', undefined]) assert.equal(heightsNote(c), null, String(c));
  const app = read('src/scripts/climate-engine/heat-map-app.ts');
  assert.match(app, /heightsNote\(resolve\(state\.ward\)\.city\.id\)/, 'the app asks per city');
});

/* ───────────── L2: a stale tooltip survives the transition early return ─────────────
   applyConfidence `return`s in its transition window before it writes #lst.title, so a
   tooltip set by an earlier tick (another city's "not yet validated" line, in the audit's
   B->K case) stayed on the readout. applyConfidence is a closure over the whole map, so
   the guard reads its source: every `return;` must sit in a block that also handles #lst. */
test('L2: every early return in applyConfidence leaves #lst with a tooltip that is current', () => {
  const app = read('src/scripts/climate-engine/heat-map-app.ts');
  const body = /function applyConfidence\(\)[\s\S]*?\n  \}\n/.exec(app)?.[0] ?? '';
  assert.ok(body.length > 500, 'found applyConfidence');
  const code = stripComments(body, '.ts');
  const returns = [...code.matchAll(/\breturn;/g)];
  assert.ok(returns.length >= 3, 'the none, wet and transition returns');
  for (const r of returns) {
    const before = code.slice(0, r.index);
    let depth = 0, at = before.length;
    while (at > 0) { /* walk back to the brace that opens the return's block */
      at -= 1;
      if (before[at] === '}') depth += 1;
      else if (before[at] === '{') { if (depth === 0) break; depth -= 1; }
    }
    const block = code.slice(at, r.index);
    assert.match(block, /el\('lst'\)/, `a return in applyConfidence leaves #lst untouched:\n${block.slice(-240)}`);
  }
  const transition = /if \(transition\) \{[\s\S]*?return;/.exec(code)?.[0] ?? '';
  assert.match(transition, /el\('lst'\)/, 'the transition branch touches #lst');
  assert.match(transition, /removeAttribute\('title'\)/, 'and clears its tooltip');
});
