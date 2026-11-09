// v0.13 lane v13-look L1-4 (W16; docs/wip/v13-look.md): the analytic contact world's whole-body shortcut
// (packages/collision/src/analytic.ts AnalyticContactWorld.sweep and pushOut: a ball around every sphere's first sweep test
// within the free radius at its centre, from the cell or from the distance at the point) is exact where it matters most,
// in tunnel-long's 0.7 m ways at 0.05 m voxels: the flight model's queries along the track (a disarmed craft let go at
// 12 of the track's points with the lesson's own bump rule, as tools/bench/test/sonic-tunnel-cost.ts flies all 62) get
// the same answers from the session's world as from the voxel walls with no shortcut at all, and the distance at the
// point is what answers most of them.
//   - control: the same shortcut over a distance that lies (the walls said to be 0.3 m further off than they are) answers
//     "free" where the voxels are solid, and its answers differ.
import { describe, expect, it } from 'vitest';
import { S, Sim } from '../../../packages/sim-core/src';
import { AnalyticContactWorld, VoxelContactWorld, analyticCollision } from '../../../packages/collision/src';
import { getLesson } from '../../../packages/sonic-fpv/src';
import type { Vec3, WorldCheckpoint } from '../../../packages/sonic-fpv/src';
import { lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import { Recorder, askAll } from './sonic-world-flight';
import { params } from './game-loop';

const lesson = getLesson('tunnel-long');
const lw = lessonWorldOf(lesson)!;
const world = lw.world;
const track = (world as unknown as { readonly checkpoints: readonly WorldCheckpoint[] }).checkpoints;

/** The flight model's queries over 12 of the track's points, 1 s each (sonic-tunnel-cost.ts's flights). */
function queries(): Recorder['queries'] {
    const rec = new Recorder(lw.builtin.contact!);
    const speed = lesson.assists.maxSpeedMps ?? 2.5;
    for (let i = 0; i < track.length; i += Math.ceil(track.length / 12)) {
        const cp = track[i]!;
        const sim = new Sim(params('pavo20pro-3s', { crashOn: false, ...lw.builtin.overrides }), rec);
        sim.reset(cp.pos[0], cp.pos[1], cp.pos[2], (Math.atan2(cp.dir[0], -cp.dir[2]) * 180) / Math.PI);
        sim.s[S.hold] = 0;
        const left: Vec3 = [cp.dir[2], 0, -cp.dir[0]];
        sim.s[S.vx] = cp.dir[0] * speed + left[0] * 0.5;
        sim.s[S.vz] = cp.dir[2] * speed + left[2] * 0.5;
        for (let t = 0; t < 1000; t++) sim.step();
    }
    return rec.queries;
}

describe('the whole-body shortcut of the analytic contact world (W16)', () => {
    const qs = queries();

    it('tunnel-long: the session\'s world answers every query of the flights as the voxels with no shortcut do, and the distance at the point answers many', () => {
        const walls = analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, world.sdf);
        const session = new AnalyticContactWorld(walls);
        const raw = new VoxelContactWorld(analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, null));
        const a = askAll(session, qs);
        const b = askAll(raw, qs);
        console.log(`sonic-tunnel-walls: ${qs.length} queries, the distance asked ${walls.stats.distanceCalls} times; session ${a.ms.toFixed(1)} ms, no shortcut ${b.ms.toFixed(1)} ms`);
        expect(qs.length).toBeGreaterThan(10000);
        expect(a.answers).toBe(b.answers);
        expect(walls.stats.distanceCalls).toBeGreaterThan(qs.length / 20);
    });

    it('control: the shortcut over a distance that lies (walls 0.3 m further off) answers "free" into the walls: the answers differ', () => {
        const lying = (x: number, y: number, z: number): number => world.sdf(x, y, z) + 0.3;
        const session = new AnalyticContactWorld(analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, lying));
        const raw = new VoxelContactWorld(analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, null));
        expect(askAll(session, qs).answers).not.toBe(askAll(raw, qs).answers);
    });
});
