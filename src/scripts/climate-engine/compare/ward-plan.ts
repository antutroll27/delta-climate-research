/**
 * ward-plan.ts — Compare's intervention plan, confined to the ward's boundary.
 *
 * WHY (pre-ship audit, 2026-10-03). Ballygunge is KMC Ward 68 inside an 1800 m
 * compute square. Compare already took the RESPONSE over the polygon's cells, but
 * it planted, priced and counted the plan over the whole square: 3.24 km² of
 * corridors and roofs billed under "Ballygunge" beside Baruipur's 1.96 km². The
 * founder's rule is that every ward figure is the ward's, so for an area with a
 * boundary the plan now goes ONLY where the ward is:
 *
 *   · tree corridors — the corridor cells inside the solver mask, in the model's
 *     own priority order; priced by the road length whose cell is inside it;
 *   · cool roofs — the roof area of the in-ward cells (the model whitens roofs
 *     per cell, so the area priced is the area whitened);
 *   · green facades — the facade area of the in-ward buildings (`inWard`, the
 *     footprints that touch the polygon), priced with the model's own formula;
 *   · parks — only sites whose whole cooling disc lies inside the ward.
 *
 * Every layer outside the ward is put back to the base, so nothing the plan
 * does lands on a context cell. Cost, delivered quantities and the response are
 * then all the ward's.
 *
 * ONE THING CANNOT BE CONFINED, and it is said rather than hidden: green facades
 * act through the anthropogenic-heat term, a SCALAR on the whole domain
 * (heat-map-model.ts FACADE_Q). Giving it a spatial form would change the
 * physics, which this pass does not touch. So the facade programme's cut to Q
 * reaches the context cells too, while its cost counts only the ward's facades;
 * the response is still read inside the ward, where the scalar applies the same
 * cut a ward-only programme would.
 *
 * NULL IS THE SQUARE. Without a boundary every function returns its input
 * object untouched — Barrackpore, Baruipur and Bengaluru run exactly as before.
 *
 * Nothing here re-states a model formula it can call instead: the facade area is
 * `buildSpatial`'s own sum over the in-ward buildings.
 */
import { buildSpatial, type RoadsData, type Spatial, type WardData } from '../heat-map-model.ts';
import { requireGrid, type SimLayers } from '../types.ts';
import type { WardMask } from '../ward-mask.ts';

/**
 * Road length, km, whose solver cell is inside the ward. The same walk and the
 * same cell rule as `buildSpatial`'s corridor (sim row 0 at the south edge,
 * `gy = floor((y + half) / sizeM * n)`), each sub-step credited to the cell its
 * midpoint falls in. Over a mask of every cell it is the road length inside the
 * square — a little under `corridorKm`, which also counts each way's stretch beyond
 * the edge (the roads file is clipped 60 m outside it): Ballygunge 91.2 against
 * 100.8 km, and 25.5 km inside Ward 68.
 */
export function roadKmInWard(ward: WardData, roads: RoadsData | null, mask: WardMask): number {
  const n = requireGrid(ward.sizeM).n, half = ward.sizeM / 2, cellM = ward.sizeM / n;
  let km = 0;
  for (const way of roads?.ways ?? []) {
    const p = way.p;
    for (let i = 0; i < p.length - 2; i += 2) {
      const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(L / cellM));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const gx = Math.floor((x0 + (x1 - x0) * t + half) / ward.sizeM * n);
        const gy = Math.floor((y0 + (y1 - y0) * t + half) / ward.sizeM * n);
        if (gx >= 0 && gx < n && gy >= 0 && gy < n && mask.cells[gy * n + gx] === 1) km += L / steps / 1000;
      }
    }
  }
  return km;
}

/** Whether a park disc of `r` cells about (cx, cy) lies wholly on in-ward cells. */
function discInWard(mask: WardMask, cx: number, cy: number, r: number): boolean {
  const n = mask.n, r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (x < 0 || x >= n || y < 0 || y >= n || mask.cells[y * n + x] === 0) return false;
  }
  return true;
}

/**
 * The plan's targets and quantities restricted to the ward. `spatial` is the
 * square's (buildSpatial over the whole domain); with no mask it is returned as is.
 */
export function wardSpatial(
  spatial: Spatial, mask: WardMask | null, ward: WardData, roads: RoadsData | null, base: SimLayers, parkRadiusM: number,
): Spatial {
  if (mask === null) return spatial;
  const n = requireGrid(ward.sizeM).n;
  if (mask.cells.length !== n * n || base.built.length !== n * n) {
    throw new RangeError(`ward plan: a ${mask.n}² boundary over a ${n}² ward`);
  }
  if (mask.inWard.length !== ward.b.length) throw new RangeError(`ward plan: inWard has ${mask.inWard.length} rows, ward has ${ward.b.length}`);
  const corridorSorted = spatial.corridorSorted.filter((i) => mask.cells[i] === 1);
  const r = Math.round(parkRadiusM / spatial.cellM);
  const parkCenters = spatial.parkCenters.filter(([cx, cy]) => discInWard(mask, cx, cy, r));
  let roofM2 = 0;
  for (let j = 0; j < n * n; j++) if (mask.cells[j] === 1) roofM2 += base.built[j] * spatial.cellArea;
  /* The model's facade sum, over the ward's buildings only. buildSpatial is called
     for that one field: roads null (no corridor walk), and its park scoring is
     discarded — a few milliseconds once per ward, against a second copy of the
     facade formula that could drift from the one that prices the square. */
  const facadeM2 = buildSpatial({ ...ward, b: ward.b.filter((_, i) => mask.inWard[i] === 1) }, base, null).facadeM2;
  return {
    corridorSorted, corridorKm: roadKmInWard(ward, roads, mask), parkCenters,
    roofM2, facadeM2, cellArea: spatial.cellArea, cellM: spatial.cellM,
  };
}

/**
 * Put every cell outside the ward back to the base. With the targets already
 * confined only the roof whitening (applied per built cell) could reach a
 * context cell; this makes "the plan lands only in the ward" true by
 * construction, whatever a future slider does. No mask: `planned` unchanged.
 */
export function confineToWard(base: SimLayers, planned: SimLayers, mask: WardMask | null): SimLayers {
  if (mask === null) return planned;
  if (mask.cells.length !== base.albedo.length) throw new RangeError(`ward plan: a ${mask.cells.length}-cell boundary over ${base.albedo.length} cells`);
  const albedo = planned.albedo === base.albedo ? planned.albedo.slice() : planned.albedo;
  const veg = planned.veg === base.veg ? planned.veg.slice() : planned.veg;
  for (let i = 0; i < mask.cells.length; i++) {
    if (mask.cells[i] === 1) continue;
    albedo[i] = base.albedo[i];
    veg[i] = base.veg[i];
  }
  return { ...planned, albedo, veg };
}
