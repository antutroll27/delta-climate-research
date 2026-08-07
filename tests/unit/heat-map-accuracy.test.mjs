import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACCURACY, HEIGHTS, bandLabel, assertAccuracyLogic } from '../../src/scripts/climate-engine/accuracy.ts';
import { assertSkyLogic } from '../../src/scripts/climate-engine/sky.ts';
import { assertInterventionLogic } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('published accuracy figures never overstate measured performance', () => {
  assertAccuracyLogic();
});

test('sky temperature, dewpoint and solar geometry hold their invariants', () => {
  assertSkyLogic();
});

test('intervention model holds, including the night-ET humidity continuity', () => {
  assertInterventionLogic();
});

test('the UI figures match the ward-scale calibration that produced them', async () => {
  // accuracy.ts mirrors a generated JSON by hand. If someone recalibrates and
  // forgets to update it, the site publishes an accuracy claim its own evidence
  // no longer supports.
  //
  // Sourced from ward-scale-fit.json, not model-accuracy.json: the latter is the
  // superseded GHS-SMOD mask calibration, which scored the model against a
  // landscape that is not the ward the product renders.
  const fit = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/ward-scale-fit.json'), 'utf8'));
  const obs = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/ward-observations.json'), 'utf8'));
  // model-accuracy.json is where the generated record of any drift lives.
  const accuracyJson = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/model-accuracy.json'), 'utf8'));

  // ECOSTRESS ONLY. ward-observations.json now carries two instruments, and
  // accuracy.ts's figures were computed on ECOSTRESS alone — counting Landsat
  // rows against an ECOSTRESS-derived constant compares nothing to nothing.
  const eco = obs.rows.filter((r) => (r.sensor ?? 'ecostress') === 'ecostress');

  // Drift is allowed to EXIST but never to be SILENT. The evidence set grows on
  // its own: NASA POWER's hourly product lags real time, so an overpass can gain
  // its forcing months later and legitimately enter the set. What must be
  // impossible is publishing a figure whose evidence has moved without anyone
  // recording it — so a mismatch is only tolerated when measure-accuracy.py has
  // written down exactly what moved.
  const pending = accuracyJson?.ward_scale?.pending_recalibration ?? null;
  for (const [phase, key] of [['night', 'night'], ['peak', 'day']]) {
    const n = eco.filter((r) => r.phase === key).length;
    if (ACCURACY[phase].n === n) continue;
    assert.ok(pending,
      `${phase}: accuracy.ts says n=${ACCURACY[phase].n} but the ECOSTRESS set now `
      + `holds ${n} — and nothing recorded the drift. Re-run scripts/measure-accuracy.py.`);
    assert.equal(pending.ecostress_rows_now[key], n,
      `${phase}: the recorded drift (${pending.ecostress_rows_now[key]}) does not match `
      + `the file (${n}) — the record is stale, which is worse than no record.`);
    assert.equal(pending.published_in_accuracy_ts[phase], ACCURACY[phase].n,
      `${phase}: the record claims accuracy.ts publishes `
      + `${pending.published_in_accuracy_ts[phase]}, but it publishes ${ACCURACY[phase].n}.`);
  }
  // and the calibration must still be the one marked not-yet-adopted-by-hand
  assert.equal(typeof fit.meets_all_criteria !== 'undefined', true,
    'ward-scale-fit.json should record whether the fit met its stated criteria');
});

test('HEIGHTS mirrors the ICESat-2 artefact it claims to summarise', async () => {
  // Same failure mode as the ward-scale test above, on a claim that is harder to
  // sanity-check by eye: accuracy.ts carries the ICESat-2 numbers by hand, so a
  // re-run of measure-height-accuracy.py that moves the verdict or the counts
  // would otherwise leave the site publishing a height claim its own evidence no
  // longer makes. EVERY published field is pinned, not a representative few —
  // the ones most likely to be quietly "tidied" are the caveat numbers, not the
  // headline.
  const j = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/icesat2-heights.json'), 'utf8'));
  const s = j.summary;

  assert.equal(HEIGHTS.verdict, s.verdict);
  assert.equal(HEIGHTS.nBuildings, s.n_buildings);
  assert.equal(HEIGHTS.minBuildings, s.min_buildings);
  assert.equal(HEIGHTS.nPasses, s.n_passes);
  assert.equal(HEIGHTS.nRgts, s.n_rgts);

  // THE ARTEFACT ITSELF MUST BE BELOW THE BAR AND SILENT. This is the pin that
  // matters most in this state: spec §5.3 admits no statistic under n = 30, so
  // if a future run publishes one, the mirror in accuracy.ts is not what should
  // change first — the verdict is. Checking the artefact rather than only
  // accuracy.ts means a bias reappearing upstream cannot slip past because
  // nobody copied it down.
  assert.equal(s.verdict === 'underpowered', s.n_buildings < s.min_buildings,
    'the artefact\'s verdict and its n must be the same fact');
  if (s.verdict === 'underpowered') {
    for (const k of Object.keys(s)) {
      assert.ok(!/bias|ci95|perm_p|ks_d/.test(k),
        `the artefact is underpowered but summary.${k} publishes a statistic anyway`);
    }
    assert.equal(j.floor_sensitivity, null,
      'floor_sensitivity is bias statistics — it must stay absent below the bar');
  }

  // The concentration caveat: which ward holds most of the cohort, and how much.
  const wards = Object.entries(j.per_ward);
  const [topWard, top] = wards.reduce((a, b) => (b[1].n_buildings > a[1].n_buildings ? b : a));
  assert.equal(HEIGHTS.topWard, topWard);
  assert.equal(HEIGHTS.topWardBuildings, top.n_buildings);
  assert.equal(
    wards.reduce((n, [, w]) => n + w.n_buildings, 0), s.n_buildings,
    'the per-ward counts must add up to the published cohort size');

  // The selection effect, recomputed from the artefact rather than trusted: the
  // note quotes this range as "the largest 7-28 % of each ward".
  const shares = Object.keys(j.excluded.buildings_in_ward).map((w) => Number(
    (100 * j.excluded.buildings_survived_erosion[w] / j.excluded.buildings_in_ward[w])
      .toFixed(1)));
  assert.equal(HEIGHTS.erosionM, j.excluded.erosion_m);
  assert.deepEqual([...HEIGHTS.survivorPctRange], [Math.min(...shares), Math.max(...shares)]);
  assert.ok(HEIGHTS.note.includes(
    `${Math.round(HEIGHTS.survivorPctRange[0])}-${Math.round(HEIGHTS.survivorPctRange[1])} %`),
    'the note quotes the survivor share to whole percent — it must be the measured one');

  // The SECOND selection, which the erosion figure alone hides: the roof-photon
  // bar removed more crossed buildings than anything else did.
  assert.equal(HEIGHTS.minRoofPhotons, j.excluded.min_roof_photons);
  assert.equal(HEIGHTS.buildingsCrossed, j.excluded.buildings_crossed_pooled);
  assert.equal(HEIGHTS.buildingsTooFewRoofPhotons, j.excluded.n_too_few_roof_ph);

  // The §5.1 pointwise relief gate (CORRECTION 2026-08-07) — the correction that
  // produced this verdict, so its counts are published and pinned like any other
  // exclusion. spec §5.4: a drop that is not counted reads as coverage.
  assert.equal(HEIGHTS.groundReliefM, j.excluded.ground_relief_m);
  assert.equal(HEIGHTS.groundWindowsGated, j.excluded.ground_windows_gated);
  assert.equal(HEIGHTS.buildingsGroundRefused, j.excluded.n_ground_refused);
  assert.ok(j.excluded.photons_over_gated_ground_windows > 0,
    'the gate refused windows but counted no photons over them — §5.4 forbids a '
    + 'silent exclusion, and a zero here would mean the ledger is not wired up');

  // The method-stability evidence: it exists, it is marked unpublished, and the
  // shipped allowance is one of the rows rather than a value nobody swept.
  const ms = j.method_stability;
  assert.equal(ms.published, false,
    'method_stability is method evidence below the bar — it must never be flagged as '
    + 'a published result');
  const shipped = ms.relief_allowances.filter((r) => r.shipped);
  assert.equal(shipped.length, 1);
  assert.equal(shipped[0].relief_m, HEIGHTS.groundReliefM);
  assert.equal(new Set(ms.relief_allowances.map((r) => r.verdict)).size, 1,
    'the note and the HEIGHTS comment both claim the relief allowance does not move '
    + 'the verdict — if that stops being true, the claim must be rewritten, not the '
    + 'allowance re-picked');
  assert.equal(shipped[0].verdict, s.verdict,
    'the shipped allowance\'s sweep row must reproduce the published verdict');

  // The floor caveat, which spec §5.3 requires to travel beside the method: the
  // 2 m roof-band floor deletes low returns and so acts on any bias positively.
  assert.equal(HEIGHTS.roofFloorM, j.excluded.roof_band_m[0]);
  assert.equal(HEIGHTS.roofPhotonsBelowFloor, j.excluded.roof_photons_below_band);

  // The fill cohort ships as a verdict and a count only — never as a number.
  assert.equal(HEIGHTS.fill.n, j.fill.n);
  assert.equal(HEIGHTS.fill.minN, j.fill.min_n);
  assert.equal(HEIGHTS.fill.verdict, j.fill.verdict);

  // Terrain: measured, gates nothing, unaffected by the ground-line correction,
  // but still must not drift from its artefact.
  assert.equal(HEIGHTS.demMinusLaserGroundM, j.terrain.dem_minus_laser_ground_m);

  // Finally, the sentences the reader actually sees must match the numbers above:
  // a rounded figure in the note is the easiest thing to leave behind.
  assert.ok(HEIGHTS.note.includes(`n = ${HEIGHTS.nBuildings} buildings`),
    'the note states n — it must be the artefact\'s n');
  assert.ok(HEIGHTS.note.includes(`minimum of ${HEIGHTS.minBuildings}`),
    'the note states the pre-registered bar — it must be the artefact\'s bar');
  assert.ok(HEIGHTS.note.includes(`${HEIGHTS.topWardBuildings} of `),
    'the note states the one-ward concentration — it must be the artefact\'s count');
  assert.ok(HEIGHTS.note.includes(`${HEIGHTS.erosionM} m erosion`),
    'the note quotes the erosion — it must be the artefact\'s erosion');
  assert.ok(HEIGHTS.note.includes(`${HEIGHTS.minRoofPhotons} roof photons`),
    'the note quotes the roof-photon bar — it must be the artefact\'s bar');

  // THE ONE FIGURE AN UNDERPOWERED VERDICT STILL PERMITS. Everything else was
  // withheld, so this is the only number in the sentence and a stale one would
  // be both invisible and the whole of what the note asserts.
  const dsm = HEIGHTS.note.match(/about ([\d.]+) m above laser ground/);
  assert.ok(dsm, 'the note must quote the DEM-minus-laser offset in those words');
  assert.ok(Math.abs(Number(dsm[1]) - j.terrain.dem_minus_laser_ground_m) < 0.05,
    `the note says ${dsm?.[1]} m but the artefact measured `
    + `${j.terrain.dem_minus_laser_ground_m} m`);

  // ... and NO other statistic may have crept into the sentence.
  assert.ok(!/\bbias(ed)?\b|\bCIs?\b|confidence interval|excludes zero/i.test(HEIGHTS.note),
    'the cohort is underpowered, so the note may not quote a difference or an interval');
});

test('daytime is never presented as more certain than night', () => {
  // RELATIONSHIPS, not literals. Pinning "± 5.0" here made this test fail on
  // every recalibration for no reason except that the numbers moved — which is
  // what a calibration is supposed to do. What must never change is the ordering
  // and the labelling.
  assert.ok(ACCURACY.peak.bandK > ACCURACY.night.bandK,
    'the daytime band must always be wider than the night band');
  assert.equal(ACCURACY.peak.confidence, 'indicative');
  assert.equal(ACCURACY.night.confidence, 'quantitative');
  assert.match(bandLabel('peak'), /^± \d+\.\d$/);
  assert.match(bandLabel('night'), /^± \d+\.\d$/);
  // the displayed band must never understate the measured error
  for (const k of ['peak', 'night']) {
    assert.ok(ACCURACY[k].bandK >= ACCURACY[k].modelRmseK,
      `${k}: displayed band understates measured RMSE`);
    assert.ok(ACCURACY[k].modelRmseK >= ACCURACY[k].ceilingRmseK,
      `${k}: model cannot beat the best predictor its own data supports`);
  }
});
