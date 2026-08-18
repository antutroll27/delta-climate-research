import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { WARDS } from '../../src/data/wards.ts';
import { LICENCE_BLOCK, ODBL_ID, ODBL_NOTICE, ODBL_URI, odblNotice } from '../../src/scripts/standards/odbl.ts';
import { buildCityJSON } from '../../src/scripts/standards/cityjson.ts';
import { wardCollection } from '../../src/scripts/standards/geojson.ts';
import { wardEntity } from '../../src/scripts/standards/ngsi-ld.ts';

test('the §4.3 notice is the exact sentence the licence prescribes', () => {
  // ODbL 4.3: "Contains information from DATABASE NAME, which is made available
  // here under the Open Database License (ODbL)." Wording is prescribed, so it
  // is generated rather than retyped — and pinned here.
  assert.equal(
    odblNotice('EXAMPLE DB'),
    'Contains information from EXAMPLE DB, which is made available here under the Open Database License (ODbL).',
  );
  assert.match(ODBL_NOTICE, /^Contains information from .+, which is made available here under the Open Database License \(ODbL\)\.$/);
  assert.equal(ODBL_ID, 'ODbL-1.0');
  assert.match(ODBL_URI, /^https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\/$/);
});

test('we adopt the STRICTER reading — Derivative Database, not Produced Work', () => {
  // the whole point: share-alike is honoured rather than argued about
  assert.match(LICENCE_BLOCK.treatedAs, /Derivative Database/);
  assert.match(LICENCE_BLOCK.shareAlike, /ODbL-1\.0/);
  assert.match(LICENCE_BLOCK.access, /machine-readable/i);          // §4.6
  assert.match(LICENCE_BLOCK.restrictions, /^none/);                 // §4.7
  assert.ok(LICENCE_BLOCK.upstream.some((u) => /OpenStreetMap contributors/.test(u)), '§4.2 upstream notices');
  assert.match(LICENCE_BLOCK.disclaimer, /not legal advice/i, 'must not read as legal advice');
});

test('EVERY export carrying building geometry ships the licence', () => {
  const w = WARDS[0];

  const cj = buildCityJSON(w);
  assert.equal(cj['+delta_lineage'].licence.licence, ODBL_ID, 'CityJSON');

  const geo = wardCollection(WARDS);
  assert.equal(geo.licence.licence, ODBL_ID, 'GeoJSON FeatureCollection');

  const e = wardEntity(w);
  assert.equal(e.dataLicence.value, ODBL_NOTICE, 'NGSI-LD entity');

  const tileset = JSON.parse(readFileSync(`public/3d-tiles/${w.id}/tileset.json`, 'utf8'));
  assert.equal(tileset.extras.licence.licence, ODBL_ID, '3D Tiles');
  // the Python builder mirrors the TS block — they must not drift apart
  assert.equal(tileset.extras.licence.notice, ODBL_NOTICE, '3D Tiles notice must match odbl.ts verbatim');
  assert.equal(tileset.extras.licence.licenceUri, ODBL_URI);
  assert.deepEqual(tileset.extras.licence.upstream.length, LICENCE_BLOCK.upstream.length);
});

test('the licence endpoint says what it does NOT cover, not just what it does', () => {
  const doc = JSON.parse(readFileSync('dist/api/licence.json', 'utf8'));
  assert.equal(doc.licence, ODBL_ID);
  assert.ok(doc.appliesTo.length >= 4);
  // over-claiming coverage would be its own kind of dishonesty: the indicators
  // and the ward record are not ODbL-derived, and the doc must say so
  const excluded = doc.notAppliesTo.map((x) => x.path);
  assert.ok(excluded.includes('/api/indicators.json'), 'indicators are not ODbL-derived');
  for (const x of doc.notAppliesTo) assert.ok(x.note.length > 25, `${x.path}: needs a reason`);
});

test('the Microsoft licence subtlety is stated, not flattened', () => {
  // CDLA-Permissive-2.0 direct from Microsoft, but ODbL when redistributed
  // inside Overture — and Kolkata comes via Overture, so ODbL governs
  const ms = LICENCE_BLOCK.upstream.find((u) => /Microsoft/.test(u));
  assert.ok(ms, 'Microsoft must appear in the upstream notices');
  assert.match(ms, /CDLA-Permissive-2\.0/);
  assert.match(ms, /redistributed under ODbL/i);
});
