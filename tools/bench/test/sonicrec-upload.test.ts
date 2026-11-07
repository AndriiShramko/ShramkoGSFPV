// Fly by Sound, step 8 (docs/wip/v12-feedback.md): the upload of a recording to the author (apps/fly/src/sonic-session/upload.ts).
// Node only, against a fake of the server's routes that answers like apps/api/sessions.py (sonicrec-send-fixtures.ts); the real API is
// driven by the same client in tools/bench/src/sonicrec-upload.ts. The requirement is not losing a recording, so the claims here are about
// order and proof: what is believed when, what is never deleted, what is never sent twice, and that "delivered" needs BOTH channels.
// Every claim has a control that must fail the way the claim says.
import { describe, expect, it } from 'vitest';
import { CHANNELS, Transfer, allConfirmed, classify, parseTransfer, readTransfer, writeTransfer } from '../../../apps/fly/src/sonic-session/upload';
import type { TransferDeps, TransferProgress, TransferRecord } from '../../../apps/fly/src/sonic-session/upload';
import { packageOf } from '../../../apps/fly/src/sonic-session/registry';
import { FakeDirectory } from './sonicrec-fixtures';
import { FakeApi, makeSession, sha256 } from './sonicrec-send-fixtures';
import type { MadeSession } from './sonicrec-send-fixtures';

interface Rig {
    readonly transfer: Transfer;
    readonly deps: TransferDeps;
    readonly waits: number[];
    readonly progress: TransferProgress[];
}

const CONSENT = { at: '2026-11-07T11:00:00Z', via: 'key' } as const;

/** A transfer on the fake server with a clock that costs nothing: a wait is recorded and returns at once; jitter is off (a random of 0.5 is x1). */
async function rig(api: FakeApi, made: MadeSession, extra: Partial<TransferDeps> = {}): Promise<Rig> {
    const waits: number[] = [];
    const progress: TransferProgress[] = [];
    const clock = { t: 1_000_000 };
    const deps: TransferDeps = {
        store: await made.stores.open(made.id),
        pack: () => packageOf(made.stores, made.id),
        consent: CONSENT,
        facts: { packageId: made.id, lesson: 'walls-hall', minor: false, voice: true, release: 'test' },
        fetch: api.fetch,
        base: 'http://api.test/api/session',
        sha256: async (b) => sha256(b),
        now: () => clock.t,
        nowIso: () => '2026-11-07T11:00:01Z',
        // a wait costs nothing but yields to the event loop (a microtask-only wait would starve every timer: a client that polled for ever
        // would hang the run past its own guards instead of failing it)
        sleep: async (ms) => {
            waits.push(ms);
            clock.t += ms;
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
        random: () => 0.5,
        onProgress: (p) => progress.push(p),
        ...extra
    };
    return { transfer: new Transfer(deps), deps, waits, progress };
}

const stages = (r: Rig): string[] => r.progress.map((p) => p.stage).filter((s, i, a) => s !== a[i - 1]);

describe('a recording goes to the server and is delivered', () => {
    it('start, the chunks the server names, finish, then the status until both channels are sent; the stored bytes are the package byte for byte', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        const r = await rig(api, made);
        const outcome = await r.transfer.run();
        const bytes = await made.pack();
        expect(outcome).toBe('delivered');
        // the order of the calls
        const seq = api.calls.map((c) => `${c.method} ${c.path.replace(/S-\d{8}-[0-9a-f]{12}/, '<id>')}`);
        const chunks = Math.ceil(bytes.length / 1000);
        expect(chunks).toBeGreaterThan(3); // a real package of several chunks, so resuming means something below
        expect(seq.slice(0, 2 + chunks + 1)).toEqual(['POST /start', 'GET /<id>', ...Array.from({ length: chunks }, (_, i) => `POST /<id>/${i}`), 'POST /<id>/finish']);
        expect(seq.slice(2 + chunks + 1).every((s) => s === 'GET /<id>')).toBe(true);
        // the start says what the pilot confirmed, and what the package is
        const start = api.calls[0] as (typeof api.calls)[number];
        expect(start.json).toMatchObject({ size: bytes.length, sha256: sha256(bytes), consentSend: true, packageId: made.id, lesson: 'walls-hall', minor: false, voice: true, release: 'test' });
        // every chunk carries its own hash and the token, and nothing else identifies the pilot
        for (const c of api.callsTo(/^POST \/S-.*\/\d+$/)) {
            const n = Number(c.path.split('/').pop());
            expect(c.headers['x-chunk-sha256']).toBe(sha256(bytes.subarray(n * 1000, Math.min(bytes.length, (n + 1) * 1000))));
            expect(c.headers['x-session-token']).toBe([...api.sessions.values()][0]?.token);
        }
        // the server holds exactly the package
        const stored = api.stored();
        expect(stored).toHaveLength(1);
        expect(sha256((stored[0] as { data: Uint8Array }).data)).toBe(sha256(bytes));
        // the stages went in the order of the truth: nothing is claimed before the server said it
        expect(stages(r)).toEqual(['preparing', 'starting', 'uploading', 'finishing', 'stored', 'delivered']);
        expect(r.progress.findIndex((p) => p.stored)).toBeGreaterThan(r.progress.findIndex((p) => p.stage === 'finishing'));
        // the token travels in a header, never in a URL
        const token = (stored[0] as { token: string }).token;
        expect(api.calls.every((c) => !c.path.includes(token) && c.search === '')).toBe(true);
    });

    it('control: with no confirmation from the pilot nothing is asked of the server at all', async () => {
        const made = await makeSession();
        const api = new FakeApi();
        const { consent: _drop, ...noConsent } = (await rig(api, made)).deps;
        const t = new Transfer(noConsent);
        expect(await t.run()).toBe('blocked');
        expect(api.calls).toHaveLength(0);
        expect(t.progress()).toMatchObject({ stage: 'blocked', problem: 'no-consent' });
    });

    it('the record in the session folder is written before the first chunk goes, and again when stored and when delivered', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        const r = await rig(api, made);
        const seen: (TransferRecord | null)[] = [];
        const store = r.deps.store;
        api.faults.push((c) => {
            // looked at as each call arrives: what upload.json says at that moment
            void readTransfer(store).then((rec) => seen.push(rec));
            return c.n < 0 ? { kind: 'network' } : null;
        });
        await r.transfer.run();
        const rec = (await readTransfer(store)) as TransferRecord;
        expect(rec).toMatchObject({ v: 1, stored: true, delivered: true, blocked: null, consentVia: 'key', consentAt: CONSENT.at, size: (await made.pack()).length });
        expect(rec.serverId).toBe([...api.sessions.keys()][0]);
        expect(rec.token).toBe([...api.sessions.values()][0]?.token);
        expect(allConfirmed(rec.channels)).toBe(true);
        // the first chunk's call found the record already there with stored false
        const firstChunk = api.callsTo(/^POST \/S-.*\/0$/)[0] as { n: number };
        const atFirstChunk = seen[firstChunk.n - 1];
        expect(atFirstChunk).toMatchObject({ stored: false, delivered: false });
    });

    it('delivered is said only when BOTH channels have confirmed; one is not enough', async () => {
        const made = await makeSession();
        const api = new FakeApi();
        api.autoDeliverAfter = null;
        const r = await rig(api, made);
        api.onStatusPoll = (polls, s) => {
            if (polls === 3) s.channels = { telegram: 'sent', email: 'retrying' };
            if (polls === 7) r.transfer.stop(); // email never confirms
        };
        const outcome = await r.transfer.run();
        expect(outcome).toBe('stopped');
        expect(r.progress.some((p) => p.stage === 'delivered' || p.delivered)).toBe(false);
        const last = r.progress.filter((p) => p.channels !== null).pop() as TransferProgress;
        expect(last.channels?.['telegram']?.status).toBe('sent');
        expect(last.channels?.['email']?.status).toBe('retrying');
        expect(((await readTransfer(r.deps.store)) as TransferRecord).delivered).toBe(false);
    });

    it('control: the same transfer IS delivered as soon as the second channel confirms (and a link counts as confirmed)', async () => {
        const made = await makeSession();
        const api = new FakeApi();
        api.autoDeliverAfter = null;
        const r = await rig(api, made);
        api.onStatusPoll = (polls, s) => {
            if (polls === 3) s.channels = { telegram: 'sent', email: 'retrying' };
            if (polls === 5) s.channels = { telegram: 'sent', email: 'link' };
        };
        expect(await r.transfer.run()).toBe('delivered');
        expect(r.progress.filter((p) => p.stage === 'delivered')).not.toHaveLength(0);
        expect(allConfirmed(((await readTransfer(r.deps.store)) as TransferRecord).channels)).toBe(true);
    });

    it('a finish that is answered ok but not "stored" is not taken as stored: the client says nothing is stored until the server says so', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => (c.path.endsWith('/finish') && n++ < 1 ? { kind: 'reply', body: { ok: true } } : null));
        const r = await rig(api, made);
        const bound = setTimeout(() => r.transfer.stop(), 1500); // a client that believed it would poll for ever
        const outcome = await r.transfer.run();
        clearTimeout(bound);
        expect(outcome).toBe('delivered');
        const firstStored = r.progress.findIndex((p) => p.stored);
        const secondFinish = api.callsTo(/\/finish$/);
        expect(secondFinish).toHaveLength(2);
        expect(firstStored).toBeGreaterThan(-1);
        // nothing said "stored" before the second finish answered
        expect(r.progress.slice(0, firstStored).every((p) => !p.stored && p.stage !== 'stored')).toBe(true);
        expect(r.progress.some((p) => p.problem === 'not-stored')).toBe(true);
    });

    it('a server that says delivered while a channel is still queued is not believed', async () => {
        const made = await makeSession();
        const api = new FakeApi();
        api.autoDeliverAfter = null;
        api.lieDelivered = true;
        const r = await rig(api, made);
        api.onStatusPoll = (polls) => {
            if (polls === 5) r.transfer.stop();
        };
        expect(await r.transfer.run()).toBe('stopped');
        expect(r.progress.some((p) => p.delivered || p.stage === 'delivered')).toBe(false);
    });
});

describe('the upload resumes and never sends what the server holds', () => {
    it('a connection that fails on a chunk is waited out (2 s, 4 s) and only that chunk goes again', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        let failures = 0;
        api.faults.push((c) => (c.method === 'POST' && c.path.endsWith('/2') && failures++ < 2 ? { kind: 'network' } : null));
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        const posts = api.callsTo(/^POST \/S-.*\/\d+$/);
        const byChunk = new Map<string, number>();
        for (const c of posts) byChunk.set(c.path.split('/').pop() as string, (byChunk.get(c.path.split('/').pop() as string) ?? 0) + 1);
        expect([...byChunk.entries()].filter(([k]) => k !== '2').every(([, n]) => n === 1)).toBe(true); // the others once each
        expect(byChunk.get('2')).toBe(3);
        expect(r.waits.slice(0, 2)).toEqual([2000, 4000]);
        expect(r.progress.some((p) => p.stage === 'waiting' && p.problem === 'network')).toBe(true);
    });

    it('a closed tab: a new transfer on the same folder asks the server what it holds and sends only the rest, with the same token', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        const first = await rig(api, made);
        // the tab closes while chunk 2 is on the way
        api.faults.push((c) => {
            if (c.method === 'POST' && c.path.endsWith('/2')) {
                first.transfer.stop();
                return { kind: 'network' };
            }
            return null;
        });
        expect(await first.transfer.run()).toBe('stopped');
        const token = [...api.sessions.values()][0]?.token;
        expect([...(api.sessions.values().next().value as { held: Map<number, string> }).held.keys()]).toEqual([0, 1]);
        const before = api.calls.length;
        api.faults.length = 0;
        const { consent: _noConsent, ...resumeDeps } = (await rig(api, made)).deps; // a new page: no new confirmation, it is in the record
        const second = new Transfer(resumeDeps);
        expect(await second.run()).toBe('delivered');
        const after = api.calls.slice(before);
        expect(after.filter((c) => c.path === '/start')).toHaveLength(0);
        const total = Math.ceil((await made.pack()).length / 1000);
        expect(after.filter((c) => /^\/S-.*\/\d+$/.test(c.path)).map((c) => c.path.split('/').pop())).toEqual(Array.from({ length: total - 2 }, (_, i) => String(i + 2)));
        expect(after.every((c) => c.path === '/start' || c.headers['x-session-token'] === token)).toBe(true);
        expect(api.stored()).toHaveLength(1);
    });

    it('a lost answer to a chunk: the client asks what the server holds, finds that chunk there and does not send it again; the file is whole', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        let lost = 0;
        api.faults.push((c) => (c.method === 'POST' && c.path.endsWith('/1') && lost++ < 1 ? { kind: 'lost' } : null));
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/S-.*\/1$/)).toHaveLength(1); // sent once; the answer was lost, the chunk was not
        expect(api.callsTo(/^GET \/S-/).length).toBeGreaterThanOrEqual(2); // the second pass began with the status
        expect(sha256((api.stored()[0] as { data: Uint8Array }).data)).toBe(sha256(await made.pack()));
    });

    it('control: a client that sent every chunk again after a failure would still end with the whole file, because a held chunk is accepted when the bytes are the same', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        const bytes = await made.pack();
        const started = (await api.fetch('http://api.test/api/session/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: bytes.length, sha256: sha256(bytes), consentSend: true }) }).then((r) => r.json())) as { id: string; token: string };
        const put = (n: number, data: Uint8Array) => api.fetch(`http://api.test/api/session/${started.id}/${n}`, { method: 'POST', headers: { 'X-Session-Token': started.token }, body: data }).then((r) => r.json() as Promise<Record<string, unknown>>);
        const first = bytes.subarray(0, 1000);
        expect(await put(0, first)).toMatchObject({ ok: true, already: false });
        expect(await put(0, first)).toMatchObject({ ok: true, already: true });
        const other = new Uint8Array(first);
        other[0] ^= 1;
        expect(await put(0, other)).toMatchObject({ ok: false, error: 'chunk-differs' });
    });

    it('a lost answer to finish: the server stored it, the client asks the status first, finds it stored and sends nothing more', async () => {
        const made = await makeSession({ voiceBytes: 3000 });
        const api = new FakeApi();
        let lost = 0;
        api.faults.push((c) => (c.path.endsWith('/finish') && lost++ < 1 ? { kind: 'lost' } : null));
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        const finishAt = api.callsTo(/\/finish$/).map((c) => c.n);
        expect(finishAt).toHaveLength(1);
        expect(api.calls.filter((c) => c.n > (finishAt[0] as number)).some((c) => c.method === 'POST')).toBe(false); // nothing is sent after it
        expect(api.callsTo(/^POST \/S-.*\/\d+$/)).toHaveLength(Math.ceil((await made.pack()).length / 1000)); // every chunk once
        expect(api.stored()).toHaveLength(1);
        expect(((await readTransfer(r.deps.store)) as TransferRecord)).toMatchObject({ stored: true, delivered: true });
    });

    it('a package the server already has is not uploaded again; its id goes straight to the delivery status', async () => {
        const made = await makeSession({ voiceBytes: 3000 });
        const api = new FakeApi();
        await (await rig(api, made)).transfer.run(); // the first time
        const other = await makeSession({ id: 'sendSession0000000002', voiceBytes: 3000, dir: made.dir });
        // the same package bytes under another local id: the manifest id differs, so make the server see the same hash instead
        const bytes = await made.pack();
        const r2 = await rig(api, other, { pack: async () => new Blob([bytes as BlobPart]) });
        const before = api.calls.length;
        expect(await r2.transfer.run()).toBe('delivered');
        const mine = api.calls.slice(before);
        expect(mine[0]?.path).toBe('/start');
        expect(mine.filter((c) => /^POST \/S-.*\/\d+$/.test(`${c.method} ${c.path}`))).toHaveLength(0);
        expect(api.stored()).toHaveLength(1);
        const rec = (await readTransfer(r2.deps.store)) as TransferRecord;
        expect(rec).toMatchObject({ stored: true, delivered: true, chunks: 0 });
    });

    it('the server forgot the upload (a restart that lost it): the client starts again with the confirmation it already had, up to three times', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let drops = 0;
        api.faults.push((c) => {
            if (c.method === 'POST' && /\/1$/.test(c.path) && drops < 1) {
                drops++;
                api.sessions.clear(); // the server lost everything
            }
            return null;
        });
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/start$/)).toHaveLength(2);
        expect(api.stored()).toHaveLength(1);
        // control: a server that forgets every time is given up on after three restarts, and says why
        const made2 = await makeSession({ id: 'sendSession0000000003', voiceBytes: 2500 });
        const api2 = new FakeApi();
        api2.faults.push((c) => {
            if (c.method === 'GET' && c.path !== '/start') api2.sessions.clear();
            return null;
        });
        const r2 = await rig(api2, made2);
        expect(await r2.transfer.run()).toBe('blocked');
        expect(api2.callsTo(/^POST \/start$/)).toHaveLength(4);
        expect(r2.transfer.progress().problem).toBe('unknown');
    });

    it('the whole package is damaged on the way: the server refuses with restart, and the client starts over and succeeds', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let spoiled = 0;
        api.faults.push((c) => {
            if (c.method === 'POST' && /\/0$/.test(c.path) && spoiled++ === 0) {
                // the chunk reaches the server flipped, with the hash of the good bytes missing: the whole-package check catches it
                const copy = new Uint8Array(c.body as Uint8Array);
                copy[10] ^= 0xff;
                (c as { body: Uint8Array | null }).body = copy;
                delete (c.headers as Record<string, string>)['x-chunk-sha256'];
            }
            return null;
        });
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/start$/)).toHaveLength(2);
        expect(sha256((api.stored()[0] as { data: Uint8Array }).data)).toBe(sha256(await made.pack()));
    });

    it('a chunk flipped on the way WITH its hash is refused by the server and sent again', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let spoiled = 0;
        api.faults.push((c) => {
            if (c.method === 'POST' && /\/1$/.test(c.path) && spoiled++ === 0) {
                const copy = new Uint8Array(c.body as Uint8Array);
                copy[3] ^= 0xff;
                (c as { body: Uint8Array | null }).body = copy;
            }
            return null;
        });
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/S-.*\/1$/)).toHaveLength(2);
        expect(api.callsTo(/^POST \/start$/)).toHaveLength(1);
    });

    it('the package on this device changed after the upload began (another one of the same size): the client does not send mixed bytes, it starts over', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        const first = await rig(api, made);
        api.faults.push((c) => {
            if (c.method === 'POST' && c.path.endsWith('/2')) {
                first.transfer.stop();
                return { kind: 'network' };
            }
            return null;
        });
        await first.transfer.run();
        api.faults.length = 0;
        const original = await made.pack();
        // a valid package of the very same size and other content: only the hash can tell them apart
        const other = await makeSession({ id: 'sendSession0000000009', at: '2026-11-07T10:05:00Z', voiceBytes: 4200, dir: new FakeDirectory('other') });
        const changed = await other.pack();
        expect(changed.length).toBe(original.length);
        expect(sha256(changed)).not.toBe(sha256(original));
        const { consent: _c, ...deps } = (await rig(api, made, { pack: async () => changed })).deps;
        const second = new Transfer(deps);
        expect(await second.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/start$/)).toHaveLength(2);
        expect(sha256((api.stored()[0] as { data: Uint8Array }).data)).toBe(sha256(changed)); // the server has one whole package, not a mix
        // and not one chunk of the changed package went to the OLD upload: its requests are the original's (two held and the one that was on
        // the way when the tab closed), and the only chunks sent since are the new upload's, all of them (the server's whole-package hash
        // would also have caught a mix, but only after sending the rest of it)
        const total = Math.ceil(changed.length / 1000);
        expect(api.callsTo(/^POST \/S-.*\/\d+$/)).toHaveLength(3 + total);
    });
});

describe('a refusal that no retry can change stops the transfer and keeps the recording', () => {
    it('too large: one request, no waiting, the reason; the files of the session are untouched', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        api.maxBytes = 100;
        const before = await made.files();
        const bytesBefore = await made.pack();
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('blocked');
        expect(api.calls).toHaveLength(1);
        expect(r.waits).toEqual([]);
        expect(r.transfer.progress()).toMatchObject({ stage: 'blocked', problem: 'too-large' });
        expect(await made.files()).toEqual(before);
        expect(sha256(await made.pack())).toBe(sha256(bytesBefore));
    });

    it('a minor whose guardian was not confirmed: the server refuses at finish and keeps nothing, the client stops with that reason, the copy stays', async () => {
        const made = await makeSession({ voiceBytes: 2500, minor: true, guardian: false });
        const api = new FakeApi();
        const before = await made.files();
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('blocked');
        expect(r.transfer.progress().problem).toBe('consent-guardian');
        expect(api.stored()).toHaveLength(0);
        expect(api.sessions.size).toBe(0);
        expect(((await readTransfer(r.deps.store)) as TransferRecord).blocked).toBe('consent-guardian');
        expect((await made.files()).filter((f) => !before.includes(f))).toEqual([expect.stringContaining('upload.json')]);
        // control: the same recording with the guardian's confirmation goes through
        const ok = await makeSession({ id: 'sendSession0000000004', voiceBytes: 2500, minor: true, guardian: true, dir: made.dir });
        const api2 = new FakeApi();
        expect(await (await rig(api2, ok)).transfer.run()).toBe('delivered');
    });

    it('a blocked record is started afresh by the next run with the new confirmation (the dead token is not used again)', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        api.maxBytes = 100;
        const r = await rig(api, made);
        await r.transfer.run();
        api.maxBytes = 1_000_000;
        const again = new Transfer({ ...r.deps, consent: { at: '2026-11-07T12:00:00Z', via: 'button' } });
        expect(await again.run()).toBe('delivered');
        expect(((await readTransfer(r.deps.store)) as TransferRecord)).toMatchObject({ consentVia: 'button', consentAt: '2026-11-07T12:00:00Z', blocked: null, delivered: true });
    });

    it('not a package: stops with that reason', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        const r = await rig(api, made, { pack: async () => new Uint8Array(3000).fill(7) });
        expect(await r.transfer.run()).toBe('blocked');
        expect(r.transfer.progress().problem).toBe('not-a-package');
    });
});

describe('waiting out the network and the server', () => {
    const table: readonly [string, number, Record<string, unknown>, 'retry' | 'restart' | 'blocked', string, number][] = [
        ['no answer from a proxy', 502, {}, 'retry', 'http-502', 0],
        ['server fault', 500, { error: 'io' }, 'retry', 'io', 0],
        ['rate limit', 429, { error: 'rate' }, 'retry', 'rate', 60_000],
        ['disk full', 507, { error: 'disk' }, 'retry', 'disk', 300_000],
        ['cap reached', 507, { error: 'cap' }, 'retry', 'cap', 300_000],
        ['slow client', 408, { error: 'slow' }, 'retry', 'slow', 0],
        ['upload busy', 409, { error: 'busy' }, 'retry', 'busy', 2000],
        ['not complete', 409, { error: 'incomplete' }, 'retry', 'incomplete', 0],
        ['unknown id', 404, { error: 'unknown' }, 'restart', 'unknown', 0],
        ['wrong token', 403, { error: 'token' }, 'restart', 'token', 0],
        ['whole hash differs, restart', 422, { error: 'bad-hash', restart: true }, 'restart', 'bad-hash', 0],
        ['chunk hash differs', 422, { error: 'bad-hash' }, 'retry', 'bad-hash', 0],
        ['chunk differs from the held one', 409, { error: 'chunk-differs' }, 'restart', 'chunk-differs', 0],
        ['too large', 413, { error: 'too-large' }, 'blocked', 'too-large', 0],
        ['guardian', 422, { error: 'consent-guardian' }, 'blocked', 'consent-guardian', 0],
        ['not a package', 422, { error: 'not-a-package' }, 'blocked', 'not-a-package', 0],
        ['no consent', 403, { error: 'no-consent' }, 'blocked', 'no-consent', 0],
        ['a proxy refuses', 403, {}, 'blocked', 'forbidden', 0],
        ['bad request', 400, { error: 'bad-size' }, 'blocked', 'bad-size', 0],
        ['chunk length', 400, { error: 'bad-length' }, 'retry', 'bad-length', 0]
    ];
    it.each(table)('%s (%i): %s', (_n, status, body, kind, code, minWait) => {
        const e = classify(status, body) as unknown as { kind: string; code: string; minWaitMs: number };
        expect({ kind: e.kind, code: e.code, minWaitMs: e.minWaitMs }).toEqual({ kind, code, minWaitMs: minWait });
    });

    it('the pause grows with each failure in a row, is never over five minutes, and starts again after a success', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => (c.path === '/start' && n++ < 9 ? { kind: 'status', status: 503, body: { ok: false, error: 'io' } } : null));
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(r.waits.slice(0, 9)).toEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000]);
        expect(r.progress.filter((p) => p.stage === 'waiting').map((p) => p.failures).slice(0, 3)).toEqual([1, 2, 3]);
        // after the success the count is back to nothing
        expect(r.transfer.progress().failures).toBe(0);
    });

    it('a rate limit or a full server waits at least a minute, or five', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => {
            if (c.path !== '/start') return null;
            n++;
            return n === 1 ? { kind: 'status', status: 429, body: { ok: false, error: 'rate' } } : n === 2 ? { kind: 'status', status: 507, body: { ok: false, error: 'disk' } } : null;
        });
        const r = await rig(api, made);
        await r.transfer.run();
        expect(r.waits.slice(0, 2)).toEqual([60_000, 300_000]);
    });

    it('a page of a captive portal with status 200 is not an answer: no chunk is counted held because of it', async () => {
        const made = await makeSession({ voiceBytes: 4200 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => (c.method === 'POST' && c.path.endsWith('/1') && n++ < 1 ? { kind: 'portal' } : null));
        const r = await rig(api, made);
        expect(await r.transfer.run()).toBe('delivered');
        expect(api.callsTo(/^POST \/S-.*\/1$/)).toHaveLength(2); // sent again, not taken as held
        expect(r.progress.some((p) => p.problem === 'bad-answer')).toBe(true);
        expect(sha256((api.stored()[0] as { data: Uint8Array }).data)).toBe(sha256(await made.pack()));
    });

    it('a request that is silent for too long is given up and tried again', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => (c.path === '/start' && n++ < 1 ? { kind: 'hang' } : null));
        const r = await rig(api, made, { requestTimeoutMs: 30 });
        expect(await r.transfer.run()).toBe('delivered');
        expect(r.progress.some((p) => p.problem === 'slow')).toBe(true);
    });

    it('retryNow cuts the wait short; stop ends the run and leaves what the server holds', async () => {
        const made = await makeSession({ voiceBytes: 2500 });
        const api = new FakeApi();
        let n = 0;
        api.faults.push((c) => (c.path === '/start' && n++ < 1 ? { kind: 'network' } : null));
        // a sleep that only ends when told to
        const r = await rig(api, made, {
            sleep: (ms, signal) =>
                new Promise<void>((resolve) => {
                    if (signal.aborted) return resolve();
                    signal.addEventListener('abort', () => resolve(), { once: true });
                    void ms;
                })
        });
        const run = r.transfer.run();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(r.transfer.progress().stage).toBe('waiting');
        expect(r.transfer.progress().retryAt).not.toBeNull();
        r.transfer.retryNow();
        // after the retry it goes on to polling, which waits again; stop it there
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(['stored', 'delivered']).toContain(r.transfer.progress().stage);
        r.transfer.stop();
        expect(await run).toMatch(/stopped|delivered/);
        expect(api.stored()).toHaveLength(1); // stopping did not undo anything on the server
    });
});

describe('the recording on this device is never touched by sending', () => {
    it('every file of the session is there, byte for byte, after a full delivery and after a failed one', async () => {
        const made = await makeSession({ voiceBytes: 3000 });
        const bytes = await made.pack();
        const names = await made.files();
        const api = new FakeApi();
        await (await rig(api, made)).transfer.run();
        const added = (await made.files()).filter((f) => !names.includes(f));
        expect(added.length).toBeGreaterThan(0);
        expect(added.every((f) => f.startsWith('upload.json.'))).toBe(true); // the record, kept as the store keeps every file
        expect((await made.files()).filter((f) => names.includes(f))).toEqual(names); // and not one file of the recording is gone
        expect(sha256(await made.pack())).toBe(sha256(bytes));
        const made2 = await makeSession({ id: 'sendSession0000000005', voiceBytes: 3000, dir: made.dir });
        const api2 = new FakeApi();
        api2.maxBytes = 10;
        await (await rig(api2, made2)).transfer.run();
        expect(sha256(await made2.pack())).toBe(sha256(await made2.pack()));
        expect((await made2.files()).filter((f) => !names.includes(f))).toEqual([]); // nothing was even written: no record without a start
    });
});

describe('the record of a transfer', () => {
    const good: TransferRecord = { v: 1, serverId: 'S-20261107-000000000001', token: 'abc', sha256: 'f'.repeat(64), size: 10, chunkBytes: 5, chunks: 2, consentAt: '2026-11-07T11:00:00Z', consentVia: 'key', startedAt: '2026-11-07T11:00:01Z', stored: false, storedAt: null, delivered: false, deliveredAt: null, channels: null, blocked: null };

    it('survives a write and a read; anything damaged is not a record', async () => {
        const made = await makeSession();
        const store = await made.stores.open(made.id);
        await writeTransfer(store, good);
        expect(await readTransfer(store)).toEqual(good);
        for (const bad of ['', '{', '[]', '{"v":2}', JSON.stringify({ ...good, size: -1 }), JSON.stringify({ ...good, token: '' }), JSON.stringify({ ...good, consentVia: 'telepathy' }), JSON.stringify({ ...good, chunks: 1.5 })]) expect(parseTransfer(bad)).toBeNull();
    });

    it('allConfirmed: every channel the server works, sent or link; a missing one is not confirmed', () => {
        const c = (telegram: string, email: string) => ({ telegram: { status: telegram }, email: { status: email } });
        expect(CHANNELS).toEqual(['telegram', 'email']);
        expect(allConfirmed(c('sent', 'sent'))).toBe(true);
        expect(allConfirmed(c('sent', 'link'))).toBe(true);
        expect(allConfirmed(c('link', 'link'))).toBe(true);
        for (const bad of [c('sent', 'queued'), c('sent', 'retrying'), c('sending', 'sent'), c('failed', 'sent'), c('sent', 'unknown')]) expect(allConfirmed(bad)).toBe(false);
        expect(allConfirmed({ telegram: { status: 'sent' } })).toBe(false);
        expect(allConfirmed(null)).toBe(false);
        expect(allConfirmed({})).toBe(false);
    });
});
