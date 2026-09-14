/**
 * THE LANDMARK LAYER: the rule it enforces, and the projection it must not copy.
 *
 * 1. A HEIGHT WITH NO STATED SOURCE IS NOT DRAWN AS A LANDMARK. Enforced at
 *    construction, so a sourceless building is unlabelled AND unpickable — not
 *    merely labelled with a caveat. Every assertion about `refused` below is
 *    about that rule being real rather than decorative.
 *
 * 2. IT PROJECTS THROUGH building-pick's `projectWard`, NOT A COPY OF IT. Two
 *    copies of a projection is how a frame drifts: they agree the day they are
 *    written and diverge the day one is fixed, and the symptom — labels sitting
 *    a few metres off the buildings they name — reads as a rendering bug. The
 *    test asserts the layer's label positions EQUAL `projectWard`'s output, so a
 *    reimplementation that differs by so much as a half-pixel fails here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { projectWard } from '../../src/scripts/climate-engine/explore/building-pick.ts';
import { createLandmarkLayer } from '../../src/scripts/climate-engine/explore/landmark-layer.ts';

/**
 * A SIDE-ON synthetic camera looking north, column-major (column j at e[j*4+row]).
 *
 *   clip.x = east / 700      clip.y = up / 200      depth = north / 700      w = 1
 *
 * Deliberately not the top-down ORTHO of heat-map-explore.test.mjs: that matrix
 * has a zero depth row, so every point comes back at depth 0 and the two rules
 * that turn on depth — nearer label wins a collision, nearer landmark wins a
 * click — could not be tested at all. Looking north means two landmarks at the
 * same easting and height land on the SAME PIXEL at DIFFERENT depths, which is
 * exactly the case those rules exist for.
 *
 * `projectWard` takes (east, up, north) and the layer anchors labels at the roof,
 * so a site's `topM` is what feeds clip.y here.
 */
const SIDE_ON = { elements: [
  1 / 700, 0, 0, 0,
  0, 1 / 200, 0, 0,
  0, 0, 1 / 700, 0,
  0, 0, 0, 1,
] };

const W = 1000, H = 1000;

/** A landmark with everything the rule requires. `title` defaults to the id
 *  because most of these tests do not care which is which; the one that does
 *  overrides it. */
const site = (name, over = {}) => ({
  name, title: name, x: 0, y: 0, topM: 100, heightM: 100,
  source: 'CTBUH 13883', ...over,
});

test('a height with no stated source is not drawn as a landmark', () => {
  const layer = createLandmarkLayer([
    site('ub-tower'),
    site('no-source', { source: '' }),
    site('blank-source', { source: '   ' }),
    site('placeholder-source', { source: '?' }),   // too short to be a citation
    site('no-height', { heightM: 0 }),
    site('nan-height', { heightM: Number.NaN }),
  ]);

  assert.deepEqual(layer.sites.map((s) => s.name), ['ub-tower']);
  /* Named, not merely counted: a refusal nobody can list is a silent drop, and
     the whole point of the rule is that it can be audited. */
  assert.deepEqual(layer.refused,
    ['no-source', 'blank-source', 'placeholder-source', 'no-height', 'nan-height']);
});

test('a refused landmark is unlabelled AND unpickable, not just uncited', () => {
  /* The weaker implementation — label it, print "source unknown" — passes any
     test that only checks the label text. This one checks that the refused site
     cannot be reached at all, which is the difference between enforcing the rule
     and displaying it. */
  const layer = createLandmarkLayer([site('unsourced', { source: '' })]);
  assert.equal(layer.labelsFor(SIDE_ON, W, H).length, 0);

  // Click exactly where it would be if it had been admitted.
  const p = projectWard(SIDE_ON, 0, 100, 0, W, H);
  assert.equal(layer.pick(SIDE_ON, p.x, p.y, W, H), null);
});

test('labels land exactly where projectWard puts them — the same projection, not a copy', () => {
  /* `topM` and `heightM` are DIFFERENT NUMBERS and both are set here on purpose:
     topM is measured off the drawn geometry (where the label hangs), heightM is
     the authored figure the citation is a citation for (what the card prints).
     Setting only one of them is what this test caught on its first run. */
  const s = site('ub-tower', { x: 350, y: 120, topM: 123, heightM: 123, title: 'UB Tower' });
  const [label] = createLandmarkLayer([s]).labelsFor(SIDE_ON, W, H);
  const expected = projectWard(SIDE_ON, s.x, s.topM, s.y, W, H);
  assert.equal(label.x, expected.x);
  assert.equal(label.y, expected.y);
  /* The label carries the claim as well as the position, so selecting a chip
     needs no second lookup keyed on a display string. */
  assert.equal(label.name, 'ub-tower');
  /* The HUMAN name, not the slug. `lm.m--chinnaswamy-stadium` un-slugged is not
     "M. Chinnaswamy Stadium", so the name ships in `extras` and travels through
     unchanged — a map that labels a landmark with its id has not got it right. */
  assert.equal(label.title, 'UB Tower');
  assert.equal(label.heightM, 123);
  assert.equal(label.source, 'CTBUH 13883');
});

test('labels are anchored at the ROOF, not at ground level', () => {
  /* A label at the base of a 123 m tower sits behind whatever stands in front of
     it. Under this camera a taller roof is higher on screen (smaller y). */
  const tall = createLandmarkLayer([site('tall', { topM: 150 })]).labelsFor(SIDE_ON, W, H)[0];
  const short = createLandmarkLayer([site('short', { topM: 10 })]).labelsFor(SIDE_ON, W, H)[0];
  assert.ok(tall.y < short.y, `roof anchor ignored: ${tall.y} should be above ${short.y}`);
});

test('overlapping labels collapse to one, and the NEARER landmark keeps it', () => {
  /* Whitefield ships 35 landmarks in a 2.8 km box: zoomed out they are not 35
     labels but one illegible smear over the city they describe. Same easting and
     roof height, different northing — identical pixel, different depth. */
  const near = site('near', { y: 100 });
  const far = site('far', { y: 600 });
  const labels = createLandmarkLayer([far, near]).labelsFor(SIDE_ON, W, H);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].name, 'near',
    'the far landmark won the collision — labels must follow the depth buffer under them');

  // Far enough apart on screen and both survive.
  const apart = createLandmarkLayer([near, site('elsewhere', { x: 400 })]);
  assert.equal(apart.labelsFor(SIDE_ON, W, H).length, 2);
});

test('labels behind the camera or off the canvas are never drawn', () => {
  const behind = { elements: SIDE_ON.elements.map((v, i) => (i === 15 ? -1 : v)) };
  assert.equal(createLandmarkLayer([site('ub-tower')]).labelsFor(behind, W, H).length, 0);

  // 900 m east of centre is past the 700 m half-width of this camera's frame.
  assert.equal(createLandmarkLayer([site('offscreen', { x: 900 })]).labelsFor(SIDE_ON, W, H).length, 0);
});

test('pick: hits the landmark under the pointer, prefers the nearer, misses empty ground', () => {
  const layer = createLandmarkLayer([
    site('far', { y: 600 }),
    site('near', { y: 100 }),
    site('east', { x: 400, source: 'OSM height tag', heightM: 44, title: 'Ambaji' }),
  ]);
  const at = (s) => projectWard(SIDE_ON, s.x ?? 0, s.topM ?? 100, s.y ?? 0, W, H);

  const overlap = at({ x: 0, topM: 100, y: 100 });
  assert.equal(layer.pick(SIDE_ON, overlap.x, overlap.y, W, H).name, 'near');

  const east = at({ x: 400, topM: 100, y: 0 });
  const hit = layer.pick(SIDE_ON, east.x, east.y, W, H);
  assert.equal(hit.name, 'east');
  assert.equal(hit.title, 'Ambaji');
  /* The pick carries the evidence, because the card it feeds prints the source
     next to the height and must never have to guess at one. */
  assert.equal(hit.heightM, 44);
  assert.equal(hit.source, 'OSM height tag');

  // Empty ground is a miss, not a forced nearest match.
  assert.equal(layer.pick(SIDE_ON, 20, 20, W, H), null);
  // And the radius is honoured rather than being decorative.
  assert.equal(layer.pick(SIDE_ON, east.x + 60, east.y, W, H, 40), null);
  assert.ok(layer.pick(SIDE_ON, east.x + 60, east.y, W, H, 90));
});

test('dispose leaves nothing to label or pick', () => {
  /* A stale ward must not label itself over the ward that replaced it. */
  const layer = createLandmarkLayer([site('ub-tower')]);
  assert.equal(layer.labelsFor(SIDE_ON, W, H).length, 1);
  layer.dispose();
  assert.equal(layer.labelsFor(SIDE_ON, W, H).length, 0);
  const p = projectWard(SIDE_ON, 0, 100, 0, W, H);
  assert.equal(layer.pick(SIDE_ON, p.x, p.y, W, H), null);
});
