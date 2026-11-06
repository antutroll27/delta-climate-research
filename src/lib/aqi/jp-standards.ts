/**
 * JAPAN'S ENVIRONMENTAL QUALITY STANDARDS (環境基準) for the three pollutants the Tokyo card shows.
 *
 * JAPAN HAS NO AIR-QUALITY INDEX, and OBOS does not make one up. The Ministry of the Environment sets
 * concentration standards, and the card shows each measured concentration beside the standard it is
 * judged against, with the standard's own averaging basis. The text below is quoted VERBATIM from the
 * Ministry's page 「大気汚染に係る環境基準」 (https://www.env.go.jp/kijun/taiki.html, read 2026-11-06;
 * saved in /Volumes/OBOSLab/research/aqi-new-cities/moe/kijun_taiki.html). The gloss is OBOS's.
 *
 * WHAT THE CARD MAY AND MAY NOT SAY. Every standard here is judged on an AVERAGE (a daily mean, or an
 * 8-hour value), never on one hour. The Soramame feed carries single provisional hours (速報値). So the
 * card prints the latest hour as "the latest hour", draws the standard as a reference mark, and says in
 * words that the standard is judged on its own basis. It never says a place "meets" or "exceeds" a
 * standard, and it never turns a single hour into a pass or a fail.
 *
 * THE OX STANDARD CHANGED ON 2026-01-30 (告示 R8.1.30): it is now an 8-hour value of 0.07 ppm or less
 * AND an annual mean of the daily maximum 8-hour value of 0.04 ppm or less. The older rule (hourly value
 * 0.06 ppm or less) is not the current one and is not used. This is why the page was read, not recalled.
 */
import type { JpPollutant } from './local-types.ts';

export interface JpStandard {
  pollutant: JpPollutant;
  name_ja: string;
  name_en: string;
  unit: 'ug_m3' | 'ppm';
  /** The condition, verbatim from the Ministry's page. */
  text_ja: string;
  /** The Ministry's notice number/date that set it, as printed after the condition. */
  notice: string;
  /** OBOS's English reading of `text_ja`. */
  gloss_en: string;
  /** The averaging basis the SHORT-TERM part of the standard is judged on. */
  basis: 'daily_mean' | 'eight_hour';
  /** Reference marks on the short-term limit, in `unit`: one mark, or the two ends of NO2's zone. */
  marks: readonly number[];
  /** The short-term part, in words, for the card's line under the bar. */
  short_term_en: string;
}

export const JP_STANDARDS: Readonly<Record<JpPollutant, JpStandard>> = {
  pm25: {
    pollutant: 'pm25', name_ja: '微小粒子状物質（PM2.5）', name_en: 'PM2.5', unit: 'ug_m3',
    text_ja: '１年平均値が15μg/m3以下であり、かつ、１日平均値が35μg/m3以下であること。',
    notice: '(H21.9.9告示)',
    gloss_en: 'The annual mean must be 15 µg/m³ or less, and the daily mean 35 µg/m³ or less.',
    basis: 'daily_mean', marks: [35],
    short_term_en: 'Daily mean 35 µg/m³ or less (annual mean 15 µg/m³ or less)',
  },
  no2: {
    pollutant: 'no2', name_ja: '二酸化窒素（NO₂）', name_en: 'NO₂', unit: 'ppm',
    text_ja: '１時間値の１日平均値が0.04ppmから0.06ppmまでのゾーン内又はそれ以下であること。',
    notice: '(53. 7.11告示)',
    gloss_en: 'The daily mean of the hourly values must lie within the zone 0.04 to 0.06 ppm, or below it.',
    basis: 'daily_mean', marks: [0.04, 0.06],
    short_term_en: 'Daily mean of hourly values within 0.04 to 0.06 ppm, or below',
  },
  ox: {
    pollutant: 'ox', name_ja: '光化学オキシダント（OX）', name_en: 'Photochemical oxidants (Ox)', unit: 'ppm',
    text_ja: 'オゾンとして、８時間値が0.07ppm以下であり、かつ、日最高８時間値の１年平均値が0.04ppm以下であること。',
    notice: '（R8.1.30告示）',
    gloss_en: 'As ozone, the 8-hour value must be 0.07 ppm or less, and the annual mean of the daily maximum 8-hour value 0.04 ppm or less.',
    basis: 'eight_hour', marks: [0.07],
    short_term_en: '8-hour value 0.07 ppm or less (annual mean of the daily maximum 8-hour value 0.04 ppm or less)',
  },
};

export const JP_POLLUTANTS: readonly JpPollutant[] = ['pm25', 'no2', 'ox'];

/** The sentence that keeps a single hour from being read as a verdict. */
export const JP_BASIS_NOTE = 'Each standard is judged on an average (a daily mean, or an 8-hour value), not on one hour. '
  + 'The value shown is the latest single provisional hour, drawn against the standard for orientation only.';
