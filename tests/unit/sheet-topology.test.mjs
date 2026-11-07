import assert from 'node:assert/strict';
import test from 'node:test';

import { AMSTERDAM_SHEET_LATTICE as L } from '../../src/data/sheets/amsterdam.ts';
import { SHEETS, SKIPPED_SHEETS, neighbours } from '../../src/scripts/climate-engine/scope/sheets.ts';
import {
  CROSSING, MAX_ATTEMPTS, RETRY_BACKOFF_MS, SHEET_BUDGETS, lod0MeshMB, tabMeshMB,
} from '../../src/scripts/climate-engine/streaming/sheet-budgets.ts';
import {
  AMSTERDAM_TOPOLOGY as T, DIRECTIONS, DIRECTION_STEP, EDGE_DIRECTIONS, createTopology, directionOfHeading, directionOfStep, headingFan,
} from '../../src/scripts/climate-engine/streaming/sheet-topology.ts';

test('every shipping sheet is found at its own centre and answers to its own cell', () => {
  for (const s of SHEETS) {
    const cell = T.locate(s.centre.lon, s.centre.lat);
    assert.deepEqual(cell, { i: s.i, j: s.j }, s.code);
    assert.equal(T.codeAt(s.i, s.j), s.code);
    assert.deepEqual(T.cell(s.code), { i: s.i, j: s.j });
    assert.equal(T.cellKind(s.i, s.j), 'ships');
    assert.ok(T.depthInto(s.i, s.j, s.centre.lon, s.centre.lat) > 1399 && T.depthInto(s.i, s.j, s.centre.lon, s.centre.lat) < 1401, 'the centre is 1,400 m from every edge');
  }
  assert.throws(() => T.cell('ZZ'), RangeError);
});

test('the lattice formula matches the generated boxes, and a point on a seam belongs to the east/north cell (half-open)', () => {
  for (const s of SHEETS) {
    const [w, south, e, n] = s.wgs84Bounds;
    const west = L.anchor.centre.lon + (s.i - 0.5) * L.dLon, north = L.anchor.centre.lat + (s.j + 0.5) * L.dLat;
    assert.ok(Math.abs(w - west) < 1e-12 && Math.abs(n - north) < 1e-12, s.code);
    assert.ok(Math.abs(e - (L.anchor.centre.lon + (s.i + 0.5) * L.dLon)) < 1e-12 && Math.abs(south - (L.anchor.centre.lat + (s.j - 0.5) * L.dLat)) < 1e-12);
  }
  const e4 = SHEETS.find((s) => s.code === 'E4');
  const seam = e4.wgs84Bounds[2];
  assert.deepEqual(T.locate(seam + 1e-9, e4.centre.lat), { i: 1, j: 0 }, 'just east of the seam is F4');
  assert.deepEqual(T.locate(seam - 1e-9, e4.centre.lat), { i: 0, j: 0 }, 'just west is E4');
  // 100 m either side
  assert.ok(Math.abs(T.depthInto(0, 0, seam - 100 / L.mPerDegLon, e4.centre.lat) - 100) < 1e-6);
  assert.ok(Math.abs(T.depthInto(0, 0, seam + 100 / L.mPerDegLon, e4.centre.lat) + 100) < 1e-6, 'negative once outside the cell');
});

test('neighbour() is the same relation as scope/sheets.ts neighbours(), and respects skipped cells', () => {
  for (const s of SHEETS) {
    const mine = DIRECTIONS.map((d) => T.neighbour(s.code, d)).filter(Boolean).sort();
    assert.deepEqual(mine, neighbours(s.code).map((n) => n.code).sort(), s.code);
    for (const d of DIRECTIONS) {
      const [di, dj] = DIRECTION_STEP[d];
      const n = T.neighbour(s.code, d);
      assert.equal(n, T.codeAt(s.i + di, s.j + dj));
      if (n === null) assert.notEqual(T.cellKind(s.i + di, s.j + dj), 'ships');
    }
  }
});

test('the 70 lattice cells are shipping, skipped or outside; skipped cells are never a codeAt', () => {
  const kinds = { ships: 0, skipped: 0, outside: 0 };
  for (let col = 0; col < L.columns.length; col++) for (let row = 0; row < L.rows; row++) kinds[T.cellKind(col + L.iOfColumnA, L.jOfRow1 - row)]++;
  assert.equal(kinds.ships, SHEETS.length);
  assert.equal(kinds.skipped, SKIPPED_SHEETS.length);
  assert.equal(kinds.ships + kinds.skipped + kinds.outside, 70);
  for (const s of SKIPPED_SHEETS) { assert.equal(T.codeAt(s.i, s.j), null); assert.equal(T.cellKind(s.i, s.j), 'skipped'); }
  assert.equal(T.cellKind(100, 100), 'outside');
});

test('a topology over a sub-table treats the removed sheet as no longer shipping', () => {
  const without = createTopology(SHEETS.filter((s) => s.code !== 'F4'), SKIPPED_SHEETS);
  assert.equal(without.codeAt(1, 0), null);
  assert.equal(without.neighbour('E4', 'e'), null);
  assert.equal(without.cellKind(1, 0), 'outside');
  assert.equal(without.has('F4'), false);
  assert.equal(T.has('F4'), true);
});

test('compass sectors: 45 degrees each, north = 0, clockwise, wrapping', () => {
  const cases = [[0, 'n'], [22.4, 'n'], [22.6, 'ne'], [45, 'ne'], [90, 'e'], [135, 'se'], [180, 's'], [225, 'sw'], [270, 'w'], [315, 'nw'], [337.4, 'nw'],
    [337.6, 'n'], [359.9, 'n'], [360, 'n'], [450, 'e'], [-90, 'w'], [-0.1, 'n']];
  for (const [deg, want] of cases) assert.equal(directionOfHeading(deg), want, `${deg}`);
  assert.equal(directionOfHeading(NaN), null);
  assert.equal(directionOfHeading(Infinity), null);
  assert.deepEqual(headingFan('e'), ['e', 'se', 'ne']);
  assert.deepEqual(headingFan('n'), ['n', 'ne', 'nw']);
  assert.deepEqual(headingFan('nw'), ['nw', 'n', 'w']);
  for (const d of DIRECTIONS) { const [di, dj] = DIRECTION_STEP[d]; assert.equal(directionOfStep(di, dj), d); }
  assert.equal(directionOfStep(0, 0), null);
  assert.equal(directionOfStep(2, 0), null);
  assert.deepEqual([...EDGE_DIRECTIONS], ['n', 'e', 's', 'w']);
});

// ── the budget table ────────────────────────────────────────────────────────

test('the budget table reproduces the P3b mesh measurements for Canal Ring (21,342 buildings)', () => {
  assert.ok(Math.abs(lod0MeshMB('full', 21342) - 131.1) < 0.2, 'bevel-core: 2,731,890 vertices of 48 B');
  assert.ok(Math.abs(lod0MeshMB('balanced', 21342) - 22.7) < 0.2, 'prism-mesh: 622,500 vertices of 30 B plus the index = 22.64 MB');
  assert.ok(Math.abs(lod0MeshMB('low', 21342) - 22.7) < 0.2, 'balanced and low draw the same packed mesh');
});

test('tiers are ordered: a smaller device never holds more, and the plan numbers are in the table', () => {
  const { full, balanced, low } = SHEET_BUDGETS;
  assert.deepEqual([full.gpuCeilingMB, balanced.gpuCeilingMB, low.gpuCeilingMB], [500, 250, 150], 'PLAN 3.2');
  assert.deepEqual([full.maxLod0Sheets, balanced.maxLod0Sheets, low.maxLod0Sheets], [3, 2, 1], 'PLAN 3.2');
  assert.ok(full.maxLod0Sheets > balanced.maxLod0Sheets && balanced.maxLod0Sheets > low.maxLod0Sheets);
  assert.deepEqual([full.ring, balanced.ring, low.ring], ['ring8', 'ring8', 'edge4']);
  assert.deepEqual([full.crossFade, balanced.crossFade, low.crossFade], [false, false, false]);
  assert.equal(low.prefetch, 'none');
  for (const tier of Object.values(SHEET_BUDGETS)) {
    assert.equal(tier.releasesCpuCopy, true, 'every tier must free the CPU copy (P0 section 3)');
    assert.ok(tier.baselineMB + 2 * tier.lod1MeshMB < tier.gpuCeilingMB);
  }
  assert.ok(Object.isFrozen(SHEET_BUDGETS));
});

test('every budget number says where it comes from; the unmeasured ones are marked estimates (audit S3)', () => {
  const { full, balanced, low } = SHEET_BUDGETS;
  for (const tier of [full, balanced, low]) {
    assert.deepEqual(Object.keys(tier.sources).sort(), ['baselineMB', 'gpuCeilingMB', 'heapAllowanceMB', 'lod0', 'lod1MeshMB', 'maxLod0Sheets']);
    assert.equal(tier.sources.lod1MeshMB, 'P3b-measured');
    assert.equal(tier.sources.lod0, 'P3b-measured');
    assert.equal(tier.sources.gpuCeilingMB, 'plan');
    assert.equal(tier.sources.maxLod0Sheets, 'plan');
  }
  assert.equal(full.sources.baselineMB, 'estimate', '36 measured + 8 estimated for the 504 solver textures');
  assert.deepEqual([balanced.baselineMB, low.baselineMB], [21, 21], 'P0 phone viewport: 6.5 MB buffers + 14 MB textures');
  assert.equal(balanced.sources.baselineMB, 'P0');
  assert.equal(full.baselineMB, 36 + 8);
});

test('the CPU row: without the release a tab holds twice the mesh, and low would break its ceiling on the densest sheet if it were bevelled', () => {
  const e4 = 21342;
  assert.equal(tabMeshMB('full', e4), lod0MeshMB('full', e4), 'released: the GL bytes only');
  assert.ok(Math.abs(2 * lod0MeshMB('full', e4) - 262.2) < 1, 'kept: ~262 MB (P0 saw 152 GL + 182 ArrayBuffers on the 56 B mesh)');
  const { low } = SHEET_BUDGETS;
  assert.ok(low.baselineMB + lod0MeshMB('low', e4) + 4 * low.lod1MeshMB < low.gpuCeilingMB, 'low fits with the packed mesh and four worst-case massings');
  assert.ok(low.baselineMB + lod0MeshMB('full', e4) > low.gpuCeilingMB, 'but a bevelled E4 alone (131 MB) is over the 150 MB ceiling once the baseline is added: low ships the packing');
});

test('the camera-crossing and retry constants are the plan\'s', () => {
  assert.deepEqual({ ...CROSSING }, { hysteresisM: 200, idleMs: 400 });
  assert.deepEqual([...RETRY_BACKOFF_MS], [2000, 8000]);
  assert.equal(MAX_ATTEMPTS, 3);
});
