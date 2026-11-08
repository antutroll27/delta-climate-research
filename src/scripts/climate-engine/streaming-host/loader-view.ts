/**
 * loader-view.ts — the DOM for the whole-city loading screen (city-streaming P4). All decisions live in loader-model.ts
 * (pure, tested in node); this file only draws a LoaderState and forwards the person's one action, Retry.
 *
 * INTEGRATION (what P3b calls; every call is cheap and safe at any time):
 *
 *   const loader = createLoaderView({ host: stageEl, onRetry: (e) => executor.send(e) });   // e = { type:'retry', sheet, level }
 *   // executor ports / city-stream hooks:
 *   loader: (c) => loader.command(c)        // the manager's { type:'loader', sheet, phase } command, as it is
 *   failure: (c) => loader.command(c)       // the manager's { type:'failure', ... } command (level and attempts matter)
 *   makeCurrent: (c) => loader.command(c)   // so the view knows a sheet landed and can plan the rise
 *   cancel / evict: (c) => loader.command(c)  // optional but advised: an abandoned load forgets its progress
 *   // real progress: whenever a level of the sheet finishes
 *   loader.stage(sheet, 'massing' | 'ward' | 'surface' | 'vector' | 'sim');
 *   // the building rise: each frame of the page's grow timeline
 *   growProgress = loader.riseValue(performance.now());       // 0..1, already 1 under reduced motion
 *   // optional extras
 *   loader.setFrame(screenQuad | null);  loader.setFacts(sheet, { buildings: drawnCount, ... });  loader.setSurvey(sheet, points);
 *   loader.setAreaNames(areaNamesJson);  // data/cities/amsterdam/area-names.json from P5, optional (falls back to the table label)
 *   loader.reset(true);                  // a new city: the next load is the first-entry sweep (design C)
 *
 * Nothing here touches the map, the renderer or the manager. The rise is the renderer's EXISTING `grow` uniform
 * (relief-renderer.ts setVisualState({ grow })): a uniform write, no geometry, no new render pass.
 *
 * MOTION: transform and opacity only, every transition in loader-view.css. The one other write is the frame path's `d`
 * attribute, and only when the HOST says the camera moved (setFrame): it tracks the map, it is not an animation. The
 * progress rule is `scaleX`, easing toward the real value; it can lag the truth but never lead it.
 */
import cssText from './loader-view.css?inline';
import type { Level, ManagerCommand } from '../streaming/sheet-manager.ts';
import { SHEETS, type SheetCode } from '../scope/sheets.ts';
import { AMSTERDAM_SHEET_LATTICE as LATTICE } from '../../../data/sheets/amsterdam.ts';
import {
  STAGE_LABEL, TILE_STAGES, stagesApplicable, createLoaderModel, nextLoaderWakeMs, progressOf, retryEventOf, riseValue, areaLabel, areaParts, areaDetail, stageValue, parseAreaNames,
  showsPlate, showsRise, showsSweep, stagesOf,
  type AreaNames, type LoaderOptions, type LoaderState, type RisePlan, type SheetFacts, type TileStage,
} from '../streaming/loader-model.ts';

export interface LoaderClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  requestFrame(fn: (nowMs: number) => void): number;
  cancelFrame(id: number): void;
}

export const BROWSER_CLOCK: LoaderClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  requestFrame: (fn) => window.requestAnimationFrame(fn),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
};

/** The sheet's footprint on screen, as four corners in the host's CSS pixels (any order around the quad). */
export type ScreenQuad = readonly (readonly [number, number])[];

/** Building centroids of a sheet for the first-entry sweep: x east and y north in 0..1 across the sheet's box, h the height in 0..1 of the tallest. */
export interface SurveyPoints {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly h: ArrayLike<number>;
}

export interface RetryRequest {
  readonly type: 'retry';
  readonly sheet: SheetCode;
  readonly level: Level;
}

export interface LoaderViewOptions extends LoaderOptions {
  /** The map stage. Must sit inside the v2 root (`.obos-v2[data-theme]`) so the plate tokens resolve. */
  readonly host: HTMLElement;
  /** The person pressed Retry. Send the manager its `retry` event (host-executor PageEvent). */
  readonly onRetry: (request: RetryRequest) => void;
  readonly clock?: LoaderClock;
}

export interface LoaderView {
  /** Forward ANY manager command; the ones the loader does not use are ignored. */
  command(command: ManagerCommand): void;
  /** A real stage finished for `sheet` (safe before the loader is shown). */
  stage(sheet: SheetCode, stage: TileStage): void;
  /** DRAWN building count etc. for `sheet` (what the host extruded, never the lattice count). */
  setFacts(sheet: SheetCode, facts: SheetFacts): void;
  /** Area names from data/cities/amsterdam/area-names.json (P5), parsed JSON in; without it the area table labels are used. */
  setAreaNames(raw: unknown): void;
  setFrame(quad: ScreenQuad | null): void;
  setSurvey(sheet: SheetCode, points: SurveyPoints): void;
  /** A new city (or a restart). `firstEntry` true = the next load plays the sweep. */
  reset(firstEntry: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** The building rise planned by the last `make-current`, and its value now. */
  rise(): RisePlan | null;
  riseValue(nowMs: number): number;
  state(): LoaderState;
  dispose(): void;
}

// ── the stylesheet, once per document ──────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'cl-style';
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = cssText;
  doc.head.appendChild(el);
}

// ── small DOM helpers ──────────────────────────────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}
function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
function toggle(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

const fmt = (n: number): string => n.toLocaleString('en-GB');

// ── the view ───────────────────────────────────────────────────────────────────────────────────────────────────

export function createLoaderView(options: LoaderViewOptions): LoaderView {
  const { host } = options;
  const doc = host.ownerDocument;
  const clock = options.clock ?? BROWSER_CLOCK;
  ensureStyle(doc);

  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const model = createLoaderModel({ firstEntry: options.firstEntry, reducedMotion: options.reducedMotion ?? mq?.matches ?? false });

  // DOM ----------------------------------------------------------------------------------------------------------
  const root = el(doc, 'div', 'cl', host);
  root.setAttribute('data-state', 'idle');
  const sweepBox = el(doc, 'div', 'cl-sweep', root);
  sweepBox.setAttribute('aria-hidden', 'true');
  const canvas = el(doc, 'canvas', '', sweepBox);
  const tele = el(doc, 'div', 'cl-tele', sweepBox);
  const scrim = el(doc, 'div', 'cl-scrim', root);
  scrim.setAttribute('aria-hidden', 'true');

  const frameSvg = doc.createElementNS(SVG_NS, 'svg');
  frameSvg.setAttribute('class', 'cl-frame cl-fade');
  frameSvg.setAttribute('aria-hidden', 'true');
  const framePath = doc.createElementNS(SVG_NS, 'path');
  frameSvg.appendChild(framePath);
  root.appendChild(frameSvg);
  const tag = el(doc, 'div', 'cl-tag cl-fade', root);
  tag.setAttribute('aria-hidden', 'true');
  const chip = el(doc, 'div', 'cl-chip', root);
  chip.setAttribute('aria-hidden', 'true');

  const mini = el(doc, 'div', 'cl-mini', root);
  mini.setAttribute('aria-hidden', 'true');
  const miniSteps = el(doc, 'ul', 'cl-steps', mini);
  const miniLis = TILE_STAGES.map((s) => {
    const li = el(doc, 'li', '', miniSteps);
    el(doc, 'span', 'dot', li);
    el(doc, 'span', '', li, STAGE_LABEL[s]);
    return li;
  });
  const miniBar = el(doc, 'i', '', el(doc, 'div', 'cl-bar', mini));

  const plate = el(doc, 'section', 'cl-plate', root);
  plate.setAttribute('aria-hidden', 'true');
  const left = el(doc, 'div', '', plate);
  el(doc, 'div', 'cl-micro', left, 'Area');
  const codeEl = el(doc, 'div', 'cl-code', left);
  const nameEl = el(doc, 'div', 'cl-name', left);
  const indexSvg = doc.createElementNS(SVG_NS, 'svg');
  indexSvg.setAttribute('class', 'cl-index');
  indexSvg.setAttribute('viewBox', '0 0 100 70');
  indexSvg.setAttribute('aria-hidden', 'true');
  const indexRects = new Map<string, SVGRectElement>();
  for (const s of SHEETS) {
    const col = s.i - LATTICE.iOfColumnA;
    const row = LATTICE.jOfRow1 - s.j;
    const r = doc.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(col * 10 + 0.8)); r.setAttribute('y', String(row * 10 + 0.8));
    r.setAttribute('width', '8.4'); r.setAttribute('height', '8.4'); r.setAttribute('rx', '1');
    r.setAttribute('class', 'ship');
    indexSvg.appendChild(r);
    indexRects.set(s.code, r);
  }
  plate.appendChild(indexSvg);
  const rows = el(doc, 'ul', 'cl-rows', plate);
  const rowLis = TILE_STAGES.map((s) => {
    const li = el(doc, 'li', '', rows);
    el(doc, 'span', '', li, STAGE_LABEL[s]);
    el(doc, 'b', '', li);
    return li;
  });
  const plateBar = el(doc, 'i', '', el(doc, 'div', 'cl-bar', plate));
  el(doc, 'div', 'cl-cred', plate, '© 3DBAG by tudelft3d and 3DGI · AHN · Copernicus Sentinel-2 · OSM via Overture');
  const failBox = el(doc, 'div', 'cl-fail', plate);
  const failMsg = el(doc, 'p', '', failBox);
  const failTitle = el(doc, 'strong', '', failMsg);
  const failBody = el(doc, 'span', '', failMsg);
  const retryBtn = el(doc, 'button', 'cl-retry', failBox, 'Retry');
  retryBtn.type = 'button';

  const sayPolite = el(doc, 'div', 'cl-sr', root);
  sayPolite.setAttribute('role', 'status');
  sayPolite.setAttribute('aria-live', 'polite');
  const sayAlert = el(doc, 'div', 'cl-sr', root);
  sayAlert.setAttribute('role', 'alert');

  // behaviour ----------------------------------------------------------------------------------------------------
  let disposed = false;
  let wake: number | null = null;
  let frameId: number | null = null;
  let lastSeq = 0;
  let shownTarget: SheetCode | null = null;
  let lastFocus: Element | null = null;
  let framePoints = '';
  let survey: { sheet: SheetCode; groups: Uint32Array[]; xs: Float32Array; ys: Float32Array; hs: Float32Array; total: number } | null = null;
  let sweepStart = -1;
  let drawn: number[] = [0, 0, 0, 0];
  let canvasW = 0, canvasH = 0, ctx: CanvasRenderingContext2D | null = null;
  let ink = '';

  const nowMs = (): number => clock.now();

  function paintSweepFrame(t: number, state: LoaderState): void {
    if (ctx === null || survey === null) return;
    const reduced = state.reducedMotion;
    const progress = reduced ? 1 : Math.min(1, (t - sweepStart) / 2200);
    const side = Math.min(canvasW * 0.86, (canvasH * 0.66) / 0.58);
    const cx = canvasW / 2, cy = canvasH * (canvasW < 700 ? 0.3 : 0.54);   // on a phone the plate takes the middle: the survey sits above it
    const alphas = [0.38, 0.55, 0.75, 0.95];
    ctx.fillStyle = ink;
    for (let g = 0; g < 4; g++) {
      const idx = survey.groups[g]!;
      ctx.globalAlpha = alphas[g]!;
      while (drawn[g]! < idx.length) {
        const k = idx[drawn[g]!]!;
        if (survey.xs[k]! > progress) break;
        const px = cx + (survey.xs[k]! - 0.5) * side;
        const py = cy - (survey.ys[k]! - 0.5) * side * 0.58 - survey.hs[k]! * side * 0.07;
        ctx.fillRect(px - 1, py - 1, 2, 2);
        drawn[g] = drawn[g]! + 1;
      }
    }
    ctx.globalAlpha = 1;
  }

  function sweepCount(): number {
    return drawn.reduce((a, b) => a + b, 0);
  }

  function startSweep(state: LoaderState): void {
    const w = host.clientWidth, h = host.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    canvasW = w; canvasH = h;
    ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(root);
    ink = cs.getPropertyValue('--plate-ink-1').trim() || 'currentColor';
    drawn = [0, 0, 0, 0];
    sweepStart = nowMs();
    paintSweepFrame(sweepStart, state);
    if (!state.reducedMotion && survey !== null && frameId === null) frameId = clock.requestFrame(sweepLoop);
  }

  /* Runs only while the sweep is on screen AND points exist; it stops by itself once every point is drawn. */
  function sweepLoop(): void {
    frameId = null;
    if (disposed || survey === null) return;
    const state = model.state();
    if (!showsSweep(state, nowMs())) return;
    paintSweepFrame(nowMs(), state);
    renderTele(state);
    if (sweepCount() < survey.total) frameId = clock.requestFrame(sweepLoop);
  }

  function renderTele(state: LoaderState): void {
    const sheet = state.sheet;
    if (sheet === null) return;
    const f = state.facts.get(sheet);
    const parts = areaParts(sheet, state.names);
    const lines = [
      `${parts.code} · ${parts.name.toUpperCase()}`,
      `POINTS ${survey !== null && survey.sheet === sheet ? `${fmt(sweepCount())} / ${fmt(survey.total)}` : '—'}`,
      `FOOTPRINTS ${f?.buildings === undefined ? '—' : fmt(f.buildings)}`,
      `STAGES ${stagesOf(state, sheet).length} / ${TILE_STAGES.length}`,
    ];
    setText(tele, lines.join('\n'));
  }

  function render(): void {
    if (disposed) return;
    const state = model.state();
    const now = nowMs();
    const sheet = state.sheet;
    const rise = showsRise(state, now);
    const plateOn = showsPlate(state, now);
    const sweepOn = showsSweep(state, now);
    const failed = state.mode === 'failed' && plateOn;

    root.setAttribute('data-state', state.mode);
    root.setAttribute('data-design', state.design);
    root.setAttribute('data-reduced', state.reducedMotion ? '1' : '0');

    // design A furniture
    const label = areaLabel(sheet, state.names);
    if (sheet !== null) setText(chip, `Entering ${label}`);
    if (sheet !== null) setText(tag, label);
    toggle(chip, 'on', rise);
    toggle(mini, 'on', rise && !plateOn);   // the plate carries the same steps; two lists would say it twice
    const frameOn = rise && framePoints !== '';
    toggle(frameSvg, 'on', frameOn);
    toggle(tag, 'on', frameOn);

    // C: the sweep (first entry)
    const wasSweep = sweepBox.classList.contains('on');
    toggle(sweepBox, 'on', sweepOn);
    if (sweepOn && !wasSweep) startSweep(state);
    if (sweepOn) renderTele(state);

    // B: the plate
    toggle(scrim, 'on', plateOn && !sweepOn);   // the sweep carries its own ground
    toggle(plate, 'on', plateOn);
    toggle(plate, 'fail', failed);
    /* Only the failure plate is in the accessibility tree: loading progress is spoken by the status region, not read twice. */
    if (failed) { plate.removeAttribute('aria-hidden'); plate.setAttribute('role', 'group'); plate.setAttribute('aria-label', `${label} could not be loaded`); }
    else { plate.setAttribute('aria-hidden', 'true'); plate.removeAttribute('role'); plate.removeAttribute('aria-label'); }
    if (sheet !== null) {
      const parts = areaParts(sheet, state.names);
      setText(codeEl, parts.code);
      setText(nameEl, areaDetail(parts));
    }
    if (sheet !== null && shownTarget !== sheet) {
      shownTarget = sheet;
      for (const [code, rect] of indexRects) rect.setAttribute('class', code === sheet ? 'target' : 'ship');
    }

    // real progress, shared by the mini panel and the plate. Once idle the last values stay put while the panels fade out;
    // a loader that was seen ends full (the sheet IS ready), a failed or cancelled one just fades.
    if (state.mode !== 'idle') {
      const done = stagesOf(state, sheet);
      const scale = `scaleX(${progressOf(state, sheet).toFixed(3)})`;
      if (miniBar.style.transform !== scale) { miniBar.style.transform = scale; plateBar.style.transform = scale; }
      const facts = sheet === null ? undefined : state.facts.get(sheet);
      const applicable = stagesApplicable(state, sheet);
      TILE_STAGES.forEach((s, k) => {
        const on = done.includes(s);
        const here = applicable.includes(s);
        for (const li of [miniLis[k]!, rowLis[k]!]) if (li.hidden === here) li.hidden = !here;       // a row that cannot happen is not drawn (F8)
        toggle(miniLis[k]!, 'on', on);
        toggle(rowLis[k]!, 'on', on);
        setText(rowLis[k]!.lastElementChild!, on ? stageValue(s, facts) : '');
      });
    } else if (state.lastEnd?.shown === true && miniBar.style.transform !== 'scaleX(1)') {
      miniBar.style.transform = 'scaleX(1)'; plateBar.style.transform = 'scaleX(1)';
    }

    // the failure body and focus
    if (failed) {
      setText(failTitle, `${label} could not be loaded`);
      setText(failBody, 'Check your connection and try again. You can also choose another area.');
      if (!(doc.activeElement === retryBtn)) {
        if (lastFocus === null) lastFocus = doc.activeElement;
        retryBtn.focus({ preventScroll: true });
      }
    } else if (lastFocus !== null) {
      if (doc.activeElement === retryBtn || doc.activeElement === doc.body || doc.activeElement === null) {
        if (lastFocus instanceof HTMLElement && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
      }
      lastFocus = null;
    }

    // the live regions say each announcement once
    if (state.status.seq !== lastSeq) {
      lastSeq = state.status.seq;
      const target = state.status.kind === 'assertive' ? sayAlert : sayPolite;
      setText(target, state.status.text);
      if (state.status.kind === 'assertive') setText(sayPolite, ''); else setText(sayAlert, '');
    }
  }

  function arm(): void {
    if (wake !== null) { clock.clearTimeout(wake); wake = null; }
    const due = nextLoaderWakeMs(model.state(), nowMs());
    if (due === null || disposed) return;
    wake = clock.setTimeout(() => { wake = null; model.dispatch({ type: 'tick', atMs: nowMs() }); render(); arm(); }, Math.max(0, due - nowMs()));
  }

  function after(): void {
    render();
    arm();
  }

  retryBtn.addEventListener('click', () => {
    const request = retryEventOf(model.state());
    if (request === null) return;
    model.dispatch({ type: 'retry', atMs: nowMs() });
    after();
    options.onRetry(request);
  });

  const onMotionPref = (e: MediaQueryListEvent): void => { model.dispatch({ type: 'reduced-motion', atMs: nowMs(), reduced: e.matches }); after(); };
  mq?.addEventListener?.('change', onMotionPref);

  return {
    command(command) { model.dispatch({ type: 'command', atMs: nowMs(), command }); after(); },
    stage(sheet, stage) { model.dispatch({ type: 'stage', atMs: nowMs(), sheet, stage }); after(); },
    /** The parsed area-names.json (see parseAreaNames); safe to call at any time, and with anything. */
    setAreaNames(raw) { model.dispatch({ type: 'names', atMs: nowMs(), names: parseAreaNames(raw) }); after(); },
    setFacts(sheet, facts) { model.dispatch({ type: 'facts', atMs: nowMs(), sheet, facts }); after(); },
    setFrame(quad) {
      if (quad === null || quad.length < 3) { framePoints = ''; framePath.removeAttribute('d'); render(); return; }
      const d = `M${quad.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
      if (d === framePoints) return;
      framePoints = d;
      framePath.setAttribute('d', d);
      let best = quad[0]!;
      for (const q of quad) if (q[1] < best[1] || (q[1] === best[1] && q[0] < best[0])) best = q;
      tag.style.transform = `translate(${(best[0] + 6).toFixed(1)}px, ${(best[1] + 6).toFixed(1)}px)`;
      render();
    },
    setSurvey(sheet, points) {
      const n = Math.min(points.x.length, points.y.length, points.h.length);
      const xs = new Float32Array(n), ys = new Float32Array(n), hs = new Float32Array(n);
      for (let k = 0; k < n; k++) { xs[k] = points.x[k]!; ys[k] = points.y[k]!; hs[k] = points.h[k]!; }
      const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => xs[a]! - xs[b]!);   // west to east: the sweep draws a prefix
      const sortedH = Float32Array.from(hs).sort();
      const q = [sortedH[Math.floor(n * 0.25)] ?? 0, sortedH[Math.floor(n * 0.5)] ?? 0, sortedH[Math.floor(n * 0.8)] ?? 0];
      const buckets: number[][] = [[], [], [], []];
      for (const k of order) buckets[hs[k]! < q[0]! ? 0 : hs[k]! < q[1]! ? 1 : hs[k]! < q[2]! ? 2 : 3]!.push(k);
      survey = { sheet, groups: buckets.map((b) => Uint32Array.from(b)), xs, ys, hs, total: n };
      drawn = [0, 0, 0, 0];
      if (showsSweep(model.state(), nowMs())) { startSweep(model.state()); }
    },
    reset(firstEntry) { model.dispatch({ type: 'reset', atMs: nowMs(), firstEntry }); survey = null; shownTarget = null; after(); },
    setReducedMotion(reduced) { model.dispatch({ type: 'reduced-motion', atMs: nowMs(), reduced }); after(); },
    rise: () => model.state().rise,
    riseValue: (t) => riseValue(model.state().rise, t),
    state: () => model.state(),
    dispose() {
      disposed = true;
      if (wake !== null) clock.clearTimeout(wake);
      if (frameId !== null) clock.cancelFrame(frameId);
      mq?.removeEventListener?.('change', onMotionPref);
      root.remove();
    },
  };
}
