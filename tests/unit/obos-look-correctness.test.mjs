import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';

import { makeHeatOverlay, OVERLAY_FRAG } from '../../src/scripts/climate-engine/explore/heat-overlay.ts';
import {
  CLAY, CLAY_PHONE, DARK, PHONE_QUERY, clayFor, labHookAllowed, lookAmounts,
} from '../../src/scripts/climate-engine/explore/look.ts';
import { makeContactAO } from '../../src/scripts/climate-engine/explore/look-shading.ts';
import { rasterizeWardBuilt } from '../../src/scripts/climate-engine/ward-raster.ts';

/**
 * THE EDITORIAL LOOK MUST NOT CHANGE WHAT THE MAP SAYS.
 *
 * obos-look.test.mjs holds the lines the look must never cross by construction
 * (no shadows, no bloom, the palette, the classic rollback). This file holds the
 * ones the 2026-10-03 pre-ship audit found it HAD crossed, or could cross with
 * every test still green — four mutants survived the old suite:
 *
 *   · the heat tint is never darkened by contact AO or haze (the same colour
 *     must mean the same temperature): the overlay shader's OWN statements are
 *     evaluated here, not a copy of them;
 *   · the overlay blend is premultiplied (ONE, not SRC_ALPHA);
 *   · the AO texture is in the heat field's texel convention, not mirrored;
 *   · the Clay overlay boost never reaches Dark;
 *   · a ward switch re-bakes the AO for the new ward;
 *   · "phone" is a phone-sized frame, and the ?lab=1 hook is local-only.
 *
 * Guard the guard: each evaluation is also shown the defect it was written
 * against, and must fail on it.
 */

const ENGINE_ROOT = new URL('../../src/scripts/climate-engine/', import.meta.url);

/* ────────────────────────────────────────────────────────────────────────────
   THE OVERLAY, EVALUATED.
   The fragment's scalar tail — from `float a=` to `gl_FragColor` — is turned into
   a JS function by a few literal rewrites. Anything the rewrite does not
   understand is left as GLSL and fails loudly, so a reshaped shader stops this
   test rather than slipping past it.
   ──────────────────────────────────────────────────────────────────────────── */

function overlayTail(frag) {
  const start = frag.indexOf('float a=');
  assert.ok(start >= 0, 'overlay shader: `float a=` not found -- the evaluation is stale');
  const end = frag.lastIndexOf('}');
  const tail = frag.slice(start, end).trim();
  assert.match(tail, /gl_FragColor=vec4\(/, 'overlay shader: no gl_FragColor in its tail -- the evaluation is stale');
  return tail;
}

/** Split `vec4(rgb, alpha)` at its top-level comma. */
function vec4Args(src) {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) return [src.slice(0, i), src.slice(i + 1)];
  }
  throw new Error(`overlay shader: could not split vec4(${src})`);
}

/**
 * The tail as fn({ col, uOp, uOpK, cool, edge, ao2, uAOW, uAOAmt, haze, uHaze, uHazeCol }) → [rgb, alpha],
 * one colour channel at a time (every term is a per-channel product or sum).
 */
function compileOverlay(frag) {
  const body = overlayTail(frag)
    .split(';').map((s) => s.trim()).filter(Boolean)
    .map((stmt) => {
      const out = stmt.match(/^gl_FragColor=vec4\((.*)\)$/s);
      if (out) { const [rgb, alpha] = vec4Args(out[1]); return `return [${rgb}, ${alpha}];`; }
      if (/^vec2 ao2=texture2D\(tAO, ?fuv\)\.rg$/.test(stmt)) return 'const ao2 = AO;';
      const decl = stmt.match(/^float (\w+)=(.*)$/s);
      if (decl) return `const ${decl[1]} = ${decl[2]};`;
      throw new Error(`overlay shader: unexpected statement "${stmt}" -- extend the evaluation`);
    }).join('\n');
  assert.doesNotMatch(body, /\bvec[234]\b|texture2D|gl_/, 'overlay shader: GLSL left after the rewrite');
  // eslint-disable-next-line no-new-func
  const fn = new Function('col', 'uOp', 'uOpK', 'cool', 'edge', 'AO', 'uAOW', 'uAOAmt', 'lookHaze', 'uHaze', 'uHazeCol',
    'smoothstep', 'clamp', 'min', body);
  const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  return (p) => fn(p.col, p.uOp, p.uOpK, p.cool ?? 0, p.edge ?? 1, p.ao2, p.uAOW, p.uAOAmt, () => p.haze ?? 0, p.uHaze ?? 0,
    p.uHazeCol ?? 0, smoothstep, clamp, Math.min);
}

/** What the framebuffer holds after the material's own blend factors are applied. */
function blendFactor(f, srcA) {
  if (f === THREE.OneFactor) return 1;
  if (f === THREE.ZeroFactor) return 0;
  if (f === THREE.SrcAlphaFactor) return srcA;
  if (f === THREE.OneMinusSrcAlphaFactor) return 1 - srcA;
  throw new Error(`blend factor ${f} is not modelled here`);
}
function composite(material, [rgb, srcA], dst) {
  assert.equal(material.blending, THREE.CustomBlending, 'the overlay is no longer custom-blended');
  return rgb * blendFactor(material.blendSrc, srcA) + dst * blendFactor(material.blendDst, srcA);
}

function overlayMaterial() {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  return makeHeatOverlay({
    heat: { value: tex }, heatMin: { value: 0 }, heatMax: { value: 1 }, cooling: { value: 0 },
    ao: { value: tex }, aoAmt: { value: CLAY.ao }, aoW: { value: new THREE.Vector2(CLAY.aoNear, CLAY.aoFar) },
    haze: { value: CLAY.haze }, hazeCol: { value: new THREE.Color() }, opBoost: { value: CLAY.overlayBoost },
  });
}

const PAPER = [0xef / 255, 0xeb / 255, 0xe4 / 255];
const HEAT_ON = { uOp: 0.42, uOpK: CLAY.overlayBoost };
const AO_SAMPLES = [{ r: 0, g: 0 }, { r: 1, g: 1 }, { r: 0.6, g: 0.2 }, { r: 0, g: 0.9 }];
const AO_UNIFORMS = { uAOW: { x: CLAY.aoNear, y: CLAY.aoFar }, uAOAmt: CLAY.ao, uHaze: 0.5 };

/**
 * The two rules, as numbers. Returns the failures rather than asserting, so the
 * guard-the-guard below can show them firing on the shader that shipped at cbb7acc.
 */
function overlayViolations(material, frag) {
  const run = compileOverlay(frag);
  const bad = [];
  for (const col of [0.204, 0.435, 0.69, 0.898]) {
    for (const haze of [0, 0.8]) {
      // 1. THE TINT TERM IS c·a, whatever the AO and the haze: dst = 0, hazeCol = 0.
      for (const ao2 of AO_SAMPLES) {
        const out = run({ col, ...HEAT_ON, ao2, haze, ...AO_UNIFORMS });
        const a = Math.min(0.92, HEAT_ON.uOp * HEAT_ON.uOpK);
        const tint = composite(material, out, 0);
        if (Math.abs(tint - col * a) > 1e-9) bad.push(`tint ${tint.toFixed(4)} ≠ c·a ${(col * a).toFixed(4)} (ao ${ao2.r}/${ao2.g}, haze ${haze})`);
      }
      // 2. WITH THE TINT DRAWN, THE AO CHANGES NO PIXEL — over the real paper.
      for (const dst of PAPER) {
        const ref = composite(material, run({ col, ...HEAT_ON, ao2: AO_SAMPLES[0], haze, ...AO_UNIFORMS, uHazeCol: dst }), dst);
        for (const ao2 of AO_SAMPLES.slice(1)) {
          const got = composite(material, run({ col, ...HEAT_ON, ao2, haze, ...AO_UNIFORMS, uHazeCol: dst }), dst);
          if (Math.abs(got - ref) > 1e-9) bad.push(`AO ${ao2.r}/${ao2.g} moved a tinted pixel ${ref.toFixed(4)} → ${got.toFixed(4)}`);
        }
      }
    }
  }
  return bad;
}

test('the heat tint is never darkened by contact AO or haze', () => {
  /* THE SAME COLOUR MUST MEAN THE SAME TEMPERATURE. The ramp darkens as it heats,
     so a darkened tint reads as a hotter class. The audit measured 4.7 % (peak)
     and 12.0 % (night) of top-down overlay pixels changing class at cbb7acc. */
  const material = overlayMaterial();
  assert.deepEqual(overlayViolations(material, OVERLAY_FRAG), [], 'the overlay shader lets AO or haze change the heat colour');

  // Guard the guard: the overlay as it shipped at cbb7acc (`col*a*k`) must fail both rules.
  const shipped = OVERLAY_FRAG
    .replace(/float ao=([^;]*?)\*\(1\.-smoothstep\(0\.,\.08,a\)\);/, 'float ao=$1;')
    .replace(/gl_FragColor=vec4\([^;]*\);/, 'gl_FragColor=vec4(col*a*k+uHazeCol*hz, 1.-(1.-a)*k);');
  assert.notEqual(shipped, OVERLAY_FRAG, 'could not rebuild the shipped overlay -- the guard-the-guard is stale');
  const found = overlayViolations(material, shipped);
  assert.ok(found.some((v) => v.startsWith('tint')), 'the tint rule no longer catches `col*a*k`');
  assert.ok(found.some((v) => v.startsWith('AO')), 'the pixel rule no longer catches AO under the tint');
  // …and the ground-only AO tried first (rgb = c·a, AO ungated) must fail the pixel rule.
  const groundOnly = OVERLAY_FRAG.replace(/float ao=([^;]*?)\*\(1\.-smoothstep\(0\.,\.08,a\)\);/, 'float ao=$1;');
  assert.ok(overlayViolations(material, groundOnly).some((v) => v.startsWith('AO')),
    'ground-only AO under a translucent tint passes -- the pixel rule is too weak');
});

test('with the heat surface off, the AO is still there as ground shading', () => {
  /* The other half of the rule above: the AO was moved off the tint, not deleted.
     With uOp = 0 it darkens the ground (paper → darker), and that is all it does. */
  const material = overlayMaterial();
  const run = compileOverlay(OVERLAY_FRAG);
  for (const dst of PAPER) {
    const bare = composite(material, run({ col: 0.5, uOp: 0, uOpK: 1, ao2: { r: 0, g: 0 }, ...AO_UNIFORMS, uHaze: 0 }), dst);
    const shaded = composite(material, run({ col: 0.5, uOp: 0, uOpK: 1, ao2: { r: 1, g: 1 }, ...AO_UNIFORMS, uHaze: 0 }), dst);
    assert.ok(Math.abs(bare - dst) < 1e-9, 'with no tint and no AO the ground must be untouched');
    assert.ok(shaded < dst * 0.5, `contact AO no longer shades the bare ground (${dst.toFixed(3)} → ${shaded.toFixed(3)})`);
  }
});

test('the overlay is premultiplied: ONE / ONE_MINUS_SRC_ALPHA', () => {
  /* The shader writes c·a. A SrcAlpha source factor would multiply by alpha a
     second time and fade the whole heat field toward the ground. */
  const material = overlayMaterial();
  assert.equal(material.blendSrc, THREE.OneFactor, 'blendSrc must be ONE (the shader premultiplies)');
  assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(material.blendSrcAlpha, THREE.OneFactor);
  assert.equal(material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  // And as a number: a lone tint over black must come out at exactly c·a.
  const run = compileOverlay(OVERLAY_FRAG);
  const a = Math.min(0.92, HEAT_ON.uOp * HEAT_ON.uOpK);
  assert.ok(Math.abs(composite(material, run({ col: 0.8, ...HEAT_ON, ao2: { r: 0, g: 0 }, ...AO_UNIFORMS }), 0) - 0.8 * a) < 1e-9);
  // Guard the guard: the composite model sees a SrcAlpha source.
  const wrong = Object.assign(overlayMaterial(), { blendSrc: THREE.SrcAlphaFactor });
  assert.notEqual(composite(wrong, run({ col: 0.8, ...HEAT_ON, ao2: { r: 0, g: 0 }, ...AO_UNIFORMS }), 0).toFixed(6), (0.8 * a).toFixed(6));
});

/* ────────────────────────────────────────────────────────────────────────────
   THE AO TEXTURE'S FRAME.
   ──────────────────────────────────────────────────────────────────────────── */

/** Weighted centroid (col, row) of a per-texel value. */
function centroid(n, value) {
  let sx = 0, sy = 0, s = 0;
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const v = value(row * n + col);
    sx += v * col; sy += v * row; s += v;
  }
  assert.ok(s > 0, 'nothing to take a centroid of');
  return [sx / s, sy / s];
}

test('the contact AO lands where the heat field puts the buildings, not mirrored', () => {
  /* The overlay samples the AO and the heat field at the SAME uv, so the AO must be
     baked in the field's texel convention: row 0 at the SOUTH edge, x east. The
     reference is the solver's own rasteriser (ward-raster.ts), not a convention
     typed here. One L-shaped block, well off both axes, so a flip in either
     direction moves the darkening by tens of texels. */
  const sizeM = 200, n = 50;
  const L = [15, 30, 40, 70, 40, 70, 55, 45, 55, 45, 80, 30, 80, 30, 40];
  const ward = { center: [0, 0], sizeM, count: 1, b: [L] };
  const built = rasterizeWardBuilt(ward, n);
  const tex = makeContactAO(ward.b, sizeM, n, 4);
  const px = tex.image.data;
  const [bx, by] = centroid(n, (i) => built[i]);
  const [ax, ay] = centroid(n, (i) => px[i * 4] + px[i * 4 + 1]);
  // The darkening rings the block, so its centroid sits near the block's.
  assert.ok(Math.abs(ax - bx) < 3 && Math.abs(ay - by) < 3,
    `AO centroid (${ax.toFixed(1)}, ${ay.toFixed(1)}) is not at the field's buildings (${bx.toFixed(1)}, ${by.toFixed(1)})`);
  assert.ok(by > n / 2 + 5, 'the test block must sit well north of centre for a N–S flip to show');
  // Under the block the AO is zero (the ground is hidden there), and it is the field's block.
  let inside = 0, dark = 0;
  for (let i = 0; i < n * n; i++) if (built[i] === 1) { inside++; if (px[i * 4] + px[i * 4 + 1] > 0) dark++; }
  assert.ok(inside > 20, 'the block covers too few cells to test');
  assert.equal(dark, 0, `${dark} of ${inside} cells inside the field's block carry AO -- the texture is shifted or flipped`);
  // And it is not empty: the texel right outside the block's south edge is dark.
  const southEdgeRow = Math.floor((40 + sizeM / 2) / (sizeM / n)) - 1, midCol = Math.floor((50 + sizeM / 2) / (sizeM / n));
  assert.ok(px[(southEdgeRow * n + midCol) * 4] > 50, 'no contact AO just outside the block');
});

/* ────────────────────────────────────────────────────────────────────────────
   PER-ENVIRONMENT AND PER-FRAME AMOUNTS.
   ──────────────────────────────────────────────────────────────────────────── */

test('the Clay overlay boost never reaches Dark', () => {
  /* Dark's base did not change, so Dark draws the tint at classic's opacity (× 1).
     The boost exists only to hold the tint's weight over the pale paper. */
  for (const phone of [false, true]) {
    assert.equal(lookAmounts(false, phone).overlayBoost, 1, `Dark${phone ? ' on a phone' : ''} is boosted`);
    assert.equal(lookAmounts(false, phone).ao, DARK.ao);
  }
  assert.equal(lookAmounts(true, false).overlayBoost, CLAY.overlayBoost);
  assert.equal(lookAmounts(true, true).overlayBoost, CLAY_PHONE.overlayBoost);
  assert.ok(CLAY.overlayBoost > 1 && CLAY_PHONE.overlayBoost > CLAY.overlayBoost, 'the guard needs a real boost to catch');
});

/** A ThreeReliefRenderer under node: no map, no GL — enough for ward switches and environments. */
async function nodeRenderer() {
  const any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any, set: () => true });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => any }) };
  const { ThreeReliefRenderer } = await import('../../src/scripts/climate-engine/explore/relief-renderer.ts');
  const map = { triggerRepaint() {}, getCanvas() {}, getBearing() { return 0; }, getPitch() { return 60; } };
  const r = new ThreeReliefRenderer({ map, simulationGridSize: 192, terrainGridSize: 16 });
  /* What onAdd would build, minus the WebGL renderer. */
  r.scene = new THREE.Scene();
  r.overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 15, 15), r.makeOverlay());
  r.hemi = new THREE.HemisphereLight(); r.key = new THREE.DirectionalLight(); r.rim = new THREE.DirectionalLight();
  return r;
}

const square = (x, y, s) => [12, x, y, x + s, y, x + s, y + s, x, y + s, x, y];
const bundle = (wardId, b) => ({
  wardId, wardData: { center: [88.36, 22.52], sizeM: 1400, count: b.length, b },
  roads: { ways: [] }, water: { polys: [] }, terrain: null,
  mercatorOrigin: { x: 0.7, y: 0.4, z: 0 }, frame: { east: 1e-7, north: 1e-7, up: 1e-7 }, veg: null,
});

test('the renderer applies the boost per environment', async () => {
  const r = await nodeRenderer();
  try {
    r.applyEnvironment('studio');
    assert.equal(r.opBoost.value, CLAY.overlayBoost, 'Clay lost its overlay boost');
    r.applyEnvironment('dark');
    assert.equal(r.opBoost.value, 1, 'the Clay overlay boost leaked into Dark');
    assert.equal(r.overlay.material.uniforms.uOpK, r.opBoost, 'the overlay does not read the boost holder');
  } finally { r.dispose(); }
});

test('a ward switch re-bakes the contact AO for the new ward', async () => {
  /* The AO is the footprints of ONE ward. Kept across a switch it would pool
     contact shading under the previous ward's buildings. */
  const r = await nodeRenderer();
  try {
    const A = bundle('unit-ward-a', [square(200, 200, 60)]);
    const B = bundle('unit-ward-b', [square(-400, -350, 60)]);
    r.setWard(A);
    const first = r.aoTex.value;
    r.setWard(B);
    const now = r.aoTex.value;
    assert.notEqual(now, first, 'the AO texture was not replaced on the ward switch');
    const want = makeContactAO(B.wardData.b, B.wardData.sizeM, now.image.width, CLAY.aoNearM).image.data;
    assert.ok(Buffer.from(now.image.data).equals(Buffer.from(want)), 'the AO after the switch is not the new ward\'s bake');
    // Every material reads it through the one holder, so the switch re-points them all.
    assert.equal(r.overlay.material.uniforms.tAO, r.aoTex, 'the overlay does not read the AO holder');
  } finally { r.dispose(); }
});

test('"phone" is a phone-sized frame, not a touch screen', () => {
  /* Matched by the browser, so checked here as the query a browser would read:
     both conditions are viewport sizes, so a resize or a rotation re-evaluates it. */
  assert.doesNotMatch(PHONE_QUERY.replace(/\(pointer: coarse\) and \(max-height: [\d.]+px\)/, ''), /pointer/,
    'coarse pointer alone must not make a phone');
  assert.match(PHONE_QUERY, /\(max-width: 599\.98px\)/);
  assert.match(PHONE_QUERY, /\(pointer: coarse\) and \(max-height: 599\.98px\)/);
  assert.equal(clayFor(true), CLAY_PHONE);
  for (const k of Object.keys(CLAY_PHONE)) assert.equal(clayFor(false)[k], CLAY[k], `desktop ${k} is not CLAY.${k}`);
});

test('the phone values follow the frame after load', async () => {
  /* A desktop window dragged from 500 to 1400 px used to keep the phone values
     until a reload. The renderer re-applies them on the media query's change. */
  const listeners = [];
  let matches = true;
  globalThis.matchMedia = () => ({ get matches() { return matches; }, addEventListener: (_e, fn) => listeners.push(fn), removeEventListener() {} });
  try {
    const r = await nodeRenderer();
    try {
      assert.equal(listeners.length, 1, 'the renderer does not watch the phone query');
      r.applyEnvironment('studio');
      assert.equal(r.opBoost.value, CLAY_PHONE.overlayBoost, 'a phone-sized frame did not get the phone boost');
      assert.equal(r.clayK.value.w, CLAY_PHONE.wallFloor);
      matches = false; listeners[0]({ matches: false });
      assert.equal(r.opBoost.value, CLAY.overlayBoost, 'widening the window kept the phone boost');
      assert.equal(r.clayK.value.x, CLAY.tintW); assert.equal(r.clayK.value.w, CLAY.wallFloor);
    } finally { r.dispose(); }
  } finally { delete globalThis.matchMedia; }
});

test('the ?lab=1 map hook is local-only', async () => {
  assert.equal(labHookAllowed('?lab=1', 'localhost'), true);
  assert.equal(labHookAllowed('?lab=1', '127.0.0.1'), true);
  assert.equal(labHookAllowed('?lab=1', 'deltaclimate.earth'), false, 'the map hook is exposed on production');
  assert.equal(labHookAllowed('?lab=1', 'delta-climate.vercel.app'), false);
  assert.equal(labHookAllowed('?lab=1', 'localhost.evil.example'), false);
  assert.equal(labHookAllowed('', 'localhost'), false);
  const app = await readFile(new URL('heat-map-app.ts', ENGINE_ROOT), 'utf8');
  assert.match(app, /if \(LAB_HOOK\) labWindow\.__obosMap = map;/, 'the hook is no longer gated by LAB_HOOK');
  assert.match(app, /if \(labWindow\.__obosMap === map\) delete labWindow\.__obosMap;/, 'the hook is not cleared on dispose');
});
