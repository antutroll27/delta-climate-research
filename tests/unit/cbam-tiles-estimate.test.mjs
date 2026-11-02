// tests/unit/cbam-tiles-estimate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { outlook } from '../../src/scripts/cbam-outlook.ts';
import {
  chargeableSplit, renderDeck, renderEstimateIdle, renderEstimateThrown, renderEstimateTiles, tierTone,
} from '../../src/scripts/cbam-ui/tiles-estimate.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const est = (over) => estimateFromPack(pack, {
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15', ...over,
});
const tiles = (e, over = {}) => renderEstimateTiles({
  estimate: e, importDate: '2026-03-15', threshold: '', attestation: '', ...over,
});
const IDLE = 'Choose a good, origin, route, mass and import date to see the provisional exposure.';

test('chargeable share: net over total embedded, one decimal, and the rest is its complement', () => {
  assert.deepEqual(chargeableSplit('475.2', {
    faaTco2e: '145.3725', netTco2e: '329.8275', totalEmbeddedTco2e: '475.2',
    certificates: '329.8275', costEur: '24855.80', indirectTco2e: '0',
  }), { chargeablePct: '69.4', restPct: '30.6', floored: false });
});

test('the tiles for a priced default line: hero, bar, direct embedded, factor, provenance', () => {
  const html = tiles(est());
  assert.ok(html.includes('<div class="b-mega cb-fig"><span class="cb-n">329.828</span></div>'));
  assert.ok(html.includes('<span class="b-tag cb-cost">€24,855.80</span>'));
  assert.equal((html.match(/\bcb-n\b/g) ?? []).length, 1, '#cbOut .cb-n must stay one element');
  assert.equal((html.match(/\bcb-cost\b/g) ?? []).length, 1);
  assert.equal((html.match(/\bcb-fig\b/g) ?? []).length, 1);
  assert.ok(html.includes('style="--share:69.4%"'));
  assert.match(html, />69\.4<span class="b-u">%<\/span>/);
  assert.match(html, />30\.6<span class="b-u">%<\/span>/);
  assert.ok(html.includes('Embedded emissions (direct) · 475.2 tCO₂e'));
  assert.ok(html.includes('145.373 tCO₂e · CBAM factor 2026 0.975'));
  assert.ok(html.includes('329.828 tCO₂e'));
  assert.match(html, /class="chip bronze"><i><\/i>Commission default \+ mark-up</);
  assert.match(html, /b-fill-bronze/);
  assert.doesNotMatch(html, /b-fill-low/, '69.4 % holds its own text');
  assert.doesNotMatch(html, /exceeds the direct emissions/);
  assert.match(html, /Import of 15 Mar 2026/);
  assert.match(html, /<div data-deck><\/div>/, 'the deck slot is painted by paintOutlook');
  assert.doesNotMatch(html, /cb-ol-/, 'the deck must not collide with the strip\'s e2e hooks');
});

test('the engine floor is stated where it applied, and a low share draws the bar as a strip', () => {
  const e = estimateFromPack(pack, {
    cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '0.1' },
  });
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect', 'premise: mixed');
  assert.deepEqual(chargeableSplit(e.emissionsTco2e, e.scenario),
    { chargeablePct: '30.6', restPct: '69.4', floored: true });
  const html = tiles(e);
  assert.ok(html.includes('Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.'));
  assert.ok(html.includes('+ Indirect (electricity) · no free allocation · 4.4 tCO₂e'));
  assert.match(html, /b-fill-ink b-fill-low/, 'mixed tier is ink; 30.6 % is a strip');
  assert.match(html, /class="chip ink"><i><\/i>Verified direct \+ Commission indirect</);
});

test('nothing embedded: no share is invented', () => {
  const e = est({ verified: { directTco2ePerT: '0' } });
  assert.equal(e.scenario.totalEmbeddedTco2e, '0', 'premise');
  assert.equal(chargeableSplit(e.emissionsTco2e, e.scenario), null);
  const html = tiles(e);
  assert.ok(html.includes('style="--share:0%"'));
  assert.match(html, /<div class="b-mid">—<\/div>/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('tier tones follow the colour law', () => {
  assert.equal(tierTone('default+markup'), 'bronze');
  assert.equal(tierTone('actual-verified'), 'cyan');
  assert.equal(tierTone('verified-direct+default-indirect'), 'ink');
  const v = tiles(est({ route: '(D)', verified: { directTco2ePerT: '1.2' } }));
  assert.match(v, /class="chip cyan"><i><\/i>Verified actual</);
  assert.match(v, /b-fill-cyan/);
});

test('idle: the prompt sits in the hero as cb-idle, escaped, and no tile claims anything', () => {
  const html = renderEstimateIdle(IDLE);
  assert.ok(html.includes(`<p class="cb-idle">${IDLE}</p>`));
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /€/, /b-mid/, /b-fp/]) assert.doesNotMatch(html, re);
  assert.ok(renderEstimateIdle('<b>x</b> & y').includes('<p class="cb-idle">&lt;b&gt;x&lt;/b&gt; &amp; y</p>'));
});

test('thrown: "No estimate" and the message, escaped, with no figure', () => {
  const html = renderEstimateThrown('Bad <thing> & more');
  assert.match(html, /cb-tag unavail">No estimate</);
  assert.ok(html.includes('<p class="cb-reason">Bad &lt;thing&gt; &amp; more</p>'));
  assert.doesNotMatch(html, /\bcb-fig\b|\bcb-cost\b|tCO/);
});

test('a refusal keeps the hero, provenance and the reason, and draws no figure anywhere', () => {
  const e = est({ route: '(D)' });
  assert.equal(e.status, 'unavailable', 'premise: (D) has no direct default for India');
  const html = tiles(e);
  assert.ok(html.includes(`<p class="cb-reason">${e.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`));
  assert.match(html, /<span>Missing rule<\/span><code>default\/73063077\/IN\/\(D\)\/2026<\/code>/);
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /b-mid/, /€/]) assert.doesNotMatch(html, re);
  assert.match(html, /Provenance\./);
});

test('no priced figure, no Chargeable tile: idle, thrown and refused draw none (and no empty plate)', () => {
  const refused = est({ route: '(D)' });
  assert.equal(refused.status, 'unavailable', 'premise: (D) has no direct default for India');
  const priced = tiles(est());
  assert.match(priced, /Chargeable\./, 'premise: a priced line still draws its Chargeable tile');
  for (const [name, html] of [
    ['idle', renderEstimateIdle(IDLE)],
    ['thrown', renderEstimateThrown('Bad thing')],
    ['refused', tiles(refused)],
  ]) {
    assert.doesNotMatch(html, /Chargeable/, `${name}: no Chargeable tile`);
    assert.doesNotMatch(html, /b-fill/, `${name}: no empty fill plate`);
    assert.match(html, /Three years\./, `${name}: the other tiles stay`);
    assert.match(html, /Provenance\./, `${name}: the other tiles stay`);
  }
});

test('the threshold card goes first, whole; no card means no plate', () => {
  const card = '<section class="cb-card cb-thresh">X</section>';
  const html = tiles(est(), { threshold: card });
  assert.ok(html.startsWith(`<div class="b-s2 b-legacy cb-out">${card}</div>`));
  assert.doesNotMatch(tiles(est()), /b-legacy|cb-thresh/);
});

test('the attestation is placed whole, inside the hero', () => {
  const att = '<p class="cb-sub cb-attested">ATTESTED</p>';
  const html = tiles(est(), { attestation: att });
  const hero = /<section class="b-t b-hero[^"]*">[\s\S]*?<\/section>/.exec(html)[0];
  assert.ok(hero.includes(att));
});

test('the page ships the idle tiles as static markup, identical to renderEstimateIdle', () => {
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  const m = /<div id="cbOut" class="b-bento b-out">([\s\S]*?)<\/div>\s*<p class="cb-source" id="cbProv">/.exec(page);
  assert.ok(m, 'the page must carry #cbOut as <div id="cbOut" class="b-bento b-out"> followed by #cbProv');
  const norm = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  assert.equal(norm(m[1]), norm(renderEstimateIdle(IDLE)));
});

const ol = (over) => outlook(pack, {
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect', ...over,
});

test('the deck: three counts, the mark-up from the model, the rise, and the missing prices', () => {
  const html = renderDeck(ol(), '100');
  assert.ok(html.includes('<p class="b-t-sub">Same line, same 100 t. Mark-up 10 → 20 → 30%.</p>'));
  for (const [i, y, n] of [[0, 2026, '329.8'], [1, 2027, '376.8'], [2, 2028, '427.4']]) {
    assert.ok(html.includes(`<li class="b-st b-st${i}"><span>${y}</span><b>${n}</b></li>`), `${y}`);
  }
  assert.ok(html.includes('+29.6% by 2028 · No certificate price published for the 2027 and 2028 imports'));
  assert.match(html, /class="b-stack b-stack-bz"/);
  assert.doesNotMatch(html, /€|quarterly|\(pending\)|Q[1-4] certificate price|cb-ol-/i);
});

test('the deck reads the mark-up from the model, never a constant', () => {
  const fert = renderDeck(ol({ cn: '28080000', country: 'DZ', route: 'default' }), '100');
  assert.match(fert, /Mark-up 1 → 1 → 1%\./);
  const verified = renderDeck(ol({ route: '(D)', verified: { directTco2ePerT: '1.2' } }), '100');
  assert.doesNotMatch(verified, /Mark-up/, 'an attested direct figure carries no mark-up');
  assert.match(verified, /class="b-stack b-stack-ink"/);
});

test('refused years say so, with the engine\'s reason verbatim, grouped, and no count', () => {
  const view = ol({ cn: '72052100', route: '(G)', massT: '60' });
  assert.ok(view.years.every((y) => y.kind === 'refused'), 'premise');
  const html = renderDeck(view, '60');
  assert.equal((html.match(/<b>No estimate<\/b>/g) ?? []).length, 3);
  const reason = view.years[0].reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.ok(html.includes(`<p class="b-help">2026, 2027 and 2028: ${reason}</p>`));
  assert.doesNotMatch(html, /Mark-up|by 2028/);
});

test('no outlook, no deck', () => {
  assert.equal(renderDeck(null, '100'), '');
});

test('the mass is escaped: it is the user\'s own text', () => {
  assert.match(renderDeck(ol(), '<b>'), /same &lt;b&gt; t\./);
});

/* ── review fixes (phase 2 review): what-if everywhere, true terms when floored, neutral refusal chip ── */

const section = (html, cls) => new RegExp(`<section class="b-t [^"]*${cls}[^"]*"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
const WHATIF = '<span class="b-tag pending">What-if · CSCF for 2026 unpublished</span>';

test('review 1 — the Chargeable tile of a what-if estimate carries the hero\'s what-if tag', () => {
  const e = est();
  assert.equal(e.status, 'cscf_pending', 'premise');
  const html = tiles(e);
  assert.ok(section(html, 'b-fill').includes(WHATIF), 'the tile\'s share and tonnage rest on CSCF = 1');
  assert.ok(section(html, 'b-hero').includes('>What-if · CSCF for 2026 unpublished</span>'), 'premise: the hero tag');
  assert.equal((html.match(/\bcb-tag\b/g) ?? []).length, 1, 'the e2e hook stays on the hero alone');
});

test('review 1 — the deck carries the strip\'s notes: the CSCF caveat and each pending price row\'s locator', () => {
  const view = ol({ cn: '2523100090', country: 'DZ', route: '(A)', date: '2026-03-15' });
  const html = renderDeck(view, '100');
  assert.ok(html.includes('Certificate counts assume no cross-sectoral correction: the Commission has not '
    + 'published the factor for these years, and it can only reduce the free allocation deducted.'));
  assert.ok(html.includes('Certificate price, 2027 and 2028: From 2027 the Commission sets a weekly certificate price'));
  assert.doesNotMatch(html, /cb-ol-/, 'the strip\'s e2e hooks stay off the deck');
  assert.ok(html.indexOf('Certificate counts assume') > html.indexOf('</ol>'), 'the notes sit under the counts');
  assert.doesNotMatch(renderDeck(ol({ cn: '72052100', route: '(G)', massT: '60' }), '60'), /Certificate counts assume/,
    'no figure year, no notes');
});

test('review 2 — a floored charge prints no free-allocation share, but the true terms and the floor sentence', () => {
  const e = estimateFromPack(pack, {
    cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '0.1' },
  });
  const rest = /<div class="b-fl-rest">[\s\S]*<\/section>/.exec(section(tiles(e), 'b-fill'))[0];
  assert.doesNotMatch(rest, /69\.4/, 'free allocation is 64.935 of 10 direct tonnes, not 69.4 % of anything');
  assert.doesNotMatch(rest, /class="b-mid"/, 'no share is printed on the free-allocation side');
  assert.ok(rest.includes('<dt>− Free allocation</dt><dd>64.935 tCO₂e</dd>'));
  assert.ok(rest.includes('<dt>= Chargeable</dt><dd>4.4 tCO₂e</dd>'));
  assert.ok(rest.includes('<dt>CBAM factor 2026</dt><dd>0.975</dd>'));
  assert.ok(rest.includes('Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.'));
  assert.ok(rest.includes('Embedded emissions (direct) · 10 tCO₂e'));
  assert.ok(rest.includes('+ Indirect (electricity) · no free allocation · 4.4 tCO₂e'));
  // the ordinary case keeps its share and prints no term list
  const plain = section(tiles(est()), 'b-fill');
  assert.match(plain, />30\.6<span class="b-u">%<\/span>/);
  assert.doesNotMatch(plain, /<dt>/);
});

test('review 3 — a refusal\'s selector is set in the data mono, as the old card set it', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/cbam-bento.css', import.meta.url)), 'utf8');
  const rule = /\.cbx \.b-hero \.cb-sel code\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /font-family:var\(--font-data\)/);
});

test('review 4 — a refusal\'s tier chip is neutral ink, never the bronze of a Commission figure', () => {
  const e = est({ route: '(D)' });
  assert.equal(e.status, 'unavailable', 'premise');
  assert.equal(e.stamp.tier, 'default+markup', 'premise: the stamp still names the attempted tier');
  const html = tiles(e);
  assert.match(html, /class="chip ink"><i><\/i>Commission default \+ mark-up</);
  assert.doesNotMatch(html, /chip bronze/);
  assert.match(tiles(est()), /chip bronze/, 'premise: a priced default line keeps bronze');
});

test('review 5 — the residual-basis note is open on the tiles, outside the folded Notes', () => {
  const e = estimateFromPack(pack, { cn: '2523100090', country: 'AQ', route: '(A)', massT: '100', date: '2026-03-15' });
  assert.equal(e.stamp.originBasis, 'residual', 'premise');
  const html = tiles(e);
  const note = 'The Commission does not publish a default for this good from this country of origin, so this figure '
    + 'uses its &quot;Other Countries and Territories&quot; residual default — a world-average value, not your country&#39;s own.';
  assert.ok(html.includes(note), 'premise: the note is printed');
  const folded = /<details[\s\S]*?<\/details>/.exec(html)[0];
  assert.ok(!folded.includes('residual default'), 'not inside the fold');
  assert.ok(html.replace(folded, '').includes(note), 'open, in the Provenance tile');
  assert.ok(folded.includes(`Notes · ${e.stamp.notes.length - 1}`), 'the fold counts only what it holds');
  assert.ok(html.replace(folded, '').indexOf(note) > html.indexOf('Provenance.'));
  // a line with no residual basis keeps all its notes folded
  assert.ok(/<details[\s\S]*Art 9 deduction/.test(tiles(est())));
});

test('review 9 — the default tier card says what is true of every origin, residual included', () => {
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  assert.ok(page.includes('<b>Commission default + mark-up</b><span>The Commission\'s published default value, with its mark-up.</span>'));
  assert.doesNotMatch(page, /published value for this origin and route/);
});

/* ── decision 4A (2026-11-03): the split tile never clips ─────────────────────────────────────
   The card-is-the-bar layout gives the smaller share a strip of the tile too narrow for its own
   label (8.2 % of a 560 px tile). When the smaller share is under 20 %, the tile draws a full-width
   bar to scale and two label tiles beneath it. From 20 % to 80 % it is exactly the card it was. */
import { splitLayout } from '../../src/scripts/cbam-ui/tiles-estimate.ts';

/** A real priced estimate with its split pushed to `pct` % chargeable (total 1000 t, floor not reached). */
const atShare = (pct, over = {}) => {
  const e = est();
  const figure = {
    ...e.scenario, totalEmbeddedTco2e: '1000', netTco2e: (pct * 10).toFixed(3),
    faaTco2e: (1000 - pct * 10).toFixed(3), certificates: (pct * 10).toFixed(3), costEur: '1000.00',
  };
  return { ...e, emissionsTco2e: '1000', scenario: figure, ...over };
};

test('4A threshold: the smaller share under 20 % draws the strip, from 20 % to 80 % the card, both directions', () => {
  const at = (p) => splitLayout(p);
  for (const [pct, want] of [
    ['19.9', 'strip'], ['20.0', 'blocks'], ['20.1', 'blocks'],
    ['79.9', 'blocks'], ['80.0', 'blocks'], ['80.1', 'strip'],
    ['0.0', 'strip'], ['100.0', 'strip'], ['91.8', 'strip'], ['50.0', 'blocks'],
  ]) assert.equal(at(pct), want, `${pct} % chargeable`);
});

test('4A: no split (nothing embedded) is not a strip: no share is invented, no bar is drawn to scale', () => {
  assert.equal(splitLayout(null), 'blocks');
  const e = est({ verified: { directTco2ePerT: '0' } });
  assert.doesNotMatch(tiles(e), /b-fill-strip|b-sp-bar/);
});

test('4A: between 20 % and 80 % the tile is byte-identical to the card it was (no strip markup)', () => {
  for (const pct of [20, 40, 69.4, 80]) {
    const html = section(tiles(atShare(pct)), 'b-fill');
    assert.doesNotMatch(html, /b-fill-strip|b-sp-/, `${pct} %`);
    assert.match(html, /class="b-fl-bar"/, `${pct} %`);
    assert.match(html, /class="b-fl-rest"/, `${pct} %`);
  }
});

test('4A: 91.8 % draws the bar to scale (no minimum width), a real aria-label, and two label tiles', () => {
  const html = section(tiles(atShare(91.8)), 'b-fill');
  assert.match(html, /b-fill-bronze b-fill-strip/);
  assert.doesNotMatch(html, /class="b-fl-bar"|class="b-fl-rest"|b-fill-low/, 'the proportional blocks are gone');
  assert.ok(html.includes('<div class="b-sp-bar" role="img" aria-label="91.8% chargeable, 8.2% free allocation">'));
  assert.ok(html.includes('<i class="b-sp-bc" style="width:91.8%"></i><i class="b-sp-bf" style="width:8.2%"></i>'));
  assert.doesNotMatch(html, /min-width|flex:/, 'true to scale: nothing pads the small segment');
  // two label tiles, each with its own title, its percentage and its sub-line
  assert.match(html, /<div class="b-sp-c"><h3 class="b-t-ti">Chargeable\.<\/h3><div class="b-mid">91\.8<span class="b-u">%<\/span><\/div><p class="b-t-sub">918 tCO₂e<\/p><\/div>/);
  assert.match(html, /<div class="b-sp-f"><h3 class="b-t-ti">Free allocation\.<\/h3><div class="b-mid">8\.2<span class="b-u">%<\/span><\/div><p class="b-t-sub">82 tCO₂e · CBAM factor 2026 0\.975<\/p><\/div>/);
  // every existing tag survives
  assert.ok(html.includes(WHATIF), 'what-if CSCF');
  assert.ok(html.includes('Embedded emissions (direct) · 1,000 tCO₂e'));
});

test('4A: a low chargeable share (8.2 %) is a strip too, widths to scale the other way round', () => {
  const html = section(tiles(atShare(8.2)), 'b-fill');
  assert.match(html, /b-fill-strip/);
  assert.ok(html.includes('aria-label="8.2% chargeable, 91.8% free allocation"'));
  assert.ok(html.includes('<i class="b-sp-bc" style="width:8.2%"></i><i class="b-sp-bf" style="width:91.8%"></i>'));
});

test('4A: the strip keeps the tier\'s colour class and the indirect tag', () => {
  const html = section(tiles(atShare(91.8, { scenario: { ...atShare(91.8).scenario, indirectTco2e: '4.4' } })), 'b-fill');
  assert.ok(html.includes('+ Indirect (electricity) · no free allocation · 4.4 tCO₂e'));
  const v = tiles(est({ route: '(D)', verified: { directTco2ePerT: '1.2' } }));
  assert.match(v, /b-fill-cyan/);
});

test('4A: a floored charge in the strip prints the true terms in the free-allocation tile, never a share', () => {
  const e = estimateFromPack(pack, {
    cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '0.1' },
  });
  // Push the chargeable share to 85 % of the embedded total while FA still exceeds the direct term.
  const f = { ...e.scenario, totalEmbeddedTco2e: '100', netTco2e: '85', indirectTco2e: '85', certificates: '85' };
  const html = section(tiles({ ...e, scenario: f }), 'b-fill');
  assert.match(html, /b-fill-strip/);
  const free = /<div class="b-sp-f">[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
  assert.ok(free.includes('<dt>− Free allocation</dt><dd>64.935 tCO₂e</dd>'));
  assert.ok(free.includes('<dt>CBAM factor 2026</dt><dd>0.975</dd>'));
  assert.ok(free.includes('Free allocation exceeds the direct emissions'));
  assert.doesNotMatch(free, /class="b-mid"/, 'no free-allocation share is printed');
});

test('4A: the bar\'s CSS pads no segment (true to scale), and the free-allocation numeral is sized to its own fill', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/cbam-bento.css', import.meta.url)), 'utf8');
  for (const sel of ['.b-sp-bar', '.b-sp-bar>i', '.b-sp-bc', '.b-sp-bf']) {
    const rules = [...css.matchAll(new RegExp(`\\.cbx[^{}]*${sel.replace(/[.>]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
    assert.ok(rules.length > 0, `${sel} is styled`);
    for (const r of rules) assert.doesNotMatch(r, /min-width|min-inline-size|flex-grow|flex:[^;]*[1-9]/, `${sel} must not pad or stretch a segment`);
  }
  // 30.6 % of a 345 px tile left a 64 px numeral ~55 px outside it: the rest block now sizes the numeral by its own width.
  assert.match(css, /\.cbx \.b-fl-rest\{[^}]*container-type:inline-size\}/);
  assert.match(css, /\.cbx \.b-fl-rest \.b-mid\{font-size:min\(64px,calc\(\(100cqi - 4px\) \/ 1\.91\)\)\}/);
});
