/**
 * The air-quality contract for a city whose standard is its OWN regulator's, not CPCB's:
 * Amsterdam (Luchtmeetnet's LKI) and Tokyo (the Ministry of the Environment's Soramame,
 * read against Japan's environmental quality standards).
 *
 * WHY A SEPARATE CONTRACT. `types.ts` is CPCB's: its categories, its sub-indices, its
 * IST windows, and the Indian painters switch on them. Widening that union to carry a
 * Dutch index and a Japanese concentration table would have changed the type every
 * Indian painter reads, to describe cities they never see. This file shares nothing
 * with it, so Kolkata's and Bengaluru's payload cannot move.
 *
 * TWO STATES, AND ABSENCE IS ONE OF THEM. A figure is `live` or the card says
 * `not_reporting`. There is no `stale` state with a number in it: a number that is no
 * longer current is not shown (a source that is down, or a last hour that is too old,
 * is "not reporting" and carries at most the TIME of the last hour, never its value).
 *
 * Every value is carried exactly as the source published it. Neither source may be
 * altered before it is shown (Luchtmeetnet's data is CC BY-ND 4.0), so nothing here is
 * rounded, averaged or converted; the one derived field is the distance from the area
 * centre, which is ours and says so.
 */

export const LOCAL_SCHEMA = 1 as const;

export type LocalStandard = 'nl-lki' | 'jp-eqs';

/** Luchtmeetnet's five LKI classes, in its own order (the site's legend: good, moderate, insufficient, bad, verybad). */
export type LkiBand = 'good' | 'moderate' | 'insufficient' | 'bad' | 'very_bad';

export interface LocalStation {
  /** The operator's id: "NL49014" for Luchtmeetnet, the 8-digit 測定局コード for Soramame. */
  id: string;
  /** The station's published name, untranslated. */
  name: string;
  lat: number;
  lon: number;
  /** Geodesic distance from the OBOS area centre, metres. OBOS's own figure; always shown. */
  distance_m: number;
  /** Who runs it, as the source names them: "GGD Amsterdam", "環境省". */
  owner: string;
  /** The monitor's class in plain English where the source publishes one ("traffic", "roadside", "general"); null when it does not. */
  kind: string | null;
  /** A plain-English reading of a non-English name, OBOS's own; null where the published name is already readable. */
  name_en: string | null;
  /** Present (true) only when a nearer monitor on the ladder was not reporting this hour. */
  fallback?: true;
}

/** What the card must print to credit the source, in the words its terms ask for. */
export interface LocalCredit {
  /** The credit line itself, verbatim. */
  line: string;
  /** The edit/processing statement the terms require, or null where the terms ask for none. */
  edit: string | null;
  /** The licence as the source states it. */
  licence: string;
  /** The licence's own URI (CC BY-ND 4.0 §3(a)(1)(C) asks for its text or a URI/hyperlink), and the words of `licence` the card turns into the link. */
  licence_url: string;
  licence_link_text: string;
  /** Where the licence/terms were read. */
  terms_url: string;
  /** The standing caveat printed with the credit: provisional/unvalidated data, and that the source does not endorse this page. */
  note: string;
}

interface Common {
  schema: typeof LOCAL_SCHEMA;
  area_id: string;
  served_at: string;
  credit: LocalCredit;
}

export type NlComponent = 'PM25' | 'PM10' | 'NO2' | 'O3';

export interface NlReading {
  formula: NlComponent;
  /** µg/m³, as published; negatives are legal in the unvalidated feed and are not hidden. */
  value: number;
  /** End of the hour the value is the mean of, UTC ISO. */
  observed_at: string;
}

/**
 * Luchtmeetnet's MODELLED LKI for the area's centre: a calculated field, NOT a measurement, so it has no station and no distance. It
 * rides beside the measured LKI of a live Amsterdam card and is OPTIONAL: a model that could not be read, is not for the current hour or
 * does not validate is simply absent, and the measured card is exactly what it would have been. (Schema stays 1: an optional field, and
 * the validator ignores keys it does not know, so a client older than this field reads the payload as before.)
 */
export interface NlModel {
  /** The model's LKI as published: a decimal, e.g. 3.549999952316284. */
  value: number;
  /** The whole-number LKI of `value` by Luchtmeetnet's own rule (rounded up; lki.ts `lkiClass`), 1-11. This is the number the card prints. */
  lki: number;
  band: LkiBand;
  /**
   * The START of the clock hour the value is for, UTC ISO (`timestamp_measured` of the model row, which Luchtmeetnet's own page treats as
   * the hour it falls in; luchtmeetnet.ts). The value is current for [hour_start, hour_start + 1 h) and for no other time.
   */
  hour_start: string;
}

export type JpPollutant = 'pm25' | 'no2' | 'ox';

export interface JpReading {
  pollutant: JpPollutant;
  /** As the CSV publishes it: µg/m³ for PM2.5, ppm for NO2 and Ox. */
  value: number;
  unit: 'ug_m3' | 'ppm';
  /** The nearest national station that reported this pollutant this hour. */
  station: LocalStation;
}

export type NotReportingReason =
  /** The source could not be read (network, HTTP error, unreadable body). Says nothing about the stations. */
  | 'source_down'
  /** The source was read and no station on the ladder has a current hour with a figure. */
  | 'no_current_hour'
  /** No monitor within the serving distance. */
  | 'no_station';

export type LocalAirPayload = Common & (
  | {
      standard: 'nl-lki';
      state: 'live';
      station: LocalStation;
      /** End of the hour of the LKI value, UTC ISO. */
      observed_at: string;
      /** The same instant as local Amsterdam time with its own offset ("+01:00" or "+02:00"). */
      observed_at_local: string;
      lki: { value: number; band: LkiBand };
      readings: NlReading[];
      /** Luchtmeetnet's modelled LKI at the area centre; absent when it is not available for the current hour. Never a substitute for `lki`. */
      model?: NlModel;
    }
  | {
      standard: 'jp-eqs';
      state: 'live';
      /** The hour the Soramame file is for: the hour ending at this instant, UTC ISO. */
      observed_at: string;
      /** The same instant as local Tokyo time ("+09:00"). */
      observed_at_local: string;
      /** Soramame publishes 速報値 (provisional values); always true, carried so the card cannot forget it. */
      provisional: true;
      readings: JpReading[];
    }
  | {
      standard: LocalStandard;
      state: 'not_reporting';
      reason: NotReportingReason;
      /** The area's nearest monitor, so the card can still say whose it is; null when there is none. */
      station: LocalStation | null;
      /** The time (never the value) of the last hour the source did report, UTC ISO; null when unknown. */
      last_observed_at: string | null;
    }
);

export type LocalAirState = LocalAirPayload['state'];
