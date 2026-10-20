// src/scripts/climate-engine/card-sink.ts — OBOS v2 on-map building card (brainstorm 04 §9): the ONE seam between the app's frame loop and the v2 card.
/**
 * v1 places #bcard itself, in heat-map-app.ts's placeCard, on every map render. v2 places the card with a keep-out solver (v2/place-card.ts, driven by
 * v2/card-v2.ts), and that code lives in the v2 shell, which mounts AFTER the app. This is where the shell hands itself to the app: while `current` is null
 * (v1, or v2 before the shell has mounted) every line of the app runs exactly as it did; once the shell sets it, the app hands over the roof's apex each frame
 * instead of writing the card, reads the card's cached box for the map labels (no per-frame getBoundingClientRect on the card), and asks where a roof picked
 * from the Solar list should land on screen. Client pixels throughout.
 */
export interface CardBox { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number }

export interface CardSink {
  /** called by the app on every map render while a building is selected. `apex` is the roof's apex on screen, null when it is behind the camera; `relief` is whether a 3-D map is there to project from. */
  place(apex: { readonly x: number; readonly y: number } | null, relief: boolean): void;
  /** the card's last placed box, null while it is hidden: the greenery tag and the ring labels keep clear of it */
  box(): CardBox | null;
  /** the lead line's thin box (null when docked or hidden): the tag and the ring labels keep off it too, or the line would run through their text */
  lead(): CardBox | null;
  /** where on the canvas (px from its top-left) a roof picked from a list should land so the card has room and nothing covers it; null = no opinion, centre it as v1 does */
  target(canvasW: number, canvasH: number, relief: boolean): { readonly x: number; readonly y: number } | null;
}

export const cardSink: { current: CardSink | null } = { current: null };
