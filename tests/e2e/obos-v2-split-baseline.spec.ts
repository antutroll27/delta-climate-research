// tests/e2e/obos-v2-split-baseline.spec.ts — OBOS v2 plan amendment A1, Task S2.9.
// THE SPLIT CHANGES NOTHING: recorded at the S2.8 head with V2_SPLIT=record, compared after S2.9.
// Local only, and skipped unless V2_SPLIT is set (it is a one-off gate, deleted in S8).
import { expect, test, type Browser } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubWeather } from './obos-v2-helpers';
import { PW_ORIGIN as ORIGIN } from './fixtures/ui-v2-state';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '/Volumes/OBOSLab/obos-v2/shots/v2-split-baseline';
const RECORD = process.env.V2_SPLIT === 'record';
const SERVER_NOW = '2026-10-07T06:05:00Z';
const VOLATILE: readonly string[] = [];   // ids only, each with a `// reason`, added only when the record-time check names them
const PAGES = ['heat-map/in/kolkata/ballygunge', 'heat-map/in/bengaluru/mg-road', 'heat-map/ae/dubai/al-quoz'] as const;
const PROPS = ['display', 'position', 'visibility', 'opacity', 'z-index', 'color', 'background-color',
  'border-top-color', 'font-family', 'font-size', 'font-weight'] as const;

/** The v2 template. Whitespace between and inside tags is collapsed: a component may re-indent
    the markup, never re-shape it. Text-node whitespace that matters is caught by the pixels. */
function v2Tree(html: string): string {
  const s = html.indexOf('<template id="obos-v2-tree">');
  const e = html.indexOf('</template>', s);
  if (s < 0 || e < 0) throw new Error('no v2 template');
  return html.slice(s, e).replace(/>\s+</g, '><').replace(/\s+/g, ' ');
}

type View = { name: string; path: string; mobile?: boolean; prefs?: Record<string, string>; click?: string };
const VIEWS: readonly View[] = [
  { name: 'ballygunge-overview-dark', path: PAGES[0] },
  { name: 'ballygunge-overview-light', path: PAGES[0], prefs: { 'obos:v2:theme': 'light', 'obos:v2:look-chosen': '1' } },
  { name: 'ballygunge-solar', path: PAGES[0], click: '.nav-item[data-section="solar"]' },
  { name: 'ballygunge-phone', path: PAGES[0], mobile: true },
  { name: 'al-quoz-dark', path: PAGES[2] },
];

async function capture(browser: Browser, v: View): Promise<{ lines: string[]; png: Buffer }> {
  const ls = [{ name: 'obos:ui', value: 'v2' }, ...Object.entries(v.prefs ?? {}).map(([name, value]) => ({ name, value }))];
  const storageState = { cookies: [], origins: [{ origin: ORIGIN, localStorage: ls }] };
  const ctx = await browser.newContext(v.mobile
    ? { baseURL: ORIGIN, storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { baseURL: ORIGIN, storageState, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(SERVER_NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await stubWeather(page, SERVER_NOW);
  await page.route(/\/api\/air-quality/, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto(`/${v.path}/`);
  await expect(page.locator('main.obos-v2')).toHaveCount(1);
  if (v.path.includes('/in/')) {
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 60_000 });
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  }
  if (v.click) await page.locator(v.click).click();
  await page.addStyleTag({ content: '#mlmap canvas, canvas.maplibregl-canvas { visibility: hidden !important; }' });
  await page.waitForTimeout(3000);
  const lines = await page.evaluate((props) => {
    const r = (n: number) => Math.round(n * 2) / 2;
    const root = document.querySelector('main.obos-v2');
    if (!root) throw new Error('no main.obos-v2');
    return [document.body, root, ...Array.from(root.querySelectorAll('*'))].map((el, i) => {
      const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' ? el.className : '';
      return `${i}|${el.tagName.toLowerCase()}#${el.id}.${cls}|${r(b.x)},${r(b.y)},${r(b.width)},${r(b.height)}|` + props.map((p) => cs.getPropertyValue(p)).join('|');
    });
  }, [...PROPS]);
  const png = await page.screenshot();
  await ctx.close();
  return { lines: lines.filter((l) => !VOLATILE.some((id) => l.includes(`#${id}.`))), png };
}

test.describe('A1 split: v2 unchanged', () => {
  test.skip(!process.env.V2_SPLIT, 'run only as the S2.9 gate (V2_SPLIT=record|compare)');
  test.setTimeout(240_000);

  test('built v2 template markup is unchanged (whitespace-normalised)', () => {
    mkdirSync(join(BASE, 'markup'), { recursive: true });
    for (const p of PAGES) {
      const tree = v2Tree(readFileSync(join(ROOT, 'dist', p, 'index.html'), 'utf8'));
      const file = join(BASE, 'markup', `${p.replaceAll('/', '_')}.html`);
      if (RECORD) { writeFileSync(file, tree); continue; }
      expect(existsSync(file), `baseline missing: ${file}`).toBe(true);
      expect(tree === readFileSync(file, 'utf8'), `${p}: the v2 tree changed`).toBe(true);
    }
  });

  for (const v of VIEWS) {
    test(`computed style and pixels: ${v.name}`, async ({ browser }) => {
      mkdirSync(join(BASE, 'style'), { recursive: true });
      const file = join(BASE, 'style', `${v.name}.json`);
      const a = await capture(browser, v);
      if (RECORD) {
        const b = await capture(browser, v);
        expect(a.lines.filter((l, i) => l !== b.lines[i]), 'NON-DETERMINISTIC nodes: add their ids to VOLATILE with a reason').toEqual([]);
        writeFileSync(file, JSON.stringify(a.lines));
      } else {
        const want = JSON.parse(readFileSync(file, 'utf8')) as string[];
        expect(a.lines.length, 'element count changed').toBe(want.length);
        expect(a.lines.map((l, i) => (l === want[i] ? null : `got  ${l}\nwant ${want[i]}`)).filter(Boolean).slice(0, 20)).toEqual([]);
      }
      expect(a.png).toMatchSnapshot(`${v.name}.png`, { maxDiffPixels: 0 });
    });
  }
});
