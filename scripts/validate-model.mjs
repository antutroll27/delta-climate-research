/**
 * Model validation harness — checks heat-map outputs against PUBLISHED values.
 *
 * This is a diagnostic report, not a pass/fail test, because several checks
 * currently fail and we want the failures visible rather than blocking. Once a
 * check has held for a while, promote it into tests/unit/ as a regression guard.
 *
 *   node --experimental-strip-types scripts/validate-model.mjs
 *
 * Benchmarks are cited inline. Do not adjust a benchmark to make a check pass —
 * adjust the model, or record why the benchmark does not apply.
 */
const M = await import('../src/scripts/climate-engine/heat-map-model.ts');

const N = M.SIM_N, N2 = N * N;
const results = [];
const check = (name, value, lo, hi, unit, source) => {
  const ok = value >= lo && value <= hi;
  results.push({ name, value, lo, hi, unit, source, ok });
};

/* ── a synthetic dense-core ward: alternating built / street columns ────────── */
function makeWard() {
  const base = {
    albedo: new Float32Array(N2), veg: new Float32Array(N2),
    built: new Float32Array(N2), water: new Float32Array(N2),
  };
  const streets = [];
  for (let i = 0; i < N2; i++) {
    const b = (i % 2 === 0) ? 1 : 0;
    base.built[i] = b;
    base.albedo[i] = b ? 0.20 : 0.32;
    base.veg[i] = b ? 0 : 0.05;
    if (!b) streets.push(i);
  }
  const spatial = {
    corridorSorted: Int32Array.from(streets), corridorKm: 40,
    parkCenters: [[48, 48], [140, 140], [48, 140], [140, 48]],
    roofM2: 5e5, facadeM2: 8e5, cellArea: 53.1, cellM: 7.29,
  };
  return { base, spatial };
}
const { base, spatial } = makeWard();
const scen = (iv) => ({ live: null, phase: 'peak', path: '2025', iv });
const ZERO = { trees: 0, roof: 0, parks: 0, facades: 0 };
/** local park cooling, used as the physically-necessary upper bound on ward-mean ΔT */
function parkDropForBound() {
  const p = M.currentParams(scen(ZERO));
  return M.eqCell(p, 0.20, 0, 0) - M.eqCell(p, 0.20, 0.9, 0);
}

/* ── 1. the displayed UHI figure ───────────────────────────────────────────── */
const p0 = M.currentParams(scen(ZERO));
const baseMean = M.eqMean(base, p0);
const k0 = p0.kRad + p0.h * p0.wind;
const ruralRef =
  (p0.S * (1 - 0.25) * p0.sun - p0.L * 1 + p0.kRad * p0.tSky + p0.h * p0.wind * p0.tAir) / k0;
check(
  'Land-cover thermal contrast', baseMean - ruralRef, 8, 18, '°C',
  'Voogt & Oke 2003: clear-sky DAYTIME SURFACE UHI runs 10-15 C (canopy AIR UHI is 2-5 C). '
  + 'This is NOT comparable to the 0.85-1.5 C Kolkata SUHII figures, which are 1 km MODIS, '
  + 'season-averaged, measured against a real rural population — a different quantity.',
);

/* ── 2. maximum achievable ward-scale cooling ──────────────────────────────── */
const MAXED = { trees: 50, roof: 100, parks: 4, facades: 15 };
const maxCool = baseMean - M.eqMean(M.applyInterventions(base, MAXED, spatial), M.currentParams(scen(MAXED)));
// NOTE ON BENCHMARK CHOICE. The "2-3 °C ward-scale ceiling" in our own model doc
// is an AIR-temperature claim; this model computes ward-mean LAND SURFACE
// temperature. Those differ by roughly two orders of magnitude for the same
// intervention — WRI India report −0.3 °C air and −27.5 °C road surface for the
// same street trees. No published ward-mean-LST benchmark was found, so we use a
// bound that is physically necessary rather than borrowed: the mean of a field
// cannot shift further than its largest validated local change.
check(
  'Max ward cooling ≤ validated local park cooling', maxCool, 0, parkDropForBound(), '°C',
  'self-consistency: ward-mean ΔT cannot exceed the local park cooling checked against Li et al. 2022',
);

/* ── 3. local park cooling — the one Kolkata-specific validation ────────────── */
const pPark = M.currentParams(scen(ZERO));
const parkDrop = M.eqCell(pPark, 0.20, 0, 0) - M.eqCell(pPark, 0.20, 0.9, 0);
check(
  'Local cooling inside a park', parkDrop, 0, 8.07, '°C',
  'Li et al. 2022 (10.3389/fenvs.2022.1073914) — Kolkata daytime maximum UCI. ONE-SIDED: '
  + "the former 4.83 lower bound was Bangkok's maximum, not a Kolkata floor — withdrawn "
  + '2026-08-08, see docs/green-score-methodology.md §4.2',
);

/* ── 3b. absolute surface temps vs air — where the contrast comes from ─────── */
// A surface cannot sit far below the air that is warming it. Vegetated surfaces
// run a few K below air via evapotranspiration; 10 K+ below is not physical.
const vegCell = M.eqCell(p0, 0.25, 1.0, 0);
const builtCell = M.eqCell(p0, 0.20, 0, 1);
check(
  'Vegetated surface below air temp', p0.tAir - vegCell, 0, 4, 'K',
  'ET can hold a vegetated surface a few K below air; >4 K below is not physical',
);
/* ── 3c. the two ET bars, across the space the app can actually reach ───────── */
// BOTH CHECKS ABOVE ARE SINGLE-POINT, AND THE THING THEY CONSTRAIN IS NOT.
// currentParams scales L by evap = 0.6 + 0.6·(1 − rh/100), so the effective ET
// coefficient spans 0.6× to 1.2× the constant — a factor of two — while the
// checks only ever saw the rh = 60 fallback. A bar that is only evaluated at one
// point of a moving parameter is not a bound, it is an anecdote.
//
// So: find the humidity at which each bar actually breaks, and report the margin
// rather than asserting a Kolkata humidity floor nobody measured. The heatwave
// path is swept too, because it derives its own rh by preserving vapour as the
// air warms — the one route in the app that reaches genuinely dry air.
const etBars = (live, heatTairC) => {
  const p = M.currentParams({ live, phase: 'peak', path: '2025', iv: ZERO, ...(heatTairC == null ? {} : { heatTairC }) });
  return {
    park: M.eqCell(p, 0.20, 0, 0) - M.eqCell(p, 0.20, 0.9, 0),
    veg: p.tAir - M.eqCell(p, 0.25, 1.0, 0),
    Leff: p.L,
  };
};
// Drive the sweep with the humidity WE ACTUALLY OBSERVED, not a round number.
// The first draft of this section asserted a 30 % floor as "well below anything
// Kolkata records". ward-observations.json records 14.1 %. Assuming a floor is
// how the L citation went wrong in the first place; read the archive instead.
const OBS_RH = [];
(function collect(node) {
  if (Array.isArray(node)) node.forEach(collect);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'rh' && typeof v === 'number') OBS_RH.push(v);
      else collect(v);
    }
  }
})(JSON.parse(await (await import('node:fs/promises')).readFile(
  new URL('../data/calibration/ward-observations.json', import.meta.url), 'utf8')));
const rhSorted = [...OBS_RH].sort((a, b) => a - b);
const live = (rh) => ({ tAir: 32, rh, wind: 3, cloud: 0 });
const violatesVeg = OBS_RH.filter((rh) => etBars(live(rh), null).veg > 4).length;
const violatesPark = OBS_RH.filter((rh) => etBars(live(rh), null).park > 8.07).length;

check(
  'Vegetated-surface bar holds on observed weather', violatesVeg, 0, 0, ' readings',
  'THE EVAP RAMP HAS NO UPPER ANCHOR. currentParams scales L by 0.6 + 0.6·(1 − rh/100), '
  + 'so ET keeps RISING as air dries, while the 4 K headroom shrinks as the sky dries. They '
  + `cross near 22 % rh, and this archive records humidity down to ${rhSorted[0].toFixed(1)} %. `
  + 'Real stomata close under high vapour-pressure deficit and ET falls — the ramp models the '
  + 'opposite. See docs/green-score-methodology.md §4.2.1; this is a MODEL DEFECT, not a bar to relax',
);
check(
  'Park-cooling bar holds on observed weather', violatesPark, 0, 0, ' readings',
  'the same sweep against the Li et al. 2022 Kolkata daytime maximum',
);
check(
  'Heatwave overlay stays physical from the median day', etBars(live(54.3), 48).veg, 0, 4, 'K',
  'imposing 48 °C on the archive MEDIAN humidity must stay inside the bar — it does. The '
  + 'overlay widens the dry-air defect above rather than causing it, and the two must not be conflated',
);

check(
  'Built surface above air temp', builtCell - p0.tAir, 5, 25, 'K',
  'clear-sky afternoon roof/asphalt runs 15-25 K above air (LST vs 2 m air)',
);

/* ── 3c. do the four levers saturate against each other? ───────────────────── */
const solo = ['trees', 'roof', 'parks', 'facades'].map((key) => {
  const iv = { ...ZERO, [key]: MAXED[key] };
  return baseMean - M.eqMean(M.applyInterventions(base, iv, spatial), M.currentParams(scen(iv)));
});
const sumSolo = solo.reduce((a, b) => a + b, 0);
// INFORMATIONAL, not pass/fail. Near-perfect additivity is CORRECT for a surface
// energy balance: the four levers act on largely disjoint cells (roofs / street
// corridors / open land), and each cell's LST is set by its own local balance.
// Interventions overlap through air mixing and advection — which this model
// deliberately does not represent (see SIM_D note in heat-map-model.ts).
const additivity = maxCool / sumSolo;

/* ── 3d. canopy dose-response — the most directly citable calibration anchor ── */
// WRI India: each +10% tree cover ≈ −0.3 °C. Measure the canopy actually added
// by the trees lever, then compare our ΔT against that dose-response.
const treedLayers = M.applyInterventions(base, { ...ZERO, trees: 50 }, spatial);
let vegBefore = 0, vegAfter = 0;
for (let i = 0; i < N2; i++) { vegBefore += base.veg[i]; vegAfter += treedLayers.veg[i]; }
const canopyAddedPct = 100 * (vegAfter - vegBefore) / N2;
const treeCooling = baseMean - M.eqMean(treedLayers, M.currentParams(scen({ ...ZERO, trees: 50 })));
// INFORMATIONAL. WRI's −0.3 °C per +10% canopy is explicitly AFTERNOON AIR
// temperature. Their SURFACE figure for the same intervention is −27.5 °C. Our
// ward-mean LST necessarily sits between the two, and no published ward-mean-LST
// dose-response was found. Reported so the gap stays visible, not scored.
const expectedByWRIair = 0.3 * (canopyAddedPct / 10);

/* ── 4. cost-effectiveness ordering ────────────────────────────────────────── */
const perDeg = (iv) => {
  const p = M.currentParams(scen(iv));
  const dT = baseMean - M.eqMean(M.applyInterventions(base, iv, spatial), p);
  const cost = M.computeCost(iv, spatial);
  return dT > 0.01 ? (cost / 1e7) / dT : Infinity;   // ₹ crore per °C
};
check(
  'Facade vs cool-roof cost per m²', M.COST.facadeM2 / M.COST.roofM2, 40, 80, '×',
  'Indian HAP practice leads with cool roofs: ₹9,500/m² facade vs ₹150/m² roof coating',
);
// Cost per DEGREE is now enormous for facades — correctly so, since the
// neighbourhood-scale effect is ~3% (Gunawardena & Steemers 2023). Reported,
// not bounded, because "facades are poor value per degree" is the honest finding.
const roofCr = perDeg({ ...ZERO, roof: 100 });
const facadeCr = perDeg({ ...ZERO, facades: 15 });
console.log(`\n  [note] ₹ crore per °C — cool roofs ${roofCr.toFixed(1)}, facades ${facadeCr.toFixed(1)}`);

/* ── 5. score behaviour ────────────────────────────────────────────────────── */
const scoreOf = (iv) => {
  const p = M.currentParams(scen(iv));
  const layers = M.applyInterventions(base, iv, spatial);
  return M.greenScore(M.computeGreenG(layers), baseMean - M.eqMean(layers, p), M.computeCost(iv, spatial));
};
check('Score at zero intervention', scoreOf(ZERO), 0, 10, '/100', 'doing nothing should score near zero');
check('Score at full intervention', scoreOf(MAXED), 0, 100, '/100', 'bounded by construction');

/* ── report ────────────────────────────────────────────────────────────────── */
const W = 42;
console.log('\nMODEL VALIDATION vs PUBLISHED BENCHMARKS');
console.log('='.repeat(96));
console.log('  ' + 'check'.padEnd(W) + 'value'.padStart(10) + '   expected'.padEnd(18) + '  status');
console.log('  ' + '-'.repeat(92));
for (const r of results) {
  const val = `${r.value.toFixed(2)} ${r.unit}`;
  const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2);
  const exp = `${fmt(r.lo)}–${fmt(r.hi)} ${r.unit}`;
  console.log('  ' + r.name.padEnd(W) + val.padStart(10) + '   ' + exp.padEnd(18) +
    (r.ok ? '  ok' : `  OUT OF RANGE (${(r.value / r.hi).toFixed(1)}x high)`));
}
console.log('  ' + '-'.repeat(92));
const bad = results.filter(r => !r.ok);
console.log(`\n  ${results.length - bad.length}/${results.length} within published bounds\n`);
console.log('  INFORMATIONAL (no valid ward-mean-LST benchmark exists — quantity mismatch):');
console.log(`    lever additivity (combined / sum of parts) : ${additivity.toFixed(2)}`);
console.log( '      correct for a surface balance — levers act on disjoint cells and');
console.log( '      overlap only via advection, which this model does not represent');
console.log(`    tree cooling ${treeCooling.toFixed(2)} °C vs WRI air-temp expectation ${expectedByWRIair.toFixed(2)} °C`);
console.log( "      WRI's own SURFACE figure for the same intervention is −27.5 °C;");
console.log( '      our ward-mean LST necessarily sits between air and local surface\n');
for (const r of bad) {
  console.log(`  FAILING: ${r.name}`);
  console.log(`    got ${r.value.toFixed(2)} ${r.unit}, expected ${r.lo}–${r.hi} ${r.unit}`);
  console.log(`    benchmark: ${r.source}\n`);
}
process.exitCode = 0;   // diagnostic only — never blocks a build
