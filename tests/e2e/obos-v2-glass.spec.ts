// tests/e2e/obos-v2-glass.spec.ts — OBOS v2 spec §8.2. LOCAL ONLY (needs a real GPU).
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PW_ORIGIN, V2_STORAGE_STATE } from './fixtures/ui-v2-state';

const SLICE = process.env.OBOS_V2_SLICE ?? 's1';
const OUT = `/Volumes/OBOSLab/obos-v2/audits/perf-${SLICE}${process.env.OBOS_PERF_THEME ? `-${process.env.OBOS_PERF_THEME}` : ''}.json`;
const SECS = Number(process.env.OBOS_PERF_SECS ?? 5), REPS = Number(process.env.OBOS_PERF_REPS ?? 3);
const METAL = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
type Mode = 'v1' | 'plates' | 'flat' | 'live';

/* The v2 surfaces at 1440x900 (brainstorm 02 §1 geometry), as REAL v2 elements so the
   shipped token CSS decides fill and filter. Rerun in S9 against the full chrome
   (OBOS_V2_SLICE=s9 with DUMMY=0). */
const BOXES: ReadonlyArray<[string, number, number, number, number]> = [
  ['rail', 16, 16, 220, 430], ['side-panel', 248, 16, 300, 788], ['card', 564, 16, 300, 190], ['compass', 564, 216, 68, 68],
  ['card', 16, 640, 220, 110], ['card', 16, 460, 220, 170], ['card', 1104, 68, 320, 400], ['card', 1104, 478, 320, 300], ['bar', 600, 830, 440, 56],
];

interface Cfg { readonly cores?: number; readonly stress?: number }

/* ONE PAGE ALIVE AT A TIME. Display::DrawAndSwap in a trace is browser-wide: with a second page open, its
   frames interleave with the measured page's and the intervals halve (measured: p50 4 ms and 163 fps on a
   144 Hz display). So every pass boots a fresh page, measures it alone, and closes it. The display must be the
   real one too (see the project's headless:false): a headless Chromium has no vsync and reads 1 ms frames.
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
  if (ui === 'v2' && process.env.DUMMY !== '0') {
    await page.evaluate((boxes) => {
      const root = document.querySelector('main.obos-v2')!;
      for (const [cls, l, t, w, h] of boxes) {
        const d = document.createElement('div');
        d.className = cls; d.setAttribute('data-perf-dummy', '');
        Object.assign(d.style, { position: 'absolute', left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px`, zIndex: '40' });
        d.innerHTML = '<b style="font-size:40px;font-weight:200">31.4°</b><br>Ballygunge · KMC Ward 68';
        root.appendChild(d);
      }
    }, BOXES);
  }
  /* a weaker GPU, simulated the way brainstorm 02 did: the map renders at a higher pixel ratio */
  if (cfg.stress) await page.evaluate((k) => (window as unknown as { __obosMap: { setPixelRatio(n: number): void } }).__obosMap.setPixelRatio(k), cfg.stress);
  await page.evaluate(() => {
    const m = (window as unknown as { __obosMap: { getBearing(): number; jumpTo(o: { bearing: number }): void } }).__obosMap;
    const b0 = m.getBearing(); const t0 = performance.now();
    const f = (t: number) => { m.jumpTo({ bearing: b0 + ((t - t0) / 1000) * 30 }); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.bringToFront();
  await page.waitForTimeout(1000);
  return page;
}

interface Shipped { glass: string | null; cards: string | null; tier: string | null; theme: string | null; blurred: number }
const shipped = (page: Page): Promise<Shipped> => page.evaluate(() => {
  const r = document.querySelector<HTMLElement>('main.obos-v2');
  /* how many v2 surfaces the compositor is actually asked to blur right now */
  const blurred = r ? [...r.querySelectorAll('[data-perf-dummy]')].filter((e) => { const v = getComputedStyle(e).backdropFilter; return !!v && v !== 'none'; }).length : 0;
  return { glass: r?.dataset.glass ?? null, cards: r?.dataset.cards ?? null, tier: r?.dataset.tier ?? null, theme: r?.dataset.theme ?? null, blurred };
});
const setFill = (page: Page, mode: Mode): Promise<void> => page.evaluate((m) => {
  const r = document.querySelector<HTMLElement>('main.obos-v2')!;
  r.dataset.cards = m === 'plates' ? 'plates' : 'glass';
  r.dataset.glass = m === 'live' ? 'live' : 'flat';
}, mode);

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

const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
interface Summary { p50: number; p95: number; fps: number; over20: number; flipped: number; blurred: number }

async function bench(browser: Browser, dsf: number, cfg: Cfg): Promise<{ sum: Record<Mode, Summary>; raw: Record<string, Run[]>; gpu: string; shipped: Shipped; pr: number }> {
  const t0 = Date.now();
  browser.on('disconnected', () => console.log(`[browser] disconnected after ${Date.now() - t0} ms`));
  const fills: Mode[] = ['plates', 'flat', 'live'];
  const res = new Map<Mode, Run[]>((['v1', ...fills] as Mode[]).map((m) => [m, []]));
  let asShipped: Shipped | null = null; let gpu = '?'; let pr = dsf;
  for (let r = 0; r < REPS; r++) {
    for (const ui of (r % 2 ? ['v2', 'v1'] : ['v1', 'v2']) as Array<'v1' | 'v2'>) {
      console.log(`[bench] ${ui} r${r} boots at ${Date.now() - t0} ms`);
      const page = await boot(browser, ui, dsf, cfg);
      if (ui === 'v1') res.get('v1')!.push(await measure(browser, page, null));
      else {
        asShipped ??= await shipped(page);
        gpu = await page.evaluate(() => (window as unknown as { __deltaRenderQualityController?: { current?: { gpuLabel?: string } } }).__deltaRenderQualityController?.current?.gpuLabel ?? '?');
        pr = await page.evaluate(() => devicePixelRatio);
        for (const m of r % 2 ? [...fills].reverse() : fills) {
          await setFill(page, m);
          const want = await shipped(page);
          await page.waitForTimeout(500);
          res.get(m)!.push(await measure(browser, page, want));
        }
      }
      await page.context().close();
    }
  }
  const sum = Object.fromEntries([...res].map(([m, r]) => [m, { p50: med(r.map((x) => x.p50)), p95: med(r.map((x) => x.p95)), fps: med(r.map((x) => x.fps)), over20: med(r.map((x) => x.over20)), flipped: r.filter((x) => x.flipped).length, blurred: med(r.map((x) => x.blurred)) }])) as Record<Mode, Summary>;
  return { sum, raw: Object.fromEntries(res), gpu, shipped: asShipped!, pr };
}

for (const dsf of [1, 2]) {
  test(`perf gate @ DSF ${dsf} (spec §8.2)`, async ({ browser }) => {
    test.setTimeout(600_000);
    const { sum, raw, gpu, shipped: asShipped, pr } = await bench(browser, dsf, {});
    mkdirSync('/Volumes/OBOSLab/obos-v2/audits', { recursive: true });
    writeFileSync(OUT.replace('.json', `-dsf${dsf}.json`), JSON.stringify({ dsf, devicePixelRatio: pr, slice: SLICE, gpu, secs: SECS, reps: REPS, shippedState: asShipped, summary: sum, raw }, null, 1));
    console.log(JSON.stringify({ dsf, asShipped, sum }));
    /* the shipped decision on a tier-2 desktop is Glass, live (spec §2.3) */
    expect(asShipped, 'v2 on a tier-2 desktop boots as Glass, live').toMatchObject({ tier: 'full', cards: 'glass', glass: 'live' });
    expect(sum.live.blurred, 'every dummy surface is blurred under live Glass').toBe(BOXES.length);
    expect(sum.flat.blurred + sum.plates.blurred, 'nothing is blurred in flat or Plates').toBe(0);
    for (const m of ['plates', 'flat', 'live'] as const) expect(sum[m].flipped, `${m}: the fill changed during a measured run (governor demotion)`).toBe(0);
    for (const m of ['plates', 'flat'] as const) {
      expect(sum[m].p50, `${m} p50 vs v1`).toBeLessThanOrEqual(sum.v1.p50 * 1.05);
      expect(sum[m].p95, `${m} p95 vs v1`).toBeLessThanOrEqual(sum.v1.p95 * 1.10);
    }
    expect(sum.live.p50 - sum.flat.p50, 'live Glass beyond the founder-accepted cost').toBeLessThanOrEqual(6.0);
  });
}

/* REPORT ONLY (OBOS_PERF_TIERS=1): the same fills on the tiers the gate cannot reach with a real GPU.
   Tier 1 and 0 are forced through the page's own hardwareConcurrency hint (render-quality.ts classifyHardware),
   and tier 0 is also run on SwiftShader. The rule never makes Glass live there; "live" is forced to show what it WOULD cost. */
const TIER_MATRIX: ReadonlyArray<{ name: string; args: string[]; cores: number; stress?: number; dsfs: readonly number[] }> = [
  { name: 'tier1-forced-metal', args: METAL, cores: 6, dsfs: [1, 2] },
  { name: 'tier0-forced-metal', args: METAL, cores: 2, dsfs: [1, 2] },
  { name: 'tier0-swiftshader', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cores: 0, dsfs: [1] },
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
        const { sum, raw, gpu, shipped: asShipped, pr } = await bench(browser, dsf, { cores: t.cores || undefined, stress: t.stress });
        mkdirSync('/Volumes/OBOSLab/obos-v2/audits', { recursive: true });
        writeFileSync(OUT.replace('.json', `-${t.name}-dsf${dsf}.json`), JSON.stringify({ tier: t.name, dsf, devicePixelRatio: pr, stress: t.stress ?? null, slice: SLICE, gpu, secs: SECS, reps: REPS, shippedState: asShipped, summary: sum, raw }, null, 1));
        console.log(t.name, dsf, JSON.stringify({ asShipped, sum }));
      } finally { await browser.close(); }
    });
  }
});

test('tier 2: Glass goes live; a demotion goes flat for the session; no digits font fetched on macOS', async ({ page }) => {
  test.setTimeout(180_000);
  const fonts: string[] = [];
  page.on('request', (r) => { if (/obos-num-/.test(r.url())) fonts.push(r.url()); });
  await page.addInitScript(() => { try { localStorage.setItem('obos:v2:cards', 'glass'); } catch { /* none */ } });
  await page.goto('/heat-map/in/kolkata/ballygunge/?lab=1');
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-tier', 'full', { timeout: 60_000 });
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-glass', 'live');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:render-quality-test', { detail: { tier: 1 } })));
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-glass', 'flat');
  await page.waitForTimeout(2000);
  expect(fonts, 'Helvetica Neue covers digits on macOS; the subset must not download').toEqual([]);
});
