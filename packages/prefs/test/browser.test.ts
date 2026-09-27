// browser.ts with fake page objects (Node has no localStorage, cookies or storage events).
// IndexedDB is checked in real Chrome by the wave-1 browser probe, not here.
import { describe, expect, it } from 'vitest';
import { CookieValue, LEGACY_LOG_KEY, LocalStorageBackend, PREFS_KEY, SCHEMA, flushOnHide, localStorageLegacy, migrateLastLog, openBrowserPrefs, requestPersistence } from '../src';
import { FakeStorage, mkStore, resolver } from './helpers';

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

/**
 * The prefs review (prefsReview.mustFix[3]): gsfpv.lastLog was copied to IndexedDB on every boot
 * whenever the copy was absent, and the legacy key stays for one release by design, so a log the
 * pilot erased (A.9 "Erase everything", or the 50 MB cap dropping the oldest) came back.
 */
describe('the v0.2 flight log moves to IndexedDB on the first v0.3 boot only (review must-fix 4)', () => {
    const LOG = { label: 'crash 12:04', header: { format: 'gsfpv-input-log/1', preset: 'pavo20pro-3s' }, endTick: 30211, hash: '9f0c', b64: 'AAAAAAAAgD8=' };
    class MapKv {
        readonly m = new Map<string, unknown>();
        opened = 0;
        closed = 0;
        async get<T>(store: string, key: string): Promise<T | undefined> { return this.m.get(`${store}/${key}`) as T | undefined; }
        async put(store: string, key: string, v: unknown): Promise<void> { this.m.set(`${store}/${key}`, v); }
        async delete(store: string, key: string): Promise<void> { this.m.delete(`${store}/${key}`); }
        close(): void { this.closed++; }
    }
    const boot = (ls: FakeStorage, kv: MapKv) => openBrowserPrefs(SCHEMA, resolver(), {
        storage: ls as unknown as Storage, win: null, doc: null, cookieDoc: null, storageManager: null, debounceMs: 0,
        openKv: async () => { kv.opened++; return kv; }
    });

    it('the first boot copies it; after the pilot erases it, the next boot does not bring it back', async () => {
        const ls = new FakeStorage({ 'gsfpv.lastLog': JSON.stringify(LOG), 'gsfpv.warned': '1' });
        const kv = new MapKv();
        const first = boot(ls, kv);
        expect(first.store.migrated?.from).toBe(0);
        expect(await first.legacyLog).toBe(true);
        expect(kv.m.get(`logs/${LEGACY_LOG_KEY}`)).toEqual(LOG);
        first.dispose();
        await kv.delete('logs', LEGACY_LOG_KEY); // the pilot erases the logs
        const second = boot(ls, kv);
        expect(second.store.migrated).toBeNull();
        expect(await second.legacyLog).toBe(false);
        expect(kv.m.has(`logs/${LEGACY_LOG_KEY}`)).toBe(false);
        expect(ls.getItem('gsfpv.lastLog')).toBe(JSON.stringify(LOG)); // the legacy key stays for one release
        second.dispose();
    });

    it('control: the copy itself still restores an erased log, so the second boot above holds back on purpose', async () => {
        const ls = new FakeStorage({ 'gsfpv.lastLog': JSON.stringify(LOG) });
        const kv = new MapKv();
        await boot(ls, kv).legacyLog;
        await kv.delete('logs', LEGACY_LOG_KEY);
        expect(await migrateLastLog(kv, localStorageLegacy(ls as unknown as Storage))).toBe(true);
        expect(kv.m.get(`logs/${LEGACY_LOG_KEY}`)).toEqual(LOG);
    });

    it('no IndexedDB: nothing moves, the store still boots', async () => {
        const ls = new FakeStorage({ 'gsfpv.lastLog': JSON.stringify(LOG) });
        const p = openBrowserPrefs(SCHEMA, resolver(), { storage: ls as unknown as Storage, win: null, doc: null, cookieDoc: null, storageManager: null, openKv: () => Promise.reject(new Error('blocked')) });
        expect(await p.legacyLog).toBe(false);
        expect(p.store.writable).toBe(true);
        p.dispose();
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
