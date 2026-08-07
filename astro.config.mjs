// @ts-check
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

// Drive sitemap exclusion off the same `published` flags the pages use for
// `noindex`, so the two never drift: a coming-soon page is both noindexed AND
// absent from the sitemap, and flips into both the moment its data publishes.
import { papers } from './src/data/papers.ts';
import { projects } from './src/data/projects.ts';

/**
 * Vercel functions in `npm run dev`.
 *
 * The live-weather and Climate Clock calls go through Vercel serverless
 * functions. Vercel runs those in production — Astro's dev server does not, so
 * without this plugin `npm run dev` serves a 404 for both integrations.
 *
 * This mounts the SAME handler on Vite's connect server, adapting Vercel's
 * (req.query / res.status().json()) shape to Node's raw one. Dev only — `apply`
 * keeps it out of every build, so nothing here can reach production.
 */
/** @returns {import('vite').Plugin} */
function devApiProxies() {
  return {
    name: 'delta-dev-api-proxies',
    apply: 'serve',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      /**
       * @param {string} path
       * @param {() => Promise<{ default: (req: any, res: any) => Promise<void> }>} loadHandler
       */
      const mount = (path, loadHandler) => server.middlewares.use(path,
        /**
         * @param {import('node:http').IncomingMessage} req
         * @param {import('node:http').ServerResponse} res
         * @param {(err?: unknown) => void} next
         */
        async (req, res, next) => {
          const handler = (await loadHandler()).default;
          const url = new URL(req.url ?? '', 'http://localhost');
          const shim = {
            method: req.method,
            query: Object.fromEntries(url.searchParams),
          };
          const out = {
            /** @param {string} k @param {string} v */
            setHeader: (k, v) => res.setHeader(k, v),
            /** @param {number} code */
            status(code) { res.statusCode = code; return out; },
            /** @param {unknown} body */
            json(body) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(body));
            },
          };
          try { await handler(shim, out); } catch (err) { next(err); }
        });

      mount('/api/live', () => import('./api/live.js'));
      mount('/api/climate-clock', () => import('./api/climate-clock.js'));
    },
  };
}

/** @param {string} page */
const sitemapFilter = (page) => {
  const path = new URL(page).pathname;
  if (path === '/climate-highlights/') return false;               // always coming-soon (no publish flag)
  if (path === '/blog/') return false;                             // coming-soon, no publish flag yet
  if (path === '/cbam/cbam-calculator/') return false;             // coming-soon, no publish flag yet
  // /cbam is the informational half of the CBAM pair and IS meant to be indexed
  // — but only once it has the explainer copy. Until then it is noindex like any
  // other coming-soon page, and this line comes out with the placeholder.
  if (path === '/cbam/') return false;
  // /heat-map is indexable and carries its caveats on the page. Its SUB-routes
  // are not: /heat-map/brief and /heat-map/compare are deep-link views of the
  // same tool, and indexing near-duplicates makes them compete with the page
  // they are views of.
  // NOTE the `!== '/heat-map/'`. Sitemap paths carry a trailing slash, so the
  // main route IS '/heat-map/' and a bare startsWith would exclude the very page
  // this change exists to include.
  if (path !== '/heat-map/' && path.startsWith('/heat-map/')) return false;
  if (path === '/HeatMapVisualizer/') return false;               // legacy stub route, removed
  if (path === '/white-papers/') return papers.some((p) => p.published);
  if (path === '/projects/') return projects.some((p) => p.published);
  const wp = path.match(/^\/white-papers\/([^/]+)\/$/);
  if (wp) return papers.some((p) => p.slug === wp[1] && p.published);
  const pr = path.match(/^\/projects\/([^/]+)\/$/);
  if (pr) return projects.some((p) => p.slug === pr[1] && p.published);
  return true;
};

// Tailwind v4 runs through its Vite plugin. Astro 6 could not do this — the
// rolldown-vite binding it shipped was incompatible with the plugin, so Tailwind
// went via PostCSS instead. Astro 7 ships real Vite 8, where the plugin works and
// the PostCSS route does NOT: Vite 8's postcss-import resolves `@import
// "tailwindcss"` as a relative file path and the build dies with ENOENT.
// https://astro.build/config
export default defineConfig({
  site: 'https://deltaclimate.earth',
  // Astro 7 changed this default to 'jsx', which strips whitespace between
  // inline elements by JSX rules rather than HTML-aware ones. That is a silent
  // visual change on a site whose typography is deliberate, so hold the v6
  // behaviour. ponytail: drop this line to take the v7 default once the type
  // has been eyeballed against it.
  compressHTML: true,
  // The calculator moved under /cbam/ so the pair reads as a hierarchy. The flat
  // URL was already deployed and is in the nav of any cached page, so it
  // redirects rather than 404s.
  redirects: { '/cbam-calculator': '/cbam/cbam-calculator' },
  integrations: [
    // Omit <lastmod> until routes have content-owned modification dates. A
    // deploy timestamp would falsely mark every page as newly updated.
    sitemap({ filter: sitemapFilter }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss(), devApiProxies()],
    // KEEP VITE'S CACHE OFF THIS REPO'S VOLUME.
    //
    // The working copy lives on an exFAT external disk. Vite and esbuild MMAP
    // the dependency-optimisation cache, and "Re-optimizing dependencies"
    // rewrites those files underneath the live mapping. APFS tolerates that;
    // exFAT via macOS's fskit driver does not, and the process dies with
    // `zsh: bus error` (SIGBUS) — a fault in the memory mapping, not in any JS.
    //
    // tmpdir() is APFS on macOS and /tmp on Linux, so this is correct on a
    // laptop and on the Vercel builder without branching. The only cost is an
    // occasional cold pre-bundle when the OS reaps the temp directory.
    cacheDir: join(tmpdir(), 'vite-delta-climate'),
    // Warning boundary above the LARGEST chunk we knowingly ship, so growth is
    // noisy and the warning still means something.
    //
    // 600 was set against the shared three runtime (~568 kB raw / ~142 kB gzip)
    // and was wrong from the start: /heat-map's page entry inlines maplibre-gl
    // and has always been ~797 kB raw / 214 kB gzip, so every single build
    // printed the warning and nobody could have spotted a real regression in it.
    // That chunk is deliberate — maplibre loads on /heat-map ONLY (verified
    // absent from / and /team), and it imports three from the shared chunk
    // rather than duplicating it.
    build: { chunkSizeWarningLimit: 850 },
    // Pre-bundle three + EVERY addon both WebGL islands use (the hero river AND
    // the About ocean's code-split Water.js), so Vite optimizes once at startup
    // and never re-optimizes mid-session — which otherwise 504s ("Outdated
    // Optimize Dep") the late-hydrating About ocean. Including the addons next to
    // 'three' also keeps them on the SAME three instance (no duplicate-module bug).
    optimizeDeps: {
      include: [
        'three', 'gsap', 'gsap/ScrollTrigger', 'lenis', 'maplibre-gl',
        'three/examples/jsm/utils/BufferGeometryUtils.js',
        'three/examples/jsm/objects/Water.js',
        'three/examples/jsm/loaders/GLTFLoader.js',
        'three/examples/jsm/loaders/DRACOLoader.js',
        'three/examples/jsm/libs/meshopt_decoder.module.js',
        'three/examples/jsm/postprocessing/EffectComposer.js',
        'three/examples/jsm/postprocessing/RenderPass.js',
        'three/examples/jsm/postprocessing/UnrealBloomPass.js',
        'three/examples/jsm/postprocessing/OutputPass.js',
        'three/examples/jsm/environments/RoomEnvironment.js',
        // Astro's ClientRouter virtual modules. These are NOT three addons and
        // they are the actual cause of the first-load "504 Outdated Optimize
        // Dep": Vite cannot see them by static analysis, discovers them on the
        // first navigation, re-optimises and forces a reload. Naming them here
        // moves that work to startup, where nothing is waiting on it.
        'astro/virtual-modules/transitions-router.js',
        'astro/virtual-modules/transitions-types.js',
        'astro/virtual-modules/transitions-events.js',
        'astro/virtual-modules/transitions-swap-functions.js',
      ],
    },
  },
});
