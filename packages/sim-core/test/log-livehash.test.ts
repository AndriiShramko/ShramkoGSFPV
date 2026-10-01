// A log saved mid-flight is checked against the live trace hash of the current life. digestHex()
// finalises a hasher in place, so reading the hash that way (v0.2's saveLog called the runner's
// traceHash() mid-flight) left every later hash of that run wrong. Runner.liveLifeHash reads a copy.

import { describe, expect, it } from 'vitest';
import { LifePlayer, Sha256 } from '../src/index';
import type { Life } from '../src/index';
import { PlaneWorld, Pilot, crashCycles, deps, newRunner, runFrames } from './log-kit';

const WORLD = PlaneWorld.room({ wallX: 4 });

function replayHash(life: Life, endTick: number): string {
    const p = new LifePlayer({ header: life.header, bytes: () => life.bytes().slice(), endTick, hashFrom: life.hashFrom, snapshot: life.snapshot }, deps(WORLD), endTick);
    p.stepTo(endTick);
    return p.digest();
}

describe('the live hash of the current life (a log saved mid-flight)', () => {
    it('read twice mid-flight, each equals a replay of the life to that tick, and the life\'s final hash is unharmed', () => {
        const r = newRunner({ world: WORLD, at: [0, 1, 0, 0] });
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        runFrames(r, 60, 2_500_000);
        const a = r.liveLifeHash()!;
        expect(a.from).toBe(0);
        expect(a.hash).toBe(replayHash(r.current(), r.sim.tick));
        runFrames(r, 60, 6_000_000, { phaseUs: 2_500_000 });
        const b = r.liveLifeHash()!;
        expect(b.hash).toBe(replayHash(r.current(), r.sim.tick));
        expect(b.hash).not.toBe(a.hash);
        // the life ends (a respawn): its traceHash is still the replay's
        const end = r.sim.tick;
        const life = r.current();
        r.respawn(0, 1, 0, 0);
        expect(life.traceHash).toBe(replayHash(life, end));
    });

    it('control: digestHex() mid-way, then more data, gives a wrong final hash; copy() does not', () => {
        const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
        const fresh = new Sha256().update(data).digestHex();
        const finalised = new Sha256().update(data.subarray(0, 333));
        finalised.digestHex();
        finalised.update(data.subarray(333));
        expect(finalised.digestHex()).not.toBe(fresh);
        const copied = new Sha256().update(data.subarray(0, 333));
        copied.copy().digestHex();
        copied.update(data.subarray(333));
        expect(copied.digestHex()).toBe(fresh);
    });
});
