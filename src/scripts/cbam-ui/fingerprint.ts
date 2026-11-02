// src/scripts/cbam-ui/fingerprint.ts
// A hash drawn as dots (spec §5.1 Provenance, §5.5 Export): its first 64 bits, the first 16 hex
// characters, as an 8 × 8 grid, most significant bit first, row by row. Exactly the prefix the
// stamp prints as text, so the drawing never shows more than the words beside it. aria-hidden:
// the hex prefix is the accessible form.

const HEX16 = /^[0-9a-f]{16}/i;

/** 64 booleans, or null when the string does not start with 16 hex digits (a placeholder). */
export function fingerprintBits(hash: string): boolean[] | null {
  const m = HEX16.exec(hash);
  if (!m) return null;
  const bits: boolean[] = [];
  for (const ch of m[0]) {
    const n = parseInt(ch, 16);
    for (let b = 3; b >= 0; b -= 1) bits.push(((n >> b) & 1) === 1);
  }
  return bits;
}

/** The dot grid, or '' when there are no bits to draw. `extraClass` is ours, never user text. */
export function renderFingerprint(hash: string, extraClass = ''): string {
  const bits = fingerprintBits(hash);
  if (!bits) return '';
  const cls = extraClass ? `b-fp ${extraClass}` : 'b-fp';
  return `<div class="${cls}" aria-hidden="true">${bits.map((on) => (on ? '<i class="on"></i>' : '<i></i>')).join('')}</div>`;
}
