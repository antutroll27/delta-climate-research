import { expect, test, type Page } from '@playwright/test';

/**
 * EVERY WORD ON THE CONSOLE, AGAINST THE GROUND IT IS ACTUALLY DRAWN ON.
 *
 * WHY THIS IS MEASURED FROM PIXELS AND NOT FROM TOKENS. Almost every surface on
 * this console is translucent — the panels, the legend, the chips, the compass
 * and the banner all carry an alpha over a LIVE MAP, with a backdrop blur on top
 * of that. So an element's true
 * background is not any value in the stylesheet: it is the map, the panel tint
 * and the blur composited together, and it moves with the basemap theme, the
 * zoom, the hour and the heat field itself.
 *
 * Computing contrast from `--faint` against `--panel-ground` therefore answers a
 * question nobody asked. Measured: that arithmetic reported 3.93:1 for the worst
 * `--faint` node. Sampling the rendered frame put the same token at 2.87:1 on
 * Slate and 2.37:1 on Clay — the stylesheet cannot see the map showing through.
 *
 * So this reads the screenshot. Each text node's ground is the DOMINANT colour
 * INSIDE its own box — the most frequent pixel, quantised to 8 levels a channel
 * so antialiasing does not split one ground into forty near-identical bins.
 * Glyphs cover a minority of a text box, so the mode is the background; that is
 * also what a reader means by "the ground this word sits on".
 *
 * IT SAMPLES INSIDE THE BOX, AND THE FIRST VERSION DID NOT. Reading a ring of
 * pixels just OUTSIDE the box picks up whatever happens to be adjacent, which
 * for the legend heading is the heat ramp two pixels below it: that reported
 * "Land Surface Temp" at 1.76:1 against `rgb(114,117,118)`, a gradient the words
 * never touch. A guard that invents failures gets switched off, so the sampling
 * has to answer the question actually being asked.
 *
 * BOTH THEMES, and Clay is not the afterthought it looks like. The console's
 * overlays were designed against a dark basemap; the pale one leaves the same
 * ink on a ground that has moved out from under it, and the map-borne overlays
 * fail there by margins they never approach on Slate. Measured before this
 * guard existed: 19 failures on Slate against 29 on Clay. A guard that ran only
 * on the default theme would have called the console clean at more than half
 * its real defect count.
 */

const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

/** WCAG 1.4.3: 4.5:1 for body text, 3:1 once it is large (24px, or 18.66px bold). */
interface Finding {
  ratio: number; floor: number; color: string; ground: string;
  px: number; text: string; path: string;
}

/**
 * Sample the built page and return every text node that misses its floor.
 *
 * The screenshot is sent BACK INTO the page and decoded through a 2-D canvas —
 * MapLibre runs `preserveDrawingBuffer: false`, so the GL buffer cannot be read
 * after a frame, and this is the only way to get at the composited pixels the
 * reader is actually looking at.
 */
async function contrastFailures(page: Page): Promise<Finding[]> {
  /* EVERY BOX, READ BEFORE THE SHUTTER. The sampling pass below reads each box
     again, two frames later, and compares — see MOTION there. */
  await page.evaluate(() => {
    const m = new WeakMap<Element, string>();
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      m.set(el, [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','));
    }
    (window as unknown as { __boxesBefore?: WeakMap<Element, string> }).__boxesBefore = m;
  });
  const shot = (await page.screenshot()).toString('base64');
  const { findings, moved } = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = `data:image/png;base64,${b64}`; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the pixel read');
    ctx.drawImage(img, 0, 0);
    const D = ctx.getImageData(0, 0, cv.width, cv.height).data;

    const at = (x: number, y: number): number[] => {
      const i = (cv.width * y + x) << 2;
      return [D[i], D[i + 1], D[i + 2]];
    };
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const L = (c: number[]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (f: number[], g: number[]): number => {
      const a = L(f), b = L(g);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const parse = (s: string): number[] => (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3);

    const out: Finding[] = [];
    let moved = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      /* Leaf text only. An element with children would be measured again through
         each of them, and its own box spans grounds its text never touches. */
      if (!el.textContent?.trim() || el.children.length) continue;
      const r = el.getBoundingClientRect();
      /* Fully inside the viewport, or the ring samples pixels the screenshot
         does not contain and the ground comes back black. */
      if (r.width < 2 || r.height < 2) continue;
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;

      /* OCCLUSION. The ground is sampled inside the element's own box, which is
         only its ground if nothing opaque sits on top — and the building card is
         clamped inside the canvas, so it lands ON aside.panel.right. That put
         about twenty right-panel readouts (#uhi, #liveT, #conf, #lst, the .k
         labels, the tint chips) against the card's cream at ~1.1:1 while they
         were really pale ink on a dark panel. Hit-test the box's centre; if the
         topmost element there is neither this element, nor inside it, nor an
         ancestor of it, something covers it and it is skipped.

         THE HIT TEST IS NOT THE PAINT ORDER UNTIL TWO THINGS ARE CORRECTED, and
         both were measured on this page rather than reasoned about.
         · POINTER-EVENTS. Every overlay on the map sets `pointer-events:none` —
           the sun line, the place name, the walk-time ring labels, the greenery
           tag — so an unforced hit test falls through them to the canvas and
           calls each one covered. It swallowed #sunLineText, the node this
           file's header cites as the whole reason Clay is measured, and with it
           the ring label's REAL 4.31:1 (its 88% cream pill over the dark panel
           composites to rgb(217 217 215), not to the cream). The property is
           forced on for the length of the test and put straight back; the
           screenshot was taken before the loop, so nothing measured moves.
         · AN ANCESTOR ON TOP. SelectField's `.field-trigger::after` is an empty
           transparent inset:0 overlay that exists only to widen the hit area, so
           the button answers for its own labels. An ancestor's box is BEHIND its
           descendant's text, and its pseudo-elements are already in the pixels
           this samples, so an ancestor is never a cover.
         Together those took a plain sweep's removals from 14 to 4.

         CEILINGS: a partially covered element is sampled as if uncovered, and a
         fully transparent SIBLING on top still reads as a cover — the four left
         in a plain sweep are that, and all four cleared their floor when they
         were still being scored. */
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const style = (el as HTMLElement).style, pe = style.pointerEvents;
      style.pointerEvents = 'auto';
      const topEl = document.elementFromPoint(cx, cy);
      style.pointerEvents = pe;
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) continue;

      /* MOTION. The screenshot and this read are two frames apart, and the
         selection's ring labels are repositioned on every map render — on the
         CI runner they never held still for 15 s. An element whose box differs
         from its box read just before the shot was sampled somewhere it no longer
         is, so it is skipped this sweep rather than scored against the map.
         Ceiling: an element moving in place (same box, changing colour) is not
         caught by this. */
      const before = (window as unknown as { __boxesBefore?: WeakMap<Element, string> }).__boxesBefore?.get(el);
      const nowBox = [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',');
      if (before !== undefined && before !== nowBox) { moved += 1; continue; }

      const x0 = Math.round(r.left), y0 = Math.round(r.top);
      const x1 = Math.min(cv.width, Math.round(r.right));
      const y1 = Math.min(cv.height, Math.round(r.bottom));
      const bins = new Map<number, { n: number; c: number[] }>();
      for (let y = Math.max(0, y0); y < y1; y++) {
        for (let x = Math.max(0, x0); x < x1; x++) {
          const c = at(x, y);
          /* 8 levels a channel. Antialiased edges otherwise scatter one flat
             ground across dozens of bins and no single colour wins. */
          const key = ((c[0] >> 5) << 10) | ((c[1] >> 5) << 5) | (c[2] >> 5);
          const hit = bins.get(key);
          if (hit) { hit.n++; } else { bins.set(key, { n: 1, c }); }
        }
      }
      if (!bins.size) continue;
      let ground = [0, 0, 0], best = -1;
      for (const { n, c } of bins.values()) if (n > best) { best = n; ground = c; }

      /* SVG TEXT IS PAINTED BY `fill`, NOT BY `color`, and reading the wrong one
         invents failures out of nothing. The compass letters inherit a near-white
         `color` from an ancestor while `fill` paints them red and slate; scoring
         them on `color` reported BOTH at 1.00:1 against the dial — two of the
         worst numbers in the whole run, and neither was real. */
      const painted = el.namespaceURI === 'http://www.w3.org/2000/svg' ? cs.fill : cs.color;
      const fg = parse(painted);
      if (fg.length < 3) continue;              // `none`, a url(#gradient), a keyword
      const px = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const floor = large ? 3 : 4.5;
      const cr = ratio(fg, ground);
      if (cr >= floor) continue;

      const path: string[] = [];
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        const cls = typeof n.className === 'string' && n.className.trim()
          ? `.${n.className.trim().split(/\s+/).join('.')}` : '';
        path.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + cls);
      }
      out.push({
        ratio: Number(cr.toFixed(2)), floor, color: painted,
        ground: `rgb(${ground.join(',')})`, px: Number(px.toFixed(1)),
        text: el.textContent.trim().slice(0, 30), path: path.slice(-3).join(' > '),
      });
    }
    return { findings: out.sort((a, b) => a.ratio - b.ratio), moved };
  }, shot);
  /* Said out loud, because a skip that silently ate every failure would look
     exactly like a clean sweep. */
  console.log(`[contrast] motion skip removed ${moved} element(s) from this sweep`);
  return findings;
}

function report(theme: string, findings: Finding[]): string {
  return `${findings.length} text node(s) below the WCAG floor on ${theme}:\n`
    + findings.map(f => `  ${String(f.ratio).padStart(5)}:1 (needs ${f.floor}) `
      + `${f.px}px ${f.color} on ${f.ground}\n        ${f.path}\n        "${f.text}"`).join('\n');
}

/** Wait for a reading — the console paints its numbers only once a ward is up. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  await page.waitForTimeout(3_000);
}

test.describe('console legibility', () => {
  test.setTimeout(180_000);

  test('every word clears its contrast floor on the default basemap', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'one tier is enough: this measures ink against panel grounds, not the renderer');
    await page.goto(BALLYGUNGE);
    await settled(page);
    const findings = await contrastFailures(page);
    expect(findings, report('OBOS Slate', findings)).toEqual([]);
  });

  test('every word clears its contrast floor on the clay basemap', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'one tier is enough: this measures ink against panel grounds, not the renderer');
    /* THE THEME THAT HAD NO COVERAGE AND THE WORST NUMBERS. The overlays were
       styled for a dark map; Clay makes the ground pale and leaves the ink where
       it was, so the map-borne text fails here by margins it never approaches on
       Slate — the sun line read 1.33:1 and the honesty banner 2.24:1. */
    await page.goto(BALLYGUNGE);
    await settled(page);
    await page.locator('#envchip button[data-e="studio"]').click();
    await page.waitForTimeout(4_000);
    const findings = await contrastFailures(page);
    expect(findings, report('Clay studio', findings)).toEqual([]);
  });

  test('Clay studio with a building card open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-tier0',
      'one tier is enough: this measures ink against panel grounds, not the renderer');
    /* THE INK THE OTHER TWO SWEEPS NEVER SEE. The building card, its solar block
       and the Solar pane are painted only after a selection, so a walk over the
       page as it boots reads none of them — on the theme where the ground moved. */
    await page.goto(BALLYGUNGE);
    await settled(page);
    /* The software renderer skips the 3D layer at boot, so nothing projects and
       the card stays at opacity 0 — which this sampler skips. Forcing relief is
       what puts the card on screen at opacity 1, where it IS sampled. */
    await page.locator('#modechip button[data-m="relief"]').click();
    await page.waitForTimeout(4_000);
    await page.locator('[data-rail="solar"]').click();
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    await page.locator('#solList tr').first().click();
    await page.waitForTimeout(1_500);
    await page.locator('#envchip button[data-e="studio"]').click();
    await page.waitForTimeout(4_000);
    const findings = await contrastFailures(page);
    expect(findings, report('Clay studio, card open', findings)).toEqual([]);
  });
});
