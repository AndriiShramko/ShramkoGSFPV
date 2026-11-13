// Track format version 2 (tracks-plan.md 2.6, lane tracks, train 2, stage T2-editor-core). The sound package's track file
// (`shramko-sonic-track/1`, its submodule, not edited here) stays the file the flight, the beacon and the server read; version 2
// is the editor's file: version 1 plus the authorship marks (origin, editedBy, the author kind admin), a hand-bent path,
// non-gate objects and the walls the course was proven on. Version 1 is read and upgraded; version 2 is written down to
// version 1 (toTrackV1) wherever the sound package or the proof needs it.
// Rules of version 2 beyond version 1: a course with a parent (a new version or a fork) names its origin and who edited it;
// a course without a parent names neither. Keys are strict as in version 1: an unknown key is refused.
import { Collector, FORMATS, GATE_ID, TRACK_ID, canonicalJson, canonicalPretty, isRecord, joinPath, sha256Hex, validateTrack } from '@shramko/sonic-fpv';
import type { Issue, TrackFile, TrackRef, Validation, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';

export const TRACK_FORMAT_V1 = FORMATS.track;
export const TRACK_FORMAT_V2 = 'shramko-sonic-track/2';

export type CourseAuthorKind = 'person' | 'agent' | 'generator' | 'admin';
export interface CourseAuthor {
    readonly kind: CourseAuthorKind;
    readonly name: string;
}
/** the course's first version: shown as "created by"; author null when read from version 1 (the file did not carry it) */
export interface CourseOrigin {
    readonly id: string;
    readonly version: number;
    readonly author: CourseAuthor | null;
}
/** a non-gate obstacle (pillar, box): never in the order of gates */
export interface CourseObject {
    readonly id: string;
    readonly shape: { readonly kind: 'pillar'; readonly radius: number; readonly height: number } | { readonly kind: 'box'; readonly size: Vec3 };
    readonly pos: Vec3;
    readonly quat: readonly [number, number, number, number];
    readonly order: null;
}
/** the walls the course was proven on */
export interface CourseWalls {
    readonly collisionSha256: string;
    readonly floaterMinBlocks: number;
    readonly ceilingM: number | null;
    readonly voxelM: number;
}

export interface Course extends Omit<TrackFile, 'format' | 'author'> {
    readonly format: typeof TRACK_FORMAT_V2;
    readonly author: CourseAuthor;
    readonly origin: CourseOrigin | null;
    readonly editedBy: CourseAuthor | null;
    /** a hand-bent path in the scan frame, or null for the path derived from the gates (path.ts) */
    readonly path: readonly WorldCheckpoint[] | null;
    readonly objects: readonly CourseObject[];
    readonly walls: CourseWalls | null;
}

const V2_KEYS = ['origin', 'editedBy', 'path', 'objects', 'walls'] as const;
const AUTHOR_KINDS: readonly CourseAuthorKind[] = ['person', 'agent', 'generator', 'admin'];
const SHA256 = /^[0-9a-f]{64}$/;
/** at most this many objects and path points (estimates: twice the format's gates) */
export const MAX_OBJECTS = 400;
export const MAX_PATH_POINTS = 400;

function checkAuthor(c: Collector, v: unknown, path: string): CourseAuthor | undefined {
    const rec = c.record(v, path);
    if (rec === null) return undefined;
    c.keys(rec, path, ['kind', 'name']);
    const kind = c.oneOf(rec.kind, joinPath(path, 'kind'), AUTHOR_KINDS);
    const name = c.string(rec.name, joinPath(path, 'name'), { min: 1, max: 80 });
    return kind !== undefined && name !== undefined ? { kind, name } : undefined;
}

function checkQuat(c: Collector, q: unknown, path: string): CourseObject['quat'] | undefined {
    if (!Array.isArray(q) || q.length !== 4 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        c.add(path, 'must be four finite numbers [w, x, y, z]');
        return undefined;
    }
    if (Math.abs(Math.hypot(...(q as number[])) - 1) > 1e-3) {
        c.add(path, 'must be a unit quaternion');
        return undefined;
    }
    return q as unknown as CourseObject['quat'];
}

function checkV2Keys(c: Collector, root: Record<string, unknown>, ids: Set<string>): Pick<Course, 'origin' | 'editedBy' | 'path' | 'objects' | 'walls'> | undefined {
    let origin: CourseOrigin | null | undefined;
    if (root.origin === null) origin = null;
    else if (root.origin === undefined) c.add('origin', 'is required (null for a course without a parent)');
    else {
        const rec = c.record(root.origin, 'origin');
        if (rec !== null) {
            c.keys(rec, 'origin', ['id', 'version', 'author']);
            const id = c.string(rec.id, 'origin.id', { pattern: TRACK_ID, patternHint: 'must be a track id' });
            const version = c.number(rec.version, 'origin.version', { integer: true, min: 1, max: 9999 });
            const author = rec.author === null ? null : checkAuthor(c, rec.author, 'origin.author');
            if (id !== undefined && version !== undefined && author !== undefined) origin = { id, version, author };
        }
    }
    let editedBy: CourseAuthor | null | undefined;
    if (root.editedBy === null) editedBy = null;
    else if (root.editedBy === undefined) c.add('editedBy', 'is required (null for a course without a parent)');
    else editedBy = checkAuthor(c, root.editedBy, 'editedBy');

    let path: WorldCheckpoint[] | null | undefined = null;
    if (root.path !== undefined && root.path !== null) {
        const arr = c.array(root.path, 'path', { min: 2, max: MAX_PATH_POINTS });
        path = arr === null ? undefined : [];
        arr?.forEach((v, i) => {
            const p = joinPath('path', i);
            const rec = c.record(v, p);
            if (rec === null) return;
            c.keys(rec, p, ['pos', 'dir', 'stage'], ['pos', 'dir']);
            const pos = c.vec3(rec.pos, joinPath(p, 'pos'));
            const dir = c.vec3(rec.dir, joinPath(p, 'dir'));
            const stage = rec.stage === undefined ? undefined : c.number(rec.stage, joinPath(p, 'stage'), { integer: true, min: 1 });
            if (pos !== undefined && dir !== undefined && path) path.push(stage === undefined ? { pos, dir } : { pos, dir, stage });
        });
    }

    const objects: CourseObject[] = [];
    if (root.objects !== undefined) {
        const arr = c.array(root.objects, 'objects', { min: 0, max: MAX_OBJECTS });
        arr?.forEach((v, i) => {
            const p = joinPath('objects', i);
            const rec = c.record(v, p);
            if (rec === null) return;
            c.keys(rec, p, ['id', 'shape', 'pos', 'quat', 'order']);
            const id = c.string(rec.id, joinPath(p, 'id'), { pattern: GATE_ID, patternHint: 'must be an object id' });
            if (id !== undefined) {
                if (ids.has(id)) c.add(joinPath(p, 'id'), `'${id}' is used twice`);
                ids.add(id);
            }
            if (rec.order !== null) c.add(joinPath(p, 'order'), 'must be null: an object is not a gate');
            const pos = c.vec3(rec.pos, joinPath(p, 'pos'));
            const quat = checkQuat(c, rec.quat, joinPath(p, 'quat'));
            const srec = c.record(rec.shape, joinPath(p, 'shape'));
            let shape: CourseObject['shape'] | undefined;
            if (srec !== null) {
                const sp = joinPath(p, 'shape');
                const kind = c.oneOf(srec.kind, joinPath(sp, 'kind'), ['pillar', 'box'] as const);
                if (kind === 'pillar') {
                    c.keys(srec, sp, ['kind', 'radius', 'height']);
                    const radius = c.number(srec.radius, joinPath(sp, 'radius'), { min: 0.01, max: 100 });
                    const height = c.number(srec.height, joinPath(sp, 'height'), { min: 0.01, max: 100 });
                    if (radius !== undefined && height !== undefined) shape = { kind, radius, height };
                } else if (kind === 'box') {
                    c.keys(srec, sp, ['kind', 'size']);
                    const size = c.vec3(srec.size, joinPath(sp, 'size'));
                    if (size !== undefined && size.some((x) => !(x > 0 && x <= 100))) c.add(joinPath(sp, 'size'), 'must be three sizes above 0 and at most 100');
                    else if (size !== undefined) shape = { kind, size };
                }
            }
            if (id !== undefined && pos !== undefined && quat !== undefined && shape !== undefined && rec.order === null) objects.push({ id, shape, pos, quat, order: null });
        });
    }

    let walls: CourseWalls | null | undefined = null;
    if (root.walls !== undefined && root.walls !== null) {
        const rec = c.record(root.walls, 'walls');
        walls = undefined;
        if (rec !== null) {
            c.keys(rec, 'walls', ['collisionSha256', 'floaterMinBlocks', 'ceilingM', 'voxelM']);
            const sha = c.string(rec.collisionSha256, 'walls.collisionSha256', { pattern: SHA256, patternHint: 'must be 64 lower-case hex digits' });
            const floater = c.number(rec.floaterMinBlocks, 'walls.floaterMinBlocks', { integer: true, min: 0 });
            const ceilingM = rec.ceilingM === null ? null : c.number(rec.ceilingM, 'walls.ceilingM', {});
            const voxelM = c.number(rec.voxelM, 'walls.voxelM', { min: 0.001, max: 10 });
            if (sha !== undefined && floater !== undefined && ceilingM !== undefined && voxelM !== undefined) walls = { collisionSha256: sha, floaterMinBlocks: floater, ceilingM, voxelM };
        }
    }
    if (origin === undefined || editedBy === undefined || path === undefined || walls === undefined) return undefined;
    return { origin, editedBy, path, objects, walls };
}

/** A version 2 course: version 1's rules (the sound package's validator) plus the marks and the extra keys. */
export function validateCourse(input: unknown): Validation<Course> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return { ok: false, issues: c.issues };
    if (root.format !== TRACK_FORMAT_V2) c.add('format', `must be '${TRACK_FORMAT_V2}', got ${JSON.stringify(root.format)}`);
    // the version 1 part, read by the sound package's own validator: the format and the author kind written down to it
    const v1: Record<string, unknown> = { ...root, format: TRACK_FORMAT_V1 };
    for (const k of V2_KEYS) delete v1[k];
    const rawAuthor = isRecord(root.author) ? root.author : null;
    if (rawAuthor && rawAuthor.kind === 'admin') v1.author = { ...rawAuthor, kind: 'person' };
    const base = validateTrack(v1);
    if (!base.ok) for (const i of base.issues) c.add(i.path, i.message);
    const author = checkAuthor(c, root.author, 'author');
    const ids = new Set<string>(Array.isArray(root.gates) ? (root.gates as unknown[]).map((g) => (isRecord(g) ? String(g.id) : '')) : []);
    const extra = checkV2Keys(c, root, ids);
    if (extra && base.ok) {
        const hasParent = base.value.parent !== null;
        if (hasParent && extra.origin === null) c.add('origin', 'a course with a parent (a new version or a fork) must name its origin');
        if (hasParent && extra.editedBy === null) c.add('editedBy', 'a course with a parent (a new version or a fork) must name who edited it');
        if (!hasParent && extra.origin !== null) c.add('origin', 'a course without a parent is its own origin: must be null');
        if (!hasParent && extra.editedBy !== null) c.add('editedBy', 'a course without a parent was not edited: must be null');
    }
    if (!c.ok || !base.ok || author === undefined || extra === undefined) return { ok: false, issues: c.issues };
    return { ok: true, value: { ...base.value, format: TRACK_FORMAT_V2, author, ...extra } };
}

/** A version 1 file as version 2. A file with a parent gets its marks from `marks` (the server's meta) or the best the file
 *  says: edited by its own author, origin the parent (a fork) or version 1 of the same id, with the origin's author unknown. */
export function upgradeTrack(t: TrackFile, marks?: { origin: CourseOrigin | null; editedBy: CourseAuthor | null }): Course {
    let origin: CourseOrigin | null = null;
    let editedBy: CourseAuthor | null = null;
    if (t.parent !== null) {
        origin = marks?.origin ?? (t.parent.id === t.id ? { id: t.id, version: 1, author: null } : { id: t.parent.id, version: t.parent.version, author: null });
        editedBy = marks?.editedBy ?? t.author;
    }
    return { ...t, format: TRACK_FORMAT_V2, origin, editedBy, path: null, objects: [], walls: null };
}

/** Reads a course file of version 1 or 2 (an object or its JSON text); version 1 comes back upgraded. */
export function readCourse(input: unknown): Validation<Course> {
    let data = input;
    if (typeof input === 'string') {
        try {
            data = JSON.parse(input);
        } catch (e) {
            return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
        }
    }
    const format = isRecord(data) ? data.format : undefined;
    if (format === TRACK_FORMAT_V1) {
        const v = validateTrack(data);
        return v.ok ? { ok: true, value: upgradeTrack(v.value) } : v;
    }
    if (format === TRACK_FORMAT_V2) return validateCourse(data);
    const issues: Issue[] = [{ path: 'format', message: `must be '${TRACK_FORMAT_V1}' or '${TRACK_FORMAT_V2}', got ${JSON.stringify(format)}` }];
    return { ok: false, issues };
}

/** The version 1 file of a course: what the flight, the beacon, the proof (checkTrack) and today's server read. The marks,
 *  the path, the objects and the walls are dropped; an admin author is written as a person. */
export function toTrackV1(c: Course): TrackFile {
    const { origin: _o, editedBy: _e, path: _p, objects: _b, walls: _w, ...rest } = c;
    const author = c.author.kind === 'admin' ? { kind: 'person' as const, name: c.author.name } : { kind: c.author.kind, name: c.author.name };
    return { ...rest, format: TRACK_FORMAT_V1, author } as TrackFile;
}

/** The canonical text of a version 2 course: keys sorted, two spaces of indent, a final newline. */
export function writeCourse(c: Course): string {
    return `${canonicalPretty(c)}\n`;
}

/** SHA-256 of the course's canonical JSON. */
export function courseDigest(c: Course): string {
    return sha256Hex(canonicalJson(c));
}

export type SaveMode = { readonly kind: 'version' } | { readonly kind: 'fork'; readonly id: string };

/**
 * The edited course `edited` as a file to save over `base`: a new version of the same id (its owner or the admin) or a fork
 * under a new id (anyone else), with the marks of tracks-plan 2.6. created by = the base's origin (or the base itself when it
 * has none); edited by = `by`, who is also this version's author.
 */
export function asSaved(base: Course, edited: Course, by: CourseAuthor, mode: SaveMode, created: string): Course {
    const origin: CourseOrigin = base.origin ?? { id: base.id, version: base.version, author: base.author };
    const parent: TrackRef = { id: base.id, version: base.version };
    const id = mode.kind === 'fork' ? mode.id : base.id;
    const version = mode.kind === 'fork' ? 1 : base.version + 1;
    return { ...edited, id, version, parent, origin, editedBy: by, author: by, created };
}
