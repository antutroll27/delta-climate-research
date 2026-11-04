// src/scripts/cbam-ui/updates.ts
// The hand-kept half of the Updates tile (spec 2026-11-04): law and our own corrections, one line
// each. Certificate prices are NOT listed here: tiles-rules.ts derives them from the pack, so a
// price can never be dated or valued differently from the one the calculator uses.
import RAW from './updates.json' with { type: 'json' };

export type UpdateKind = 'law' | 'data' | 'correction';
export interface UpdateEntry {
  readonly date: string; // YYYY-MM-DD: the Official Journal date for law, the go-live date for ours
  readonly kind: UpdateKind;
  readonly text: string;
  readonly source?: string;
}

export const UPDATES: readonly UpdateEntry[] = RAW as readonly UpdateEntry[];
