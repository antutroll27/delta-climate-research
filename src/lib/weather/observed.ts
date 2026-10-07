/**
 * "Now", observed: which airport, is its report fresh, has it been raining, and
 * the reading the heat model receives. Pure — the caller supplies parsed reports
 * and the clock — so every rule here is unit-tested against real METARs.
 *
 * Founder decisions 2026-10-07 (/Volumes/OBOSLab/rain-fix/decisions.md):
 *   · METAR first; met.no stays as the fallback when the report is stale or absent;
 *   · Bengaluru reads the nearer of VOBL and VOBG by ward-centre distance;
 *   · the airport's rain is APPLIED to the ward, with a visible note that
 *     conditions over the ward may differ.
 */
import { METAR_STATIONS, type MetarStation } from '../../data/metar-stations.ts';
import {
  heatIndexC, surfaceWetness, type Ambient, type Convective, type RainEpisode,
} from '../../scripts/climate-engine/heat-map-model.ts';
import {
  cloudFraction, convectiveCloud, rainedRecently, rainingAtStation, thunderAtStation,
  vicinityWeather, type Metar,
} from './metar.ts';

/**
 * A report older than this hands "now" back to met.no. Indian aerodromes report
 * every 30 minutes, so 90 is two missed reports — late enough to ride out one
 * slow upload, early enough that a reader is never shown a morning's rain at
 * tea time. (Decision 2 gave "e.g. older than 90 min".)
 */
export const METAR_STALE_MIN = 90;

/** A report stamped this far ahead of our clock is still accepted (skew). */
const FUTURE_SLACK_MS = 5 * 60_000;
/** An onset or end is placed at the midpoint between reports, at most this far out. */
const MAX_HALF_GAP_MS = 30 * 60_000;
/** A rain group with no preceding report is assumed to have begun this long before. */
const UNSEEN_ONSET_MS = 15 * 60_000;
const MS_PER_KT = 0.514444;

export interface RankedStation { readonly icao: string; readonly km: number }

/** Great-circle distance, km (haversine, mean Earth radius 6371.0088 km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A city's stations, nearest first from a ward centre. Empty: no observed "now". */
export function rankStations(cityId: string, lat: number, lon: number): RankedStation[] {
  return (METAR_STATIONS[cityId] ?? [])
    .map((s) => ({ icao: s.icao, km: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km);
}

const stationInfo = (icao: string): MetarStation | null =>
  Object.values(METAR_STATIONS).flat().find((s) => s.icao === icao) ?? null;

const ms = (m: Metar) => Date.parse(m.time);

/**
 * Rain episodes from a station's reports (any order). METAR says only what is
 * happening AT each report, so an onset is placed at the MIDPOINT between the
 * last dry report and the first wet one — the unbiased estimate when the true
 * onset is equally likely anywhere in the gap — and an end likewise. A rain run
 * still going at the newest report is open (`endMs: null`).
 *
 * A recent-weather group (RERA, RETSRA…) on a dry report after a dry report says
 * rain fell in between and has stopped: a 15-minute shower ending at the midpoint
 * is placed there. That is a stated assumption; METAR gives no more.
 */
export function rainEpisodes(reports: readonly Metar[]): RainEpisode[] {
  const r = [...reports].filter((m) => !m.nil).sort((a, b) => ms(a) - ms(b));
  const out: RainEpisode[] = [];
  const half = (a: number, b: number) => Math.min((b - a) / 2, MAX_HALF_GAP_MS);
  for (let i = 0; i < r.length; i++) {
    const wet = rainingAtStation(r[i]);
    const prevWet = i > 0 && rainingAtStation(r[i - 1]);
    if (wet && !prevWet) {
      const t = ms(r[i]);
      const startMs = i > 0 ? t - half(ms(r[i - 1]), t) : t - UNSEEN_ONSET_MS;
      let j = i;
      while (j + 1 < r.length && rainingAtStation(r[j + 1])) j++;
      const last = ms(r[j]);
      const endMs = j + 1 < r.length ? last + half(last, ms(r[j + 1])) : null;
      out.push({ startMs, endMs });
      i = j;
    } else if (!wet && !prevWet && rainedRecently(r[i])) {
      const t = ms(r[i]);
      const prev = i > 0 ? ms(r[i - 1]) : t - 2 * UNSEEN_ONSET_MS;
      const endMs = t - half(prev, t);
      out.push({ startMs: Math.max(prev, endMs - UNSEEN_ONSET_MS), endMs });
    }
  }
  return out;
}

export interface ObservedNow {
  readonly station: MetarStation;
  readonly km: number;
  readonly latest: Metar;
  /** minutes since the observation, at the `nowMs` it was assembled for */
  readonly ageMin: number;
  readonly raining: boolean;
  readonly thunder: boolean;
  readonly convective: Convective;
  /** VC groups as written: VCSH, VCTS… Said on screen, never applied. */
  readonly vicinity: readonly string[];
  readonly episodes: readonly RainEpisode[];
  /** the station's cloud fraction 0–1, or null when it reported none */
  readonly cloud: number | null;
  readonly ambient: Ambient;
}

/** Values met.no can lend a report that is silent on them. Never invented here. */
export interface Fallback { readonly cloudPct?: number | null; readonly rh?: number | null; readonly windMs?: number | null }

/** RH from air and dew point, Magnus (the same 17.67 / 243.5 °C as sky.ts and _physics.py). */
export function rhFromDewpoint(t: number, td: number): number {
  const g = (x: number) => (17.67 * x) / (x + 243.5);
  return Math.min(100, 100 * Math.exp(g(td) - g(t)));
}

/**
 * The nearest station with a fresh, usable report, assembled into the reading
 * the model runs on — or null, which hands "now" to met.no.
 */
export function observedNow(
  reportsByStation: Readonly<Record<string, readonly Metar[]>>,
  ranked: readonly RankedStation[],
  nowMs: number,
  fallback: Fallback = {},
): ObservedNow | null {
  for (const { icao, km } of ranked) {
    const station = stationInfo(icao);
    if (!station) continue;
    const reports = (reportsByStation[icao] ?? [])
      .filter((m) => !m.nil && m.station === icao && ms(m) <= nowMs + FUTURE_SLACK_MS)
      .sort((a, b) => ms(a) - ms(b));
    const latest = reports.at(-1);
    if (!latest) continue;
    const ageMin = Math.max(0, (nowMs - ms(latest)) / 60_000);
    if (ageMin > METAR_STALE_MIN) continue;
    if (latest.tempC === null) continue;

    const rh = latest.dewC !== null ? rhFromDewpoint(latest.tempC, latest.dewC) : fallback.rh ?? null;
    const wind = latest.wind ? latest.wind.speedKt * MS_PER_KT : fallback.windMs ?? null;
    if (rh === null || wind === null) continue;

    const cloud = cloudFraction(latest);
    const thunder = thunderAtStation(latest);
    const convective: Convective = thunder ? 'thunder' : convectiveCloud(latest) ? 'cumuliform' : 'none';
    const episodes = rainEpisodes(reports);
    const ambient: Ambient = {
      tAir: latest.tempC, rh, wind,
      cloud: cloud !== null ? cloud * 100 : fallback.cloudPct ?? 0,
      windFrom: latest.wind?.dirDeg ?? undefined,
      feels: heatIndexC(latest.tempC, rh),
      validAt: latest.time,
      observed: { stationCloud: cloud !== null, convective, wet: surfaceWetness(episodes, nowMs) },
    };
    return {
      station, km, latest, ageMin, raining: rainingAtStation(latest), thunder, convective,
      vicinity: vicinityWeather(latest).map((w) => w.raw), episodes, cloud, ambient,
    };
  }
  return null;
}

/**
 * Wetness from a station's history when its newest report is STALE — so a feed
 * that goes quiet in the rain decays the surface instead of snapping it dry.
 *
 * WHY. Without this, falling back to met.no dropped `observed.wet`: a frozen VECC
 * feed read a wet 31 °C at 07:29 and 46.7 °C at 07:31 — the original defect,
 * back in one step. Rain still falling at the newest report is taken to persist
 * exactly as long as the fresh path trusts that report (METAR_STALE_MIN) and to
 * stop there; from that moment the surface re-warms with τ_dry. Continuous by
 * construction: at the stale limit both paths give the same wetness.
 */
export function carriedWetness(
  reportsByStation: Readonly<Record<string, readonly Metar[]>>,
  ranked: readonly RankedStation[],
  nowMs: number,
): number {
  for (const { icao } of ranked) {
    const reports = (reportsByStation[icao] ?? [])
      .filter((m) => !m.nil && m.station === icao && ms(m) <= nowMs + FUTURE_SLACK_MS);
    if (!reports.length) continue;
    const newest = Math.max(...reports.map(ms));
    const trustedUntil = newest + METAR_STALE_MIN * 60_000;
    const episodes = rainEpisodes(reports).map((e) => ({
      startMs: e.startMs, endMs: e.endMs ?? Math.min(nowMs, trustedUntil),
    }));
    return surfaceWetness(episodes, nowMs);
  }
  return 0;
}

/**
 * met.no's reading as the fallback "now", carrying any wetness the airport's
 * history still implies. Cloud stays met.no's MODEL cloud (calibrated formula);
 * only the wetting term is carried, because it is the one with memory.
 */
export function fallbackAmbient(
  metno: Ambient | null,
  reportsByStation: Readonly<Record<string, readonly Metar[]>>,
  ranked: readonly RankedStation[],
  nowMs: number,
): Ambient | null {
  if (!metno) return null;
  const wet = carriedWetness(reportsByStation, ranked, nowMs);
  return wet > 0 ? { ...metno, observed: { stationCloud: false, convective: 'none', wet } } : metno;
}

export interface WeatherWords {
  /** a single pictograph, decorative on its own */
  readonly icon: string;
  /** its text alternative, for `aria-label` / `title` */
  readonly iconLabel: string;
  /** sentence-case condition, e.g. "Light rain", "Mostly cloudy · showers nearby" */
  readonly text: string;
  /** what the model is doing about it, or '' */
  readonly effect: string;
}

const INTENSITY = { light: 'Light', moderate: 'Moderate', heavy: 'Heavy' } as const;

/** Words for the weather line. Every claim maps to a group in the report. */
export function describeWeather(o: ObservedNow): WeatherWords {
  const m = o.latest;
  const wetGroup = m.weather.find((w) => !w.vicinity && w.phenomena.some((p) => p === 'RA' || p === 'DZ'));
  const nearby = o.vicinity.length
    ? ` · ${o.vicinity.some((v) => v.includes('TS')) ? 'thunderstorm' : 'showers'} nearby`
    : '';
  if (wetGroup) {
    const kind = wetGroup.descriptor === 'TS' ? 'thunderstorm with rain'
      : wetGroup.descriptor === 'SH' ? 'rain showers'
      : wetGroup.phenomena.includes('RA') ? 'rain' : 'drizzle';
    return {
      icon: o.thunder ? '⛈' : '🌧', iconLabel: o.thunder ? 'Thunderstorm' : 'Rain',
      text: `${INTENSITY[wetGroup.intensity]} ${kind}${nearby}`,
      effect: 'surfaces cooling',
    };
  }
  const dryingOut = o.ambient.observed && o.ambient.observed.wet > 0.05 ? 'surfaces drying' : '';
  if (o.thunder) return { icon: '⛈', iconLabel: 'Thunderstorm', text: `Thunderstorm${nearby}`, effect: dryingOut };
  const c = o.cloud;
  const sky = c === null ? { icon: '🌡', label: 'Sky not reported', text: 'Sky not reported' }
    : c === 0 ? { icon: '☀', label: 'Clear', text: 'Clear' }
    : c <= 0.19 ? { icon: '🌤', label: 'Mostly clear', text: 'A few clouds' }
    : c <= 0.44 ? { icon: '⛅', label: 'Partly cloudy', text: 'Partly cloudy' }
    : c < 1 ? { icon: '🌥', label: 'Mostly cloudy', text: 'Mostly cloudy' }
    : { icon: '☁', label: 'Overcast', text: 'Overcast' };
  const cb = o.convective === 'cumuliform' ? ', storm clouds' : '';
  return { icon: sky.icon, iconLabel: sky.label, text: `${sky.text}${cb}${nearby}`, effect: dryingOut };
}
