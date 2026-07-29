// @ts-check
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

// Drive sitemap exclusion off the same `published` flags the pages use for
// `noindex`, so the two never drift: a coming-soon page is both noindexed AND
// absent from the sitemap, and flips into both the moment its data publishes.
import { papers } from './src/data/papers.ts';
import { projects } from './src/data/projects.ts';

/** @param {string} page */
const sitemapFilter = (page) => {
  const path = new URL(page).pathname;
  if (path === '/climate-highlights/') return false;               // always coming-soon (no publish flag)
  if (path === '/blog/') return false;                             // coming-soon, no publish flag yet
  if (path === '/cbam-calculator/') return false;                  // coming-soon, no publish flag yet
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

// Tailwind v4 runs via PostCSS (postcss.config.mjs) rather than the Vite plugin,
// to avoid a rolldown-vite binding incompatibility in Astro 6.
// https://astro.build/config
export default defineConfig({
  site: 'https://deltaclimate.earth',
  integrations: [
    // Omit <lastmod> until routes have content-owned modification dates. A
    // deploy timestamp would falsely mark every page as newly updated.
    sitemap({ filter: sitemapFilter }),
    react(),
  ],
  vite: {
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
    // The shared, tree-shaken Three runtime is ~549 kB raw / ~142 kB gzip.
    // Retain a warning boundary just above it so future vendor growth is noisy.
    build: { chunkSizeWarningLimit: 600 },
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
