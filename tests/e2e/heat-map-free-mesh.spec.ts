import { expect, test, type Page } from '@playwright/test';
import { openV2, stubAt } from './obos-v2-helpers';
import { LAB, pick, relief, placed } from './obos-v2-onmap-helpers';

/**
 * THE BUILDING MESH GIVES BACK ITS CPU COPY, AND THE CITY STILL WORKS (relief-renderer.ts, gpu-resident.ts).
 *
 * three keeps `attribute.array` after the GPU has it, because it re-uploads from it when a context is lost. The merged
 * building mesh no longer keeps one. Measured on this page (Ballygunge, new headless on Metal): ArrayBuffers 62.7 MB before,
 * 17.7 MB after, against 49.4 MB of GL buffers either way. So the three things that could have leaned on the arrays are
 * pinned here, in the browser, because only a real GL context can show them:
 *   · the arrays really are gone (otherwise every other assertion passes with the change reverted);
 *   · a click still finds a building (it hits the ward's footprint rings, never the mesh);
 *   · a lost-and-restored context brings the same city back. Sabotage-checked: with the `webglcontextrestored` handler
 *     removed, three re-uploads from a null array and the city does not come back.
 *
 *   · Bengaluru comes back WITHOUT THE NETWORK: the renderer keeps the compressed GLB (and the Draco decoder), so a restore decodes
 *     them again; with the network cut after the first load the model and its landmark labels return, and nothing asks for the GLB.
 *
 * LOCAL ONLY, on the relief project: it needs Metal. Headless SwiftShader runs tier 0 and opens on the flat map, so CI's relief clicks
 * (ward-switch, obos-v2-building, solar) do draw this mesh and cover render-after-free, picking and area switches on the software path,
 * but a forced context loss and restore is covered only here.
 */
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'chromium-relief', 'needs the Metal GL path'); });

/** Bytes the GL buffers hold, counted at `bufferData` (the P0 hook); installed before any page script runs. */
async function countGlBuffers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buffers = new Map<WebGLBuffer, number>();
    (window as unknown as { __glBytes: () => number }).__glBytes = () => [...buffers.values()].reduce((a, b) => a + b, 0);
    /* every upload over 4 MB, in order: on these pages the building mesh is what goes up in pieces that big */
    const big: number[] = [];
    (window as unknown as { __bigUploads: number[] }).__bigUploads = big;
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      const bound = new WeakMap<object, Record<number, WebGLBuffer | null>>();
      const { bindBuffer, bufferData, deleteBuffer } = p;
      p.bindBuffer = function (this: object, ...a: unknown[]) {
        const [t, buffer] = a as [number, WebGLBuffer | null];
        if (!bound.has(this)) bound.set(this, {});
        bound.get(this)![t] = buffer; return bindBuffer.apply(this, a);
      };
      p.bufferData = function (this: object, ...a: unknown[]) {
        const [t, data] = a as [number, ArrayBufferView | number | null];
        const b = bound.get(this)?.[t];
        const bytes = typeof data === 'number' ? data : (data?.byteLength ?? 0);
        if (b) buffers.set(b, bytes);
        if (bytes > 4e6) big.push(bytes);
        return bufferData.apply(this, a);
      };
      p.deleteBuffer = function (this: object, ...a: unknown[]) { buffers.delete(a[0] as WebGLBuffer); return deleteBuffer.apply(this, a); };
    }
  });
}

/** ArrayBuffer backing-store bytes after a forced GC (CDP), and the GL bytes counted above. */
async function memory(page: Page): Promise<{ arrayMB: number; glMB: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return { arrayMB: heap.backingStorageSize / 1e6, glMB: await page.evaluate(() => (window as unknown as { __glBytes: () => number }).__glBytes() / 1e6) };
}

/** The city is on the GPU: the GL byte total has stopped growing and is more than MapLibre's own tiles. */
async function cityUploaded(page: Page): Promise<void> {
  let last = -1, flat = 0;
  await expect.poll(async () => {
    const gl = (await memory(page)).glMB;
    flat = Math.abs(gl - last) < 0.01 && gl > 20 ? flat + 1 : 0; last = gl;
    return flat;
  }, { timeout: 120_000, intervals: [1000] }).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(3000);   // the grow animation and the first solver frames
}

/**
 * A LOST CONTEXT COMES BACK WITH ITS CITY. The building mesh has no array left for three to re-upload, so the renderer rebuilds it from
 * the ward data: the same big buffers must go to the GPU a second time, and nothing may throw. (Not a pixel comparison: after a restore the
 * app also demotes the heat solver and rebuilds three's environment map, so the frame is not the same frame, with or without this change.)
 */
async function restoreBringsCityBack(page: Page, thrown: string[], atLeast: number): Promise<void> {
  const bigBefore = await page.evaluate(() => [...(window as unknown as { __bigUploads: number[] }).__bigUploads]);
  expect(bigBefore.length, 'the building mesh went up in big buffers').toBeGreaterThanOrEqual(atLeast);
  await page.evaluate(async () => {
    const canvas = (window as unknown as { __obosMap: { getCanvas(): HTMLCanvasElement } }).__obosMap.getCanvas();
    const ext = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!.getExtension('WEBGL_lose_context')!;
    const restored = new Promise<void>((done) => canvas.addEventListener('webglcontextrestored', () => done(), { once: true }));
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 500));
    ext.restoreContext();
    await restored;
  });
  const n = bigBefore.length;
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bigUploads: number[] }).__bigUploads.length), {
    message: 'the building mesh was uploaded again after the restore', timeout: 60_000,
  }).toBeGreaterThanOrEqual(n * 2);
  const bigAfter = await page.evaluate((from) => (window as unknown as { __bigUploads: number[] }).__bigUploads.slice(from), n);
  expect([...bigAfter].sort((a, b) => b - a).slice(0, n), 'the same buffers, byte for byte').toEqual([...bigBefore].sort((a, b) => b - a));
  await page.waitForTimeout(3000);
  expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
}

test.describe('the building mesh gives back its CPU copy', () => {
  test.setTimeout(300_000);

  test('the arrays are gone, a click still finds a building, and a lost context brings the same city back', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.emulateMedia({ reducedMotion: 'reduce' });   // no auto-orbit, so two frames of the same city are the same frame
    await countGlBuffers(page);
    await stubAt(page, '2026-10-07T06:05:00Z');
    await openV2(page, LAB);
    await relief(page);
    await cityUploaded(page);

    /* 1 · THE FREE HAPPENED. Before: 62.7 MB of ArrayBuffers against 49.4 MB of GL (1.27x). After: 17.7 against 49.4 (0.36x). */
    const m = await memory(page);
    expect(m.glMB, 'the city is on the GPU').toBeGreaterThan(30);
    expect(m.arrayMB / m.glMB, `ArrayBuffers ${m.arrayMB.toFixed(1)} MB vs GL ${m.glMB.toFixed(1)} MB`).toBeLessThan(0.7);

    /* 2 · A CLICK STILL PICKS. Take a roof from the Solar list, note where its brackets stand, close the card, then click that pixel. */
    await pick(page);
    await placed(page);
    await page.waitForTimeout(2000);   // the camera eases to the roof for 700 ms; the brackets are read once it has stopped
    const first = { id: await page.locator('#bcId').innerText(), ll: await page.locator('#bcLL').innerText() };
    const apex = await page.evaluate(() => { const r = document.getElementById('bsel')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.locator('#bcX').click();
    await expect(page.locator('#bcard')).toBeHidden();
    await page.waitForTimeout(500);
    /* The brackets mark the footprint's centroid, which need not lie on the roof (the centre click missed on a measured run, the ones
       10 px around it did not): so try the centre and then 10 px around it. The first click that opens a card must open THIS building's. */
    let picked: { id: string; ll: string } | null = null;
    for (const [dx, dy] of [[0, 0], [0, 10], [0, -10], [10, 0], [-10, 0]]) {
      await page.mouse.click(apex.x + dx, apex.y + dy);
      await page.waitForTimeout(500);
      if (await page.locator('#bcard').isVisible()) { picked = { id: await page.locator('#bcId').innerText(), ll: await page.locator('#bcLL').innerText() }; break; }
    }
    expect(picked, 'a click on the building opened no card').not.toBeNull();
    expect(picked, 'the click selected the same building').toEqual(first);
    await page.locator('#bcX').click();
    await expect(page.locator('#bcard')).toBeHidden();
    await page.waitForTimeout(1500);

    /* 3 · A LOST CONTEXT COMES BACK WITH ITS CITY. */
    await restoreBringsCityBack(page, thrown, 4);
  });

  test('Bengaluru, the glTF path: the arrays are gone and a lost context re-decodes the model', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countGlBuffers(page);
    await stubAt(page, '2026-10-07T06:05:00Z');
    await openV2(page, '/heat-map/in/bengaluru/mg-road/?lab=1');
    await relief(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __bigUploads: number[] }).__bigUploads.length), { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(8000);
    /* MG Road, measured: ArrayBuffers 39.0 MB before, 27.9 MB after, against 18.4 MB of GL either way (2.1x, then 1.5x): the rest is the ward's own data. */
    const m = await memory(page);
    expect(m.arrayMB / m.glMB, `ArrayBuffers ${m.arrayMB.toFixed(1)} MB vs GL ${m.glMB.toFixed(1)} MB`).toBeLessThan(1.8);
    await restoreBringsCityBack(page, thrown, 2);
  });

  test('Bengaluru with no network: a lost context comes back with the model and its landmark labels', async ({ page, context }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countGlBuffers(page);
    await stubAt(page, '2026-10-07T06:05:00Z');
    await openV2(page, '/heat-map/in/bengaluru/mg-road/?lab=1');
    await relief(page);
    const chips = page.locator('#lmlabs .lmlab:not([hidden])');
    await expect(chips.first(), 'the landmark labels are up before the loss').toBeVisible({ timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __bigUploads: number[] }).__bigUploads.length), { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(5000);
    const labelsBefore = await chips.count();

    /* THE CONNECTION DROPS. From here any request for the model or the decoder is a failure of this test, not just a failed fetch. */
    await context.setOffline(true);
    const asked: string[] = [];
    page.on('request', (request) => { if (/\.glb|\/draco\//.test(request.url())) asked.push(request.url()); });

    await restoreBringsCityBack(page, thrown, 2);
    await expect(chips.first(), 'the landmark labels come back after the restore').toBeVisible({ timeout: 60_000 });
    expect(await chips.count(), 'the same landmarks').toBe(labelsBefore);
    expect(asked, 'the restore decoded the kept bytes: no request for the model or the decoder').toEqual([]);
    await context.setOffline(false);
  });
});
