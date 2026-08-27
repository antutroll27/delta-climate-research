/**
 * Freeze what the OBOS physics produces TODAY, before the Country → City → Area
 * migration moves four constants out of the physics module.
 *
 * WHY THIS EXISTS. The scope migration lifts PATH_DELTA, COST, PARK_R_M and
 * FALLBACK_TAIR out of src/scripts/climate-engine/heat-map-model.ts, because each
 * belongs to a country or a city rather than to physics. Moving a constant out of the
 * module that reads it is exactly the kind of edit that changes a number while looking
 * like a move — the diff shows a deletion here and an addition there, and nothing shows
 * the value that shifted in between. These two files are the before-picture that makes
 * such a drift impossible to miss.
 *
 * WHY TWO MATRICES AND NOT ONE. currentParams reaches only HALF the migrated set. It
 * reads PATH_DELTA and FALLBACK_TAIR, so golden-params.json freezes those. It reads
 * neither COST — used only in computeCost, which returns rupees — nor PARK_R_M, used
 * only in applyInterventions, which returns SimLayers. Neither value is anywhere on the
 * SimParams path, so no currentParams golden can ever guard them, and golden-layers.json
 * exists to cover exactly that gap.
 *
 * WHY THE TEST ONLY READS, AND THIS FILE ONLY WRITES. A test that regenerates its own
 * baseline when the file is missing cannot establish the one property this task exists
 * for. Drift a constant and the sequence is: run fails correctly · delete the JSON · run
 * rewrites it from the drifted code · run passes. Suite green, evidence destroyed, no
 * trace in the diff. The missing-file message cannot defend against it either, because
 * it is the same message a legitimate first capture prints — the merged form simply
 * cannot tell "captured before the migration" from "recaptured after it". So the split
 * here is the same one scripts/dump-water-oracle.mjs and scripts/gen-cbam-fixtures.mjs
 * already use: the generator is the only thing that writes, and the consumer fails with
 * a command rather than healing itself.
 *
 * WHAT EACH FIXTURE HAS TO GET RIGHT. Both matrices are built to make the constant they
 * guard OBSERVABLE, which is not automatic:
 *
 *   · currentParams reads exactly ONE field of `iv` — facades, through FACADE_Q. With
 *     facades at 0 the term collapses to Q * (1 - 0) and FACADE_Q could hold any value
 *     at all while every frozen case still matched. It is held non-zero for that reason.
 *   · computeCost multiplies each COST field by a DIFFERENT spatial quantity, so a
 *     fixture with roofM2 / corridorKm / facadeM2 at zero would render three of the four
 *     fields invisible. All four are non-zero, and each lever is also exercised alone.
 *   · the park blob's CENTRE is radius-independent — at dx = dy = 0 the inside check
 *     holds for every r >= 0 — so a centre-only assertion cannot see PARK_R_M change at
 *     all. The transect is taken off-centre and straddles the edge.
 *
 * DETERMINISM. Every input here is a literal — no Math.random, no dates, no environment,
 * no network. Re-running this on any machine must produce byte-identical files, so a
 * diff in git is a diff in the physics.
 *
 *   node --import tsx scripts/dump-obos-golden.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyInterventions,
  computeCost,
  currentParams,
  SIM_N,
} from '../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GOLDEN_PARAMS = join(ROOT, 'data/calibration/golden-params.json');
export const GOLDEN_LAYERS = join(ROOT, 'data/calibration/golden-layers.json');

/* ── Matrix 1 · currentParams — guards PATH_DELTA, FALLBACK_TAIR, FACADE_Q ──
   currentParams is WARD-INDEPENDENT: ScenarioState carries
   {live, phase, path, iv, heatTairC, sunNow} and no ward, so the matrix varies only
   what actually reaches the function. 2 phases x 3 pathways x 2 live x 2 heatwave.

   `sunNow` is the one member of that shape held fixed (absent). It selects an
   alternative "right now" branch that reads NONE of the migrated constants beyond the
   two this matrix already covers through the shared prologue, and
   tests/unit/heat-map-now-phase.test.mjs already exercises that branch directly.
   Varying it here would double the matrix to buy coverage that exists elsewhere. */

// An ordinary Kolkata monsoon afternoon. The exact values are arbitrary but FIXED —
// nothing downstream depends on them being a real observation, only on them never
// changing, so that a diff in the frozen output is a diff in the code.
const LIVE = { tAir: 31.2, rh: 74, wind: 2.4, cloud: 40 };

/* facades MUST STAY NON-ZERO. currentParams reads exactly one field of `iv`:
     heat-map-model.ts:378 — Q = DEFAULT_PARAMS.Q * (1 - FACADE_Q * (iv.facades / 15))
   trees, roof and parks are never read by it and are decorative here (they matter to
   applyInterventions and computeCost, which matrix 2 covers). At facades = 0 the
   FACADE_Q term multiplies out and the constant becomes unobservable — every case would
   still match with FACADE_Q set to anything. 7.5 is a mid value of the 0..15 range the
   divisor implies. */
const IV = { trees: 12, roof: 40, parks: 2, facades: 7.5 };

export function paramsMatrix() {
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

/* ── Matrix 2 · computeCost + applyInterventions — guards COST and PARK_R_M ── */

/* computeCost reads only roofM2, corridorKm, parkCenters.length and facadeM2
   (heat-map-model.ts:327-330); corridorSorted, cellArea and cellM are type-shape
   padding it never touches. Each of the four quantities it DOES read is non-zero, so
   none of the four COST fields can hide behind a zero multiplier. */
export const COST_SPATIAL = {
  corridorSorted: new Int32Array(100),
  corridorKm: 12.5,
  parkCenters: Array.from({ length: 10 }, (_, i) => [i * 10, i * 10]),
  roofM2: 500_000,
  facadeM2: 250_000,
  cellArea: 53.1,
  cellM: 7.29,
};

// Each `-only` case moves exactly ONE lever, which is what isolates one COST field per
// figure; `all-high` catches a change that cancels across levers.
export const COST_CASES = {
  zero: { trees: 0, roof: 0, parks: 0, facades: 0 },
  'roof-only': { trees: 0, roof: 50, parks: 0, facades: 0 },
  'trees-only': { trees: 25, roof: 0, parks: 0, facades: 0 },
  'parks-only': { trees: 0, roof: 0, parks: 3, facades: 0 },
  'facades-only': { trees: 0, roof: 0, parks: 0, facades: 7.5 },
  'all-high': { trees: 50, roof: 100, parks: 8, facades: 15 },
};

/* The park fixture's cellM is 7.29 m — the shipped ward geometry, 1400 m across
   SIM_N cells (heat-map-model.ts:15). So PARK_R_M = 50 m is round(50/7.29) = 7 cells,
   and a halved PARK_R_M = 25 m is round(25/7.29) = 3. Offsets 4..7 therefore sit INSIDE
   the real blob and OUTSIDE a halved one, which is what lets the frozen profile tell the
   two radii apart. The dense run 0..9 pins the edge to an exact cell; 12/16/32 hold the
   far field down. */
export const TRANSECT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 32];

export function layersMatrix() {
  const count = SIM_N * SIM_N;
  // Same fixture shape as tests/unit/heat-map-compare.test.mjs: zeroed veg, albedo 0.12.
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
  // parks 1.5 => patch 0 at full coverage, patch 1 blended at 0.5. A transect through
  // both pins the radius AND the fractional-coverage blend.
  const layers = applyInterventions(base, { trees: 0, roof: 0, parks: 1.5, facades: 0 }, spatial);

  const transects = {};
  for (const [name, c] of [['full-40-40', [40, 40]], ['fractional-120-120', [120, 120]]]) {
    /* The row is walked by raw index, so an x that ran past the grid edge would wrap
       into the NEXT row and read plausible-looking zeros. The straddle check and the
       golden would both still pass while the transect had stopped being a transect. */
    assert.ok(c[0] + Math.max(...TRANSECT) < SIM_N,
      `transect from ${name} runs off the row: ${c[0]} + ${Math.max(...TRANSECT)} >= ${SIM_N}`);
    transects[name] = TRANSECT.map((d) => {
      const i = c[1] * SIM_N + (c[0] + d);
      return { d, veg: layers.veg[i], albedo: layers.albedo[i] };
    });
  }

  const cost = {};
  for (const [name, iv] of Object.entries(COST_CASES)) cost[name] = computeCost(iv, COST_SPATIAL);

  return { cost, parkTransectPlusX: transects };
}

/* Importing this module must have no side effects — the test imports the builders above
   and must never be able to rewrite the evidence it checks. Only running the file
   writes. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const params = paramsMatrix(), layers = layersMatrix();
  writeFileSync(GOLDEN_PARAMS, `${JSON.stringify(params, null, 2)}\n`);
  writeFileSync(GOLDEN_LAYERS, `${JSON.stringify(layers, null, 2)}\n`);

  const qs = [...new Set(Object.values(params).map((p) => p.Q))].sort((a, b) => a - b);
  console.log(`  ${Object.keys(params).length} currentParams cases`
    + `  ·  ${new Set(Object.values(params).map((p) => JSON.stringify(p))).size} distinct`);
  console.log(`    Q values ${qs.join(', ')}  (FACADE_Q is live in these — see the header)`);
  console.log(`  ${Object.keys(layers.cost).length} computeCost cases`
    + `  ·  ${Object.keys(layers.parkTransectPlusX).length} park transects`
    + ` of ${TRANSECT.length} offsets`);
  for (const [name, fig] of Object.entries(layers.cost)) {
    console.log(`    ${name.padEnd(14)} ₹${fig.toLocaleString('en-IN')}`);
  }
  console.log(`\n  wrote ${GOLDEN_PARAMS}`);
  console.log(`  wrote ${GOLDEN_LAYERS}`);
}
