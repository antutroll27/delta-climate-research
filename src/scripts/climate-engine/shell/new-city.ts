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
 */
import { CITIES } from '../../../data/cities.ts';
import { areaPath } from '../scope/paths.ts';
import { AREA_KEYS, isDrawable, splitKey, type AreaKey } from '../scope/registry.ts';
import { defaultStore, type LayoutStore } from './layout-state.ts';

/** How long a city counts as new, in days. */
export const NEW_CITY_DAYS = 90;

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
    return store?.getItem(newCityKey(cityId)) === 'dismissed';
  } catch {
    return false;
  }
}

/** Remember it, or fail to and carry on: the badge is already off the screen. */
export function rememberDismissed(cityId: string, store: LayoutStore | null = defaultStore()): void {
  try {
    store?.setItem(newCityKey(cityId), 'dismissed');
  } catch {
    /* the preference is a convenience; the reader's click already took effect */
  }
}

/**
 * The city worth announcing to a reader standing in `openCityId`, or null.
 *
 * The most recent arrival wins, so two cities landing in one quarter still
 * produce one badge rather than a row of them. A city with no date is never
 * announced, which is why a forgotten field is silent rather than wrong.
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

  for (const city of candidates) {
    const key = openableAreaKey(city.id);
    if (key) return { id: city.id, name: city.name, href: areaPath(key) };
  }
  return null;
}
