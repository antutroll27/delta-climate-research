import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { layoutCumulus, layoutVeil, fitLobes, cloudFuse, CLOUD }
  from '../../src/scripts/climate-engine/cloud-sprites.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFile(join(ROOT, 'src/scripts/climate-engine', p), 'utf8');
/** Comments must be stripped: these files are REQUIRED to name SimLayers in prose. */
const code = async (p) => (await src(p))
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Deterministic source so a layout can be asserted at all. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

test('no lobe reaches the sprite border, at any roundness or ovalness', () => {
  // This is the "straight edges" bug: lobes were positioned in canvas pixels and
  // overflowed, so the bitmap's own rectangle became the cloud's silhouette.
  for (const oval of [0, 0.36, 0.72, 1]) {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    for (const L of lobes) {
      const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
      assert.ok(gap >= W * 0.08,
        `oval ${oval}: a lobe sits ${gap.toFixed(1)}px from the border (need >= ${W * 0.08}). `
        + 'Overflow here is what made the clouds look like rectangles.');
    }
  }
});

test('ovalness widens the silhouette monotonically', () => {
  const aspect = (oval) => {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const L of lobes) {
      minX = Math.min(minX, L.cx - L.rx); maxX = Math.max(maxX, L.cx + L.rx);
      minY = Math.min(minY, L.cy - L.ry); maxY = Math.max(maxY, L.cy + L.ry);
    }
    return (maxX - minX) / (maxY - minY);
  };
  const a0 = aspect(0), a1 = aspect(0.72), a2 = aspect(1);
  assert.ok(a0 < a1 && a1 < a2, `aspect must increase with oval: ${a0} ${a1} ${a2}`);
  assert.ok(a1 > 3 && a1 < 4, `at the approved oval 0.72 expect ~3.4:1, got ${a1.toFixed(2)}`);
});

test('lobes are ellipses, squashed hardest at the base', () => {
  const lobes = layoutCumulus(seeded(7723117), 0.72).filter(L => L.main);
  const base = lobes.filter(L => L.cy > 0.45), crown = lobes.filter(L => L.cy < 0.2);
  const flat = (a) => a.reduce((s, L) => s + L.ry / L.rx, 0) / a.length;
  assert.ok(flat(base) < flat(crown),
    'a cumulus has a flat bottom and a domed top; base lobes must be flatter than crowns');
});

test('cover crosses from cumulus to veil, continuously', () => {
  assert.equal(cloudFuse(0), 0, 'clear sky is all cumulus');
  assert.equal(cloudFuse(1), 1, 'overcast is all veil');
  assert.equal(cloudFuse(0.42), 0, 'the crossover starts at 42% cover');
  let prev = -1;
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const f = cloudFuse(c);
    assert.ok(f >= prev - 1e-9, `fuse must not decrease: ${c} gave ${f} after ${prev}`);
    assert.ok(f >= 0 && f <= 1, `fuse out of range at ${c}: ${f}`);
    prev = f;
  }
});

test('the veil layout also stays inside its border', () => {
  const W = 768, H = Math.round(W * 0.44);
  const lobes = layoutVeil(seeded(31337));
  fitLobes(lobes, W, H, CLOUD.PAD);
  for (const L of lobes) {
    const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
    assert.ok(gap >= W * 0.08, `veil lobe ${gap.toFixed(1)}px from the border`);
  }
});

test('the approved constants are pinned', () => {
  assert.equal(CLOUD.ROUND, 0.62);
  assert.equal(CLOUD.OVAL, 0.72);
  assert.equal(CLOUD.SIZE, 0.84);
  assert.equal(CLOUD.OPACITY, 1.22);
  assert.equal(CLOUD.DECK_M, 320);
  assert.equal(CLOUD.COUNT, 26);
});

test('the cloud layer stays render-only', async () => {
  for (const f of ['cloud-sprites.ts', 'cloud-layer.ts']) {
    const t = await code(f);
    assert.doesNotMatch(t, /SimLayers/, `${f} must not reach the simulation's layers`);
    assert.doesNotMatch(t, /buildSpatial|Spatial\b/, `${f} must not reach intervention targeting`);
  }
});

test('there is exactly one cloud source, and the model already reads it', async () => {
  const model = await src('heat-map-model.ts');
  assert.match(model, /skyTemperatureC\(baseTair, rh, cloud\)/,
    'the model must still consume measured cover for T_sky — if this moved, the deck '
    + 'is no longer drawing the input the simulation uses, which is its entire claim');
  assert.match(model, /sun: 1 \* \(1 - 0\.6 \* cloud\)/,
    'cover must still cut direct sun; the layer dims the key light to match');
  for (const f of ['cloud-sprites.ts', 'cloud-layer.ts']) {
    const t = await code(f);
    assert.doesNotMatch(t, /gibs|earthdata|himawari|forecast/i,
      `${f} introduces a SECOND cloud source. The deck must draw state.live.cloud and `
      + 'nothing else, or the sky on screen is not the sky the model is using.');
  }
});

/**
 * WIDENED 2026-08-29, SAME BUG. The guard used to name `keyBase` — the per-basemap
 * base level — because writing a literal here clobbers the clay-studio environment,
 * whose key is 1.7 and not 2.1.
 *
 * `keyBase` is no longer the right factor, and the difference is the reason the sky
 * work happened: the key now also carries the SUN'S HEIGHT (`keyLevel = keyBase ×
 * the elevation factor`). Multiplying `keyBase` here would throw that away on every
 * frame the live ambient exists — which is every frame — and relight the 22:00
 * retained-heat phase with a sun that set four hours ago. So the guard now names
 * `keyLevel`, and still refuses both literals.
 */
test('the deck dims the ENVIRONMENT-AND-SUN key light, never a literal', async () => {
  const relief = await code('explore/relief-renderer.ts');
  assert.match(relief, /this\.key\.intensity = this\.keyLevel \* this\.clouds\.sunFactor/,
    'the deck must dim what the environment and the sun already agreed on');
  assert.match(relief, /this\.keyLevel = this\.keyBase \* lighting\.keyFactor/,
    'and keyLevel must be exactly that: the basemap base times the sun height');
  assert.doesNotMatch(relief, /this\.key\.intensity = (?:2\.1|1\.7) \*/,
    'the literal form is the bug this guard exists for');
  assert.doesNotMatch(relief, /this\.key\.intensity = this\.keyBase \* this\.clouds/,
    'and dimming keyBase discards the sun height, which is the newer half of it');
});

test('the deck dims at night rather than lighting cloud tops at 22:00', async () => {
  const relief = await code('explore/relief-renderer.ts');
  assert.match(relief, /this\.visual\.phase === 'night'/,
    'the phase must reach cloudLayer.update — without it the deck draws sunlit cumulus '
    + 'casting hard ground shadows at night');
  const layer = await code('cloud-layer.ts');
  assert.match(layer, /shadowLit/, 'the shadow must go to zero at night: no sun, no shadow');
});

test('a null reading draws no sky', async () => {
  const relief = await code('explore/relief-renderer.ts');
  // Tolerant of extra conditions (the deck is also gated off in 2D), but BOTH
  // cloudLayer and state.live must still be required — that is the guarantee.
  assert.match(relief, /if \(this\.clouds && [^)]*this\.visual\.live\)/,
    'an invented deck with no measurement behind it is the loader land-dust mistake');
  assert.match(relief, /this\.clouds\.group\.visible = this\.visual\.mode !== 'iso'/,
    'the deck must stay out of the 2D isotherm view: measured on an M4, it was the '
    + 'only thing keeping that page rendering (4.31 ms/frame against 0.07 ms idle) '
    + 'for clouds seen straight down over a flat isotherm');
});

test('wind direction is documented as advection-only', async () => {
  const model = await src('heat-map-model.ts');
  assert.match(model, /windFrom\?: number/, 'Ambient must carry the direction');
  assert.match(model, /wind as a scalar/,
    'the comment must state the model has no direction term, so nobody wires windFrom '
    + 'into the physics believing it already belongs there');
});

test('every per-ward layer is rebuilt with the ward, clouds included', async () => {
  /* THE DEFECT, MEASURED. `rebuildWard` tore down and rebuilt water, roads and
     vegetation, and guarded the cloud deck with `if (!this.clouds)` -- so it was
     constructed once, on the first ward, and never again. The deck closes over
     `terrainDrawAt(bundle.terrain, ...)` and calls it every frame to seat each
     shadow on the ground, so after any ward switch the shadows sat on the PREVIOUS
     ward's terrain. Between the shipped terrains that is a mean absolute error of
     10.7 m and a maximum of 35.3 m, against a total drawn relief range of about
     55 m -- an error the same size as the thing being drawn, and silent.

     DRIVEN FROM THE LAYER LIST, NOT FROM THE NAME "clouds". The fields come out of
     `dispose()`, which is the one place this class enumerates what it owns, so a
     sixth layer added tomorrow is checked the day it is added rather than the day
     someone remembers to extend a list in a test file.

     AND THE CLOSURE IS WHAT MAKES IT MATTER. A layer that did NOT read the terrain
     could be built once and reused honestly; the last assertion is what establishes
     that these all do, and therefore that a build-once guard on any of them is a
     stale-terrain bug rather than an optimisation. */
  const relief = await code('explore/relief-renderer.ts');

  /* THE FIELDS TYPED AS A `*Layer`, which is the renderer's own way of saying which
     of the things it holds are drawn layers rather than machinery. `dispose()` was
     the first candidate and it is the wrong one: it also disposes the
     THREE.WebGLRenderer, which is per-CANVAS and must survive a ward. */
  const layers = [...new Set([...relief.matchAll(/private (\w+): (\w+Layer) \| null = null;/g)]
    .map((m) => m[1]))];
  assert.ok(layers.length >= 4,
    `relief-renderer.ts declares only ${layers.length} nullable *Layer fields `
    + `(${layers.join(', ')}). The renderer owns water, clouds, roads and `
    + 'vegetation at minimum, so a number this small means the matcher has stopped '
    + 'finding them and the loop below would assert almost nothing');
  assert.ok(layers.includes('clouds'),
    'the cloud deck is no longer a nullable *Layer field, which is where this test '
    + 'learns it is a per-ward layer at all -- the defect this guard was written '
    + 'for would be invisible again');

  const rebuild = relief.match(/private rebuildWard\(bundle: ReliefWardBundle\): void \{([\s\S]*?)\n  \}/);
  assert.ok(rebuild,
    'relief-renderer.ts no longer declares `private rebuildWard(bundle: '
    + 'ReliefWardBundle): void` -- every assertion below reads its body');
  const body = rebuild[1];

  for (const field of layers) {
    assert.ok(body.includes(`this.${field}.dispose()`),
      `rebuildWard never disposes this.${field}. A layer kept across a ward switch `
      + 'holds the closure it was built with, so it goes on drawing against the '
      + 'terrain of the ward the reader has left');
    assert.match(body, new RegExp(`this\\.${field} = `),
      `rebuildWard never reassigns this.${field}, so whatever it disposed is either `
      + 'still on the scene or gone from it for good');
    assert.doesNotMatch(body, new RegExp(`if \\(!this\\.${field}\\)`),
      `rebuildWard builds this.${field} only when it does not already exist. That `
      + 'is a build-once guard, and it is exactly the shape the cloud deck shipped '
      + "with: constructed on the first ward, holding the first ward's terrain, "
      + 'never rebuilt again');
  }

  /* THE CLAIM THE THREE ABOVE REST ON. */
  const factories = [...body.matchAll(/create(\w+)Layer\(([\s\S]*?)\);/g)];
  assert.ok(factories.length >= 4,
    `rebuildWard calls only ${factories.length} layer factories -- fewer than the `
    + 'layers dispose() names, so either a layer is built somewhere else entirely '
    + 'or this matcher has stopped finding them');
  for (const [, name, args] of factories) {
    assert.match(args, /terrainDrawAt\(bundle\.terrain/,
      `create${name}Layer is built without a closure over bundle.terrain. If that `
      + 'is genuinely true it may safely outlive a ward and this test is asking too '
      + 'much of it; if it is not, the layer is about to draw against the wrong '
      + 'ground and nothing else will say so');
  }
});
