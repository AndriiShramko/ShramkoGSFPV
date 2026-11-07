// The upload of a recording to the author (docs/wip/v12-plan.md section 4.3 step 8; spec section 8 of the sound package). Not losing a
// recording is the requirement, so the rules here are about what the client keeps and when it believes the server:
//
//   - the package stays in this browser's storage the whole time and after it: nothing here deletes a file of a session;
//   - the client says the server HAS it only after the server's own `finish` answer says stored, and says DELIVERED only after the
//     server's status shows BOTH channels confirmed (sent, or link when the package was too big for that channel);
//   - the upload is in chunks of the size the server names (1 MiB), each with its own SHA-256, and the whole package's SHA-256 at the
//     start and at the finish; it resumes: what the server holds is asked (GET status) and only the missing chunks go;
//   - what the client needs to resume after a closed tab (the server's id, the upload token, the hash) is written to upload.json in
//     the session's own folder before the first chunk goes, and again when the server has stored it and when it is delivered;
//   - a failure of the network or of the server is waited out with a growing pause and tried again for as long as the page lives
//     (and the next start resumes); a refusal that no retry can change (too large, a minor without the guardian's confirmation,
//     not a package) stops the transfer with its reason, and the local copy is untouched.
//
// Everything the transfer touches comes in through TransferDeps (fetch, the hash, the clock, the pauses, the folder), so the Node
// tests drive it against a fake server and a fake clock, and the browser run drives it against the real API.
import type { ChunkStore } from '@shramko/sonic-fpv';
import { sha256Hex as pureSha256Hex, utf8Decode, utf8Encode } from '@shramko/sonic-fpv';

export const TRANSFER_FILE = 'upload.json';
/** The delivery channels the server works, in the order it lists them (sessions.py CHANNELS). */
export const CHANNELS = ['telegram', 'email'] as const;
export type ChannelName = (typeof CHANNELS)[number];

export type ConsentVia = 'key' | 'button' | 'voice';

export interface ChannelState {
    readonly status: string;
    readonly attempts: number;
    readonly error: string;
}

/** What survives a closed tab, in upload.json beside the files of the session. */
export interface TransferRecord {
    readonly v: 1;
    readonly serverId: string;
    /** the upload token the server showed once; it opens this one upload's chunks and status and nothing else */
    readonly token: string;
    readonly sha256: string;
    readonly size: number;
    readonly chunkBytes: number;
    readonly chunks: number;
    /** the pilot's separate confirmation to send this recording: when, and by which way */
    readonly consentAt: string;
    readonly consentVia: ConsentVia;
    readonly startedAt: string;
    readonly stored: boolean;
    readonly storedAt: string | null;
    readonly delivered: boolean;
    readonly deliveredAt: string | null;
    readonly channels: Readonly<Record<string, ChannelState>> | null;
    /** the code of a refusal no retry can change; null while the transfer can still go on */
    readonly blocked: string | null;
}

export type TransferStage = 'preparing' | 'starting' | 'uploading' | 'finishing' | 'stored' | 'delivered' | 'waiting' | 'blocked' | 'stopped';

export interface TransferProgress {
    readonly stage: TransferStage;
    readonly chunksDone: number;
    readonly chunks: number;
    readonly bytes: number;
    readonly stored: boolean;
    readonly delivered: boolean;
    readonly channels: Readonly<Record<string, ChannelState>> | null;
    /** a short code of what went wrong (network, slow, http-503, disk, rate, too-large, consent-guardian ...); null when nothing did */
    readonly problem: string | null;
    /** failures in a row so far */
    readonly failures: number;
    /** the clock time of the next try while waiting, ms */
    readonly retryAt: number | null;
    readonly serverId: string | null;
}

export type TransferOutcome = 'delivered' | 'blocked' | 'stopped';

export interface TransferDeps {
    /** the session's own folder: upload.json lives here beside the package's files */
    readonly store: ChunkStore;
    /** the package as one .zip (registry.packageOf); called when bytes are needed, not before */
    readonly pack: () => Promise<Blob | Uint8Array>;
    /** the pilot's separate confirmation to send this recording; the first start needs it, a resumed transfer has it in its record */
    readonly consent?: { readonly at: string; readonly via: ConsentVia };
    /** what the client says about its package (informational: the manifest inside the zip is what the server checks) */
    readonly facts?: { readonly packageId?: string; readonly lesson?: string; readonly minor?: boolean; readonly voice?: boolean; readonly release?: string };
    readonly fetch?: typeof fetch;
    /** '/api/session' in the page; an absolute URL in a test */
    readonly base?: string;
    readonly sha256?: (bytes: Uint8Array) => Promise<string>;
    readonly now?: () => number;
    readonly nowIso?: () => string;
    /** a wait that ends at once when the signal aborts */
    readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    readonly random?: () => number;
    /** the pause after the n-th failure in a row (n from 1), ms */
    readonly backoffMs?: (failures: number) => number;
    /** the pause before the n-th look (n from 0) at the delivery status, ms */
    readonly pollMs?: (n: number) => number;
    /** a request that is silent this long is given up and tried again, ms */
    readonly requestTimeoutMs?: number;
    readonly onProgress?: (p: TransferProgress) => void;
}

// ------------------------------------------------------------------ the record

export function parseTransfer(text: string): TransferRecord | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const str = (k: string): string | null => (typeof r[k] === 'string' && (r[k] as string).length > 0 && (r[k] as string).length <= 400 ? (r[k] as string) : null);
    const int = (k: string): number | null => (typeof r[k] === 'number' && Number.isInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
    const serverId = str('serverId');
    const token = str('token');
    const sha256 = str('sha256');
    const size = int('size');
    const chunkBytes = int('chunkBytes');
    const chunks = int('chunks');
    const consentAt = str('consentAt');
    const startedAt = str('startedAt');
    if (r['v'] !== 1 || serverId === null || token === null || sha256 === null || size === null || chunkBytes === null || chunks === null || consentAt === null || startedAt === null) return null;
    const via = r['consentVia'];
    if (via !== 'key' && via !== 'button' && via !== 'voice') return null;
    const channels = r['channels'];
    const parsedChannels: Record<string, ChannelState> | null =
        channels !== null && typeof channels === 'object' && !Array.isArray(channels)
            ? Object.fromEntries(Object.entries(channels as Record<string, unknown>).map(([k, v]) => [k, channelState(v)]))
            : null;
    return {
        v: 1,
        serverId,
        token,
        sha256,
        size,
        chunkBytes,
        chunks,
        consentAt,
        consentVia: via,
        startedAt,
        stored: r['stored'] === true,
        storedAt: typeof r['storedAt'] === 'string' ? r['storedAt'] : null,
        delivered: r['delivered'] === true,
        deliveredAt: typeof r['deliveredAt'] === 'string' ? r['deliveredAt'] : null,
        channels: parsedChannels,
        blocked: typeof r['blocked'] === 'string' ? r['blocked'] : null
    };
}

function channelState(v: unknown): ChannelState {
    const o = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    return { status: typeof o['status'] === 'string' ? o['status'] : 'unknown', attempts: typeof o['attempts'] === 'number' ? o['attempts'] : 0, error: typeof o['error'] === 'string' ? o['error'].slice(0, 80) : '' };
}

export async function readTransfer(store: ChunkStore): Promise<TransferRecord | null> {
    try {
        const bytes = await store.read(TRANSFER_FILE);
        return bytes === null ? null : parseTransfer(utf8Decode(bytes));
    } catch {
        return null;
    }
}

/** The record replaced whole (the store writes a new file and only then drops the old one, so it is the old record or the new, never half). */
export async function writeTransfer(store: ChunkStore, record: TransferRecord): Promise<void> {
    await store.replace(TRANSFER_FILE, utf8Encode(JSON.stringify(record)));
}

/** True only when every channel the server works has confirmed. */
export function allConfirmed(channels: Readonly<Record<string, { readonly status: string }>> | null | undefined): boolean {
    if (channels === null || channels === undefined) return false;
    return CHANNELS.every((c) => {
        const s = channels[c]?.status;
        return s === 'sent' || s === 'link';
    });
}

// ------------------------------------------------------------------ errors

type StepKind = 'retry' | 'restart' | 'blocked';

class StepError extends Error {
    constructor(
        readonly kind: StepKind,
        readonly code: string,
        /** the least pause before the next try, ms */
        readonly minWaitMs = 0,
        readonly body: Record<string, unknown> = {}
    ) {
        super(`${kind} ${code}`);
    }
}

/** What a refusal means for the transfer. The codes are the server's own (sessions.py SessionError). */
export function classify(status: number, body: Record<string, unknown>): StepError {
    const code = typeof body['error'] === 'string' ? (body['error'] as string) : `http-${status}`;
    switch (status) {
        case 404:
            return new StepError('restart', code === 'bad-chunk' ? 'bad-chunk' : 'unknown', 0, body);
        case 410:
            return new StepError('restart', 'gone', 0, body);
        case 403:
            return code === 'token' ? new StepError('restart', 'token', 0, body) : new StepError('blocked', code === 'no-consent' ? 'no-consent' : 'forbidden', 0, body);
        case 408:
            return new StepError('retry', 'slow', 0, body);
        case 409:
            if (code === 'incomplete') return new StepError('retry', 'incomplete', 0, body);
            if (code === 'chunk-differs') return new StepError('restart', 'chunk-differs', 0, body);
            if (code === 'busy') return new StepError('retry', 'busy', 2000, body);
            return new StepError('retry', code, 0, body); // not-uploading, duplicate: finish answers for them
        case 413:
            return code === 'too-large' ? new StepError('blocked', 'too-large', 0, body) : new StepError('restart', code, 0, body);
        case 422:
            if (code === 'consent-guardian' || code === 'not-a-package') return new StepError('blocked', code, 0, body);
            if (body['restart'] === true || code === 'bad-size') return new StepError('restart', code, 0, body);
            return new StepError('retry', code, 0, body); // a chunk damaged on the way: send it again
        case 429:
            return new StepError('retry', 'rate', 60_000, body);
        case 507:
            return new StepError('retry', code === 'cap' ? 'cap' : 'disk', 300_000, body);
        default:
            if (status === 400) return new StepError(code === 'bad-length' || code === 'cut-short' ? 'retry' : 'blocked', code, 0, body);
            if (status >= 500) return new StepError('retry', code, 0, body);
            return new StepError('blocked', code, 0, body);
    }
}

// ------------------------------------------------------------------ defaults

const defaultBackoff = (failures: number): number => Math.min(300_000, 2000 * 2 ** Math.max(0, failures - 1));
const defaultPoll = (n: number): number => [2000, 2000, 3000, 5000, 8000, 13_000, 20_000, 30_000][n] ?? 60_000;
const MAX_RESTARTS = 3;
const MAX_FINISH_LOOPS = 6;
const EMPTY_PROGRESS: TransferProgress = { stage: 'preparing', chunksDone: 0, chunks: 0, bytes: 0, stored: false, delivered: false, channels: null, problem: null, failures: 0, retryAt: null, serverId: null };

/** SHA-256 of bytes: the browser's own (fast) where there is one, else the package's. */
export async function sha256Of(bytes: Uint8Array): Promise<string> {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (subtle !== undefined) {
        try {
            const digest = await subtle.digest('SHA-256', bytes as BufferSource);
            return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
            // an insecure context or a refusing browser: the package's own hash below
        }
    }
    return pureSha256Hex(bytes);
}

function sleepOn(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done(): void {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done, { once: true });
    });
}

// ------------------------------------------------------------------ the transfer

export class Transfer {
    private p: TransferProgress = EMPTY_PROGRESS;
    private stopped = false;
    private running: Promise<TransferOutcome> | null = null;
    private waitCtl: AbortController | null = null;
    private fetchCtl: AbortController | null = null;
    private packed: Uint8Array | null = null;
    private hashed: string | null = null;
    private verified = false;
    private carriedConsent: { at: string; via: ConsentVia } | null = null;
    /** the server forgot the upload this run knew: the record on disk is dead, begin again */
    private forgetRecord = false;
    private failures = 0;

    constructor(private readonly deps: TransferDeps) {}

    progress(): TransferProgress {
        return this.p;
    }

    private get now(): () => number {
        return this.deps.now ?? Date.now;
    }

    private nowIso(): string {
        return (this.deps.nowIso ?? ((): string => new Date().toISOString()))();
    }

    private set(patch: Partial<TransferProgress>): void {
        this.p = { ...this.p, ...patch };
        try {
            this.deps.onProgress?.(this.p);
        } catch {
            // a listener's trouble is not the transfer's
        }
    }

    /** Runs until the recording is delivered, refused for good, or stopped. Calling it again while it runs returns the same run. */
    run(): Promise<TransferOutcome> {
        this.running ??= this.loop().finally(() => {
            this.running = null;
        });
        return this.running;
    }

    /** Cuts a pause short: the next try is made now (the pilot pressed U again, or the helper's Try again). */
    retryNow(): void {
        this.waitCtl?.abort();
    }

    /** The page is going away or the pilot gave up: nothing more is asked of the server. What the server holds stays there. */
    stop(): void {
        this.stopped = true;
        this.waitCtl?.abort();
        this.fetchCtl?.abort();
    }

    private async loop(): Promise<TransferOutcome> {
        let restarts = 0;
        this.stopped = false;
        while (!this.stopped) {
            try {
                await this.step();
                return this.stopped ? 'stopped' : 'delivered';
            } catch (e) {
                if (this.stopped) break;
                const err = e instanceof StepError ? e : new StepError('retry', 'internal');
                if (err.kind === 'blocked' || (err.kind === 'restart' && ++restarts > MAX_RESTARTS)) {
                    await this.markBlocked(err.code);
                    this.set({ stage: 'blocked', problem: err.code, retryAt: null });
                    return 'blocked';
                }
                if (err.kind === 'restart') {
                    this.dropForRestart();
                    continue;
                }
                this.failures++;
                const wait = Math.max(err.minWaitMs, this.jitter((this.deps.backoffMs ?? defaultBackoff)(this.failures)));
                this.set({ stage: 'waiting', problem: err.code, failures: this.failures, retryAt: this.now() + wait });
                await this.pause(wait);
            }
        }
        this.set({ stage: 'stopped', retryAt: null });
        return 'stopped';
    }

    private jitter(ms: number): number {
        const r = (this.deps.random ?? Math.random)();
        return Math.round(ms * (0.85 + 0.3 * r));
    }

    private async pause(ms: number): Promise<void> {
        const ctl = new AbortController();
        this.waitCtl = ctl;
        try {
            await (this.deps.sleep ?? sleepOn)(ms, ctl.signal);
        } finally {
            this.waitCtl = null;
        }
    }

    /** One pass through what is left to do. Throws a StepError for whatever goes wrong; returns when the recording is delivered. */
    private async step(): Promise<void> {
        let rec = await readTransfer(this.deps.store);
        if (rec !== null) this.carriedConsent = { at: rec.consentAt, via: rec.consentVia };
        if (rec === null || rec.blocked !== null || this.forgetRecord) rec = await this.begin();
        this.set({ serverId: rec.serverId, chunks: rec.chunks, bytes: rec.size, stored: rec.stored });
        for (let loops = 0; !rec.stored; loops++) {
            if (loops >= MAX_FINISH_LOOPS) throw new StepError('retry', 'not-complete', 5000);
            const alreadyStored = await this.upload(rec);
            if (alreadyStored) {
                rec = await this.save({ ...rec, stored: true, storedAt: this.nowIso() });
                break;
            }
            try {
                rec = await this.finish(rec);
            } catch (e) {
                if (e instanceof StepError && e.code === 'incomplete') continue;
                throw e;
            }
        }
        this.packed = null; // the bytes are no longer needed here: the server has them
        await this.deliver(rec);
    }

    private async save(rec: TransferRecord): Promise<TransferRecord> {
        await writeTransfer(this.deps.store, rec);
        return rec;
    }

    private async markBlocked(code: string): Promise<void> {
        const rec = await readTransfer(this.deps.store);
        if (rec !== null) await writeTransfer(this.deps.store, { ...rec, blocked: code }).catch(() => undefined);
    }

    /** The server forgot this upload (or it cannot be continued): forget it here and begin again; the consent given stays. */
    private dropForRestart(): void {
        this.packed = null;
        this.hashed = null;
        this.verified = false;
        // the old record stays until the new start has been answered (begin overwrites it): a tab closed in between resumes, finds the
        // server without it, and restarts the same way
        this.set({ stage: 'starting', chunksDone: 0, retryAt: null });
        this.forgetRecord = true;
    }

    private async bytes(): Promise<Uint8Array> {
        if (this.packed === null) {
            const pack = await this.deps.pack();
            this.packed = pack instanceof Uint8Array ? pack : new Uint8Array(await pack.arrayBuffer());
        }
        return this.packed;
    }

    private hash(bytes: Uint8Array): Promise<string> {
        return (this.deps.sha256 ?? sha256Of)(bytes);
    }

    /** Packs and hashes the package, asks the server for an upload, and writes what is needed to come back to it. */
    private async begin(): Promise<TransferRecord> {
        // the confirmation given for THIS run wins; one carried from the record only stands in for it when a transfer is resumed
        const consent = this.deps.consent === undefined ? this.carriedConsent : { at: this.deps.consent.at, via: this.deps.consent.via };
        // the pilot's separate confirmation comes first: without it nothing is asked of the server
        if (consent === null) throw new StepError('blocked', 'no-consent');
        this.set({ stage: 'preparing', problem: null });
        const bytes = await this.bytes();
        const sha = await this.hash(bytes);
        this.hashed = sha;
        this.verified = true;
        this.set({ stage: 'starting', bytes: bytes.length });
        const f = this.deps.facts ?? {};
        const r = await this.call('POST', '/start', { size: bytes.length, sha256: sha, consentSend: true, ...pick(f) });
        const id = r['id'];
        const token = r['token'];
        const chunkBytes = r['chunkBytes'];
        const chunks = r['chunks'];
        if (typeof id !== 'string' || typeof token !== 'string' || typeof chunkBytes !== 'number' || typeof chunks !== 'number') throw new StepError('retry', 'bad-answer');
        const stored = r['stored'] === true;
        this.forgetRecord = false;
        return this.save({
            v: 1,
            serverId: id,
            token,
            sha256: sha,
            size: bytes.length,
            chunkBytes,
            chunks,
            consentAt: consent.at,
            consentVia: consent.via,
            startedAt: this.nowIso(),
            stored,
            storedAt: stored ? this.nowIso() : null,
            delivered: false,
            deliveredAt: null,
            channels: null,
            blocked: null
        });
    }

    /** Sends the chunks the server does not hold. Resolves true when the server says the package is already stored (a duplicate). */
    private async upload(rec: TransferRecord): Promise<boolean> {
        this.set({ stage: 'uploading', chunks: rec.chunks, chunksDone: 0, problem: null });
        const st = await this.call('GET', `/${rec.serverId}`, null, rec.token, {}, false);
        if (st['stored'] === true) return true;
        const heldList = Array.isArray(st['held']) ? (st['held'] as unknown[]).filter((n): n is number => Number.isInteger(n)) : [];
        const held = new Set<number>(heldList);
        this.set({ chunksDone: held.size });
        if (held.size >= rec.chunks) return false;
        const bytes = await this.bytes();
        if (!this.verified) {
            // a resumed upload: the package packed now must be the one the server was told about
            if (bytes.length !== rec.size || (await this.hash(bytes)) !== rec.sha256) throw new StepError('restart', 'package-changed');
            this.verified = true;
        }
        for (let n = 0; n < rec.chunks; n++) {
            if (held.has(n)) continue;
            if (this.stopped) throw new StepError('retry', 'stopped');
            const from = n * rec.chunkBytes;
            const part = bytes.subarray(from, Math.min(rec.size, from + rec.chunkBytes));
            const h = await this.hash(part);
            await this.call('POST', `/${rec.serverId}/${n}`, part, rec.token, { 'X-Chunk-Sha256': h, 'Content-Type': 'application/octet-stream' });
            held.add(n);
            this.set({ chunksDone: held.size });
        }
        return false;
    }

    private async finish(rec: TransferRecord): Promise<TransferRecord> {
        this.set({ stage: 'finishing' });
        const r = await this.call('POST', `/${rec.serverId}/finish`, { sha256: rec.sha256 }, rec.token);
        if (r['stored'] !== true) throw new StepError('retry', 'not-stored');
        const channels = readChannels(r['channels']);
        const done = r['delivered'] === true && allConfirmed(channels);
        const saved = await this.save({ ...rec, stored: true, storedAt: this.nowIso(), channels, delivered: done, deliveredAt: done ? this.nowIso() : null });
        this.set({ stored: true, channels, delivered: done });
        return saved;
    }

    /** The server has the package; this watches its two channels until both confirm. A failure to read the status is waited out and never undoes "stored". */
    private async deliver(first: TransferRecord): Promise<void> {
        let rec = first;
        this.set({ stage: 'stored', stored: true, serverId: rec.serverId, channels: rec.channels ?? this.p.channels, problem: null });
        if (rec.delivered && allConfirmed(rec.channels)) {
            this.set({ stage: 'delivered', delivered: true });
            return;
        }
        for (let n = 0; !this.stopped; n++) {
            let st: Record<string, unknown>;
            try {
                st = await this.call('GET', `/${rec.serverId}`, null, rec.token);
            } catch (e) {
                if (!(e instanceof StepError) || e.kind !== 'retry') {
                    // the server no longer knows this recording (the owner deleted it, or it aged out): not started again behind anyone's back
                    throw new StepError('blocked', e instanceof StepError ? (e.kind === 'restart' ? (e.code === 'token' ? 'token' : 'gone') : e.code) : 'internal');
                }
                this.failures++;
                this.set({ problem: e.code, failures: this.failures });
                await this.pause(Math.max(e.minWaitMs, this.jitter((this.deps.backoffMs ?? defaultBackoff)(this.failures))));
                continue;
            }
            const channels = readChannels(st['channels']);
            const done = st['delivered'] === true && allConfirmed(channels);
            // saved when something changed that the next start would want to know (a channel's state, or the end)
            if (done || JSON.stringify(channels) !== JSON.stringify(rec.channels)) {
                rec = await this.save({ ...rec, channels, delivered: done, deliveredAt: done ? this.nowIso() : null });
            }
            this.set({ stage: done ? 'delivered' : 'stored', channels, delivered: done, problem: null, failures: 0 });
            if (done) return;
            await this.pause(this.jitter((this.deps.pollMs ?? defaultPoll)(n)));
        }
    }

    /**
     * One request. Resolves with the answer's JSON when the server says ok; throws a StepError for everything else. `progress`: whether
     * an answer counts as the thing that failed before working again (it ends the run of failures); a status read between two failed
     * chunks does not, or a chunk that never goes through would be tried every two seconds for ever.
     */
    private async call(method: 'GET' | 'POST', path: string, body: unknown, token?: string, headers: Record<string, string> = {}, progress = true): Promise<Record<string, unknown>> {
        const f = this.deps.fetch ?? globalThis.fetch.bind(globalThis);
        const ctl = new AbortController();
        this.fetchCtl = ctl;
        const timeout = setTimeout(() => ctl.abort(), this.deps.requestTimeoutMs ?? 60_000);
        try {
            return await this.exchange(f, ctl, method, path, body, token, headers, progress);
        } finally {
            clearTimeout(timeout);
        }
    }

    private async exchange(f: typeof fetch, ctl: AbortController, method: 'GET' | 'POST', path: string, body: unknown, token: string | undefined, headers: Record<string, string>, progress: boolean): Promise<Record<string, unknown>> {
        const isBytes = body instanceof Uint8Array;
        const init: RequestInit = {
            method,
            headers: { ...(token === undefined ? {} : { 'X-Session-Token': token }), ...(body !== null && !isBytes ? { 'Content-Type': 'application/json' } : {}), ...headers },
            signal: ctl.signal,
            cache: 'no-store'
        };
        if (body !== null) init.body = isBytes ? (body as BufferSource) : JSON.stringify(body);
        let res: Response;
        let json: Record<string, unknown> = {};
        try {
            res = await f(`${this.deps.base ?? '/api/session'}${path}`, init);
            try {
                const text = await res.text();
                json = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
            } catch {
                if (ctl.signal.aborted) throw new Error('timeout');
                // a proxy's own error page, or a cut-off answer: judged by the status alone
            }
        } catch {
            if (this.stopped) throw new StepError('retry', 'stopped');
            throw new StepError('retry', ctl.signal.aborted ? 'slow' : 'network');
        }
        // only the server's own "ok": a captive portal's page with status 200 is not a chunk held
        if (res.ok && json['ok'] === true) {
            if (progress && (this.failures !== 0 || this.p.problem !== null)) {
                this.failures = 0;
                this.set({ failures: 0, problem: null });
            }
            return json;
        }
        if (res.ok) throw new StepError('retry', 'bad-answer');
        throw classify(res.status, json);
    }
}

function pick(f: NonNullable<TransferDeps['facts']>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (f.packageId !== undefined) out['packageId'] = f.packageId;
    if (f.lesson !== undefined) out['lesson'] = f.lesson;
    if (f.minor !== undefined) out['minor'] = f.minor;
    if (f.voice !== undefined) out['voice'] = f.voice;
    if (f.release !== undefined) out['release'] = f.release;
    return out;
}

function readChannels(v: unknown): Record<string, ChannelState> | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, c]) => [k, channelState(c)]));
}
