import assert from 'node:assert/strict';
import test from 'node:test';

import { AMSTERDAM_SHEET_LATTICE as L } from '../../src/data/sheets/amsterdam.ts';
import { SHEETS } from '../../src/scripts/climate-engine/scope/sheets.ts';
import { SIM_D } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { ADMITTED_GRIDS, DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';
import {
  CELL_M, SHEET_HALO, assembleHaloLayers, coreStats, extractCore, haloCellSource, haloGridSpec, haloN, solveSheetWithHalo,
} from '../../src/scripts/climate-engine/streaming/halo-solve.ts';
import { AMSTERDAM_TOPOLOGY as T, DIRECTIONS, DIRECTION_STEP } from '../../src/scripts/climate-engine/streaming/sheet-topology.ts';

const N = SHEET_HALO.coreN, H = SHEET_HALO.haloCells;

test('the shipped geometry is the admitted 504-cell / 3,675 m pair, on the shared 175/24 m cell', () => {
  assert.equal(haloN(SHEET_HALO), 504);
  assert.deepEqual(haloGridSpec(), { n: 504, cellMeters: 3675 / 504 });
  assert.equal(CELL_M, 2800 / 384);
  assert.equal(3675 / 504, CELL_M);
  assert.ok(ADMITTED_GRIDS.some((g) => g.n === 504 && g.sizeM === 3675));
});

/* ── the cell definition ───────────────────────────────────────────────────────────────────────────────────────
   G9d (scripts/_sheets.py check_halo_cells) says: for sheet A and its neighbour B at (di, dj), A's halo block over B has
   rows/cols  range(n, n+h) for +1, range(-h, 0) for -1, range(n) for 0, and the matching cell of B is that index minus
   (di * n, dj * n). This is that rule written out independently of haloCellSource. */
function g9dBlock(di, dj) {
  const span = (d) => (d === 1 ? [N, N + H] : d === -1 ? [-H, 0] : [0, N]);
  const [r0, r1] = span(dj), [c0, c1] = span(di);
  return { r0, r1, c0, c1 };
}

test('haloCellSource agrees with G9d for every neighbour block, and a halo index is the core index offset by the ring', () => {
  for (const dir of DIRECTIONS) {
    const [di, dj] = DIRECTION_STEP[dir];
    const { r0, r1, c0, c1 } = g9dBlock(di, dj);
    let cells = 0;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const src = haloCellSource(SHEET_HALO, r + H, c + H);       // halo-grid index = sheet cell index + H
        assert.deepEqual(src, { dir, r: r - dj * N, c: c - di * N }, `${dir} (${r}, ${c})`);
        cells++;
      }
    }
    assert.equal(cells, (di === 0 ? N : H) * (dj === 0 ? N : H), `${dir} block size`);
  }
  assert.deepEqual(haloCellSource(SHEET_HALO, H, H), { dir: null, r: 0, c: 0 }, 'the first core cell');
  assert.deepEqual(haloCellSource(SHEET_HALO, H + N - 1, H + N - 1), { dir: null, r: N - 1, c: N - 1 });
  assert.throws(() => haloCellSource(SHEET_HALO, 504, 0), RangeError);
  assert.throws(() => haloCellSource(SHEET_HALO, -1, 0), RangeError);
  assert.throws(() => haloCellSource(SHEET_HALO, 0.5, 0), RangeError);
});

/** The lon/lat of a corner of cell (r, c) of a sheet, as `_cell_corners` computes it: rows north from the south edge. */
function corner(sheet, r, c, dx, dy) {
  const x = -2800 / 2 + (c + dx) * CELL_M, y = -2800 / 2 + (r + dy) * CELL_M;
  return [sheet.centre.lon + x / L.mPerDegLon, sheet.centre.lat + y / L.mPerDegLat];
}

test('every halo cell of every sheet is the neighbour\'s own cell, corner for corner, to 1e-9 degrees (G9d, in TypeScript)', () => {
  let checked = 0, worst = 0;
  const byCode = new Map(SHEETS.map((s) => [s.code, s]));
  for (const sheet of SHEETS) {
    for (let R = 0; R < haloN(SHEET_HALO); R++) {
      for (let C = 0; C < haloN(SHEET_HALO); C++) {
        const src = haloCellSource(SHEET_HALO, R, C);
        if (src.dir === null) continue;
        const code = T.neighbour(sheet.code, src.dir);
        if (code === null) continue;                                 // no neighbour: the edge rule, nothing to compare
        const other = byCode.get(code);
        for (const [dx, dy] of [[0, 0], [1, 1]]) {
          const [lonA, latA] = corner(sheet, R - H, C - H, dx, dy);   // the halo cell, in A's own frame
          const [lonB, latB] = corner(other, src.r, src.c, dx, dy);   // the neighbour's cell it names
          worst = Math.max(worst, Math.abs(lonA - lonB), Math.abs(latA - latB));
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 1_000_000, `only ${checked} cells compared`);
  assert.ok(worst <= 1e-9, `worst corner difference ${worst} degrees`);
});

// ── assembly ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Layers whose every cell encodes where it came from: tag * 1e5 + r * 400 + c (exact in float32). */
function tagged(tag, n = N) {
  const mk = (k) => Float32Array.from({ length: n * n }, (_, i) => tag * 1e5 + Math.floor(i / n) * 400 + (i % n) + k * 0.25);
  return { albedo: mk(0), veg: mk(1), built: mk(2), water: mk(3) };
}
const TAG = { core: 0, ...Object.fromEntries(DIRECTIONS.map((d, i) => [d, i + 1])) };

test('assembly lays the core in the middle and each neighbour into its block, in all four layers', () => {
  const nb = Object.fromEntries(DIRECTIONS.map((d) => [d, tagged(TAG[d])]));
  const { layers, missing } = assembleHaloLayers(SHEET_HALO, tagged(TAG.core), nb);
  assert.deepEqual(missing, []);
  const n = haloN(SHEET_HALO);
  for (const [k, offset] of [['albedo', 0], ['veg', 0.25], ['built', 0.5], ['water', 0.75]]) {
    assert.equal(layers[k].length, n * n);
    for (let R = 0; R < n; R += 3) {
      for (let C = 0; C < n; C += 3) {
        const s = haloCellSource(SHEET_HALO, R, C);
        assert.equal(layers[k][R * n + C], TAG[s.dir ?? 'core'] * 1e5 + s.r * 400 + s.c + offset, `${k} (${R}, ${C})`);
      }
    }
  }
  assert.equal(layers.albedo[H * n + H], 0, 'the south-west core cell is core (0, 0)');
  assert.equal(layers.albedo[0], TAG.sw * 1e5 + (N - H) * 400 + (N - H), 'the halo corner is the SW neighbour\'s (N-H, N-H)');
  assert.equal(layers.albedo[n * n - 1], TAG.ne * 1e5 + (H - 1) * 400 + (H - 1), 'and the NE corner is the NE neighbour\'s (H-1, H-1)');
});

test('with no neighbours the edge rule replicates this sheet\'s own nearest core cell outward, and says so', () => {
  const core = tagged(TAG.core);
  const { layers, missing } = assembleHaloLayers(SHEET_HALO, core, {});
  assert.deepEqual(missing, [...DIRECTIONS]);
  const n = haloN(SHEET_HALO);
  const at = (r, c) => core.albedo[Math.min(N - 1, Math.max(0, r)) * N + Math.min(N - 1, Math.max(0, c))];
  for (let R = 0; R < n; R += 5) for (let C = 0; C < n; C += 5) assert.equal(layers.albedo[R * n + C], at(R - H, C - H));
  assert.equal(layers.albedo[0], core.albedo[0], 'the SW corner is core (0, 0)');
  assert.equal(layers.albedo[(n - 1) * n + (n - 1)], core.albedo[N * N - 1]);
});

test('a missing neighbour uses the edge rule on its own block only; the others stay real', () => {
  const core = tagged(TAG.core);
  const nb = { e: tagged(TAG.e), n: tagged(TAG.n) };                // no ne: the corner between them has nothing
  const { layers, missing } = assembleHaloLayers(SHEET_HALO, core, nb);
  assert.deepEqual(missing, ['nw', 'ne', 'w', 'sw', 's', 'se']);
  const n = haloN(SHEET_HALO);
  assert.equal(layers.albedo[(H + 10) * n + (H + N + 5)], TAG.e * 1e5 + 10 * 400 + 5, 'east block is the east neighbour');
  assert.equal(layers.albedo[(H + N + 5) * n + (H + 10)], TAG.n * 1e5 + 5 * 400 + 10, 'north block is the north neighbour');
  assert.equal(layers.albedo[(H + N + 5) * n + (H + N + 5)], core.albedo[(N - 1) * N + (N - 1)], 'the NE corner replicates core (N-1, N-1), not either neighbour');
});

test('assembly copies, refuses wrong-sized layers, and leaves its inputs alone', () => {
  const core = tagged(TAG.core), before = core.albedo.slice();
  const out = assembleHaloLayers(SHEET_HALO, core, {}).layers;
  out.albedo[0] = -1; out.albedo[H * haloN(SHEET_HALO) + H] = -1;
  assert.deepEqual(core.albedo, before);
  assert.throws(() => assembleHaloLayers(SHEET_HALO, tagged(0, 100), {}), RangeError);
  assert.throws(() => assembleHaloLayers(SHEET_HALO, core, { e: tagged(1, 100) }), /neighbour e/);
});

// ── core-only statistics ───────────────────────────────────────────────────────────────────────────────────

test('extractCore returns exactly the core window; coreStats never sees a ring cell', () => {
  const n = haloN(SHEET_HALO);
  const field = new Float32Array(n * n).fill(30);
  for (let R = 0; R < n; R++) for (let C = 0; C < n; C++) {
    const inCore = R >= H && R < H + N && C >= H && C < H + N;
    if (!inCore) field[R * n + C] = 1000;                            // poison every ring cell
  }
  field[(H + 5) * n + (H + 7)] = 45;                                 // one hot core cell
  const stats = coreStats(SHEET_HALO, field, 40);
  assert.equal(stats.peakC, 45);
  assert.equal(stats.fracAbove, 1 / (N * N));
  assert.ok(Math.abs(stats.meanC - (30 + 15 / (N * N))) < 1e-4);
  const core = extractCore(SHEET_HALO, field);
  assert.equal(core.length, N * N);
  assert.ok(core.every((v) => v <= 45));
  assert.equal(core[5 * N + 7], 45);

  /* what the whole-field stats WOULD say, to show the rule matters */
  let sum = 0; for (const v of field) sum += v;
  assert.ok(sum / field.length > 100, 'counting the ring would make this sheet read hundreds of degrees hot');
  assert.throws(() => coreStats(SHEET_HALO, new Float32Array(10)), RangeError);
});

test('coreStats equals TsHeatSim.stats on the core alone (same definitions)', () => {
  const g = { coreN: 24, haloCells: 6 };
  const rand = (() => { let s = 7; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); })();
  const n = haloN(g);
  const field = Float32Array.from({ length: n * n }, () => 20 + rand() * 30);
  const core = extractCore(g, field);
  const sim = new TsHeatSim();
  const layers = { albedo: new Float32Array(24 * 24), veg: new Float32Array(24 * 24), built: new Float32Array(24 * 24), water: new Float32Array(24 * 24) };
  sim.reset({ n: 24, cellMeters: CELL_M }, layers, DEFAULT_PARAMS);
  sim.temperature().set(core);
  const want = sim.stats(40), got = coreStats(g, field, 40);
  assert.ok(Math.abs(got.meanC - want.meanC) < 1e-9);
  assert.equal(got.peakC, want.peakC);
  assert.equal(got.fracAbove, want.fracAbove);
});

// ── the physics: a tiled solve with a halo is the contiguous solve ─────────────────────────────────────────

/** A 3 x 3 world of 96-cell sheets with block structure (built 0/0.8, vegetation, albedo), so it has hard edges across every seam. */
function world(coreN) {
  const n = coreN * 3;
  let s = 99;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const BLOCK = 12, blocks = Math.ceil(n / BLOCK);
  const built = Float32Array.from({ length: blocks * blocks }, () => (rand() < 0.5 ? 0.8 : 0));
  const veg = Float32Array.from({ length: blocks * blocks }, () => (rand() < 0.35 ? 0.6 : 0));
  const alb = Float32Array.from({ length: blocks * blocks }, () => 0.1 + rand() * 0.25);
  const layer = (src) => Float32Array.from({ length: n * n }, (_, i) => src[Math.floor(Math.floor(i / n) / BLOCK) * blocks + Math.floor((i % n) / BLOCK)]);
  return { n, layers: { albedo: layer(alb), veg: layer(veg), built: layer(built), water: new Float32Array(n * n) } };
}

function slice(world, coreN, si, sj) {                              // sheet (si, sj) of the 3x3 world, row 0 = south
  const out = {};
  for (const k of ['albedo', 'veg', 'built', 'water']) {
    out[k] = new Float32Array(coreN * coreN);
    for (let r = 0; r < coreN; r++) for (let c = 0; c < coreN; c++) out[k][r * coreN + c] = world.layers[k][(sj * coreN + r) * world.n + si * coreN + c];
  }
  return out;
}

test('a sheet solved on its 60-cell halo matches the contiguous solve to well under 0.05 K; a hard cut does not', () => {
  const coreN = 96;
  const w = world(coreN);
  /* the production diffusion (SIM_D) at the production calm floor, wind 0.3: lambda = sqrt(D / (kRad + h wind)) = 10 cells,
     the worst case the halo has to cover (halo-wind-floor.test.mjs). With the default D = 0.15 lambda is 2.4 cells and
     any halo passes by exactly nothing, which proves nothing. */
  const params = { ...DEFAULT_PARAMS, D: SIM_D, wind: 0.3 };
  const STEPS = 3000;

  const whole = new TsHeatSim();
  whole.reset({ n: w.n, cellMeters: CELL_M }, w.layers, params);
  whole.step(1, STEPS);
  const truth = whole.temperature();
  const wantCore = new Float32Array(coreN * coreN);
  for (let r = 0; r < coreN; r++) for (let c = 0; c < coreN; c++) wantCore[r * coreN + c] = truth[(coreN + r) * w.n + coreN + c];

  const neighbours = {};
  for (const dir of DIRECTIONS) { const [di, dj] = DIRECTION_STEP[dir]; neighbours[dir] = slice(w, coreN, 1 + di, 1 + dj); }
  const core = slice(w, coreN, 1, 1);

  const maxDiff = (got) => { let m = 0; for (let i = 0; i < got.length; i++) m = Math.max(m, Math.abs(got[i] - wantCore[i])); return m; };

  const withHalo = solveSheetWithHalo(new TsHeatSim(), params, { coreN, haloCells: 60 }, core, neighbours, STEPS, 1);
  assert.deepEqual(withHalo.missing, []);
  const haloErr = maxDiff(withHalo.core);

  const hard = solveSheetWithHalo(new TsHeatSim(), params, { coreN, haloCells: 0 }, core, {}, STEPS, 1);
  const hardErr = maxDiff(hard.core);

  /* P0 measured 0.0103 K at 60 cells and 0.217 K at 24 on real Canal Ring layers; this world agrees, which also shows the
     test can tell a short halo from a long one */
  const shortHalo = solveSheetWithHalo(new TsHeatSim(), params, { coreN, haloCells: 24 }, core, neighbours, STEPS, 1);
  assert.ok(maxDiff(shortHalo.core) > 0.05, `a 24-cell halo should fail the 0.05 K mark, got ${maxDiff(shortHalo.core)} K`);
  assert.ok(haloErr < 0.05, `halo error ${haloErr} K`);
  assert.ok(hardErr > 0.3, `a hard cut should disagree visibly, got ${hardErr} K`);
  assert.ok(hardErr > 20 * haloErr, `the halo removes the seam: ${hardErr} K -> ${haloErr} K`);

  /* core-only stats of the halo solve equal the stats of the contiguous solve's same window (not the sim's whole-grid stats) */
  const truthStats = coreStats({ coreN, haloCells: 0 }, wantCore, 40);
  assert.ok(Math.abs(withHalo.stats.meanC - truthStats.meanC) < 0.05);
  assert.ok(Math.abs(withHalo.stats.peakC - truthStats.peakC) < 0.05);
  assert.equal(withHalo.core.length, coreN * coreN);
});
