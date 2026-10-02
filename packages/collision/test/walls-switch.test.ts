// Walls on / off (Andrii 2026-09-27, message 9): a flight with the walls switched off has no
// contact world, its log header says so (no collision hash, walls: 'off', another config hash),
// and a replay takes the setting from the header. The flight model is the real one (sim-core),
// in a 10 m voxel room; the header and replay rules are the app's own (apps/fly flightwalls.ts).
import { describe, expect, it } from 'vitest';
import { Sim, Runner, InputLog, S, compileParams, replay, SIM_CORE_VERSION } from '../../sim-core/src/index';
import type { PresetJson, LogHeader } from '../../sim-core/src/index';
import preset from '../../sim-core/presets/pavo20pro-3s.json';
import { flightHeader, worldForLog, wallsState, wallsWanted } from '../../../apps/fly/src/flightwalls';
import type { FlightLogHeader } from '../../../apps/fly/src/flightwalls';
import { syntheticRoom, VoxelContactWorld } from '../src/index';

const P = compileParams(preset as PresetJson, {});
const ROOM = syntheticRoom(0.05, 5); // walls at +-5 m on every axis
const WORLD = new VoxelContactWorld(ROOM);
const SHA = 'a'.repeat(64);
const SPAWN: [number, number, number, number] = [0, -3.5, 0, 0];
const END_TICK = 6000;

/** Arm, climb a little, then pitch forward hard for seconds: straight into the +z or -z wall. */
function samples(): { tUs: number; ch: number[] }[] {
    const out: { tUs: number; ch: number[] }[] = [];
    out.push({ tUs: 0, ch: [0, 0, -1, 0, -1, 1, 0, 0] });
    out.push({ tUs: 20_000, ch: [0, 0, -1, 0, 1, 1, 0, 0] });
    for (let t = 100_000; t < END_TICK * 1000; t += 4000) {
        const climb = t < 700_000;
        out.push({ tUs: t, ch: [0, climb ? 0 : 0.9, climb ? 0.2 : 0.35, 0, 1, 1, 0, 0] });
    }
    return out;
}

function fly(header: FlightLogHeader): { hash: string; log: InputLog; crashes: number; contacts: number; maxAbs: number } {
    const world = worldForLog(header, SHA, WORLD);
    if (world === undefined) throw new Error('no world for this header');
    const sim = new Sim(P, world);
    sim.reset(...SPAWN);
    const log = new InputLog(header);
    const runner = new Runner(sim, log, true);
    for (const s of samples()) runner.enqueue(s);
    let maxAbs = 0;
    runner.onStep = (x) => { maxAbs = Math.max(maxAbs, Math.abs(x.s[S.px]), Math.abs(x.s[S.pz])); };
    // frames of 4 ms, like a 250 Hz page (one call is capped at the runner's catch-up limit)
    for (let t = 4000; t <= END_TICK * 1000; t += 4000) runner.advanceTo(t);
    expect(sim.tick).toBe(END_TICK);
    const ev = runner.events;
    return { hash: runner.traceHash(), log, crashes: ev.filter((e) => e.type === 'crash').length, contacts: ev.filter((e) => e.type === 'contact' || e.type === 'crash').length, maxAbs };
}

function replayed(log: InputLog, header: LogHeader = log.header): string {
    const world = worldForLog(header as FlightLogHeader, SHA, WORLD);
    if (world === undefined) throw new Error('no world for this header');
    const sim = new Sim(P, world);
    sim.reset(...header.spawn);
    return replay(sim, log, END_TICK);
}

const head = (wallsOn: boolean, wallsSha256: string | null = SHA): FlightLogHeader =>
    flightHeader({ simCore: SIM_CORE_VERSION, preset: 'pavo20pro-3s', overrides: {}, wallsSha256, wallsOn, spawn: SPAWN });

describe('walls switch: log header and replay', () => {
    const on = fly(head(true));
    const off = fly(head(false));

    it('the header records the setting: on carries the walls hash, off carries none and another config hash', () => {
        expect(on.log.header).toMatchObject({ walls: 'on', collisionSha256: SHA });
        expect(off.log.header).toMatchObject({ walls: 'off', collisionSha256: null });
        expect(off.log.header.configHash).not.toBe(on.log.header.configHash);
        expect(head(true, null)).toMatchObject({ walls: 'none', collisionSha256: null });
        // a scan without walls: the switch changes nothing in the header (both fly without contact)
        expect(head(false, null)).toEqual(head(true, null));
    });

    it('with walls the craft hits the room; with them off it flies out through the wall', () => {
        expect(on.contacts).toBeGreaterThan(0);
        expect(on.maxAbs).toBeLessThan(5);
        expect(off.contacts).toBe(0);
        expect(off.crashes).toBe(0);
        expect(off.maxAbs).toBeGreaterThan(5.5);
    });

    it('each log replays to its own hash, with the world its header names', () => {
        expect(replayed(on.log)).toBe(on.hash);
        expect(replayed(off.log)).toBe(off.hash);
        // the header survives the JSON a saved log goes through
        const back = JSON.parse(JSON.stringify(off.log.header)) as LogHeader;
        expect(replayed(InputLog.fromBytes(back, new Uint8Array(off.log.bytes())), back)).toBe(off.hash);
    });

    it('control: on and off differ, and a log replayed with the other setting does not reproduce its hash', () => {
        expect(on.hash).not.toBe(off.hash);
        const offWithWalls = new Sim(P, WORLD);
        offWithWalls.reset(...SPAWN);
        expect(replay(offWithWalls, off.log, END_TICK)).not.toBe(off.hash);
        const onWithout = new Sim(P, null);
        onWithout.reset(...SPAWN);
        expect(replay(onWithout, on.log, END_TICK)).not.toBe(on.hash);
    });

    it('worldForLog: foreign walls cannot replay; logs from before the switch (no field) read as on', () => {
        expect(worldForLog(head(true), 'b'.repeat(64), WORLD)).toBeUndefined();
        const old: LogHeader = { format: 'gsfpv-input-log/1', simCore: SIM_CORE_VERSION, preset: 'pavo20pro-3s', configHash: '', collisionSha256: SHA, spawn: SPAWN, seed: 0 };
        expect(worldForLog(old, SHA, WORLD)).toBe(WORLD);
        expect(worldForLog({ ...old, collisionSha256: null }, SHA, WORLD)).toBeNull();
        // a header that says off never gets walls, whatever hash it carries
        expect(worldForLog({ ...old, walls: 'off' } as FlightLogHeader, SHA, WORLD)).toBeNull();
    });
});

describe('walls switch: which setting a flight starts with', () => {
    it('the store scene.walls for this scan (one choice for every scan, its default per scan: prefs store.test.ts)', () => {
        const asked: unknown[] = [];
        const store = (v: string) => ({ get: <T,>(id: string, ctx?: { scene?: string }) => { asked.push([id, ctx]); return v as T; } });
        expect(wallsWanted(store('on'), '39e63ce9')).toBe(true);
        expect(wallsWanted(store('off'), '39e63ce9')).toBe(false);
        // asked for this scan, so a pilot who never chose gets the author's default for it
        expect(asked[0]).toEqual(['scene.walls', { scene: '39e63ce9' }]);
        expect(wallsState(true, false)).toBe('off');
        expect(wallsState(false, false)).toBe('none');
    });
});
