import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Explore analytical core has no static Three.js dependency', async () => {
  const sources = await Promise.all([
    read('../../src/scripts/climate-engine/heat-map-app.ts'),
    read('../../src/scripts/climate-engine/explore/core-field-layer.ts'),
    read('../../src/scripts/climate-engine/explore/relief-contract.ts'),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /from\s+['"]three(?:\/|['"])/);
    assert.doesNotMatch(source, /import\s+\*\s+as\s+THREE/);
  }

  const [heatMapAppSource] = sources;
  // mapillary-js is ~290 KB; it and the viewer panel MUST be dynamically imported so they
  // never enter the static bundle. A static import here would defeat the lazy boundary.
  assert.doesNotMatch(heatMapAppSource, /import\s+[^\n]*from\s+['"]mapillary-js['"]/, 'mapillary-js must be dynamically imported, never static, in heat-map-app.ts');
  assert.doesNotMatch(heatMapAppSource, /import\s+[^\n]*from\s+['"]\.\/streetview\/street-view-panel['"]/, 'street-view-panel must be dynamically imported in heat-map-app.ts');
  assert.match(heatMapAppSource, /import\(['"]\.\/streetview\/street-view-panel['"]\)/, 'street-view-panel is loaded via dynamic import()');
});

test('Explore loads relief through one explicit dynamic boundary', async () => {
  const [core, relief] = await Promise.all([
    read('../../src/scripts/climate-engine/heat-map-app.ts'),
    read('../../src/scripts/climate-engine/explore/relief-renderer.ts'),
  ]);
  assert.match(core, /import\(['"]\.\/explore\/relief-renderer['"]\)/);
  assert.match(relief, /from\s+['"]three['"]/);
});
