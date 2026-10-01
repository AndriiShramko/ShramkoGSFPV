// Crashes and respawn (A.8, C.6-C.8; items 3, 16, 18, 20, 23). Owner: W2-2 (respawn).
// physics.vCrash is v0.2's "Crash threshold" slider. The rest ship with part C (wave 2): the session
// reads them through app/builtin/respawn.ts (policyFrom, crash.enabled -> crashOn). respawn.showPad
// (a faint ring where the platform is) is not drawn yet, so it stays planned.
import type { SettingDef } from '../schema';

export const CRASH_DEFS: readonly SettingDef[] = [
    // a flag, not vCrash = Infinity: JSON turns Infinity into null (C.7)
    { id: 'crash.enabled', group: 'crash', scope: 'global', type: 'bool', default: true, apply: 'life', shown: ['settings', 'crash'], status: 'shipped', since: 1, items: [3, 23] },
    { id: 'physics.vCrash', group: 'crash', scope: 'drone', type: 'number', min: 2, max: 10, step: 0.5, unit: 'mps', default: { preset: 'v_crash_ms', fallback: 4 }, apply: 'life', shown: ['settings'], status: 'shipped', since: 1, items: [20] },
    { id: 'respawn.auto', group: 'crash', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'crash'], status: 'shipped', since: 1, items: [23] },
    { id: 'respawn.delayS', group: 'crash', scope: 'global', type: 'number', min: 0.5, max: 10, step: 0.5, unit: 's', default: 2, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [23] },
    { id: 'respawn.target', group: 'crash', scope: 'global', type: 'enum', options: ['rewind', 'start'], default: 'rewind', apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [23] },
    { id: 'respawn.rewindS', group: 'crash', scope: 'global', type: 'number', min: 1, max: 30, step: 1, unit: 's', default: 5, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [23] },
    // applies at the next respawn
    { id: 'respawn.platform', group: 'crash', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [16, 23] },
    { id: 'respawn.keepArmed', group: 'crash', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [23] },
    { id: 'respawn.unstuck', group: 'crash', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [18] },
    // Andrii asked for an invisible platform (item 16)
    { id: 'respawn.showPad', group: 'crash', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [16] },
    // D-i: a pack that survives every respawn runs flat after a few minutes in one scan
    { id: 'battery.refill', group: 'crash', scope: 'global', type: 'enum', options: ['start', 'respawn', 'never'], default: 'start', apply: 'live', shown: ['settings'], status: 'shipped', since: 1 }
];
