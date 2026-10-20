// tests/unit/obos-v2-ci-scope.test.mjs — FINAL audit F1 (founder-approved 19 Oct): the @v2 browser suite gets its own CI job, so the 38-minute Playwright stop never has to hold both suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

/* "Unset" must mean unset. The CI step that runs this test sets OBOS_PW_SCOPE=main for its own Playwright run, and spreading process.env
   carried that into the child, so the "unset" case ran as 'main' and lost the two v2 projects (PR #62, CI only). Strip it first. */
const names = (scope) => {
  const { OBOS_PW_SCOPE: _inherited, ...base } = process.env;
  return JSON.parse(execFileSync('node', ['--import', 'tsx', '-e', "import('./playwright.config.ts').then((m) => console.log(JSON.stringify(m.default.projects.map((p) => p.name))))"],
    { env: { ...base, ...(scope === undefined ? {} : { OBOS_PW_SCOPE: scope }), OBOS_PW_SCOPE_TEST: '1' }, encoding: 'utf8' }));
};
const V2 = ['chromium-v2-a', 'chromium-v2-b'];

test('OBOS_PW_SCOPE unset: every project, as before (local)', () => {
  const all = names(undefined);
  for (const n of ['chromium-tier0', ...V2]) assert.ok(all.includes(n), n);
});

test("OBOS_PW_SCOPE='v2-a' / 'v2-b': only that part; 'main': everything except the two parts", () => {
  assert.deepEqual(names('v2-a'), ['chromium-v2-a']);
  assert.deepEqual(names('v2-b'), ['chromium-v2-b']);
  const main = names('main');
  assert.ok(main.includes('chromium-tier0'));
  for (const n of V2) assert.ok(!main.includes(n), `${n} must not run in the main job`);
});

test('an unknown scope is refused (a typo must not silently run nothing, or everything)', () => {
  assert.throws(() => names('v2-c'));
});

const wf = YAML.parse(readFileSync('.github/workflows/verify.yml', 'utf8'));

test('verify.yml: the existing job runs the main scope; a separate obos-v2-browser job runs part a and part b as a matrix, 30 minutes each, with their durations uploaded', () => {
  const q = wf.jobs.quality;
  const verify = q.steps.find((s) => /npm run \$\{\{/.test(s.run ?? ''));
  assert.equal((verify.env ?? q.env ?? {}).OBOS_PW_SCOPE, 'main', 'the existing job is scoped to everything but the @v2 parts');
  const j = wf.jobs['obos-v2-browser'];
  assert.ok(j, 'job obos-v2-browser');
  assert.deepEqual(j.strategy.matrix.part, ['a', 'b']);
  assert.equal(j['timeout-minutes'], 30);
  assert.equal(j.strategy['fail-fast'], false);
  const run = j.steps.map((s) => s.run ?? '').join('\n');
  assert.match(run, /npm ci/);
  assert.match(run, /npm run build/);
  assert.match(run, /npx playwright test --project=chromium-v2-\$\{\{ matrix\.part \}\}/);
  const test = j.steps.find((s) => /npx playwright test/.test(s.run ?? ''));
  assert.equal(test.env.OBOS_PW_SCOPE, 'v2-${{ matrix.part }}');
  /* rc1 R4: Playwright stops itself before the job limit does, so a hang ends as a failure with a summary, not a silent cancellation (the config's own 38 minutes is longer than this job's 30) */
  const gt = /--global-timeout=(\d+)/.exec(test.run);
  assert.ok(gt, 'the v2 step passes --global-timeout');
  assert.ok(Number(gt[1]) <= (j['timeout-minutes'] - 3) * 60_000, 'it leaves at least 3 minutes of the job limit to print the summary and upload the results');
  const up = j.steps.find((s) => /upload-artifact/.test(s.uses ?? ''));
  assert.equal(up.with.name, 'playwright-results-v2-${{ matrix.part }}');
  assert.match(up.with.path, /test-results\//);
});

test('verify.yml: the v2 job runs only when the browser contracts do (the same scope rule), and installs Chromium only', () => {
  const j = wf.jobs['obos-v2-browser'];
  const scope = j.steps.find((s) => s.id === 'scope');
  assert.ok(scope, 'the same changed-files rule decides whether it runs');
  const installs = j.steps.map((s) => s.run ?? '').filter((r) => /playwright install(?!-deps)/.test(r));
  assert.deepEqual(installs.map((r) => r.trim()), ['npx playwright install chromium']);
  for (const s of j.steps.filter((s) => /playwright|Playwright/.test(`${s.run ?? ''}${s.name ?? ''}`) && s.id !== 'scope')) assert.equal(s.if, "steps.scope.outputs.browser == 'true'", s.name);
});

test("playwright.config.ts no longer claims CI runs both parts in the one job", () => {
  const c = readFileSync('playwright.config.ts', 'utf8');
  assert.doesNotMatch(c, /Until then CI runs both parts in the one job/);
  assert.match(c, /OBOS_PW_SCOPE/);
});
