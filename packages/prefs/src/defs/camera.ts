// Camera (A.8). Owner: W2-1. Render-only from v0.3 (D-h): changing them never rebuilds the model.
import type { SettingDef } from '../schema';

export const CAMERA_DEFS: readonly SettingDef[] = [
    { id: 'camera.fovDeg', group: 'camera', scope: 'drone', type: 'number', min: 70, max: 150, step: 1, unit: 'deg', default: { preset: 'camera_fov_deg', fallback: 115 }, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [20] },
    { id: 'camera.uptiltDeg', group: 'camera', scope: 'drone', type: 'number', min: 0, max: 50, step: 1, unit: 'deg', default: { preset: 'camera_uptilt_deg', fallback: 20 }, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [20] }
];
