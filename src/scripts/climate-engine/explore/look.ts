/**
 * look.ts — which look the OBOS city draws, and every number that look is made of.
 *
 * THE DEFAULT IS THE EDITORIAL LOOK ("D"), the founder's pick of 2026-10-02 after
 * four preview rounds (A = the look shipped until then, B = editorial Clay, C = a
 * contrast pass over B, D = the middle ground), on every screen including phones.
 * `?look=classic` draws the look shipped before that, byte for byte: the classic
 * shaders are kept as separate strings chosen at construction, never patched, so
 * the switch is a one-query rollback and an A/B reference, not a second design.
 *
 * NOTHING IN HERE TOUCHES THE PHYSICS. It is colour, light levels, haze and soft
 * contact shading on the drawn city. The heat ramp's colours and temperatures are
 * untouched; the editorial look only makes the existing tint more VISIBLE over a
 * paler ground.
 *
 * NO CAST SHADOWS IN EITHER LOOK, and no bloom. Per-building shadow failed its
 * pre-registered night placebo (p = 5.4e-07; relief-renderer.ts, `applySun`), so a
 * shadow here would be read as a shade term the model does not have. Contact
 * shading is a baked, sun-independent darkening where blocks meet the ground: it
 * says "this block stands on that ground" and claims nothing about shade.
 *
 * THREE.JS-FREE ON PURPOSE: heat-map-app.ts imports this statically, and the
 * explore core must not pull three into its chunk (heat-explore-module-boundary).
 */

export type LookName = 'd' | 'classic';

/** The look a query string asks for. Anything but `look=classic` is the default. */
export function lookFromSearch(search: string): LookName {
  return new URLSearchParams(search).get('look') === 'classic' ? 'classic' : 'd';
}

function readLook(): LookName {
  if (typeof location === 'undefined') return 'd';
  try { return lookFromSearch(location.search); } catch { return 'd'; }
}

export const LOOK: LookName = readLook();
/** `?look=classic`: the look shipped before 2026-10-02 — rollback and A/B only. */
export const CLASSIC: boolean = LOOK === 'classic';

/**
 * A PHONE-SIZED FRAME: a viewport under 600 px wide, or a touch screen under
 * 600 px tall (a phone on its side). The editorial look is tuned on a desktop
 * frame; on a phone-sized one the same streets and tint read thinner, so a
 * handful of Clay values (`CLAY_PHONE`, below) are pushed a step further.
 *
 * NOT "a touch screen". It used to be `(pointer: coarse) || innerWidth < 600`,
 * read once at load: an iPad at 1180×820, and every touch laptop, got the phone
 * values, and a desktop window dragged from 500 to 1400 px kept them. Both
 * halves of this query are viewport sizes, so its `change` event re-evaluates
 * it on a resize or a rotation (`watchPhone`).
 */
export const PHONE_QUERY = '(max-width: 599.98px), (pointer: coarse) and (max-height: 599.98px)';

/** Is the frame phone-sized right now? Always false under `?look=classic`, which has no phone values. */
export function isPhone(): boolean {
  if (CLASSIC || typeof matchMedia !== 'function') return false;
  return matchMedia(PHONE_QUERY).matches;
}

/**
 * Call `onChange` whenever the frame crosses the phone line (a resize, a
 * rotation, a split view). Returns the unsubscribe. Inert under classic.
 */
export function watchPhone(onChange: (phone: boolean) => void): () => void {
  if (CLASSIC || typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(PHONE_QUERY);
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches);
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

/** Clay's light, per look. Colours are hemisphere sky/ground; levels are BASE levels the sun scales. */
export interface StudioLight { sky: number; ground: number; hemi: number; key: number; rim: number; }

/** The Clay light shipped until 2026-10-02 — what `?look=classic` restores. */
export const CLASSIC_STUDIO_LIGHT: StudioLight = { sky: 0xffffff, ground: 0xd8d2c8, hemi: 1.45, key: 1.7, rim: 0.12 };

/**
 * The editorial Clay light: less sky fill and a stronger key, so blocks read by a
 * lit top against mid walls and pooled contact rather than by hard contrast; and
 * no rim, which on paper read as a cyan fringe rather than as light.
 */
export const EDITORIAL_STUDIO_LIGHT: StudioLight = { sky: 0xf4f6f8, ground: 0xcfc6b8, hemi: 1.05, key: 2.10, rim: 0 };

export const STUDIO_LIGHT: StudioLight = CLASSIC ? CLASSIC_STUDIO_LIGHT : EDITORIAL_STUDIO_LIGHT;

/**
 * THE EDITORIAL CLAY, in one place so a reviewer can read the whole look.
 *
 * Every value here is VALUE (light, dark, edge) or the VISIBILITY of the existing
 * heat tint — never a ramp colour, never a temperature, never a warm hue in the
 * base (a unit test holds the base colours out of the ramp's red/orange band).
 * `?look=classic` reads none of it. These are the DESKTOP values; a phone-sized
 * frame swaps in `CLAY_PHONE`'s, read through `clayFor(phone)`.
 */
export const CLAY = {
  /** Contact occlusion strength. On the ground it shows only where no heat tint is drawn
      (heat-overlay.ts); the walls' contact shading is where the crowns' lost contrast is bought back. */
  ao: 0.80,
  /** Weights of the tight (aoNearM) and wide (≈ 8 m) contact blurs. */
  aoNear: 0.85, aoFar: 0.30,
  /** Radius of the tight contact blur: a crisp edge where a block meets the ground. */
  aoNearM: 1.3,
  /** Aerial haze amount — near zero, so the heat ramp stays legible at distance. */
  haze: 0.03,
  /** Haze target: the paper, cooled a touch, so distance lifts instead of greying. */
  hazeCol: '#e8e9e6',
  /** What a grazing view of the water reflects: Clay's midday horizon. */
  horizon: '#e2e4e3',
  /** × the heat overlay's own opacity, so the tint holds its weight over the paper. */
  overlayBoost: 1.22,
  /** Building tint: smoothstep(lo, hi, t) × weight — earlier and fuller than classic's .10/.52/.92. */
  tintLo: 0.06, tintHi: 0.44, tintW: 0.98,
  /** Floor lines: line colour = body × lineK, drawn at strokeK. */
  lineK: 0.80, strokeK: 0.62,
  /** Wall value at its own ground, rising to 1 over the first few metres (contact). */
  wallFloor: 0.54,
  /** How much of the concrete roof tone an untinted roof takes. */
  roofMix: 0.10,
  /** The block body: the infographic's warm off-white — a neutral, not a warm hue. */
  building: '#f1ede6',
  /** Roof concrete. */
  roof: '#a39e96',
  /** Mid warm-grey asphalt, so a street reads as a cut in the sheet, not a drawn line. */
  asphalt: '#746f67', roadAlpha: 0.96,
  /** DRAWN road width multiplier; the model's widths never read it. */
  roadWidth: 1.15,
  /** Crown centre height (crown radii above the trunk) and vertical squash: lower,
      squatter crowns so roofs and their tint stand clear at the oblique camera. */
  crownLift: 0.55, crownSquash: 0.78,
  /** Water, shallow → deep teal by Beer–Lambert over metres from shore (fall-off waterK m). */
  waterShallow: '#86cbb7', waterDeep: '#136f69', waterK: 9.0,
} as const;

/**
 * The Clay values a PHONE-SIZED frame (`isPhone`) pushes a step further: on a
 * small frame the same streets and tint read thinner. Value and visibility only,
 * like everything in CLAY.
 */
export const CLAY_PHONE = {
  overlayBoost: 1.30, tintW: 1.0, lineK: 0.70, strokeK: 0.75, wallFloor: 0.48,
  asphalt: '#5f5a54', roadWidth: 1.9,
} as const;

/** The phone-dependent Clay values for a frame. */
export interface ClayFrame {
  readonly overlayBoost: number; readonly tintW: number; readonly lineK: number; readonly strokeK: number;
  readonly wallFloor: number; readonly asphalt: string; readonly roadWidth: number;
}

/** CLAY's phone-dependent values for a desktop or a phone-sized frame. */
export function clayFor(phone: boolean): ClayFrame {
  if (phone) return CLAY_PHONE;
  const { overlayBoost, tintW, lineK, strokeK, wallFloor, asphalt, roadWidth } = CLAY;
  return { overlayBoost, tintW, lineK, strokeK, wallFloor, asphalt, roadWidth };
}

/** The editorial Dark: contact shading and the water's sky; no haze, light unchanged. */
export const DARK = {
  ao: 0.42, aoNear: 0.62, aoFar: 0.38, haze: 0,
  /** Slate's midday horizon, for the water's Fresnel. */
  horizon: '#6b6b96',
} as const;

/** What the ground overlay and the water read per environment (relief-renderer.ts `applyLook`). */
export interface LookAmounts { ao: number; aoNear: number; aoFar: number; haze: number; horizon: string; overlayBoost: number; }

/**
 * The per-environment amounts. THE OVERLAY BOOST IS CLAY'S ALONE: Dark draws the
 * heat tint at exactly the opacity classic did (× 1), because Dark's base did not
 * change and the boost exists only to hold the tint's weight over the pale paper.
 */
export function lookAmounts(studio: boolean, phone: boolean): LookAmounts {
  const env = studio ? CLAY : DARK;
  return {
    ao: env.ao, aoNear: env.aoNear, aoFar: env.aoFar, haze: env.haze, horizon: env.horizon,
    overlayBoost: studio ? clayFor(phone).overlayBoost : 1,
  };
}

/**
 * THE WARD BOUNDARY (ward-mask.ts), in both looks: the outline drawn on the
 * ground, and how the context outside the polygon is held back so a reader sees
 * the ward's heat first.
 *
 * NO HUE. The line is ink on paper in Clay and paper on ink in Dark — one new
 * neutral (`ink`) and the paper already in `CLAY.hazeCol` — so it can never read
 * as a heat class, and no warm colour enters the base (the palette test reads
 * this file). The veil DESATURATES and THINS the heat outside the polygon; it
 * never shifts a ramp colour inside it, and the ward's own pixels are untouched
 * (the same rule as contact shading: value and visibility, never the heat colour).
 */
export const WARD = {
  /** The outline's dark neutral. */
  ink: '#1c2326',
  /** Drawn widths of the outline's core and its contrasting halo, metres. */
  lineM: 6, haloM: 14,
  /** Opacity of the see-through pass: where a roof stands on the line, the line still
      shows through it this faintly, so the boundary reads whole without reading as a HUD. */
  xrayAlpha: 0.38,
  /** Metres above the ground: over the roads' and water's ribbons, under every roof. */
  liftM: 1.6,
  /** Outside the polygon, the heat overlay is desaturated by this share and its opacity scaled by `veilAlpha`. */
  veilDesat: 0.35, veilAlpha: 0.6,
  /** Out-of-ward buildings: their tint desaturated by this share, then faded toward the paper (Clay) or dimmed (Dark). */
  buildingDesat: 0.35, buildingFadeClay: 0.2, buildingDimDark: 0.82,
} as const;

/** Below this height the glint holds a high sun, so a night lake keeps a faint sheen. */
export const GLINT_MIN_SUN_Y = 0.25;

/**
 * The water's glint direction FROM THE REAL SUN (scene frame: +x east, +y up,
 * +z north) — the same vector that aims the key light, so the highlight sits where
 * the compass says the sun is. The classic water used a fixed north-east sun.
 */
export function glintSun(sun: { x: number; y: number; z: number }): [number, number, number] {
  const y = Math.max(sun.y, GLINT_MIN_SUN_Y);
  const n = Math.hypot(sun.x, y, sun.z) || 1;
  return [sun.x / n, y / n, sun.z / n];
}

/**
 * `?lab=1` exposes the map as `window.__obosMap` for the look-capture and perf
 * harnesses (camera pinning, the stress orbit). Nothing in the app reads it.
 *
 * LOCAL ONLY. On the production host the query is ignored, so the live site
 * never hands a page script its map: the harnesses run against `astro dev` or
 * `astro preview` on localhost / 127.0.0.1, where the hook still works.
 */
export function labHookAllowed(search: string, hostname: string): boolean {
  return new URLSearchParams(search).get('lab') === '1'
    && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);
}

export const LAB_HOOK: boolean = typeof location !== 'undefined'
  && labHookAllowed(location.search, location.hostname);
