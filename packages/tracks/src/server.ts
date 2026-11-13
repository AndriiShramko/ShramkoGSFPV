// The contract of a course saved on the server (train 1 plan section 7; apps/api/tracks.py validate_track is its Python
// twin, held to this by the shared fixtures apps/api/tests/fixtures/tracks/{valid,invalid}-*.json, which
// packages/tracks/test/fixtures.test.ts and apps/api/tests/test_tracks.py both read). On top of the sound package's
// validateTrack: author.kind 'generator', generator.name 'gsfpv-course', a title 'Course <seed36>', scene.kind 'scan' with a
// hex scene id, version 1 without a parent (the server keeps no versions in train 1).
import { validateTrack, type TrackFile } from '@shramko/sonic-fpv';
import { GENERATOR_NAME } from './generate';

export const SERVER_TITLE = /^Course [0-9a-z-]{1,24}$/;
export const SERVER_SCENE_ID = /^[0-9a-f]{6,32}$/;
/** An id the server issued: `<sceneId>-<8 hex>` (tracks.py SERVER_ID). */
export const SERVER_TRACK_ID = /^([0-9a-f]{6,32})-([0-9a-f]{8})$/;

export type ServerCheck = { ok: true; track: TrackFile } | { ok: false; issues: string[] };

export function validateServerTrack(input: unknown): ServerCheck {
    const v = validateTrack(input);
    const issues: string[] = v.ok ? [] : v.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
    const r = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const sub = (k: string): Record<string, unknown> | null => {
        const x = r[k];
        return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
    };
    if (typeof r.version === 'number' && r.version !== 1) issues.push('version: must be 1: the server keeps no versions yet');
    if ('parent' in r && r.parent !== null) issues.push('parent: must be null on the server');
    if (typeof r.title === 'string' && !SERVER_TITLE.test(r.title)) issues.push(`title: must match ${String(SERVER_TITLE)}`);
    const scene = sub('scene');
    if (scene && typeof scene.kind === 'string' && scene.kind !== 'scan') issues.push("scene.kind: must be 'scan'");
    if (scene && typeof scene.id === 'string' && !SERVER_SCENE_ID.test(scene.id)) issues.push('scene.id: must be 6-32 lowercase hex digits');
    const author = sub('author');
    if (author && typeof author.kind === 'string' && author.kind !== 'generator') issues.push("author.kind: must be 'generator'");
    if ('generator' in r && r.generator === null) issues.push('generator: must name the generator');
    const gen = sub('generator');
    if (gen && typeof gen.name === 'string' && gen.name !== GENERATOR_NAME) issues.push(`generator.name: must be '${GENERATOR_NAME}'`);
    const params = gen?.params;
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) paramIssues(params as Record<string, unknown>, issues);
    boundIssues(r, issues);
    return issues.length === 0 && v.ok ? { ok: true, track: v.value } : { ok: false, issues };
}

// Bounds against hostile files (lane review TR-1, TR-2, TR-3; tracks.py has the same numbers), ESTIMATES not measured: no scan
// the site serves is near 10000 units across, and the generator's legs are at most legMaxM 15 flown m, so 60 leaves room.
/** |x|, |y|, |z| of a gate or the start, scan units */
export const MAX_COORD = 10000;
/** one leg between two gates (and the leg back on a closed course), flown m */
export const MAX_LEG_M = 60;
/** the keys generateCourse writes into generator.params */
export const PARAM_KEYS: readonly string[] = ['marginM', 'cellM', 'freeDigest', 'wanted', 'rooms', 'volumeM3', 'tries', 'walked', 'stop', 'closed', 'proof'];
const PROOF_KEYS: readonly string[] = ['ok', 'marginM', 'pathM'];
const PARAM_TEXT_MAX = 40;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isFlat = (x: unknown): boolean => x === null || typeof x === 'boolean' || isNum(x) || (typeof x === 'string' && x.length <= PARAM_TEXT_MAX);

function paramIssues(p: Record<string, unknown>, issues: string[]): void {
    for (const [k, val] of Object.entries(p)) {
        const path = `generator.params.${k.slice(0, 40)}`;
        if (!PARAM_KEYS.includes(k)) issues.push(`${path}: is not a known key`);
        else if (k === 'proof' && typeof val === 'object' && val !== null && !Array.isArray(val)) {
            for (const [pk, pv] of Object.entries(val as Record<string, unknown>)) {
                if (!PROOF_KEYS.includes(pk) || !(typeof pv === 'boolean' || isNum(pv))) issues.push(`${path}.${pk.slice(0, 40)}: is not a known key or not a flat value`);
            }
        } else if (!isFlat(val)) issues.push(`${path}: must be a number, a boolean, null or a text of at most ${PARAM_TEXT_MAX} characters`);
    }
}

/** a coordinate beyond MAX_COORD (no Math.abs: architecture rule 8 for packages/tracks) */
const far = (c: number): boolean => c > MAX_COORD || c < -MAX_COORD;

function vec(x: unknown): [number, number, number] | null {
    return Array.isArray(x) && x.length === 3 && x.every(isNum) ? (x as [number, number, number]) : null;
}

function boundIssues(r: Record<string, unknown>, issues: string[]): void {
    const gates = Array.isArray(r.gates) ? (r.gates as unknown[]) : [];
    const pts: [number, number, number][] = [];
    gates.forEach((g, i) => {
        const pos = vec(typeof g === 'object' && g !== null ? (g as Record<string, unknown>).pos : null);
        if (!pos) return;
        if (pos.some(far)) issues.push(`gates[${i}].pos: must be within ${MAX_COORD} of the origin`);
        else pts.push(pos);
    });
    const start = typeof r.start === 'object' && r.start !== null ? vec((r.start as Record<string, unknown>).pos) : null;
    if (start && start.some(far)) issues.push(`start.pos: must be within ${MAX_COORD} of the origin`);
    const t = r.transform;
    const s = Array.isArray(t) && t.length === 4 && isNum(t[0]) && t[0] > 0 && t[0] <= 1000 ? t[0] : null;
    if (s === null || pts.length === 0 || pts.length !== gates.length) return;
    const legs: [number, number][] = pts.slice(1).map((_, i) => [i, i + 1]);
    if (isNum(r.laps) && r.laps > 1 && pts.length > 1) legs.push([pts.length - 1, 0]);
    for (const [a, b] of legs) {
        const p = pts[a]!, q = pts[b]!;
        const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) * s > MAX_LEG_M) {
            issues.push(`gates[${a}]: the leg to the next gate must be at most ${MAX_LEG_M} m`);
            return;
        }
    }
}

/** Bytes as the server reads them: JSON.parse refuses NaN and Infinity, as tracks.py parse_track does. */
export function parseServerTrack(text: string): ServerCheck {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
    return validateServerTrack(data);
}
