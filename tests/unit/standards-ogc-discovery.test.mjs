import assert from 'node:assert/strict';
import test from 'node:test';
import { readDist } from './_dist.mjs';

/* Walks the API the way QGIS or ogr2ogr would: start at the landing page, follow
   link relations only, never a hardcoded path. If this passes, the .json path
   deviation genuinely costs a client nothing — which is the entire claim being
   made on /standards. */
const read = readDist;
const follow = (doc, rel) => {
  const l = (doc.links ?? []).find((x) => x.rel === rel);
  assert.ok(l, `no link with rel="${rel}"`);
  return l;
};

test('a client can navigate landing → conformance → collections → items → feature by rel alone', () => {
  const landing = read('/api/index.json');
  // Req 2: the landing page MUST carry these three relations
  for (const rel of ['service-desc', 'conformance', 'data']) follow(landing, rel);
  assert.equal(follow(landing, 'self').href, '/api/index.json');

  const conformance = read(follow(landing, 'conformance').href);
  assert.ok(Array.isArray(conformance.conformsTo));

  const collections = read(follow(landing, 'data').href);
  assert.ok(Array.isArray(collections.collections) && collections.collections.length >= 1);

  const wards = collections.collections.find((c) => c.id === 'wards');
  assert.ok(wards, 'the wards collection must be listed');
  const meta = read(follow(wards, 'self').href);
  assert.equal(meta.id, 'wards');

  const items = read(follow(wards, 'items').href);
  assert.equal(items.type, 'FeatureCollection');
  assert.ok(items.features.length >= 3);

  // and every advertised link must actually resolve to a file that exists
  const seen = new Set();
  const crawl = (doc) => {
    for (const l of doc.links ?? []) {
      if (seen.has(l.href) || !l.href.startsWith('/api/')) continue;
      seen.add(l.href);
      crawl(read(l.href));            // read() throws if the target is missing
    }
  };
  crawl(landing);
  assert.ok(seen.size >= 4, `crawled only ${seen.size} documents`);
});

test('the conformance declaration claims nothing it cannot back', () => {
  const c = read('/api/conformance.json');
  // Core is unmet, and every other Part 1 class depends on Core — so the honest
  // list is empty. A subset claim here would be the overclaim §2.4 forbids.
  assert.deepEqual(c.conformsTo, [], 'conformsTo must stay empty until query parameters are supported');
  assert.ok(c.reason.length > 200, 'the reason must be stated, not implied');
  const params = c.unmetRequirements.map((r) => r.parameter).sort();
  assert.deepEqual(params, ['bbox', 'datetime', 'limit'], 'name the three mandatory parameters');
});

test('media types are the ones the spec expects', () => {
  const items = read('/api/collections/wards/items.json');
  assert.equal(items.type, 'FeatureCollection');
  const landing = read('/api/index.json');
  assert.equal(follow(landing, 'data').type, 'application/json');
  const wards = read('/api/collections.json').collections[0];
  assert.equal(follow(wards, 'items').type, 'application/geo+json', 'features are geo+json, not plain json');
});

test('NGSI-LD entities carry the structure the information model requires', () => {
  for (const id of ['ballygunge', 'barrackpore', 'baruipur']) {
    const e = read(`/api/ngsi-ld/entities/${id}.jsonld`);
    assert.match(e.id, /^urn:ngsi-ld:UrbanClimateWard:/, 'id must be a URN');
    assert.equal(e.type, 'UrbanClimateWard');
    assert.ok(e['@context'], 'entity must declare an @context');
    for (const [k, v] of Object.entries(e)) {
      if (k.startsWith('@') || k === 'id' || k === 'type') continue;
      assert.ok(['Property', 'Relationship', 'GeoProperty'].includes(v.type),
        `attribute ${k} has type ${v.type}`);
    }
    assert.equal(e.location.type, 'GeoProperty');
    assert.equal(e.location.value.type, 'Polygon');
    // UN/CEFACT Rec 20: kelvin is KEL. A wrong unitCode is silently wrong.
    assert.equal(e.surfaceTemperatureBand.unitCode, 'KEL');
    // the LST-vs-comfort separation must survive into the broker representation too
    assert.match(e.measuredQuantity.value, /land surface temperature/i);
    assert.ok(e.notMeasured.value.some((s) => /comfort/i.test(s)));
  }
});

test('the NGSI-LD entity does not borrow Smart Data Models Building fields we lack', () => {
  const e = read('/api/ngsi-ld/entities/ballygunge.jsonld');
  // these are real SDM Building properties; adopting the type would have invited
  // filling them in, which is the fabrication this pass exists to prevent
  for (const f of ['peopleCapacity', 'peopleOccupancy', 'occupier', 'floorsAboveGround', 'openingHours']) {
    assert.ok(!(f in e), `entity carries ${f}, which we do not measure`);
  }
});
