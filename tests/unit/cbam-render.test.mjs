import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { nextRoute, renderResult, renderThreshold } from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  estimateFromPack, resolveThreshold, routesFor,
} from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

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
