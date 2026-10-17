// src/scripts/climate-engine/v2/method-copy.ts — OBOS v2 spec §4.3, H23 [H]. Owner: Track A (plan S3.3). Every figure is an accuracy.ts export; none is typed here.
import { ACCURACY, TRANSITION_HOURS, TRANSITION_RMSE_K, SEASONAL_CAVEATS, seasonalCaveatLine } from '../accuracy.ts';

export interface Row { readonly k: string; readonly v: string }

const hm = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** The chip applyConfidence prints in the transition window (heat-map-app.ts, applyConfidence), as plain text. */
export function transitionChip(): string { return `Outside validation · ~±${TRANSITION_RMSE_K.toFixed(1)} °C at this hour`; }

export function checkedRows(): readonly Row[] {
  const n = ACCURACY.night, p = ACCURACY.peak;
  return [
    { k: 'Night', v: `±${n.bandK.toFixed(1)} °C over ${n.n} ward-scenes of NASA ECOSTRESS. In-sample error ${n.modelRmseK} K against a best possible ${n.ceilingRmseK} K.` },
    { k: 'Day', v: `±${p.bandK.toFixed(1)} °C, indicative only: n = ${p.n}, an earlier evidence set.` },
    { k: 'Band', v: `Covers the leave-one-overpass-out error (${n.looOverpassRmseK} K at night), not the in-sample fit.` },
  ];
}

export function caveatRows(): readonly Row[] {
  const [a, b] = TRANSITION_HOURS;
  return [
    { k: 'Dawn', v: `In the Now view from solar ${hm(a)} to ${hm(b)} the chip reads "${transitionChip()}": OBOS keeps ${TRANSITION_RMSE_K} K for that window, the larger of its out-of-sample measurements of the morning ECOSTRESS stratum, because the surface is still releasing stored heat while the sun is already loading it.` },
    ...SEASONAL_CAVEATS.map((c) => ({ k: 'Season', v: `When it applies, the reading adds: "${seasonalCaveatLine(c)}".` })),
  ];
}
