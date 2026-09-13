import { expect, test, type Page } from '@playwright/test';

/**
 * THE CONSOLE'S OVERLAYS MUST NOT COVER EACH OTHER.
 *
 * Every badge, chip and widget on this console is absolutely positioned over one
 * map. Nothing about that arrangement reserves space: two overlays anchored to
 * different edges do not know the other exists, and the only thing keeping them
 * apart is the width of the viewport. Narrow the window and they walk into each
 * other — silently, because neither element changes, nothing throws, and no
 * layout assertion anywhere notices that one is now painted over the other.
 *
 * MEASURED, before this guard existed. `.con-stamp` is centred on the map
 * (`left:50%` on `.stamp-slot`); the ward clock is anchored right. The gap
 * between them closes as the viewport narrows:
 *
 *     1680   0px      clear
 *     1536  10px      4% of the stamp
 *     1440  58px     25%
 *     1366  95px     40%
 *     1280 122px     52%   ← only the "U" of "Under Construction" survives
 *
 * Those are the three commonest laptop widths, worst first. This is the same
 * defect as the honesty banner that wrapped and then clipped behind `.rail-r`;
 * that fix moved the rail and never considered this pair.
 *
 * WHY IT SURVIVED A GREEN SUITE. The clock is drawn only when there is a live
 * reading — `paintClock` hides it behind `btn.hidden = !L` — and the browser suite
 * used to run against a plain `astro preview`, which answers 404 for /api/live.
 * #clockw was 0x0 in ten of the eleven specs, so it could not collide with
 * anything, and console-contrast.spec.ts walked "every word on the console" over a
 * console this widget was missing from. See playwright.config.ts's webServer.
 *
 * THE ASSERTION IS GEOMETRIC, NOT VISUAL. A screenshot would pin today's pixels
 * and fail on every deliberate restyle; what must stay true is only that these two
 * boxes do not intersect.
 */

const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

/* The widths a reader actually has. 1280 and 1440 are the two commonest laptop
   viewports; 1366 is the commonest Windows one; 1536 is a 1920 screen at 125%
   scaling, which is Windows' default. 1024 stands in for the narrowest desktop
   the console still lays out as a desktop. */
const WIDTHS = [1024, 1280, 1366, 1440, 1536, 1680, 1920];

interface Box { x: number; y: number; w: number; h: number }

/** Wait for the ward: the clock is not drawn until a reading has arrived. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  await expect(page.locator('#clockw')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

/** Both boxes, or null for whichever is not on the page. */
async function boxes(page: Page): Promise<{ stamp: Box | null; clock: Box | null }> {
  return page.evaluate(() => {
    const read = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    return {
      stamp: read(document.querySelector('.con-stamp')),
      clock: read(document.getElementById('clockw')),
    };
  });
}

const overlap = (a: Box, b: Box): { x: number; y: number } => ({
  x: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
  y: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)),
});

test.describe('console overlays', () => {
  test.setTimeout(240_000);

  test('the construction stamp and the ward clock never cover each other', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'one tier is enough: this measures element geometry, not the renderer');

    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(BALLYGUNGE);
    await settled(page);

    const collisions: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      /* The stamp is centred and the clock right-anchored; both move on resize
         and neither animates, so one frame is enough to settle. */
      await page.waitForTimeout(700);

      const { stamp, clock } = await boxes(page);
      /* THE CLOCK MUST BE THERE. If it is 0x0 the server is not serving
         /api/live and this test proves nothing — that is exactly the hole it was
         written to close, so it fails rather than passing vacuously. */
      expect(clock, `#clockw missing at ${width}px`).not.toBeNull();
      expect(clock!.w, `#clockw is 0-wide at ${width}px — is the suite's server serving /api/live?`)
        .toBeGreaterThan(0);
      if (!stamp) continue;   // the stamp is a temporary badge; absent is fine

      const o = overlap(stamp, clock!);
      if (o.x > 0 && o.y > 0) {
        const covered = Math.round((100 * o.x * o.y) / (stamp.w * stamp.h));
        collisions.push(`${width}px: ${Math.round(o.x)}x${Math.round(o.y)}px — ${covered}% of the stamp`);
      }
    }

    expect(collisions, `the ward clock is painted over the construction stamp:\n  ${collisions.join('\n  ')}`)
      .toEqual([]);
  });
});
