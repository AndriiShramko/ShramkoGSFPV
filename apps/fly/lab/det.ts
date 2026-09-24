// A6 in the browser: the same determinism runs as in Node, plus one run paced by real frames.
import { compileParams, Runner, Sim, InputLog } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld } from '@gsfpv/collision';
import { runDeterminism, replayDeterminism, renderScript, determinismScript, DET_SEED, DET_DURATION_S } from '@gsfpv/input/sim';
import { PRESETS } from '../src/presets';

const out: Record<string, unknown> = { status: 'running' };
(window as unknown as { __det: unknown }).__det = out;

async function run() {
    const q = new URLSearchParams(location.search);
    const p = compileParams(PRESETS['pavo20pro-3s']);
    const col = await fetchVoxelCollision('https://s3-eu-west-1.amazonaws.com/splats.playcanvas.com/39e63ce9/v1/scene.voxel.json');
    const world = new VoxelContactWorld(col.collision);
    const spawn = JSON.parse(q.get('spawn') ?? '[0.6857250332832336,1.5809873342514038,0.6940217018127441,-107.22887701503547]') as [number, number, number, number];
    const results = [];
    for (const hz of [30, 60, 144, 240]) {
        const r = runDeterminism(p, world, spawn, hz);
        results.push({ frameHz: r.frameHz, hash: r.hash, ticks: r.ticks, hitches: r.hitches, crashed: r.crashed });
    }
    const base = runDeterminism(p, world, spawn, 60);
    const rep = replayDeterminism(p, world, spawn, base.log, base.ticks);
    const ctl = runDeterminism(p, world, spawn, 60, Math.random);

    // real frames: the browser's own rAF cadence drives advanceTo, like the app does
    const samples = renderScript(determinismScript(), DET_DURATION_S, 250, 400, DET_SEED);
    const sim = new Sim(p, world);
    sim.reset(...spawn);
    const runner = new Runner(sim, new InputLog(base.log.header), true);
    const endUs = DET_DURATION_S * 1_000_000;
    const speed = 10; // 10x real time so the page run takes 3 s; frame boundaries still come from rAF
    const frameTimes: number[] = [];
    await new Promise<void>((resolve) => {
        const t0 = performance.now();
        let si = 0;
        const tick = (now: number) => {
            frameTimes.push(now);
            const t = Math.min(endUs, Math.round((now - t0) * 1000 * speed));
            while (si < samples.length && samples[si].tUs <= t) runner.enqueue(samples[si++]);
            let guard = 0;
            while (sim.tick * 1000 + 1000 <= t && guard++ < 100000) runner.stepOnce();
            if (t >= endUs) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    const dts = frameTimes.slice(1).map((t, i) => t - frameTimes[i]).sort((a, b) => a - b);
    Object.assign(out, {
        status: 'done',
        userAgent: navigator.userAgent,
        collisionSha: null,
        splits: results,
        replayFromInputLog: { hash: rep.hash, ticks: rep.ticks },
        rafPaced: { hash: runner.traceHash(), ticks: sim.tick, frames: frameTimes.length, medianFrameMs: dts[dts.length >> 1] },
        control: { name: 'Math.random added to the thrust must change the hash', hash: ctl.hash }
    });
}

run().catch((e) => Object.assign(out, { status: 'error', error: String(e?.stack ?? e) }));
