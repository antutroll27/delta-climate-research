import assert from 'node:assert/strict';
import test from 'node:test';
import { readDist } from './_dist.mjs';
import { existsSync, readFileSync } from 'node:fs';

import { WARDS } from '../../src/data/wards.ts';
import { PRODUCTS, stacCatalog, stacCollection, stacItem } from '../../src/scripts/standards/stac.ts';
import { datasetJsonLd, temporalCoverage } from '../../src/scripts/standards/dataset-jsonld.ts';

test('every STAC Item has an HONEST temporal extent, not a download date', () => {
  for (const w of WARDS) for (const p of PRODUCTS) {
    const i = stacItem(w, p);
    // datetime null + start/end is the correct form for a composite; a single
    // instant would be fabricated, which is the whole reason for one Item per
    // ward x PRODUCT rather than one per ward
    assert.equal(i.properties.datetime, null, `${i.id}: composites have no single instant`);
    assert.ok(i.properties.start_datetime < i.properties.end_datetime, `${i.id}: interval must run forwards`);
    assert.ok(i.properties['delta:temporal_basis'].length > 40, `${i.id}: the basis for the dates must be stated`);
  }
  // and the three products must genuinely differ — if they were equal, the
  // per-product split would be pointless and one of them would be wrong
  const starts = new Set(PRODUCTS.map((p) => p.start));
  assert.equal(starts.size, PRODUCTS.length, 'each product has its own capture period');
});

test('canopy is dated to its source imagery, not to when we downloaded it', () => {
  const canopy = PRODUCTS.find((p) => p.id === 'canopy');
  // ~80% of the Meta/WRI model's imagery is 2018-2020 (scripts/fetch-canopy.py)
  assert.match(canopy.start, /^2018/);
  assert.match(canopy.end, /^2020/);
  assert.match(canopy.why, /2018-2020/);
});

test('catalog, collection and items link to each other coherently', () => {
  const cat = stacCatalog(WARDS);
  assert.equal(cat.type, 'Catalog');
  assert.equal(cat.stac_version, '1.0.0');
  const col = stacCollection(WARDS);
  assert.equal(col.type, 'Collection');
  assert.ok(col.extent.spatial.bbox[0].length === 4);
  const itemLinks = cat.links.filter((l) => l.rel === 'item');
  assert.equal(itemLinks.length, WARDS.length * PRODUCTS.length, 'catalogue lists every item');
  for (const w of WARDS) for (const p of PRODUCTS) {
    const i = stacItem(w, p);
    assert.equal(i.collection, col.id);
    for (const rel of ['root', 'parent', 'self', 'collection']) {
      assert.ok(i.links.some((l) => l.rel === rel), `${i.id}: missing rel=${rel}`);
    }
    assert.ok(Object.keys(i.assets).length >= 1, `${i.id}: an Item with no assets is pointless`);
  }
});

test('every STAC asset href points at a file that exists', () => {
  for (const w of WARDS) for (const p of PRODUCTS) {
    for (const [name, a] of Object.entries(stacItem(w, p).assets)) {
      const local = a.href.startsWith('/heat-map/') || a.href.startsWith('/3d-tiles/')
        ? `public${a.href}` : `dist${a.href}`;
      assert.ok(existsSync(local), `${w.id}-${p.id}: asset "${name}" → ${a.href} does not exist`);
    }
  }
});

test('schema.org/Dataset distributions all resolve, and the licence is the GOVERNING one', () => {
  const d = datasetJsonLd(WARDS);
  assert.equal(d['@type'], 'Dataset');
  // ODbL, not the CC-BY of an upstream source — the distinction the attribution
  // fix turned on
  assert.match(d.license, /opendatacommons\.org\/licenses\/odbl/);
  assert.ok(d.distribution.length >= 5);
  for (const dist of d.distribution) {
    const path = dist.contentUrl.replace('https://deltaclimate.earth', '');
    const local = path.startsWith('/3d-tiles/') ? `public${path}` : `dist${path}`;
    assert.ok(existsSync(local), `distribution ${dist.name} → ${path} does not resolve`);
  }
  // temporal coverage must span every product, not just the newest
  assert.match(temporalCoverage(), /^2018-01-01\/2026-/);
  // the LST-is-not-comfort separation survives into the discovery metadata
  const lst = d.variableMeasured.find((v) => /surface temperature/i.test(v.name));
  assert.match(lst.description, /NOT air temperature/i);
});

test('the built STAC files match what the module generates', () => {
  const built = readDist('/api/stac/items/ballygunge-canopy.json');
  assert.deepEqual(built, JSON.parse(JSON.stringify(stacItem(WARDS[0], PRODUCTS.find((p) => p.id === 'canopy')))));
});

test('no display markup leaks into machine-readable titles', () => {
  // Ward.name carries <em> for the wordmark. ward-record strips it; STAC did not,
  // and shipped "Bally<em>gunge</em>" into ten documents. stac_valid cannot catch
  // this — `title` is a free string — so an audit found it instead.
  for (const w of WARDS) for (const p of PRODUCTS) {
    const i = stacItem(w, p);
    assert.ok(!/<\/?em>/.test(i.properties.title), `${i.id}: markup in title — ${i.properties.title}`);
    assert.ok(!/[<>]/.test(i.properties.title), `${i.id}: angle brackets in a machine-readable title`);
  }
  for (const l of stacCatalog(WARDS).links) {
    if (l.title) assert.ok(!/<\/?em>/.test(l.title), `catalogue link title carries markup: ${l.title}`);
  }
});
