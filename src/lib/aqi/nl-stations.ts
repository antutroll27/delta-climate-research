/**
 * THE LUCHTMEETNET STATIONS NEAREST AMSTERDAM'S STREAMED AREAS, and the rule that picks the ones the LKI card may use.
 *
 * THE RULE. The LKI is "the substance with the highest index number decides" over NO2, PM10, PM2.5 and O3, and
 * "Als alle stoffen hetzelfde indexgetal hebben dan wordt de totale index één punt hoger" (if all substances have the
 * same index number the total goes up one point) (luchtmeetnet.nl, "Luchtkwaliteitsindex (LKI)"). A station that does
 * not measure all four would publish an LKI from fewer substances: normally as high or lower than the full one, though
 * not strictly always, because of the tie rule (a station whose few substances all tie gets the extra point, and one
 * with a fourth, lower substance would not). Its LKI is a different quantity, not a lower bound. So a station serves the card only
 * if its published component list (`/open_api/stations/{id}` → `components`) holds all four.
 *
 * THE SURVEY (2026-11-09). All 30 Luchtmeetnet stations within 30 km of 52.37 N, 4.90 E were read with their published
 * components (`/open_api/stations/{id}`; recorded in tests/fixtures/aqi/nl/stations-survey-2026-11-09.json; the survey script and the
 * area centres it used are kept in /Volumes/OBOSLab/research/ams-area-air). Seven of the 30 measure all four substances:
 *   NL49014 Amsterdam-Vondelpark        Municipal  GGD Amsterdam  NO2 PM10 PM25 O3 (+CO FN NO BCWB)
 *   NL49012 Amsterdam-Van Diemenstraat  Traffic    GGD Amsterdam  NO2 PM10 PM25 O3 (+CO FN NO BCWB)
 *   NL49003 Amsterdam-Nieuwendammerdijk Municipal  GGD Amsterdam  NO2 PM10 PM25 O3 (+FN NO BCWB)
 *   NL49680 Almere-Boomgaardweg         Municipal  GGD Amsterdam  NO2 PM10 PM25 O3 (+NO PS)
 *   NL10552 Haarlem-Freddie Oversteegenstraat  RIVM  Other     NO2 PM10 PM25 O3 (+NO)
 *   NL10444 De Zilk-Vogelaarsdreef      RIVM  Regional  NO2 PM10 PM25 O3 (+FN NH3 NO SO2 BCWB)
 *   NL10641 Breukelen-A2                RIVM  Traffic   NO2 PM10 PM25 O3 (+FN NO BCWB)   MEASURES ALL FOUR, DELIBERATELY NOT ON THE LADDER
 * Breukelen-A2 is a traffic station beside the A2 motorway: a poor stand-in for a neighbourhood's air, so it is excluded by
 * decision (founder, 2026-11-09), not by the rule above. The other six are the ladder. De Zilk is a regional-background station
 * 17.7 km from the nearest area centre (B5), so it is inside the 20 km ceiling for three west-side areas (B3, B4, B5) and on their
 * ladder as a far fallback; it is nobody's nearest. The 2026-11-06 national list (all 103 stations, same fixture folder) holds no
 * other four-substance station within 20 km of any area centre (the next, Cabauw-Wielsekade, is 35.0 km from the nearest).
 *
 * EACH AREA HAS ITS OWN LADDER: the stations within 20 km of THAT AREA'S centre (src/data/sheets/amsterdam.ts, `centre`), nearest first,
 * with the true distance from that centre. A card served from a rung other than the nearest says "nearest reporting" (`fallback`),
 * as Bengaluru's does. Nearer stations that lack a substance still publish an LKI, but from fewer substances, so the card does not
 * stand it in for the area's (Canal Ring: NL49017 Stadhouderskade, NL49019 Oude Schans, NL49020 Jan van Galenstraat, NL49002
 * Haarlemmerweg, NL49007 Einsteinweg, NL49016 Westerpark; no O3).
 *
 * POSITIONS are Luchtmeetnet's own (`geometry.coordinates`, [lon, lat]), retrieved 2026-11-09 (the six Amsterdam-region positions are
 * unchanged from 2026-11-06). Distances are computed here from the area centre, never typed (tests/unit/aqi-luchtmeetnet.test.mjs
 * re-derives every area's ladder from the recorded station details, so a change in the rule or the data fails loudly).
 */
import { AMSTERDAM_SHEETS } from '../../data/sheets/amsterdam.ts';
import { distanceM } from './geo.ts';
import type { LocalStation } from './local-types.ts';

/** The centre of the OBOS Canal Ring square (src/data/cities.ts, ward canal-ring; a test pins the equality, also to the sheet record's). */
export const CANAL_RING = { lat: 52.3640, lon: 4.8850 } as const;

/**
 * The centre of a streamed Amsterdam area by its area id (`ams-f4`, or `canal-ring`): the sheet record's own `centre`, read, not retyped,
 * so a regenerated sheet table moves the card with it. Null for an id that is not a streamed area. Server-side (the browser never needs a centre).
 */
export function amsterdamCentre(areaId: string): { readonly lat: number; readonly lon: number } | null {
  return AMSTERDAM_SHEETS.find((s) => s.id === areaId)?.centre ?? null;
}

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
  { id: 'NL49680', name: 'Almere-Boomgaardweg', lat: 52.373572, lon: 5.239257, kind: 'municipal', owner: 'GGD Amsterdam' },
  { id: 'NL10552', name: 'Haarlem-Freddie Oversteegenstraat', lat: 52.37029, lon: 4.651789, kind: 'other', owner: 'RIVM' },
  { id: 'NL10444', name: 'De Zilk-Vogelaarsdreef', lat: 52.296556, lon: 4.510817, kind: 'regional', owner: 'RIVM' },
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
