// tests/e2e/obos-v2-helpers.ts
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
export const METAR = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8')) as { icaoId: string; rawOb: string }[];
export const METNO = readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8');

/** The observed-weather spec's stub (heat-map-observed-weather.spec.ts:22–39), parameterised. */
export async function stubWeather(page: Page, serverNow: string, reports: readonly { icao: string; raw: string }[] | null = null): Promise<void> {
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(serverNow).toUTCString(), age: '0' }, body: METNO,
  }));
  await page.route(/\/api\/metar\?/, (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? [];
    const list = reports ?? METAR.map((r) => ({ icao: r.icaoId, raw: r.rawOb }));
    void route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { date: new Date(serverNow).toUTCString() },
      body: JSON.stringify({ source: 'aviationweather.gov', fetchedAt: '2026-10-07T06:09:00.000Z',
        reports: list.filter((r) => ids.includes(r.icao)) }),
    });
  });
}

/** A fixed instant and a synthetic met.no reading at it; /api/metar stays the server's canned empty list. */
export async function stubAt(page: Page, iso: string): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
  await page.route(/\/api\/live\?/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { date: new Date(iso).toUTCString(), age: '0' },
    body: JSON.stringify({ properties: { timeseries: [{ time: `${iso.slice(0, 14)}00:00Z`, data: { instant: { details: {
      air_temperature: 30.0, relative_humidity: 65, wind_speed: 2.4, cloud_area_fraction: 20 } } } }] } }),
  }));
}

export async function openV2(page: Page, path = '/heat-map/in/kolkata/ballygunge/'): Promise<void> {
  await page.addInitScript(() => { try { sessionStorage.setItem('delta:loaded', '1'); } catch { /* none */ } });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'v2');
  await expect(page.locator('main.obos-v2')).toHaveCount(1);
  if (path.includes('/in/')) {
    await expect(page.locator('#simBackend')).not.toHaveText('SELECTING ENGINE', { timeout: 60_000 });
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 60_000 });
  }
}

export async function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const e of document.querySelectorAll('[id]')) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
}

/** Visible text of a node, as a sighted reader gets it (innerText drops display:none). */
export const visibleText = (page: Page, sel: string): Promise<string> =>
  page.locator(sel).evaluate((e) => (e as HTMLElement).innerText);

/* ──────────────────────────────── S8: the phone ──────────────────────────────── */

/**
 * EVERYTHING THAT CAN GO WRONG WITH A PHONE LAYOUT, in one read of the live page. An empty array is a clean screen.
 *   · the page, the v2 root, the sheet and the drawer never scroll sideways;
 *   · every visible piece of chrome (menu button, title card, compass, toolbar, sheet, nudge, an open popover) lies inside the viewport;
 *   · no two pieces of chrome overlap (area in px², more than 4 px² counts);
 *   · every interactive control is at least 24 px on its short side (WCAG 2.5.8), the v2 floor for a fine pointer; inline links in running text excepted.
 * This reads boxes, not pixels. Occlusion of one figure by another is checked where it matters with `occludedBy`.
 */
export async function phoneIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const iw = window.innerWidth, ih = window.innerHeight;
    const root = document.querySelector<HTMLElement>('main.obos-v2');
    if (!root) return ['no v2 root'];
    const shown = (e: Element): boolean => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    if (document.documentElement.scrollWidth > iw) out.push(`the page scrolls sideways: ${document.documentElement.scrollWidth} > ${iw}`);
    for (const sel of ['main.obos-v2', '#v2Sheet', '#v2Drawer']) {
      const e = document.querySelector<HTMLElement>(sel);
      if (e && shown(e) && e.scrollWidth > e.clientWidth + 1) out.push(`${sel} scrolls sideways: ${e.scrollWidth} > ${e.clientWidth}`);
    }
    const chrome: Array<[string, Element | null]> = [
      ['menu button', document.querySelector('.tw-menu')], ['title card', document.querySelector('.st-title .tc')], ['compass', document.querySelector('#compass')],
      ['toolbar', document.querySelector('.obos-v2 > .toolbar')], ['sheet', document.querySelector('#v2Sheet')], ['rotate nudge', document.querySelector('#rotateNudge')],
      ['drawer', document.querySelector('#v2Drawer')], ['layers popover', document.querySelector('#v2Layers')], ['credits popover', document.querySelector('#v2Credits')], ['key popover', document.querySelector('#v2Key')],
    ];
    const live = chrome.filter(([, e]) => e && shown(e)) as Array<[string, Element]>;
    for (const [n, e] of live) {
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > iw + 0.5 || r.bottom > ih + 0.5) out.push(`${n} leaves the viewport: ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')} in ${iw}x${ih}`);
    }
    /* popovers and the drawer are modal-ish layers that cover the page by design: only the always-on chrome is compared with each other */
    const flat = live.filter(([n]) => !/popover|drawer/.test(n));
    for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i][1].getBoundingClientRect(), b = flat[j][1].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0 && w * h > 4) out.push(`${flat[i][0]} overlaps ${flat[j][0]} by ${Math.round(w)}x${Math.round(h)} px`);
    }
    for (const e of root.querySelectorAll<HTMLElement>('button, summary, select, input:not([type="hidden"]), [role="button"], [role="combobox"], a[href]')) {
      /* .field-store is SelectField's visually hidden native <select> (a 1x1 form store, not a control a person reaches: the combobox beside it is) */
      if (!shown(e) || e.closest('[inert], .sr-only, [hidden]') || e.matches('.sr-only, .field-store')) continue;
      if (e.tagName === 'A' && getComputedStyle(e).display === 'inline') continue;
      /* a checkbox or radio inside its <label> is hit through the label: the row is the target (LayerTree wraps its control on purpose) */
      const r = (e.matches('input[type="checkbox"], input[type="radio"]') ? e.closest('label') ?? e : e).getBoundingClientRect();
      if (Math.min(r.width, r.height) < 24 - 0.5) out.push(`target under 24 px: ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).trim().split(/\s+/).join('.')} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent ?? '').trim().slice(0, 24)}"`);
    }
    return out;
  });
}

/** The topmost element at the centre of `sel` is `sel` itself or inside it (nothing sits on top of it): honesty text is not covered by a sheet or a card. */
export async function occludedBy(page: Page, sel: string): Promise<string | null> {
  return page.locator(sel).first().evaluate((e) => {
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return 'nothing is at its centre (off screen)';
    return e.contains(top) || top.contains(e) ? null : `covered by ${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}.${String(top.className).trim().split(/\s+/).join('.')}`;
  });
}

/* ──────────────────────────────── S8: contrast over the live canvas (spec §7.1) ──────────────────────────────── */
/* Copied VERBATIM from console-contrast.spec.ts :44–237 (plan S8.2 Step 1): the word walker that scores every text node against the pixels it is drawn on.
   The only change is `export`. It skips #bcard-covered nodes exactly as the v1 sweep does, because the card keeps its id in v2. */
/** WCAG 1.4.3: 4.5:1 for body text, 3:1 once it is large (24px, or 18.66px bold). */
export interface Finding {
  ratio: number; floor: number; color: string; ground: string;
  px: number; text: string; path: string;
  /** Inside the Air card or the Air pane. */
  air: boolean;
}

/**
 * Sample the built page and return every text node that misses its floor.
 *
 * The screenshot is sent BACK INTO the page and decoded through a 2-D canvas —
 * MapLibre runs `preserveDrawingBuffer: false`, so the GL buffer cannot be read
 * after a frame, and this is the only way to get at the composited pixels the
 * reader is actually looking at.
 */
export async function contrastFailures(page: Page): Promise<Finding[]> {
  /* EVERY BOX, READ BEFORE THE SHUTTER. The sampling pass below reads each box
     again, two frames later, and compares — see MOTION there. */
  await page.evaluate(() => {
    const m = new WeakMap<Element, string>();
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      m.set(el, [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','));
    }
    (window as unknown as { __boxesBefore?: WeakMap<Element, string> }).__boxesBefore = m;
    const cardEl = document.querySelector('#bcard');
    const cb = cardEl && !cardEl.hasAttribute('hidden') && getComputedStyle(cardEl).opacity !== '0' ? cardEl.getBoundingClientRect() : null;
    (window as unknown as { __cardBoxBefore?: number[] | null }).__cardBoxBefore = cb ? [cb.left, cb.top, cb.right, cb.bottom] : null;
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
      /* UNDER THE CARD. The card is the one opaque overlay that sits over other
         text (z-index 7, 90% cream), and the hit test above missed it: on
         2026-09-06 the right panel's confidence chip was scored against the
         card's cream twice of two while a hit test one frame later resolved to
         the chip itself. The card's box read in the same pre-shot pass as the
         element boxes is what the screenshot shows, so an element whose centre
         lies inside it, and is not part of it, is under it and is skipped.
         Ceiling: a partial cover — the box edge across an element — is not. */
      const cardNow = document.querySelector('#bcard');
      const cbb = (window as unknown as { __cardBoxBefore?: number[] | null }).__cardBoxBefore;
      /* PARTIAL COVERS TOO: the centre and four inset corners are tested, not the
         centre alone, so the opaque card's edge across an element (a tint chip)
         skips it instead of scoring the card.
         THE MAP-BORNE CHIPS ARE NOT SKIPPED (pre-ship audit 2026-10-03). The greenery
         tag and the ring labels were once excused here as covers, which hid real
         overlaps — the tag over #wardScope and the LST unit, a ring label on the
         tag. The app now keeps them clear of the HUD and of each other
         (heat-map-app.ts hudKeepOut), so text under one of them is a failure. */
      const probes = [[cx, cy], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
      const inBox = (b: number[]) => probes.some(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
      if (cbb && cardNow && !cardNow.contains(el) && inBox(cbb)) continue;

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
        air: el.closest('#aqiBlock, #airPane') !== null,
      });
    }
    return { findings: out.sort((a, b) => a.ratio - b.ratio), moved };
  }, shot);
  /* Said out loud, because a skip that silently ate every failure would look
     exactly like a clean sweep. */
  console.log(`[contrast] motion skip removed ${moved} element(s) from this sweep`);
  return findings;
}

export function report(label: string, findings: Finding[]): string {
  return `${findings.length} text node(s) below the WCAG floor on ${label}:\n`
    + findings.map((f) => `  ${String(f.ratio).padStart(5)}:1 (needs ${f.floor}) ${f.px}px ${f.color} on ${f.ground}\n        ${f.path}\n        "${f.text}"`).join('\n');
}

/**
 * ONE SCREEN, SWEPT WHOLE. contrastFailures scores only what is inside the viewport, so a column that scrolls (the right column, the side panel, the phone sheet
 * and the drawer) is swept at its top, its middle and its foot: every word on the screen is on screen once. A finding repeated at two offsets is reported once.
 */
export async function sweepScreen(page: Page, label: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tag: string, fs: Finding[]): void => {
    for (const f of fs) {
      const key = `${f.text}|${f.path}|${f.ground}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${label} · ${tag}: ${f.ratio}:1 (needs ${f.floor}) ${f.px}px ${f.color} on ${f.ground} "${f.text}" ${f.path}`);
    }
  };
  add('top', await contrastFailures(page));
  for (const sel of ['#legend', '.side-panel .sp-scroll', '#v2Sheet', '#v2Drawer']) {
    const room = await page.evaluate((s) => { const e = document.querySelector<HTMLElement>(s); return !e || e.getClientRects().length === 0 ? 0 : e.scrollHeight - e.clientHeight; }, sel);
    if (room < 24) continue;
    for (const at of [0.5, 1]) {
      await page.evaluate(([s, y]) => { document.querySelector<HTMLElement>(s as string)!.scrollTop = y as number; }, [sel, Math.round(room * at)]);
      await page.waitForTimeout(250);
      add(`${sel} @${Math.round(at * 100)}%`, await contrastFailures(page));
    }
    await page.evaluate((s) => { document.querySelector<HTMLElement>(s)!.scrollTop = 0; }, sel);
  }
  return out;
}
