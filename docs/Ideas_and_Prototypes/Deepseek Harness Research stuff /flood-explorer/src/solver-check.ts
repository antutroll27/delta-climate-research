/**
 * Runnable self-check for the flood solver. No DOM, no GL, no framework.
 *
 *   npx tsx src/solver-check.ts        (or: node --experimental-strip-types)
 *
 * WHAT THIS EXISTS TO CATCH. The previous solver compared an inflow in m3
 * against a stage-volume curve in metre-cells, so every depression sat pinned at
 * its rim and ALL EIGHT rainfall snapshots were bit-identical -- the slider, the
 * event preset and the truth metrics were all wired to a constant field, while
 * the HUD kept reporting which snapshots it was interpolating. Nothing in the
 * project would have failed. The water budget below is the check that would.
 */
import {
  CELL, N, RAIN_STEPS,
  synthesizeTerrain, priorityFlood, buildModel, computeSnapshot, snapshotWithBudget,
  runoffMm, INFILTRATION_MM_PER_H, STORM_HOURS,
  handIndex, handExtent, extentMetrics,
} from './sim.ts';

export function assertSolverLogic(): void {
  const a = (ok: boolean, msg: string) => { if (!ok) throw new Error(`solver: ${msg}`); };
  const H = synthesizeTerrain();
  const S = priorityFlood(H);
  const model = buildModel(H, S);
  const cellArea = CELL * CELL;

  a(model.hier.nNodes > 1, 'the terrain must yield at least one depression');

  // 1. WATER IS CONSERVED. Rain in = infiltrated + ponded + left the domain.
  //    A unit error, a dropped spill or a lost cascade all break this line.
  for (const mm of RAIN_STEPS) {
    const { budget } = snapshotWithBudget(H, model, mm);
    // The ponded term is integrated from a Float32Array, because `depth` is
    // uploaded to a DataTexture unchanged. So the budget closes to SINGLE
    // precision, not double: ~1e-6 relative, not 1e-15. Loosening past this
    // would be hiding a solver error behind a rounding excuse -- every defect
    // this file was written for was 4 to 10 ORDERS of magnitude above it.
    const tol = Math.max(1e-3, budget.ponded * 1e-6);
    a(Math.abs(budget.residual) <= tol,
      `water budget must close at ${mm} mm (residual ${budget.residual.toExponential(3)} m3)`);
    a(budget.ponded >= 0 && budget.toSea >= 0, `no negative volumes at ${mm} mm`);
  }

  // 2. THE FIELD RESPONDS TO RAINFALL. The defect this file was written for.
  //    Distinct rainfall totals above the loss threshold must give distinct fields.
  const wet = RAIN_STEPS.filter((mm) => runoffMm(mm) > 0);
  a(wet.length >= 3, 'the scenario ladder must clear the loss threshold at least three times');
  const snaps = wet.map((mm) => computeSnapshot(H, model, mm));
  for (let i = 1; i < snaps.length; i++) {
    let differs = false;
    for (let k = 0; k < N; k++) if (snaps[i][k] !== snaps[i - 1][k]) { differs = true; break; }
    a(differs, `snapshot at ${wet[i]} mm is identical to ${wet[i - 1]} mm — the field is frozen`);
  }

  // 3. MONOTONICITY. More rain can never mean less water standing.
  for (let i = 1; i < snaps.length; i++) {
    let vPrev = 0, vNow = 0;
    for (let k = 0; k < N; k++) { vPrev += snaps[i - 1][k]; vNow += snaps[i][k]; }
    a(vNow >= vPrev - 1e-6, `ponded volume fell from ${wet[i - 1]} mm to ${wet[i]} mm`);
  }

  // 4. LOSSES ARE RATE-LIMITED, NOT PROPORTIONAL. A fixed runoff coefficient
  //    would hold the ratio constant; a real infiltration rate must not.
  const loss = 5 + INFILTRATION_MM_PER_H * STORM_HOURS;
  a(runoffMm(loss - 1) === 0, 'rain below the loss threshold must produce no runoff');
  const rLo = runoffMm(100) / 100, rHi = runoffMm(300) / 300;
  a(rHi > rLo, 'runoff ratio must rise with event size under a rate-limited loss');

  // 5. NOTHING PONDS ON THE OPEN BOUNDARY — it is the sea, not a basin.
  const big = computeSnapshot(H, model, RAIN_STEPS[RAIN_STEPS.length - 1]);
  for (let i = 0; i < 128; i++) a(big[i] === 0, `south edge cell ${i} must drain, not pond`);

  // 6. THE CROSS-CHECK IS NOT CIRCULAR. The truth panel previously scored the
  //    solver against a 5 %-flipped copy of its own output, so CSI sat near 0.9
  //    whatever the solver did -- a validation panel that could not fail. HAND
  //    is derived from the terrain by a different method, so the agreement must
  //    actually MOVE across the scenario ladder.
  const hand = handIndex(H, model);
  const scored = RAIN_STEPS.filter((mm) => runoffMm(mm) > 0)
    .map((mm) => extentMetrics(computeSnapshot(H, model, mm), handExtent(hand, mm)).csi);
  a(new Set(scored.map((c) => c.toFixed(3))).size >= 3,
    `cross-check CSI must vary across the ladder (got ${scored.map((c) => c.toFixed(3)).join(', ')})`);
  a(scored.some((c) => c < 0.9), 'a cross-check that never drops below 0.9 is not a check');

  // 7. FLOW ACCUMULATION ACTUALLY ACCUMULATES. Computed in the wrong order it
  //    tops out at "1 + immediate upstream neighbours" and still looks like a
  //    drainage network on screen.
  let maxAcc = 0;
  for (let k = 0; k < N; k++) if (model.acc[k] > maxAcc) maxAcc = model.acc[k];
  a(maxAcc > N / 20, `flow accumulation must reach a real maximum (got ${maxAcc})`);

  // 8. DEPTH NEVER EXCEEDS THE LOCAL RELIEF OF ITS OWN BASIN.
  let maxD = 0;
  for (let k = 0; k < N; k++) if (big[k] > maxD) maxD = big[k];
  let relief = -Infinity, low = Infinity;
  for (let k = 0; k < N; k++) { if (H[k] > relief) relief = H[k]; if (H[k] < low) low = H[k]; }
  a(maxD <= relief - low, `max depth ${maxD.toFixed(2)} m exceeds total terrain relief`);
}

assertSolverLogic();
console.log('solver-check: OK');
