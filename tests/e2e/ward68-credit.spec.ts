import { expect, test, type Page } from '@playwright/test';

/**
 * THE WARD 68 BOUNDARY'S CREDIT IS ON SCREEN WHEREVER THE BOUNDARY IS DRAWN.
 *
 * The polygon is DataMeet's, CC BY-SA 2.5 India, so attribution is a licence term,
 * not a courtesy. Until the pre-ship audit (2026-10-03) the only credit was a line
 * in the legend — below the fold on a desktop and `display:none` on a phone — so it
 * was present in the DOM and seen by nobody. Asserted here as a reader would meet
 * it: visible, inside the viewport, at desktop and phone sizes, and absent where no
 * boundary is drawn.
 */

async function settled(page: Page): Promise<void> {
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
}

test.describe('the DataMeet credit', () => {
  test.setTimeout(120_000);

  /* FLIP (plan B.2.2): the two tests that stood here read v1's under-the-mean line (#wardScope .ward-credit) and MapLibre's own attribution control, neither of which the v2 page draws.
     The credit is v2's Credits popover now; its holders: obos-v2-shell.spec.ts "credits: every licence is a real link; DataMeet credit present for Ward 68" (desktop, with the by-sa/2.5/in
     licence linked) and obos-v2-phone.spec.ts (the credits chip on a phone, 44 px, on top, opening the DataMeet credit). The honesty rule (the boundary's credit is on screen) keeps both holders. */

  test('an area with no boundary credits none', async ({ page }) => {
    await page.goto('/heat-map/in/kolkata/baruipur/');
    await settled(page);
    await expect(page.locator('#wardScope')).toBeHidden();
    /* v2: the credit lives in the Credits popover; it must not name DataMeet where no DataMeet boundary is drawn */
    await page.locator('[data-pop-open="credits"]').click();
    await expect(page.locator('#v2Credits')).toBeVisible();
    await expect(page.locator('#v2Credits')).not.toContainText('DataMeet');
  });
});
