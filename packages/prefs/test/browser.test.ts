// browser.ts with fake page objects (Node has no localStorage, cookies or storage events).
// IndexedDB is checked in real Chrome by the wave-1 browser probe, not here.
import { describe, expect, it } from 'vitest';
import { CookieValue, LocalStorageBackend, PREFS_KEY, flushOnHide, localStorageLegacy, requestPersistence } from '../src';
import { FakeStorage, mkStore } from './helpers';

class FakeTarget {
    private readonly h = new Map<string, Set<(e: Event) => void>>();
    visibilityState: DocumentVisibilityState = 'visible';
    addEventListener(type: string, cb: (e: Event) => void) {
        (this.h.get(type) ?? this.h.set(type, new Set()).get(type)!).add(cb);
    }
    removeEventListener(type: string, cb: (e: Event) => void) {
        this.h.get(type)?.delete(cb);
    }
    fire(type: string, e: Partial<StorageEvent> = {}) {
        for (const cb of this.h.get(type) ?? []) cb(e as Event);
    }
    count(type: string) {
        return this.h.get(type)?.size ?? 0;
    }
}

describe('LocalStorageBackend', () => {
    it('reads and writes one key', () => {
        const ls = new FakeStorage();
        const b = new LocalStorageBackend(PREFS_KEY, ls as unknown as Storage, null);
        expect(b.read()).toBeNull();
        expect(b.write('{"a":1}')).toBe(true);
        expect(ls.getItem('gsfpv.prefs.v1')).toBe('{"a":1}');
    });

    it('blocked storage (no storage, or a throwing one) reads null and refuses writes; the store says so', () => {
        const none = new LocalStorageBackend(PREFS_KEY, null, null);
        expect(none.write('x')).toBe(false);
        const quota = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } } as unknown as Storage;
        const b = new LocalStorageBackend(PREFS_KEY, quota, null);
        expect(b.read()).toBeNull();
        expect(b.write('x')).toBe(false);
        const s = mkStore(b);
        expect(s.writable).toBe(false);
        s.set('flight.mode', 'acro');
        expect(s.get('flight.mode')).toBe('acro');
    });

    it('the storage event of its key (or a clear) reaches onExternal; other keys do not', () => {
        const win = new FakeTarget();
        const b = new LocalStorageBackend(PREFS_KEY, new FakeStorage() as unknown as Storage, win);
        let n = 0;
        const off = b.onExternal(() => n++);
        win.fire('storage', { key: PREFS_KEY });
        win.fire('storage', { key: 'gsfpv.profiles.v1' });
        win.fire('storage', { key: null });
        expect(n).toBe(2);
        off();
        expect(win.count('storage')).toBe(0);
    });

    it('a store on it picks up another tab\'s write through the event', () => {
        const ls = new FakeStorage();
        const win = new FakeTarget();
        const a = mkStore(new LocalStorageBackend(PREFS_KEY, ls as unknown as Storage, null));
        const b = mkStore(new LocalStorageBackend(PREFS_KEY, ls as unknown as Storage, win));
        a.set('respawn.rewindS', 9);
        expect(b.get('respawn.rewindS')).toBe(5);
        win.fire('storage', { key: PREFS_KEY });
        expect(b.get('respawn.rewindS')).toBe(9);
    });
});

describe('localStorageLegacy', () => {
    it('reads and never writes', () => {
        const ls = new FakeStorage({ 'gsfpv.warned': '1' });
        const read = localStorageLegacy(ls as unknown as Storage);
        expect(read('gsfpv.warned')).toBe('1');
        expect(read('gsfpv.nothing')).toBeNull();
        expect(ls.writes).toEqual([]);
        expect(localStorageLegacy(null)('gsfpv.warned')).toBeNull();
    });
});

describe('CookieValue (NEXT_LOCALE)', () => {
    it('writes what v0.2 setLocale and the landing write, reads it back, deletes it', () => {
        const jar = { set: [] as string[], value: '' };
        const doc = {
            get cookie() { return jar.value; },
            set cookie(v: string) {
                jar.set.push(v);
                const [pair, ...attrs] = v.split(';');
                const [k, val] = pair.split('=');
                const rest = jar.value.split('; ').filter((p) => p && !p.startsWith(`${k}=`));
                jar.value = (attrs.some((a) => a.trim() === 'max-age=0') ? rest : [...rest, `${k}=${val}`]).join('; ');
            }
        };
        const c = new CookieValue('NEXT_LOCALE', { doc, allowed: ['en', 'es', 'pl', 'ru'] });
        jar.value = 'gsfpv_consent=yes; NEXT_LOCALE=es';
        expect(c.read()).toBe('es');
        expect(c.write('pl')).toBe(true);
        expect(jar.set[0]).toBe('NEXT_LOCALE=pl; path=/; max-age=31536000; samesite=lax');
        expect(c.read()).toBe('pl');
        expect(c.write(null)).toBe(true);
        expect(c.read()).toBeNull();
        expect(jar.value).toBe('gsfpv_consent=yes');
        jar.value = 'NEXT_LOCALE=de';
        expect(c.read()).toBeNull(); // not one of ours
    });

    it('no document (Node, a worker): reads null, refuses writes', () => {
        const c = new CookieValue('NEXT_LOCALE', { doc: null });
        expect(c.read()).toBeNull();
        expect(c.write('en')).toBe(false);
    });
});

describe('requestPersistence (A.5)', () => {
    it('asks once, at the first user change, never for session or external ones', async () => {
        const s = mkStore();
        let asked = 0;
        const off = await requestPersistence(s, { persisted: async () => false, persist: async () => { asked++; return true; } });
        expect(s.persisted).toBe('no');
        s.setSession('flight.mode', 'acro');
        expect(asked).toBe(0);
        s.set('flight.mode', 'horizon');
        s.set('flight.mode', 'acro');
        await Promise.resolve();
        await Promise.resolve();
        expect(asked).toBe(1);
        expect(s.persisted).toBe('yes');
        off();
    });

    it('already persisted: no request; no StorageManager: unknown', async () => {
        const s = mkStore();
        let asked = 0;
        await requestPersistence(s, { persisted: async () => true, persist: async () => { asked++; return true; } });
        s.set('flight.mode', 'acro');
        expect(asked).toBe(0);
        expect(s.persisted).toBe('yes');
        const t = mkStore();
        await requestPersistence(t, null);
        expect(t.persisted).toBe('unknown');
    });
});

describe('flushOnHide', () => {
    it('a hidden tab or pagehide writes pending changes at once', () => {
        const ls = new FakeStorage();
        const s = mkStore(new LocalStorageBackend(PREFS_KEY, ls as unknown as Storage, null), { debounceMs: 60000 });
        const win = new FakeTarget();
        const doc = new FakeTarget();
        const off = flushOnHide(s, win, doc as unknown as Document);
        s.set('flight.mode', 'acro');
        expect(JSON.parse(ls.getItem(PREFS_KEY)!).settings.global['flight.mode']).toBeUndefined();
        doc.fire('visibilitychange'); // still visible: nothing
        expect(JSON.parse(ls.getItem(PREFS_KEY)!).settings.global['flight.mode']).toBeUndefined();
        doc.visibilityState = 'hidden';
        doc.fire('visibilitychange');
        expect(JSON.parse(ls.getItem(PREFS_KEY)!).settings.global['flight.mode']).toBe('acro');
        s.set('flight.mode', 'horizon');
        win.fire('pagehide');
        expect(JSON.parse(ls.getItem(PREFS_KEY)!).settings.global['flight.mode']).toBe('horizon');
        off();
        expect(win.count('pagehide') + doc.count('visibilitychange')).toBe(0);
    });
});
