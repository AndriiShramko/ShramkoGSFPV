// Voxel overlay (A.8, G.2; item 24). Owner: W3-4. Shipped on main before prefs was wired
// (apps/fly/src/voxels.ts, ui/voxels.ts; V key, the walls menu on the credit line, Settings), so
// these defs describe what main does today, not the first draft of A.8:
//  - the view (V) is not remembered: main shows the scan again after a reload (persist: false);
//  - four styles, render-pc's VOXEL_STYLES (a test reads packages/render-pc/src/voxel-colors.ts:
//    prefs does not import render-pc), default 'wire';
//  - one opacity per view, 0.05-1: over the scan 0.55, voxels only 1 (main's DEFAULT_PREFS; the
//    slider shows the one of the view in use); main kept all three in gsfpv.voxels (migrate.ts);
//  - the radius has no control on the live site (the test hook and ?vradius only): planned, with
//    main's value, 20 m, clamped to 2-60 m like the hook.
// ?voxels=, ?vstyle= and ?vradius= are main's test switches for this page load: the session layer.
import type { SettingDef } from '../schema';

/** render-pc VOXEL_STYLES, in its order (packages/render-pc/src/voxel-colors.ts). */
export const VOXEL_STYLES: readonly string[] = ['solid', 'wire', 'height', 'floaters'];
/** apps/fly/src/voxels.ts VOXEL_MODES: V cycles them in this order. */
export const VOXEL_VIEWS: readonly string[] = ['off', 'overlay', 'only'];

export const VOXELS_DEFS: readonly SettingDef[] = [
    // V cycles off, over the scan, voxels only; "only" hides the scan and flies the voxels
    { id: 'voxels.show', group: 'voxels', scope: 'global', type: 'enum', options: VOXEL_VIEWS, default: 'off', apply: 'live', shown: ['key', 'settings', 'url'], action: 'voxels.cycle', url: 'voxels', persist: false, status: 'shipped', since: 1, items: [24] },
    { id: 'voxels.style', group: 'voxels', scope: 'global', type: 'enum', options: VOXEL_STYLES, default: 'wire', apply: 'live', shown: ['settings', 'url'], url: 'vstyle', status: 'shipped', since: 1, items: [24] },
    // over the scan (main: opacityOverlay)
    { id: 'voxels.opacity', group: 'voxels', scope: 'global', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.55, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [24] },
    // with the scan hidden (main: opacityOnly)
    { id: 'voxels.opacityOnly', group: 'voxels', scope: 'global', type: 'number', min: 0.05, max: 1, step: 0.05, default: 1, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [24] },
    { id: 'voxels.radiusM', group: 'voxels', scope: 'global', type: 'number', min: 2, max: 60, step: 1, unit: 'm', default: 20, apply: 'live', shown: ['settings', 'url'], url: 'vradius', status: 'planned', since: 1, items: [24] }
];
