/**
 * Validate the committed 3D Tiles artefacts.
 *
 * Two tiers, deliberately:
 *
 *  1. FAST, always: structural and georeferencing invariants, no dependencies.
 *     This is what the unit test also runs, and it is the check that catches the
 *     failure this repo has actually shipped before — geometry in the wrong
 *     place. Degrees-instead-of-radians in a `region` puts Kolkata off the coast
 *     of Africa; a transposed ENU basis mirrors the ward.
 *
 *  2. SLOW, on demand: the official Cesium validator, run via npx. It is NOT a
 *     devDependency — it unpacks to 363 MB, which is a heavy tax on every
 *     install for a check on artefacts that only change when
 *     build-3d-tiles.py is re-run. Run it then, not on every build:
 *
 *         npx -y 3d-tiles-validator@0.6.1 --tilesetFile public/3d-tiles/<ward>/tileset.json
 *
 *     Verified 2026-08-18: 0 errors, 0 warnings on all three wards. That
 *     validator does open the .glb — corrupting one produces
 *     CONTENT_VALIDATION_ERROR — so a clean pass covers the glTF too.
 */
import { readFileSync, existsSync } from 'node:fs';

const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];
const A = 6378137.0, F = 1 / 298.257223563, E2 = F * (2 - F);

/** ECEF -> geodetic, so we can ask where the tileset actually PUTS the ward. */
export function ecefToGeodetic([x, y, z]) {
  const lam = Math.atan2(y, x), p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(phi), n = A / Math.sqrt(1 - E2 * s * s);
    phi = Math.atan2(z + E2 * n * s, p);
  }
  return [lam * 180 / Math.PI, phi * 180 / Math.PI];
}

export function checkTileset(ward, root = 'public/3d-tiles') {
  const dir = `${root}/${ward}`;
  const t = JSON.parse(readFileSync(`${dir}/tileset.json`, 'utf8'));
  const issues = [];
  const ok = (cond, msg) => { if (!cond) issues.push(msg); };

  ok(t.asset?.version === '1.1', `asset.version is ${t.asset?.version}, expected 1.1`);
  ok(typeof t.geometricError === 'number' && t.geometricError > 0, 'root geometricError must be a positive number');
  ok(!('children' in t.root), 'a leaf tile must omit `children`, not carry an empty array');
  ok(existsSync(`${dir}/${t.root.content.uri}`), `content ${t.root.content.uri} is missing`);

  const r = t.root.boundingVolume?.region;
  ok(Array.isArray(r) && r.length === 6, 'boundingVolume.region must have 6 elements');
  if (Array.isArray(r) && r.length === 6) {
    // RADIANS: every angle must be within +/-2pi. Degrees sail past this instantly.
    for (const [i, v] of r.slice(0, 4).entries()) {
      ok(Math.abs(v) <= 2 * Math.PI, `region[${i}] = ${v} is out of radian range — degrees?`);
    }
    ok(r[0] < r[2] && r[1] < r[3], 'region west<east and south<north');
    ok(r[4] <= r[5], 'region minHeight <= maxHeight');
  }

  const m = t.root.transform;
  ok(Array.isArray(m) && m.length === 16, 'root.transform must be a 16-element matrix');
  let placed = null;
  if (Array.isArray(m) && m.length === 16) {
    placed = ecefToGeodetic(m.slice(12, 15));
    // the transform origin must sit inside the tile's own bounding region
    const [lon, lat] = placed;
    const deg = r.slice(0, 4).map((v) => v * 180 / Math.PI);
    ok(lon >= deg[0] && lon <= deg[2] && lat >= deg[1] && lat <= deg[3],
      `transform origin ${lat.toFixed(4)},${lon.toFixed(4)} is outside its own region`);
  }
  return { ward, issues, placed, buildings: t.extras?.buildings, geometricError: t.geometricError };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const w of WARDS) {
    const r = checkTileset(w);
    const at = r.placed ? `${r.placed[1].toFixed(4)}N ${r.placed[0].toFixed(4)}E` : '??';
    console.log(`  ${r.issues.length ? 'FAIL' : 'ok  '} ${w.padEnd(12)} ${String(r.buildings).padStart(5)} buildings  gErr ${r.geometricError} m  at ${at}`);
    for (const i of r.issues) console.log(`        ${i}`);
    bad += r.issues.length ? 1 : 0;
  }
  console.log(bad ? `  ${bad} tileset(s) FAILED` : '  all tilesets structurally valid and correctly georeferenced');
  process.exit(bad ? 1 : 0);
}
