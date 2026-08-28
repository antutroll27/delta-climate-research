/**
 * The layer registry: what the tree can draw, and what each layer DEPENDS ON.
 *
 * THE ONE RULE. A layer declares what it NEEDS. Whether it is available HERE is
 * DERIVED, by asking `scope/paths.ts` whether that artefact resolves for this area.
 * No entry below names a city, and `tests/unit/obos-layers.test.mjs` reads this
 * file's own source to keep it that way.
 *
 * That prohibition is not fastidiousness. A per-layer `cities: [...]` list would be
 * a second copy of a fact `paths()` already answers, and a second copy is free to
 * disagree with the first — which is the defect the whole scope model was written
 * against. Five Python scripts carried private ward tables and had ALREADY DIVERGED
 * by 10–44 m before anyone looked; nothing failed, the numbers were just quietly
 * about slightly different ground. Task 7 of the scope migration deleted a third
 * ward table rather than adapting it for the same reason. A city list here would be
 * that same defect one dimension over: stop shipping a canopy raster and the layer
 * needing it disables itself, with nobody having to remember this file exists.
 *
 * TWO KINDS OF DEPENDENCY, and the second is not symmetry for its own sake.
 *
 *   an ARTEFACT   — a key of `AreaPaths` or `CityPaths`, resolved by `paths()` and
 *                   `cityPaths()`. Five of the six layers.
 *   a CAPABILITY  — `{ cap: 'mapillary' }`. Street-level imagery has NO local
 *                   artefact: it fetches tiles from `tiles.mapillary.com` against an
 *                   access token, and the entire feature tree-shakes out when
 *                   `PUBLIC_MAPILLARY_TOKEN` is unset (heat-map-app.ts:259, and the
 *                   six sites that read `MLY_TOKEN` after it). Its availability is a
 *                   BUILD-TIME fact, not a file.
 *
 * Collapsing the capability onto the artefact axis would mean inventing a filename
 * that does not exist, purely so the model could have one axis instead of two — and
 * then `paths()` would have to answer for a URL nothing ever fetches. Two kinds is
 * the honest count.
 *
 * ONLY THE SIX LAYERS THAT ALREADY RENDER ARE DECLARED. Plan B adds seven more and
 * three new `paths()` keys, and it is tempting to write them now. It would be
 * wrong: a registered layer nobody draws ships a permanently greyed row that looks
 * DELIBERATE — indistinguishable, to a visitor, from a row greyed because this city
 * lacks the data. The tree's whole job is to tell those two apart.
 *
 * NOTHING CONSUMES THIS YET, by design — the same additive shape Tasks 2 and 3 of
 * the scope migration used. The registry has to exist and be proven correct before
 * a tree is pointed at it.
 */

import { cityPaths, paths, type AreaPaths, type CityPaths } from './paths.ts';
import type { AreaKey } from './registry.ts';

/**
 * A dependency that is not a file.
 *
 * One member today, and a union rather than a bare string so that adding the second
 * is a compile-time event: `Capabilities` below is DERIVED from this, so a new
 * capability id makes every construction of a `Capabilities` object fail until it
 * answers for the new one. A `Record<string, boolean>` would have let a layer
 * declare `{ cap: 'mapilary' }`, read `undefined`, and disable itself for ever
 * under a reason naming a capability nobody had ever defined.
 */
type CapabilityId = 'mapillary';

/**
 * What the host knows about build-time capabilities, at the moment it asks.
 *
 * A parameter rather than a module-level read of `import.meta.env`, because this
 * module is imported by tests under plain Node where that object does not exist —
 * and because a capability the caller cannot vary is a capability that cannot be
 * tested in both states. The test exercises exactly that: one call with the token,
 * one without.
 */
export type Capabilities = { readonly [K in CapabilityId]: boolean };

/**
 * The names `paths()` answers to — both scopes, in one union.
 *
 * DERIVED FROM THE INTERFACES THEMSELVES, never listed out. A hand-written list
 * would be a third copy of the artefact names (after `AreaPaths` and the URL
 * builder), and the compiler would go on accepting a name `paths()` had stopped
 * emitting. As written, deleting a field from `AreaPaths` turns every layer needing
 * it into a compile error in this file, naming the layer.
 */
type ArtefactKey = keyof AreaPaths | keyof CityPaths;

/** Either kind of dependency. The object form is how a capability is spelled. */
type Needs = ArtefactKey | { readonly cap: CapabilityId };

interface LayerItem {
  /** what the row says. Non-empty — see check 5. */
  readonly label: string;
  /** an artefact name, or a capability. NEVER a city. */
  readonly needs: Needs;
  /** whether the tree starts with this one drawn */
  readonly defaultOn: boolean;
}

interface LayerGroup {
  /** the section heading above the rows */
  readonly label: string;
  readonly items: Readonly<Record<string, LayerItem>>;
}

/**
 * The six layers the instrument already draws, in four groups.
 *
 * `as const satisfies` in that order, the same clause `REGISTRY` closes with and
 * for the same measured reason: `satisfies` only CHECKS, so the literal types
 * survive `as const` and `LayerId` below still derives six exact ids instead of
 * widening to `string`. Drop the `satisfies` and an item missing `defaultOn`
 * compiles clean here and fails, tasks away, inside whatever first reads it.
 *
 * `footprints` and `heights` both need `ward` and that is not a mistake: one
 * `{area}.json` carries both, each building row being `[height, x0, y0, x1, y1, …]`
 * (relief-renderer.ts:240–246). Two rows, one artefact — the tree draws them as
 * separate toggles because a visitor turns off extrusion far more often than
 * outlines, not because two files back them.
 */
export const LAYERS = {
  thermal: {
    label: 'Thermal field',
    items: {
      surface: { label: 'Surface temperature', needs: 'surface', defaultOn: true },
    },
  },
  green: {
    label: 'Green infrastructure',
    items: {
      canopy: { label: 'Tree canopy (CHM)', needs: 'canopy', defaultOn: true },
      trees: { label: 'Tree instances', needs: 'trees', defaultOn: true },
    },
  },
  built: {
    label: 'Built form',
    items: {
      footprints: { label: 'Building footprints', needs: 'ward', defaultOn: true },
      /* TRUE, AND IT WAS FALSE UNTIL THE TREE WAS WIRED TO THE MAP.
         `defaultOn` is not a preference — it is a CLAIM ABOUT THE MAP'S FIRST
         PAINT, and the tree renders it as a ticked or unticked box before anything
         has been clicked. The instrument opens in 3D relief with every building
         extruded to its measured height, so `false` here would have shipped an
         unticked box beside a layer that is plainly on the screen: the same lie as
         a ticked box over a layer that is not drawn, which is the case this file's
         `checked: defaultOn && available` rule already refuses.
         The rationale beside it — that a visitor turns extrusion off far more
         often than outlines — is an argument for the row EXISTING, and reads as
         one for extrusion starting on. */
      heights: { label: 'Building heights', needs: 'ward', defaultOn: true },
    },
  },
  ground: {
    label: 'Ground truth',
    items: {
      street: { label: 'Street-level imagery', needs: { cap: 'mapillary' }, defaultOn: false },
    },
  },
} as const satisfies Record<string, LayerGroup>;

type Layers = typeof LAYERS;

/**
 * Every layer, as a literal union of `group/item`.
 *
 * DERIVED, never written out — the same mapped-type shape `AreaKey` uses in
 * `registry.ts`, and derived for the identical reason. A hand-maintained union is a
 * second copy of the table above, and it drifts the moment someone adds an item and
 * forgets it: the compiler then keeps accepting the id that no longer exists and
 * rejecting the one that does, which surfaces as a type error somewhere else
 * entirely. Verified in both directions before this shipped — `thermal/surface`
 * assigns and `thermal/typo` does not — because a key type that compiles while
 * accepting any string is worse than none, it makes every later `LayerId`
 * annotation a decoration.
 *
 * `AreaKey` needs an `extends { areas: infer A }` at its inner level to get past
 * TS2536; this one does not, and the difference is real rather than an oversight.
 * That union is three deep, so while the mapped type is still distributing over the
 * CITY key TypeScript cannot prove `['areas']` indexes it. Here `Layers[G]['items']`
 * is indexed by the OUTER mapped key, which is the position `Registry[C]['cities']`
 * occupies over there — and that one compiles unaided too.
 */
export type LayerId = {
  [G in keyof Layers]: {
    [N in keyof Layers[G]['items']]: `${G & string}/${N & string}`
  }[keyof Layers[G]['items']]
}[keyof Layers];

/* The registry read through a WIDENED view, never its literal type — the move
   `registry.ts` makes with `COUNTRIES` and `scope/paths.ts` repeats. Every
   invariant below is a property of the TREE, not of which groups happen to be in it
   today, and a walk written against the literal type would need editing each time a
   layer is added. */
const GROUPS: Readonly<Record<string, LayerGroup>> = LAYERS;

interface LayerParts {
  readonly group: string;
  readonly item: string;
}

interface LayerRecord {
  readonly parts: LayerParts;
  readonly entry: LayerItem;
}

/* The flatten, and the ONLY place an id is ever taken apart.

   THE PARTS ARE REMEMBERED HERE, not recovered later by splitting on "/". That is a
   correction carried over from `splitKey` next door, which originally split and
   mis-resolved any slug containing a separator: `a/b/c` read back as group "a" and
   item "b/c" under one spelling and "a/b" and "c" under another, and whichever one
   was wrong returned a layer that exists nowhere. The next property access then
   threw a TypeError naming neither the slug nor the layer. Check 3 refuses such a
   slug outright, but a lookup cannot be wrong even while the registry is broken,
   which matters precisely when the guards are the thing being run.

   The map keeps the FIRST binding on a collision, so the loser of a duplicate is
   unreachable rather than silently swapped — check 2 is what stops that shipping. */
const ids: LayerId[] = [];
const LAYER_BY_ID = new Map<string, LayerRecord>();
for (const [group, groupEntry] of Object.entries(GROUPS)) {
  for (const [item, itemEntry] of Object.entries(groupEntry.items)) {
    const id = `${group}/${item}` as LayerId;
    ids.push(id);
    if (!LAYER_BY_ID.has(id)) {
      LAYER_BY_ID.set(id, Object.freeze({
        parts: Object.freeze({ group, item }), entry: itemEntry,
      }));
    }
  }
}

/** Every layer id, in declaration order — which is tree order. The runtime twin of `LayerId`. */
export const LAYER_IDS: readonly LayerId[] = ids;

/**
 * Membership, not shape.
 *
 * `unknown` in, because the callers that matter are the untrusted ones: a restored
 * session's visibility set, a query parameter, a value read back from
 * localStorage after the registry has moved on. A signature demanding a string
 * would push the cast out to every one of those sites, where it gets written once
 * carelessly. An id that merely LOOKS well-formed is rejected — `thermal/typo` has
 * the right shape and no layer behind it.
 */
export function isLayerId(value: unknown): value is LayerId {
  return typeof value === 'string' && LAYER_BY_ID.has(value);
}

/**
 * The two slugs an id was built from — looked up, never re-parsed. See the flatten.
 *
 * Total on `LayerId`. The throw is unreachable through the type and exists for the
 * one call site the type cannot police: a value cast in from storage or a URL
 * without `isLayerId` first.
 */
export function splitLayerId(id: LayerId): LayerParts {
  const record = LAYER_BY_ID.get(id);
  if (record === undefined) {
    throw new Error(`scope/layers: "${id}" is not a registered layer id`);
  }
  return record.parts;
}

/**
 * Whether a layer can be drawn here, and if not, WHY NOT.
 *
 * A DISCRIMINATED UNION, so "unavailable" cannot be constructed without a reason.
 * That is the whole point of the shape: the tree must render a blocked layer
 * DISABLED AND EXPLAINED. Hiding it reads as "this does not exist"; showing it live
 * gives a control that does nothing and says nothing, which the spec-1 audit found
 * shipped twice. Neither is available to a caller holding one of these.
 */
export type Availability =
  | { readonly available: true; readonly reason: null }
  | { readonly available: false; readonly reason: string };

/** One shared frozen yes. There is only ever one thing "available" can mean. */
const AVAILABLE: Availability = Object.freeze({ available: true, reason: null });

const refuse = (reason: string): Availability => Object.freeze({ available: false, reason });

/**
 * Can this layer be drawn for this area? DERIVED — the registry is never asked.
 *
 * The artefact branch resolves the need through `paths()` and `cityPaths()`, which
 * are the authority on what ships. A city that stops emitting a canopy raster
 * disables the canopy layer here with no edit to this file, and a city that never
 * shipped one was never enabled. That is what "derived" buys, and it is why there
 * is no city named anywhere above.
 *
 * The two scopes are merged into ONE lookup because a layer declares WHICH artefact
 * it needs, not which scope owns it — `needs: 'canopy'` should not have to know
 * that canopy is per-area while heatwave percentiles are per-city, and a layer
 * moving between the two would otherwise be an edit here as well as there. The
 * twelve names are disjoint by construction (`AreaPaths` and `CityPaths` in
 * `scope/paths.ts`), which is that file's invariant to keep, not this one's.
 *
 * `undefined` is treated exactly like `null`: a `needs` naming no artefact at all
 * fails CLOSED rather than resolving to a URL of "undefined" and firing a request
 * that 404s into a half-drawn city. The type already forbids it and the unit test
 * checks every `needs` against the live key sets, so this branch is the third line
 * rather than the first — but silent degradation is the failure this codebase keeps
 * paying for, and it gets in through exactly this kind of gap.
 */
export function layerAvailability(id: LayerId, key: AreaKey, caps: Capabilities): Availability {
  const record = LAYER_BY_ID.get(id);
  if (record === undefined) {
    throw new Error(`scope/layers: "${id}" is not a registered layer id`);
  }
  const needs = record.entry.needs;

  /* The capability branch. It reads `caps` and NOTHING else — deliberately not the
     artefacts, because street-level imagery has none: it is served from
     tiles.mapillary.com against a token, and a city with every artefact we ship can
     still have no token behind it. Gating it on files would have made it available
     wherever the ward JSON was, which is wrong in both directions. */
  if (typeof needs === 'object') {
    if (caps[needs.cap]) return AVAILABLE;
    return refuse(
      `no ${needs.cap} token — this layer is served from the ${needs.cap} API, not from a `
      + 'shipped artefact, and the whole feature is tree-shaken out of a build whose '
      + 'token is unset');
  }

  const area = paths(key);
  const urls: Readonly<Record<string, string | null | undefined>> = {
    ...cityPaths(key), ...(area ?? {}),
  };
  const url = urls[needs];
  if (url === null || url === undefined) {
    /* NAMING THE ARTEFACT IS THE REQUIREMENT, and the two clauses are different
       facts an operator needs told apart: an area that ships nothing at all is a
       scope the twin has not been built for, where a city missing one stem has
       everything else. "Unavailable" alone would send both to the same shrug. */
    return refuse(area === null
      ? `no "${needs}" artefact — "${key}" ships no per-area artefacts at all, so there `
        + 'is nothing to draw and nothing to fetch'
      : `no "${needs}" artefact — this area's city declares none under that name`);
  }
  return AVAILABLE;
}

/**
 * Runnable self-check. Every assertion guards a failure that is SILENT — one that
 * ships green and draws a wrong tree rather than throwing.
 *
 *   node --import tsx -e "import('./layers.ts').then(m=>m.assertLayerLogic())"
 *
 * Failures are COLLECTED rather than thrown on sight, the same as
 * `assertRegistryLogic`: when one edit breaks three invariants, seeing them one at a
 * time is three round trips, and the second and third tend to be the real mistake.
 */
export function assertLayerLogic(): void {
  const failures: string[] = [];
  const need = (ok: boolean, msg: string): void => { if (!ok) failures.push(msg); };

  /* 1 · A flatten that returns nothing makes `isLayerId` reject EVERY id, including
     the six that draw. No other check here can see it: each of the others iterates
     the tree, so all of them pass vacuously on an empty one. */
  need(LAYER_IDS.length > 0,
    'LAYER_IDS is empty — no layer is registered, so isLayerId would reject every id '
    + 'and the tree would render nothing while reporting no fault');

  /* 2 · The id is a flat string with "/" as its separator, so (group, item) → id is
     a bijection only while no slug contains one. Let one through and two rows answer
     to a single id; the loser is unreachable, and WHICH one loses is decided by
     declaration order.

     What this actually proves, since it should not be overstated: an object literal
     cannot carry a key twice, so with the tree written as a literal a duplicate is
     reachable ONLY via a slug containing "/" — meaning check 2 never fires alone,
     always alongside check 3. It earns its place by naming the CONSEQUENCE where
     check 3 names the cause, and because LAYER_IDS need not always come from one
     literal: a build that concatenated a plugin's layers could duplicate with no
     slash anywhere, and then this is the only thing watching. */
  const seen = new Set<string>();
  for (const id of LAYER_IDS) {
    need(!seen.has(id),
      `duplicate layer id "${id}" — two entries flatten to the same id, so one of them `
      + 'is unreachable. Check for a "/" inside a slug');
    seen.add(id);
  }

  const noSlash = (kind: string, slug: string): void => {
    need(!slug.includes('/'),
      `${kind} slug "${slug}" contains a "/" — the separator that joins a group to an `
      + 'item, so the id it builds cannot be read back unambiguously and a visibility '
      + 'set persisted under it names a layer that does not exist');
  };

  /* Walks the TREE, not LAYER_IDS. Going through the ids would make checks 3–5
     depend on check 2 having already passed, and a guard that only works on a
     healthy registry is no use on the broken one it was written for. */
  for (const [group, groupEntry] of Object.entries(GROUPS)) {
    /* 3 · The root cause check 2 names the consequence of. It also catches the half
       check 2 cannot see: a slash that happens to collide produces a duplicate and
       check 2 fires, but a LONE slash-bearing slug produces a perfectly unique id
       and sails past everything else. */
    noSlash('group', group);

    const items = Object.entries(groupEntry.items);

    /* 4 · A group with no items produces no ids, so it draws an empty section
       heading — a category the visitor is told exists and can never open. It still
       appears in every count built from the tree. */
    need(items.length > 0,
      `layer group "${group}" has no items — it renders a heading over nothing, and a `
      + 'group that can never be opened reads as a group whose data is missing');

    /* 5 · An unlabelled row is a checkbox with no name. Groups are held to the same
       rule for the same reason: the heading is the only thing telling a visitor what
       the rows under it have in common, and an empty string renders as a gap rather
       than as a fault. `.trim()` because a label of spaces is an empty label that
       passes a length test. */
    need(groupEntry.label.trim().length > 0,
      `layer group "${group}" has an empty label — the section heading would render as `
      + 'blank space, which reads as a layout bug rather than as a missing name');
    for (const [item, itemEntry] of items) {
      noSlash(`item in "${group}"`, item);
      need(itemEntry.label.trim().length > 0,
        `layer "${group}/${item}" has an empty label — the row would render as a `
        + 'checkbox with nothing beside it, and nothing anywhere would report why');
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    throw new Error(
      `scope/layers: ${failures.length} invariant(s) failed — see the FAIL lines above`);
  }
}
