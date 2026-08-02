# Hero river — mobile touch interaction (parked prototype)

**Status:** designed + verified working, **NOT implemented** (reverted from the working tree 2026-07-08 on request). This doc holds the full code so it can be re-applied when we pick a mode.

## What it does
On a phone, dragging a finger across the hero river injects **ripple rings** where the finger is and/or **parallaxes the camera** with it — reusing the exact desktop pointer system. It's **scroll-safe**: the listeners are `passive` and never `preventDefault`, so vertical swipes still scroll the page natively; ripples just trail the finger.

**Cost:** ~free. The ripple shader path already runs on mobile (`uTier < 1.5`, tier 1 = coarse pointer) — it was simply never being fed touch coordinates. `URIPPLE` (ripple strength) is `0.7`; bump it for mobile if the rings read too subtle.

## Three modes (A/B via `#touch=` URL hash)
- `#touch=both` — ripples **+** camera parallax (fullest "it reacts to me")
- `#touch=ripple` — ripples only (water disturbed, camera fixed)
- `#touch=parallax` — parallax only (view drifts, water untouched)
- `#touch=off` — baseline / current behaviour

The prototype defaults to `both`. For production we drop the hash flag and hardcode the chosen mode (see "Shipping" below).

## The code

All edits are in [`src/scripts/river-scene.ts`](../src/scripts/river-scene.ts). The `DRACOLoader` import + wiring is **already shipped** (part of the flare fix) — only the touch block below is the prototype.

### 1. Add after the existing `pointermove` listener
Find:
```ts
  window.addEventListener('pointermove', onPointer, { passive: true });
```
Insert immediately below:
```ts
  // ── mobile touch: same parallax + ripple injection, driven by a finger.
  //    PROTOTYPE: mode from URL hash (#touch=both|ripple|parallax|off) so all
  //    three feels can be A/B'd on a real device before we pick one. Passive +
  //    never preventDefault → vertical swipes still scroll the page natively.
  let touchMode = 'both';
  const readTouchMode = () => { const m = /touch=(both|ripple|parallax|off)/.exec(location.hash); touchMode = m ? m[1] : 'both'; };
  readTouchMode();
  window.addEventListener('hashchange', readTouchMode);
  const spawnRipple = (clientX: number, clientY: number) => {
    if (reduce) return;
    const now = performance.now();
    if (now - lastRipple < 70) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(waterPlane, hit)) {
      rippleArr[rippleIdx].set(hit.x, hit.z, UTIME.value);
      rippleIdx = (rippleIdx + 1) % RIPPLE_MAX;
      lastRipple = now;
    }
  };
  const onTouch = (e: TouchEvent) => {
    if (touchMode === 'off') return;
    const t = e.touches[0]; if (!t) return;
    if (touchMode === 'both' || touchMode === 'parallax') { camT.x = t.clientX / window.innerWidth - 0.5; camT.y = t.clientY / window.innerHeight - 0.5; }
    if (touchMode === 'both' || touchMode === 'ripple') spawnRipple(t.clientX, t.clientY);
  };
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
```

### 2. Add to the `dispose()` cleanup
Find (inside `dispose`):
```ts
    window.removeEventListener('pointermove', onPointer);
    dracoLoader.dispose();
```
Change to:
```ts
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('hashchange', readTouchMode);
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('touchmove', onTouch);
    dracoLoader.dispose();
```

## Dependencies these lines rely on (already present in the scene)
- `onPointer` / `camT` — camera parallax target (desktop pointer path)
- `raycaster`, `ndc`, `hit`, `waterPlane` — cursor→water-surface raycast
- `rippleArr`, `rippleIdx`, `RIPPLE_MAX`, `lastRipple`, `UTIME` — ripple ring buffer + shader clock
- `reduce` — `prefers-reduced-motion` guard (skips ripples)

## Local test harness (also parked)
`public/river-touch-demo.html` — a phone menu linking the four `#touch=` modes. It's local-only (uncommitted). Serve the built site and open on a phone:
```
npm run build
python3 -m http.server 8100 --directory dist
# phone (same Wi-Fi): http://<mac-lan-ip>:8100/river-touch-demo.html
```
Synthetic-touch verification: `/tmp/touchtest.mjs <url> <out.png>` dispatches a CDP touch drag across the river band.

## Shipping later (once a mode is picked)
1. Re-apply the two edits above.
2. Replace the hash-flag machinery with the chosen mode. E.g. for **ripples + parallax**, drop `readTouchMode`/`hashchange`/the `location.hash` regex and just inline the behaviour (or set `const touchMode = 'both'` as a constant and delete the hash reads).
3. Delete `public/river-touch-demo.html`.
4. Gate to touch devices if desired (the handlers are touch-event-only, so they're already inert on mouse-only desktops).
5. Verify: warm river (Draco fix), ripples follow the finger, vertical swipe still scrolls, no console errors. Ship.

## Open question for the user
Which mode: **ripples + parallax**, **ripples only**, or **parallax only**? And do the ripples need more strength on mobile (raise `URIPPLE` above `0.7`)?
