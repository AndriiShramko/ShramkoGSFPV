// Scene rotation (docs/architecture-v03.md E.3, E.10): the shuffle bag does not repeat until it is
// exhausted, never returns the current scene, and skips failed and wall-less scenes. Control: with
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
            expect(pool.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'old-fail']);
            let current: string | null = 'a';
            const seen: string[] = [];
            for (let i = 0; i < 40; i++) {
                const id = r.next('curated', current, 'random', RULES)!;
                expect(id).not.toBe(current);
                expect(pool).toContain(id);
                seen.push(id);
                current = id;
            }
            // each bag is every scene but the current one: 5 draws, 5 different scenes, then a refill
            for (let k = 0; k + 5 <= seen.length; k += 5) expect(new Set(seen.slice(k, k + 5)).size).toBe(5);
        }
    });

    it('skips scenes without walls and scenes that failed in the last 24 h; allowNoWalls lets the wall-less in', () => {
        const r = rot(3);
        const drawn = new Set<string>();
        let cur: string | null = null;
        for (let i = 0; i < 200; i++) { cur = r.next('curated', cur, 'random', RULES); drawn.add(cur!); }
        expect(drawn.has('nowalls')).toBe(false);
        expect(drawn.has('failed')).toBe(false);
        expect(drawn.has('old-fail')).toBe(true);
        expect(rot(3).candidates('curated', { allowNoWalls: true })).toContain('nowalls');
    });

    it('control: with skipping disabled the failed and wall-less scenes are returned', () => {
        const r = rot(3);
        const drawn = new Set<string>();
        let cur: string | null = null;
        for (let i = 0; i < 200; i++) { cur = r.next('curated', cur, 'random', { allowNoWalls: false, skip: false }); drawn.add(cur!); }
        expect(drawn.has('nowalls')).toBe(true);
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
        expect(walk).toEqual(['e', 'old-fail', 'a', 'b', 'c', 'd', 'e']);
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
        expect(r.candidates('history', RULES)).toEqual(['h1', 'old-fail']);
        for (let i = 0; i < 50; i++) expect(r.random('a', RULES)).not.toBe('a');
    });
});
