// Item 22 ("the arm switch works, the throttle does not"): the page -> sim clock of apps/fly. Each
// case runs the fixed clock and, as its negative control, the clock the app had before, which
// stamped samples on arrival and started a rebuilt model's clock without regard to a pause.

import { describe, expect, it } from 'vitest';
import { Sim, Runner, InputLog, compileParams, DT_US } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import pavo from '@gsfpv/sim-core/presets/pavo20pro-3s.json';
import { SimClock } from '../../../apps/fly/src/simclock';
import { runDeterminism } from '../src/sim/determinism';
import { renderScript, determinismScript } from '../src/sim/signals';
import { DET_DURATION_S, DET_SEED } from '../src/sim/determinism';

const P = compileParams(pavo as PresetJson);
const SPAWN: [number, number, number, number] = [0, 100, 0, 0];

function model(): Runner {
    const sim = new Sim(P, null);
    sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], SPAWN[3]);
    return new Runner(sim, null);
}

const frame = (thr: number): Float32Array => new Float32Array([0, 0, thr, 0, 1, -1, 0, 0]);

/** The clock of HEAD (session.ts before the fix), same interface. */
class HeadClock {
    private t0 = 0;
    private pausedAt = 0;
    paused = false;
    private runner: Runner | null = null;
    restart(now: number, runner: Runner): void { this.t0 = now; this.runner = runner; }
    pause(on: boolean, now: number): void {
        if (on === this.paused) return;
        if (on) this.pausedAt = now;
        else this.t0 += now - this.pausedAt;
        this.paused = on;
    }
    toSimUs(tMs: number): number { return Math.round((tMs - this.t0) * 1000); }
    push(ch: ArrayLike<number>, tMs: number): void {
        if (!this.paused) this.runner!.enqueue({ tUs: this.toSimUs(tMs), ch });
    }
    advance(runner: Runner, now: number): void {
        if (this.paused) return;
        const target = this.toSimUs(now);
        const before = runner.hitches;
        runner.advanceTo(target);
        if (runner.hitches > before) this.t0 += (target - runner.tUs) / 1000;
    }
}

type Clock = { restart(now: number, r: Runner): void; pause(on: boolean, now: number): void; push(ch: ArrayLike<number>, tMs: number): void; advance(r: Runner, now: number): void; toSimUs(t: number): number; paused: boolean };

function fixed(c = new SimClock()): Clock {
    return {
        restart: (now) => c.restart(now),
        pause: (on, now) => c.pause(on, now),
        push: (ch, t) => { if (!c.paused) c.push(ch, t); },
        advance: (r, now) => c.advance(r, now),
        toSimUs: (t) => c.toSimUs(t),
        get paused() { return c.paused; }
    };
}

/** A radio at 500 Hz and frames at 60 Hz from `from` to `to` (ms); `thr(t)` is the throttle stick. */
function fly(c: Clock, r: Runner, from: number, to: number, thr: (t: number) => number): void {
    let nextFrame = from;
    for (let t = from; t <= to; t += 2) {
        c.push(frame(thr(t)), t);
        if (t >= nextFrame) { c.advance(r, t); nextFrame += 1000 / 60; }
    }
}

/** Menu open for `menuMs`, a new model built in it (Restart / Drone / Settings Apply), then resume. */
function rebuildWhilePaused(c: Clock, menuMs: number): { r: Runner; resumeAt: number } {
    let r = model();
    c.restart(0, r);
    fly(c, r, 0, 1000, () => -1);
    c.pause(true, 1000);
    r = model();
    c.restart(1000 + menuMs, r);
    const resumeAt = 1000 + menuMs + 30;
    c.pause(false, resumeAt);
    return { r, resumeAt };
}

describe('page -> sim clock (item 22)', () => {
    it('a model rebuilt while paused runs as soon as the flight resumes, whatever the pause lasted', () => {
        for (const menuMs of [500, 8000, 60000]) {
            const c = fixed();
            const { r, resumeAt } = rebuildWhilePaused(c, menuMs);
            expect(c.toSimUs(resumeAt)).toBe(0);
            fly(c, r, resumeAt, resumeAt + 500, () => 0.2);
            expect(r.sim.tick).toBeGreaterThanOrEqual(480); // 0.5 s of physics in 0.5 s of wall time
            expect(r.sim.ch[2]).toBeCloseTo(0.2, 6); // the throttle follows the stick
        }
    });

    it('negative control: the old clock freezes the rebuilt model for as long as the menu was open', () => {
        const c = new HeadClock();
        const { r, resumeAt } = rebuildWhilePaused(c, 8000);
        expect(c.toSimUs(resumeAt)).toBe(-8000 * 1000);
        fly(c, r, resumeAt, resumeAt + 500, () => 0.2);
        expect(r.sim.tick).toBe(0);
        expect(r.sim.ch[2]).not.toBeCloseTo(0.2, 3);
    });

    /** 1 s of flight, then no frame for `stallMs` while the radio keeps sending, then the stick moves. */
    function stall(c: Clock, stallMs: number): Runner {
        const r = model();
        c.restart(0, r);
        fly(c, r, 0, 1000, (t) => -1 + t / 1000); // a ramp that ends at 0
        for (let t = 1002; t < 1000 + stallMs; t += 2) c.push(frame(-0.98), t); // hidden tab / long task
        fly(c, r, 1000 + stallMs, 1000 + stallMs + 100, () => 0.2);
        return r;
    }

    it('after a stall longer than the catch-up limit, the newest stick position applies at once', () => {
        const c = fixed();
        const r = stall(c, 10000);
        expect(r.hitches).toBe(1);
        expect(r.sim.ch[2]).toBeCloseTo(0.2, 6);
        // wall time was skipped, not fast-forwarded: 1 s + 250 ms catch-up + 100 ms
        expect(r.sim.tick).toBeGreaterThan(1300);
        expect(r.sim.tick).toBeLessThan(1400);
    });

    it('negative control: with samples stamped on arrival, the stick is ignored for the length of the stall', () => {
        const c = new HeadClock();
        const r = stall(c, 10000);
        expect(r.hitches).toBe(1);
        expect(r.sim.ch[2]).toBeCloseTo(-0.98, 6);
    });

    it('without pauses or stalls the physics is bit-identical to the determinism run (60 Hz frames)', () => {
        const ref = runDeterminism(P, null, SPAWN, 60);
        const samples = renderScript(determinismScript(), DET_DURATION_S, 250, 400, DET_SEED);
        const sim = new Sim(P, null);
        sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], SPAWN[3]);
        const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: P.presetId, configHash: '', collisionSha256: null, spawn: SPAWN, seed: DET_SEED });
        const r = new Runner(sim, log, true);
        const c = new SimClock();
        c.restart(0);
        const endUs = DET_DURATION_S * 1_000_000;
        let si = 0;
        for (let k = 1; ; k++) {
            const t = Math.min(endUs, Math.round((k * 1e6) / 60));
            // samples arrive when their time has come, stamped in page ms
            while (si < samples.length && samples[si].tUs <= t) { c.push(samples[si].ch, samples[si].tUs / 1000); si++; }
            c.advance(r, t / 1000);
            if (t >= endUs) break;
        }
        expect(sim.tick).toBe(ref.ticks);
        expect(r.hitches).toBe(0);
        expect(r.traceHash()).toBe(ref.hash);
        expect(DT_US).toBe(1000);
    });

    it('a pause keeps what arrived before it and drops nothing', () => {
        const c = new SimClock();
        const r = model();
        c.restart(0);
        fly(fixed(c), r, 0, 500, () => -1);
        c.push(frame(0.4), 501);
        c.pause(true, 502); // the frame that would have taken them never came
        expect(c.pending).toBeGreaterThanOrEqual(1);
        c.pause(false, 20000);
        c.advance(r, 20017);
        expect(r.sim.ch[2]).toBeCloseTo(0.4, 6);
        expect(c.pending).toBe(0);
        expect(c.dropped).toBe(0);
    });
});
