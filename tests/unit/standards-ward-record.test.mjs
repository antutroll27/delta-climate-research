import assert from 'node:assert/strict';
import test from 'node:test';

import { WARDS } from '../../src/data/wards.ts';
import { ACCURACY, HEIGHTS, SPATIAL } from '../../src/scripts/climate-engine/accuracy.ts';
import { LICENCES, allWardRecords, utmEpsg, wardBbox, wardRecord } from '../../src/scripts/standards/ward-record.ts';

/* The bbox published on the wire must be the bbox the science ran on. These are
   scripts/_types.py:ward_bounds() outputs, captured 2026-08-18. If wards.ts moves
   a centre or _types.py changes m_per_deg, ONE of them changes and this fails —
   which is the point: the two must be changed together or not at all. */
const PY_ORACLE = {
  ballygunge:  [88.3590923461, 22.5216674507, 88.3727076539, 22.5343325493],
  baruipur:    [88.4251003228, 22.3590674507, 88.4386996772, 22.3717325493],
  barrackpore: [88.3644807323, 22.7557674507, 88.3781192677, 22.7684325493],
};

test('wardBbox reproduces scripts/_types.py:ward_bounds to 1e-9 deg', () => {
  for (const w of WARDS) {
    const got = wardBbox(w);
    const want = PY_ORACLE[w.id];
    assert.ok(want, `no oracle for ${w.id}`);
    got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${w.id}[${i}] ${v} vs ${want[i]}`));
  }
});

test('the analysis CRS derives to the zone the pipeline hardcodes for Kolkata', () => {
  for (const w of WARDS) assert.equal(utmEpsg(w.lon, w.lat), 'EPSG:32645');
  assert.equal(utmEpsg(55.25, 25.15), 'EPSG:32640', 'Dubai must derive to zone 40');
  assert.equal(utmEpsg(-46.6, -23.5), 'EPSG:32723', 'southern hemisphere takes 327xx');
});

test('every ward record carries the measured confidence, verbatim from accuracy.ts', () => {
  for (const r of allWardRecords()) {
    assert.equal(r.status, 'prototype');
    assert.equal(r.confidence.night.bandK, ACCURACY.night.bandK);
    assert.equal(r.confidence.night.n, ACCURACY.night.n);
    assert.equal(r.confidence.peak.tier, ACCURACY.peak.confidence);
    assert.equal(r.confidence.spatial.rModel, SPATIAL.rModel);
    assert.equal(r.confidence.heights.verdict, HEIGHTS.verdict);
    assert.equal(r.crs, 'EPSG:4326');
    assert.ok(!/<\/?em>/.test(r.name), 'display markup must not leak into the record');
  }
});

test('the invented Blueprint fields can never appear in a record', () => {
  const banned = ['population_exposed', 'glare_index', 'load_reduction', 'physics_data', 'kmc_ward_'];
  const json = JSON.stringify(allWardRecords());
  for (const b of banned) assert.ok(!json.includes(b), `record contains banned field "${b}"`);
});

test('every dataset in a provenance file has a licence entry, and every layer is licensed', () => {
  for (const r of allWardRecords()) {
    for (const d of r.provenance.footprints.byDataset) assert.ok(LICENCES[d.dataset], `${r.id}: "${d.dataset}" unlicensed`);
    for (const l of r.provenance.layers) {
      // `licence` was split into sourceLicence + governingLicence: one field could
      // not express "CDLA at source, ODbL as we redistribute it", and collapsing
      // them is what put a wrong licence on the published table.
      assert.ok(l.sourceLicence && l.governingLicence && l.holder && l.url,
        `${r.id}: layer "${l.layer}" missing licence fields`);
    }
    // per-dataset counts must sum to the file's count — the provenance is internally consistent
    const sum = r.provenance.footprints.byDataset.reduce((a, d) => a + d.count, 0);
    assert.equal(sum, r.provenance.footprints.count, `${r.id}: per-source counts do not sum to count`);
    // OSM is the human-traced set in every ward; that flag must survive to the wire
    const osm = r.provenance.footprints.byDataset.find((d) => d.dataset === 'OpenStreetMap');
    assert.ok(osm && osm.traced === true, `${r.id}: OSM should be flagged traced`);
  }
});

test('an unlicensed dataset is a build failure, not a silent omission', () => {
  const fake = { ...WARDS[0], id: '__nope__' };
  assert.throws(() => wardRecord(fake), /no such file|ENOENT/i, 'unknown ward has no provenance file');
});

test('every record says what it is measuring — LST, explicitly not comfort (§13.1)', () => {
  for (const r of allWardRecords()) {
    assert.match(r.quantity.measured, /land surface temperature/i);
    // the conflations that must be ruled out by name, not merely left unstated
    const ruledOut = r.quantity.isNot.join(' | ').toLowerCase();
    for (const t of ['air temperature', 'comfort']) {
      assert.ok(ruledOut.includes(t), `"${t}" must be named in quantity.isNot`);
    }
    // and the honest nuance: night tracks air temp, day does not — stating only
    // "not air temperature" would mislead in the other direction
    assert.match(r.quantity.note, /night/i);
    assert.match(r.quantity.note, /diverge|divergence/i);
  }
});

test('a completed roadmap item must name the artefact that proves it', async () => {
  const { PHASES } = await import('../../src/scripts/standards/matrix.ts');
  assert.ok(PHASES.length >= 4);
  for (const ph of PHASES) for (const i of ph.items) {
    assert.ok(['done', 'partial', 'todo'].includes(i.status), `${i.item}: bad status`);
    // the whole point: a tick with nothing behind it is marketing
    if (i.status !== 'todo') {
      assert.ok(i.evidence && i.evidence.length > 12, `"${i.item}" is ${i.status} but cites no evidence`);
    }
  }
  // Phase 1 is claimed complete on the page — that claim must stay true in the data
  const p1 = PHASES[0].items;
  assert.ok(p1.every((i) => i.status === 'done'), 'the page says Phase 1 is complete; the data must agree');
});

test('the heat-map card has no dead controls, and its record link is real', async () => {
  const { readFile } = await import('node:fs/promises');
  const stage = await readFile('src/components/ClimateEngine/HeatMapStage.astro', 'utf8');
  const app = await readFile('src/scripts/climate-engine/heat-map-app.ts', 'utf8');

  // The primary action shipped to production as <button class="cta"> with no
  // handler anywhere in src/. Any <button> carrying .cta must be wired.
  const bareCta = stage.match(/<button[^>]*class="cta"[^>]*>/g) ?? [];
  for (const b of bareCta) {
    const id = /id="([^"]+)"/.exec(b)?.[1];
    assert.ok(id && app.includes(id), `dead control: ${b} has no handler`);
  }

  // and the link that replaced it must point at an endpoint that exists
  const href = /<a[^>]*id="report-link"[^>]*href=\{([^}]+)\}/.exec(stage)?.[1];
  assert.ok(href, 'report-link must be an anchor whose href is an expression');
  assert.equal(href.trim(), 'reportHref');
  assert.match(stage, /const reportHref = `\/api\/wards\/\$\{scope\.area\.id\}\/metadata\.json`;/,
    'the record href must be built from the route\'s own area id');

  /* The record link must name the ward the instrument opened, or the first click
     downloads a different ward's record — under a filename that looks right.

     THIS USED TO BE A REGEX PINNING TWO LITERALS TO EACH OTHER: a hardcoded
     `/api/wards/ballygunge/metadata.json` in the markup, and a hardcoded
     `INITIAL_AREA` in the app. Two files holding one opinion, agreeing only because
     this assertion compared them. Task 8 gave every area its own URL, and both
     copies are gone: the route resolves a scope, the markup builds the href from
     `scope.area.id`, and the app reads the SAME scope back off `data-area`. There
     is one source now, so the agreement is structural rather than asserted — and
     what is worth watching is that it stays that way.

     Both halves are checked, because either one regressing alone rebuilds the old
     defect. A literal creeping back into the markup makes the link stop following
     the route; the app naming its own boot area again makes the instrument open
     Ballygunge on all six pages, under each page's own correct title and
     coordinate, with nothing failing anywhere. */
  /* COMMENTS STRIPPED FIRST, and the tripwire proved it needed to be: the docblock
     that replaced `INITIAL_AREA` quotes the constant it removed, so a grep over raw
     source fires on the explanation of the very fix it is checking for. A guard that
     cries wolf on its own prose gets deleted rather than heeded — obos-scope.test.mjs
     makes the same move for the same reason. */
  const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/'(in|ae)\/[a-z]+\/[a-z-]+'/.test(appCode),
    'heat-map-app.ts hardcodes an area key — the route states which area it is, and '
    + 'an instrument that names its own would open the same ward on every page');
  assert.match(app, /function bootArea\(\): AreaKey \{[\s\S]{0,400}?getAttribute\('data-area'\)/,
    'the app must read its boot area from the page');
  assert.match(app, /if \(!isAreaKey\(declared\)\) \{[\s\S]{0,80}?throw new Error\(/,
    'an unrecognised data-area must throw, not fall back — a fallback reopens the '
    + 'defect this whole check exists against, silently');
  /* WIDENED FOR A SIBLING ATTRIBUTE, NOT WEAKENED. The stage now also carries
     `data-console`, which is how shell/console-shell.ts finds a page with a rail
     and panes — Compare has one too and is not a stage. Both things this line
     actually guards are still required exactly as before: that the tag is the
     stage's own <main>, and that its area is `scope.key` rather than a literal.
     Only the assumption that nothing else could ever sit between them is gone. */
  assert.match(stage, /<main id="main" class="stage"[^>]*\sdata-area=\{scope\.key\}>/,
    'the stage must state its area for the app to read');
  assert.match(app, /const INITIAL_AREA = bootArea\(\);/);
  assert.match(app, /const state: State = \{ ward: INITIAL_AREA,/,
    'the app must boot on the area it was given, not on a second copy of the id');

  // and it must follow the selection
  assert.ok(app.includes('updateReportHref'), 'the href must be updated on ward change');
  assert.match(app, /state\.ward = name;[\s\S]{0,240}?updateCompareHref\(\); updateReportHref\(\); updateAddressBar\(\);/,
    'updateReportHref and updateAddressBar must run wherever the ward changes');
  /* Added in Task 8. Switching ward by tab does not navigate — the map and the
     caches are reused — so without this the address bar goes on naming the ward the
     page was opened at while the instrument shows another. Copying the URL then
     hands someone a different ward than the one on screen, which is the same
     wrong-record failure the record link above is guarded against, one layer up. */
  assert.match(app, /function updateAddressBar\(\) \{[\s\S]{0,300}?history\.replaceState\([\s\S]{0,80}?areaPath\(state\.ward\)/,
    'the URL must follow the open area');
  /* Added in Task 6, and it belongs beside the two above: the scope is now derived
     from the open area, so a switch that moved `state.ward` without re-resolving
     `state.climate` would run the new area's geometry through the old one's
     fallback temperature and park-cooling radius — silently, with a plausible
     number out. */
  assert.match(app, /state\.ward = name; state\.climate = resolve\(name\)\.climate;/,
    'state.climate must be re-resolved wherever the ward changes');
});
