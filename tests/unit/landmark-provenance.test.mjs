/**
 * THE RULE THAT GATES THE LANDMARK LAYER: a height with no stated source is not
 * drawn as a landmark.
 *
 * A landmark is the one building on the map whose height the instrument asserts
 * BY NAME. "UB Tower is 123 m" is a claim about the world, and the only thing
 * separating it from a guess is the citation behind it — so the citation has to
 * survive every hop from the JSON that measured it to the pixel that draws it.
 *
 * IT DID NOT SURVIVE. `blender_bangalore.py` sets `height_m` and `height_source`
 * as Blender custom properties on every `lm.` object, and the glTF exporter maps
 * custom properties onto node `extras` ONLY when `export_extras=True` — which
 * was missing. So all 47 landmark nodes shipped with their provenance silently
 * dropped at the export boundary, and `building-model.ts` — which already reads
 * `extras` — found nothing to read. Nothing errored. The nodes were all there,
 * correctly named and correctly placed. Only the evidence was gone.
 *
 * THIS TEST PARSES THE RAW glTF JSON, WHICH IS NOT THE BROWSER'S VIEW. In the
 * file the node is genuinely `lm.ub-tower`; three.js hands the loader
 * `lmub-tower`, because `PropertyBinding.sanitizeNodeName` strips the dot. So a
 * green result here is evidence about the SHIPPED ARTEFACT and nothing else —
 * `bangalore-building-model.test.mjs` runs the real sanitiser and is what proves
 * the loader still finds these nodes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = join(ROOT, 'public', 'heat-map', 'models');

/**
 * The `lm.` nodes of a ward's shipped GLB, straight out of the container's JSON
 * chunk.
 *
 * Read here rather than shelled out to python: the GLB header is four fields and
 * the dot survives in both languages, so a subprocess per ward would buy nothing
 * but a dependency on an interpreter and a heredoc. Same reader the sibling
 * `bangalore-building-model.test.mjs` already uses.
 */
function landmarksOf(ward) {
  const bytes = readFileSync(join(MODELS, `${ward}.glb`));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  return (json.nodes ?? []).filter((node) => (node.name ?? '').startsWith('lm.'));
}

/** Measured from the shipped GLBs, and pinned so a silent export regression that
 *  drops landmark nodes cannot pass this file by having nothing left to check. */
const EXPECTED = { 'mg-road': 12, whitefield: 35 };

test('every landmark node carries a height and a source', () => {
  for (const [ward, count] of Object.entries(EXPECTED)) {
    const landmarks = landmarksOf(ward);
    /* A loop over an empty list passes every assertion inside it. Without this
       line, an export that shipped ZERO landmarks would be indistinguishable
       from one that shipped 35 perfectly cited ones. */
    assert.equal(landmarks.length, count,
      `${ward}: expected ${count} lm. nodes, found ${landmarks.length}`);

    for (const node of landmarks) {
      const extras = node.extras ?? {};
      assert.ok(Number(extras.height_m) > 0,
        `${ward}/${node.name}: no height_m in extras. The exporter needs `
        + 'export_extras=True, or the custom properties never leave Blender.');
      assert.ok(String(extras.height_source ?? '').length > 3,
        `${ward}/${node.name}: no height_source — a height with no stated source `
        + 'is not a landmark.');
    }
  }
});

test('Indiranagar has no landmarks, and that is CORRECT', () => {
  /* Asserted, not tolerated. 142 named buildings on measured evidence and not
     one over 40 m: Indiranagar is a genuinely low-rise ward, so zero is the
     right answer and a future export that "fixed" it would be the regression. */
  assert.equal(landmarksOf('indiranagar').length, 0,
    '142 named buildings on measured evidence, none over 40 m — a low-rise ward');
});

test('the cited landmarks name a real source, not a placeholder', () => {
  /* height_source falls back to a constructed string when nothing is published
     ("OSM height tag", "OSM building:levels=12"). That is still a stated source
     and still passes above. This test pins the OTHER end: where a published
     figure exists it must reach the file verbatim, because "CTBUH 13883" is the
     whole reason a reader should believe 123 m. */
  const byName = new Map(landmarksOf('mg-road').map((n) => [n.name, n.extras ?? {}]));
  const ub = byName.get('lm.ub-tower');
  assert.ok(ub, 'lm.ub-tower is not in mg-road.glb');
  assert.equal(Number(ub.height_m), 123);
  assert.match(String(ub.height_source), /CTBUH/);

  /* The stadium's roof line is ESTIMATED, and the file says so in its own words.
     A landmark layer that printed this as a citation would be the dishonest
     case this whole rule exists to prevent. */
  const stadium = byName.get('lm.m--chinnaswamy-stadium');
  assert.ok(stadium, 'lm.m--chinnaswamy-stadium is not in mg-road.glb');
  assert.match(String(stadium.height_source), /estimated/i);
});
