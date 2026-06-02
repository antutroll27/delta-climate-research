// @ts-check
import { defineConfig } from 'astro/config';

// Tailwind v4 runs via PostCSS (postcss.config.mjs) rather than the Vite plugin,
// to avoid a rolldown-vite binding incompatibility in Astro 6.
// https://astro.build/config
export default defineConfig({
  site: 'https://delta-climate-research.example',
});
