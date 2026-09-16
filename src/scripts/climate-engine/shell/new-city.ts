/**
 * WHICH CITY IS NEW, AND WHERE IT OPENS.
 *
 * A reader who follows any front door lands on one Kolkata ward
 * (`DEFAULT_AREA` in scope/registry.ts), and Bengaluru is reachable only as an
 * unlabelled option inside a collapsible select. Its pages are deliberately
 * `noindex` until a catalogue record exists, so search cannot find it either.
 * This module decides what the console should say about that.
 *
 * PURE, AND BOTH INPUTS INJECTED. The clock is a parameter because a test that
 * waits ninety days is not a test, and the store is a parameter because reading
 * `localStorage` THROWS on a document with site data blocked — see layout-state.ts,
 * whose accessor this reuses rather than copies.
 *
 * WHETHER, NOT WHEN. This module decides whether a city is worth announcing; the
 * shell decides when the badge becomes visible, and the two are separate because
 * the only party holding the facts that settle "when" is the browser. Both of them
 * are: the dismissal lives in `localStorage`, and the clock that matters is live.
 * These pages are PRERENDERED — `[area].astro` builds through `getStaticPaths` and
 * nothing opts out — so `new Date()` in frontmatter is the BUILD clock, frozen at
 * deploy. A badge revealed on the server would therefore keep announcing a city
 * long past its window until somebody redeployed, and would flash once for a reader
 * who had already dismissed it. So the server renders the badge hidden and carries
 * `since` out to the client, and the shell re-checks the window and the dismissal
 * before unhiding it. That is what makes the announcement expire on its own rather
 * than as a line of copy somebody has to remember to delete.
 */
import { CITIES } from '../../../data/cities.ts';
import { areaPath } from '../scope/paths.ts';
import { AREA_KEYS, isDrawable, splitKey, type AreaKey } from '../scope/registry.ts';
import { defaultStore, type LayoutStore } from './layout-state.ts';

/** How long a city counts as new, in days. */
export const NEW_CITY_DAYS = 90;

/**
 * The one stored value that means "the reader put this badge away".
 *
 * NAMED BECAUSE IT IS A WIRE FORMAT. Spelled twice as a bare literal — once to
 * write, once to compare — it can be changed in one edit with both halves kept
 * symmetric, so every test still passes while every real reader who had dismissed
 * the badge gets it back. `layout-state.ts` exports COLLAPSED/EXPANDED for exactly
 * this reason.
 */
export const DISMISSED = 'dismissed';

/**
 * When a city arrived, in epoch milliseconds, or NaN if it declares no usable date.
 *
 * EXPORTED SO THE TEST AND THE CONSUMER CANNOT DRIFT. The `Z` is load-bearing:
 * `Date.parse('2026-09-16T00:00:00')` is local time, which at UTC+14 is fourteen
 * hours early and round-trips to the fifteenth — a whole day at the window's edge.
 * Two copies of this concatenation is two chances to lose the Z, so there is one.
 *
 * NaN IS THE SILENT CASE, and deliberately so: a city that declares no date, or a
 * malformed one, is never announced rather than wrongly announced. A forgotten
 * field costs an opportunity; a wrong one puts a lie on screen.
 */
export function arrivedMs(city: { readonly since?: string }): number {
  return city.since ? Date.parse(`${city.since}T00:00:00Z`) : NaN;
}

/** What the badge needs to render itself, and nothing more. */
export interface NewCity {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  /**
   * The arrival date, travelling out to the client as it was declared.
   *
   * IT GOES TO THE BROWSER BECAUSE THE SERVER'S CLOCK IS FROZEN. These pages are
   * prerendered, so the window this module just checked was checked against the
   * BUILD clock and cannot expire on its own. The shell re-checks it against a
   * live `Date.now()` before revealing the badge; without this field the reveal
   * would have nothing to re-check and the badge would outlive its window.
   */
  readonly since: string;
}

/** Namespaced like `obos:rail` and `obos:panel`, one key per city. */
export function newCityKey(cityId: string): string {
  return `obos:new-city:${cityId}`;
}

/**
 * The area to open for a city: its declared showcase when that area can actually
 * be drawn, else the first drawable one.
 *
 * DERIVED, NEVER TYPED. A hard-coded URL survives a ward rename and a
 * `drawable: false`, and the reader is the one who finds out.
 */
function openableAreaKey(cityId: string): AreaKey | null {
  const inCity = AREA_KEYS.filter((key) => splitKey(key).city === cityId);
  const drawable = inCity.filter((key) => {
    const { country, city, area } = splitKey(key);
    return isDrawable(country, city, area);
  });
  const showcase = CITIES[cityId]?.showcase;
  const preferred = drawable.find((key) => splitKey(key).area === showcase);
  return preferred ?? drawable[0] ?? null;
}

/** TRUE only when this store says this city was dismissed. Anything else is false. */
export function wasDismissed(cityId: string, store: LayoutStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(newCityKey(cityId)) === DISMISSED;
  } catch {
    return false;
  }
}

/** Remember it, or fail to and carry on: the badge is already off the screen. */
export function rememberDismissed(cityId: string, store: LayoutStore | null = defaultStore()): void {
  try {
    store?.setItem(newCityKey(cityId), DISMISSED);
  } catch {
    /* the preference is a convenience; the reader's click already took effect */
  }
}

/**
 * The city worth announcing to a reader standing in `openCityId`, or null.
 *
 * The most recent arrival wins, so two cities landing in one quarter still
 * produce one badge rather than a row of them. A city with no date is never
 * announced, which is why a forgotten field is silent rather than wrong. And if
 * the most recent arrival cannot be opened, the answer is null — never the
 * runner-up; see the note on the head candidate below.
 */
export function newCityToAnnounce(
  openCityId: string,
  now: Date = new Date(),
  store: LayoutStore | null = defaultStore(),
): NewCity | null {
  const cutoff = now.getTime() - NEW_CITY_DAYS * 86_400_000;
  const candidates = Object.values(CITIES)
    .filter((city) => city.id !== openCityId)
    .filter((city) => {
      const since = arrivedMs(city);
      return Number.isFinite(since) && since > cutoff && since <= now.getTime();
    })
    .filter((city) => !wasDismissed(city.id, store))
    .sort((a, b) => arrivedMs(b) - arrivedMs(a));

  // THE NEWEST, OR NOTHING. Walking on to the next candidate would quietly
  // announce a city the docblock above does not promise. Two ordinary shapes get
  // there: a newer city whose areas are all `drawable: false` — which is exactly
  // how Dubai is declared today — and a newer city never added to
  // scope/registry.ts at all, which is the ordinary way a third city arrives,
  // since CITIES and the registry are already divergent. In both, the runner-up
  // would take the badge with nothing logged. [area].astro refuses an
  // unrecognised area rather than falling back for the same reason: a confident
  // wrong name is worse than an absent one, because it looks like success.
  const city = candidates[0];
  if (!city) return null;
  const key = openableAreaKey(city.id);
  if (!key) return null;
  // `since` is non-empty by construction — the filter above admitted this city
  // only because `arrivedMs` returned a finite number, which requires it. The
  // fallback is unreachable, and fail-safe if it ever stops being: the client
  // re-check parses '' to NaN and leaves the badge hidden.
  return { id: city.id, name: city.name, href: areaPath(key), since: city.since ?? '' };
}
