import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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

test('nothing shipped before the delta table was reviewed', () => {
  // The load-bearing guarantee of this whole phase. Every script writes to
  // data/geometry/staging/; only a deliberate, reviewed ship step may touch
  // public/. If a pipeline script ever writes there directly, this fails.
  const dirty = execSync('git status --porcelain public/heat-map/data/', { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean)
    .filter(line => WARDS.some(w => line.includes(`${w}.json`)) && !line.includes('-'));
  assert.deepEqual(dirty, [],
    `a pipeline script modified shipped ward geometry outside the ship step: ${dirty}`);
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

test('the replacement adds buildings and never loses them', () => {
  // Measured 2026-08-04: +72 / +57 / +29 %. Overture merges OSM + Google +
  // Microsoft, so our current source is one of its inputs — a superset by
  // construction. A staged set SMALLER than shipped means the acquisition
  // filtered too hard, not that Kolkata lost buildings.
  for (const w of WARDS) {
    assert.ok(staged[w].count > shipped[w].count,
      `${w}: ${staged[w].count} staged vs ${shipped[w].count} shipped — the replacement lost buildings`);
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
