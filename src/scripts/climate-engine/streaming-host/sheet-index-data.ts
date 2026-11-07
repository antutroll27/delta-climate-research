/**
 * sheet-index-data.ts: the data files the sheet index reads, loaded by bundler glob so that ABSENCE is a value, not an error.
 *
 *   area-names.json   neighbourhood names, written by scripts/build-area-names.py (committed with the app)
 *
 * `import.meta.glob` resolves to {} when a file does not exist, so a branch without the file builds and runs, and the UI falls
 * back to the table's own labels (names) or shows no building count (counts). Nothing here is copied into code.
 * Not imported by node tests: it needs the bundler. The parsers it calls (sheet-index.ts) are tested in node.
 */
import { parseAreaNames, type IndexExtras } from '../streaming/sheet-index.ts';

const NAMES = import.meta.glob('../../../../data/cities/amsterdam/area-names.json', { eager: true, import: 'default' });

const first = (m: Record<string, unknown>): unknown => Object.values(m)[0] ?? null;

export function loadIndexExtras(): IndexExtras {
  return { names: parseAreaNames(first(NAMES)) };
}
