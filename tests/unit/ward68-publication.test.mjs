/**
 * WHAT WE PUBLISH ABOUT KMC WARD 68 IS THE WARD, IN THE RIGHT PLACE, UNDER ITS OWN
 * LICENCE (pre-ship audit, 2026-10-03).
 *
 *   · Every published copy of the polygon — the ward record, the OGC item, the
 *     NGSI-LD `location`, the 2-D map outline — is compared VERTEX BY VERTEX against
 *     DataMeet's own ring in data/geometry/kmc-wards-around-ballygunge.geojson. A
 *     north–south mirror stays inside the square, keeps its area and its vertex count,
 *     and passed every check that existed (audit mutants N2 and N7); against the
 *     source it is hundreds of metres out.
 *   · The polygon is CC BY-SA 2.5 India, not ODbL: its licence, URI (§4(a)), credit
 *     and share-alike term ride with it wherever it is embedded.
 *   · NGSI-LD's buildingCount is the ward's, not the square's.
 *   · Figures from the evidence set measured before Ballygunge became Ward 68 say so.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WARDS } from '../../src/data/wards.ts';
import { HEIGHTS_EVIDENCE_BASIS, PEAK_EVIDENCE_BASIS } from '../../src/scripts/climate-engine/accuracy.ts';
import { wardOutlineGeoJson } from '../../src/scripts/climate-engine/explore/core-field-layer.ts';
import { wardFeature } from '../../src/scripts/standards/geojson.ts';
import { wardEntity } from '../../src/scripts/standards/ngsi-ld.ts';
import { allWardRecords, wardRecord } from '../../src/scripts/standards/ward-record.ts';

const json = async (rel) => JSON.parse(await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const MASK = await json('public/heat-map/data/ballygunge-ward.json');
const SOURCE = await json('data/geometry/kmc-wards-around-ballygunge.geojson');
const BALLYGUNGE = WARDS.find((w) => w.id === 'ballygunge');
const URI = 'https://creativecommons.org/licenses/by-sa/2.5/in/';

/** DataMeet's Ward 68 exterior ring, [lon, lat], as shipped from the source file. */
const W68 = (() => {
  const f = SOURCE.features.find((x) => x.properties.ward === 68);
  assert.ok(f, 'Ward 68 is missing from the source geojson');
  const g = f.geometry;
  return g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
})();

const M_LAT = 110_540, mLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
/** Largest distance, metres, from any published vertex to its nearest source vertex — and back. */
function hausdorffM(published) {
  const d = (p, q) => Math.hypot((p[0] - q[0]) * mLon(p[1]), (p[1] - q[1]) * M_LAT);
  const one = (from, to) => Math.max(...from.map((p) => Math.min(...to.map((q) => d(p, q)))));
  return Math.max(one(published, W68), one(W68, published));
}

test('the source ring is the one the mask artefact was built from (sanity for the comparisons below)', () => {
  assert.equal(MASK.kmcWard, 68);
  assert.ok(W68.length >= 100, `${W68.length} vertices`);
});

test('the ward record\'s published polygon IS DataMeet\'s Ward 68, not a mirror or a shift of it (N2)', () => {
  const b = wardRecord(BALLYGUNGE).boundary;
  const h = hausdorffM(b.polygon);
  assert.ok(h < 1.5, `the published polygon sits up to ${h.toFixed(1)} m from DataMeet's ring`);
});

test('the 2-D map outline IS DataMeet\'s Ward 68, not a mirror of it (N7)', () => {
  const line = wardOutlineGeoJson(BALLYGUNGE, MASK.ring).geometry.coordinates;
  const h = hausdorffM(line);
  assert.ok(h < 1.5, `the outline sits up to ${h.toFixed(1)} m from DataMeet's ring`);
});

test('the boundary carries its own CC BY-SA 2.5 IN licence, URI and credit — in the artefact, the record and the OGC item', () => {
  assert.equal(MASK.licenceUri, URI);
  const b = wardRecord(BALLYGUNGE).boundary;
  assert.equal(b.licence, 'CC BY-SA 2.5 India');
  assert.equal(b.licenceId, 'CC-BY-SA-2.5-IN');
  assert.equal(b.licenceUri, URI);
  assert.equal(b.attribution, 'DataMeet (Municipal_Spatial_Data)');
  assert.match(b.shareAlike, /^Share-alike: .*CC BY-SA 2\.5 India.*not covered by the ODbL/);
  const item = wardFeature(BALLYGUNGE);
  assert.equal(item.licence.licence, 'ODbL-1.0', 'the feature as a whole stays ODbL');
  assert.deepEqual(item.propertyLicences, { boundary: { licence: 'CC-BY-SA-2.5-IN', uri: URI, attribution: 'DataMeet (Municipal_Spatial_Data)', note: b.shareAlike } });
  assert.equal(item.properties.boundary.licenceUri, URI, 'the embedded polygon lost its licence URI');
  for (const w of WARDS.filter((x) => x.id !== 'ballygunge')) assert.equal(wardFeature(w).propertyLicences, undefined, `${w.id} claims a boundary licence`);
});

test('NGSI-LD publishes Ward 68: its polygon as location, its 2,207 buildings, the square as context only', () => {
  const e = wardEntity(BALLYGUNGE);
  assert.equal(e.buildingCount.value, 2207);
  assert.equal(e.buildingsDrawn.value, 7931);
  assert.equal(e.location.value.type, 'Polygon');
  const h = hausdorffM(e.location.value.coordinates[0]);
  assert.ok(h < 1.5, `location sits up to ${h.toFixed(1)} m from DataMeet's ring`);
  assert.deepEqual(e.computeDomain.value, wardFeature(BALLYGUNGE).geometry, 'the compute square is not the record\'s');
  assert.match(e.statisticsArea.value, /KMC Ward 68 \(0\.93 km²/);
  assert.match(e.boundaryLicence.value, /CC-BY-SA-2\.5-IN.*creativecommons\.org\/licenses\/by-sa\/2\.5\/in\/.*DataMeet \(Municipal_Spatial_Data\)/);
  /* the others: the square IS the study area, and nothing new appears */
  for (const w of WARDS.filter((x) => x.id !== 'ballygunge')) {
    const o = wardEntity(w);
    assert.equal(o.buildingCount.value, wardRecord(w).provenance.footprints.count);
    assert.deepEqual(o.location.value, wardFeature(w).geometry);
    for (const k of ['buildingsDrawn', 'computeDomain', 'statisticsArea', 'boundaryLicence']) assert.equal(o[k], undefined, `${w.id} grew ${k}`);
  }
});

test('the peak band and the heights verdict say they are the earlier, pre-Ward-68 evidence', () => {
  for (const r of allWardRecords()) {
    assert.equal(r.confidence.peak.basis, PEAK_EVIDENCE_BASIS);
    assert.equal(r.confidence.heights.basis, HEIGHTS_EVIDENCE_BASIS);
  }
  assert.match(PEAK_EVIDENCE_BASIS, /before Ballygunge became KMC Ward 68.*1\.4 km box/);
  assert.match(HEIGHTS_EVIDENCE_BASIS, /earlier 1\.4 km Ballygunge box/);
});

test('STAC states each ward\'s own surface grid, and it is the shipped PNG\'s real size', async () => {
  const { stacItem, PRODUCTS, surfaceGridN } = await import('../../src/scripts/standards/stac.ts');
  const surface = PRODUCTS.find((p) => p.id === 'surface');
  assert.doesNotMatch(surface.description, /140x140|140 × 140/, 'one grid size stated for every ward');
  for (const w of WARDS) {
    const png = await readFile(new URL(`../../public/heat-map/data/${w.id}-surface.png`, import.meta.url));
    const side = png.readUInt32BE(16);
    assert.equal(png.readUInt32BE(20), side, `${w.id}: surface PNG is not square`);
    assert.equal(surfaceGridN(w), side, `${w.id}: STAC says ${surfaceGridN(w)}, the PNG is ${side}`);
    assert.match(stacItem(w, surface).properties.description, new RegExp(`This ward: ${side} × ${side} cells`));
  }
});
