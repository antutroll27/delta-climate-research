// tests/e2e/obos-v2-glass.spec.ts — OBOS v2 spec §8.2. LOCAL ONLY (needs a real GPU).
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { PW_ORIGIN, V2_STORAGE_STATE } from './fixtures/ui-v2-state';

const SLICE = process.env.OBOS_V2_SLICE ?? 's1';
const OUT = `/Volumes/OBOSLab/obos-v2/audits/perf-${SLICE}${process.env.OBOS_PERF_THEME ? `-${process.env.OBOS_PERF_THEME}` : ''}.json`;
const SECS = Number(process.env.OBOS_PERF_SECS ?? 5), REPS = Number(process.env.OBOS_PERF_REPS ?? 3);
/* FOUNDER RULE (17 Oct): no browser window ever appears on his screen. The off-screen window the brief asked for first
   (--window-position=-32000,-32000 --no-startup-window ...) was CLAMPED back onto the display by macOS (CDP
   Browser.getWindowBounds read left 0, top 30), so the committed default is the brief's fallback: new headless on Metal.
   SAME LIST as PERF_METAL in playwright.config.ts. Every JSON says "headless": true. */
const METAL = ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const HEADLESS = METAL.includes('--headless=new');
type Mode = 'v1' | 'bare' | 'plates' | 'flat' | 'live';
/* S2 audit F2: with DUMMY=0 the "bare" page is the REAL chrome in flat, not a bare page, so the JSON calls it what it is. */
const CHROME_ONLY = process.env.DUMMY === '0';
const BARE_KEY = CHROME_ONLY ? 'chrome-flat' : 'bare';
/* The S9 gate (plan S9.4, A1 §4.4) is the BINDING one: over the whole chrome, with no dummies. */
const BINDING = /^s9/.test(SLICE);

/* THE APPROVED SHELL'S OWN SURFACES at 1440x900 (S1 audit F1): the 14 blurred boxes of the preview's Overview
   (present mode), each as a REAL v2 element so the shipped token CSS decides fill, filter and radius. They cover
   792k px2; the nine boxes this gate began with covered 703k and measured live Glass ~2 ms low. Source:
   /Volumes/OBOSLab/obos-v2/audits/s1a/preview-rects.json. Rerun in S9 against the full chrome (OBOS_V2_SLICE=s9, DUMMY=0).
   Tuple: [class, x, y, w, h, border-radius]. */
const BOXES: ReadonlyArray<[string, number, number, number, number, string]> = [
  ['toolbar', 1210, 12, 214, 41, '14px'], ['rail', 16, 16, 220, 498, '22px'], ['card', 568, 16, 300, 189, '22px'],
  ['card compass', 568, 215, 56, 56, '50%'], ['card', 568, 495, 214, 117, '16px'], ['card', 568, 619, 214, 197, '16px'],
  ['toast', 884, 16, 197, 38, '99px'], ['toast', 884, 62, 229, 38, '99px'], ['side-panel', 252, 16, 300, 788, '22px'],
  ['card', 1104, 68, 320, 633, '22px'], ['card', 1104, 711, 320, 189, '22px'], ['bar', 641, 831, 374, 55, '20px'],
  ['place', 1131, 16, 69, 30, '99px'], ['attrib', 1076, 864, 352, 24, '11px'],
];
/* text rastered inside each surface, so the blur has real content to sample and clip */
const SURFACE_HTML = '<div class="micro">Air now · Dum Dum airport</div><p class="hero">31.4<span class="u">°C</span></p><p class="lede">Ballygunge · KMC Ward 68 · ground 38.2 °C · rooftop 44.1 °C</p><dl class="stats"><div><dt class="micro">Above 40 °C</dt><dd>21%</dd></div><div><dt class="micro">Δ vs green</dt><dd>+2.4 °C</dd></div></dl>';

interface Cfg { readonly cores?: number; readonly stress?: number }

/* ONE PAGE ALIVE AT A TIME. Display::DrawAndSwap in a trace is browser-wide: with a second page open, its
   frames interleave with the measured page's and the intervals halve (measured: p50 4 ms and 163 fps on a
   144 Hz display). So every pass boots a fresh page, measures it alone, and closes it. The display must be the
   real one too (see the project's headless:false): a headless Chromium has no vsync and reads 1 ms frames.
   The window is OFF-SCREEN (founder rule), so nothing here calls bringToFront; the --disable-* flags keep it rendering.
   The v2 page boots as shipped (tier 2 => Glass live, monitor running) and the fills are switched with the two
   attributes the toolbar will write. */
async function boot(browser: Browser, ui: 'v1' | 'v2', dsf: number, cfg: Cfg): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: PW_ORIGIN, viewport: { width: 1440, height: 900 }, deviceScaleFactor: dsf,
    storageState: ui === 'v1' ? undefined : process.env.OBOS_PERF_THEME ? { cookies: [], origins: [{ origin: PW_ORIGIN, localStorage: [...V2_STORAGE_STATE.origins[0].localStorage, { name: 'obos:v2:theme', value: process.env.OBOS_PERF_THEME }] }] } : V2_STORAGE_STATE });
  const page = await ctx.newPage();
  await page.addInitScript((cores) => {
    try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ }
    if (cores) Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: cores });
  }, cfg.cores ?? 0);
  await page.goto(`/heat-map/in/kolkata/ballygunge/?lab=1${ui === 'v1' ? '&ui=v1' : ''}`);
  await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as { __obosMap?: unknown }).__obosMap, null, { timeout: 90_000 });
  await page.waitForTimeout(6000);
  /* a weaker GPU, simulated the way brainstorm 02 did: the map renders at a higher pixel ratio */
  if (cfg.stress) await page.evaluate((k) => (window as unknown as { __obosMap: { setPixelRatio(n: number): void } }).__obosMap.setPixelRatio(k), cfg.stress);
  await page.evaluate(() => {
    const m = (window as unknown as { __obosMap: { getBearing(): number; jumpTo(o: { bearing: number }): void } }).__obosMap;
    const b0 = m.getBearing(); const t0 = performance.now();
    const f = (t: number) => { m.jumpTo({ bearing: b0 + ((t - t0) / 1000) * 30 }); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.waitForTimeout(1000);
  return page;
}

/** the 14 surfaces as live v2 elements; none with DUMMY=0 (the S9 rerun measures the real chrome) */
const addDummies = (page: Page): Promise<void> => page.evaluate(([boxes, html]) => {
  const root = document.querySelector('main.obos-v2')!;
  for (const [cls, l, t, w, h, radius] of boxes) {
    const d = document.createElement('div');
    d.className = cls; d.setAttribute('data-perf-dummy', '');
    Object.assign(d.style, { position: 'absolute', left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px`, zIndex: '40', overflow: 'hidden', borderRadius: radius });
    d.innerHTML = html;
    root.appendChild(d);
  }
}, [BOXES, SURFACE_HTML] as const);
const removeDummies = (page: Page): Promise<void> => page.evaluate(() => { document.querySelectorAll('[data-perf-dummy]').forEach((e) => e.remove()); });

interface Shipped { glass: string | null; cards: string | null; tier: string | null; theme: string | null; blurred: number }
const shipped = (page: Page): Promise<Shipped> => page.evaluate(() => {
  const r = document.querySelector<HTMLElement>('main.obos-v2');
  /* how many v2 surfaces (the dummies, and from S2 the real chrome) the compositor is actually asked to blur right now */
  /* RENDERED surfaces only (S2 audit F2): a display:none popover or chip is blurred in computed style and costs nothing. */
  const blurred = r ? [...r.querySelectorAll('*')].filter((e) => { if (e.getClientRects().length === 0) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && !!cs.backdropFilter && cs.backdropFilter !== 'none'; }).length : 0;
  return { glass: r?.dataset.glass ?? null, cards: r?.dataset.cards ?? null, tier: r?.dataset.tier ?? null, theme: r?.dataset.theme ?? null, blurred };
});
const setFill = (page: Page, mode: Mode): Promise<void> => page.evaluate((m) => {
  const r = document.querySelector<HTMLElement>('main.obos-v2')!;
  r.dataset.cards = m === 'plates' ? 'plates' : 'glass';
  r.dataset.glass = m === 'live' ? 'live' : 'flat';
}, mode);

interface WindowBounds { left: number; top: number; width: number; height: number; windowState: string }
/** where the browser window really is (CDP Browser.getWindowBounds); the founder rule is that it is on no display */
async function windowBounds(page: Page): Promise<WindowBounds | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    return { left: bounds.left ?? Number.NaN, top: bounds.top ?? Number.NaN, width: bounds.width ?? Number.NaN, height: bounds.height ?? Number.NaN, windowState: bounds.windowState ?? '?' };
  } catch { return null; /* new headless has no window to ask about */ } finally { await cdp.detach(); }
}
const offScreen = (b: WindowBounds): boolean => b.left + b.width <= 0 || b.top + b.height <= 0 || b.left >= 30000 || b.top >= 30000;
/** the page's rAF rate over one second: the display's refresh rate when frames are not being throttled */
const rafHz = (page: Page): Promise<number> => page.evaluate(() => new Promise<number>((res) => {
  const t: number[] = []; const f = (n: number): void => { t.push(n); if (n - t[0] < 1000) requestAnimationFrame(f); else { const d = t.slice(1).map((x, k) => x - t[k]).sort((a, b) => a - b); res(1000 / d[Math.floor(d.length / 2)]); } };
  requestAnimationFrame(f);
}));

interface Run { p50: number; p95: number; fps: number; over20: number; n: number; flipped: boolean; blurred: number }

async function measure(browser: Browser, page: Page, want: Shipped | null): Promise<Run> {
  await browser.startTracing(page, { categories: ['viz', 'gpu'] });
  await page.waitForTimeout(SECS * 1000);
  const buf = await browser.stopTracing();
  const after = want ? await shipped(page) : null;
  const raw = JSON.parse(buf.toString()) as { traceEvents?: Array<{ name: string; ph: string; ts: number }> } | Array<{ name: string; ph: string; ts: number }>;
  const ev = Array.isArray(raw) ? raw : raw.traceEvents ?? [];
  const das = ev.filter((e) => e.name === 'Display::DrawAndSwap' && e.ph === 'X').sort((a, b) => a.ts - b.ts);
  const iv = das.slice(1).map((e, k) => (e.ts - das[k].ts) / 1000).sort((a, b) => a - b);
  const q = (p: number): number => iv[Math.min(iv.length - 1, Math.floor(p * iv.length))] ?? Number.NaN;
  const span = das.length > 1 ? (das[das.length - 1].ts - das[0].ts) / 1e6 : SECS;
  /* the governor can demote the v2 page while it sits behind the v1 page; a run whose fill changed mid-run is flagged */
  const flipped = !!want && !!after && (after.glass !== want.glass || after.cards !== want.cards);
  return { p50: q(0.5), p95: q(0.95), fps: (das.length - 1) / span, over20: iv.filter((x) => x > 20).length / Math.max(1, iv.length), n: das.length, flipped, blurred: after?.blurred ?? 0 };
}

/** rename the 'bare' key for the JSON when it is really the chrome in flat (S2 audit F2) */
const named = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === 'bare' ? BARE_KEY : k, v]));
const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
interface Summary { p50: number; p95: number; fps: number; over20: number; flipped: number; blurred: number }

interface Env { window: WindowBounds | null; probed: boolean; displayHz: number; loadavg: number[] }
async function bench(browser: Browser, dsf: number, cfg: Cfg): Promise<{ sum: Record<Mode, Summary>; raw: Record<string, Run[]>; gpu: string; shipped: Shipped; pr: number; env: Env }> {
  const t0 = Date.now();
  browser.on('disconnected', () => console.log(`[browser] disconnected after ${Date.now() - t0} ms`));
  const fills: Mode[] = ['plates', 'flat', 'live'];
  const res = new Map<Mode, Run[]>((['v1', 'bare', ...fills] as Mode[]).map((m) => [m, []]));
  let asShipped: Shipped | null = null; let gpu = '?'; let pr = dsf; const env: Env = { window: null, probed: false, displayHz: Number.NaN, loadavg: loadavg() };
  for (let r = 0; r < REPS; r++) {
    for (const ui of (r % 2 ? ['v2', 'v1'] : ['v1', 'v2']) as Array<'v1' | 'v2'>) {
      console.log(`[bench] ${ui} r${r} boots at ${Date.now() - t0} ms`);
      const page = await boot(browser, ui, dsf, cfg);
      if (ui === 'v1') res.get('v1')!.push(await measure(browser, page, null));
      else {
        asShipped ??= await shipped(page);
        gpu = await page.evaluate(() => (window as unknown as { __deltaRenderQualityController?: { current?: { gpuLabel?: string } } }).__deltaRenderQualityController?.current?.gpuLabel ?? '?');
        pr = await page.evaluate(() => devicePixelRatio);
        if (!env.probed) { env.probed = true; env.window = await windowBounds(page); env.displayHz = await rafHz(page); }
        /* BARE: the same v2 page with no surfaces at all. It is the honest baseline for the chrome: v1's map is
           938x764 (a sidebar layout) with 11 blurred surfaces of its own, v2's is the full 1440x900, so v1 is a
           different workload and is kept in the JSON for reference only. */
        const order: Mode[] = r % 2 ? [...fills].reverse() : fills;
        for (const m of r % 2 ? [...order, 'bare' as Mode] : ['bare' as Mode, ...order]) {
          if (m === 'bare') await removeDummies(page);
          else if (!(await page.locator('[data-perf-dummy]').count()) && process.env.DUMMY !== '0') await addDummies(page);
          if (m !== 'bare') await setFill(page, m); else await setFill(page, 'flat');
          const want = await shipped(page);
          await page.waitForTimeout(500);
          res.get(m)!.push(await measure(browser, page, want));
        }
      }
      await page.context().close();
    }
  }
  const sum = Object.fromEntries([...res].map(([m, r]) => [m, { p50: med(r.map((x) => x.p50)), p95: med(r.map((x) => x.p95)), fps: med(r.map((x) => x.fps)), over20: med(r.map((x) => x.over20)), flipped: r.filter((x) => x.flipped).length, blurred: med(r.map((x) => x.blurred)) }])) as Record<Mode, Summary>;
  env.loadavg = loadavg();
  return { sum, raw: Object.fromEntries(res), gpu, shipped: asShipped!, pr, env };
}

for (const dsf of [1, 2]) {
  test(`perf gate @ DSF ${dsf} (spec §8.2)`, async ({ browser }) => {
    test.setTimeout(600_000);
    expect(!BINDING || CHROME_ONLY, 'the S9 gate is binding and measures the real chrome: set DUMMY=0').toBe(true);
    const { sum, raw, gpu, shipped: asShipped, pr, env } = await bench(browser, dsf, {});
    mkdirSync('/Volumes/OBOSLab/obos-v2/audits', { recursive: true });
    const cost = sum.live.p50 - sum.flat.p50;
    writeFileSync(OUT.replace('.json', `-dsf${dsf}.json`), JSON.stringify({ dsf, devicePixelRatio: pr, slice: SLICE, binding: BINDING, mode: CHROME_ONLY ? 'real-chrome (DUMMY=0)' : 'dummies', headless: HEADLESS, offscreen: HEADLESS ? null : !!env.window && offScreen(env.window), window: env.window, displayHz: env.displayHz, loadavg: env.loadavg, liveMinusFlatMs: cost, gpu, secs: SECS, reps: REPS, shippedState: asShipped, summary: named(sum), raw: named(raw) }, null, 1));
    console.log(JSON.stringify({ dsf, asShipped, env, cost, sum: named(sum) }));
    /* THE FOUNDER RULE: no window on any display. In new headless there is no window at all; if METAL ever goes headed again,
       Browser.getWindowBounds is the proof and this fails when macOS clamps the window back on screen. */
    if (!HEADLESS) expect(env.window && offScreen(env.window), `the browser window is on screen: ${JSON.stringify(env.window)}`).toBe(true);
    /* frames stayed at the display rate: an off-screen window that the OS throttled reads low for everything (S2 audit F9) */
    expect(sum.bare.fps, `off-screen window throttled: ${sum.bare.fps.toFixed(0)} fps against ${env.displayHz.toFixed(0)} Hz`).toBeGreaterThan(0.9 * env.displayHz);
    /* S2 audit F2(3): a loaded machine moves the cost by ~1.5 ms; v1's own p50 is the yardstick (7.0 quiet, 9.9 loaded) */
    if (dsf === 1) expect(sum.v1.p50, `environment loaded (loadavg ${env.loadavg.map((x) => x.toFixed(1)).join(' ')}), re-run`).toBeLessThanOrEqual(8.0);
    /* the shipped decision on a tier-2 desktop is Glass, live (spec §2.3) */
    expect(asShipped, 'v2 on a tier-2 desktop boots as Glass, live').toMatchObject({ tier: 'full', cards: 'glass', glass: 'live' });
    /* S1 audit F1(4): an occluded or throttled headed window reads low fps for everything and would pass vacuously */
    expect(sum.v1.fps, 'the headed window was occluded or throttled').toBeGreaterThan(50);
    /* From S2 the shell is real: with the 14 dummies ON TOP of it every surface would blur twice, so the S2+ measurement is DUMMY=0
       (the real chrome alone). The dummies remain for a chrome-less tree. */
    if (CHROME_ONLY) expect(sum.live.blurred, 'the real chrome blurs under live Glass').toBeGreaterThan(8);
    else expect(sum.live.blurred, 'every dummy surface is blurred under live Glass').toBeGreaterThanOrEqual(BOXES.length);
    expect(sum.flat.blurred + sum.plates.blurred, 'nothing is blurred in flat or Plates').toBe(0);
    for (const m of ['plates', 'flat', 'live'] as const) expect(sum[m].flipped, `${m}: the fill changed during a measured run (governor demotion)`).toBe(0);
    for (const m of ['plates', 'flat'] as const) {
      expect(sum[m].p50, `${m} p50 vs v1`).toBeLessThanOrEqual(sum.v1.p50 * 1.05);
      expect(sum[m].p95, `${m} p95 vs v1`).toBeLessThanOrEqual(sum.v1.p95 * 1.10);
      /* With DUMMY=0 the "bare" page is the real chrome in flat, so these would compare flat with flat: skipped (a true bare
         baseline needs the chrome removed). */
      if (CHROME_ONLY) continue;
      expect(sum[m].p50, `${m} p50 vs bare v2`).toBeLessThanOrEqual(sum.bare.p50 * 1.05);
      expect(sum[m].p95, `${m} p95 vs bare v2`).toBeLessThanOrEqual(sum.bare.p95 * 1.10);
    }
    expect(sum.live.p50 - sum.flat.p50, 'live Glass beyond the founder-accepted cost').toBeLessThanOrEqual(6.0);
  });
}

/* REPORT ONLY (OBOS_PERF_TIERS=1): the same fills on the tiers the gate cannot reach with a real GPU.
   Tier 1 and 0 are forced through the page's own hardwareConcurrency hint (render-quality.ts classifyHardware),
   and tier 0 is also run on SwiftShader. The rule never makes Glass live there; "live" is forced to show what it WOULD cost. */
const TIER_MATRIX: ReadonlyArray<{ name: string; args: string[]; cores: number; stress?: number; dsfs: readonly number[]; headless?: boolean }> = [
  { name: 'tier1-forced-metal', args: METAL, cores: 6, dsfs: [1, 2] },
  { name: 'tier0-forced-metal', args: METAL, cores: 2, dsfs: [1, 2] },
  /* SwiftShader has no vsync either way; headless like every other run (founder rule) */
  { name: 'tier0-swiftshader', args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cores: 0, dsfs: [1] },
  /* a GPU about 3x weaker (brainstorm 02's "map 3x stress"): is the live-Glass cost still inside the gate, and is the flat fill still free? */
  { name: 'tier2-metal-stress3', args: METAL, cores: 0, stress: 3, dsfs: [1] },
  { name: 'tier1-forced-metal-stress3', args: METAL, cores: 6, stress: 3, dsfs: [1] },
];
test.describe('tier matrix (report only)', () => {
  test.skip(!process.env.OBOS_PERF_TIERS, 'set OBOS_PERF_TIERS=1');
  for (const t of TIER_MATRIX) for (const dsf of t.dsfs) {
    test(`${t.name} @ DSF ${dsf}`, async () => {
      test.setTimeout(900_000);
      const browser = await chromium.launch({ args: t.args, headless: false });
      try {
        const { sum, raw, gpu, shipped: asShipped, pr, env } = await bench(browser, dsf, { cores: t.cores || undefined, stress: t.stress });
        mkdirSync('/Volumes/OBOSLab/obos-v2/audits', { recursive: true });
        writeFileSync(OUT.replace('.json', `-${t.name}-dsf${dsf}.json`), JSON.stringify({ tier: t.name, dsf, devicePixelRatio: pr, stress: t.stress ?? null, slice: SLICE, headless: t.headless ?? HEADLESS, window: env.window, displayHz: env.displayHz, loadavg: env.loadavg, gpu, secs: SECS, reps: REPS, shippedState: asShipped, summary: named(sum), raw: named(raw) }, null, 1));
        console.log(t.name, dsf, JSON.stringify({ asShipped, env, sum: named(sum) }));
      } finally { await browser.close(); }
    });
  }
});

type RQ = { __deltaRenderQualityController: { applyTier(t: number): void } };
const FONT_PROBE = '<p class="hero">31.4<span class="u">°C</span></p><p class="hero thin">12:30</p><b style="font-weight:500">−4 %</b>';

test('tier 2: Glass goes live; the governor\'s own demotion goes flat for the session; no digits font fetched on macOS', async ({ page }) => {
  test.setTimeout(180_000);
  const fonts: string[] = [];
  page.on('request', (r) => { if (/obos-num-/.test(r.url())) fonts.push(r.url()); });
  await page.addInitScript(() => { try { localStorage.setItem('obos:v2:cards', 'glass'); } catch { /* none */ } });
  await page.goto('/heat-map/in/kolkata/ballygunge/');
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-tier', 'full', { timeout: 60_000 });
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-glass', 'live');
  /* S1 audit F4: the assertion below is only as strong as what the page draws. Put visible digits in --sans first,
     so a stack that lists "OBOS Num" ahead of Helvetica Neue would fetch a woff2 and fail this test. */
  await page.evaluate((html) => { const d = document.createElement('div'); d.setAttribute('data-font-probe', ''); d.style.cssText = 'position:absolute;left:600px;top:300px;z-index:60'; d.innerHTML = html; document.querySelector('main.obos-v2')!.appendChild(d); }, FONT_PROBE);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  expect(fonts, 'Helvetica Neue covers digits on macOS; the subset must not download').toEqual([]);
  /* S1 audit F2: the governor's own notification path (no ?lab hook): applyTier(1) is what a real demotion calls. */
  await page.evaluate(() => (window as unknown as RQ).__deltaRenderQualityController.applyTier(1));
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-glass', 'flat');
});

test('tier 2: reduced transparency switched on mid-session goes flat, and the CSS alone stops the blur (S1 audit F3)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { try { localStorage.setItem('obos:v2:cards', 'glass'); } catch { /* none */ } });
  await page.goto('/heat-map/in/kolkata/ballygunge/');
  const root = page.locator('main.obos-v2');
  await expect(root).toHaveAttribute('data-glass', 'live', { timeout: 60_000 });
  await page.evaluate(() => { const p = document.createElement('div'); p.className = 'card'; p.setAttribute('data-rt-probe', ''); document.querySelector('main.obos-v2')!.appendChild(p); });
  const blur = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('[data-rt-probe]')!).backdropFilter);
  expect(await blur(), 'a live Glass card blurs').not.toBe('none');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await expect(root, 'the attribute stays truthful').toHaveAttribute('data-glass', 'flat');
  expect(await blur()).toBe('none');
  /* the CSS belt on its own: force the attribute back to live under the media feature */
  await page.evaluate(() => { document.querySelector<HTMLElement>('main.obos-v2')!.dataset.glass = 'live'; });
  expect(await blur(), 'prefers-reduced-transparency blurs nothing even if the attribute lags').toBe('none');
});
