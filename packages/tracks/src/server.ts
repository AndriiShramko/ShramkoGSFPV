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
    return issues.length === 0 && v.ok ? { ok: true, track: v.value } : { ok: false, issues };
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
