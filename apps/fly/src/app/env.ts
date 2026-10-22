// The page's environment, read once when the page loads: the URL as it was opened (the scene link
// later rewrites ?scene=, nothing else reads it again) and what the browser can do.
import { h } from '../ui/dom';
import { gaEvent, gaParams } from './analytics';

export const q = new URLSearchParams(location.search);

export const hasWebGPU = typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
export const hasHid = typeof navigator !== 'undefined' && 'hid' in navigator;
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

/**
 * A usage event to the site's /api/e (whitelisted names and values, apps/api/server.py EVENTS) and, only
 * when the visitor accepted analytics, the same event to GA4 with GA's parameter names (app/analytics.ts);
 * `ga`: GA-only parameters the counter does not keep (the scene id, the flight mode). Never fails the caller.
 */
export function beacon(e: string, p: Record<string, string | number | boolean> = {}, ga: Record<string, string | number | boolean | undefined> = {}): void {
    try {
        navigator.sendBeacon?.('/api/e', JSON.stringify({ e, p }));
    } catch {
        /* offline / blocked */
    }
    gaEvent(e, { ...gaParams(p), ...ga });
}

/** A note along the top edge (no WebGPU, no WebHID); ui/hud.ts stacks them under each other. */
export function banner(ui: HTMLElement, text: string, kind: string): void {
    ui.append(h('div', { class: 'banner', role: 'note', 'data-testid': 'banner', 'data-kind': kind }, text));
}
