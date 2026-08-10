// mapillary-js Viewer — typed loosely to avoid a static type import of the heavy lib.
type Viewer = { moveTo: (id: string) => Promise<unknown>; remove: () => void };
let viewer: Viewer | null = null;
let mjs: Promise<typeof import('mapillary-js')> | null = null;

export function shouldOpen(token: string, imageId: string): boolean {
  return Boolean(token) && Boolean(imageId);
}

/** Open (or move) the Mapillary viewer to `imageId` inside `container`. Lazy-loads mapillary-js
 *  and its CSS on first open, so this module stays node-importable for unit tests. */
export async function openViewer(container: HTMLElement, imageId: string, token: string): Promise<void> {
  if (!shouldOpen(token, imageId)) return;
  await import('mapillary-js/dist/mapillary.css');
  const { Viewer } = await (mjs ??= import('mapillary-js'));
  if (viewer) { await viewer.moveTo(imageId).catch(() => {}); return; }
  viewer = new Viewer({ accessToken: token, container, imageId }) as unknown as Viewer;
}

/** Tear the viewer down (frees the WebGL context). Safe to call when nothing is open. */
export function closeViewer(): void {
  try { viewer?.remove(); } catch { /* already gone */ }
  viewer = null;
}

export function assertStreetViewLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`street-view: ${m}`); };
  ok(shouldOpen('MLY|t', 'i') === true, 'valid opens');
  ok(shouldOpen('', 'i') === false && shouldOpen('t', '') === false, 'guards missing inputs');
}
