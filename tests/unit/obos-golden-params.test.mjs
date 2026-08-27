import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyInterventions,
  computeCost,
  currentParams,
  SIM_N,
} from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'data/calibration/golden-params.json');
const GOLDEN_LAYERS = join(ROOT, 'data/calibration/golden-layers.json');

// currentParams is WARD-INDEPENDENT: ScenarioState carries
// {live, phase, path, iv, heatTairC, sunNow} and no ward. So the matrix varies
// only what actually reaches it. 2 phases x 3 pathways x 2 live x 2 heatwave.
const LIVE = { tAir: 31.2, rh: 74, wind: 2.4, cloud: 40 };
const IV = { trees: 12, roof: 40, parks: 2, facades: 0 };

function matrix() {
  const out = {};
  for (const phase of ['peak', 'night']) {
    for (const path of ['2025', 'ssp245', 'ssp585']) {
      for (const [liveName, live] of [['nolive', null], ['live', LIVE]]) {
        for (const [hwName, heatTairC] of [['plain', null], ['heatwave', 41.5]]) {
          const key = `${phase}/${path}/${liveName}/${hwName}`;
          out[key] = currentParams({ live, phase, path, iv: IV, heatTairC });
        }
      }
    }
  }
  return out;
}

test('currentParams output is frozen against the pre-migration baseline', async () => {
  const now = matrix();
  assert.equal(Object.keys(now).length, 24, 'the matrix must be 24 cases');

  if (!existsSync(GOLDEN)) {
    await writeFile(GOLDEN, JSON.stringify(now, null, 2) + '\n');
    assert.fail('golden-params.json did not exist; it has been written. '
      + 'Inspect it, commit it, and re-run. It must be captured BEFORE any '
      + 'scope-model change lands, or it freezes the wrong thing.');
  }

  const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
  assert.deepEqual(now, golden,
    'currentParams drifted from the frozen baseline. If the change was '
    + 'intentional, say so explicitly and regenerate — do not edit the JSON.');
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECOND MATRIX — the two constants the first one cannot reach.

   currentParams reads PATH_DELTA and FALLBACK_TAIR, so the matrix above freezes
   both. It reads NEITHER of the other two constants the scope migration moves:
   COST is used only in computeCost (which returns rupees) and PARK_R_M only in
   applyInterventions (which returns SimLayers). Neither value is anywhere on
   the SimParams path, so no currentParams golden can ever guard them.

   The pre-existing park test in heat-map-compare.test.mjs does not guard
   PARK_R_M either. It asserts only the two park CENTRE cells, and at a centre
   dx = dy = 0, so `dx*dx + dy*dy <= r2` holds for every r >= 0 — the centre
   value is radius-INDEPENDENT. PARK_R_M could change freely and that test would
   still pass. The transect below is therefore taken OFF-CENTRE and straddles
   the radius, so what gets frozen is the blob's EDGE, not just its peak.
   ───────────────────────────────────────────────────────────────────────────*/

/* computeCost multiplies each COST field by a DIFFERENT spatial quantity, so
   the compare fixture (roofM2 / facadeM2 / corridorKm all zero) would make
   three of the four fields invisible. All four are non-zero here, and each
   intervention is additionally exercised ALONE, so a change to any single COST
   field is guaranteed to move at least one recorded figure. */
const COST_SPATIAL = {
  corridorSorted: new Int32Array(100),
  corridorKm: 12.5,
  parkCenters: Array.from({ length: 10 }, (_, i) => [i * 10, i * 10]),
  roofM2: 500_000,
  facadeM2: 250_000,
  cellArea: 53.1,
  cellM: 7.29,
};

const COST_CASES = {
  zero: { trees: 0, roof: 0, parks: 0, facades: 0 },
  'roof-only': { trees: 0, roof: 50, parks: 0, facades: 0 },
  'trees-only': { trees: 25, roof: 0, parks: 0, facades: 0 },
  'parks-only': { trees: 0, roof: 0, parks: 3, facades: 0 },
  'facades-only': { trees: 0, roof: 0, parks: 0, facades: 7.5 },
  'all-high': { trees: 50, roof: 100, parks: 8, facades: 15 },
};

/* cellM is 7.29, so PARK_R_M = 50 m is round(50/7.29) = 7 cells, and a halved
   PARK_R_M = 25 m is round(25/7.29) = 3. Offsets 4..7 therefore sit INSIDE the
   real blob and OUTSIDE a halved one — that band is what lets the negative test
   tell the two radii apart. The dense run 0..9 pins the edge to an exact cell;
   12/16/32 hold the far field down. */
const TRANSECT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 32];

function layersMatrix() {
  const count = SIM_N * SIM_N;
  // Same fixture shape as heat-map-compare.test.mjs: zeroed veg, albedo 0.12.
  const base = {
    albedo: new Float32Array(count).fill(0.12),
    veg: new Float32Array(count),
    built: new Float32Array(count),
    water: new Float32Array(count),
  };
  const spatial = {
    corridorSorted: new Int32Array(), corridorKm: 0,
    parkCenters: [[40, 40], [120, 120]], roofM2: 0, facadeM2: 0,
    cellArea: 53.1, cellM: 7.29,
  };
  // parks 1.5 => patch 0 at full coverage, patch 1 blended at 0.5. Freezing a
  // transect through both pins the radius AND the fractional-coverage blend.
  const layers = applyInterventions(base, { trees: 0, roof: 0, parks: 1.5, facades: 0 }, spatial);

  const transects = {};
  for (const [name, c] of [['full-40-40', [40, 40]], ['fractional-120-120', [120, 120]]]) {
    transects[name] = TRANSECT.map((d) => {
      const i = c[1] * SIM_N + (c[0] + d);
      return { d, veg: layers.veg[i], albedo: layers.albedo[i] };
    });
  }

  const cost = {};
  for (const [name, iv] of Object.entries(COST_CASES)) cost[name] = computeCost(iv, COST_SPATIAL);

  return { cost, parkTransectPlusX: transects };
}

test('computeCost and the park blob edge are frozen against the pre-migration baseline', async () => {
  const now = layersMatrix();

  assert.equal(Object.keys(now.cost).length, 6, 'every COST field needs an isolating case');
  assert.equal(Object.keys(now.parkTransectPlusX).length, 2, 'both park patches are sampled');

  /* Self-check: the transect is only a PARK_R_M guard while it straddles the
     blob edge. If a later edit slides it wholly inside or wholly outside, the
     golden file would still compare equal while guarding nothing — so assert
     the straddle directly rather than trusting the offsets to stay correct. */
  const full = now.parkTransectPlusX['full-40-40'];
  assert.ok(full.some((p) => p.veg > 0.5), 'transect must sample INSIDE the blob');
  assert.ok(full.some((p) => p.veg === 0), 'transect must sample OUTSIDE the blob');

  if (!existsSync(GOLDEN_LAYERS)) {
    await writeFile(GOLDEN_LAYERS, JSON.stringify(now, null, 2) + '\n');
    assert.fail('golden-layers.json did not exist; it has been written. '
      + 'Inspect it, commit it, and re-run. It must be captured BEFORE any '
      + 'scope-model change lands, or it freezes the wrong thing.');
  }

  const golden = JSON.parse(await readFile(GOLDEN_LAYERS, 'utf8'));
  assert.deepEqual(now, golden,
    'computeCost or the park blob drifted from the frozen baseline. If the '
    + 'change was intentional, say so explicitly and regenerate — do not edit '
    + 'the JSON.');
});
