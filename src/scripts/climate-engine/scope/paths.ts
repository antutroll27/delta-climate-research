/**
 * Every `/heat-map/data/…` URL the twin fetches, built in ONE place.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. Sixteen call sites — heat-map-app.ts ×10,
 * ward-loader.ts ×3, surface-raster.ts ×2, provenance.ts ×1, counted with
 * `grep -rn 'heat-map/data/\${' src/scripts/climate-engine/` — interpolate a bare
 * ward id straight into a URL:
 *
 *     fetch(`/heat-map/data/${name}-trees.json`)
 *
 * That is correct exactly while an area id is ONE slug. The scope migration makes
 * the id `in/kolkata/ballygunge`, and all sixteen then ask the server for
 * `/heat-map/data/in/kolkata/ballygunge-trees.json`.
 *
 * That would be survivable if it were loud. It is not. FOURTEEN OF THE SIXTEEN
 * SWALLOW THE FAILURE — six behind `optional(...)`, five behind
 * `.catch(() => ({ ways: [] }))` or `.catch(() => null)`, two behind a `try` that
 * returns null, one behind a bare `catch` — because a ward may legitimately have
 * no water layer and no trees. Only the ward's own `.json` (heat-map-app.ts:941,
 * ward-loader.ts:32) would throw. So the map renders a city with no trees, no
 * roads and no provenance, which at a glance is indistinguishable from a city that
 * HAS been rendered, and the only evidence is 404s in a console nobody has open.
 * Silent degradation is the failure mode this codebase keeps paying for, and
 * fixing it by search-and-replace leaves the seventeenth call site free to
 * reintroduce it. Hence a choke point: once Task 4 lands, this module is the only
 * place allowed to write the string `/heat-map/data/`.
 *
 * THE URL SHAPE IS DELIBERATELY NOT THE KEY SHAPE. The key is hierarchical and
 * the files stay flat — `in/kolkata/ballygunge` reads `/heat-map/data/ballygunge.json`.
 * NOTHING ON DISK MOVES. Rearranging thirty-odd shipped artefacts into
 * country/city directories would also mean rewriting the Python emitters, the
 * STAC asset hrefs in `scripts/standards/stac.ts`, the CityJSON and ward-record
 * readers, and the freshness check that names them — real risk, and not one pixel
 * of it visible to a reader. This module is the seam where the two shapes are
 * allowed to differ, and the only one.
 *
 * NOTHING CONSUMES THIS YET. Task 3 is additive, like Task 2 before it: the
 * builder has to exist and be proven against the actual contents of
 * `public/heat-map/data/` before sixteen live fetches are pointed at it. The
 * build-time readers are a SEPARATE problem and not this module's: two of them
 * (`standards/ward-record.ts`, `standards/cityjson.ts`) resolve filesystem paths
 * under `public/`, not URLs, and `standards/stac.ts` emits hrefs rather than
 * fetching them.
 */

import { DEFAULT_AREA, REGISTRY, splitKey, type AreaKey } from './registry.ts';

/** The tool's URL root. The one literal; the data directory and every area page compose it. */
const ROOT = '/heat-map/';

/** The served directory. */
const DATA = `${ROOT}data/`;

/**
 * The PAGE url for an area — `/heat-map/in/kolkata/ballygunge/`.
 *
 * A DIFFERENT SHAPE FROM THE DATA URLS ABOVE AND BELOW, deliberately, and this is
 * the file that is allowed to know both. The key is hierarchical and the page URL
 * follows it segment for segment, because a URL is the one place the hierarchy is
 * the point — it is what makes a view shareable, bookmarkable and linkable from a
 * deck. The artefacts stay flat (`/heat-map/data/ballygunge.json`) for the reason
 * the header gives: nothing on disk moves.
 *
 * THE TRAILING SLASH IS LOAD-BEARING. `Astro.site` + `Astro.url.pathname` build the
 * canonical link and the sitemap entry with one, because the build format is
 * `directory` and every route is emitted as `…/index.html`. An in-app href written
 * without it is a different string from the canonical it points at, and whether
 * that costs a 301 or a 404 is decided by host configuration rather than by
 * anything in this repo — Vercel and `astro preview` do not agree. So every link
 * this function emits is byte-identical to the canonical of the page it opens.
 *
 * Built from `splitKey`, never by pasting the key into the path. They happen to
 * produce the same string today; they would stop the moment a slug contained a
 * character the key tolerates and a path segment does not, and registry.ts check 8
 * is the guard that keeps that from being reachable at all.
 */
export function areaPath(key: AreaKey): string {
  const { country, city, area } = splitKey(key);
  return `${ROOT}${country}/${city}/${area}/`;
}

/** Where `/heat-map` with nothing after it goes. See `DEFAULT_AREA`. */
export const DEFAULT_AREA_PATH = areaPath(DEFAULT_AREA);

/** The eleven per-area artefacts. Names are the callers' vocabulary, not the files'. */
export interface AreaPaths {
  readonly ward: string;
  readonly terrain: string;
  readonly water: string;
  readonly roads: string;
  readonly labels: string;
  readonly provenance: string;
  readonly trees: string;
  readonly surface: string;
  readonly canopy: string;
  readonly layers: string;
  readonly pv: string;
}

/**
 * The city-level artefacts, `null` where the city declares none.
 *
 * `heatwave-percentiles.json` and `dc-urs-inputs.json` sit beside the ward files
 * under names that imply they are global. They are not. The first carries a
 * `city` key reading "Kolkata"; the second a `wards` key listing exactly
 * ballygunge, baruipur and barrackpore. Serving them to a second city would give
 * it Kolkata's heatwave percentiles — a number that is plausible, wrong, and
 * attached to nothing that would flag it. So the stems are declared per city in
 * the registry's `data` block, and a city that declares none gets `null` here
 * rather than inheriting Kolkata's by default.
 */
export interface CityPaths {
  readonly heatwave: string | null;
  readonly dcUrs: string | null;
}

/** `null` stem in, `null` URL out — a declared absence, never a guessed filename. */
const cityUrl = (stem: string | null): string | null => (stem === null ? null : `${DATA}${stem}.json`);

/* The registry read through a WIDENED view — the same move registry.ts's own
   walkers make with `COUNTRIES`, and needed for the same reason: every fact below
   is a property of the TREE, not of which countries happen to be in it today.
   Without it `Object.entries` cannot infer past the second level, because
   `cityEntry.areas` is a UNION of Kolkata's three-key object and Dubai's, with no
   index signature on either — TS gives up and hands back `unknown`, and
   `areaEntry.shipsData` becomes ts(18046). Measured, not assumed: that is the
   error `astro check` gave this file before the annotations below existed.

   The element types are DERIVED from REGISTRY, never re-declared. registry.ts
   keeps `CityEntry` and `AreaEntry` private, and hand-copying their shape here
   would create a second contract free to drift from the first — an area gains a
   field, this copy does not, and the walk quietly stops seeing it. That is the
   divergence the whole scope design was written against, so the compiler derives
   it instead. `ValuesOf` is a distributive conditional rather than a plain
   `T[keyof T]`: `keyof` over a union yields the INTERSECTION of its members' keys,
   which for `{ kolkata } | { dubai }` is `never`. The `extends unknown` splits the
   union first so each member is indexed by its own keys. */
type ValuesOf<T> = T extends unknown ? T[keyof T] : never;
type CityEntry = ValuesOf<ValuesOf<typeof REGISTRY>['cities']>;
type AreaEntry = ValuesOf<CityEntry['areas']>;

/* One walk of the registry at module load, mirroring `AREA_PARTS` next door: the
   facts are REMEMBERED rather than looked up through a widened index later. Two
   things come out of it.

   SHIPPING holds the area keys with artefacts behind them. CITY_DATA is keyed by
   "country/city" and NOT by area key, because city-level artefacts are a property
   of the city — one entry per area would be three identical copies of Kolkata's
   two stems, free to disagree with each other, which is the duplication the
   registry's own header was written against.

   CITY_DATA takes every city in the tree, including one with no areas. That makes
   it a strict superset of the cities `splitKey` can name, which is what lets the
   lookup in `cityPaths` treat a miss as impossible rather than as an absence. */
const SHIPPING = new Set<string>();
const CITY_DATA = new Map<string, CityPaths>();
for (const [country, entry] of Object.entries(REGISTRY)) {
  const cities: Readonly<Record<string, CityEntry>> = entry.cities;
  for (const [city, cityEntry] of Object.entries(cities)) {
    CITY_DATA.set(`${country}/${city}`, Object.freeze({
      heatwave: cityUrl(cityEntry.data.heatwave),
      dcUrs: cityUrl(cityEntry.data.dcUrs),
    }));
    const areas: Readonly<Record<string, AreaEntry>> = cityEntry.areas;
    for (const [areaId, areaEntry] of Object.entries(areas)) {
      if (areaEntry.shipsData) SHIPPING.add(`${country}/${city}/${areaId}`);
    }
  }
}

/**
 * Every artefact URL for one area, or `null` when the area ships none.
 *
 * THE AREA ID IS THE FILE STEM, and there is deliberately no `stem` field
 * anywhere — a reader will look for one, so: both sides come from
 * `src/data/wards.ts`. The Python pipeline emits each artefact under the ward id,
 * and `assertRegistryLogic` check 7 with `areaTableDrift` pins the registry's
 * data-shipping ids to that same table in BOTH directions, so the two cannot
 * drift apart without a test failing. A `stem` field could only ever be a second
 * copy of a name we already have, free to disagree with the first — which is
 * exactly the divergence the registry exists to stop (five Python scripts carried
 * private ward tables and were already 10–44 m apart; nothing failed).
 */
export function paths(key: AreaKey): AreaPaths | null {
  /* splitKey first, and not only for the stem. It is the one thing separating
     "registered, ships nothing" — `null`, a deliberate answer — from "not an area
     at all", which throws. Collapse the two and a mistyped key returns `null` and
     reads as a disabled city, putting the typo back in the class of faults this
     whole module was written to end. */
  const { area } = splitKey(key);

  /* Dubai is registered so it can be NAMED — the gap between its tier and
     Kolkata's IS the funding ask — but it ships nothing. Returning `null` rather
     than a URL makes it unreachable BY CONSTRUCTION: a caller that cannot obtain a
     URL cannot fire a request that 404s, and cannot half-render a city from three
     files out of ten. That is stronger than every caller remembering to check. */
  if (!SHIPPING.has(key)) return null;

  return {
    ward: `${DATA}${area}.json`,
    terrain: `${DATA}${area}-terrain.json`,
    water: `${DATA}${area}-water.json`,
    roads: `${DATA}${area}-roads.json`,
    labels: `${DATA}${area}-road-labels.geojson`,
    provenance: `${DATA}${area}-provenance.json`,
    trees: `${DATA}${area}-trees.json`,
    surface: `${DATA}${area}-surface.png`,
    canopy: `${DATA}${area}-canopy.png`,
    layers: `${DATA}${area}-layers.json`,
    pv: `${DATA}pv-${area}.json`,
  };
}

/**
 * The city-level artefacts for the city an area belongs to.
 *
 * Total, unlike `paths`: a city always HAS a city-level answer, it is just `null`
 * for both stems when the city declares none. There is no third state to signal,
 * so there is no whole-object `null` to force every caller through a check that
 * would tell them nothing.
 */
export function cityPaths(key: AreaKey): CityPaths {
  const { country, city } = splitKey(key);
  const built = CITY_DATA.get(`${country}/${city}`);
  if (built === undefined) {
    /* Unreachable: the walk above records EVERY city in the registry, and
       `splitKey` only ever returns parts that the registry's own walk recorded, so
       a hit is guaranteed. It throws rather than falling back to
       `{ heatwave: null, dcUrs: null }` because that fallback would be
       indistinguishable from a city that legitimately declares no artefacts — the
       silent-degradation shape again, at the one place it could still get in. */
    throw new Error(`scope/paths: "${key}" names no city in the registry`);
  }
  return built;
}
