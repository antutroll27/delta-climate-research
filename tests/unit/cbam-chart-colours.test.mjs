import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * THE COLOURS THE GRAPHS DRAW ARE CHECKED, NOT EYEBALLED.
 *
 * Since the bento redesign (spec §3, §5.2, §5.3) the CBAM views draw three kinds of mark and no
 * hue other than the one the colour law allows: BRONZE (--bronze-f), which means the Commission's
 * default or the mark-up and nothing else, and the INKS (--ink, --ink-3, and their translucent
 * tints), which mean everything else. Whether those can be told apart, by someone with a
 * colour-vision deficiency as well as someone without, on the surfaces they are drawn on, is
 * computable; so it is computed here, from the tokens in cbam-app.css and cbam-bento.css, in the
 * light and the dark theme, on the white (dark teal) card and on the inverted hero (near-black in
 * light, PEARL in dark). Change a token to a colour that fails and this fails.
 *
 * (These four tests used to guard the four --color-chart-* tokens of the old dark "why does it rise?"
 * card. Nothing draws those any more; they are retired, and the same checks, at the same thresholds,
 * now hold what is drawn.)
 *
 * The method (lightness band and chroma floor for the hue, pair separation in OKLab under simulated
 * protanopia, deuteranopia and tritanopia, and contrast with the surface) follows the palette checks
 * the old tokens' own comment recorded. The thresholds are the same: separation of at least 8 under a
 * simulated deficiency and at least 15 with full colour vision, chroma of at least 0.10 for the hue,
 * and 3:1 against the surface (WCAG 1.4.11). This is an independent implementation, so its figures
 * are held to those thresholds, not to recorded decimals.
 */
const read = (f) => readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), 'utf8');
const css = read('src/styles/global.css');
const app = read('src/styles/cbam-app.css');
const bento = read('src/styles/cbam-bento.css');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  assert.ok(m, `--${name} must be a six-digit hex colour in global.css`);
  return m[1].toLowerCase();
};

// The token blocks, read the way cbam-bento-contrast.test.mjs reads them: light is .cbx; dark overrides it.
const block = (src, selector) => {
  const at = src.indexOf(`${selector}{`);
  assert.ok(at >= 0, `${selector}{ … } must exist`);
  return src.slice(at + selector.length + 1, src.indexOf('}', at));
};
const tokens = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = { ...tokens(block(app, '.cbx')), ...tokens(block(bento, '.cbx')) };
const DARK = { ...LIGHT, ...tokens(block(app, '.cbx[data-theme="dark"]')), ...tokens(block(bento, '.cbx[data-theme="dark"]')) };
const rgbOf = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  assert.ok(m, `cannot evaluate ${v}`);
  const p = m[1].split(',').map(parseFloat);
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const toHex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
/** A token as a solid hex, a translucent one composited over `base` (a hex). */
const solid = (theme, name, base = null) => {
  const c = rgbOf(theme[name] ?? name);
  if (c[3] === 1) return toHex(c.slice(0, 3));
  assert.ok(base, `${name} is translucent: name the surface it sits on`);
  const b = rgbOf(base);
  return toHex([0, 1, 2].map((i) => c[i] * c[3] + b[i] * (1 - c[3])));
};
/** A tint of one token over another, as the CSS draws it: color-mix(in oklab, X pct%, transparent) over a base, in sRGB (close enough to hold a 3:1 and a ΔE line). */
const tint = (theme, name, pct, base) => {
  const c = rgbOf(theme[name] ?? name), b = rgbOf(base);
  return toHex([0, 1, 2].map((i) => c[i] * (pct / 100) + b[i] * (1 - pct / 100)));
};

const lin = (hex) => [1, 3, 5].map((i) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const sim = (rgb, m) => m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
const deltaE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/**
 * `hues` are the colours that carry meaning BY HUE (lightness band and chroma floor apply to them);
 * `greys` carry it by lightness and position, so only contrast and separation apply. Every pair
 * across both is held to the separation floors; every colour to 3:1 on every surface.
 */
function check({ hues = [], greys = [] }, surfaces, band) {
  const problems = [];
  const all = [...hues, ...greys];
  for (const hex of all) {
    const [L, a, b] = oklab(lin(hex));
    if (hues.includes(hex)) {
      if (L < band[0] || L > band[1]) problems.push(`${hex}: lightness ${L.toFixed(3)} outside ${band.join('–')}`);
      if (Math.hypot(a, b) < 0.1) problems.push(`${hex}: chroma ${Math.hypot(a, b).toFixed(3)} below 0.10 (reads as grey)`);
    }
    for (const surface of surfaces) {
      if (contrast(hex, surface) < 3) problems.push(`${hex}: contrast ${contrast(hex, surface).toFixed(2)} with ${surface} below 3:1`);
    }
  }
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const [p, q] = [all[i], all[j]].map(lin);
      const normal = deltaE(oklab(p), oklab(q));
      if (normal < 15) problems.push(`${all[i]} / ${all[j]}: separation ${normal.toFixed(1)} with full colour vision, below 15`);
      for (const [name, m] of Object.entries(CVD)) {
        const d = deltaE(oklab(sim(p, m)), oklab(sim(q, m)));
        if (d < 8) problems.push(`${all[i]} / ${all[j]}: separation ${d.toFixed(1)} under ${name}, below 8`);
      }
    }
  }
  return problems;
}

// The hue's lightness band: the old paper band (0.43-0.77) widened to 0.80 at the top, because the dark card's
// bronze (#CFA24A) sits at 0.76 where the old dark band stopped at 0.67. Chroma, contrast and separation are the originals'.
const BAND = [0.43, 0.8];

for (const [name, theme] of [['light', LIGHT], ['dark', DARK]]) {
  const card = solid(theme, '--card');
  const bronze = solid(theme, '--bronze-f');
  const ink = solid(theme, '--ink'), grey = solid(theme, '--seg-3');

  test(`the marks on the ${name} bento card: bronze, ink and the grey are told apart and each stands 3:1 off the card`, () => {
    // The "Why it rises." bar draws all three side by side (mark-up bronze, free allocation ink, benchmark grey).
    assert.deepEqual(check({ hues: [bronze], greys: [ink, grey] }, [card], BAND), []);
  });

  test(`bronze on the ${name} card is told from the marks it stands beside: its base segment and the unlit dots`, () => {
    // What the mark-up adds: the bronze segment on its column over the engine's base count (--well-2 on the card);
    // the plate's mark-up dots, lit bronze against unlit ink at 16%.
    const base = solid(theme, '--well-2', card), off = tint(theme, '--ink', 16, card);
    assert.deepEqual(check({ hues: [bronze], greys: [base] }, [card], BAND).filter((p) => /separation/.test(p)), []);
    assert.deepEqual(check({ hues: [bronze], greys: [off] }, [card], BAND).filter((p) => /separation/.test(p)), []);
  });

  test(`bronze on the ${name} inverted hero: the hero's bronze stands 3:1 off it, apart from the ink tint, with its label legible`, () => {
    // The hero is the ink: near-black in light, PEARL (#F1F3F0) in dark. The 2026 plate's dots and the share bar draw bronze there.
    const hero = solid(theme, '--ink'), heroBronze = solid(theme, '--hero-bz');
    // The rest of the share bar is an ink tint: it only has to be told from the bronze, being the other half of the same bar.
    const rest = tint(theme, '--on-ink', 22, hero);
    assert.deepEqual(check({ hues: [heroBronze] }, [hero], BAND), []);
    assert.deepEqual(check({ hues: [heroBronze], greys: [rest] }, [hero], BAND).filter((p) => /separation/.test(p)), []);
    const label = solid(theme, '--fill-bz-ink');
    assert.ok(contrast(label, heroBronze) >= 4.5, `the label on the hero bronze: ${contrast(label, heroBronze).toFixed(2)}`);
  });
}

test('the check bites: the card bronze on the pearl hero fails 3:1, which is why the hero draws its own; brand colours and a near-twin pair are refused', () => {
  // THE FINDING THIS FILE EXISTS FOR. Bronze (#CFA24A) on the dark theme's pearl hero is 2.1:1: not a mark.
  const pearl = solid(DARK, '--ink');
  assert.ok(contrast(solid(DARK, '--bronze-f'), pearl) < 3, 'the card bronze does not stand on pearl');
  assert.match(bento, /\.cbx \.b-hero \.b-sp-bz\{background:var\(--hero-bz\)\}/);
  assert.match(bento, /\.cbx \.b-hero \.b-d10\.b-bz i\.on\{background:var\(--hero-bz\)\}/);
  assert.match(bento, /\.cbx \.b-sp-ink2\{background:var\(--seg-3\)/);
  // The brand bronze and cyan are too grey for a fill, and the cyan is too light for a dark surface.
  const darkCard = [solid(DARK, '--card'), solid(DARK, '--well')];
  const brand = check({ hues: [token('color-bronze'), token('color-cyan')] }, darkCard, [0.48, 0.67]);
  assert.ok(brand.some((p) => /chroma/.test(p)), brand.join('; '));
  assert.ok(brand.some((p) => /lightness/.test(p)), brand.join('; '));
  // Two cyans a reader cannot tell apart.
  const twins = check({ hues: ['#22a2b5', '#2aa9bb'] }, darkCard, [0.48, 0.67]);
  assert.ok(twins.some((p) => /separation/.test(p)), twins.join('; '));
  // A colour that vanishes into the surface.
  assert.ok(check({ hues: ['#1d3a40', '#22a2b5'] }, darkCard, [0.1, 0.9]).some((p) => /contrast/.test(p)));
});

test('the calculator page draws the graphs in these tokens and names no chart colour of its own', () => {
  // The graphs live in bento tiles (spec §5.3). Their --cg-* tokens are mapped onto the bento tokens
  // in cbam-bento.css, under the colour law (spec §3): bronze only for the mark-up; free allocation,
  // the benchmark and the visitor's own price in ink. None is a colour of its own.
  const start = bento.indexOf('/* ── Why it changes'), end = bento.indexOf('/* ── end Why it changes */');
  assert.ok(start >= 0 && end > start, 'the Why section is marked in cbam-bento.css');
  const why = bento.slice(start, end);
  assert.match(why, /--cg-markup:var\(--bronze-f\);/);
  assert.match(why, /\.cbx \.cg-cost\{--cg-markup:var\(--ink\)\}/);
  // The tokens the cut charts read (allocation, benchmark, surface) are gone: nothing draws them.
  assert.doesNotMatch(bento, /--cg-(allocation|benchmark|surface|warm|neutral-2)/);
  assert.deepEqual(why.match(/--cg-[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8}\b/g) ?? [], [], 'every --cg-* token is a design token');
  // And the old chart tokens are retired from global.css: nothing references them.
  assert.doesNotMatch(css, /--color-chart-/);
  for (const f of ['../../src/scripts/cbam-graphs.ts', '../../src/scripts/cbam-ui/tiles-why.ts', '../../src/scripts/cbam-ui/tiles-years.ts']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    assert.deepEqual(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], `${f} must use the tokens only`);
  }
  // The bar's label colour is a token, not a literal.
  assert.doesNotMatch(bento.slice(bento.indexOf('/* ── Three years'), end), /color:#141614/);
});
