// v0.13, lane v13-host A6 (W16 of the sound package's merge review; docs/wip/v13-host.md): what tunnel-long's walls cost the
// flight model, measured once. tunnel-long is the largest lesson world (bounds 102 x 4.4 x 65 m) and one of the two built at
// 0.05 m voxels (its ways are 0.7 m), so its collider has the most cells; sonic-world-cost.ts measures v0.12's hall only.
//   - the build: lessonWorldOf (the analytic collider and its contact world), ms;
//   - the contact queries: at every point of the world's track a disarmed craft is let go along the track at the lesson's
//     speed cap and a little toward the left wall, for 1 s (it falls, meets the floor and the walls, slides), every query
//     of the flight model recorded; then asked again the three ways (as the session flies, the cells only, no cull), best of
//     9 rounds, scaled to 10 s of flight at 1 kHz, against the plan's 20 ms for 10 s of flight (v0.12, sonic-world-cost.ts).
// v0.13 lane v13-look (L1-4, W16): the craft flies the lesson world's own flight rules (BuiltinWorld.overrides: the bump
// 'slide' of M41-19, which bounces it off the walls instead of grinding along them), as the session flies them now;
// DRONE_BUMP=1 flies the drone's own contact, as A6 measured (23.24 ms). The session's walls answer with the whole-body
// shortcut of AnalyticContactWorld (its exactness: sonic-tunnel-walls.test.ts).
// Evidence: evidence/<date>/sonic-tunnel-cost.json.
//   cd tools/bench && npx tsx test/sonic-tunnel-cost.ts
import { S, Sim } from '../../../packages/sim-core/src';
import { getLesson } from '../../../packages/sonic-fpv/src';
import type { Vec3, WorldCheckpoint } from '../../../packages/sonic-fpv/src';
import { lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import { Recorder, costKinds, measureKinds } from './sonic-world-flight';
import { params } from './game-loop';
import { writeEvidence } from '../src/evidence';

const PLAN_BOUND_MS = 20;
const ROUNDS = 9;
const FLIGHT_TICKS = 1000;
const ms = (n: number): number => Math.round(n * 100) / 100;

const lesson = getLesson('tunnel-long');
const t0 = performance.now();
const lw = lessonWorldOf(lesson)!;
const buildMs = performance.now() - t0;
const col = lw.collision;
const track = (lw.world as unknown as { readonly checkpoints: readonly WorldCheckpoint[] }).checkpoints;
const speed = lesson.assists.maxSpeedMps ?? 2.5;

const timed = new Recorder(lw.builtin.contact!);
let contacts = 0, ticks = 0;
for (const cp of track) {
    const sim = new Sim(params('pavo20pro-3s', { crashOn: false, ...(process.env.DRONE_BUMP === '1' ? {} : lw.builtin.overrides) }), timed);
    const [x, y, z] = cp.pos;
    sim.reset(x, y, z, (Math.atan2(cp.dir[0], -cp.dir[2]) * 180) / Math.PI);
    sim.s[S.hold] = 0; // let go: gravity and the push only
    const left: Vec3 = [cp.dir[2], 0, -cp.dir[0]];
    sim.s[S.vx] = cp.dir[0] * speed + left[0] * 0.5;
    sim.s[S.vz] = cp.dir[2] * speed + left[2] * 0.5;
    for (let i = 0; i < FLIGHT_TICKS; i++) {
        const n = sim.events.length;
        sim.step();
        ticks++;
        for (let j = n; j < sim.events.length; j++) if (sim.events[j]!.type === 'contact') contacts++;
    }
}
measureKinds(timed.queries, costKinds(lw.world), 1); // warm-up
const { best, answers } = measureKinds(timed.queries, costKinds(lw.world), ROUNDS);
const per10s = (v: number): number => (v * 10000) / ticks;
const result = {
    world: { id: lw.world.id, voxelM: lw.world.voxelM, bounds: lw.world.bounds, voxels: col.numVoxelsX * col.numVoxelsY * col.numVoxelsZ, trackPoints: track.length },
    buildMs: ms(buildMs),
    flight: { ticks, queries: timed.queries.length, contacts },
    bestMs: { session: ms(best.session), cells: ms(best.cells), raw: ms(best.raw) },
    per10sMs: { session: ms(per10s(best.session)), cells: ms(per10s(best.cells)), raw: ms(per10s(best.raw)) },
    sameAnswers: answers.session === answers.raw && answers.cells === answers.raw,
    cells: { uniform: col.stats.cellsUniform, mixed: col.stats.cellsMixed }
};
const pass = result.per10sMs.session < PLAN_BOUND_MS && result.sameAnswers;
const file = writeEvidence('sonic-tunnel-cost', { planBoundMs: PLAN_BOUND_MS, rounds: ROUNDS, bump: process.env.DRONE_BUMP === '1' ? 'drone' : 'lesson', pass, result });
console.log(JSON.stringify(result, null, 1));
console.log(`${pass ? 'PASS' : 'OVER'}: ${result.per10sMs.session} ms of contact queries for 10 s of flight in tunnel-long (${PLAN_BOUND_MS} allowed); ${file}`);
process.exitCode = pass ? 0 : 1;
