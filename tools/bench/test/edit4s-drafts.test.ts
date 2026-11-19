// Lane edit4s (train 4, E6): the course editor keeps drafts from the first change on, several automatic versions, and a
// way back. Pure list rules (course/editor/drafts.ts) and the keeper's timing (course/editor/parts/keep.ts) on a fake
// localStorage. NEG: on origin/main (e3201fec) nothing writes a draft key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import type { EditorState } from '@gsfpv/tracks';
import {
    DRAFTS_KEPT, DRAFTS_PREFIX, DRAFT_DEBOUNCE_MS, addDraft, draftToRestore, readDrafts, restoredState, writeDrafts,
    type DraftEntry, type DraftStorage,
} from '../../../apps/fly/src/course/editor/drafts';
import { DraftKeeper, type KeepHost } from '../../../apps/fly/src/course/editor/parts/keep';
import { KEEP_KEYS } from '../../../apps/fly/src/course/editor/keep-texts';
import en from '../../../packages/i18n/locales/fly/course-save/en.json';
import es from '../../../packages/i18n/locales/fly/course-save/es.json';
import pl from '../../../packages/i18n/locales/fly/course-save/pl.json';
import ru from '../../../packages/i18n/locales/fly/course-save/ru.json';

vi.mock('../../../apps/fly/src/i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => k + (v ? JSON.stringify(v) : '') }));

/** a Storage with key/length; `limit` chars in all values together, then setItem throws as a full quota does */
class FakeStorage implements DraftStorage {
    readonly m = new Map<string, string>();
    constructor(public limit = Infinity) {}
    get length(): number { return this.m.size; }
    key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
    getItem(k: string): string | null { return this.m.get(k) ?? null; }
    removeItem(k: string): void { this.m.delete(k); }
    setItem(k: string, v: string): void {
        let size = v.length;
        for (const [kk, vv] of this.m) if (kk !== k) size += vv.length;
        if (size > this.limit) throw new DOMException('full', 'QuotaExceededError');
        this.m.set(k, v);
    }
    clear(): void { this.m.clear(); }
}

const track = (x: number, id = 'gen-1', title = 'Course'): TrackFile =>
    ({ id, title, laps: 1, start: null, gates: [{ id: 'g1', pos: [x, 1, 0] }, { id: 'g2', pos: [x, 1, 5] }] }) as unknown as TrackFile;

const entry = (t: number, x: number, by = 'move', saved = false, sourceId: string | null = null): DraftEntry =>
    ({ t, by, title: 'Course', sourceId, gates: 2, saved, track: track(x, sourceId ?? 'gen-1') });

describe('edit4s drafts: the list rules', () => {
    it('keeps an unchanged course once, folds the same kind within a minute, a different kind is its own version', () => {
        let l = addDraft([], entry(0, 1));
        expect(addDraft(l, entry(1_000, 1))).toHaveLength(1);
        l = addDraft(l, entry(10_000, 2));
        expect(l).toHaveLength(1);
        expect(l[0]!.track.gates[0]!.pos[0]).toBe(2);
        l = addDraft(l, entry(20_000, 3, 'turn'));
        expect(l.map((e) => e.by)).toEqual(['turn', 'move']);
    });

    it('restore: the newest unsaved draft newer than the opened course; a server course takes only its own drafts', () => {
        const list = [entry(300, 3), entry(200, 2, 'move', true), entry(100, 1, 'move', false, 'abc-1')];
        expect(draftToRestore(list, { source: 'generated', track: track(9), madeAt: null })?.t).toBe(300);
        expect(draftToRestore(list, { source: 'generated', track: track(3), madeAt: null })).toBeNull();
        expect(draftToRestore(list, { source: 'server', track: track(9, 'abc-1'), madeAt: 50 })?.t).toBe(100);
        expect(draftToRestore(list, { source: 'server', track: track(9, 'abc-1'), madeAt: 150 })).toBeNull();
        expect(draftToRestore([entry(200, 2, 'move', true)], { source: 'generated', track: track(9), madeAt: null })).toBeNull();
    });

    it('a full storage drops the oldest other scene and writes; with nothing to drop it says blocked', () => {
        const s = new FakeStorage();
        expect(writeDrafts(s, 'a', [entry(1, 1)], 1)).toBe('ok');
        expect(writeDrafts(s, 'b', [entry(2, 2)], 2)).toBe('ok');
        s.limit = [...s.m.values()].reduce((n, v) => n + v.length, 0) + 10;
        expect(writeDrafts(s, 'c', [entry(3, 3)], 3)).toBe('ok');
        expect(s.getItem(DRAFTS_PREFIX + 'a')).toBeNull();
        expect(readDrafts(s, 'b')).toHaveLength(1);
        expect(readDrafts(s, 'c')).toHaveLength(1);
        s.limit = 5;
        s.clear();
        expect(writeDrafts(s, 'c', [entry(3, 3)], 4)).toBe('blocked');
        expect(writeDrafts(null, 'c', [entry(3, 3)], 4)).toBe('blocked');
    });

    it('keeps at most three scenes, the one drafted longest ago goes', () => {
        const s = new FakeStorage();
        for (const [i, sc] of ['a', 'b', 'c', 'd'].entries()) writeDrafts(s, sc, [entry(i, i)], i);
        expect([...s.m.keys()].sort()).toEqual(['b', 'c', 'd'].map((x) => DRAFTS_PREFIX + x));
    });

    it('restoredState puts the course in as one undo step', () => {
        const a = { gates: [1, 2, 3] } as never;
        const b = { gates: [1] } as never;
        const st = { course: a, selected: 2, undo: [], redo: [{ course: a, selected: 0 }], problems: [] } as unknown as EditorState;
        const r = restoredState(st, b, () => []);
        expect(r.course).toBe(b);
        expect(r.selected).toBe(0);
        expect(r.undo).toEqual([{ course: a, selected: 2 }]);
        expect(r.redo).toEqual([]);
    });
});

describe('edit4s drafts: the keeper', () => {
    let store: FakeStorage;
    let now: number;
    let cur: TrackFile;
    let said: string[];
    let restored: TrackFile[];
    const host = (): KeepHost => ({
        sceneId: () => '70b50d42',
        trackNow: () => cur,
        sourceId: () => null,
        restore: (tr) => { restored.push(tr); cur = tr; },
        say: (text) => { said.push(text); },
        hook: () => {},
        versions: () => {},
    });
    beforeEach(() => {
        vi.useFakeTimers();
        store = new FakeStorage();
        now = Date.UTC(2026, 10, 19, 13, 0, 0);
        cur = track(0);
        said = [];
        restored = [];
    });
    afterEach(() => vi.useRealTimers());
    const step = (ms: number): void => {
        now += ms;
        vi.advanceTimersByTime(ms);
    };

    it('a change is a draft 2 s later (a draft key exists), 12 changes over 15 minutes keep the newest 10', () => {
        const k = new DraftKeeper(host(), store, () => now);
        k.opened({ source: 'generated', track: cur, madeAt: null });
        cur = track(1);
        k.changed('move');
        step(DRAFT_DEBOUNCE_MS - 1);
        expect(store.getItem(DRAFTS_PREFIX + '70b50d42')).toBeNull();
        step(1);
        expect(store.getItem(DRAFTS_PREFIX + '70b50d42')).not.toBeNull();
        for (let i = 2; i <= 12; i++) {
            step(75_000 - DRAFT_DEBOUNCE_MS);
            cur = track(i);
            k.changed('move');
            step(DRAFT_DEBOUNCE_MS);
        }
        const l = k.list();
        expect(l).toHaveLength(DRAFTS_KEPT);
        expect(l.map((e) => e.track.gates[0]!.pos[0])).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
        k.dispose();
    });

    it('a loss writes at once; an untouched course writes nothing', () => {
        const k = new DraftKeeper(host(), store, () => now);
        k.opened({ source: 'generated', track: cur, madeAt: null });
        k.beforeLoss('generate');
        expect(k.list()).toHaveLength(0);
        cur = track(5);
        k.changed('turn');
        k.beforeLoss('generate');
        expect(k.list()).toHaveLength(1);
        expect(k.list()[0]!.by).toBe('turn');
        k.dispose();
    });

    // review edit4s R1: G pressed twice in the editor drops the changes on purpose; the editor reopens on the new course and
    // must not bring the dropped one back over it (it stays in Versions), not after a reload either
    it('a course dropped by Generate or another course does not come back over the next one', () => {
        for (const by of ['generate', 'open-other']) {
            store.clear();
            restored = [];
            const a = new DraftKeeper(host(), store, () => now);
            a.opened({ source: 'generated', track: cur, madeAt: null });
            cur = track(4);
            a.changed('move');
            step(DRAFT_DEBOUNCE_MS);
            a.beforeLoss(by);
            a.dispose();
            cur = track(8); // the new generated course
            const b = new DraftKeeper(host(), store, () => now);
            expect(b.opened({ source: 'generated', track: cur, madeAt: null })).toBeNull();
            expect(restored).toHaveLength(0);
            expect(b.list().some((e) => e.track.gates[0]!.pos[0] === 4)).toBe(true);
            // a restored draft dropped again without a change stays dropped too
            b.dispose();
            const c = new DraftKeeper(host(), store, () => now);
            c.back(c.list().findIndex((e) => e.track.gates[0]!.pos[0] === 4));
            c.beforeLoss(by);
            c.dispose();
            cur = track(9);
            const d = new DraftKeeper(host(), store, () => now);
            expect(d.opened({ source: 'generated', track: cur, madeAt: null })).toBeNull();
            // the next course's own change comes back as before
            cur = track(10);
            d.changed('turn');
            step(DRAFT_DEBOUNCE_MS);
            d.dispose();
            cur = track(9);
            const e = new DraftKeeper(host(), store, () => now);
            expect(e.opened({ source: 'generated', track: cur, madeAt: null })?.track.gates[0]!.pos[0]).toBe(10);
            e.dispose();
        }
    });

    it('the page hiding writes the waiting draft', () => {
        const k = new DraftKeeper(host(), store, () => now);
        cur = track(7);
        k.changed('size');
        globalThis.dispatchEvent?.(new Event('pagehide'));
        if (typeof globalThis.dispatchEvent !== 'function') k.leave();
        expect(k.list()).toHaveLength(1);
        k.dispose();
    });

    it('opening again brings the unsaved draft back and says the time; a saved one stays in Versions only', () => {
        const a = new DraftKeeper(host(), store, () => now);
        cur = track(4);
        a.changed('move');
        step(DRAFT_DEBOUNCE_MS);
        a.dispose();
        cur = track(0); // the reload made a new course
        const b = new DraftKeeper(host(), store, () => now);
        expect(b.opened({ source: 'generated', track: cur, madeAt: null })?.track.gates[0]!.pos[0]).toBe(4);
        expect(restored).toHaveLength(1);
        expect(said[0]).toMatch(/13:00|\d\d:\d\d/);
        b.saved(cur);
        b.dispose();
        cur = track(0);
        const c = new DraftKeeper(host(), store, () => now);
        expect(c.opened({ source: 'generated', track: cur, madeAt: null })).toBeNull();
        expect(c.list()[0]!.saved).toBe(true);
        expect(c.back(0)).toBe(true);
        expect(cur.gates[0]!.pos[0]).toBe(4);
        c.dispose();
    });

    it('blocked storage says so once', () => {
        const k = new DraftKeeper(host(), null, () => now);
        cur = track(1);
        k.beforeLoss('x');
        k.changed('move');
        k.beforeLoss('x');
        cur = track(2);
        k.changed('turn');
        k.beforeLoss('x');
        expect(said).toHaveLength(1);
        k.dispose();
    });
});

describe('edit4s drafts: texts', () => {
    it('en es pl ru hold every key of the saving part', () => {
        for (const d of [en, es, pl, ru] as Record<string, string>[]) {
            for (const k of KEEP_KEYS) expect(d[k], k).toBeTruthy();
            expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
        }
    });
});
