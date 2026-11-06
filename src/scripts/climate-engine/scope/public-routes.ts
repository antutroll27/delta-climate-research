/**
 * The routes the site PUBLISHES for the scope registry, in one place so the page,
 * the sitemap and the tests read the same list.
 *
 * `PUBLIC_AREA_KEYS` (registry.ts) is the gate. This module turns it into URLs and
 * into the sitemap's verdict, and exists as a module because astro.config.mjs and
 * a unit test both need the verdict and neither can import the other.
 */
import { PUBLIC_AREA_KEYS, isPublicArea } from './registry.ts';
import { areaPath } from './paths.ts';
import { resolve } from './resolve.ts';

/** `/heat-map/{country}/{city}/{area}/` for every public area. */
export function publicAreaPaths(): readonly string[] {
  return PUBLIC_AREA_KEYS.map(areaPath);
}

/**
 * The sitemap's verdict on an area page path, or null when the path is not an area
 * page at all (the caller then applies its other rules).
 *
 * Two conditions, both required: the area is PUBLIC (it has a page), and it
 * PUBLISHES to the catalogue (it is worth indexing). The first is the Dubai
 * exclusion; the second is the existing Bengaluru one.
 */
export function areaPageIndexable(pathname: string): boolean | null {
  const m = /^\/heat-map\/([^/]+\/[^/]+\/[^/]+)\/$/.exec(pathname);
  if (m === null) return null;
  const key = m[1];
  return isPublicArea(key) && resolve(key).area.publishes;
}
