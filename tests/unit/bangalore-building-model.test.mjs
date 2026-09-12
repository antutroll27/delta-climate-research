/**
 * The two defects that ship a Bengaluru city which renders perfectly and is wrong.
 *
 * 1. A NORTH–SOUTH MIRROR. Blender is Z-up; the glTF exporter rotates to Y-up,
 *    so +Z in the model points SOUTH. Reading it as north reflects the whole
 *    ward about its own centre line, and no symmetric statistic can see that:
 *    min, max, mean, sd and |lo+hi| are identical under the mirror, and
 *    check-bangalore-artefacts.py passes mirrored data (measured: exit 0). Only
 *    an ASYMMETRIC EXTERNAL REFERENCE catches it, which is why this file places
 *    published landmarks rather than measuring the mesh's extent.
 *
 * 2. A LANDMARK MATCHER THAT MATCHES NOTHING. three.js strips the dot out of
 *    `lm.ub-tower`, so `startsWith('lm.')` finds zero landmarks in every ward
 *    and folds all 47 into the bulk group — no error, nothing visibly missing.
 *    Task 11's Python test parses raw glTF JSON, where the dot survives, so a
 *    green Python test is NOT evidence the loader works. This one runs the real
 *    three.js sanitiser.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PropertyBinding } from 'three';

import {
  MODEL_TO_SCENE,
  MODEL_WARDS,
  hasBuildingModel,
  landmarkNamesByLoadedName,
  wardLocalFromModel,
} from '../../src/scripts/climate-engine/explore/building-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = join(ROOT, 'public', 'heat-map', 'models');

/** Landmark counts per ward, measured from the shipped GLBs. Indiranagar's zero
 *  is CORRECT: 142 named buildings on measured evidence, none over 40 m. */
const EXPECTED_LANDMARKS = { 'mg-road': 12, whitefield: 35, indiranagar: 0 };

/** Published positions, in the wording and precision `check-bangalore-frame.py`
 *  uses. `id` is the glTF node name with the `lm.` prefix removed. */
const PUBLISHED = [
  { ward: 'mg-road', id: 'm--chinnaswamy-stadium', name: 'M. Chinnaswamy Stadium', lat: 12.9789, lon: 77.5997 },
  { ward: 'mg-road', id: 'ub-tower', name: 'UB Tower', lat: 12.97287, lon: 77.595848 },
  { ward: 'mg-road', id: 'subhas-chandra-bose-tower', name: 'Subhas Chandra Bose Tower', lat: 12.97406, lon: 77.609894 },
];

/** Metres. Generous against a few-metre bbox-centre offset, ruthless against a
 *  mirror, which lands these three 302 m, 576 m and 744 m out. */
const TOLERANCE_M = 60;

function gltfJson(ward) {
  const bytes = readFileSync(join(MODELS, `${ward}.glb`));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

/**
 * Centre of a node's own mesh, in raw glTF axes.
 *
 * The GLB is Draco-compressed, so the vertices cannot be decoded here — but a
 * POSITION accessor's `min` and `max` are REQUIRED to be present in the glTF
 * JSON and survive compression untouched. A bounding-box centre places a
 * landmark to a few metres, two orders of magnitude finer than the error a
 * mirror produces. Node translations are identity; the geometry carries the
 * position.
 */
function modelCentre(json, nodeName) {
  const node = json.nodes.find((n) => n.name === nodeName);
  assert.ok(node, `${nodeName} is not a node in this GLB`);
  const accessor = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
  const mid = (axis) => (accessor.min[axis] + accessor.max[axis]) / 2;
  return { x: mid(0), y: mid(1), z: mid(2) };
}

/**
 * Published degrees → ward metres, THROUGH THE FRAME GATE'S OWN PROJECTION.
 *
 * Shelling out rather than reimplementing `_bangalore.to_local` here is the
 * point: two copies of a projection is how a frame drifts, and this test would
 * then be measuring its own copy rather than the one the artefacts were built
 * and gated with.
 */
function toLocal(ward, lon, lat) {
  const py = [
    'import json, sys',
    'sys.path.insert(0, "scripts")',
    'import _bangalore as blr',
    'print(json.dumps(blr.to_local(blr.WARDS[sys.argv[1]], float(sys.argv[2]), float(sys.argv[3]))))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', py, ward, String(lon), String(lat)], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

test('every published landmark lands within 60 m of where it is published', () => {
  for (const landmark of PUBLISHED) {
    const centre = modelCentre(gltfJson(landmark.ward), `lm.${landmark.id}`);
    const local = wardLocalFromModel(centre.x, centre.y, centre.z);
    const [ex, ey] = toLocal(landmark.ward, landmark.lon, landmark.lat);
    const error = Math.hypot(local.x - ex, local.y - ey);
    assert.ok(error <= TOLERANCE_M,
      `${landmark.name}: the loader places it ${error.toFixed(1)} m from its published `
      + `position (limit ${TOLERANCE_M} m). Expected (${ex.toFixed(1)}, ${ey.toFixed(1)}), `
      + `got (${local.x.toFixed(1)}, ${local.y.toFixed(1)}). A north-south mirror looks exactly like this.`);
  }
});

test('and the same measurement REFUSES the mirror', () => {
  /* A gate that cannot fail is not a gate. Reading +Z as north — the axis this
     loader was originally documented with — must put every one of these
     landmarks far outside the tolerance the test above just passed. */
  for (const landmark of PUBLISHED) {
    const centre = modelCentre(gltfJson(landmark.ward), `lm.${landmark.id}`);
    const [ex, ey] = toLocal(landmark.ward, landmark.lon, landmark.lat);
    const mirrored = Math.hypot(centre.x - ex, centre.z - ey);
    assert.ok(mirrored > 200,
      `${landmark.name}: reading +Z as north is only ${mirrored.toFixed(1)} m out, so this `
      + 'test could not tell the mirror from the truth and proves nothing.');
  }
});

test('the glTF axis flip is one fact, not two', () => {
  /* MODEL_TO_SCENE is derived from wardLocalFromModel precisely so a mirror
     would have to be introduced in both at once. This pins the sign it yields. */
  assert.deepEqual([...MODEL_TO_SCENE], [1, 1, -1],
    'scene-local is (east, up, north) and the glTF is (east, up, -north)');
});

test('landmark nodes survive three.js stripping the dot out of their names', () => {
  for (const [ward, expected] of Object.entries(EXPECTED_LANDMARKS)) {
    const raw = gltfJson(ward).nodes.map((node) => node.name ?? '');
    const matched = landmarkNamesByLoadedName(raw, PropertyBinding.sanitizeNodeName);
    assert.equal(matched.size, expected, `${ward}: matched ${matched.size} landmarks, expected ${expected}`);
    for (const [loaded, original] of matched) {
      assert.ok(original.startsWith('lm.'), `${ward}: ${original} is not a landmark node`);
      assert.equal(loaded, PropertyBinding.sanitizeNodeName(original),
        `${ward}: the matcher keyed ${original} by a name three.js will not produce`);
    }
  }
});

test("and `startsWith('lm.')` on the loaded name would have found NOTHING", () => {
  /* The trap, stated as a measurement: the dot is genuinely in the file, and is
     genuinely gone by the time three.js hands the node over. */
  const raw = gltfJson('mg-road').nodes.map((node) => node.name ?? '');
  assert.equal(raw.filter((name) => name.startsWith('lm.')).length, 12,
    'the GLB really does carry the dotted names');
  const loaded = raw.map((name) => PropertyBinding.sanitizeNodeName(name));
  assert.equal(loaded.filter((name) => name.startsWith('lm.')).length, 0,
    'three.js strips the dot, so the naive matcher folds all 12 into the bulk group');
});

test('MODEL_WARDS is exactly what public/heat-map/models ships', () => {
  /* The list exists so a Kolkata ward neither 404s nor downloads the glTF and
     Draco chunks. This is what keeps it from drifting from the directory. */
  const shipped = readdirSync(MODELS).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual([...MODEL_WARDS].sort(), shipped);
});

test('Kolkata has no model, so it falls back to extrusion', () => {
  for (const ward of ['ballygunge', 'baruipur', 'barrackpore']) {
    assert.equal(hasBuildingModel(ward), false, `${ward} must stay on the extrusion path`);
  }
});
