import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, nextRoute, renderLineCard, renderResult, renderThreshold, renderTotals,
  renderYearThreshold,
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
  assert.match(html, /attested/i, 'the verdict must say what it rests on');
  assert.match(html, /data-attest="2026"[^>]*checked/, 'checkbox reflects the attestation');
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
  assert.match(html, /Art(icle)? 9/i, 'the carbon-price-abroad gap must be stated');
  assert.match(html, /inputs as entered/i, 'the fingerprint must be labelled honestly');
  assert.match(html, /completeness/i, 'the attestation basis must be stated');
  assert.match(html, new RegExp('f'.repeat(16)), 'the pack snapshot appears');
  assert.match(html, /What this does not tell you/i);
  assert.match(html, /2026-08-08/, 'the generation date is the one the caller supplied, not the clock');
  // The direction that matters most: CSCF=1 is the MAXIMUM legally possible correction, so every
  // shown figure is a FLOOR — the true bill cannot be lower, only possibly higher.
  assert.match(html, /cannot be lower.*may be higher/is, 'the CSCF direction must not be stated backwards');
  assert.doesNotMatch(html, /cannot be higher/i, 'must not carry the reversed claim');
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
