// The recordings kept on this device (docs/wip/v12-plan.md section 4.3 step 3): which sessions are in the browser's storage,
// in what state, and what can be done with each: bring an interrupted one back, pack one into a .zip, delete one. The folder
// of a session is the truth; a small file beside it, local.json, remembers what happened to it on this device (recovered,
// saved to disk), and step 8 adds what the server said (stored, delivered).
//
//   unfinished   manifest.json says the recording never ended (the tab was closed or crashed): offered at the next start
//   finished     the recording ended; complete says whether it ended by the pilot (true) or was brought back (false)
//   unreadable   no manifest, or one the package refuses: nothing can be done but delete it
//
// A session another tab is recording right now holds a lock on its folder (platform.ts) and is shown as `locked`, never recovered.
import type { ChunkStore, SessionManifest } from '@shramko/sonic-fpv';
import { PackageError, SESSION_FILES, packSession, parseManifest, recoverSession, utf8Decode, utf8Encode } from '@shramko/sonic-fpv';
import type { RecoveryReport } from '@shramko/sonic-fpv';
import type { SessionStores } from './recorder';

export type SessionState = 'unfinished' | 'finished' | 'unreadable';

/** What this device remembers about a session besides its files. */
export interface LocalNotes {
    /** ISO time the session was brought back after an interruption */
    readonly recoveredAt?: string;
    /** ISO time and way it was saved to disk by the pilot or the helper */
    readonly savedAt?: string;
    readonly savedVia?: 'picker' | 'download';
}

export interface SessionEntry {
    readonly id: string;
    readonly state: SessionState;
    readonly manifest: SessionManifest | null;
    /** the recording ended by the pilot's stop (finished) or was brought back (recovered, complete false) */
    readonly complete: boolean;
    /** another tab is recording it now */
    readonly locked: boolean;
    /** ms from the start of the recording to its last record or its end; null when the manifest does not say */
    readonly durationMs: number | null;
    /** bytes of every file of the session, the sidecars included */
    readonly bytes: number;
    readonly voice: boolean;
    readonly notes: LocalNotes;
    /** why an unreadable session is unreadable */
    readonly problem: string | null;
}

export const LOCAL_NOTES = 'local.json';

/** A store that can say how big a file is without reading it (OpfsChunkStore). */
interface Sized {
    size(name: string): Promise<number>;
}
const isSized = (s: ChunkStore): s is ChunkStore & Sized => typeof (s as Partial<Sized>).size === 'function';

async function sizeOf(store: ChunkStore, name: string): Promise<number> {
    if (isSized(store)) return store.size(name);
    return (await store.read(name))?.length ?? 0;
}

export async function readNotes(store: ChunkStore): Promise<LocalNotes> {
    try {
        const bytes = await store.read(LOCAL_NOTES);
        if (bytes === null) return {};
        const raw = JSON.parse(utf8Decode(bytes)) as Record<string, unknown>;
        return {
            ...(typeof raw['recoveredAt'] === 'string' ? { recoveredAt: raw['recoveredAt'] } : {}),
            ...(typeof raw['savedAt'] === 'string' ? { savedAt: raw['savedAt'] } : {}),
            ...(raw['savedVia'] === 'picker' || raw['savedVia'] === 'download' ? { savedVia: raw['savedVia'] } : {})
        };
    } catch {
        return {};
    }
}

/** Adds to what this device remembers (the file is replaced whole, atomically). */
export async function writeNotes(store: ChunkStore, add: LocalNotes): Promise<LocalNotes> {
    const next = { ...(await readNotes(store)), ...add };
    await store.replace(LOCAL_NOTES, utf8Encode(JSON.stringify(next)));
    return next;
}

/** The manifest of a session's store, or why it cannot be read. */
async function manifestOf(store: ChunkStore): Promise<{ manifest: SessionManifest } | { problem: string }> {
    const bytes = await store.read(SESSION_FILES.manifest);
    if (bytes === null) return { problem: 'no manifest.json' };
    const parsed = parseManifest(utf8Decode(bytes));
    return parsed.ok ? { manifest: parsed.value } : { problem: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ').slice(0, 300) };
}

const FILES = [SESSION_FILES.manifest, SESSION_FILES.flight, SESSION_FILES.events, SESSION_FILES.voice, SESSION_FILES.survey, SESSION_FILES.simLog, 'voice-sync.jsonl', LOCAL_NOTES];

/** One session's entry. `isLocked`: whether another tab holds the session (platform.ts sessionIsLocked). */
export async function describeSession(stores: SessionStores, id: string, isLocked: (id: string) => Promise<boolean>): Promise<SessionEntry> {
    const store = await stores.open(id);
    const [m, notes, locked] = await Promise.all([manifestOf(store), readNotes(store), isLocked(id).catch(() => false)]);
    let bytes = 0;
    for (const name of FILES) bytes += await sizeOf(store, name).catch(() => 0);
    const hasVoice = (await sizeOf(store, SESSION_FILES.voice).catch(() => 0)) > 0;
    if ('problem' in m) return { id, state: 'unreadable', manifest: null, complete: false, locked, durationMs: null, bytes, voice: hasVoice, notes, problem: m.problem };
    const manifest = m.manifest;
    const endMs = manifest.ended === null ? null : Date.parse(manifest.ended);
    const startMs = Date.parse(manifest.clock.startIso);
    return {
        id,
        state: manifest.ended === null ? 'unfinished' : 'finished',
        manifest,
        complete: manifest.complete,
        locked,
        durationMs: endMs !== null && Number.isFinite(endMs) && Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : null,
        bytes,
        voice: hasVoice,
        notes,
        problem: null
    };
}

/** Every session in storage, newest first (by creation time; unreadable ones last). */
export async function listSessions(stores: SessionStores, isLocked: (id: string) => Promise<boolean>): Promise<SessionEntry[]> {
    const ids = await stores.list();
    const entries: SessionEntry[] = [];
    for (const id of ids) {
        try {
            entries.push(await describeSession(stores, id, isLocked));
        } catch (e) {
            entries.push({ id, state: 'unreadable', manifest: null, complete: false, locked: false, durationMs: null, bytes: 0, voice: false, notes: {}, problem: e instanceof Error ? e.message : String(e) });
        }
    }
    const created = (e: SessionEntry): number => (e.manifest === null ? -Infinity : Date.parse(e.manifest.created));
    return entries.sort((a, b) => created(b) - created(a));
}

/**
 * Brings an interrupted session back (the package's recoverSession: a damaged tail of the flight log is cut at the last whole
 * chunk, a half event line is dropped, a `recovered` event is added, the manifest is rewritten as not complete with its files
 * listed) and notes it. A session another tab is recording is refused.
 */
export async function keepSession(stores: SessionStores, id: string, isLocked: (id: string) => Promise<boolean>, nowIso: () => string, options: { gzip?: (b: Uint8Array) => Promise<Uint8Array> } = {}): Promise<RecoveryReport> {
    if (await isLocked(id)) throw new Error('another tab is recording this session');
    const store = await stores.open(id);
    const report = await recoverSession(store, options.gzip === undefined ? {} : { gzip: options.gzip });
    await writeNotes(store, { recoveredAt: nowIso() });
    return report;
}

/** The session as one .zip (the package's packSession checks every listed file against its size and SHA-256). */
export async function packageOf(stores: SessionStores, id: string): Promise<Blob> {
    const store = await stores.open(id);
    try {
        return new Blob((await packSession(store)) as BlobPart[], { type: 'application/zip' });
    } catch (e) {
        if (e instanceof PackageError) throw new Error(`the recording cannot be packed: ${e.message}`);
        throw e;
    }
}

export async function deleteSession(stores: SessionStores, id: string, isLocked: (id: string) => Promise<boolean>): Promise<void> {
    if (await isLocked(id)) throw new Error('another tab is recording this session');
    await stores.remove(id);
}
