// Fakes for the Node tests of the sending of a recording (lane v12-feedback, step 8): a finished session in an in-memory OPFS, and a fake of
// the server's recording routes that answers with the same statuses and error codes as apps/api/sessions.py (the real API is tried in
// apps/api/tests/test_sessions.py, and the real one against the page in tools/bench/src/sonicrec-upload.ts). Nothing here is a test.
import { createHash, randomBytes } from 'node:crypto';
import { SessionWriter, readPackage } from '../../../packages/sonic-fpv/src';
import type { FlightFrame } from '../../../packages/sonic-fpv/src';
import { buildManifestInput } from '../../../apps/fly/src/sonic-session/manifest-input';
import { consentFor, newProfile } from '../../../apps/fly/src/sonic-session/consent';
import type { PilotProfile } from '../../../apps/fly/src/sonic-session/consent';
import { packageOf } from '../../../apps/fly/src/sonic-session/registry';
import { listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import type { SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { FakeDirectory, fakeRuntime, nodeGzip } from './sonicrec-fixtures';

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function stores(dir: FakeDirectory): SessionStores {
    return {
        durable: true,
        create: (id) => openSessionStore(dir, id),
        open: (id) => openSessionStore(dir, id, false),
        list: () => listSessionIds(dir),
        remove: (id) => removeSession(dir, id)
    };
}

function frames(n: number): FlightFrame[] {
    return Array.from({ length: n }, (_, i) => {
        const t = i * (1000 / 30);
        return { t, tick: Math.round(t), p: [Math.cos(t / 900) * 3, 2.5, Math.sin(t / 900) * 3], v: [0, 0, 1], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: ['height.tone'] } as FlightFrame;
    });
}

/** Bytes that are the same on every run (a package of many chunks needs a voice of some size). */
export function filler(n: number, seed = 1): Uint8Array {
    const out = new Uint8Array(n);
    let x = seed >>> 0;
    for (let i = 0; i < n; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        out[i] = x >>> 24;
    }
    return out;
}

export interface MadeSession {
    readonly dir: FakeDirectory;
    readonly stores: SessionStores;
    readonly id: string;
    /** the package as it packs now */
    pack(): Promise<Uint8Array>;
    /** the names of every file in the session's folder */
    files(): Promise<string[]>;
}

export interface MakeOptions {
    readonly id?: string;
    readonly at?: string;
    readonly voiceBytes?: number;
    readonly minor?: boolean;
    readonly guardian?: boolean;
    readonly dir?: FakeDirectory;
}

/** A finished recording in an in-memory folder, written by the sound package's own writer. */
export async function makeSession(o: MakeOptions = {}): Promise<MadeSession> {
    const dir = o.dir ?? new FakeDirectory('sonic-sessions');
    const id = o.id ?? 'sendSession0000000001';
    const at = o.at ?? '2026-11-07T10:00:00Z';
    const store = await openSessionStore(dir, id);
    const profile: PilotProfile = { ...newProfile(), minor: o.minor === true, guardianConfirmed: o.minor === true && o.guardian === true };
    const manifest = buildManifestInput({
        runtime: fakeRuntime('walls-hall').runtime,
        env: { release: { sha: 'test', sonic: 'test' }, locale: 'en', userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] },
        consent: consentFor(profile, { voice: true, at }),
        profile,
        startIso: at,
        id
    });
    const w = await SessionWriter.start({ sink: store, manifest, gzip: nodeGzip, chunkFrames: 30 });
    w.setVoiceOffset(5);
    for (const f of frames(75)) w.frame(f);
    w.event({ t: 100, kind: 'checkpoint', id: 'cp' });
    w.voice(filler(o.voiceBytes ?? 3000));
    await w.finish({ ended: new Date(Date.parse(at) + 2500).toISOString() });
    const st = stores(dir);
    return {
        dir,
        stores: st,
        id,
        pack: async () => new Uint8Array(await (await packageOf(st, id)).arrayBuffer()),
        files: async () => ((await dir.getDirectoryHandle(id)) as FakeDirectory).names()
    };
}

// ------------------------------------------------------------------ the fake server

export interface Call {
    readonly n: number;
    readonly method: string;
    readonly path: string;
    /** the query string, which a client must never put a token in */
    readonly search: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array | null;
    readonly json: Record<string, unknown> | null;
}

export type Fault =
    | { kind: 'network' }
    | { kind: 'status'; status: number; body?: Record<string, unknown> }
    | { kind: 'lost' }
    | { kind: 'portal' }
    | { kind: 'hang' }
    | { kind: 'reply'; body: Record<string, unknown> }
    /** the body takes `body.length / bytesPerSecond` seconds to arrive, in the timers the test controls; a request aborted before that has put nothing on the server */
    | { kind: 'throttle'; bytesPerSecond: number };

interface Sess {
    id: string;
    token: string;
    size: number;
    sha: string;
    chunkBytes: number;
    chunks: number;
    held: Map<number, string>;
    data: Uint8Array;
    state: 'uploading' | 'stored' | 'duplicate';
    of?: string;
    polls: number;
    channels: { telegram: string; email: string };
}

const ok = (status: number, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } => ({ status, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): { status: number; body: Record<string, unknown> } => ({ status, body: { ok: false, error, ...extra } });

/** The recording routes of the API as sessions.py answers them, held in memory, with faults that a test arms. */
export class FakeApi {
    chunkBytes = 1000;
    maxBytes = 1_000_000;
    readonly sessions = new Map<string, Sess>();
    readonly calls: Call[] = [];
    /** consulted for every call before it is handled; the first that returns a fault applies */
    readonly faults: ((c: Call) => Fault | null)[] = [];
    /** after this many status polls of a stored session both channels say sent (null: never; the test sets channels itself) */
    autoDeliverAfter: number | null = 2;
    /** what the status reports instead of the truth about "delivered" (a broken server): null = honest */
    lieDelivered = false;
    onStatusPoll: ((polls: number, s: Sess) => void) | null = null;
    private seq = 0;
    private ids = 0;

    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
        const raw = init?.body;
        const body = raw === undefined || raw === null ? null : typeof raw === 'string' ? new TextEncoder().encode(raw) : raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
        let json: Record<string, unknown> | null = null;
        if (body !== null && (headers['content-type'] ?? '').startsWith('application/json')) json = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
        const call: Call = { n: ++this.seq, method: init?.method ?? 'GET', path: url.pathname.replace(/^\/api\/session/, '') || '/', search: url.search, headers, body, json };
        this.calls.push(call);
        let fault: Fault | null = null;
        for (const f of this.faults) fault = fault ?? f(call);
        if (fault?.kind === 'network') throw new TypeError('fetch failed');
        if (fault?.kind === 'throttle') {
            const ms = ((body?.length ?? 0) / fault.bytesPerSecond) * 1000;
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, ms);
                init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
            });
        }
        if (fault?.kind === 'hang') {
            await new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
        }
        if (fault?.kind === 'status') return new Response(JSON.stringify(fault.body ?? { ok: false, error: `http-${fault.status}` }), { status: fault.status });
        if (fault?.kind === 'reply') return new Response(JSON.stringify(fault.body), { status: 200 });
        if (fault?.kind === 'portal') return new Response('<html>please sign in to the wifi</html>', { status: 200, headers: { 'content-type': 'text/html' } });
        const r = this.handle(call);
        if (fault?.kind === 'lost') throw new TypeError('fetch failed'); // the server did it, the answer never came
        return new Response(JSON.stringify(r.body), { status: r.status });
    };

    private newId(): string {
        return `S-20261107-${(++this.ids).toString(16).padStart(12, '0')}`;
    }

    /** Sets what the channels of a stored session report. */
    setChannels(id: string, channels: Partial<Sess['channels']>): void {
        const s = this.sessions.get(id);
        if (s !== undefined) Object.assign(s.channels, channels);
    }

    stored(): Sess[] {
        return [...this.sessions.values()].filter((s) => s.state === 'stored');
    }

    callsTo(re: RegExp): Call[] {
        return this.calls.filter((c) => re.test(`${c.method} ${c.path}`));
    }

    private channelsOf(s: Sess): Record<string, unknown> {
        return Object.fromEntries(Object.entries(s.channels).map(([k, v]) => [k, { status: v, attempts: v === 'queued' ? 0 : 1, error: '', at: v === 'sent' ? '2026-11-07T10:00:00Z' : null }]));
    }

    private delivered(s: Sess): boolean {
        return Object.values(s.channels).every((v) => v === 'sent' || v === 'link');
    }

    private storedAnswer(s: Sess, sid: string): { status: number; body: Record<string, unknown> } {
        return ok(200, { ok: true, stored: true, id: sid, bytes: s.size, sha256: s.sha, channels: this.channelsOf(s), delivered: this.lieDelivered || this.delivered(s) });
    }

    handle(c: Call): { status: number; body: Record<string, unknown> } {
        const m = /^\/(start|S-\d{8}-[0-9a-f]{12})(?:\/(finish|\d+))?$/.exec(c.path);
        if (m === null) return fail(404, 'unknown');
        const [, head, tail] = m;
        if (head === 'start') return this.start(c);
        const s = this.sessions.get(head as string);
        if (s === undefined) return fail(404, 'unknown');
        if (c.headers['x-session-token'] !== s.token) return fail(403, 'token');
        if (tail === undefined) return this.status(s);
        if (tail === 'finish') return this.finish(s, c);
        return this.chunk(s, Number(tail), c);
    }

    private start(c: Call): { status: number; body: Record<string, unknown> } {
        const b = c.json;
        if (b === null) return fail(400, 'bad-request');
        const size = b['size'];
        const digest = b['sha256'];
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return fail(400, 'bad-size');
        if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return fail(400, 'bad-hash');
        if (b['consentSend'] !== true) return fail(403, 'no-consent');
        if (size > this.maxBytes) return fail(413, 'too-large', { limit: this.maxBytes });
        const id = this.newId();
        const token = randomBytes(24).toString('hex');
        const twin = this.stored().find((x) => x.sha === digest);
        if (twin !== undefined) {
            this.sessions.set(id, { id, token, size, sha: digest, chunkBytes: this.chunkBytes, chunks: 0, held: new Map(), data: new Uint8Array(0), state: 'duplicate', of: twin.id, polls: 0, channels: twin.channels });
            return ok(200, { ok: true, id, token, stored: true, duplicate: true, chunkBytes: this.chunkBytes, chunks: 0 });
        }
        const chunks = Math.ceil(size / this.chunkBytes);
        this.sessions.set(id, { id, token, size, sha: digest, chunkBytes: this.chunkBytes, chunks, held: new Map(), data: new Uint8Array(size), state: 'uploading', polls: 0, channels: { telegram: 'queued', email: 'queued' } });
        return ok(200, { ok: true, id, token, stored: false, chunkBytes: this.chunkBytes, chunks });
    }

    private chunk(s: Sess, n: number, c: Call): { status: number; body: Record<string, unknown> } {
        if (s.state === 'duplicate') return fail(409, 'duplicate', { of: s.of });
        if (s.state !== 'uploading') return fail(409, 'not-uploading');
        if (n < 0 || n >= s.chunks) return fail(404, 'bad-chunk');
        const expect = Math.min(s.chunkBytes, s.size - n * s.chunkBytes);
        const body = c.body ?? new Uint8Array(0);
        if (body.length !== expect) return fail(body.length > expect ? 413 : 400, 'bad-length', { expect });
        const digest = sha256(body);
        const held = s.held.get(n);
        if (held !== undefined) return digest === held ? ok(200, { ok: true, held: s.held.size, of: s.chunks, already: true }) : fail(409, 'chunk-differs');
        const claimed = c.headers['x-chunk-sha256'];
        if (claimed !== undefined && claimed.toLowerCase() !== digest) return fail(422, 'bad-hash');
        s.data.set(body, n * s.chunkBytes);
        s.held.set(n, digest);
        return ok(200, { ok: true, held: s.held.size, of: s.chunks, already: false });
    }

    /** What the server decides about a package at finish, besides its hash; a test replaces it for a refusal. */
    verdict: (data: Uint8Array) => { status: number; error: string } | null = (data) => {
        try {
            const pkg = readPackage(data, { lenient: true });
            const consent = pkg.manifest.consent;
            if (consent.minor && consent.guardianConfirmed !== true) return { status: 422, error: 'consent-guardian' };
            return null;
        } catch {
            return { status: 422, error: 'not-a-package' };
        }
    };

    private finish(s: Sess, c: Call): { status: number; body: Record<string, unknown> } {
        if (s.state === 'duplicate') return this.storedAnswer(this.sessions.get(s.of as string) as Sess, s.id);
        if (s.state === 'stored') return this.storedAnswer(s, s.id);
        const sent = c.json?.['sha256'];
        if (typeof sent === 'string' && sent.toLowerCase() !== s.sha) return fail(400, 'hash-changed');
        const missing = [...Array(s.chunks).keys()].filter((i) => !s.held.has(i));
        if (missing.length > 0) return fail(409, 'incomplete', { missing, held: s.held.size, of: s.chunks });
        if (sha256(s.data) !== s.sha) {
            this.sessions.delete(s.id);
            return fail(422, 'bad-hash', { restart: true });
        }
        const refused = this.verdict(s.data);
        if (refused !== null) {
            this.sessions.delete(s.id);
            return fail(refused.status, refused.error);
        }
        s.state = 'stored';
        return this.storedAnswer(s, s.id);
    }

    private status(s: Sess): { status: number; body: Record<string, unknown> } {
        if (s.state === 'duplicate') return this.storedAnswer(this.sessions.get(s.of as string) as Sess, s.id);
        if (s.state === 'stored') {
            s.polls++;
            this.onStatusPoll?.(s.polls, s);
            if (this.autoDeliverAfter !== null && s.polls >= this.autoDeliverAfter) s.channels = { telegram: 'sent', email: 'sent' };
            return { ...this.storedAnswer(s, s.id), body: { ...this.storedAnswer(s, s.id).body, state: 'stored', storedAt: '2026-11-07T10:00:00Z' } };
        }
        return ok(200, { ok: true, state: 'uploading', stored: false, id: s.id, size: s.size, chunks: s.chunks, chunkBytes: s.chunkBytes, held: [...s.held.keys()].sort((a, b) => a - b), delivered: false });
    }
}
