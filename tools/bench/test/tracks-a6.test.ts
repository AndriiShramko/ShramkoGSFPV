// Lane tracks T2, A6: a scripted flight with the course on has the same trace hash as the same flight without it. The
// course (apps/fly/src/course/run.ts, what the feature runs every drawn frame) reads the craft's position and the sim's
// clock between frames, as the page does, and writes nothing. Model: tools/bench/src/a6-run.ts (runDeterminism of
// @gsfpv/input/sim, 60 Hz frames). Control: the sim's perturb seam changes the hash, so the comparison can fail.
import { describe, expect, it } from 'vitest';
import { InputLog, Runner, S, Sim } from '../../../packages/sim-core/src';
import { DET_DURATION_S, DET_SEED, determinismScript, renderScript } from '../../../packages/input/src/sim';
import { freeSpace, generateCourse } from '@gsfpv/tracks';
import { CourseRun } from '../../../apps/fly/src/course/run';
import { params } from '../src/presets';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';

const SPAWN: [number, number, number, number] = [0, 1.5, 0, 0];

/** runDeterminism's loop, with `onFrame` after every 60 Hz frame. */
function flight(onFrame: ((sim: Sim) => void) | null, perturb: (() => number) | null = null): { hash: string; ticks: number } {
    const p = params('pavo20pro-3s');
    const samples = renderScript(determinismScript(), DET_DURATION_S, 250, 400, DET_SEED);
    const sim = new Sim(p, null);
    sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], SPAWN[3]);
    sim.perturb = perturb;
    const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: p.presetId, configHash: '', collisionSha256: null, spawn: SPAWN, seed: DET_SEED });
    const runner = new Runner(sim, log, true);
    const endUs = DET_DURATION_S * 1_000_000;
    let si = 0;
    const period = 1e6 / 60;
    for (let k = 1; ; k++) {
        const tUs = Math.min(endUs, Math.round(k * period));
        while (si < samples.length && samples[si]!.tUs <= tUs) runner.enqueue(samples[si++]!);
        runner.advanceTo(tUs);
        onFrame?.(sim);
        if (tUs >= endUs) break;
    }
    return { hash: runner.traceHash(), ticks: sim.tick };
}

describe('A6 with the course on', () => {
    const walls = threeRooms();
    const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 11, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });

    it('the trace hash with the course fed every frame equals the solo one; control: perturb changes it', () => {
        expect(track.gates.length).toBeGreaterThanOrEqual(3);
        const solo = flight(null);
        const run = new CourseRun(track, { s: 1, t: [0, 0, 0] });
        let fed = 0;
        const withCourse = flight((sim) => {
            run.feed(sim.tick, [sim.s[S.px], sim.s[S.py], sim.s[S.pz]]);
            run.view(sim.tick);
            fed++;
        });
        expect(fed).toBeGreaterThan(1000);
        expect(withCourse.ticks).toBe(solo.ticks);
        expect(withCourse.hash).toBe(solo.hash);
        let k = 0;
        const perturbed = flight(null, () => ((k++ * 2654435761) % 1000) / 1000);
        expect(perturbed.hash).not.toBe(solo.hash);
    });
});
