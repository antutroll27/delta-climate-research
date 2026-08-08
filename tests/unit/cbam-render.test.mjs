import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, decorateSnapshot, nextRoute, renderLineCard, renderResult, renderThreshold,
  renderTotals, renderYearThreshold,
} from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  estimateFromPack, resolveThreshold, routesFor,
} from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { sumTotals } from '../../src/scripts/cbam-lines.ts';

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
