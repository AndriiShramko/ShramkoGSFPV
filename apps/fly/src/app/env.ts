// The page's environment, read once when the page loads: the URL as it was opened (the scene link
// later rewrites ?scene=, nothing else reads it again) and what the browser can do.
import { h } from '../ui/dom';

export const q = new URLSearchParams(location.search);

export const hasWebGPU = typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
export const hasHid = typeof navigator !== 'undefined' && 'hid' in navigator;
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

/** A usage event to the site's /api/e; never fails the caller. */
export function beacon(e: string, p: Record<string, string | number | boolean> = {}): void {
    try {
        navigator.sendBeacon?.('/api/e', JSON.stringify({ e, p }));
    } catch {
        /* offline / blocked */
    }
}

/** A note along the top edge (no WebGPU, no WebHID); ui/hud.ts stacks them under each other. */
export function banner(ui: HTMLElement, text: string, kind: string): void {
    ui.append(h('div', { class: 'banner', role: 'note', 'data-testid': 'banner', 'data-kind': kind }, text));
}
