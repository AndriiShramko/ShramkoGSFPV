// The Fly by Sound collection 'sonic' (v0.12 lane v12-flight step 7, docs/wip/v12-plan.md section 1): the pilot's sound
// settings as one opaque document and the progress of every lesson, kept like the other collections. It is a collection,
// not settings, so it has no catalogue rows. What is held here: a default that is empty, a validator that repairs and
// bounds, the store's persistence and change events, the export file, import (replace, merge, the count of the preview)
// and hostile input (reserved keys, huge documents, a lesson id that is not one). Each rule has a case that breaks it.
import { describe, expect, it } from 'vitest';
import { COLLECTION_IDS, MemoryBackend, PREFS_KEY, SONIC_LESSON_ID, SONIC_PREFS_CAP, SONIC_PROGRESS_CAP, canonicalJson, defaultCollection, emptyDoc, normalizeDoc, validSonicProgress, validateCollection } from '../src';
import type { PrefChange, SonicLessonProgress } from '../src';
import { mkStore } from './helpers';

const progress = (id: string, o: Partial<SonicLessonProgress> = {}): SonicLessonProgress => ({
    lessonId: id, version: 1, attempts: 3, successes: 2, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-07T10:00:00.000Z', ...o
});

describe('the collection and its default', () => {
    it('is one of the collections, empty by default, in every new document', () => {
        expect(COLLECTION_IDS).toContain('sonic');
        expect(defaultCollection('sonic')).toEqual({ v: 1, prefs: null, progress: {}, current: null });
        expect(emptyDoc().collections.sonic).toEqual({ v: 1, prefs: null, progress: {}, current: null });
    });

    it('a document from before it (no sonic key) is read with the default, the other collections untouched', () => {
        const old = { format: 'gsfpv-prefs', version: 1, app: '0.3.0', savedAt: '2026-10-01T00:00:00.000Z', settings: { global: {}, drone: {}, scene: {} }, collections: { ui: { v: 1, warned: true } } };
        const doc = normalizeDoc(old);
        expect(doc.collections.sonic).toEqual({ v: 1, prefs: null, progress: {}, current: null });
        expect(doc.collections.ui.warned).toBe(true);
    });
});

describe('validation repairs and bounds', () => {
    it('keeps a good lesson and its numbers', () => {
        const v = validateCollection('sonic', { v: 1, prefs: { theme: 'clear', captions: false }, progress: { 'walls-hall': progress('walls-hall', { passed: true, bestTimeMs: 41200, blocksPassed: 1 }) }, current: 'walls-hall' })!;
        expect(v.progress['walls-hall']).toEqual(progress('walls-hall', { passed: true, bestTimeMs: 41200, blocksPassed: 1 }));
        expect(v.prefs).toEqual({ theme: 'clear', captions: false });
        expect(v.current).toBe('walls-hall');
    });

    it('drops what is not a lesson: a bad id, a wrong count, a negative time, a date that is no date, a key that is not the lesson\'s', () => {
        const bad = {
            'Bad Id': progress('Bad Id'),
            'a': { ...progress('a'), attempts: -1 },
            'b': { ...progress('b'), attempts: 1.5 },
            'c': { ...progress('c'), bestTimeMs: -5 },
            'd': { ...progress('d'), lastAt: 'yesterday' },
            'e': { ...progress('e'), passed: 'yes' },
            'f': { ...progress('f'), version: 0 },
            'g': { ...progress('other') },
            'ok': progress('ok')
        };
        const v = validateCollection('sonic', { v: 1, progress: bad })!;
        expect(Object.keys(v.progress)).toEqual(['ok']);
    });

    it('the key is the lesson id, whatever the entry says; a missing lessonId is the key\'s', () => {
        const { lessonId: _drop, ...bare } = progress('hover-height');
        void _drop;
        expect(validSonicProgress('hover-height', bare)).toEqual(progress('hover-height'));
        expect(validSonicProgress('hover-height', { ...bare, lessonId: 'walls-hall' })).toBeNull();
    });

    it('an unknown current lesson id is not a lesson id: none', () => {
        expect(validateCollection('sonic', { v: 1, current: '../../etc' })!.current).toBeNull();
        expect(validateCollection('sonic', { v: 1, current: 'rings-first' })!.current).toBe('rings-first');
        expect(SONIC_LESSON_ID.test('rings-first')).toBe(true);
        expect(SONIC_LESSON_ID.test('Rings')).toBe(false);
    });

    it('holds at most SONIC_PROGRESS_CAP lessons and a sound document under SONIC_PREFS_CAP characters', () => {
        const many: Record<string, unknown> = {};
        for (let i = 0; i < SONIC_PROGRESS_CAP + 20; i++) many[`lesson-${i}`] = progress(`lesson-${i}`);
        expect(Object.keys(validateCollection('sonic', { v: 1, progress: many })!.progress)).toHaveLength(SONIC_PROGRESS_CAP);
        expect(validateCollection('sonic', { v: 1, prefs: { x: 'y'.repeat(SONIC_PREFS_CAP) } })!.prefs).toBeNull();
        expect(validateCollection('sonic', { v: 1, prefs: { x: 'y'.repeat(100) } })!.prefs).toEqual({ x: 'y'.repeat(100) });
    });

    it('a sound document that is not an object is none, not a crash', () => {
        for (const p of ['text', 5, [1, 2], true]) expect(validateCollection('sonic', { v: 1, prefs: p })!.prefs).toBeNull();
    });

    it('reserved keys never become keys (a lesson id, a document key), and are reported', () => {
        const dropped: string[] = [];
        const text = '{"v":1,"prefs":{"__proto__":{"polluted":1},"theme":"soft"},"progress":{"__proto__":' + JSON.stringify(progress('x')) + ',"constructor":' + JSON.stringify(progress('constructor')) + ',"hover-height":' + JSON.stringify(progress('hover-height')) + '}}';
        const v = validateCollection('sonic', JSON.parse(text), dropped)!;
        expect(Object.keys(v.progress)).toEqual(['hover-height']);
        expect(Object.keys(v.prefs ?? {})).toEqual(['theme']);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        expect(dropped.sort()).toEqual(['collections.sonic.progress.__proto__', 'collections.sonic.progress.constructor']);
    });
});

describe('the store keeps it', () => {
    it('updateCollection stores, a new store on the same backend reads it back, a change event says so', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        const seen: PrefChange[] = [];
        s.onChange((c) => seen.push(c));
        s.updateCollection('sonic', (d) => {
            d.prefs = { theme: 'race', selfVoice: false };
            d.progress['rings-first'] = progress('rings-first', { attempts: 9, successes: 8, passed: true, blocksPassed: 1 });
            d.current = 'rings-line';
        });
        expect(seen.map((c) => c.id)).toEqual(['collection.sonic']);
        const t = mkStore(b);
        expect(t.collection('sonic')).toEqual({ v: 1, prefs: { theme: 'race', selfVoice: false }, progress: { 'rings-first': progress('rings-first', { attempts: 9, successes: 8, passed: true, blocksPassed: 1 }) }, current: 'rings-line' });
        expect(b.read()).toContain('"sonic"');
    });

    it('v0.13 (W7): a lesson left without passing keeps `skipped` through a write and a new store on the same backend, true or false; one of v0.12 has none; a `skipped` that is no boolean is left out, the lesson kept (control)', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.updateCollection('sonic', (d) => {
            d.progress['hover-height'] = progress('hover-height', { version: 2, attempts: 4, successes: 1, skipped: true });
            d.progress['walls-hall'] = progress('walls-hall', { version: 2, passed: true, skipped: false });
            d.progress['rings-first'] = progress('rings-first');
            d.progress['corridor'] = { ...progress('corridor'), skipped: 'yes' } as unknown as SonicLessonProgress;
            d.current = 'walls-hall';
        });
        // in the store at once (updateCollection validates every write) and after a reload
        for (const st of [s, mkStore(b)]) {
            const p = st.collection('sonic').progress;
            expect(p['hover-height']).toEqual(progress('hover-height', { version: 2, attempts: 4, successes: 1, skipped: true }));
            expect(p['walls-hall']?.skipped).toBe(false);
            expect(p['rings-first']).toEqual(progress('rings-first'));
            expect('skipped' in (p['rings-first'] as object)).toBe(false);
            expect(p['corridor']).toEqual(progress('corridor'));
            expect('skipped' in (p['corridor'] as object)).toBe(false);
        }
        expect(validSonicProgress('hover-height', { ...progress('hover-height'), skipped: true })?.skipped).toBe(true);
        expect(validSonicProgress('hover-height', { ...progress('hover-height'), skipped: 1 })).toEqual(progress('hover-height'));
        // the export file carries it, and an import of that file keeps it
        const file = s.exportFile({ include: ['sonic'] });
        expect((file.collections.sonic as { progress: Record<string, SonicLessonProgress> }).progress['hover-height']?.skipped).toBe(true);
        const other = mkStore();
        other.importFile(file, 'replace');
        expect(other.collection('sonic').progress['hover-height']?.skipped).toBe(true);
    });

    it('an update that breaks a rule (a bad lesson id) leaves the others and drops the bad one; the stored text is canonical', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.updateCollection('sonic', (d) => {
            d.progress['ok-one'] = progress('ok-one');
            d.progress['Not Ok'] = progress('Not Ok');
        });
        expect(Object.keys(s.collection('sonic').progress)).toEqual(['ok-one']);
        const raw = JSON.parse(b.read()!) as { collections: { sonic: unknown } };
        expect(canonicalJson(raw.collections.sonic)).toBe(canonicalJson(s.collection('sonic')));
    });

    it('the storage key is the page\'s, and the other collections are not disturbed by a sonic write', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.updateCollection('ui', (d) => { d.warned = true; });
        s.updateCollection('sonic', (d) => { d.current = 'hover-height'; });
        const t = mkStore(b);
        expect(t.collection('ui').warned).toBe(true);
        expect(t.collection('sonic').current).toBe('hover-height');
        expect(PREFS_KEY).toBe('gsfpv.prefs.v1');
    });

    it('reset of the collection puts the default back (resetAll with the collection named)', () => {
        const s = mkStore();
        s.updateCollection('sonic', (d) => { d.progress['a'] = progress('a'); d.current = 'a'; });
        s.resetAll({ settings: false, collections: ['sonic'] });
        expect(s.collection('sonic')).toEqual(defaultCollection('sonic'));
    });

    it('two tabs: one writes progress, the other a different lesson; both stay (the changed fields replay on the stored document)', () => {
        const b = new MemoryBackend();
        const a1 = mkStore(b);
        const a2 = mkStore(b);
        a1.updateCollection('sonic', (d) => { d.progress['one'] = progress('one'); });
        a2.updateCollection('sonic', (d) => { d.current = 'two'; });
        const c = mkStore(b);
        // the progress field was written by the first tab, the current lesson by the second: neither lost the other's field
        expect(c.collection('sonic').current).toBe('two');
        expect(Object.keys(c.collection('sonic').progress)).toEqual(['one']);
    });
});

describe('export and import', () => {
    function filled() {
        const s = mkStore();
        s.updateCollection('sonic', (d) => {
            d.prefs = { theme: 'clear', calm: true };
            d.progress['walls-hall'] = progress('walls-hall', { passed: true, blocksPassed: 1, lastAt: '2026-11-07T10:00:00.000Z' });
            d.progress['corridor'] = progress('corridor', { attempts: 1, lastAt: '2026-11-07T11:00:00.000Z' });
            d.current = 'corridor';
        });
        return s;
    }

    it('the export file carries the collection and a round trip is identical', () => {
        const a = filled();
        const file = a.exportFile();
        expect(Object.keys(file.collections)).toContain('sonic');
        const b = mkStore();
        const r = b.importFile(JSON.stringify(file));
        expect(r.ok).toBe(true);
        expect(canonicalJson(b.collection('sonic'))).toBe(canonicalJson(a.collection('sonic')));
        expect(r.collections.sonic).toEqual({ added: 2, changed: 2 });
    });

    it('a file that leaves the collection out leaves ours alone (include)', () => {
        const a = filled();
        const file = a.exportFile({ include: ['ui'] });
        const b = filled();
        b.updateCollection('sonic', (d) => { d.current = 'hover-height'; });
        b.importFile(JSON.stringify(file));
        expect(b.collection('sonic').current).toBe('hover-height');
    });

    it('merge: per lesson the later visit wins, a lesson only one has stays, merging the file twice equals once', () => {
        const mine = mkStore();
        mine.updateCollection('sonic', (d) => {
            d.progress['walls-hall'] = progress('walls-hall', { attempts: 10, passed: true, lastAt: '2026-11-08T09:00:00.000Z' });
            d.progress['rings-first'] = progress('rings-first', { attempts: 2 });
            d.prefs = { theme: 'soft' };
            d.current = 'rings-first';
        });
        const file = JSON.stringify(filled().exportFile());
        mine.importFile(file, 'merge');
        const once = canonicalJson(mine.collection('sonic'));
        const v = mine.collection('sonic');
        // walls-hall: mine is later (8 November) than the file's (7 November): mine stays
        expect(v.progress['walls-hall']!.attempts).toBe(10);
        expect(Object.keys(v.progress).sort()).toEqual(['corridor', 'rings-first', 'walls-hall']);
        expect(v.prefs).toEqual({ theme: 'clear', calm: true });
        expect(v.current).toBe('corridor');
        mine.importFile(file, 'merge');
        expect(canonicalJson(mine.collection('sonic'))).toBe(once);
    });

    it('replace: the file\'s collection replaces ours', () => {
        const mine = mkStore();
        mine.updateCollection('sonic', (d) => { d.progress['only-mine'] = progress('only-mine'); });
        mine.importFile(JSON.stringify(filled().exportFile()), 'replace');
        expect(Object.keys(mine.collection('sonic').progress).sort()).toEqual(['corridor', 'walls-hall']);
    });

    it('a hostile file: a lesson id with a path in it, a __proto__ key, a huge document: dropped, nothing polluted', () => {
        const file = filled().exportFile() as unknown as { collections: { sonic: { progress: Record<string, unknown>; prefs: unknown } } };
        file.collections.sonic.progress['../x'] = progress('../x');
        const text = JSON.stringify(file).replace('"progress":{', '"progress":{"__proto__":{"passed":true},');
        const b = mkStore();
        const r = b.importFile(text);
        expect(r.ok).toBe(true);
        expect(Object.keys(b.collection('sonic').progress).sort()).toEqual(['corridor', 'walls-hall']);
        expect(({} as Record<string, unknown>)['passed']).toBeUndefined();
        const huge = JSON.stringify(filled().exportFile()).replace('"calm":true', `"calm":"${'z'.repeat(SONIC_PREFS_CAP)}"`);
        const c = mkStore();
        c.importFile(huge);
        expect(c.collection('sonic').prefs).toBeNull();
    });
});
