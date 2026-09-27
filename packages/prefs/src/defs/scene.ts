// Per-scene settings (A.8, E.7, G.3). Owners: W3-3 (transform), W4-2 (dropFloaters). A file, not
// a group: the transform sits in group scenes, the floater filter in group voxels.
import type { SettingDef } from '../schema';

/** T(w) = s*w + t around the drone (E.7); v = the scene version it was set on (0 = none). */
export interface SceneTransform { s: number; t: [number, number, number]; v: number }

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Scale is clamped into 0.25-4; a transform stored before versions were known gets v = 0. */
export function validateTransform(v: unknown): SceneTransform | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (!fin(o.s) || o.s <= 0 || !Array.isArray(o.t) || o.t.length !== 3 || !o.t.every(fin)) return null;
    const ver = o.v === undefined ? 0 : o.v;
    if (!Number.isInteger(ver) || (ver as number) < 0) return null;
    const s = o.s < SCALE_MIN ? SCALE_MIN : o.s > SCALE_MAX ? SCALE_MAX : o.s;
    return { s, t: [o.t[0], o.t[1], o.t[2]], v: ver as number };
}

export const SCENE_DEFS: readonly SettingDef[] = [
    // default: the curated scale of the scene, else 1 (the store asks PresetResolver.curatedScale)
    { id: 'scene.transform', group: 'scenes', scope: 'scene', type: 'json', kind: 'transform', validate: validateTransform, default: null, apply: 'live', shown: ['pause', 'key', 'settings'], action: ['scale.down', 'scale.up'], status: 'planned', since: 1, items: [11] },
    // drops voxel components under N blocks (0 = off); changes the collision, so a life setting
    { id: 'scene.dropFloaters', group: 'voxels', scope: 'scene', type: 'number', min: 0, max: 64, step: 1, unit: 'blocks', default: 0, apply: 'life', shown: ['settings'], status: 'planned', since: 1, items: [24] }
];
