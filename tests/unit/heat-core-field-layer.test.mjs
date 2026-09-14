import test from 'node:test';
import assert from 'node:assert/strict';

const {
  heatRampRgb, wardFieldCoordinates, createCoreFieldLayer,
} = await import('../../src/scripts/climate-engine/explore/core-field-layer.ts');
const { WARD_MAP } = await import('../../src/data/wards.ts');
const { CITIES } = await import('../../src/data/cities.ts');

test('core heat ramp preserves the relief colour endpoints', () => {
  assert.deepEqual(heatRampRgb(20, 20, 40), [111, 202, 214]);
  assert.deepEqual(heatRampRgb(40, 20, 40), [229, 72, 77]);
});

test('core field coordinates are north-up and clockwise', () => {
  const [nw, ne, se, sw] = wardFieldCoordinates(WARD_MAP.ballygunge, 1400);
  assert.ok(nw[1] > sw[1]);
  assert.ok(ne[1] > se[1]);
  assert.ok(ne[0] > nw[0]);
  assert.ok(se[0] > sw[0]);
});

/* THIS SUITE HAS NO DOM, and this layer's entire job is a canvas, so the two
   doubles below stand in for exactly two things: `document.createElement
   ('canvas')` and the MapLibre map — the same stand-in heat-relief-lifecycle
   .test.mjs already makes for a map. Nothing else is faked. The code under test
   is the real `createCoreFieldLayer`, and both assertions are on its real
   behaviour: the width the real `attach` sets, and the refusal the real
   `update` throws. The ImageData double is a genuine Uint8ClampedArray, so the
   repaint loop really runs over all 384² cells rather than being skipped. */
function harness() {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }),
  };
  globalThis.document = { createElement: () => canvas };
  const sources = new Map();
  const layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, { ...spec, setCoordinates() {} }),
    getLayer: (id) => layers.get(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    setLayoutProperty: () => {},
    removeLayer: (id) => layers.delete(id),
    removeSource: (id) => sources.delete(id),
    triggerRepaint: () => {},
  };
  return { canvas, map };
}

/* THE PHASE'S NEWEST SILENT-FAILURE SURFACE. A canvas left at the grid it was
   constructed with accepts nothing from a differently sized ward — but the
   failure it guards against is the other direction: a field of exactly the
   right length for the WRONG ward, which no bounds check can see. The canvas
   must therefore re-read `n` from the ward being attached, not keep the one it
   opened with. */
test('the canvas re-reads its grid from the attached ward, and refuses the other size', () => {
  const { canvas, map } = harness();
  const bengaluru = CITIES.bengaluru.wards[0];
  assert.equal(bengaluru.footprintM, 2800, 'fixture assumption: Bengaluru wards are 2800 m');

  // Constructed on Kolkata's pair, exactly as heat-map-app does at mount.
  const layer = createCoreFieldLayer(map, 192);
  assert.equal(canvas.width, 192, 'it opens on the grid it was handed');

  layer.attach(bengaluru, bengaluru.footprintM);
  assert.equal(canvas.width, 384, 'a 2800 m ward must resize the canvas to its own 384 grid');
  assert.equal(canvas.height, 384);

  assert.doesNotThrow(() => layer.update(new Float32Array(384 * 384), 20, 40),
    "the attached ward's own field must be accepted");
  assert.throws(() => layer.update(new Float32Array(192 * 192), 20, 40),
    /does not match this ward's 384×384/,
    "Kolkata's 192² field is not this ward's grid, and must be refused rather than mis-strided");
});
