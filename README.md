# Delta Climate Research

The public site for Delta Climate Research, an interdisciplinary climate studio working across science, technology, policy, and finance. The site is built as a static Astro application with React islands for the WebGL scenes.

## Local setup

The project targets Node 24.11.1 and requires Node 22.12.0 or newer. With `nvm` installed:

```sh
nvm use
npm install
npm run dev
```

The development server is available at `http://localhost:4321` by default.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Astro in development mode |
| `npm run check` | Run Astro and TypeScript diagnostics |
| `npm run build` | Create the production build in `dist/` |
| `npm run test:unit` | Run dependency-free scheduling tests |
| `npm run report:build` | Measure the built asset and JavaScript graph |
| `npm run check:publication` | Validate indexing, canonicals, placeholders, and sitemap membership |
| `npm run verify` | Run diagnostics, unit tests, build, and both build contracts |
| `npm run test:e2e` | Build, preview, and run accessibility and normal-motion browser tests |
| `npm run preview` | Serve the production build locally |

## Project structure

- `src/pages/` defines the routes.
- `src/components/` contains Astro sections and React WebGL islands.
- `src/data/` is the source of truth for project and paper catalogue metadata.
- `src/scripts/` owns page transitions, scroll effects, live climate data, and the Three.js river scene.
- `src/styles/global.css` contains the design tokens, global utilities, and shared interaction states.
- `public/` contains the assets that are copied into the static build.
- `docs/`, `attic/`, `models-src/`, and `previews/` contain research, source material, and experiments that do not ship.

`src/layouts/Base.astro` owns the document shell, metadata, structured data, navigation lifecycle, and shared client initialization. Astro's client router means browser scripts must tolerate repeated page initialization and clean up their listeners or observers before navigation.

## Publishing content

Projects and papers remain honest coming-soon pages until their catalogue entry has real route content and its `published` flag is set to `true` in `src/data/projects.ts` or `src/data/papers.ts`. The same flags control route indexing and sitemap inclusion.

`npm run verify` writes machine-readable diagnostic reports to `.astro/reports/`. The build report separates startup JavaScript from lazy-reachable modules, inline executable scripts, and public helpers. The publication contract derives its expected routes from the project and paper manifests, then fails if build output disagrees with their publication flags. Reports are ignored by Git and never copied into `dist/`.

## Runtime and accessibility contracts

- Essential content and actions must remain available without WebGL or animation.
- Reduced-motion and lower-powered devices receive static or lighter-weight equivalents.
- The production hero uses `public/models/river-1k.glb`. Larger river models remain available as source inputs and are excluded from the Vercel build upload.
- Run `npm run verify` before deploying.
- Run `npm run test:e2e` after installing Playwright's Chromium browser when changing navigation, accessibility, loader, or WebGL lifecycle behavior.
