import { fmtMoney } from '../money.ts';
import { resolve, requireCosts } from '../scope/resolve.ts';
import { createPairedScenarioClient } from './paired-client.ts';
import { statsOverLabel, type PairedResult, type WardScenarioResult } from './paired-protocol.ts';
import { parsePairedScenario, serializePairedScenario } from '../scenario/scenario-url.ts';

export function mountPairedBrief(): () => void {
  const root = document.querySelector<HTMLElement>('[data-brief-root]');
  if (!root) return () => {};
  const state = parsePairedScenario(window.location.search);
  const all = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const set = (selector: string, value: string) => all<HTMLElement>(selector).forEach((node) => { node.textContent = value; });
  const status = (value: string) => set('[data-role="status"]', value);
  const link = root.querySelector<HTMLAnchorElement>('[data-role="compare-link"]');
  if (link) link.href = `/heat-map/compare/?${serializePairedScenario(state)}`;
  set('[data-value="trees"]', `${state.coverage.trees}% modelled corridor cells`);
  set('[data-value="roofs"]', `${state.coverage.roofs}% mapped roof stock`);
  set('[data-value="facades"]', `${state.coverage.facades.toFixed(1)}% modelled programme intensity`);
  set('[data-value="phase"]', state.phase === 'peak' ? '13:00 peak' : '22:00 retained');
  const print = root.querySelector<HTMLButtonElement>('[data-action="print"]');
  const onPrint = () => window.print();
  print?.addEventListener('click', onPrint);
  const client = createPairedScenarioClient();

  const writeWard = (slot: 'a' | 'b', result: WardScenarioResult) => {
    /* `resolve`, not `WARD_MAP`: the map is keyed by bare id (so a key reads back
       `undefined`) and its `name` carries `<em>` markup that `textContent` would
       print verbatim. Same reasoning as paired-controller.ts. */
    const scope = resolve(result.ward);
    set(`[data-value="${slot}-name"]`, scope.area.name);
    /* WHAT THIS SIDE'S FIGURES ARE OVER. The two areas are not equal any more —
       KMC Ward 68 is 0.93 km² inside an 1800 m square, the others are their 1.4 km
       windows — and every row below, the cost included, is this area's. */
    set(`[data-value="${slot}-over"]`, statsOverLabel(result));
    set(`[data-value="${slot}-baseline"]`, `${result.baselineMeanC.toFixed(1)}°C`);
    set(`[data-value="${slot}-scenario"]`, `${result.scenarioMeanC.toFixed(1)}°C`);
    set(`[data-value="${slot}-cooling"]`, `−${result.coolingC.toFixed(1)}°C`);
    /* The SAME `Costs` paired-core priced this figure with — `runWard` resolves the
       area's own scope and calls `requireCosts` before `computeCost`, and this
       resolves the same key to the same frozen object. So the label cannot name a
       currency other than the one the arithmetic used. The ₹ that stood here could,
       and did: it was a literal, and it survived the country becoming data. */
    set(`[data-value="${slot}-cost"]`, fmtMoney(result.capitalCost, requireCosts(scope)));
  };
  root.setAttribute('aria-busy', 'true');
  void client.run(state).then((result: PairedResult) => {
    writeWard('a', result.a);
    writeWard('b', result.b);
    set('[data-value="forcing"]', `${result.forcing.label}; ${result.forcing.source}`);
    set('[data-value="backend"]', result.a.evidence.backendVersion);
    /* Each side's own admitted grid: Ballygunge's 1800 m square is 247 cells, a 1.4 km
       window 192 — the same physical cell to 0.06 % (paired-protocol.ts). */
    const grid = (w: WardScenarioResult) => { const n = Math.round(Math.sqrt(w.field.length)); return `${n} × ${n}, ${w.evidence.gridVersion}`; };
    set('[data-value="grid"]', grid(result.a) === grid(result.b) ? grid(result.a) : `${grid(result.a)} / ${grid(result.b)}`);
    /* The boundary's licence travels with the figures taken inside it (CC BY-SA 2.5 IN §4). */
    const bounded = [result.a, result.b].filter((w) => w.statsOver);
    const credit = root.querySelector<HTMLElement>('[data-value="boundary-credit"]');
    if (credit) {
      credit.hidden = bounded.length === 0;
      credit.textContent = bounded.length === 0 ? '' : `${bounded.map((w) => w.statsOver!.name).join(' and ')}: ward boundary © DataMeet (Municipal_Spatial_Data), CC BY-SA 2.5 India, https://creativecommons.org/licenses/by-sa/2.5/in/.`;
    }
    status('Record reproduced in the client with the pinned scenario and version contract.');
    client.dispose();
  }).catch((error: Error) => {
    status(`This scenario cannot be reproduced: ${error.message}`);
  }).finally(() => {
    root.setAttribute('aria-busy', 'false');
  });
  return () => { client.dispose(); print?.removeEventListener('click', onPrint); };
}
