// The course editor on the page (lane tracks, train 2, stage T3-editor-ui; tracks-plan.md 2.9, 2.11): the editor's own key
// table, its words in four languages, the store's pilot saves and votes, the list keeping later versions, and the editor's
// window in the mouse rule. Negative control (neg_control.py, ref origin/main, files store.ts mouse-look.ts): the old store
// drops version 2 rows and has no saveMine or vote, the old mouse rule keeps the lock over the editor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { BIG_STEP_M, KEY_ROWS, editorKey, forwardOf } from '../../../apps/fly/src/course/editor/keys';
import { editorLocaleKeys } from '../../../apps/fly/src/course/editor/texts';
import { CourseStore, myVotes, rememberVote, voterId } from '../../../apps/fly/src/course/store';
import { CURSOR_WINDOWS, cursorWindowOpen } from '../../../apps/fly/src/play/mouse-look';

const LOCALES = join(__dirname, '../../../packages/i18n/locales/fly/course');
const lang = (l: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, `${l}.json`), 'utf8')) as Record<string, string>;

class MemStore {
    m = new Map<string, string>();
    getItem(k: string): string | null { return this.m.get(k) ?? null; }
    setItem(k: string, v: string): void { this.m.set(k, v); }
}

describe('the editor key table', () => {
    it('arrows move relative to the view: looking along -Z, Up is -Z; turned 90 degrees left, Up is -X', () => {
        const ahead = forwardOf(1, 0, 0, 0);
        expect(editorKey({ code: 'ArrowUp' }, ahead)).toEqual({ edit: { kind: 'move', axis: 2, steps: -1 } });
        expect(editorKey({ code: 'ArrowRight' }, ahead)).toEqual({ edit: { kind: 'move', axis: 0, steps: 1 } });
        expect(editorKey({ code: 'ArrowDown', shiftKey: true }, ahead)).toEqual({ edit: { kind: 'move', axis: 2, steps: 1, stepM: BIG_STEP_M } });
        const h = Math.SQRT1_2;
        const left = forwardOf(h, 0, h, 0);
        expect(left[0]).toBeCloseTo(-1, 6);
        expect(editorKey({ code: 'ArrowUp' }, left)).toEqual({ edit: { kind: 'move', axis: 0, steps: -1 } });
        expect(editorKey({ code: 'ArrowLeft' }, left)).toEqual({ edit: { kind: 'move', axis: 2, steps: 1 } });
    });

    it('the plan\'s keys: Tab, PageUp, Q, E, 1-4, +, -, Insert, Delete, Ctrl+Z, G, Enter, Esc; flying-only keys do nothing', () => {
        const f: [number, number] = [0, -1];
        expect(editorKey({ code: 'Tab', shiftKey: true }, f)).toEqual({ edit: { kind: 'select-step', step: -1 } });
        expect(editorKey({ code: 'PageUp' }, f)).toEqual({ edit: { kind: 'move', axis: 1, steps: 1 } });
        expect(editorKey({ code: 'KeyQ' }, f)).toEqual({ edit: { kind: 'turn', steps: -1 } });
        expect(editorKey({ code: 'Digit3' }, f)).toEqual({ edit: { kind: 'dive' } });
        expect(editorKey({ code: 'Equal' }, f)).toEqual({ edit: { kind: 'size', steps: 1 } });
        expect(editorKey({ code: 'Insert' }, f)).toEqual({ edit: { kind: 'insert' } });
        expect(editorKey({ code: 'Delete' }, f)).toEqual({ edit: { kind: 'delete' } });
        expect(editorKey({ code: 'KeyZ', ctrlKey: true }, f)).toEqual({ edit: { kind: 'undo' } });
        expect(editorKey({ code: 'KeyG', shiftKey: true }, f)).toEqual({ cmd: 'regen-same' });
        expect(editorKey({ code: 'Enter' }, f)).toEqual({ cmd: 'save-mine' });
        expect(editorKey({ code: 'Escape' }, f)).toEqual({ cmd: 'exit' });
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyT']) expect(editorKey({ code }, f), code).toBeNull();
        expect(editorKey({ code: 'KeyQ', altKey: true }, f)).toBeNull();
    });

    it('every button of the window stands for a key the table knows', () => {
        for (const r of KEY_ROWS) expect(editorKey(r.press, [0, -1]), r.caps).not.toBeNull();
    });
});

describe('the editor speaks four languages', () => {
    it('every key the editor uses is in en, es, pl and ru, with the same {placeholders}, and translated', () => {
        const keys = editorLocaleKeys();
        expect(keys.length).toBeGreaterThan(60);
        const en = lang('en');
        const holes = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const d = lang(l);
            for (const k of keys) {
                expect(typeof d[k] === 'string' && d[k]!.length > 0, `${l} ${k}`).toBe(true);
                expect(holes(d[k]!), `${l} ${k}`).toBe(holes(en[k]!));
            }
            if (l === 'en') continue;
            const same = keys.filter((k) => d[k] === en[k] && !/^\{\w+\}\. \{\w+\}$/.test(en[k]!));
            // a few words are the same in two languages (generator, pilot); a copied table is not
            expect(same.length, `${l}: ${same.join(' ')}`).toBeLessThan(4);
        }
    });
});

// the shared fixture of a pilot's fork (held to the server by apps/api/tests and fixtures.test.ts)
const FORK = JSON.parse(readFileSync(join(__dirname, '../../../apps/api/tests/fixtures/tracks/valid-person-fork.json'), 'utf8')) as TrackFile;
const person = (over: Partial<TrackFile> = {}): TrackFile => ({ ...FORK, id: '887f27aa-0000abcd', ...over } as TrackFile);

describe('the store: pilot saves, votes, later versions', () => {
    it('keeps a row of version 2 in the list (the old filter dropped it)', async () => {
        const rows = [
            { id: '887f27aa-0000abcd', version: 2, title: 'Hall loop', gates: 3, lengthM: 20, created: 'x', creator: { kind: 'generator', name: 'gsfpv-course' }, editor: { kind: 'person', name: 'Andrii' }, up: 2, down: 1 },
            { id: '887f27aa-0000abce', version: 1.5, title: 'bad', gates: 3, lengthM: 20, created: 'x' }
        ];
        const store = new CourseStore(async () => new Response(JSON.stringify({ v: 1, tracks: rows }), { status: 200 }));
        const got = await store.list('887f27aa');
        expect(got.map((r) => r.version)).toEqual([2]);
        expect(got[0]!.editor?.name).toBe('Andrii');
    });

    it('a new course or fork posts to /api/tracks and keeps the token; a new version posts to /versions with the token', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const store = new CourseStore(async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(url.endsWith('/versions') ? { id: '887f27aa-0000abcd', version: 2 } : { id: '887f27aa-0000abcd', version: 1, editToken: 'tok' }), { status: 201 });
        });
        const a = await store.saveMine(person({ parent: { id: '887f27aa-11112222', version: 1 } } as Partial<TrackFile>));
        expect(a).toEqual({ ok: true, id: '887f27aa-0000abcd', version: 1, token: 'tok' });
        expect(calls[0]!.url).toBe('/api/tracks');
        const b = await store.saveMine(person({ version: 2, parent: { id: '887f27aa-0000abcd', version: 1 } } as Partial<TrackFile>), 'tok');
        expect(b).toEqual({ ok: true, id: '887f27aa-0000abcd', version: 2, token: 'tok' });
        expect(calls[1]!.url).toBe('/api/tracks/887f27aa-0000abcd/versions');
        expect((calls[1]!.init?.headers as Record<string, string>)['X-Track-Token']).toBe('tok');
        // a name the contract refuses never leaves the page
        const c = await store.saveMine(person({ author: { kind: 'person', name: 'x' } } as Partial<TrackFile>));
        expect(c.ok).toBe(false);
        expect(calls.length).toBe(2);
    });

    it('a vote posts {v, voter} and answers the counts; the browser keeps its voter id and its own votes', async () => {
        const mem = new MemStore();
        const id = voterId(mem);
        expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(voterId(mem)).toBe(id);
        let body = '';
        const store = new CourseStore(async (_u, init) => {
            body = String(init?.body);
            return new Response(JSON.stringify({ id: '887f27aa-0000abcd', v: 1, up: 3, down: 1, rating: 0.3 }), { status: 200 });
        });
        expect(await store.vote('887f27aa-0000abcd', 1, id)).toEqual({ ok: true, up: 3, down: 1, v: 1 });
        expect(JSON.parse(body)).toEqual({ v: 1, voter: id });
        expect((await store.vote('887f27aa-0000abcd', 1, 'nothex')).ok).toBe(false);
        rememberVote('887f27aa-0000abcd', -1, mem);
        expect(myVotes(mem)).toEqual({ '887f27aa-0000abcd': -1 });
        rememberVote('887f27aa-0000abcd', 0, mem);
        expect(myVotes(mem)).toEqual({});
    });
});

describe('the editor window has the mouse', () => {
    it('.course-editor is a cursor window', () => {
        expect(CURSOR_WINDOWS as readonly string[]).toContain('.course-editor');
        const root = { querySelector: (s: string) => (s === '.course-editor' ? ({} as Element) : null) };
        expect(cursorWindowOpen(root)).toBe(true);
    });
});
