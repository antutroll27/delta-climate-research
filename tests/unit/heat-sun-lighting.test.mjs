import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFile(join(ROOT, path), 'utf8');

const {
  SKY_ENVIRONMENTS,
  dayOfYearUtc,
  imageBasedLightingAllowed,
  maplibreSky,
  representativeSolarHour,
  skyEnvironment,
  sunLighting,
  sunPlacement,
} = await import('../../src/scripts/climate-engine/explore/sun-lighting.ts');

const { solarAzimuthDeg, solarElevationDeg } = await import('../../src/scripts/climate-engine/sky.ts');

const KOLKATA_LAT = 22.55;
/** Late August — the doy the founder's screenshots were taken on. */
const DOY = 241;
const DEG = 180 / Math.PI;

/** Recover a bearing and a height FROM the vector, by the inverse of how it was built. */
function readBack(sun) {
  return {
    azimuthDeg: ((Math.atan2(sun.x, sun.z) * DEG) % 360 + 360) % 360,
    elevationDeg: Math.asin(Math.min(1, Math.max(-1, sun.y))) * DEG,
  };
}

/**
 * THE ONE ASSERTION THIS WHOLE TASK EXISTS FOR.
 *
 * Not "the key light moved" — thirteen guards in this repo have been caught
 * comparing a value against a copy of itself, and "it differs from (0.4, 1, 0.35)"
 * is exactly that shape of nothing. The vector is BUILT with sin/cos of the two
 * angles; it is read back here with atan2/asin and compared against `sky.ts`
 * called directly. A swapped sin/cos, a flipped sign, or an axis mix-up all
 * survive "it moved" and all die here.
 */
test('the sun vector reads back as the bearing and height sky.ts computes', () => {
  for (const hour of [7, 9, 11, 13, 15, 17]) {
    for (const doy of [15, 80, 172, 241, 355]) {
      const sun = sunPlacement(hour, doy, KOLKATA_LAT);
      const back = readBack(sun);
      const wantAz = solarAzimuthDeg(hour, doy, KOLKATA_LAT);
      const wantEl = solarElevationDeg(hour, doy, KOLKATA_LAT);
      if (wantEl <= 0) continue;                 // bearing is meaningless below the horizon
      const dAz = Math.abs(((back.azimuthDeg - wantAz + 540) % 360) - 180);
      assert.ok(dAz < 1e-6, `azimuth at ${hour}h doy ${doy}: ${back.azimuthDeg} vs ${wantAz}`);
      assert.ok(Math.abs(back.elevationDeg - wantEl) < 1e-6,
        `elevation at ${hour}h doy ${doy}: ${back.elevationDeg} vs ${wantEl}`);
      assert.ok(Math.abs(Math.hypot(sun.x, sun.y, sun.z) - 1) < 1e-9, 'must be a unit vector');
    }
  }
});

/**
 * THE FRAME IS EAST / UP / NORTH, and the reason it is asserted with named compass
 * words rather than with the same trigonometry the module uses.
 *
 * `relief-renderer.ts` maps a ward point (east, north, height) to the scene vector
 * (east, height, north). Writing (cos, ·, sin) instead of (sin, ·, cos) mirrors the
 * sun about the north-east diagonal — at Kolkata's 231° afternoon bearing that is a
 * 78° error, and a 78°-wrong sun still throws light across a city convincingly.
 */
test('scene axes are +x east, +y up, +z north', () => {
  // Kolkata, 13:00 late August: measured on the shipped console as 231 deg, 71 up.
  const afternoon = sunPlacement(13, DOY, KOLKATA_LAT);
  assert.ok(afternoon.azimuthDeg > 180 && afternoon.azimuthDeg < 270,
    `13:00 must be south-west, got ${afternoon.azimuthDeg}`);
  assert.ok(afternoon.x < 0, 'an afternoon sun is WEST of the ward, so scene x is negative');
  assert.ok(afternoon.z < 0, 'and SOUTH of it, so scene z is negative');
  assert.ok(afternoon.y > 0.9, 'and 71 deg up, so scene y is nearly one');

  // The mirror image, six hours earlier: east of the ward, so +x.
  const morning = sunPlacement(7, DOY, KOLKATA_LAT);
  assert.ok(morning.azimuthDeg > 45 && morning.azimuthDeg < 135,
    `07:00 must be east-ish, got ${morning.azimuthDeg}`);
  assert.ok(morning.x > 0, 'a morning sun is EAST of the ward, so scene x is positive');

  /* Kolkata is inside the tropics: for six weeks around the June solstice the noon
     sun stands NORTH of overhead. sky.ts is built to survive that and the frame has
     to as well, or the one season that matters most for heat lights from behind. */
  const solstice = sunPlacement(12, 172, KOLKATA_LAT);
  assert.ok(solstice.z > 0, 'midsummer noon at 22.55 N is north of overhead, so +z');
});

test('the retained-heat phase puts the sun below the horizon', () => {
  const night = sunPlacement(22, DOY, KOLKATA_LAT);
  assert.equal(night.up, false);
  assert.ok(night.elevationDeg < -20, `22:00 elevation ${night.elevationDeg}`);
  assert.ok(night.y < 0, 'below the horizon means a negative scene y');
});

/**
 * …AND THE SCENE DOES NOT GO BLACK THERE.
 *
 * Zeroing the key at night is the honest half; it is only correct if something
 * takes its place, because a console nobody can read is not a more truthful one.
 */
test('night kills the key light and raises the fill instead', () => {
  const nightEl = sunPlacement(22, DOY, KOLKATA_LAT).elevationDeg;
  const night = sunLighting(nightEl);
  const day = sunLighting(sunPlacement(13, DOY, KOLKATA_LAT).elevationDeg);

  assert.equal(night.keyFactor, 0, 'there is no sun at 22:00, so no key light');
  assert.equal(day.keyFactor, 1, 'a 71-deg sun is the full key');
  assert.ok(night.fillFactor > day.fillFactor, 'the hemisphere must take over');
  assert.ok(night.fillFactor >= 1.5 && night.fillFactor <= 1.6, `fill ${night.fillFactor}`);
  assert.ok(night.environmentIntensity > 0, 'image-based ambience survives the night');
  assert.ok(day.environmentIntensity > night.environmentIntensity, 'and is stronger by day');

  // civil twilight is neither noon nor midnight
  const dusk = sunLighting(0);
  assert.ok(dusk.keyFactor > 0 && dusk.keyFactor < 1, `horizon keyFactor ${dusk.keyFactor}`);
  assert.equal(sunLighting(-6).keyFactor, 0, 'below civil twilight the sun is gone');
  assert.ok(sunLighting(10).keyFactor === 1, 'extinction is spent by 10 deg');
});

/**
 * ONE RULE FOR WHICH HOUR THE INSTRUMENT IS DESCRIBING. This was inline in
 * `syncSunBearing`; the dial, the key light and the sky now share it, and the
 * source guard below is what keeps them sharing it.
 */
test('the representative hour is the two solved phases, or the live clock', () => {
  assert.equal(representativeSolarHour(null, 9.4, 'peak'), 13);
  assert.equal(representativeSolarHour(null, 9.4, 'night'), 22);
  assert.equal(representativeSolarHour(undefined, 9.4, 'night'), 22);
  assert.equal(representativeSolarHour(0, 9.4, 'peak'), 9.4, 'sunNow 0 is still Now, not absent');
  assert.equal(representativeSolarHour(0.83, 14.2, 'peak'), 14.2);
});

test('day of year is the calendar one, at both ends of it', () => {
  assert.equal(dayOfYearUtc(Date.UTC(2026, 0, 1, 12)), 1);
  assert.equal(dayOfYearUtc(Date.UTC(2026, 7, 29, 12)), 241);
  assert.equal(dayOfYearUtc(Date.UTC(2026, 11, 31, 12)), 365);
  assert.equal(dayOfYearUtc(Date.UTC(2024, 11, 31, 12)), 366, 'a leap year has a 366th');
});

/**
 * THE VISIBLE SKY, CHECKED AGAINST THE INSTALLED STYLE SPEC RATHER THAN THE DOCS.
 *
 * maplibre-gl 4.7.1's sky fragment shader reads three properties. The style spec
 * validates seven — the other four feed `terrainUniformValues` only, and this map
 * sets no terrain. This asserts both halves: the object validates, and it carries
 * nothing inert.
 */
test('the sky spec is one maplibre-gl 4.7.1 both accepts and draws', async () => {
  const spec = await import('@maplibre/maplibre-gl-style-spec');
  const value = maplibreSky(45, 0.2);
  const errors = spec.validate({ value, styleSpec: spec.v8, key: 'sky', valueSpec: spec.v8.sky, style: {} });
  assert.deepEqual(errors, [], `installed style spec rejected the sky: ${JSON.stringify(errors)}`);

  assert.deepEqual(Object.keys(value).sort(), ['horizon-color', 'sky-color', 'sky-horizon-blend']);
  for (const inert of ['fog-color', 'fog-ground-blend', 'horizon-fog-blend', 'atmosphere-blend']) {
    assert.ok(!(inert in value), `${inert} does nothing without terrain in 4.7.1 — do not set it`);
  }
});

const luma = (hex) => 0.2126 * parseInt(hex.slice(1, 3), 16)
  + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16);

test('the sky is coloured by the computed sun height', () => {
  const noon = maplibreSky(71, 0);
  const night = maplibreSky(-47, 0);
  assert.ok(luma(noon['sky-color']) > luma(night['sky-color']) * 2,
    'a 22:00 sky must be far darker than a 13:00 one');
  assert.ok(luma(noon['horizon-color']) > luma(noon['sky-color']),
    'the horizon is the bright end of the gradient, not the zenith');
  assert.ok(night['sky-horizon-blend'] > noon['sky-horizon-blend'],
    'a night horizon is a soft wash; a clear day one is a tighter band');

  // monotone in elevation — no band where dusk is brighter than noon
  let previous = -1;
  for (const elevation of [-40, -10, -6, 0, 6, 12, 30, 71]) {
    const l = luma(maplibreSky(elevation, 0)['sky-color']);
    assert.ok(l >= previous, `sky brightness dipped at ${elevation} deg`);
    previous = l;
  }
});

test('cloud desaturates the sky, and Clay gets a light one', () => {
  const clear = maplibreSky(71, 0);
  const overcast = maplibreSky(71, 1);
  assert.notEqual(clear['sky-color'], overcast['sky-color']);
  const chroma = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.max(...c) - Math.min(...c);
  };
  assert.ok(chroma(overcast['sky-color']) < chroma(clear['sky-color']), 'cloud pulls it grey');

  const studio = maplibreSky(71, 0, 'studio');
  assert.ok(luma(studio['sky-color']) > luma(clear['sky-color']) * 2,
    'the Clay basemap is light; a violet night sky over it reads as a fault');
});

/**
 * THE SEALED PALETTE. The climate stripes' red is never sampled as an accent
 * anywhere in this project, and a sky is exactly where a dusk glow would sneak one
 * in. There is no dusk glow: the palette interpolates night to day and stops.
 */
test('no sky colour is a warm accent at any hour', () => {
  for (const elevation of [-47, -20, -6, -2, 0, 3, 8, 20, 45, 71]) {
    for (const environment of ['dark', 'studio']) {
      for (const key of ['sky-color', 'horizon-color']) {
        const hex = maplibreSky(elevation, 0, environment)[key];
        const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        assert.ok(b >= r, `${environment} ${key} at ${elevation} deg is warm: ${hex}`);
      }
    }
  }
});

test('the day dome is the one with no sun in it', () => {
  assert.ok(SKY_ENVIRONMENTS.day.peakOverMean < 5,
    'the day dome must have no baked sun disc to fight — measured max/mean');
  assert.ok(SKY_ENVIRONMENTS.night.peakOverMean < 60,
    'and the night dome no moon: the clear-night alternatives measured 141 to 2876');
  assert.equal(skyEnvironment(71).slug, SKY_ENVIRONMENTS.day.slug);
  assert.equal(skyEnvironment(-47).slug, SKY_ENVIRONMENTS.night.slug);
  assert.equal(skyEnvironment(-6.1).slug, SKY_ENVIRONMENTS.night.slug, 'civil twilight is the switch');
  assert.equal(skyEnvironment(-5.9).slug, SKY_ENVIRONMENTS.day.slug);
  for (const dome of [SKY_ENVIRONMENTS.day, SKY_ENVIRONMENTS.night]) {
    assert.match(dome.url, /^\/heat-map\/sky\/[a-z0-9_]+_1k\.hdr$/);
    assert.ok(dome.url.includes(dome.slug), 'the url must name the slug the provenance records');
  }
});

test('the vendored domes are in the repo, not on someone else’s CDN', async () => {
  const source = await read('src/scripts/climate-engine/explore/sun-lighting.ts');
  assert.doesNotMatch(source, /polyhaven\.(com|org)\/[^\s"']*\.hdr/,
    'a third-party CDN in the render path is a dependency we do not control');
  const { access } = await import('node:fs/promises');
  for (const dome of [SKY_ENVIRONMENTS.day, SKY_ENVIRONMENTS.night]) {
    await access(join(ROOT, 'public', dome.url.replace(/^\//, '')));
  }
});

test('image-based ambience is the top tier only, and never a requirement', () => {
  assert.equal(imageBasedLightingAllowed('full'), true);
  assert.equal(imageBasedLightingAllowed('balanced'), false, 'a coarse pointer lands here');
  assert.equal(imageBasedLightingAllowed('low'), false);
});

/**
 * THE TIER IS READ LATE, AND THE VALUE FORM WAS A MEASURED BUG.
 *
 * `runtimeTier` starts at 'balanced' and is promoted to 'full' inside
 * `initSimHost`, which runs from `resetSim` once the ward has loaded. The relief
 * renderer is built much earlier, straight off `capsReady`. Handed the VALUE, it
 * captured 'balanced' for the life of the session and never fetched a dome at all
 * — measured with a request listener: zero `.hdr` requests across a full boot and
 * a phase switch, on a machine that classifies as tier 2.
 *
 * A source-shape guard, because the alternative needs a WebGL context. It names
 * the exact regression: someone "simplifying" the thunk back to a value.
 */
test('the renderer reads the device tier late, not at construction', async () => {
  const contract = await read('src/scripts/climate-engine/explore/relief-contract.ts');
  assert.match(contract, /deviceTier:\s*\(\)\s*=>\s*ExploreDeviceTier/,
    'the option must be a thunk — caps resolve AFTER the renderer is built');
  const app = await read('src/scripts/climate-engine/heat-map-app.ts');
  assert.match(app, /deviceTier:\s*\(\)\s*=>\s*runtimeTier/,
    'passing runtimeTier by value freezes it at its pre-caps default of "balanced"');
  const relief = await read('src/scripts/climate-engine/explore/relief-renderer.ts');
  assert.match(relief, /imageBasedLightingAllowed\(this\.options\.deviceTier\(\)\)/,
    'and the renderer must CALL it, at the moment it wants to know');
});

/**
 * ONE COMPUTATION FEEDS THE DIAL, THE LIGHT AND THE SKY.
 *
 * This is the defect the task was opened for, stated structurally: the console
 * reported the sun's bearing on its compass and lit the city from a constant. A
 * second `sunPlacement(` call in this file would be a second answer to one
 * question, which is how the first one drifted.
 */
test('heat-map-app computes the sun exactly once', async () => {
  const app = await read('src/scripts/climate-engine/heat-map-app.ts');
  const calls = app.match(/\bsunPlacement\(/g) ?? [];
  assert.equal(calls.length, 1, `sunPlacement is called ${calls.length} times; the dial, the key light and the sky must share one`);
  assert.match(app, /representativeSolarHour/, 'and the hour rule is the shared one, not a re-typed ternary');
  assert.doesNotMatch(app, /phase === 'night' \? 22 : 13/, 'the inline copy of the hour rule must be gone');
});

/**
 * THE HONESTY CONSTRAINT, MADE STRUCTURAL.
 *
 * The physics is 2-D. `sun` and `kRad` are ward-wide scalars and there is no shade
 * term, so a better sky cannot move the temperature field. This proves it the only
 * way that stays true after the next refactor: the solver cannot reach the sky.
 */
test('nothing in the solver can see the lighting', async () => {
  for (const path of [
    'src/scripts/climate-engine/heat-map-model.ts',
    'src/scripts/climate-engine/sim-ts.ts',
    'src/scripts/climate-engine/types.ts',
    'src/scripts/climate-engine/sim-worker.ts',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /sun-lighting|relief-renderer/,
      `${path} is on the solver path and must not import the renderer's lighting`);
  }
  /* IMPORTS ONLY. The docblock names `heat-map-model.ts` on purpose — it points the
     next reader at the solver so they stop looking here for one — so a bare
     substring match would fail on its own prose and prove nothing about the graph. */
  const lighting = await read('src/scripts/climate-engine/explore/sun-lighting.ts');
  const imports = [...lighting.matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../sky', './runtime-budget'],
    'the lighting must reach neither the physics nor three.js — heat-map-app imports it statically');
  assert.match(lighting, /NONE OF THIS IS PHYSICS/,
    'the docblock must say so, where the next reader will be');
});
