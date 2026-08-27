/**
 * The scope registry: Country → City → Area.
 *
 * OBOS supports one city by CONSTRUCTION, not by configuration — Kolkata's three
 * wards are spelled out in module after module, and Dubai (WETEX, October 2026)
 * has nowhere to be named. This file is the spine that fixes that: it adds the
 * two layers ABOVE the ward table, and holds the things that are properties of a
 * COUNTRY (which warming pathway, which currency) or of a CITY (which Köppen
 * climate, which confidence tier, what to fall back to when the live feed is
 * down) rather than of a patch of ground.
 *
 * WHAT THIS FILE MUST NEVER BECOME: a third ward table.
 *
 * TWO exist — `src/data/wards.ts` and `WARDS` in `scripts/_types.py`, which mirrors
 * it for six Python scripts — and the comment above the Python one records what
 * happens when a table is copied rather than referenced: five scripts carried
 * private copies and they HAD ALREADY DIVERGED, `ecostress-census.py` sitting
 * 10–44 m from the others. Sub-pixel at ECOSTRESS's 70 m; four pixels at
 * Sentinel's 10 m. Nothing failed. The numbers were just quietly about slightly
 * different ground.
 *
 * There were THREE when this file was written. `src/scripts/climate-engine/wards.ts`
 * was the third — the same three wards with fewer fields and no Python mirror — and
 * Task 7 deleted it rather than adapting it, for exactly the reason above: a table
 * that is redundant has no way to be right, only a way to be not-yet-wrong. Its
 * consumers now read geography from `src/data/wards.ts` and identity from here. THE
 * COUNT GOES DOWN, never up.
 *
 * So: `src/data/wards.ts` is THE area table, and an area entry here is a
 * REFERENCE to an id that already exists there. No lat. No lon. No footprint. No
 * vegetation. Kolkata's areas carry a single flag and nothing else, because their
 * names, zones and coordinates are already written down one directory over and a
 * second copy could only ever disagree with the first. Dubai's areas carry a
 * display name because they are NOT in that table — no data ships for them yet,
 * and inventing ward-table rows for geometry we have not validated would be the
 * same mistake pointed the other way. `assertRegistryLogic` check 7 enforces the
 * boundary, and `tests/unit/obos-scope.test.mjs` reads this file's own source to
 * confirm the four banned fields never appear in it.
 *
 * NOTHING CONSUMES THIS YET. Task 2 of the scope migration is additive by design:
 * the registry has to exist and be proven correct before anything is pointed at it.
 */

import { WARDS } from '../../../data/wards.ts';

/**
 * Path segments under `/heat-map/` that are already taken.
 *
 * A country slug is the first segment of an area key and, once routing consumes
 * this, of the URL. `/heat-map/brief` and `/heat-map/compare` are real static
 * Astro pages; `/heat-map/data/…` and `/heat-map/styles/…` are served directories
 * in `public/` (the latter holds obos-slate.json, obos-dusk.json, obos-petrol.json).
 * Astro resolves a static route before a dynamic one, so a country registered
 * under any of these names would never reach its own page — the build would
 * succeed, the tests would pass, and the route would simply render the briefing
 * for ever. Check 1 exists because that failure has no other symptom.
 */
export const RESERVED_SLUGS = ['brief', 'compare', 'data', 'styles'] as const;

/**
 * The confidence tiers, weakest last.
 *
 *   validated — measured against satellite observation for every area
 *   zone      — climate-zone transfer of a validated fit, not locally checked
 *   geometry  — buildings and terrain only; the physics has not been evidenced here
 *
 * The tier is the honesty label the page shows, and the GAP between Kolkata's
 * tier and Dubai's is the thing we are asking to be funded to close. It is spelled
 * as data rather than inferred from what happens to be present, so that shipping
 * an artefact by accident cannot silently promote a city.
 */
const TIERS = ['validated', 'zone', 'geometry'] as const;

export const REGISTRY = {
  in: {
    name: 'India',
    /* The NAME of the warming-pathway source: Dhara et al. 2025, PLOS Climate
       4(11):e0000724 (post-AR6 India update). Task 5's scope/resolve.ts maps this
       name to its own delta table.

       IT IS EMPHATICALLY NOT A KEY INTO `PATH_DELTA`. That table is keyed by
       SCENARIO — '2025' | 'ssp245' | 'ssp585' (heat-map-model.ts:77-81) — and
       'dhara2025' is not among them. Indexing PATH_DELTA with this would fail
       SILENTLY in the worst way available: PATH_DELTA is Record<string, number>
       and noUncheckedIndexedAccess is off, so `PATH_DELTA[pathway]` type-checks
       clean AS A NUMBER, evaluates to undefined, and propagates a NaN warming
       delta with nothing raised anywhere. A pathway name and a scenario key are
       different kinds of thing; only resolve.ts may turn one into the other. */
    pathway: 'dhara2025',
    /* Intervention unit costs; parkCr is ₹ crore. Currency is a country fact.

       THE FOUR COST FIGURES MATCH `COST` IN heat-map-model.ts:70 FIELD FOR FIELD,
       and have to; `currency` is registry-only, the model having no notion of one.
       computeCost multiplies each field by a DIFFERENT spatial quantity, so an
       absent field is `undefined`, its term evaluates to NaN, and NaN POISONS THE
       WHOLE TOTAL — measured: ₹110,966,666.67 becomes NaN outright, not a smaller
       plausible number. That is the good case, loud rather than quiet, and the
       `satisfies` clause below now makes it a compile error before it can happen.
       facadeM2 was in fact absent from the first draft of this entry, and is the
       largest of the four at ₹9,500/m². */
    costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5, facadeM2: 9500 },
    cities: {
      kolkata: {
        koppen: 'Aw',
        tier: 'validated',
        /** used only when the live met feed is down */
        fallbackTairC: 32,
        /** cooling-blob radius, metres — Kolkata's measured tree-void-effect scale */
        parkRadiusM: 50,
        /** basenames under public/heat-map/data/ — artefacts, not geography */
        data: { heatwave: 'heatwave-percentiles', dcUrs: 'dc-urs-inputs' },
        /* Names, zones and coordinates deliberately absent: see the header. */
        areas: {
          ballygunge: { shipsData: true },
          baruipur: { shipsData: true },
          barrackpore: { shipsData: true },
        },
      },
    },
  },
  ae: {
    /* No pathway and no costs, and null rather than a plausible-looking placeholder.
       An Indian rupee figure or an India-fitted warming delta carried into Dubai
       would compute silently and read as an answer. Null cannot. */
    name: 'United Arab Emirates',
    pathway: null,
    costs: null,
    cities: {
      dubai: {
        koppen: 'BWh',
        tier: 'geometry',
        fallbackTairC: 40,
        parkRadiusM: 50,
        data: { heatwave: null, dcUrs: null },
        /* These three are NOT in src/data/wards.ts, which is why they carry a
           display name here: they are our own tiling of the city, not municipal
           units, and the descriptor says so rather than implying a ward. */
        areas: {
          creek: { shipsData: false, name: 'Dubai Creek', descriptor: 'area · our tiling' },
          'al-quoz': { shipsData: false, name: 'Al Quoz', descriptor: 'area · our tiling' },
          south: { shipsData: false, name: 'Dubai South', descriptor: 'area · our tiling' },
        },
      },
    },
  },
} as const satisfies Record<string, CountryEntry>;

type Registry = typeof REGISTRY;

/**
 * Every registered area, as a literal union of `country/city/area`.
 *
 * DERIVED, never written out. A hand-maintained union is a fifth table, and it
 * would drift the moment someone adds a city and forgets it — the compiler would
 * keep accepting the old set and rejecting the new one, which is drift that looks
 * like a type error somewhere else entirely.
 *
 * THE `extends { areas: infer A }` IS LOAD-BEARING. The obvious spelling,
 * `Registry[C]['cities'][Y]['areas']`, does not compile: TS2536, because while the
 * mapped type is still distributing over `Y` TypeScript cannot prove that
 * `['areas']` indexes it. The conditional supplies exactly that proof. Verified
 * both directions before this shipped — `in/kolkata/ballygunge` assigns and
 * `in/kolkata/typo` does not — because a key type that compiles but accepts any
 * string is worse than none: it would make every later `AreaKey` annotation a
 * decoration.
 */
export type AreaKey = {
  [C in keyof Registry]: {
    [Y in keyof Registry[C]['cities']]:
      Registry[C]['cities'][Y] extends { areas: infer A }
        ? { [N in keyof A]: `${C & string}/${Y & string}/${N & string}` }[keyof A]
        : never
  }[keyof Registry[C]['cities']]
}[keyof Registry];

/**
 * The authoring contract. REGISTRY closes with
 * `as const satisfies Record<string, CountryEntry>`, and that clause is what makes
 * an incomplete entry fail HERE.
 *
 * Without it a city omitting `fallbackTairC` compiled clean and passed all eight
 * runtime guards — the guards walk the tree and not one of them reads that field,
 * so the omission surfaced only at the first generic consumer, tasks away, as a
 * type error naming the wrong file.
 *
 * `as const` comes FIRST and `satisfies` only checks, so the literal types survive
 * and AreaKey still derives the six exact keys instead of widening to `string`.
 * That is verified, not assumed: the negative probe still rejects
 * `in/kolkata/typo` while accepting `in/kolkata/ballygunge`.
 */
type Tier = typeof TIERS[number];

interface CountryCosts {
  readonly currency: string;
  readonly roofM2: number;
  readonly tree: number;
  readonly parkCr: number;
  readonly facadeM2: number;
}
interface AreaEntry {
  readonly shipsData: boolean;
  /** present ONLY for areas absent from src/data/wards.ts — see the header */
  readonly name?: string;
  readonly descriptor?: string;
}
interface CityEntry {
  readonly koppen: string;
  /** the union, so a typo is a compile error and check 4 is the backstop */
  readonly tier: Tier;
  readonly fallbackTairC: number;
  readonly parkRadiusM: number;
  readonly data: { readonly heatwave: string | null; readonly dcUrs: string | null };
  readonly areas: Readonly<Record<string, AreaEntry>>;
}
interface CountryEntry {
  readonly name: string;
  readonly pathway: string | null;
  readonly costs: CountryCosts | null;
  readonly cities: Readonly<Record<string, CityEntry>>;
}

/* The walkers below read REGISTRY through this WIDENED view, never its literal
   type. Every invariant here is a property of the tree, not of which countries
   happen to be in it today, and a walk written against the literal type would
   have to be edited each time a city is added. */
const COUNTRIES: Readonly<Record<string, CountryEntry>> = REGISTRY;

interface AreaParts {
  readonly country: string;
  readonly city: string;
  readonly area: string;
}

/* The flatten, and the ONLY place a key is ever taken apart.

   The parts are REMEMBERED here rather than recovered later by splitting on "/",
   and that is a correction, not a flourish. Splitting cannot be right in general:
   the key joins three slugs with two separators, so a slug that itself contains a
   "/" makes the string ambiguous and a left-to-right split silently returns the
   WRONG area — `ae/dubai/al/quoz` reads back as area "al", which exists nowhere,
   and the next property access throws a TypeError with no mention of the slug that
   caused it. That is exactly what happened the first time check 2 below was
   deliberately broken: the duplicate WAS detected, and then check 7 crashed on the
   mis-split key before a single collected FAIL line could be printed. A guard that
   is pre-empted by a crash in a later guard reports nothing at all.

   Duplicates are kept in AREA_KEYS but the map keeps the FIRST binding, which is
   what makes the loser of a collision unreachable rather than silently swapped —
   check 2 is what stops that state from shipping, and check 8 refuses the slug that
   causes it outright. */
const keys: AreaKey[] = [];
const AREA_PARTS = new Map<string, AreaParts>();
for (const [country, entry] of Object.entries(COUNTRIES)) {
  for (const [city, cityEntry] of Object.entries(entry.cities)) {
    for (const areaId of Object.keys(cityEntry.areas)) {
      const key = `${country}/${city}/${areaId}` as AreaKey;
      keys.push(key);
      if (!AREA_PARTS.has(key)) {
        AREA_PARTS.set(key, Object.freeze({ country, city, area: areaId }));
      }
    }
  }
}

/** Every area key, in declaration order. The runtime twin of `AreaKey`. */
export const AREA_KEYS: readonly AreaKey[] = keys;

/**
 * Membership, not shape.
 *
 * Takes `unknown` because the callers that matter are the untrusted ones — a URL
 * segment, a query parameter, a restored session value — and a signature that
 * demanded a string would push the cast to every call site, where it would be
 * written once carelessly. A key that merely LOOKS well-formed is rejected:
 * `in/kolkata/typo` has the right shape and no city behind it.
 */
export function isAreaKey(value: unknown): value is AreaKey {
  return typeof value === 'string' && AREA_PARTS.has(value);
}

/**
 * The three slugs a key was built from — looked up, never re-parsed.
 *
 * Total on `AreaKey`, and honestly so: the answer is the same object the flatten
 * recorded, so it cannot disagree with the registry however the slugs are spelled.
 * The throw is unreachable through the type, and is here for the one call site the
 * type cannot police — a value cast from a URL without `isAreaKey` first.
 */
export function splitKey(key: AreaKey): AreaParts {
  const parts = AREA_PARTS.get(key);
  if (parts === undefined) {
    throw new Error(`scope/registry: "${key}" is not a registered area key`);
  }
  return parts;
}

/**
 * The keys sharing one key's CITY, in declaration order — including the key itself.
 *
 * Reads the parts back through `splitKey`, never by splitting the string: see the
 * note above `AREA_PARTS` for why a left-to-right split cannot be right in general.
 */
export function areaKeysInCity(key: AreaKey): readonly AreaKey[] {
  const { country, city } = splitKey(key);
  return AREA_KEYS.filter((candidate) => {
    const parts = splitKey(candidate);
    return parts.country === country && parts.city === city;
  });
}

/**
 * Pure half of `nextDistinctArea`, separate for the reason `areaTableDrift` is:
 * so the case this registry does NOT yet contain — a city with exactly one area —
 * can be exercised before it is real.
 *
 * Null, not the key back. A caller handed its own key would build a comparison of
 * an area against itself, which `assertPairedResult` refuses and no reader wants;
 * null makes the absence a thing the caller has to answer for.
 */
export function nextDistinctKey(cityKeys: readonly AreaKey[], key: AreaKey): AreaKey | null {
  return cityKeys.find((candidate) => candidate !== key) ?? null;
}

/**
 * A DIFFERENT area in the SAME city, or null when the city has only one.
 *
 * Same city is the whole point. This replaces `nextDistinctWard`, which searched a
 * three-slug list that was Kolkata by construction, so the constraint was free.
 * Over the registry it is not: `AREA_KEYS.find(k => k !== key)` would happily pair
 * Ballygunge against Al Quoz — two cities, two climates, two currencies, and Dubai
 * shipping no artefacts at all, so the second half of the comparison would fail to
 * load while the first rendered. Confining the search to the city is what keeps the
 * fallback a comparison rather than a category error.
 */
export function nextDistinctArea(key: AreaKey): AreaKey | null {
  return nextDistinctKey(areaKeysInCity(key), key);
}

/** Every area id that ships data, anywhere in the registry — not just Kolkata's. */
export function shippingAreaIds(): readonly string[] {
  const ids: string[] = [];
  for (const entry of Object.values(COUNTRIES)) {
    for (const cityEntry of Object.values(entry.cities)) {
      for (const [areaId, areaEntry] of Object.entries(cityEntry.areas)) {
        if (areaEntry.shipsData) ids.push(areaId);
      }
    }
  }
  return ids;
}

/**
 * Check 7's comparison, pure and separate so it can be exercised against
 * registries this one is not yet.
 *
 * It is separate for a reason. The first version compared the ward table against
 * `Object.keys(kolkata.areas)`, which quietly encoded "the ward table IS Kolkata's
 * area set" — a premise this file's own header denies. The first non-Kolkata area
 * to ship data would have failed it spuriously, and nothing in the shipped
 * registry could have caught that, because no such area exists YET. Pulling the
 * comparison out lets the Dubai case be tested before it is real.
 *
 * Both directions matter. An area shipping data with no row in the ward table has
 * no coordinates behind it; a row in the table that no area ships describes ground
 * the twin does not model. Returns null when the two agree.
 */
export function areaTableDrift(
  shippingIds: readonly string[], tableIds: readonly string[],
): string | null {
  const shipping = [...new Set(shippingIds)].sort().join(', ');
  const table = [...new Set(tableIds)].sort().join(', ');
  if (shipping === table) return null;
  return `the registry ships data for [${shipping}] but src/data/wards.ts describes `
    + `[${table}] — these must name the same ground. Five Python scripts once `
    + 'diverged this way and nothing failed';
}

/**
 * Runnable self-check. Every assertion here guards a failure that is SILENT —
 * one that ships green and shows a wrong page rather than throwing.
 *
 *   node --import tsx -e "import('./registry.ts').then(m=>m.assertRegistryLogic())"
 *
 * Failures are collected rather than thrown on first sight: when a registry edit
 * breaks three invariants, seeing one and re-running is three round trips, and
 * the second and third are the ones that tend to be the real mistake.
 */
export function assertRegistryLogic(): void {
  const failures: string[] = [];
  const need = (ok: boolean, msg: string): void => { if (!ok) failures.push(msg); };

  /* 1 · A country slug that collides with a real route is unreachable for ever,
     and nothing anywhere reports it. See RESERVED_SLUGS. */
  const reserved: readonly string[] = RESERVED_SLUGS;
  for (const country of Object.keys(COUNTRIES)) {
    need(!reserved.includes(country),
      `country slug "${country}" is a reserved route under /heat-map/ — Astro resolves `
      + 'the static page first, so this country could never be reached');
  }

  /* 2 · The key is a flat string with "/" as its separator, so (country, city,
     area) → key is a bijection only while no slug contains a "/". Let one through
     and two different places answer to one key; the loser is silently unreachable,
     and which one loses depends on declaration order.

     Precisely what this proves, since the file should not overstate it: an object
     literal cannot carry the same key twice, so a duplicate is reachable ONLY via a
     slug containing a "/" — meaning check 2 never fires alone, always alongside
     check 8. It is kept for two reasons. It names the CONSEQUENCE where check 8
     names the cause, and AREA_KEYS need not always come from one literal: a
     migration that concatenated legacy aliases could duplicate with no slash at
     all, and then check 2 would be the only thing watching. */
  const seen = new Set<string>();
  for (const key of AREA_KEYS) {
    need(!seen.has(key),
      `duplicate area key "${key}" — two entries flatten to the same key, so one of `
      + 'them is unreachable. Check for a "/" inside a slug');
    seen.add(key);
  }

  /* 3 · A flattening that returns nothing makes isAreaKey reject EVERY key,
     including the three that ship real data. No other check here can see it:
     each of them iterates areas, so all of them pass vacuously. */
  need(AREA_KEYS.length > 0,
    'AREA_KEYS is empty — no area is registered, so isAreaKey would reject every key');

  const tiers: readonly string[] = TIERS;
  for (const [country, entry] of Object.entries(COUNTRIES)) {
    for (const [city, cityEntry] of Object.entries(entry.cities)) {
      /* 4 · A mistyped tier is not a runtime error. It falls through every switch
         to the default branch — and a default shows the MOST confident label, so
         a typo fails in the direction of overclaiming. */
      need(tiers.includes(cityEntry.tier),
        `${country}/${city} has tier "${cityEntry.tier}", which is not one of `
        + `${tiers.join(' | ')} — an unknown tier falls through to the default label, `
        + 'which overclaims');

      const areaIds = Object.keys(cityEntry.areas);

      /* 5 · "validated" is the strongest claim the page can make, and it is a claim
         about the WHOLE city. One area without measured data behind it and the
         label is false for that area while reading true for all of them. */
      if (cityEntry.tier === 'validated') {
        for (const areaId of areaIds) {
          need(cityEntry.areas[areaId].shipsData,
            `${country}/${city} claims tier "validated" but area "${areaId}" ships no `
            + 'data — a city may only claim validation its areas can each support');
        }
      }

      /* 6 · A city with no areas produces no keys, so it is unreachable while still
         appearing in every count and every menu built from the registry. */
      need(areaIds.length > 0, `${country}/${city} has no areas — it can never be reached`);
    }
  }

  /* 7 · THE ANTI-DIVERGENCE CHECK. src/data/wards.ts is the one area table; this
     registry references it. Read against it rather than trusted, because the
     defect being prevented is precisely the one that leaves both files internally
     consistent and quietly about different ground. */
  const tableIds = WARDS.map((w) => w.id);
  /* Walks the tree rather than the keys. Going back through a key would make this
     check depend on check 2 having already passed, and a check that only works on
     a healthy registry is no use on a broken one — see the note above AREA_PARTS. */
  for (const [country, entry] of Object.entries(COUNTRIES)) {
    for (const [city, cityEntry] of Object.entries(entry.cities)) {
      for (const [areaId, areaEntry] of Object.entries(cityEntry.areas)) {
        if (!areaEntry.shipsData) continue;
        need(tableIds.includes(areaId),
          `"${country}/${city}/${areaId}" ships data but "${areaId}" is not in `
          + 'src/data/wards.ts — an area that ships data must be described there, not here');
      }
    }
  }
  /* Against EVERY data-shipping area in the registry, not against Kolkata's.
     Kolkata is merely the only city shipping data TODAY, and hard-coding that made
     the two halves of this check contradict each other: the first says the ward
     table must CONTAIN each shipping area, the second used to say it must EQUAL
     Kolkata's. Give Dubai's creek `shipsData: true`, add the ward row that first
     half then requires, and the second fired anyway. Loud, but wrong, and it would
     have blocked Task 3 onwards. */
  const drift = areaTableDrift(shippingAreaIds(), tableIds);
  if (drift !== null) failures.push(drift);

  /* 8 · No slug may contain a "/". Numbered last because it was added last, but it
     belongs with check 2: it is that failure's ROOT CAUSE, and it catches the half
     check 2 cannot see. A slash that happens to collide produces a duplicate key and
     check 2 fires; a LONE slash-bearing slug produces a perfectly unique key and
     sails past every check above. The converse holds too, and check 2's comment
     says so: a duplicate is unreachable WITHOUT a slash, so the two always fire
     together and check 2 never fires alone.

     It still breaks two things. The key is the URL form — routing puts these into
     /heat-map/{country}/{city}/{area} — where a slug carrying a slash silently
     becomes an extra path segment, so the route no longer matches what the registry
     thinks it registered. And `ae/dubai/al/quoz` cannot be read back by eye or by
     any consumer that parses on "/", even though splitKey itself now looks the parts
     up rather than re-deriving them. Refusing the slug is cheaper than making every
     downstream consumer slash-aware. */
  const noSlash = (kind: string, slug: string): void => {
    need(!slug.includes('/'),
      `${kind} slug "${slug}" contains a "/" — a slug is ONE path segment in `
      + '/heat-map/{country}/{city}/{area}, so a slash splits it into two and the area '
      + 'key it builds cannot be read back unambiguously');
  };
  for (const [country, entry] of Object.entries(COUNTRIES)) {
    noSlash('country', country);
    for (const [city, cityEntry] of Object.entries(entry.cities)) {
      noSlash(`city in "${country}"`, city);
      for (const areaId of Object.keys(cityEntry.areas)) {
        noSlash(`area in "${country}/${city}"`, areaId);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    throw new Error(
      `scope/registry: ${failures.length} invariant(s) failed — see the FAIL lines above`);
  }
}
