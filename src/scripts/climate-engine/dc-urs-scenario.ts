/**
 * Scenario layer — DC-URS under a set of interventions.
 *
 * DC-URS replaces the Green Score, so the sliders must still move it. One score,
 * evaluated twice: BASELINE from observed inputs, SCENARIO with modelled changes
 * applied on top (docs/dc-urs-spec.md §5).
 *
 * WHAT MOVES AND WHAT DOES NOT
 *
 *   fvc, canopyFrac   trees and parks add vegetation
 *   albedo            cool roofs raise reflectance
 *   distCoolM         a new park shortens the distance to a refuge
 *   lstDayC/NightC    from the thermal model, carrying its measured error
 *
 *   ndviStd           FROZEN — see below
 *   popDensity, far, socioVuln   inert; no intervention touches them
 *
 * WHY VSI IS FROZEN. The Vegetation Stability Index measures multi-year
 * persistence. Newly planted cover has no history: honest values put it near
 * 0.27 against a mature canopy's 0.95. A live VSI would therefore make PLANTING
 * TREES LOWER THE SCORE, which is both wrong and the sort of thing that destroys
 * trust in an index. It is held at its baseline value and the freeze is
 * disclosed, rather than silently recomputed.
 *
 * THE INERT THIRD IS A FEATURE. `EVI` carries 0.35 of the weight and nothing the
 * user does can touch it. That is not a limitation to hide — it is the sharpest
 * thing the tool says: some of a ward's vulnerability is demographic, and trees
 * cannot fix it. `structuralFloor()` in dc-urs.ts quantifies exactly how much.
 */
import type { DcUrsInputs } from './dc-urs-inputs.ts';
import type { Interventions } from './heat-map-model.ts';

/** How far each slider can push its indicator, at full travel.
 *
 *  These are deliberately conservative and describe the SCENARIO, not a
 *  prediction. They are ceilings on plausible change over a 1400 m ward, not
 *  fitted constants — an intervention model calibrated against measurement does
 *  not exist for these wards, and pretending otherwise would repeat the mistake
 *  the thermal calibration was built to correct. */
export const SCENARIO = {
  /** 50 street-tree units at full travel. Canopy over a ward is bounded by the
   *  street network, so the reachable ceiling is modest. */
  treesFvcGain: 0.12,
  treesCanopyGain: 0.10,
  /** 10 pocket parks. Parks add ground vegetation and, more importantly, put a
   *  refuge within reach. */
  parksFvcGain: 0.06,
  parksCanopyGain: 0.04,
  /** Metres of refuge distance removed at full park travel. A pocket park in a
   *  ward that had none is the single largest TRA move available. */
  parksDistCut: 220,
  /** 100 % cool-roof coverage over the built fraction. LBNL aged value 0.60
   *  against a dark-roof 0.15; the ward-mean shift is far smaller than that
   *  because roofs are a fraction of the surface. */
  roofAlbedoGain: 0.10,
  /** Facades barely move surface albedo — they are vertical, and the satellite
   *  sees the ward from above. Small on purpose. */
  facadeFvcGain: 0.01,
} as const;

export interface ScenarioResult {
  readonly inputs: DcUrsInputs;
  /** true when any slider is off zero */
  readonly active: boolean;
  /** indicators the interventions actually moved */
  readonly moved: readonly string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Apply interventions to the baseline inputs.
 *
 * `lst` is supplied by the caller from the thermal model, so this module does no
 * physics — it maps sliders onto indicators and nothing else.
 */
export function applyScenario(
  base: DcUrsInputs,
  iv: Interventions,
  lst?: { dayC?: number; nightC?: number },
): ScenarioResult {
  const trees = iv.trees / 50, roof = iv.roof / 100;
  const parks = Math.min(1, iv.parks / 10), facades = iv.facades / 15;
  const active = iv.trees > 0 || iv.roof > 0 || iv.parks > 0 || iv.facades > 0;

  const fvc = clamp01(base.fvc.value
    + trees * SCENARIO.treesFvcGain
    + parks * SCENARIO.parksFvcGain
    + facades * SCENARIO.facadeFvcGain);
  const canopy = clamp01(base.canopyFrac.value
    + trees * SCENARIO.treesCanopyGain
    + parks * SCENARIO.parksCanopyGain);
  const albedo = clamp01(base.albedo.value + roof * SCENARIO.roofAlbedoGain);
  const dist = Math.max(0, base.distCoolM.value - parks * SCENARIO.parksDistCut);

  const moved: string[] = [];
  if (fvc !== base.fvc.value) moved.push('vegetation');
  if (canopy !== base.canopyFrac.value) moved.push('canopy');
  if (albedo !== base.albedo.value) moved.push('albedo');
  if (dist !== base.distCoolM.value) moved.push('refuge access');
  if (lst?.dayC !== undefined || lst?.nightC !== undefined) moved.push('surface temperature');

  return {
    active,
    moved,
    inputs: {
      ...base,
      fvc: { ...base.fvc, value: fvc, source: 'modelled' },
      canopyFrac: { ...base.canopyFrac, value: canopy, source: 'modelled' },
      albedo: { ...base.albedo, value: albedo, source: 'modelled' },
      distCoolM: { ...base.distCoolM, value: dist, source: 'modelled' },
      lstDayC: lst?.dayC !== undefined
        ? { ...base.lstDayC, value: lst.dayC, source: 'modelled' } : base.lstDayC,
      lstNightC: lst?.nightC !== undefined
        ? { ...base.lstNightC, value: lst.nightC, source: 'modelled' } : base.lstNightC,
      // ndviStd deliberately untouched — see the module note on VSI.
    },
  };
}

/** ponytail: one runnable check */
export function assertScenarioLogic(base: DcUrsInputs): void {
  const a = (ok: boolean, m: string) => { if (!ok) throw new Error(`dc-urs-scenario: ${m}`); };
  const none = { trees: 0, roof: 0, parks: 0, facades: 0 };
  const all = { trees: 50, roof: 100, parks: 10, facades: 15 };

  const z = applyScenario(base, none);
  a(!z.active && z.moved.length === 0, 'no intervention must move nothing');
  a(z.inputs.fvc.value === base.fvc.value, 'zero sliders must leave fvc untouched');

  const full = applyScenario(base, all);
  a(full.active, 'full intervention must register as active');
  a(full.inputs.fvc.value > base.fvc.value, 'planting must raise vegetation');
  a(full.inputs.albedo.value > base.albedo.value, 'cool roofs must raise albedo');
  a(full.inputs.distCoolM.value < base.distCoolM.value, 'parks must shorten refuge distance');

  // the freeze, asserted so it cannot be quietly undone
  a(full.inputs.ndviStd.value === base.ndviStd.value, 'VSI input must stay frozen in scenario mode');

  // the inert third, asserted for the same reason
  a(full.inputs.popDensity.value === base.popDensity.value, 'population must be inert');
  a(full.inputs.far.value === base.far.value, 'built density must be inert');
  a(full.inputs.socioVuln.value === base.socioVuln.value, 'social vulnerability must be inert');

  // anything the scenario touches is modelled, not measured
  a(full.inputs.fvc.source === 'modelled', 'a modelled value must not claim to be measured');
}
