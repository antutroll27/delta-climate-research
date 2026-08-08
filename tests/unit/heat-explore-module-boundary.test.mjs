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
});

test('Explore loads relief through one explicit dynamic boundary', async () => {
  const [core, relief] = await Promise.all([
    read('../../src/scripts/climate-engine/heat-map-app.ts'),
    read('../../src/scripts/climate-engine/explore/relief-renderer.ts'),
  ]);
  assert.match(core, /import\(['"]\.\/explore\/relief-renderer['"]\)/);
  assert.match(relief, /from\s+['"]three['"]/);
});
