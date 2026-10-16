// tests/e2e/obos-v1-unchanged.spec.ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* THE v1-UNCHANGED PROOF (spec §8.3). Recorded ONCE on the untouched worktree
   (7eb32e8) with V1_BASELINE=record, then compared at every slice gate with the
   v2 flag OFF. Local only: the baseline lives on the OBOSLab volume. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '/Volumes/OBOSLab/obos-v2/shots/v1-baseline';
const RECORD = process.env.V1_BASELINE === 'record';
const FIX = join(ROOT, 'tests/fixtures/metar');
const METAR = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8')) as { icaoId: string; rawOb: string }[];
const METNO = readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8');
const SERVER_NOW = '2026-10-07T06:05:00Z';

/* Ids whose box legitimately differs between two recordings of the SAME build.
   Added ONLY when the record-time determinism check names them, each with a reason.
   Empty means the snapshot is fully deterministic. */
const VOLATILE: readonly string[] = [];

const PAGES = [
  'heat-map/in/kolkata/ballygunge',
  'heat-map/in/bengaluru/mg-road',
  'heat-map/ae/dubai/al-quoz',
  'heat-map/compare',
  'heat-map/brief',
] as const;

const PROPS = ['display', 'position', 'visibility', 'opacity', 'z-index', 'color', 'background-color',
  'border-top-color', 'font-family', 'font-size', 'font-weight'] as const;

function v1Main(html: string): string {
  const start = html.indexOf('<main id="main"');
  if (start < 0) throw new Error('no <main id="main"> in the page');
  const end = html.indexOf('</main>', start);
  if (end < 0) throw new Error('unterminated <main id="main">');
  return html.slice(start, end + '</main>'.length);
}

async function stub(page: Page): Promise<void> {
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(SERVER_NOW).toUTCString(), age: '0' }, body: METNO,
  }));
  await page.route(/\/api\/metar\?/, (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? [];
    void route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date(SERVER_NOW).toUTCString() },
      body: JSON.stringify({
        source: 'aviationweather.gov', fetchedAt: '2026-10-07T06:09:00.000Z',
        reports: METAR.filter((r) => ids.includes(r.icaoId)).map((r) => ({ icao: r.icaoId, raw: r.rawOb })),
      }),
    });
  });
  await page.route(/\/api\/air-quality/, (route) => route.fulfill({ status: 503, body: '' }));
}

async function open(page: Page, path: string): Promise<void> {
  await page.clock.setFixedTime(new Date(SERVER_NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await stub(page);
  await page.goto(`/${path}/`);
  if (path.includes('/in/')) {
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 60_000 });
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  }
  if (path.endsWith('compare')) {
    /* the bench runs its model in a worker; paired-controller.ts:315 clears aria-busy when it lands */
    await expect(page.locator('[data-compare-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 });
  }
  await page.addStyleTag({ content: '#mlmap canvas, canvas.maplibregl-canvas, [data-compare-root] canvas { visibility: hidden !important; }' });
  await page.waitForTimeout(3000);
  /* `.livedot.on{animation:hmPulse}` out-ranks the reduced-motion `.livedot{animation:none}`, so
     the dot pulses under reduced motion and its opacity is a function of wall time. Freeze every
     running animation at t=0 (does not touch the CSS, so a lost @keyframes would still show). */
  await freezeAnimations(page);
}

async function freezeAnimations(page: Page): Promise<void> {
  await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; } });
  await page.waitForTimeout(250);
}

async function snapshot(page: Page): Promise<string[]> {
  const lines = await page.evaluate((props) => {
    const r = (n: number) => Math.round(n * 2) / 2;
    const root = document.querySelector('main#main');
    if (!root) throw new Error('no main#main');
    const all = [document.body, root, ...Array.from(root.querySelectorAll('*'))];
    return all.map((el, i) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' ? el.className : '';
      return `${i}|${el.tagName.toLowerCase()}#${el.id}.${cls}|${r(b.x)},${r(b.y)},${r(b.width)},${r(b.height)}|`
        + props.map((p) => cs.getPropertyValue(p)).join('|');
    });
  }, [...PROPS]);
  return lines.filter((l) => !VOLATILE.some((id) => l.includes(`#${id}.`)));
}

type View = { name: string; path: string; mobile: boolean; clay: boolean };
const VIEWS: readonly View[] = [
  { name: 'ballygunge-dark', path: PAGES[0], mobile: false, clay: false },
  { name: 'ballygunge-clay', path: PAGES[0], mobile: false, clay: true },
  { name: 'ballygunge-phone', path: PAGES[0], mobile: true, clay: false },
  { name: 'compare-dark', path: PAGES[3], mobile: false, clay: false },
];

async function capture(browser: Browser, v: View): Promise<{ lines: string[]; png: Buffer }> {
  /* browser.newContext() does not inherit the project's `use`, so baseURL is passed here. */
  const ctx = await browser.newContext(v.mobile
    ? { baseURL: 'http://127.0.0.1:4322', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { baseURL: 'http://127.0.0.1:4322', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await open(page, v.path);
  if (v.clay) {
    await page.locator('#envchip button[data-e="studio"]').click();
    await page.waitForTimeout(4000);
    await freezeAnimations(page);
  }
  const lines = await snapshot(page);
  const png = await page.screenshot();
  await ctx.close();
  return { lines, png };
}

test.describe('v1 unchanged (spec §8.3)', () => {
  test.skip(!!process.env.CI, 'local only: the baseline lives on /Volumes/OBOSLab');
  test.setTimeout(240_000);

  test('built v1 <main> markup is byte-identical to the 7eb32e8 baseline', () => {
    mkdirSync(join(BASE, 'markup'), { recursive: true });
    for (const p of PAGES) {
      const main = v1Main(readFileSync(join(ROOT, 'dist', p, 'index.html'), 'utf8'));
      const file = join(BASE, 'markup', `${p.replaceAll('/', '_')}.html`);
      if (RECORD) { writeFileSync(file, main); continue; }
      expect(existsSync(file), `baseline missing: ${file}`).toBe(true);
      expect(main === readFileSync(file, 'utf8'), `${p}: the v1 <main> changed`).toBe(true);
    }
  });

  for (const v of VIEWS) {
    test(`computed style and pixels: ${v.name}`, async ({ browser }) => {
      mkdirSync(join(BASE, 'style'), { recursive: true });
      const file = join(BASE, 'style', `${v.name}.json`);
      const a = await capture(browser, v);
      if (RECORD) {
        const b = await capture(browser, v);
        const diff = a.lines.filter((l, i) => l !== b.lines[i]);
        expect(diff, 'NON-DETERMINISTIC nodes: add their ids to VOLATILE with a reason, then re-record').toEqual([]);
        writeFileSync(file, JSON.stringify(a.lines, null, 0));
      } else {
        const want = JSON.parse(readFileSync(file, 'utf8')) as string[];
        const diff = a.lines.map((l, i) => (l === want[i] ? null : `got  ${l}\nwant ${want[i]}`)).filter(Boolean);
        expect(a.lines.length, 'element count changed').toBe(want.length);
        expect(diff.slice(0, 20)).toEqual([]);
      }
      expect(a.png).toMatchSnapshot(`${v.name}.png`, { maxDiffPixels: 0 });
    });
  }
});
