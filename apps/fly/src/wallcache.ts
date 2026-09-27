// Walls built in this browser, kept across restarts and carried to another PC (voxel-plan sec. 4).
// A bake is 10 s to minutes of GPU and CPU; its result depends only on the scene's bytes, the walls it
// started from and the bake settings, so it is stored under a key made of exactly those, and a key
// that changes (the scene republished as v<N+1>, its file overwritten with a new ETag, SuperSplat's
// own walls replaced, another voxel size) simply finds nothing: stale walls are never used.
// Store: IndexedDB `gsfpv` -> `blobs` (the layout v0.3's prefs reserve), a per-tab Map where
// IndexedDB is blocked (private mode). Everything here also runs in Node (the tests).
import { assertWalls, BAKE_TOOL, OPACITY_CUTOFF } from './bake';

/** Everything the baked bytes depend on. */
export interface WallsKeyInput {
    sceneId: string;
    /** the scene's v<N> folder */
    version: number;
    /** ETag of its lod-meta.json / meta.json (a same-folder overwrite changes it) */
    etag: string | null;
    /** sha256 of the walls the refine replaces, 'none' for a scene published without walls */
    base: string;
    voxelM: number;
    opacity?: number;
    tool?: string;
    /** 'full': the whole scene (a local tile would name its box) */
    box?: string;
    dropFloaters?: boolean;
}

export interface WallsRow {
    key: string;
    input: WallsKeyInput;
    /** sha256 of json + bin, the same digest the flight's input log names */
    sha256: string;
    sceneId: string;
    voxelM: number;
    bytesRaw: number;
    bytesStored: number;
    gaussians: number;
    bakeMs: number;
    createdAt: number;
    lastUsedAt: number;
    /** the scene moved on (new version / ETag / walls): evicted first */
    stale?: boolean;
}

export interface WallsEntry {
    row: WallsRow;
    json: Uint8Array;
    bin: Uint8Array;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    let s = '';
    for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
    return s;
}

/** The digest the session names its walls by: sha256 of the .voxel.json bytes followed by the .bin. */
export function wallsSha(json: Uint8Array, bin: Uint8Array): Promise<string> {
    const both = new Uint8Array(json.length + bin.length);
    both.set(json, 0);
    both.set(bin, json.length);
    return sha256Hex(both);
}

/** Fixed field order: the same input gives the same key in every browser and in Node. */
export function keyText(k: WallsKeyInput): string {
    return JSON.stringify(['gsfpv-walls/1', k.sceneId, k.version, k.etag ?? 'none', k.base, k.voxelM, k.opacity ?? OPACITY_CUTOFF, k.tool ?? BAKE_TOOL, k.box ?? 'full', k.dropFloaters ?? false]);
}

export async function wallsKey(k: WallsKeyInput): Promise<string> {
    return sha256Hex(new TextEncoder().encode(keyText(k)));
}

async function streamBytes(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    return new Uint8Array(await new Response(s).arrayBuffer());
}

/** The .bin gzips to ~40 % (92 MB -> 37-40 MB for 7a475d38 at 1.6 cm). */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    return streamBytes(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip')));
}

export async function gunzip(bytes: Uint8Array | Blob): Promise<Uint8Array> {
    const b = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>]);
    return streamBytes(b.stream().pipeThrough(new DecompressionStream('gzip')));
}

// ------------------------------------------------------------------ key-value stores

export interface Kv {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
    del(key: string): Promise<void>;
    /** [key, value] of every key starting with `prefix` */
    list(prefix: string): Promise<Array<[string, unknown]>>;
}

/** Per-tab store: private mode, IndexedDB blocked, and the tests. */
export class MemKv implements Kv {
    readonly map = new Map<string, unknown>();
    async get(key: string): Promise<unknown> { return this.map.get(key); }
    async put(key: string, value: unknown): Promise<void> { this.map.set(key, value); }
    async del(key: string): Promise<void> { this.map.delete(key); }
    async list(prefix: string): Promise<Array<[string, unknown]>> { return [...this.map].filter(([k]) => k.startsWith(prefix)); }
}

const IDB_NAME = 'gsfpv';
/** The stores v0.3's prefs create in the same database (handles, logs, blobs): opening it first here must not break them. */
const IDB_STORES = ['handles', 'logs', 'blobs'];
const STORE = 'blobs';

export class IdbKv implements Kv {
    private constructor(private readonly db: IDBDatabase) {}

    static open(factory: IDBFactory | null = globalThis.indexedDB ?? null): Promise<IdbKv> {
        if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
        return new Promise((resolve, reject) => {
            const req = factory.open(IDB_NAME);
            req.onupgradeneeded = () => {
                for (const s of IDB_STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
            };
            req.onsuccess = () => {
                if (!req.result.objectStoreNames.contains(STORE)) { req.result.close(); reject(new Error('IndexedDB gsfpv has no blobs store')); return; }
                resolve(new IdbKv(req.result));
            };
            req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
            req.onblocked = () => reject(new Error('IndexedDB open blocked'));
        });
    }

    /** Resolves when the transaction commits: a put is on disk before the caller moves on. */
    private run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const t = this.db.transaction(STORE, mode);
            const r = fn(t.objectStore(STORE));
            t.oncomplete = () => resolve(r.result);
            t.onerror = () => reject(t.error ?? r.error ?? new Error('IndexedDB request failed'));
            t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    get(key: string): Promise<unknown> { return this.run('readonly', (s) => s.get(key)); }
    put(key: string, value: unknown): Promise<void> { return this.run('readwrite', (s) => s.put(value, key)).then(() => undefined); }
    del(key: string): Promise<void> { return this.run('readwrite', (s) => s.delete(key)).then(() => undefined); }
    async list(prefix: string): Promise<Array<[string, unknown]>> {
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        const keys = await this.run('readonly', (s) => s.getAllKeys(range));
        const values = await this.run('readonly', (s) => s.getAll(range));
        return keys.map((k, i) => [String(k), values[i]]);
    }
}

// ------------------------------------------------------------------ the cache

const META = 'wallsmeta:';
const DATA = 'walls:';
/** Evict least recently used walls above min(1 GB, 10 % of the origin's quota). */
export const CACHE_MAX_BYTES = 1 << 30;

interface DataRow {
    json: Uint8Array;
    binGz: Blob | Uint8Array;
}

export type LookupMiss = 'absent' | 'corrupt';

export class WallCache {
    /** 'idb': survives restarts; 'memory': this tab only */
    readonly kind: 'idb' | 'memory';
    lastMiss: LookupMiss | null = null;

    constructor(readonly kv: Kv, kind: 'idb' | 'memory' = kv instanceof IdbKv ? 'idb' : 'memory', private readonly quota: () => Promise<number | null> = defaultQuota) {
        this.kind = kind;
    }

    /** IndexedDB when the browser allows it, else memory: a bake then still works, it is just not kept. */
    static async open(): Promise<WallCache> {
        try {
            return new WallCache(await IdbKv.open());
        } catch {
            return new WallCache(new MemKv(), 'memory');
        }
    }

    async rows(): Promise<WallsRow[]> {
        return (await this.kv.list(META)).map(([, v]) => v as WallsRow).filter((r) => r && typeof r.key === 'string');
    }

    /** The walls stored under `key`, checked against their sha256; a mismatch is deleted and missed. */
    async get(key: string): Promise<WallsEntry | null> {
        this.lastMiss = null;
        const row = (await this.kv.get(META + key)) as WallsRow | undefined;
        const data = row ? ((await this.kv.get(DATA + key)) as DataRow | undefined) : undefined;
        if (!row || !data) {
            this.lastMiss = 'absent';
            return null;
        }
        let bin: Uint8Array;
        try {
            bin = await gunzip(data.binGz);
            if ((await wallsSha(data.json, bin)) !== row.sha256) throw new Error('sha256 mismatch');
        } catch {
            await this.delete(key);
            this.lastMiss = 'corrupt';
            return null;
        }
        const used: WallsRow = { ...row, lastUsedAt: Date.now(), stale: false };
        await this.kv.put(META + key, used);
        return { row: used, json: data.json, bin };
    }

    /** Store baked or imported walls; returns the row. `binGz`: already compressed bytes (an import). */
    async put(input: WallsKeyInput, json: Uint8Array, bin: Uint8Array, info: { gaussians?: number; bakeMs?: number; sha256?: string; binGz?: Uint8Array } = {}): Promise<WallsRow> {
        const key = await wallsKey(input);
        const gz = info.binGz ?? await gzip(bin);
        const now = Date.now();
        const row: WallsRow = {
            key, input, sha256: info.sha256 ?? await wallsSha(json, bin), sceneId: input.sceneId, voxelM: input.voxelM,
            bytesRaw: json.length + bin.length, bytesStored: json.length + gz.length, gaussians: info.gaussians ?? 0, bakeMs: info.bakeMs ?? 0, createdAt: now, lastUsedAt: now
        };
        // a Blob keeps the bytes out of the JS heap until they are needed; Node's structured clone keeps either
        await this.kv.put(DATA + key, { json, binGz: typeof Blob !== 'undefined' ? new Blob([gz as Uint8Array<ArrayBuffer>]) : gz } satisfies DataRow);
        await this.kv.put(META + key, row);
        await this.evict(key);
        return row;
    }

    async delete(key: string): Promise<void> {
        await this.kv.del(DATA + key);
        await this.kv.del(META + key);
    }

    async clear(): Promise<void> {
        for (const r of await this.rows()) await this.delete(r.key);
    }

    /** Other walls of the same scene and voxel size under another key: the scene moved on. */
    async markStale(current: WallsKeyInput, currentKey: string): Promise<number> {
        let n = 0;
        for (const r of await this.rows()) {
            if (r.key !== currentKey && r.sceneId === current.sceneId && r.voxelM === current.voxelM && !r.stale) {
                await this.kv.put(META + r.key, { ...r, stale: true });
                n++;
            }
        }
        return n;
    }

    /** Least recently used first (stale ones before all others), never the walls just stored. */
    async evict(keep: string): Promise<string[]> {
        const q = await this.quota();
        const cap = Math.min(CACHE_MAX_BYTES, q && q > 0 ? q * 0.1 : CACHE_MAX_BYTES);
        const rows = await this.rows();
        let total = rows.reduce((s, r) => s + r.bytesStored, 0);
        const order = rows.filter((r) => r.key !== keep).sort((a, b) => Number(!!b.stale) - Number(!!a.stale) || a.lastUsedAt - b.lastUsedAt);
        const gone: string[] = [];
        for (const r of order) {
            if (total <= cap) break;
            await this.delete(r.key);
            total -= r.bytesStored;
            gone.push(r.key);
        }
        return gone;
    }

    // -------------------------------------------------------------- carry to another PC

    /** gsfpv-walls-YYYY-MM-DD.zip: walls/index.json + each key's .voxel.json and .voxel.bin.gz */
    async exportZip(keys?: string[]): Promise<Uint8Array> {
        const rows = (await this.rows()).filter((r) => !keys || keys.includes(r.key));
        const files: Array<{ name: string; data: Uint8Array }> = [];
        const index: WallsRow[] = [];
        for (const r of rows) {
            const d = (await this.kv.get(DATA + r.key)) as DataRow | undefined;
            if (!d) continue;
            const gz = d.binGz instanceof Uint8Array ? d.binGz : new Uint8Array(await d.binGz.arrayBuffer());
            files.push({ name: `walls/${r.key}.voxel.json`, data: d.json }, { name: `walls/${r.key}.voxel.bin.gz`, data: gz });
            index.push(r);
        }
        const doc = { format: 'gsfpv-walls/1', exportedAt: new Date().toISOString(), walls: index };
        files.unshift({ name: 'walls/index.json', data: new TextEncoder().encode(JSON.stringify(doc, null, 1)) });
        return zipStore(files);
    }

    /** Every entry is re-keyed and re-hashed here; one that does not match is rejected, the rest kept. */
    async importZip(bytes: Uint8Array): Promise<ImportReport> {
        const report: ImportReport = { imported: [], rejected: [] };
        const files = await unzip(bytes);
        const idx = files.get('walls/index.json');
        if (!idx) throw new Error('not a walls export: walls/index.json is missing');
        const doc = JSON.parse(new TextDecoder().decode(idx)) as { format?: string; walls?: WallsRow[] };
        if (doc.format !== 'gsfpv-walls/1' || !Array.isArray(doc.walls)) throw new Error(`not a walls export (format ${String(doc.format)})`);
        for (const r of doc.walls) {
            const key = String(r?.key ?? '');
            const reject = (reason: ImportReject['reason']) => report.rejected.push({ key, sceneId: r?.sceneId ?? null, reason });
            if (!r?.input || (await wallsKey(r.input)) !== key) { reject('key'); continue; }
            const json = files.get(`walls/${key}.voxel.json`);
            const gz = files.get(`walls/${key}.voxel.bin.gz`);
            if (!json || !gz) { reject('missing'); continue; }
            let bin: Uint8Array;
            try { bin = await gunzip(gz); } catch { reject('sha256'); continue; }
            if ((await wallsSha(json, bin)) !== r.sha256) { reject('sha256'); continue; }
            try { assertWalls(json, bin); } catch { reject('empty'); continue; }
            await this.put(r.input, json, bin, { gaussians: r.gaussians, bakeMs: r.bakeMs, sha256: r.sha256, binGz: gz });
            report.imported.push({ key, sceneId: r.sceneId, voxelM: r.voxelM });
        }
        return report;
    }
}

export interface ImportReject {
    key: string;
    sceneId: string | null;
    reason: 'key' | 'missing' | 'sha256' | 'empty';
}

export interface ImportReport {
    imported: Array<{ key: string; sceneId: string; voxelM: number }>;
    rejected: ImportReject[];
}

async function defaultQuota(): Promise<number | null> {
    try {
        const e = await (globalThis.navigator as Navigator | undefined)?.storage?.estimate?.();
        return e?.quota ?? null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ zip (stored entries)
// The bins are already gzipped: storing is as small as deflating again and needs no library (the
// splat-transform one is 5 MB and only loaded for a bake). Reading also takes deflate, for a zip
// that a person unpacked and packed again with another tool.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(b: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: Array<{ name: string; data: Uint8Array }>, when = new Date()): Uint8Array {
    const enc = new TextEncoder();
    const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        if (f.data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('walls export above 4 GB');
        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 names
        lv.setUint16(8, 0, true); // stored
        lv.setUint16(10, dosTime, true);
        lv.setUint16(12, dosDate, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, f.data.length, true);
        lv.setUint32(22, f.data.length, true);
        lv.setUint16(26, name.length, true);
        local.set(name, 30);
        const cd = new Uint8Array(46 + name.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, dosTime, true);
        cv.setUint16(14, dosDate, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, f.data.length, true);
        cv.setUint32(24, f.data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        cd.set(name, 46);
        parts.push(local, f.data);
        central.push(cd);
        offset += local.length + f.data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + end.length);
    let p = 0;
    for (const x of [...parts, ...central, end]) { out.set(x, p); p += x.length; }
    return out;
}

/** name -> bytes; every entry's CRC-32 is checked, so a damaged download fails here, loudly. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map<string, Uint8Array>();
    for (let n = 0; n < count; n++) {
        if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip central directory is damaged');
        const method = v.getUint16(p + 10, true);
        const crc = v.getUint32(p + 16, true);
        const csize = v.getUint32(p + 20, true);
        const nameLen = v.getUint16(p + 28, true);
        const extraLen = v.getUint16(p + 30, true);
        const commentLen = v.getUint16(p + 32, true);
        const lho = v.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (v.getUint32(lho, true) !== 0x04034b50) throw new Error(`zip entry ${name}: bad local header`);
        const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
        const raw = bytes.subarray(start, start + csize);
        let data: Uint8Array;
        if (method === 0) data = raw;
        else if (method === 8) data = await streamBytes(new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
        else throw new Error(`zip entry ${name}: compression method ${method} is not supported`);
        if (crc32(data) !== crc) throw new Error(`zip entry ${name} is damaged (CRC-32)`);
        if (!name.endsWith('/')) out.set(name, data);
    }
    return out;
}

// ------------------------------------------------------------------ this machine's bake speed

const SPEED_KEY = 'gsfpv.bakeSecondsPerMillion';

/** Seconds per million Gaussians the last bake took here (download included), or null. */
export function loadBakeSpeed(): number | null {
    try {
        const v = Number(globalThis.localStorage?.getItem(SPEED_KEY));
        return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
        return null;
    }
}

export function saveBakeSpeed(seconds: number, gaussians: number): void {
    if (!(seconds > 0) || !(gaussians > 0)) return;
    try {
        globalThis.localStorage?.setItem(SPEED_KEY, String(Math.round((seconds / (gaussians / 1e6)) * 100) / 100));
    } catch {
        /* storage blocked: the default estimate stays */
    }
}
