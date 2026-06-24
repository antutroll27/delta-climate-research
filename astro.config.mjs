// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

// Tailwind v4 runs via PostCSS (postcss.config.mjs) rather than the Vite plugin,
// to avoid a rolldown-vite binding incompatibility in Astro 6.
// https://astro.build/config
export default defineConfig({
  site: 'https://deltaclimate.earth',
  integrations: [sitemap(), react()],
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