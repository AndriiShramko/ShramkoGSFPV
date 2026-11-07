// The chunk store of a Fly by Sound session (docs/wip/v12-plan.md section 4.3 step 2) on the browser's origin
// private file system (OPFS): one folder per session, one small file per chunk the sound package's SessionWriter
// appends ("OPFS chunk files"). A closed or crashed tab leaves every chunk that was written; recoverSession of the
// package brings the folder back to a readable session.
//
// Why files per chunk and not one growing file: an append to a file through createWritable({ keepExistingData })
// copies the whole file again (a 10 MB voice track would be copied once per second), and a sync access handle needs a
// worker. A part is written once, atomically (the browser writes a swap file and renames it on close()), so a part is
// either whole or absent, never half. A logical file (flight.jsonl.gz, events.jsonl, voice.webm, manifest.json ...)
// is its parts in order:
//
//   <name>.e<epoch>.<seq>.part      epoch counts the replace() calls, seq the appends since
//
// append() adds the next part of the current epoch. replace() writes the new content as the first part of the NEXT
// epoch and only then deletes the older epochs, so a crash in between leaves both and reading takes the newest epoch:
// the new content, never a mix. Anything in the folder that is not a part (a browser's swap file) is ignored.
import type { ChunkStore } from '@shramko/sonic-fpv';

/** The part of a writable stream the store uses. */
export interface WritableLike {
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
}

/** The part of a file handle the store uses (a FileSystemFileHandle, or a test double). */
export interface FileLike {
    readonly kind: 'file';
    readonly name: string;
    getFile(): Promise<{ readonly size: number; readonly lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
}

/** The part of a directory handle the store uses (a FileSystemDirectoryHandle, or a test double). */
export interface DirectoryLike {
    readonly kind: 'directory';
    readonly name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    entries(): AsyncIterable<[string, FileLike | DirectoryLike]>;
}

const PART = /^(.+)\.e(\d+)\.(\d{6})\.part$/;
const pad = (n: number): string => String(n).padStart(6, '0');
const READ_BATCH = 24;

interface Logical {
    epoch: number;
    /** sequence numbers present in `epoch`, ascending */
    seqs: number[];
    /** the next sequence number to append */
    next: number;
}

/** A chunk store in one OPFS folder (or any DirectoryLike). One writer at a time: the recorder holds a lock on the folder. */
export class OpfsChunkStore implements ChunkStore {
    private readonly state = new Map<string, Logical>();
    private scanned = false;
    /** the scan that is running: operations that start while it runs wait for it instead of starting a second one */
    private scanning: Promise<void> | null = null;
    /** every part name this store knows, by logical name and epoch (to delete older epochs) */
    private readonly parts = new Map<string, Map<number, number[]>>();

    constructor(private readonly dir: DirectoryLike) {}

    get name(): string {
        return this.dir.name;
    }

    /** Reads the folder once: which parts exist. Called by every operation that needs the index; at most one scan runs. */
    private scan(): Promise<void> {
        if (this.scanned) return Promise.resolve();
        this.scanning ??= this.readFolder().finally(() => {
            this.scanning = null;
        });
        return this.scanning;
    }

    private async readFolder(): Promise<void> {
        this.parts.clear();
        this.state.clear();
        for await (const [fileName, handle] of this.dir.entries()) {
            if (handle.kind !== 'file') continue;
            const m = PART.exec(fileName);
            if (m === null) continue;
            const name = m[1] as string;
            const epoch = Number(m[2]);
            const seq = Number(m[3]);
            let epochs = this.parts.get(name);
            if (epochs === undefined) this.parts.set(name, (epochs = new Map()));
            const list = epochs.get(epoch) ?? [];
            list.push(seq);
            epochs.set(epoch, list);
        }
        for (const [name, epochs] of this.parts) {
            const newest = Math.max(...epochs.keys());
            const seqs = (epochs.get(newest) as number[]).sort((a, b) => a - b);
            this.state.set(name, { epoch: newest, seqs, next: (seqs[seqs.length - 1] as number) + 1 });
        }
        this.scanned = true;
    }

    private async write(fileName: string, bytes: Uint8Array): Promise<void> {
        const handle = await this.dir.getFileHandle(fileName, { create: true });
        const w = await handle.createWritable({ keepExistingData: false });
        try {
            if (bytes.length > 0) await w.write(bytes);
            await w.close();
        } catch (e) {
            try {
                await w.abort?.();
            } catch {
                // the stream is already closed
            }
            throw e;
        }
    }

    async append(name: string, bytes: Uint8Array): Promise<void> {
        await this.scan();
        let st = this.state.get(name);
        if (st === undefined) {
            st = { epoch: 0, seqs: [], next: 0 };
            this.state.set(name, st);
        }
        // the number is taken before the write, so two appends to one name that overlap never pick the same one
        const seq = st.next++;
        await this.write(`${name}.e${st.epoch}.${pad(seq)}.part`, bytes);
        // the part exists now: only then does the index know it (a failed write leaves a gap, which reading skips)
        const last = st.seqs[st.seqs.length - 1];
        st.seqs.push(seq);
        if (last !== undefined && last > seq) st.seqs.sort((a, b) => a - b);
    }

    async replace(name: string, bytes: Uint8Array): Promise<void> {
        await this.scan();
        const old = this.state.get(name);
        const epoch = old === undefined ? 0 : old.epoch + 1;
        await this.write(`${name}.e${epoch}.${pad(0)}.part`, bytes);
        this.state.set(name, { epoch, seqs: [0], next: 1 });
        // the older epochs are garbage now; a failed delete leaves them, the newest epoch still wins
        if (old !== undefined) {
            for (const seq of old.seqs) {
                try {
                    await this.dir.removeEntry(`${name}.e${old.epoch}.${pad(seq)}.part`);
                } catch {
                    // already gone or busy: ignored
                }
            }
            const epochs = this.parts.get(name);
            if (epochs !== undefined) {
                for (const [e, seqs] of epochs) {
                    if (e === epoch) continue;
                    for (const seq of seqs) {
                        try {
                            await this.dir.removeEntry(`${name}.e${e}.${pad(seq)}.part`);
                        } catch {
                            // ignored
                        }
                    }
                    epochs.delete(e);
                }
            }
        }
    }

    async read(name: string): Promise<Uint8Array | null> {
        await this.scan();
        const st = this.state.get(name);
        if (st === undefined) return null;
        const chunks: Uint8Array[] = new Array<Uint8Array>(st.seqs.length);
        for (let i = 0; i < st.seqs.length; i += READ_BATCH) {
            const batch = st.seqs.slice(i, i + READ_BATCH);
            const got = await Promise.all(
                batch.map(async (seq) => {
                    const file = await (await this.dir.getFileHandle(`${name}.e${st.epoch}.${pad(seq)}.part`)).getFile();
                    return new Uint8Array(await file.arrayBuffer());
                })
            );
            got.forEach((b, k) => {
                chunks[i + k] = b;
            });
        }
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
            out.set(c, at);
            at += c.length;
        }
        return out;
    }

    async list(): Promise<readonly string[]> {
        await this.scan();
        return [...this.state.keys()].sort();
    }

    /** The size of a logical file in bytes without reading it, 0 when it does not exist. */
    async size(name: string): Promise<number> {
        await this.scan();
        const st = this.state.get(name);
        if (st === undefined) return 0;
        let total = 0;
        for (const seq of st.seqs) total += (await (await this.dir.getFileHandle(`${name}.e${st.epoch}.${pad(seq)}.part`)).getFile()).size;
        return total;
    }

    /** Forgets what was read from the folder: the next operation scans it again (another writer, or a folder just recovered). */
    rescan(): void {
        this.scanned = false;
    }
}

// ------------------------------------------------------------------ the folder of all sessions

/** Where the sessions live in the origin private file system. */
export const SESSIONS_DIR = 'sonic-sessions';

/** The browser has what the store needs: OPFS and a writable file stream. */
export function opfsAvailable(): boolean {
    const nav = globalThis.navigator as (Navigator & { storage?: { getDirectory?: unknown } }) | undefined;
    const fh = (globalThis as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle;
    return typeof nav?.storage?.getDirectory === 'function' && fh !== undefined && 'createWritable' in fh.prototype;
}

/** The folder that holds every session folder (made when missing). Throws where OPFS is not there. */
export async function openSessionsRoot(): Promise<DirectoryLike> {
    if (!opfsAvailable()) throw new Error('the origin private file system is not available');
    const root = (await globalThis.navigator.storage.getDirectory()) as unknown as DirectoryLike;
    return root.getDirectoryHandle(SESSIONS_DIR, { create: true });
}

/** A session's store: its folder under `root`, made when missing (`create` false: it must exist, else this rejects). */
export async function openSessionStore(root: DirectoryLike, id: string, create = true): Promise<OpfsChunkStore> {
    return new OpfsChunkStore(await root.getDirectoryHandle(id, { create }));
}

/** The ids of the session folders under `root`. */
export async function listSessionIds(root: DirectoryLike): Promise<string[]> {
    const ids: string[] = [];
    for await (const [name, handle] of root.entries()) if (handle.kind === 'directory') ids.push(name);
    return ids.sort();
}

/** Deletes a session's folder and everything in it. */
export async function removeSession(root: DirectoryLike, id: string): Promise<void> {
    await root.removeEntry(id, { recursive: true });
}
