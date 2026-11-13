// The scan lesson (v0.12, docs/wip/v12-plan.md 2.7 and 4.2 step 10; spec sections 3 and 4): module 7, "free flight", flies a
// real scan (Winter Garden, 7a475d38) at a size the lesson fixes (x5), through a chain of rings laid by hand in the scan's
// own frame (apps/fly/public/sonic/tracks/<id>-v<n>.json, the sound package's track format), timed, the best time kept.
// What the page needs for it, as pure parts (Node tests hold them) around the flight's own pieces:
//
//   the track     fetched from the release's static files, read by the package's strict parser (parseTrack), and held to the
//                 lesson: the same id and version, the same scan, the transform the lesson forces. A file that does not match
//                 is refused with its reason, never flown.
//   the size      forced for this scan by the prefs' session layer (scanSessionPrefs): `scene.transform` = the lesson's
//                 [s, tx, ty, tz] with no scan version (so it is taken as it is), and `scene.walls` on (a lesson's sound and
//                 touches are the walls'). The layer wins over the pilot's saved values and is never saved; the mode takes
//                 it off again when it leaves (SonicMode.leave). The scale feature follows the store and applies it, and the
//                 keys [ ] are the mode's (a note says the scene keeps its size).
//   the world     ScanSonicWorld over the session's walls and size now (rays against the voxels flown, the track's gates
//                 through the transform), the gates as SonicObjects in the flown world (trackToObjects) for the runner, the
//                 start as the track gives it (else the scan's own spawn), the floor under the start for the height layer,
//                 and the helper's view: the gates as primitives over the scan (primitives.ts objectPrims).
//   the walls     a scan's walls are as fine as its file: Winter Garden ships 3.2 cm cells, 16 cm flown at x5. Plan section 8 item 6
//                 asked whether a refined grid (1.6 cm, 8 cm flown) can ship with the release so that no PC has to refine first:
//                 measured, it cannot (tools/bench/src/sonic-garden-refine.ts: the page's own refine takes 417 s here and the grid
//                 is 96.6 MB raw, 35.2 MB brotli, against 19.2 MB and 7.6 MB shipped; and at x5 the walls box refuses a refine
//                 and finds none in its store, because it reads the flown cell size as the grid's), so the lesson says plainly
//                 that the walls are coarse (wallsAreCoarse, the host's line sonic.say.wallsCoarse).
import { parseTrack, trackToObjects } from '@shramko/sonic-fpv';
import type { LessonDef, LessonWorldRef, Pose, SceneTransform, SonicObject, SonicWorld, TrackFile, TrackRef, Vec3 } from '@shramko/sonic-fpv';
import type { VoxelCollision } from '@gsfpv/collision';
import { ScanSonicWorld } from './scan-world';
import type { ScanWorldSource } from './scan-world';
import { objectPrims } from './primitives';
import type { Prim } from './primitives';

/** Walls with cells larger than this, flown metres, are coarse enough to say so (the same line the scene size row draws, 10 cm). */
export const COARSE_SAY_M = 0.1;

/** The prefs the session layer holds while a scan lesson flies: the lesson's size and the walls on. */
export const SCAN_PREF_IDS: readonly string[] = ['scene.transform', 'scene.walls'];

/** Where the release serves a track: next to the page's own files (apps/fly/public/sonic/tracks), under the page's base. */
export function trackUrl(ref: TrackRef, base: string = '/fly/'): string {
    return `${base.endsWith('/') ? base : `${base}/`}sonic/tracks/${ref.id}-v${ref.version}.json`;
}

export class TrackError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TrackError';
    }
}

type Scan = Extract<LessonWorldRef, { kind: 'scan' }>;

const sameTransform = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);

/**
 * The track of a scan lesson from its text: the package's strict parse, then held to the lesson (id and version as the lesson
 * names them, the scan's id, the size it was laid out for). Throws TrackError with the reason.
 */
export function readLessonTrack(text: string, world: Scan): TrackFile {
    const r = parseTrack(text);
    if (!r.ok) throw new TrackError(`the track file is not valid: ${r.issues.map((i) => `${i.path || 'file'}: ${i.message}`).join('; ')}`);
    const t = r.value;
    const ref = world.track;
    if (ref && (t.id !== ref.id || t.version !== ref.version)) throw new TrackError(`the lesson flies ${ref.id} version ${ref.version}, the file is ${t.id} version ${t.version}`);
    if (t.scene.kind !== 'scan' || t.scene.id !== world.sceneId) throw new TrackError(`the track is for ${t.scene.kind} ${t.scene.id}, the lesson flies the scan ${world.sceneId}`);
    if (!sameTransform(t.transform, world.transform)) throw new TrackError(`the track was laid out for the size ${t.transform.join(', ')}, the lesson flies ${world.transform.join(', ')}`);
    return t;
}

/** The track a scan lesson names, fetched (a network or a file error becomes a TrackError). */
export async function loadLessonTrack(world: Scan, fetchImpl: typeof fetch = fetch, base?: string): Promise<TrackFile> {
    if (!world.track) throw new TrackError(`the lesson names no track`);
    const url = trackUrl(world.track, base);
    let res: Response;
    try {
        res = await fetchImpl(url, { cache: 'no-cache' });
    } catch (e) {
        throw new TrackError(`the track did not load (${(e as Error)?.message ?? String(e)})`);
    }
    if (!res.ok) throw new TrackError(`the track did not load (${res.status} for ${url})`);
    return readLessonTrack(await res.text(), world);
}

/** What the lesson holds in the prefs' session layer, or null for a lesson that flies no scan. */
export function scanSessionPrefs(world: LessonWorldRef): Record<string, unknown> | null {
    if (world.kind !== 'scan') return null;
    const [s, tx, ty, tz] = world.transform;
    return { 'scene.transform': { s, t: [tx, ty, tz], v: 0 }, 'scene.walls': 'on' };
}

/** What of the prefs store the lesson sets (PrefsStore; a fake in tests). */
export interface SessionPrefs {
    setSession(id: string, value: unknown): unknown;
    clearSession(id?: string): void;
}

/** Puts the lesson's size and walls into the session layer; false for a lesson that flies no scan (nothing is set). */
export function forceScanPrefs(prefs: SessionPrefs, world: LessonWorldRef): boolean {
    const p = scanSessionPrefs(world);
    if (!p) return false;
    for (const [id, v] of Object.entries(p)) prefs.setSession(id, v);
    return true;
}

export function clearScanPrefs(prefs: SessionPrefs): void {
    for (const id of SCAN_PREF_IDS) prefs.clearSession(id);
}

/** The walls are coarse enough to say so: cells (flown) above COARSE_SAY_M. */
export function wallsAreCoarse(voxelM: number | null): boolean {
    return voxelM !== null && voxelM > COARSE_SAY_M + 1e-9;
}

/** The walls' cell size as the line says it, whole centimetres. */
export function voxelCm(voxelM: number): number {
    return Math.round(voxelM * 100);
}

/** What the lesson host needs of a scan lesson once the page flies the scan (LessonPage.scanLesson). */
export interface ScanLesson {
    /** rays against the walls flown, the track's gates as objects: what sound reads */
    readonly world: SonicWorld;
    /** world y of the floor under the start: the height layer's zero */
    readonly floorY: number;
    /** where an attempt starts, flown world */
    readonly start: Pose;
    /** the gates in the flown world, in course order (the runner's `objects`) */
    readonly objects: readonly SonicObject[];
    /** the helper's view of the gates */
    readonly prims: readonly Prim[];
    /** the walls' cell size flown, m, or null when the scan has none */
    readonly voxelM: number | null;
    readonly track: TrackFile | null;
}

/** The scan flown now, as the lesson reads it. */
export interface ScanView {
    readonly sceneId: string;
    readonly sceneVersion: number;
    readonly src: ScanWorldSource;
    /** the scan's own spawn, flown world: where the lesson starts when the track gives no start */
    readonly spawn: Pose;
}

/** The floor under `p`: a ray straight down through the walls (the craft's start is in the air), else `fallbackM` below it. */
export function floorUnder(col: VoxelCollision | null, p: Vec3, fallbackM = 1.5): number {
    if (col) {
        const h = col.queryRay(p[0], p[1], p[2], 0, -1, 0, 200);
        if (h) return h.y;
    }
    return p[1] - fallbackM;
}

/** The start of the track in the flown world (its start pose through the transform now), else `fallback`. */
export function flownStart(track: TrackFile, tr: { readonly s: number; readonly t: readonly number[] }, fallback: Pose): Pose {
    if (!track.start) return fallback;
    const p = track.start.pos;
    return { pos: [tr.s * p[0] + (tr.t[0] as number), tr.s * p[1] + (tr.t[1] as number), tr.s * p[2] + (tr.t[2] as number)], yawDeg: track.start.yawDeg };
}

/**
 * The lesson over the scan flown now: its world, gates, start, floor and helper's view. No track (train 2, the free flight scan-free):
 * no gates, the scan's own spawn, the walls and the floor only.
 */
export function buildScanLesson(track: TrackFile | null, view: ScanView): ScanLesson {
    const tr = view.src.transform();
    const transform: SceneTransform = [tr.s, tr.t[0] as number, tr.t[1] as number, tr.t[2] as number];
    const col = view.src.collision();
    const start = track ? flownStart(track, tr, view.spawn) : view.spawn;
    const objects = track ? trackToObjects(track, { transform }) : [];
    return {
        world: new ScanSonicWorld(view.sceneId, view.sceneVersion, view.src, track),
        floorY: floorUnder(col, start.pos),
        start,
        objects,
        prims: objectPrims(objects),
        voxelM: col ? col.voxelResolution : null,
        track
    };
}
