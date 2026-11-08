// Fly by Sound, step 3 (docs/wip/v12-feedback.md): the recordings kept on this device, saved to disk and offered again.
//   registry   which sessions are in storage and in what state, keep (recover) one, pack one into a .zip, delete one
//   save       the .zip through the file picker or as a download, and what happens when the person closes the picker
//   resume     the unfinished recording of an earlier visit offered at the next start ("Press T to keep it")
// Node only, on the in-memory file system of sonicrec-fixtures.ts; the panel's buttons and a real download are tried in
// tools/bench/src/sonicrec-local.ts. Every claim has a control that must fail the way the claim says.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionWriter, readPackage } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, SpeechLine } from '../../../packages/sonic-fpv/src';
import { buildManifestInput } from '../../../apps/fly/src/sonic-session/manifest-input';
import { consentFor, newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { deleteSession, describeSession, keepSession, listSessions, packageOf, readNotes, writeNotes } from '../../../apps/fly/src/sonic-session/registry';
import { RegistryError } from '../../../apps/fly/src/sonic-session/reasons';
import { ResumeOffer } from '../../../apps/fly/src/sonic-session/resume';
import { browserSaveEnv, packageFileName, saveToDisk } from '../../../apps/fly/src/sonic-session/save';
import type { SaveEnv } from '../../../apps/fly/src/sonic-session/save';
import { formatBytes, formatClock, formatWhen } from '../../../apps/fly/src/sonic-session/format';
import { listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import type { SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { FakeDirectory, fakeRuntime, nodeGzip } from './sonicrec-fixtures';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';

const ids = { done: 'doneSession00000000001', cut: 'cutSession000000000002', old: 'oldSession00000000003', busy: 'busySession0000000004', empty: 'emptySession000000005' };

function stores(dir: FakeDirectory): SessionStores {
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

/** A session in the folder: `finish` ends it, else it is a recording cut off after its flush. `at`: the start, ISO. */
async function makeSession(dir: FakeDirectory, id: string, at: string, finish: boolean, voice = true): Promise<void> {
    const store = await openSessionStore(dir, id);
    const profile = newProfile();
    const manifest = buildManifestInput({
        runtime: fakeRuntime('walls-hall').runtime,
        env: { release: { sha: 'test', sonic: 'test' }, locale: 'en', userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] },
        consent: consentFor(profile, { voice, at }),
        profile,
        startIso: at,
        id
    });
    const w = await SessionWriter.start({ sink: store, manifest, gzip: nodeGzip, chunkFrames: 30 });
    if (voice) w.setVoiceOffset(5);
    for (const f of frames(75)) w.frame(f);
    w.event({ t: 100, kind: 'checkpoint', id: 'cp' });
    if (voice) w.voice(new Uint8Array(2000).fill(7));
    if (finish) await w.finish({ ended: new Date(Date.parse(at) + 2500).toISOString() });
    else await w.flush();
}

const never = async (): Promise<boolean> => false;

describe('the registry of recordings on this device', () => {
    it('lists finished, interrupted and unreadable sessions, newest first, with sizes and lengths', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.old, '2026-11-06T09:00:00Z', true);
        await makeSession(dir, ids.done, '2026-11-07T10:00:00Z', true);
        await makeSession(dir, ids.cut, '2026-11-07T11:00:00Z', false);
        await dir.getDirectoryHandle(ids.empty, { create: true }); // a folder whose first write never finished
        const list = await listSessions(stores(dir), never);
        expect(list.map((e) => `${e.id.slice(0, 4)}:${e.state}`)).toEqual(['cutS:unfinished', 'done:finished', 'oldS:finished', 'empt:unreadable']);
        const done = list.find((e) => e.id === ids.done)!;
        expect(done).toMatchObject({ complete: true, voice: true, locked: false, problem: null });
        expect(done.durationMs).toBe(2500);
        expect(done.bytes).toBeGreaterThan(2000);
        expect(list.find((e) => e.id === ids.empty)?.problem).toBe('no manifest.json');
        expect(list.find((e) => e.id === ids.cut)?.manifest?.ended).toBeNull();
    });

    it('a session another tab is recording is marked locked and left alone: not recovered, not deleted', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.busy, '2026-11-07T10:00:00Z', false);
        const busy = async (id: string): Promise<boolean> => id === ids.busy;
        expect((await describeSession(stores(dir), ids.busy, busy)).locked).toBe(true);
        // a code the panel says in the page's language (reasons.ts), not an English sentence
        await expect(keepSession(stores(dir), ids.busy, busy, () => 'x')).rejects.toMatchObject({ name: 'RegistryError', code: 'locked' });
        await expect(deleteSession(stores(dir), ids.busy, busy)).rejects.toBeInstanceOf(RegistryError);
        await expect(deleteSession(stores(dir), ids.busy, busy)).rejects.toSatisfy((e: Error) => !/another tab/.test(e.message));
        expect(await listSessionIds(dir)).toEqual([ids.busy]);
        // control: with no lock the same call recovers it
        const kept = await keepSession(stores(dir), ids.busy, never, () => '2026-11-07T12:00:00Z', { gzip: nodeGzip });
        expect(kept.manifest.complete).toBe(false);
    });

    it('keeping an interrupted session brings it back to one that packs and reads strictly, marked as not complete', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.cut, '2026-11-07T11:00:00Z', false);
        // control: before it is kept, the session cannot be packed (nothing lists its files)
        const err = (await packageOf(stores(dir), ids.cut).catch((e: unknown) => e)) as RegistryError;
        expect(err).toBeInstanceOf(RegistryError);
        expect(err.code).toBe('cannot-pack');
        expect(err.detail.length).toBeGreaterThan(5); // the sound package's own technical note, which the panel shows inside the sentence of the code
        expect(err.message).not.toMatch(/the recording cannot be packed/);
        const report = await keepSession(stores(dir), ids.cut, never, () => '2026-11-07T12:00:00Z', { gzip: nodeGzip });
        expect(report.frames).toBe(75); // the writer was flushed before the tab went: all 75 frames are in storage
        const entry = await describeSession(stores(dir), ids.cut, never);
        expect(entry).toMatchObject({ state: 'finished', complete: false });
        expect(entry.notes.recoveredAt).toBe('2026-11-07T12:00:00Z');
        const blob = await packageOf(stores(dir), ids.cut);
        const pkg = readPackage(new Uint8Array(await blob.arrayBuffer()));
        expect(pkg.frames).toHaveLength(75);
        expect(pkg.manifest.complete).toBe(false);
        expect(pkg.events.some((e) => e.kind === 'session' && e.what === 'recovered')).toBe(true);
        expect(pkg.problems).toEqual([]);
    });

    it('a finished session packs into the same bytes every time, and what this device remembers is separate from the package', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.done, '2026-11-07T10:00:00Z', true);
        const a = new Uint8Array(await (await packageOf(stores(dir), ids.done)).arrayBuffer());
        await writeNotes(await openSessionStore(dir, ids.done), { savedAt: '2026-11-07T10:05:00Z', savedVia: 'download' });
        const b = new Uint8Array(await (await packageOf(stores(dir), ids.done)).arrayBuffer());
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
        expect(await readNotes(await openSessionStore(dir, ids.done))).toEqual({ savedAt: '2026-11-07T10:05:00Z', savedVia: 'download' });
        expect(readPackage(a).manifest.files.map((f) => f.name)).not.toContain('local.json');
        // notes add up, they do not replace each other
        await writeNotes(await openSessionStore(dir, ids.done), { recoveredAt: 'x' });
        expect(await readNotes(await openSessionStore(dir, ids.done))).toEqual({ savedAt: '2026-11-07T10:05:00Z', savedVia: 'download', recoveredAt: 'x' });
    });

    it('delete removes the folder and nothing else', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.done, '2026-11-07T10:00:00Z', true);
        await makeSession(dir, ids.old, '2026-11-06T09:00:00Z', true);
        await deleteSession(stores(dir), ids.done, never);
        expect(await listSessionIds(dir)).toEqual([ids.old]);
        expect((await describeSession(stores(dir), ids.old, never)).state).toBe('finished');
    });
});

describe('saving to disk', () => {
    const blob = new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], { type: 'application/zip' });
    const name = 'fly-by-sound-20261107-100000-doneSess.zip';
    /** the file type's description in the save dialog: the page's language, given by the caller from the dictionaries (v12-int step 9) */
    const label = 'a description from the dictionaries';

    function env(over: Partial<SaveEnv> = {}) {
        const written: Blob[] = [];
        const downloads: { name: string; size: number }[] = [];
        let closed = 0;
        const e: SaveEnv = {
            picker: async (o) => {
                expect(o.suggestedName).toBe(name);
                expect(o.types[0]?.accept).toEqual({ 'application/zip': ['.zip'] });
                expect(o.types[0]?.description).toBe(label); // never a text of the code's own
                return { createWritable: async () => ({ write: async (b: Blob) => void written.push(b), close: async () => void closed++ }) };
            },
            download: (b, n) => void downloads.push({ name: n, size: b.size }),
            ...over
        };
        return { e, written, downloads, closed: () => closed };
    }

    it('the file name is the start of the recording in UTC and the first characters of its random id', () => {
        expect(packageFileName({ id: 'doneSession00000000001', created: '2026-11-07T10:00:00Z' })).toBe(name);
        expect(packageFileName({ id: 'a-b_c', created: 'not a date' })).toBe('fly-by-sound-unknown-time-abc.zip');
        expect(packageFileName({ id: 'AbCdEfGhIjKlMnOp', created: '2026-01-02T03:04:05.678Z' })).toBe('fly-by-sound-20260102-030405-AbCdEfGh.zip');
    });

    it('through the picker the blob is written whole and closed, and nothing is downloaded', async () => {
        const s = env();
        expect(await saveToDisk(blob, name, s.e, label)).toBe('picker');
        expect(s.written).toEqual([blob]);
        expect(s.closed()).toBe(1);
        expect(s.downloads).toEqual([]);
    });

    it('a person who closes the picker has said no: nothing is saved, nothing is downloaded behind their back', async () => {
        const s = env({ picker: async () => { throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }); } });
        expect(await saveToDisk(blob, name, s.e, label)).toBe('cancelled');
        expect(s.downloads).toEqual([]);
        // control: any other refusal of the picker falls back to the download
        const refused = env({ picker: async () => { throw Object.assign(new Error('needs a gesture'), { name: 'SecurityError' }); } });
        expect(await saveToDisk(blob, name, refused.e, label)).toBe('download');
        expect(refused.downloads).toEqual([{ name, size: blob.size }]);
    });

    it('without a picker the download carries it; a write that fails is reported, not swallowed', async () => {
        const noPicker = env({ picker: null });
        expect(await saveToDisk(blob, name, noPicker.e, label)).toBe('download');
        expect(noPicker.downloads).toEqual([{ name, size: 7 }]);
        const broken = env({ picker: async () => ({ createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => undefined }) }) });
        await expect(saveToDisk(blob, name, broken.e, label)).rejects.toThrow('disk full');
    });

    it('the browser\'s own env hands a download to an anchor with the file name', () => {
        const clicks: { href: string; download: string }[] = [];
        const anchor = { href: '', download: '', rel: '', click() { clicks.push({ href: this.href, download: this.download }); }, remove() {} };
        vi.stubGlobal('document', { createElement: () => anchor, body: { append() {} } });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL() {} }));
        const e = browserSaveEnv();
        expect(e.picker).toBeNull(); // Node has no showSaveFilePicker
        e.download(blob, name);
        expect(clicks).toEqual([{ href: 'blob:test', download: name }]);
        vi.unstubAllGlobals();
    });
});

describe('the formatters of the panel', () => {
    it('sizes, clocks and dates', () => {
        expect(['12', '999', '1000', '640000', '2400000', '1500000000'].map((n) => formatBytes(Number(n)))).toEqual(['12 B', '999 B', '1 KB', '640 KB', '2.4 MB', '1.5 GB']);
        expect(formatBytes(-1)).toBe('-');
        expect([0, 59_999, 252_000, 3_723_000].map(formatClock)).toEqual(['0:00', '0:59', '4:12', '1:02:03']);
        expect(formatWhen('not a date', 'en')).toBe('not a date');
        expect(formatWhen('2026-11-07T10:30:00Z', 'en')).toMatch(/2026/);
        expect(formatWhen('2026-11-07T10:30:00Z', 'xx-invalid-locale-!!')).toMatch(/2026/);
    });
});

describe('the offer to keep an unfinished recording at the next start', () => {
    function offer(dir: FakeDirectory, locked: (id: string) => Promise<boolean> = never) {
        const said: SpeechLine[] = [];
        let changes = 0;
        const r = new ResumeOffer({ stores: stores(dir), isLocked: locked, nowIso: () => '2026-11-08T08:00:00Z', say: (l) => void said.push(l), keyLabel: (c) => c.replace('Key', ''), gzip: nodeGzip, onChange: () => void changes++ });
        return { r, said, changes: () => changes };
    }

    it('says once, in the package\'s words, which key keeps it; the oldest is offered first', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.old, '2026-11-05T09:00:00Z', false);
        await makeSession(dir, ids.cut, '2026-11-07T11:00:00Z', false);
        await makeSession(dir, ids.done, '2026-11-06T10:00:00Z', true); // finished: not offered
        const { r, said } = offer(dir);
        expect(await r.scan()).toEqual([ids.old, ids.cut]);
        expect(said).toEqual([{ key: 'rec.recover', params: { key: 'T' } }]);
        await r.scan(); // a second look in the same page says nothing more
        expect(said).toHaveLength(1);
    });

    it('T keeps the oldest, says it is saved, offers the next; when none is left it says nothing more', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.old, '2026-11-05T09:00:00Z', false);
        await makeSession(dir, ids.cut, '2026-11-07T11:00:00Z', false);
        const { r, said } = offer(dir);
        await r.scan();
        said.length = 0;
        const first = await r.keepNext();
        expect(first?.id).toBe(ids.old);
        expect(first).toMatchObject({ state: 'finished', complete: false });
        expect(said.map((l) => l.key)).toEqual(['rec.saved', 'rec.recover']);
        expect(r.pending).toEqual([ids.cut]);
        said.length = 0;
        await r.keepNext();
        expect(said.map((l) => l.key)).toEqual(['rec.saved']);
        expect(r.pending).toEqual([]);
        expect(await r.keepNext()).toBeNull();
        expect(said).toHaveLength(1);
        for (const id of [ids.old, ids.cut]) expect((await describeSession(stores(dir), id, never)).notes.recoveredAt).toBe('2026-11-08T08:00:00Z');
    });

    it('offers nothing when nothing is unfinished, and nothing that another tab is recording', async () => {
        const none = new FakeDirectory('sonic-sessions');
        await makeSession(none, ids.done, '2026-11-06T10:00:00Z', true);
        const quiet = offer(none);
        expect(await quiet.r.scan()).toEqual([]);
        expect(quiet.said).toEqual([]);
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.busy, '2026-11-07T11:00:00Z', false);
        const o = offer(dir, async (id) => id === ids.busy);
        expect(await o.r.scan()).toEqual([]);
        expect(o.said).toEqual([]);
        // control: the same session with no lock is offered
        expect(await offer(dir).r.scan()).toEqual([ids.busy]);
    });

    it('not now: a dismissed session stays as it is and is not pressed on the pilot again in this page; it is offered at the next start', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        await makeSession(dir, ids.cut, '2026-11-07T11:00:00Z', false);
        const { r } = offer(dir);
        await r.scan();
        r.dismiss(ids.cut);
        expect(r.pending).toEqual([]);
        expect((await describeSession(stores(dir), ids.cut, never)).state).toBe('unfinished');
        expect(await offer(dir).r.scan()).toEqual([ids.cut]); // the next page
    });

    it('a storage that cannot be read offers nothing and does not throw', async () => {
        const broken: SessionStores = { durable: true, create: async () => { throw new Error('x'); }, open: async () => { throw new Error('x'); }, list: async () => { throw new Error('storage gone'); }, remove: async () => undefined };
        const said: SpeechLine[] = [];
        const r = new ResumeOffer({ stores: broken, isLocked: never, nowIso: () => 'x', say: (l) => void said.push(l), keyLabel: (c) => c });
        expect(await r.scan()).toEqual([]);
        expect(said).toEqual([]);
    });
});

describe('T in the flight page while a recording waits for an answer', () => {
    let mod: typeof import('../../../apps/fly/src/sonic-session/session');
    beforeAll(async () => {
        class FakeElement { isContentEditable = false; }
        vi.stubGlobal('HTMLElement', FakeElement);
        vi.stubGlobal('HTMLInputElement', class extends FakeElement { type = 'text'; });
        vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {});
        vi.stubGlobal('HTMLSelectElement', class extends FakeElement {});
        vi.stubGlobal('location', { pathname: '/en/fly/', search: '' });
        vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
        vi.stubGlobal('addEventListener', () => undefined);
        vi.stubGlobal('removeEventListener', () => undefined);
        mod = await import('../../../apps/fly/src/sonic-session/session');
    });

    const press = (keys: KeyRouter, code: string): string | null =>
        keys.route({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {} } as unknown as KeyboardEvent);

    it('the first T keeps the interrupted recording the pilot was told about; only the next T asks about a new one', async () => {
        const fake = fakeRuntime('walls-hall');
        const keys = new KeyRouter();
        const ctx = { keys, events: new Bus<AppEvents>(), sonic: fake.runtime, session: { transform: { s: 1, t: [0, 0, 0] } }, controls: { source: 'keyboard', profile: null }, renderer: { isWebGPU: false } } as unknown as FlightContext;
        const s = mod.createSonicSession(ctx);
        // an earlier visit left a recording cut off in this page's storage (the browser's memory store stands in for OPFS here)
        const store = await s.stores.create(ids.cut);
        const profile = newProfile();
        const w = await SessionWriter.start({
            sink: store,
            manifest: buildManifestInput({ runtime: fake.runtime, env: { release: { sha: 't', sonic: 't' }, locale: 'en', userAgent: 'v', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] }, consent: consentFor(profile, { voice: false, at: '2026-11-07T11:00:00Z' }), profile, startIso: '2026-11-07T11:00:00Z', id: ids.cut }),
            gzip: nodeGzip,
            chunkFrames: 30
        });
        for (const f of frames(75)) w.frame(f);
        await w.flush();
        expect(await s.resume.scan()).toEqual([ids.cut]);
        expect(fake.spoken.map((l) => l.key)).toEqual(['rec.recover']);
        expect(press(keys, 'KeyT')).toBe('sonic.record');
        const t0 = Date.now();
        while (s.resume.pending.length > 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 5));
        await new Promise((r) => setTimeout(r, 30));
        expect(s.recorder.phase).toBe('idle'); // that T answered the offer, it did not start a recording
        expect(fake.spoken.map((l) => l.key)).toEqual(['rec.recover', 'rec.saved']);
        expect((await describeSession(s.stores, ids.cut, never)).complete).toBe(false);
        press(keys, 'KeyT');
        expect(s.recorder.phase).toBe('asking'); // the next T is the recorder's
        s.dispose();
    });
});
