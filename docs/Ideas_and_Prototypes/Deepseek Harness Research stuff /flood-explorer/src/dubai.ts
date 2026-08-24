/**
 * Real Dubai Creek geometry for the renderer.
 *
 * Terrain: DeltaDTM v1.1 bare earth, 256^2 at 30 m (7.68 km window), CC BY 4.0.
 * Buildings: 13,577 Microsoft GlobalML footprints, CDLA-Permissive-2.0.
 *
 * TWO THINGS THIS FILE IS HONEST ABOUT, BECAUSE BOTH ARE VISIBLE ON SCREEN.
 *
 * 1. VERTICAL EXAGGERATION. Real relief across this window is 5.66 m p5-p95 over
 *    7.68 km. At 1:1 that is invisible — the city is genuinely flat, and the
 *    synthetic terrain this replaces had 45 m of drama that did not exist. The
 *    terrain is drawn at TERRAIN_EXAG and the HUD says so. Buildings are NOT
 *    exaggerated; they sit at true height on the stretched surface, which is the
 *    usual convention and keeps their scale readable against the water.
 *
 * 2. HEIGHTS ARE ESTIMATED, NOT MEASURED. GlobalML ships a `height` property and
 *    for the UAE it is -1.0 on every one of 241,667 footprints. Google Open
 *    Buildings 2.5D excludes all six GCC states. So no open per-building height
 *    exists for Dubai and these come from a footprint-area prior. Validated
 *    against Dubai's own OSM tags, that class of model runs RMSE ~5 m below 10 m
 *    and 45-117 m above 50 m — fine for villas, useless for towers. Footprints
 *    are measured; heights are a guess wearing a plausible shape, and the
 *    provenance card must keep saying so.
 */
import * as THREE from 'three';

export const TERRAIN_EXAG = 6.0;

export interface SiteData {
  n: number;
  cellM: number;
  domainM: number;
  h: Float32Array;          // bare-earth elevation, m
  bcr: Float32Array;        // building coverage ratio, 0..1
  rings: Float32Array[];    // footprint rings, flat [x,y,...] in site-local metres
  meta: { reliefM: number; count: number; licence: string };
}

interface TerrainDoc {
  n: number; cellM: number; footprintM: number;
  h: number[]; bcr: number[];
  dtm: { p5: number; p95: number; min: number; max: number };
  licence: string;
}
interface BuildingsDoc { count: number; licence: string; b: { p: number[] }[] }

export async function loadSite(base = 'data'): Promise<SiteData> {
  const [t, b] = await Promise.all([
    fetch(`${base}/dubai-creek-terrain.json`).then((r) => r.json() as Promise<TerrainDoc>),
    fetch(`${base}/dubai-creek-buildings.json`).then((r) => r.json() as Promise<BuildingsDoc>),
  ]);
  return {
    n: t.n,
    cellM: t.cellM,
    domainM: t.footprintM,
    h: Float32Array.from(t.h),
    bcr: Float32Array.from(t.bcr),
    rings: b.b.map((x) => Float32Array.from(x.p)),
    meta: {
      reliefM: t.dtm.p95 - t.dtm.p5,
      count: b.count,
      licence: `${t.licence} · ${b.licence}`,
    },
  };
}

/** Bilinear ground height, metres, at a site-local position. */
export function sampleGround(site: SiteData, x: number, y: number): number {
  const { n, domainM, h } = site;
  const fx = ((x + domainM / 2) / domainM) * (n - 1);
  const fy = ((y + domainM / 2) / domainM) * (n - 1);
  const i = Math.max(0, Math.min(n - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(n - 2, Math.floor(fy)));
  const u = fx - i, v = fy - j;
  const a = h[j * n + i], bb = h[j * n + i + 1];
  const c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return (a * (1 - u) + bb * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Footprint area to height, metres.
 *
 * LOGARITHMIC AND CAPPED, ON PURPOSE. A linear or sqrt relation makes the
 * largest footprint the tallest building, and in Dubai the largest footprints
 * are malls, terminals and warehouses — wide and LOW. The 177,062 m2 outlier in
 * this window would come out near 100 m under sqrt. Saturating the curve keeps
 * big-and-flat looking big and flat.
 */
export function estimateHeight(areaM2: number, seed: number): number {
  const base = 3.0 + 9.0 * Math.log10(1 + areaM2 / 100);
  const jitter = 0.85 + 0.30 * ((Math.sin(seed * 127.1) * 43758.5453) % 1 + 1) / 2;
  return Math.max(3, Math.min(40, base * jitter));
}

export function ringArea(p: Float32Array): number {
  let a = 0;
  for (let i = 0; i + 3 < p.length; i += 2) a += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
  return Math.abs(a) / 2;
}
