// The page's v0.2 session still runs a format /1 runner until the session moves to lives (W2-2).
// Lead contract step before wave 2: its FlightStats (runner.stats) must start a new life at every
// respawn, like the lives runner does, so the summary (W2-4) can show "this life" today.
import { describe, expect, it } from 'vitest';
import { FlightStats, InputLog, Runner, SIM_CORE_VERSION, compileParams, lifeSim } from '../src/index';
import { PRESET, Pilot, PlaneWorld, runFrames } from './log-kit';

function fly(attach: 'runner' | 'onStep'): { st: FlightStats; respawnTick: number; endTick: number } {
    const world = PlaneWorld.room();
    const at: [number, number, number, number] = [0, 1, 0, 0];
    const sim = lifeSim(compileParams(PRESET), world);
    sim.reset(at[0], at[1], at[2], at[3]);
    const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: SIM_CORE_VERSION, preset: PRESET.id, configHash: '', collisionSha256: null, spawn: at, seed: 0 });
    const r = new Runner(sim, log, false);
    const st = new FlightStats([at[0], at[1], at[2]], 550);
    if (attach === 'runner') r.stats = st;
    else {
        // control: the same counter fed only per step, so nothing tells it about the respawn
        const prev = r.onStep;
        r.onStep = (s) => { prev?.(s); st.onStep(s); };
    }
    const pilot = new Pilot(r); // format /1: one life from tick 0
    pilot.plan = (pp, sm) => { if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [0, 1, 0], yawDeg: 0 }, sm); pp.phase = 'hover'; } };
    runFrames(r, 60, 6_000_000);
    const respawnTick = r.sim.tick;
    r.respawn(0, 1, 0, 0);
    pilot.phase = ''; // the bot hovers again from the respawn
    runFrames(r, 60, 9_000_000, { phaseUs: 6_000_000 });
    return { st, respawnTick, endTick: r.sim.tick };
}

describe('FlightStats on the format /1 runner', () => {
    it('a respawn starts a new life: life airtime counts from the respawn, the session keeps the total', () => {
        const { st, respawnTick, endTick } = fly('runner');
        const life = st.life(), ses = st.session();
        expect(ses.airtimeS).toBeGreaterThan(4); // armed for most of 6 s, then again after the respawn
        expect(life.airtimeS).toBeLessThanOrEqual((endTick - respawnTick) / 1000 + 1e-9);
        expect(life.airtimeS).toBeLessThan(ses.airtimeS - 3);
    });

    it('control: without the runner telling it, the "life" is the whole flight', () => {
        const { st } = fly('onStep');
        expect(st.life().airtimeS).toBeCloseTo(st.session().airtimeS, 9);
    });
});
