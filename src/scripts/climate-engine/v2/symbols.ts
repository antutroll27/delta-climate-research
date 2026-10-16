/**
 * OBOS v2 — THE MARKS (spec §2.5). Single source, after the twin's symbols.ts and the
 * preview's symbols.js. colour = WHAT IS MEASURED; shape = WHAT KIND OF PLACE;
 * SOLID = measured/observed/computed; OUTLINED (dashed) = modelled/illustrative.
 * The ONLY spelling of every symbol and AQI hex; the root's style attribute carries them.
 */
export type SymShape = 'disc' | 'square' | 'quarter' | 'bowl' | 'bar' | 'dome' | 'ward';
export type SymKind = 'measured' | 'modelled';
export type HeatClass = 'heat-1' | 'heat-2' | 'heat-3' | 'heat-4' | 'heat-5';
export type AqBand = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very-poor' | 'severe';
export type SymColour = HeatClass | `aq-${AqBand}` | 'solar' | 'water' | 'green' | 'cold' | 'wind' | 'ink' | 'neutral';

export const SHAPE_PATH: Readonly<Record<SymShape, string>> = Object.freeze({
  disc: 'M0 50a50 50 0 1 0 100 0a50 50 0 1 0-100 0Z',
  dome: 'M0 75a50 50 0 0 1 100 0Z',
  quarter: 'M100 100H0A100 100 0 0 1 100 0Z',
  bowl: 'M0 50a50 50 0 0 0 100 0Z',
  bar: 'M22 0h56v100H22Z',
  square: 'M8 8h84v84H8Z',
  ward: 'M50 2 94 27v46L50 98 6 73V27Z',
});

/** sym-green has a light and a dark value; tokens.css maps --sym-green per theme. */
export const SYMBOL_HEX = Object.freeze({
  solar: '#E3C02E', water: '#3D7BD9', 'green-light': '#3F8F66', 'green-dark': '#5FA87E', cold: '#2E4E9E', wind: '#6B7F81',
} as const);

/** India's six NAQI band colours, exactly as OBOS's live Air card (HeatMapStage.astro:1029). Data colour: always beside the band word. */
export const AQ_HEX: Readonly<Record<AqBand, string>> = Object.freeze({
  good: '#2a8f6a', satisfactory: '#6fcf97', moderate: '#f2d03a', poor: '#f2912e', 'very-poor': '#e0404f', severe: '#9b3fa0',
});

export function symbolCssVars(): string {
  const sym = Object.entries(SYMBOL_HEX).map(([k, v]) => `--sym-${k}:${v}`);
  const aq = Object.entries(AQ_HEX).map(([k, v]) => `--aq-${k}:${v}`);
  return [...sym, ...aq].join(';');
}

const COLOUR_VAR: Readonly<Record<SymColour, string>> = Object.freeze({
  'heat-1': 'var(--heat-1)', 'heat-2': 'var(--heat-2)', 'heat-3': 'var(--heat-3)', 'heat-4': 'var(--heat-4)', 'heat-5': 'var(--heat-5)',
  'aq-good': 'var(--aq-good)', 'aq-satisfactory': 'var(--aq-satisfactory)', 'aq-moderate': 'var(--aq-moderate)',
  'aq-poor': 'var(--aq-poor)', 'aq-very-poor': 'var(--aq-very-poor)', 'aq-severe': 'var(--aq-severe)',
  solar: 'var(--sym-solar)', water: 'var(--sym-water)', green: 'var(--sym-green)', cold: 'var(--sym-cold)',
  wind: 'var(--sym-wind)', ink: 'var(--ink-1)', neutral: 'var(--ink-3)',
});
const KEYLINED: ReadonlySet<SymColour> = new Set<SymColour>(['solar', 'aq-moderate', 'aq-satisfactory']);

export function symSvg(shape: SymShape, c: SymColour, kind: SymKind, size: number): string {
  const col = COLOUR_VAR[c];
  const d = SHAPE_PATH[shape];
  const path = kind === 'modelled'
    ? `<path class="f" d="${d}" fill="none" stroke="${col}" stroke-width="2.25" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`
    : `<path class="${KEYLINED.has(c) ? 'f sym-keyline' : 'f'}" d="${d}" fill="${col}"/>`;
  return `<svg class="sym" viewBox="-3 -3 106 106" width="${size}" height="${size}" aria-hidden="true" focusable="false">${path}</svg>`;
}

/** lstColor's classes (heat-map-app.ts:3153): <33 Comfortable, ≥33 Hot, ≥37 Severe, ≥40 Extreme. */
export function heatClass(meanC: number): HeatClass {
  if (!Number.isFinite(meanC)) return 'heat-1';
  return meanC >= 40 ? 'heat-5' : meanC >= 37 ? 'heat-4' : meanC >= 33 ? 'heat-3' : 'heat-1';
}
