import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { papers } from '../../src/data/papers.ts';
import { projects } from '../../src/data/projects.ts';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const buildReportScript = join(projectRoot, 'scripts/report-build.mjs');
const publicationScript = join(projectRoot, 'scripts/check-publication-contract.mjs');
const siteUrl = 'https://deltaclimate.earth';

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'delta-build-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function runScript(script, args) {
  try {
    const result = await execFileAsync(process.execPath, [script, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (!error || typeof error !== 'object') throw error;
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

function gzipBytes(source) {
  return gzipSync(Buffer.from(source), { level: 9, mtime: 0 }).byteLength;
}

test('build report accounts for executable inline JavaScript per route', async (t) => {
  const root = await temporaryDirectory(t);
  const dist = join(root, 'dist');
  const outputA = join(root, 'report-a.json');
  const outputB = join(root, 'report-b.json');
  const external = 'export const ready = true;';
  const classic = 'globalThis.classicBoot = "Delta";';
  const module = 'globalThis.moduleBoot = "Δ";';
  const legacyMime = 'globalThis.legacyBoot = true;';

  const homeHtml = [
    `<script>${classic}</script>`,
    `<script type=" module ">${module}</script>`,
    `<script type="text/javascript; charset=utf-8">${legacyMime}</script>`,
    '<script type="application/ld+json">{"name":"not executable"}</script>',
    '<script type="application/json">{"also":"data"}</script>',
    '<script type="importmap">{"imports":{}}</script>',
    '<script type="speculationrules">{"prefetch":[]}</script>',
    '<script src="">globalThis.emptySourceFallback = true;</script>',
    '<script type="module" src="/app.js">globalThis.externalFallback = true;</script>',
  ].join('');
  const aboutHtml = [
    `<script>${classic}</script>`,
    '<script type="module" src="/app.js"></script>',
  ].join('');

  await write(join(dist, 'app.js'), external);
  await write(join(dist, 'index.html'), homeHtml);
  await write(join(dist, 'about/index.html'), aboutHtml);

  const first = await runScript(buildReportScript, ['--dist', dist, '--output', outputA]);
  const second = await runScript(buildReportScript, ['--dist', dist, '--output', outputB]);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(await readFile(outputA, 'utf8'), await readFile(outputB, 'utf8'));

  const report = JSON.parse(await readFile(outputA, 'utf8'));
  const home = report.routes.find((route) => route.route === '/');
  const about = report.routes.find((route) => route.route === '/about/');
  const expectedHomeRaw = Buffer.byteLength(classic) + Buffer.byteLength(module) + Buffer.byteLength(legacyMime);
  const expectedHomeGzip = gzipBytes(classic) + gzipBytes(module) + gzipBytes(legacyMime);

  assert.equal(home.javascript.inlineStartup.scriptCount, 3);
  assert.equal(home.javascript.inlineStartup.rawBytes, expectedHomeRaw);
  assert.equal(home.javascript.inlineStartup.gzipBytes, expectedHomeGzip);
  assert.deepEqual(
    home.javascript.inlineStartup.scripts.map((script) => script.kind),
    ['classic', 'module', 'classic'],
  );
  assert.equal(home.javascript.startup.rawBytes, Buffer.byteLength(external));
  assert.equal(home.javascript.startupTotal.rawBytes, Buffer.byteLength(external) + expectedHomeRaw);
  assert.equal(home.javascript.startupTotal.gzipBytes, gzipBytes(external) + expectedHomeGzip);

  assert.equal(about.javascript.inlineStartup.scriptCount, 1);
  assert.equal(about.javascript.inlineStartup.rawBytes, Buffer.byteLength(classic));
  assert.equal(report.javascript.siteStartupModules.fileCount, 1);
  assert.equal(report.javascript.siteStartupModules.rawBytes, Buffer.byteLength(external));
  assert.equal('siteInlineStartup' in report.javascript, false);
});

function publicationContracts() {
  const anyPaperPublished = papers.some((paper) => paper.published);
  const anyProjectPublished = projects.some((project) => project.published);
  return [
    { route: '/', indexable: true, placeholder: false },
    { route: '/team/', indexable: true, placeholder: false },
    { route: '/climate-highlights/', indexable: false, placeholder: true },
    // ponytail: this list mirrors `routeContracts` in check-publication-contract.mjs by
    // hand — a third place encoding "is /heat-map/ indexable", after that script and
    // astro.config.mjs's sitemapFilter. That triplication is what let the three drift
    // apart in the first place. Export the contract list from the checker and import it
    // here if it drifts again.
    { route: '/heat-map/', indexable: true, placeholder: false },
    { route: '/heat-map/compare/', indexable: false, placeholder: false },
    { route: '/heat-map/brief/', indexable: false, placeholder: false },
    // the three standards documents — core, indexable, permanent (see the checker)
    { route: '/standards/', indexable: true, placeholder: false },
    { route: '/uncertainty/', indexable: true, placeholder: false },
    { route: '/attribution/', indexable: true, placeholder: false },
    { route: '/white-papers/', indexable: anyPaperPublished, placeholder: !anyPaperPublished },
    ...papers.map((paper) => ({
      route: `/white-papers/${paper.slug}/`,
      indexable: paper.published,
      placeholder: !paper.published,
    })),
    { route: '/projects/', indexable: anyProjectPublished, placeholder: !anyProjectPublished },
    ...projects.map((project) => ({
      route: `/projects/${project.slug}/`,
      indexable: project.published,
      placeholder: !project.published,
    })),
    { route: '/404.html', indexable: false, placeholder: false },
  ];
}

function htmlPathForRoute(route) {
  if (route === '/') return 'index.html';
  if (route === '/404.html') return '404.html';
  return `${route.slice(1)}index.html`;
}

function fixtureHtml(contract, robotsOverride) {
  const canonical = contract.route === '/404.html' ? null : `${siteUrl}${contract.route}`;
  const robots = robotsOverride ?? (contract.indexable ? '' : '<meta name="robots" content="noindex">');
  return [
    '<!doctype html><html><head><title>Fixture</title>',
    robots,
    contract.indexable ? `<link rel="canonical" href="${canonical}">` : '',
    canonical ? `<meta property="og:url" content="${canonical}">` : '',
    `</head><body class="${contract.placeholder ? 'soon-tide' : 'content'}"></body></html>`,
  ].join('');
}

async function createPublicationFixture(t, robotsByRoute = {}) {
  const root = await temporaryDirectory(t);
  const dist = join(root, 'dist');
  const output = join(root, 'publication-report.json');
  const contracts = publicationContracts();

  for (const contract of contracts) {
    await write(
      join(dist, htmlPathForRoute(contract.route)),
      fixtureHtml(contract, robotsByRoute[contract.route]),
    );
  }

  const indexableUrls = contracts
    .filter((contract) => contract.indexable)
    .map((contract) => `${siteUrl}${contract.route}`)
    .sort();
  await write(
    join(dist, 'sitemap-index.xml'),
    `<sitemapindex><sitemap><loc>${siteUrl}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
  );
  await write(
    join(dist, 'sitemap-0.xml'),
    `<urlset>${indexableUrls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`,
  );

  return { root, dist, output, contracts, indexableUrls };
}

async function runPublicationFixture(fixture) {
  const result = await runScript(publicationScript, [
    '--dist', fixture.dist,
    '--output', fixture.output,
  ]);
  const report = JSON.parse(await readFile(fixture.output, 'utf8'));
  return { result, report };
}

test('publication checker combines every robots and googlebot directive', async (t) => {
  const noindexFixture = await createPublicationFixture(t, {
    '/climate-highlights/': [
      '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="nofollow">',
      '<meta name="GoogleBot" content=" NoInDeX ">',
    ].join(''),
  });
  const passing = await runPublicationFixture(noindexFixture);
  assert.equal(passing.result.exitCode, 0, passing.result.stderr);
  assert.equal(passing.report.status, 'pass');
  assert.equal(
    passing.report.routes.find((route) => route.route === '/climate-highlights/').noindex,
    true,
  );

  const indexableFixture = await createPublicationFixture(t, {
    '/': '<meta name="robots" content="index, follow"><meta name="googlebot" content="none">',
  });
  const failing = await runPublicationFixture(indexableFixture);
  assert.equal(failing.result.exitCode, 1);
  assert.ok(failing.report.violations.some((violation) => (
    violation.code === 'indexability-mismatch' && violation.route === '/'
  )));
});

test('publication checker trusts only same-origin sitemap-index references', async (t) => {
  const fixture = await createPublicationFixture(t);
  await write(
    join(fixture.dist, 'sitemap-99.xml'),
    '<urlset><url><loc>https://deltaclimate.earth/orphan/</loc></url></urlset>',
  );

  const passing = await runPublicationFixture(fixture);
  assert.equal(passing.result.exitCode, 0, passing.result.stderr);
  assert.equal(passing.report.status, 'pass');
  assert.deepEqual(passing.report.sitemap.referencedFiles, ['sitemap-0.xml']);
  assert.equal(passing.report.sitemap.actual.includes(`${siteUrl}/orphan/`), false);

  await write(
    join(fixture.dist, 'sitemap-index.xml'),
    `<sitemapindex><sitemap><loc>${siteUrl}/missing.xml</loc></sitemap></sitemapindex>`,
  );
  const missing = await runPublicationFixture(fixture);
  assert.equal(missing.result.exitCode, 1);
  assert.ok(missing.report.violations.some((violation) => (
    violation.code === 'missing-referenced-sitemap'
  )));
  assert.deepEqual(missing.report.sitemap.actual, []);

  await write(
    join(fixture.dist, 'sitemap-index.xml'),
    '<sitemapindex><sitemap><loc>https://example.test/sitemap-0.xml</loc></sitemap></sitemapindex>',
  );
  const crossOrigin = await runPublicationFixture(fixture);
  assert.equal(crossOrigin.result.exitCode, 1);
  assert.ok(crossOrigin.report.violations.some((violation) => (
    violation.code === 'cross-origin-sitemap-reference'
  )));
  assert.deepEqual(crossOrigin.report.sitemap.actual, []);

  await rm(join(fixture.dist, 'sitemap-index.xml'));
  const missingIndex = await runPublicationFixture(fixture);
  assert.equal(missingIndex.result.exitCode, 1);
  assert.ok(missingIndex.report.violations.some((violation) => (
    violation.code === 'missing-sitemap-index'
  )));
});

test('the calculator states its idle prompt identically in the page and in the script', async () => {
  // TWO COPIES OF ONE SENTENCE, and they are rendered by different machinery: the .astro ships
  // it server-side as the pre-hydration card, and run() overwrites #cbOut with its own copy on
  // the first input. A user sees the static one first, and keeps seeing it if ensurePack()
  // never resolves — so a drift between them is a drift in what the product says, not a tidiness
  // problem.
  //
  // They DID drift, in the commit that added the import date to run()'s completeness gate: the
  // script's copy grew "and import date", the page's did not, and nothing caught it. Which is
  // the same defect this calculator's engine work keeps closing one surface at a time — a fact
  // spelled out in two places, where changing one is not changing the other.
  //
  // Extracted from the PAGE and required to appear in the SCRIPT, deliberately in that
  // direction: cbam-app.ts holds several cb-idle strings (the mass refusal, the verified-panel
  // refusal), so searching it for "some cb-idle sentence" would pass on the wrong one.
  const page = await readFile(join(projectRoot, 'src/pages/cbam/cbam-calculator.astro'), 'utf8');
  const script = await readFile(join(projectRoot, 'src/scripts/cbam-algos/cbam-app.ts'), 'utf8');

  const idle = /<p class="cb-idle">([^<]+)<\/p>/.exec(page);
  assert.ok(idle, 'the page must ship an idle prompt inside #cbOut before hydration');
  assert.match(idle[1], /import date/,
    'the idle prompt must name every field the gate requires — the import date included, since '
    + 'a cleared date is exactly what run() now refuses to price');
  assert.ok(script.includes(idle[1]),
    `the script's idle copy must be byte-identical to the page's. Page says:\n  ${idle[1]}\n`
    + 'but cbam-app.ts does not contain that string. Update run()\'s message and this one '
    + 'together, or the product states two different sentences for one state.');
});

test('the portability dossier teaches the gate the calculator actually ships', async () => {
  // A THIRD COPY, with a DIFFERENT failure mode from the two above. docs/cbam-calculator-
  // portability.md is the port target's guidance — a reference implementation someone rebuilds
  // this calculator from in another repo — so a stale snippet there does not merely say the wrong
  // thing on a screen, it TEACHES a gate the shipped one no longer has.
  //
  // It shipped exactly that: the dossier's `estimate` computed gated on four fields (good,
  // origin, route, mass) and its idle sentence named four, which is the state this calculator was
  // in before a cleared <input type="date"> was found being priced as calendar year 0. Anyone
  // porting from the document would have rebuilt that defect from scratch.
  //
  // Extracted from the PAGE and required in the DOSSIER, the same direction and for the same
  // reason as the test above: the shipped copy is the authority, and searching the document for
  // "some sentence about the exposure" would pass on whichever one happened to be there.
  const page = await readFile(join(projectRoot, 'src/pages/cbam/cbam-calculator.astro'), 'utf8');
  const dossier = await readFile(join(projectRoot, 'docs/cbam-calculator-portability.md'), 'utf8');

  const idle = /<p class="cb-idle">([^<]+)<\/p>/.exec(page);
  assert.ok(idle, 'the page must ship an idle prompt inside #cbOut before hydration');
  assert.ok(dossier.includes(idle[1]),
    `the dossier's idle copy must be byte-identical to the page's. Page says:\n  ${idle[1]}\n`
    + 'but docs/cbam-calculator-portability.md does not contain that string.');

  // AND THE GATE BEHIND IT, which is the half that costs a port real money. A document naming
  // the date in its prompt while its `estimate` computed still gates on four fields would be
  // worse than the drift it replaced: the sentence would promise a gate the snippet below it
  // does not implement.
  const gate = /const estimate = computed\(\(\) => \{[\s\S]*?\n\}\)/.exec(dossier);
  assert.ok(gate, 'the dossier must still show the `estimate` computed that gates the panel');
  assert.match(gate[0], /!date\.value/,
    'the dossier\'s estimate gate must require the import date, as run() does — without it a '
    + 'cleared date reaches the engine as calendar year 0 and the panel blames the published '
    + 'rules for a blank field');
});
