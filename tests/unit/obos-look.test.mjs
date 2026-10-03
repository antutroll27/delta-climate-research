import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CLASSIC, CLASSIC_STUDIO_LIGHT, CLAY, EDITORIAL_STUDIO_LIGHT, GLINT_MIN_SUN_Y, LOOK, STUDIO_LIGHT,
  glintSun, lookFromSearch,
} from '../../src/scripts/climate-engine/explore/look.ts';
import { maplibreSky, sunPlacement } from '../../src/scripts/climate-engine/explore/sun-lighting.ts';

/**
 * THE OBOS LOOK, AND WHAT IT IS NOT ALLOWED TO BECOME.
 *
 * The editorial look ("D") became the default on 2026-10-02 (explore/look.ts).
 * Most of what it is can only be judged by eye, and was — four preview rounds,
 * screenshots, a founder's pick. What CAN be held by a test is the set of lines
 * it must never cross, and the rollback that must keep working:
 *
 *   · no cast shadows, anywhere in the engine — a scientific constraint, not a taste;
 *   · no bloom and no post-processing composer;
 *   · the water's glint is aimed at the real sun, not at a constant;
 *   · the base palette stays out of the heat ramp's red/orange band;
 *   · `?look=classic` still selects the shipped-until-then path, byte for byte.
 *
 * GUARD THE GUARD. Several guards in this project have passed while protecting
 * nothing — iterating a list that came back empty, or reading a file that was
 * not there. So every walk below counts what it read, every regex is shown the
 * offender it was written against, and every extraction fails loudly when it
 * finds nothing to extract.
 */

const ENGINE_ROOT = new URL('../../src/scripts/climate-engine/', import.meta.url);
const COMPONENT_ROOT = new URL('../../src/components/ClimateEngine/', import.meta.url);

/** Comments are not code: a shadow or a bloom named in prose must not count. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

/** Every .ts / .astro file under a root, recursively. `._` files are exFAT sidecars. */
async function sourceFiles(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) { found.push(...await sourceFiles(next, `${prefix}${entry.name}/`)); continue; }
    if (!/\.(ts|astro)$/.test(entry.name) || entry.name.startsWith('._')) continue;
    found.push([`${prefix}${entry.name}`, next]);
  }
  return found;
}

/** The engine and its components: every file that can put a pixel in the OBOS scene. */
async function obosFiles() {
  const files = [
    ...(await sourceFiles(ENGINE_ROOT)).map(([rel, url]) => [`climate-engine/${rel}`, url]),
    ...(await sourceFiles(COMPONENT_ROOT)).map(([rel, url]) => [`ClimateEngine/${rel}`, url]),
  ];
  /* Ninety-odd files today. A walk that came back with a handful has stopped
     walking — the renderer, the layers and the explore folder must all be in it. */
  assert.ok(files.length >= 60, `only ${files.length} OBOS source files were found -- the walk is broken`);
  for (const must of ['climate-engine/explore/relief-renderer.ts', 'climate-engine/water-layer.ts',
    'climate-engine/vegetation-layer.ts', 'climate-engine/road-layer.ts', 'climate-engine/heat-map-app.ts']) {
    assert.ok(files.some(([rel]) => rel === must), `${must} is missing from the walk`);
  }
  return files;
}

const read = (rel) => readFile(new URL(rel, ENGINE_ROOT), 'utf8');

/** The text strictly between two markers, or a loud failure. */
function between(src, open, close, what) {
  const i = src.indexOf(open);
  assert.ok(i >= 0, `${what}: could not find its opening marker -- the extraction is stale`);
  const j = src.indexOf(close, i + open.length);
  assert.ok(j >= 0, `${what}: could not find its closing marker -- the extraction is stale`);
  return src.slice(i + open.length, j);
}

/* ────────────────────────────────────────────────────────────────────────────
   NO CAST SHADOWS.
   ──────────────────────────────────────────────────────────────────────────── */

/** The three ways three.js is told to draw a shadow. Any one is a shadow pass. */
const SHADOW = /\bcastShadow\s*=\s*true\b|\breceiveShadow\b|\bshadowMap\s*\.\s*enabled\b/;

test('no cast shadows anywhere in the OBOS scene', async () => {
  /* THIS IS A SCIENTIFIC CONSTRAINT, NOT A STYLE. The surface-temperature model has
     no shade term: `sun` and `kRad` are ward-wide scalars. Per-building shadow was
     tested as a thermal signal over 87 ward-scenes and FAILED its pre-registered
     night placebo, p = 5.4e-07 (relief-renderer.ts, `applySun`). A shadow drawn on
     this scene would be read as the model knowing where the shade is. It does not.
     The editorial look gets its depth from a baked, sun-independent contact
     shading instead (explore/look-shading.ts) — which claims nothing about shade. */
  const offenders = [];
  for (const [rel, url] of await obosFiles()) {
    const code = stripComments(await readFile(url, 'utf8'));
    const m = code.match(SHADOW);
    if (m) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [],
    'cast shadows are switched on in the OBOS scene. Per-building shadow failed its '
    + 'pre-registered night placebo (p = 5.4e-07; relief-renderer.ts ~applySun): the heat '
    + 'model has no shade term, so a drawn shadow would claim one. Use contact shading.');

  // Guard the guard: the pattern must still fire on each shape it was written for.
  for (const shape of ['this.key.castShadow = true;', 'mesh.receiveShadow = true', 'renderer.shadowMap.enabled = true']) {
    assert.match(shape, SHADOW, `the shadow pattern no longer matches \`${shape}\``);
  }
  assert.doesNotMatch('castShadow stays off', SHADOW, 'the shadow pattern fires on prose about shadows');
});

/* ────────────────────────────────────────────────────────────────────────────
   NO BLOOM.
   ──────────────────────────────────────────────────────────────────────────── */

const BLOOM = /\b(?:EffectComposer|UnrealBloomPass|BloomPass|BloomEffect|SelectiveBloomEffect|RenderPass)\b|(?:three\/(?:examples\/jsm|addons)\/postprocessing|['"]postprocessing['"])/;

test('no bloom and no post-processing composer in OBOS', async () => {
  /* The August look-pass (attic/heat-fx) tried glow and grounding passes and was
     shelved; the editorial look was built under the rule that it adds no render
     pass at all. The GL context is MapLibre's: a composer would also have to own a
     render target this shared context has no room for. And a bloom on the hottest
     roofs is precisely a sampled warm accent, which the sealed palette forbids. */
  const offenders = [];
  for (const [rel, url] of await obosFiles()) {
    const code = stripComments(await readFile(url, 'utf8'));
    const m = code.match(BLOOM);
    if (m) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'a bloom or post-processing composer has entered the OBOS scene');
  for (const shape of [
    "import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';",
    'new UnrealBloomPass(size, 1.2, 0.4, 0.85)',
    "import { BloomEffect } from 'postprocessing';",
  ]) assert.match(shape, BLOOM, `the bloom pattern no longer matches \`${shape}\``);
});

/* ────────────────────────────────────────────────────────────────────────────
   THE WATER'S SUN IS THE REAL SUN.
   ──────────────────────────────────────────────────────────────────────────── */

test('the glint direction is the real sun, clamped high only below the horizon', () => {
  /* BEHAVIOUR FIRST. The classic water lit every pond from a fixed north-east sun,
     vec3(0.45, 0.72, -0.35), while the compass beside it reported the real one.
     `glintSun` is what the renderer feeds the water (`applySun`): for a sun above
     GLINT_MIN_SUN_Y it must BE that sun's direction, and two hours must differ. */
  const morning = sunPlacement(9, 172), afternoon = sunPlacement(16, 172), night = sunPlacement(23, 172);
  assert.ok(morning.y > GLINT_MIN_SUN_Y && afternoon.y > GLINT_MIN_SUN_Y && night.y < 0,
    'the fixture hours no longer give two day suns and a night one');
  for (const sun of [morning, afternoon]) {
    const g = glintSun(sun), n = Math.hypot(sun.x, sun.y, sun.z);
    for (const [k, i] of [['x', 0], ['y', 1], ['z', 2]]) {
      assert.ok(Math.abs(g[i] - sun[k] / n) < 1e-9, `glint ${k} is not the sun's (${g[i]} vs ${sun[k] / n})`);
    }
  }
  const [am, pm] = [glintSun(morning), glintSun(afternoon)];
  assert.ok(Math.hypot(am[0] - pm[0], am[1] - pm[1], am[2] - pm[2]) > 0.5,
    'the glint did not move between 09:00 and 16:00 -- it is not following the sun');
  const fixed = [0.45, 0.72, -0.35].map((v, _, a) => v / Math.hypot(...a));
  assert.ok(Math.hypot(am[0] - fixed[0], am[1] - fixed[1], am[2] - fixed[2]) > 0.1,
    'the morning glint equals the classic fixed sun');
  // Night: the bearing is kept and the height held at the floor, so a lake keeps a sheen.
  const g = glintSun(night);
  assert.ok(Math.abs(Math.hypot(...g) - 1) < 1e-9, 'the night glint is not a unit vector');
  assert.ok(g[1] > 0, 'the night glint points under the water');
  assert.ok(Math.abs(Math.atan2(g[0], g[2]) - Math.atan2(night.x, night.z)) < 1e-9, 'the night glint lost the sun\'s bearing');
});

test('the shipped water shader reads that sun, and the renderer writes it', async () => {
  /* WIRING, as source: three hops, each of which could silently fall back to a constant. */
  const waterRaw = await read('water-layer.ts');
  const water = stripComments(waterRaw);
  const frag = stripComments(between(waterRaw, 'const FRAG = /* glsl */ `', '`;', 'water-layer.ts FRAG'));
  assert.match(frag, /uniform\s+vec3[^;]*\buSun\b/, 'the shipped water shader no longer declares a uSun uniform');
  assert.match(frag, /\bnormalize\(\s*uSun\s*\)/, 'the shipped water shader no longer lights from uSun');
  assert.doesNotMatch(frag, /normalize\(\s*vec3\(\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\)\s*\)/,
    'the shipped water shader normalises a literal direction -- a hard-coded sun');
  assert.match(water, /uSun:\s*look\.sun\b/, 'the water layer does not bind uSun to the renderer\'s sun holder');
  assert.match(water, /fragmentShader:\s*look\s*\?\s*FRAG\s*:\s*FRAG_CLASSIC/, 'the water no longer selects FRAG by default');

  const relief = stripComments(await read('explore/relief-renderer.ts'));
  assert.match(relief, /sun:\s*this\.sunDir\b/, 'the renderer hands the water some other sun holder');
  const applySun = between(relief, 'private applySun(sun: SunPlacement): void {', '\n  }\n', 'relief-renderer.ts applySun');
  assert.match(applySun, /this\.sunDir\.value\.set\(\s*\.\.\.glintSun\(\s*sun\s*\)\s*\)/,
    'applySun no longer aims the water\'s glint at the sun it is given');
  assert.doesNotMatch(relief, /sunDir\s*=\s*\{\s*value:\s*new THREE\.Vector3\(\s*0\.45/,
    'the glint holder starts at the classic fixed sun again');
});

/* ────────────────────────────────────────────────────────────────────────────
   THE BASE PALETTE STAYS OUT OF THE HEAT'S HUES.
   ──────────────────────────────────────────────────────────────────────────── */

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** sRGB 0–1 → OKLCH { L, C, h° }. */
function oklch([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
const fromHex = (hex) => {
  const h = hex.replace(/^#|^0x/i, '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};

/** The ramp's stops, as the shaders write them: `c3=vec3(.831,.420,.290)`. */
function rampStops(src) {
  const stops = new Map();
  for (const m of src.matchAll(/\b(c[0-4])=vec3\(([-\d.]+),([-\d.]+),([-\d.]+)\)/g)) {
    const v = [m[2], m[3], m[4]].map(Number);
    const prev = stops.get(m[1]);
    if (prev) assert.deepEqual(prev, v, `ramp stop ${m[1]} is written two different ways in relief-renderer.ts`);
    stops.set(m[1], v);
  }
  return stops;
}

/**
 * Below this OKLCH chroma a colour has no hue to speak of: the off-white blocks,
 * the paper and the warm-grey asphalt all sit near 0.01. The ramp's red/orange
 * stops sit at 0.14 and 0.19, so the floor is far below anything that could read
 * as heat, and far above the numerical noise of a near-grey's hue angle.
 */
const NEUTRAL_C = 0.02;
/** The band is the ramp's red and orange stops' hues, widened by this much each side. */
const BAND_MARGIN_DEG = 15;

/** Every colour literal (#hex or 0xhex) in a source text, comments stripped. */
const colourLiterals = (src) => [...stripComments(src).matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b0x[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);

test('the Clay base palette has no warm red or orange in it', async () => {
  /* THE HEAT OWNS WARM. A Clay ground, block, road or sky in the ramp's red/orange
     band would compete with the one thing on this map that is allowed to be hot —
     and the climate stripes' red is sealed besides. The editorial look buys its
     contrast in VALUE only, and this is that rule as a number.

     The band is READ FROM THE SHADERS, not typed here, so it moves if the ramp
     ever does; and the palette is every colour literal in the files that define
     the editorial base — the look table, the paper basemap, the paper sky, the
     Clay planting constants — so a colour added there is checked without anyone
     remembering to list it. Phone values included: they are literals too. */
  const stops = rampStops(await read('explore/relief-renderer.ts'));
  assert.ok(stops.has('c3') && stops.has('c4'), 'could not read the ramp\'s red/orange stops from relief-renderer.ts');
  const hues = ['c3', 'c4'].map((k) => oklch(stops.get(k)).h);
  for (const k of ['c3', 'c4']) assert.ok(oklch(stops.get(k)).C > 0.1, `ramp stop ${k} is no longer a saturated warm -- recheck the band`);
  const lo = Math.min(...hues) - BAND_MARGIN_DEG, hi = Math.max(...hues) + BAND_MARGIN_DEG;
  const inBand = (hex) => { const c = oklch(fromHex(hex)); return c.C >= NEUTRAL_C && c.h >= lo && c.h <= hi; };

  const sky = between(await read('explore/sun-lighting.ts'), 'const PAPER_SKY = {', '}', 'sun-lighting.ts PAPER_SKY');
  const planting = between(await read('vegetation-layer.ts'), 'The editorial Clay planting', 'function addWind', 'vegetation-layer.ts planting constants');
  const sources = {
    'explore/look.ts': await read('explore/look.ts'),
    'explore/look-paper.ts': await read('explore/look-paper.ts'),
    'explore/sun-lighting.ts PAPER_SKY': sky,
    'vegetation-layer.ts planting': planting,
  };
  const offenders = [];
  let checked = 0;
  for (const [where, src] of Object.entries(sources)) {
    const found = colourLiterals(src);
    assert.ok(found.length >= 3, `${where}: only ${found.length} colours found -- the palette read is broken`);
    for (const hex of found) {
      checked += 1;
      if (inBand(hex)) {
        const c = oklch(fromHex(hex));
        offenders.push(`${where}: ${hex} (OKLCH C ${c.C.toFixed(3)}, h ${c.h.toFixed(0)}°, band ${lo.toFixed(0)}–${hi.toFixed(0)}°)`);
      }
    }
  }
  /* The editorial Clay light's two colours are numbers, and are checked as such. */
  for (const n of [EDITORIAL_STUDIO_LIGHT.sky, EDITORIAL_STUDIO_LIGHT.ground]) {
    const hex = `#${n.toString(16).padStart(6, '0')}`;
    checked += 1;
    if (inBand(hex)) offenders.push(`EDITORIAL_STUDIO_LIGHT: ${hex}`);
  }
  assert.deepEqual(offenders, [], 'a Clay base colour sits in the heat ramp\'s red/orange band');
  assert.ok(checked >= 40, `only ${checked} base colours were checked -- the palette read has shrunk`);

  // Guard the guard: the test must see a terracotta, and must not see the asphalt.
  assert.ok(inBand('#d4876a'), 'a terracotta no longer counts as red/orange -- the band is broken');
  assert.ok(inBand('#c0392b'), 'a brick red no longer counts as red/orange -- the band is broken');
  assert.ok(!inBand(CLAY.asphalt) && !inBand(CLAY.building), 'the band now catches the neutral base it was written to allow');
});

/* ────────────────────────────────────────────────────────────────────────────
   `?look=classic` — THE ROLLBACK.
   ──────────────────────────────────────────────────────────────────────────── */

test('the query string picks the look, and only `look=classic` leaves the default', () => {
  assert.equal(lookFromSearch(''), 'd');
  assert.equal(lookFromSearch('?look=classic'), 'classic');
  assert.equal(lookFromSearch('?lab=1&look=classic'), 'classic');
  /* The preview flags of the four rounds are gone: each now lands on the default
     rather than on a half-remembered variant. */
  for (const retired of ['?look=v2', '?look=c', '?look=d', '?look=v1', '?look=CLASSIC', '?look=']) {
    assert.equal(lookFromSearch(retired), 'd', `${retired} should draw the default look`);
  }
  // Under node there is no location: the module must resolve to the shipped default.
  assert.equal(LOOK, 'd');
  assert.equal(CLASSIC, false);
  assert.equal(STUDIO_LIGHT, EDITORIAL_STUDIO_LIGHT);
});

test('`?look=classic` selects the classic constants at module load', async () => {
  /* BEHAVIOUR, NOT SOURCE: the module is loaded twice more, once under a
     `location` that asks for classic and once under none, and each instance must
     resolve its own way. A query string on the import gives a fresh instance. */
  const url = new URL('../../src/scripts/climate-engine/explore/look.ts', import.meta.url).href;
  let classic;
  globalThis.location = { search: '?look=classic' };
  try { classic = await import(`${url}?as=classic`); } finally { delete globalThis.location; }
  const plain = await import(`${url}?as=default`);
  assert.equal(classic.CLASSIC, true, '`?look=classic` did not select the classic look');
  assert.equal(classic.STUDIO_LIGHT, classic.CLASSIC_STUDIO_LIGHT, 'classic did not select the classic Clay light');
  /* The phone values are the editorial look's: classic has none, even on a phone. */
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    assert.equal(classic.isPhone(), false, 'the phone boosts leak into classic');
    assert.equal(plain.isPhone(), true, 'the default look no longer sees a phone-sized frame');
  } finally { delete globalThis.matchMedia; }
  assert.equal(plain.CLASSIC, false);
  assert.equal(plain.STUDIO_LIGHT, plain.EDITORIAL_STUDIO_LIGHT);
  /* The classic Clay light is pinned to the values shipped until 2026-10-02
     (relief-renderer.ts at d64cdd0: hemi 0xffffff/0xd8d2c8 at 1.45, key 1.7, rim 0.12). */
  assert.deepEqual({ ...CLASSIC_STUDIO_LIGHT }, { sky: 0xffffff, ground: 0xd8d2c8, hemi: 1.45, key: 1.7, rim: 0.12 });
  assert.notDeepEqual({ ...CLASSIC_STUDIO_LIGHT }, { ...EDITORIAL_STUDIO_LIGHT });
  // The sky: classic Clay is the stock studio sky, the default is the paper one.
  assert.equal(maplibreSky(71, 0, 'studio', true)['horizon-color'], '#d7dde8', 'classic lost its Clay sky');
  assert.notEqual(maplibreSky(71, 0, 'studio')['horizon-color'], '#d7dde8', 'the default is drawing the classic sky');
});

/**
 * The classic shaders, hashed as they stood on main at d64cdd0, the last commit
 * before the look work. A changed hash means the rollback no longer draws what
 * shipped. If the SHIPPED look is what you mean to change, change the editorial
 * path; classic is frozen on purpose.
 */
const CLASSIC_FROZEN = [
  ['water-layer.ts', 'const FRAG_CLASSIC = /* glsl */ `', '`;', 'a39df32735132172'],
  ['road-layer.ts', 'const FRAG_CLASSIC = /* glsl */ `', '`;', 'e572893b9bbd7ce6'],
  ['explore/relief-renderer.ts', 'fragmentShader: `varying vec2 vUv; uniform sampler2D tT; uniform float uMin,uMax,uOp,uCool;', '`', '4e8c60e3aa96c7e2'],
  ['explore/relief-renderer.ts', "private makeFacadeClassic(kind: 'extruded' | 'model'): THREE.MeshStandardMaterial {", '\n  }\n', '8bdf56233f2886eb'],
];

test('the classic shaders are byte-for-byte what shipped', async () => {
  for (const [file, open, close, want] of CLASSIC_FROZEN) {
    const body = between(await read(file), open, close, `${file} classic`);
    const got = createHash('sha256').update(body).digest('hex').slice(0, 16);
    assert.equal(got, want, `${file}: the classic path changed (sha ${got}), so ?look=classic no longer restores what shipped`);
  }
});

test('every layer takes its classic path under the flag, and the default path otherwise', async () => {
  /* WIRING, as source. The renderer decides once — `look` is undefined under
     classic — and each layer chooses its shader from that; the basemap and the
     sky take the flag directly. Each pattern is the selector itself, so inverting
     or hard-wiring any one of them fails here. */
  const relief = stripComments(await read('explore/relief-renderer.ts'));
  assert.match(relief, /CLASSIC\s*\?\s*new THREE\.ShaderMaterial\(\{[\s\S]*?\}\)\s*:\s*this\.makeOverlay\(\)/, 'the ground overlay no longer selects classic by the flag');
  assert.match(relief, /return\s+CLASSIC\s*\?\s*this\.makeFacadeClassic\(kind\)\s*:\s*this\.makeEditorialFacade\(kind\)/, 'the facade no longer selects classic by the flag');
  assert.match(relief, /const look = CLASSIC\s*\?\s*undefined\s*:/, 'the layers are handed the editorial holders under classic');
  assert.match(relief, /if \(!CLASSIC\) \{ this\.applyLook\(studio\)/, 'the editorial amounts are applied under classic');
  assert.match(relief, /this\.hemiBase = STUDIO_LIGHT\.hemi; this\.keyBase = STUDIO_LIGHT\.key; this\.rim\.intensity = STUDIO_LIGHT\.rim;/, 'Clay light no longer comes from STUDIO_LIGHT');
  for (const file of ['water-layer.ts', 'road-layer.ts']) {
    assert.match(stripComments(await read(file)), /fragmentShader:\s*look\s*\?\s*FRAG\s*:\s*FRAG_CLASSIC/, `${file} no longer selects its classic shader without the holders`);
  }
  const veg = stripComments(await read('vegetation-layer.ts'));
  assert.match(veg, /if \(look\) \{\s*softGeo =/, 'the Clay planting is built under classic');
  const app = stripComments(await read('heat-map-app.ts'));
  assert.match(app, /!CLASSIC && s \? \{ transformStyle: paperStyle \}/, 'the paper basemap is applied under classic, or never');
  assert.match(app, /maplibreSky\([\s\S]{0,200}?env,\s*CLASSIC,?\s*\)/, 'the sky is no longer told which look is on');
});
