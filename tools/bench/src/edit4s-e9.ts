// Lane edit4s, train 4 stage S2 (complaint E9: 'cannot save, try another time' on a generated course). Node replica of
// the page's Save of an untouched generated course: fitCourse as the page's worker, the body saveMine (builtin/course.ts)
// posts with the name 'Andrii Shramko' and the title the panel shows (the generated one), then validateServerTrack, the
// check store.ts runs before the post (and tracks.py repeats). Prints the issues by kind; --out writes the bodies so that
// apps/api/tracks.py validate_track can be run on the same files. Read only; no browser, no network for the walls.
//
//   cd tools/bench && npx tsx src/edit4s-e9.ts --walls <dir with scene.voxel.json and .bin> --scene 70b50d42 [--seeds 1-50] [--out f.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { checkTrack, fitCourse, flownCollision, freeSpace, marginOf, toTrackV1, upgradeTrack, validateServerTrack, COURSE_DEFAULTS, FIT_BUDGET_MS } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';
import type { TrackFile } from '@shramko/sonic-fpv';

const arg = (n: string): string | null => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const scene = arg('--scene') ?? '70b50d42';
const dir = arg('--walls');
if (!dir) throw new Error('--walls <dir> is needed');
const range = (arg('--seeds') ?? '1-50').split('-').map(Number);
const seeds = Array.from({ length: (range[1] ?? range[0]!) - range[0]! + 1 }, (_, i) => range[0]! + i);
const T: SceneTransform = [1, 0, 0, 0];

const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
const walls = flownCollision(openVoxelCollision(meta, new Uint8Array(readFileSync(join(dir, 'scene.voxel.bin')))), T);
const settings = (await (await fetch(`https://d28zzqy0iyovbz.cloudfront.net/${scene}/v1/settings.json`)).json()) as { cameras?: { initial?: { position: Vec3 } }[]; camera?: { position: Vec3 } };
const spawn = (settings.cameras?.[0]?.initial ?? settings.camera)!.position;
const free = freeSpace(walls, { spawn });
/** the kind of an issue: its text without numbers (gates[3] and gates[7] count as one kind) */
const kind = (s: string): string => s.replace(/\d+/g, '#');
const kinds: Record<string, number> = {};
const bodies: TrackFile[] = [];
let tried = 0;
let refusedByCheck = 0;
for (const seed of seeds) {
    const fit = fitCourse(free, walls, { seed, scene: { id: scene, version: 1 }, transform: T, created: '2026-11-19T00:00:00.000Z' }, COURSE_DEFAULTS.gatesMin, undefined, { at: performance.now() + FIT_BUDGET_MS, now: () => performance.now() });
    const track = fit.track;
    if (!track) continue;
    tried++;
    const course = upgradeTrack(track);
    const rep = checkTrack(track, walls, T, marginOf(track), true);
    const pass = rep.startClear && rep.outside.length === 0 && rep.legs.every((l) => l.clear) && rep.gates.every((g) => g.clear && g.directionOk);
    if (!pass) refusedByCheck++;
    // builtin/course.ts saveMine: a generated course (no server id, no token)
    const edited = toTrackV1(course);
    const body: TrackFile = { ...edited, id: edited.id, version: 1, parent: null, author: { kind: 'person', name: 'Andrii Shramko' }, title: track.title, generator: null };
    bodies.push(body);
    const v = validateServerTrack(JSON.parse(JSON.stringify(body)));
    const issues = v.ok ? [] : v.issues;
    for (const i of issues) kinds[kind(i)] = (kinds[kind(i)] ?? 0) + 1;
    console.log(JSON.stringify({ seed, gates: track.gates.length, laps: track.laps ?? null, checkPasses: pass, serverIssues: issues.slice(0, 3) }));
}
console.log(JSON.stringify({ scene, tried, refusedByCheck, refusedByServerCheck: bodies.length - bodies.filter((b) => validateServerTrack(JSON.parse(JSON.stringify(b))).ok).length, kinds }));
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify(bodies));
