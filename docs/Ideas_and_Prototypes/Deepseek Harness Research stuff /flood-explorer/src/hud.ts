// DOM refs for the static HUD in index.html. Wiring lives in main.ts.

function q<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

export const els = {
  root: q('hud'),
  rainSlider: q<HTMLInputElement>('rain-slider'),
  rainMm: q('rain-mm'),
  rainRate: q('rain-rate'),
  layerWater: q<HTMLInputElement>('layer-water'),
  layerDrain: q<HTMLInputElement>('layer-drain'),
  layerTerrain: q<HTMLInputElement>('layer-terrain'),
  cineToggle: q<HTMLButtonElement>('cine-toggle'),
  qualityChip: q('quality-chip'),
  truthToggle: q<HTMLButtonElement>('truth-toggle'),
  truthCard: q('truth-card'),
  mCsi: q('m-csi'),
  mF1: q('m-f1'),
  mPod: q('m-pod'),
  mFar: q('m-far'),
  totArea: q('tot-area'),
  totMax: q('tot-max'),
  totPop: q('tot-pop'),
  pinEmpty: q('pin-empty'),
  pinBody: q('pin-body'),
  pinDepth: q('pin-depth'),
  pinCell: q('pin-cell'),
  pinChip: q('pin-chip'),
  pinChipVal: q('pin-chip-val'),
  cursor: q('cursor-readout'),
  fps: q('fps'),
  skip: q<HTMLButtonElement>('skip-intro'),
  resetCam: q<HTMLButtonElement>('reset-cam'),
};
