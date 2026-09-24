// A6 determinism run, shared verbatim by Node and the browser: the same scripted 30 s of stick
// input, delivered with different frame splits, must give the same SHA-256 of the full trace.

import { Sim, Runner, InputLog, replay } from '@gsfpv/sim-core';
import type { SimParams, ContactWorld } from '@gsfpv/sim-core';
import { renderScript, determinismScript } from './signals';

export interface DetResult {
    frameHz: number | 'replay';
    hash: string;
    ticks: number;
    hitches: number;
    crashed: boolean;
}

export const DET_DURATION_S = 30;
export const DET_SEED = 42;

/** Run the script with frames at frameHz (0 = one frame per tick). perturb only for the control. */
export function runDeterminism(p: SimParams, world: ContactWorld | null, spawn: [number, number, number, number], frameHz: number, perturb: (() => number) | null = null): DetResult & { log: InputLog } {
    const samples = renderScript(determinismScript(), DET_DURATION_S, 250, 400, DET_SEED);
    const sim = new Sim(p, world);
    sim.reset(spawn[0], spawn[1], spawn[2], spawn[3]);
    sim.perturb = perturb;
    const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: p.presetId, configHash: '', collisionSha256: null, spawn, seed: DET_SEED });
    const runner = new Runner(sim, log, true);
    const endUs = DET_DURATION_S * 1_000_000;
    let si = 0;
    const period = frameHz > 0 ? 1e6 / frameHz : 1000;
    for (let k = 1; ; k++) {
        const t = Math.min(endUs, Math.round(k * period));
        while (si < samples.length && samples[si].tUs <= t) runner.enqueue(samples[si++]);
        runner.advanceTo(t);
        if (t >= endUs) break;
    }
    return { frameHz, hash: runner.traceHash(), ticks: sim.tick, hitches: runner.hitches, crashed: sim.crashed, log };
}

/** Replay a recorded input log on a fresh sim (the trajectory stream is not used at all). */
export function replayDeterminism(p: SimParams, world: ContactWorld | null, spawn: [number, number, number, number], log: InputLog, ticks: number): DetResult {
    const sim = new Sim(p, world);
    sim.reset(spawn[0], spawn[1], spawn[2], spawn[3]);
    const hash = replay(sim, log, ticks);
    return { frameHz: 'replay', hash, ticks: sim.tick, hitches: 0, crashed: sim.crashed };
}
