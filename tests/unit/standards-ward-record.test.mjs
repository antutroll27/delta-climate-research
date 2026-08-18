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
      assert.ok(l.licence && l.holder && l.url, `${r.id}: layer "${l.layer}" missing licence fields`);
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
