// src/scripts/climate-engine/v2/shell-ctx.ts — OBOS v2 shell types (plan amendment A1 S2.9). FROZEN: moved out of shell-v2.ts so every track's binder imports one stable file.
import type { Cleanup } from './dom.ts';
import type { SectionId } from './sections.ts';

export interface Sections { readonly go: (id: SectionId, side?: boolean) => void; readonly paint: () => void }
export interface LayerStack { open(el: HTMLElement, opener: HTMLElement | null, onClose?: () => void): void; closeTop(): boolean; isOpen(el: HTMLElement): boolean }
export interface ShellCtx { readonly root: HTMLElement; readonly cleanup: Cleanup; glassRefresh: () => void; sections?: Sections; layers?: LayerStack }
