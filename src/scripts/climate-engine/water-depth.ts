/**
 * water-depth.ts — how far each point is from the nearest shore.
 *
 * WHY DISTANCE FROM THE EDGE IS THE RIGHT PROXY. We have polygon outlines and
 * nothing else: no bathymetry, no soundings, and the pond census that might have
 * carried depth covers one ward of three. But shorelines shelve — a pond is
 * shallow where it meets land and deepest near its middle — so distance to the
 * nearest edge tracks depth closely enough to draw, and it scales the way the eye
 * expects: a 12 ha river reads deep, a 200 m² tank reads shallow, with no
 * per-feature tuning and nothing invented.
 *
 * It is also exactly the paper-cut contour look: quantise this field and you get
 * the concentric bands, for free, from the same numbers.
 *
 * PURE AND NODE-TESTABLE. No canvas, no WebGL, no DOM — a scanline fill and a
 * two-pass chamfer transform over a typed array. That keeps the visual layer's
 * one non-obvious computation checkable without a browser.
 */

/** Grid side for the field. 256 over 1520 m is ~6 m/texel — finer than the
 *  simulation's 7.29 m cells, and one channel, so ~65 KB per ward. */
export const DEPTH_N = 256;

/** Chamfer weights: 3-4 is the classic integer approximation to Euclidean
 *  distance, accurate to ~2 % and two passes instead of a full EDT. */
const STEP_ORTHO = 3;
const STEP_DIAG = 4;

export interface DepthField {
  /** DEPTH_N² bytes, 0 = land or shore, 255 = furthest point from any shore */
  readonly data: Uint8Array;
  readonly n: number;
  /** metres the field spans, edge to edge — the caller's clip box */
  readonly sizeM: number;
  /** greatest shore distance found, metres — 0 when there is no water */
  readonly maxDistM: number;
}

/** Flat [x,y,…] ring → mask cells, by scanline. */
function fillRing(mask: Uint8Array, ring: readonly number[], n: number, sizeM: number): void {
  const half = sizeM / 2;
  const toCell = (v: number) => ((v + half) / sizeM) * n;
  const count = ring.length / 2;
  if (count < 3) return;

  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < ring.length; i += 2) {
    const y = toCell(ring[i]);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rowFrom = Math.max(0, Math.ceil(minY - 0.5));
  const rowTo = Math.min(n - 1, Math.floor(maxY + 0.5));

  const crossings: number[] = [];
  for (let row = rowFrom; row <= rowTo; row++) {
    const scanY = row + 0.5;
    crossings.length = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const ay = toCell(ring[i * 2 + 1]), by = toCell(ring[j * 2 + 1]);
      if ((ay > scanY) === (by > scanY)) continue;          // edge does not span the row
      const ax = toCell(ring[i * 2]), bx = toCell(ring[j * 2]);
      crossings.push(ax + ((scanY - ay) / (by - ay)) * (bx - ax));
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    /* Even-odd fill: the same rule ward-raster uses, so a polygon with a hole
       punched by a reversed inner ring behaves consistently across the two. */
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(n - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let col = from; col <= to; col++) mask[row * n + col] = 1;
    }
  }
}

/** Two-pass chamfer distance transform, in place, over the wet cells. */
function chamfer(dist: Int32Array, n: number): void {
  const at = (r: number, c: number) => dist[r * n + c];
  const put = (r: number, c: number, v: number) => { if (v < dist[r * n + c]) dist[r * n + c] = v; };

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (dist[r * n + c] === 0) continue;
      if (r > 0) {
        put(r, c, at(r - 1, c) + STEP_ORTHO);
        if (c > 0) put(r, c, at(r - 1, c - 1) + STEP_DIAG);
        if (c + 1 < n) put(r, c, at(r - 1, c + 1) + STEP_DIAG);
      }
      if (c > 0) put(r, c, at(r, c - 1) + STEP_ORTHO);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = n - 1; c >= 0; c--) {
      if (dist[r * n + c] === 0) continue;
      if (r + 1 < n) {
        put(r, c, at(r + 1, c) + STEP_ORTHO);
        if (c + 1 < n) put(r, c, at(r + 1, c + 1) + STEP_DIAG);
        if (c > 0) put(r, c, at(r + 1, c - 1) + STEP_DIAG);
      }
      if (c + 1 < n) put(r, c, at(r, c + 1) + STEP_ORTHO);
    }
  }
}

/**
 * Build the shore-distance field for one ward's water.
 *
 * Returns 0 outside water and on the shoreline, rising toward the interior. The
 * byte scale is NORMALISED PER WARD, so a pond in a pondy ward still shows its
 * own shelving — the alternative, a single global scale, renders every small
 * water body flat black beside a river.
 */
export function buildDepthField(
  polys: readonly { readonly p: readonly number[] }[],
  sizeM: number,
  n: number = DEPTH_N,
): DepthField {
  const total = n * n;
  const mask = new Uint8Array(total);
  for (const poly of polys) fillRing(mask, poly.p, n, sizeM);

  const INF = 0x3fffffff;
  const dist = new Int32Array(total);
  for (let i = 0; i < total; i++) dist[i] = mask[i] ? INF : 0;
  chamfer(dist, n);

  let peak = 0;
  for (let i = 0; i < total; i++) if (dist[i] < INF && dist[i] > peak) peak = dist[i];

  const data = new Uint8Array(total);
  if (peak > 0) {
    for (let i = 0; i < total; i++) {
      if (dist[i] === 0 || dist[i] === INF) continue;
      data[i] = Math.max(1, Math.round((dist[i] / peak) * 255));
    }
  }
  /* Chamfer counts in STEP_ORTHO units per cell, so metres are
     (chamfer / STEP_ORTHO) cells × (sizeM / n) metres per cell. */
  const maxDistM = (peak / STEP_ORTHO) * (sizeM / n);
  return { data, n, sizeM, maxDistM };
}

/** ponytail: one runnable check — the shapes the shader depends on. */
export function assertWaterDepthLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`water-depth: ${m}`); };

  // A centred 400 m square in a 1000 m frame: deepest point is its middle,
  // 200 m from the nearest shore.
  const square = [{ p: [-200, -200, 200, -200, 200, 200, -200, 200] }];
  const field = buildDepthField(square, 1000, 64);
  const mid = field.data[(32 * 64) + 32];
  ok(mid === 255, `centre of a square should be the deepest point, got ${mid}`);
  ok(field.data[0] === 0, 'a corner of the frame is dry land and must read zero');
  ok(Math.abs(field.maxDistM - 200) < 25, `max shore distance ${field.maxDistM.toFixed(0)} m, expected ~200`);

  /* Shelving: wet but near the shore must read shallower than the middle.
     Column 21 is ~164 m west of centre — inside the square, whose western edge
     falls at cell 19.2 — so it is genuinely wet and about 36 m from land. */
  const nearEdge = field.data[(32 * 64) + 21];
  ok(nearEdge > 0 && nearEdge < mid, `edge ${nearEdge} should be wet but shallower than centre ${mid}`);
  // …and just outside that edge is land.
  ok(field.data[(32 * 64) + 17] === 0, 'a cell west of the shoreline must be dry');

  // Bigger water is deeper water — the whole reason this is size-aware.
  const small = buildDepthField([{ p: [-40, -40, 40, -40, 40, 40, -40, 40] }], 1000, 64);
  ok(small.maxDistM < field.maxDistM, 'a small pond must not read as deep as a large one');

  // No water is a real answer, not a divide by zero.
  const empty = buildDepthField([], 1000, 64);
  ok(empty.maxDistM === 0 && empty.data.every(v => v === 0), 'empty water must be all zero');
}
