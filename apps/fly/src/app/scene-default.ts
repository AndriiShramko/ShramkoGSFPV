// "Save as this scene's default" (v0.7 lane E, item 3 of the lane; docs/wip/v07-e.md section 6): the
// owner, flying a scan with an admin session in this browser, keeps what he flies now (walls, the
// floater filter, the scene size, the collision ceiling, the wind) as the scan's defaults in the
// admin's catalogue DRAFT, through the admin API the admin page uses (apps/fly/src/admin/api.ts:
// session cookie + X-CSRF). Nothing goes live here: the admin page publishes the draft.
//
// No DOM and no session here (the builtin feature app/builtin/scene-default.ts reads the flight and
// shows the result), so the mapping and the save run in Node tests against the real API server
// (tools/bench/test/scene-default.test.ts).
//
// Mapping, in the catalogue's own canonical form (packages/scenes catalog.ts; the server's
// apps/api/admin.py clean_scene keeps the same ranges): an absent field is the catalogue's default.
//  - walls: 'on' | 'off' as flown; a scan without walls keeps the entry's value.
//  - dropFloaters: the floater filter flown, 1..64 blocks; 0 = no field.
//  - scale: Scene size s, when it is in the catalogue's range 0.25..4 (1 = no field). Above x4 (the
//    pilot goes to x100) the entry keeps its scale and the result says so. The pilot's offset (Scene
//    size scales around the drone) has no catalogue field: the default scales as the catalogue does.
//  - ceilingM: the ceiling flown, scan metres (the number the walls were cut with); none = no field.
//  - wind: the custom wind as 'manual'; still air flown (wind off, or a scan without wind) = no field;
//    the scan's own wind flown = the entry's wind untouched (its source, e.g. 'climate', stays); the
//    live wind of the place is weather, not a default: the entry keeps its wind and the result says so.
import type { CatalogScene, SceneCatalog, SceneWind } from '@gsfpv/scenes';

/** The catalogue's range of `scale` (packages/scenes catalog.ts, apps/api/admin.py clean_scene). */
export const CATALOG_SCALE_MIN = 0.25;
export const CATALOG_SCALE_MAX = 4;
/** The catalogue's range of `dropFloaters`. */
export const CATALOG_FLOATERS_MAX = 64;

/** What the pilot flies now, as the flight knows it (FlightSession). */
export interface FlownDefaults {
    /** the walls switch flown; null: the scan has no walls (nothing to say about them) */
    walls: 'on' | 'off' | null;
    /** the floater filter: pieces under this many blocks dropped, 0 = off */
    dropFloaters: number;
    /** Scene size (E.7 transform s) */
    scale: number;
    /** the collision ceiling flown, scan metres; null = none */
    ceilingM: number | null;
    /** the wind flown and where it came from; null = still air */
    wind: { source: 'scene' | 'now' | 'custom'; fromDeg: number; speed: number; gust: number } | null;
}

/** The catalogue fields the action writes. */
export type DefaultField = 'walls' | 'dropFloaters' | 'scale' | 'ceilingM' | 'wind';

/** What a save changes in the scan's entry: fields set, fields removed (= the catalogue's default), fields left as they are on purpose. */
export interface SceneDefaultPatch {
    set: Partial<Pick<CatalogScene, DefaultField>>;
    drop: DefaultField[];
    /** left untouched because the catalogue cannot hold what is flown: scale above x4, the live wind */
    kept: ('scale' | 'wind')[];
}

const fin = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

/** The patch for what is flown (see the header for the rules). */
export function sceneDefaultPatch(f: FlownDefaults): SceneDefaultPatch {
    const p: SceneDefaultPatch = { set: {}, drop: [], kept: [] };
    if (f.walls !== null) p.set.walls = f.walls;
    const fl = Math.round(f.dropFloaters);
    if (fin(fl) && fl > 0) p.set.dropFloaters = Math.min(fl, CATALOG_FLOATERS_MAX);
    else p.drop.push('dropFloaters');
    if (!fin(f.scale) || f.scale < CATALOG_SCALE_MIN || f.scale > CATALOG_SCALE_MAX) p.kept.push('scale');
    else if (f.scale === 1) p.drop.push('scale');
    else p.set.scale = f.scale;
    if (f.ceilingM !== null && fin(f.ceilingM)) p.set.ceilingM = f.ceilingM;
    else p.drop.push('ceilingM');
    const w = f.wind;
    if (w === null) p.drop.push('wind');
    else if (w.source === 'custom') p.set.wind = { fromDeg: w.fromDeg, speed: w.speed, gust: w.gust, source: 'manual' } satisfies SceneWind;
    else if (w.source === 'now') p.kept.push('wind');
    // 'scene': the entry's own wind is what is flown; nothing to write
    return p;
}

/**
 * `cat` with the patch on scene `id` (a new object; the other scenes and fields untouched), or null
 * when the catalogue has no such scene (a scan opened from a SuperSplat link is not in it).
 */
export function withSceneDefault(cat: SceneCatalog, id: string, patch: SceneDefaultPatch): SceneCatalog | null {
    const i = cat.scenes.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const next: CatalogScene = { ...cat.scenes[i], ...patch.set };
    for (const k of patch.drop) delete next[k];
    const scenes = cat.scenes.slice();
    scenes[i] = next;
    return { ...cat, scenes };
}

/** The two calls the save needs (AdminClient has them: GET/POST /api/admin/<path>, X-CSRF on the POST). */
export interface DraftClient {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
}

export type SaveDefaultResult =
    | { ok: true; patch: SceneDefaultPatch; entry: CatalogScene }
    | { ok: false; why: 'not-in-catalogue' | 'session' | 'refused' | 'network' };

/**
 * Read the admin's draft, put the patch on scene `id`, save the whole draft back (the admin API saves
 * the list as one document). The entry returned is the one the server kept (its own cleaning applied).
 * `status` of a thrown error (ApiError) tells the session (401/403) from a refusal (400/413).
 */
export async function saveSceneDefault(client: DraftClient, id: string, flown: FlownDefaults): Promise<SaveDefaultResult> {
    const patch = sceneDefaultPatch(flown);
    try {
        const state = await client.get<{ draft: SceneCatalog }>('catalog');
        const next = withSceneDefault(state.draft, id, patch);
        if (!next) return { ok: false, why: 'not-in-catalogue' };
        const saved = await client.post<{ draft: SceneCatalog }>('catalog/draft', { catalog: next });
        const entry = saved.draft?.scenes?.find((s) => s.id === id);
        return entry ? { ok: true, patch, entry } : { ok: false, why: 'refused' };
    } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status === 401 || status === 403) return { ok: false, why: 'session' };
        if (typeof status === 'number' && status >= 400 && status < 500) return { ok: false, why: 'refused' };
        return { ok: false, why: 'network' };
    }
}
