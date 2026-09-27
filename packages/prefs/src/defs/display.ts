// Display (A.8). Owner: W2-1. hud, quality, reduced motion, F3 frame stats and the language are
// v0.2 controls; units, the governor and the latency guard have none (units is hard-coded metric,
// the governor and the guard URL-only), so they stay planned until their rows exist.
import type { SettingDef } from '../schema';

export const DISPLAY_DEFS: readonly SettingDef[] = [
    { id: 'display.hud', group: 'display', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'key'], action: 'hud.toggle', status: 'shipped', since: 1, items: [20] },
    { id: 'display.units', group: 'display', scope: 'global', type: 'enum', options: ['metric', 'imperial'], default: 'metric', apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [12] },
    // 1.0 is what v0.2 actually flew with; its panel showed 0.7 (D-b)
    { id: 'display.quality', group: 'display', scope: 'global', type: 'number', min: 0, max: 1, step: 0.05, default: 1, apply: 'live', shown: ['settings'], advanced: true, status: 'shipped', since: 1, items: [20] },
    { id: 'display.governor', group: 'display', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'url'], url: 'governor', advanced: true, status: 'planned', since: 1, items: [12] },
    // main's latency guard (render-pc LatencyGuard): it measures rAF -> presentation and, when
    // Chrome's compositor runs frames behind, holds the render loop briefly so Chrome leaves that
    // slow state. URL-only on main (?guard=0: measure, never skip), like the governor: planned
    // until a row exists.
    { id: 'display.latencyGuard', group: 'display', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'url'], url: 'guard', advanced: true, status: 'planned', since: 1 },
    // 'system' follows prefers-reduced-motion; v0.2 re-read the OS on every panel open (D-b)
    { id: 'display.reducedMotion', group: 'display', scope: 'global', type: 'enum', options: ['system', 'on', 'off'], default: 'system', apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [20] },
    { id: 'display.frameStats', group: 'display', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['key'], action: 'frameStats.toggle', status: 'shipped', since: 1, items: [12] },
    // kept in the NEXT_LOCALE cookie the landing reads (A.5); 'browser' = no cookie, the page's own language
    { id: 'ui.language', group: 'display', scope: 'global', type: 'enum', options: ['browser', 'en', 'es', 'pl', 'ru'], default: 'browser', apply: 'reload', shown: ['settings'], status: 'shipped', since: 1, items: [12] }
];
