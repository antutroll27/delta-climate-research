import { expect, test, type Page } from '@playwright/test';

/**
 * A WARD SWITCH IS ATOMIC, ON THE RELIEF PATH, IN CI.
 *
 * WHY THIS FILE EXISTS. The in-depth ward-switch audit (2026-10-04) found that
 * nothing in CI ever switched wards with the 3-D city loaded. The default project
 * is tier 0 (SwiftShader) and boots the 2-D isotherm; the relief project is local
 * only. Clicking `#modechip [data-m=relief]` loads the full Three.js renderer on
 * SwiftShader, so every test here does that first and runs in BOTH projects.
 *
 * WHAT IT GUARDS, TWO TESTS:
 *   1. the switch-matrix walk: every readout that names the ward agrees, the strip
 *      tile equals the headline mean, the engine is the one it booted with, and
 *      no figure is ever shown under another ward's name (C1, C2, I1);
 *   2. failure atomicity: a ward file that 500s, a throw inside the commit, and a
 *      throw inside the URL projection all leave EVERYTHING on the previous ward,
 *      the reader can click back and retry (C1, M1); then a consumer-side error
 *      drops a frame instead of demoting the engine (C2).
 *
 * SLOW BUT RUN: each switch waits for the relief scene and a solve on SwiftShader.
 */

const kol = (w: string) => `/heat-map/in/kolkata/${w}/`;

const WARDS: Record<string, { name: RegExp; count: RegExp }> = {
  ballygunge: { name: /^Ballygunge$/, count: /^2,207 buildings in KMC Ward 68 · 7,931 drawn$/ },
  baruipur: { name: /^Baruipur$/, count: /^4,538 real buildings$/ },
  barrackpore: { name: /^Barrackpore$/, count: /^4,702 real buildings$/ },
  indiranagar: { name: /^Indiranagar$/, count: /^14,867 real buildings$/ },
  whitefield: { name: /^Whitefield$/, count: /^10,897 real buildings$/ },
};

/** Everything on the page that states which ward is open, plus the figures. */
async function ui(page: Page) {
  return page.evaluate(() => {
    const t = (id: string) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const sel = document.querySelector<HTMLSelectElement>('select[data-scope="area"]');
    const on = document.querySelector<HTMLElement>('#strip .ward.on');
    return {
      url: location.pathname,
      title: document.title,
      crumb: t('crumbArea'),
      select: sel?.value ?? null,
      dataArea: document.querySelector('.stage')?.getAttribute('data-area') ?? null,
      pname: t('pname'),
      bcount: t('bcount'),
      lst: t('lst'),
      stripOn: on?.dataset.w ?? null,
      tile: on ? (on.querySelector('.big')?.textContent?.replace(/\s+/g, ' ').trim() ?? null) : null,
      sim: t('simBackend'),
      chip: t('loadchip'),
      chipOn: document.getElementById('loadchip')?.classList.contains('on') ?? false,
      /* A hidden chip keeps its last words, so a failure is the words AND the chip up. */
      failed: (() => { const c = document.getElementById('loadchip'); return !!c && c.classList.contains('on') && c.classList.contains('fail'); })(),
    };
  });
}
type UI = Awaited<ReturnType<typeof ui>>;

/** Every statement of the open ward names `ward`, and the strip tile is the headline mean. */
function expectNames(u: UI, ward: string, city = 'kolkata') {
  const key = `in/${city}/${ward}`;
  expect.soft(u.pname, `pname for ${ward}`).toMatch(WARDS[ward].name);
  expect.soft(u.crumb, `crumb for ${ward}`).toMatch(WARDS[ward].name);
  expect.soft(u.url, `URL for ${ward}`).toBe(`/heat-map/${key}/`);
  expect.soft(u.select, `Area select for ${ward}`).toBe(key);
  expect.soft(u.dataArea, `stage data-area for ${ward}`).toBe(key);
  expect.soft(u.stripOn, `strip highlight for ${ward}`).toBe(ward);
  expect.soft(u.title, `title for ${ward}`).toMatch(new RegExp(`^${WARDS[ward].name.source.slice(1, -1)} `));
  expect.soft(u.bcount, `building count for ${ward}`).toMatch(WARDS[ward].count);
  const mean = (s: string | null) => s?.match(/^(\d+\.\d)/)?.[1] ?? null;
  expect.soft(mean(u.lst), `#lst is a figure on ${ward}`).not.toBeNull();
  expect.soft(mean(u.tile), `strip tile = #lst on ${ward}`).toBe(mean(u.lst));
}

/** Capture console warnings/errors that name a ward switch or the sim, from first paint. */
async function captureConsole(page: Page): Promise<string[]> {
  const lines: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'warning' && m.type() !== 'error') return;
    const t = m.text();
    if (/could not load|Heat simulation unavailable|RangeError|frame dropped|rolled back/i.test(t)) lines.push(t.split('\n')[0]);
  });
  page.on('pageerror', (e) => lines.push(`[pageerror] ${e.message}`));
  return lines;
}

async function expectFailed(page: Page, name: string) {
  const chip = page.locator('#loadchip');
  await expect(chip).toHaveClass(/\bfail\b/, { timeout: 30_000 });
  await expect(chip).toHaveClass(/\bon\b/);
  await expect(chip).toHaveText(`${name} could not load.`);
}

async function settle(page: Page, ward: string, timeout = 90_000) {
  await page.waitForFunction((w) => {
    const chip = document.getElementById('loadchip');
    if (chip?.classList.contains('on') && chip.classList.contains('fail')) return true;
    const on = document.querySelector<HTMLElement>('#strip .ward.on')?.dataset.w;
    const lst = document.getElementById('lst')?.textContent ?? '';
    return on === w && /\d/.test(lst) && !/—/.test(lst) && !chip?.classList.contains('on');
  }, ward, { timeout, polling: 100 });
}

/** Boot a ward page and put it on the 3-D relief path, whatever the tier chose. */
async function bootRelief(page: Page, url: string, ward: string) {
  await page.goto(url);
  await expect(page.locator('#simBackend')).not.toHaveText(/selecting/i, { timeout: 60_000 });
  await page.locator('#modechip button[data-m="relief"]').click();
  await expect(page.locator('#modechip button[data-m="relief"]')).toHaveClass(/on/);
  /* The relief chunk is fetched and the scene built; wait for the ward's figures. */
  await settle(page, ward);
  await page.waitForTimeout(1500);
}

/**
 * A MUTATION OBSERVER + 50 ms POLL over the readouts, from before the click.
 *
 * Every time #pname or a figure changes, record (pname, signature of the figures).
 * The signature is the headline mean, Δ vs reference, %>40 and all twelve histogram
 * heights — a coincidence across wards on all of those is not a real risk.
 */
async function startWatch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __rec: Array<{ t: number; pname: string; sig: string; blank: boolean }>; __obs?: MutationObserver; __iv?: number };
    w.__rec = [];
    const t0 = performance.now();
    const read = () => {
      const tx = (id: string) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const lst = tx('lst');
      const bars = [...(document.getElementById('histo')?.children ?? [])].map((b) => (b as HTMLElement).style.height).join(',');
      const sig = `${lst}|${tx('uhi')}|${tx('area')}|${bars}`;
      const pname = tx('pname');
      const last = w.__rec[w.__rec.length - 1];
      if (last && last.pname === pname && last.sig === sig) return;
      w.__rec.push({ t: Math.round(performance.now() - t0), pname, sig, blank: !/\d/.test(lst) || /—/.test(lst) });
    };
    read();
    w.__obs = new MutationObserver(read);
    for (const id of ['pname', 'lst', 'uhi', 'area', 'histo']) {
      const node = document.getElementById(id);
      if (node) w.__obs.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
    }
    w.__iv = window.setInterval(read, 50);
  });
}
async function stopWatch(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __rec: Array<{ t: number; pname: string; sig: string; blank: boolean }>; __obs?: MutationObserver; __iv?: number };
    w.__obs?.disconnect(); clearInterval(w.__iv);
    return w.__rec;
  });
}

/** No figure seen while `from` was named may be shown while `to` is named. */
function expectNoStaleFigures(rec: Array<{ t: number; pname: string; sig: string; blank: boolean }>, from: RegExp, to: RegExp) {
  const old = new Set(rec.filter((r) => from.test(r.pname) && !r.blank).map((r) => r.sig));
  const stale = rec.filter((r) => to.test(r.pname) && !r.blank && old.has(r.sig));
  expect.soft(stale.map((r) => `${r.t}ms ${r.pname}: ${r.sig.split('|')[0]}`),
    `a figure from ${from.source} shown under ${to.source}`).toEqual([]);
}

test.describe('ward switch on the relief path', () => {

  test('switch-matrix walk: every readout agrees, the engine holds, no stale figure', async ({ page }) => {
    test.setTimeout(600_000);
    const lines = await captureConsole(page);
    await bootRelief(page, kol('ballygunge'), 'ballygunge');
    const boot = await ui(page);
    expectNames(boot, 'ballygunge');
    const walk = ['baruipur', 'barrackpore', 'ballygunge', 'barrackpore', 'baruipur', 'ballygunge'];
    let from = 'ballygunge';
    for (const ward of walk) {
      await startWatch(page);
      await page.locator(`#strip .ward[data-w="${ward}"]`).click();
      await settle(page, ward);
      await page.waitForTimeout(1200);
      const rec = await stopWatch(page);
      const u = await ui(page);
      expect.soft(u.failed, `${from} -> ${ward}: load failed (${u.chip})`).toBe(false);
      expectNames(u, ward);
      expect.soft(u.sim, `${from} -> ${ward}: engine`).toBe(boot.sim);
      expectNoStaleFigures(rec, WARDS[from].name, WARDS[ward].name);
      from = ward;
    }
    expect(lines.filter((l) => !/frame dropped/i.test(l))).toEqual([]);
  });

  test('a failed switch leaves everything on the previous ward, and back and retry both work', async ({ page }) => {
    test.setTimeout(600_000);
    const lines = await captureConsole(page);
    await page.route('**/heat-map/data/baruipur.json', (r) => r.fulfill({ status: 500, body: 'injected' }));
    await bootRelief(page, kol('ballygunge'), 'ballygunge');
    const before = await ui(page);

    /* (a) THE DATA FILE 500s, chosen from the scope switcher's Area select. */
    await page.locator('select[data-scope="area"]').evaluate((s: HTMLSelectElement) => {
      s.value = 'in/kolkata/baruipur'; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expectFailed(page, 'Baruipur');
    await page.waitForTimeout(1500);
    let u = await ui(page);
    expectNames(u, 'ballygunge');
    expect.soft(u.sim, 'engine after a 500').toBe(before.sim);

    /* Retry once the file answers. */
    await page.unroute('**/heat-map/data/baruipur.json');
    await page.locator('#strip .ward[data-w="baruipur"]').click();
    await settle(page, 'baruipur');
    await page.waitForTimeout(1000);
    u = await ui(page);
    expect.soft(u.failed, `retry after a 500 (${u.chip})`).toBe(false);
    expectNames(u, 'baruipur');

    /* (b) A THROW INSIDE THE COMMIT, after the ward's base layers are assigned:
       the Tree-canopy row's `hidden` setter throws exactly once. */
    await page.evaluate(() => {
      const v = document.getElementById('vegw') as HTMLElement & { __armed?: boolean };
      Object.defineProperty(v, 'hidden', {
        configurable: true,
        get() { return this.hasAttribute('hidden'); },
        set(val: boolean) {
          if (v.__armed) { v.__armed = false; throw new Error('INJECTED commit failure'); }
          if (val) this.setAttribute('hidden', ''); else this.removeAttribute('hidden');
        },
      });
      v.__armed = true;
    });
    await page.locator('#strip .ward[data-w="barrackpore"]').click();
    await expectFailed(page, 'Barrackpore');
    await page.waitForTimeout(3000);
    u = await ui(page);
    expectNames(u, 'baruipur');
    expect.soft(u.sim, 'engine after a commit throw').toBe(before.sim);

    /* Clicking back on the ward that is on screen is honoured (not a stuck chip). */
    await page.locator('#strip .ward[data-w="baruipur"]').click();
    await page.waitForTimeout(1000);
    u = await ui(page);
    expect.soft(u.chipOn, 'the failure chip stands down when the on-screen ward is clicked').toBe(false);
    expectNames(u, 'baruipur');

    /* And the failed ward can be retried. */
    await page.locator('#strip .ward[data-w="barrackpore"]').click();
    await settle(page, 'barrackpore');
    await page.waitForTimeout(1000);
    u = await ui(page);
    expect.soft(u.failed, `retry after a commit throw (${u.chip})`).toBe(false);
    expectNames(u, 'barrackpore');
    expect.soft(u.sim, 'engine after the retry').toBe(before.sim);

    /* (c) A THROW INSIDE THE URL PROJECTION, the earliest write a commit makes. */
    await page.evaluate(() => {
      const orig = history.replaceState.bind(history);
      let armed = true;
      history.replaceState = (...a: Parameters<History['replaceState']>) => {
        if (armed) { armed = false; throw new Error('INJECTED projection failure'); }
        return orig(...a);
      };
    });
    await page.locator('#strip .ward[data-w="ballygunge"]').click();
    await expectFailed(page, 'Ballygunge');
    await page.waitForTimeout(3000);
    u = await ui(page);
    expectNames(u, 'barrackpore');
    expect.soft(u.sim, 'engine after a projection throw').toBe(before.sim);
    await page.locator('#strip .ward[data-w="ballygunge"]').click();
    await settle(page, 'ballygunge');
    await page.waitForTimeout(1000);
    u = await ui(page);
    expectNames(u, 'ballygunge');
    expect.soft(u.sim, 'engine at the end').toBe(before.sim);
    /* (d) A CONSUMER-SIDE ERROR drops one frame and never demotes the engine (C2). */
    /* The headline readout's innerHTML setter throws once: that is `refreshStats`,
       on the far side of the host's promise. */
    await page.evaluate(() => {
      const lst = document.getElementById('lst')!;
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
      let armed = true;
      Object.defineProperty(lst, 'innerHTML', {
        configurable: true,
        get() { return desc.get!.call(this); },
        set(v: string) {
          if (armed) { armed = false; throw new RangeError('INJECTED consumer failure'); }
          desc.set!.call(this, v);
        },
      });
    });
    /* A scenario move re-solves through resetSim, whose snapshot the armed setter refuses. */
    await page.locator('#segPhase button[data-p="night"]').evaluate((b: HTMLButtonElement) => b.click());
    await page.waitForTimeout(4000);
    u = await ui(page);
    expect.soft(u.sim, 'engine after a consumer error').toBe(before.sim);
    expect.soft(u.lst ?? '', 'a figure after the dropped frame').toMatch(/\d+\.\d/);
    expect(lines.filter((l) => l.startsWith('[pageerror]'))).toEqual([]);
  });

});
