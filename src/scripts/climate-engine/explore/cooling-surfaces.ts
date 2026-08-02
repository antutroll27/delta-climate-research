/**
 * cooling-surfaces.ts — where the vegetation is dense enough, and contiguous
 * enough, to actually cool the air around it.
 *
 * A single green pixel is not shade. This finds connected runs of vegetated
 * cells above a minimum area, which is the same shape of test the offline
 * thermal-refuge pipeline (scripts/compute-tra.py) applies — threshold, label
 * connected components, discard anything too small to matter.
 *
 * WHAT THIS IS NOT, and the UI must say so. The browser has only the measured
 * Sentinel-2 vegetation raster. It has no water mask (SimLayers.water ships as
 * zeros), so the Hooghly and every pond are invisible to it — Barrackpore sits
 * on a river this cannot see. It has no notion of public access either: a
 * gated lawn scores the same as a park. So these are "cooling surfaces",
 * never "refuges", and the distance to one is a straight line, not a walk.
 */

/**
 * 0–1 vegetation fraction below which a cell is not counted as cooling.
 *
 * READ THIS BEFORE QUOTING ANY DISTANCE THIS MODULE PRODUCES AS A FACT.
 * The result is far more sensitive to this constant than to any geometry.
 * Measured across all three wards, median distance from a building to the
 * nearest surviving patch:
 *
 *     threshold      Ballygunge   Baruipur   Barrackpore
 *     veg >= 0.45        42 m        12 m        60 m
 *     veg >= 0.50        86 m        32 m        66 m
 *     veg >= 0.55       242 m        66 m        92 m
 *
 * A 0.05 nudge moves the answer by up to 5.8x. 0.50 is chosen because it lands
 * within +10% (Ballygunge) and +16% (Baruipur) of the independent offline TRA
 * pipeline's ward medians — Barrackpore diverges because that ward sits on the
 * Hooghly and the browser has no water mask — but "within 10% of another
 * estimate" is not precision. The UI therefore states a BAND against the walk
 * rings, whose radii are exact, and offers the metres only as approximate.
 */
export const VEG_THRESHOLD = 0.5;
/** Minimum patch area in m². 0.77 ha mirrors compute-tra.py's floor. */
export const MIN_PATCH_M2 = 7_700;

export interface CoolingSurfaces {
  /** grid-sized mask, 1 where a surviving patch covers the cell */
  readonly mask: Uint8Array;
  /** flat indices of every surviving cell, for nearest-neighbour queries */
  readonly cells: Int32Array;
  readonly patchCount: number;
  /** total area of surviving patches, m² */
  readonly areaM2: number;
}

/**
 * Threshold + 4-connected components + minimum-area filter.
 *
 * Iterative flood fill with an explicit stack: a ward can hold one patch of
 * several thousand cells, and recursion at that depth is a stack overflow in a
 * browser. Runs once per ward load, ~37k cells.
 */
export function findCoolingSurfaces(
  veg: Float32Array, n: number, cellM2: number,
  threshold = VEG_THRESHOLD, minAreaM2 = MIN_PATCH_M2,
): CoolingSurfaces {
  const total = n * n;
  const seen = new Uint8Array(total);
  const mask = new Uint8Array(total);
  const keep: number[] = [];
  const stack: number[] = [];
  const patch: number[] = [];
  const minCells = Math.max(1, Math.ceil(minAreaM2 / cellM2));
  let patchCount = 0;

  for (let s = 0; s < total; s++) {
    if (seen[s] || veg[s] < threshold) continue;
    patch.length = 0; stack.length = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      patch.push(c);
      const x = c % n, y = (c / n) | 0;
      /* 4-connected, and the x guards matter: without them a cell on the right
         edge would flood into the left edge of the next row down. */
      if (x + 1 < n && !seen[c + 1] && veg[c + 1] >= threshold) { seen[c + 1] = 1; stack.push(c + 1); }
      if (x > 0 && !seen[c - 1] && veg[c - 1] >= threshold) { seen[c - 1] = 1; stack.push(c - 1); }
      if (y + 1 < n && !seen[c + n] && veg[c + n] >= threshold) { seen[c + n] = 1; stack.push(c + n); }
      if (y > 0 && !seen[c - n] && veg[c - n] >= threshold) { seen[c - n] = 1; stack.push(c - n); }
    }
    if (patch.length >= minCells) {
      patchCount++;
      for (const c of patch) { mask[c] = 1; keep.push(c); }
    }
  }
  return {
    mask, cells: Int32Array.from(keep), patchCount,
    areaM2: keep.length * cellM2,
  };
}

/**
 * Straight-line distance to the nearest cooling cell.
 *
 * Pass `ring` (the building's footprint, flat [x,z,…]) to measure from the
 * building's nearest CORNER rather than its centre. Nobody steps out of the
 * middle of a building, and on a ward's worth of footprints the centroid
 * overstates the walk by a median of ~11 m — free accuracy for one loop.
 *
 * Linear scan. A ward holds a few thousand surviving cells and this runs once
 * per selection, so an index would be optimising a cost nobody pays.
 * Returns null when the ward has no qualifying patch at all, which is a real
 * answer and must be said rather than rendered as a zero.
 */
export function nearestCooling(
  surfaces: CoolingSurfaces, x: number, z: number, n: number, sizeM: number,
  ring?: ArrayLike<number>,
): { x: number; z: number; distM: number } | null {
  const half = sizeM / 2, cell = sizeM / n;
  const verts = ring && ring.length >= 6 ? ring : null;
  let best = -1, bestD2 = Infinity;
  for (let i = 0; i < surfaces.cells.length; i++) {
    const c = surfaces.cells[i];
    const cx = ((c % n) + 0.5) * cell - half;
    const cz = (((c / n) | 0) + 0.5) * cell - half;
    let d2 = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (verts) {
      /* Cheap reject: a corner can only beat the centroid's distance by at most
         the building's own radius, so skip the vertex loop unless this cell is
         already in contention. */
      if (d2 < bestD2 * 4) {
        for (let v = 0; v + 1 < verts.length; v += 2) {
          const dx = cx - verts[v], dz = cz - verts[v + 1];
          const vd2 = dx * dx + dz * dz;
          if (vd2 < d2) d2 = vd2;
        }
      }
    }
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  if (best < 0) return null;
  return {
    x: ((best % n) + 0.5) * cell - half,
    z: (((best / n) | 0) + 0.5) * cell - half,
    distM: Math.sqrt(bestD2),
  };
}
