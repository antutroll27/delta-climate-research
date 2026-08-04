/**
 * Ward-mean equilibrium surface temperature: shipped geometry vs staged.
 *
 * THE MEASUREMENT THE GATE WAS MISSING. Built fraction falls 10-29 % under the
 * Overture footprints (Microsoft blobs count courtyards as roof; real footprints
 * do not). `built` drives the heat model, and the ward mean it produces is
 * PUBLISHED on the page with a +/-3.0 K band. This says by how much it moves.
 *
 * Surface layers are FLAT at the measured ward means (surface = null) on purpose:
 * the only thing differing between the two runs is the built raster, so the delta
 * isolates the footprint change and nothing else.
 *
 *   node --experimental-strip-types scripts/geometry-sim-delta.mjs
 */
import { readFileSync } from 'node:fs';

const M = await import('../src/scripts/climate-engine/heat-map-model.ts');
const R = await import('../src/scripts/climate-engine/ward-raster.ts');

const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];
const inputs = JSON.parse(readFileSync('public/heat-map/data/dc-urs-inputs.json', 'utf8')).wards;
const ZERO = { trees: 0, roof: 0, parks: 0, facades: 0 };

const rows = [];
for (const ward of WARDS) {
  const w = inputs[ward];
  /* dc-urs-inputs wraps every figure as {value, source, vintage, cite} so its
     provenance travels with it. Reading .fvc directly yields an OBJECT, which
     propagates to NaN through the whole field rather than throwing -- so the
     unwrap is asserted, not assumed. */
  const num = (k) => {
    const v = w?.[k]?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`${ward}: ${k} is not a finite measured value (got ${JSON.stringify(w?.[k])})`);
    }
    return v;
  };
  const means = { fvc: num('fvc'), albedo: num('albedo') };

  const meanFor = (dir, phase) => {
    const d = JSON.parse(readFileSync(`${dir}/${ward}.json`, 'utf8'));
    const base = R.rasterWardBase(d, means, null);
    return M.eqMean(base, M.currentParams({ live: null, phase, path: '2025', iv: ZERO }));
  };

  for (const phase of ['peak', 'night']) {
    const before = meanFor('public/heat-map/data', phase);
    const after = meanFor('data/geometry/staging', phase);
    rows.push({ ward, phase, before, after, delta: after - before });
  }
}

console.log(`  ${'ward'.padEnd(13)}${'phase'.padEnd(7)}${'shipped'.padStart(9)}${'staged'.padStart(9)}${'delta'.padStart(9)}`);
for (const r of rows) {
  const flag = Math.abs(r.delta) > 0.5 ? '  <-- exceeds 0.5 K' : '';
  const d = (r.delta >= 0 ? '+' : '') + r.delta.toFixed(2);
  console.log(`  ${r.ward.padEnd(13)}${r.phase.padEnd(7)}${r.before.toFixed(2).padStart(9)}`
    + `${r.after.toFixed(2).padStart(9)}${d.padStart(9)}${flag}`);
}
/* Machine-readable, so the gate consumes a contract rather than parsing columns —
   the first version mis-parsed its own output because two fields ran together. */
const byWard = {};
for (const r of rows) (byWard[r.ward] ??= {})[r.phase] = Number(r.delta.toFixed(2));
console.log('\nJSON ' + JSON.stringify(byWard));

const worst = rows.reduce((a, b) => Math.abs(b.delta) > Math.abs(a.delta) ? b : a);
console.log(`\n  largest shift: ${worst.delta >= 0 ? '+' : ''}${worst.delta.toFixed(2)} K `
  + `(${worst.ward} ${worst.phase}), against published bands of +/-4.5 K peak, +/-3.0 K night`);
