import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * WHOLE-CITY STREAMING, THE WALK (city-streaming integration). Skipped unless OBOS_STREAM_URL names a server running a build made
 * with PUBLIC_OBOS_STREAM_DEV=1 with the area data beside it (playwright.stream.config.ts starts one).
 *
 * Opens Canal Ring with ?stream=1 and walks E4 -> F4 -> F5 -> E5 by PANNING the map, then E5 -> E4 through the PICKER (a real click on the
 * chip and then on the cell). On every arrival it asserts what the person sees: the page header names the area (name from area-names.json,
 * its code beside it), the Area select names it, the address carries `area=<code>`, the drawn building count is the area's own, the loader
 * (if it was shown) has ended, no screen text says "sheet", and the page has thrown nothing. Then the picker sends the camera to G5 under a
 * held network so the rise and the plate are on screen for the screenshots.
 *
 * "The loader appeared and ended": it ENDED on every arrival. It APPEARED on every arrival whose data was not already resident; an area the
 * manager had already fetched (the one heading-prefetched area, a neighbour it still held) opens inside its quiet window and, by design,
 * never draws a loader. The test records which it was and fails if an arrival with nothing resident drew none.
 *
 * AND THE ORDER: a loader may be on screen only BEFORE the area it is loading is committed (and then it holds until the first solve). The
 * sampler records every moment a loader turns on while the page header already names the area the manager is opening: that is "Entering..."
 * drawn over an area that is already on screen (INT audit F1/F9), and the test fails if it ever happens, resident arrival or not.
 *
 * THE DATA. Every area but Canal Ring is read from Cloudflare R2, through the Worker in front of the bucket (public/heat-map/data/ams-r2-manifest.json, streaming/data-source.ts); the test
 * proxies those requests through Playwright (real network, real bytes) to hold the detail files and answers them with `Access-Control-Allow-Origin: *`, so this run exercises the
 * bytes and the page's handling of them, NOT the Worker's CORS policy (which admits production, the Vercel previews of this team and the local dev ports 4321/4322, and may not
 * admit the port of this run). That policy is checked against the live Worker by `node scripts/check-city-worker-cors.mjs`. It asserts no area but Canal Ring came from the page's origin.
 */
const BASE = process.env.OBOS_STREAM_URL;
const SHOTS = process.env.OBOS_STREAM_SHOTS ?? '/Volumes/PortableSSD/OBOS Lab/previews/city-streaming/int';
const TIER = process.env.OBOS_STREAM_TIER;                    // optional ?streamtier= (dev build only)
/** PUBLIC MODE (OBOS_STREAM_PUBLIC=1): the build was made with PUBLIC_OBOS_STREAM=1 only. No `?stream=1`, no `?streamtier=`, and none of the dev hooks exist
 *  (`window.__obosStream` is absent by design), so the walk reads what a visitor sees: the header, the Area select, the address, the drawn count, the loader. The
 *  steps that need the dev read-out (resident set, massing, tier demotion) are the dev run's and are skipped here, said out loud. */
const PUBLIC = process.env.OBOS_STREAM_PUBLIC === '1';
/** `?lab=1` (localhost only, explore/look.ts) puts the page's MapLibre map on `window.__obosMap` in ANY build: a public run pans with it. It changes nothing else. */
const QUERY = PUBLIC ? '?lab=1' : '?stream=1';
const HOLD_MS = Number(process.env.OBOS_WALK_HOLD_MS ?? 2_400);
/** The origin the layer files are read from: the committed manifest's `baseUrl/prefix/` (the Cloudflare Worker in front of the R2 bucket). */
const MANIFEST = JSON.parse(readFileSync(new URL('../../public/heat-map/data/ams-r2-manifest.json', import.meta.url), 'utf8')) as { baseUrl: string; prefix: string };
const DATA_ORIGIN = `${MANIFEST.baseUrl}/${MANIFEST.prefix}/`;
/** The per-area bundles (`ams-f4.obosb`, one request per area): the page's default. The per-file origin above is only its fallback, so a bundle run must not touch it. */
const BUNDLES = JSON.parse(readFileSync(new URL('../../public/heat-map/data/ams-r2-bundles.json', import.meta.url), 'utf8')) as { baseUrl: string; prefix: string };
const BUNDLE_ORIGIN = `${BUNDLES.baseUrl}/${BUNDLES.prefix}/`;
const isWorkerUrl = (href: string): boolean => href.startsWith(DATA_ORIGIN) || href.startsWith(BUNDLE_ORIGIN);
const centre = (lon: number, lat: number) => ({ lon, lat });
const D_LAT = 0.025330197213674, D_LON = 0.041190546565045;
const AREA = {
  E4: { ...centre(4.885, 52.364), id: 'canal-ring' },
  F4: { ...centre(4.885 + D_LON, 52.364), id: 'ams-f4' },
  F5: { ...centre(4.885 + D_LON, 52.364 - D_LAT), id: 'ams-f5' },
  E5: { ...centre(4.885, 52.364 - D_LAT), id: 'ams-e5' },
  G5: { ...centre(4.885 + 2 * D_LON, 52.364 - D_LAT), id: 'ams-g5' },
} as const;
type Code = keyof typeof AREA;
const idOf = (code: string): string => (code === 'E4' ? 'canal-ring' : `ams-${code.toLowerCase()}`);

const names = JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/area-names.json', import.meta.url), 'utf8')).areas as Record<string, { name: string }>;
const build = JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/sheets-build.json', import.meta.url), 'utf8')).sheets as Array<{ code: string; buildings: number }>;
const drawnOf = (code: string): number => build.find((s) => s.code === code)!.buildings;

interface Report { tier: string; current: string | null; displayed: string | null; open: string | null; resident: string[]; massing: string[]; switches: number; modelMB: number; ceilingMB: number }
const report = (page: Page): Promise<Report | null> => page.evaluate((pub) => {
  const hook = (window as unknown as { __obosStream?: { report(): unknown } }).__obosStream;
  if (!pub) return hook?.report() as Report | null ?? null;
  /* public: the page itself says which area is on screen (the header code), and the address says which one was asked for */
  const code = document.querySelector('#pname .obos-area-code')?.textContent ?? null;      // written by the stream when an area is on screen (Canal Ring's static header has none)
  return { tier: '?', current: new URL(location.href).searchParams.get('area') ?? 'E4', displayed: code, open: code, resident: [], massing: [], switches: 0, modelMB: 0, ceilingMB: 1 } as Report;
}, PUBLIC);
/** The map to pan: the dev hook's in a dev build, the lab hook's in a public one. */
const MAP_EXPR = PUBLIC ? 'window.__obosMap' : 'window.__obosStream.map';

test.describe.configure({ timeout: 420_000 });

/** Samples the loader's three faces every 25 ms from the first frame, so a loader that was up for half a second is seen however the test polls. */
async function watchLoader(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { rise: false, plate: false, sweep: false };
    const late: string[] = [];
    (window as unknown as { __cl: unknown; __clLate: string[] }).__cl = seen;
    (window as unknown as { __clLate: string[] }).__clLate = late;
    let was = false;
    setInterval(() => {
      if (document.querySelector('.cl-chip.on')) seen.rise = true;
      if (document.querySelector('.cl-plate.on')) seen.plate = true;
      if (document.querySelector('.cl-sweep.on')) seen.sweep = true;
      const on = !!document.querySelector('.cl-chip.on, .cl-plate.on, .cl-sweep.on');
      if (on && !was) {
        const header = document.querySelector('#pname .obos-area-code')?.textContent ?? '';
        const current = (window as unknown as { __obosStream?: { report(): { current: string | null } } }).__obosStream?.report().current ?? null;
        if (header !== '' && header === current) late.push(`${header} at ${Math.round(performance.now())} ms`);
      }
      was = on;
    }, 25);
  });
}
/** Real network, one proxy for the whole walk: the R2 origin (every area but Canal Ring) and Canal Ring's own detail files. Holds the detail
 *  files `holdMs`; adds CORS (see the header); records where the files came from. Returns the origins seen, per area file. */
async function routeData(page: Page, holdMs: number): Promise<{ r2: string[]; bundles: string[]; bundlesDone: string[]; bundlesAborted: string[]; perFile: string[]; sameOriginAreas: string[]; canal: string[]; manifest: string[]; bundleManifest: string[]; hold: { ms: number } }> {
  const seen = { r2: [] as string[], bundles: [] as string[], bundlesDone: [] as string[], bundlesAborted: [] as string[], perFile: [] as string[], sameOriginAreas: [] as string[], canal: [] as string[], manifest: [] as string[], bundleManifest: [] as string[], hold: { ms: holdMs } };
  page.on('request', (request) => {
    const url = request.url();
    if (isWorkerUrl(url)) { seen.r2.push(url); (url.startsWith(BUNDLE_ORIGIN) ? seen.bundles : seen.perFile).push(url); }
    else if (/\/heat-map\/data\/ams-r2-manifest\.json$/.test(url)) seen.manifest.push(url);
    else if (/\/heat-map\/data\/ams-r2-bundles\.json$/.test(url)) seen.bundleManifest.push(url);
    else if (/\/heat-map\/data\/ams-[a-z0-9]+(-[a-z]+)?\.(json|png)$/.test(url)) seen.sameOriginAreas.push(url);
    else if (/\/heat-map\/data\/canal-ring(-[a-z]+)?\.(json|png)$/.test(url)) seen.canal.push(url);
  });
  page.on('requestfinished', (request) => { if (request.url().startsWith(BUNDLE_ORIGIN)) seen.bundlesDone.push(request.url()); });
  page.on('requestfailed', (request) => { if (request.url().startsWith(BUNDLE_ORIGIN)) seen.bundlesAborted.push(request.url()); });      // the loader cancelled it (the camera moved on)
  await page.route((url) => isWorkerUrl(url.href) || /\/heat-map\/data\/canal-ring-(terrain|trees|water)\.json$/.test(url.pathname), async (route) => {
    const response = await route.fetch();
    if (/-(terrain|trees|water)\.json$|\.obosb$/.test(route.request().url())) await new Promise((r) => setTimeout(r, seen.hold.ms));      // a bundle holds everything the vector files used to
    const headers = { ...response.headers() };
    delete headers['content-encoding']; delete headers['content-length'];          // the body below is already decoded
    await route.fulfill({ status: response.status(), headers: { ...headers, 'access-control-allow-origin': '*' }, body: await response.body() });
  });
  return seen;
}
const loaderSeen = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __cl: { rise: boolean; plate: boolean; sweep: boolean } }).__cl }));
const loaderLate = (page: Page) => page.evaluate(() => [...((window as unknown as { __clLate: string[] }).__clLate ?? [])]);
const resetLoaderSeen = (page: Page) => page.evaluate(() => { const s = (window as unknown as { __cl: Record<string, boolean> }).__cl; s.rise = s.plate = s.sweep = false; });
const loaderOn = (page: Page) => page.evaluate(() => !!document.querySelector('.cl-chip.on, .cl-plate.on, .cl-sweep.on'));

/** Every COMPLETED Worker request for `ams-<code>.obosb` so far: a newly opened area is exactly ONE (its halo and neighbours are other areas' bundles, each one request too).
 *  A download the loader cancelled because nobody wanted that area any more (its halo job was dropped and no job asked within 250 ms) is not completed; it is reported separately. */
const bundleRequests = (fetched: { bundlesDone: string[] }, code: string): number => fetched.bundlesDone.filter((u) => u.endsWith(`/${idOf(code)}.obosb`)).length;

async function arrived(page: Page, code: Code, thrown: string[], how: string, wasResident: boolean, fetched?: { bundlesDone: string[] }): Promise<void> {
  await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000, message: `${how}: ${code} is displayed` }).toBe(code);
  await expect.poll(() => loaderOn(page), { timeout: 30_000, message: `${how}: the loader has ended` }).toBe(false);
  await expect.poll(() => page.evaluate(() => document.getElementById('pname')?.textContent ?? ''), { message: `${how}: the header names ${code}` }).toContain(names[code]!.name);
  const header = await page.evaluate(() => ({ pname: document.getElementById('pname')?.textContent ?? '', pzone: document.getElementById('pzone')?.textContent ?? '', crumb: document.getElementById('crumbArea')?.textContent ?? '', explore: document.querySelector('[data-side-pane="explore"] .sp-head h2')?.textContent ?? '' }));
  expect(header.pname, `${how}: header code`).toContain(code);
  expect(header.pzone, `${how}: header zone`).toContain(`Area ${code}`);
  expect(header.crumb).toBe(names[code]!.name);
  expect(header.explore, 'the panel says "area", not "ward"').toBe('Explore the area');
  const select = await page.evaluate(() => {
    const s = document.querySelector<HTMLSelectElement>('select[data-scope="area"]');
    return { value: s?.value ?? '', text: s?.selectedOptions[0]?.textContent ?? '', visible: document.querySelector('[data-select-field] .field-value-text, [data-select-field] [data-select-value]')?.textContent ?? null };
  });
  expect(select.value, `${how}: Area select value`).toMatch(new RegExp(`/${idOf(code)}$`));
  expect(select.text, `${how}: Area select text`).toContain(names[code]!.name);
  expect(new URL(page.url()).searchParams.get('area'), `${how}: the address`).toBe(code);
  await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 20_000, message: `${how}: drawn count` }).toContain(drawnOf(code).toLocaleString('en-US'));
  const words = await page.evaluate(() => [...document.querySelectorAll('.st-title, .si-host, .cl, #pname, #pzone')].map((n) => (n as HTMLElement).innerText ?? n.textContent ?? '').join('\n'));
  expect(words, `${how}: no screen text says "sheet"`).not.toMatch(/\bsheets?\b/i);
  if (PUBLIC) await publicSurfaces(page, code, how);
  const seen = await loaderSeen(page);
  const appeared = seen.rise || seen.plate || seen.sweep;
  console.log(`[walk] ${how}: ${code} shown; loader appeared=${appeared} ${JSON.stringify(seen)}; resident before=${wasResident}`);
  if (!wasResident) expect(appeared, `${how}: ${code} had nothing resident, so its loader must have been drawn`).toBe(true);
  expect(await loaderLate(page), `${how}: a loader came up over an area that was already on screen`).toEqual([]);
  if (fetched !== undefined && code !== 'E4') expect(bundleRequests(fetched, code), `${how}: ${code} cost exactly one Worker request (its bundle)`).toBe(1);
  expect(thrown, `page errors: ${thrown.join(' | ')}`).toEqual([]);
}

/** PUBLIC MODE, on every arrival: the surfaces that were written for ONE area say what they do for this one (stream-public, scripts/.../streaming/area-surfaces.ts),
 *  and the heat-accuracy caveat is on screen. Canal Ring (E4) keeps what the page always showed. */
async function publicSurfaces(page: Page, code: string, how: string): Promise<void> {
  const s = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    compare: { href: document.querySelector('a[data-rail="analysis"]')?.getAttribute('href') ?? null, off: document.querySelector('a[data-rail="analysis"]')?.getAttribute('data-unavailable') ?? null },
    brief: { href: document.querySelector('[data-v2-brief]')?.getAttribute('href') ?? null, off: document.querySelector('[data-v2-brief]')?.getAttribute('data-unavailable') ?? null },
    recordNote: document.querySelector('[data-v2-card="record"] [data-streamed-note]')?.textContent ?? null,
    solar: document.getElementById('solPaneSum')?.textContent ?? '',
    reportLink: (() => { const a = document.getElementById('report-link'); return a === null ? 'absent' : a.hasAttribute('hidden') ? 'hidden' : 'shown'; })(),
    caveat: (document.getElementById('conf')?.textContent ?? '').includes('Heat accuracy not yet validated for this city'),      // textContent: on a phone the card is folded away, but it is written
    dev: typeof (window as unknown as { __obosStream?: unknown }).__obosStream,
  }));
  expect(s.dev, `${how}: no dev hook in a public build`).toBe('undefined');
  expect(s.caveat, `${how}: ${code} shows the Amsterdam heat-accuracy caveat`).toBe(true);
  for (const url of [s.ogUrl, s.canonical]) if (url !== '') expect(url.endsWith('/heat-map/nl/amsterdam/canal-ring/'), `${how}: URL tag ${url} is Canal Ring's page, not a page of ${code}`).toBe(true);
  if (code === 'E4') {
    expect(s.title).toContain('Canal Ring');
    expect(s.compare.href, `${how}: Canal Ring keeps its Compare link`).toContain('/heat-map/compare/');
    expect(s.compare.off).toBeNull();
    expect(s.recordNote).toBeNull();
  } else {
    expect(s.title, `${how}: the tab names ${code}`).toContain(`Area ${code}`);
    expect(s.title).toContain(names[code]!.name);
    expect(s.title + s.description, `${how}: nothing says Canal Ring for ${code}`).not.toContain('Canal Ring');
    expect(s.description).toContain('not yet validated');
    expect(s.compare.href, `${how}: Compare is withdrawn for ${code} (it would open Kolkata's pair)`).toBeNull();
    expect(s.compare.off).toContain('Not available');
    expect(s.brief.href).toBeNull();
    expect(s.brief.off).toContain('Not available');
    expect(s.recordNote, `${how}: the record card names ${code}`).toContain(names[code]!.name);
    expect(s.solar, `${how}: the solar pane says "not yet" for ${code}, naming it`).toContain(`No solar screen ships for ${names[code]!.name} yet`);
    expect(s.reportLink, `${how}: no ward-record download for ${code}`).not.toBe('shown');
  }
}

async function panTo(page: Page, code: Code): Promise<void> {
  const c = AREA[code];
  await page.evaluate(({ lon, lat, expr }) => {
    const map = new Function(`return ${expr}`)() as { easeTo(o: unknown): void };
    map.easeTo({ center: [lon, lat], duration: 1_800 });
  }, { lon: c.lon, lat: c.lat, expr: MAP_EXPR });
}

for (const viewport of [{ width: 390, height: 844, tag: 'phone', tier: 'low' as string | undefined }, { width: 1440, height: 900, tag: 'desktop', tier: TIER }]) {
  test(`streaming walk E4 -> F4 -> F5 -> E5 by panning, E4 by the picker: ${viewport.tag}`, async ({ page }) => {
    test.skip(!BASE, 'set OBOS_STREAM_URL to a server running a PUBLIC_OBOS_STREAM_DEV=1 build');
    const tag = PUBLIC ? `public-${viewport.tag}` : viewport.tier ? `${viewport.tag}-${viewport.tier}` : viewport.tag;
    mkdirSync(SHOTS, { recursive: true });
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    if (PUBLIC) page.on('console', (m) => { if (m.type() === 'warning' && /^streaming:|sheet executor/.test(m.text())) thrown.push(`console: ${m.text()}`); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    /* A held network for the detail files of every area (Canal Ring's too, so coming back to it is a real load), so a loader is on screen long enough to be seen and shot. */
    const fetched = await routeData(page, HOLD_MS);
    await watchLoader(page);
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/${QUERY}${viewport.tier && !PUBLIC ? `&streamtier=${viewport.tier}` : ''}`, { waitUntil: 'domcontentloaded' });

    // first entry: E4, design C
    await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000, message: 'E4 opens through the stream' }).toBe('E4');
    await arrived(page, 'E4', thrown, 'first entry', false);
    if (!PUBLIC) await expect.poll(async () => (await report(page))?.massing.length ?? 0, { timeout: 90_000, message: 'the ring arrives' }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${SHOTS}/${tag}-1-E4.png` });

    // the picker, open
    await page.locator('.si-chip').click();
    await expect(page.locator('.si[data-open="true"]')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${tag}-2-picker-open.png` });
    const chipLabel = await page.locator('.si-chip').getAttribute('aria-label');
    expect(chipLabel).toContain('E4');
    expect(await page.locator('.si-panel').innerText()).toContain(drawnOf('E4').toLocaleString('en-US'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.si[data-open="false"]')).toHaveCount(1);

    // Shift + arrow on the MAP must still reach MapLibre (rotate), not the picker
    const bearing = async () => page.evaluate((expr) => (new Function(`return ${expr}`)() as { getBearing(): number }).getBearing(), MAP_EXPR);
    const b0 = await bearing();
    await page.evaluate(() => (document.querySelector('.maplibregl-canvas') as HTMLElement).focus());
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(700);
    expect(Math.abs((await bearing()) - b0), 'MapLibre\'s own Shift + arrow still rotates the map').toBeGreaterThan(1);
    expect((await report(page))?.current, 'and did not move the picker').toBe('E4');

    // the walk, by panning
    let previous: Code = 'E4';
    for (const code of ['F4', 'F5', 'E5'] as const) {
      const before = await report(page);
      const wasResident = before?.resident.includes(code) ?? false;
      await resetLoaderSeen(page);
      await panTo(page, code);
      await arrived(page, code, thrown, `pan ${previous}->${code}`, wasResident, fetched);
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: `${SHOTS}/${tag}-3-arrived-${code}.png` });
      const r = (await report(page))!;
      if (!PUBLIC) {
        expect(r.massing, `${previous} is now grey massing`).toContain(previous);
        expect(r.modelMB).toBeLessThanOrEqual(r.ceilingMB);
      }
      previous = code;
    }

    // back to E4 through the picker: a real click on the chip, then on the E4 cell
    {
      const wasResident = (await report(page))?.resident.includes('E4') ?? false;
      await resetLoaderSeen(page);
      await page.locator('.si-chip').click();
      await expect(page.locator('.si[data-open="true"]')).toBeVisible();
      await page.locator('.si-grid .si-cell[data-code="E4"]').click();
      await arrived(page, 'E4', thrown, 'picker E5->E4', wasResident, fetched);
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: `${SHOTS}/${tag}-3-arrived-E4-picker.png` });
    }

    // an area whose data is already resident, picked: it opens without a loader coming up over it (the ordering is asserted in `arrived`).
    // A low-tier phone keeps only the area on screen resident (maxLod0), so there is nothing to pick there and the step is skipped, said out loud.
    {
      /* Make one: on a tier that prefetches by heading, drift toward E4's east edge (about 1 km, inside E4, so no crossing) and wait for F4's data to be held. */
      if (!PUBLIC && (await report(page))!.resident.every((c) => c === 'E4') && (await report(page))!.tier !== 'low') {
        await page.evaluate(({ lon, lat }) => (window as unknown as { __obosStream: { map: { easeTo(o: unknown): void } } }).__obosStream.map.easeTo({ center: [lon, lat], duration: 1_500 }), { lon: AREA.E4.lon + 0.0150, lat: AREA.E4.lat });
        await expect.poll(async () => (await report(page))!.resident.length, { timeout: 60_000, message: 'a heading prefetch left a neighbour resident' }).toBeGreaterThan(1);
      }
      const r = (await report(page))!;
      const resident = r.resident.filter((c) => c !== r.displayed);
      console.log(`[walk] ${tag}: resident ${r.resident.join(',')} (displayed ${r.displayed}, tier ${r.tier})`);
      if (PUBLIC) console.log(`[walk] ${tag}: public run - no resident read-out, the resident-pick step is the dev run's`);
      else if (resident.length === 0) console.log(`[walk] ${tag}: no other area is resident (tier ${r.tier}): resident-pick step skipped`);
      else {
        const code = resident[0] as Code;
        await resetLoaderSeen(page);
        await page.locator('.si-chip').click();
        await expect(page.locator('.si[data-open="true"]')).toBeVisible();
        await page.locator(`.si-grid .si-cell[data-code="${code}"]`).click();
        await arrived(page, code, thrown, `picker ->${code} (resident)`, true, fetched);
        await page.waitForTimeout(1_500);
        await page.screenshot({ path: `${SHOTS}/${tag}-3-arrived-${code}-resident.png` });
      }
    }

    // a tier demotion REBUILDS the open area's mesh (INT audit F3: the ward session used to refuse to reload the ward on screen)
    {
      const tier = (await report(page))!.tier;
      const rebuilds = () => page.evaluate(() => (window as unknown as { __obosStream: { timings(): { rebuilds: number } } }).__obosStream.timings().rebuilds);
      if (PUBLIC) console.log('[walk] public run - no tier hook, the demotion step is the dev run\'s');
      else if (tier !== 'low') {
        const before = await rebuilds();
        const shown = (await report(page))!.displayed;
        await page.evaluate(() => (window as unknown as { __obosStream: { setTier(t: string): void } }).__obosStream.setTier('low'));
        await expect.poll(rebuilds, { timeout: 60_000, message: `a demotion from ${tier} rebuilt the open mesh` }).toBeGreaterThan(before);
        await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 30_000 }).toContain(drawnOf(shown!).toLocaleString('en-US'));
        expect((await report(page))!.displayed, 'and the same area is still the displayed one').toBe(shown);
      } else console.log('[walk] tier already low: no demotion to test in this run');
    }

    // the loader on screen: the picker sends the camera to an area with NOTHING resident (G5 when it is not, else the first that is not), under the held
    // network. A resident area opens inside the quiet window and must show no plate (that is the F1 fix), so the target is chosen from the report.
    const r0 = (await report(page))!;
    /* public run: no resident read-out, so the farthest area from where the walk ended (E4 after the picker, F4-ish): I7 is five cells away, never prefetched */
    const target = PUBLIC ? ('I7' as Code) : (['G5', 'F5', 'F4', 'E5'] as const).find((c) => !r0.resident.includes(c) && c !== r0.displayed)!;
    console.log(`[walk] ${tag}: loader target ${target} (resident ${r0.resident.join(',')}, displayed ${r0.displayed})`);
    fetched.hold.ms = 7_000;                                     // long enough that the shots below (slow on a busy machine) find the loader still up
    await resetLoaderSeen(page);
    await page.locator('.si-chip').click();
    await expect(page.locator('.si[data-open="true"]')).toBeVisible();
    await page.locator(`.si-grid .si-cell[data-code="${target}"]`).click();
    for (let k = 0; k < 14 && process.env.OBOS_WALK_TRACE; k++) {      // OBOS_WALK_TRACE=1: the loader's faces and the manager, every 250 ms after the pick
      const t = await page.evaluate(() => ({ chip: !!document.querySelector('.cl-chip.on'), plate: !!document.querySelector('.cl-plate.on'), rep: (window as unknown as { __obosStream: { report(): { current: string; displayed: string } } }).__obosStream.report() }));
      console.log(`[trace +${k * 250} ms] chip=${t.chip} plate=${t.plate} current=${t.rep.current} displayed=${t.rep.displayed}`);
      await page.waitForTimeout(250);
    }
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.cl-chip.on')), { timeout: 30_000, message: 'the rise furniture shows' }).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${tag}-4-loader-rise.png` });
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.cl-plate.on')), { timeout: 30_000, message: 'the plate shows' }).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/${tag}-5-loader-plate.png` });
    await arrived(page, target as Code, thrown, `picker ->${target}`, false, fetched);
    await page.unrouteAll({ behavior: 'ignoreErrors' });        // a held request still in flight must not outlive the test
    console.log(`[walk] ${tag}: ${fetched.r2.length} files from R2, ${fetched.canal.length} Canal Ring files from the page's origin, ${fetched.sameOriginAreas.length} other-area files from the page's origin`);
    expect(fetched.perFile, 'the six per-file URLs are the fallback: a bundle run never touches them').toEqual([]);
    expect(fetched.bundles.length, 'the other areas were read from R2 as bundles').toBeGreaterThan(5);
    /* A bundle is fetched once while the loader holds it (city-stream.ts keeps the last 14 areas' downloads, least-recently-used out). It may be asked for again once it has been
       evicted; this run bypasses the HTTP cache, which in a real browser answers that repeat from disk (the bundles are immutable). LRU makes the exact moment depend on what was
       touched, so the check is a bound, not a schedule: a re-fetch storm would be far above it. The OPENED areas' count (exactly 1) is asserted on every arrival above. */
    const perUrl = new Map<string, number>();
    const early: string[] = [];
    const done = fetched.bundlesDone;                  // completed downloads; a request the loader cancelled (nobody wanted the area any more) is counted separately
    for (const u of done) perUrl.set(u, (perUrl.get(u) ?? 0) + 1);
    const repeats = done.length - perUrl.size;
    if (repeats > 10 || [...perUrl.values()].some((n) => n > 2)) early.push(`${repeats} repeat downloads (${[...perUrl].filter(([, n]) => n > 1).map(([u, n]) => `${u.slice(u.lastIndexOf('/') + 1)} x${n}`).join(', ')})`);
    if (early.length > 0) console.log(`[walk] ${tag}: bundle order ${done.map((u) => u.slice(u.lastIndexOf('/') + 5, -6)).join(' ')} | cancelled ${fetched.bundlesAborted.map((u) => u.slice(u.lastIndexOf('/') + 5, -6)).join(' ')}`);
    expect(early, 'only memo evictions are fetched again, and only a few').toEqual([]);
    console.log(`[walk] ${tag}: ${perUrl.size} distinct bundles, ${done.length} completed Worker requests + ${fetched.bundlesAborted.length} cancelled in flight; the six-file path would have been ${(done.length + fetched.bundlesAborted.length) * 6}`);
    expect(fetched.sameOriginAreas, 'no area but Canal Ring came from the page\'s own origin').toEqual([]);
    expect(fetched.canal.length, 'Canal Ring stayed same-origin').toBeGreaterThan(0);
    expect(fetched.manifest.length, 'the manifest was read once').toBe(1);
    expect(fetched.bundleManifest.length, 'and so was the bundle manifest').toBe(1);
    expect(thrown, `page errors: ${thrown.join(' | ')}`).toEqual([]);
  });
}

/** A short phone-size recording of the walk E4 -> F4 -> F5 (OBOS_WALK_VIDEO=1; the file is written to SHOTS/walk-phone.webm). */
test('streaming walk, phone recording', async ({ browser }) => {
  test.skip(!BASE || process.env.OBOS_WALK_VIDEO !== '1', 'set OBOS_STREAM_URL and OBOS_WALK_VIDEO=1');
  mkdirSync(SHOTS, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: `${SHOTS}/.video`, size: { width: 390, height: 844 } } });
  const page = await context.newPage();
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));
  await routeData(page, 900);
  await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=1&streamtier=low`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000 }).toBe('E4');
  await page.waitForTimeout(3_500);
  for (const code of ['F4', 'F5'] as const) {
    await panTo(page, code);
    await expect.poll(async () => (await report(page))?.displayed, { timeout: 150_000 }).toBe(code);
    await page.waitForTimeout(3_500);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const video = page.video();
  await context.close();
  await video!.saveAs(`${SHOTS}/walk-phone.webm`);
  expect(thrown).toEqual([]);
});

/* PUBLIC MODE ONLY: the two doors that are not the walk. */
test.describe('public mode', () => {
  test.skip(!BASE || !PUBLIC, 'set OBOS_STREAM_URL to a PUBLIC_OBOS_STREAM=1 build and OBOS_STREAM_PUBLIC=1');
  test.describe.configure({ timeout: 240_000 });

  test('a shared link opens its area: ?area=F4 is F4 on first paint, with nothing else asked', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    const fetched = await routeData(page, 0);
    await watchLoader(page);
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?lab=1&area=F4`, { waitUntil: 'domcontentloaded' });
    await arrived(page, 'F4', thrown, 'deep link', false, fetched);
    expect(fetched.manifest.length).toBe(1);
    expect(fetched.bundleManifest.length).toBe(1);
    expect(fetched.perFile, 'a shared link reads F4 as one bundle, not six files').toEqual([]);
    expect(bundleRequests(fetched, 'F4')).toBe(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect(thrown).toEqual([]);
  });

  test('the kill switch: ?stream=0 is the classic single-area page - no picker, no manifest, nothing from R2, ?area= ignored', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    const fetched = await routeData(page, 0);
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?stream=0&area=F4`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 90_000, message: 'Canal Ring draws' }).toMatch(/\d/);
    await page.waitForTimeout(3_000);
    expect(await page.locator('.si-chip').count(), 'no area picker').toBe(0);
    expect(await page.evaluate(() => document.querySelector('#pname')?.textContent ?? ''), 'the header is Canal Ring').toContain('Canal');
    expect(await page.evaluate(() => document.querySelector('#pname .obos-area-code')?.textContent ?? null)).toBeNull();
    expect(fetched.manifest, 'the manifest is not read').toEqual([]);
    expect(fetched.bundleManifest, 'nor the bundle manifest').toEqual([]);
    expect(fetched.r2, 'nothing from R2').toEqual([]);
    expect(fetched.canal.length, 'Canal Ring came from the page\'s origin').toBeGreaterThan(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect(thrown).toEqual([]);
  });

  /* THE FAILURE PATHS (public audit B1, S1). */
  test('B1: with the Worker unreachable Canal Ring is usable - no plate, no alert - and PICKING another area fails honestly for that area only', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.route((url) => isWorkerUrl(url.href), (route) => route.abort('connectionrefused'));
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?lab=1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await report(page))?.displayed, { timeout: 120_000, message: 'E4 opens with the Worker down' }).toBe('E4');
    await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 30_000 }).toContain(drawnOf('E4').toLocaleString('en-US'));
    await page.waitForTimeout(14_000);                       // past the retry schedule: the halo and the ring have been given up on
    const state = () => page.evaluate(() => ({
      plate: !!document.querySelector('.cl-plate.on'),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent ?? '').trim()).filter((t) => t !== ''),
      shown: document.querySelector('#pname .obos-area-code')?.textContent ?? null,
    }));
    const calm = await state();
    expect(calm.plate, 'no failure plate over a Canal Ring that is drawn').toBe(false);
    expect(calm.alerts, 'nothing announced assertively').toEqual([]);
    expect(calm.shown).toBe('E4');
    await page.screenshot({ path: `${SHOTS}/public-worker-down-E4.png` });
    // pick F4: its data cannot be fetched, so THAT area fails, in words, and Canal Ring stays
    await page.locator('.si-chip').click();
    await page.locator('.si-grid .si-cell[data-code="F4"]').click();
    const said = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent ?? '').trim()).join(' | '));
    await expect.poll(said, { timeout: 90_000, message: 'F4 is reported as failed, in words, after its retries' }).toMatch(/F4.*could not be loaded/i);
    expect(await said()).not.toMatch(/Canal Ring|E4/);
    expect(await page.evaluate(() => !!document.querySelector('.cl-plate.on button, .cl-plate.on [data-retry]') || (document.querySelector('.cl-plate.on')?.textContent ?? '').includes('Retry')), 'with a Retry').toBe(true);
    expect((await state()).shown, 'Canal Ring is still the area on screen').toBe('E4');
    await page.screenshot({ path: `${SHOTS}/public-worker-down-F4-pick.png` });
    expect(thrown).toEqual([]);
  });

  test('S1: one streaming chunk that cannot be loaded leaves the classic Canal Ring page, drawn, with no uncaught error', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.route(/\/area-surfaces\.[^/]*\.js$/, (route) => route.abort('failed'));
    await page.goto(`${BASE}/heat-map/nl/amsterdam/canal-ring/?lab=1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => document.getElementById('bcount')?.textContent ?? ''), { timeout: 90_000, message: 'Canal Ring draws without streaming' }).toContain(drawnOf('E4').toLocaleString('en-US'));
    await page.waitForTimeout(2_000);
    expect(await page.locator('.si-chip').count(), 'no picker: this is the classic page').toBe(0);
    expect(await page.evaluate(() => !!document.querySelector('.cl-plate.on'))).toBe(false);
    expect(thrown, 'the failed import is caught, not left uncaught').toEqual([]);
  });
});
