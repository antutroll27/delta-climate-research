// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

// Drive sitemap exclusion off the same `published` flags the pages use for
// `noindex`, so the two never drift: a coming-soon page is both noindexed AND
// absent from the sitemap, and flips into both the moment its data publishes.
import { papers } from './src/data/papers.ts';
import { projects } from './src/data/projects.ts';

const sitemapFilter = (page) => {
  const path = new URL(page).pathname;
  if (path === '/climate-highlights/') return false;               // always coming-soon (no publish flag)
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
  integrations: [sitemap({ filter: sitemapFilter }), react()],
  vite: {
    // Pre-bundle three + EVERY addon both WebGL islands use (the hero river AND
    // the About ocean's code-split Water.js), so Vite optimizes once at startup
    // and never re-optimizes mid-session — which otherwise 504s ("Outdated
    // Optimize Dep") the late-hydrating About ocean. Including the addons next to
    // 'three' also keeps them on the SAME three instance (no duplicate-module bug).
    optimizeDeps: {
      include: [
        'three', 'gsap', 'gsap/ScrollTrigger', 'lenis',
        'three/examples/jsm/objects/Water.js',
        'three/examples/jsm/loaders/GLTFLoader.js',
        'three/examples/jsm/libs/meshopt_decoder.module.js',
        'three/examples/jsm/postprocessing/EffectComposer.js',
        'three/examples/jsm/postprocessing/RenderPass.js',
        'three/examples/jsm/postprocessing/UnrealBloomPass.js',
        'three/examples/jsm/postprocessing/OutputPass.js',
        'three/examples/jsm/environments/RoomEnvironment.js',
      ],
    },
  },
});