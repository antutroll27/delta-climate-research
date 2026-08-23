/**
 * What each production-route indicator means, for the route dropdown.
 *
 * TWO LAYERS, DELIBERATELY SEPARATE. `quote` is the Commission's exact wording from IR (EU)
 * 2025/2620, Annex point 5.3, transcribed character for character — including its own
 * inconsistencies ("Carbon Steel" but "Low alloy Steel"; "Scrap/EAF" in (E) but "scrap/EAF" in
 * (H)). `label` is OURS: plain English, shown in the option, never presented as the regulation's
 * words. A test asserts the two are never the same string, because collapsing them would start
 * passing our gloss off as the Commission's.
 *
 * BF, DRI and EAF are expanded on the regulation's own authority — recitals (15) and (16) give
 * "blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes". BOF is
 * expanded NOWHERE in the regulation, so that expansion is ours. It is standard and not in
 * dispute, but it is not a quote and must not be cited as one.
 *
 * COMPLETE, AND MEASURED TO BE: the eleven indicators here are exactly the distinct
 * routeIndicator values in the shipped pack — no gaps, no extras. The letters are also disjoint
 * across sectors (cement A–B under chapter 25, iron & steel C–H and J under 72/73, aluminium K–L
 * under 76), so this flat lookup is unambiguous and needs no sector key.
 *
 * NOT HERE: 'default'. routesFor returns it for a good with a single unlettered route, and
 * cbam-app renders it "single route". It is not an Annex indicator, and it is always alone in its
 * list — measured 53,070 of 53,070 over 572 goods x 122 origins x the three covered years — which
 * is what makes that label accurate.
 *
 * ONE LOCATOR, THREE SPELLINGS IN THIS REPO. The pack's own source record for this document reads
 * "Arts 1-3, Annex §5.3", and every benchmark row's sourceLocator reads "IR (EU) 2025/2620 Annex,
 * Column B route (A) (via EC benchmarks workbook v1…)". The regulation itself numbers this "point
 * 5.3", which is what CITE uses. Noted so the difference reads as three renderings of one source
 * rather than as three sources.
 */
export interface RouteGloss {
  /** Ours. Plain English, shown in the option. Never the Commission's wording. */
  label: string;
  /** The Commission's exact words, verbatim. */
  quote: string;
  /** Where the quote comes from. */
  cite: string;
}

const CITE = 'IR (EU) 2025/2620, Annex point 5.3';

export const ROUTE_GLOSSARY: Record<string, RouteGloss> = {
  '(A)': { label: 'Grey cement clinker', quote: 'grey clinker / cement', cite: CITE },
  '(B)': { label: 'White cement clinker', quote: 'white clinker / cement', cite: CITE },
  '(C)': {
    label: 'Carbon steel · blast furnace / basic oxygen furnace',
    quote: 'Carbon Steel based on BF/BOF', cite: CITE,
  },
  '(D)': {
    label: 'Carbon steel · direct reduced iron / electric arc furnace',
    quote: 'Carbon Steel based on DRI/EAF', cite: CITE,
  },
  '(E)': {
    label: 'Carbon steel · scrap / electric arc furnace',
    quote: 'Carbon Steel based on Scrap/EAF', cite: CITE,
  },
  '(F)': {
    label: 'Low-alloy steel · blast furnace / basic oxygen furnace',
    quote: 'Low alloy Steel based on BF/BOF', cite: CITE,
  },
  '(G)': {
    label: 'Low-alloy steel · direct reduced iron / electric arc furnace',
    quote: 'Low alloy Steel based on DRI/EAF', cite: CITE,
  },
  '(H)': {
    label: 'Low-alloy steel · scrap / electric arc furnace',
    quote: 'Low alloy Steel based on scrap/EAF', cite: CITE,
  },
  '(J)': {
    label: 'High-alloy steel · electric arc furnace',
    quote: 'High alloy Steel (based on EAF)', cite: CITE,
  },
  '(K)': { label: 'Primary aluminium', quote: 'primary Aluminium', cite: CITE },
  '(L)': { label: 'Secondary aluminium', quote: 'secondary Aluminium', cite: CITE },
};
