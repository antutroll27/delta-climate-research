// src/scripts/climate-engine/v2/weather-panel.ts — OBOS v2 spec §4.5, H22 [H]. Pure: words from parsed groups only.
import { rainingAtStation, type Metar, type WeatherGroup } from '../../../lib/weather/metar.ts';

export interface DecodeRow { readonly code: string; readonly text: string }
export interface RainCell { readonly time: string; readonly tempC: number | null; readonly wet: boolean }

/**
 * WHERE THE WEATHER CAME FROM, and so what the card may call it (founder, 17 Oct; spec correction, A-S3 audit F1).
 * The kind chip and the solid/outlined mark follow the ACTUAL source, never the card's own wording:
 *   - `observed`: a fresh airport METAR. The app's `observed` is non-null only inside METAR_STALE_MIN, so "fresh" is already decided there.
 *   - `forecast`: Met Norway stands in (no usable airport report): MODELLED/FORECAST, outlined.
 *   - `none`: no reading at all: the card claims nothing.
 */
export type WeatherSourceKind = 'observed' | 'forecast' | 'none';
export interface WeatherSource { readonly kind: WeatherSourceKind; readonly chip: 'observed' | 'forecast' | 'no reading'; readonly solid: boolean }
export function weatherSource(hasObserved: boolean, hasReading: boolean): WeatherSource {
  if (hasObserved) return { kind: 'observed', chip: 'observed', solid: true };
  if (hasReading) return { kind: 'forecast', chip: 'forecast', solid: false };
  return { kind: 'none', chip: 'no reading', solid: false };
}

/** The app's istLike (heat-map-app.ts:2991–2992): the ward's clock, "IST" for India. */
export function wardTime(iso: string, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  return f.format(new Date(Date.parse(iso))).replace('GMT+5:30', 'IST');
}

const COVER: Readonly<Record<string, string>> = { FEW: 'few cloud', SCT: 'scattered cloud', BKN: 'broken cloud', OVC: 'overcast', VV: 'vertical visibility', '///': 'cloud, amount unmeasured' };
const PHEN: Readonly<Record<string, string>> = { RA: 'rain', DZ: 'drizzle', TS: 'thunderstorm', SH: 'showers', HZ: 'haze', BR: 'mist', FG: 'fog', FU: 'smoke', DU: 'dust', SA: 'sand', SQ: 'squalls', GR: 'hail', SN: 'snow' };
const INT = { light: 'light ', moderate: '', heavy: 'heavy ' } as const;
const n = (x: number): string => x.toLocaleString('en-GB');
const tok = (raw: string, re: RegExp): string | null => re.exec(raw)?.[0] ?? null;

function groupWords(g: WeatherGroup): string {
  const what = [g.descriptor === 'TS' ? 'thunderstorm with' : g.descriptor === 'SH' ? 'showers of' : null, ...g.phenomena.map((p) => PHEN[p] ?? p)].filter(Boolean).join(' ');
  return `${INT[g.intensity]}${what}${g.vicinity ? ' in the vicinity (8–16 km)' : ''}`;
}

export function decodeRows(m: Metar, tz: string): readonly DecodeRow[] {
  const rows: DecodeRow[] = [];
  const t = tok(m.raw, /\b\d{6}Z\b/);
  if (t) rows.push({ code: t, text: `observed ${m.time.slice(11, 16)} UTC = ${wardTime(m.time, tz)}` });
  if (m.wind) {
    const code = tok(m.raw, /\b(?:VRB|\d{3})\d{2,3}(?:G\d{2,3})?(?:KT|MPS)\b/) ?? '';
    const dir = m.wind.dirDeg === null ? 'variable direction' : `${String(m.wind.dirDeg).padStart(3, '0')}°`;
    rows.push({ code, text: `wind from ${dir} at ${m.wind.speedKt} knots${m.wind.gustKt ? `, gusting ${m.wind.gustKt}` : ''}` });
  }
  if (m.cavok) rows.push({ code: 'CAVOK', text: 'visibility 10 km or more, no cloud that matters' });
  else if (m.visibilityM !== null) rows.push({ code: tok(m.raw, /(?<=\s)\d{4}(?=\s)/) ?? '', text: `visibility ${n(m.visibilityM)} m` });
  for (const g of m.weather) rows.push({ code: g.raw, text: groupWords(g) });
  for (const c of m.clouds) {
    const code = c.baseFt === null ? `${c.cover}///` : `${c.cover}${String(Math.round(c.baseFt / 100)).padStart(3, '0')}${c.convective ?? ''}`;
    rows.push({ code, text: `${COVER[c.cover] ?? c.cover}${c.baseFt === null ? '' : ` at ${n(c.baseFt)} ft`}${c.convective === 'CB' ? ', cumulonimbus' : c.convective === 'TCU' ? ', towering cumulus' : ''}` });
  }
  if (m.tempC !== null && m.dewC !== null) rows.push({ code: tok(m.raw, /\bM?\d{2}\/M?\d{2}\b/) ?? '', text: `air ${m.tempC} °C, dew point ${m.dewC} °C` });
  if (m.qnhHpa !== null) rows.push({ code: tok(m.raw, /\bQ\d{4}\b/) ?? '', text: `sea-level pressure ${m.qnhHpa} hPa` });
  for (const u of m.unparsed) rows.push({ code: u, text: 'not recognised, dropped' });
  return rows;
}

export function rainMemory(reports: readonly Metar[], tz: string): { cells: RainCell[]; since: string | null; wetCount: number } {
  const live = reports.filter((m) => !m.nil);
  const cells = live.map((m) => ({ time: wardTime(m.time, tz), tempC: m.tempC, wet: rainingAtStation(m) }));
  return { cells, since: cells[0]?.time ?? null, wetCount: cells.filter((c) => c.wet).length };
}
