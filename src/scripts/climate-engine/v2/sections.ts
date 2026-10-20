// src/scripts/climate-engine/v2/sections.ts — OBOS v2 spec §3.2 (pure)
export type SectionId = 'overview' | 'heat' | 'air' | 'solar' | 'weather' | 'scenarios' | 'methods';
export type RailId = SectionId | 'compare';
export type SidePane = 'explore' | 'air' | 'solar';
export interface Section {
  readonly id: SectionId; readonly label: string; readonly side: SidePane | null;
  /** written to html[data-open-pane]: the seam heat-map-app.ts:1210–1250 reads */
  readonly openPane: string;
  /** false: reachable on an area that ships no artefacts */
  readonly needsData: boolean;
}
export const SECTIONS: readonly Section[] = Object.freeze([
  { id: 'overview', label: 'Overview', side: 'explore', openPane: 'map', needsData: false },
  { id: 'heat', label: 'Heat', side: null, openPane: 'heat', needsData: true },
  { id: 'air', label: 'Air', side: 'air', openPane: 'air', needsData: true },
  { id: 'solar', label: 'Solar', side: 'solar', openPane: 'solar', needsData: true },
  { id: 'weather', label: 'Weather', side: null, openPane: 'weather', needsData: true },
  { id: 'scenarios', label: 'Scenarios', side: 'explore', openPane: 'scenarios', needsData: true },
  { id: 'methods', label: 'Data & methods', side: null, openPane: 'reports', needsData: false },
]);
export const COMPARE_ITEM = Object.freeze({ id: 'compare', label: 'Analysis · Compare', href: '/heat-map/compare/' } as const);
export const RAIL_ORDER: readonly RailId[] = Object.freeze(['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'compare', 'methods']);

export function sectionOf(id: string | undefined): Section {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

export interface NavState { readonly section: SectionId; readonly sideOpen: boolean }
export function onMenuClick(state: NavState, clicked: SectionId): NavState {
  return clicked === state.section ? { section: clicked, sideOpen: !state.sideOpen } : { section: clicked, sideOpen: state.sideOpen };
}
