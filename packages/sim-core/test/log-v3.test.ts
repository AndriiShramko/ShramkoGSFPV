// Log format /3 (v0.7 lane E): the header carries the wind (overrides.wind) and the collision ceiling
// (scene.ceilingM, world records ch[5] / ch[6]); a flight in gusty wind with a rescale replays to the
// live hash at every frame split; edits and impossible /2 headers are refused. Old /2 logs:
// log-v2-compat.test.ts.

import { describe, expect, it } from 'vitest';
import {
    LOG_FORMAT_V2, LOG_FORMAT_V3, REC_WORLD, Runner, WORLD_FLAG_CEILING, compileParams, forEachRecord, lifeConfigHash, lifeHeaderProblem,
    lifeSim, readWorld, replayLife, replayLives, writeWorld
} from '../src/index';
import type { Life, LifeHeader, ReplayDeps, WindConfig, WorldEvent } from '../src/index';
import { PRESET, PlaneWorld, Pilot, SPLITS, deps, header, runFrames } from './log-kit';

const WIND: WindConfig = { fromDeg: 200, speed: 4, gust: 2.5, compassDeg: 30, seed: 4242, groundM: -3 };
const SCENE = { id: 'synthetic-v3', version: 1, transform: [1, 0, 0, 0] as [number, number, number, number], floaterMinBlocks: 0 };
const FLOOR = PlaneWorld.room();
const roomDeps: ReplayDeps = deps(FLOOR);

/** A gusty flight: the bot holds a box path, the scene is rescaled at 2 s (s 1.5, ty 0.4, a ceiling at 3 m), 6 s in all. */
function fly(frameHz: number, o: { world?: boolean; wind?: WindConfig } = {}): Runner {
    const overrides = { wind: o.wind ?? WIND };
    const sim = lifeSim(compileParams(PRESET, overrides), FLOOR);
    const r = new Runner(sim, header({ at: [0, 0.05, 0, 0], overrides, scene: SCENE, opts: { platform: true } }), { traceHash: true, runHash: true });
    const p = new Pilot(r);
    p.plan = (pp, s) => {
        if (pp.phase === '') { pp.bot.setTask({ kind: 'path', points: [[0, 2, 0], [3, 2, 0], [3, 2, 3], [0, 2, 3]], speed: 2, yawDeg: 0 }, s); pp.phase = 'fly'; }
    };
    runFrames(r, frameHz, 2_000_000);
    if (o.world !== false) r.world({ s: 1.5, t: [0, 0.4, 0], floaterMinBlocks: 0, ceilingM: 3 });
    runFrames(r, frameHz, 6_000_000, { phaseUs: 2_000_000 });
    return r;
}

describe('format /3 headers and records', () => {
    it('new headers are written as /3; /2 and /3 are both read', () => {
        expect(header({ at: [0, 0, 0, 0] }).format).toBe(LOG_FORMAT_V3);
        const h2 = { ...header({ at: [0, 0, 0, 0] }), format: LOG_FORMAT_V2 } as LifeHeader;
        expect(lifeHeaderProblem(h2)).toBeNull();
    });

    it('a world record keeps the ceiling (Float32) behind its flag; none and a /2 record read as no ceiling', () => {
        const ch = new Float32Array(8);
        writeWorld(ch, { s: 2, t: [1, 2, 3], floaterMinBlocks: 4, ceilingM: 12.3 });
        expect(ch[6]).toBe(WORLD_FLAG_CEILING);
        expect(readWorld(ch)).toEqual({ s: 2, t: [1, 2, 3], floaterMinBlocks: 4, ceilingM: Math.fround(12.3) });
        writeWorld(ch, { s: 2, t: [1, 2, 3], floaterMinBlocks: 4, ceilingM: null });
        expect(readWorld(ch).ceilingM).toBeNull();
        // a ceiling at 0 m is a ceiling: the flag, not the value, says whether there is one
        writeWorld(ch, { s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: 0 });
        expect(readWorld(ch).ceilingM).toBe(0);
        const v2 = Float32Array.from([1.5, 0, 0, 0, 3, 0, 0, 0]);
        expect(readWorld(v2).ceilingM).toBeNull();
        expect(() => writeWorld(ch, { s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: Number.NaN })).toThrow(RangeError);
    });

    it('control: a /2 header that carries wind or a ceiling is refused (no /2 writer made one)', () => {
        const withWind = { ...header({ at: [0, 0, 0, 0], overrides: { wind: WIND } }), format: LOG_FORMAT_V2 } as LifeHeader;
        expect(lifeHeaderProblem(withWind)).toMatch(/cannot carry wind/);
        const withCeiling = { ...header({ at: [0, 0, 0, 0], scene: { ...SCENE, ceilingM: 5 } }), format: LOG_FORMAT_V2 } as LifeHeader;
        expect(lifeHeaderProblem(withCeiling)).toMatch(/cannot carry wind or a collision ceiling/);
        expect(lifeHeaderProblem({ ...withCeiling, format: LOG_FORMAT_V3 })).toBeNull();
    });
});

describe('a flight in gusty wind with a rescale replays exactly', () => {
    it('every frame split gives the same run hash, and the life replays alone to its live hash and state', () => {
        const runs = SPLITS.map((hz) => fly(hz));
        const hashes = runs.map((r) => r.traceHash());
        expect(new Set(hashes).size).toBe(1);
        const r = runs[1];
        const life = r.current();
        expect(life.header.format).toBe(LOG_FORMAT_V3);
        expect(life.header.overrides.wind).toEqual(WIND);
        const rep = replayLife(life, roomDeps);
        expect(rep.hash).toBe(r.liveLifeHash()!.hash);
        expect(Array.from(rep.sim.s)).toEqual(Array.from(r.sim.s));
        expect(Array.from(replayLives(r.lives(), roomDeps).sim.s)).toEqual(Array.from(r.sim.s));
        // the world record carries the ceiling, and the replay ends on the record's scene frame
        const worlds: WorldEvent[] = [];
        forEachRecord(life.bytes(), (kind, _slot, ch) => { if (kind === REC_WORLD) worlds.push(readWorld(ch)); });
        expect(worlds).toEqual([{ s: 1.5, t: [0, Math.fround(0.4), 0], floaterMinBlocks: 0, ceilingM: 3 }]);
        expect(rep.sim.windGroundY).toBe(r.sim.windGroundY);
        expect(r.sim.windGroundY).toBeCloseTo(1.5 * WIND.groundM + 0.4, 6);
    }, 60000);

    it('control: the rescale moves the wind\'s ground, so the same flight without the world record flies differently', () => {
        expect(fly(60, { world: false }).traceHash()).not.toBe(fly(60).traceHash());
    }, 60000);

    it('control: the header\'s wind edited (configHash made to match) replays elsewhere; edited alone it is refused', () => {
        const r = fly(60);
        const life = r.current();
        const h = life.header;
        const turned = { ...h.overrides, wind: { ...WIND, fromDeg: WIND.fromDeg + 90 } };
        const edited: Life = { ...life, header: { ...h, overrides: turned, configHash: lifeConfigHash(h.presetSha256, turned, h.simCore) }, bytes: () => life.bytes() };
        expect(lifeHeaderProblem(edited.header)).toBeNull();
        expect(replayLife(edited, roomDeps).hash).not.toBe(r.liveLifeHash()!.hash);
        expect(lifeHeaderProblem({ ...h, overrides: turned })).toMatch(/configHash/);
    }, 60000);

    it('the next life (a respawn after the rescale) carries the ceiling in its header scene', () => {
        const r = fly(60);
        r.respawn(0, 0.05, 0, 0, { platform: true }, 'manual-start');
        expect(r.current().header.scene).toMatchObject({ transform: [1.5, 0, Math.fround(0.4), 0], ceilingM: 3 });
        expect(r.current().header.format).toBe(LOG_FORMAT_V3);
    }, 60000);
});
