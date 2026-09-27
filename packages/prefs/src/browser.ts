// The page side of prefs (A.1, A.5): localStorage for the document, the NEXT_LOCALE cookie for the
// language, navigator.storage.persist(), and IndexedDB for what is too big or not JSON (flight
// logs, the recording folder handle). The only file of @gsfpv/prefs allowed to touch the DOM
// (architecture rule 1.4). Every access is guarded: private windows and blocked storage throw.

import { PREFS_KEY } from './doc';
import { LEGACY_KEYS, parseLegacyLastLog } from './migrate';
import { PrefsStore } from './store';
import type { Backend, StoreOptions, ValueBackend } from './store';
import type { PresetResolver, Schema } from './schema';

type Listen = Pick<Window, 'addEventListener' | 'removeEventListener'>;

function defaultStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null; // Firefox with storage blocked throws on the property itself
    }
}

function defaultWindow(): Listen | null {
    return typeof window === 'undefined' ? null : window;
}

/** The document in one localStorage key; another tab's write arrives through the storage event. */
export class LocalStorageBackend implements Backend {
    constructor(readonly key: string = PREFS_KEY, private readonly storage: Storage | null = defaultStorage(), private readonly win: Listen | null = defaultWindow()) {}

    read(): string | null {
        try {
            return this.storage?.getItem(this.key) ?? null;
        } catch {
            return null;
        }
    }

    write(text: string): boolean {
        if (!this.storage) return false;
        try {
            this.storage.setItem(this.key, text);
            return true;
        } catch {
            return false; // quota, private mode
        }
    }

    onExternal(cb: () => void): () => void {
        const win = this.win;
        if (!win) return () => {};
        // key null: another tab cleared the whole storage
        const h = (e: Event) => {
            const k = (e as StorageEvent).key;
            if (k === this.key || k === null) cb();
        };
        win.addEventListener('storage', h);
        return () => win.removeEventListener('storage', h);
    }
}

/** Read-only access to the v0.2 keys for the first-boot migration; it never writes or removes. */
export function localStorageLegacy(storage: Storage | null = defaultStorage()): (key: string) => string | null {
    return (key) => {
        try {
            return storage?.getItem(key) ?? null;
        } catch {
            return null;
        }
    };
}

/** One cookie as a setting's storage. The landing reads NEXT_LOCALE, so the format is the one it writes. */
export class CookieValue implements ValueBackend {
    constructor(readonly name: string, private readonly o: { doc?: { cookie: string } | null; allowed?: readonly string[]; maxAgeS?: number } = {}) {}

    private get doc(): { cookie: string } | null {
        if (this.o.doc !== undefined) return this.o.doc;
        return typeof document === 'undefined' ? null : document;
    }

    read(): string | null {
        try {
            const c = this.doc?.cookie ?? '';
            for (const part of c.split(';')) {
                const i = part.indexOf('=');
                if (i < 0 || part.slice(0, i).trim() !== this.name) continue;
                const v = decodeURIComponent(part.slice(i + 1).trim());
                return !v || (this.o.allowed && !this.o.allowed.includes(v)) ? null : v;
            }
        } catch {
            /* cookies disabled */
        }
        return null;
    }

    write(v: string | null): boolean {
        const d = this.doc;
        if (!d) return false;
        try {
            d.cookie = v === null ? `${this.name}=; path=/; max-age=0; samesite=lax` : `${this.name}=${encodeURIComponent(v)}; path=/; max-age=${this.o.maxAgeS ?? 31536000}; samesite=lax`;
        } catch {
            return false;
        }
        return this.read() === v;
    }
}

type StorageManagerLike = Pick<StorageManager, 'persisted' | 'persist'>;

function defaultStorageManager(): StorageManagerLike | null {
    try {
        return typeof navigator === 'undefined' ? null : (navigator.storage ?? null);
    } catch {
        return null;
    }
}

/**
 * Fills store.persisted and asks for persistent storage at the pilot's first explicit change:
 * that change runs inside the click that made it, which Firefox needs for its prompt (A.5).
 * Returns an unsubscribe.
 */
export async function requestPersistence(store: PrefsStore, sm: StorageManagerLike | null = defaultStorageManager()): Promise<() => void> {
    if (!sm?.persisted || !sm.persist) {
        store.persisted = 'unknown';
        return () => {};
    }
    try {
        store.persisted = (await sm.persisted()) ? 'yes' : 'no';
    } catch {
        store.persisted = 'unknown';
    }
    if (store.persisted === 'yes') return () => {};
    const off = store.onChange((c) => {
        if (c.source !== 'user') return;
        off();
        sm.persist().then((ok) => { store.persisted = ok ? 'yes' : 'no'; }, () => { /* keep the last known state */ });
    });
    return off;
}

/** Writes pending changes when the page goes away or the tab is hidden (Andrii switches windows often). */
export function flushOnHide(store: PrefsStore, win: Listen | null = defaultWindow(), doc: (Pick<Document, 'visibilityState'> & Listen) | null = typeof document === 'undefined' ? null : document): () => void {
    const hide = () => store.flush();
    const vis = () => { if (doc?.visibilityState === 'hidden') store.flush(); };
    win?.addEventListener('pagehide', hide);
    doc?.addEventListener('visibilitychange', vis);
    return () => {
        win?.removeEventListener('pagehide', hide);
        doc?.removeEventListener('visibilitychange', vis);
    };
}

// ------------------------------------------------------------------ IndexedDB

export type IdbStoreName = 'handles' | 'logs' | 'blobs';
export const IDB_NAME = 'gsfpv';
/** handles: the recording folder; logs: saved flight logs; blobs: reserved (A.5) */
export const IDB_STORES: readonly IdbStoreName[] = ['handles', 'logs', 'blobs'];

/** A small promise wrapper over the `gsfpv` database: one key-value store per name. */
export class IdbKv {
    private constructor(private readonly db: IDBDatabase) {}

    static open(o: { name?: string; factory?: IDBFactory | null } = {}): Promise<IdbKv> {
        let f: IDBFactory | null = null;
        try {
            f = o.factory !== undefined ? o.factory : (globalThis.indexedDB ?? null);
        } catch {
            f = null;
        }
        if (!f) return Promise.reject(new Error('IndexedDB is not available'));
        const factory = f;
        return new Promise((resolve, reject) => {
            const req = factory.open(o.name ?? IDB_NAME, 1);
            req.onupgradeneeded = () => {
                for (const s of IDB_STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
            };
            req.onsuccess = () => resolve(new IdbKv(req.result));
            req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        });
    }

    /** Resolves when the transaction commits, so a put is on disk before the caller moves on. */
    private run<T>(store: IdbStoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const t = this.db.transaction(store, mode);
            const r = fn(t.objectStore(store));
            t.oncomplete = () => resolve(r.result);
            t.onerror = () => reject(t.error ?? r.error ?? new Error('IndexedDB request failed'));
            t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    get<T = unknown>(store: IdbStoreName, key: string): Promise<T | undefined> {
        return this.run(store, 'readonly', (s) => s.get(key)) as Promise<T | undefined>;
    }

    put(store: IdbStoreName, key: string, value: unknown): Promise<void> {
        return this.run(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
    }

    delete(store: IdbStoreName, key: string): Promise<void> {
        return this.run(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
    }

    keys(store: IdbStoreName): Promise<string[]> {
        return this.run(store, 'readonly', (s) => s.getAllKeys()).then((ks) => ks.map(String));
    }

    close(): void {
        this.db.close();
    }
}

/** The key v0.2's single saved log gets in the `logs` store. */
export const LEGACY_LOG_KEY = 'legacy-lastLog';

/**
 * Copies v0.2's saved flight log (the `gsfpv.lastLog` key) into IndexedDB once, unchanged. The
 * key itself stays for one release, like every legacy key. true when it copied.
 */
export async function migrateLastLog(kv: IdbKv, read: (key: string) => string | null): Promise<boolean> {
    let text: string | null = null;
    try {
        text = read(LEGACY_KEYS.lastLog);
    } catch {
        text = null;
    }
    const log = parseLegacyLastLog(text);
    if (!log || (await kv.get('logs', LEGACY_LOG_KEY)) !== undefined) return false;
    await kv.put('logs', LEGACY_LOG_KEY, log);
    return true;
}

export interface BrowserPrefs { store: PrefsStore; dispose(): void }

/**
 * The page's store in one call: the document in localStorage (v0.2 keys migrated on the first
 * boot), the language in its cookie, writes flushed when the tab hides, persistence asked for at
 * the first change, and the v0.2 flight log copied to IndexedDB in the background.
 */
export function openBrowserPrefs(schema: Schema, presets: PresetResolver, o: StoreOptions = {}): BrowserPrefs {
    const storage = defaultStorage();
    const legacy = localStorageLegacy(storage);
    let origin = '';
    try {
        origin = globalThis.location?.origin ?? '';
    } catch {
        origin = '';
    }
    const external: Record<string, ValueBackend> = schema.byId.has('ui.language') ? { 'ui.language': new CookieValue('NEXT_LOCALE', { allowed: ['en', 'es', 'pl', 'ru'] }) } : {};
    const store = new PrefsStore(schema, new LocalStorageBackend(PREFS_KEY, storage), presets, { legacy, external, origin, ...o });
    const offHide = flushOnHide(store);
    let offPersist: () => void = () => {};
    void requestPersistence(store).then((off) => { offPersist = off; });
    void IdbKv.open().then((kv) => migrateLastLog(kv, legacy).finally(() => kv.close())).catch(() => { /* no IndexedDB: the log stays in its v0.2 key */ });
    return {
        store,
        dispose: () => {
            offHide();
            offPersist();
            store.dispose();
        }
    };
}
