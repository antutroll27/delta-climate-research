import { PARK_HA, type Interventions, type Spatial } from '../heat-map-model.ts';
import type { CoverageScenario } from './scenario-state.ts';

export const STUDY_WINDOW_HA = 196;

export interface DeliveredQuantities {
  treeCorridorCells: number;
  roofAreaM2: number;
  requestedParkHa: number;
  appliedParkHa: number;
  parkSiteEquivalents: number;
  facadeIntensityPct: number;
}

/** Translate transparent coverage controls into the existing model's input units. */
export function coverageToInterventions(coverage: CoverageScenario): Interventions {
  return {
    trees: coverage.trees / 100 * 50,
    roof: coverage.roofs,
    parks: Math.min(10, coverage.parks / 100 * STUDY_WINDOW_HA / PARK_HA),
    facades: coverage.facades / 100 * 15,
  };
}

export function deliveredQuantities(coverage: CoverageScenario, spatial: Spatial): DeliveredQuantities {
  const requestedParkHa = coverage.parks / 100 * STUDY_WINDOW_HA;
  const appliedParkHa = Math.min(requestedParkHa, spatial.parkCenters.length * PARK_HA);
  return {
    treeCorridorCells: Math.floor(spatial.corridorSorted.length * coverage.trees / 100),
    roofAreaM2: spatial.roofM2 * coverage.roofs / 100,
    requestedParkHa,
    appliedParkHa,
    parkSiteEquivalents: appliedParkHa / PARK_HA,
    facadeIntensityPct: coverage.facades,
  };
}
