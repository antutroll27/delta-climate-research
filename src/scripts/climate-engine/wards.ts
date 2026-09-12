/**
 * Ward identity and presentation for Compare. NOT physical inputs.
 *
 * `vegetationBaseline` used to live here — 0.12 / 0.62 / 0.28, hand-set archetype
 * values carried over from the original prototype, with no citation and no
 * Sourced<T> wrapper while every other input in the system had both. They
 * disagreed with the measured Sentinel-2 fvc by +0.21 / −0.17 / +0.03, in
 * opposite directions, so the page scored Ballygunge on fvc 0.33 while heating it
 * on veg 0.12. Vegetation now comes from surface-raster.ts, measured, with the
 * ward mean pinned to the value DC-URS scores on.
 *
 * THE WARD LIST USED TO BE WRITTEN OUT HERE, TWICE — once as a union type and
 * once as a record literal of three Kolkata wards. Both are gone; this module
 * now derives from `src/data/wards.ts`, which derives from the registry.
 */
import { WARDS as PUBLISHED_WARDS } from '../../data/wards.ts';

/**
 * Any ward id. Deliberately open.
 *
 * WAS `'ballygunge' | 'baruipur' | 'barrackpore'`, which wrote "there are
 * exactly three wards and they are Kolkata's" into the type system — so a
 * second city was not a data change but a TYPE change, rippling through every
 * `Record<WardId, …>` and every switch that narrowed on those three literals.
 *
 * WHY `string` AND NOT A UNION DERIVED FROM THE REGISTRY. A union built from
 * the registry (`typeof CITIES[…]['wards'][number]['id']`, or a const-asserted
 * id list) would be the same closed set with a longer spelling: it would still
 * refuse an id the registry gains at runtime, still force a type change per
 * city, and — because ward ids arrive from URLs, worker messages and `<select>`
 * values, i.e. from `string` — it would only relocate the validation to a cast.
 * The set of valid ids is a RUNTIME fact about what is published, so it is
 * checked at runtime by `isWardId`, which is the one place that knows.
 */
export type WardId = string;

/**
 * What Compare prints for a ward. Deliberately only the two fields it prints.
 *
 * `zone`, `coord`, `lat` and `lon` used to sit here too and were read by
 * NOTHING — a second, silently diverging copy of registry strings ('Urban Core,
 * Ward 68' here against the registry's 'Urban Core · Ward 68', which is what the
 * heat-map page actually renders). A dead duplicate is worse than no field: the
 * next reader reaches for the nearest one. Coordinates live on the ward record
 * in src/data/wards.ts.
 */
export interface WardMeta {
  id: WardId;
  name: string;
  descriptor: string;
}

/**
 * Compare's one-line characterisation of a ward, which has no registry home.
 *
 * These are editorial copy, not data — the registry carries `zone`, the
 * administrative label. A ward with no entry falls back to its zone rather than
 * printing an empty line, so a newly published ward renders before anyone has
 * written its sentence.
 */
const DESCRIPTORS: Readonly<Record<WardId, string>> = {
  ballygunge: 'dense urban core',
  baruipur: 'peri-urban fringe',
  barrackpore: 'industrial river corridor',
};

/**
 * Keyed by id, over the wards that are PUBLISHED — not over every ward the
 * registry declares.
 *
 * Compare's ward `<select>`, its URL parameters and its worker keys all resolve
 * through this object, and every one of them ends at `loadWard`, which fetches
 * /heat-map/data/{id}.json. Offering a ward whose artefacts are not on disk
 * would put a 404 behind a menu item. `src/data/wards.ts` owns that gate (and
 * the comment naming the task that lifts it); this module must not widen it.
 *
 * That it is derived is also what keeps indexing total: `WARD_IDS` and
 * `isWardId` are both built from these keys, so any id that reaches
 * `WARDS[id]` through either of them has an entry. That invariant is what the
 * union type used to provide, and it now comes from a single source rather
 * than from three literals repeated in two files.
 */
export const WARDS: Readonly<Record<WardId, WardMeta>> = Object.fromEntries(
  PUBLISHED_WARDS.map((ward): [WardId, WardMeta] => [ward.id, {
    id: ward.id,
    // The registry's name carries `<em>` around the syllable the wordmark
    // emphasises. Compare writes these through `textContent`, which would print
    // the tags literally, so the markup is stripped here rather than at four
    // call sites that would each have to remember.
    name: ward.name.replace(/<[^>]*>/g, ''),
    descriptor: DESCRIPTORS[ward.id] ?? ward.zone.toLowerCase(),
  }]),
);

export const WARD_IDS: readonly WardId[] = Object.freeze(Object.keys(WARDS));

/**
 * Is this a ward we can actually render?
 *
 * The question this answers CHANGED with the union's deletion: it used to mean
 * "one of three literals", and now means "published, with artefacts on disk".
 * Today those are the same three ids. They stop being the same the day a second
 * city publishes, which is the point — this is the gate that then admits it, and
 * the only place that decision is made.
 */
export function isWardId(value: string | null | undefined): value is WardId {
  return typeof value === 'string' && value in WARDS;
}

/**
 * A ward to pair against `ward`, for the rule that Compare's two sides must
 * differ.
 *
 * It refuses rather than inventing one. The previous fallback was the literal
 * `'baruipur'` — which, once the ward list became data, could name a ward that
 * is not published at all, handing `loadWard` an id that 404s. There is no
 * honest answer when fewer than two wards are published: Compare cannot run.
 */
export function nextDistinctWard(ward: WardId): WardId {
  const other = WARD_IDS.find((candidate) => candidate !== ward);
  if (!other) {
    throw new RangeError(
      'Compare needs two published wards to pair; fewer than two are published. '
      + 'See PUBLISHED_CITIES in src/data/wards.ts.',
    );
  }
  return other;
}
