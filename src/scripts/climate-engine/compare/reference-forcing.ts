import { heatIndexC, type Ambient } from '../heat-map-model.ts';
import type { ComparePhase } from '../scenario/scenario-state.ts';

export interface CompareReferenceForcing {
  id: string;
  status: 'reference' | 'fallback-reference';
  label: string;
  source: string;
  referenceLocation: string | null;
  referenceDate: string | null;
  values: Record<ComparePhase, Ambient>;
}

const ambient = (tAir: number, rh: number, wind: number, cloud: number): Ambient => ({
  tAir,
  rh,
  wind,
  cloud,
  feels: heatIndexC(tAir, rh),
});

/**
 * Deliberately explicit interim forcing. It makes the production route usable
 * for engineering and UX verification without claiming an observed heat-day.
 * Replace this record with a cited regional observation before publication.
 */
export const SCREENING_REFERENCE: CompareReferenceForcing = {
  id: 'delta-screening-reference-v1',
  status: 'fallback-reference',
  label: 'Illustrative screening reference',
  source: 'Delta fallback model inputs, not an observed heat-day record',
  referenceLocation: null,
  referenceDate: null,
  values: {
    peak: ambient(35.6, 58, 1.8, 24),
    retained: ambient(29.4, 71, 1.2, 38),
  },
};

export function resolveReferenceForcing(id: string): CompareReferenceForcing | null {
  return id === SCREENING_REFERENCE.id ? SCREENING_REFERENCE : null;
}
