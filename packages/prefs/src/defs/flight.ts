// Flight settings (A.8, items 15 and 23). Owner: W2-3 (modes). Angle is everyone's default: item
// 23 ("self-level by default for everyone") was said after item 15 and wins (design 0.1).
import type { SettingDef } from '../schema';

export const FLIGHT_DEFS: readonly SettingDef[] = [
    { id: 'flight.mode', group: 'flight', scope: 'global', type: 'enum', options: ['acro', 'angle', 'horizon'], default: 'angle', apply: 'live', shown: ['hud', 'settings', 'key'], action: 'mode.cycle', status: 'shipped', since: 1, items: [15, 23] },
    // Betaflight 4.5.1 level-mode numbers (research-a (b)), per drone like the rest of a tune
    { id: 'level.angleLimitDeg', group: 'flight', scope: 'drone', type: 'number', min: 10, max: 85, step: 1, unit: 'deg', default: 60, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] },
    { id: 'level.strength', group: 'flight', scope: 'drone', type: 'number', min: 0, max: 200, step: 1, default: 50, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] },
    { id: 'level.horizonStrength', group: 'flight', scope: 'drone', type: 'number', min: 0, max: 200, step: 1, default: 75, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [15] }
];
