import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * 2026-09-23 audit, item 1. The ward route rendered <Base> without `nativeScroll`,
 * so Lenis started on the OBOS page and cancelled every wheel event inside its side
 * panels — on a page whose own body never scrolls (HeatMapStage sets
 * body{overflow:hidden}). Base.astro states the rule: interactive tools manage their
 * own native scrolling and must not start Lenis. compare.astro and brief.astro
 * followed it; the ward route, the one people actually use, did not.
 */
const PAGES = 'src/pages/heat-map';
const astroFiles = readdirSync(PAGES, { recursive: true })
  .filter((f) => String(f).endsWith('.astro'))
  .map((f) => join(PAGES, String(f)));

test('every page that renders the OBOS stage opts out of Lenis', () => {
  const stages = astroFiles.filter((f) => readFileSync(f, 'utf8').includes('<HeatMapStage'));
  assert.ok(stages.length >= 1, `no page under ${PAGES} renders <HeatMapStage> — did the route move?`);
  for (const file of stages) {
    // The template only: past the frontmatter's closing ---, with template comments removed,
    // so a <Base …> written in a comment can neither satisfy nor fail the check.
    const template = readFileSync(file, 'utf8')
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const base = template.match(/<Base\b[^>]*>/s);
    assert.ok(base, `${file}: no <Base> element`);
    assert.match(base[0], /\bnativeScroll(?:=\{\s*true\s*\})?(?=[\s/>])/,
      `${file}: <Base> lacks nativeScroll, so Lenis will swallow wheel events in the panels`);
  }
});
