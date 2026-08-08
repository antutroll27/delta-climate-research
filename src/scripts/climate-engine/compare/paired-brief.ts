import { fmtCr } from '../heat-map-model.ts';
import { WARDS } from '../wards.ts';
import { PairedScenarioClient } from './paired-client.ts';
import type { PairedResult, WardScenarioResult } from './paired-protocol.ts';
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
  const client = new PairedScenarioClient();

  const writeWard = (slot: 'a' | 'b', result: WardScenarioResult) => {
    set(`[data-value="${slot}-name"]`, WARDS[result.ward].name);
    set(`[data-value="${slot}-baseline"]`, `${result.baselineMeanC.toFixed(1)}°C`);
    set(`[data-value="${slot}-scenario"]`, `${result.scenarioMeanC.toFixed(1)}°C`);
    set(`[data-value="${slot}-cooling"]`, `−${result.coolingC.toFixed(1)}°C`);
    set(`[data-value="${slot}-cost"]`, `₹${fmtCr(result.capitalCost)}`);
  };
  root.setAttribute('aria-busy', 'true');
  void client.run(state).then((result: PairedResult) => {
    writeWard('a', result.a);
    writeWard('b', result.b);
    set('[data-value="forcing"]', `${result.forcing.label}; ${result.forcing.source}`);
    set('[data-value="backend"]', result.a.evidence.backendVersion);
    status('Record reproduced in the client with the pinned scenario and version contract.');
    client.dispose();
  }).catch((error: Error) => {
    status(`This scenario cannot be reproduced: ${error.message}`);
  }).finally(() => {
    root.setAttribute('aria-busy', 'false');
  });
  return () => { client.dispose(); print?.removeEventListener('click', onPrint); };
}
