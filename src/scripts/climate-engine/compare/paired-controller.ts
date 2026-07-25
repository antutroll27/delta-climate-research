import { fmtCr } from '../heat-map-model.ts';
import { WARDS, WARD_IDS, nextDistinctWard, type WardId } from '../wards.ts';
import { enablePairedMapInteraction, renderPairedMap, resetPairedMapView, thermalPatternSummary } from './paired-map-2d.ts';
import { runPairedScenario, type MetricValue, type PairedResult, type WardScenarioResult } from './paired-runner.ts';
import { parsePairedScenario, serializePairedScenario } from '../scenario/scenario-url.ts';
import { coverageIsZero, normalizeCoverage, type CoverageScenario } from '../scenario/scenario-state.ts';
import type {
  ObservatoryState,
  ObservatoryViewMode,
  PairedThermalObservatory,
} from './paired-map-3d.ts';

type SheetState = 'collapsed' | 'half' | 'full';
type BenchTab = 'settings' | 'evidence' | 'wards';

const coverageKeys = ['trees', 'roofs', 'parks', 'facades'] as const;

function formatTemperature(value: number): string {
  return `${value.toFixed(1)}°C`;
}

function formatMetric(metric: MetricValue): string {
  if (metric.state !== 'evaluated') return 'Not evaluated';
  const prefix = metric.unit === 'percentage-points' && metric.value > 0 ? '+' : '';
  return metric.unit === 'percent'
    ? `${metric.value.toFixed(1)}%`
    : `${prefix}${metric.value.toFixed(1)} pp`;
}

function formatDelivered(result: WardScenarioResult): string {
  const quantity = result.delivered;
  return `${quantity.treeCorridorCells.toLocaleString()} corridor cells, ${(quantity.roofAreaM2 / 1000).toFixed(1)}k m² roofs, ${quantity.appliedParkHa.toFixed(2)} ha parks, ${quantity.facadeIntensityPct.toFixed(1)}% façade intensity`;
}

export function mountPairedBench(): () => void {
  const root = document.querySelector<HTMLElement>('[data-compare-root]');
  if (!root) return () => {};
  let state = parsePairedScenario(window.location.search);
  let checkpoint: CoverageScenario | null = null;
  let sheet: SheetState = 'collapsed';
  let tab: BenchTab = 'settings';
  let runController: AbortController | null = null;
  let runGeneration = 0;
  let pendingTimer: number | undefined;
  let observatory: PairedThermalObservatory | null = null;
  let observatoryState: ObservatoryState | null = null;
  let enhancementAttempted = false;
  let enhancementPromise: Promise<void> | null = null;
  let latestResult: PairedResult | null = null;
  let presentedResult: PairedResult | null = null;
  const cleanup: Array<() => void> = [];
  const mapCleanup = new Map<HTMLCanvasElement, () => void>();

  const all = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const one = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const setText = (selector: string, value: string) => all<HTMLElement>(selector).forEach((node) => { node.textContent = value; });
  const setStatus = (value: string) => setText('[data-role="status"]', value);

  function setCanvasMode(reason = 'Canvas relief'): void {
    root!.dataset.renderer = 'canvas';
    setText('[data-role="renderer-label"]', reason);
    setText('[data-role="map-mode-label"]', 'Canvas relief · adaptive fallback');
    all<HTMLCanvasElement>('[data-map-three]').forEach((canvas) => {
      canvas.tabIndex = -1;
      canvas.setAttribute('aria-hidden', 'true');
    });
    all<HTMLButtonElement>('[data-view-mode], [data-action="motion"]').forEach((button) => {
      button.disabled = true;
    });
  }

  function applyObservatoryState(next: ObservatoryState): void {
    observatoryState = next;
    root!.dataset.renderer = 'three';
    const fidelity = next.tier === 2 ? 'full fidelity' : 'balanced';
    setText('[data-role="renderer-label"]', `Linked 3D · ${fidelity}`);
    setText('[data-role="map-mode-label"]', 'Linked 3D · drag either view');
    all<HTMLCanvasElement>('[data-map-three]').forEach((canvas) => {
      canvas.tabIndex = 0;
      canvas.removeAttribute('aria-hidden');
    });
    all<HTMLButtonElement>('[data-view-mode]').forEach((button) => {
      button.disabled = false;
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === next.mode));
    });
    const motion = one<HTMLButtonElement>('[data-action="motion"]');
    if (motion) {
      motion.disabled = !next.motionAvailable;
      motion.setAttribute('aria-pressed', String(next.motion));
      motion.textContent = next.motion ? 'Pause' : 'Motion';
      motion.setAttribute('aria-label', next.motion ? 'Pause ambient map motion' : 'Resume ambient map motion');
    }
  }

  function handleThreeFallback(reason: string): void {
    observatory?.dispose();
    observatory = null;
    observatoryState = null;
    setCanvasMode('Canvas relief');
    root!.dataset.rendererReason = reason;
  }

  async function enhanceWithThree(result: PairedResult): Promise<void> {
    latestResult = result;
    const wardChanged = presentedResult
      ? presentedResult.a.ward !== result.a.ward || presentedResult.b.ward !== result.b.ward
      : false;
    if (observatory) {
      if (wardChanged) setCanvasMode('Preparing linked 3D');
      await observatory.update(result.a, result.b);
      if (latestResult === result && observatory) applyObservatoryState(observatoryState ?? {
        mode: 'relief',
        motion: false,
        motionAvailable: false,
        renderer: 'three',
        tier: 1,
      });
      presentedResult = result;
      return;
    }
    if (enhancementAttempted || enhancementPromise) return;
    enhancementAttempted = true;
    enhancementPromise = (async () => {
      const canvasA = one<HTMLCanvasElement>('[data-map-three="a"]');
      const canvasB = one<HTMLCanvasElement>('[data-map-three="b"]');
      if (!canvasA || !canvasB) return;
      const module = await import('./paired-map-3d.ts');
      const mounted = await module.mountPairedThermalObservatory({
        root: root!,
        canvasA,
        canvasB,
        initialA: result.a,
        initialB: result.b,
        onState: applyObservatoryState,
        onFallback: handleThreeFallback,
        onProbe: (slot, probe) => {
          const output = one<HTMLOutputElement>(`[data-map-probe="${slot}"]`);
          if (!output) return;
          output.hidden = probe === null;
          output.textContent = probe ? `${probe.temperatureC.toFixed(1)}°C · model cell` : '';
        },
      });
      if (!mounted) return;
      observatory = mounted;
      presentedResult = result;
      if (latestResult && latestResult !== result) {
        await mounted.update(latestResult.a, latestResult.b);
        presentedResult = latestResult;
      }
      if (observatoryState) applyObservatoryState(observatoryState);
    })().catch((error) => {
      handleThreeFallback(`3D enhancement unavailable: ${(error as Error).message}`);
    }).finally(() => {
      enhancementPromise = null;
    });
    await enhancementPromise;
  }

  function setSheet(next: SheetState): void {
    sheet = next;
    const controls = one<HTMLElement>('.heat-compare__controls');
    controls?.setAttribute('data-sheet', next);
    const expanded = next !== 'collapsed';
    one<HTMLButtonElement>('[data-action="sheet-toggle"]')?.setAttribute('aria-expanded', String(expanded));
    const workbench = one<HTMLElement>('.heat-compare__workbench');
    if (workbench) workbench.inert = next === 'full';
  }

  function setTab(next: BenchTab): void {
    tab = next;
    all<HTMLButtonElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === next)));
    all<HTMLElement>('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== next; });
  }

  function updateInputs(): void {
    for (const key of coverageKeys) {
      const input = one<HTMLInputElement>(`[data-input="${key}"]`);
      if (input) input.value = String(state.coverage[key]);
      const decimals = key === 'parks' || key === 'facades' ? 1 : 0;
      setText(`[data-output="${key}"]`, `${state.coverage[key].toFixed(decimals)}%`);
    }
    const phase = one<HTMLInputElement>(`[data-input="phase"][value="${state.phase}"]`);
    if (phase) phase.checked = true;
    const a = one<HTMLSelectElement>('[data-input="ward-a"]');
    const b = one<HTMLSelectElement>('[data-input="ward-b"]');
    for (const [select, selected, other] of [[a, state.a, state.b], [b, state.b, state.a]] as const) {
      if (!select) continue;
      select.replaceChildren(...WARD_IDS.map((id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = WARDS[id].name;
        option.selected = id === selected;
        option.disabled = id === other;
        return option;
      }));
    }
    const reset = one<HTMLButtonElement>('[data-action="reset"]');
    if (reset) reset.disabled = coverageIsZero(state.coverage);
    const undo = one<HTMLButtonElement>('[data-action="undo"]');
    if (undo) undo.disabled = checkpoint === null;
    setText('[data-role="mobile-summary"]', coverageIsZero(state.coverage) ? 'No interventions selected' : 'Illustrative package, edited');
    const query = serializePairedScenario(state);
    const brief = one<HTMLAnchorElement>('[data-role="brief-link"]');
    if (brief) brief.href = `/heat-map/brief/?${query}`;
  }

  function renderCanvasField(slot: 'a' | 'b', ward: WardScenarioResult): void {
    const canvas = one<HTMLCanvasElement>(`[data-map-field="${slot}"]`);
    if (!canvas) return;
    renderPairedMap(canvas, ward.field, ward.wardData, ward.roads);
    if (!mapCleanup.has(canvas)) mapCleanup.set(canvas, enablePairedMapInteraction(canvas));
  }

  function replaceUrl(): void {
    const query = serializePairedScenario(state);
    history.replaceState(null, '', `${window.location.pathname}?${query}`);
  }

  function applyResult(result: PairedResult): void {
    const writeWard = (slot: 'a' | 'b', ward: WardScenarioResult) => {
      const meta = WARDS[ward.ward];
      setText(`[data-value="${slot}-name"]`, meta.name);
      setText(`[data-value="${slot}-descriptor"]`, meta.descriptor);
      setText(`[data-value="${slot}-baseline"]`, formatTemperature(ward.baselineMeanC));
      setText(`[data-value="${slot}-scenario"]`, formatTemperature(ward.scenarioMeanC));
      setText(`[data-value="${slot}-cooling"]`, `−${ward.coolingC.toFixed(1)}°C`);
      setText(`[data-value="${slot}-hot-area"]`, formatMetric(ward.scenarioHotAreaPct));
      setText(`[data-value="${slot}-hot-change"]`, formatMetric(ward.hotAreaChangePp));
      setText(`[data-value="${slot}-rural"]`, `${ward.ruralContrastC >= 0 ? '+' : ''}${ward.ruralContrastC.toFixed(1)}°C`);
      setText(`[data-value="${slot}-cost"]`, `₹${fmtCr(ward.capitalCost)}`);
      setText(`[data-value="${slot}-delivered"]`, formatDelivered(ward));
      setText(`[data-value="${slot}-pattern"]`, thermalPatternSummary(ward.field));
      const threeCanvas = one<HTMLCanvasElement>(`[data-map-three="${slot}"]`);
      threeCanvas?.setAttribute(
        'aria-label',
        `Interactive 3D thermal model for ${meta.name}. The camera is linked to the other ward.`,
      );
      requestAnimationFrame(() => renderCanvasField(slot, ward));
    };
    writeWard('a', result.a);
    writeWard('b', result.b);
    const forcingLabel = `${result.forcing.label} · ${result.forcing.status.replace('-', ' ')}`;
    setText('[data-role="forcing-label"]', forcingLabel);
    setStatus(`Comparison settled. ${WARDS[result.a.ward].name} and ${WARDS[result.b.ward].name} use the same ${result.forcing.label.toLowerCase()}.`);
    void enhanceWithThree(result);
  }

  async function run(): Promise<void> {
    window.clearTimeout(pendingTimer);
    runController?.abort();
    const controller = new AbortController();
    runController = controller;
    const generation = ++runGeneration;
    setStatus('Running the paired model on the canonical grid.');
    root!.setAttribute('data-pending', 'true');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const result = await runPairedScenario(state, controller.signal);
      if (generation !== runGeneration || controller.signal.aborted) return;
      applyResult(result);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      setStatus(`Comparison unavailable: ${(error as Error).message}`);
    } finally {
      if (generation === runGeneration) root!.removeAttribute('data-pending');
    }
  }

  function scheduleRun(delay = 160): void {
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => { void run(); }, delay);
  }

  function setCoverage(next: Partial<CoverageScenario>): void {
    state = { ...state, coverage: normalizeCoverage({ ...state.coverage, ...next }) };
    checkpoint = null;
    updateInputs();
    replaceUrl();
    scheduleRun();
  }

  for (const key of coverageKeys) {
    const input = one<HTMLInputElement>(`[data-input="${key}"]`);
    const listener = () => setCoverage({ [key]: Number(input?.value) } as Partial<CoverageScenario>);
    input?.addEventListener('input', listener);
    if (input) cleanup.push(() => input.removeEventListener('input', listener));
  }

  all<HTMLInputElement>('[data-input="phase"]').forEach((input) => {
    const listener = () => {
      if (!input.checked) return;
      state = { ...state, phase: input.value === 'retained' ? 'retained' : 'peak' };
      replaceUrl();
      scheduleRun(0);
    };
    input.addEventListener('change', listener);
    cleanup.push(() => input.removeEventListener('change', listener));
  });

  const wardA = one<HTMLSelectElement>('[data-input="ward-a"]');
  const wardB = one<HTMLSelectElement>('[data-input="ward-b"]');
  const bindWard = (select: HTMLSelectElement | null, side: 'a' | 'b') => {
    const listener = () => {
      const chosen = select?.value as WardId;
      const other = side === 'a' ? state.b : state.a;
      const valid = chosen === other ? nextDistinctWard(other) : chosen;
      state = side === 'a' ? { ...state, a: valid } : { ...state, b: valid };
      updateInputs();
      replaceUrl();
      scheduleRun(0);
    };
    select?.addEventListener('change', listener);
    if (select) cleanup.push(() => select.removeEventListener('change', listener));
  };
  bindWard(wardA, 'a');
  bindWard(wardB, 'b');

  const reset = one<HTMLButtonElement>('[data-action="reset"]');
  const onReset = () => {
    if (coverageIsZero(state.coverage)) return;
    checkpoint = { ...state.coverage };
    state = { ...state, coverage: { trees: 0, roofs: 0, parks: 0, facades: 0 } };
    updateInputs();
    replaceUrl();
    scheduleRun(0);
  };
  reset?.addEventListener('click', onReset);
  if (reset) cleanup.push(() => reset.removeEventListener('click', onReset));

  const undo = one<HTMLButtonElement>('[data-action="undo"]');
  const onUndo = () => {
    if (!checkpoint) return;
    state = { ...state, coverage: checkpoint };
    checkpoint = null;
    updateInputs();
    replaceUrl();
    scheduleRun(0);
  };
  undo?.addEventListener('click', onUndo);
  if (undo) cleanup.push(() => undo.removeEventListener('click', onUndo));

  const swap = one<HTMLButtonElement>('[data-action="swap"]');
  const onSwap = () => {
    state = { ...state, a: state.b, b: state.a };
    updateInputs();
    replaceUrl();
    scheduleRun(0);
  };
  swap?.addEventListener('click', onSwap);
  if (swap) cleanup.push(() => swap.removeEventListener('click', onSwap));

  all<HTMLButtonElement>('[data-action="map-reset"]').forEach((button) => {
    const listener = () => {
      if (observatory) {
        observatory.reset();
        return;
      }
      all<HTMLCanvasElement>('[data-map-field]').forEach((canvas) => resetPairedMapView(canvas));
    };
    button.addEventListener('click', listener);
    cleanup.push(() => button.removeEventListener('click', listener));
  });

  all<HTMLButtonElement>('[data-view-mode]').forEach((button) => {
    const listener = () => observatory?.setView((button.dataset.viewMode as ObservatoryViewMode) || 'relief');
    button.addEventListener('click', listener);
    cleanup.push(() => button.removeEventListener('click', listener));
  });

  const motion = one<HTMLButtonElement>('[data-action="motion"]');
  const onMotion = () => observatory?.setMotion(!(observatoryState?.motion ?? false));
  motion?.addEventListener('click', onMotion);
  if (motion) cleanup.push(() => motion.removeEventListener('click', onMotion));

  const share = one<HTMLButtonElement>('[data-action="share"]');
  const onShare = async () => {
    const url = new URL(window.location.href);
    const value = url.toString();
    const field = one<HTMLElement>('[data-role="share-field"]');
    const input = one<HTMLInputElement>('[data-role="share-url"]');
    if (input) input.value = value;
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Shareable comparison URL copied to the clipboard.');
    } catch {
      if (field) field.hidden = false;
      input?.focus();
      input?.select();
      setStatus('Clipboard access is unavailable. The shareable URL is ready to copy.');
    }
  };
  share?.addEventListener('click', onShare);
  if (share) cleanup.push(() => share.removeEventListener('click', onShare));

  const sheetToggle = one<HTMLButtonElement>('[data-action="sheet-toggle"]');
  const onSheetToggle = () => setSheet(sheet === 'collapsed' ? 'half' : sheet === 'half' ? 'full' : 'collapsed');
  sheetToggle?.addEventListener('click', onSheetToggle);
  if (sheetToggle) cleanup.push(() => sheetToggle.removeEventListener('click', onSheetToggle));

  all<HTMLButtonElement>('[data-tab]').forEach((button) => {
    const listener = () => setTab((button.dataset.tab as BenchTab) || 'settings');
    button.addEventListener('click', listener);
    cleanup.push(() => button.removeEventListener('click', listener));
  });

  const onResize = () => {
    if (window.innerWidth >= 768) setSheet('collapsed');
    if (latestResult) {
      requestAnimationFrame(() => {
        renderCanvasField('a', latestResult!.a);
        renderCanvasField('b', latestResult!.b);
      });
    }
  };
  window.addEventListener('resize', onResize);
  cleanup.push(() => window.removeEventListener('resize', onResize));
  const onPopState = () => {
    state = parsePairedScenario(window.location.search);
    checkpoint = null;
    updateInputs();
    scheduleRun(0);
  };
  window.addEventListener('popstate', onPopState);
  cleanup.push(() => window.removeEventListener('popstate', onPopState));

  updateInputs();
  setTab(tab);
  setSheet(sheet);
  void run();

  return () => {
    window.clearTimeout(pendingTimer);
    runController?.abort();
    observatory?.dispose();
    observatory = null;
    mapCleanup.forEach((dispose) => dispose());
    cleanup.forEach((dispose) => dispose());
  };
}
