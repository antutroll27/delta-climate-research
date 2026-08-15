import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, decorateSnapshot, inputFor, nextRoute, parseVerifiedFields, renderAttestation,
  renderLineCard, renderResult, renderThreshold, renderTotals, renderYearThreshold, verifiedInputOf,
} from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  estimateFromPack, resolveThreshold, routesFor,
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
 * EXACT-PINNED legal prose — the four §4 caveats plus the below-threshold attestation
 * sentence. Normally pinning exact text is a brittle test worth avoiding; here brittleness is
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
 * the verified tier. Both states are pinned below (present when one is, absent when none is) —
 * an unconditional caveat would be a claim about attested data on a document that contains none,
 * and a missing one would leave the mark-up-skipping figures looking as Commission-backed as
 * every other row. Hand-typed here for exactly the reason the four above are; see the doc comment
 * on this block.
 */
const CAVEAT_VERIFIED =
  '<li>Lines marked verified in §1 were priced from the user\'s own attested figures, which skip\n'
  + '        the mark-up the Commission\'s default values carry. Those figures are a claim, from a\n'
  + '        verification this tool has not seen and cannot confirm; any reference cited beside them\n'
  + '        is transcribed as entered, never checked.</li>';
const ATTESTATION_SENTENCE =
  '<p class="cb-sub">Below the threshold an importer owes nothing for 2026. This verdict rests '
  + 'on your attested statement that the list is complete — it is your completeness claim, '
  + 'verified by no one, not by the Commission or by us.</p>';

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

test('hydrogen and electricity are outside the exemption, so no card is shown', () => {
  // Reg (EU) 2025/2083 excludes them from the 50 t exemption. Rendering an
  // "indeterminate" card for hydrogen would imply an exemption it cannot have.
  assert.equal(thresh('28041000', '10'), null, 'hydrogen must resolve to no threshold rule');
});

/* ── indirect (electricity) emissions ──────────────────────────────────────── */

const withScope = (emissionsScope) => estimateFromPack(pack, {
  cn: '25231000', country: 'DZ', route: '(A)', massT: '100',
  date: '2026-03-15', emissionsScope,
});

test('indirect emissions are charged for cement and receive NO free allocation', () => {
  const direct = withScope('direct'), both = withScope('direct_and_indirect');
  assert.equal(direct.scenario.indirectTco2e, '0');
  assert.equal(both.scenario.indirectTco2e, '6.6');
  // Free allocation is a DIRECT-emission benchmark, so the deduction must not grow
  // when indirect is added — the indirect tonnes pass into the charge in full.
  assert.equal(direct.scenario.faaTco2e, both.scenario.faaTco2e,
    'free allocation must be unchanged by indirect emissions');
  assert.equal(both.scenario.netTco2e, '78.065');
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
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true, eligibleLineCount: 1,
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

test('renderYearThreshold: above hides the checkbox — a fact needs no attestation', () => {
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'above_threshold',
    knownEligibleMassT: '60', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: [], attested: false, eligibleLineCount: 1,
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
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: false, eligibleLineCount: 1,
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
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true, eligibleLineCount: 1,
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
  const previewShape = { tier: 'actual-verified', verifiedRef: 'DNV-2026-0042' };
  assert.ok(renderAttestation(previewShape).includes(ATTESTED_NOTE),
    'a verified figure must carry its attestation on every surface that prices it, card or preview');
  assert.equal(renderAttestation({ tier: 'default+markup' }), '',
    'a Commission-default figure makes no attested claim, so it must say nothing');
  // Absent reference must not print a bare "Ref:" label with nothing after it.
  assert.equal(renderAttestation({ tier: 'actual-verified' }),
    renderAttestation({ tier: 'actual-verified', verifiedRef: '' }),
    'no reference and an empty reference read identically here');
  assert.doesNotMatch(renderAttestation({ tier: 'actual-verified' }), /Ref:/);
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
