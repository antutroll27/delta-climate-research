/**
 * The bare-ward-id bridge. DELETE IN TASK 7, WITH ITS TWO CALLERS.
 *
 * Task 6 tightened the four data loaders to take an `AreaKey`, which is what makes
 * the migration compiler-enforced rather than a search-and-replace: a caller that
 * still holds a bare slug now fails to compile instead of quietly fetching
 * `/heat-map/data/in/kolkata/ballygunge-trees.json` and swallowing the 404.
 *
 * `compare/` and `scenario/` are Task 7's, and they still speak `WardId` — a
 * three-slug union from `climate-engine/wards.ts` that Task 7 also deletes. Rather
 * than reach into those modules early, the two entry points they use keep their old
 * names and their old parameter type as thin wrappers over the new ones, and every
 * wrapper turns its id into a key HERE.
 *
 * ONE MAP, DECLARED ONCE. A second copy inside `ward-loader.ts` and a third inside
 * `surface-raster.ts` would be exactly the divergence the registry exists to stop —
 * and this table is precisely the kind that diverges, because it looks too obvious
 * to check. Written out rather than derived from `AREA_KEYS` on purpose: the
 * mapping is a historical fact about which city the pre-scope code ASSUMED, not a
 * rule about the registry, and deriving it would make it silently follow a registry
 * edit that has nothing to do with the legacy callers.
 *
 * It is exhaustive by type. `Record<WardId, AreaKey>` means a fourth ward id cannot
 * be added to `climate-engine/wards.ts` without this failing to compile, and the
 * lookup is total — no `undefined` branch for a caller to mishandle.
 */

import type { AreaKey } from './registry.ts';
import type { WardId } from '../wards.ts';

/* Deliberately NOT tagged `@deprecated`. The tag is a signpost for Task 7, and it
   should fire on the two legacy ENTRY POINTS — `loadWard`, `loadWardSurface` — where
   a caller can still act on it. Tagging the table too only lights up the wrappers
   that exist to use it, which is four hints saying "this deprecated thing uses the
   deprecated thing it is made of". A tripwire that fires on its own implementation
   is the kind that gets suppressed, and then stops being read at all. */
/** Bare Kolkata ward id → area key. Deleted in Task 7, with both wrappers. */
export const LEGACY_AREA_KEY: Readonly<Record<WardId, AreaKey>> = Object.freeze({
  ballygunge: 'in/kolkata/ballygunge',
  baruipur: 'in/kolkata/baruipur',
  barrackpore: 'in/kolkata/barrackpore',
});
