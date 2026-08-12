/**
 * Freeze the SHIPPED TypeScript canopy path as the parity contract for the Python port.
 *
 * WHY THIS EXISTS. `blendCanopyIntoVeg` now exists twice: in the browser, where it
 * decides what the map draws, and in scripts/_canopy.py, where it decides what the
 * validation scores. Two implementations of one equation drift silently -- and this
 * particular equation was already the subject of limitation #1 in
 * docs/evidence/known-limitations.md, where the render path and the validation path
 * had quietly diverged at exactly one function for months. A second divergence at
 * the same seam would be unforgivable, so it is machine-checked.
 *
 * DIRECTION MATTERS. TypeScript is the ORACLE. It is the shipped instrument; the
 * Python is the laboratory that must reproduce it. This file therefore imports the
 * real modules under src/ -- not a copy, not a re-derivation -- and records what
 * they return. Consistent with the standing rule that Python reads types.ts and
 * never the reverse.
 *
 * COVERAGE IS BY BRANCH, not by happy path. `blendCanopyIntoVeg` has four exits and
 * two clamps, and the clamps are the reason its mean-neutrality is approximate
 * rather than exact. Each is a case below, and each blend case carries diagnostics
 * (how many cells hit each clamp, how far the mean actually moved) so the checker
 * can assert the case still BITES. A clamp case that silently stops clamping would
 * otherwise keep passing while testing nothing.
 *
 * DETERMINISM. Every input is generated from integer arithmetic -- no Math.random,
 * no dates, no environment. Re-running this on any machine must produce a
 * byte-identical file, so a diff in git is a diff in the physics.
 *
 *   node --import tsx scripts/dump-canopy-oracle.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { blendCanopyIntoVeg } from '../src/scripts/climate-engine/ward-raster.ts';
import { canopyHeightsFromPixels, resample } from '../src/scripts/climate-engine/surface-raster.ts';
import { CANOPY_BLEND_STRENGTH } from '../src/scripts/climate-engine/types.ts';

const OUT_DIR = 'tests/fixtures/canopy-oracle';
const CANOPY_HI = 30;          // mirrors surface-raster.ts's private CANOPY_HI

/**
 * The strength `rasterWardBase` actually passes, IMPORTED from the shipped constant
 * rather than retyped. It travels into the fixture as `shippedStrength`, and
 * check-canopy-oracle.py fails if scripts/_canopy.py's BLEND_STRENGTH disagrees with
 * it. That is the whole mechanism keeping the two implementations' shipped value in
 * parity: one literal, in types.ts, machine-propagated to the laboratory.
 */
const SHIPPED_STRENGTH = CANOPY_BLEND_STRENGTH;

/**
 * The strength the BRANCH-COVERAGE cases below run at — deliberately NOT the shipped
 * one. The shipped value is 0 (see types.ts for the measurement that put it there),
 * and at 0 the blend is arithmetically an identity: no clamp fires, no redistribution
 * happens, and every case would pass against a port that did nothing. The oracle's job
 * is to pin the FUNCTION, which must stay correct at any strength so the decision
 * remains one constant away from reversible. 0.5 is used because it is the value the
 * measurement was taken at, and it is the value a future re-enable would start from.
 * Cases 7 and 8 additionally pin strength 1 and strength 0 explicitly.
 */
const PROBE_STRENGTH = 0.5;

/** Plain array of doubles, so JSON round-trips the float32 values exactly. */
const nums = (a) => Array.from(a, (v) => v);

/**
 * Deterministic pseudo-pattern. A prime-modulus walk, not a PRNG: the same integers
 * are reproducible in Python if anyone ever wants to regenerate the inputs there,
 * and no seed or library version can change it.
 */
const pattern = (i, mod, mul) => ((i * mul) % mod) / (mod - 1);

// ---------------------------------------------------------------- decode cases

const decodeCases = {};

/** @param {string} name @param {number} n @param {(row:number,col:number)=>number} red */
function decodeCase(name, n, red) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const p = (row * n + col) * 4;
      data[p] = red(row, col);
      // G and B are deliberately NON-zero and NON-equal to R. The browser reads the
      // R channel only; a port that averaged the channels, or read the wrong one,
      // would pass against an all-grey fixture and fail here.
      data[p + 1] = (red(row, col) + 61) % 256;
      data[p + 2] = (red(row, col) + 157) % 256;
      data[p + 3] = 255;
    }
  }
  decodeCases[name] = {
    n, hi: CANOPY_HI,
    rgba: Array.from(data),
    heights: nums(canopyHeightsFromPixels(data, n, CANOPY_HI)),
  };
}

// The 2x2 the unit test uses, so the fixture and the test agree on the flip.
decodeCase('flip-2x2', 2, (row, col) => (row === 0 && col === 0 ? 255 : row === 1 && col === 1 ? 128 : 0));
// Asymmetric under BOTH a vertical flip and a transpose: a port that flipped the
// wrong axis, or transposed instead of flipping, cannot pass this by luck.
decodeCase('flip-asymmetric-5x5', 5, (row, col) => (row * 5 + col) * 9);
// Saturation and floor, exactly.
decodeCase('extremes-3x3', 3, (row, col) => ((row * 3 + col) % 2 === 0 ? 255 : 0));

// -------------------------------------------------------------- resample cases

const resampleCases = {};

/** @param {string} name @param {number} sn @param {number} tn @param {(i:number)=>number} f */
function resampleCase(name, sn, tn, f) {
  const source = new Float32Array(sn * sn);
  for (let i = 0; i < source.length; i++) source[i] = f(i);
  resampleCases[name] = {
    sourceN: sn, targetN: tn,
    source: nums(source),
    out: nums(resample(source, sn, tn)),
  };
}

resampleCase('constant-4to8', 4, 8, () => 0.25);
resampleCase('ramp-2to3', 2, 3, (i) => i);
// The upsample ratio the browser actually uses is 140 -> 192. Reproducing it at
// full size would put 56k floats in the fixture for no extra coverage, so this
// keeps the same NON-INTEGER ratio (1.371) at a reviewable size: 8 -> 11 is 1.375,
// and a resampler that only works for integer ratios fails here.
resampleCase('noninteger-8to11', 8, 11, (i) => pattern(i, 97, 31));
// Downsample, which the browser never asks for but a residual measurement might.
resampleCase('down-9to4', 9, 4, (i) => pattern(i, 89, 17));

// ------------------------------------------------------------------ blend cases

const blendCases = {};

/**
 * Record one blend case with the diagnostics that prove which branch it exercised.
 * `clampedHigh`/`clampedLow` are counted by re-running the first pass here, in the
 * oracle's own language, so the Python checker can recompute them and compare.
 */
function blendCase(name, veg, canopy, strength, why) {
  const out = blendCanopyIntoVeg(veg, canopy, strength);
  const mean = (a) => (a.length ? Array.from(a).reduce((s, v) => s + v, 0) / a.length : 0);
  const meanIn = mean(veg);
  const meanOut = mean(out);

  // Clamp accounting. Only meaningful when the function actually ran its loops.
  let clampedHigh = 0, clampedLow = 0;
  const ran = canopy.length === veg.length && Array.from(canopy).reduce((s, v) => s + v, 0) > 0;
  if (ran) {
    const count = veg.length;
    const vSum = Array.from(veg).reduce((s, v) => s + v, 0);
    const cSum = Array.from(canopy).reduce((s, v) => s + v, 0);
    const vMean = vSum / count, cMean = cSum / count;
    const pass1 = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const raw = veg[i] + strength * (vMean * (canopy[i] / cMean) - veg[i]);
      if (raw > 1) clampedHigh++;
      if (raw < 0) clampedLow++;
      pass1[i] = Math.min(1, Math.max(0, raw));
    }
    let oSum = 0; for (let i = 0; i < count; i++) oSum += pass1[i];
    const delta = (vSum - oSum) / count;
    for (let i = 0; i < count; i++) {
      const raw = pass1[i] + delta;
      if (raw > 1) clampedHigh++;
      if (raw < 0) clampedLow++;
    }
  }

  blendCases[name] = {
    why,
    n: veg.length, strength,
    veg: nums(veg),
    canopy: nums(canopy),
    out: nums(out),
    // `returnsInput` records the reference-identity behaviour of the early exits.
    // The Python port reproduces it by returning its argument object.
    returnsInput: out === veg,
    diagnostics: { meanIn, meanOut, meanShift: meanOut - meanIn, clampedHigh, clampedLow },
  };
}

/** A field of `count` float32s from `f`. */
const field = (count, f) => { const a = new Float32Array(count); for (let i = 0; i < count; i++) a[i] = f(i); return a; };

// 1. The ordinary case: structured veg, structured canopy, nothing at a bound.
blendCase('normal-8x8',
  field(64, (i) => 0.15 + 0.5 * pattern(i, 101, 37)),
  field(64, (i) => 18 * pattern(i, 89, 23)),
  PROBE_STRENGTH,
  'happy path: both fields structured, no clamp reached');

// 2. Length mismatch -> the input comes back untouched.
blendCase('length-mismatch',
  field(16, (i) => 0.2 + 0.01 * i),
  field(9, () => 5),
  PROBE_STRENGTH,
  'canopy.length !== veg.length: early return, input unchanged');

// 3. cSum <= 0 via an all-zero canopy: the ward has a canopy raster but no canopy.
blendCase('zero-canopy',
  field(16, (i) => 0.2 + 0.01 * i),
  field(16, () => 0),
  PROBE_STRENGTH,
  'cSum === 0: early return, input unchanged');

// 4. cSum <= 0 via NEGATIVE values. Heights cannot be negative, but the guard is
//    `<= 0`, not `=== 0`, and a port that wrote `if (cSum === 0)` would pass case 3
//    and divide by a negative mean here -- inverting the whole redistribution.
blendCase('negative-sum-canopy',
  field(16, (i) => 0.2 + 0.01 * i),
  field(16, (i) => (i % 2 === 0 ? -3 : 1)),
  PROBE_STRENGTH,
  'cSum < 0: early return, input unchanged (guard is <= 0, not === 0)');

// 5. THE UPPER CLAMP, in BOTH passes. Two tall cells in sixteen make the pass-1
//    target 8x the ward mean, so those cells overshoot 1 and are clipped. The
//    clipped mass cannot be given back, so pass 2's delta is positive and pushes
//    the same cells past 1 again. The ward mean is measurably NOT preserved -- this
//    is the case that documents why the operator is only APPROXIMATELY mean-neutral,
//    and the reason neither clamp may be "simplified" out of the port.
blendCase('clamp-high-both-passes',
  field(16, () => 0.5),
  field(16, (i) => (i < 2 ? 40 : 0)),
  PROBE_STRENGTH,
  'upper [0,1] clamp fires in both passes; mean-neutrality measurably broken');

// 6. THE LOWER CLAMP, in BOTH passes. Unreachable from a real height raster (heights
//    are non-negative), but the guard upstream is `cSum <= 0`, not "all non-negative",
//    so a single negative cell inside a positive-sum field drives the target below
//    zero and clips at 0. Pass 1 clipping UPWARD makes pass 2's delta negative, which
//    pushes the clipped cell below zero again. A port that clamped only the top would
//    pass every other case here and fail this one.
blendCase('clamp-low-both-passes',
  field(16, () => 0.5),
  field(16, (i) => (i === 0 ? -30 : 10)),
  PROBE_STRENGTH,
  'lower [0,1] clamp fires in both passes; delta goes negative');

// 7. strength = 1: the nudge lands exactly on the canopy-weighted target.
blendCase('strength-1',
  field(36, (i) => 0.1 + 0.6 * pattern(i, 71, 13)),
  field(36, (i) => 3 + 20 * pattern(i, 83, 29)),
  1.0,
  'strength = 1: target reached in one step');

// 8. strength = 0: arithmetically the identity, but it still runs both loops, so it
//    catches a port that mixed up the direction of the interpolation.
blendCase('strength-0',
  field(36, (i) => 0.1 + 0.6 * pattern(i, 71, 13)),
  field(36, (i) => 3 + 20 * pattern(i, 83, 29)),
  0.0,
  'strength = 0: runs both loops and must change nothing');

// 9. A single tall cell in an otherwise bare ward -- the sparsest real canopy shape,
//    and the one where cMean is smallest and the target ratio largest.
blendCase('single-tall-cell',
  field(49, () => 0.22),
  field(49, (i) => (i === 30 ? 26 : 0)),
  PROBE_STRENGTH,
  'one tall cell: largest target ratio the shipped rasters can produce');

// -------------------------------------------------------------------- write out

mkdirSync(OUT_DIR, { recursive: true });
const oracle = {
  note: 'GENERATED from the SHIPPED TypeScript by scripts/dump-canopy-oracle.mjs. '
      + 'TypeScript is the oracle; scripts/_canopy.py must reproduce it. Regenerate only '
      + 'when the browser behaviour legitimately changes, and review the diff as a change '
      + 'to what the map draws.',
  generatedBy: 'scripts/dump-canopy-oracle.mjs',
  checkedBy: 'scripts/check-canopy-oracle.py',
  source: [
    'src/scripts/climate-engine/ward-raster.ts (blendCanopyIntoVeg)',
    'src/scripts/climate-engine/surface-raster.ts (canopyHeightsFromPixels, resample)',
  ],
  canopyHi: CANOPY_HI,
  // The PINNED shipped value, imported from types.ts. check-canopy-oracle.py asserts
  // scripts/_canopy.py's BLEND_STRENGTH equals this, so the render path and the
  // validation path cannot ship different strengths. Not the strength the cases run at.
  shippedStrength: SHIPPED_STRENGTH,
  canopyHeightsFromPixels: decodeCases,
  resample: resampleCases,
  blendCanopyIntoVeg: blendCases,
};
writeFileSync(`${OUT_DIR}/oracle.json`, `${JSON.stringify(oracle, null, 1)}\n`);

console.log(`  ${Object.keys(decodeCases).length} decode · ${Object.keys(resampleCases).length} resample`
  + ` · ${Object.keys(blendCases).length} blend cases`);
for (const [name, c] of Object.entries(blendCases)) {
  const d = c.diagnostics;
  console.log(`    ${name.padEnd(20)} meanShift ${d.meanShift.toExponential(2).padStart(10)}`
    + `  clampedHigh ${String(d.clampedHigh).padStart(3)}  clampedLow ${String(d.clampedLow).padStart(3)}`
    + `${c.returnsInput ? '  (early return)' : ''}`);
}
console.log(`\n  wrote ${OUT_DIR}/oracle.json`);
