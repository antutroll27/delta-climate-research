/**
 * Area key → everything that key means. The one place identity becomes numbers.
 *
 * WHAT THIS EXISTS FOR. Four constants used to live inside
 * `../heat-map-model.ts`, the pure physics module, and not one of them was a fact
 * about heat transfer:
 *
 *   PATH_DELTA     all-India warming deltas — a COUNTRY's adopted projection
 *   COST           four figures denominated in RUPEES — a COUNTRY's currency
 *   PARK_R_M       50 m, measured as Kolkata's tree-void-effect scale — a CITY's
 *   FALLBACK_TAIR  32 °C, a Kolkata climatology — a CITY's
 *
 * Held there, a second city could not be added without being wrong. Dubai's
 * fallback air temperature is nearer 40 °C, no Gulf warming pathway has been
 * adopted here at all, and a DEWA audience quoted rupees would be reading Kolkata's
 * economics with Dubai's name on them. None of those four failures throws. Each one
 * computes cleanly and prints a plausible number, which is the failure mode this
 * codebase keeps paying for.
 *
 * THE DIRECTION OF THE DEPENDENCY IS THE WHOLE DESIGN. This module PRODUCES a
 * `ClimateConstants`; the physics CONSUMES one and never learns whose it was.
 * `heat-map-model.ts`, `dc-urs.ts` and `sim-ts.ts` contain zero references to
 * `scope/` — not even a type import — and `tests/unit/obos-scope.test.mjs` reads the
 * model's own source to keep it that way. The shared vocabulary (`ClimateConstants`,
 * `Costs`) is declared one level down in `../types.ts`, which both halves already
 * import, precisely so neither has to import the other.
 *
 * NOTHING RE-STATES THE REGISTRY HERE. Country names come from `REGISTRY`, area
 * names from `src/data/wards.ts`, the key parts from `splitKey`. The only datum
 * this file owns is the pathway TABLE below, because a table of warming deltas is
 * not geography and has nowhere else to be.
 */
import { REGISTRY, splitKey, AREA_KEYS, type AreaKey } from './registry.ts';
import { wardById } from '../../../data/wards.ts';
import type { ClimateConstants, Costs } from '../types.ts';

/* Re-exported so a consumer needs ONE import to take a scope apart. They are
   DECLARED in ../types.ts — see the header — and re-exported, never re-declared;
   a second declaration would be a second contract free to drift from the first. */
export type { ClimateConstants, Costs };

/**
 * Warming-pathway deltas by pathway NAME.
 *
 * The registry stores the name (`REGISTRY.in.pathway === 'dhara2025'`) and this is
 * the only place it becomes numbers. The registry's own comment spells out why the
 * two must not be confused: a pathway name indexed straight into a delta table
 * type-checks clean as a `number`, evaluates to `undefined`, and propagates NaN
 * warming with nothing raised anywhere.
 *
 * A country with `pathway: null` gets an EMPTY table, not a zeroed one — see
 * `ClimateConstants.pathDelta`. A country naming a pathway that is not here is an
 * authoring error and throws: silently handing back the empty table would kill the
 * warming control for that country while looking exactly like a country that had
 * declared none.
 */
const PATHWAYS: Record<string, Record<string, number>> = {
  /**
   * All-India warming deltas, °C. All positive: no emissions scenario produces
   * regional cooling over India — the previous −1.2 °C "target" pathway was a
   * mitigation aspiration drawn on a physical-temperature axis and is deleted.
   * Source: Dhara et al. 2025, PLOS Climate 4(11):e0000724 (post-AR6 India update).
   *
   *   '2025'  observed baseline
   *   ssp245  SSP2-4.5, 2041–2060 all-India mean (+1.2 to +1.3)
   *   ssp585  SSP5-8.5, 2065–2094 max temperature vs 1985–2014
   */
  dhara2025: { '2025': 0, ssp245: 1.25, ssp585: 4.1 },
};

/** The empty table, shared and frozen — one object for every pathway-less country. */
const NO_PATHWAY: Readonly<Record<string, number>> = Object.freeze({});

/**
 * The confidence tier, which is the honesty label the page shows.
 *
 * Spelled out rather than derived from the tiers that HAPPEN to be in the registry
 * today: a consumer switching on this must handle every tier the vocabulary
 * defines, not only the two currently in use. The registry's `satisfies` clause
 * already refuses a tier outside its own union, and the assignment in `build()`
 * below fails to compile if that union ever grows past this one — so the two
 * cannot drift apart in silence.
 */
export type CityTier = 'validated' | 'zone' | 'geometry';

/** Everything an area key means, resolved once. */
export interface ResolvedScope {
  readonly key: AreaKey;
  readonly country: { readonly id: string; readonly name: string };
  readonly city: { readonly id: string; readonly name: string; readonly koppen: string };
  readonly area: {
    readonly id: string;
    readonly name: string;
    /** what KIND of unit this is — a ward, or a tile of our own drawing */
    readonly descriptor: string;
    /** whether artefacts ship for it; `scope/paths.ts` is the authority on which */
    readonly hasData: boolean;
  };
  readonly tier: CityTier;
  readonly climate: ClimateConstants;
}

/* The registry read through a WIDENED view, and the element types DERIVED from it
   rather than re-declared — the same move `scope/paths.ts` makes, for the reason
   its comment gives: `registry.ts` keeps `CityEntry` and `AreaEntry` private, and a
   hand-written copy of their shape here would be a second contract free to drift.
   `ValuesOf` is a distributive conditional because `keyof` over a union yields the
   INTERSECTION of its members' keys, which for `{ kolkata } | { dubai }` is `never`. */
type ValuesOf<T> = T extends unknown ? T[keyof T] : never;
type CityEntry = ValuesOf<ValuesOf<typeof REGISTRY>['cities']>;
type AreaEntry = ValuesOf<CityEntry['areas']>;

const COUNTRIES: Readonly<Record<string, ValuesOf<typeof REGISTRY>>> = REGISTRY;

/** `Bally<em>gunge</em>` → `Ballygunge`. The `<em>` marks the wordmark's stress. */
const stripMarkup = (name: string): string => name.replace(/<[^>]*>/g, '');

/**
 * `al-quoz` → `Al Quoz`. Used for the CITY name only, which the registry does not
 * carry — deriving it from the slug is one rule, where a `name` field would be a
 * second copy of a string we already have.
 */
const titleCase = (slug: string): string => slug
  .split('-')
  .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
  .join(' ');

/**
 * The area's display name and descriptor, from whichever side of the boundary
 * owns them.
 *
 * TWO SOURCES ON PURPOSE, and the registry's header says why. Kolkata's areas are
 * rows in `src/data/wards.ts` — THE area table — so the registry stores nothing but
 * a flag for them and their names are read from there. Dubai's are not in that
 * table (no validated geometry ships for them), so inventing ward-table rows would
 * be the same divergence pointed the other way; they carry their own name here.
 *
 * The `in` narrowing is how the derived union is read without re-declaring it.
 */
function label(areaId: string, entry: AreaEntry): { name: string; descriptor: string } {
  const ward = wardById(areaId);
  if (ward !== undefined) {
    /* An area in the ward table that ALSO named itself here would be exactly the
       two-copies-of-one-name defect the registry exists to prevent — five Python
       scripts once carried private ward tables and were already 10–44 m apart, and
       nothing failed. Refuse it rather than silently preferring one. */
    if ('name' in entry) {
      throw new Error(
        `scope/resolve: area "${areaId}" is in src/data/wards.ts AND names itself in the `
        + 'registry — one name, one place. Delete the registry copy');
    }
    return { name: stripMarkup(ward.name), descriptor: ward.zone };
  }
  if (!('name' in entry) || !('descriptor' in entry)) {
    /* Unreachable in a well-formed registry, and reached at MODULE LOAD if it ever
       is — see the eager walk below. An area with no row in the ward table and no
       name of its own cannot be displayed at all, and a placeholder would put an
       id where a reader expects a place. */
    throw new Error(
      `scope/resolve: area "${areaId}" is not in src/data/wards.ts, so it must carry its `
      + 'own name and descriptor in the registry');
  }
  return { name: entry.name, descriptor: entry.descriptor };
}

/** The country's warming table: declared and known, declared and unknown, or absent. */
function pathDeltaFor(countryId: string, pathway: string | null): Readonly<Record<string, number>> {
  if (pathway === null) return NO_PATHWAY;
  const table = PATHWAYS[pathway];
  if (table === undefined) {
    throw new Error(
      `scope/resolve: country "${countryId}" names warming pathway "${pathway}", which is not `
      + `in PATHWAYS (${Object.keys(PATHWAYS).join(' | ')}) — a named pathway that resolves to `
      + 'nothing would silently disable the warming control');
  }
  return Object.freeze({ ...table });
}

function build(key: AreaKey): ResolvedScope {
  const { country: countryId, city: cityId, area: areaId } = splitKey(key);
  const countryEntry = COUNTRIES[countryId];
  const cities: Readonly<Record<string, CityEntry>> = countryEntry.cities;
  const cityEntry = cities[cityId];
  const areas: Readonly<Record<string, AreaEntry>> = cityEntry.areas;
  const areaEntry = areas[areaId];
  const { name, descriptor } = label(areaId, areaEntry);

  return Object.freeze({
    key,
    country: Object.freeze({ id: countryId, name: countryEntry.name }),
    city: Object.freeze({ id: cityId, name: titleCase(cityId), koppen: cityEntry.koppen }),
    area: Object.freeze({ id: areaId, name, descriptor, hasData: areaEntry.shipsData }),
    /* Assigning the registry's literal tier into `CityTier` is the drift guard:
       widen the registry's own tier union past this one and it stops compiling. */
    tier: cityEntry.tier,
    climate: Object.freeze({
      pathDelta: pathDeltaFor(countryId, countryEntry.pathway),
      fallbackTairC: cityEntry.fallbackTairC,
      parkRadiusM: cityEntry.parkRadiusM,
      /* Kept as declared, INCLUDING the null. Substituting a zero-valued Costs for
         a country that has adopted none would put a budget of nothing on screen —
         see ClimateConstants.costs and `requireCosts` below. */
      costs: countryEntry.costs,
    }),
  });
}

/* EAGER, at module load, the same shape `registry.ts` and `scope/paths.ts` use.
   Every area is resolved once here, so an authoring error — a pathway name with no
   table, an area with no name anywhere — fails on import rather than on the first
   render that happens to touch that area. The alternative, resolving lazily, moves
   the failure to whichever city a demo opens, which is the worst possible moment.

   It also makes every scope a SHARED FROZEN OBJECT: two calls for one key return
   the same `climate`, so nothing downstream can mutate one caller's pathway table
   out from under another's. */
const SCOPES = new Map<string, ResolvedScope>(AREA_KEYS.map((k) => [k, build(k)]));

/**
 * Everything one area key means.
 *
 * Total on `AreaKey`. The throw is unreachable through the type and exists for the
 * one call site the type cannot police — a value cast in from a URL without
 * `isAreaKey` first. It throws rather than returning null because a caller handed
 * `null` here has no way to render anything true.
 */
export function resolve(key: AreaKey): ResolvedScope {
  const scope = SCOPES.get(key);
  if (scope === undefined) {
    throw new Error(`scope/resolve: "${key}" is not a registered area key`);
  }
  return scope;
}

/**
 * The costs, or a refusal — never a zero.
 *
 * `computeCost` takes a non-null `Costs` because there is no such thing as a cost
 * in no currency, so the absence has to be dealt with SOMEWHERE. This is that
 * place: one seam, one explanation, at the point where identity enters, rather than
 * a `?? 0` in the physics that would quote every pathway-less country a budget of
 * nothing and print it as a finding.
 *
 * Today it is unreachable — the only wired scope is Kolkata, and India declares its
 * four figures. It becomes reachable the moment a second country is selectable, and
 * at that point the right answer is a readout saying "no cost basis for the UAE",
 * not a number. The type is what forces that work to be done rather than defaulted.
 */
export function requireCosts(scope: ResolvedScope): Costs {
  const costs = scope.climate.costs;
  if (costs === null) {
    throw new Error(
      `scope/resolve: ${scope.country.name} declares no intervention costs, so `
      + `"${scope.key}" has no capital-cost answer. Report it as unavailable — a zero `
      + 'would read as a budget of nothing');
  }
  return costs;
}
