// Makes a REAL session package (the sound repository's own writer and zip, through this lane's recorder, on the Node fakes of
// tools/bench/test/sonicrec-fixtures.ts) and writes it to a file: the fixture the API's tests upload
// (apps/api/tests/fixtures/session-adult.zip), so the server's reader (Python's zipfile) is proved against bytes the real writer made,
// not against a zip Python made itself. The voice is synthetic bytes (the fake microphone), the flight a craft circling at 2 m/s.
//   npx tsx tools/bench/src/sonicrec-make-package.ts <out.zip> [seconds]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { packSession, readPackage } from '../../../packages/sonic-fpv/src';
import { Recorder } from '../../../apps/fly/src/sonic-session/recorder';
import type { SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import { VoiceCapture } from '../../../apps/fly/src/sonic-session/voice';
import { FakeDirectory, FakeMic, fakeRuntime, lessonOpen, nodeGzip, sampleAt } from '../test/sonicrec-fixtures';

const out = resolve(process.argv[2] ?? 'session-adult.zip');
const seconds = Number(process.argv[3] ?? 4);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const dir = new FakeDirectory('sonic-sessions');
const mic = new FakeMic('grant');
const fake = fakeRuntime('walls-hall');
const state = { now: 100_000 };
const stores: SessionStores = {
    durable: true,
    create: async (id) => openSessionStore(dir, id),
    open: async (id) => openSessionStore(dir, id, false),
    list: async () => listSessionIds(dir),
    remove: async (id) => removeSession(dir, id)
};
const rec = new Recorder({
    nowMs: () => state.now,
    nowIso: () => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + (state.now - 100_000)).toISOString(),
    runtime: () => fake.runtime,
    env: () => ({ release: { sha: 'abc1234', sonic: '3959930' }, locale: 'en' as const, userAgent: 'fixture', audio: { sampleRate: 48000, baseLatencyMs: 10, outputLatencyMs: null }, input: 'keyboard' as const, inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] as const }),
    stores,
    voice: new VoiceCapture(mic),
    profile: () => newProfile(),
    say: () => undefined,
    keyLabel: (c) => c.replace('Key', ''),
    gzip: nodeGzip,
    flushMs: 15,
    askMs: 250,
    freeBytes: async () => null
});
const phase = (): string => rec.phase; // read afresh each time: the recorder changes it asynchronously
rec.pressRecord();
rec.pressRecord();
for (let i = 0; i < 400 && phase() !== 'recording'; i++) await sleep(5);
if (phase() !== 'recording') throw new Error('the recording did not start');
rec.onEvent(lessonOpen(state.now - 100_000 + 5000));
for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
    state.now += 1000 / 60;
    rec.onSample(sampleAt(state.now + 5000));
}
await sleep(60);
rec.pressRecord();
for (let i = 0; i < 400 && phase() !== 'idle'; i++) await sleep(5);
const id = rec.status().lastSessionId;
if (id === null) throw new Error('no session was finished');
const parts = await packSession(await openSessionStore(dir, id));
const bytes = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
const pkg = readPackage(bytes); // strict: any problem throws
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(JSON.stringify({ out, bytes: bytes.length, frames: pkg.frames.length, events: pkg.events.length, voiceBytes: pkg.voice?.length ?? 0, complete: pkg.manifest.complete, id: pkg.manifest.id }));
