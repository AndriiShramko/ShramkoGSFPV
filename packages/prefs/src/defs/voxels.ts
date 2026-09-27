// Voxel overlay (A.8, G.2; item 24). Owner: W3-4.
import type { SettingDef } from '../schema';

export const VOXELS_DEFS: readonly SettingDef[] = [
    // V cycles off, overlay, voxels only; "only" hides the scan and flies the voxels
    { id: 'voxels.show', group: 'voxels', scope: 'global', type: 'enum', options: ['off', 'overlay', 'only'], default: 'off', apply: 'live', shown: ['key', 'settings'], action: 'voxels.cycle', status: 'planned', since: 1, items: [24] },
    { id: 'voxels.opacity', group: 'voxels', scope: 'global', type: 'number', min: 0, max: 1, step: 0.05, default: 0.35, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [24] },
    { id: 'voxels.style', group: 'voxels', scope: 'global', type: 'enum', options: ['solid', 'grid', 'edges', 'height', 'floaters'], default: 'grid', apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [24] },
    { id: 'voxels.radiusM', group: 'voxels', scope: 'global', type: 'number', min: 5, max: 40, step: 1, unit: 'm', default: 15, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [24] }
];
