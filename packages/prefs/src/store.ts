// PrefsStore (A.3, A.5, A.6): the one place a value the pilot can change is read from and written
// to. No DOM here (architecture rule 1.4): storage arrives as a Backend, so the same store runs in
// the page (browser.ts LocalStorageBackend), in Node tests and in the catalogue generator.
//
// Where a value comes from: the session layer (URL, test hook) ?? the stored entry of the def's
// scope (global, drone[ctx.drone], scene[ctx.scene]) ?? the default (a literal, the drone preset's
// field, the admin's value for the scan in showcase.json, or a scene's curated scale). ctx.drone
// defaults to the drone flown now (drone.current). A def with `persist: false` lives in the
// session layer only (this page load).

import { boundsOf, canonicalJson, checkValue, isCuratedRef, isPresetRef, presetValue, SCHEMA_VERSION } from './schema';
import type { GroupId, PresetResolver, Schema, Scope, SettingDef } from './schema';
import { COLLECTION_IDS, PREFS_APP_VERSION, clone, defaultCollection, emptyDoc, isReservedKey, normalizeDoc, parseDocInput, validateCollection } from './doc';
import type { CollectionId, Collections, PrefsDoc, PrefsFile } from './doc';
import { migrateLegacy, runMigrations } from './migrate';
import type { MigrationNote } from './migrate';
import { entriesOf, entryAt, planImport, putEntry } from './io';
import type { ImportMode, ImportReport } from './io';

export interface Ctx { drone?: string; scene?: string }
export interface Backend { read(): string | null; write(text: string): boolean; onExternal?(cb: () => void): () => void }
/**
 * One setting kept outside the document (ui.language: the NEXT_LOCALE cookie the landing reads).
 * It holds only non-default values: setting the default removes it, so the landing never sees a
 * value it does not know.
 */
export interface ValueBackend { read(): string | null; write(v: string | null): boolean }
export type ChangeSource = 'user' | 'import' | 'reset' | 'migration' | 'external' | 'session';
/**
 * value: what that scope and key now hold (the default after a reset). Collections report as id
 * `collection.<name>` with the whole collection as value.
 */
export interface PrefChange { id: string; scope: Scope; key: string | null; value: unknown; previous: unknown; source: ChangeSource }
export type SetResult = { ok: true; value: unknown; clamped: boolean } | { ok: false; reason: 'unknown-id' | 'type' | 'range' | 'option' | 'no-context' };

export interface StoreOptions {
    now?: () => number;
    /** writes wait this long and go out together (A.5: 250 ms); 0 writes at once */
    debounceMs?: number;
    /** the app version written into the document */
    app?: string;
    /** written into export files (the page passes its origin) */
    origin?: string;
    /** read-only access to the keys written before v0.3, for the first-boot migration */
    legacy?: (key: string) => string | null;
    /** the storage's key names, for the per-scan legacy keys (migrate.ts LEGACY_PREFIXES) */
    legacyKeys?: () => readonly string[];
    /** settings that live outside the document, by id */
    external?: Readonly<Record<string, ValueBackend>>;
}

export interface MigrationInfo extends MigrationNote { from: number; found: string[] }

/** In-memory storage. tab() opens a second view on the same text: a write through one view
 * reaches the other's onExternal, like the storage event between two browser tabs. */
export class MemoryBackend implements Backend {
    private readonly listeners = new Set<() => void>();
    private readonly box: { text: string | null; tabs: MemoryBackend[] };

    constructor(text: string | null = null, box?: { text: string | null; tabs: MemoryBackend[] }) {
        this.box = box ?? { text, tabs: [] };
        this.box.tabs.push(this);
    }
    tab(): MemoryBackend {
        return new MemoryBackend(null, this.box);
    }
    read(): string | null {
        return this.box.text;
    }
    write(text: string): boolean {
        this.box.text = text;
        for (const t of this.box.tabs) if (t !== this) for (const cb of [...t.listeners]) cb();
        return true;
    }
    onExternal(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
}

const slot = (scope: Scope, key: string | null, id: string) => JSON.stringify([scope, key, id]);

export class PrefsStore {
    readonly schema: Schema;
    /** navigator.storage.persisted(), filled in by browser.ts requestPersistence */
    persisted: 'yes' | 'no' | 'unknown' = 'unknown';
    /** what the first-boot migration did, or null when the document already existed */
    readonly migrated: MigrationInfo | null = null;

    private doc: PrefsDoc;
    private readonly backend: Backend;
    private readonly presets: PresetResolver;
    private readonly now: () => number;
    private readonly debounceMs: number;
    private readonly app: string;
    private readonly origin: string;
    private readonly external: Readonly<Record<string, ValueBackend>>;
    private readonly session = new Map<string, unknown>();
    /** entries and collection fields this tab changed since its last successful write */
    private readonly dirty = new Set<string>();
    private readonly dirtyCols = new Set<string>();
    private readonly listeners = new Set<(c: PrefChange) => void>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private canWrite = true;
    /** a document written by a newer version: read, never overwritten */
    private readOnly = false;
    /**
     * This tab has seen a stored document (read one, or written one). Until it has, "nothing
     * stored" means our document never reached storage (full or blocked at the first boot), not
     * that another tab erased everything: the tab's own view is then the base of the next write.
     */
    private seenStored = false;
    private unExternal: (() => void) | null = null;

    constructor(schema: Schema, backend: Backend, presets: PresetResolver, o: StoreOptions = {}) {
        this.schema = schema;
        this.backend = backend;
        this.presets = presets;
        this.now = o.now ?? (() => Date.now());
        this.debounceMs = o.debounceMs ?? 250;
        this.app = o.app ?? PREFS_APP_VERSION;
        this.origin = o.origin ?? '';
        this.external = o.external ?? {};

        const text = this.safeRead();
        this.seenStored = text !== null;
        let writeNow = false;
        if (text === null) {
            // first boot of v0.3 (or a first visit): v0.2's keys become the document, once
            if (o.legacy) {
                const m = migrateLegacy(o.legacy, { app: this.app, savedAt: this.iso() }, o.legacyKeys);
                this.doc = m.doc;
                this.migrated = { from: 0, found: m.found, moved: m.note.moved, ignored: m.note.ignored };
            } else this.doc = emptyDoc(this.app, this.iso());
            writeNow = true;
        } else {
            const p = parseDocInput(text);
            if (p.ok) {
                if (p.version < SCHEMA_VERSION) {
                    const note: MigrationNote = { moved: [], ignored: [] };
                    this.doc = runMigrations(p.raw, p.version, { app: this.app }, note);
                    this.migrated = { from: p.version, found: [], ...note };
                    writeNow = true;
                } else this.doc = normalizeDoc(p.raw, this.app);
            } else if (p.error === 'newer-version') {
                // best effort read; writing would destroy what the newer version stored
                this.doc = normalizeDoc(JSON.parse(text) as Record<string, unknown>, this.app);
                this.readOnly = true;
                this.canWrite = false;
            } else {
                // unreadable: start clean; it is replaced at the first change, not at boot
                this.doc = emptyDoc(this.app, this.iso());
            }
        }
        // the first write doubles as the storage probe: blocked storage shows its banner at boot
        if (writeNow) this.writeDoc(this.doc);
        this.unExternal = backend.onExternal?.(() => this.reloadExternal()) ?? null;
    }

    /** false: private mode, blocked or full storage, or a newer version's document; changes live in memory */
    get writable(): boolean {
        return this.canWrite;
    }

    // ------------------------------------------------------------------ reading

    get<T = unknown>(id: string, ctx?: Ctx): T {
        const def = this.def(id);
        if (this.session.has(id)) return clone(this.session.get(id)) as T;
        const s = this.stored(def, ctx);
        return (s.has ? s.value : this.defaultOf(id, ctx)) as T;
    }

    defaultOf<T = unknown>(id: string, ctx?: Ctx): T {
        const def = this.def(id);
        if (isCuratedRef(def.default)) {
            // the admin's value for this scan (showcase.json) when it is a valid one, else the fallback
            const scene = ctx?.scene;
            const raw = scene !== undefined && !isReservedKey(scene) ? this.presets.curated?.(scene, def.default.curated) : undefined;
            const c = raw === undefined ? null : checkValue(def, raw, def.type === 'number' ? boundsOf(def, this.presets, this.droneOf(ctx)) : undefined);
            return clone(c?.ok ? c.value : def.default.fallback) as T;
        }
        if (def.type === 'json' && def.kind === 'transform') {
            // a scene's default size is the admin's curated scale (E.2), else 1
            const s = ctx?.scene !== undefined ? this.presets.curatedScale?.(ctx.scene) : undefined;
            return def.validate({ s: s ?? 1, t: [0, 0, 0], v: 0 }) as T;
        }
        if (def.type === 'number' && isPresetRef(def.default)) {
            const drone = this.droneOf(ctx);
            const v = presetValue(def.default, this.presets, drone) ?? def.default.fallback ?? 0;
            const b = boundsOf(def, this.presets, drone);
            return (v < b.min ? b.min : v > b.max ? b.max : v) as T;
        }
        return clone(def.default) as T;
    }

    isExplicit(id: string, ctx?: Ctx): boolean {
        return this.stored(this.def(id), ctx).has;
    }

    explicitList(ctx?: Ctx): { id: string; scope: Scope; key: string | null; value: unknown }[] {
        const drone = ctx ? this.droneOf(ctx) : undefined;
        const out: { id: string; scope: Scope; key: string | null; value: unknown }[] = [];
        for (const def of this.schema.defs) {
            if (def.scope === 'global') {
                const s = this.stored(def);
                if (s.has) out.push({ id: def.id, scope: 'global', key: null, value: s.value });
                continue;
            }
            const keys = def.scope === 'drone' ? (ctx ? (drone === undefined ? [] : [drone]) : Object.keys(this.doc.settings.drone)) : ctx ? (ctx.scene === undefined ? [] : [ctx.scene]) : Object.keys(this.doc.settings.scene);
            for (const key of keys) {
                const s = this.stored(def, def.scope === 'drone' ? { drone: key } : { scene: key });
                if (s.has) out.push({ id: def.id, scope: def.scope, key, value: s.value });
            }
        }
        const rank = { global: 0, drone: 1, scene: 2 };
        return out.sort((a, b) => rank[a.scope] - rank[b.scope] || (a.key ?? '').localeCompare(b.key ?? '') || a.id.localeCompare(b.id));
    }

    collection<K extends CollectionId>(k: K): Readonly<Collections[K]> {
        return clone(this.doc.collections[k]);
    }

    // ------------------------------------------------------------------ writing

    /** Stores explicitly, even a value equal to the default (A.6): a later default change does not reach it. */
    set(id: string, value: unknown, ctx?: Ctx): SetResult {
        return this.write(id, value, ctx, 'user');
    }

    reset(id: string, ctx?: Ctx): void {
        const def = this.def(id);
        this.remove(def, ctx, 'reset');
    }

    resetGroup(group: GroupId, ctx?: Ctx): void {
        // The context is resolved once, before the loop (review finding C2): group 'drone' starts
        // with drone.current, so resolving it per def would aim the drone's own rows at the default
        // drone once drone.current is reset, and wipe that drone's values instead of this one's.
        const c: Ctx = { drone: this.droneOf(ctx), scene: ctx?.scene };
        for (const def of this.schema.defs) if (def.group === group) this.remove(def, c, 'reset');
    }

    /** Settings (default) and, when named, collections back to their defaults. Unknown ids (a newer version's) stay. */
    resetAll(o: { settings?: boolean; collections?: readonly CollectionId[] } = {}): void {
        if (o.settings ?? true) {
            for (const e of entriesOf(this.doc.settings)) {
                const def = this.schema.byId.get(e.id);
                if (def) this.remove(def, e.scope === 'drone' ? { drone: e.key ?? undefined } : e.scope === 'scene' ? { scene: e.key ?? undefined } : undefined, 'reset');
            }
            for (const id of Object.keys(this.external)) {
                const def = this.schema.byId.get(id);
                if (def) this.remove(def, undefined, 'reset');
            }
            for (const def of this.schema.defs) if (def.persist === false) this.remove(def, undefined, 'reset');
        }
        for (const k of o.collections ?? []) this.replaceCollection(k, defaultCollection(k), 'reset');
    }

    /** The URL / test layer: wins over stored values, never persisted. */
    setSession(id: string, value: unknown): SetResult {
        const def = this.schema.byId.get(id);
        if (!def) return { ok: false, reason: 'unknown-id' };
        const c = checkValue(def, value, def.type === 'number' ? boundsOf(def, this.presets, this.droneOf()) : undefined);
        if (!c.ok) return c;
        const previous = this.get(id);
        this.session.set(id, c.value);
        this.emit({ id, scope: def.scope, key: null, value: clone(c.value), previous, source: 'session' });
        return c;
    }

    clearSession(id?: string): void {
        for (const k of id === undefined ? [...this.session.keys()] : [id]) {
            if (!this.session.has(k)) continue;
            const previous = this.get(k);
            this.session.delete(k);
            this.emit({ id: k, scope: this.def(k).scope, key: null, value: this.get(k), previous, source: 'session' });
        }
    }

    updateCollection<K extends CollectionId>(k: K, fn: (draft: Collections[K]) => void): void {
        const draft = clone(this.doc.collections[k]);
        fn(draft);
        const v = validateCollection(k, draft);
        if (v) this.replaceCollection(k, v, 'user');
    }

    onChange(cb: (c: PrefChange) => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    // ------------------------------------------------------------------ files

    exportFile(o: { include?: readonly CollectionId[] } = {}): PrefsFile {
        const doc = this.withExternal();
        const include = o.include ?? COLLECTION_IDS;
        const collections: Partial<Collections> = {};
        for (const k of include) (collections as Record<string, unknown>)[k] = clone(doc.collections[k]);
        return { ...doc, collections, exportedAt: this.iso(), origin: this.origin };
    }

    previewImport(file: unknown, mode: ImportMode = 'replace'): ImportReport {
        return planImport(this.withExternal(), file, mode, this.schema, this.presets, this.droneOf(), this.app).report;
    }

    importFile(file: unknown, mode: ImportMode = 'replace'): ImportReport {
        const before = this.withExternal();
        const plan = planImport(before, file, mode, this.schema, this.presets, this.droneOf(), this.app);
        if (!plan.doc) return plan.report;
        const next = plan.doc;
        // settings kept outside the document go back to their own stores
        for (const [id, ext] of Object.entries(this.external)) {
            const v = next.settings.global[id];
            delete next.settings.global[id];
            delete before.settings.global[id];
            const def = this.schema.byId.get(id);
            if (!def) continue;
            const want = v === undefined || canonicalJson(v) === canonicalJson(def.default) ? null : this.encode(v);
            if (ext.read() !== want) {
                const previous = this.valueAt(def);
                ext.write(want);
                this.emit({ id, scope: 'global', key: null, value: this.valueAt(def), previous, source: 'import' });
            }
        }
        for (const e of [...entriesOf(before.settings), ...entriesOf(next.settings)]) {
            if (canonicalJson(entryAt(before.settings, e.scope, e.key, e.id)) !== canonicalJson(entryAt(next.settings, e.scope, e.key, e.id))) this.dirty.add(slot(e.scope, e.key, e.id));
        }
        for (const k of COLLECTION_IDS) this.markCollection(k, before.collections[k], next.collections[k]);
        const prev = this.doc;
        this.doc = next;
        this.emitDiff(prev, next, 'import');
        // an import is one deliberate action: it is written now, not after the debounce
        this.flush();
        return plan.report;
    }

    // ------------------------------------------------------------------ persistence

    /** Writes this tab's changes now (pagehide, tab hidden, import). Another tab's changes in
     * storage are kept: only this tab's dirty entries are applied to a fresh read. */
    flush(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.readOnly || (!this.dirty.size && !this.dirtyCols.size)) return;
        const base = this.readStored();
        if (base === 'newer') return;
        const next = this.replay(base);
        next.savedAt = this.iso();
        next.app = this.app;
        if (this.writeDoc(next)) {
            this.dirty.clear();
            this.dirtyCols.clear();
        }
        const prev = this.doc;
        this.doc = next;
        this.emitDiff(prev, next, 'external');
    }

    /** Stops listening to other tabs and writes what is pending. */
    dispose(): void {
        this.flush();
        this.unExternal?.();
        this.unExternal = null;
    }

    // ------------------------------------------------------------------ internals

    private def(id: string): SettingDef {
        const d = this.schema.byId.get(id);
        // a typo must be loud: a silent default is how settings "come back to defaults" (item 20)
        if (!d) throw new Error(`unknown setting ${id}`);
        return d;
    }

    private iso(): string {
        return new Date(this.now()).toISOString();
    }

    private droneOf(ctx?: Ctx): string | undefined {
        if (ctx?.drone !== undefined) return ctx.drone;
        return this.schema.byId.has('drone.current') ? this.get<string>('drone.current') : undefined;
    }

    /**
     * Where a def's value is stored for ctx; null when a scene setting has no scene, or when the
     * drone or scene id is a reserved key (doc.ts RESERVED_KEYS: '__proto__' as a map key would
     * reach Object.prototype, review must-fix 3).
     */
    private target(def: SettingDef, ctx?: Ctx): { scope: Scope; key: string | null } | null {
        if (def.scope === 'global') return { scope: 'global', key: null };
        if (def.scope === 'drone') {
            const d = this.droneOf(ctx);
            return d === undefined || isReservedKey(d) ? null : { scope: 'drone', key: d };
        }
        return ctx?.scene === undefined || isReservedKey(ctx.scene) ? null : { scope: 'scene', key: ctx.scene };
    }

    private check(def: SettingDef, v: unknown, key: string | null) {
        return checkValue(def, v, def.type === 'number' ? boundsOf(def, this.presets, def.scope === 'drone' ? (key ?? undefined) : this.droneOf()) : undefined);
    }

    private encode(v: unknown): string {
        return typeof v === 'string' ? v : canonicalJson(v);
    }

    private decode(def: SettingDef, s: string): unknown {
        if (def.type === 'enum') return s;
        try {
            return JSON.parse(s);
        } catch {
            return undefined;
        }
    }

    private stored(def: SettingDef, ctx?: Ctx): { has: boolean; value?: unknown } {
        // never stored, so never read from the document either (a hand-edited one included)
        if (def.persist === false) return { has: false };
        const ext = this.external[def.id];
        if (ext) {
            let raw: string | null = null;
            try {
                raw = ext.read();
            } catch {
                raw = null;
            }
            if (raw === null) return { has: false };
            const c = this.check(def, this.decode(def, raw), null);
            return c.ok ? { has: true, value: c.value } : { has: false };
        }
        const t = this.target(def, ctx);
        if (!t) return { has: false };
        const raw = entryAt(this.doc.settings, t.scope, t.key, def.id);
        if (raw === undefined) return { has: false };
        // a value from an older range or a hand edit is used clamped; a wrong type is not used
        const c = this.check(def, raw, t.key);
        return c.ok ? { has: true, value: c.value } : { has: false };
    }

    private write(id: string, value: unknown, ctx: Ctx | undefined, source: ChangeSource): SetResult {
        const def = this.schema.byId.get(id);
        if (!def) return { ok: false, reason: 'unknown-id' };
        if (def.persist === false) {
            // this page load only (the def says why): the session layer, never the document
            const c = this.check(def, value, null);
            if (!c.ok) return c;
            const previous = this.get(id);
            this.session.set(id, c.value);
            this.emit({ id, scope: 'global', key: null, value: clone(c.value), previous, source });
            return c;
        }
        const ext = this.external[id];
        const t = ext ? { scope: 'global' as Scope, key: null } : this.target(def, ctx);
        if (!t) return { ok: false, reason: 'no-context' };
        const c = this.check(def, value, t.key);
        if (!c.ok) return c;
        const tctx = t.scope === 'drone' ? { drone: t.key ?? undefined } : t.scope === 'scene' ? { scene: t.key ?? undefined } : undefined;
        const previous = this.valueAt(def, tctx);
        if (ext) ext.write(canonicalJson(c.value) === canonicalJson(def.default) ? null : this.encode(c.value));
        else {
            putEntry(this.doc.settings, t.scope, t.key, id, clone(c.value));
            this.dirty.add(slot(t.scope, t.key, id));
            this.schedule();
        }
        this.emit({ id, scope: t.scope, key: t.key, value: clone(c.value), previous, source });
        return c;
    }

    private remove(def: SettingDef, ctx: Ctx | undefined, source: ChangeSource): void {
        if (def.persist === false) {
            if (!this.session.has(def.id)) return;
            const previous = this.get(def.id);
            this.session.delete(def.id);
            this.emit({ id: def.id, scope: 'global', key: null, value: this.get(def.id), previous, source });
            return;
        }
        const ext = this.external[def.id];
        if (ext) {
            if (!this.stored(def).has) return;
            const previous = this.valueAt(def);
            ext.write(null);
            this.emit({ id: def.id, scope: 'global', key: null, value: this.valueAt(def), previous, source });
            return;
        }
        const t = this.target(def, ctx);
        if (!t || entryAt(this.doc.settings, t.scope, t.key, def.id) === undefined) return;
        const tctx = t.scope === 'drone' ? { drone: t.key ?? undefined } : t.scope === 'scene' ? { scene: t.key ?? undefined } : undefined;
        const previous = this.valueAt(def, tctx);
        putEntry(this.doc.settings, t.scope, t.key, def.id, undefined);
        this.dirty.add(slot(t.scope, t.key, def.id));
        this.schedule();
        this.emit({ id: def.id, scope: t.scope, key: t.key, value: this.valueAt(def, tctx), previous, source });
    }

    /** Stored-or-default for one scope and key, ignoring the session layer. */
    private valueAt(def: SettingDef, ctx?: Ctx): unknown {
        const s = this.stored(def, ctx);
        return s.has ? s.value : this.defaultOf(def.id, ctx);
    }

    private replaceCollection<K extends CollectionId>(k: K, v: Collections[K], source: ChangeSource): void {
        const before = this.doc.collections[k];
        if (!this.markCollection(k, before, v)) return;
        this.doc.collections[k] = clone(v);
        this.schedule();
        this.emit({ id: `collection.${k}`, scope: 'global', key: null, value: clone(v), previous: clone(before), source });
    }

    /** Marks the changed top-level fields of a collection; true if any changed. */
    private markCollection(k: CollectionId, before: unknown, after: unknown): boolean {
        const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
        let any = false;
        for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (canonicalJson(a[f]) !== canonicalJson(b[f])) {
                this.dirtyCols.add(`${k}.${f}`);
                any = true;
            }
        }
        return any;
    }

    private schedule(): void {
        if (this.debounceMs <= 0) {
            this.flush();
            return;
        }
        // not restarted by later changes: a dragged slider still reaches storage every 250 ms
        this.timer ??= setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.debounceMs);
    }

    private safeRead(): string | null {
        try {
            return this.backend.read();
        } catch {
            return null;
        }
    }

    /**
     * The document as storage holds it now. Nothing stored: if this tab has seen a stored
     * document, another tab erased everything, so an empty one (the erase is respected); if it
     * never has, its own document never reached storage (full or blocked since boot, review
     * must-fix 2), so this tab's own view, or the first change would drop what the first-boot
     * migration read. Unreadable: this tab's own view, so nothing it knows is lost when it writes.
     * A newer version's document: 'newer', and this tab stops writing.
     */
    private readStored(): PrefsDoc | 'newer' {
        const text = this.safeRead();
        if (text === null) return this.seenStored ? emptyDoc(this.app, this.iso()) : clone(this.doc);
        this.seenStored = true;
        const p = parseDocInput(text);
        if (!p.ok) {
            if (p.error === 'newer-version') {
                this.readOnly = true;
                this.canWrite = false;
                return 'newer';
            }
            return clone(this.doc);
        }
        return p.version < SCHEMA_VERSION ? runMigrations(p.raw, p.version, { app: this.app }) : normalizeDoc(p.raw, this.app);
    }

    /** The stored document with this tab's unwritten changes on top. */
    private replay(base: PrefsDoc): PrefsDoc {
        const out = clone(base);
        for (const k of this.dirty) {
            const [scope, key, id] = JSON.parse(k) as [Scope, string | null, string];
            putEntry(out.settings, scope, key, id, clone(entryAt(this.doc.settings, scope, key, id)));
        }
        for (const k of this.dirtyCols) {
            const [col, field] = k.split('.') as [CollectionId, string];
            const mine = (this.doc.collections[col] as unknown as Record<string, unknown>)[field];
            const target = out.collections[col] as unknown as Record<string, unknown>;
            if (mine === undefined) delete target[field];
            else target[field] = clone(mine);
        }
        return out;
    }

    private writeDoc(doc: PrefsDoc): boolean {
        const text = canonicalJson(doc);
        let ok = false;
        try {
            // read back: a backend that drops writes without an error is caught here
            ok = this.backend.write(text) && this.backend.read() === text;
        } catch {
            ok = false;
        }
        this.canWrite = ok;
        if (ok) this.seenStored = true;
        return ok;
    }

    private reloadExternal(): void {
        const base = this.readStored();
        if (base === 'newer') return;
        const next = this.replay(base);
        const prev = this.doc;
        this.doc = next;
        this.emitDiff(prev, next, 'external');
    }

    /** The document plus the values kept outside it, as an export carries them. */
    private withExternal(): PrefsDoc {
        const doc = clone(this.doc);
        for (const id of Object.keys(this.external)) {
            const def = this.schema.byId.get(id);
            if (!def) continue;
            const s = this.stored(def);
            if (s.has) doc.settings.global[id] = s.value;
        }
        return doc;
    }

    private emitDiff(prev: PrefsDoc, next: PrefsDoc, source: ChangeSource): void {
        if (!this.listeners.size) return;
        const seen = new Set<string>();
        for (const e of [...entriesOf(prev.settings), ...entriesOf(next.settings)]) {
            const k = slot(e.scope, e.key, e.id);
            const def = this.schema.byId.get(e.id);
            if (seen.has(k) || !def) continue;
            seen.add(k);
            const a = entryAt(prev.settings, e.scope, e.key, e.id), b = entryAt(next.settings, e.scope, e.key, e.id);
            if (canonicalJson(a) === canonicalJson(b)) continue;
            const ctx = e.scope === 'drone' ? { drone: e.key ?? undefined } : e.scope === 'scene' ? { scene: e.key ?? undefined } : undefined;
            this.emit({ id: e.id, scope: e.scope, key: e.key, value: this.valueAt(def, ctx), previous: a === undefined ? this.defaultOf(e.id, ctx) : clone(a), source });
        }
        for (const c of COLLECTION_IDS) {
            if (canonicalJson(prev.collections[c]) !== canonicalJson(next.collections[c])) this.emit({ id: `collection.${c}`, scope: 'global', key: null, value: clone(next.collections[c]), previous: clone(prev.collections[c]), source });
        }
    }

    private emit(c: PrefChange): void {
        for (const cb of [...this.listeners]) {
            try {
                cb(c);
            } catch {
                /* one broken listener must not stop the others or the write */
            }
        }
    }
}
