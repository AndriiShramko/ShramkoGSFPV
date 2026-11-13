// Train 1, lane rooms, A6: flying in a room is the same flight. The determinism script of tools/bench/src/a6-run.ts
// (packages/input/src/sim/determinism.ts, fixture 39e63ce9, 60 Hz frames) flown with the rooms pose reader attached the
// way the page attaches it (apps/fly/src/app/builtin/rooms.ts: on every frame, at 15 Hz, simPose + encodePose of the
// shown sim) gives the same trace hash as solo. Control: the perturb seam of packages/sim-core/src/sim.ts changes it.
import { describe, expect, it } from 'vitest';
import { InputLog, Runner, Sim } from '@gsfpv/sim-core';
import type { ContactWorld, SimParams } from '@gsfpv/sim-core';
import { DET_DURATION_S, DET_SEED, determinismScript, renderScript, runDeterminism } from '@gsfpv/input/sim';
import { loadScene } from '../src/scenes';
import { params } from '../src/presets';
import { PoseClock, simPose } from '../../../apps/fly/src/rooms/pose';
import { decodePose, encodePose } from '../../../apps/fly/src/rooms/codec';

/** runDeterminism's loop with the rooms pose reader on every frame; returns the hash and the poses read. */
function flyWithRoom(p: SimParams, world: ContactWorld | null, spawn: [number, number, number, number], frameHz: number, perturb: (() => number) | null): { hash: string; poses: number } {
    const samples = renderScript(determinismScript(), DET_DURATION_S, 250, 400, DET_SEED);
    const sim = new Sim(p, world);
    sim.reset(spawn[0], spawn[1], spawn[2], spawn[3]);
    sim.perturb = perturb;
    const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: p.presetId, configHash: '', collisionSha256: null, spawn, seed: DET_SEED });
    const runner = new Runner(sim, log, true);
    const clock = new PoseClock();
    const endUs = DET_DURATION_S * 1_000_000;
    const period = 1e6 / frameHz;
    let si = 0, poses = 0;
    for (let k = 1; ; k++) {
        const t = Math.min(endUs, Math.round(k * period));
        while (si < samples.length && samples[si].tUs <= t) runner.enqueue(samples[si++]);
        runner.advanceTo(t);
        // the page's 'frame' event: the pose reader reads the shown sim
        const seq = clock.due(t / 1000);
        if (seq !== null && decodePose(encodePose(simPose(sim, seq, false)))) poses++;
        if (t >= endUs) break;
    }
    return { hash: runner.traceHash(), poses };
}

describe('A6 with a room on (the rooms pose reader attached)', () => {
    it('gives the same trace hash as solo; control: the perturb seam changes it', async () => {
        const sc = await loadScene('39e63ce9');
        const p = params('pavo20pro-3s');
        const pos = sc.settings.position, tgt = sc.settings.target;
        const spawn: [number, number, number, number] = [pos[0], pos[1], pos[2], (Math.atan2(tgt[0] - pos[0], -(tgt[2] - pos[2])) * 180) / Math.PI];
        const solo = runDeterminism(p, sc.world, spawn, 60).hash;
        const room = flyWithRoom(p, sc.world, spawn, 60, null);
        // 30 s at 15 poses a second
        expect(room.poses).toBeGreaterThanOrEqual(449);
        expect(room.hash).toBe(solo);
        let k = 0;
        const ctl = flyWithRoom(p, sc.world, spawn, 60, () => (k++ % 7 === 0 ? 1 : 0));
        expect(ctl.hash).not.toBe(solo);
    }, 180000);
});
