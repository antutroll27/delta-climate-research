/**
 * How the instrument SHOWS KMC Ward 68: the outline, the veil over the context and
 * the dimmed context buildings — read off the renderer's source, since the shaders
 * run only on a GPU.
 *
 * The rule the look branch set for contact shading applies here too (audit
 * 2026-10-03, C1): drawing may change the context's value and visibility, never a
 * heat colour inside the ward. So the veil must be the identity where the mask is 1,
 * and every ward without a polygon must see a mask of 1 everywhere.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WARD, CLAY } from '../../src/scripts/climate-engine/explore/look.ts';

const read = (rel) => readFile(new URL(`../../src/scripts/climate-engine/${rel}`, import.meta.url), 'utf8');
const RELIEF = await read('explore/relief-renderer.ts');
const OVERLAY = await read('explore/heat-overlay.ts');
const CORE = await read('explore/core-field-layer.ts');
const APP = await read('heat-map-app.ts');

test('the field texture\'s alpha is the ward mask, and 1 everywhere for an area without one', () => {
  assert.match(RELIEF, /this\.heatData\[index \* 4 \+ 3\] = cells \? cells\[index\] : 1;/);
  assert.match(RELIEF, /const cells = this\.boundary && this\.boundary\.cells\.length === this\.blur\.length \? this\.boundary\.cells : null;/,
    'a mask for another grid would be read into the field');
});

test('the overlay veil desaturates and thins the context and is the identity inside the ward', () => {
  /* The overlay lives in heat-overlay.ts since the look's C1 fix; obos-look-correctness
     EVALUATES its tail with and without the veil. Here: the veil reads the mask (F.a),
     and both of its factors are exactly 1 where wIn = 1. */
  assert.match(OVERLAY, /float wIn=step\(\.5,F\.a\); col=mix\(mix\(col,vec3\(dot\(col,vec3\(\.299,\.587,\.114\)\)\),\$\{WARD\.veilDesat\.toFixed\(3\)\}\),col,wIn\);/);
  assert.match(OVERLAY, /\*edge\*\(1\.-\(1\.-wIn\)\*\$\{\(1 - WARD\.veilAlpha\)\.toFixed\(3\)\}\);/);
  assert.ok(WARD.veilDesat > 0 && WARD.veilDesat <= 0.5 && WARD.veilAlpha >= 0.4 && WARD.veilAlpha < 1, 'the veil is no longer a light one');
});

test('context buildings are dimmed by a per-building flag, and the model path is never dimmed', () => {
  assert.match(RELIEF, /geometry\.setAttribute\('aIn', new THREE\.BufferAttribute\(new Float32Array\(vertices\)\.fill\(inWard \? inWard\[row\] : 1\), 1\)\)/);
  assert.match(RELIEF, /if\(vIn<\.5\)\{body=mix\(body,vec3\(dot\(body,vec3\(\.299,\.587,\.114\)\)\),\$\{WARD\.buildingDesat/);
  assert.match(RELIEF, /vSel=uSelR>0\.\?1\.-step\(uSelR,distance\(position\.xz,uSelCtr\)\):0\.;vIn=1\.;/, 'the authored-model path reads no flag and must count as in-ward');
});

test('the outline is rebuilt per ward, depth-tested, writes no depth, and only where a boundary ships', () => {
  assert.match(RELIEF, /this\.buildOutline\(bundle\);\s*\/\* LAST, AND IT HAS TO BE LAST/);
  assert.match(RELIEF, /if \(!this\.scene \|\| !bundle\.boundary\) return;/);
  assert.match(RELIEF, /new THREE\.MeshBasicMaterial\(\{ transparent: true, depthWrite: false, depthTest, side: THREE\.DoubleSide \}\)/);
  /* Halo and core are depth-tested ground; only the see-through pass is not, and it is faint. */
  assert.match(RELIEF, /make\(WARD\.haloM \/ 2, WARD\.liftM, 1, true\);\s*make\(WARD\.lineM \/ 2, WARD\.liftM \+ 0\.05, 2, true\);/);
  assert.equal((RELIEF.match(/\bmake\([^)]*, false\);/g) ?? []).length, 1, 'more than one outline pass ignores depth');
  assert.ok(WARD.xrayAlpha > 0 && WARD.xrayAlpha <= 0.5, 'the see-through pass is no longer faint, so the outline reads as a HUD line');
  /* Ink and paper only: no new colour that could read as a heat class. */
  assert.match(RELIEF, /const ink = srgbLinear\(WARD\.ink\), paper = srgbLinear\(CLAY\.hazeCol\);/);
  assert.equal(WARD.ink.length, 7);
  assert.ok(CLAY.hazeCol.startsWith('#'));
});

test('the 2-D path veils by the same mask and draws the same outline, enrolled for style swaps', () => {
  assert.match(CORE, /if \(cells && veil && veil\[source\] === 1\) \{/);
  assert.match(CORE, /if \(cells && veilFor !== cells\) \{ veil = veilCells\(cells, n\); veilFor = cells; \}/);
  assert.match(CORE, /const keep = 1 - WARD\.veilDesat, alphaOut = Math\.round\(210 \* WARD\.veilAlpha\);/);
  assert.match(APP, /\{ source: WARD_OUTLINE_SOURCE, restore: \(\) => coreField\.restoreOutline\(\) \}/);
  assert.match(APP, /coreField\.setOutlineVisible\(!showRelief\);/);
  assert.match(APP, /boundary: wardMask,/, 'the 3-D scene is not handed the boundary');
});

/* ── the veil is HARD at the line (pre-ship audit 2026-10-03) ───────────────────
   The field texture is linear-filtered, so the mask in its alpha arrives at every
   pixel as a BILINEAR blend. Read raw, it half-veiled the ward for a cell inside the
   line (1.94 % of the ward, measured). These evaluate the shader's own `wIn`
   statement and the 2-D path's own veil, on the values a bilinear sample produces. */
test('the 3-D overlay\'s wIn is a hard step of the mask: never a fraction, 1 from the 0.5 contour in', () => {
  const stmt = OVERLAY.match(/float wIn=([^;]+);/);
  assert.ok(stmt, 'the overlay no longer declares wIn');
  const expr = stmt[1].replace(/\bF\.a\b/g, 'A');
  assert.doesNotMatch(expr, /texture2D|vec\d/, 'wIn reads something other than the mask alpha');
  // eslint-disable-next-line no-new-func
  const wIn = new Function('A', 'step', 'smoothstep', 'clamp', 'min', 'max', `return ${expr};`);
  const step = (e, x) => (x < e ? 0 : 1);
  for (let k = 0; k <= 256; k++) {
    const a = k / 256, v = wIn(a, step, () => NaN, () => NaN, Math.min, Math.max);
    assert.ok(v === 0 || v === 1, `a bilinear mask sample of ${a.toFixed(3)} gives wIn = ${v}: the veil is not hard`);
    assert.equal(v, a >= 0.5 ? 1 : 0, `sample ${a.toFixed(3)}`);
  }
});

test('the 2-D path spares the outside cells next to the ward, so its bilinear blend never reaches inside', async () => {
  const { veilCells } = await import('../../src/scripts/climate-engine/explore/core-field-layer.ts');
  const n = 9, cells = new Uint8Array(n * n);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) cells[y * n + x] = 1;
  const veil = veilCells(cells, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ring = x >= 2 && x <= 6 && y >= 2 && y <= 6;
    assert.equal(veil[y * n + x], ring ? 0 : 1, `cell ${x},${y}`);
  }
  /* any pixel whose four bilinear texels include an in-ward one sees no veiled texel */
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const four = [y * n + x, y * n + x + 1, (y + 1) * n + x, (y + 1) * n + x + 1];
    if (four.some((i) => cells[i] === 1)) assert.ok(four.every((i) => veil[i] === 0), `pixel between ${x},${y} blends a veiled texel`);
  }
});

