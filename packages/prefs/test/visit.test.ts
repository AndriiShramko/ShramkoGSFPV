// The visit layer (v0.9, item 15): settings a shared link brought for ONE scene, for this visit only.
// The claims: they read only for that scene (also a global setting such as the walls switch), they are
// never stored or exported, the session layer (URL, test hook) still wins over them, the pilot's own write
// or reset of the same setting takes them out, clearVisit announces the change and gives the pilot's own
// value back, keepVisit stores them as his own. Controls: the session layer, the only layer there was, leaks
// one scene's value into every scene; a value outside the setting's range is refused.
import { describe, expect, it } from 'vitest';
import { MemoryBackend, PrefsStore, SCHEMA } from '../src';
import type { PrefChange } from '../src';
import { clock, resolver } from './helpers';

const A = 'aaaaaa01';
const B = 'bbbbbb02';
const tr = (s: number) => ({ s, t: [0, 0, 0] as [number, number, number], v: 0 });

function mk(backend = new MemoryBackend()): { store: PrefsStore; backend: MemoryBackend; seen: PrefChange[] } {
    const store = new PrefsStore(SCHEMA, backend, resolver({ [B]: 4 }), { now: clock, debounceMs: 0 });
    const seen: PrefChange[] = [];
    store.onChange((c) => seen.push(c));
    return { store, backend, seen };
}

describe('the visit layer', () => {
    it('reads only for the scene it was set for, in every scope', () => {
        const { store } = mk();
        expect(store.setVisit(A, 'scene.transform', tr(3)).ok).toBe(true);
        expect(store.setVisit(A, 'scene.walls', 'off').ok).toBe(true); // a global setting: the walls switch
        expect(store.setVisit(A, 'scene.dropFloaters', 5).ok).toBe(true);
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(3));
        expect(store.get('scene.walls', { scene: A })).toBe('off');
        expect(store.get('scene.dropFloaters', { scene: A })).toBe(5);
        // another scene, and no scene at all, read the pilot's own / the default
        expect(store.get('scene.transform', { scene: B })).toEqual(tr(4)); // B's owner default
        expect(store.get('scene.walls', { scene: B })).toBe('on');
        expect(store.get('scene.walls')).toBe('on');
        expect(store.get('scene.dropFloaters', { scene: B })).toBe(0);
        expect(store.visitOf(A)).toEqual({ 'scene.transform': tr(3), 'scene.walls': 'off', 'scene.dropFloaters': 5 });
        expect(store.visitOf(B)).toEqual({});
    });

    it('control: the session layer leaks one scene\'s value into every scene (why the layer exists)', () => {
        const { store } = mk();
        store.setSession('scene.transform', tr(3));
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(3));
        expect(store.get('scene.transform', { scene: B })).toEqual(tr(3)); // the next scene on N would fly at x3 too
    });

    it('is never stored or exported', () => {
        const { store, backend } = mk();
        store.setVisit(A, 'scene.transform', tr(3));
        store.setVisit(A, 'scene.walls', 'off');
        store.flush();
        expect(store.isExplicit('scene.transform', { scene: A })).toBe(false);
        expect(store.explicitList()).toEqual([]);
        expect(JSON.stringify(store.exportFile().settings)).not.toContain(A);
        expect(backend.read() ?? '').not.toContain(A);
        // control: a pilot's own set is stored and listed
        store.set('scene.dropFloaters', 7, { scene: A });
        store.flush();
        expect(store.explicitList({ scene: A }).map((e) => e.id)).toEqual(['scene.dropFloaters']);
        expect(backend.read() ?? '').toContain(A);
    });

    it('the session layer (URL, test hook) still wins over it; the stored value is under it', () => {
        const { store } = mk();
        store.set('scene.walls', 'on');
        store.setVisit(A, 'scene.walls', 'off');
        expect(store.get('scene.walls', { scene: A })).toBe('off');
        store.setSession('scene.walls', 'on');
        expect(store.get('scene.walls', { scene: A })).toBe('on');
        store.clearSession('scene.walls');
        expect(store.get('scene.walls', { scene: A })).toBe('off');
    });

    it('refuses what the setting refuses, and says nothing was set', () => {
        const { store, seen } = mk();
        expect(store.setVisit(A, 'scene.walls', 'sideways')).toEqual({ ok: false, reason: 'option' });
        expect(store.setVisit(A, 'scene.dropFloaters', 'many')).toMatchObject({ ok: false });
        expect(store.setVisit(A, 'no.such.setting', 1)).toEqual({ ok: false, reason: 'unknown-id' });
        expect(store.setVisit('__proto__', 'scene.walls', 'off')).toEqual({ ok: false, reason: 'no-context' });
        expect(store.visitOf(A)).toEqual({});
        expect(seen).toEqual([]);
        // a number beyond the range is clamped, as any write is (not refused, not passed on unchecked)
        expect(store.setVisit(A, 'scene.dropFloaters', 500)).toMatchObject({ ok: true, clamped: true, value: 64 });
    });

    it('announces its changes as source "session" with the previous value, for the features that follow the store', () => {
        const { store, seen } = mk();
        store.set('scene.transform', tr(2), { scene: A });
        seen.length = 0;
        store.setVisit(A, 'scene.transform', tr(3));
        expect(seen).toEqual([{ id: 'scene.transform', scope: 'scene', key: A, value: tr(3), previous: tr(2), source: 'session' }]);
        seen.length = 0;
        store.setVisit(A, 'scene.walls', 'off');
        expect(seen).toEqual([{ id: 'scene.walls', scope: 'global', key: null, value: 'off', previous: 'on', source: 'session' }]);
        seen.length = 0;
        store.clearVisit(A, 'scene.transform');
        expect(seen).toEqual([{ id: 'scene.transform', scope: 'scene', key: A, value: tr(2), previous: tr(3), source: 'session' }]);
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(2)); // the pilot's own again
        expect(store.get('scene.walls', { scene: A })).toBe('off'); // the rest stays
        seen.length = 0;
        store.clearVisit(A);
        expect(seen.map((c) => [c.id, c.value])).toEqual([['scene.walls', 'on']]);
        store.clearVisit(A); // nothing left: silent
        expect(seen).toHaveLength(1);
    });

    it('the pilot\'s own write or reset of the setting takes its entry out; the rest of the layer stays', () => {
        const { store } = mk();
        store.setVisit(A, 'scene.transform', tr(3));
        store.setVisit(A, 'scene.dropFloaters', 5);
        store.set('scene.transform', tr(1.5), { scene: A }); // pressed [ ] or moved the slider
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(1.5));
        expect(store.visitOf(A)).toEqual({ 'scene.dropFloaters': 5 });
        store.reset('scene.dropFloaters', { scene: A });
        expect(store.visitOf(A)).toEqual({});
        expect(store.get('scene.dropFloaters', { scene: A })).toBe(0);
        // a global setting written by the pilot leaves the layer of every scene
        store.setVisit(A, 'scene.walls', 'off');
        store.setVisit(B, 'scene.walls', 'off');
        store.set('scene.walls', 'on'); // pressed C
        expect(store.visitOf(A)).toEqual({});
        expect(store.visitOf(B)).toEqual({});
        expect(store.get('scene.walls', { scene: A })).toBe('on');
    });

    it('control: another tab\'s change (a storage event) is not the pilot\'s own write here and leaves the layer alone', () => {
        const backend = new MemoryBackend();
        const here = new PrefsStore(SCHEMA, backend, resolver(), { now: clock, debounceMs: 0 });
        const tab = new PrefsStore(SCHEMA, backend.tab(), resolver(), { now: clock, debounceMs: 0 });
        here.setVisit(A, 'scene.walls', 'off');
        tab.set('scene.walls', 'on');
        tab.set('scene.transform', tr(2), { scene: A });
        tab.flush();
        expect(here.get('scene.transform', { scene: A })).toEqual(tr(2)); // the other tab's value arrived
        expect(here.get('scene.walls', { scene: A })).toBe('off'); // this visit's value still shadows its stored one
        expect(here.visitOf(A)).toEqual({ 'scene.walls': 'off' });
        here.dispose();
        tab.dispose();
    });

    it('keepVisit stores each item as the pilot\'s own and empties the layer', () => {
        const { store, backend, seen } = mk();
        store.setVisit(A, 'scene.transform', tr(3));
        store.setVisit(A, 'scene.walls', 'off');
        store.setVisit(A, 'wind.mode', 'custom');
        store.setVisit(A, 'wind.speed', 9);
        seen.length = 0;
        const kept = store.keepVisit(A);
        expect(kept).toEqual(['scene.transform', 'scene.walls', 'wind.mode', 'wind.speed']);
        expect(store.visitOf(A)).toEqual({});
        expect(store.isExplicit('scene.transform', { scene: A })).toBe(true);
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(3));
        expect(store.get('scene.walls')).toBe('off'); // the walls switch is one choice for every scan
        expect(store.get('wind.speed', { scene: A })).toBe(9);
        expect(store.get('scene.transform', { scene: B })).toEqual(tr(4)); // another scene: its default, untouched
        store.flush();
        expect(backend.read() ?? '').toContain('"scene.transform"');
        expect(seen.every((c) => c.source === 'user' || c.source === 'session')).toBe(true);
        expect(store.keepVisit(A)).toEqual([]);
    });

    it('resetAll clears it too', () => {
        const { store } = mk();
        store.setVisit(A, 'scene.transform', tr(3));
        store.resetAll();
        expect(store.visitOf(A)).toEqual({});
        expect(store.get('scene.transform', { scene: A })).toEqual(tr(1));
    });
});
