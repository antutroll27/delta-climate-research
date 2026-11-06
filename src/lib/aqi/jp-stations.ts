/**
 * THE NATIONAL (国設局) SOURCE STATIONS NEAR MARUNOUCHI, and the one rule that decides what counts as national.
 *
 * WHY ONLY THESE. Soramame's API manual (§2-1, https://soramame.env.go.jp/data/apiManual/2.html) says the
 * copyright of every station's data is held by the Ministry of the Environment, each local government and NIES;
 * that for stations "other than national (国設局)" one must ask the local government or NIES; and that national
 * stations' data follow the Ministry's rules (https://www.env.go.jp/mail.html: PDL 1.0, commercial use allowed,
 * credit + edit statement). Most Tokyo stations are Tokyo-to or ward stations, so they are EXCLUDED here until
 * their owners consent (founder question Q6b). Nothing outside this rule is ever read into a payload.
 *
 * THE RULE IS TWO-SIDED ON PURPOSE: a station is national only when its name starts with 国設 AND its contact
 * (問い合わせ先) is 環境省. Three stations in the 2026-11-06 national file carry the 国設 name but name a prefecture
 * as contact (国設箟岳 宮城県, 国設名古屋大気環境測定所 愛知県, 国設前橋自動車交通環境測定所 群馬県), and one
 * (筑後小郡) names the Ministry without the prefix. Each is treated as not-national: the manual's words are
 * "国設局", and where the two signals disagree OBOS does not guess in its own favour.
 *
 * POSITIONS are the Ministry's own, from the station master the Soramame map draws from
 * (https://soramame.env.go.jp/data/map/kyokuNoudo/2026/11/06/01.csv, retrieved 2026-11-06; columns 緯度,経度,
 * 測定局コード). Distances are computed from them, never typed.
 */
import { distanceM } from './geo.ts';
import type { LocalStation } from './local-types.ts';

/** The centre of the OBOS Marunouchi square (PLAN-amsterdam-tokyo.md, B-phase area defaults). */
export const MARUNOUCHI = { lat: 35.6826, lon: 139.7613 } as const;

export interface JpStationRef {
  id: string;
  name: string;
  /** A plain English reading of the name for the card; OBOS's, not the Ministry's. */
  name_en: string;
  lat: number;
  lon: number;
  kind: 'general' | 'roadside';
}

/** Nearest first from MARUNOUCHI. 国設川崎 stands at 19.2 km, inside MAX_JP_SERVE_M, and is the last rung. */
export const JP_NATIONAL_STATIONS: readonly JpStationRef[] = [
  { id: '13101520', name: '国設霞が関', name_en: 'Kasumigaseki national station', lat: 35.669444, lon: 139.756389, kind: 'roadside' },
  { id: '13104540', name: '国設新宿', name_en: 'Shinjuku national roadside station', lat: 35.681389, lon: 139.718611, kind: 'roadside' },
  { id: '13104010', name: '国設東京（新宿）', name_en: 'Tokyo (Shinjuku) national station', lat: 35.677778, lon: 139.716667, kind: 'general' },
  { id: '14131030', name: '国設川崎', name_en: 'Kawasaki national station', lat: 35.515, lon: 139.712222, kind: 'general' },
];

/** No figure is served from a monitor farther than this (the same 20 km ceiling the Bengaluru ladder uses). */
export const MAX_JP_SERVE_M = 20_000;

export function jpStation(ref: JpStationRef, from: { lat: number; lon: number } = MARUNOUCHI): LocalStation {
  return { id: ref.id, name: ref.name, lat: ref.lat, lon: ref.lon, distance_m: distanceM(from.lat, from.lon, ref.lat, ref.lon), owner: '環境省', kind: ref.kind, name_en: ref.name_en };
}

/** The ladder in serving order: by distance from `from`, those within the ceiling. */
export function jpLadder(from: { lat: number; lon: number } = MARUNOUCHI): readonly { ref: JpStationRef; station: LocalStation }[] {
  return JP_NATIONAL_STATIONS
    .map((ref) => ({ ref, station: jpStation(ref, from) }))
    .filter((x) => x.station.distance_m <= MAX_JP_SERVE_M)
    .sort((a, b) => a.station.distance_m - b.station.distance_m);
}

/** The row fields the rule reads. */
export interface NationalProbe { name: string; contact: string }

/** True only for a Ministry-run national station: 国設 in the name AND 環境省 as the contact. Pure. */
export function isNationalStation(row: NationalProbe): boolean {
  return row.name.startsWith('国設') && row.contact === '環境省';
}
