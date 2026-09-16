import test from 'node:test';
import assert from 'node:assert/strict';

/* The renderer's constructor, setWard and updateField touch no WebGL — they
   allocate typed arrays and a DataTexture, both of which are plain CPU objects
   until a context exists. So the grid-sizing contract is testable in node
   without a browser, which is the half of this renderer that has ever been
   wrong. */
const { createReliefRenderer } = await import('../../src/scripts/climate-engine/explore/relief-renderer.ts');

/** [height, x0,z0, x1,z1, …] — one square, large enough for buildRegistry to keep. */
const RING = [12, -5, -5, 5, -5, 5, 5, -5, 5];

function bundle(sizeM) {
  return {
    /* A Kolkata ward, so this stays on the extrusion path and the grid contract
       is measured without a model fetch in the way. */
    wardId: 'ballygunge',
    wardData: { center: [77.6, 12.97], sizeM, count: 1, b: [RING] },
    roads: { ways: [] },
    water: { polys: [] },
    terrain: null,
    mercatorOrigin: { x: 0, y: 0, z: 0 },
    frame: { east: 1, north: 1, up: 1 },
    veg: null,
  };
}

function renderer(simulationGridSize) {
  return createReliefRenderer({
    map: { triggerRepaint() {} },
    reducedMotion: true,
    simulationGridSize,
    terrainGridSize: 96,
  });
}

const field = (n) => ({ field: new Float32Array(n * n), coolingMask: null, ramp: [20, 40] });

/* THE BUG THIS PINS. The field buffers were allocated ONCE in the constructor,
   from the grid of whichever ward was open when the Three chunk resolved. Open
   Ballygunge (1400 m, 192²) and then a Bengaluru ward (2800 m, 384²) and the
   renderer poured a 147,456-cell field into 36,864-cell buffers — updateField's
   own guard threw a RangeError and the city did not draw at all. */
test('a 2800 m ward resizes the field buffers a 1400 m ward allocated', () => {
  const relief = renderer(192);
  relief.setWard(bundle(1400));
  relief.updateField(field(192));

  relief.setWard(bundle(2800));
  assert.doesNotThrow(() => relief.updateField(field(384)),
    'a 384² field must render after a 192² ward');
});

/* The reverse order is the shipping case today — Kolkata must keep working once
   a Bengaluru ward has been opened, which means the resize goes both ways. */
test('a 1400 m Kolkata ward still renders after a 2800 m Bengaluru one', () => {
  const relief = renderer(192);
  relief.setWard(bundle(2800));
  relief.updateField(field(384));

  relief.setWard(bundle(1400));
  assert.doesNotThrow(() => relief.updateField(field(192)),
    'Kolkata must render unchanged after Bengaluru');
});

/* The resize must not become a reason to accept ANY field. The guard is what
   makes a grid mismatch loud instead of a mis-strided, plausible-looking wrong
   city, so it has to keep firing — now against the OPEN ward's grid. */
test('the guard still refuses a field that does not match the open ward', () => {
  const relief = renderer(192);
  relief.setWard(bundle(2800));
  assert.throws(() => relief.updateField(field(192)), RangeError,
    'a 192² field must still be refused while a 2800 m ward is open');

  relief.setWard(bundle(1400));
  assert.throws(() => relief.updateField(field(384)), RangeError,
    'a 384² field must still be refused while a 1400 m ward is open');
});

/* A ward size with no admitted (grid, size) pair must refuse rather than invent
   a grid — the same refusal requireGrid makes everywhere else. */
test('an unadmitted ward size is refused, not guessed', () => {
  const relief = renderer(192);
  assert.throws(() => relief.setWard(bundle(2000)), RangeError);
});
