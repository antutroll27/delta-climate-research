import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, decorateSnapshot, inputFor, nextRoute, parseVerifiedFields, renderAttestation,
  renderDraftThreshold, renderLineCard, renderResult, renderThreshold, renderTotals,
  renderYearThreshold, stampedTierOf, verifiedInputOf,
} from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  estimateFromPack, resolveThreshold, routesFor, selectIndirectFactorFromPack,
} from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { csvRows, sumTotals } from '../../src/scripts/cbam-lines.ts';

/**
 * The CBAM engine is the GeoCBAM SaaS's, copied byte-for-byte. Its UI is not — the
 * portability dossier recommended mounting the SaaS's Vue cards precisely because
 * the honesty states live inside them, and warned that rebuilding the UI means
 * re-implementing those states by hand: "that is where mistakes get made."
 *
 * This file is the mitigation for taking that risk deliberately. It asserts, per
 * branch of the result union, that the renderer shows what the dossier's §7
 * non-negotiables require — and, as importantly, that it does NOT show what it
 * must not. A refusal that quietly renders a zero is the failure mode worth
 * spending a test file on.
 *
 * These run against the REAL rule pack, so they also pin the three figures the
 * dossier's §8 checklist names. If the pack is regenerated and a number moves,
 * this fails rather than the site silently quoting last quarter's rules.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

const run = (cn, country, route, massT, date = '2026-03-15') =>
  estimateFromPack(pack, { cn, country, route, massT, date });

/**
 * EXACT-PINNED legal prose — the four §4 caveats plus the below-threshold verdict, in both the
 * forms it can now take (see its own doc below). Normally pinning exact text is a brittle test worth avoiding; here brittleness is
 * the point. A reviewer proved that keyword-based assertions (match/doesNotMatch on a phrase)
 * can be defeated by a PARAPHRASE ATTACK: keep every phrase the assertions look for, then
 * append a contradicting reassurance to the same sentence — e.g. keeping "are not modelled" and
 * "do not credit any such payment" verbatim on the Art 9 caveat, then appending "— but rest
 * assured, the certificate price shown already reflects any such payment in practice, so your
 * bill is effectively reduced for it regardless." All five caveats (including the CSCF pair,
 * which was the one example that caught its own INVERSION) fell to this: every phrase a regex
 * looked for was still present, so every assertion passed, on a caveat that had just been
 * quietly undone.
 *
 * These constants are a manually maintained, independent transcript of the CURRENT production
 * text — not imported from cbam-app.ts. If they were shared with production (e.g. exported
 * constants both sides import), editing the prose would edit the test's expectation in lock
 * step and the test could never catch anything. Being a separate, hand-typed copy is what makes
 * `assert.ok(html.includes(...))` below refuse ANY edit — a real fix, an inversion, or an
 * appended qualifying clause — and force whoever changed the wording to update this file too,
 * deliberately, rather than let a paraphrase attack (or an honest rewrite that quietly drops a
 * caveat) slip through unreviewed. When §4's wording changes on purpose, update these constants
 * in the SAME commit as the production change — do not loosen this file's assertions to make a
 * red test green.
 */
const CAVEAT_CSCF =
  '<li>The cross-sectoral correction factor (CSCF) for 2026–2030 is unpublished. CSCF only\n'
  + '        ever reduces the free allocation that offsets a bill — it can subtract, never add — so\n'
  + '        every figure above assumes the largest free allocation legally possible (CSCF&nbsp;=&nbsp;1,\n'
  + '        the last value the Commission actually set). Each figure above is therefore a floor: the\n'
  + '        real bill cannot be lower than what is shown, and may be higher once the true factor is\n'
  + '        published.</li>';
const CAVEAT_ARTICLE_9 =
  '<li>Article 9 deductions for a carbon price paid in the country of origin are not modelled\n'
  + '        (the implementing act is still a draft), so figures do not credit any such payment.</li>';
const CAVEAT_COMPLETENESS =
  '<li>Any below-threshold verdict rests on the user\'s own statement of completeness, ticked\n'
  + '        in the tool. No one has verified that list.</li>';
const CAVEAT_FINGERPRINT =
  '<li>Line fingerprints cover inputs as entered; no source document exists behind them. They\n'
  + '        are not customs provenance.</li>';
/**
 * The fifth caveat, and the only CONDITIONAL one: it appears iff at least one line was entered at
 * a verified-bearing tier. Both states are pinned below (present when one is, absent when none is)
 * — an unconditional caveat would be a claim about attested data on a document that contains none,
 * and a missing one would leave the mark-up-skipping figures looking as Commission-backed as
 * every other row. Hand-typed here for exactly the reason the four above are; see the doc comment
 * on this block.
 *
 * IT NOW COVERS TWO MARKS, and the second sentence is why it was reworded rather than merely
 * re-gated. It used to say, flatly, that lines marked verified "were priced from the user's own
 * attested figures, which skip the mark-up" — half-false the moment §1 can carry a
 * 'verified-direct+default-indirect' row, whose electricity component is the Commission's own
 * default and DOES carry the mark-up. Widening `anyVerified` without touching this text would have
 * printed a caveat that under-states the very thing it exists to disclose, on the document handed
 * to an auditor.
 */
const CAVEAT_VERIFIED =
  '<li>Lines marked verified in §1 carry the user\'s own attested figures, which skip the\n'
  + '        mark-up the Commission\'s default values carry. A line marked “Verified direct +\n'
  + '        Commission indirect” is attested for its direct figure only: its electricity component is\n'
  + '        the Commission\'s published default value, and that half does carry the mark-up. Those\n'
  + '        attested figures are a claim, from a verification this tool has not seen and cannot confirm;\n'
  + '        any reference cited beside them covers the attested figures alone and is transcribed as\n'
  + '        entered, never checked.</li>';
/**
 * The below-threshold verdict, pinned in BOTH its forms — the whole `<p class="cb-sub">`, closed
 * at both ends by its own tags, for the reason the banner constant below spells out: a constant
 * that stopped at the last full stop would be open at the right-hand end, and the paraphrase
 * attack appends its reassurance there.
 *
 * Two constants because the sentence is now CONDITIONAL. It used to read "Below the threshold an
 * importer owes nothing for 2026…", which was a claim about the year rather than about the mass
 * test that actually ran — MEASURED: 40 t of cement plus 1000 t of hydrogen rendered exactly that
 * beside a page total of EUR 525,302.23, because Art 2(3) is a mass test over four sectors and
 * hydrogen is (rightly) not in the basis. Pinning only the no-exclusion form would let the
 * exclusion clause be deleted without a red test; pinning only the excluded form would let it
 * become boilerplate that prints on every card. Both states, or neither is guarded.
 */
const ATTESTATION_SENTENCE =
  '<p class="cb-sub">Your cement, iron &amp; steel, aluminium and fertiliser imports for 2026 '
  + 'total 30&nbsp;t, below the 50&nbsp;t threshold for those sectors. This verdict rests '
  + 'on your attested statement that the list is complete — it is your completeness claim, '
  + 'verified by no one, not by the Commission or by us.</p>';
const ATTESTATION_SENTENCE_WITH_EXCLUSION =
  '<p class="cb-sub">Your cement, iron &amp; steel, aluminium and fertiliser imports for 2026 '
  + 'total 40&nbsp;t, below the 50&nbsp;t threshold for those sectors. 1 of your 2 lines for '
  + '2026 is outside that test — goods not measured by mass for de minimis, such as hydrogen '
  + 'and electricity, are chargeable regardless. This verdict does not mean you owe nothing. '
  + 'This verdict rests on your attested statement that the list is complete — it is your '
  + 'completeness claim, verified by no one, not by the Commission or by us.</p>';

/**
 * NON-NEGOTIABLE 1 (dossier §7.1) — the framing banner, and the eyebrow above it. Unlike the
 * four caveats above, this prose is not emitted by cbam-app.ts: it is markup in
 * src/pages/cbam/cbam-calculator.astro, precisely so it survives the script failing to run or
 * the pack failing to load. So it is pinned by reading the page source, not a render.
 *
 * WHITESPACE IS NORMALISED before matching, which is the one deliberate difference from the
 * CAVEAT_* constants above. There the embedded '\n        ' is real: it is emitted into the
 * print document verbatim. Here the line breaks are hard-wrapping in a .astro file — arbitrary
 * formatting the browser collapses anyway — so pinning them would turn a harmless re-wrap into
 * a red test and teach the next reader to loosen this file. Normalising costs nothing that
 * matters: an exact match on the collapsed text still refuses ANY inserted, deleted, reworded
 * or appended clause, which is the paraphrase attack the block comment above describes.
 *
 * THE ENCLOSING TAGS ARE PART OF THE PIN, and are not decoration. A substring match only
 * constrains what it spans, so a constant ending at the last full stop is silently open at the
 * right-hand end: the paraphrase attack appends its contradicting reassurance AFTER 'liability.'
 * ('...In practice the Registry accepts these figures as filed.'), leaving every phrase
 * assertion below true and the pin still matching. Drafting this test hit exactly that — it
 * passed the attack until the constant was anchored to '<div class="cb-banner" role="note">'
 * and its closing '</div>'. The four CAVEAT_* constants above are closed the same way, by their
 * own '</li>'. Any replacement for these constants must stay closed at BOTH ends.
 *
 * Same rule as the caveats: hand-typed here, never imported from the page. When §7.1's wording
 * changes on purpose, update these in the SAME commit — do not loosen the assertions to make a
 * red test green.
 */
const EYEBROW_71 =
  '<p class="cb-eyebrow">Provisional · defaults or your verified figures · in-browser</p>';
const BANNER_71 =
  '<div class="cb-banner" role="note"> '
  + 'Prototype estimator · Commission default values or your own verified figures · '
  + 'decision-support, not a declaration. Computed in your browser from the published rules, '
  + 'and never sent anywhere. For a 2026 import no final figure exists — the cross-sectoral '
  + 'correction factor is unpublished — so any number below is a labelled what-if. This is not '
  + 'a filing, not validated by the EU CBAM Registry, and not a statement of monetary '
  + 'liability. '
  + '</div>';

/* ── §8 checklist: the engine still produces the SaaS's figures ─────────────── */

test('§8 — priced line matches the SaaS exactly', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.emissionsTco2e, '136.4');
  assert.equal(e.scenario.faaTco2e, '64.935');
  assert.equal(e.scenario.netTco2e, '71.465');
  assert.equal(e.scenario.certificates, '71.465');
  assert.equal(e.scenario.costEur, '5385.60');
});

test('§8 — the stranded steel line refuses, and names the missing rule', () => {
  // 72241010 used to be the example here. It is no longer stranded: its Column B rows
  // were keyed (F)(1)/(F)(2), Annex §5.3 production-year markers that the generator was
  // writing into routeIndicator, so nothing could ever match a declared route of (F).
  // Moving the year into validFrom/validTo made 794 rows reachable and that good with
  // them, so the refusal path needs a good that is genuinely still stranded.
  //
  // 72052100 is one: the defaults corpus declares route (C), while its Column B publishes
  // only (F) and (G) variants. That is a real vocabulary gap between the two corpora —
  // the thing this test was written to prove is reported honestly rather than guessed.
  const e = run('72052100', 'IN', '(C)', '60');
  assert.equal(e.status, 'unavailable');
  assert.equal(e.selector, 'benchmark/72052100/column-B/(C)/2026-03-15');
});

test('§8 — route lookup is unchanged', () => {
  assert.deepEqual(routesFor(pack, '72083800', 'IN', 2026), ['(C)']);
});

/* ── the de minimis threshold ──────────────────────────────────────────────── */

const thresh = (cn, massT, date = '2026-03-15') => resolveThreshold(pack, { cn, massT, date });

test('a line under 50 t is INDETERMINATE, never exempt', () => {
  // The failure that matters. One line is not an annual total: it can prove you are
  // ABOVE the threshold and can never prove you are below it. Reporting a small line
  // as "exempt" would tell an importer they owe nothing on evidence that cannot
  // support it — the most expensive possible way for this tool to be wrong.
  const t = thresh('25231000', '10');
  assert.equal(t.state, 'indeterminate');
  const html = renderThreshold(t);
  assert.doesNotMatch(html, /\bexempt\b(?!\.)/i,
    'the card must not assert exemption from a single line');
  assert.match(html, /annual total/i, 'it must say why one line cannot settle it');
});

test('a line over 50 t is ABOVE the threshold, and says the exposure stands', () => {
  const t = thresh('25231000', '100');
  assert.equal(t.state, 'above_threshold');
  assert.match(renderThreshold(t), /exceeds/i);
});

test('the threshold card always cites the amending regulation', () => {
  // The pack's own sourceLocator names only the consolidated article; the 50 t
  // figure was put there by Reg (EU) 2025/2083 and a provenance tool must say so.
  for (const m of ['10', '100']) {
    assert.match(renderThreshold(thresh('25231000', m)), /2025\/2083/,
      'the amending act must be cited, not just the consolidated article');
  }
});

/**
 * A one-sector per-year card, so the sector name it prints can be compared 1:1 with the
 * single-line card's. Shaped exactly like the `ruleFound: true` fixtures further down, and
 * `below_threshold` + attested because that is the only branch whose sentence names the sectors.
 */
const yearCardFor = (sector) => renderYearThreshold({
  calendarYear: 2026, ruleFound: true, state: 'below_threshold',
  knownEligibleMassT: '30', thresholdT: '50',
  sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
  entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
  eligibleLineCount: 1, linesInYear: 1,
  includedSectors: [sector],
});

test('the two threshold cards name a sector identically — "iron & steel", never "iron and steel"', () => {
  // BOTH CARDS SHIP, and they contradicted each other about the same sector. The per-year card
  // reads its names off SECTOR_PROSE ("iron & steel", and "fertiliser" from a plural key); the
  // single-line card ran `.replace(/_/g, ' ')` and printed "iron and steel" — the shortcut the
  // table's own docblock, twelve lines above, already records as wrong on two of the four keys.
  //
  // ASSERTED BOTH ABSOLUTELY AND RELATIVELY. The absolute arm hand-types the wanted prose, so
  // the two cards agreeing on a name nobody chose still fails. The relative arm reads the name
  // straight out of the OTHER card, so the two can never drift apart again whatever the table
  // is later edited to say — the defect was disagreement, and that is the thing to pin.
  const line = renderThreshold(thresh('72083800', '10'));
  assert.ok(line.includes('iron &amp; steel'),
    'the single-line card must say "iron & steel" — the ampersand escaped, as the per-year card escapes it');
  assert.doesNotMatch(line, /iron and steel/,
    'the mechanical underscore swap must be gone from BOTH of the card\'s two sector sites');

  // The must-not-regress guard: a lookup that silently reworded every sector would pass the
  // arm above. Two of the four keys are said exactly as they are spelled, and must stay so.
  assert.match(renderThreshold(thresh('25231000', '10')), /<b>cement<\/b>/,
    'cement is said "cement" — the fix must move only the keys whose prose differs from the key');
  assert.match(renderThreshold(thresh('76011010', '10')), /<b>aluminium<\/b>/,
    'aluminium likewise — unchanged by the table');

  // ...and the two cards, compared directly. `sub` is whatever the per-year card calls the
  // sector, extracted from its own verdict rather than re-typed here.
  for (const [sector, cn] of [
    ['cement', '25231000'], ['iron_and_steel', '72083800'],
    ['aluminium', '76011010'], ['fertilisers', '28080000'],
  ]) {
    const said = /Your (.+?) imports for 2026 total/.exec(yearCardFor(sector));
    assert.ok(said, `the per-year card must name ${sector} in its verdict`);
    for (const massT of ['10', '100']) {
      assert.ok(renderThreshold(thresh(cn, massT)).includes(`<b>${said[1]}</b>`),
        `the single-line card must call ${sector} what the per-year card calls it: "${said[1]}"`);
    }
  }
});

test('hydrogen and electricity are outside the exemption, so no card is shown', () => {
  // Reg (EU) 2025/2083 excludes them from the 50 t exemption. Rendering an
  // "indeterminate" card for hydrogen would imply an exemption it cannot have.
  assert.equal(thresh('28041000', '10'), null, 'hydrogen must resolve to no threshold rule');
});

/**
 * WHICH of resolveThreshold's four nulls the preview owes the user a card for.
 *
 * That function returns null for four unrelated reasons and distinguishes none of them, so the
 * preview rendered all four as the empty string. renderDraftThreshold is the decision, split out
 * of run() precisely so it can be enumerated here rather than only through a browser — run()
 * itself is a closure inside initCbam() and lives in tests/e2e/cbam-lines.spec.ts.
 *
 * `draft` mirrors `thresh` above: same pack, same three-field input, so the two can be compared
 * case for case.
 */
const draft = (cn, massT, date = '2026-03-15') =>
  renderDraftThreshold(pack, { cn, massT, date });

test('a year with no published threshold row gets a card on the PREVIEW too, not silence', () => {
  // The defect. The pack publishes one threshold row (2026), so 2027 — an ordinary date to type
  // — resolves to null, and the preview dropped the card with nothing in its place. The estimate
  // beside it refuses on the certificate price and volunteers that "the good and its benchmark
  // are present", so the one sentence on screen that could have explained the missing de minimis
  // verdict instead says nothing is wrong with the good.
  const html = draft('25231000', '30', '2027-03-15');
  assert.match(html, /No published rule/, 'the year must be reported, not dropped');
  assert.match(html, /2027/, 'and the card must name WHICH year has no rule');

  // SAID BY THE MULTI-LINE CARD'S OWN RENDERER, not by a second phrasing that could drift from
  // it: both panels can describe the same year, and they used to disagree by one showing a card
  // and the other showing nothing at all.
  assert.equal(html, renderYearThreshold({
    calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0,
  }), 'the preview must render the same no-rule card the per-year panel renders');
});

test('the other three nulls stay silent — an absent card is the right answer for them', () => {
  // 1. HYDROGEN. Outside the 50 t exemption (the test directly above), so an "indeterminate"
  //    card would imply an exemption it cannot have. Priceable from 93 origins in this pack, so
  //    this is a state a user reaches with a working estimate on screen beside it.
  assert.equal(draft('28041000', '10'), '', 'hydrogen must stay silent, exactly as before');

  // 2. A CN WITH NO SECTOR. Not one of the 574 goods the pack offers, so the estimate beside it
  //    already refuses by name; a second card saying we cannot classify it adds nothing.
  assert.equal(draft('99999999', '10'), '', 'an unclassifiable good must stay silent');

  // 3. AN UNREADABLE MASS. run() refuses this with nonNegativeDecimal long before the threshold,
  //    so it is unreachable through the form — pinned here as silence so that a future caller
  //    without run()'s gate cannot get a de minimis card built around a mass nobody can read.
  assert.equal(draft('25231000', 'abc'), '', 'an unreadable mass must never reach a card');
});

test('a year that HAS a published row is untouched — the same card, byte for byte', () => {
  // The must-not-regress arm. The fix is about which null gets a card; it must not restate,
  // re-tone or re-order the verdict card for the ordinary 2026 case.
  for (const massT of ['10', '100']) {
    assert.equal(draft('25231000', massT), renderThreshold(thresh('25231000', massT)),
      'a resolvable threshold must still render exactly renderThreshold\'s card');
  }
});

/* ── indirect (electricity) emissions ──────────────────────────────────────── */

const withScope = (emissionsScope) => estimateFromPack(pack, {
  cn: '25231000', country: 'DZ', route: '(A)', massT: '100',
  date: '2026-03-15', emissionsScope,
});

test('indirect emissions are charged for cement and receive NO free allocation', () => {
  const direct = withScope('direct'), both = withScope('direct_and_indirect');
  assert.equal(direct.scenario.indirectTco2e, '0');
  // 0.04 (DZ/2026 indirect, ROUTE (A) — the route withScope declares) x 1.10 markup x 100 t.
  // This read 6.6 until the route joined the indirect match: that is route (B)'s 0.06, and the
  // assertion had pinned the over-charge itself.
  assert.equal(both.scenario.indirectTco2e, '4.4');
  // Free allocation is a DIRECT-emission benchmark, so the deduction must not grow
  // when indirect is added — the indirect tonnes pass into the charge in full.
  assert.equal(direct.scenario.faaTco2e, both.scenario.faaTco2e,
    'free allocation must be unchanged by indirect emissions');
  assert.equal(both.scenario.netTco2e, '75.865');
  assert.equal(direct.scenario.netTco2e, '71.465');
});

test('the indirect component is shown as its own line, never folded into embedded', () => {
  const html = renderResult(withScope('direct_and_indirect'));
  assert.match(html, /Indirect \(electricity\)/i, 'the indirect term must be visible');
  assert.match(html, /no free allocation/i, 'and must say it gets no deduction');
  assert.match(html, /Embedded emissions \(direct\)/i,
    'the direct term must be labelled direct, or the two read as one number');
});

test('a direct-only sector is unaffected by the scope control', () => {
  // Steel publishes no indirect default, so asking for indirect must not fabricate
  // a component — and must not fail the estimate either.
  const ask = estimateFromPack(pack, { cn: '72083800', country: 'IN', route: '(C)',
    massT: '100', date: '2026-03-15', emissionsScope: 'direct_and_indirect' });
  assert.equal(ask.scenario.indirectTco2e, '0');
  assert.equal(ask.scenario.netTco2e, '337.225');
  assert.doesNotMatch(renderResult(ask), /Indirect \(electricity\)/i,
    'no indirect row when there is no indirect default');
});

/* ── the route the form ends up pricing ────────────────────────────────────── */

test('a valid route survives a change to any other field', () => {
  // The defect: rebuilding the <select> made the browser select option 0, so
  // changing ONLY the import date reverted (B) to (A) and moved the headline
  // figure 58.148 -> 71.465 certificates with nothing saying so.
  assert.equal(nextRoute(['(A)', '(B)'], '(B)'), '(B)');
  assert.equal(nextRoute(['(A)', '(B)', '(C)'], '(C)'), '(C)');
});

test('when several routes are published and none is chosen, none is chosen FOR the user', () => {
  assert.equal(nextRoute(['(A)', '(B)'], ''), '',
    'auto-selecting the first route prices a line the user never asked for');
  // The other half: the previous pick is no longer published for this pairing.
  // Falling back to option 0 here is the same guess by a different route.
  assert.equal(nextRoute(['(C)', '(D)'], '(B)'), '');
});

test('a single published route is selected — there is no choice to make', () => {
  assert.equal(nextRoute(['(C)'], ''), '(C)');
  assert.equal(nextRoute(['default'], '(B)'), 'default');
});

test('no published routes yields no selection', () => {
  assert.equal(nextRoute([], '(A)'), '');
});

test('the real pack: 72083800/IN publishes one route, so it needs no pick', () => {
  const rs = routesFor(pack, '72083800', 'IN', 2026);
  assert.deepEqual(rs, ['(C)']);
  assert.equal(nextRoute(rs, ''), '(C)');
  // ...whereas 25231000/DZ publishes two, and must not be resolved for the user.
  const many = routesFor(pack, '25231000', 'DZ', 2026);
  assert.ok(many.length > 1, `expected several routes, got ${many}`);
  assert.equal(nextRoute(many, ''), '');
});

/* ── §7 non-negotiables, per branch ────────────────────────────────────────── */

/**
 * The one non-negotiable that is not a render branch, and the reason this section used to start
 * at 2: §7.1 lives in markup so that it holds when nothing else does. Asserted against the page
 * source for that same reason — routing it through a render would test the opposite of the
 * property (that the banner survives the script never running).
 */
test('NON-NEGOTIABLE 1 — the banner names both tiers, and concedes everything it conceded before', () => {
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  // Hard-wrapped markup: every guarantee below straddles a source line break, so a raw substring
  // search reports them all missing while they are all present.
  const prose = page.replace(/\s+/g, ' ');

  // The claim that went stale. The form has offered the verified tier since it shipped and the
  // engine prices an attested figure with NO mark-up — the mark-up exists to price not having
  // data — so "default values only" was false in the one place a visitor cannot miss.
  assert.ok(!prose.includes('default values only'),
    'the banner must not claim Commission defaults are the only input — the verified tier exists');
  assert.ok(!prose.includes('defaults only'),
    'the eyebrow carries the same claim in short form; correcting one line and not the other '
    + 'leaves the page contradicting itself');
  assert.ok(prose.includes('Commission default values or your own verified figures'),
    'the banner must name both tiers the engine actually prices');
  // The corrected sentence is only true while the tier it now advertises is really on offer:
  // remove the option and this fix silently becomes a different false claim.
  assert.match(page, /<option value="actual-verified">/,
    'the banner promises a verified tier, so the form must still offer one');

  // The concessions that must survive that correction. §7.1 is a single block, and a commit
  // licensed to fix the tier claim is not licensed to soften the rest of it. Named one by one
  // so a failure says WHICH promise was dropped.
  assert.ok(prose.includes('not a filing'),
    'the banner must still disclaim being a filing');
  assert.ok(prose.includes('never sent anywhere'),
    'the banner must still promise the entered line leaves nobody\'s browser');
  assert.ok(prose.includes('cross-sectoral correction factor is unpublished'),
    'the banner must still say the CSCF is unpublished — that is what makes every figure a what-if');

  // EXACT pins, for the reason the constants' doc comment gives: every phrase assertion above
  // survives a paraphrase that keeps the phrase and appends a contradicting reassurance to the
  // same sentence. A whole-block substring match does not.
  assert.ok(prose.includes(EYEBROW_71),
    'the eyebrow must match the pinned text exactly');
  assert.ok(prose.includes(BANNER_71),
    'the §7.1 banner must match the pinned text exactly — word for word, punctuation for punctuation');
});

test('NON-NEGOTIABLE 2 — a refusal renders NO figure of any kind', () => {
  const html = renderResult(run('72052100', 'IN', '(C)', '60'));
  assert.match(html, /No estimate/i, 'the refusal must be stated, not implied');
  assert.match(html, /benchmark\/72052100\/column-B\/\(C\)\/2026-03-15/,
    'the missing rule selector must be shown verbatim');
  // The failure that matters: a refusal that looks like a computed zero.
  assert.doesNotMatch(html, /class="cb-fig"/,
    'a refusal must not render the figure block — no number, not even zero');
  assert.doesNotMatch(html, /cb-cost/,
    'a refusal must not render a cost');
});

test('NON-NEGOTIABLE 3 — CSCF-pending is labelled a what-if, never a figure', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  const html = renderResult(e);
  assert.match(html, /What-if/i, 'the scenario must be labelled as one');
  assert.match(html, /unpublished/i, 'it must say the factor is unpublished');
  assert.match(html, /CSCF\s*(&nbsp;)?=(&nbsp;)?\s*1/,
    'the assumed CSCF must be stated, not buried');
  assert.match(html, /Not a final figure/i,
    'it must say outright that this is not final');
});

test('NON-NEGOTIABLE 5 — the provenance stamp travels on EVERY branch', () => {
  for (const [label, e] of [
    ['priced', run('25231000', 'DZ', '(A)', '100')],
    ['refused', run('72241010', 'IN', '(F)', '60')],
  ]) {
    const html = renderResult(e);
    assert.match(html, /Provenance/, `${label}: the stamp must render`);
    assert.match(html, /Origin basis/, `${label}: originBasis must be shown`);
    assert.match(html, /Snapshot/, `${label}: the snapshot hash must be shown`);
  }
});

test('NON-NEGOTIABLE 4 — nothing claims a filing or registry validation', () => {
  for (const e of [run('25231000', 'DZ', '(A)', '100'), run('72241010', 'IN', '(F)', '60')]) {
    const html = renderResult(e).toLowerCase();
    for (const forbidden of ['filed', 'submitted to the', 'validated by', 'registry-approved']) {
      assert.ok(!html.includes(forbidden),
        `the readout must never claim "${forbidden}" — it is decision-support, not a declaration`);
    }
  }
});

test('a residual-basis figure says so — it must not read as the origin\'s own value', () => {
  // Find any good whose default resolves from the Commission's residual bucket.
  let residual = null;
  for (const c of pack.classifications.slice(0, 120)) {
    for (const country of ['IN', 'TR', 'CN', 'BR']) {
      const rs = routesFor(pack, c.code, country, 2026);
      if (!rs.length) continue;
      const e = run(c.code, country, rs[0], '10');
      if (e.stamp?.originBasis === 'residual') { residual = e; break; }
    }
    if (residual) break;
  }
  if (!residual) return; // none in the sampled slice; the branch is still covered above
  assert.match(renderResult(residual), /Residual bucket/,
    'a residual-derived figure must name its basis, or a reader believes the Commission '
    + 'priced their country when it did not');
});

test('the renderer handles every status the engine can return', () => {
  // Exhaustiveness is enforced at compile time by the `never` arm in renderResult;
  // this checks the runtime side — that each reachable status produces real output.
  const seen = new Set();
  const probes = [
    // cscf_pending, unavailable, cscf_pending — 72052100/(C) is the refusal probe
    // (72241010 no longer refuses; see the §8 stranded-line test above).
    ['25231000', 'DZ', '(A)'], ['72052100', 'IN', '(C)'], ['72083800', 'IN', '(C)'],
  ];
  for (const [cn, country, route] of probes) {
    const e = run(cn, country, route, '10');
    seen.add(e.status);
    const html = renderResult(e);
    assert.ok(html.includes('cb-res'), `${e.status}: must render a result block`);
    assert.ok(html.length > 200, `${e.status}: output looks empty`);
  }
  assert.ok(seen.size >= 2, `expected several statuses across probes, saw ${[...seen]}`);
});

/* ── per-year threshold cards (multi-line) ─────────────────────────────────── */

/**
 * The 2026 threshold row's own sectors, on every hand-built `ruleFound: true` card below. The
 * verdict's sentence is now DERIVED from this field rather than typed into the template, so a
 * card without it is not a card thresholdByYear could ever produce — and renderYearThreshold
 * throws on one rather than falling back to a hardcoded four, which is why omitting it here
 * fails loudly instead of quietly re-pinning prose nothing computed.
 *
 * READ FROM THE REAL PACK, not typed, for the reason this file's header gives for every other
 * figure in it: if the Commission widens the row, ATTESTATION_SENTENCE below goes red and a human
 * has to look at the prose — exactly the alarm a hardcoded list could never raise.
 */
const SECTORS_2026 = pack.thresholds.find((t) => t.calendarYear === 2026).includedSectors;

test('renderYearThreshold: a year without a rule refuses to invent one', () => {
  const html = renderYearThreshold({ calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.match(html, /no.*threshold.*published.*2027/i);
  assert.doesNotMatch(html, /50/, 'must not show the 2026 figure for 2027');
});

test('renderYearThreshold: below-attested says so and names its basis', () => {
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '30', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
    eligibleLineCount: 1, linesInYear: 1,
    includedSectors: SECTORS_2026,
  });
  assert.match(html, /Below threshold/);
  // Pin MEANING, not just the word "attested" appearing anywhere — a keyword-only assertion
  // (assert.match(html, /attested/i)) still passes if the sentence is inverted to say the
  // verdict does NOT rest on any attestation. Match the actual claim, and assert its precise
  // negation is absent, the same shape the CSCF floor test already uses.
  assert.match(html, /rests on your attested statement/i, 'the verdict must say what it rests on');
  assert.match(html, /verified by no one/i, 'and must say the claim is unverified');
  assert.doesNotMatch(html, /does not rest on/i, 'must not carry the inverted claim');
  assert.doesNotMatch(html, /independently (confirmed|verified)/i,
    'must not claim the Commission verified completeness — no one did');
  assert.doesNotMatch(html, /verified by the commission/i);
  // EXACT pin (see the constant's own doc comment above the §8 checklist) — catches a
  // paraphrase that keeps "rests on your attested statement" and "verified by no one" both
  // verbatim, then appends a clause that quietly reassures the reader out of the caveat.
  assert.ok(html.includes(ATTESTATION_SENTENCE),
    'the attestation sentence must match the pinned text exactly — word for word, punctuation for punctuation');
  assert.match(html, /data-attest="2026"[^>]*checked/, 'checkbox reflects the attestation');
  assert.match(html, /2025\/2083/, 'the amending act must be cited on the per-year card too');
});

test('renderYearThreshold: a below-threshold verdict says which lines its test did not cover', () => {
  // THE regression this task exists for. Art 2(3)'s de minimis is a MASS test over four sectors,
  // so a hydrogen line is RIGHTLY outside the basis — the exclusion is correct and untouched.
  // The wording then generalised it. MEASURED on the shipped pack: 40 t of cement plus 1000 t of
  // hydrogen, both dated 2026, attested complete —
  //   THRESHOLD CARD → state below_threshold, knownEligibleMassT '40', eligibleLineCount 1
  //   PER-LINE         cement    40 t → EUR      2,286.87   (scenario.costEur; both cscf_pending)
  //                    hydrogen 1000 t → EUR    523,015.36
  //   sumTotals        costEur '525302.23'
  // — and the card said "Below the threshold an importer owes nothing for 2026" beside it.
  //
  // The card ALREADY knew: eligibleLineCount was 1 while the user had entered 2. It just had no
  // denominator to say so with, which is what linesInYear (cbam-lines.ts) now supplies.
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '40', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
    eligibleLineCount: 1, linesInYear: 2,
    includedSectors: SECTORS_2026,
  });
  assert.match(html, /1 of your 2 lines/, 'the card must count what its test did not cover');
  assert.match(html, /does not mean you owe nothing/i,
    'and must refuse the generalisation the old sentence made');
  // The verdict must no longer make the unqualified claim ANYWHERE in the card — a card that
  // added the caveat while keeping the original sentence would pass both matches above.
  assert.doesNotMatch(html, /an importer owes nothing/i,
    'the unqualified year-wide claim must be gone, not merely qualified further down');
  // EXACT pin, closed at both ends by its own <p> tags (see the constant's doc): catches the
  // paraphrase attack that keeps every phrase above and appends a reassurance after the last
  // full stop, and catches a reworded exclusion clause that still contains "1 of your 2 lines".
  assert.ok(html.includes(ATTESTATION_SENTENCE_WITH_EXCLUSION),
    'the excluded-line verdict must match the pinned text exactly — word for word');
});

test('renderYearThreshold: a year with nothing excluded carries no exclusion sentence', () => {
  // The other half, and the one that keeps the sentence from becoming boilerplate. A caveat that
  // prints on EVERY below-threshold card is not a caveat, it is furniture — a reader who sees it
  // beside a cement-only year learns nothing from seeing it beside a hydrogen one.
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '40', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
    eligibleLineCount: 1, linesInYear: 1,
    includedSectors: SECTORS_2026,
  });
  assert.doesNotMatch(html, /of your \d+ lines/, 'nothing was excluded, so nothing is named');
  assert.doesNotMatch(html, /does not mean you owe nothing/i);
  assert.doesNotMatch(html, /outside that test/i);
  // ...and the verdict it DOES carry still states its own basis: the four mass sectors, not
  // "the year". Dropping the exclusion clause must not drop the scoping with it.
  assert.match(html, /threshold for those sectors/,
    'the surviving sentence must still scope itself to the sectors the test measures');
});

test('renderYearThreshold: the exclusion sentence agrees with itself in number', () => {
  // Two excluded lines, so the verb must be "are". Cheap to get wrong, and a card whose grammar
  // visibly breaks is a card a reader trusts less on the arithmetic too.
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '40', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
    eligibleLineCount: 1, linesInYear: 3,
    includedSectors: SECTORS_2026,
  });
  assert.match(html, /2 of your 3 lines for 2026 are outside that test/);
});

test('renderYearThreshold: only the below-threshold verdict carries the exclusion note', () => {
  // The note exists to stop ONE claim — "you owe nothing for the year". The other two states
  // never make it: 'above' says the exemption does not apply and the exposure stands, and
  // 'indeterminate' says the year is unresolved and asks the user to attest. Printing the note
  // on those would attach a rebuttal to a claim that was never made, and would train the reader
  // to skim past it on the one card where it matters. Both fixtures carry an excluded line
  // (eligibleLineCount 1 of linesInYear 2), so the note is available to print and withheld.
  for (const state of ['above_threshold', 'indeterminate']) {
    const html = renderYearThreshold({
      calendarYear: 2026, ruleFound: true, state,
      knownEligibleMassT: state === 'above_threshold' ? '60' : '40', thresholdT: '50',
      sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
      entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: state !== 'above_threshold',
      eligibleLineCount: 1, linesInYear: 2,
      includedSectors: SECTORS_2026,
    });
    assert.doesNotMatch(html, /of your 2 lines/, `${state} makes no owe-nothing claim to qualify`);
    assert.doesNotMatch(html, /does not mean you owe nothing/i, state);
  }
});

test('renderYearThreshold: above hides the checkbox — a fact needs no attestation', () => {
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'above_threshold',
    knownEligibleMassT: '60', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: [], attested: false,
    eligibleLineCount: 1, linesInYear: 2,
    includedSectors: SECTORS_2026,
  });
  assert.match(html, /Above threshold/);
  assert.doesNotMatch(html, /data-attest/, 'no checkbox when it cannot change the answer');
});

test('renderYearThreshold: indeterminate is tagged pending, not the green of a real below-threshold verdict', () => {
  // The plan this shipped from gave indeterminate the SAME 'ok' tone as below_threshold — an
  // unresolved "we cannot tell you yet" must not wear the colour of a resolved "you owe nothing".
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'indeterminate',
    knownEligibleMassT: '30', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: false,
    eligibleLineCount: 1, linesInYear: 2,
    includedSectors: SECTORS_2026,
  });
  assert.match(html, /Indeterminate/);
  assert.match(html, /cb-tag pending/, 'indeterminate must use the pending tone, not ok');
  assert.doesNotMatch(html, /cb-tag ok/, 'indeterminate must not be tagged with the same class as below_threshold');
});

/* ── the totals card ────────────────────────────────────────────────────────── */

test('renderTotals: a pending total is tagged a what-if and shows no false euro', () => {
  const html = renderTotals({
    certificates: '214.395', costEur: null, chargeableTco2e: '214.395',
    pricedLines: 2, refusedLines: 1, anyPending: true,
  });
  assert.match(html, /What-if/);
  assert.match(html, /1 line.*no estimate/i, 'refusals are counted, not hidden');
  // The intent is "no euro FIGURE", not "no euro character at all" — the honest fallback
  // sentence names the euro ("No € total — …") without a number attached to it.
  assert.doesNotMatch(html, /€[\d,]/, 'no euro figure when any price is missing');
});

test('renderTotals: a final priced total shows the euro figure and no what-if language', () => {
  const html = renderTotals({
    certificates: '71.465', costEur: '5385.60', chargeableTco2e: '71.465',
    pricedLines: 1, refusedLines: 0, anyPending: false,
  });
  assert.match(html, /Priced/);
  assert.match(html, /€5,385\.60/);
  assert.doesNotMatch(html, /What-if/);
});

test('renderTotals: a non-numeric costEur never prints as "€NaN" or the literal text "null"', () => {
  // Every current call site only calls eur() after checking its input is truthy — costEur here
  // is a non-empty but non-numeric string, so it still passes that guard and reaches eur().
  // Nothing in Totals' TYPE stops a future caller from constructing this; eur() must make it
  // safe to print rather than trust that every future call site re-derives the same guard.
  const html = renderTotals({
    certificates: '71.465', costEur: 'not-a-number', chargeableTco2e: '71.465',
    pricedLines: 1, refusedLines: 0, anyPending: false,
  });
  assert.doesNotMatch(html, /€NaN/i);
  assert.doesNotMatch(html, />null</, 'eur() must never leave a bare "null" for a template to print');
});

test('renderTotals: a whitespace-only costEur never prints as an invented "€0.00"', () => {
  // Number('   ') is 0 in JS, same quirk as Number('') — the first fix only special-cased the
  // exact empty string and missed this. A whitespace-only string is TRUTHY, so it passes the
  // `t.costEur ? eur(t.costEur) : fallback` guard at every call site exactly like a real value.
  const html = renderTotals({
    certificates: '71.465', costEur: '   ', chargeableTco2e: '71.465',
    pricedLines: 1, refusedLines: 0, anyPending: false,
  });
  assert.doesNotMatch(html, /€0\.00/, 'blank input must not render as an invented zero cost');
  assert.match(html, /cb-cost">—<\/div>/, 'blank input renders the same placeholder as null');
});

test('renderTotals: every entered line refused reads as a warning, never a claimed zero', () => {
  // Totals.certificates is '0' both for "genuinely zero" and "nothing was summed" — the card
  // must not let the second case read as a confirmed zero-liability result.
  const html = renderTotals({
    certificates: '0', costEur: null, chargeableTco2e: '0',
    pricedLines: 0, refusedLines: 2, anyPending: false,
  });
  assert.doesNotMatch(html, /Priced/, 'zero priced lines must not be tagged as a priced result');
  assert.doesNotMatch(html, /class="cb-fig"/, 'no figure block when nothing was summed');
  assert.match(html, /2 line.*no estimate/i, 'the refused lines must still be named');
  assert.match(html, /cb-tag unavail/, 'every-line-refused is a real warning, the red tone');
});

test('renderTotals: no lines entered yet is a neutral empty state, not the same red as a refusal', () => {
  // pricedLines === 0 with refusedLines === 0 is derivable from Totals as it stands — no line
  // was ever entered — and must not wear the same "unavail" tone as every-line-refused: an
  // empty form is not a form full of failures.
  const html = renderTotals({
    certificates: '0', costEur: null, chargeableTco2e: '0',
    pricedLines: 0, refusedLines: 0, anyPending: false,
  });
  assert.doesNotMatch(html, /Nothing priced/i, 'must not read as "every line failed" when none were entered');
  assert.doesNotMatch(html, /class="cb-fig"/);
  assert.match(html, /cb-tag pending/, 'an empty state is neutral, not the red unavail tone');
});

/* ── per-line card ──────────────────────────────────────────────────────────── */

test('renderLineCard: 1-based numbering, the remove control carries the id, and user text is escaped', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  const html = renderLineCard({
    id: 'L1"><script>alert(1)</script>', cn: '25231000<b>', country: 'DZ',
    route: '(A)', scope: 'direct', massT: '100', date: '2026-03-15',
  }, e, 2);
  assert.match(html, /Line 3/, 'the index shown to the user is 1-based');
  assert.doesNotMatch(html, /<script>/, 'a raw line id must never reach the DOM unescaped');
  assert.match(html, /data-remove="L1&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/,
    'the remove control must carry the escaped line id, matching what render put in data-line');
  assert.match(html, /25231000&lt;b&gt;/, 'CN text must be escaped, not injected as markup');
  assert.match(html, /cb-res/, 'the ordinary result card renders inside the line card');
});

test('renderLineCard: a cleared mass field reads as missing, never a false zero', () => {
  // Number('') is 0 in JS — a real quirk, not a missing-value signal. Line.massT is free-typed
  // by the user with no format guarantee (unlike every earlier num() caller, which only ever
  // fed engine output), so a cleared field must not silently render as a confirmed "0 t".
  const e = run('25231000', 'DZ', '(A)', '100');
  const html = renderLineCard({
    id: 'L1', cn: '25231000', country: 'DZ', route: '(A)', scope: 'direct', massT: '', date: '2026-03-15',
  }, e, 0);
  assert.doesNotMatch(html, /\b0 t\b/, 'an empty mass must not render as a confirmed zero');
  assert.match(html, /· — t ·/, 'an empty mass renders as a visible placeholder instead');
});

test('renderLineCard: a whitespace-only mass field reads as missing, never a false zero', () => {
  // Number('   ') is 0 in JS, the same quirk as Number('') — the first fix only special-cased
  // the exact empty string and missed this. A cleared <input> can leave stray whitespace behind
  // depending on how it was cleared, and that must be treated as missing input too.
  const e = run('25231000', 'DZ', '(A)', '100');
  const html = renderLineCard({
    id: 'L1', cn: '25231000', country: 'DZ', route: '(A)', scope: 'direct', massT: '   ', date: '2026-03-15',
  }, e, 0);
  assert.doesNotMatch(html, /\b0 t\b/, 'a whitespace-only mass must not render as a confirmed zero');
  assert.match(html, /· — t ·/, 'a whitespace-only mass renders as a visible placeholder instead');
});

/* ── the printable document ────────────────────────────────────────────────── */

test('buildPrintDocument carries all four §4 caveats, the real OJ hashes, and the injected date', () => {
  const html = buildPrintDocument({
    lines: [{ id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
              scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' }],
    results: [run('25231000', 'DZ', '(A)', '100')],
    yearCards: [], totals: sumTotals([run('25231000', 'DZ', '(A)', '100')]),
    packSnapshot: 'f'.repeat(64),
    rulePackages: ['eu-cbam-2026-defaults-v2@v1', 'eu-cbam-2026-free-allocation@v1'],
    pack, generatedOn: '2026-08-08',
  });
  assert.match(html, /cross-sectoral correction factor/i);
  assert.match(html, new RegExp('f'.repeat(16)), 'the pack snapshot appears');
  assert.match(html, /What this does not tell you/i);
  assert.match(html, /2026-08-08/, 'the generation date is the one the caller supplied, not the clock');
  // Every §4 caveat below is asserted as a MATCH-the-claim + ASSERT-the-negation-is-absent
  // pair. A reviewer proved that keyword-only assertions (e.g. assert.match(html, /Art.*9/i))
  // still pass when the sentence is inverted to its precise opposite — three of four caveats
  // were flipped this way and all 33 tests stayed green. Only the CSCF pair below (already
  // shaped this way) caught its own inversion.
  //
  // The direction that matters most: CSCF=1 is the MAXIMUM legally possible correction, so every
  // shown figure is a FLOOR — the true bill cannot be lower, only possibly higher.
  assert.match(html, /cannot be lower.*may be higher/is, 'the CSCF direction must not be stated backwards');
  assert.doesNotMatch(html, /cannot be higher/i, 'must not carry the reversed claim');
  assert.doesNotMatch(html, /may be lower/i, 'must not carry the reversed claim');
  // Article 9 (carbon price paid in the country of origin): NOT modelled.
  assert.match(html, /are not modelled/i, 'the Art 9 gap must be stated as a gap');
  assert.match(html, /do not credit any such payment/i);
  assert.doesNotMatch(html, /are modelled/i, 'must not claim Art 9 is modelled — mutation: "are modelled and applied automatically"');
  assert.doesNotMatch(html, /already credit/i, 'must not claim a payment is already credited');
  // Completeness: rests on the USER's statement, verified by no one.
  assert.match(html, /rests on the user's own statement of completeness/i);
  assert.match(html, /no one has verified that list/i);
  assert.doesNotMatch(html, /independently verified/i, 'mutation: "independently verified… by the Commission"');
  assert.doesNotMatch(html, /verified.{0,20}by the commission/is);
  // Fingerprint: inputs as entered, NOT customs provenance, no source document.
  assert.match(html, /inputs as entered/i, 'the fingerprint must be labelled honestly');
  assert.match(html, /no source document exists/i);
  assert.match(html, /not customs provenance/i);
  assert.doesNotMatch(html, /checked against a source document/i, 'mutation: fingerprints ARE checked against a document');
  assert.doesNotMatch(html, /\bconstitute customs provenance\b/i, 'mutation: fingerprints DO constitute customs provenance');
  // EXACT pins (see the constants' own doc comment above): the match/doesNotMatch pairs above
  // give a readable failure naming which claim broke; these catch what regex CANNOT — a
  // paraphrase that keeps every phrase a regex looks for and appends a contradicting
  // reassurance to the same sentence ("...so your bill is effectively reduced for it
  // regardless"). Regex still passes that; an exact substring match cannot.
  assert.ok(html.includes(CAVEAT_CSCF), 'the CSCF caveat must match the pinned text exactly — word for word, punctuation for punctuation');
  assert.ok(html.includes(CAVEAT_ARTICLE_9), 'the Article 9 caveat must match the pinned text exactly');
  assert.ok(html.includes(CAVEAT_COMPLETENESS), 'the completeness caveat must match the pinned text exactly');
  assert.ok(html.includes(CAVEAT_FINGERPRINT), 'the fingerprint caveat must match the pinned text exactly');
  // Sourced from pack.sources IN THE TEST, not retyped — a hardcoded expected hash here would
  // keep passing even if the document started printing the wrong field of the pack again (the
  // earlier bug this replaced: printing the WORKBOOK digest under the REGULATION's label).
  const regHash = (id) => pack.sources.find((s) => s.id === id).sha256;
  assert.match(html, new RegExp(regHash('ir-2025-2620')),
    'the IR (EU) 2025/2620 REGULATION hash — not the Benchmarks workbook\'s — must appear');
  assert.match(html, new RegExp(regHash('ir-2025-2621')),
    'the IR (EU) 2025/2621 REGULATION hash — not the Default Values workbook\'s — must appear');
  // The underlying Commission workbooks are a different, also-true claim — printed too, but
  // distinctly labelled so a reader cannot mistake one digest for the other.
  assert.match(html, new RegExp(regHash('ec-benchmarks-workbook-v1')),
    'the Benchmarks workbook hash must also appear, labelled as a workbook');
  assert.match(html, new RegExp(regHash('ec-default-values-workbook-v1')),
    'the Default Values workbook hash must also appear, labelled as a workbook');
  assert.notEqual(regHash('ir-2025-2620'), regHash('ec-benchmarks-workbook-v1'),
    'sanity: the regulation and its workbook must be genuinely different digests in the pack');
  assert.match(html, /workbook/i, 'the workbook hashes must be labelled distinctly from the regulations');
});

test('buildPrintDocument never prints the pack\'s all-zero placeholder as though it were a real digest', () => {
  // Four real sources in the shipped pack (dir-2003-87-art-10a-1a, dr-2019-331-art-14-6,
  // reg-2023-956, ec-certificate-price-page) still carry 64 zeros because no hash has been
  // pinned for them. A future §3 line reaching one of those must say so, not print the zeros.
  const zeroPack = {
    sources: [
      { id: 'ir-2025-2620', sha256: '0'.repeat(64) },
      { id: 'ir-2025-2621', sha256: pack.sources.find((s) => s.id === 'ir-2025-2621').sha256 },
      { id: 'ec-benchmarks-workbook-v1', sha256: pack.sources.find((s) => s.id === 'ec-benchmarks-workbook-v1').sha256 },
      { id: 'ec-default-values-workbook-v1', sha256: pack.sources.find((s) => s.id === 'ec-default-values-workbook-v1').sha256 },
    ],
  };
  const html = buildPrintDocument({
    lines: [], results: [], yearCards: [], totals: sumTotals([]),
    packSnapshot: 'f'.repeat(64), rulePackages: [], pack: zeroPack, generatedOn: '2026-08-08',
  });
  assert.doesNotMatch(html, /0{64}/, 'a placeholder digest must never render as 64 zeros');
  assert.match(html, /not yet pinned/i, 'a missing digest must be named as unpinned, not silently zero');
});

test('buildPrintDocument throws a named error on a lines/results length mismatch, rather than crash blind', () => {
  assert.throws(() => buildPrintDocument({
    lines: [{ id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
              scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' }],
    results: [],
    yearCards: [], totals: sumTotals([]),
    packSnapshot: 'f'.repeat(64), rulePackages: [], pack, generatedOn: '2026-08-08',
  }), /1 line\(s\) but 0 result\(s\)/);
});

test('buildPrintDocument\'s §2 verdict matches what renderYearThreshold\'s own card shows, for both branches of the union', () => {
  // Review finding: §2 used to re-derive the verdict word inline (`y.state.replace(/_/g, ' ')`)
  // instead of routing through yearVerdictTag(y) — the helper renderYearThreshold and the
  // #cbStatus announcement both already call for exactly this reason (see yearVerdictTag's own
  // doc comment). The two agreed only by casing today ("below threshold" here vs "Below
  // threshold" on the card) — a coincidence, not a guarantee, and the exact failure mode this
  // branch spent twenty commits eliminating elsewhere. Every buildPrintDocument test above this
  // one passes `yearCards: []`, so this path had never actually been exercised.
  const below = {
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '30', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true,
    eligibleLineCount: 1, linesInYear: 1,
    includedSectors: SECTORS_2026,
  };
  // The ruleFound: false branch too — a year with no published rule at all, which the document
  // must still say SOMETHING about rather than silently omit (renderYearThreshold's own doc names
  // this the "sighted users only" gap when it is skipped).
  const noRule = { calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 };

  const okLine = { id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
    scope: 'direct_and_indirect', massT: '30', date: '2026-03-15' };
  const okResult = run('25231000', 'DZ', '(A)', '30');
  const html = buildPrintDocument({
    lines: [okLine], results: [okResult],
    yearCards: [below, noRule], totals: sumTotals([okResult]),
    packSnapshot: 'f'.repeat(64), rulePackages: [], pack, generatedOn: '2026-08-08',
  });

  for (const y of [below, noRule]) {
    const cardMatch = renderYearThreshold(y).match(/<span class="cb-tag [^"]+">([^<]+)<\/span>/);
    assert.ok(cardMatch, `sanity: renderYearThreshold(${y.calendarYear}) must render a tag span`);
    const cardTag = cardMatch[1];
    assert.ok(html.includes(`<b>${cardTag}</b>`),
      `§2 for ${y.calendarYear} must show the card's own tag verbatim ("${cardTag}"), not a `
      + 're-derived paraphrase that can drift from it');
  }
});

/* ── the LineEstimateFailure arm (Task 6) ──────────────────────────────────── */

test('buildPrintDocument shows a THROWN line in §1 rather than dropping it silently', () => {
  // §3 of the design doc defines §1 of the document as "every line as entered". A line whose
  // estimateFromPack call threw (see safeEstimates in cbam-app.ts's initCbam — rare, but the
  // old single-line run() caught exactly this) has no CertificateEstimate to put in its
  // results[i] slot. Dropping it from `lines`/`results` entirely would violate "every line as
  // entered" while it is STILL counted in the year cards (computed from the raw Line list, not
  // from priced results) — the exact silent-vanishing failure Task 6 was reviewed for. The fix:
  // a LineEstimateFailure marker keeps `lines` and `results` parallel and the row still prints,
  // carrying the failure reason instead of a figure.
  const okLine = { id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
    scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' };
  const failedLine = { id: 'L2', cn: '99999999', country: 'ZZ', route: 'default',
    scope: 'direct', massT: '10', date: '2026-06-01' };
  const okResult = run('25231000', 'DZ', '(A)', '100');
  const html = buildPrintDocument({
    lines: [okLine, failedLine],
    results: [okResult, { failed: true, message: 'engine exploded: no benchmark table for 99999999' }],
    yearCards: [], totals: sumTotals([okResult]),
    packSnapshot: 'f'.repeat(64),
    rulePackages: ['eu-cbam-2026-defaults-v2@v1'],
    pack, generatedOn: '2026-08-08',
  });
  assert.match(html, /99999999/, 'the failed line must still be listed in §1, not dropped');
  assert.match(html, /engine exploded: no benchmark table for 99999999/,
    'the failure reason must be printed in place of a figure');
  assert.match(html, /no estimate \(error\)/, 'a thrown line reads distinctly from an ordinary refusal');
  // The table must stay well-formed: same row shape (one <tr> per line), not a colspan hack that
  // could silently misalign columns for every row after it.
  assert.equal((html.match(/<tr>/g) ?? []).length, 3, 'one header row plus one row per line, including the failed one');
});

test('buildPrintDocument: a mix of ok, unavailable and thrown lines all print distinctly', () => {
  const okLine = { id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
    scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' };
  const refusedLine = { id: 'L2', cn: '72052100', country: 'IN', route: '(C)',
    scope: 'direct', massT: '60', date: '2026-03-15' };
  const failedLine = { id: 'L3', cn: '00000000', country: 'ZZ', route: 'default',
    scope: 'direct', massT: '5', date: '2026-06-01' };
  const okResult = run('25231000', 'DZ', '(A)', '100');
  const refusedResult = run('72052100', 'IN', '(C)', '60');
  assert.equal(refusedResult.status, 'unavailable', 'sanity: this is an ordinary engine refusal, not a throw');
  const html = buildPrintDocument({
    lines: [okLine, refusedLine, failedLine],
    results: [okResult, refusedResult, { failed: true, message: 'boom' }],
    yearCards: [], totals: sumTotals([okResult, refusedResult]),
    packSnapshot: 'f'.repeat(64), rulePackages: [], pack, generatedOn: '2026-08-08',
  });
  assert.equal((html.match(/<tr>/g) ?? []).length, 4, 'the header row plus all three lines appear, none silently dropped');
  assert.match(html, /no estimate<\/td>/, 'the ordinary refusal reads as a plain "no estimate"');
  assert.match(html, /no estimate \(error\)/, 'the thrown line reads distinctly, as an error');
  assert.match(html, />boom</, 'the thrown line\'s own message is printed');
});

/* ── the shared snapshot-decoration point (spec-review fix) ───────────────────
 *
 * initCbam's single-line preview (run()) and its multi-line path (estimateLine()) both render a
 * CertificateEstimate, and BOTH must stamp the real pack snapshot in place of the vendored
 * engine's literal 'browser-prototype' placeholder — that is the whole point of §4's snapshot
 * claim. They used to do this with two separate `e.stamp.snapshotHash = snapshot` assignments;
 * run() never got one, so the view every first-time visitor sees (and the one shown again
 * whenever the last line is removed) rendered the raw placeholder. decorateSnapshot() is now the
 * ONE place either path can reach for this, and it is exported specifically so this — the fact
 * that no rendered estimate on EITHER path can carry the placeholder — is checkable without
 * driving the DOM. */

test('decorateSnapshot replaces the vendored placeholder — the one decoration point both run() and estimateLine() share', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  assert.equal(e.stamp.snapshotHash, 'browser-prototype',
    'sanity: the vendored engine ships this literal placeholder before decoration');
  const decorated = decorateSnapshot(e, 'f'.repeat(64));
  assert.equal(decorated.stamp.snapshotHash, 'f'.repeat(64));
  assert.notEqual(decorated.stamp.snapshotHash, 'browser-prototype',
    'no path may render the raw vendored placeholder — the exact regression this fixes');
});

test('decorateSnapshot never falls through to an empty claim, or silently keeps the placeholder, before the pack snapshot is known', () => {
  // initCbam's `snapshot` variable is only ever set atomically alongside `pack` itself, inside
  // ensurePack, once BOTH loadPack() and packSnapshotHash() have succeeded — so by construction
  // every call site reachable today already has a real hash by the time it calls this function.
  // This exercises the branch defensively anyway: '' must not print as though the stamp made no
  // claim at all (worse than the placeholder it replaces), and must not silently fall back to the
  // vendored text either.
  const e = run('25231000', 'DZ', '(A)', '100');
  const decorated = decorateSnapshot(e, '');
  assert.notEqual(decorated.stamp.snapshotHash, '',
    'a blank snapshot reads as though no claim were made at all — worse than an unmet one');
  assert.notEqual(decorated.stamp.snapshotHash, 'browser-prototype',
    'must not silently keep the vendored placeholder either');
  assert.match(decorated.stamp.snapshotHash, /pending|not yet/i,
    'the pre-pack state must say, honestly, that the snapshot is not yet available');
});

test('the pre-pack fallback text renders in full, never truncated as though it were a hash', () => {
  // renderStamp (cbam-app.ts) truncates any snapshotHash LONGER than 24 chars to its first 16
  // plus an ellipsis, on the assumption that anything that long is a hash worth shortening — the
  // same assumption that used to mangle the vendored 'browser-prototype' placeholder into
  // "browser-prototyp" before that function's own length check was added. decorateSnapshot's
  // fallback text is deliberately kept at or under that 24-char threshold for exactly this
  // reason; this pins BOTH halves of that fix — that the fallback is short enough today, and
  // that renderStamp still shows it in full rather than a garbled, ellipsis-truncated fragment.
  const e = decorateSnapshot(run('25231000', 'DZ', '(A)', '100'), '');
  assert.ok(e.stamp.snapshotHash.length <= 24,
    `the fallback text must stay at or under renderStamp's 24-char truncation threshold, got ${e.stamp.snapshotHash.length}`);
  const html = renderResult(e);
  assert.match(html, /not yet computed/,
    'the fallback text must appear in full, not truncated as though it were a hash');
  assert.doesNotMatch(html, /not yet comput(?!ed)/, 'must not be cut off mid-word by the hash-truncation path');
  assert.doesNotMatch(html, /browser-prototype/);
});

test('renderStamp truncates a genuine 64-hex-char snapshotHash to its first 16 chars plus an ellipsis', () => {
  // Every test above this one exercises renderStamp only with the SHORT pre-pack fallback
  // ('not yet computed', 22 chars) — none of them ever cross the `s.snapshotHash.length > 24`
  // branch renderStamp's own doc comment describes. A real digest is exactly what that branch
  // exists for (`decorateSnapshot` stamps a 64-hex-char sha256 onto every estimate once the pack
  // has resolved — see its own doc comment), and removing the truncation entirely left the whole
  // suite green until this test existed.
  const realHash = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  assert.equal(realHash.length, 64, 'sanity: this is a genuine sha256 hex digest length');
  const e = decorateSnapshot(run('25231000', 'DZ', '(A)', '100'), realHash);
  assert.equal(e.stamp.snapshotHash, realHash, 'sanity: decorateSnapshot stamped the real hash unmodified');
  const html = renderResult(e);
  assert.match(html, new RegExp(`${realHash.slice(0, 16)}…`),
    'a real hash must render shortened to its first 16 characters plus an ellipsis');
  assert.doesNotMatch(html, new RegExp(realHash),
    'the full 64-char digest must not be printed verbatim in the stamp — that is what the '
    + 'truncation exists to avoid');
});

/* ── verified emissions: the spec §6 worked line, pinned end-to-end ─────────── */

test('verified figures price with no mark-up — the spec worked example', () => {
  const e = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
    verified: { directTco2ePerT: '2.31' },
  });
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.emissionsTco2e, '231');
  assert.equal(e.scenario.certificates, '105.42');
  assert.equal(e.scenario.costEur, '7944.45');
  assert.equal(e.stamp.tier, 'actual-verified');
  // and the SAME line through the default path still gives the marked-up figure —
  // this pair IS the delta the card will show (€12,420.84 − €7,944.45)
  const d = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  });
  assert.equal(d.status, 'cscf_pending');
  assert.equal(d.scenario.costEur, '12420.84');
});

test('a verified figure rests on no Commission default, so it reports no origin basis', () => {
  // originBasis is a provenance CLAIM about where the number came from. The defaults path
  // stamps 'country' because the figure IS the origin's published default; an importer's own
  // audited figure is backed by their verifier, not by the Commission. The UI renders this row
  // on truthiness, so any truthy value here would print "the origin's own published default"
  // over someone's attested number — a false provenance claim, not merely a redundant one.
  const e = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
    verified: { directTco2ePerT: '2.31' },
  });
  assert.equal(e.stamp.originBasis, null,
    'a verified figure must report NO origin basis — not "country"');
  // the contrast that gives the assertion its teeth: the same line through the defaults path
  // genuinely does rest on a published country default, and still says so.
  const d = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  });
  assert.equal(d.stamp.originBasis, 'country',
    'sanity: the defaults path still reports the basis it really has');
});

test('a negative verified figure is refused, not priced', () => {
  // Fail-closed: the engine's floor clamp is not a guard here (it clamps the direct side and
  // then ADDS indirect), so a nonsense figure that got through would print a confident bill —
  // a negative one priced a negative liability. Refusing names the gap instead.
  const e = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
    verified: { directTco2ePerT: '-1' },
  });
  assert.equal(e.status, 'unavailable');
  assert.equal(e.scenario, undefined, 'a refusal must carry no what-if figure');
  assert.equal(e.figure, undefined, 'a refusal must carry no figure at all');
  assert.match(e.selector, /directTco2ePerT/,
    'the refusal must name which input it could not read');
});

/* ── the verified panel's pure validator ───────────────────────────────────────
 * parseVerifiedFields is the only place the verified form fields become line data, and it is
 * pure precisely so the tests can reach it — the DOM handler around it is a two-line read of
 * five `.value`s, checked by Task 8's e2e. Everything worth getting wrong is in here.
 */

/** The all-default input; each test overrides only the field it is about. */
const vf = (over = {}) => ({
  tier: 'actual-verified', direct: '', indirect: '', attested: true, ref: '', ...over,
});

test('the defaults tier passes straight through, ignoring every other field', () => {
  // Not merely "returns ok": a user who filled the panel in, then changed their mind back to the
  // Commission defaults, must not have their abandoned figures ride along into the line. The
  // tier is the only thing the defaults branch may contribute — and this branch is the ONLY
  // thing enforcing that, because syncVerifiedRows deliberately leaves those inputs FULL when it
  // hides the panel (clearing them would let one stray arrow-key `change` destroy the typing).
  const r = parseVerifiedFields(vf({
    tier: 'default+markup', direct: '9.9', indirect: '1.1', attested: false, ref: 'DNV-123',
  }));
  assert.deepEqual(r.ok, { tier: 'default+markup' },
    'the defaults branch must contribute the tier and NOTHING else');
});

test('a blank direct figure is refused, and the refusal names the field', () => {
  const r = parseVerifiedFields(vf({ direct: '' }));
  assert.equal(r.ok, undefined, 'a verified line with no figure must not become a line');
  assert.match(r.error, /direct/i, 'the refusal must name which field is missing');
});

test('a non-numeric direct figure is refused rather than coerced', () => {
  const r = parseVerifiedFields(vf({ direct: 'about two' }));
  assert.equal(r.ok, undefined);
  assert.match(r.error, /direct/i);
});

test('Infinity is refused — the check is finiteness, not merely not-NaN', () => {
  // `Number('Infinity')` is a number and passes `!Number.isNaN`, so only the FINITE test catches
  // it; verifiedFigure's own doc names this case. `<input type="number">` sanitises the string
  // away in a browser, so this is a guard on the pure function's contract rather than a reachable
  // UI path — asserted here because that contract is the only thing holding it.
  const r = parseVerifiedFields(vf({ direct: 'Infinity' }));
  assert.equal(r.ok, undefined, 'an infinite figure must never become a priceable line');
  assert.match(r.error, /direct/i);
});

test('a negative direct figure is refused — the engine floor would hide it', () => {
  // certificate-estimate.ts clamps the DIRECT side and then adds indirect on top, so a negative
  // figure that got past this function can price a negative bill. Refuse at the form too.
  const r = parseVerifiedFields(vf({ direct: '-1' }));
  assert.equal(r.ok, undefined);
  assert.match(r.error, /negative/i);
});

test('zero is a legal verified direct figure', () => {
  // A 100%-scrap EAF producer genuinely attests a near-zero figure. Treating 0 as "empty" (the
  // falsy trap) would refuse the one importer with the best data in the room.
  const r = parseVerifiedFields(vf({ direct: '0' }));
  assert.equal(r.error, undefined, `0 must be accepted, got: ${r.error}`);
  assert.equal(r.ok.seeDirect, '0');
  assert.equal(r.ok.tier, 'actual-verified');
});

test('the figures are stored AS ENTERED, never re-stringified through Number()', () => {
  // THE AUDIT TRAIL. lineFingerprint hashes these exact strings, so the digest is the record of
  // what the importer actually typed. `String(Number('2.50'))` is '2.5' — a round-trip through
  // the parsed number would leave the fingerprint pinning a figure nobody entered, and a verifier
  // reconciling the export against the attestation would find the trailing digit gone.
  const r = parseVerifiedFields(vf({ direct: '2.50', indirect: '0.40' }));
  assert.equal(r.error, undefined, `expected ok, got: ${r.error}`);
  assert.equal(r.ok.seeDirect, '2.50', 'the trailing zero the importer typed must survive');
  assert.equal(r.ok.seeIndirect, '0.40', 'and on the indirect figure too');
});

test('an unticked attestation refuses the line and says what the tick does', () => {
  const r = parseVerifiedFields(vf({ direct: '1.5', attested: false }));
  assert.equal(r.ok, undefined, 'an unattested claim must never reach the export');
  assert.match(r.error, /attest/i);
});

test('whitespace is trimmed off all three text values', () => {
  const r = parseVerifiedFields(vf({ direct: '  1.5 ', indirect: ' 0.4\t', ref: '  DNV-123  ' }));
  assert.equal(r.error, undefined, `expected ok, got: ${r.error}`);
  assert.equal(r.ok.seeDirect, '1.5');
  assert.equal(r.ok.seeIndirect, '0.4');
  assert.equal(r.ok.verifiedRef, 'DNV-123');
});

test('a whitespace-only direct figure is refused, not read as a number', () => {
  const r = parseVerifiedFields(vf({ direct: '   ' }));
  assert.equal(r.ok, undefined, "Number('   ') is 0 — trimming must run before the number check");
  assert.match(r.error, /direct/i);
});

test('a blank indirect field yields an object with NO seeIndirect key at all', () => {
  // THE ONE THAT MATTERS. estimate-from-pack.ts tests `indirectTco2ePerT !== undefined` BEFORE
  // verifiedPerT's shape gate, so an ABSENT indirect prices the line normally while an EMPTY
  // STRING fails the gate and refuses the WHOLE line. lineFingerprint distinguishes the two
  // deliberately (`?? null`). `seeIndirect: el.value` written unconditionally turns every blank
  // optional field into a refused line — so `in`, not `=== undefined`: the two differ here.
  const r = parseVerifiedFields(vf({ direct: '1.5', indirect: '' }));
  assert.equal(r.error, undefined, `expected ok, got: ${r.error}`);
  assert.equal('seeIndirect' in r.ok, false, 'a blank indirect must be ABSENT, not empty-string');
  assert.equal('verifiedRef' in r.ok, false, 'a blank reference must be ABSENT, not empty-string');
});

test('a whitespace-only indirect field is absent too, not an empty string', () => {
  const r = parseVerifiedFields(vf({ direct: '1.5', indirect: '   ' }));
  assert.equal(r.error, undefined, `expected ok, got: ${r.error}`);
  assert.equal('seeIndirect' in r.ok, false);
});

test('a non-numeric or negative indirect figure is refused', () => {
  const bad = parseVerifiedFields(vf({ direct: '1.5', indirect: 'lots' }));
  assert.equal(bad.ok, undefined);
  assert.match(bad.error, /indirect/i);
  const neg = parseVerifiedFields(vf({ direct: '1.5', indirect: '-0.4' }));
  assert.equal(neg.ok, undefined);
  assert.match(neg.error, /negative/i);
  const zero = parseVerifiedFields(vf({ direct: '1.5', indirect: '0' }));
  assert.equal(zero.error, undefined, 'zero indirect is as legal as zero direct');
  assert.equal(zero.ok.seeIndirect, '0');
});

/* ── tier → engine input ─────────────────────────────────────────────────────── */

test('verifiedInputOf derives from the TIER, never from whether the figures look truthy', () => {
  // If the tier says verified and no `verified` object reaches the engine, the engine stamps
  // 'default+markup' — and csvRows' tier guard then THROWS at export time, killing the whole
  // file, instead of the user seeing a refusal on the card. So a verified tier ALWAYS produces
  // an object, even a hopeless one; the engine's own verifiedPerT produces the refusal.
  assert.equal(verifiedInputOf({ tier: 'default+markup', seeDirect: '1.5' }), undefined,
    'the defaults tier must never smuggle a stray figure into the engine');
  assert.deepEqual(verifiedInputOf({ tier: 'actual-verified', seeDirect: '1.5' }),
    { directTco2ePerT: '1.5' }, 'an absent seeIndirect must omit indirectTco2ePerT entirely');
  assert.deepEqual(
    verifiedInputOf({ tier: 'actual-verified', seeDirect: '1.5', seeIndirect: '0.4' }),
    { directTco2ePerT: '1.5', indirectTco2ePerT: '0.4' });
  assert.deepEqual(verifiedInputOf({ tier: 'actual-verified' }), { directTco2ePerT: '' },
    'a verified line with no figure must still reach the engine, to be refused BY it');
});

test('verifiedInputOf still asks the engine on a MIXED line — the round trip that keeps export alive', () => {
  // THE ROUND TRIP THIS PINS. A mixed line is one the engine STAMPED
  // 'verified-direct+default-indirect' — the user never selects it (#cbTier has two options and
  // parseVerifiedFields emits two values); it is what the engine computes when an importer
  // attests their direct figure and leaves electricity to the Commission's published default.
  // The line then carries that stamped tier back, and every later re-estimate of the line reads
  // it HERE, through this function.
  //
  // So this arm is what makes the tier stable across the round trip. Narrow the check back to
  // 'actual-verified' alone and a mixed line returns `undefined`, the engine takes the DEFAULTS
  // path, stamps 'default+markup', and csvRows' guard throws at export — killing the entire CSV
  // over one line, which is exactly the failure verifiedInputOf's own docblock exists to
  // describe. It is invisible to the compiler: a narrower `!==` against a wider union type
  // checks clean, so this test is the only thing standing where the type cannot.
  const mixed = verifiedInputOf({ tier: 'verified-direct+default-indirect', seeDirect: '2.31' });
  assert.deepEqual(mixed, { directTco2ePerT: '2.31' },
    'a mixed line must still produce a verified input, carrying the attested DIRECT figure');
  // NOT merely `=== undefined`: the engine branches on `indirectTco2ePerT !== undefined` and a
  // present-but-undefined key reads to a human as "supplied, empty" while behaving as absent.
  // The key must not exist at all — that ABSENCE is what tells the engine to stand the
  // Commission's default in, which is the whole reason this tier exists.
  assert.ok(!('indirectTco2ePerT' in mixed),
    'the indirect key must be ABSENT — its absence is what invites the Commission default in');
  // And the attested figure still travels on the mixed tier, exactly as on the fully-verified
  // one: it is the half the importer DID audit, and dropping it would re-price the direct side
  // from defaults while the tier still claimed it was verified.
  assert.deepEqual(
    verifiedInputOf({ tier: 'verified-direct+default-indirect', seeDirect: '0' }),
    { directTco2ePerT: '0' },
    'zero is a legal attested figure on the mixed tier too (a 100%-scrap EAF producer)');
});

/* ── the verified line card: attestation and the default-path delta ──────────
 *
 * Two things the card owes a verified line, and neither is arithmetic:
 *
 *   1. THE STAMP. The figures are the importer's own claim and this tool has not checked them.
 *      renderStamp's "Data tier: Verified actual" row states WHICH corpus priced the line; it
 *      does not tell a reader that the number came from them and was never confirmed by us.
 *   2. THE DELTA. The mark-up prices not-having-data, so verified figures usually cost less —
 *      but a genuinely dirty producer can exceed the marked-up default, and a card that only
 *      ever says "saves" would be an advertisement, not an estimate. Both directions are
 *      exercised below against the REAL pack, with the crossover point computed rather than
 *      guessed (see the "worse" test's own arithmetic).
 *
 * The prose below is EXACT-PINNED, for the reason the §4 caveat constants give at the top of
 * this file: a keyword assertion survives a paraphrase that keeps every phrase it looks for and
 * appends a reassurance undoing them ("...though in practice verified data always comes out
 * cheaper"). These constants are a hand-typed, independent transcript of the production text —
 * never imported from cbam-app.ts — so changing the wording forces a deliberate edit here too.
 */
const ATTESTED_NOTE =
  'These emissions figures are your own attested claim, transcribed exactly as entered. '
  + 'This tool has not confirmed them — it has no way to check the verification behind them, '
  + 'and nothing on this card has been checked against your verification report.';
const DELTA_SAVES =
  'The Commission default would give €12,420.84 — your verified data saves €4,476.39. '
  + 'Both figures are what-ifs at the assumed CSCF, so the difference between them is one too.';
const DELTA_ADDS =
  'The Commission default would give €12,420.84 — your verified data adds €15,795.45 to what '
  + 'the default would cost. Both figures are what-ifs at the assumed CSCF, so the difference '
  + 'between them is one too.';
const DELTA_IDENTICAL =
  'The Commission default would give €12,420.84 — the same figure your verified data gives, '
  + 'so this claim changes nothing on this line. Both figures are what-ifs at the assumed CSCF, '
  + 'so the difference between them is one too.';
const DELTA_NO_DEFAULT =
  'The Commission publishes no default value for this good, origin and route, so there is '
  + 'nothing to compare your verified figures against.';
const DELTA_NOT_COMPUTED =
  'No Commission-default comparison was computed for this line, so none is shown. That is not '
  + 'a statement about what the Commission publishes.';
const DELTA_NOT_PRICED =
  'This line has no priced figure of its own, so there is nothing to compare a Commission '
  + 'default against.';

/** The spec §6 worked line, verified. Each test overrides only the field it is about. */
const vline = (over = {}) => ({
  id: 'L1', cn: '72061000', country: 'IN', route: '(C)', scope: 'direct',
  massT: '100', date: '2026-03-15', tier: 'actual-verified', seeDirect: '2.31', ...over,
});
/**
 * The line through its OWN tier, exactly as estimateLine does it in cbam-app.ts — through the
 * SAME builder production uses, not a hand-typed copy of it. These two helpers used to build the
 * EstimatorInput by hand, which is precisely why the delta tests below could not have noticed
 * estimateLine and defaultPathComparison drifting apart: every test held its own third copy of
 * the construction. See inputFor's own doc, and the drift test at the foot of this file.
 */
const estOf = (l) => estimateFromPack(pack, inputFor(l, verifiedInputOf(l)));
/** The same line through the Commission-default path — `verified` omitted, nothing else changed. */
const defaultOf = (l) => estimateFromPack(pack, inputFor(l, undefined));
/** What safeEstimates threads to the card: an unavailable default path is no comparison at all. */
const comparisonOf = (l) => {
  const d = defaultOf(l);
  return d.status === 'unavailable' ? null : d;
};

/**
 * The MIXED tier's worked line — the one vline cannot be.
 *
 * Cement from DZ at `direct_and_indirect` scope, attesting a direct figure and no indirect one.
 * 25231000/DZ/(A) HAS a published indirect default (baseIntensity 0.04, mark-up 10%), so the
 * engine stands it in — 0.04 × 1.10 × 100 t = 4.4 tCO2e — and stamps
 * 'verified-direct+default-indirect'. vline's 72061000 could never reach this tier from any input:
 * the Commission publishes no indirect default for iron & steel at all, so the lookup returns
 * `none` and zero is the published ANSWER rather than a substitution — which is why vline stays
 * 'actual-verified' and every test above it is untouched by this feature.
 *
 * `tier` states the tier the ENGINE stamps for these fields, because that is what draftLine puts
 * on the line. A test that wants the pre-stamp shape (what parseVerifiedFields emits) overrides it
 * to 'actual-verified' explicitly — see the mechanism test, which is about exactly that step.
 */
const mline = (over = {}) => ({
  id: 'M1', cn: '25231000', country: 'DZ', route: '(A)', scope: 'direct_and_indirect',
  massT: '100', date: '2026-03-15', tier: 'verified-direct+default-indirect', seeDirect: '2.31',
  ...over,
});

/**
 * The MIXED tier's REFUSED worked line, and the reason it is KR rather than a 2027 date.
 *
 * A refused mixed line is not a curiosity of an out-of-range year: KR is the only origin
 * publishing grey clinker route-independently, so the Commission's route-independent electricity
 * default is found and stands in (the line is stamped mixed), and the Annex then publishes
 * column-B cement benchmarks for routes (A) and (B) only — so the benchmark lookup fails at an
 * ordinary 2026 date with the price table fully populated. The refusal is raised INSIDE
 * estimateCertificates, after the substitution, which is exactly why the tier survives it.
 *
 * Shared by the tier test and the attestation tests below rather than copied into each: this file
 * has already paid for holding three copies of one construction (see estOf's own note).
 */
const krline = (over = {}) => ({
  id: 'K1', cn: '25231000', country: 'KR', route: 'default', scope: 'direct_and_indirect',
  massT: '100', date: '2026-03-15', tier: 'verified-direct+default-indirect', seeDirect: '2.31',
  ...over,
});

/**
 * A PRICED mixed line whose substituted electricity default came from the residual bucket — the
 * one shape that fires MIXED_RESIDUAL_INDIRECT_NOTE. mline cannot be it: DZ is listed for cement
 * (its own indirect row, base 0.04), so its substitution is the origin's own published value and
 * the note correctly stays silent. FJ is not listed at all, so the fallback resolves selOrigin
 * OTHER and the note fires. The pair is used together below, because the failure worth testing is
 * one note bleeding into the other's population.
 */
const rline = (over = {}) => ({
  id: 'R1', cn: '25232900', country: 'FJ', route: 'default', scope: 'direct_and_indirect',
  massT: '100', date: '2026-03-15', tier: 'verified-direct+default-indirect', seeDirect: '2.31',
  ...over,
});

/**
 * The mixed line's attestation, hand-typed for the reason the constants block at the top of this
 * file gives. It is a DIFFERENT paragraph from ATTESTED_NOTE, not a qualified version of it:
 * ATTESTED_NOTE says "These emissions figures are your own attested claim", which on a mixed line
 * is half-false — the electricity half is the Commission's own default value, marked up. Rendering
 * ATTESTED_NOTE there would over-claim provenance; rendering nothing would leave a mark-up-free
 * direct figure with no attestation beside it, the single state renderAttestation's docblock
 * exists to prevent. So the wording states which half is which, and both directions of it.
 */
const MIXED_NOTE =
  'Only the direct emissions figure on this line is your own attested claim, transcribed exactly '
  + 'as entered — this tool has not confirmed it, and has no way to check the verification behind '
  + 'it. The electricity component is not attested at all: it is the Commission\'s published '
  + 'default value, it carries the mark-up, and any verifier\'s reference cited here covers the '
  + 'direct figure alone.';

/**
 * The SAME line when the engine produced no figure for it, and why it is a third paragraph rather
 * than either of the two above.
 *
 * MIXED_NOTE is a claim about the OUTPUT: "the electricity component ... is the Commission's
 * published default value, it carries the mark-up". On a refused card there is no electricity
 * component, no figure of any kind (renderResult's 'unavailable' branch calls neither figure()
 * nor renderWaterfall()), and so nothing for that sentence to be about — it points at a number
 * the card does not have, and tells the reader a mark-up was charged on it.
 *
 * ATTESTED_NOTE is not the substitute, and this is the distinction the whole change turns on: it
 * is a claim about the INPUT ("These emissions figures are your own attested claim"), which is why
 * the refused FULLY-VERIFIED card keeps it verbatim and a test above pins that as wanted. On a
 * mixed line that sentence is still half false in the expensive direction whether or not a figure
 * was produced — the importer attested the direct figure and nothing else, so "these figures"
 * claims provenance for a half they never saw.
 *
 * Silence is not the substitute either, for the reason renderAttestation's own docblock gives: an
 * attested claim with no attestation beside it is the single state that function exists to
 * prevent, and a refusal does not un-make the claim.
 *
 * Hand-typed here, never imported, per the anti-paraphrase convention this file's constants block
 * documents.
 */
const REFUSED_MIXED_NOTE =
  'Only the direct emissions figure on this line is your own attested claim, and this tool has '
  + 'not confirmed it — it has no way to check the verification behind it. No figure was produced '
  + 'for this line, so nothing shown here rests on that claim, or on any Commission value.';

/**
 * The engine's residual-indirect disclosure, hand-typed for the same reason. It reaches the card
 * through stamp.notes, which renderStamp emits verbatim and ESCAPED — so the card is asserted
 * against the escaped form below, and the raw form against the stamp the engine produced.
 */
const RESIDUAL_INDIRECT_NOTE =
  'The electricity default substituted on this line is the Commission\'s "Other Countries and '
  + 'Territories" residual — a world-average value, not your country\'s own. Your direct figure '
  + 'is unaffected: it is your own attested claim.';

/**
 * The mixed line's delta, computed rather than guessed, and pinned because it is the arithmetic
 * the "treat mixed as verified in defaultPathComparison" decision rests on. For 25231000/DZ/(A)
 * at 100 t, both sides resolve the SAME free-allocation benchmark and the SAME indirect default:
 *
 *   free allocation   = 64.935 tCO2e            (identical on both paths)
 *   indirect          = 0.04 × 1.10 × 100 = 4.4 (identical on both paths — the lookup does not
 *                                                read `verified`, so it cancels in the subtraction)
 *   default   direct  = 1.24 × 1.10 × 100 = 136.4 → net 71.465 + 4.4 = 75.865 → €5,717.19
 *   attested  direct  = 2.31 × 100        = 231   → net 166.065 + 4.4 = 170.465 → €12,846.24
 *   delta             = 5717.19 − 12846.24 = −7129.05, i.e. the attestation ADDS €7,129.05
 *
 * The "adds" direction is not a quirk of the fixture: 2.31 tCO2e/t is a genuinely dirtier producer
 * than the marked-up Algerian cement default, and the card must say so in that direction. The
 * seeDirect figure is the one the rest of this file already uses, kept rather than tuned to
 * produce a flattering number.
 */
const DELTA_MIXED_ADDS =
  'The Commission default would give €5,717.19 — your verified data adds €7,129.05 to what the '
  + 'default would cost. Both figures are what-ifs at the assumed CSCF, so the difference between '
  + 'them is one too.';

/* ── the attestation gates itself, so no surface can price a verified figure bare ──────────── */

test('renderAttestation gates on the TIER, not on an external if — the preview shipped without one', () => {
  // The live preview (run()) renders before any line is added: it is what the page shows on load,
  // and it is all a visitor who never clicks Add ever sees. It priced a verified line — the
  // materially LOWER of the two liabilities, since verified skips the mark-up — with no statement
  // of whose claim the figure was. The gate moved inside this function so a caller CANNOT omit it.
  //
  // Asserted on the parseVerifiedFields shape, not a Line: that is precisely what the preview
  // holds, and a signature that demanded a whole Line is what forced the gate outside in the
  // first place.
  // `priced` is passed on every call here even though NEITHER tier below reads it — the two arms
  // that ignore it are pinned as ignoring it further down. It is passed because the function now
  // refuses a call that omits it (see the footgun test at the end of this block): the answer to
  // "did this line price?" has no safe default, so there is no tier on which it may be left out.
  const previewShape = { tier: 'actual-verified', verifiedRef: 'DNV-2026-0042' };
  assert.ok(renderAttestation(previewShape, true).includes(ATTESTED_NOTE),
    'a verified figure must carry its attestation on every surface that prices it, card or preview');
  assert.equal(renderAttestation({ tier: 'default+markup' }, true), '',
    'a Commission-default figure makes no attested claim, so it must say nothing');
  // Absent reference must not print a bare "Ref:" label with nothing after it.
  assert.equal(renderAttestation({ tier: 'actual-verified' }, true),
    renderAttestation({ tier: 'actual-verified', verifiedRef: '' }, true),
    'no reference and an empty reference read identically here');
  assert.doesNotMatch(renderAttestation({ tier: 'actual-verified' }, true), /Ref:/);
});

test('renderLineCard: a verified line says the figures are the user\'s own claim, unconfirmed here, and cites the reference', () => {
  const l = vline({ verifiedRef: 'DNV-2026-0042' });
  const html = renderLineCard(l, estOf(l), 0, comparisonOf(l));
  assert.ok(html.includes(`<p class="cb-sub cb-attested">${ATTESTED_NOTE} Ref: DNV-2026-0042</p>`),
    'the attestation paragraph must match the pinned text exactly — word for word, punctuation '
    + 'for punctuation — and carry the reference the importer cited');
  // The claim and its precise negation, the same shape the §4 caveats use: a paraphrase that
  // keeps "attested claim" but flips the confirmation clause would pass a keyword-only assertion.
  assert.match(html, /has not confirmed them/i, 'the card must say this tool did not confirm them');
  assert.doesNotMatch(html, /we have (confirmed|verified|checked) (them|these)/i,
    'must never claim this tool confirmed an attested figure');
  assert.doesNotMatch(html, /independently (confirmed|verified)/i);
  // Complementary to renderStamp's own row, not a duplicate of it: the row says WHICH tier
  // priced the line, the paragraph says whose claim the number is.
  assert.match(html, /Verified actual/, 'the provenance row still states the tier');
});

test('renderLineCard: a verifier reference is free text, and is escaped like every other user string', () => {
  const l = vline({ verifiedRef: 'DNV"><script>alert(1)</script>' });
  const html = renderLineCard(l, estOf(l), 0, comparisonOf(l));
  assert.doesNotMatch(html, /<script>/, 'a raw reference must never reach the DOM unescaped');
  assert.match(html, /Ref: DNV&quot;&gt;&lt;script&gt;/, 'it renders escaped, and still readable');
});

test('renderLineCard: a verified line with no reference cites none, rather than an empty "Ref:"', () => {
  const l = vline();
  const html = renderLineCard(l, estOf(l), 0, comparisonOf(l));
  assert.ok(html.includes(`<p class="cb-sub cb-attested">${ATTESTED_NOTE}</p>`),
    'with no reference the paragraph ends at the pinned sentence');
  assert.doesNotMatch(html, /Ref:/, 'no dangling label for a reference that was never given');
});

test('renderLineCard: the delta names BOTH the Commission default and the difference the data is worth', () => {
  // The spec §6 worked pair, pinned end-to-end above: €12,420.84 default vs €7,944.45 verified.
  const l = vline();
  const e = estOf(l);
  const cmp = comparisonOf(l);
  assert.equal(e.scenario.costEur, '7944.45', 'sanity: the verified figure the delta is computed from');
  assert.equal(cmp.scenario.costEur, '12420.84', 'sanity: the default figure it is compared against');
  const html = renderLineCard(l, e, 0, cmp);
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_SAVES}</p>`),
    'the delta must match the pinned text exactly — both figures named, and labelled a what-if '
    + 'because the figures it subtracts are what-ifs');
  assert.match(html, /€12,420\.84/, 'the default figure is shown, not just the difference');
  assert.match(html, /€4,476\.39/, 'and the difference itself');
});

test('renderLineCard: the delta reverses honestly when the verified figure is WORSE than the marked-up default', () => {
  // THE ARITHMETIC, computed rather than guessed. For 72061000/IN/(C) at 100 t:
  //   free allocation  = 125.58 tCO2e (a benchmark of the GOOD, identical on both paths)
  //   default path     = 2.904 tCO2e/t (published base + mark-up) x 100 t = 290.4 embedded
  //                    -> 290.4 - 125.58 = 164.82 certificates x €75.36 = €12,420.84
  // So the verified figure breaks even at exactly 2.904 tCO2e/t and is WORSE above it. 5 t/t:
  //   500 - 125.58 = 374.42 certificates x €75.36 = €28,216.29, i.e. €15,795.45 MORE.
  // A dirty producer with audited data really does owe more than the mark-up would have charged,
  // and a card that only ever said "saves" would be an advertisement.
  const l = vline({ seeDirect: '5' });
  const e = estOf(l);
  assert.equal(e.scenario.costEur, '28216.29', 'sanity: the worse verified figure');
  const html = renderLineCard(l, e, 0, comparisonOf(l));
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_ADDS}</p>`),
    'the delta must state the increase in the pinned words, not soften it');
  assert.doesNotMatch(html, /\bsaves?\b/i, 'a worse verified figure must never read as a saving');
  assert.match(html, /€15,795\.45/, 'the difference is named, in the direction it actually runs');
});

test('renderLineCard: verified figures that land exactly on the default claim no difference at all', () => {
  // 2.904 tCO2e/t is the break-even computed above — the one input where the two paths agree to
  // the cent. Rendering "saves €0.00" here would be a saving that does not exist.
  const l = vline({ seeDirect: '2.904' });
  const e = estOf(l);
  assert.equal(e.scenario.costEur, '12420.84', 'sanity: this is exactly the default-path figure');
  const html = renderLineCard(l, e, 0, comparisonOf(l));
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_IDENTICAL}</p>`),
    'an identical pair must say so in the pinned words');
  assert.doesNotMatch(html, /€0\.00/, 'a zero difference must not be printed as a figure');
  assert.doesNotMatch(html, /\bsaves?\b|\badds?\b/i, 'neither direction applies');
});

test('renderLineCard: no published default means no comparison — and the card says so instead of inventing one', () => {
  // ZZ is a real-shaped but unpublished origin: the Commission publishes no default factor for
  // it, so the default path refuses while the verified path prices normally off the benchmark.
  // Fail closed — there is genuinely nothing to compare, and saying nothing at all would leave
  // the reader assuming the comparison was simply zero.
  const l = vline({ country: 'ZZ' });
  const e = estOf(l);
  assert.equal(e.status, 'cscf_pending', 'sanity: the verified side still prices');
  const cmp = comparisonOf(l);
  assert.equal(cmp, null, 'sanity: the default side is unavailable, so there is no comparison');
  const html = renderLineCard(l, e, 0, cmp);
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_NO_DEFAULT}</p>`),
    'the missing comparison must be stated in the pinned words');
  assert.doesNotMatch(html, /\bsaves?\b/i, 'no comparison can claim a saving');
  assert.doesNotMatch(html, /\badds?\b/i, 'nor an increase');
});

test('renderLineCard: an uncomputed comparison never claims the Commission publishes no default', () => {
  // `undefined` (the 4th argument simply not threaded) and `null` (computed, and there is no
  // published default) are DIFFERENT facts. A future caller that forgets to pass the comparison
  // must not thereby publish a false claim about the Commission's own corpus.
  const l = vline();
  const html = renderLineCard(l, estOf(l), 0);
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_NOT_COMPUTED}</p>`),
    'an absent comparison says only that none was computed');
  assert.doesNotMatch(html, /publishes no default/i,
    'must not assert a gap in the Commission corpus it never looked at');
  assert.doesNotMatch(html, /\bsaves?\b|\badds?\b/i);
});

test('renderLineCard: a REFUSED verified line shows no comparison figure — NON-NEGOTIABLE 2 outranks the delta', () => {
  // The attested figure was unreadable, so the engine refused the line. The default path still
  // prices perfectly well (€12,420.84) — and printing it here would put a confident euro figure
  // on a card whose whole point is that it has none.
  const l = vline({ seeDirect: 'nonsense' });
  const e = estOf(l);
  assert.equal(e.status, 'unavailable', 'sanity: the engine refused the attested figure');
  const cmp = comparisonOf(l);
  assert.equal(cmp.scenario.costEur, '12420.84', 'sanity: the default path priced fine');
  const html = renderLineCard(l, e, 0, cmp);
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_NOT_PRICED}</p>`),
    'a refused line says there is nothing to compare, in the pinned words');
  assert.doesNotMatch(html, /€12,420\.84/,
    'a refusal must carry no euro figure at all — not even the comparison it would have had');
  assert.doesNotMatch(html, /class="cb-fig"/, 'and still no figure block');
  // The attestation still belongs: the user made a claim, and the card is refusing THAT claim.
  assert.ok(html.includes(`<p class="cb-sub cb-attested">${ATTESTED_NOTE}</p>`),
    'a refused claim is still the user\'s claim, and still unconfirmed by this tool');
});

test('renderLineCard: a default-tier line renders NO delta and NO attestation, even if a comparison is handed to it', () => {
  // The tier is the gate, not the argument. A default-tier line has nothing to attest and
  // nothing to compare itself against — it IS the Commission default.
  const l = vline({ tier: 'default+markup', seeDirect: undefined });
  const e = defaultOf(l);
  assert.equal(e.stamp.tier, 'default+markup', 'sanity: this line priced at the defaults tier');
  const html = renderLineCard(l, e, 0, e);
  assert.doesNotMatch(html, /cb-delta/, 'no delta block on a line that owes no comparison');
  assert.doesNotMatch(html, /cb-attested/, 'no attestation paragraph where nothing was attested');
  assert.doesNotMatch(html, /attested claim/i);
  assert.doesNotMatch(html, /Commission default would give/i);
  assert.match(html, /cb-res/, 'the ordinary result card is unchanged');
});

test('a verified line with no usable figure renders a refusal — it never throws at export', () => {
  // End-to-end proof of the rule above, through the two functions that would otherwise disagree:
  // the engine stamps the tier it actually priced at, and csvRows throws when that disagrees
  // with the line. Both halves are exercised here so a future edit to either side cannot quietly
  // reintroduce a thrown export in place of a rendered refusal.
  const line = {
    id: 'l1', cn: '72061000', country: 'IN', route: '(C)', scope: 'direct',
    massT: '100', date: '2026-03-15', tier: 'actual-verified', seeDirect: 'nonsense',
  };
  const e = estimateFromPack(pack, {
    cn: line.cn, country: line.country, route: line.route, massT: line.massT, date: line.date,
    emissionsScope: line.scope, verified: verifiedInputOf(line),
  });
  assert.equal(e.status, 'unavailable', 'the engine refuses the figure it cannot read');
  assert.equal(e.stamp.tier, 'actual-verified',
    'the refusal is still stamped at the tier the line claims — this is what stops the throw');
  assert.doesNotThrow(
    () => csvRows([line], [e], new Map([['l1', 'deadbeef']]), 'snap', pack),
    'a refused verified line must export as a row, not blow the whole file up',
  );
});

/* ── the mixed tier: the line records what the ENGINE computed ────────────────
 *
 * Until this point the third tier existed in the type, in tierLabel and in verifiedInputOf, and
 * NOTHING constructed a line carrying it: parseVerifiedFields emits the user's two-option
 * selection and nothing overwrote it. So the engine computed a mixed stamp, the line still said
 * 'actual-verified', and csvRows' equality guard would have thrown at export. These tests pin the
 * step that closes it — draftLine reading the tier back off the stamp — and the four rendering
 * surfaces that must move with it or ship a document that under-states its own provenance.
 */

test('the mechanism: a drafted line takes the tier the ENGINE stamped, not the one the form selected', () => {
  // WHY THE READ-BACK, rather than deriving the tier where the line is built. Whether a line is
  // mixed depends on the emissions scope, on whether the Commission publishes an indirect default
  // for that exact good/origin/route/year, and on the importer leaving the field blank —
  // parseVerifiedFields holds no pack and cannot know any of it (see its own doc). Two copies of
  // that rule would drift, and the drift surfaces as a thrown export, not a wrong pixel.
  const selected = mline({ tier: 'actual-verified', verifiedRef: 'BV-2026-0142' });
  const priced = estOf(selected);
  assert.equal(priced.stamp.tier, 'verified-direct+default-indirect',
    'sanity: the engine stands the Commission default in for the electricity half nobody attested');

  const drafted = { ...selected, tier: stampedTierOf(selected, estOf) };
  assert.equal(drafted.tier, 'verified-direct+default-indirect',
    'the line must carry the tier its own estimate was actually computed at');

  // THE ROUND TRIP, and it is not decoration: `lines` outlives the form, so every later
  // re-estimate reads the LINE (estimateLine's doc). verifiedInputOf keys on the tier and returns
  // the same object for both verified-bearing tiers, so the second pricing must stamp the same
  // value — otherwise the guard throws one render after the line was added, not at draft time.
  const repriced = estOf(drafted);
  assert.equal(repriced.stamp.tier, drafted.tier,
    're-pricing the drafted line must stamp the same tier, or the guard fires a render later');

  // The whole point of the equality: the export survives.
  const rows = csvRows([drafted], [repriced], new Map([['M1', 'deadbeef']]), 'snap', pack);
  assert.equal(rows[0].data_tier, 'verified-direct+default-indirect',
    'the CSV carries the compound value VERBATIM — it is the column that tells an auditor which '
    + 'half of this figure came from where');
  assert.equal(rows[0].verified_reference, 'BV-2026-0142',
    'and the reference travels with it: it certifies the direct half, which is a real half');
});

test('stampedTierOf leaves the claimed tier alone when the estimate THROWS', () => {
  // A thrown estimate is not a verdict about the tier. safeEstimates renders that line's fallback
  // card with no figures at all, and buildPrintDocument still prints its row off the LINE — so the
  // only honest tier for a line nothing could price is the one the user claimed. It also must not
  // take the Add down: draftLine runs inside onAdd's try/finally, whose only job is re-enabling
  // the button, so an escaping throw would leave the click silently doing nothing.
  const selected = mline({ tier: 'actual-verified' });
  assert.equal(
    stampedTierOf(selected, () => { throw new Error('engine exploded'); }),
    'actual-verified',
    'a thrown pricer must fall back to the claimed tier rather than crashing the add');
  // And a refusal is NOT a throw: it comes back as a real estimate carrying a real stamp, so the
  // tier is read off it like any other. THIS refusal is 'actual-verified', and the reason is
  // narrow: an unreadable direct figure is refused inside estimateFromPack's own code, before the
  // electricity fallback can run, so nothing ever stood in for anything on this line.
  //
  // THAT REASONING DOES NOT GENERALISE, and this file used to claim here that it did — that the
  // engine stamps EVERY verified-path refusal 'actual-verified'. It does not, and the test
  // directly below pins the path this one cannot see: a refusal raised AFTER the fallback fired.
  const refused = mline({ tier: 'actual-verified', seeDirect: 'nonsense' });
  const e = estOf(refused);
  assert.equal(e.status, 'unavailable', 'sanity: the engine refused the attested figure');
  assert.equal(e.selector, 'verified/25231000/directTco2ePerT',
    'sanity: refused on the FIGURE, which is a site inside estimateFromPack itself — the tier '
    + 'below is a fact about that site, not about refusals in general');
  assert.equal(stampedTierOf(refused, estOf), 'actual-verified',
    'a refused estimate still carries a stamp, and its tier is the one to read');
});

test('a verified-path refusal carries the tier the engine ATTEMPTED to price at — often the MIXED one', () => {
  // THE PATH THE TEST ABOVE CANNOT SEE. Its refusal is raised in estimateFromPack's own code
  // before the electricity fallback runs, so 'actual-verified' is right for it. A refusal raised
  // AFTER the fallback fired is a different fact: the Commission's marked-up electricity default
  // really was looked up and applied, and it is a LATER lookup that failed. The tier records what
  // the engine attempted to price the line at, so it stays mixed — the substitution did happen.
  //
  // Swept over every (good, origin, route, year) the form can offer — 66,675 selectors, one date
  // per year — 5,542 verified-path refusals come back mixed. The old comment claimed none did.

  // A. THE CERTIFICATE PRICE. The pack prices 2026 quarters only and <input type="date"> takes
  //    2027, so this is the refusal an ordinary user meets first.
  assert.equal(estOf(mline()).status, 'cscf_pending',
    'sanity: the same line prices at a 2026 date, so the date is the only thing that moved');
  const noPrice = mline({ date: '2027-03-15' });
  const ePrice = estOf(noPrice);
  assert.equal(ePrice.status, 'unavailable', 'sanity: no published price for a 2027 quarter');
  assert.equal(ePrice.selector, 'certificate-price/2027-Q1',
    'and the PRICE is what is missing — the good, its default and its benchmark all resolved, '
    + 'which is exactly why the electricity substitution had already happened');
  assert.equal(stampedTierOf(noPrice, estOf), 'verified-direct+default-indirect',
    'the line must record the tier it was priced AT, not a tier that describes the refusal');

  // B. THE BENCHMARK, AT AN ORDINARY 2026 DATE — so this is not a 2027-only curiosity, and a
  //    reader must not learn "mixed refusal ⇒ missing price". KR is the only origin publishing
  //    grey clinker route-independently; the Commission publishes a route-independent electricity
  //    default for it (the fallback fires) but the Annex publishes column-B cement benchmarks
  //    for routes (A) and (B) only (the benchmark lookup then finds nothing).
  const kr = krline();
  assert.ok(routesFor(pack, kr.cn, kr.country, 2026).includes('default'),
    'sanity: the form really offers this pairing — syncRoutes renders it as "single route"');
  const eBench = estOf(kr);
  assert.equal(eBench.status, 'unavailable', 'sanity: the engine refuses this line');
  assert.equal(eBench.selector, 'benchmark/25231000/column-B/route-independent/2026-03-15',
    'and it refuses on the BENCHMARK, in 2026, with the price table fully populated');
  assert.equal(stampedTierOf(kr, estOf), 'verified-direct+default-indirect',
    'a second refusal namespace reaches the mixed tier, so the split is about WHERE the refusal '
    + 'is raised — not about which table the selector names');

  // C. THE CONTROL THAT ISOLATES THE MECHANISM. Same good, same origin, same route, same date,
  //    same selector as A — only the fallback does not run, because this line's scope never asks
  //    for electricity. If the namespace decided the tier, this would come back mixed too.
  const directOnly = mline({ date: '2027-03-15', scope: 'direct' });
  const eDirect = estOf(directOnly);
  assert.equal(eDirect.selector, ePrice.selector,
    'sanity: byte-identical refusal to A — the only difference is whether electricity was priced');
  assert.equal(stampedTierOf(directOnly, estOf), 'actual-verified',
    'no substitution, no mixed tier: the tier tracks the fallback, never the refusal');

  // D. AND THE EXPORT STILL SURVIVES. csvRows throws when a line's tier disagrees with its
  //    estimate's stamp, which is the failure a wrong tier here would cause — one bad line
  //    killing the whole file, one render after the line was added.
  const drafted = { ...noPrice, tier: stampedTierOf(noPrice, estOf) };
  assert.doesNotThrow(
    () => csvRows([drafted], [estOf(drafted)], new Map([['M1', 'deadbeef']]), 'snap', pack),
    'a refused MIXED line must export as a row, not blow the whole file up');
});

test('renderAttestation on a MIXED line names both halves — attested direct, Commission electricity', () => {
  // PRICED, explicitly: this paragraph is a claim about an electricity component that exists, so
  // it belongs to the arm where a figure was produced. The refused arm is a different paragraph,
  // pinned by its own test below.
  const withRef = renderAttestation({
    tier: 'verified-direct+default-indirect', verifiedRef: 'BV-2026-0142',
  }, true);
  assert.ok(withRef.includes(`<p class="cb-sub cb-attested">${MIXED_NOTE} Ref: BV-2026-0142</p>`),
    'the mixed attestation must match the pinned text exactly — word for word, punctuation for '
    + 'punctuation — and still transcribe the reference the importer cited');
  // NOT the whole-line note. This is the assertion that would have caught "just widen the gate":
  // ATTESTED_NOTE beside a figure half-priced from the Commission's marked-up corpus claims
  // provenance for a number the importer never saw.
  assert.ok(!withRef.includes(ATTESTED_NOTE),
    'the fully-verified paragraph must not print on a half-attested line');
  assert.doesNotMatch(withRef, /These emissions figures are your own attested claim/,
    'and not in any form: "these figures" is a claim about the whole line');
  // The claim and its precise negation, the shape every other honesty pin in this file uses.
  assert.match(withRef, /carries the mark-up/,
    'the electricity half must be stated as carrying the mark-up, since it does');
  assert.match(withRef, /has not confirmed it/, 'the attested half is still unchecked, and says so');
  assert.doesNotMatch(withRef, /(we|this tool) (have|has) (confirmed|verified|checked)/i);
  assert.doesNotMatch(withRef, /independently (confirmed|verified)/i);
  // Absent reference must not leave a dangling label, exactly as on the fully-verified arm.
  assert.equal(renderAttestation({ tier: 'verified-direct+default-indirect' }, true),
    renderAttestation({ tier: 'verified-direct+default-indirect', verifiedRef: '' }, true));
  assert.doesNotMatch(renderAttestation({ tier: 'verified-direct+default-indirect' }, true), /Ref:/);
  // THE THIRD ARM MUST NOT HAVE SWALLOWED THE SECOND. A three-way decision written as
  // `if (tier === 'default+markup') ... else mixed` would print the mixed paragraph on a fully
  // verified line, and one written as `if (tier !== 'actual-verified') return MIXED` would print
  // it on a Commission-default line that attests nothing at all.
  assert.equal(renderAttestation({ tier: 'default+markup' }, true), '',
    'a Commission-default figure makes no attested claim, so it must still say nothing');
  assert.equal(renderAttestation({ tier: 'default+markup', verifiedRef: 'BV-2026-0142' }, true), '',
    'not even with a stray reference on it');
  assert.ok(renderAttestation({ tier: 'actual-verified' }, true).includes(ATTESTED_NOTE),
    'and a fully verified line keeps the paragraph that is true of IT');
});

test('renderLineCard: a MIXED line gets its attestation AND its delta, and the delta isolates the direct half', () => {
  const l = mline({ verifiedRef: 'BV-2026-0142' });
  const mine = estOf(l);
  const theirs = comparisonOf(l);
  // THE CANCELLATION, MEASURED — the claim the defaultPathComparison decision rests on. Both
  // sides reach the same indirect lookup with the same mark-up over the same mass (the lookup
  // reads cn/country/route/date and never `verified`), so the electricity term is byte-identical
  // on both and subtracts out. What is left is exactly what the DIRECT attestation was worth,
  // which is the only thing the sentence claims to measure.
  assert.equal(mine.scenario.indirectTco2e, '4.4',
    'sanity: the Commission default stood in for electricity — 0.04 × 1.10 × 100 t');
  assert.equal(theirs.scenario.indirectTco2e, mine.scenario.indirectTco2e,
    'the indirect component must be IDENTICAL on both sides, or the delta is not a like-for-like '
    + 'subtraction and the sentence beside it is measuring two different things');
  assert.equal(mine.scenario.faaTco2e, theirs.scenario.faaTco2e,
    'and so must the free allocation — it is a benchmark of the GOOD, not of the data tier');

  const html = renderLineCard(l, mine, 0, theirs);
  assert.ok(html.includes(`<p class="cb-sub cb-attested">${MIXED_NOTE} Ref: BV-2026-0142</p>`),
    'the card carries the mixed attestation, not the fully-verified one');
  assert.match(html, /cb-delta/,
    'a mixed line HAS attested data, so it earns the comparison that data is worth');
  assert.ok(html.includes(`<p class="cb-sub">${DELTA_MIXED_ADDS}</p>`),
    'the delta must match the pinned text exactly — see the constant for the arithmetic');
  assert.match(html, /Verified direct \+ Commission indirect/,
    'and the provenance row states the compound tier, so the card names both corpora');
});

/* ── the attestation is picked by (tier, priced), because one of the two notes is about the
 *    OUTPUT ────────────────────────────────────────────────────────────────────────────────
 *
 * Measured at 5,542 selectors: a verified line whose refusal is raised INSIDE
 * estimateCertificates keeps the mixed tier, because the tier is decided before that call (see
 * the tier test above, which pins the mechanism). The card that results shows no figure at all
 * and used to print MIXED_NOTE over it — a sentence asserting that its electricity component is
 * the Commission's published default and carries the mark-up, on a card with no electricity
 * component to point at. The tier alone cannot tell those two cards apart, which is why the
 * function now takes a second fact.
 */

test('renderAttestation: a REFUSED mixed line drops the electricity clause — the card has no such component', () => {
  const l = krline({ verifiedRef: 'BV-2026-0142' });
  const e = estOf(l);
  // Sanity, and it is the whole premise: an ordinary 2026 date, a refusal raised after the
  // substitution, and therefore the MIXED tier on a card carrying no figure whatsoever.
  assert.equal(e.status, 'unavailable', 'sanity: the engine refuses this line');
  assert.equal(e.selector, 'benchmark/25231000/column-B/route-independent/2026-03-15',
    'sanity: refused on the benchmark, in 2026, with the price table fully populated');
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect',
    'sanity: the refusal still carries the mixed tier — that is the defect this test is about');

  const html = renderLineCard(l, e, 0, comparisonOf(l));
  assert.doesNotMatch(html, /class="cb-fig"/, 'sanity: no figure block, so nothing to substitute into');

  assert.ok(html.includes(`<p class="cb-sub cb-attested">${REFUSED_MIXED_NOTE} Ref: BV-2026-0142</p>`),
    'the refused mixed attestation must match the pinned text exactly — word for word, '
    + 'punctuation for punctuation — and still transcribe the reference the importer cited');

  // THE CLAUSE THAT MUST NOT SURVIVE. Not a keyword check on the whole note: the exact sentences
  // that assert a substitution nothing on this card shows.
  assert.ok(!html.includes(MIXED_NOTE),
    'the priced mixed paragraph asserts an electricity component this card does not have');
  assert.doesNotMatch(html, /carries the mark-up/,
    'a card with no figure must not tell an importer a mark-up was charged on one');
  assert.doesNotMatch(html, /The electricity component is not attested at all/,
    'nor describe a component that is not on it');
  assert.doesNotMatch(html, /Commission's published\s+default value/,
    'and must not attribute a value to the Commission that this card never printed');

  // AND IT MUST NOT VANISH. Silence over an attested claim is the state renderAttestation exists
  // to prevent; a refusal does not un-make the claim (the same rule the refused fully-verified
  // card is pinned on).
  assert.match(html, /class="cb-sub cb-attested"/, 'the attestation paragraph still renders');
  assert.match(html, /your own attested claim/, 'and still says whose claim the figure was');
  assert.ok(!html.includes(ATTESTED_NOTE),
    'but not the WHOLE-line claim: the importer attested the direct figure and nothing else');

  // The unit boundary, both ways round, so the decision is pinned as (tier, priced) rather than
  // as something a caller happened to hand in.
  const shape = { tier: 'verified-direct+default-indirect', verifiedRef: 'BV-2026-0142' };
  assert.ok(renderAttestation(shape, false).includes(REFUSED_MIXED_NOTE),
    'unpriced mixed → the refused paragraph');
  assert.ok(renderAttestation(shape, true).includes(MIXED_NOTE),
    'priced mixed → the full paragraph');

  /*
   * THE HALF-FIX GUARD, and why it is a source-text assertion.
   *
   * renderAttestation has TWO callers: renderLineCard, which this suite renders directly, and
   * run()'s live preview — a closure inside initCbam(), reachable only through
   * document.getElementById, and this suite has no DOM (no jsdom in devDependencies). The preview
   * is not a lesser surface: it is what the page shows before anyone clicks Add, so a visitor who
   * never adds a line sees ONLY it, and it is the exact surface that shipped without an
   * attestation when the verified tier landed, and again without the mixed paragraph when the
   * mixed tier did. A fix applied to the card alone would leave it printing the mark-up sentence
   * over a refusal, and every behavioural assertion above would stay green.
   *
   * So the pin is the one the file already uses for a site no test can reach (see
   * defaultPathComparison's, below): both call sites must pass the SAME spelling of the question,
   * and there must be no third caller that answers it some other way.
   */
  const src = readFileSync(fileURLToPath(
    new URL('../../src/scripts/cbam-algos/cbam-app.ts', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  // One definition plus exactly two calls. A third caller raises this and must be read, not
  // silenced — it is a new surface that has to answer the priced question too.
  assert.equal((code.match(/renderAttestation\(/g) ?? []).length, 3,
    'renderAttestation has one definition and two call sites — the line card and the live '
    + 'preview. Found a different number, so a surface was added or removed.');
  // ...and BOTH calls pass the estimate's own answer, not a literal and not a second spelling.
  // `[^()]*` cannot cross the definition's own `): string {`, so the definition never matches.
  assert.equal((code.match(/renderAttestation\([^()]*hasFigure\(e\)\)/g) ?? []).length, 2,
    'both call sites must pass hasFigure(e) — the card AND the live preview. One of two is the '
    + 'half-fix that leaves the preview asserting a mark-up over a refusal, which is precisely '
    + 'how the preview was missed the last two times this function changed.');
  assert.equal((code.match(/\bhasFigure\(/g) ?? []).length, 2,
    'and nowhere else spells the question — one predicate, two callers');
});

test('renderAttestation: a PRICED mixed line still says both halves, mark-up included', () => {
  // The guard against overshooting: the substitution really did happen here, the electricity
  // component really is on the card, and withholding that sentence would leave a marked-up
  // Commission figure looking as attested as the direct one.
  const l = mline({ verifiedRef: 'BV-2026-0142' });
  const e = estOf(l);
  assert.equal(e.status, 'cscf_pending', 'sanity: this line prices');
  assert.equal(e.scenario.indirectTco2e, '4.4',
    'sanity: the Commission default really did stand in for electricity — 0.04 × 1.10 × 100 t');

  const html = renderLineCard(l, e, 0, comparisonOf(l));
  assert.ok(html.includes(`<p class="cb-sub cb-attested">${MIXED_NOTE} Ref: BV-2026-0142</p>`),
    'a priced mixed line keeps the full paragraph, word for word');
  assert.ok(!html.includes(REFUSED_MIXED_NOTE),
    'and not the refused wording, which would drop the one disclosure this card owes');
  assert.match(html, /carries the mark-up/, 'the mark-up on the electricity half is disclosed');
});

test('renderAttestation: a REFUSED fully-verified line keeps ATTESTED_NOTE unchanged', () => {
  // EXISTING WANTED BEHAVIOUR, pinned again from the other side now that a second fact reaches
  // this function: `priced` must not leak into the 'actual-verified' arm. ATTESTED_NOTE is a claim
  // about the INPUT — the figures the importer typed, which they typed whether or not the engine
  // could price them — so a refusal changes nothing about its truth.
  const l = vline({ seeDirect: 'nonsense' });
  const e = estOf(l);
  assert.equal(e.status, 'unavailable', 'sanity: the engine refused the attested figure');
  assert.ok(renderLineCard(l, e, 0, comparisonOf(l))
    .includes(`<p class="cb-sub cb-attested">${ATTESTED_NOTE}</p>`),
    'a refused claim is still the user\'s claim, in the same words as a priced one');
  // Both arms of the new boolean, on the tier that must ignore it.
  assert.equal(renderAttestation({ tier: 'actual-verified' }, false),
    renderAttestation({ tier: 'actual-verified' }, true),
    'priced or refused, a fully attested line says the same thing');
  assert.ok(!renderAttestation({ tier: 'actual-verified' }, false).includes(REFUSED_MIXED_NOTE),
    'and never the mixed refusal wording, which would deny provenance the importer does have');
});

test('renderAttestation: a default-tier line still says nothing, priced or refused', () => {
  // Nothing was attested, so there is no claim to disclose in either state — and no reference
  // that could belong beside one.
  for (const priced of [true, false]) {
    assert.equal(renderAttestation({ tier: 'default+markup' }, priced), '',
      `a Commission-default figure makes no attested claim (priced=${priced})`);
    assert.equal(renderAttestation({ tier: 'default+markup', verifiedRef: 'BV-2026-0142' }, priced), '',
      `not even with a stray reference on it (priced=${priced})`);
  }
});

test('renderAttestation: a call that cannot answer "priced?" must not answer it by default', () => {
  /*
   * THE FOOTGUN, AND WHY IT IS PINNED HERE RATHER THAN AT THE CALL SITES.
   *
   * `priced` is required in TypeScript, but this function is EXPORTED, so a JavaScript caller —
   * this file is one — reaches it with no compiler in the way. Called with one argument, `priced`
   * is `undefined`, which is falsy, which selects REFUSED_MIXED_NOTE: "No figure was produced for
   * this line". On a mixed line that DID price, that sentence is simply false, and false in the
   * UNDER-claiming direction — the tool disclaiming a figure it actually produced, which nobody
   * reports because it reads as caution rather than as a bug.
   *
   * Both real call sites are pinned by SOURCE TEXT (see the half-fix guard above), because one of
   * them — run()'s live preview — is a closure inside initCbam() reachable only through
   * document.getElementById, and this suite has no DOM. A source pin cannot see this defect at
   * all: both call sites are spelled correctly today and the footgun is still there, in the
   * function, waiting for a third caller or a hand-edit that drops an argument.
   *
   * So this asserts the PROPERTY, not the mechanism: whatever happens on a one-argument call, it
   * must not be the quiet production of the refused wording. Refusing loudly satisfies it; so
   * would a signature that takes the estimate and computes the answer itself. Both call sites are
   * covered by it, the DOM-locked one included, because the guarantee lives in the function
   * rather than in what any caller happens to pass.
   */
  const attempt = (...args) => {
    try { return { html: renderAttestation(...args) }; } catch (err) { return { err }; }
  };
  const shape = { tier: 'verified-direct+default-indirect', verifiedRef: 'BV-2026-0142' };

  const oneArg = attempt(shape);
  assert.ok(oneArg.err || !oneArg.html.includes(REFUSED_MIXED_NOTE),
    'a caller that never said whether the line priced must not be answered "it did not" — that '
    + 'renders "No figure was produced for this line" over a line that produced one');

  // The same defect one step along: a stale or hand-written caller passing something that is not
  // the answer at all. Truthy junk took the PRICED arm, asserting a mark-up on an electricity
  // component a refused card does not show — the over-claiming half of the same hole.
  for (const junk of ['yes', 1, {}, null]) {
    const r = attempt(shape, junk);
    assert.ok(r.err, `renderAttestation must refuse a non-boolean \`priced\` (${JSON.stringify(junk)}), `
      + 'rather than coerce it into one of the two wordings');
  }

  // If it refuses, it must say what to pass — a bare TypeError leaves the next caller guessing at
  // a contract this function is the only place that states.
  assert.match(String(oneArg.err), /renderAttestation/, 'the refusal names itself');
  assert.match(String(oneArg.err), /hasFigure/, 'and names the answer the caller was meant to hand it');

  // ...and the real, two-argument contract is untouched by the guard.
  assert.ok(renderAttestation(shape, true).includes(MIXED_NOTE), 'priced mixed → the full paragraph');
  assert.ok(renderAttestation(shape, false).includes(REFUSED_MIXED_NOTE),
    'unpriced mixed → the refused paragraph');
});

test('the residual-indirect note reaches the card, and only where the fallback was residual', () => {
  // The engine gained this note two commits ago and nothing in either suite asserted on a notes
  // array, so its only user-visible path — stamp.notes, which renderStamp emits verbatim — was
  // unpinned. It is pinned here because this task changes the paragraph directly above it.
  const l = rline();
  const e = estOf(l);
  assert.equal(e.status, 'cscf_pending', 'sanity: a PRICED mixed line — the note is about a figure');
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect', 'sanity: and it is mixed');
  assert.ok(e.stamp.notes.includes(RESIDUAL_INDIRECT_NOTE),
    'the engine states, in the pinned words, that the substituted electricity default is the '
    + 'world-average bucket rather than the origin\'s own');

  // ESCAPED, because renderStamp escapes every note — the apostrophes and quotes in this
  // sentence are exactly the characters that would prove it reached the DOM raw.
  const html = renderLineCard(l, e, 0, comparisonOf(l));
  const escaped = RESIDUAL_INDIRECT_NOTE
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.match(html, /<ul class="cb-notes">/, 'the notes list renders on the card');
  assert.ok(html.includes(`<li>${escaped}</li>`),
    'and carries the residual-indirect note as its own item, escaped');

  // NO BLEED, in both directions. A listed origin's substitution is the origin's own published
  // value, so this note must stay silent...
  const listed = mline();
  const listedHtml = renderLineCard(listed, estOf(listed), 0, comparisonOf(listed));
  assert.ok(!estOf(listed).stamp.notes.includes(RESIDUAL_INDIRECT_NOTE),
    'DZ is listed for cement, so nothing residual was substituted and the note must not fire');
  assert.ok(!listedHtml.includes(escaped), 'nor reach the card');
  // ...and the DEFAULTS-path note must never appear on a mixed line, which is the failure this
  // note exists to avoid: it says "this figure" rests on a world average, and on a mixed line the
  // direct figure is the importer's own audited number.
  assert.doesNotMatch(html, /this figure uses its/,
    'RESIDUAL_BASIS_NOTE must not fire on a mixed line — it would call an audited figure a '
    + 'world average');
  assert.match(html, /Origin basis<\/span><b>—<\/b>/,
    'and the stamp row stays neutral, because the verified path rests on no default basis');
});

test('a REFUSED mixed line drops the residual-indirect note — no figure, no provenance claim', () => {
  // The half of the previous commit that it named as still open. renderAttestation stopped
  // asserting a mark-up on a refused mixed card; one line lower, the engine's own note went on
  // saying where the substituted electricity default came from, over a card with no figure at
  // all. FJ cement at a 2027 date rendered it as the SOLE <li>.
  //
  // Fixed in the ENGINE, not here: renderStamp emits stamp.notes verbatim (non-negotiable #5 in
  // cbam-app.ts's header), so filtering at this sink would break that contract and leave the
  // vendored engine's own output still making the claim. This test therefore pins the vendored
  // engine's behaviour as it reaches the DOM — the surface a user meets.
  const refused = rline({ date: '2027-03-15' });
  const e = estOf(refused);

  // Three guards against a vacuous pass, each of which would make "no note" true for the wrong
  // reason. Without them a corpus that started pricing 2027, or a tier that stopped surviving the
  // refusal, would turn this green while the defect was untouched.
  assert.equal(e.status, 'unavailable', 'the fixture must actually refuse');
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect',
    'and must still be MIXED — the refusal is raised after the substitution, which is exactly '
    + 'why the note survived it');
  assert.equal(estOf(rline()).status, 'cscf_pending',
    'and the SAME line at a priced date must still price, or the pair below proves nothing');

  assert.ok(!e.stamp.notes.includes(RESIDUAL_INDIRECT_NOTE),
    'the engine must not claim the provenance of an electricity figure this card does not show');
  const html = renderLineCard(refused, e, 0, comparisonOf(refused));
  const escaped = RESIDUAL_INDIRECT_NOTE
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.ok(!html.includes(escaped), 'nor may it reach the card');
  // Not merely reworded into a survivor: nothing on this card may call anything a world average,
  // since there is no figure for such a claim to attach to. Catches both residual sentences.
  assert.doesNotMatch(html, /world-average/,
    'no note on a card showing no figure may describe that figure as a world average');

  // The card is genuinely a refusal — no waterfall, no certificates row — which is the whole
  // premise. If a figure appeared here the note would be owed, not suppressed.
  assert.match(html, /cb-tag unavail">No estimate/, 'sanity: the card really shows no estimate');
  assert.doesNotMatch(html, /cb-water/, 'and carries no waterfall for a note to be about');

  // THE OTHER ARM, in the same test so the pair cannot drift apart: suppressing everywhere would
  // delete a disclosure the priced card owes, and every assertion above would still pass.
  const p = rline();
  const pricedHtml = renderLineCard(p, estOf(p), 0, comparisonOf(p));
  assert.ok(pricedHtml.includes(`<li>${escaped}</li>`),
    'the PRICED line still discloses that its substituted electricity default is the residual '
    + 'bucket — the suppression is about the missing figure, not about the disclosure');
});

/**
 * THE ONE PIN defaultPathComparison CAN HAVE, and the reason it is a source-text assertion rather
 * than a behavioural one.
 *
 * "Does this line carry a figure the importer attested?" is asked at FIVE places in cbam-app.ts.
 * Four are reachable from this suite through an exported function, and each is pinned by a named
 * test above — measured, not assumed: narrowing one site alone to 'actual-verified' kills exactly
 * one of them (renderLineCard → the MIXED delta test; tierCell → §1's reference; §4's caveat →
 * the mixed-only document; verifiedInputOf → the MIXED round trip, plus four downstream).
 *
 * The fifth, defaultPathComparison, is reachable from NEITHER suite. It is a closure inside
 * initCbam(), gettable only through document.getElementById, and these tests have no DOM (no
 * jsdom in devDependencies — the same reason two e2e tests exist for closures in this file).
 * The e2e suite does assert a delta, but on 72061000/IN, iron & steel, for which the Commission
 * publishes no indirect default at all — so that line can never reach the mixed tier, and
 * narrowing defaultPathComparison leaves e2e green too. Measured: that narrowing kills ZERO of
 * the 410 tests, and moves ZERO bytes of rendered output.
 *
 * So the fifth site's only guarantee is that it SHARES the predicate. That is what this test
 * pins, and it is not bookkeeping: the inventory of sites needing the pair has been wrong four
 * times — two, then six, then seven (run()'s preview), then four when this predicate was
 * extracted and defaultPathComparison was missed. Re-spelling a site inline drops the call count
 * and fails here; hand-writing the pair at a NEW site raises the comparison count and fails here.
 *
 * WHEN YOU LEGITIMATELY ADD OR REMOVE A CALL SITE, change the number — and read the list while
 * you are here. That five-second stop is the review moment absent every time this went wrong.
 */
test('the attestation question has ONE spelling and five call sites — the only pin defaultPathComparison can have', () => {
  const src = readFileSync(fileURLToPath(
    new URL('../../src/scripts/cbam-algos/cbam-app.ts', import.meta.url)), 'utf8');
  // Comments are prose ABOUT the predicate — several docblocks quote the tiers deliberately, and
  // must stay free to. Only executable lines are counted.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  const spellings = code.match(/[!=]==\s*'verified-direct\+default-indirect'/g) ?? [];
  assert.equal(spellings.length, 1,
    'the mixed tier must be COMPARED against in exactly one place — isAttested. A second '
    + 'comparison means the pair has been hand-written somewhere again, which is the bug that '
    + 'has recurred at every tier change. Found: ' + JSON.stringify(spellings));

  const calls = code.match(/\bisAttested\(/g) ?? [];
  assert.equal(calls.length, 5,
    'isAttested must be called at all five sites — renderLineCard\'s delta gate, tierCell\'s '
    + 'verifier reference, buildPrintDocument\'s §4 caveat, verifiedInputOf\'s engine hand-off '
    + 'and defaultPathComparison. Four of five would be worse than none: two spellings, neither '
    + 'authoritative, and the one that drops out may well be the site no test can reach.');

  // The switch it must NOT be folded into. renderAttestation answers the same question with a
  // `never` default — a COMPILE-TIME guarantee that a fourth tier gets handled, and the site that
  // already caught exactly that bug by construction. A boolean there would be a downgrade.
  assert.match(code, /const _exhaustive: never = line\.tier;/,
    'renderAttestation must keep its exhaustive switch — see isAttested\'s docblock for why it '
    + 'is deliberately excluded from the predicate');
});

/* ── the printable document's verified surfaces (Task 7) ─────────────────────
 *
 * The document is the artefact an importer hands to an auditor, so the two things a verified
 * line changes about it are both honesty surfaces, not decoration:
 *
 *   §1 must SAY which rows were priced from attested figures — otherwise a mark-up-skipping row
 *      sits in the same table as the Commission-priced ones with nothing distinguishing it, and
 *      the reference the importer cited never appears in the document at all.
 *   §4 must carry the matching caveat — CONDITIONALLY, because a document with no verified line
 *      making a claim about attested data would be describing a document other than itself.
 *
 * Both states of §4 are pinned. The absence case is not hypothetical bookkeeping: every
 * buildPrintDocument test above this section passes lines with no `tier` field at all (they
 * predate the field), and those must keep reading as default-tier — asserted directly below.
 */

/** A plain Commission-defaults line, tier stated. */
const dline = (over = {}) => ({
  id: 'D1', cn: '25231000', country: 'DZ', route: '(A)', scope: 'direct_and_indirect',
  massT: '100', date: '2026-03-15', tier: 'default+markup', ...over,
});
/** The document, built over whatever lines/results a test hands it. */
const docOf = (lines, results) => buildPrintDocument({
  lines, results,
  yearCards: [], totals: sumTotals(results.filter((r) => !('failed' in r))),
  packSnapshot: 'f'.repeat(64), rulePackages: ['eu-cbam-2026-defaults-v2@v1'],
  pack, generatedOn: '2026-08-08',
});
/** How many cells each <tr> carries — the table's rectangularity, measured rather than assumed. */
const rowWidths = (html) => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map((m) => (m[1].match(/<t[dh]\b/g) ?? []).length);

test('the document gains a fifth §4 caveat when a line was priced from attested figures', () => {
  const v = vline({ verifiedRef: 'DNV-2026-0042' });
  const html = docOf([v], [estOf(v)]);
  assert.ok(html.includes(CAVEAT_VERIFIED),
    'the verified caveat must match the pinned text exactly — word for word, punctuation for '
    + 'punctuation (see the constants block at the top of this file for why)');
  // The four it joins must survive untouched and in order — a fifth caveat that displaced or
  // reworded one of them would be a net loss of honesty dressed as an addition.
  const order = [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT,
    CAVEAT_VERIFIED].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), 'all five caveats must be present, each exactly as pinned');
  assert.deepEqual(order, [...order].sort((a, b) => a - b),
    'the four original caveats keep their order, and the new one joins at the end');
  // The claim and its negation, the shape every other caveat assertion uses: a paraphrase that
  // kept "attested" and appended a reassurance would pass a keyword-only test.
  assert.match(html, /has not seen and cannot confirm/i, 'the gap must be stated as a gap');
  assert.doesNotMatch(html, /(we|this tool) (have|has) (confirmed|verified|checked)/i,
    'the document must never claim it confirmed an attested figure');
  assert.doesNotMatch(html, /independently (verified|confirmed)/i);
  assert.doesNotMatch(html, /reference .{0,30}(has been|was) checked/i,
    'the reference is transcribed, never checked');
});

test('the document carries NO verified caveat when no line claims the verified tier', () => {
  // Two shapes of "not verified" in one document: a line that states the defaults tier, and a
  // line with no `tier` field at all — the shape every buildPrintDocument test written before
  // this feature uses. Both must read as default-tier, or those tests are silently asserting
  // against a document that has grown a caveat about data it does not contain.
  const legacy = { id: 'L0', cn: '25231000', country: 'DZ', route: '(A)',
    scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' };
  const d = dline();
  const results = [run('25231000', 'DZ', '(A)', '100'), run('25231000', 'DZ', '(A)', '100')];
  const html = docOf([legacy, d], results);
  assert.ok(!html.includes(CAVEAT_VERIFIED),
    'the verified caveat must be absent from a document with no verified line');
  assert.doesNotMatch(html, /attested/i,
    'nothing in a defaults-only document may speak of attested figures');
  assert.doesNotMatch(html, /Verified actual/,
    'and no row may be marked as priced from verified data');
  // The four unconditional ones are unaffected by the gate — present, AND IN ORDER. The order
  // assertion lived only in the verified-present test above, which meant a reorder that landed in
  // a defaults-only document (the overwhelmingly common one) had nothing asserting against it:
  // swapping, say, the Art 9 and completeness caveats here left every test green. Both branches of
  // the gate now pin the sequence, not just the membership.
  const order = [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT]
    .map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), 'the four unconditional caveats print regardless of tier');
  assert.deepEqual(order, [...order].sort((a, b) => a - b),
    'and they keep their order in a defaults-only document too');
});

/**
 * §4's list, cut out of the rendered document by ITS OWN boundaries: the heading that opens the
 * section, that section's `<ul>`, and that block's `</ul>`.
 *
 * THE BOUNDARIES WERE MEASURED off a rendered document, not assumed. It contains exactly three
 * `<ul>` blocks — §2's verdicts, §3's authorities, §4's caveats — no nested list anywhere, and
 * §4's `</ul>` is the last thing buildPrintDocument returns. So the first `</ul>` after §4's
 * `<ul>` is its matching close. Anchoring on the §4 HEADING rather than on "the document's last
 * `</ul>`" is what keeps that reading correct if a §5 is ever added below it.
 *
 * Nothing user-entered reaches §4 — it is static prose plus the `anyVerified` gate — and `esc`
 * turns `<`/`>` into entities everywhere a value IS interpolated, so no entered value can forge
 * a `</ul>` and move where this block appears to end.
 *
 * THE ONE THING THIS CANNOT SEE is a nested list: `[\s\S]*?` would stop at an inner `</ul>` and
 * report a truncated §4. That is not airtight so much as loudly fenced — the assertion below
 * refuses a nested list outright, so the day §4 grows one the failure says so instead of
 * pretending a caveat went missing.
 */
const caveatItems = (html) => {
  const block = html.match(/<h2>4 · What this does not tell you<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
  assert.ok(block,
    '§4 must render as its heading followed by a <ul>: the caveats are what this file exists to '
    + 'guard, so failing to FIND them is itself the failure, not a reason to skip the check');
  assert.doesNotMatch(block[1], /<(ul|ol)\b/,
    'a nested list inside §4 would put the matching </ul> past the first one, so this extraction '
    + 'would silently guard a truncated section — re-cut the boundaries before §4 grows one');
  return [...block[1].matchAll(/<li>[\s\S]*?<\/li>/g)].map((m) => m[0]);
};

/**
 * §4 carries the pinned caveats and NOTHING ELSE — same set, same order, no sixth item.
 *
 * Surplus and shortfall are asserted separately BEFORE the whole-list comparison purely so the
 * failure names the offending text: a bare deepEqual over five ~400-character strings reports
 * that two arrays differ, which is true and useless to the person who has to decide whether the
 * new item was an honest addition or a reassurance that undoes the section.
 */
const assertCaveatsExactly = (html, expected, shape) => {
  const actual = caveatItems(html);
  const surplus = actual.filter((li) => !expected.includes(li));
  assert.deepEqual(surplus, [],
    `§4 (${shape}) carries ${surplus.length} list item(s) that no pinned caveat accounts for. `
    + 'An ADDED item is the one mutation every assertion above survives — each includes() is '
    + 'still true and the indexOf order is still ascending — while the document has grown a '
    + `sentence the caveats never agreed to. Unpinned:\n${surplus.join('\n')}`);
  const missing = expected.filter((li) => !actual.includes(li));
  assert.deepEqual(missing, [],
    `§4 (${shape}) is missing ${missing.length} pinned caveat(s), or their text was edited. `
    + `Expected but not found:\n${missing.join('\n')}`);
  assert.deepEqual(actual, expected,
    `§4 (${shape}) must be exactly the pinned caveats, in the pinned order, and nothing else`);
};

test('§4 is exactly the pinned caveats — no sixth item — in both shapes it can take', () => {
  // WHY THIS EXISTS ALONGSIDE the per-caveat pins. Those constants refuse any EDIT to a caveat,
  // and the order checks above refuse any REORDER of them. Both are satisfied by ADDING. MEASURED
  // before this test was written: appending
  //     <li>In practice the Registry accepts these figures as filed, so the caveats above rarely
  //     bite.</li>
  // to §4 in cbam-app.ts left all 399 unit tests green — every includes() still true, the indexOf
  // order still ascending, and the document now talking the reader out of the caveats it prints.
  // Set-and-order containment is the half that was missing.
  //
  // BOTH SHAPES, because §4 legitimately has two: the fifth caveat joins iff a line was entered at
  // the verified tier (the pair of tests above pin that gate in each direction). An assertion that
  // fitted only one shape would go red on the next HONEST change rather than on a dishonest one,
  // and would teach whoever met it to loosen this file.

  // Four-caveat shape — no line claims the verified tier.
  const d = dline();
  assertCaveatsExactly(
    docOf([d], [run('25231000', 'DZ', '(A)', '100')]),
    [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT],
    'defaults only',
  );

  // Five-caveat shape — one verified line, so the conditional caveat joins at the end.
  const v = vline({ verifiedRef: 'DNV-2026-0042' });
  assertCaveatsExactly(
    docOf([v], [estOf(v)]),
    [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT, CAVEAT_VERIFIED],
    'one verified line',
  );
});

test('the §4 caveat stands even when the verified line was REFUSED', () => {
  // ARGUED BOTH WAYS, and settled fail-closed. Against: the refused line contributed no figure,
  // so no number in the document rests on the attestation. For, and decisive: §1 still prints the
  // row, still marks it verified and still transcribes the reference the importer cited — so the
  // document still CONTAINS an unchecked claim, and the caveat is the only thing that says so.
  // Gating on "was it priced" would also make the caveat blink in and out with the engine's
  // verdict rather than with what the user actually entered.
  const v = vline({ seeDirect: 'nonsense', verifiedRef: 'DNV-2026-0042' });
  const e = estOf(v);
  assert.equal(e.status, 'unavailable', 'sanity: the engine refused the attested figure');
  const html = docOf([v], [e]);
  assert.ok(html.includes(CAVEAT_VERIFIED),
    'a refused verified line is still a verified claim, and the caveat still applies');
  assert.match(html, /no estimate/, 'sanity: the row itself carries no figure');
});

test('§1 marks a verified row and transcribes the reference the importer cited', () => {
  const v = vline({ verifiedRef: 'DNV-2026-0042' });
  const d = dline({ id: 'D2' });
  const html = docOf([v, d], [estOf(v), defaultOf(d)]);
  assert.match(html, /<td[^>]*>Verified actual — ref DNV-2026-0042<\/td>/,
    'the verified row states the tier that priced it and the reference cited for it');
  assert.match(html, /<td[^>]*>Commission default \+ mark-up<\/td>/,
    'and the defaults row says which corpus priced IT — the contrast is what makes the mark being '
    + 'absent meaningful');
  assert.match(html, /<th>Data tier<\/th>/, 'the column is labelled');
  // Exactly the two strings the on-screen provenance stamp uses (renderStamp's "Data tier" row),
  // so the printed document and the card a user saw cannot name the same tier differently.
  const stampRow = renderResult(estOf(v)).match(/<span>Data tier<\/span><b>([^<]+)<\/b>/);
  assert.ok(stampRow, 'sanity: the card renders a Data tier row');
  assert.match(html, new RegExp(`<td[^>]*>${stampRow[1]} —`),
    'the document uses the card\'s own tier label verbatim, not a second wording of it');
});

test('§1 shows no reference label for a verified line that cited none', () => {
  const v = vline();
  const html = docOf([v], [estOf(v)]);
  assert.match(html, /<td[^>]*>Verified actual<\/td>/, 'the row is still marked verified');
  assert.doesNotMatch(html, /ref\s*<\/td>/i, 'no dangling label for a reference never given');
  assert.doesNotMatch(html, /— ref\b/, 'and no empty separator either');
});

test('§1 prints NO reference beside a defaults-tier row, even one carrying a stray reference', () => {
  // tierCell gates the reference on the TIER, not on the reference's own truthiness, and nothing
  // pinned that: deleting `l.tier === 'actual-verified' &&` from the gate left all 375 tests green.
  // What it prevents is a row reading "Commission default + mark-up — ref DNV-2026-0042", which an
  // auditor reads as a named verifier having certified the Commission's own MARKED-UP value — the
  // one number in this document nobody verified and nobody could.
  //
  // parseVerifiedFields cannot build this line today (its defaults branch returns the tier alone
  // and reads no other field), so the gate is belt-and-braces — but buildPrintDocument is exported
  // and takes whatever Line it is handed, and a future construction site that carries the panel's
  // fields through unconditionally is exactly the drift the gate exists for.
  const d = dline({ verifiedRef: 'DNV-2026-0042' });
  const html = docOf([d], [defaultOf(d)]);
  assert.match(html, /<td[^>]*>Commission default \+ mark-up<\/td>/,
    'the tier cell states the defaults corpus and STOPS THERE — the cell closes on the label');
  assert.doesNotMatch(html, /DNV-2026-0042/,
    'the reference must appear nowhere in a document whose only line was priced from defaults');
  assert.doesNotMatch(html, /— ref\b/, 'and no separator survives without it');
});

test('§1 escapes the verifier reference — it is free text the user typed', () => {
  const v = vline({ verifiedRef: 'DNV"><script>alert(1)</script>' });
  const html = docOf([v], [estOf(v)]);
  assert.doesNotMatch(html, /<script>/, 'a raw reference must never reach the document unescaped');
  assert.match(html, /ref DNV&quot;&gt;&lt;script&gt;/, 'it prints escaped, and still readable');
});

test('§1 transcribes the verifier reference on a MIXED row — it certifies the half that is real', () => {
  // WHAT LEAVING tierCell BEHIND WOULD HAVE COST. Its reference is gated on the tier, not on the
  // reference's own truthiness (see the defaults-row test above for why that gate is right), and a
  // gate naming only 'actual-verified' silently deletes the importer's cited evidence from the ONE
  // artefact built to be handed to an auditor — while the label beside it still says the direct
  // figure was verified. The document would then assert a verified figure and withhold the
  // reference for it, which reads as no reference having been cited at all.
  const m = mline({ verifiedRef: 'BV-2026-0142' });
  const html = docOf([m], [estOf(m)]);
  assert.match(html, /<td[^>]*>Verified direct \+ Commission indirect — ref BV-2026-0142<\/td>/,
    'the mixed row states the compound tier that priced it and the reference cited for it');
  // Exactly the string the on-screen provenance stamp uses, the same cross-check the fully
  // verified row carries: the paper artefact and the card a user saw must not name one tier twice.
  const stampRow = renderResult(estOf(m)).match(/<span>Data tier<\/span><b>([^<]+)<\/b>/);
  assert.ok(stampRow, 'sanity: the card renders a Data tier row');
  assert.equal(stampRow[1], 'Verified direct + Commission indirect');
  assert.ok(html.includes(`<td class="cbp-loc">${stampRow[1]} — ref BV-2026-0142</td>`),
    'the document uses the card\'s own tier label verbatim, not a second wording of it');
});

test('§4 carries the verified caveat for a document of ONLY mixed lines, and says which half is which', () => {
  // TWO FAILURES IN ONE, and they had to be fixed together. A document whose only lines are mixed
  // contains attested figures priced without the mark-up and a transcribed verifier reference —
  // and, with `anyVerified` naming one tier, printed NO caveat saying any of it was unchecked. But
  // widening that gate alone would have printed the OLD wording, which says such lines "were
  // priced from the user's own attested figures, which skip the mark-up": false of the electricity
  // half, which is the Commission's own value with the mark-up on it. A caveat that under-states
  // the substitution is worse than a missing one, because it reads as having disclosed it.
  const m = mline({ verifiedRef: 'BV-2026-0142' });
  const html = docOf([m], [estOf(m)]);
  assert.ok(html.includes(CAVEAT_VERIFIED),
    'the verified caveat must appear, and match the pinned text exactly — word for word');
  assertCaveatsExactly(html,
    [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT, CAVEAT_VERIFIED],
    'one mixed line');
  // The claim and its negation. A rewording that dropped the second sentence would keep every
  // phrase the assertions below look for while going back to describing the whole line as attested.
  assert.match(html, /that half does carry the mark-up/,
    'the caveat must say the electricity half carries the mark-up, because it does');
  assert.match(html, /attested for its direct figure only/,
    'and must scope the attestation to the direct half by name');
  assert.match(html, /has not seen and cannot confirm/, 'the gap is still stated as a gap');
  assert.doesNotMatch(html, /(we|this tool) (have|has) (confirmed|verified|checked)/i);
  assert.doesNotMatch(html, /reference .{0,30}(has been|was) checked/i);
});

test('§1 stays rectangular across ordinary, refused, thrown and verified rows', () => {
  // The failure branch builds its own <tr> by hand, in parallel with the ordinary one, so a
  // column added to one and not the other misaligns every cell after it for that row — a table
  // where a euro figure sits under "Benchmark authority" and nothing says so.
  const v = vline({ verifiedRef: 'DNV-2026-0042' });
  const d = dline({ id: 'D3' });
  const refused = { id: 'R1', cn: '72052100', country: 'IN', route: '(C)', scope: 'direct',
    massT: '60', date: '2026-03-15', tier: 'default+markup' };
  const refusedResult = run('72052100', 'IN', '(C)', '60');
  assert.equal(refusedResult.status, 'unavailable', 'sanity: an ordinary engine refusal');
  const html = docOf(
    [v, d, refused, vline({ id: 'V2' })],
    [estOf(v), defaultOf(d), refusedResult, { failed: true, message: 'boom' }],
  );
  const widths = rowWidths(html);
  assert.equal(widths.length, 5, 'the header row plus one row per line, none dropped');
  assert.equal(new Set(widths).size, 1,
    `every row must carry the same number of cells — got ${widths.join(', ')}`);
  assert.match(html, />boom</, 'the thrown line still prints its reason');
});

test('the document never leaks the per-line delta — that figure is presentation, not record', () => {
  // The card shows what the verified choice was worth; the CSV deliberately omits it, and so must
  // this. A delta is a difference between two estimates, only one of which the importer is
  // claiming — printing it in an audit artefact would put a Commission-default euro figure on a
  // line the Commission never priced.
  const v = vline();
  const html = docOf([v], [estOf(v)]);
  assert.doesNotMatch(html, /would give/i, 'no counterfactual sentence belongs in the record');
  assert.doesNotMatch(html, /\bsaves?\b/i, 'no saving is claimed');
  assert.doesNotMatch(html, /€12,420\.84/,
    'the default-path figure for this exact line must not appear anywhere in the document');
});

/* ── one input builder, two paths (Task 6 review carry-forward) ───────────────
 *
 * estimateLine and defaultPathComparison must price THE SAME LINE, differing only in whether
 * `verified` is supplied — that identity is the entire meaning of the delta the card prints. They
 * used to hold two hand-written copies of the EstimatorInput construction, with nothing enforcing
 * that they stayed identical: a future engine field wired into estimateLine alone would have made
 * the comparison price a different line, while the card confidently stated "your verified data
 * saves €X" for the gap between two non-comparable estimates. No test could have failed, because
 * the tests built their inputs by hand too. inputFor is now the single construction site, and the
 * test below compares its two outputs GENERICALLY (over Object.keys, not a hard-coded field list)
 * so a field added there is covered without anyone remembering to extend this test.
 */

test('inputFor: the verified and default paths differ in `verified` and in NOTHING else', () => {
  const l = vline({ verifiedRef: 'DNV-2026-0042', seeIndirect: '0.4' });
  const withVerified = inputFor(l, verifiedInputOf(l));
  const asDefault = inputFor(l, undefined);
  assert.deepEqual(Object.keys(withVerified).sort(), Object.keys(asDefault).sort(),
    'both paths must present the engine with the same shape of input');
  for (const k of Object.keys(withVerified)) {
    if (k === 'verified') continue;
    assert.deepEqual(withVerified[k], asDefault[k],
      `inputFor must build '${k}' identically on both paths — a field that differs here prices a `
      + 'different line, and the card would report the difference as the value of verified data');
  }
  assert.deepEqual(withVerified.verified, { directTco2ePerT: '2.31', indirectTco2ePerT: '0.4' },
    'the verified path carries the attested figures, as entered');
  assert.equal(asDefault.verified, undefined,
    'and the default path carries none — that omission IS the comparison');
});

test('inputFor carries every field the engine prices on, read off the line and nothing else', () => {
  const l = vline({ scope: 'direct_and_indirect', massT: '7.5', date: '2026-11-02' });
  assert.deepEqual(inputFor(l, undefined), {
    cn: '72061000', country: 'IN', route: '(C)', massT: '7.5', date: '2026-11-02',
    emissionsScope: 'direct_and_indirect', verified: undefined,
  }, 'every value comes off the line as entered — no defaulting, no coercion');
});

test('inputFor: the two paths really do produce comparable estimates against the real pack', () => {
  // The end of the chain the two tests above hold: same line, both paths, and the ONLY thing that
  // may differ between the two results is the emissions basis. The free-allocation benchmark is a
  // property of the good, so it must be identical — if a future field made the comparison price a
  // different good, mass or date, this is where it shows up as a moved benchmark.
  const l = vline();
  const mine = estimateFromPack(pack, inputFor(l, verifiedInputOf(l)));
  const theirs = estimateFromPack(pack, inputFor(l, undefined));
  assert.equal(mine.stamp.tier, 'actual-verified');
  assert.equal(theirs.stamp.tier, 'default+markup');
  assert.equal(mine.scenario.faaTco2e, theirs.scenario.faaTco2e,
    'the same good at the same mass gets the same free allocation on both paths — the delta is '
    + 'the emissions basis alone');
  assert.notEqual(mine.emissionsTco2e, theirs.emissionsTco2e,
    'sanity: the two paths genuinely priced different emissions, so the check above has teeth');
});

/* ── the definitive regime's first day is inside it ─────────────────────────── */

test('1 January 2026 prices, instead of claiming the rule does not exist', () => {
  // The likeliest date an importer types when sizing a year's exposure. It used to refuse
  // every good with "The published rules do not give a free-allocation benchmark…", naming a
  // rule that was in force that day — active() sorted the timestamp bound after the plain date.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-01-01',
  });
  assert.notEqual(e.status, 'unavailable',
    'the first day of the definitive regime must resolve');
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.scenario.certificates, '71.465');
  assert.equal(e.scenario.costEur, '5385.60');
  // …and the day before is still outside the regime.
  const before = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2025-12-31',
  });
  assert.equal(before.status, 'unavailable');
});

/* ── the electricity default follows the route you declared ─────────────────── */

test('route (A) is priced with route (A) electricity, not route (B)\'s', () => {
  // Algerian cement clinker publishes indirect (A): 0.04 and (B): 0.06. The lookup used to match
  // on good/origin/year only and take whichever sorted first — the dearer one — so route (A) was
  // over-charged EUR 165.79 per 100 t.
  //
  // Changing the route on the form DID move the total even then — the DIRECT factors are route-
  // keyed too (1.24 against 1.29), so the old engine already answered 5882.98 against 4879.37.
  // What never moved was the ELECTRICITY: 6.6 for both routes, route (B)'s figure charged to
  // route (A). That is why the closing assertion reads indirectTco2e and not costEur. A costEur
  // comparison passes with the defect fully present and pins nothing.
  const line = { cn: '25231000', country: 'DZ', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect' };
  const a = estimateFromPack(pack, { ...line, route: '(A)' });
  const b = estimateFromPack(pack, { ...line, route: '(B)' });
  assert.equal(a.status, 'cscf_pending');
  assert.equal(b.status, 'cscf_pending');
  assert.equal(a.scenario.certificates, '75.865');
  assert.equal(a.scenario.costEur, '5717.19');
  assert.equal(b.scenario.certificates, '64.7475');
  assert.equal(b.scenario.costEur, '4879.37');
  assert.notEqual(a.scenario.indirectTco2e, b.scenario.indirectTco2e,
    'the electricity component must follow the declared route — the old engine returned 6.6 for both');
});

test('the indirect lookup separates "publishes none" from "publishes one" — the fact syncScope reads', () => {
  // THIS PINS THE LOOKUP'S CONTRACT, NOT THE CONTROL'S VISIBILITY, AND THE LIMIT IS WORTH STATING
  // PLAINLY. cbam-app.ts syncScope() hides the emissions-scope row unless
  // `selectIndirectFactorFromPack(...).kind !== 'none'`. That expression sits in a closure inside
  // initCbam() and needs a `document`, which this suite has not got (node:test + tsx, no DOM
  // library in devDependencies). So reverting syncScope to the old `!== null` does NOT fail this
  // test, and nothing else in this suite catches it either — policing that operator needs an e2e
  // assertion on #cbScopeRow's hidden state. Do not read this test as covering it.
  //
  // What it DOES pin is the half syncScope rests on, and the half the type checker is blind to.
  // The lookup returns an OBJECT in every case now, so `!= null` against it is always true and
  // TypeScript accepts it without a murmur — that blindness is the whole reason the operator had
  // to change. Asserting the union's TAGS turns the return shape into a contract: put the pre-fix
  // `Factor | null` lookup back and this test dies on the first assertion, because `null` has no
  // `.kind`. A silent re-tagging, or a lookup that started answering `found` for a direct-only
  // sector, fails it the same way.
  const sel = (over) => ({ massT: '1', date: '2026-03-15', ...over });

  // Iron & steel and aluminium are charged direct-only in the definitive period — the Commission
  // publishes no indirect row for them at all. `none` is what keeps the control off those goods.
  //
  // EVERY SELECTOR HERE IS ONE THE FORM CAN ACTUALLY PRODUCE: each good is listed in
  // pack.classifications and the route is one routesFor() publishes for that pairing, so these
  // are states a user can reach. That is deliberate. A CN the pack does not classify (e.g. the
  // heading-level '76011000', which is absent — the pack lists '76011010' and its siblings)
  // also answers `none`, but from isOfferedGood's unknown-good guard, and routesFor gives it no
  // route at all, so syncScope's own `!!route.value` has already failed. It would look like an
  // assertion about aluminium while testing something else entirely.
  assert.equal(selectIndirectFactorFromPack(pack, sel({
    cn: '72083800', country: 'IN', route: '(C)' })).kind, 'none', 'iron & steel publishes none');
  assert.equal(selectIndirectFactorFromPack(pack, sel({
    cn: '76011010', country: 'MZ', route: '(K)' })).kind, 'none', 'aluminium publishes none');

  // Cement does publish one, so the good half of the predicate has to answer too — asserting only
  // the `none` arm would be satisfied by a lookup that returned `none` for everything.
  assert.equal(selectIndirectFactorFromPack(pack, sel({
    cn: '25231000', country: 'DZ', route: '(A)' })).kind, 'found', 'DZ cement clinker publishes one');

  // The third arm, `route-mismatch`, is deliberately absent: it is unreachable in the shipped pack
  // (see syncScope's note — 0 of 66,675 reachable selectors), so there is no input that would
  // exercise it and a test claiming to would be fiction.
});

/* ── a mass that cannot become a figure is refused, not priced ──────────────── */

test('net mass is gated: no negative bill, no NaN euros, no hex tonnage', () => {
  // -100 t priced -4.4 certificates / -EUR 331.58; 0x10 priced 16 t / EUR 914.75 because
  // Decimal honours JS radix prefixes; NaN and Infinity rendered AS figures rather than throwing.
  // '1e9999999999999999' is all digits so it clears the shape gate, then saturates to Infinity
  // past Decimal.maxE — the only path by which the engine's isFinite() check is load-bearing.
  const line = { cn: '25231000', country: 'DZ', route: '(A)', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect' };
  for (const massT of ['-100', '', 'abc', 'NaN', 'Infinity', '0x10', '1_000', '1e9999999999999999']) {
    const e = estimateFromPack(pack, { ...line, massT });
    assert.equal(e.status, 'unavailable', `massT=${JSON.stringify(massT)} must refuse`);
  }
  // and an ordinary mass is untouched, including zero
  assert.equal(estimateFromPack(pack, { ...line, massT: '100' }).status, 'cscf_pending');
  assert.equal(estimateFromPack(pack, { ...line, massT: '0' }).status, 'cscf_pending');
});

/* ── a refusal names the table that is actually empty ───────────────────────── */

test('a 2027 date refuses on the PRICE, and says so', () => {
  // pack.prices holds four rows, all 2026, while defaultFactors runs through 2028 and cscf to
  // 2030 — so every 2027 and 2028 date refuses, and refuses on the PRICE. It used to answer
  // "The published rules do not give a free-allocation benchmark…" beside a selector reading
  // certificate-price/2027-Q1, sending the reader to hunt a benchmark that is present.
  //
  // Only 2027 onward reaches this. A 2026 quarter with no price published yet (Q3 and Q4 are
  // status 'pending', priceEur null) is NOT a refusal — the engine prices the emissions, notes
  // the missing price and carries costEur as null. The 2027 quarters have no row at all, so
  // the lookup fails closed instead. That is why the defect was invisible across 2026.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-03-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^certificate-price\//);
  assert.match(e.reason, /certificate price/i);
  assert.doesNotMatch(e.reason, /free-allocation benchmark/i);
});

test('…and a good whose benchmark really is missing still says BENCHMARK', () => {
  // The other arm, and the reason this pair exists rather than the test above alone: a dispatch
  // hard-wired to return the price reason for every refusal passes that test perfectly, and
  // nothing else in this repo would notice — the existing refusal tests (72052100 above) pin
  // status and selector, never the wording. Upstream hit exactly that trap.
  //
  // Same good and same year as the price case, so the only thing that differs is which table is
  // empty: route 'default' sends 25231000 to Column B route-independent, which it does not
  // publish, and that refuses on benchmark/ at every date in 2026-2028.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'KR', route: 'default', massT: '100', date: '2027-03-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^benchmark\//);
  assert.match(e.reason, /free-allocation benchmark/i);
  assert.doesNotMatch(e.reason, /certificate price/i);
});

/* ── an unreadable import date says so, instead of blaming a benchmark ──────── */

test('an out-of-range month refuses on the DATE, not the benchmark', () => {
  // quarterOf throws when the year is not four digits or the month is outside 1-12, and what
  // reaches that throw is an unreadable import date — not a missing rule. <input type="date">
  // cannot emit month 13, so no user of THIS form meets it; the engine is vendored byte-for-byte
  // from a SaaS whose form is not this one, and the refusal is reachable through estimateFromPack
  // regardless. Measured on this pack before the re-vendor: this input answered "The published
  // rules do not give a free-allocation benchmark…" beside a selector reading
  // quarter/2027-13-15, sending the reader to hunt an Annex row that had resolved a moment
  // earlier. The selector was right all along; only the sentence beside it was wrong.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-13-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^quarter\//);
  assert.match(e.reason, /not a readable calendar date/i);
  assert.doesNotMatch(e.reason, /free-allocation benchmark/i);
});

test('a single-digit month refuses on the DATE too, where the guard used to miss', () => {
  // A DIFFERENT DEFECT WITH THE SAME SYMPTOM, which is why it is pinned separately rather than
  // folded into the case above as one more date. '2027-1-15'.slice(5, 7) is '1-', Number('1-')
  // is NaN, and NaN < 1 || NaN > 12 is false || false — so the month guard did not fire at all.
  // quarterOf returned the STRING '2027-QNaN', no price row matched it, and the refusal surfaced
  // two layers down as certificate-price/2027-QNaN, answered "the good and its benchmark are
  // present, only the price is missing". Every clause of that is false for a date nobody can
  // read, and it read MORE confidently wrong once month 13 above started reporting correctly.
  //
  // A selector/reason agreement sweep cannot catch this one: the two agreed perfectly, both
  // consistently wrong. The selector itself was the lie, so only an assertion about which table
  // is blamed — this test — can see it. Measured here before the re-vendor, the hole was never
  // confined to years that have no price row: '2026-1-15' refused as certificate-price/
  // 2026-QNaN in exactly the same way, inside the year the site actually prices.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-1-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^quarter\//);
  assert.match(e.reason, /not a readable calendar date/i);
});

test('…and a UTC timestamp still prices, which is why that guard is isInteger and not a regex', () => {
  // THE OVER-CATCHING WITNESS, and it is deliberately not a plain well-formed date. Tightening a
  // guard can refuse inputs that used to work, but an ordinary day needs no new test here: two
  // dozen cases in this file pass '2026-03-15' explicitly and the run() helper defaults to it,
  // several of them pinning its exact figures — so a guard that over-caught ordinary days would
  // already be red long before reaching this line.
  //
  // The timestamp form is the one shape nothing in this repo covers, and it is precisely the
  // shape the upstream fix had to preserve: quarterOf's callers may pass a UTC timestamp as well
  // as a plain day (active() in resolve-fa.ts was built to take either), and
  // '2026-01-01T00:00:00.000Z'.slice(5, 7) is '01'. The obvious tightening — a whole-date regex
  // like /^\d{4}-\d{2}-\d{2}$/ — would refuse it and silently stop pricing every timestamp
  // caller. That reasoning currently lives only in a comment upstream; a later re-tightening
  // would arrive here by cp, and cbam-sync-check records whatever hash arrives without an
  // opinion. This test is the thing that would refuse it.
  const line = { cn: '25231000', country: 'DZ', route: '(A)', massT: '100',
    emissionsScope: 'direct_and_indirect' };
  const stamped = estimateFromPack(pack, { ...line, date: '2026-01-01T00:00:00.000Z' });
  assert.equal(stamped.status, 'cscf_pending');
  assert.equal(stamped.priceQuarter, '2026-Q1', 'the timestamp must still resolve to a quarter');
  assert.equal(stamped.scenario.costEur, '5717.19');
  // Same day in two encodings: the timestamp must not merely price, it must price IDENTICALLY.
  assert.deepEqual(stamped, estimateFromPack(pack, { ...line, date: '2026-01-01' }));
});
