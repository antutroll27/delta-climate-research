/**
 * METAR, parsed — pure, total, and suspicious of its input.
 *
 * WHY THIS EXISTS. OBOS's "now" used to be Met Norway's FORECAST for the ward's
 * hour. On 2026-10-07 at 11:30 IST that forecast said fair, 13 % cloud, no rain,
 * while Kolkata airport was reporting `-RA SCT018 FEW025CB BKN100 31/23`, and the
 * page showed a 46.7 °C surface in the rain. An airport METAR is an OBSERVATION,
 * made every 30 minutes by a trained observer or an AWOS, so "now" reads it first
 * (founder decision, /Volumes/OBOSLab/rain-fix/decisions.md, 2026-10-07).
 *
 * WHAT "ROBUST" MEANS HERE, measured on 36 h of real Indian reports
 * (tests/fixtures/metar): an observer writes `TEMP` for `TEMPO`, the live feed
 * served `Q101 5` for `Q1015`, `NOSIG` arrives as `N OSIG`. So:
 *   · nothing throws — an unrecognised token lands in `unparsed`, never in a field;
 *   · present weather and cloud are read ONLY before the temperature group, which
 *     always precedes the trend. That is what stops `TEMPO 2000 RA` (a forecast)
 *     from becoming rain (an observation) — including when TEMPO is misspelt;
 *   · a report with no station or no time is refused (null), because an
 *     observation that cannot be placed and dated is not one.
 *
 * Format: WMO No. 306 FM 15 (METAR) / FM 16 (SPECI) and ICAO Annex 3 App. 3, with
 * the US statute-mile and CLR forms tolerated. Not a full decoder: remarks, runway
 * state, wind shear and trends are skipped because nothing downstream reads them.
 */

export type Cover = 'FEW' | 'SCT' | 'BKN' | 'OVC';

/**
 * Cloud fraction for each METAR cover word: the MIDPOINT of its okta band.
 * FEW 1–2 oktas → 1.5/8, SCT 3–4 → 3.5/8, BKN 5–7 → 6/8, OVC 8/8 (ICAO Annex 3
 * App. 3 §4.5.4.3). The founder's brief rounded these to 0.19/0.44/0.75/1.
 */
export const COVER_FRACTION: Readonly<Record<Cover, number>> = Object.freeze({
  FEW: 1.5 / 8, SCT: 3.5 / 8, BKN: 6 / 8, OVC: 1,
});

export interface CloudLayer {
  readonly cover: Cover | 'VV';
  /** height of base, feet above the aerodrome; null when reported as `///` */
  readonly baseFt: number | null;
  /** CB (cumulonimbus) or TCU (towering cumulus), the two types METAR names */
  readonly convective: 'CB' | 'TCU' | null;
}

export interface WeatherGroup {
  readonly raw: string;
  /** `-` light, none moderate, `+` heavy. VC groups are 'moderate' and `vicinity`. */
  readonly intensity: 'light' | 'moderate' | 'heavy';
  /** VC: "in the vicinity", 8–16 km from the aerodrome — NOT at the station. */
  readonly vicinity: boolean;
  readonly descriptor: 'MI' | 'PR' | 'BC' | 'DR' | 'BL' | 'SH' | 'TS' | 'FZ' | null;
  /** two-letter phenomena in order: RA, DZ, SN, BR, HZ, … */
  readonly phenomena: readonly string[];
}

export interface Wind {
  /** degrees true; null when variable (VRB) or missing */
  readonly dirDeg: number | null;
  readonly speedKt: number;
  readonly gustKt: number | null;
}

export interface Metar {
  readonly raw: string;
  readonly type: 'METAR' | 'SPECI';
  readonly station: string;
  /** observation time, ISO-8601 UTC, seconds precision (`2026-10-07T06:00:00Z`) */
  readonly time: string;
  readonly auto: boolean;
  readonly corrected: boolean;
  /** `NIL`: the report is missing. Every field below is empty. */
  readonly nil: boolean;
  readonly wind: Wind | null;
  /** prevailing visibility, metres; 10000 for 9999 and CAVOK */
  readonly visibilityM: number | null;
  readonly cavok: boolean;
  /** NSC / NCD / SKC / CLR, or CAVOK: the observer says no cloud that matters */
  readonly skyClear: boolean;
  readonly weather: readonly WeatherGroup[];
  /** RE groups: weather in the last hour (or since the last report), not now */
  readonly recent: readonly WeatherGroup[];
  readonly clouds: readonly CloudLayer[];
  readonly tempC: number | null;
  readonly dewC: number | null;
  readonly qnhHpa: number | null;
  /** body tokens no rule recognised — kept so a reader can see what was skipped */
  readonly unparsed: readonly string[];
}

const KT_PER_MPS = 1 / 0.514444;
const M_PER_SM = 1609.344;

const DESCRIPTORS = ['MI', 'PR', 'BC', 'DR', 'BL', 'SH', 'TS', 'FZ'] as const;
const PHENOMENA = new Set(['DZ', 'RA', 'SN', 'SG', 'IC', 'PL', 'GR', 'GS', 'UP',
  'BR', 'FG', 'FU', 'VA', 'DU', 'SA', 'HZ', 'PY', 'PO', 'SQ', 'FC', 'SS', 'DS']);

/** Words that begin the trend or remarks: everything after them is not an observation. */
const TREND = /^(NOSIG|TEMPO|TEMP|BECMG|RMK|TREND|FM\d{4,6}|TL\d{4}|AT\d{4})$/;

function weatherGroup(tok: string): WeatherGroup | null {
  const m = /^(-|\+|VC)?([A-Z]{2,})$/.exec(tok);
  if (!m) return null;
  let rest = m[2];
  let descriptor: WeatherGroup['descriptor'] = null;
  for (const d of DESCRIPTORS) if (rest.startsWith(d)) { descriptor = d; rest = rest.slice(2); break; }
  if (rest.length % 2 !== 0) return null;
  const phenomena: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const p = rest.slice(i, i + 2);
    if (!PHENOMENA.has(p)) return null;
    phenomena.push(p);
  }
  // a descriptor alone is meaningful only for TS (thunder heard, no precipitation)
  // and SH in the vicinity (VCSH); anything else is an unknown word, not weather
  if (phenomena.length === 0 && descriptor !== 'TS' && !(descriptor === 'SH' && m[1] === 'VC')) return null;
  return {
    raw: tok,
    intensity: m[1] === '-' ? 'light' : m[1] === '+' ? 'heavy' : 'moderate',
    vicinity: m[1] === 'VC',
    descriptor,
    phenomena,
  };
}

const signedC = (s: string): number => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));

/**
 * Resolve DDHHMM against a reference instant: the most recent such moment no
 * more than a day after `refMs`. METAR carries no month or year.
 */
function resolveTime(dd: number, hh: number, mm: number, refMs: number): number | null {
  if (dd < 1 || dd > 31 || hh > 23 || mm > 59) return null;
  const ref = new Date(refMs);
  for (let back = 0; back <= 2; back++) {
    const y = ref.getUTCFullYear(), mo = ref.getUTCMonth() - back;
    const t = Date.UTC(y, mo, dd, hh, mm);
    // Date.UTC rolls an impossible day (31 Sep) into the next month; refuse that
    if (new Date(t).getUTCDate() !== dd) continue;
    if (t <= refMs + 86_400_000) return t;
  }
  return null;
}

/**
 * Parse one METAR or SPECI. `refMs` is any instant within a few days after the
 * observation (the fetch time); it supplies the month and year the report omits.
 * Returns null only when the report cannot be placed (no station) or dated.
 */
export function parseMetar(raw: string, refMs: number): Metar | null {
  if (typeof raw !== 'string') return null;
  const toks = raw.replace(/=+\s*$/, '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  let type: Metar['type'] = 'METAR';
  if (toks[i] === 'METAR' || toks[i] === 'SPECI') { type = toks[i] as Metar['type']; i++; }
  let auto = false, corrected = false;
  while (toks[i] === 'COR' || toks[i] === 'AUTO') { if (toks[i] === 'COR') corrected = true; else auto = true; i++; }
  const station = toks[i];
  if (!station || !/^[A-Z][A-Z0-9]{3}$/.test(station)) return null;
  i++;
  const tm = /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[i] ?? '');
  if (!tm) return null;
  const t = resolveTime(Number(tm[1]), Number(tm[2]), Number(tm[3]), refMs);
  if (t === null) return null;
  i++;

  let nil = false, cavok = false, skyClear = false;
  let wind: Wind | null = null, visibilityM: number | null = null;
  let tempC: number | null = null, dewC: number | null = null, qnhHpa: number | null = null;
  const weather: WeatherGroup[] = [], recent: WeatherGroup[] = [], clouds: CloudLayer[] = [], unparsed: string[] = [];
  let afterTemp = false;

  for (; i < toks.length; i++) {
    const s = toks[i];
    if (TREND.test(s)) break;
    if (s === 'NIL') { nil = true; break; }
    if (s === 'AUTO') { auto = true; continue; }
    if (s === 'COR') { corrected = true; continue; }

    let m: RegExpExecArray | null;
    if (!afterTemp) {
      if (!wind && (m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(s))) {
        const k = m[4] === 'MPS' ? KT_PER_MPS : m[4] === 'KMH' ? 1 / 1.852 : 1;
        wind = {
          dirDeg: m[1] === 'VRB' ? null : Number(m[1]),
          speedKt: Math.round(Number(m[2]) * k),
          gustKt: m[3] ? Math.round(Number(m[3]) * k) : null,
        };
        continue;
      }
      if (/^\d{3}V\d{3}$/.test(s)) continue;                       // wind variation sector
      if (/^\/{3,}(KT|MPS)?$/.test(s)) continue;                   // missing group
      if (s === 'CAVOK') { cavok = true; skyClear = true; visibilityM = 10000; continue; }
      if (visibilityM === null && (m = /^(\d{4})(NDV)?$/.exec(s))) {
        visibilityM = m[1] === '9999' ? 10000 : Number(m[1]); continue;
      }
      if (/^\d{4}(N|NE|E|SE|S|SW|W|NW)$/.test(s)) continue;         // directional minimum
      if (visibilityM === null && (m = /^(P|M)?(\d+)(?:\/(\d+))?SM$/.exec(s))) {
        const v = m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2]);
        visibilityM = Math.round(v * M_PER_SM); continue;
      }
      if (/^R\d{0,2}[LCR]?\/./.test(s) || /^R\/\d/.test(s)) continue; // runway visual range
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(s))) {
        clouds.push({
          cover: m[1] as Cover,
          baseFt: m[2] === '///' ? null : Number(m[2]) * 100,
          convective: m[3] === 'CB' || m[3] === 'TCU' ? m[3] : null,
        });
        continue;
      }
      if ((m = /^VV(\d{3}|\/\/\/)$/.exec(s))) {
        clouds.push({ cover: 'VV', baseFt: m[1] === '///' ? null : Number(m[1]) * 100, convective: null });
        continue;
      }
      if (s === 'NSC' || s === 'NCD' || s === 'SKC' || s === 'CLR') { skyClear = true; continue; }
      if ((m = /^(M?\d{2})\/(M?\d{2}|\/\/|XX)?$/.exec(s))) {
        tempC = signedC(m[1]);
        dewC = m[2] && /\d/.test(m[2]) ? signedC(m[2]) : null;
        afterTemp = true;
        continue;
      }
      const wx = weatherGroup(s);
      if (wx) { weather.push(wx); continue; }
    } else {
      if ((m = /^Q(\d{4})$/.exec(s))) { qnhHpa = Number(m[1]); continue; }
      if ((m = /^A(\d{4})$/.exec(s))) { qnhHpa = Math.round(Number(m[1]) / 100 * 33.8639); continue; }
      if ((m = /^RE([A-Z]+)$/.exec(s))) {
        const wx = weatherGroup(m[1]);
        if (wx) { recent.push({ ...wx, raw: s }); continue; }
      }
      if (/^WS\b/.test(s)) continue;
    }
    unparsed.push(s);
  }

  return {
    raw, type, station, time: new Date(t).toISOString().replace('.000Z', 'Z'),
    auto, corrected, nil, wind, visibilityM, cavok, skyClear,
    weather, recent, clouds, tempC, dewC, qnhHpa, unparsed,
  };
}

const WETTING = new Set(['RA', 'DZ']);

/** Rain or drizzle, any intensity, AT the station (VC excluded). RA, SHRA, TSRA, DZ, FZRA… */
export function rainingAtStation(m: Metar): boolean {
  return m.weather.some((w) => !w.vicinity && w.phenomena.some((p) => WETTING.has(p)));
}

/** A recent-weather group (RERA, RETSRA, RESHRA, REDZ): it rained since the last report. */
export function rainedRecently(m: Metar): boolean {
  return m.recent.some((w) => w.phenomena.some((p) => WETTING.has(p)));
}

/** Thunderstorm AT the station (TS descriptor, not VCTS). */
export function thunderAtStation(m: Metar): boolean {
  return m.weather.some((w) => !w.vicinity && w.descriptor === 'TS');
}

/** A CB or TCU layer was reported. */
export function convectiveCloud(m: Metar): boolean {
  return m.clouds.some((c) => c.convective !== null);
}

/** Weather "in the vicinity" (VC): worth saying, not applied to the ward. */
export function vicinityWeather(m: Metar): readonly WeatherGroup[] {
  return m.weather.filter((w) => w.vicinity);
}

/**
 * Total cloud fraction, 0–1, or null when the report says nothing about cloud.
 *
 * THE LARGEST LAYER, NOT A COMBINATION. Under METAR's layer rules (ICAO Annex 3
 * App. 3 §4.5.4.3: the second layer is reported only at SCT or more, the third
 * only at BKN or more) and the US summation principle (FMH-1 §9.5.4), each
 * reported amount is the sky covered at and below that layer, so the largest is
 * the total. Where a state reports layer amounts individually instead, the
 * largest is a LOWER bound on total cover; a random-overlap combination
 * 1 − Π(1 − Cᵢ) would be an upper one and would turn SCT018 FEW025CB BKN100 into
 * 0.89. Erring towards more sun is the honest side: it can under-cool the field,
 * never invent cloud the observer did not report.
 *
 * VV (sky obscured, vertical visibility) is 1. A CB/TCU layer's own amount counts
 * like any other; the extra opacity of convective cloud is the model's business
 * (see `stationCloudTransmission` in heat-map-model.ts), not the cover's.
 */
export function cloudFraction(m: Metar): number | null {
  if (m.skyClear && m.clouds.length === 0) return 0;
  if (m.clouds.length === 0) return null;
  let c = 0;
  for (const l of m.clouds) c = Math.max(c, l.cover === 'VV' ? 1 : COVER_FRACTION[l.cover]);
  return c;
}
