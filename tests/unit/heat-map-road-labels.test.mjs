import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LABEL_FONT, LABEL_SOURCE, LABEL_LAYER, REPLACED_ROAD_GEOMETRY,
  isReplacedRoadLabel, labelLayerSpec,
} from '../../src/scripts/climate-engine/road-labels.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];
const MAJOR = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
  'tertiary_link', 'trunk', 'trunk_link', 'motorway', 'motorway_link',
]);
const doc = (w) => readFile(join(ROOT, `public/heat-map/data/${w}-road-labels.geojson`), 'utf8')
  .then(JSON.parse);

test('every ward ships labels, and every feature carries a name', async () => {
  for (const w of WARDS) {
    const d = await doc(w);
    assert.equal(d.type, 'FeatureCollection');
    assert.equal(d.source, 'OpenStreetMap via Overpass (ODbL)',
      'attribution travels with the data, not only in the UI');
    assert.equal(d.count, d.features.length);
    assert.ok(d.features.length > 0, `${w} has named arterials — a zero means the fetch regressed`);
    for (const f of d.features) {
      assert.ok(f.properties?.name?.trim(), `${w}: a feature with no name would render blank`);
      assert.equal(f.geometry.type, 'LineString');
      assert.ok(f.geometry.coordinates.length >= 2);
    }
  }
});

test('ONLY major classes are labelled — the editorial decision, pinned', async () => {
  for (const w of WARDS) {
    for (const f of (await doc(w)).features) {
      assert.ok(MAJOR.has(f.properties.cls),
        `${w}: ${f.properties.name} is a ${f.properties.cls}. OSM names 97% of primary and `
        + '100% of tertiary ways here but 17% of residential and 2% of service — labelling '
        + 'the minor classes would assert that the unnamed majority have no name. If you '
        + 'want them, change MAJOR in scripts/fetch-road-labels.py deliberately.');
    }
  }
});

test('coordinates are lon/lat, not ward metres', async () => {
  // The whole point of this artefact's frame: it never enters our metre frame, so
  // it cannot inherit a frame bug and instead acts as a check on the geometry that can.
  for (const w of WARDS) {
    for (const f of (await doc(w)).features) {
      for (const [lon, lat] of f.geometry.coordinates) {
        assert.ok(lon > 87 && lon < 90, `${w}: longitude ${lon} is not Bengal — metres leaked in?`);
        assert.ok(lat > 21 && lat < 24, `${w}: latitude ${lat} is not Bengal`);
      }
    }
  }
});

test('every labelled way is near its own ward', async () => {
  const { WARD_MAP } = await import('../../src/data/wards.ts');
  for (const w of WARDS) {
    const o = WARD_MAP[w];
    for (const f of (await doc(w)).features) {
      const near = f.geometry.coordinates.some(([lon, lat]) =>
        Math.abs(lon - o.lon) < 0.012 && Math.abs(lat - o.lat) < 0.012);
      assert.ok(near, `${w}: "${f.properties.name}" lies wholly outside the ward window`);
    }
  }
});

test('the font stack is one the basemap actually serves', () => {
  // A stack the glyph endpoint lacks renders NOTHING, silently — no error, no text.
  assert.equal(LABEL_FONT, 'Noto Sans Regular');
  const spec = labelLayerSpec('dark');
  assert.deepEqual(spec.layout['text-font'], [LABEL_FONT]);
});

test('labels are upright, not lying on the exaggerated ground', () => {
  const spec = labelLayerSpec('dark');
  assert.equal(spec.layout['text-pitch-alignment'], 'viewport',
    'the ground is drawn at x4 exaggeration, so a label pinned flat would sit up to ~26 m '
    + 'from its ribbon on screen at 60 deg pitch — wider than the carriageway. Upright text '
    + 'reads as pointing AT the road; flat text would read as paint and make the offset '
    + 'look like a registration error.');
  assert.equal(spec.layout['symbol-placement'], 'line');
});

test('both environments get a legible palette', () => {
  for (const env of ['dark', 'studio']) {
    const p = labelLayerSpec(env).paint;
    assert.ok(p['text-color'], `${env} needs a text colour`);
    assert.ok(p['text-halo-color'], `${env} needs a halo, or names vanish over the massing`);
  }
  assert.notEqual(labelLayerSpec('dark').paint['text-color'],
    labelLayerSpec('studio').paint['text-color'],
    'clay studio is a light basemap — the dark palette would be invisible on it');
});

test('basemap road LABELS are matched by predicate, geometry by id', () => {
  // The ids differ between the two styles we ship, so an id list for labels is one
  // already known to be incomplete. Geometry stays enumerated because it carries a
  // per-class judgement: highway_path and the motorway layers are deliberately kept.
  assert.ok(isReplacedRoadLabel({ type: 'symbol', 'source-layer': 'transportation_name' }));
  assert.ok(isReplacedRoadLabel({ type: 'symbol', 'source-layer': 'transportation' }));
  assert.ok(!isReplacedRoadLabel({ type: 'symbol', 'source-layer': 'place' }),
    'place labels are context we do not supply and are not replacing');
  assert.ok(!isReplacedRoadLabel({ type: 'symbol', 'source-layer': 'water_name' }),
    'we draw water polygons but have no water names');
  assert.ok(!isReplacedRoadLabel({ type: 'line', 'source-layer': 'transportation' }),
    'the LINE layers are geometry — handled by the enumerated list, not this predicate');
  assert.equal(REPLACED_ROAD_GEOMETRY.length, 4);
});

test('the app wires the source, the layer and the hide', async () => {
  const app = await readFile(join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
  assert.match(app, /addSource\(LABEL_SOURCE/,
    'the label source must be added on style.load — setStyle drops every source, so a '
    + 'once-only add loses the labels on the first environment switch');
  assert.match(app, /addLayer\(labelLayerSpec\(/, 'and the layer with it');
  assert.match(app, /isReplacedRoadLabel/,
    'without the label hide, street names float over roads the basemap no longer paints');
  assert.match(app, /labelLayerSpec\(env === 'studio'/,
    'the layer must be built for the CURRENT environment, or studio gets the dark palette');
  assert.ok(LABEL_SOURCE && LABEL_LAYER, 'both ids are exported for the app to use');
});
