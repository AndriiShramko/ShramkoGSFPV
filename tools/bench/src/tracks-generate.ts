// Train 1, lane tracks, stage T1 (docs/wip/train1-plan.md section 3, tracks-plan.md 2.1-2.2): the course generator on real
// walls. For each cached scan (the walls loaded as tools/bench/test/sonic-garden.test.ts loads them: tools/bench/src/scenes.ts,
// .cache/scenes or the CDN once) it builds the free space at the flown size, measures the free-space pass (time, bytes of
// its arrays, the process's peak resident memory), generates courses for three seeds, proves each with checkTrack (measured:
// minimum free radius, path length), validates the file, checks the beacon path (coursePath, pathProblems with the walls),
// and writes a top view per scene. It also counts the well scanned cells at three enclosure thresholds, so the effect of the
// default (0.7, an estimate in freespace.ts) is on record.
//
//   cd tools/bench && npx tsx src/tracks-generate.ts [--scenes id,id]
// Evidence: evidence/<date>/tracks-generate.json and tracks-generate-<scene>.png. Node only: no browser, no GPU.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLesson, validateTrack } from '../../../packages/sonic-fpv/src';
import type { LessonDef, SceneTransform, Vec3 } from '../../../packages/sonic-fpv/src';
import { FREE_DEFAULTS, checkTrack, coursePath, flownCollision, freeSpace, generateCourse, pathProblems, sweeperOf } from '@gsfpv/tracks';
import type { FreeSpace } from '@gsfpv/tracks';
import { REPO, today, writeEvidence } from './evidence';
import { loadScene } from './scenes';
import { topView } from './sonic-track-check';

const garden = getLesson('free-garden').world as Extract<LessonDef['world'], { kind: 'scan' }>;
/** Winter Garden at the lesson's size; the others at their own size. */
const SCENES: { id: string; transform: SceneTransform; note: string }[] = [
    { id: '7a475d38', transform: garden.transform, note: 'Winter Garden at the free-garden lesson size' },
    { id: '887f27aa', transform: [1, 0, 0, 0], note: 'cached scan, own size' },
    { id: '39e63ce9', transform: [1, 0, 0, 0], note: 'fixture scene of the page probes, own size' },
    { id: 'bd04e182', transform: [1, 0, 0, 0], note: 'cached scan, own size' }
];
const SEEDS = [1, 2, 3];
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const arrayBytes = (f: FreeSpace): number => f.solid.byteLength + f.clearance.byteLength + f.room.byteLength;

function cliArg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
    const only = cliArg('--scenes')?.split(',') ?? null;
    const stamp = today();
    const dir = join(REPO, 'evidence', stamp);
    mkdirSync(dir, { recursive: true });
    const results: Record<string, unknown>[] = [];
    let peakRss = process.memoryUsage().rss;
    const sample = (): void => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
    };
    for (const sc of SCENES) {
        if (only && !only.includes(sc.id)) continue;
        let scene;
        try {
            scene = await loadScene(sc.id);
        } catch (e) {
            results.push({ scene: sc.id, error: `walls not loaded: ${String(e).slice(0, 200)}` });
            continue;
        }
        const T = sc.transform;
        const walls = flownCollision(scene.collision, T);
        const p = scene.settings.position;
        const spawn: Vec3 = [T[0] * p[0] + T[1], T[0] * p[1] + T[2], T[0] * p[2] + T[3]];
        const rssBefore = process.memoryUsage().rss;
        const t0 = performance.now();
        const free = freeSpace(walls, { spawn });
        const freeMs = performance.now() - t0;
        sample();
        const thresholds = [0.5, 0.7, 0.9].map((e) => {
            const f = e === FREE_DEFAULTS.enclosureMin ? free : freeSpace(walls, { spawn, enclosureMin: e });
            sample();
            return { enclosureMin: e, scanned: f.stats.scanned, usable: f.stats.usable, volumeM3: r3(f.volumeM3), rooms: f.rooms.length };
        });
        const courses = SEEDS.map((seed) => {
            const g0 = performance.now();
            const track = generateCourse(free, walls, { seed, scene: { id: sc.id, version: 1 }, transform: T, created: `${stamp}T00:00:00.000Z` });
            const genMs = performance.now() - g0;
            sample();
            if (track.gates.length === 0) return { seed, gates: 0, genMs: Math.round(genMs), note: 'no gate fits' };
            const proof = checkTrack(track, walls, T, 0.5);
            const path = coursePath(track, T);
            const problems = pathProblems(path, track, T, sweeperOf(walls), 0.3);
            if (seed === SEEDS[0]) writeFileSync(join(dir, `tracks-generate-${sc.id}.png`), topView(track, walls, T));
            return {
                seed,
                id: track.id,
                title: track.title,
                gates: track.gates.length,
                kinds: track.gates.map((g) => g.shape.kind[0]).join(''),
                wanted: track.generator?.params.wanted,
                valid: validateTrack(JSON.parse(JSON.stringify(track))).ok,
                proofOk: proof.ok,
                pathM: proof.pathM,
                minFreeM: proof.minFreeM,
                minGapM: proof.minGapM,
                beaconPoints: path.length,
                beaconProblems: problems.slice(0, 3),
                genMs: Math.round(genMs)
            };
        });
        results.push({
            scene: sc.id,
            note: sc.note,
            transform: T,
            walls: { voxelCm: r3(scene.metadata.voxelResolution * 100), flownCm: r3(walls.voxelResolution * 100), sha256: scene.sha256 },
            spawn: spawn.map(r3),
            free: {
                cellM: r3(free.cellM),
                dims: free.dims,
                stats: free.stats,
                rooms: free.rooms.length,
                volumeM3: r3(free.volumeM3),
                outdoor: free.outdoor,
                startFound: free.startCell >= 0,
                ms: Math.round(freeMs),
                arraysMB: r3(arrayBytes(free) / 1048576),
                rssGrowthMB: r3((process.memoryUsage().rss - rssBefore) / 1048576)
            },
            thresholds,
            courses
        });
        console.log(JSON.stringify(results[results.length - 1]).slice(0, 600));
    }
    const all = results.flatMap((r) => ((r.courses as { proofOk?: boolean; valid?: boolean; gates: number }[] | undefined) ?? []));
    const out = writeEvidence('tracks-generate', {
        step: 'tracks T1: the course generator on real walls',
        peakRssMB: r3(peakRss / 1048576),
        defaults: FREE_DEFAULTS,
        scenes: results,
        summary: { courses: all.length, withGates: all.filter((c) => c.gates > 0).length, proven: all.filter((c) => c.proofOk).length, valid: all.filter((c) => c.valid).length }
    });
    console.log(`evidence ${out}`);
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/tracks-generate\.(ts|js|mjs)$/.test(argv1)) await main();
