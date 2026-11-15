// Lane editor3, train 3 stage H1-tunis (a): does an untouched generated course on a scan pass the editor's Save check?
// Node replica of the page: the CDN walls of the scan, fitCourse as the page's worker (no quality box, 120 s deadline),
// then checkTrack with measure=true at the course's own margin. For each refused leg and gate: freeM, the place, the
// height above the ground (a downward sweep) and the nearest wall's distance. Read only; no browser, no GPU.
//
//   cd tools/bench && npx tsx src/editor3-tunis-check.ts [--scene 887f27aa] [--seeds 1,2,3] [--transform s,tx,ty,tz] [--out f.json]
import { writeFileSync } from 'node:fs';
import { checkTrack, fitCourse, flownCollision, freeSpace, marginOf, nearestWall, sweepFree, COURSE_DEFAULTS, FIT_BUDGET_MS } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';
import { loadScene } from './scenes';

const arg = (n: string): string | null => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const scene = arg('--scene') ?? '887f27aa';
const seeds = (arg('--seeds') ?? '1,2,3').split(',').map(Number);
const T = (arg('--transform') ?? '1,0,0,0').split(',').map(Number) as unknown as SceneTransform;
const r2 = (x: number): number => Math.round(x * 100) / 100;

const sc = await loadScene(scene);
const walls = flownCollision(sc.collision, T);
const s0 = sc.settings.position;
const spawn: Vec3 = [T[0] * s0[0] + T[1], T[0] * s0[1] + T[2], T[0] * s0[2] + T[3]];
const free = freeSpace(walls, { spawn });
/** metres of free fall below p (a thin sweep straight down, 5 cm steps, up to 60 m) */
const height = (p: Vec3): number => {
    let h = 0;
    while (h < 60 && sweepFree(walls, p, [p[0], p[1] - (h + 0.05), p[2]], 0.02)) h += 0.05;
    return r2(h);
};
const where = (p: Vec3): Record<string, unknown> => ({ at: p.map(r2), aboveGround: height(p), nearestWallM: r2(nearestWall(walls, p)?.distance ?? -1) });
const rows: unknown[] = [];
for (const seed of seeds) {
    const t0 = performance.now();
    const fit = fitCourse(free, walls, { seed, scene: { id: scene, version: 1 }, transform: T, created: '2026-11-15T00:00:00.000Z' }, COURSE_DEFAULTS.gatesMin, undefined, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() });
    const track = fit.track;
    if (!track) {
        rows.push({ seed, track: null });
        continue;
    }
    const margin = marginOf(track);
    const rep = checkTrack(track, walls, T, margin, true);
    const pos = new Map<string, Vec3>(track.gates.map((g) => [g.id, [T[0] * g.pos[0] + T[1], T[0] * g.pos[1] + T[2], T[0] * g.pos[2] + T[3]] as Vec3]));
    const num = (id: string): number => track.gates.findIndex((g) => g.id === id) + 1;
    const legs = rep.legs.filter((l) => !l.clear).map((l) => ({ from: l.from === 'start' ? 'start' : num(l.from), to: num(l.to), freeM: r2(l.freeM), to_gate: pos.get(l.to) ? where(pos.get(l.to)!) : null }));
    const gates = rep.gates.filter((g) => !g.clear || !g.directionOk).map((g) => ({ gate: num(g.id), clear: g.clear, freeM: r2(g.freeM), directionOk: g.directionOk, axisInDeg: Math.round(g.axisInDeg), ...where(pos.get(g.id)!) }));
    const row = { seed, gates: track.gates.length, margin, scale: fit.scale, ms: Math.round(performance.now() - t0), startClear: rep.startClear, startFreeM: r2(rep.startFreeM), outside: rep.outside.length, refusedLegs: legs, refusedGates: gates, passes: rep.startClear && rep.outside.length === 0 && legs.length === 0 && gates.length === 0 };
    rows.push(row);
    console.log(JSON.stringify({ seed, gates: row.gates, passes: row.passes, legs: legs.length, badGates: gates.length, startClear: row.startClear, ms: row.ms }));
}
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify({ scene, T, spawn, rows }, null, 1));
