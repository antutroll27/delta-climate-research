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
 *
 * AMSTERDAM'S 31 STREAMED AREAS (the whole-city stream, dev flag) are the one exception to "drawable": they have no page of their own, the stream
 * opens each on the Canal Ring page, and the card follows the open one, so they are ready by being a sheet of the table (`streamed`). Their keys
 * are derived from the sheet ids; the API therefore answers exactly those ids (and Canal Ring, Tokyo) and no other.
 */
import { AMSTERDAM_SHEET_IDS } from '../../data/sheets/amsterdam.ts';
import { isDrawable } from '../../scripts/climate-engine/scope/registry.ts';
import type { LocalStandard } from './local-types.ts';

export interface LocalAirArea {
  standard: LocalStandard;
  /** What the card calls the place before the area's own name. */
  country: 'nl' | 'jp';
  /** The IANA zone the card's times are told in (also the registry's `tz` for the city). */
  tz: string;
  /**
   * True for Amsterdam's other 31 streamed areas (src/data/sheets/amsterdam.ts). They are registered non-drawable (no page of their own until
   * TILED_CITY_READY), yet the whole-city stream opens each of them on the Canal Ring page, and the card follows the open one; so their
   * readiness is not `drawable` but their being a sheet of the table. They are never offered by a production page: nothing there opens one.
   */
  streamed?: true;
}

/** Amsterdam's streamed areas other than Canal Ring (which keeps its own, drawable-gated entry): `nl/amsterdam/ams-f4`, … Derived from the sheet table's ids, never listed by hand. */
const AMSTERDAM_STREAMED: Readonly<Record<string, LocalAirArea>> = Object.fromEntries(
  AMSTERDAM_SHEET_IDS.filter((id) => id !== 'canal-ring').map((id) => [`nl/amsterdam/${id}`, { standard: 'nl-lki', country: 'nl', tz: 'Europe/Amsterdam', streamed: true } satisfies LocalAirArea]),
);

/** Keys are `country/city/area`, exactly the registry's. Tokyo's key is the plan's (B6); the Tokyo registry entry arrives with that task. */
export const LOCAL_AIR_AREAS: Readonly<Record<string, LocalAirArea>> = {
  'nl/amsterdam/canal-ring': { standard: 'nl-lki', country: 'nl', tz: 'Europe/Amsterdam' },
  ...AMSTERDAM_STREAMED,
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

/** True when the area has a local-regulator Air card AND it can be opened: its city is drawable, or it is a streamed sheet (see `streamed`). The one gate. */
export function localAirReady(key: string, drawable: DrawableFn = isDrawable): boolean {
  if (!isLocalAirArea(key)) return false;
  if (LOCAL_AIR_AREAS[key]!.streamed === true) return true;
  const [country, city, area] = key.split('/');
  return country !== undefined && city !== undefined && area !== undefined && drawable(country, city, area);
}
