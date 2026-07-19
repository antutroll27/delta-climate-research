import { readFile, readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const SITE_URL = 'https://deltaclimate.earth';
const DEFAULT_DIST = 'dist';
const DEFAULT_OUTPUT = '.astro/reports/publication-contract.json';

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const toPosix = (path) => path.split(sep).join('/');

async function literalArrayExport(sourceUrl, exportName) {
  const sourcePath = fileURLToPath(sourceUrl);
  const source = await readFile(sourcePath, 'utf8');
  const declaration = new RegExp(`export\\s+const\\s+${exportName}\\b[^=]*=\\s*\\[`).exec(source);
  if (!declaration) throw new Error(`Could not find literal array export ${exportName} in ${sourcePath}.`);

  const start = declaration.index + declaration[0].lastIndexOf('[');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let end = -1;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && nextCharacter === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end === -1) throw new Error(`Unterminated literal array export ${exportName} in ${sourcePath}.`);
  const value = runInNewContext(`(${source.slice(start, end)})`, Object.create(null), { timeout: 100 });
  if (!Array.isArray(value)) throw new Error(`${exportName} must be an array.`);
  return value;
}

const papers = await literalArrayExport(new URL('../src/data/papers.ts', import.meta.url), 'papers');
const projects = await literalArrayExport(new URL('../src/data/projects.ts', import.meta.url), 'projects');

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}

const distDirectory = resolve(optionValue('--dist', DEFAULT_DIST));
const outputPath = resolve(optionValue('--output', DEFAULT_OUTPUT));

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..';
}

if (outputPath === distDirectory || isInside(distDirectory, outputPath)) {
  throw new Error('The report must be written outside dist so it cannot alter or ship with the build.');
}

try {
  if (!(await stat(distDirectory)).isDirectory()) throw new Error();
} catch {
  throw new Error(`Build directory not found: ${distDirectory}. Run the production build first.`);
}

function htmlPathForRoute(route) {
  if (route === '/') return 'index.html';
  if (route === '/404.html') return '404.html';
  return `${route.slice(1)}index.html`;
}

function canonicalUrlForRoute(route) {
  return `${SITE_URL}${route}`;
}

function attributes(tag) {
  const values = new Map();
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of tag.matchAll(expression)) {
    values.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return values;
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function metaContents(html, attributeName, attributeValue) {
  const contents = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const values = attributes(match[0]);
    if (values.get(attributeName)?.trim().toLowerCase() === attributeValue.toLowerCase()) {
      contents.push(values.get('content') ?? null);
    }
  }
  return contents;
}

function metaContent(html, attributeName, attributeValue) {
  return metaContents(html, attributeName, attributeValue)[0] ?? null;
}

function canonicalHref(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const values = attributes(match[0]);
    const relations = (values.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (relations.includes('canonical')) return values.get('href') ?? null;
  }
  return null;
}

function titleText(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].trim()) : null;
}

function hasNoindex(html) {
  const directives = ['robots', 'googlebot']
    .flatMap((name) => metaContents(html, 'name', name))
    .filter((content) => content !== null)
    .flatMap((content) => content.toLowerCase().split(/[\s,]+/).filter(Boolean));
  return directives.includes('noindex') || directives.includes('none');
}

function hasPlaceholder(html) {
  return /class=["'][^"']*\bsoon-(?:draft|tide)\b[^"']*["']/i.test(html);
}

function xmlLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => decodeHtml(match[1].trim()));
}

async function sitemapData() {
  const indexFile = 'sitemap-index.xml';
  const indexPath = resolve(distDirectory, indexFile);
  const issues = [];
  let indexXml;

  try {
    indexXml = await readFile(indexPath, 'utf8');
  } catch {
    return {
      indexFile,
      referencedFiles: [],
      urls: [],
      issues: [{
        code: 'missing-sitemap-index',
        message: `Expected sitemap index ${indexFile}.`,
      }],
    };
  }

  const siteOrigin = new URL(SITE_URL).origin;
  const referencesByFile = new Map();

  for (const reference of xmlLocations(indexXml)) {
    let url;
    try {
      url = new URL(reference, `${SITE_URL}/${indexFile}`);
    } catch {
      issues.push({
        code: 'invalid-sitemap-reference',
        message: `Invalid sitemap reference in ${indexFile}: ${reference}`,
      });
      continue;
    }

    if (url.origin !== siteOrigin) {
      issues.push({
        code: 'cross-origin-sitemap-reference',
        message: `Sitemap reference must use ${siteOrigin}: ${url.href}`,
      });
      continue;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      issues.push({
        code: 'invalid-sitemap-reference',
        message: `Sitemap reference has an invalid encoded path: ${url.href}`,
      });
      continue;
    }

    const path = resolve(distDirectory, `.${pathname}`);
    if (!isInside(distDirectory, path)) {
      issues.push({
        code: 'invalid-sitemap-reference',
        message: `Sitemap reference resolves outside the build directory: ${url.href}`,
      });
      continue;
    }

    const file = toPosix(relative(distDirectory, path));
    if (!referencesByFile.has(file)) referencesByFile.set(file, { file, url: url.href });
  }

  const references = [...referencesByFile.values()]
    .sort((left, right) => compare(left.file, right.file) || compare(left.url, right.url));

  if (references.length === 0 && issues.length === 0) {
    issues.push({
      code: 'empty-sitemap-index',
      message: `${indexFile} does not reference any sitemap files.`,
    });
  }

  const urls = new Set();

  for (const reference of references) {
    let xml;
    try {
      xml = await readFile(resolve(distDirectory, reference.file), 'utf8');
    } catch {
      issues.push({
        code: 'missing-referenced-sitemap',
        message: `Referenced sitemap file is missing or unreadable: ${reference.file}`,
      });
      continue;
    }

    for (const url of xmlLocations(xml)) urls.add(url);
  }

  return {
    indexFile,
    referencedFiles: references.map((reference) => reference.file),
    urls: [...urls].sort(compare),
    issues,
  };
}

function routeContract(route, kind, expectedIndexable, placeholderExpected = null, label = null) {
  return { route, kind, expectedIndexable, placeholderExpected, label };
}

const anyPaperPublished = papers.some((paper) => paper.published);
const anyProjectPublished = projects.some((project) => project.published);
const routeContracts = [
  routeContract('/', 'core', true),
  routeContract('/team/', 'core', true),
  routeContract('/climate-highlights/', 'permanent-preview', false, true),
  routeContract('/white-papers/', 'paper-hub', anyPaperPublished, !anyPaperPublished),
  ...papers.map((paper) => routeContract(
    `/white-papers/${paper.slug}/`,
    'paper',
    paper.published,
    !paper.published,
    paper.title,
  )),
  routeContract('/projects/', 'project-hub', anyProjectPublished, !anyProjectPublished),
  ...projects.map((project) => routeContract(
    `/projects/${project.slug}/`,
    'project',
    project.published,
    !project.published,
    project.title,
  )),
  routeContract('/404.html', 'error', false),
].sort((left, right) => compare(left.route, right.route));

const sitemapResult = await sitemapData();
const sitemap = sitemapResult.urls;
const sitemapSet = new Set(sitemap);
const violations = [];
let checkCount = 0;

function check(condition, code, route, message) {
  checkCount += 1;
  if (!condition) violations.push({ code, route, message });
}

function checkUnique(items, key, kind) {
  const seen = new Set();
  for (const item of items) {
    check(!seen.has(item[key]), `duplicate-${kind}-${key}`, null, `${kind} ${key} must be unique: ${item[key]}`);
    seen.add(item[key]);
  }
}

async function builtDetailSlugs(directory) {
  try {
    const entries = await readdir(resolve(distDirectory, directory), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compare);
  } catch {
    return [];
  }
}

checkUnique(papers, 'id', 'paper');
checkUnique(papers, 'slug', 'paper');
checkUnique(projects, 'id', 'project');
checkUnique(projects, 'slug', 'project');

for (const issue of sitemapResult.issues) {
  check(false, issue.code, null, issue.message);
}

for (const [kind, directory, expectedSlugs] of [
  ['paper', 'white-papers', papers.map((paper) => paper.slug)],
  ['project', 'projects', projects.map((project) => project.slug)],
]) {
  const expected = new Set(expectedSlugs);
  for (const slug of await builtDetailSlugs(directory)) {
    check(
      expected.has(slug),
      `unexpected-${kind}-route`,
      `/${directory}/${slug}/`,
      `Built ${kind} route has no matching manifest entry: ${slug}`,
    );
  }
}

const routeResults = [];
for (const contract of routeContracts) {
  const htmlPath = htmlPathForRoute(contract.route);
  let html;
  try {
    html = await readFile(resolve(distDirectory, htmlPath), 'utf8');
  } catch {
    check(false, 'missing-html', contract.route, `Expected build output ${htmlPath}.`);
    routeResults.push({
      ...contract,
      html: htmlPath,
      exists: false,
    });
    continue;
  }

  const noindex = hasNoindex(html);
  const indexable = !noindex;
  const canonical = canonicalHref(html);
  const ogUrl = metaContent(html, 'property', 'og:url');
  const placeholder = hasPlaceholder(html);
  const canonicalExpected = contract.route === '/404.html' ? null : canonicalUrlForRoute(contract.route);
  const inSitemap = canonicalExpected ? sitemapSet.has(canonicalExpected) : false;

  check(
    indexable === contract.expectedIndexable,
    'indexability-mismatch',
    contract.route,
    `Expected indexable=${contract.expectedIndexable}, found indexable=${indexable}.`,
  );
  check(
    inSitemap === contract.expectedIndexable,
    'sitemap-membership-mismatch',
    contract.route,
    `Expected sitemap membership=${contract.expectedIndexable}, found ${inSitemap}.`,
  );

  if (contract.expectedIndexable) {
    check(
      canonical === canonicalExpected,
      'canonical-mismatch',
      contract.route,
      `Expected canonical ${canonicalExpected}, found ${canonical ?? 'none'}.`,
    );
  } else if (canonical !== null && canonicalExpected !== null) {
    check(
      canonical === canonicalExpected,
      'canonical-mismatch',
      contract.route,
      `Canonical must match its own route when present: expected ${canonicalExpected}, found ${canonical}.`,
    );
  }

  if (canonicalExpected !== null) {
    check(
      ogUrl === canonicalExpected,
      'og-url-mismatch',
      contract.route,
      `Expected og:url ${canonicalExpected}, found ${ogUrl ?? 'none'}.`,
    );
  }

  if (contract.placeholderExpected !== null) {
    check(
      placeholder === contract.placeholderExpected,
      'placeholder-mismatch',
      contract.route,
      `Expected placeholder=${contract.placeholderExpected}, found placeholder=${placeholder}.`,
    );
  }

  routeResults.push({
    ...contract,
    html: htmlPath,
    exists: true,
    title: titleText(html),
    noindex,
    indexable,
    canonical,
    ogUrl,
    placeholder,
    inSitemap,
  });
}

const expectedSitemap = routeContracts
  .filter((contract) => contract.expectedIndexable)
  .map((contract) => canonicalUrlForRoute(contract.route))
  .sort(compare);
const expectedSitemapSet = new Set(expectedSitemap);

for (const url of sitemap) {
  check(expectedSitemapSet.has(url), 'unexpected-sitemap-url', null, `Unexpected sitemap URL: ${url}`);
}
for (const url of expectedSitemap) {
  check(sitemapSet.has(url), 'missing-sitemap-url', null, `Missing sitemap URL: ${url}`);
}

violations.sort((left, right) => (
  compare(left.route ?? '', right.route ?? '')
  || compare(left.code, right.code)
  || compare(left.message, right.message)
));

const report = {
  schemaVersion: 1,
  status: violations.length === 0 ? 'pass' : 'fail',
  distDirectory: toPosix(relative(process.cwd(), distDirectory)) || '.',
  siteUrl: SITE_URL,
  summary: {
    checks: checkCount,
    violations: violations.length,
    routes: routeResults.length,
    expectedIndexableRoutes: routeContracts.filter((route) => route.expectedIndexable).length,
    sitemapUrls: sitemap.length,
  },
  publications: {
    papers: {
      total: papers.length,
      published: papers.filter((paper) => paper.published).map((paper) => paper.slug).sort(compare),
    },
    projects: {
      total: projects.length,
      published: projects.filter((project) => project.published).map((project) => project.slug).sort(compare),
    },
  },
  sitemap: {
    indexFile: sitemapResult.indexFile,
    referencedFiles: sitemapResult.referencedFiles,
    expected: expectedSitemap,
    actual: sitemap,
  },
  routes: routeResults,
  violations,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Publication contract: ${report.status.toUpperCase()}`);
console.log(`${checkCount} checks across ${routeResults.length} routes; ${violations.length} violations.`);
console.log(`Report: ${toPosix(relative(process.cwd(), outputPath))}`);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.code}${violation.route ? ` (${violation.route})` : ''}: ${violation.message}`);
  }
  process.exitCode = 1;
}
