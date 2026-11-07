// Fly by Sound, step 2 (docs/wip/v12-feedback.md): the chunk store on the origin private file system
// (apps/fly/src/sonic-session/store.ts) under the failures that decide whether a recording survives: a write that
// fails (the quota), a tab that dies with a write in flight, a replace that is cut off between its two halves. The file
// system is an in-memory fake with those failure modes (sonicrec-fixtures.ts); the browser's real OPFS is tried in
// tools/bench/src/sonicrec-recorder.ts. Every claim has a control that must fail the way the claim says.
import { describe, expect, it } from 'vitest';
import { MemorySink, SessionWriter, packSession, readPackage, recoverSession, utf8Decode, utf8Encode } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, SessionEvent } from '../../../packages/sonic-fpv/src';
import { OpfsChunkStore, listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import { FakeDirectory, QuotaError, nodeGzip } from './sonicrec-fixtures';
import { buildManifestInput } from '../../../apps/fly/src/sonic-session/manifest-input';
import { consentFor, newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { fakeRuntime } from './sonicrec-fixtures';

const text = (b: Uint8Array | null): string | null => (b === null ? null : utf8Decode(b));
const bytes = (s: string): Uint8Array => utf8Encode(s);

/** What a reader gets that ignores the epoch rule: every part of a name, in name order. The control of the replace test. */
async function readIgnoringEpochs(dir: FakeDirectory, name: string): Promise<string> {
    const parts = dir.names().filter((n) => n.startsWith(`${name}.e`) && n.endsWith('.part')).sort();
    return parts.map((n) => utf8Decode((dir.files.get(n) as { bytes: Uint8Array }).bytes)).join('');
}

describe('OpfsChunkStore', () => {
    it('appends parts and reads them back in order, empty files included', async () => {
        const dir = new FakeDirectory('s');
        const store = new OpfsChunkStore(dir);
        await store.append('events.jsonl', bytes('one\n'));
        await store.append('events.jsonl', bytes('two\n'));
        await store.append('voice.webm', new Uint8Array([1, 2, 3]));
        await store.replace('survey.json', new Uint8Array(0));
        expect(text(await store.read('events.jsonl'))).toBe('one\ntwo\n');
        expect(Array.from((await store.read('voice.webm')) as Uint8Array)).toEqual([1, 2, 3]);
        expect((await store.read('survey.json'))?.length).toBe(0);
        expect(await store.read('nothing.json')).toBeNull();
        expect(await store.list()).toEqual(['events.jsonl', 'survey.json', 'voice.webm']);
        expect(await store.size('events.jsonl')).toBe(8);
        // one small file per chunk, named so that no other file in the folder can be taken for a part
        expect(dir.names()).toEqual(['events.jsonl.e0.000000.part', 'events.jsonl.e0.000001.part', 'survey.json.e0.000000.part', 'voice.webm.e0.000000.part']);
    });

    it('replace swaps the whole file and later appends go after the new content', async () => {
        const dir = new FakeDirectory('s');
        const store = new OpfsChunkStore(dir);
        await store.append('manifest.json', bytes('old a'));
        await store.append('manifest.json', bytes(' old b'));
        await store.replace('manifest.json', bytes('NEW'));
        expect(text(await store.read('manifest.json'))).toBe('NEW');
        expect(dir.names()).toEqual(['manifest.json.e1.000000.part']);
        await store.append('manifest.json', bytes('+more'));
        expect(text(await store.read('manifest.json'))).toBe('NEW+more');
    });

    it('a replace cut off before its old parts are deleted reads as the NEW content, in this tab and after a restart', async () => {
        const dir = new FakeDirectory('s');
        const store = new OpfsChunkStore(dir);
        await store.append('manifest.json', bytes('{"v":1}'));
        dir.faults.removeFails = true; // the delete of the old part never happens: the tab dies right there
        await store.replace('manifest.json', bytes('{"v":2}'));
        expect(dir.names()).toEqual(['manifest.json.e0.000000.part', 'manifest.json.e1.000000.part']);
        expect(text(await store.read('manifest.json'))).toBe('{"v":2}');
        // a new tab: the index is rebuilt from the file names alone
        const again = new OpfsChunkStore(dir);
        expect(text(await again.read('manifest.json'))).toBe('{"v":2}');
        // control: a reader without the epoch rule joins old and new into something that is neither
        expect(await readIgnoringEpochs(dir, 'manifest.json')).toBe('{"v":1}{"v":2}');
        // and the next replace cleans the stale epoch up
        dir.faults.removeFails = false;
        await again.replace('manifest.json', bytes('{"v":3}'));
        expect(dir.names()).toEqual(['manifest.json.e2.000000.part']);
    });

    it('a write that fails leaves no half part, and the store goes on when writes work again', async () => {
        const dir = new FakeDirectory('s');
        const store = new OpfsChunkStore(dir);
        await store.append('events.jsonl', bytes('a\n'));
        dir.faults.writesLeft = 0;
        await expect(store.append('events.jsonl', bytes('lost\n'))).rejects.toBeInstanceOf(QuotaError);
        dir.faults.writesLeft = null;
        await store.append('events.jsonl', bytes('b\n'));
        expect(text(await store.read('events.jsonl'))).toBe('a\nb\n');
        await expect(new OpfsChunkStore(dir).read('events.jsonl').then(text)).resolves.toBe('a\nb\n');
        // control: the failed chunk really did not make it (it is not that the test never wrote it)
        expect(text(await store.read('events.jsonl'))).not.toContain('lost');
    });

    it('operations that start together on a store that has not looked at its folder yet scan it once, not once each', async () => {
        const dir = new FakeDirectory('s');
        const first = new OpfsChunkStore(dir);
        await first.append('manifest.json', bytes('{"id":1}'));
        await first.append('events.jsonl', bytes('a\n'));
        await first.append('events.jsonl', bytes('b\n'));
        // a new tab reads several files at once (the registry reads the manifest and the notes together)
        const fresh = new OpfsChunkStore(dir);
        const [manifest, events, notes, names] = await Promise.all([fresh.read('manifest.json'), fresh.read('events.jsonl'), fresh.read('local.json'), fresh.list()]);
        expect(text(manifest)).toBe('{"id":1}'); // twice over (the second scan adding every part again) was the bug
        expect(text(events)).toBe('a\nb\n');
        expect(notes).toBeNull();
        expect(names).toEqual(['events.jsonl', 'manifest.json']);
    });

    it('overlapping appends to one name never share a part', async () => {
        const dir = new FakeDirectory('s');
        const store = new OpfsChunkStore(dir);
        await Promise.all(['a', 'b', 'c', 'd', 'e'].map((c) => store.append('voice-sync.jsonl', bytes(c))));
        const got = text(await store.read('voice-sync.jsonl')) as string;
        expect(got.split('').sort().join('')).toBe('abcde');
        expect(dir.names()).toHaveLength(5);
    });

    it('a store opened on an existing folder continues after its last part and ignores foreign files', async () => {
        const dir = new FakeDirectory('s');
        const first = new OpfsChunkStore(dir);
        await first.append('flight.jsonl.gz', bytes('AAA'));
        await first.append('flight.jsonl.gz', bytes('BBB'));
        // a browser's swap file from a write that never finished, and something that is not ours
        await (await dir.getFileHandle('flight.jsonl.gz.e0.000002.part.crswap', { create: true })).createWritable().then((w) => w.close());
        await (await dir.getFileHandle('notes.txt', { create: true })).createWritable().then((w) => w.close());
        const second = new OpfsChunkStore(dir);
        await second.append('flight.jsonl.gz', bytes('CCC'));
        expect(text(await second.read('flight.jsonl.gz'))).toBe('AAABBBCCC');
        expect(await second.list()).toEqual(['flight.jsonl.gz']);
        // control: starting the numbering over would have overwritten the first part
        expect(dir.names().filter((n) => n.endsWith('.000000.part'))).toEqual(['flight.jsonl.gz.e0.000000.part']);
    });

    it('lists, opens and removes session folders', async () => {
        const root = new FakeDirectory('sonic-sessions');
        const a = await openSessionStore(root, 'aaaaaaaaaaaaaaaaaaaaaa');
        await a.append('manifest.json', bytes('{}'));
        await openSessionStore(root, 'bbbbbbbbbbbbbbbbbbbbbb');
        expect(await listSessionIds(root)).toEqual(['aaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbb']);
        await removeSession(root, 'aaaaaaaaaaaaaaaaaaaaaa');
        expect(await listSessionIds(root)).toEqual(['bbbbbbbbbbbbbbbbbbbbbb']);
    });
});

// ------------------------------------------------------------------ the package writer on the store

function frames(n: number, from = 0): FlightFrame[] {
    return Array.from({ length: n }, (_, i) => {
        const t = (from + i) * (1000 / 30);
        return { t, tick: Math.round(t), p: [Math.cos(t / 900) * 3, 2.5, Math.sin(t / 900) * 3], v: [0, 0, 1], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: ['height.tone'] } as FlightFrame;
    });
}

function manifestFor(id: string, voice: boolean) {
    const rt = fakeRuntime('walls-hall');
    const profile = newProfile();
    return buildManifestInput({
        runtime: rt.runtime,
        env: { release: { sha: 'test', sonic: 'test' }, locale: 'en', userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] },
        consent: consentFor(profile, { voice, at: '2026-11-07T10:00:00Z' }),
        profile,
        startIso: '2026-11-07T10:00:00Z',
        id
    });
}

describe('SessionWriter on the store', () => {
    const ID = 'writerTestSession0001';

    it('a finished session packs and reads back whole (the same package as through memory)', async () => {
        const dir = new FakeDirectory(ID);
        const store = new OpfsChunkStore(dir);
        const w = await SessionWriter.start({ sink: store, manifest: manifestFor(ID, true), gzip: nodeGzip, chunkFrames: 30 });
        w.setVoiceOffset(40);
        const all = frames(100);
        const ev: SessionEvent[] = [{ t: 0, kind: 'session', what: 'start' }, { t: 500, kind: 'checkpoint', id: 'cp1' }];
        for (const f of all) w.frame(f);
        for (const e of ev) w.event(e);
        w.voice(new Uint8Array([1, 2, 3, 4]));
        w.voice(new Uint8Array([5, 6]));
        const manifest = await w.finish({ ended: '2026-11-07T10:00:04Z' });
        expect(manifest.complete).toBe(true);
        const zip = await packSession(store);
        const pkg = readPackage(new Uint8Array(await new Blob(zip as BlobPart[]).arrayBuffer()));
        expect(pkg.frames).toHaveLength(100);
        expect(pkg.events).toEqual(ev);
        expect(Array.from(pkg.voice as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6]);
        // through memory the same bytes come out
        const mem = new MemorySink();
        const mw = await SessionWriter.start({ sink: mem, manifest: manifestFor(ID, true), gzip: nodeGzip, chunkFrames: 30 });
        mw.setVoiceOffset(40);
        for (const f of all) mw.frame(f);
        for (const e of ev) mw.event(e);
        mw.voice(new Uint8Array([1, 2, 3, 4]));
        mw.voice(new Uint8Array([5, 6]));
        await mw.finish({ ended: '2026-11-07T10:00:04Z' });
        for (const name of ['flight.jsonl.gz', 'events.jsonl', 'voice.webm']) expect(Array.from((await store.read(name)) as Uint8Array)).toEqual(Array.from(mem.read(name) as Uint8Array));
    });

    it('a tab killed mid-session leaves a session that recovers to the last whole chunk and reads strictly', async () => {
        const dir = new FakeDirectory(ID);
        const store = new OpfsChunkStore(dir);
        const w = await SessionWriter.start({ sink: store, manifest: manifestFor(ID, true), gzip: nodeGzip, chunkFrames: 30 });
        w.setVoiceOffset(0);
        for (const f of frames(100)) w.frame(f); // 3 chunks of 30 are closed, 10 frames are still in memory
        w.event({ t: 100, kind: 'checkpoint', id: 'early' });
        w.voice(new Uint8Array([9, 9, 9]));
        await w.flush(); // the page's one-second timer: the 10 frames and the event are written
        for (const f of frames(7, 100)) w.frame(f); // seven more frames, then the tab dies before the next flush
        dir.kill();
        dir.revive(); // a new tab over the same files
        const store2 = new OpfsChunkStore(dir);
        const report = await recoverSession(store2, { gzip: nodeGzip });
        expect(report.frames).toBe(100); // the seven in memory are the only loss
        expect(report.manifest.complete).toBe(false);
        expect(report.droppedFlightBytes).toBe(0);
        const zip = await packSession(store2);
        const pkg = readPackage(new Uint8Array(await new Blob(zip as BlobPart[]).arrayBuffer()));
        expect(pkg.frames).toHaveLength(100);
        expect(pkg.events.map((e) => e.kind)).toEqual(['checkpoint', 'session']); // the early event, then 'recovered'
        expect(Array.from(pkg.voice as Uint8Array)).toEqual([9, 9, 9]);
        // the loss is what was not flushed: 7 frames of 30 Hz, about 0.23 s
        expect(((7 * 1000) / 30) < 3000).toBe(true);
    });

    it('control: a session whose writer never flushed leaves nothing but its manifest', async () => {
        const dir = new FakeDirectory(ID);
        const store = new OpfsChunkStore(dir);
        const w = await SessionWriter.start({ sink: store, manifest: manifestFor(ID, false), gzip: nodeGzip, chunkFrames: 100000, chunkMs: 1e9 });
        for (const f of frames(60)) w.frame(f);
        dir.kill();
        dir.revive();
        const report = await recoverSession(new OpfsChunkStore(dir), { gzip: nodeGzip });
        expect(report.frames).toBe(0);
    });
});
