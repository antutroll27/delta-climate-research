/**
 * sun-lighting.ts — where the sun is, and what that does to the PICTURE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * NONE OF THIS IS PHYSICS. THE SOLVER NEVER SEES IT.
 *
 * The surface-temperature model is 2-D: `sun` and `kRad` in types.ts are ward-wide
 * SCALARS, and there is no shade term. Per-building shadow was built and tested
 * over 87 ward-scenes and failed its pre-registered night placebo (p = 5.4e-07),
 * so it is not in the solve. Nothing in this module is either.
 *
 * A better-lit city is a better-lit city. It does not move the temperature field
 * by one millikelvin, it cannot change a golden, and it must never be described on
 * screen as if it did. If you are here to make the simulation more accurate, you
 * are in the wrong file — `heat-map-model.ts` is the solver.
 *
 * What this module IS for: the console draws a sun on its compass at a real
 * bearing, and until now lit the city from a fixed `position.set(0.4, 1, 0.35)`
 * that had nothing to do with it. At 13:00 in Kolkata that is a 64°-high sun in
 * the NORTH-EAST while the dial correctly reports 231° / 71° up — the south-west.
 * Two places on one screen disagreeing about one fact. This is the one fact.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The geometry comes from `../sky.ts` and is NOT recomputed here: `solarAzimuthDeg`
 * and `solarElevationDeg` already carry the Spencer declination series, the hour
 * angle, and the acos form that survives Kolkata sitting inside the tropics. A
 * second copy would be a second thing to disagree with.
 */

import { solarAzimuthDeg, solarElevationDeg } from '../sky';
import type { ExploreDeviceTier } from './runtime-budget';

/**
 * The sun, in the relief scene's own axes.
 *
 * THE FRAME, DERIVED RATHER THAN GUESSED, because a light in the wrong-handed
 * frame is a bug that looks like a style choice.
 *
 * `relief-renderer.ts` builds each building from `shape.moveTo(b[1], -b[2])`,
 * extrudes along +Z and then `rotateX(-PI/2)`, which sends a ward point
 * (x_east, y_north, height) to the scene-local vector (x_east, height, y_north).
 * The render matrix then applies `scale(frame.east, -frame.north, frame.up)` after
 * `rotationX(PI/2)`, and `ward-frame.ts` documents that the minus is what puts
 * northing on Mercator's southward +y. Composing the two gives the same answer
 * from the other end: scene +x is EAST, scene +y is UP, scene +z is NORTH.
 *
 * So a bearing measured clockwise from north becomes (sin, ·, cos) — NOT the
 * (cos, ·, sin) you would write for a mathematical angle from +x. Getting that
 * backwards mirrors the sun about the north-east diagonal, which at Kolkata's
 * afternoon bearing is a 78° error that still looks plausible in a screenshot.
 *
 * The scene node's own `scale(1, 1, -1)` needs no compensation here: it mirrors
 * the light and the buildings together, and a mirror preserves angles.
 */
export interface SunPlacement {
  /** compass bearing, degrees clockwise from true north */
  readonly azimuthDeg: number;
  /** degrees above the horizon; negative below it */
  readonly elevationDeg: number;
  /** above the horizon at all */
  readonly up: boolean;
  /** unit vector toward the sun, scene-local: +x east, +y up, +z north */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const RAD = Math.PI / 180;

export function sunPlacement(solarHour: number, doy: number, latDeg = 22.55): SunPlacement {
  const azimuthDeg = solarAzimuthDeg(solarHour, doy, latDeg);
  const elevationDeg = solarElevationDeg(solarHour, doy, latDeg);
  const cosEl = Math.cos(elevationDeg * RAD);
  return {
    azimuthDeg,
    elevationDeg,
    up: elevationDeg > 0,
    x: cosEl * Math.sin(azimuthDeg * RAD),
    y: Math.sin(elevationDeg * RAD),
    z: cosEl * Math.cos(azimuthDeg * RAD),
  };
}

/** Day of year, 1–366, from a UTC epoch in milliseconds. */
export function dayOfYearUtc(ms: number): number {
  return Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 0)) / 86_400_000);
}

/**
 * WHICH HOUR THE INSTRUMENT IS DESCRIBING — one rule, one place.
 *
 * The console is steady-state at a representative phase; its own freshness note
 * says it "has no 14:32". So there are exactly two fixed hours the engine solves,
 * plus the live clock when the reader has asked for Now. This was written inline
 * in `syncSunBearing`; it is here so the compass dial, the key light and the
 * visible sky are answering from the same expression rather than from three
 * copies of it that drift apart one edit at a time.
 */
export function representativeSolarHour(
  sunNow: number | null | undefined,
  liveSolarHour: number,
  phase: 'peak' | 'night',
): number {
  if (sunNow !== null && sunNow !== undefined) return liveSolarHour;
  return phase === 'night' ? 22 : 13;
}

export interface SunLighting {
  /** multiplies the environment's key-light base; 0 once the sun has set */
  readonly keyFactor: number;
  /** multiplies the environment's hemisphere base; >= 1, rises as the sun goes */
  readonly fillFactor: number;
  /** absolute `scene.environmentIntensity` for the image-based ambience */
  readonly environmentIntensity: number;
}

/** Hermite ramp, 0 below `a`, 1 above `b`. */
function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * What the sun's HEIGHT does to the three lights.
 *
 * KEY. A directional light's intensity in three.js is the beam irradiance measured
 * perpendicular to the beam; the shader already applies N·L. Scaling it by
 * cos(zenith) as well would count the same geometry twice and leave a noon sun
 * dimmer than it is. What does belong here is atmospheric extinction, which is why
 * the ramp spans -6° to +10° rather than switching at the horizon: a sun in the
 * last degrees before setting is genuinely weak, and civil twilight is genuinely
 * not black. Below -6° it is zero, because there is no sun.
 *
 * FILL. The 22:00 retained-heat phase is the reason this exists. With the key
 * correctly gone the scene would lose two thirds of its light, so the hemisphere
 * term rises to take its place — which is also what happens outdoors, where a city
 * at night is lit by sky and its own glow rather than by a source. The ceiling is
 * 1.55, tuned against the screenshot rather than derived; it is a look, and it is
 * labelled as one.
 *
 * ENVIRONMENT. Deliberately small, AND THE FIRST TRY WAS NOT. The HDRI is here for
 * material richness, not for exposure, and 0.20–0.38 lifted the mean luminance of
 * the 13:00 frame by 18 % — 43 % of the map's pixels brighter, the pale roofs
 * washing toward white. That is a second key light wearing an ambience label.
 * 0.10–0.16 lands at about +7 %, which reads as depth on the shaded faces and
 * leaves the exposure where the founder approved it.
 */
export function sunLighting(elevationDeg: number): SunLighting {
  const up = smoothstep(-6, 10, elevationDeg);
  return {
    keyFactor: up,
    fillFactor: 1 + 0.55 * (1 - up),
    environmentIntensity: 0.10 + 0.06 * up,
  };
}

/**
 * A vendored Poly Haven dome, and the measurement that chose it.
 *
 * `meanRadiance` is the solid-angle-weighted mean luminance of the file as
 * committed, measured by parsing the RGBE directly. It is recorded so that
 * `environmentIntensity` above means something: swapping in a dome twice as bright
 * without touching the number would silently double the ambience, and the
 * provenance note in docs/evidence/data-sources.md would still read correct.
 *
 * `peakOverMean` is the whole argument for these two files. It is max pixel
 * luminance over that mean — a baked sun's disc is hundreds of times the mean, and
 * an overcast dome has no disc at all.
 */
export interface SkyEnvironment {
  readonly slug: string;
  readonly url: string;
  readonly meanRadiance: number;
  readonly peakOverMean: number;
}

/**
 * MEASURED 2026-08-29 over the 1k files as committed (see the table in
 * docs/evidence/data-sources.md for the full shortlist and the numbers that
 * eliminated the rest).
 *
 * DAY — `mud_road_puresky`: midday overcast, sky only. max/mean = 2.2, and 0.2 %
 * of its light sits in the brightest 0.1 % of solid angle. There is no baked sun
 * in it to fight, which is the honest way to satisfy "damp the HDRI's own sun":
 * pick one that has none. The alternatives measured 6, 7 and 28.
 *
 * NIGHT — `kloppenheim_07_puresky`: overcast night, sky only, cloud lit from below
 * by a town. max/mean = 49 against 141, 215 and 2876 for the clear-night domes,
 * whose bright spot is a moon or the galactic core — a second directional source
 * at the angle it was photographed at, exactly what must not be in here. An
 * overcast night has its light spread across the whole cloud deck, and a humid,
 * light-polluted Kolkata at 22:00 is the case it describes.
 */
export const SKY_ENVIRONMENTS: { readonly day: SkyEnvironment; readonly night: SkyEnvironment } = {
  day: {
    slug: 'mud_road_puresky',
    url: '/heat-map/sky/mud_road_puresky_1k.hdr',
    meanRadiance: 0.367,
    peakOverMean: 2.2,
  },
  night: {
    slug: 'kloppenheim_07_puresky',
    url: '/heat-map/sky/kloppenheim_07_puresky_1k.hdr',
    meanRadiance: 0.249,
    peakOverMean: 49,
  },
};

/** Which dome the sun's height calls for. Civil twilight is the switch. */
export function skyEnvironment(elevationDeg: number): SkyEnvironment {
  return elevationDeg > -6 ? SKY_ENVIRONMENTS.day : SKY_ENVIRONMENTS.night;
}

/**
 * WHO GETS THE 2.3 MB, AND WHY THE ANSWER IS "ONLY THE TOP TIER".
 *
 * The two domes are 1.1 and 1.2 MB, and turning either into a `scene.environment`
 * means a PMREM convolution on the same GPU that is already the bottleneck here —
 * `render-quality.ts` puts a coarse pointer, <= 4 GB of memory or <= 6 cores at
 * tier 1 for that reason. Tier 0 never loads the 3-D scene at all.
 *
 * THE NO-HDRI PATH IS THE PRIMARY PATH, NOT A FALLBACK. Everything that carries
 * meaning — the key light at the computed bearing, the fill that rises as the sun
 * sets, the visible sky — is analytic and runs on every tier. The dome adds
 * ambience to the materials and nothing else, so a phone renders the same scene
 * with slightly flatter surfaces, never a broken or a differently-lit one.
 */
export function imageBasedLightingAllowed(tier: ExploreDeviceTier): boolean {
  return tier === 'full';
}

export interface MapLibreSky {
  readonly 'sky-color': string;
  readonly 'horizon-color': string;
  readonly 'sky-horizon-blend': number;
}

/**
 * THE VISIBLE SKY, AND EXACTLY WHAT maplibre-gl 4.7.1 WILL DRAW OF IT.
 *
 * The three.js scene is a MapLibre custom layer with no background of its own — it
 * composites over the basemap — so a three.js skybox would paint over the map
 * tiles. The sky above the horizon therefore belongs to MapLibre, through
 * `map.setSky`.
 *
 * MEASURED AGAINST THE SHIPPED BUNDLE, not against the style-spec docs. 4.7.1's
 * `SkySpecification` validates seven properties and its sky fragment shader reads
 * exactly three of them:
 *
 *     if (y > u_horizon) { ... mix(u_sky_color, u_horizon_color, ...) }
 *
 * `fog-color`, `fog-ground-blend`, `horizon-fog-blend` and `atmosphere-blend` are
 * accepted by `setSky` and stored, and in this version are consumed ONLY by
 * `terrainUniformValues`. This map sets no terrain, so all four are inert. They
 * are not set here: a property that does nothing is a claim that something happens.
 *
 * AND THERE IS NO AZIMUTH IN IT. The shader's only spatial input is `gl_FragCoord.y`
 * against a horizon line. So the computed sun colours this sky by its HEIGHT, and
 * cannot place a glow on its BEARING — that would need a version whose sky knows
 * where it is looking. The compass dial and the key light carry the bearing; this
 * carries the hour.
 *
 * @param elevationDeg   solar elevation; the whole day/night blend
 * @param cloudFraction  0–1, live cloud cover; desaturates both colours
 * @param environment    the basemap in use — a violet night sky over the light
 *                       Clay basemap would read as a rendering fault, not a mood
 */
export function maplibreSky(
  elevationDeg: number,
  cloudFraction: number,
  environment: 'dark' | 'studio' = 'dark',
): MapLibreSky {
  const day = smoothstep(-8, 12, elevationDeg);
  const cloud = Math.min(1, Math.max(0, cloudFraction));
  const p = environment === 'studio' ? STUDIO_SKY : SLATE_SKY;
  return {
    'sky-color': mixHex(mixHex(p.nightSky, p.daySky, day), p.overcast, cloud * 0.55),
    'horizon-color': mixHex(mixHex(p.nightHorizon, p.dayHorizon, day), p.overcast, cloud * 0.45),
    // a night horizon is a soft wash; a clear day one is a tighter band
    'sky-horizon-blend': 0.9 - 0.35 * day,
  };
}

/* OBOS Slate's own family — ground #14131f, arterial #726d99. The sky is a
   deep blue-violet by day rather than a photographic blue, because this is an
   instrument and the heat ramp has to own warm outright. The climate-stripes red
   is sealed and appears nowhere in here, including in any dusk glow: there is no
   dusk glow, the palette interpolates night to day and stops. */
const SLATE_SKY = {
  nightSky: '#0d0c16', nightHorizon: '#221f33',
  daySky: '#2f3560', dayHorizon: '#6b6b96',
  overcast: '#4a4a58',
} as const;

/* Clay/positron is a light basemap; the same violet over it reads as a bug. */
const STUDIO_SKY = {
  nightSky: '#3f4356', nightHorizon: '#767a8c',
  daySky: '#8ea3c6', dayHorizon: '#d7dde8',
  overcast: '#b9bcc4',
} as const;

function mixHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const va = parseInt(a.slice(i, i + 2), 16);
    const vb = parseInt(b.slice(i, i + 2), 16);
    out += Math.round(va + (vb - va) * k).toString(16).padStart(2, '0');
  }
  return out;
}
