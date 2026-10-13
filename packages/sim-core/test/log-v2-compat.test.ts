// Old logs replay (lane E, log format /3): fixtures/v2-log.json was written by the format /2 writer
// (commit cbc41e8, fixtures/v2-log-maker.ts) before wind and the collision ceiling existed. Every
// life still replays to the hash it was saved with, and the run still ends in the saved state; a
// tampered record (the control) does not.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_FORMAT_V2, lifeHeaderProblem, replayLife, replayLives } from '../src/index';
import type { Life, LifeHeader, ReplayDeps } from '../src/index';
import { deps } from './log-kit';
import { v2Room } from './fixtures/v2-log-maker';

interface SavedLife { header: LifeHeader; b64: string; endTick: number; traceHash: string; hashFrom: number }
const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v2-log.json'), 'utf8')) as { format: string; lives: SavedLife[]; final: number[] };

function lifeOf(l: SavedLife, bytes = new Uint8Array(Buffer.from(l.b64, 'base64'))): Life {
    return { header: l.header, bytes: () => bytes, endTick: l.endTick, traceHash: l.traceHash, hashFrom: l.hashFrom };
}

/** The room moves with the scene scale: the header's transform, or the world record's. */
const roomDeps: ReplayDeps = {
    preset: deps(null).preset,
    world: (scene, ev) => v2Room(ev ? ev.s : scene ? scene.transform[0] : 1)
};

describe('logs written by format /2 replay unchanged', () => {
    it('the fixture is a real /2 log: three lives, a world record, a crash rewind and a settings life', () => {
        expect(FIX.format).toBe(LOG_FORMAT_V2);
        expect(FIX.lives.map((l) => l.header.life.reason)).toEqual(['start', 'crash', 'settings']);
        for (const l of FIX.lives) expect(lifeHeaderProblem(l.header)).toBeNull();
    });

    it('every life replays alone to its saved hash, and the lives in one pass end in the saved state', () => {
        const lives = FIX.lives.map((l) => lifeOf(l));
        for (let i = 0; i < lives.length; i++) {
            const p = replayLife(lives[i], roomDeps);
            expect(p.hash, `life ${i}`).toBe(FIX.lives[i].traceHash);
        }
        expect(Array.from(replayLives(lives, roomDeps).sim.s)).toEqual(FIX.final);
    });

    it('control: one input bit flipped in the first life changes its replay hash', () => {
        const l = FIX.lives[0];
        const bytes = new Uint8Array(Buffer.from(l.b64, 'base64'));
        // record 40: its first channel's lowest mantissa byte
        bytes[40 * 36 + 4] ^= 1;
        expect(replayLife(lifeOf(l, bytes), roomDeps).hash).not.toBe(l.traceHash);
    });
});
