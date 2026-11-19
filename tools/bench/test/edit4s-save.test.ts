// Lane edit4s, train 4 stage S2 (complaint E9, docs/wip/edit4s.md): 'cannot save, try another time' for a generated
// course. The store threw the reason away (a bare string), the page said 'press save again' with no reason and no time,
// and the server counted refused presses against the 10 creates of the hour (apps/api/tests/test_tracks.py holds that
// side). Here: the store answers a named SaveProblem; save-words gives each case words that say what happened, that the
// course is kept and what to do, with Save again at the right time; the name field is checked live by the server's rule;
// a failed save writes a draft even for an untouched course; all four languages hold the keys and their {time}/{msg}.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { CourseStore, type SaveProblem } from '../../../apps/fly/src/course/store';
import { RATE_WAIT_DEFAULT_S, SAVE_WORD_KEYS, fieldProblem, saveProblemWords } from '../../../apps/fly/src/course/editor/save-words';
import { DRAFTS_PREFIX, readDrafts, type DraftStorage } from '../../../apps/fly/src/course/editor/drafts';
import { DraftKeeper } from '../../../apps/fly/src/course/editor/parts/keep';
import en from '../../../packages/i18n/locales/fly/course-save/en.json';
import es from '../../../packages/i18n/locales/fly/course-save/es.json';
import pl from '../../../packages/i18n/locales/fly/course-save/pl.json';
import ru from '../../../packages/i18n/locales/fly/course-save/ru.json';

vi.mock('../../../apps/fly/src/i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => k + (v ? JSON.stringify(v) : '') }));

const FORK = JSON.parse(readFileSync(join(__dirname, '../../../apps/api/tests/fixtures/tracks/valid-person-fork.json'), 'utf8')) as TrackFile;
const mine = (over: Partial<TrackFile> = {}): TrackFile => ({ ...FORK, id: '887f27aa-0000abcd', parent: null, author: { kind: 'person', name: 'Andrii Shramko' }, ...over } as TrackFile);
const answering = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const calls: string[] = [];
    const store = new CourseStore(async (url) => {
        calls.push(url);
        return new Response(JSON.stringify(body), { status, headers });
    });
    return { store, calls };
};
const problemOf = async (p: Promise<{ ok: boolean; problem?: SaveProblem }>): Promise<SaveProblem> => {
    const r = await p;
    expect(r.ok).toBe(false);
    return r.problem!;
};

describe('edit4s save: the store says why a save failed', () => {
    it('429 is rate with the Retry-After seconds; 507 and 500 are storage; another 4xx is refused with its code', async () => {
        const a = answering(429, { ok: false }, { 'Retry-After': '900' });
        expect(await problemOf(a.store.saveMine(mine()))).toEqual({ status: 429, code: 'rate', detail: 'http 429', retryAfterS: 900, gate: null });
        expect((await problemOf(answering(429, {}).store.saveMine(mine()))).retryAfterS).toBeNull();
        expect((await problemOf(answering(507, { error: 'disk-full' }).store.saveMine(mine()))).code).toBe('storage');
        expect((await problemOf(answering(500, { error: 'io' }).store.save(mine()))).code).toBe('storage');
        expect(await problemOf(answering(409, { error: 'too-many-versions' }).store.saveMine(mine(), 'tok'))).toMatchObject({ code: 'refused', detail: 'http 409 too-many-versions' });
    });

    it('no answer is network; the server\'s 400 issues name the field or the leg', async () => {
        const down = new CourseStore(async () => { throw new TypeError('Failed to fetch'); });
        expect(await problemOf(down.saveMine(mine()))).toMatchObject({ status: null, code: 'network' });
        const leg = answering(400, { error: 'invalid', issues: ['gates[8]: the leg to the next gate must be at most 60 m'] });
        expect(await problemOf(leg.store.saveMine(mine()))).toMatchObject({ status: 400, code: 'leg-long', gate: 9 });
        const title = answering(400, { error: 'invalid', issues: ['title: must have 3-60 characters'] });
        expect((await problemOf(title.store.saveMine(mine()))).code).toBe('invalid-title');
    });

    it('a name the rule refuses never leaves the page and is named as the name', async () => {
        const a = answering(201, { id: '887f27aa-0000abcd', version: 1, editToken: 't' });
        expect(await problemOf(a.store.saveMine(mine({ author: { kind: 'person', name: 'Andrii (FPV)' } } as Partial<TrackFile>)))).toMatchObject({ status: null, code: 'invalid-name' });
        expect(a.calls).toHaveLength(0);
        expect((await a.store.saveMine(mine())).ok).toBe(true);   // control: the owner's own name goes through
    });
});

describe('edit4s save: words for every failure, each with a way on', () => {
    const p = (over: Partial<SaveProblem>): SaveProblem => ({ status: null, code: 'refused', detail: 'http 409 x', retryAfterS: null, gate: null, ...over });
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);

    it('429: kept as a draft, Save again after the time the server named', () => {
        const w = saveProblemWords(p({ status: 429, code: 'rate', retryAfterS: 600 }), now, 8);
        expect(w.key).toBe('course.save.problem.rate');
        expect(w.again).toEqual({ at: now + 600_000 });
        expect(typeof w.args.time).toBe('string');
        expect(saveProblemWords(p({ code: 'rate' }), now, 8).again).toEqual({ at: now + RATE_WAIT_DEFAULT_S * 1000 });
    });

    it('network and other refusals: Save again at once; storage: in a minute; the reason is in the words', () => {
        expect(saveProblemWords(p({ code: 'network' }), now, 8)).toMatchObject({ key: 'course.save.problem.network', again: { at: null } });
        expect(saveProblemWords(p({ code: 'storage', status: 507 }), now, 8)).toMatchObject({ key: 'course.save.problem.storage', again: { at: now + 60_000 } });
        expect(saveProblemWords(p({}), now, 8)).toMatchObject({ key: 'course.save.problem.other', args: { msg: 'http 409 x' }, again: { at: null } });
    });

    it('a bad name or title outlines its field; a long leg points at its gate and names the next one (the closing leg: 1)', () => {
        expect(saveProblemWords(p({ code: 'invalid-name' }), now, 8)).toMatchObject({ field: 'name', again: null });
        expect(saveProblemWords(p({ code: 'invalid-title' }), now, 8)).toMatchObject({ field: 'title' });
        expect(saveProblemWords(p({ code: 'leg-long', gate: 9 }), now, 9)).toMatchObject({ key: 'course.save.problem.leg', args: { a: 9, b: 1 }, gate: 9 });
        expect(saveProblemWords(p({ code: 'leg-long', gate: 3 }), now, 9).args).toEqual({ a: 3, b: 4 });
    });

    it('the live field check follows the server rule', () => {
        expect(fieldProblem('name', 'Andrii Shramko')).toBeNull();
        expect(fieldProblem('name', ' Andrii ')).toBeNull();   // trimmed as the save sends it
        expect(fieldProblem('name', 'Andrii (FPV)')).toBe('course.save.problem.name');
        expect(fieldProblem('name', 'A')).toBe('course.save.problem.name');
        expect(fieldProblem('title', '')).toBeNull();   // the save keeps the course's own title
        expect(fieldProblem('title', 'Course 12')).toBeNull();
        expect(fieldProblem('title', 'ab')).toBe('course.save.problem.title');
    });

    it('all four languages hold every key; rate holds {time}, other {msg}, leg {a} and {b}', () => {
        for (const loc of [en, es, pl, ru] as Record<string, string>[]) {
            for (const k of SAVE_WORD_KEYS) expect(loc[k], k).toBeTruthy();
            expect(loc['course.save.problem.rate']).toContain('{time}');
            expect(loc['course.save.againAt']).toContain('{time}');
            expect(loc['course.save.problem.other']).toContain('{msg}');
            expect(loc['course.save.problem.leg']).toMatch(/\{a\}.*\{b\}/);
            expect(loc['course.keep.by.notSaved']).toBeTruthy();
        }
    });
});

describe('edit4s save: a failed save keeps the course', () => {
    it('an untouched generated course gets a draft when its save fails (the words say it is kept)', () => {
        const m = new Map<string, string>();
        const store: DraftStorage = { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
        const cur = mine({ id: 'gen-1' });
        const k = new DraftKeeper({ sceneId: () => '70b50d42', trackNow: () => cur, sourceId: () => null, restore: () => {}, say: () => {}, hook: () => {}, versions: () => {} }, store, () => 1_000);
        k.opened({ source: 'generated', track: cur, madeAt: null });
        k.beforeLoss('generate');
        expect(m.get(DRAFTS_PREFIX + '70b50d42')).toBeUndefined();   // control: untouched, nothing to keep before a loss
        k.saveFailed();
        const kept = readDrafts(store, '70b50d42');
        expect(kept.map((d) => d.by)).toEqual(['save-failed']);
        k.dispose();
    });
});
