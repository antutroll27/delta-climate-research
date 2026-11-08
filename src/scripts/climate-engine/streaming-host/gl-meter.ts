/**
 * gl-meter.ts — DEV ONLY: what the page really holds on the GPU, to set against the cost model (`gpuMB`, sheet-budgets.ts).
 *
 * Patches the WebGL2 prototype to total the live buffer bytes (bufferData minus deleteBuffer) and the live texture bytes
 * (texImage2D / texStorage2D minus deleteTexture), everything on the page included (MapLibre's too). It sees only what is
 * created AFTER it is installed, and texture bytes are rough (width x height x the format's size, mips ignored). It does not
 * see the drawing buffer (the canvas swap chain: at phone DPR 3 with depth and MSAA roughly 24-48 MB, per the P3b audit) or
 * driver padding. `jsHeapMB` is Chromium's `performance.memory` and is null elsewhere.
 */
export interface Measured {
  readonly glBufferMB: number;
  readonly glTextureMB: number;
  readonly jsHeapMB: number | null;
  /** What is NOT in these numbers. */
  readonly excludes: string;
}

let installed = false;
let bufferBytes = 0, textureBytes = 0;

export function installGlMeter(): void {
  if (installed || typeof WebGL2RenderingContext === 'undefined') return;
  installed = true;
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const boundBuffer = new WeakMap<object, Map<number, WebGLBuffer | null>>();
  const sizes = new WeakMap<WebGLBuffer, number>();
  const texSizes = new WeakMap<WebGLTexture, number>();
  const boundTexture = new WeakMap<object, Map<number, WebGLTexture | null>>();
  const wrap = (name: string, fn: (self: object, args: unknown[], original: (...a: unknown[]) => unknown) => unknown): void => {
    const original = proto[name];
    if (typeof original !== 'function') return;
    proto[name] = function (this: object, ...args: unknown[]) { return fn(this, args, original.bind(this)); };
  };
  const mapOf = <V,>(store: WeakMap<object, Map<number, V | null>>, self: object): Map<number, V | null> => {
    let m = store.get(self); if (!m) { m = new Map(); store.set(self, m); } return m;
  };
  wrap('bindBuffer', (self, [target, buffer], original) => { mapOf(boundBuffer, self).set(target as number, buffer as WebGLBuffer | null); return original(target, buffer); });
  wrap('bufferData', (self, args, original) => {
    const buffer = mapOf(boundBuffer, self).get(args[0] as number);
    const size = typeof args[1] === 'number' ? args[1] : (args[1] as ArrayBufferView | null)?.byteLength ?? 0;
    if (buffer) { bufferBytes += size - (sizes.get(buffer) ?? 0); sizes.set(buffer, size); }
    return original(...args);
  });
  wrap('deleteBuffer', (_self, [buffer], original) => { const b = buffer as WebGLBuffer | null; if (b) { bufferBytes -= sizes.get(b) ?? 0; sizes.delete(b); } return original(buffer); });
  wrap('bindTexture', (self, [target, texture], original) => { mapOf(boundTexture, self).set(target as number, texture as WebGLTexture | null); return original(target, texture); });
  const bytesPerPixel = (internal: number, type?: number): number => (type === 0x1406 || internal === 0x8814 ? 16 : type === 0x140b || internal === 0x881a ? 8 : 4);
  const countTexture = (self: object, args: unknown[], width: number, height: number, bpp: number): void => {
    const tex = mapOf(boundTexture, self).get(args[0] as number);
    if (!tex) return;
    const bytes = width * height * bpp;
    textureBytes += bytes - (texSizes.get(tex) ?? 0); texSizes.set(tex, bytes);
  };
  wrap('texImage2D', (self, args, original) => {
    if (typeof args[3] === 'number' && args[1] === 0) countTexture(self, args, args[3] as number, args[4] as number, bytesPerPixel(args[2] as number, args[7] as number));
    return original(...args);
  });
  wrap('texStorage2D', (self, args, original) => { countTexture(self, args, args[3] as number, args[4] as number, bytesPerPixel(args[2] as number)); return original(...args); });
  wrap('deleteTexture', (_self, [texture], original) => { const t = texture as WebGLTexture | null; if (t) { textureBytes -= texSizes.get(t) ?? 0; texSizes.delete(t); } return original(texture); });
}

export function measured(): Measured {
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return {
    glBufferMB: bufferBytes / 1e6, glTextureMB: textureBytes / 1e6, jsHeapMB: heap === undefined ? null : heap / 1e6,
    excludes: 'the drawing buffer (canvas swap chain, ~24-48 MB at phone DPR 3), driver padding, textures created before install, mip levels',
  };
}
