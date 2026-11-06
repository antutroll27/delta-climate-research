/**
 * WHICH OBOS AREAS HAVE AN AIR CARD OF A LOCAL REGULATOR'S KIND, and when each may show one.
 *
 * Pure configuration, safe in the browser bundle: it names no adapter and holds no key. The server
 * (local-handler.ts) maps `standard` to its reader.
 *
 * THE CARD FOLLOWS THE MAP. A city's Air card is wired in but NOT shown until the city is drawable
 * (`scope/registry.ts` `drawable`), because an air card beside a map that cannot be opened is a promise
 * the page cannot keep. `localAirReady` is that one gate, used by the UI (`isAirCity`) and by the API
 * (an area that is not ready answers 404 like an unknown one). This file does not set `drawable`.
 */
import { isDrawable } from '../../scripts/climate-engine/scope/registry.ts';
import type { LocalStandard } from './local-types.ts';

export interface LocalAirArea {
  standard: LocalStandard;
  /** What the card calls the place before the area's own name. */
  country: 'nl' | 'jp';
  /** The IANA zone the card's times are told in (also the registry's `tz` for the city). */
  tz: string;
}

/** Keys are `country/city/area`, exactly the registry's. Tokyo's key is the plan's (B6); the Tokyo registry entry arrives with that task. */
export const LOCAL_AIR_AREAS: Readonly<Record<string, LocalAirArea>> = {
  'nl/amsterdam/canal-ring': { standard: 'nl-lki', country: 'nl', tz: 'Europe/Amsterdam' },
  'jp/tokyo/marunouchi': { standard: 'jp-eqs', country: 'jp', tz: 'Asia/Tokyo' },
};

/**
 * How long a published hour stays "current", per standard, ms. Luchtmeetnet rows appear about 35 minutes after the
 * hour closes (two hours leaves room for one missed publication); Soramame files appear about an hour after
 * (the newest hour is normally 60 to 120 minutes old, so three hours). Past it the card shows no number.
 */
export const LOCAL_LIVE_MS: Readonly<Record<LocalStandard, number>> = { 'nl-lki': 2 * 3_600_000, 'jp-eqs': 3 * 3_600_000 };

/** The clock each standard's card tells its times on (the zone of every area using it); the painters read it here, not as a literal in the engine tree. */
export const LOCAL_STANDARD_TZ: Readonly<Record<LocalStandard, string>> = { 'nl-lki': 'Europe/Amsterdam', 'jp-eqs': 'Asia/Tokyo' };

export function isLocalAirArea(key: string): boolean {
  return Object.hasOwn(LOCAL_AIR_AREAS, key);
}

/** The area's config, or null for anything that is not a local-regulator Air area. */
export function localAirArea(key: string): LocalAirArea | null {
  return Object.hasOwn(LOCAL_AIR_AREAS, key) ? LOCAL_AIR_AREAS[key]! : null;
}

export type DrawableFn = (country: string, city: string, area: string) => boolean;

/** True when the area has a local-regulator Air card AND its city can be opened. The one gate. */
export function localAirReady(key: string, drawable: DrawableFn = isDrawable): boolean {
  if (!isLocalAirArea(key)) return false;
  const [country, city, area] = key.split('/');
  return country !== undefined && city !== undefined && area !== undefined && drawable(country, city, area);
}

/** True when any area of the same city (`nl/amsterdam/x` → the city) is ready: the UI's city-level question. */
export function localAirCityReady(key: string, drawable: DrawableFn = isDrawable): boolean {
  const prefix = key.split('/').slice(0, 2).join('/') + '/';
  return Object.keys(LOCAL_AIR_AREAS).some((k) => k.startsWith(prefix) && localAirReady(k, drawable));
}
