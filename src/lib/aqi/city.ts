/**
 * THE CITY-WIDE AQI, by CPCB's own city method: the arithmetic mean of the published
 * AQI of every station CPCB groups under the city that reports a valid AQI in the
 * same feed snapshot, rounded to a whole number and given the CPCB category of that
 * number (CPCB's daily AQI bulletin averages a city's stations the same way).
 *
 * Membership is CPCB's own `<State id>` + `<City id>` grouping in the feed, never a
 * radius: Howrah is its own city in the feed and is not folded into Kolkata. Fewer
 * than MIN_CITY_STATIONS valid stations is no city figure at all (null), never one
 * station passed off as a city. Pure; no I/O.
 */
import { category } from './cpcb.ts';
import { AQI_MAX, type FeedStation } from './cpcb-feed.ts';
import type { CityAqi } from './types.ts';

export const MIN_CITY_STATIONS = 2;

/** An OBOS city as CPCB's feed groups it. */
export interface CityRef {
  /** What the card prints, e.g. "Kolkata". */
  name: string;
  /** The feed's exact `<State id>` and `<City id>`. */
  cpcb_state: string;
  cpcb_city: string;
}

/** OBOS cities with an Air card, by area-key prefix. Bengaluru has no Air card, so no entry. */
export const CITIES: Readonly<Record<string, CityRef>> = {
  'in/kolkata': { name: 'Kolkata', cpcb_state: 'West Bengal', cpcb_city: 'Kolkata' },
};

/** The city an area key belongs to (`in/kolkata/ballygunge` → Kolkata), or null. */
export function cityFor(area: string): CityRef | null {
  const prefix = area.split('/').slice(0, 2).join('/');
  return Object.hasOwn(CITIES, prefix) ? CITIES[prefix]! : null;
}

/**
 * The city's mean AQI over its valid stations in this snapshot, or null. "Same snapshot":
 * only stations stamped with the city's newest `lastupdate` count, so a station that
 * stopped updating never drags an old value into the mean.
 */
export function cityAqi(feed: readonly FeedStation[], ref: CityRef): CityAqi | null {
  const inCity = feed.filter((s) => s.state === ref.cpcb_state && s.city === ref.cpcb_city
    && s.aqi !== null && Number.isInteger(s.aqi) && s.aqi >= 0 && s.aqi <= AQI_MAX && Number.isFinite(Date.parse(s.published_at)));
  if (inCity.length === 0) return null;
  const newest = Math.max(...inCity.map((s) => Date.parse(s.published_at)));
  const members = inCity.filter((s) => Date.parse(s.published_at) === newest).map((s) => ({ name: s.name, aqi: s.aqi! }));
  if (members.length < MIN_CITY_STATIONS) return null;
  const aqi = Math.round(members.reduce((a, m) => a + m.aqi, 0) / members.length);
  return { name: ref.name, aqi, category: category(aqi), stations: members.length, members, observed_at: new Date(newest).toISOString() };
}
