/**
 * THE LUCHTMEETNET STATIONS NEAREST THE CANAL RING, and the rule that picks the ones the LKI card may use.
 *
 * THE RULE. The LKI is "the substance with the highest index number decides" over NO2, PM10, PM2.5 and O3, and
 * "Als alle stoffen hetzelfde indexgetal hebben dan wordt de totale index één punt hoger" (if all substances have the
 * same index number the total goes up one point) (luchtmeetnet.nl, "Luchtkwaliteitsindex (LKI)"). A station that does
 * not measure all four would publish an LKI from fewer substances: normally as high or lower than the full one, though
 * not strictly always, because of the tie rule (a station whose few substances all tie gets the extra point, and one
 * with a fourth, lower substance would not). Its LKI is a different quantity, not a lower bound. So a station serves the card only
 * if its published component list (`/open_api/stations/{id}` → `components`) holds all four. Measured on
 * 2026-11-06 over all 100 stations Luchtmeetnet lists whose detail was read, within 20 km of the canal ring:
 *   NL49014 Amsterdam-Vondelpark        1,362 m  Municipal  NO2 PM10 PM25 O3 (+CO FN NO BCWB)   SERVES (first)
 *   NL49012 Amsterdam-Van Diemenstraat  2,895 m  Traffic    NO2 PM10 PM25 O3 (+CO FN NO BCWB)   SERVES (fallback)
 *   NL49003 Amsterdam-Nieuwendammerdijk 4,885 m  Municipal  NO2 PM10 PM25 O3 (+FN NO BCWB)      SERVES (fallback)
 *   NL10552 Haarlem-Freddie Oversteegenstraat 15,849 m  RIVM  Other    NO2 PM10 PM25 O3 (+NO)       SERVES (far fallback)
 *   NL10641 Breukelen-A2                19,363 m  RIVM  Traffic  NO2 PM10 PM25 O3 (+FN NO BCWB) SERVES (far fallback)
 * and nearer ones that do NOT (no O3): NL49017 Stadhouderskade 1,198 m (traffic), NL49019 Oude Schans 1,593 m
 * (NO NO2 only), NL49020 Jan van Galenstraat 2,061 m, NL49002 Haarlemmerweg 2,463 m, NL49007 Einsteinweg 3,317 m,
 * NL49016 Westerpark 3,482 m (PM10 PM25 SO2). They still publish an LKI, but from fewer substances, so the card
 * does not stand it in for the area's. The two RIVM rungs are inside the 20 km ceiling; a card served from one
 * says "nearest reporting" with its true distance (`fallback`), as Bengaluru's does.
 *
 * POSITIONS are Luchtmeetnet's own (`geometry.coordinates`, [lon, lat]), retrieved 2026-11-06. Distances are
 * computed here from the area centre, never typed (tests/unit/aqi-luchtmeetnet.test.mjs re-derives the ladder
 * from the recorded station details, so a change in the rule or the data fails loudly).
 */
import { distanceM } from './geo.ts';
import type { LocalStation } from './local-types.ts';

/** The centre of the OBOS Canal Ring square (src/data/cities.ts, ward canal-ring; a test pins the equality). */
export const CANAL_RING = { lat: 52.3640, lon: 4.8850 } as const;

/** The four substances the LKI is built from, as Luchtmeetnet spells their formulas. */
export const LKI_COMPONENTS = ['NO2', 'PM10', 'PM25', 'O3'] as const;

export interface NlStationRef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Luchtmeetnet's station type, lower-cased: "municipal", "traffic", "other". */
  kind: string;
  /** The `organisation` the station detail names. */
  owner: string;
}

export const NL_LADDER: readonly NlStationRef[] = [
  { id: 'NL49014', name: 'Amsterdam-Vondelpark', lat: 52.359714, lon: 4.866208, kind: 'municipal', owner: 'GGD Amsterdam' },
  { id: 'NL49012', name: 'Amsterdam-Van Diemenstraat', lat: 52.389983, lon: 4.887811, kind: 'traffic', owner: 'GGD Amsterdam' },
  { id: 'NL49003', name: 'Amsterdam-Nieuwendammerdijk', lat: 52.389314, lon: 4.943822, kind: 'municipal', owner: 'GGD Amsterdam' },
  { id: 'NL10552', name: 'Haarlem-Freddie Oversteegenstraat', lat: 52.37029, lon: 4.651789, kind: 'other', owner: 'RIVM' },
  { id: 'NL10641', name: 'Breukelen-A2', lat: 52.20153, lon: 4.987444, kind: 'traffic', owner: 'RIVM' },
];

/** The ceiling shared with the Bengaluru and Tokyo ladders. */
export const MAX_NL_SERVE_M = 20_000;

/** True when a station's published component list holds every substance the LKI is built from. */
export function measuresLkiBasis(components: readonly string[]): boolean {
  return LKI_COMPONENTS.every((c) => components.includes(c));
}

export function nlStation(ref: NlStationRef, from: { lat: number; lon: number } = CANAL_RING): LocalStation {
  return { id: ref.id, name: ref.name, lat: ref.lat, lon: ref.lon, distance_m: distanceM(from.lat, from.lon, ref.lat, ref.lon), owner: ref.owner, kind: ref.kind, name_en: null };
}

export function nlLadder(from: { lat: number; lon: number } = CANAL_RING): readonly { ref: NlStationRef; station: LocalStation }[] {
  return NL_LADDER
    .map((ref) => ({ ref, station: nlStation(ref, from) }))
    .filter((x) => x.station.distance_m <= MAX_NL_SERVE_M)
    .sort((a, b) => a.station.distance_m - b.station.distance_m);
}
