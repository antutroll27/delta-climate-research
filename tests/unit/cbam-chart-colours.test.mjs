import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * THE CHART COLOURS ARE CHECKED, NOT EYEBALLED.
 *
 * The CBAM graphs tell two causes apart by hue (the mark-up, free allocation). Whether two hues
 * can be told apart, by someone with a colour-vision deficiency as well as someone without, on
 * the surface they are drawn on, is computable; so it is computed here, from the four values in
 * src/styles/global.css. Change one of them to a colour that fails and this fails.
 *
 * The method (lightness band, chroma floor, pair separation in OKLab under simulated protanopia,
 * deuteranopia and tritanopia, and contrast with the surface) follows the palette checks the
 * tokens' own comment records. The thresholds are the same: separation of at least 8 under a
 * simulated deficiency and at least 15 with full colour vision, chroma of at least 0.10, and 3:1
 * against the surface. This is an independent implementation, so its figures are held to those
 * thresholds, not to the recorded decimals.
 */
const css = readFileSync(fileURLToPath(new URL('../../src/styles/global.css', import.meta.url)), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  assert.ok(m, `--${name} must be a six-digit hex colour in global.css`);
  return m[1].toLowerCase();
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

function check(colours, surfaces, band) {
  const problems = [];
  for (const hex of colours) {
    const [L, a, b] = oklab(lin(hex));
    if (L < band[0] || L > band[1]) problems.push(`${hex}: lightness ${L.toFixed(3)} outside ${band.join('–')}`);
    if (Math.hypot(a, b) < 0.1) problems.push(`${hex}: chroma ${Math.hypot(a, b).toFixed(3)} below 0.10 (reads as grey)`);
    for (const surface of surfaces) {
      if (contrast(hex, surface) < 3) problems.push(`${hex}: contrast ${contrast(hex, surface).toFixed(2)} with ${surface} below 3:1`);
    }
  }
  const [p, q] = colours.map(lin);
  const normal = deltaE(oklab(p), oklab(q));
  if (normal < 15) problems.push(`${colours.join(' / ')}: separation ${normal.toFixed(1)} with full colour vision, below 15`);
  for (const [name, m] of Object.entries(CVD)) {
    const d = deltaE(oklab(sim(p, m)), oklab(sim(q, m)));
    if (d < 8) problems.push(`${colours.join(' / ')}: separation ${d.toFixed(1)} under ${name}, below 8`);
  }
  return problems;
}

const DARK = [token('color-chart-markup'), token('color-chart-allocation')];
const PAPER = [token('color-chart-markup-paper'), token('color-chart-allocation-paper')];
// The surfaces the graphs are drawn on: the dark card's gradient ends, and the paper tone.
const DARK_SURFACES = ['#0d2b2e', '#0a171b', token('color-instrument')];
const PAPER_SURFACES = [token('color-paper'), '#e6e9ec'];

test('the chart colours on the dark cards pass every check', () => {
  assert.deepEqual(check(DARK, DARK_SURFACES, [0.48, 0.67]), []);
});

test('the chart colours on the paper cards pass every check', () => {
  assert.deepEqual(check(PAPER, PAPER_SURFACES, [0.43, 0.77]), []);
});

test('the check bites: the brand colours themselves, and a near-twin pair, are refused', () => {
  // The reason the chart steps exist. Brand bronze and cyan are too grey for a fill, and the
  // cyan is too light for a dark surface.
  const brand = check([token('color-bronze'), token('color-cyan')], DARK_SURFACES, [0.48, 0.67]);
  assert.ok(brand.some((p) => /chroma/.test(p)), brand.join('; '));
  assert.ok(brand.some((p) => /lightness/.test(p)), brand.join('; '));
  // Two cyans a reader cannot tell apart.
  const twins = check(['#22a2b5', '#2aa9bb'], DARK_SURFACES, [0.48, 0.67]);
  assert.ok(twins.some((p) => /separation/.test(p)), twins.join('; '));
  // A colour that vanishes into the surface.
  assert.ok(check(['#1d3a40', '#22a2b5'], DARK_SURFACES, [0.1, 0.9]).some((p) => /contrast/.test(p)));
});

test('the calculator page draws the graphs in these tokens and names no chart colour of its own', () => {
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  assert.match(page, /--cg-markup: var\(--color-chart-markup\); --cg-allocation: var\(--color-chart-allocation\);/);
  assert.match(page, /--cg-markup: var\(--color-chart-markup-paper\); --cg-allocation: var\(--color-chart-allocation-paper\);/);
  const graphs = readFileSync(fileURLToPath(new URL('../../src/scripts/cbam-graphs.ts', import.meta.url)), 'utf8');
  assert.deepEqual(graphs.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], 'cbam-graphs.ts must use the --cg-* tokens only');
});
