// Scene rotation (docs/architecture-v03.md E.3, E.10): the shuffle bag does not repeat until it is
// exhausted, never returns the current scene, and skips failed scenes (and, for the pilot's own
// sources, wall-less ones; the owner's catalogue is never filtered by walls, v0.9 item 9). Control: with
// skipping disabled, they are returned.
import { describe, expect, it } from 'vitest';
import { SceneRotation, library as L, emptyLibrary } from '../src/index';
import type { RotationScene, SceneLibraryData } from '../src/index';

/** A seeded generator (mulberry32), so every run draws the same. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const NOW = 1_000_000_000;
const curated: RotationScene[] = [
    { id: 'a', collision: true }, { id: 'b', collision: true }, { id: 'c', collision: true },
    { id: 'd', collision: true }, { id: 'e', collision: true }, { id: 'nowalls', collision: false }
];
function lib(): SceneLibraryData {
    let d = emptyLibrary();
    // 'failed' failed an hour ago; 'old-fail' a week ago (it is back in)
    d = L.recordFailure(d, 'failed', 'network', NOW - 3600e3);
    d = L.recordFailure(d, 'old-fail', 'network', NOW - 7 * 24 * 3600e3);
    return d;
}
const rot = (seed = 1, list: RotationScene[] = [...curated, { id: 'failed', collision: true }, { id: 'old-fail', collision: true }], data = lib()) =>
    new SceneRotation({ curated: () => list, library: () => data, now: () => NOW }, rng(seed));
const RULES = { allowNoWalls: false };

describe('scene rotation: shuffle bag', () => {
    it('no repeats until every scene came once, never the current one, over many seeds', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const r = rot(seed);
            const pool = r.candidates('curated', RULES);
            expect(pool.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'nowalls', 'old-fail']);
            let current: string | null = 'a';
            const seen: string[] = [];
            for (let i = 0; i < 40; i++) {
                const id = r.next('curated', current, 'random', RULES)!;
                expect(id).not.toBe(current);
                expect(pool).toContain(id);
                seen.push(id);
                current = id;
            }
            // each bag is every scene but the current one: 6 draws, 6 different scenes, then a refill
            for (let k = 0; k + 6 <= seen.length; k += 6) expect(new Set(seen.slice(k, k + 6)).size).toBe(6);
        }
    });

    it('skips scenes that failed in the last 24 h; the owner\'s list is not filtered by walls', () => {
        const r = rot(3);
        const drawn = new Set<string>();
        let cur: string | null = null;
        for (let i = 0; i < 200; i++) { cur = r.next('curated', cur, 'random', RULES); drawn.add(cur!); }
        expect(drawn.has('nowalls')).toBe(true);
        expect(drawn.has('failed')).toBe(false);
        expect(drawn.has('old-fail')).toBe(true);
        // allowNoWalls changes nothing for the owner's list
        expect(rot(3).candidates('curated', { allowNoWalls: true })).toEqual(rot(3).candidates('curated', RULES));
    });

    it('control: with skipping disabled the failed scene is returned', () => {
        const r = rot(3);
        const drawn = new Set<string>();
        let cur: string | null = null;
        for (let i = 0; i < 200; i++) { cur = r.next('curated', cur, 'random', { allowNoWalls: false, skip: false }); drawn.add(cur!); }
        expect(drawn.has('failed')).toBe(true);
    });

    it('a single scene that is the current one: nothing to go to', () => {
        expect(rot(1, [{ id: 'a', collision: true }]).next('curated', 'a', 'random', RULES)).toBeNull();
        expect(rot(1, [{ id: 'a', collision: true }]).next('curated', 'a', 'sequential', RULES)).toBeNull();
        expect(rot(1, [{ id: 'a', collision: true }]).next('curated', 'zz', 'random', RULES)).toBe('a');
    });
});

describe('scene rotation: sequential, favourites, random', () => {
    it('sequential walks the source in order after the current scene and wraps', () => {
        const r = rot();
        const walk: string[] = [];
        let cur: string | null = 'd';
        for (let i = 0; i < 7; i++) { cur = r.next('curated', cur, 'sequential', RULES); walk.push(cur!); }
        expect(walk).toEqual(['e', 'nowalls', 'old-fail', 'a', 'b', 'c', 'd']);
    });

    it('F: the next favourite in the favourites order; skipped ones are passed over', () => {
        let d = lib();
        for (const id of ['a', 'failed', 'c', 'b']) d = L.toggleFavourite(d, id).data; // order: b, c, failed, a
        const r = rot(1, curated, d);
        expect(r.nextFavourite('b', RULES)).toBe('c');
        expect(r.nextFavourite('c', RULES)).toBe('a');
        expect(r.nextFavourite('a', RULES)).toBe('b');
        expect(r.nextFavourite('zz', RULES)).toBe('b');
        expect(r.nextFavourite('c', { allowNoWalls: false, skip: false })).toBe('failed');
        expect(rot(1, curated, lib()).nextFavourite('a', RULES)).toBeNull();
    });

    it('history source and Shift+N random: from the history / curated list, never the current scene', () => {
        let d = lib();
        d = L.recordOpen(d, { id: 'h1', version: 1, hasCollision: true }, NOW - 10);
        d = L.recordOpen(d, { id: 'h2', version: 1, hasCollision: false }, NOW - 5);
        const r = rot(5, curated, d);
        // only scenes opened here: 'old-fail' failed before it was ever opened, so it is not history
        expect(r.candidates('history', RULES)).toEqual(['h1']);
        for (let i = 0; i < 50; i++) expect(r.random('a', RULES)).not.toBe('a');
    });
});

// The owner's report (message 22, item 9): "N cycles only 3-4 scenes although many are uploaded".
// The flags below are the live catalogue of 2026-10-17 (GET /api/catalog): 13 published scenes, 9 of
// them without a walls file (collision false), in the owner's order.
const LIVE: RotationScene[] = [
    ['887f27aa', true], ['39e63ce9', true], ['7a475d38', true], ['70b50d42', false], ['ab5efa0e', false], ['d10c5638', false],
    ['2f1ddf5f', false], ['ba7aa29d', false], ['9baef54b', false], ['0230d903', false], ['eb5f51dc', false], ['1994c65c', false], ['b11e45d1', true]
].map(([id, collision]) => ({ id: id as string, collision: collision as boolean }));

describe('scene rotation: the owner\'s catalogue is not filtered by walls (v0.9 item 9)', () => {
    /** The v0.8 rule, transcribed: the walls rule applied to every source, the default setting being off. */
    const v08Candidates = (list: readonly RotationScene[]): string[] => list.filter((s) => s.collision !== false).map((s) => s.id);

    it('the live catalogue: N can reach all 13 scenes, not the 4 that have walls', () => {
        const r = new SceneRotation({ curated: () => LIVE, library: () => emptyLibrary(), now: () => NOW }, rng(7));
        expect(r.candidates('curated', RULES)).toEqual(LIVE.map((s) => s.id));
        // walking N in the default (random) order for a while reaches every scene
        const reached = new Set<string>();
        let cur: string | null = null;
        for (let i = 0; i < 60; i++) { cur = r.next('curated', cur, 'random', RULES); reached.add(cur!); }
        expect(reached.size).toBe(13);
        // control: the v0.8 rule on the same list leaves the 4 scenes the owner saw
        expect(v08Candidates(LIVE)).toEqual(['887f27aa', '39e63ce9', '7a475d38', 'b11e45d1']);
    });

    it('the pilot\'s own sources keep the walls rule (history, favourites); allowNoWalls lets them in', () => {
        let d = emptyLibrary();
        d = L.recordOpen(d, { id: 'h1', version: 1, hasCollision: true }, NOW - 10);
        d = L.recordOpen(d, { id: 'h2', version: 1, hasCollision: false }, NOW - 5);
        d = L.toggleFavourite(d, 'h2', { hasCollision: false }).data;
        d = L.toggleFavourite(d, 'h1', { hasCollision: true }).data;
        const r = new SceneRotation({ curated: () => LIVE, library: () => d, now: () => NOW }, rng(1));
        expect(r.candidates('history', RULES)).toEqual(['h1']);
        expect(r.candidates('favourites', RULES)).toEqual(['h1']);
        expect(r.candidates('history', { allowNoWalls: true }).sort()).toEqual(['h1', 'h2']);
        expect(r.candidates('favourites', { allowNoWalls: true }).sort()).toEqual(['h1', 'h2']);
    });
});
