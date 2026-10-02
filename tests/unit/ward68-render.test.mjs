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
  assert.match(OVERLAY, /float wIn=F\.a; col=mix\(mix\(col,vec3\(dot\(col,vec3\(\.299,\.587,\.114\)\)\),\$\{WARD\.veilDesat\.toFixed\(3\)\}\),col,wIn\);/);
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
  assert.match(RELIEF, /new THREE\.MeshBasicMaterial\(\{ transparent: true, depthWrite: false, side: THREE\.DoubleSide \}\)/);
  assert.doesNotMatch(RELIEF, /depthTest:\s*false/, 'an outline drawn through buildings would read as a HUD line, not ground');
  /* Ink and paper only: no new colour that could read as a heat class. */
  assert.match(RELIEF, /const ink = srgbLinear\(WARD\.ink\), paper = srgbLinear\(CLAY\.hazeCol\);/);
  assert.equal(WARD.ink.length, 7);
  assert.ok(CLAY.hazeCol.startsWith('#'));
});

test('the 2-D path veils by the same mask and draws the same outline, enrolled for style swaps', () => {
  assert.match(CORE, /if \(cells && cells\[source\] === 0\) \{/);
  assert.match(CORE, /const keep = 1 - WARD\.veilDesat, alphaOut = Math\.round\(210 \* WARD\.veilAlpha\);/);
  assert.match(APP, /\{ source: WARD_OUTLINE_SOURCE, restore: \(\) => coreField\.restoreOutline\(\) \}/);
  assert.match(APP, /coreField\.setOutlineVisible\(!showRelief\);/);
  assert.match(APP, /boundary: wardMask,/, 'the 3-D scene is not handed the boundary');
});
