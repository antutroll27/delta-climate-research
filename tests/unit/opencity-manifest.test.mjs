import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifest = JSON.parse(await readFile(join(ROOT, 'data/opencity/manifest.json'), 'utf8'));
const rows = Object.entries(manifest.artefacts);

test('every acquired artefact has a manifest row and is on disk', async () => {
  assert.ok(rows.length >= 10, `only ${rows.length} artefacts — a dataset went missing`);
  for (const [id, row] of rows) {
    const info = await stat(join(ROOT, row.path)).catch(() => null);
    assert.ok(info?.isFile(), `${id}: ${row.path} is not on disk`);
    assert.equal(info.size, row.bytes, `${id}: size drifted from the manifest`);
  }
});

test('the bytes on disk are the bytes that were reviewed', async () => {
  // A hash is the only thing separating "we vetted this file" from "we vetted a
  // file that used to be at this path".
  for (const [id, row] of rows) {
    const digest = createHash('sha256').update(await readFile(join(ROOT, row.path))).digest('hex');
    assert.equal(digest, row.sha256, `${id}: sha256 drift — the file changed under the manifest`);
  }
});

test('a licence is always stated, even when the statement is "not stated"', () => {
  // An absent licence field reads as "fine to use". For a consultancy deliverable
  // that is the expensive assumption, so absence is not permitted — only an
  // explicit admission of ignorance.
  for (const [id, row] of rows) {
    assert.ok(typeof row.licence === 'string' && row.licence.length > 0,
      `${id}: licence empty — say "not stated" explicitly`);
  }
});

test('blocked means blocked', () => {
  // The single mechanical thing standing between a licence-unknown dataset and a
  // future UI that renders it.
  for (const [id, row] of rows) {
    assert.ok(Array.isArray(row.blockers), `${id}: blockers must be a list, even an empty one`);
    if (row.blockers.length > 0) {
      assert.equal(row.display, false, `${id}: has blockers but is marked displayable`);
    }
  }
  const blocked = rows.filter(([, r]) => r.blockers.length > 0).map(([id]) => id);
  assert.deepEqual(blocked, ['kmc-parks'],
    'the blocked set changed — a dataset was cleared or newly blocked without review');
});

test('the parks blockers name both unresolved facts', () => {
  const parks = manifest.artefacts['kmc-parks'];
  assert.equal(parks.blockers.length, 2);
  assert.ok(parks.blockers.some(b => /licence/i.test(b)), 'the unstated licence must stay named');
  assert.ok(parks.blockers.some(b => /unit/i.test(b)), 'the unstated Area units must stay named');
});

test('nothing raw is served to the browser', () => {
  // Raw archives stay pipeline-side; the browser gets derived artefacts only.
  for (const [id, row] of rows) {
    assert.ok(!row.path.startsWith('public/'),
      `${id}: raw archive under public/ — serve a derived artefact instead`);
    assert.ok(row.path.startsWith('data/opencity/'), `${id}: unexpected path ${row.path}`);
  }
});

test('every row can be traced back to its source', () => {
  for (const [id, row] of rows) {
    assert.match(row.source_url, /^https:\/\/data\.opencity\.in\//, `${id}: source_url unusable`);
    assert.match(row.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${id}: retrieved date missing`);
    assert.ok(row.notes.length > 40, `${id}: notes too thin to stop someone re-deriving the finding`);
  }
});

test('the findings that killed routes are recorded verbatim, not summarised away', () => {
  // Each of these cost real investigation. Losing them means someone repeats it.
  const { artefacts } = manifest;
  assert.match(artefacts['water-census'].notes, /ZERO polygons/,
    'the point-only finding must survive — it is why water geometry comes from OSM');
  assert.match(artefacts['kmc-parks'].notes, /Ballygunge/,
    'the KMC-keying finding must survive — it is why the DC-URS route was dropped');
  assert.match(artefacts['microwatersheds'].notes, /2A1A5k3/,
    'the containment result must survive with its polygon ids');
});
