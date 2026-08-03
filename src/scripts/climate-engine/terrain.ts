/**
 * terrain.ts — the ground the scene sits on, and the one thing it must never claim.
 *
 * WHAT THIS IS. A smoothed 128² heightfield per ward, baked offline by
 * `scripts/fetch-terrain.py` from AWS terrain tiles (SRTM-derived over India),
 * median-filtered at ~40 m to strip rooftops out of what is fundamentally a
 * SURFACE model, and stored in metres relative to the window median.
 *
 * WHAT IT IS NOT, and why the label is not optional. Two independent instruments
 * were asked the same question and gave different answers: terrarium (SRTM) and
 * Copernicus GLO-30 (TanDEM-X) agree about this ground only to r ≈ 0.5, with a
 * per-cell RMSE of 1.5–2.1 m against a total relief of 4.9–7.7 m. Their mutual
 * disagreement is roughly a quarter of the entire signal. On a delta this flat,
 * free elevation data cannot resolve the shape of the land.
 *
 * So this is INDICATIVE BROAD-SCALE FORM. Three consequences, all enforced:
 *
 *   1. It is drawn EXAGGERATED, because 5–8 m across 1400 m is invisible at the
 *      map's pitch — and the multiplier is displayed, because an unlabelled
 *      exaggeration is a lie about slope.
 *   2. BUILDING HEIGHTS ARE NEVER EXAGGERATED WITH IT. Only the ground scales;
 *      buildings keep their measured extrusion, so the one thing a reader might
 *      measure off the screen stays true.
 *   3. It NEVER enters the simulation. `SimLayers` has no terrain channel and is
 *      not gaining one: a 3–5 m elevation range has no thermal significance at
 *      ward scale, and a layer this uncertain has no business near a published
 *      ±3.0 K band.
 *
 * Pure and node-testable — no canvas, no WebGL, no DOM.
 */

/** Grid side of the baked field. 128 over 1400 m ≈ 11 m/texel. */
export const TERRAIN_N = 128;

/**
 * Ground exaggeration. ×4 sits between "invisible" and "mountainous": it lifts
 * Barrackpore's 4.9 m of relief to ~20 m of drawn form, which reads under 20–50 m
 * buildings without competing with them. Displayed to the reader, never hidden.
 */
export const TERRAIN_EXAGGERATION = 4;

export interface TerrainField {
  readonly ward: string;
  /** TERRAIN_N² heights in metres, relative to the window median */
  readonly h: readonly number[];
  readonly n: number;
  readonly sizeM: number;
  /** p5–p95 span of the raw crop, before smoothing */
  readonly rawSpanM: number;
  /** …and after — what the eye actually sees */
  readonly smoothSpanM: number;
  readonly confidence: string;
}

/**
 * Height in metres at a point in the ward's local frame, bilinear.
 *
 * THE FRAME. Building rows are `[h, x0,y0, …]` and the scene builds
 * `Shape(x, −y)` then rotates −90° about X, which lands world `(x, z)` on data
 * `(x, y)`. So world x/z index the field directly. Field row 0 is the window's
 * NORTH edge, because tile y grows southward — which `(y + half)/size` gives.
 *
 * Out-of-window samples clamp to the edge rather than throwing: the roads and
 * water artefacts are clipped to a slightly larger box than the field, and a
 * hard failure at the margin would be a worse answer than the nearest shore.
 */
export function terrainAt(field: TerrainField, x: number, y: number): number {
  const n = field.n;
  const half = field.sizeM / 2;
  const fx = Math.min(n - 1.001, Math.max(0, ((x + half) / field.sizeM) * (n - 1)));
  const fy = Math.min(n - 1.001, Math.max(0, ((y + half) / field.sizeM) * (n - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const at = (r: number, c: number) => field.h[r * n + c];
  return (at(y0, x0) * (1 - ax) + at(y0, x0 + 1) * ax) * (1 - ay)
       + (at(y0 + 1, x0) * (1 - ax) + at(y0 + 1, x0 + 1) * ax) * ay;
}

/** The same, scaled for drawing. The ONLY place exaggeration is applied. */
export function terrainDrawAt(field: TerrainField | null, x: number, y: number): number {
  return field ? TERRAIN_EXAGGERATION * terrainAt(field, x, y) : 0;
}

/** The label the reader sees. An exaggeration nobody is told about is a lie about slope. */
export function terrainLabel(field: TerrainField | null): string {
  if (!field) return '';
  return `ground ×${TERRAIN_EXAGGERATION} · indicative relief`;
}

/**
 * Narrow an unknown fetch result to a usable field, or null.
 *
 * The loaders in this engine swallow to empty rather than throw — a missing
 * terrain artefact must leave the map flat and working, exactly as it is today,
 * never half-displaced or broken.
 */
export function asTerrainField(raw: unknown): TerrainField | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const h = d.h, n = d.n, sizeM = d.sizeM;
  if (!Array.isArray(h) || typeof n !== 'number' || typeof sizeM !== 'number') return null;
  if (h.length !== n * n) return null;
  return {
    ward: typeof d.ward === 'string' ? d.ward : '',
    h: h as number[],
    n, sizeM,
    rawSpanM: typeof d.rawSpanM === 'number' ? d.rawSpanM : 0,
    smoothSpanM: typeof d.smoothSpanM === 'number' ? d.smoothSpanM : 0,
    confidence: typeof d.confidence === 'string' ? d.confidence : 'indicative',
  };
}

/** ponytail: one runnable check — the shapes the scene depends on. */
export function assertTerrainLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`terrain: ${m}`); };

  // A 4×4 ramp rising west→east: interpolation must be monotonic and exact at nodes.
  const n = 4, sizeM = 400;
  const h: number[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h.push(c);
  const f: TerrainField = { ward: 't', h, n, sizeM, rawSpanM: 3, smoothSpanM: 3, confidence: 'indicative' };

  ok(Math.abs(terrainAt(f, -sizeM / 2, 0) - 0) < 1e-9, 'west edge should read the first column');
  /* The east edge lands at 2.999, not 3: `n - 1.001` deliberately holds the
     sample one thousandth inside the last cell so that x0 + 1 can never index
     past the array. A millimetre of height at the frame's rim is the correct
     price for never reading out of bounds. */
  ok(Math.abs(terrainAt(f, sizeM / 2, 0) - 3) < 0.01, 'east edge should read the last column');
  const mid = terrainAt(f, 0, 0);
  ok(mid > 1.4 && mid < 1.6, `centre of a 0..3 ramp should be ~1.5, got ${mid}`);
  ok(terrainAt(f, -100, 0) < terrainAt(f, 100, 0), 'the ramp must rise eastward');

  // Out of window clamps rather than throwing or returning NaN.
  for (const x of [-9999, 9999]) {
    const v = terrainAt(f, x, 0);
    ok(Number.isFinite(v), `out-of-window sample at ${x} must be finite, got ${v}`);
  }

  // Exaggeration applies once, and a missing field is flat — never broken.
  ok(terrainDrawAt(f, 0, 0) === TERRAIN_EXAGGERATION * mid, 'draw height must scale exactly once');
  ok(terrainDrawAt(null, 0, 0) === 0, 'a missing field must read flat, not NaN');
  ok(terrainLabel(null) === '', 'no field, no label');
  ok(terrainLabel(f).includes(`×${TERRAIN_EXAGGERATION}`), 'the label must state the multiplier');

  // The guard: malformed artefacts are rejected, not half-loaded.
  ok(asTerrainField(null) === null, 'null is not a field');
  ok(asTerrainField({ h: [1, 2], n: 4, sizeM: 400 }) === null, 'a short h array must be rejected');
  ok(asTerrainField({ h, n, sizeM })?.n === n, 'a well-formed artefact must load');
}
