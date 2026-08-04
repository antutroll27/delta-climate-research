import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];

const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const shipped = Object.fromEntries(await Promise.all(
  WARDS.map(async w => [w, await read(`public/heat-map/data/${w}.json`)])));
const staged = Object.fromEntries(await Promise.all(
  WARDS.map(async w => [w, await read(`data/geometry/staging/${w}.json`)])));

test('the shipped geometry IS the Overture set, with its provenance intact', () => {
  // THIS TEST CHANGED JOB AT SHIP. Before shipping it asserted public/ was
  // untouched -- the guarantee that no pipeline script wrote there outside a
  // reviewed step. That guarantee has now been deliberately spent, so the test
  // pins what shipped instead of pinning that nothing had. Deleting it would
  // have removed the only assertion that the served geometry is what we measured.
  const EXPECTED = { ballygunge: 3527, barrackpore: 4702, baruipur: 4538 };
  for (const w of WARDS) {
    assert.equal(shipped[w].count, EXPECTED[w],
      `${w}: served count is not the measured Overture count`);
    assert.match(shipped[w].source, /Overture/, `${w}: shipped source is not Overture`);
    assert.match(shipped[w].source, /ODbL/, `${w}: shipped source dropped the licence`);
  }
});

test('staged geometry is schema-identical, so every consumer keeps working', () => {
  // rasterizeWardBuilt, the pick registry, compute-far.py, Compare and the 3D
  // scene all read this shape. A key that appears or vanishes breaks one of them
  // silently, because they index rather than validate.
  for (const w of WARDS) {
    assert.deepEqual(Object.keys(staged[w]).sort(), Object.keys(shipped[w]).sort(),
      `${w}: schema drifted from the shipped artefact`);
    assert.equal(staged[w].sizeM, shipped[w].sizeM, `${w}: window size changed`);
    assert.deepEqual(staged[w].center, shipped[w].center, `${w}: ward centre moved`);
    assert.equal(staged[w].count, staged[w].b.length, `${w}: count disagrees with rows`);
  }
});

test('staging and shipped agree, so a re-bake can never drift unnoticed', () => {
  // Post-ship these are the same artefact by construction. If a future
  // regeneration changes staging without a matching ship, this catches the
  // divergence rather than letting the served file quietly fall behind the
  // pipeline that is supposed to produce it.
  for (const w of WARDS) {
    assert.equal(staged[w].count, shipped[w].count,
      `${w}: staging (${staged[w].count}) has drifted from shipped (${shipped[w].count}) — re-bake or re-ship`);
    assert.equal(staged[w].heightsNote, shipped[w].heightsNote,
      `${w}: staging and shipped disagree about how the heights were made`);
  }
});

test('every row is a well-formed [height, x0,y0, …] ring inside its window', () => {
  for (const w of WARDS) {
    const half = staged[w].sizeM / 2 + 60;      // the acquisition's clip envelope
    for (const row of staged[w].b) {
      assert.ok(row.length >= 7 && row.length % 2 === 1,
        `${w}: malformed row of length ${row.length}`);
      assert.ok(row[0] >= 2.5 && row[0] <= 200,
        `${w}: implausible height ${row[0]} m`);
      for (let i = 1; i < row.length; i++) {
        assert.ok(Number.isFinite(row[i]) && Math.abs(row[i]) <= half,
          `${w}: vertex ${row[i]} escapes the window envelope`);
      }
    }
  }
});

test('the heights say plainly that they are not independently validated', () => {
  // Task 3 matched 6 OSM building:levels tags against a threshold of 8. The
  // artefact must not let a downstream reader mistake p65 for a validated
  // measurement — an underpowered test is a result, and it travels with the data.
  for (const w of WARDS) {
    assert.match(staged[w].heightsNote, /UNDERPOWERED/,
      `${w}: heightsNote hides that the validation was underpowered`);
    assert.match(staged[w].heightsNote, /p65/, `${w}: heightsNote does not name the method`);
    assert.match(staged[w].heightsNote, /fill/i,
      `${w}: heightsNote drops the 2.5 m no-confidence convention`);
    assert.match(staged[w].source, /Overture/, `${w}: source does not name the footprint origin`);
    assert.match(staged[w].source, /ODbL/, `${w}: source drops the licence`);
  }
});

test('the delta table carries every number the ship decision needs', async () => {
  // Recorded so the decision is reproducible from the repo rather than from a
  // conversation. If a field goes missing, the evidence for shipping went with it.
  const t = await read('data/calibration/geometry-replacement.json');
  for (const w of WARDS) {
    const row = t.wards[w];
    assert.ok(row, `${w} missing from the delta table`);
    for (const k of ['buildings', 'far', 'built_fraction']) {
      assert.ok(Array.isArray(row[k]) && row[k].length === 2 && row[k].every(Number.isFinite),
        `${w}.${k} is not a before/after pair of numbers`);
    }
    assert.ok(Number.isFinite(t.sim_delta_K[w].peak) && Number.isFinite(t.sim_delta_K[w].night),
      `${w}: sim delta missing — the published ward mean moves and must be measured`);
  }
  assert.match(t.accuracy_rerun.measure_accuracy, /byte-identical/i,
    'the accuracy re-run verdict was dropped');
  assert.match(t.accuracy_rerun.direction_check, /caveat/i,
    'the direction check lost its caveats — it is level agreement, not per-ward validation');
});

test('the sim shift stays well inside the published bands', async () => {
  // The bands are +/-4.5 K peak and +/-3.0 K night (accuracy.ts). Measured worst
  // case is -0.68 K. This is not a pass/fail on the geometry; it is a tripwire
  // for a FUTURE regeneration quietly moving the displayed figure much further.
  const t = await read('data/calibration/geometry-replacement.json');
  for (const w of WARDS) {
    const { peak, night } = t.sim_delta_K[w];
    assert.ok(Math.abs(peak) < 4.5, `${w}: peak shift ${peak} K reaches the published band`);
    assert.ok(Math.abs(night) < 3.0, `${w}: night shift ${night} K reaches the published band`);
    assert.ok(peak <= 0 && night <= 0,
      `${w}: shift turned WARMER (${peak}/${night} K) — less roof should not heat the ward`);
  }
});
