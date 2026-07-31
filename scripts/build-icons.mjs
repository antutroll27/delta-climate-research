/**
 * Build the favicon / app-icon set from public/deltalogo.png.
 *
 * TWO ARTWORKS, NOT ONE. The mark's contour lines are its whole character, and
 * they survive down to 48px and no further — at 16px they collapse into a fuzzy
 * blue blob (verified by rendering it). ICO is a container of independent
 * images, so the 16px entry gets the SIMPLIFIED outline (the same silhouette the
 * old favicon.svg drew) and 32/48 get the real mark. That is what the format is
 * for; shipping one downscaled artwork at every size is the usual mistake.
 *
 * GOOGLE'S SEARCH FAVICON RULE: the icon it picks must be a square whose side is
 * a multiple of 48 (48, 96, 144...). Hence favicon-96.png, declared explicitly —
 * a 32px icon alone can leave the search result showing a generic globe.
 *
 * Written by hand rather than via a dependency: an ICO is a 6-byte header plus
 * one 16-byte directory entry per image plus the payloads, and PNG payloads are
 * accepted by every browser we support. That is ~30 lines, versus a package.
 *
 *   node scripts/build-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SRC = 'public/deltalogo.png';
const BG = { r: 5, g: 6, b: 6, alpha: 1 };          // --color-base #050606

/** The mark, trimmed of its transparent margin and re-padded to a consistent
 *  optical inset. Trimming first means every output has the same visual weight
 *  regardless of the source file's own padding. */
const markAt = async (size, { inset = 0.10, bg = null, radius = 0 } = {}) => {
  const trimmed = await sharp(SRC).trim().toBuffer();
  const inner = Math.round(size * (1 - inset * 2));
  const logo = await sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const pad = Math.round((size - inner) / 2);
  let img = sharp({ create: { width: size, height: size, channels: 4,
    background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, top: pad, left: pad }]);
  if (radius > 0) {
    const r = Math.round(size * radius);
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  return img.png({ compressionLevel: 9 }).toBuffer();
};

/** The 16px fallback: silhouette only, stroked thick enough to survive. Same
 *  geometry as the outgoing favicon.svg so the identity does not jump. */
const tinyMark = async (size) => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
       <rect width="32" height="32" rx="6" fill="#050606"/>
       <path d="M16 7 L25 24 H7 Z" fill="none" stroke="#07C9FD" stroke-width="2.6" stroke-linejoin="round"/>
     </svg>`);
  return sharp(svg).png({ compressionLevel: 9 }).toBuffer();
};

/** ICO container: 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image. */
function buildIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);       // 0 means 256
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);  // palette, reserved
    dir.writeUInt16LE(1, o + 4);                          // colour planes
    dir.writeUInt16LE(32, o + 6);                         // bits per pixel
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, dir, ...entries.map(e => e.data)]);
}

const out = [];
const write = (p, b) => { writeFileSync(p, b); out.push([p, b.length]); };

// favicon.ico — 16 simplified, 32/48 the real mark, all on the brand near-black
// so the tab icon reads on a light chrome as well as a dark one.
write('public/favicon.ico', buildIco([
  { size: 16, data: await tinyMark(16) },
  { size: 32, data: await markAt(32, { inset: 0.09, bg: BG, radius: 0.19 }) },
  { size: 48, data: await markAt(48, { inset: 0.09, bg: BG, radius: 0.19 }) },
]));

// Google search results: square, side a multiple of 48.
write('public/favicon-96.png',   await markAt(96,  { inset: 0.09, bg: BG, radius: 0.19 }));
// iOS home screen: no transparency, no rounding (the OS masks it itself).
write('public/apple-touch-icon.png', await markAt(180, { inset: 0.12, bg: BG }));
// PWA manifest
write('public/icon-192.png', await markAt(192, { inset: 0.10, bg: BG, radius: 0.19 }));
write('public/icon-512.png', await markAt(512, { inset: 0.10, bg: BG, radius: 0.19 }));
// Maskable: Android crops to a circle, so the mark sits inside the 40% safe zone.
write('public/icon-maskable-512.png', await markAt(512, { inset: 0.22, bg: BG }));
// The nav mark: transparent, 2x of its ~34px display size, plus a webp.
write('public/logo-mark-96.png',  await markAt(96, { inset: 0 }));
write('public/logo-mark-96.webp',
  await sharp(await markAt(96, { inset: 0 })).webp({ quality: 92 }).toBuffer());

for (const [p, n] of out) console.log(`  ${String(n).padStart(8)} bytes  ${p}`);
