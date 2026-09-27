// Drone and physics (A.8, H). Owner: W2-1. Every per-drone value is scope 'drone', so one drone's
// change never reaches another (D-c). v0.2 exposed the drone picker, gravity, the crash threshold
// (defs/crash.ts), motor tau and drag; TWR, duct drag, prop inertia and idle are new with H.
import type { SettingDef } from '../schema';

/** The six presets in packages/sim-core/presets (a test keeps this list equal to the folder). */
export const DRONE_IDS: readonly string[] = ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s'];

export const DRONE_DEFS: readonly SettingDef[] = [
    { id: 'drone.current', group: 'drone', scope: 'global', type: 'enum', options: DRONE_IDS, default: 'pavo20pro-3s', apply: 'life', shown: ['picker', 'url'], url: 'drone', status: 'shipped', since: 1, items: [13] },
    // Earth, Moon, Mars and zero are presets of the control; any value in range is valid
    { id: 'physics.gravity', group: 'drone', scope: 'global', type: 'number', min: 0, max: 30, step: 0.01, unit: 'mps2', default: 9.81, apply: 'life', shown: ['settings', 'url'], url: 'g', status: 'shipped', since: 1, items: [12] },
    { id: 'physics.gravityMode', group: 'drone', scope: 'global', type: 'enum', options: ['honest', 'same-twr', 'auto-throttle'], default: 'honest', apply: 'life', shown: ['settings', 'url'], url: 'gm', status: 'shipped', since: 1, items: [12] },
    { id: 'physics.twr', group: 'drone', scope: 'drone', type: 'number', min: 2, max: 8, step: 0.1, default: { preset: 'twr', fallback: 5 }, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] },
    { id: 'physics.tauMs', group: 'drone', scope: 'drone', type: 'number', min: 8, max: 30, step: 1, unit: 'ms', default: { preset: 'motor_tau_ms', fallback: 15 }, apply: 'life', shown: ['settings'], advanced: true, status: 'shipped', since: 1, items: [20] },
    { id: 'physics.dragScale', group: 'drone', scope: 'drone', type: 'number', min: 0.5, max: 2, step: 0.05, unit: 'x', default: 1, apply: 'life', shown: ['settings'], advanced: true, status: 'shipped', since: 1, items: [20] },
    // rotor and duct momentum drag (H.2 item 1); presets gain the field with W1-3
    { id: 'physics.ductDrag', group: 'drone', scope: 'drone', type: 'number', min: 0, max: 1.5, step: 0.05, unit: 'per_s', default: { preset: 'rotor_drag_per_s', fallback: 0.6 }, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] },
    { id: 'physics.propInertia', group: 'drone', scope: 'drone', type: 'number', min: 0, max: 3, step: 0.1, unit: 'x', default: 1, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] },
    // presets store motor_idle as a fraction (0.055 = Betaflight dshot_idle_value 550)
    { id: 'physics.idlePct', group: 'drone', scope: 'drone', type: 'number', min: 0, max: 15, step: 0.1, unit: 'pct', default: { preset: 'motor_idle', scale: 100, fallback: 5.5 }, apply: 'life', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [21] }
];
