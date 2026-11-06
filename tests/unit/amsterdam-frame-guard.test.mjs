import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* data/cities/amsterdam/frame-guard.json is written by `scripts/check-city-frame.py --measure` and
   re-verified in CI by `npm run check:cities-frame`. This test holds the RECORD itself to account in
   the unit gate: every guard passes, every one compared north-up against a deliberately mirrored copy,
   the recorded inputs are the committed files, and the three statistics a mirror cannot fake are
   actually separated. A guard that passes on both orientations proves nothing, so we assert the gap. */

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT));
const fg = JSON.parse(read('data/cities/amsterdam/frame-guard.json'));
const byId = Object.fromEntries(fg.guards.map((g) => [g.id, g]));

test('all eight guards are recorded, and all pass', () => {
  assert.deepEqual(fg.guards.map((g) => g.id), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']);
  for (const g of fg.guards) assert.equal(g.status, 'pass', `${g.id} ${g.name}`);
});

test('the record describes the committed files (sha256), so a stale measurement cannot stand', () => {
  for (const [name, hash] of Object.entries(fg.inputs)) {
    assert.equal(createHash('sha256').update(read(`data/cities/amsterdam/${name}`)).digest('hex'), hash, name);
  }
});

test('north-up beats the mirrored copy by a wide margin on every asymmetric statistic', () => {
  assert.ok(byId.G2.north < 0.05 && byId.G2.mirrored > 1, 'ring self-consistency');
  assert.ok(byId.G3.north <= 0.01 && byId.G3.mirrored >= 5 * byId.G3.north, 'buildings on water');
  assert.ok(byId.G4.north <= 60 && byId.G4.mirrored >= 100, 'landmarks');
  assert.ok(byId.G5.north >= 0.8 && byId.G5.mirrored <= 0.3, 'heights vs AHN nDSM');
  assert.ok(byId.G6.north >= 2 * byId.G6.mirrored, 'DTM nodata mask vs footprints + water');
  assert.ok(byId.G7.north > 0 && byId.G7.north >= 2 * byId.G7.mirrored, 'park vegetation contrast');
  assert.equal(byId.G8.detail.flippedEqual, true);
  assert.equal(byId.G8.detail.unflippedEqual, false);
});

test('G4 uses four landmarks resolved from Wikidata with the date recorded, none of them inside a symmetric position', () => {
  const lm = JSON.parse(read('data/cities/amsterdam/landmarks.json'));
  assert.equal(lm.landmarks.length, 4);
  for (const l of lm.landmarks) {
    assert.match(l.qid, /^Q\d+$/);
    assert.equal(l.retrieved, lm.retrieved);
  }
  const ys = Object.values(byId.G4.detail.perLandmark).map((v) => Math.abs(v.y));
  assert.ok(ys.every((y) => y > 300), 'a landmark near y = 0 is its own mirror and tests nothing');
});

test('the height cross-check is recorded per building and never blended into h', () => {
  const doc = JSON.parse(read('data/cities/amsterdam/canal-ring-buildings.json'));
  const withCheck = doc.b.filter((b) => b.hCheck !== null);
  assert.ok(withCheck.length > 0.9 * doc.b.length, 'hCheck on most buildings');
  assert.ok(doc.b.some((b) => b.flag), 'some buildings are flagged');
  assert.ok(doc.b.every((b) => b.flag === (b.hCheck !== null && Math.abs(b.h - b.hCheck) > 5)), 'flag means |h - hCheck| > 5 m, nothing else');
  assert.match(doc.crossCheck, /never blended into h/);
  const exported = JSON.parse(read('public/heat-map/data/canal-ring.json'));
  assert.deepEqual(exported.b.slice(0, 20).map((r) => r[0]), doc.b.slice(0, 20).map((b) => Math.round(b.h * 100) / 100), 'the exported h is the 3D BAG h');
});
