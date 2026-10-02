// The scene settings (A.8, E.7, G.3). Owners: W3-3 (transform), W4-2 (dropFloaters), W3-4 (walls,
// already shipped on main; one value for every scan since schema 2, its default per scan). A file,
// not a group: the transform sits in group scenes, the floater filter and the walls switch in group
// voxels (Settings: "Walls and voxel grid").
import type { SettingDef } from '../schema';

/** T(w) = s*w + t around the drone (E.7); v = the scene version it was set on (0 = none). */
export interface SceneTransform { s: number; t: [number, number, number]; v: number }

export const SCALE_MIN = 0.25;
/** x100 (the owner's message 16): a room as big as a city, a dive along a chair like a mosquito */
export const SCALE_MAX = 100;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Scale is clamped into SCALE_MIN..SCALE_MAX; a transform stored before versions were known gets v = 0. */
export function validateTransform(v: unknown): SceneTransform | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (!fin(o.s) || o.s <= 0 || !Array.isArray(o.t) || o.t.length !== 3 || !o.t.every(fin)) return null;
    const ver = o.v === undefined ? 0 : o.v;
    if (!Number.isInteger(ver) || (ver as number) < 0) return null;
    const s = o.s < SCALE_MIN ? SCALE_MIN : o.s > SCALE_MAX ? SCALE_MAX : o.s;
    return { s, t: [o.t[0], o.t[1], o.t[2]], v: ver as number };
}

/** The walls switch's values, as showcase.json's "walls" field and main's gsfpv.walls.<scene> key write them. */
export const WALLS_OPTIONS: readonly string[] = ['on', 'off'];

export const SCENE_DEFS: readonly SettingDef[] = [
    // The walls (collisions) switch (C, the walls menu, Settings). ONE choice for every scan (the
    // owner's message 16, schema 2; per scan before, migrate.ts 1 -> 2): a pilot who switched the
    // walls off flies every scan without them. A pilot who never switched follows the admin's value
    // for each scan (showcase.json "walls": "off" for a noisy scan), also when the admin changes it
    // later (A.6). ?walls= is this load's value (the session layer) over both. The id keeps its
    // name: it is in exported files and links. A new flight model and log at the same spot: a life setting.
    { id: 'scene.walls', group: 'voxels', scope: 'global', type: 'enum', options: WALLS_OPTIONS, default: { curated: 'walls', fallback: 'on' }, apply: 'life', shown: ['key', 'settings', 'url'], action: 'walls.toggle', url: 'walls', status: 'shipped', since: 1 },
    // default: the curated scale of the scene, else 1 (the store asks PresetResolver.curatedScale)
    { id: 'scene.transform', group: 'scenes', scope: 'scene', type: 'json', kind: 'transform', validate: validateTransform, default: null, apply: 'live', shown: ['pause', 'key', 'settings'], action: ['scale.down', 'scale.up'], status: 'shipped', since: 1, items: [11] },
    // G.3 phantom walls: drops the walls' connected pieces under N blocks (0 = off). Per scan like
    // the walls switch: the admin's default is showcase.json's "dropFloaters", the pilot's value for
    // a scan wins. It changes the walls, so a life setting (a world record and a new life).
    { id: 'scene.dropFloaters', group: 'voxels', scope: 'scene', type: 'number', min: 0, max: 64, step: 1, unit: 'blocks', default: { curated: 'dropFloaters', fallback: 0 }, apply: 'life', shown: ['settings'], status: 'shipped', since: 1, items: [24] }
];
