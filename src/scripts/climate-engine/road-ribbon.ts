/**
 * road-ribbon.ts — OSM centrelines as draped quad strips, and the width table.
 *
 * RENDER ONLY. Nothing here reaches SimLayers or Spatial. The simulation has its
 * OWN road width — `rad = way.w > 1 ? 2 : 1` in heat-map-model.ts, which at
 * dx ≈ 7.29 m/cell is a 36.5 m / 21.9 m band. That is a TREE-PLANTING CORRIDOR,
 * not a carriageway, and it feeds corridorSorted → treeCorridorCells → the
 * published cost and cooling figures (compare/paired-runner.ts builds Spatial
 * too). The two numbers describe different things and must never be reconciled.
 *
 * WHERE THE WIDTHS COME FROM. An Overpass survey of the 447 highway ways in the
 * Ballygunge window (2026-08-04) found:
 *
 *   width      0 / 447    OSM carries no carriageway width for Kolkata at all
 *   est_width  0 / 447
 *   lanes     24 /  31 primary ways — 22 × 4 lanes, 2 × 8
 *   lanes      5 / 390 residential + service ways — not a sample, a rumour
 *
 * So the major class is DERIVED (4 lanes × 3.25 m ≈ 14 m) and the minor class is
 * ASSUMED (4 m). The `source` field records which is which, because 14 and 4 are
 * not equally supported and a reader has no way to tell by looking.
 *
 * These are deliberately NARROWER than the basemap's painted casing. Measured
 * residual building overlap is ~4 % major / ~17 % minor against 38 % for the
 * basemap — and that residue is genuine zero-setback frontage. Widening these
 * constants to chase a prettier picture manufactures overlap that is not there.
 *
 * Pure and node-testable — no THREE, no canvas, no DOM.
 */
import type { RoadsData } from './heat-map-model';

export const ROAD_WIDTH_M: Readonly<Record<number, { widthM: number; source: string }>> =
  Object.freeze({
    2: Object.freeze({ widthM: 14, source: 'osm-lanes' }),
    1: Object.freeze({ widthM: 4, source: 'assumed' }),
  });

/** Above the heat overlay (ground + 0.6), below the water surface (ground + 0.9). */
export const ROAD_Y = 0.75;

/**
 * Mitre clamp. At a hairpin the exact mitre is half-width / cos(θ/2), which runs
 * to infinity as the way doubles back — and OSM service roads round car parks do
 * exactly that. 3× half-width is past any join that reads as a corner and short
 * of anything that reads as a spike.
 */
const MITRE_MAX = 3;

/** Unknown classes take the minor width: a road we cannot classify is far more
 *  likely to be a gully than an arterial, and under-drawing is the safe error. */
export function roadHalfWidthM(w: number): number {
  return (ROAD_WIDTH_M[w] ?? ROAD_WIDTH_M[1]).widthM / 2;
}

export interface RoadMesh {
  /** flat [x, y, z, …] world positions, y already draped */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** how many ways actually contributed geometry — for the honesty readout */
  readonly ways: number;
}

/** Drop consecutive duplicates; OSM ways carry them and they make normals NaN. */
function points(p: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - y) < 1e-6) continue;
    out.push([x, y]);
  }
  return out;
}

/**
 * Every way in the artefact as ONE indexed triangle soup, ready for a single
 * draw call.
 *
 * @param groundAt drawn ground height in metres at a point in the DATA frame
 *   (x east, y north). Sampled per vertex, not per way: a road follows the land,
 *   which is the one way it differs from water — a lane really does run downhill.
 */
export function buildRoadMesh(
  data: RoadsData,
  groundAt: (x: number, y: number) => number,
): RoadMesh | null {
  const pos: number[] = [], idx: number[] = [];
  let ways = 0;

  for (const way of data.ways ?? []) {
    const pts = points(way.p ?? []);
    if (pts.length < 2) continue;
    const half = roadHalfWidthM(way.w);
    const base = pos.length / 3;

    /* Unit normal of each segment, left-hand side. */
    const segN: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dy) || 1;
      segN.push([-dy / len, dx / len]);
    }

    for (let i = 0; i < pts.length; i++) {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
      let nx = a[0] + b[0], ny = a[1] + b[1];
      const len = Math.hypot(nx, ny);
      /* A doubled-back join sums to zero; fall back to one side's normal. */
      if (len < 1e-6) { nx = b[0]; ny = b[1]; }
      else { nx /= len; ny /= len; }
      /* Exact mitre: scale by 1/cos(half-angle) = 1/(m · n). Clamped both ways. */
      const scale = Math.min(MITRE_MAX, 1 / Math.max(1e-3, nx * b[0] + ny * b[1]));
      const off = half * scale;
      for (const s of [1, -1]) {
        const x = pts[i][0] + nx * off * s, y = pts[i][1] + ny * off * s;
        pos.push(x, groundAt(x, y) + ROAD_Y, y);
      }
    }

    for (let i = 0; i + 1 < pts.length; i++) {
      const q = base + i * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    ways++;
  }

  if (!ways) return null;
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), ways };
}
