// Log format /2 (docs/architecture-v03.md C.9, C.12 item 9): codes, record layouts, time past
// the 35.79 min where format /1 wrapped (D-e), and the header guards.

import { describe, expect, it } from 'vitest';
import {
    InputLog, LifePlayer, MAX_LOG_TICK, REC_INPUT, REC_RESPAWN, REC_WORLD, RESPAWN_REASONS, Runner, S, SIM_CORE_VERSION,
    canonicalJson, compileParams, forEachRecord, lifeConfigHash, lifeHeaderProblem, lifeParams, lifeSim, presetSha256,
    readRespawn, recordCode, recordKind, recordSlot, replayLife
} from '../src/index';
import type { LifeHeader, PresetJson, Sim } from '../src/index';
import { PRESET, PlaneWorld, Pilot, deps, header, newRunner, runFrames } from './log-kit';

describe('record codes (format /2)', () => {
    it('slots round-trip for every kind up to the last tick, and tick 3 000 000 (50 min) is exact', () => {
        const buf = new DataView(new ArrayBuffer(4));
        const bad: string[] = [];
        for (const slot of [0, 1, 2_147_482, 2_147_484, 3_000_000, MAX_LOG_TICK - 1]) {
            for (const kind of [REC_INPUT, REC_RESPAWN, REC_WORLD]) {
                buf.setInt32(0, recordCode(kind, slot), true);
                const code = buf.getInt32(0, true);
                if (recordKind(code) !== kind || recordSlot(code) !== slot) bad.push(`${kind}@${slot}`);
            }
        }
        expect(bad).toEqual([]);
        // time order inside one slot: respawn, world, then the input for the next tick
        expect(recordCode(REC_RESPAWN, 7)).toBeLessThan(recordCode(REC_WORLD, 7));
        expect(recordCode(REC_WORLD, 7)).toBeLessThan(recordCode(REC_INPUT, 7));
        expect(recordCode(REC_INPUT, 6)).toBeLessThan(recordCode(REC_RESPAWN, 7));
    });

    it('control: format /1 stores tick 3 000 000 as a wrapped time (as measured in .cache/v02/arch-int32.ts)', () => {
        const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'x', preset: 'p', configHash: '', collisionSha256: null, spawn: [0, 0, 0, 0], seed: 0 }, 4);
        const ch = new Float32Array(8);
        log.push(3_000_000 * 1000, ch);
        expect(log.record(0, ch)).not.toBe(3_000_000 * 1000);
        expect(log.record(0, ch)).toBeLessThan(0);
    });

    it('a tick beyond 6.2 days is refused, never wrapped', () => {
        expect(() => recordCode(REC_RESPAWN, MAX_LOG_TICK)).not.toThrow();
        expect(() => recordCode(REC_INPUT, MAX_LOG_TICK)).toThrow(RangeError);
        expect(() => recordCode(REC_RESPAWN, MAX_LOG_TICK + 1)).toThrow(RangeError);
    });

    it('a life starting at tick 3 000 000 logs inputs, a world change and a respawn at their true ticks and replays exactly', () => {
        const world = PlaneWorld.room();
        const sim = lifeSim(compileParams(PRESET), world);
        sim.tick = 3_000_000;
        const r = new Runner(sim, header({ at: [0, 0.5, 0, 0] }), { traceHash: true });
        const ch = [0.1, 0, -1, 0, -1, -1, 0, 0];
        r.enqueue({ tUs: 3_000_010 * 1000, ch });
        r.advanceTo(3_000_020 * 1000);
        r.world({ s: 1, t: [0, 0, 0], floaterMinBlocks: 0 });
        r.advanceTo(3_000_030 * 1000);
        const life0 = r.current();
        r.respawn(1, 0.5, 0, 90, { platform: true }, 'manual-start');
        const seen: [number, number][] = [];
        forEachRecord(life0.bytes(), (kind, slot) => seen.push([kind, slot]));
        expect(seen).toEqual([[REC_INPUT, 3_000_009], [REC_WORLD, 3_000_020], [REC_RESPAWN, 3_000_030]]);
        expect(r.current().header.life.startTick).toBe(3_000_030);
        expect(replayLife(r.lives()[0], deps(world)).hash).toBe(r.lives()[0].traceHash);
    });
});

describe('record layouts', () => {
    it('respawn records carry flags, radius, pack and every reason; the runner applies the Float32 values it logs', () => {
        const world = PlaneWorld.room();
        const r = newRunner({ world, at: [0, 0.5, 0, 0] });
        const want = [0.1234567, 0.7654321, -2.3456789, 33.333333];
        for (const reason of RESPAWN_REASONS) {
            r.advanceTo((r.sim.tick + 5) * 1000);
            r.respawn(want[0], want[1], want[2], want[3], { platform: true, platformR: 0.3, keepArmed: reason === 'crash', soc: reason === 'scene' ? 0.5 : undefined }, reason);
        }
        const lives = r.lives();
        const got: string[] = [];
        for (let i = 0; i < RESPAWN_REASONS.length; i++) {
            const bytes = lives[i].bytes();
            const ch = new Float32Array(bytes.buffer, bytes.byteOffset + bytes.byteLength - 32, 8);
            const rec = readRespawn(Array.from(ch));
            const next = lives[i + 1].header.life;
            got.push(`${rec.reason}|${rec.opts.platform}|${rec.opts.keepArmed}|${rec.opts.platformR}|${rec.opts.soc}`);
            expect(next.reason).toBe(rec.reason);
            expect(next.at).toEqual(want.map((v) => Math.fround(v)));
            expect(next.opts).toEqual(rec.opts);
        }
        expect(got[0]).toBe(`crash|true|true|${Math.fround(0.3)}|undefined`);
        expect(got[RESPAWN_REASONS.indexOf('scene')]).toBe(`scene|true|false|${Math.fround(0.3)}|0.5`);
        expect(got.map((g) => g.split('|')[0])).toEqual([...RESPAWN_REASONS]);
        // the pack: kept (header soc = the sim's), or the fresh value it logged
        expect(lives[RESPAWN_REASONS.indexOf('scene') + 1].header.life.soc).toBe(0.5);
        expect(r.sim.s[S.px]).toBe(Math.fround(want[0]));
    });

    it('world records reach onWorld as Float32 and a replay swaps the world at the same tick; control: a replay that ignores them diverges', () => {
        // the floor rises through the hovering craft: only the world record says when
        const floorAt = (s: number) => new PlaneWorld([[0, 1, 0, 0.8 * s]]);
        const r = newRunner({ world: floorAt(0), at: [0, 0.04, 0, 0] });
        const pilot = new Pilot(r);
        pilot.plan = (p, sim) => {
            if (p.phase === '') { p.bot.setTask({ kind: 'hover', target: [0, 0.8, 0], yawDeg: 0 }, sim); p.phase = 'fly'; }
        };
        let got: number[] = [];
        r.onWorld = (ev) => {
            got = [ev.s, ...ev.t, ev.floaterMinBlocks];
            r.sim.world = floorAt(ev.s);
        };
        r.advanceTo(1_500_000);
        r.world({ s: 1.1, t: [0.1, 0.2, 0.3], floaterMinBlocks: 3 });
        r.advanceTo(3_000_000);
        expect(got).toEqual([Math.fround(1.1), Math.fround(0.1), Math.fround(0.2), Math.fround(0.3), 3]);
        const d = { preset: deps(null).preset, world: (_: LifeHeader['scene'], ev: { s: number } | null) => floorAt(ev ? ev.s : 0) };
        const rep = replayLife(r.current(), d);
        expect(Array.from(rep.sim.s)).toEqual(Array.from(r.sim.s));
        const blind = replayLife(r.current(), { preset: d.preset, world: () => floorAt(0) });
        expect(Array.from(blind.sim.s)).not.toEqual(Array.from(r.sim.s));
    });
});

describe('a 40-minute session (D-e)', () => {
    const END = 40 * 60_000;
    const ARM_AT = 39 * 60_000;
    /** parked at 20 Hz input until minute 39, then armed and flying a box at 250 Hz */
    function session(p: Pilot): void {
        p.period = 50;
        p.plan = (pp, sim) => {
            if (pp.phase === '' && sim.tick >= ARM_AT) {
                pp.period = 4;
                pp.bot.setTask({ kind: 'path', points: [[0, 1.5, 0], [2, 1.5, 0], [2, 1.5, 2], [0, 1.5, 2], [0, 1.5, 0]], speed: 2, yawDeg: 0 }, sim);
                pp.phase = 'fly';
            }
        };
    }
    /** v0.2's replay() without its trace hash (the hash of 2.4 M states costs more than the physics) */
    function replayV1(sim: Sim, log: InputLog, endTick: number): void {
        const ch = new Float32Array(8);
        let i = 0;
        let nextT = log.count > 0 ? log.record(0, ch) : Infinity;
        while (sim.tick < endTick) {
            const tickT = (sim.tick + 1) * 1000;
            while (i < log.count && nextT <= tickT) {
                const t = log.record(i, ch);
                if ((t & 1) === 1) sim.respawn(ch[0], ch[1], ch[2], ch[3]);
                else sim.setChannels(ch);
                i++;
                nextT = i < log.count ? log.record(i, ch) : Infinity;
            }
            sim.step();
        }
    }

    it('format /2: records keep rising past 35.79 min and the flight in minute 40 replays bit for bit; control: format /1 wraps and diverges', () => {
        const world = PlaneWorld.room();
        const at: [number, number, number, number] = [0, 0.04, 0, 0];
        const r2 = newRunner({ world, at, runner: { traceHash: false } });
        session(new Pilot(r2));
        let maxY = 0;
        r2.onStep = ((prev) => (sim: Sim) => { prev?.(sim); if (sim.s[S.py] > maxY) maxY = sim.s[S.py]; })(r2.onStep);
        runFrames(r2, 60, END * 1000);
        expect(r2.sim.tick).toBe(END);
        expect(r2.lives().length).toBe(1);
        let prev = -1;
        let rising = true;
        let late = 0;
        const n = forEachRecord(r2.current().bytes(), (kind, slot) => {
            if (slot < prev) rising = false;
            prev = slot;
            if (slot > 35.79 * 60_000) late++;
        });
        expect(rising).toBe(true);
        expect(late).toBeGreaterThan(14_000); // minute 39-40 at 250 Hz, plus the parked 20 Hz tail
        expect(n).toBeGreaterThan(60_000);
        expect(maxY).toBeGreaterThan(1.2); // it really flew in the last minute
        const p = new LifePlayer(r2.current(), deps(world), undefined, { hash: false });
        p.stepTo(END);
        expect(Array.from(p.sim.s)).toEqual(Array.from(r2.sim.s));

        // control: the same session through format /1
        const sim1 = lifeSim(compileParams(PRESET), world);
        sim1.reset(at[0], at[1], at[2], at[3]);
        const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: SIM_CORE_VERSION, preset: PRESET.id, configHash: '', collisionSha256: null, spawn: at, seed: 0 });
        const r1 = new Runner(sim1, log, false);
        session(new Pilot(r1));
        runFrames(r1, 60, END * 1000);
        const ch = new Float32Array(8);
        let wrapped = 0;
        for (let i = 0; i < log.count; i++) if (log.record(i, ch) < 0) wrapped++;
        expect(wrapped).toBeGreaterThan(14_000);
        const again = lifeSim(compileParams(PRESET), world);
        again.reset(at[0], at[1], at[2], at[3]);
        replayV1(again, log, END);
        const dx = again.s[S.px] - sim1.s[S.px], dy = again.s[S.py] - sim1.s[S.py], dz = again.s[S.pz] - sim1.s[S.pz];
        expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeGreaterThan(0.01);
    });
});

describe('header v2 guards', () => {
    it('the configHash covers preset, overrides and sim-core; a runner refuses a header whose hash does not match', () => {
        const h = header({ at: [0, 1, 0, 0], overrides: { tauMs: 20 } });
        expect(lifeHeaderProblem(h)).toBeNull();
        expect(h.configHash).toBe(lifeConfigHash(presetSha256(PRESET), { tauMs: 20 }, SIM_CORE_VERSION));
        // control: an override changed after the hash was made
        const stale: LifeHeader = { ...h, overrides: { tauMs: 21 } };
        expect(lifeHeaderProblem(stale)).toMatch(/configHash/);
        expect(() => new Runner(lifeSim(compileParams(PRESET), null), stale)).toThrow(/configHash/);
    });

    it('v0.2 logs (format /1) are refused with a clear message', () => {
        const v1 = { ...header({ at: [0, 1, 0, 0] }), format: 'gsfpv-input-log/1' } as unknown as LifeHeader;
        expect(() => lifeParams(v1, deps(null))).toThrow(/format \/1/);
        expect(() => lifeParams(header({ at: [0, 1, 0, 0] }), deps(null))).not.toThrow();
    });

    it('canonical JSON ignores key order and refuses Infinity (which JSON would turn into null, C.7)', () => {
        expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }));
        expect(() => canonicalJson({ vCrash: Infinity })).toThrow(RangeError);
        // why: plain JSON writes Infinity as null without a word
        expect(JSON.stringify({ vCrash: Infinity })).toBe('{"vCrash":null}');
    });

    it('a later preset edit is detected; the preset embedded in a saved header still replays (D-g)', () => {
        const world = PlaneWorld.room();
        const r = newRunner({ world, at: [0, 0.04, 0, 0] });
        r.advanceTo(200_000);
        const edited = JSON.parse(JSON.stringify(PRESET)) as PresetJson;
        (edited.fields.twr as { value: number }).value = 4.5;
        const later = { preset: () => edited, world: () => world };
        expect(() => replayLife(r.current(), later)).toThrow(/differs/);
        const saved = { ...r.current(), header: { ...r.current().header, presetJson: JSON.parse(JSON.stringify(PRESET)) as PresetJson }, bytes: () => r.current().bytes(), endTick: r.current().endTick };
        expect(() => replayLife(saved, later)).not.toThrow();
    });
});

describe('the synthetic world used by these tests', () => {
    it('touches the floor and a wall where it should and nowhere else', () => {
        const w = PlaneWorld.room({ wallX: 4 });
        const out = { x: 0, y: 0, z: 0 };
        expect(w.pushOut(0, 0.02, 0, 0.03, out)).toBe(true);
        expect(out.y).toBeCloseTo(0.01, 12);
        expect(w.pushOut(0, 1, 0, 0.03, out)).toBe(false);
        expect(w.pushOut(3.99, 1, 0, 0.03, out)).toBe(true);
        expect(out.x).toBeCloseTo(-0.02, 12);
        const c0 = Float64Array.from([3, 1, 0]), c1 = Float64Array.from([5, 1, 0]);
        const co = { sphere: -1, nx: 0, ny: 0, nz: 0 };
        expect(w.sweep(c0, c1, Float64Array.from([0.1]), Float64Array.from([0]), 1, co)).toBeCloseTo(0.45, 12);
        expect(co.nx).toBe(-1);
        expect(w.sweep(Float64Array.from([0, 1, 0]), Float64Array.from([1, 1, 0]), Float64Array.from([0.1]), Float64Array.from([0]), 1, co)).toBe(-1);
    });
});
