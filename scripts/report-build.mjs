import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, posix, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const DEFAULT_DIST = 'dist';
const DEFAULT_OUTPUT = '.astro/reports/build-report.json';

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const toPosix = (path) => path.split(sep).join('/');

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

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compare(left.name, right.name));
  const paths = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }

  return paths;
}

function assetCategory(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.js' || extension === '.mjs') return 'javascript';
  if (extension === '.css') return 'stylesheets';
  if (['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp'].includes(extension)) return 'images';
  if (['.eot', '.otf', '.ttf', '.woff', '.woff2'].includes(extension)) return 'fonts';
  if (['.bin', '.glb', '.gltf', '.wasm'].includes(extension)) return 'modelsAndBinary';
  if (['.html', '.xml', '.txt', '.json', '.webmanifest'].includes(extension)) return 'documents';
  return 'other';
}

const absoluteFiles = await walk(distDirectory);
const files = [];

for (const path of absoluteFiles) {
  const contents = await readFile(path);
  const relativePath = toPosix(relative(distDirectory, path));
  files.push({
    path: relativePath,
    category: assetCategory(relativePath),
    rawBytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
    ...(assetCategory(relativePath) === 'javascript'
      ? { gzipBytes: gzipSync(contents, { level: 9, mtime: 0 }).byteLength }
      : {}),
  });
}

files.sort((left, right) => compare(left.path, right.path));

const jsFiles = new Map(
  files
    .filter((file) => file.category === 'javascript')
    .map((file) => [file.path, file]),
);

function resolveModuleReference(importer, reference) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  if (!cleanReference || /^(?:[a-z]+:)?\/\//i.test(cleanReference) || cleanReference.startsWith('data:')) {
    return null;
  }

  const resolved = cleanReference.startsWith('/')
    ? cleanReference.slice(1)
    : posix.normalize(posix.join(posix.dirname(importer), cleanReference));

  return jsFiles.has(resolved) ? resolved : null;
}

function moduleReferences(sourcePath, source) {
  const staticImports = new Set();
  const dynamicImports = new Set();
  const literalReference = /(["'])(\.{1,2}\/[^"']+\.js(?:[?#][^"']*)?|\/[^"']+\.js(?:[?#][^"']*)?)\1/g;

  for (const match of source.matchAll(literalReference)) {
    const resolved = resolveModuleReference(sourcePath, match[2]);
    if (!resolved) continue;
    const prefix = source.slice(Math.max(0, match.index - 32), match.index);
    if (/\bimport\(\s*$/.test(prefix)) dynamicImports.add(resolved);
    else staticImports.add(resolved);
  }

  return {
    staticImports: [...staticImports].sort(compare),
    dynamicImports: [...dynamicImports].sort(compare),
  };
}

const moduleGraph = new Map();
for (const path of [...jsFiles.keys()].sort(compare)) {
  const source = await readFile(resolve(distDirectory, path), 'utf8');
  moduleGraph.set(path, moduleReferences(path, source));
}

function localJavaScriptUrl(url, importer = 'index.html') {
  return resolveModuleReference(importer, url);
}

function tagAttributes(tag) {
  const attributes = new Map();
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of tag.matchAll(expression)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

const JAVASCRIPT_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function executableInlineScriptKind(declaredType) {
  const type = declaredType.trim().toLowerCase().split(';', 1)[0].trim();
  if (type === '' || JAVASCRIPT_MIME_TYPES.has(type)) return 'classic';
  if (type === 'module') return 'module';
  return null;
}

function summarizeInlineJavaScript(html) {
  const scripts = [];
  let documentIndex = 0;

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = tagAttributes(`<script${match[1]}>`);
    const currentIndex = documentIndex;
    documentIndex += 1;
    if (attributes.has('src')) continue;

    const declaredType = attributes.get('type')?.trim() ?? '';
    const kind = executableInlineScriptKind(declaredType);
    if (kind === null) continue;

    const contents = Buffer.from(match[2]);
    scripts.push({
      documentIndex: currentIndex,
      kind,
      declaredType: declaredType || null,
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9, mtime: 0 }).byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }

  return {
    scriptCount: scripts.length,
    rawBytes: scripts.reduce((total, script) => total + script.rawBytes, 0),
    gzipBytes: scripts.reduce((total, script) => total + script.gzipBytes, 0),
    scripts,
  };
}

function htmlModuleRoots(htmlPath, html) {
  const startup = new Set();
  const lazy = new Set();

  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tagName = match[1].toLowerCase();
    const attributes = tagAttributes(match[0]);
    const reference = tagName === 'script' ? attributes.get('src') : attributes.get('href');
    if (!reference) continue;
    if (tagName === 'link' && attributes.get('rel')?.toLowerCase() !== 'modulepreload') continue;
    const resolved = localJavaScriptUrl(reference, htmlPath);
    if (resolved) startup.add(resolved);
  }

  for (const attribute of ['component-url', 'renderer-url', 'before-hydration-url']) {
    const expression = new RegExp(`${attribute}=["']([^"']+)["']`, 'gi');
    for (const match of html.matchAll(expression)) {
      const resolved = localJavaScriptUrl(match[1], htmlPath);
      if (resolved) lazy.add(resolved);
    }
  }

  for (const match of html.matchAll(/\bimport\(\s*["']([^"']+\.js(?:[?#][^"']*)?)["']\s*\)/g)) {
    const resolved = localJavaScriptUrl(match[1], htmlPath);
    if (resolved) lazy.add(resolved);
  }

  return {
    startup: [...startup].sort(compare),
    lazy: [...lazy].sort(compare),
  };
}

function graphClosure(seeds, includeDynamicImports) {
  const visited = new Set();
  const queue = [...seeds].sort(compare);

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || visited.has(path) || !moduleGraph.has(path)) continue;
    visited.add(path);
    const node = moduleGraph.get(path);
    const references = includeDynamicImports
      ? [...node.staticImports, ...node.dynamicImports]
      : node.staticImports;
    for (const reference of references.sort(compare)) {
      if (!visited.has(reference)) queue.push(reference);
    }
    queue.sort(compare);
  }

  return visited;
}

function routeFromHtml(path) {
  if (path === 'index.html') return '/';
  if (path === '404.html') return '/404.html';
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`;
  return `/${path.slice(0, -'.html'.length)}`;
}

function summarizeJavaScript(paths) {
  const sortedPaths = [...paths].sort(compare);
  return {
    fileCount: sortedPaths.length,
    rawBytes: sortedPaths.reduce((total, path) => total + jsFiles.get(path).rawBytes, 0),
    gzipBytes: sortedPaths.reduce((total, path) => total + jsFiles.get(path).gzipBytes, 0),
    files: sortedPaths,
  };
}

const htmlFiles = files.filter((file) => file.path.endsWith('.html'));
if (htmlFiles.length === 0) throw new Error(`No HTML files found in ${distDirectory}.`);

const routes = [];
for (const file of htmlFiles) {
  const html = await readFile(resolve(distDirectory, file.path), 'utf8');
  const roots = htmlModuleRoots(file.path, html);
  const startup = graphClosure(roots.startup, false);
  const reachable = graphClosure([...startup, ...roots.lazy], true);
  const lazyReachable = new Set([...reachable].filter((path) => !startup.has(path)));
  const startupModules = summarizeJavaScript(startup);
  const inlineStartup = summarizeInlineJavaScript(html);

  routes.push({
    route: routeFromHtml(file.path),
    html: file.path,
    directStartupRoots: roots.startup,
    directLazyRoots: roots.lazy,
    javascript: {
      startup: startupModules,
      inlineStartup,
      startupTotal: {
        moduleFileCount: startupModules.fileCount,
        inlineScriptCount: inlineStartup.scriptCount,
        rawBytes: startupModules.rawBytes + inlineStartup.rawBytes,
        gzipBytes: startupModules.gzipBytes + inlineStartup.gzipBytes,
      },
      lazyReachable: summarizeJavaScript(lazyReachable),
      allReachable: summarizeJavaScript(reachable),
    },
  });
}
routes.sort((left, right) => compare(left.route, right.route));

const siteStartup = new Set(routes.flatMap((route) => route.javascript.startup.files));
const siteReachable = new Set(routes.flatMap((route) => route.javascript.allReachable.files));
const siteLazyReachable = new Set([...siteReachable].filter((path) => !siteStartup.has(path)));
const notModuleGraphReachable = new Set([...jsFiles.keys()].filter((path) => !siteReachable.has(path)));
const applicationBundle = new Set([...jsFiles.keys()].filter((path) => path.startsWith('_astro/')));
const publicJavaScript = new Set([...jsFiles.keys()].filter((path) => !path.startsWith('_astro/')));

const categoryTotals = {};
for (const category of [...new Set(files.map((file) => file.category))].sort(compare)) {
  const categoryFiles = files.filter((file) => file.category === category);
  categoryTotals[category] = {
    fileCount: categoryFiles.length,
    rawBytes: categoryFiles.reduce((total, file) => total + file.rawBytes, 0),
  };
}

const report = {
  schemaVersion: 1,
  distDirectory: toPosix(relative(process.cwd(), distDirectory)) || '.',
  measurementNotes: [
    'Gzip sizes are the sum of each external file or executable inline script body compressed independently at level 9.',
    'Application-bundle JavaScript is emitted under _astro; public JavaScript is reported separately.',
    'Startup modules are local script/modulepreload roots plus their static imports.',
    'Executable inline script bodies are measured per route and included in that route\'s startupTotal; they are not deduplicated across routes or added to site-wide module totals.',
    'Inline-script gzip bytes are diagnostic body measurements, not the compressed transfer size of the containing HTML response.',
    'Lazy-reachable modules are hydration roots and dynamic imports reachable from a route, not proof that a browser requested them.',
    'Files outside the ES-module graph, such as decoder helpers loaded by URL at runtime, are not classified as unused.',
  ],
  summary: {
    fileCount: files.length,
    routeCount: routes.length,
    rawBytes: files.reduce((total, file) => total + file.rawBytes, 0),
    categories: categoryTotals,
  },
  javascript: {
    allFiles: summarizeJavaScript(new Set(jsFiles.keys())),
    applicationBundle: summarizeJavaScript(applicationBundle),
    publicJavaScript: summarizeJavaScript(publicJavaScript),
    siteStartupModules: summarizeJavaScript(siteStartup),
    siteLazyReachableModules: summarizeJavaScript(siteLazyReachable),
    notModuleGraphReachable: summarizeJavaScript(notModuleGraphReachable),
    modules: [...moduleGraph.entries()]
      .sort(([left], [right]) => compare(left, right))
      .map(([path, references]) => ({
        path,
        rawBytes: jsFiles.get(path).rawBytes,
        gzipBytes: jsFiles.get(path).gzipBytes,
        sha256: jsFiles.get(path).sha256,
        ...references,
      })),
  },
  routes,
  files,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Build report: ${toPosix(relative(process.cwd(), outputPath))}`);
console.log(
  `JavaScript: ${report.javascript.allFiles.fileCount} files total `
  + `(${report.javascript.applicationBundle.fileCount} application-bundle, `
  + `${report.javascript.publicJavaScript.fileCount} public/static), `
  + `${report.javascript.allFiles.rawBytes} raw bytes, `
  + `${report.javascript.allFiles.gzipBytes} gzip bytes.`,
);
console.log(
  `Module reachability: ${report.javascript.siteStartupModules.gzipBytes} startup gzip bytes, `
  + `${report.javascript.siteLazyReachableModules.gzipBytes} lazy-reachable gzip bytes, `
  + `${report.javascript.notModuleGraphReachable.gzipBytes} not module-graph-reachable gzip bytes.`,
);
