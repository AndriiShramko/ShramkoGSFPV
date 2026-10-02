// The scene library (docs/architecture-v03.md E.1, E.10): the history cap of 100, the favourites'
// order and the merge. Each block ends with a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { library as L, emptyLibrary, mergeLibraries, lastScene, HISTORY_CAP, failedRecently } from '../src/index';
import type { SceneLibraryData } from '../src/index';

const open = (d: SceneLibraryData, id: string, now: number, extra: { title?: string; hasCollision?: boolean | null } = {}): SceneLibraryData =>
    L.recordOpen(d, { id, version: 1, title: extra.title, hasCollision: extra.hasCollision ?? true }, now);

describe('scene library: history', () => {
    it('keeps the newest 100, newest first, one entry per scene', () => {
        let d = emptyLibrary();
        for (let i = 0; i < 130; i++) d = open(d, `s${i}`, 1000 + i);
        d = open(d, 's50', 5000); // reopened: moves to the front, still once
        expect(d.history.length).toBe(HISTORY_CAP);
        expect(d.history[0].id).toBe('s50');
        expect(d.history[1].id).toBe('s129');
        expect(d.history.filter((e) => e.id === 's50').length).toBe(1);
        // the oldest ones fell out
        expect(d.history.some((e) => e.id === 's0')).toBe(false);
        expect(lastScene(d)?.id).toBe('s50');
    });

    it('counts flights and airtime only for scenes in the history; a good open clears a failure', () => {
        let d = open(emptyLibrary(), 'a', 1);
        d = L.recordFlight(d, 'a', 12.5);
        d = L.recordFlight(d, 'zz', 3);
        expect(d.history).toEqual([expect.objectContaining({ id: 'a', flights: 1, airtimeS: 12.5 })]);
        d = L.recordFailure(d, 'a', 'network', 10);
        expect(failedRecently(d, 'a', 20)).toBe(true);
        expect(failedRecently(d, 'a', 10 + 25 * 3600e3)).toBe(false);
        d = open(d, 'a', 30);
        expect(failedRecently(d, 'a', 40)).toBe(false);
        // a scene never opened that fails goes to the end: it is not "the last scene"
        d = L.recordFailure(d, 'x', 'not-found', 50);
        expect(d.history.map((e) => e.id)).toEqual(['a', 'x']);
        expect(lastScene(d)?.id).toBe('a');
    });
});

describe('scene library: favourites', () => {
    it('a new star goes first, unstarring keeps the order of the rest', () => {
        let d = emptyLibrary();
        for (const id of ['a', 'b', 'c']) d = L.toggleFavourite(d, id).data;
        expect(d.favourites).toEqual(['c', 'b', 'a']);
        const r = L.toggleFavourite(d, 'b');
        expect(r.on).toBe(false);
        expect(r.data.favourites).toEqual(['c', 'a']);
        expect(L.toggleFavourite(r.data, 'b')).toEqual({ data: expect.objectContaining({ favourites: ['b', 'c', 'a'] }), on: true });
    });

    it('control: the input is never changed in place (a caller holding the old data keeps it)', () => {
        const d = L.toggleFavourite(emptyLibrary(), 'a').data;
        const before = JSON.stringify(d);
        L.toggleFavourite(d, 'b');
        L.recordFlight(open(d, 'a', 1), 'a', 1);
        expect(JSON.stringify(d)).toBe(before);
    });
});

describe('scene library: merge', () => {
    it('newer open wins, counts take the larger, favourites keep the first order then the second', () => {
        let a = open(emptyLibrary(), 'x', 100, { title: 'X old' });
        a = L.recordFlight(a, 'x', 10);
        a = open(a, 'y', 200);
        a = { ...a, favourites: ['y', 'x'], versions: { x: 2 } };
        let b = open(emptyLibrary(), 'x', 300, { title: 'X new' });
        b = open(b, 'z', 50);
        b = L.recordFlight(L.recordFlight(L.recordFlight(b, 'z', 1), 'z', 1), 'z', 1);
        b = { ...b, favourites: ['z', 'x', 'q'], versions: { x: 1, z: 3 } };
        const m = mergeLibraries(a, b);
        expect(m.history.map((e) => e.id)).toEqual(['x', 'y', 'z']);
        expect(m.history[0]).toEqual(expect.objectContaining({ id: 'x', title: 'X new', lastFlown: 300, flights: 1, airtimeS: 10 }));
        expect(m.history[2].flights).toBe(3);
        expect(m.favourites).toEqual(['y', 'x', 'z', 'q']);
        expect(m.versions).toEqual({ x: 2, z: 3 });
        // merging the same library twice changes nothing
        expect(mergeLibraries(m, m)).toEqual(m);
    });

    it('a failure newer than both opens is kept, an older one is not', () => {
        const a = L.recordFailure(open(emptyLibrary(), 'x', 100), 'x', 'network', 500);
        const b = open(emptyLibrary(), 'x', 300);
        expect(mergeLibraries(a, b).history[0].failCode).toBe('network');
        const c = open(emptyLibrary(), 'x', 900);
        expect(mergeLibraries(a, c).history[0].failCode).toBeUndefined();
    });

    it('control: a naive concat keeps duplicates and the wrong order (the merge is what fixes it)', () => {
        const a = open(open(emptyLibrary(), 'x', 1), 'y', 2);
        const b = open(emptyLibrary(), 'x', 3);
        const naive = [...a.history, ...b.history].map((e) => e.id);
        expect(naive).toEqual(['y', 'x', 'x']);
        expect(mergeLibraries(a, b).history.map((e) => e.id)).toEqual(['x', 'y']);
    });
});
