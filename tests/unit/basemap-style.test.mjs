import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLES = join(ROOT, 'public', 'heat-map', 'styles');

/**
 * THE SHIPPED BASEMAPS, CHECKED AS ARTEFACTS.
 *
 * scripts/build-map-style.mjs throws on the same conditions, but the build only
 * runs when someone runs it: these three files are COMMITTED, they are what the
 * console actually loads, and a stale one would sail past a builder that is never
 * invoked. This reads the JSON on disk for that reason, and needs no network.
 */
async function styles() {
  const names = (await readdir(STYLES)).filter((f) => f.endsWith('.json'));
  assert.ok(names.length >= 3, `expected the OBOS basemaps in ${STYLES}, found ${names.length}`);
  return Promise.all(names.map(async (name) => ({
    name, style: JSON.parse(await readFile(join(STYLES, name), 'utf8')),
  })));
}

/**
 * A PATTERN REFERENCE IS A COLOUR THAT WILL NEVER BE DRAWN.
 *
 * `fill-color` is disabled by `fill-pattern` in the MapLibre style spec, and a
 * pattern whose image is missing from the sprite paints nothing at all — so the
 * layer disappears while the stylesheet still says what colour it is.
 *
 * That is not hypothetical. Upstream's `landcover_wood` carried
 * `fill-pattern: "wood-pattern"`, our recolour set `fill-color` beside it, and the
 * sprite these styles declare holds 264 icons and no patterns whatsoever. Every
 * woodland polygon on all three basemaps was invisible, and the three greens
 * chosen for them had never appeared on screen. The only symptom was a line in the
 * browser console, on the two green wards and nowhere else.
 */
test('no basemap layer references a pattern image, because the declared sprite has none', async () => {
  for (const { name, style } of await styles()) {
    const patterned = style.layers.flatMap((l) => Object.keys(l.paint ?? {})
      .filter((k) => k.endsWith('-pattern'))
      .map((k) => `${l.id}.${k}`));
    assert.deepEqual(patterned, [],
      `${name} references ${patterned.join(', ')}, but its sprite (${style.sprite}) ships no `
      + 'pattern images — the paint under those layers would never be drawn');
  }
});

/**
 * The woodland colour is the point of the fix above, so it is asserted directly:
 * dropping the pattern is only worth anything if a colour is left behind to draw.
 */
test('woodland still carries a colour of its own after the pattern is dropped', async () => {
  for (const { name, style } of await styles()) {
    const wood = style.layers.find((l) => l.id === 'landcover_wood');
    assert.ok(wood, `${name} has no landcover_wood layer`);
    assert.match(String(wood.paint?.['fill-color']), /^#[0-9a-f]{6}$/i,
      `${name} landcover_wood has no flat fill-color to fall back on`);
  }
});
