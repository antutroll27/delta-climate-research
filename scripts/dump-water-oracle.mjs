/**
 * Freeze the SHIPPED TypeScript water rasteriser as the parity contract for the Python port.
 *
 * WHY THIS EXISTS. `rasterizeWardWater` now exists twice: in the browser, where it
 * decides what the solver treats as water, and in scripts/_water.py, where it decides
 * what the validation scores. Two implementations of one operator drift silently, and
 * this repo has already paid for that once — limitation #1 in
 * docs/evidence/known-limitations.md, where the render path and the validation path
 * diverged at exactly one function for months and the tell was an accuracy number that
 * would not move. The canopy port answered it with an oracle; so does this.
 *
 * DIRECTION MATTERS. TypeScript is the ORACLE. It is the shipped instrument; the Python
 * is the laboratory that must reproduce it. This file imports the real module under
 * src/ — not a copy, not a re-derivation — and records what it returns.
 *
 * COVERAGE IS BY BRANCH, not by happy path. The operator is a point-in-polygon crossing
 * test with a collinearity early-return wrapped in a 2x2 supersample, and every one of
 * those parts has a way to be wrong that a square would not catch:
 *
 *   · the on-segment EPS decides whether a sample exactly on a shoreline is water;
 *   · the crossing test divides by `by - ay`, which is zero on horizontal edges;
 *   · concave and self-touching rings are where a parity bug first shows;
 *   · rings are OR'd, so a port that summed would exceed 1 on overlaps;
 *   · rings escaping the ±700 m frame must clamp, not wrap;
 *   · a ring with fewer than three finite vertices contributes nothing.
 *
 * AND THE SHIPPED ARTEFACTS THEMSELVES. Synthetic cases pin the arithmetic; they say
 * nothing about the 86 real rings the map actually rasterises. The `wards` section runs
 * the real `{ward}-water.json` at both grids the laboratory uses (192 for the solver,
 * 140 for the surface grid) and records row and column marginals — a fingerprint that a
 * flip, a transpose, a half-cell offset or a scale error all break, at a twentieth of
 * the size of the fields themselves. Re-fetching water legitimately changes these, and
 * that diff should be read as a change to the ward.
 *
 * DETERMINISM. Every synthetic input is an integer-derived literal — no Math.random, no
 * dates, no environment. Re-running this on any machine must produce a byte-identical
 * file, so a diff in git is a diff in the physics.
 *
 *   node --import tsx scripts/dump-water-oracle.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rasterizeWardWater } from '../src/scripts/climate-engine/ward-raster.ts';
import { CANONICAL_GRID_N, WATER_LAYER_ENABLED } from '../src/scripts/climate-engine/types.ts';

const OUT_DIR = 'tests/fixtures/water-oracle';
const DATA_DIR = 'public/heat-map/data';
const WARDS = ['ballygunge', 'baruipur', 'barrackpore'];

/** The Sentinel-2 surface grid measure-spatial-accuracy.py works at (_sentinel.GRID). */
const SURFACE_GRID = 140;

/** Plain array of doubles, so JSON round-trips the float32 values exactly. */
const nums = (a) => Array.from(a, (v) => v);

/**
 * JSON has no NaN, and `JSON.stringify` silently writes `null` for one — which would
 * turn the malformed-ring case into a case about `null`, a value the loop handles by a
 * different branch (`Number.isFinite(null)` is false, but so is `Number.isFinite(NaN)`,
 * and the two would stop being distinguishable in the fixture). Non-finite coordinates
 * are therefore written as STRINGS and named here so the checker can restore them.
 */
const NON_FINITE_ENCODING = 'non-finite coordinates are written as the strings '
  + '"NaN" / "Infinity" / "-Infinity"; JSON cannot carry them and stringify would '
  + 'silently substitute null';
const encodeNonFinite = (_key, value) =>
  (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);

// ------------------------------------------------------------------ synthetic cases

const cases = {};

/** @param {string} name @param {{k:string,p:number[]}[]|null} polys @param {number} sizeM
 *  @param {number} n @param {string} why */
function rasterCase(name, polys, sizeM, n, why) {
  const out = rasterizeWardWater(polys === null ? null : { polys }, sizeM, n);
  let wet = 0, sum = 0;
  for (const v of out) { sum += v; if (v > 0) wet++; }
  cases[name] = { why, sizeM, n, polys, out: nums(out), wet, sum };
}

// 1. The ordinary case. A 2x2 m square in the north-east quadrant of a 4 m ward on a
//    4x4 grid: four whole cells, and they must land in the SOUTH-UP rows the sim uses.
rasterCase('square-quadrant',
  [{ k: 'water', p: [0, 0, 2, 0, 2, 2, 0, 2] }], 4, 4,
  'axis-aligned square on exact cell boundaries; pins row order and full coverage');

// 2. PARTIAL COVERAGE. The whole point of a fraction rather than a mask — a body
//    smaller than a cell must produce a quarter, not a 1 and not a 0. 85% of the real
//    bodies are sub-pixel at ECOSTRESS, so this is the common case, not the edge one.
rasterCase('sub-cell-pond',
  [{ k: 'water', p: [-0.4, -0.4, 0.1, -0.4, 0.1, 0.1, -0.4, 0.1] }], 4, 4,
  'pond smaller than a cell: must yield quarters, the fraction contract');

// 3. THE SHORELINE, exactly on the subsample points. Cell column 0 samples x = -1.75
//    and -1.25; an edge at x = -1.25 is collinear with the second, and `pointOnSegment`
//    returns TRUE there. A port that used a strict crossing test alone answers 0.75
//    where the browser answers 1.
rasterCase('edge-through-subsamples',
  [{ k: 'water', p: [-2, -2, -1.25, -2, -1.25, 2, -2, 2] }], 4, 4,
  'ring edge lies exactly on subsample points; the on-segment EPS decides this');

// 4. HORIZONTAL EDGES, which make `by - ay` zero in the crossing quotient. A port that
//    divides without masking gets inf/NaN here; one that masks correctly gets the same
//    answer as a ring with no horizontal edge. Sampled at a y the edges sit on.
rasterCase('horizontal-edges-on-sample-row',
  [{ k: 'water', p: [-1.5, -0.125, 1.5, -0.125, 1.5, 0.125, -1.5, 0.125] }], 4, 8,
  'edges collinear with a sample row: exercises the zero denominator in the crossing test');

// 5. CONCAVE. A U shape: the parity test must count two crossings across the notch and
//    leave it dry. A port that used a bounding box, or a winding rule with the wrong
//    sign, fills the notch.
rasterCase('concave-u',
  [{ k: 'water', p: [-3, -3, 3, -3, 3, 3, 1, 3, 1, -1, -1, -1, -1, 3, -3, 3] }], 8, 8,
  'concave notch must stay dry; pins the crossing-parity rule');

// 6. OVERLAP. Two rings covering the same cells. Bits are OR'd, so coverage saturates
//    at 1; a port that summed fractions would report 2.
rasterCase('overlapping-rings', [
  { k: 'water', p: [-1, -1, 1, -1, 1, 1, -1, 1] },
  { k: 'pool', p: [-0.5, -0.5, 1.5, -0.5, 1.5, 1.5, -0.5, 1.5] },
], 4, 4, 'two rings over the same cells: OR, never sum');

// 7. OUT OF FRAME. fetch-water.py clips rings to ±760 m while the raster covers
//    ±sizeM/2, so real artefacts DO carry vertices past the grid. The overhang must be
//    clamped away, and a ring entirely outside must contribute nothing at all.
rasterCase('overhanging-and-outside', [
  { k: 'river', p: [-1.5, 8, 1.5, 8, 1.5, -8, -1.5, -8] },
  { k: 'water', p: [20, 20, 24, 20, 24, 24, 20, 24] },
], 4, 4, 'a ring running past the frame clamps; one wholly outside is dropped');

// 8. MALFORMED RINGS, three ways, and they do NOT all behave alike — which is the point.
//    Two vertices is dropped entirely. A NaN pair is skipped and the REMAINING three
//    vertices still rasterise. An unpaired trailing value falls outside the loop bound
//    and the ring rasterises without it. A port that dropped all three, or kept all
//    three, gets the total area wrong in opposite directions.
rasterCase('malformed-rings', [
  { k: 'water', p: [0, 0, 1, 1] },
  { k: 'water', p: [0, 0, 1, 0, Number.NaN, 1, 0, 1] },
  { k: 'water', p: [-1, -1, 1, -1, 1, 1, -1] },
], 4, 4, 'dropped below three vertices, a skipped NaN pair, and an unpaired trailing value');

// 9. NO WATER AT ALL, both spellings. `null` is a ward whose artefact failed to load;
//    an empty `polys` is a ward that genuinely has none. Both must give the all-zero
//    layer the engine shipped before this existed.
rasterCase('null-water', null, 4, 4, 'a failed fetch degrades to the zero layer');
rasterCase('empty-polys', [], 4, 4, 'a ward with no water is not an error');

// 10. A NON-DIVIDING GRID. 1400/192 is not an integer number of metres, and neither is
//     this: 7/5. A port that assumed cells land on whole metres passes everything above
//     and fails here.
rasterCase('non-integer-cells',
  [{ k: 'water', p: [-2.3, -1.1, 0.7, -1.1, 0.7, 2.4, -2.3, 2.4] }], 7, 5,
  'cell size is not a whole number of metres, as it is not at 1400/192');

// ------------------------------------------------------------------- shipped wards

const wardCases = {};
for (const ward of WARDS) {
  const water = JSON.parse(readFileSync(`${DATA_DIR}/${ward}-water.json`, 'utf8'));
  const sizeM = JSON.parse(readFileSync(`${DATA_DIR}/${ward}.json`, 'utf8')).sizeM;
  const grids = {};
  for (const n of [CANONICAL_GRID_N, SURFACE_GRID]) {
    const out = rasterizeWardWater(water, sizeM, n);
    const rowSums = new Float64Array(n), colSums = new Float64Array(n);
    let sum = 0, wet = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = out[y * n + x];
        rowSums[y] += v; colSums[x] += v; sum += v; if (v > 0) wet++;
      }
    }
    // Marginals rather than the field: a flip reverses rowSums, a transpose swaps the
    // two, an offset shifts them and a scale error rescales them — all caught, at 384
    // numbers instead of 36,864.
    grids[n] = { sum, wet, rowSums: nums(rowSums), colSums: nums(colSums) };
  }
  wardCases[ward] = { sizeM, rings: water.polys.length, grids };
}

// -------------------------------------------------------------------- write out

mkdirSync(OUT_DIR, { recursive: true });
const oracle = {
  note: 'GENERATED from the SHIPPED TypeScript by scripts/dump-water-oracle.mjs. '
      + 'TypeScript is the oracle; scripts/_water.py must reproduce it. Regenerate only '
      + 'when the browser behaviour legitimately changes — or when the water artefacts '
      + 'are re-fetched, which moves the `wards` section — and review the diff as a '
      + 'change to what the solver treats as water.',
  generatedBy: 'scripts/dump-water-oracle.mjs',
  checkedBy: 'scripts/check-water-oracle.py',
  source: ['src/scripts/climate-engine/ward-raster.ts (rasterizeWardWater)'],
  nonFiniteEncoding: NON_FINITE_ENCODING,
  // The one thing the elementwise cases cannot check: whether the layer this function
  // builds REACHES THE SOLVER. That decision lived as a bare literal in two files the
  // moment the Python port existed — `WATER_LAYER_ENABLED` here and `LAYER_ENABLED`
  // there — free to diverge silently in exactly the way known-limitations.md warns
  // about. Imported from types.ts, written here, asserted by check-water-oracle.py.
  shippedEnabled: WATER_LAYER_ENABLED,
  simGrid: CANONICAL_GRID_N,
  surfaceGrid: SURFACE_GRID,
  rasterizeWardWater: cases,
  wards: wardCases,
};
writeFileSync(`${OUT_DIR}/oracle.json`, `${JSON.stringify(oracle, encodeNonFinite, 1)}\n`);

console.log(`  ${Object.keys(cases).length} synthetic · ${WARDS.length} shipped wards`
  + `  ·  WATER_LAYER_ENABLED ${WATER_LAYER_ENABLED}`
  + `${WATER_LAYER_ENABLED ? '' : ' (rasterised and oracle-checked, NOT in the solve)'}`);
for (const [name, c] of Object.entries(cases)) {
  console.log(`    ${name.padEnd(28)} ${String(c.n).padStart(3)}²  wet ${String(c.wet).padStart(4)}`
    + `  area ${c.sum.toFixed(2)} cells`);
}
for (const [ward, c] of Object.entries(wardCases)) {
  const g = c.grids[CANONICAL_GRID_N];
  console.log(`    ${ward.padEnd(28)} ${c.rings} rings  mean fraction `
    + `${(g.sum / (CANONICAL_GRID_N ** 2)).toFixed(5)}  wet cells ${g.wet}`);
}
console.log(`\n  wrote ${OUT_DIR}/oracle.json`);
