#!/usr/bin/env node
/**
 * Render a Markdown document to a print-quality PDF.
 *
 *     node scripts/md-to-pdf.mjs docs/green-score-methodology.md
 *
 * The methodology documents go to people outside engineering, so they need to
 * survive being read on a laptop and printed. Markdown -> styled HTML ->
 * Chromium print, which is the only toolchain already installed here (no
 * pandoc, no LaTeX).
 *
 * ponytail: python-markdown does the conversion because it ships with tables
 * and fenced code as bundled extensions; the repo's micromark would need three
 * more packages for the same thing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/md-to-pdf.mjs <file.md>');
  process.exit(1);
}
const srcPath = resolve(src);
const outPath = srcPath.replace(/\.md$/, '.pdf');
const md = readFileSync(srcPath, 'utf8');

const body = execFileSync('python3', ['-c', `
import sys, markdown
sys.stdout.write(markdown.markdown(
    sys.stdin.read(),
    extensions=['tables', 'fenced_code', 'attr_list', 'sane_lists'],
    output_format='html5'))
`], { input: md, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? basename(srcPath, '.md')).replace(/[*_`]/g, '');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root{ --ink:#1c2325; --mute:#5d6b6e; --line:#d8dedf; --accent:#0f5f68; --wash:#f4f7f7; }
  *{ box-sizing:border-box }
  body{ font:10.5pt/1.62 "Charter","Georgia","Times New Roman",serif; color:var(--ink); margin:0; }
  h1{ font-size:20pt; line-height:1.2; margin:0 0 .2em; letter-spacing:-.01em }
  h2{ font-size:14pt; margin:1.9em 0 .5em; padding-bottom:.28em; border-bottom:1.5px solid var(--accent);
      page-break-after:avoid; color:var(--accent) }
  h3{ font-size:11.5pt; margin:1.4em 0 .35em; page-break-after:avoid }
  p,li{ orphans:3; widows:3 }
  code{ font:9pt/1.5 "SF Mono",Menlo,Consolas,monospace; background:var(--wash); padding:.08em .3em; border-radius:2px }
  pre{ background:var(--wash); border:1px solid var(--line); border-radius:3px; padding:.7em .9em;
       overflow:visible; white-space:pre-wrap; page-break-inside:avoid }
  pre code{ background:none; padding:0 }
  table{ border-collapse:collapse; width:100%; margin:.9em 0; font-size:9pt; page-break-inside:avoid }
  th,td{ border:1px solid var(--line); padding:.42em .6em; text-align:left; vertical-align:top }
  th{ background:var(--wash); font-weight:600 }
  tr:nth-child(even) td{ background:#fbfcfc }
  hr{ border:0; border-top:1px solid var(--line); margin:1.8em 0 }
  a{ color:var(--accent); text-decoration:none; word-break:break-word }
  blockquote{ margin:1em 0; padding:.1em 0 .1em 1em; border-left:3px solid var(--line); color:var(--mute) }
  em{ color:var(--mute) }
  h1 + p{ color:var(--mute); font-size:9.5pt }
</style></head><body>${body}</body></html>`;

const tmp = `${outPath}.tmp.html`;
writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${tmp}`, { waitUntil: 'load' });
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    `<div style="width:100%;font:8pt Georgia,serif;color:#8b9698;padding:0 16mm;
      display:flex;justify-content:space-between">
      <span>${title}</span><span class="pageNumber"></span>
     </div>`,
});
await browser.close();
unlinkSync(tmp);

const pages = readFileSync(outPath).toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? '?';
console.log(`  ${outPath.split('/').slice(-2).join('/')}  ${pages} pages`);
