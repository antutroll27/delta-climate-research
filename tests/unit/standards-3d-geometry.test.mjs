import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/* Structural validity is not correctness. cjval and 3d-tiles-validator both pass
   on geometry that is the wrong SHAPE or SCALE, or inside out — they check
   indices, schemas and closure, not whether the buildings match the city.
   This decodes the shipped GLB and measures it against the source footprints.

   Summing only UPWARD-facing horizontal faces is deliberate: if roof normals were
   flipped, the total would collapse toward zero rather than matching. So one
   assertion covers area, scale and winding at once. */
function readGlb(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

const M_PER_DEG_LAT = 110540;
const shoelace = (ring) => {
  const mx = 111320 * Math.cos((ring[0][1] * Math.PI) / 180);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * mx * ring[i + 1][1] * M_PER_DEG_LAT - ring[i + 1][0] * mx * ring[i][1] * M_PER_DEG_LAT;
  }
  return Math.abs(s) / 2;
};

for (const ward of ['ballygunge', 'barrackpore', 'baruipur']) {
  test(`${ward}: the shipped 3D mesh matches the source footprints in area, volume and winding`, () => {
    const { json, bin } = readGlb(`public/3d-tiles/${ward}/content.glb`);
    const [pa, ia] = json.accessors;
    const pv = json.bufferViews[pa.bufferView], iv = json.bufferViews[ia.bufferView];
    const pos = [];
    for (let i = 0; i < pa.count; i++) {
      const o = pv.byteOffset + i * 12;
      pos.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
    }
    const wide = ia.componentType === 5125;
    const idx = [];
    for (let i = 0; i < ia.count; i++) {
      const o = iv.byteOffset + i * (wide ? 4 : 2);
      idx.push(wide ? bin.readUInt32LE(o) : bin.readUInt16LE(o));
    }

    let roof = 0, vol = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = pos[idx[i]], b = pos[idx[i + 1]], c = pos[idx[i + 2]];
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(a[2] - b[2]) < 1e-6 && Math.abs(b[2] - c[2]) < 1e-6 && a[2] > 0 && nz > 0) {
        roof += nz / 2; vol += (nz / 2) * a[2];
      }
    }

    const fp = JSON.parse(readFileSync(`data/geometry/${ward}-footprints.json`, 'utf8')).b;
    const hs = JSON.parse(readFileSync('data/geometry/heights-overture.json', 'utf8')).wards[ward];
    let srcArea = 0, srcVol = 0;
    fp.forEach((r, i) => {
      const a = shoelace(r.lonlat);
      const h = hs[i].fill || hs[i].p65 < 2.5 ? 2.5 : hs[i].p65;
      srcArea += a; srcVol += a * h;
    });

    // 2% covers the local-ENU vs metres-per-degree difference between the mesh
    // and this plan-area approximation; a real defect moves it far more.
    assert.ok(Math.abs(roof / srcArea - 1) < 0.02, `roof area ratio ${(roof / srcArea).toFixed(4)}`);
    assert.ok(Math.abs(vol / srcVol - 1) < 0.02, `volume ratio ${(vol / srcVol).toFixed(4)}`);
    assert.ok(roof > 0, 'zero roof area means the normals are inverted');
  });
}
