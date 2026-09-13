import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* TRANSITIVE, BECAUSE ONE HOP IS WHAT ALREADY FAILED. The grep above reads a file's own
   source, and heat-map-app.ts passes it while reaching three.js through
   vegetation-layer.ts (measured: three.core lands in the app's static chunk). This walks
   static VALUE imports only: `import type` is erased, and a dynamic import() is a
   separate chunk — exactly how relief is meant to load three. */
const ENGINE = fileURLToPath(new URL('../../src/scripts/climate-engine/', import.meta.url));

function chainToThree(file, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    const [, typeOnly, spec] = m;
    if (typeOnly) continue;
    if (/^three(?:\/|$)/.test(spec)) return [file, spec];
    if (!spec.startsWith('.')) continue;
    const base = join(dirname(file), spec);
    const next = [base, `${base}.ts`, base.replace(/\.js$/, '.ts'), join(base, 'index.ts')]
      .find((candidate) => candidate.endsWith('.ts') && existsSync(candidate));
    const rest = next ? chainToThree(next, seen) : null;
    if (rest) return [file, ...rest];
  }
  return null;
}

test('scope/paths.ts and ward-prefetch.ts reach no three.js, however deep the import', () => {
  for (const rel of ['scope/paths.ts', 'ward-prefetch.ts']) {
    const chain = chainToThree(join(ENGINE, rel));
    assert.equal(chain, null, `${rel} reaches three.js: ${chain?.map((p) => p.replace(ENGINE, '')).join(' -> ')}`);
  }
});

test('the import walker finds three.js when it is there', () => {
  /* A gate that cannot fail is not a gate. building-model.ts imports three at module
     scope, so a walker that returns null for it is broken, not reassuring. */
  assert.notEqual(chainToThree(join(ENGINE, 'explore/building-model.ts')), null);
});
