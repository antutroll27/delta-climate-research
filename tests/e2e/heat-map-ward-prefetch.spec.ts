import { expect, test, type Page } from '@playwright/test';

/**
 * THE CITY'S OTHER WARDS ARE FETCHED IN THE BACKGROUND — AND NOT UNDER SAVE-DATA.
 *
 * Asserts REQUESTS, not timings. The preview server sends no cache headers, so a
 * switch-time assertion here would measure the test harness, not the feature.
 */
const OPEN = '/heat-map/in/bengaluru/indiranagar/';
const SIBLINGS = [
  '/heat-map/data/mg-road.json',
  '/heat-map/data/whitefield.json',
  '/heat-map/models/mg-road.glb',
];

function recordRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(new URL(request.url()).pathname));
  return seen;
}

async function waitForWard(page: Page): Promise<void> {
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });
}

test("after the first ward loads, the city's other wards are fetched in the background", async ({ page }) => {
  const seen = recordRequests(page);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await waitForWard(page);
  await expect.poll(() => SIBLINGS.filter((url) => seen.includes(url)), { timeout: 20_000 }).toEqual(SIBLINGS);
});

test('with Save-Data set, no other ward is fetched', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true, value: { saveData: true, effectiveType: '4g' },
    });
  });
  const seen = recordRequests(page);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await waitForWard(page);
  /* requestIdleCallback's timeout is 4 s, so a prefetch that was going to run has
     started by 8 s. A bounded wait is the only way to assert that something did NOT
     happen. If this fails, find what else is requesting a sibling — do not loosen it. */
  await page.waitForTimeout(8_000);
  expect(SIBLINGS.filter((url) => seen.includes(url))).toEqual([]);
});

test('a switch before the warm-up runs does not cancel it for the rest of the visit', async ({ page }) => {
  /* DETERMINISTIC, NOT A RACE. The prefetch's idle callbacks (the only ones asking for a
     4 s timeout) are held until the switch has committed, then released. Scheduled once
     per page, the first ward's warm-up was aborted by the switch and never re-scheduled,
     so Whitefield was never fetched; re-scheduled per commit, the switch's own commit
     queues one. Nothing else on an MG Road switch requests Whitefield. */
  await page.addInitScript(() => {
    const held: IdleRequestCallback[] = [];
    const real = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) => {
      if (options?.timeout !== 4000) return real(callback, options);
      held.push(callback);
      return 0;
    };
    (window as unknown as { releaseIdle: () => void }).releaseIdle = () =>
      held.splice(0).forEach((callback) => callback({ didTimeout: true, timeRemaining: () => 0 }));
  });
  const seen = recordRequests(page);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await waitForWard(page);
  const first = (await page.locator('#bcount').textContent()) ?? '';
  await page.click('#strip .ward[data-w="mg-road"]');
  await expect(page.locator('#bcount')).not.toHaveText(first, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { releaseIdle: () => void }).releaseIdle());
  await expect.poll(() => seen.includes('/heat-map/data/whitefield.json'), { timeout: 20_000 }).toBe(true);
});
