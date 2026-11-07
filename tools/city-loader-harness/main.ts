/* DEV HARNESS for the whole-city loading screen (city-streaming P4). Not part of the Astro build.
 *
 *   npx vite --config tools/city-loader-harness/vite.config.ts --port 4738 --host 127.0.0.1
 *   http://127.0.0.1:4738/?scene=plate-45            one frozen state (what shoot.mjs photographs)
 *   http://127.0.0.1:4738/?bench=1                    buttons that play slow / fast / failing / first-entry moves in real time
 *
 * What is real here: the sheet manager (createSheetManager) is driven by scripted load answers, and EVERY command it
 * emits goes into the real loader view. What is a stand-in: the map. A Canvas2D oblique draw of Canal Ring's real 3D BAG
 * footprints stands where the MapLibre + three.js layer sits, and the loader's `riseValue` feeds it the same 0..1 `grow`
 * the renderer's uGrow uniform takes. */
import '../../src/styles/obos-v2/tokens.css';
import { createLoaderView, BROWSER_CLOCK, type LoaderClock, type LoaderView, type ScreenQuad } from '../../src/scripts/climate-engine/streaming-host/loader-view.ts';
import { createSheetManager, type ManagerCommand, type ManagerEvent } from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';
import { STAGE_OF_LEVEL, type TileStage } from '../../src/scripts/climate-engine/streaming/loader-model.ts';
import { MAX_ATTEMPTS } from '../../src/scripts/climate-engine/streaming/sheet-budgets.ts';
import type { SheetCode } from '../../src/scripts/climate-engine/scope/sheets.ts';

// ── a clock the screenshots can step ───────────────────────────────────────────────────────────────────────────

class ManualClock implements LoaderClock {
  t = 1000;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private frames: { id: number; fn: (n: number) => void }[] = [];
  private next = 1;
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): number { const id = this.next++; this.timers.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id: number): void { this.timers = this.timers.filter((x) => x.id !== id); }
  requestFrame(fn: (n: number) => void): number { const id = this.next++; this.frames.push({ id, fn }); return id; }
  cancelFrame(id: number): void { this.frames = this.frames.filter((x) => x.id !== id); }
  advance(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) {
      const step = Math.min(16, end - this.t);
      this.t += step;
      for (let guard = 0; guard < 1000; guard++) {
        const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        this.timers = this.timers.filter((x) => x !== due);
        due.fn();
      }
      const frames = this.frames; this.frames = [];
      for (const f of frames) f.fn(this.t);
    }
  }
}

// ── the page, simulated: a real manager, scripted answers ──────────────────────────────────────────────────────

interface Script {
  /** how long `sheet`/`level` takes to answer; 0 = at once */
  latency(sheet: SheetCode, level: string): number;
  /** a level that answers with a failure while this returns true */
  failing(sheet: SheetCode, level: string): boolean;
}

class PageSim {
  readonly manager = createSheetManager('full');
  private pending = new Map<string, { id: number; timers: number[] }>();
  script: Script = { latency: () => 0, failing: () => false };
  onMakeCurrent: (sheet: SheetCode) => void = () => undefined;
  displayed: SheetCode | null = null;
  private wake: number | null = null;
  constructor(private readonly clock: LoaderClock, private readonly view: LoaderView) {}

  send(event: DistributiveOmit<ManagerEvent, 'atMs'>): void {
    const cmds = this.manager.dispatch({ ...event, atMs: this.clock.now() } as ManagerEvent);
    for (const c of cmds) this.handle(c);
    if (this.wake !== null) this.clock.clearTimeout(this.wake);
    const due = this.manager.nextWakeMs(this.clock.now());
    this.wake = due === null ? null : this.clock.setTimeout(() => { this.wake = null; this.send({ type: 'tick' }); }, Math.max(0, due - this.clock.now()));
  }

  private handle(c: ManagerCommand): void {
    this.view.command(c);                                                       // EVERY command goes to the loader, as in the app
    const key = (s: string, l: string): string => `${s}/${l}`;
    if (c.type === 'load') {
      const id = c.requestId;
      const wait = this.script.latency(c.sheet, c.level);
      const timers: number[] = [];
      if (c.level === 'lod0' && wait > 0) {
        const stages: [number, TileStage][] = [[0.4, 'ward'], [0.65, 'surface'], [0.85, 'vector']];
        for (const [f, st] of stages) timers.push(this.clock.setTimeout(() => this.view.stage(c.sheet, st), wait * f));
      }
      timers.push(this.clock.setTimeout(() => {
        this.pending.delete(key(c.sheet, c.level));
        if (this.script.failing(c.sheet, c.level)) this.send({ type: 'load-failed', requestId: id, reason: 'harness' });
        else {
          const st = STAGE_OF_LEVEL[c.level];
          if (st !== null && c.level !== 'lod0') this.view.stage(c.sheet, st);
          this.send({ type: 'load-finished', requestId: id });
        }
      }, wait));
      this.pending.set(key(c.sheet, c.level), { id, timers });
    } else if (c.type === 'cancel') {
      for (const t of this.pending.get(key(c.sheet, c.level))?.timers ?? []) this.clock.clearTimeout(t);
      this.pending.delete(key(c.sheet, c.level));
    } else if (c.type === 'make-current') {
      this.displayed = c.sheet;
      this.onMakeCurrent(c.sheet);
    }
  }
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

// ── the stand-in map ───────────────────────────────────────────────────────────────────────────────────────────

interface Building { h: number; ring: Float32Array; d: number }
const K = 0.58;       // north-south squash of the oblique view
const EX = 2.6;       // height exaggeration, so heights read at this scale

async function loadBuildings(): Promise<Building[]> {
  const res = await fetch('/data/canal-ring.json');
  const data = (await res.json()) as { b: number[][] };
  const noise = (x: number, y: number): number => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  const out: Building[] = data.b.map((row) => {
    const ring = Float32Array.from(row.slice(1));
    let cx = 0, cy = 0; const n = ring.length / 2;
    for (let k = 0; k < n; k++) { cx += ring[2 * k]!; cy += ring[2 * k + 1]!; }
    cx /= n; cy /= n;
    // the shader's own delay: radial 72 % plus 28 % hash
    return { h: row[0]!, ring, d: Math.min(1, Math.hypot(cx, cy) / 1400) * 0.72 + noise(Math.floor(cx), Math.floor(cy)) * 0.28 };
  });
  out.sort((a, b) => b.ring[1]! - a.ring[1]!);                                 // north first
  return out;
}

const easeShader = (t: number): number => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

function createMap(canvas: HTMLCanvasElement, buildings: Building[]) {
  const root = canvas.closest('.obos-v2') as HTMLElement;
  const rect = (): { w: number; h: number } => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const project = (W: number, H: number) => {
    const s = (W > 700 ? W / 3500 : W / 1500);
    return { s, X: (x: number) => W / 2 + x * s, Y: (y: number, h = 0) => H * 0.52 - y * s * K - h * s * EX };
  };
  let lastGrow = -1;
  let lastKey = '';
  function sheetQuad(): ScreenQuad {
    const { w, h } = rect(); const p = project(w, h);
    return [[p.X(-1400), p.Y(1400)], [p.X(1400), p.Y(1400)], [p.X(1400), p.Y(-1400)], [p.X(-1400), p.Y(-1400)]];
  }
  function draw(grow: number, targetShown: boolean): void {
    const { w, h } = rect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const key = `${w}x${h}|${root.dataset.theme}|${targetShown}`;
    if (key !== lastKey) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); lastKey = key; lastGrow = -1; }
    const q = Math.round(grow * 60) / 60;
    if (q === lastGrow) return;
    lastGrow = q;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(root);
    const ground = cs.getPropertyValue('--card').trim(), mass = cs.getPropertyValue('--plate-well-2').trim(), roof = cs.getPropertyValue('--plate-ink-3').trim(), wall = cs.getPropertyValue('--plate-ink-2').trim();
    const p = project(w, h);
    g.fillStyle = ground; g.fillRect(0, 0, w, h);
    // grey neighbour massing (LOD1 stand-in): deterministic blocks outside the sheet, denser toward the middle
    g.fillStyle = mass;
    for (let gx = -5; gx <= 5; gx++) for (let gy = -3; gy <= 3; gy++) {
      if (gx >= -1 && gx <= 1 && gy >= -1 && gy <= 1 && targetShown) continue;       // the sheet itself is drawn below
      const n = Math.sin(gx * 91.7 + gy * 47.3) * 43758.5453; const r = n - Math.floor(n);
      const wM = 330 + r * 160, hM = 220 + r * 120;
      for (let k = 0; k < 7; k++) for (let m = 0; m < 5; m++) {
        const b = Math.sin((gx * 7 + k) * 12.9898 + (gy * 5 + m) * 78.233) * 43758.5453; const rb = b - Math.floor(b);
        if (rb < 0.3) continue;
        g.globalAlpha = 0.25 + rb * 0.45;
        const x = gx * 800 - 400 + k * (800 / 7), y = gy * 800 - 400 + m * (800 / 5);
        g.fillRect(p.X(x), p.Y(y + 100, 6 + rb * 14), 800 / 7 * p.s * 0.8, 100 * p.s * K + (6 + rb * 14) * p.s * EX);
      }
      void wM; void hM;
    }
    g.globalAlpha = 1;
    // the sheet's own footprints, rising by the same delay-and-ease the facade shader uses
    for (const b of buildings) {
      const f = grow >= 1 ? 1 : easeShader(clamp01((grow - b.d * 0.55) / 0.45));
      const height = b.h * f;
      const n = b.ring.length / 2;
      if (height > 0.4) {
        g.fillStyle = wall; g.globalAlpha = 0.9; g.beginPath();
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const ax = p.X(b.ring[2 * k]!), ay = p.Y(b.ring[2 * k + 1]!), bx = p.X(b.ring[2 * k2]!), by = p.Y(b.ring[2 * k2 + 1]!), dh = height * p.s * EX;
          g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx, by - dh); g.lineTo(ax, ay - dh); g.closePath();
        }
        g.fill();
      }
      g.fillStyle = roof; g.globalAlpha = grow >= 1 || f > 0.02 ? 1 : 0.5; g.beginPath();
      g.moveTo(p.X(b.ring[0]!), p.Y(b.ring[1]!, height));
      for (let k = 1; k < n; k++) g.lineTo(p.X(b.ring[2 * k]!), p.Y(b.ring[2 * k + 1]!, height));
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }
  return { draw, sheetQuad };
}

// ── scenes ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const rootEl = document.getElementById('root') as HTMLElement;
  rootEl.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
  const stage = document.getElementById('mlmap') as HTMLElement;
  const canvas = document.getElementById('mock') as HTMLCanvasElement;
  const buildings = await loadBuildings();
  const map = createMap(canvas, buildings);

  const manual = params.has('bench') ? false : true;
  const clock: LoaderClock = manual ? new ManualClock() : BROWSER_CLOCK;
  const firstEntry = params.get('scene') === 'first-entry' || params.get('first') === '1';
  const reduced = params.get('reduced') === '1';
  let retried = 0;
  let sim: PageSim;
  const view = createLoaderView({
    host: stage, clock, firstEntry, reducedMotion: reduced,
    onRetry: (r) => { retried++; sim.script = { latency: () => 800, failing: () => false }; sim.send({ type: 'retry', sheet: r.sheet, level: r.level }); },
  });
  sim = new PageSim(clock, view);
  let growOverride: number | null = null;
  let targetShown = false;
  sim.onMakeCurrent = (sheet) => { if (sheet === 'E4') targetShown = true; };

  const paint = (): void => {
    const g = growOverride ?? (targetShown ? view.riseValue(clock.now()) : 0);
    map.draw(g, true);
    view.setFrame(map.sheetQuad());
  };
  const loop = (): void => { paint(); requestAnimationFrame(loop); };
  if (!manual) requestAnimationFrame(loop);

  // a survey for the first-entry sweep: building centroids of Canal Ring, as 0..1 across the sheet
  const survey = {
    x: buildings.map((b) => (b.ring[0]! + 1400) / 2800), y: buildings.map((b) => (b.ring[1]! + 1400) / 2800),
    h: buildings.map((b) => Math.min(1, b.h / 60)),
  };

  /** Stand inside the city at D4 (instant), so a move to E4 is a move, not an entry. */
  const settleAt = (code: SheetCode): void => {
    sim.script = { latency: () => 0, failing: () => false };
    sim.send({ type: 'start', sheet: code });
    if (manual) (clock as ManualClock).advance(50);
    targetShown = false; growOverride = null;
  };
  const settle = async (ms: number): Promise<void> => {      // let the real CSS transitions finish
    paint();
    await new Promise((r) => setTimeout(r, ms));
  };

  async function scene(name: string): Promise<void> {
    const mc = clock as ManualClock;
    const slowE4 = (ms: number): Script => ({ latency: (s, l) => (s === 'E4' && l === 'lod0' ? ms : 20), failing: () => false });
    if (name !== 'first-entry') settleAt('D4' as SheetCode);
    switch (name) {
      case 'waiting': case 'plate-45': case 'rising': case 'failure': case 'reduced-motion': {
        sim.script = name === 'failure' ? { latency: () => 20, failing: (s, l) => s === 'E4' && l === 'lod0' } : slowE4(4000);
        sim.send({ type: 'select', sheet: 'E4' });
        view.stage('E4' as SheetCode, 'massing');                          // E4's grey massing was on screen as a neighbour
        view.setFacts('E4' as SheetCode, { buildings: 21_342, surfaceScenes: 6, trees: 18_400 });
        if (name === 'waiting') { mc.advance(900); break; }                  // past the 400 ms rise, before the 1.2 s plate: massing only, 25 %
        if (name === 'plate-45') { mc.advance(1700); break; }                // the footprints landed at 1.6 s: massing + ward = 45 %
        if (name === 'failure') { mc.advance(60_000); break; }
        if (name === 'rising') { mc.advance(4100); growOverride = 0.35; break; }
        if (name === 'reduced-motion') { mc.advance(1700); break; }
        break;
      }
      case 'first-entry': {
        sim.script = slowE4(5000);
        sim.send({ type: 'start', sheet: 'E4' as SheetCode });
        view.setFacts('E4' as SheetCode, { buildings: 21_342 });
        mc.advance(700);
        view.setSurvey('E4' as SheetCode, survey);
        mc.advance(1500);
        break;
      }
      default: throw new Error(`unknown scene ${name}`);
    }
    await settle(900);
  }

  const w = window as unknown as { __h: unknown };
  w.__h = {
    ready: true,
    scene,
    state: () => view.state(),
    retries: () => retried,
    attempts: MAX_ATTEMPTS,
    clickRetry: () => (document.querySelector('.cl-retry') as HTMLButtonElement).click(),
    advance: (ms: number) => { if (manual) (clock as ManualClock).advance(ms); },
    paint,
  };

  const sceneName = params.get('scene');
  if (sceneName !== null) await scene(sceneName);

  if (!manual) buildBench();

  function buildBench(): void {
    const bench = document.getElementById('bench') as HTMLElement;
    bench.hidden = false;
    const add = (label: string, fn: () => void): void => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); bench.appendChild(b); };
    const home = (): void => { settleAt('D4' as SheetCode); targetShown = false; };
    add('Slow move (3.5 s)', () => { home(); sim.script = { latency: (s, l) => (s === 'E4' && l === 'lod0' ? 3500 : 20), failing: () => false }; sim.send({ type: 'select', sheet: 'E4' }); view.stage('E4' as SheetCode, 'massing'); });
    add('Fast move (150 ms)', () => { home(); sim.script = { latency: (s, l) => (s === 'E4' && l === 'lod0' ? 150 : 20), failing: () => false }; sim.send({ type: 'select', sheet: 'E4' }); });
    add('Medium move (800 ms)', () => { home(); sim.script = { latency: (s, l) => (s === 'E4' && l === 'lod0' ? 800 : 20), failing: () => false }; sim.send({ type: 'select', sheet: 'E4' }); });
    add('Failing move', () => { home(); sim.script = { latency: () => 20, failing: (s, l) => s === 'E4' && l === 'lod0' }; sim.send({ type: 'select', sheet: 'E4' }); });
    add('First entry', () => { view.reset(true); sim.send({ type: 'start', sheet: 'D4' as SheetCode }); targetShown = false; sim.script = { latency: (s, l) => (s === 'E4' && l === 'lod0' ? 4500 : 20), failing: () => false }; sim.send({ type: 'start', sheet: 'E4' as SheetCode }); view.setSurvey('E4' as SheetCode, survey); });
    add('Light / dark', () => { rootEl.dataset.theme = rootEl.dataset.theme === 'dark' ? 'light' : 'dark'; });
  }
}

void boot();
