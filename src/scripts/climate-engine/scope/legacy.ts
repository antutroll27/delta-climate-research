/**
 * The bare-ward-id bridge — now PERMANENT, and narrowed to the one thing that
 * still needs it: the Compare deep link.
 *
 * Task 6 created this as a temporary shim for four data loaders. Task 7 deleted
 * those wrappers along with `climate-engine/wards.ts`, and everything inside the
 * engine now speaks `AreaKey`. What cannot be deleted is the URL: `/heat-map/compare`
 * ships, and links of the form `?a=ballygunge&b=baruipur` are already in
 * bookmarks, in the Explore page's own "compare" button, and in whatever people
 * have pasted to each other. A bare id is not an `AreaKey`, and nothing else in
 * the codebase may accept one.
 *
 * WHY THIS IS THE FILE THAT DECIDES THE URL SPELLING. `scenario-url.ts` reads the
 * query string and `heat-map-app.ts` writes it, and until now the writer's comment
 * asserted what the reader would accept. That is two places agreeing by hand, which
 * is the shape of every defect the scope migration exists to end. Both now call
 * these two functions, so the alias is defined ONCE in each direction.
 *
 * THE FAILURE THIS PREVENTS IS SILENT, WHICH IS WHY IT GETS A FILE. The reader it
 * replaces, `isWardId`, FAILED SOFT: an unrecognised id fell through to the default
 * pair. Swapping it for `isAreaKey` would have kept every shared link working in the
 * sense that none of them errored — while showing a DIFFERENT COMPARISON, with no
 * banner, no console line and no changed URL, because the page rewrites the address
 * bar from the state it parsed. A user who bookmarked Ballygunge-vs-Baruipur would
 * have been reading Ballygunge-vs-Baruipur's title over some other pair's numbers.
 *
 * ONE MAP, DECLARED ONCE. A second copy anywhere would be exactly the divergence
 * the registry exists to stop — and this is precisely the kind of table that
 * diverges, because it looks too obvious to check. Written out rather than derived
 * from `AREA_KEYS` on purpose, and that choice now carries more weight than it did
 * in Task 6: the mapping is a historical fact about which city the pre-scope code
 * ASSUMED, not a rule about the registry. Derive it and the day Dubai is added
 * `?a=creek` silently becomes a valid legacy alias — a URL nobody ever shipped,
 * accepted on the strength of a rule nobody wrote.
 */

import { isAreaKey, type AreaKey } from './registry.ts';

/**
 * The three bare ids that were ever addressable. NOT a ward table: no coordinate,
 * no name, no footprint — see the registry header on what a fourth table costs.
 * This is a spelling of three keys, and the keys are the authority.
 */
const LEGACY_WARD_IDS = ['ballygunge', 'baruipur', 'barrackpore'] as const;

export type LegacyWardId = typeof LEGACY_WARD_IDS[number];

/**
 * Bare Kolkata ward id → area key.
 *
 * Exhaustive by type in both directions: `Record<LegacyWardId, AreaKey>` means a
 * fourth legacy id cannot be listed above without failing to compile here, and a
 * key that leaves the registry fails at `AreaKey`.
 */
export const LEGACY_AREA_KEY: Readonly<Record<LegacyWardId, AreaKey>> = Object.freeze({
  ballygunge: 'in/kolkata/ballygunge',
  baruipur: 'in/kolkata/baruipur',
  barrackpore: 'in/kolkata/barrackpore',
});

/* The reverse, INVERTED from the map above rather than written out again. Reading
   one table backwards cannot disagree with reading it forwards; a second literal
   could, and would do it in the direction that matters least visibly — a link that
   emits an alias the reader no longer accepts. */
const TO_LEGACY: ReadonlyMap<string, LegacyWardId> = new Map(
  (Object.entries(LEGACY_AREA_KEY) as [LegacyWardId, AreaKey][])
    .map(([id, key]) => [key as string, id]),
);

/**
 * A URL's `?a=` / `?b=` value → the area it names, or null.
 *
 * ACCEPTS BOTH SPELLINGS, which is the whole job: a bare legacy id (`ballygunge`)
 * because that is what every already-shared link says, and a full key
 * (`in/kolkata/ballygunge`) because that is what the state actually is and what a
 * second city will have to use. The two must resolve to the SAME area — that
 * property, not mere non-erroring, is what a bookmarked link depends on, and
 * `tests/unit/heat-map-compare.test.mjs` asserts it by comparing parsed states
 * rather than by checking each spelling in isolation.
 *
 * Takes `unknown` for the same reason `isAreaKey` does: every real caller is
 * holding `string | null` straight out of `URLSearchParams`, and a signature that
 * demanded a string would push the narrowing to the call site.
 *
 * Returns null for anything else rather than a default. The default belongs to the
 * caller, who knows what it is comparing; returning one from here would rebuild the
 * fail-soft this file exists to remove, one layer down.
 */
export function fromLegacyWard(value: unknown): AreaKey | null {
  if (typeof value !== 'string') return null;
  if (isAreaKey(value)) return value;
  return Object.hasOwn(LEGACY_AREA_KEY, value)
    ? LEGACY_AREA_KEY[value as LegacyWardId]
    : null;
}

/**
 * An area key → what a URL should SAY for it: the legacy bare id where one exists,
 * the key itself where none does.
 *
 * THE DECISION THIS ENCODES: Compare keeps emitting bare ids for Kolkata. Old and
 * new links are then byte-identical, so exactly one URL form is ever in the wild
 * for the three areas that ship — no percent-encoded `in%2Fkolkata%2Fballygunge`
 * appearing in the address bar the first time a bookmarked visitor nudges a slider
 * (the page `history.replaceState`s on every interaction), and no second form for
 * a reader to keep alive for ever.
 *
 * It is a per-key alias rather than a blanket `splitKey(key).area`, and that is the
 * load-bearing part. The bare id is only unambiguous for the three keys that
 * predate the registry. Emitting `?a=creek` for `ae/dubai/creek` would produce a
 * link that `fromLegacyWard` correctly refuses and the page then silently answers
 * with the default pair — the exact fail-soft this file removed from the reader,
 * reintroduced from the writer. An unaliased key emits itself, so a second city is
 * self-describing from its first link and needs no change here.
 */
export function toLegacyWard(key: AreaKey): string {
  return TO_LEGACY.get(key) ?? key;
}
