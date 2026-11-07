// Fly by Sound, step 2 (docs/wip/v12-feedback.md): the recorder of the flight and the pilot's voice
// (apps/fly/src/sonic-session/recorder.ts and what it is built from) against fakes: the OPFS of sonicrec-fixtures.ts,
// a microphone that makes slices, the sound mode's runtime as the flight lane will expose it, and synthetic samples at the
// rate of a display. The same code runs for real in tools/bench/src/sonicrec-recorder.ts (headless Chrome, a fake
// microphone, real OPFS). Every claim has a control that must fail the way the claim says it would.
import { describe, expect, it } from 'vitest';
import { packSession, readPackage, recoverSession } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, SessionEvent, SpeechLine } from '../../../packages/sonic-fpv/src';
import { Recorder } from '../../../apps/fly/src/sonic-session/recorder';
import type { RecorderStatus, SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { SessionClock } from '../../../apps/fly/src/sonic-session/clock';
import { FrameSampler, busEventWanted, cleanCues, eventProblem } from '../../../apps/fly/src/sonic-session/frames';
import { consentFor, loadProfile, newProfile, saveProfile, withProfile, cleanNickname, PROFILE_KEY } from '../../../apps/fly/src/sonic-session/consent';
import type { PilotProfile } from '../../../apps/fly/src/sonic-session/consent';
import { OpfsChunkStore, listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import { VoiceCapture } from '../../../apps/fly/src/sonic-session/voice';
import { FakeDirectory, FakeMic, fakeRuntime, lessonOpen, nodeGzip, sampleAt } from './sonicrec-fixtures';
import type { FakeRuntime, MicMode } from './sonicrec-fixtures';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, what: string, ms = 3000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(4);
    }
}

const ENV = { release: { sha: 'abc1234', sonic: '3959930' }, locale: 'en' as const, userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: 10, outputLatencyMs: null }, input: 'keyboard' as const, inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] as const };

interface Setup {
    mic?: MicMode;
    profile?: PilotProfile;
    lesson?: string | null;
    mode?: 'on' | 'off';
    free?: number | null;
    askMs?: number;
    /** the spoken line, as the page's engine would give it: a promise that settles when the line has been said (default: nothing to wait for) */
    say?: (line: SpeechLine) => unknown;
    readMs?: number;
}

function setup(o: Setup = {}) {
    const dir = new FakeDirectory('sonic-sessions');
    const mic = new FakeMic(o.mic ?? 'grant');
    const fake: FakeRuntime = fakeRuntime(o.lesson === undefined ? 'walls-hall' : o.lesson);
    const state = { runtime: o.mode === 'off' ? null : fake.runtime, now: 100_000, profile: o.profile ?? newProfile() };
    const said: SpeechLine[] = [];
    const statuses: RecorderStatus[] = [];
    const created: string[] = [];
    const stores: SessionStores = {
        durable: true,
        async create(id) {
            created.push(id);
            return openSessionStore(dir, id);
        },
        async open(id) {
            return openSessionStore(dir, id, false);
        },
        async list() {
            return listSessionIds(dir);
        },
        async remove(id) {
            await removeSession(dir, id);
        }
    };
    const voice = new VoiceCapture(mic);
    const rec = new Recorder({
        nowMs: () => state.now,
        nowIso: () => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + (state.now - 100_000)).toISOString(),
        runtime: () => state.runtime,
        env: () => ENV,
        stores,
        voice,
        profile: () => state.profile,
        say: (line) => {
            said.push(line);
            return o.say?.(line);
        },
        keyLabel: (c) => c.replace('Key', ''),
        gzip: nodeGzip,
        flushMs: 15,
        askMs: o.askMs ?? 250,
        ...(o.readMs === undefined ? {} : { readMs: o.readMs }),
        freeBytes: async () => (o.free === undefined ? null : o.free),
        onStatus: (s) => statuses.push(s)
    });
    return { dir, mic, fake, state, said, statuses, created, rec, voice, stores };
}
type H = ReturnType<typeof setup>;

/** T, T: asks, then says yes; resolves when the recording runs. */
async function startRecording(h: H): Promise<void> {
    h.rec.pressRecord();
    expect(h.rec.phase).toBe('asking');
    h.rec.pressRecord();
    await until(() => h.rec.phase === 'recording', 'the recording to start');
}

/** `seconds` of flight at `hz` rendered frames a second; the host clock is `hostOffset` ms ahead of the recorder's. */
function fly(h: H, seconds: number, hz = 60, hostOffset = 5000): void {
    const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i++) {
        h.state.now += 1000 / hz;
        h.rec.onSample(sampleAt(h.state.now + hostOffset));
    }
}

async function packageOf(h: H, id: string) {
    const parts = await packSession(await openSessionStore(h.dir, id));
    return readPackage(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()));
}

const keys = (l: SpeechLine[]): string[] => l.map((x) => x.key);

// ------------------------------------------------------------------ the pure parts

describe('the recording clock', () => {
    it('t = 0 is the start; a host clock with another origin is carried onto it', () => {
        let now = 5000;
        const c = new SessionClock(() => now);
        c.begin();
        now += 40;
        expect(c.now()).toBe(40);
        // the first sample says which host time is t = 0 here: the host clock reads 90 040 when this clock reads 40
        expect(c.sample(90_040)).toBe(40);
        now += 1000;
        expect(c.sample(91_040)).toBe(1040);
        expect(c.fromHost(91_540)).toBe(1540);
        expect(c.fromHost(1)).toBe(0); // never negative
        expect(c.jumps).toBe(0);
    });

    it('a host clock that jumps is taken again, counted, and time never goes back', () => {
        let now = 0;
        const c = new SessionClock(() => now);
        c.begin();
        now = 100;
        expect(c.sample(1100)).toBe(100); // the host clock reads 1000 more than this one
        now = 600;
        expect(c.sample(1600)).toBe(600);
        // the flight starts its clock over: at 700 the host says 50, where the mapping expected 1700
        now = 700;
        expect(c.sample(50)).toBe(700);
        expect(c.jumps).toBe(1);
        now = 716;
        expect(c.sample(66)).toBe(716); // and it follows the new origin from here
        expect(c.jumps).toBe(1);
        // control: a mapping that is never taken again stamps every later sample at 0 (a negative time, clamped), stuck behind
        const naive = (hostT: number, base: number): number => Math.max(0, hostT - base);
        expect(naive(66, 1000)).toBe(0);
        expect(naive(82, 1000)).toBe(0);
    });
});

describe('frames at 30 Hz', () => {
    const rate = (hz: number, seconds = 10): number => {
        const s = new FrameSampler();
        let kept = 0;
        const n = hz * seconds;
        for (let i = 0; i < n; i++) {
            const t = (i * 1000) / hz;
            if (s.take(sampleAt(t), t, []) !== null) kept++;
        }
        return kept / seconds;
    };

    it('keeps 30 a second from displays of 30, 60, 75, 120, 144 and 240 Hz; a slow display keeps every frame', () => {
        for (const hz of [30, 60, 75, 120, 144, 240]) expect(rate(hz), `${hz} Hz`).toBeGreaterThanOrEqual(29.5);
        for (const hz of [30, 60, 75, 120, 144, 240]) expect(rate(hz), `${hz} Hz`).toBeLessThanOrEqual(30.5);
        expect(rate(20)).toBeCloseTo(20, 1);
    });

    it('control: keeping every second or third frame is only right at 60 Hz', () => {
        const everyNth = (hz: number, n: number): number => hz / n;
        expect(everyNth(60, 2)).toBe(30);
        expect(everyNth(144, 2)).not.toBe(30);
        expect(everyNth(75, 2)).not.toBe(30);
    });

    it('builds the frame the package takes: millisecond time, unit quaternion, sticks in range, cue ids cleaned', () => {
        const s = new FrameSampler();
        const f = s.take({ ...sampleAt(1234.6), quat: [1.2, 0, 0, 0], sticks: [3, -4, 0.5, 0] }, 1234.6, ['a', '', 'x'.repeat(81), 'b']) as FlightFrame;
        expect(f.q).toEqual([1, 0, 0, 0]);
        expect(f.s).toEqual([1, -1, 0.5, 0]);
        expect(f.c).toEqual(['a', 'b']);
        expect(cleanCues(Array.from({ length: 100 }, (_, i) => `c${i}`))).toHaveLength(64);
    });

    it('refuses what the package would refuse, counts it, and never throws', () => {
        const s = new FrameSampler();
        expect(s.take({ ...sampleAt(0), pos: [Number.NaN, 0, 0] }, 0, [])).toBeNull();
        expect(s.take({ ...sampleAt(40), quat: [0, 0, 0, 0] }, 40, [])).toBeNull();
        expect(s.take(sampleAt(80), 80, [])).not.toBeNull();
        expect(s.refused.total).toBe(2);
        expect(s.refused.counts.get('not-finite')).toBe(1);
        expect(s.refused.counts.get('quaternion')).toBe(1);
    });

    it('time never goes back in a package: a sample from before the last frame is not written', () => {
        const s = new FrameSampler();
        const a = s.take(sampleAt(1000), 1000, []) as FlightFrame;
        const b = s.take(sampleAt(1040), 1040, []) as FlightFrame;
        expect([a.t, b.t]).toEqual([1000, 1040]);
        expect(s.take(sampleAt(1030), 1030, [])).toBeNull(); // the mapping slipped back
        expect(s.take(sampleAt(100), 100, [])).toBeNull();
        const c = s.take(sampleAt(1080), 1080, []) as FlightFrame;
        expect(c.t).toBe(1080);
    });
});

describe('events', () => {
    const touch = (over: object = {}): SessionEvent => ({ t: 100, kind: 'touch', material: 'wall', speed: 1.2, pos: [1, 2, 3], ...over }) as SessionEvent;

    it('an event the package reads passes; one it would refuse is named', () => {
        expect(eventProblem(touch())).toBeNull();
        expect(eventProblem(touch({ speed: -1 }))).toMatch(/speed/);
        expect(eventProblem(touch({ material: 'water' }))).toMatch(/material/);
        expect(eventProblem({ t: 1, kind: 'speech', key: 'x', text: 'y'.repeat(2001) })).toMatch(/text/);
        expect(eventProblem({ t: 1, kind: 'lesson', lessonId: 'Bad Id', version: 1, what: 'open', attempt: 0 })).toMatch(/lessonId/);
        expect(eventProblem({ t: Number.NaN, kind: 'session', what: 'start' })).not.toBeNull();
    });

    it('while recording every kind is written; after the stop only speech, so nothing the replay cannot re-derive trails the last frame', () => {
        const kinds: SessionEvent[] = [touch(), lessonOpen(5), { t: 1, kind: 'speech', key: 'speech.end', text: '' }, { t: 1, kind: 'gate', gateId: 'g', index: 0, missM: 0.1 }, { t: 1, kind: 'key', code: 'KeyN', action: 'next' }];
        expect(kinds.map((e) => busEventWanted(e, 'recording'))).toEqual([true, true, true, true, true]);
        expect(kinds.map((e) => busEventWanted(e, 'closing'))).toEqual([false, false, true, false, false]);
    });
});

describe('the pilot and the consent', () => {
    it('a minor without a guardian\'s confirmation records, but nothing that leaves the device can be consented to', () => {
        const minor = withProfile(newProfile(), { minor: true });
        expect(consentFor(minor, { voice: true, at: '2026-11-07T10:00:00Z' })).toMatchObject({ minor: true, guardianConfirmed: false, send: false, speechRecognition: false });
        expect(() => consentFor(minor, { voice: true, at: 'x', send: true })).toThrow(/guardian/);
        expect(() => consentFor(minor, { voice: true, at: 'x', speechRecognition: true })).toThrow(/guardian/);
        const confirmed = withProfile(minor, { guardianConfirmed: true });
        expect(consentFor(confirmed, { voice: true, at: 'x', send: true })).toMatchObject({ guardianConfirmed: true, send: true });
        expect(consentFor(newProfile(), { voice: false, at: 'x' })).toMatchObject({ minor: false, guardianConfirmed: null, voice: false });
    });

    it('a guardian\'s confirmation does not outlive "under 18"; nicknames are cleaned; a stored profile is repaired, never trusted', () => {
        const p = withProfile(withProfile(newProfile(), { minor: true, guardianConfirmed: true }), { minor: false });
        expect(p.guardianConfirmed).toBe(false);
        expect(cleanNickname('  Ann \u0007 Lee\n  ')).toBe('Ann Lee');
        expect(cleanNickname('x'.repeat(100))).toHaveLength(40);
        expect(cleanNickname('   ')).toBeNull();
        const store = new Map<string, string>();
        const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
        const mine = withProfile(newProfile(), { nickname: 'Pilot', headphones: 'wired' });
        saveProfile(kv, mine);
        expect(loadProfile(kv)).toEqual(mine);
        store.set(PROFILE_KEY, JSON.stringify({ id: 'x', nickname: 5, minor: 'yes', guardianConfirmed: true, headphones: 'tin-cans', surveysSeen: [1, 'first-flight'] }));
        const repaired = loadProfile(kv);
        expect(repaired).toMatchObject({ nickname: null, minor: false, guardianConfirmed: false, headphones: 'unknown', surveysSeen: ['first-flight'] });
        expect(repaired.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        store.set(PROFILE_KEY, '{not json');
        expect(loadProfile(kv).id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(loadProfile(null).id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
});

// ------------------------------------------------------------------ the recorder

describe('the recorder: T asks, T records, T stops', () => {
    it('records a flight with the pilot\'s voice into a package that reads strictly, in the order of the keys', async () => {
        const h = setup();
        await startRecording(h);
        expect(h.mic.asked).toBe(1);
        expect(keys(h.said)).toEqual(['rec.ask', 'rec.started']);
        expect(h.said[0]?.params).toEqual({ key: 'T' });
        h.rec.onEvent(lessonOpen(h.state.now + 5000 + 10));
        fly(h, 3);
        h.rec.onEvent({ t: h.state.now + 5000 - 1000, kind: 'checkpoint', id: 'cp1' });
        await sleep(120); // the voice makes slices on its own clock
        const done = await h.rec.stop();
        expect(done).not.toBeNull();
        expect(h.rec.phase).toBe('idle');
        expect(keys(h.said)).toEqual(['rec.ask', 'rec.started', 'rec.stopped', 'rec.saved']);
        const pkg = await packageOf(h, done!.id);
        expect(pkg.problems).toEqual([]);
        // 3 s of 60 Hz rendering is 90 frames of 30 Hz, the first at the start of the recording
        expect(pkg.frames.length).toBeGreaterThanOrEqual(89);
        expect(pkg.frames.length).toBeLessThanOrEqual(91);
        expect(pkg.frames[0]?.t).toBeLessThan(40);
        expect((pkg.frames[pkg.frames.length - 1] as FlightFrame).t).toBeGreaterThan(2900);
        expect(pkg.frames.every((f, i, a) => i === 0 || f.t >= (a[i - 1] as FlightFrame).t)).toBe(true);
        expect(pkg.frames[10]?.c).toEqual(['height.tone', 'room.bed']);
        // the events the recorder writes itself, and the bus's, carried onto the recording clock
        const kinds = pkg.events.map((e) => `${e.kind}:${(e as { what?: string }).what ?? (e as { id?: string }).id ?? ''}`);
        expect(kinds).toEqual(['session:start', 'recording:start', 'lesson:open', 'checkpoint:cp1', 'recording:stop', 'session:end']);
        const cp = pkg.events.find((e) => e.kind === 'checkpoint') as SessionEvent;
        expect(cp.t).toBeGreaterThan(1900);
        expect(cp.t).toBeLessThan(2100); // 1 s before the end of a 3 s flight on the host's clock (5000 ms ahead), not 6000 ms
        // the voice is every slice the microphone made, from the offset the recorder reported
        expect(Array.from(pkg.voice as Uint8Array)).toEqual(Array.from(h.mic.voice()));
        expect(pkg.manifest.clock.voiceOffsetMs).toBeGreaterThanOrEqual(0);
        expect(pkg.manifest.clock.voiceOffsetMs).toBeLessThan(100);
        expect(pkg.manifest.consent).toMatchObject({ recording: true, voice: true, send: false, speechRecognition: false, minor: false, guardianConfirmed: null });
        expect(pkg.manifest.lesson).toEqual({ id: 'walls-hall', version: 1, path: 'full' });
        expect(pkg.manifest.scene.kind).toBe('analytic');
        expect(pkg.manifest.complete).toBe(true);
        expect(pkg.manifest.app).toEqual({ name: 'ShramkoGSFPV', release: 'abc1234', sonic: '3959930' });
        expect(h.mic.stopped).toBe(1); // the microphone is let go
    });

    it('the second press calls getUserMedia in the same task as the key (before any await)', () => {
        const h = setup();
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(0);
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(1); // synchronously, with no tick in between
    });

    it('a microphone that is refused or missing still records the flight, and the package says so', async () => {
        for (const mode of ['deny', 'missing', 'unsupported'] as const) {
            const h = setup({ mic: mode });
            await startRecording(h);
            fly(h, 1);
            const done = await h.rec.stop();
            const pkg = await packageOf(h, done!.id);
            expect(pkg.manifest.consent.voice, mode).toBe(false);
            expect(pkg.voice, mode).toBeNull();
            expect(pkg.manifest.clock.voiceOffsetMs, mode).toBeNull();
            expect(pkg.frames.length, mode).toBeGreaterThan(25);
            const marks = pkg.events.filter((e) => e.kind === 'recording').map((e) => (e as { what: string }).what);
            expect(marks, mode).toEqual(mode === 'deny' ? ['start', 'mic-denied', 'stop'] : ['start', 'stop']);
            expect(keys(h.said), mode).toContain(mode === 'deny' ? 'rec.mic-denied' : 'rec.started');
            // control: a refusal is not a granted microphone
            expect(h.mic.stopped, mode).toBe(0);
        }
    });

    it('a minor is told so first, the package is valid, and it never claims consent to send', async () => {
        const profile = withProfile(newProfile(), { minor: true, guardianConfirmed: false, nickname: 'Kid', headphones: 'wired' });
        const h = setup({ profile });
        h.rec.pressRecord();
        expect(keys(h.said)).toEqual(['rec.minor', 'rec.ask']);
        h.rec.pressRecord();
        await until(() => h.rec.phase === 'recording', 'start');
        fly(h, 1);
        const done = await h.rec.stop();
        const pkg = await packageOf(h, done!.id);
        expect(pkg.manifest.consent).toMatchObject({ minor: true, guardianConfirmed: false, send: false, speechRecognition: false });
        expect(pkg.manifest.pilot).toEqual({ id: profile.id, nickname: 'Kid' });
        expect(pkg.manifest.device.headphones).toBe('wired');
    });

    it('no second press in time: nothing was asked of the microphone and nothing was written', async () => {
        const h = setup({ askMs: 30 });
        h.rec.pressRecord();
        await until(() => h.rec.phase === 'idle', 'the question to time out');
        expect(keys(h.said)).toEqual(['rec.ask', 'rec.off']);
        expect(h.mic.asked).toBe(0);
        expect(h.created).toEqual([]);
        expect(h.dir.dirs.size).toBe(0);
        // and the keys work again afterwards
        await startRecording(h);
        await h.rec.stop();
    });

    it('a second press before the question has been read out is not a yes: the microphone is not asked for and nothing is written', async () => {
        // the page's engine says a line and settles when it ends: here the line is still being read
        let readOut!: () => void;
        const reading = new Promise<void>((resolve) => {
            readOut = resolve;
        });
        const h = setup({ say: () => reading });
        h.rec.pressRecord();
        h.rec.pressRecord(); // struck twice in a hurry: the pilot has heard nothing of "May I record this flight and your voice?"
        h.rec.pressRecord();
        await sleep(40);
        expect(h.rec.phase).toBe('asking');
        expect(h.mic.asked).toBe(0);
        expect(h.created).toEqual([]);
        // the question has been read out: now a press is the pilot's answer, and it asks for the microphone in the same task
        readOut();
        await sleep(0);
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(1);
        await until(() => h.rec.phase === 'recording', 'the recording to start');
        await h.rec.stop();
    });

    it('for a minor the guardian line and the question are both read out before a press counts', async () => {
        const gates: (() => void)[] = [];
        const profile = withProfile(newProfile(), { minor: true, guardianConfirmed: true });
        const h = setup({ profile, say: () => new Promise<void>((resolve) => gates.push(resolve)) });
        h.rec.pressRecord();
        expect(keys(h.said)).toEqual(['rec.minor', 'rec.ask']);
        gates[0]?.(); // the first line is over, the question is not
        await sleep(10);
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(0);
        gates[1]?.();
        await sleep(0);
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(1);
        await until(() => h.rec.phase === 'recording', 'the recording to start');
        await h.rec.stop();
    });

    it('a question that never ends (a hidden tab) cannot lock the pilot out: after the reading limit a press is the answer', async () => {
        const h = setup({ say: () => new Promise<void>(() => undefined), readMs: 40 });
        h.rec.pressRecord();
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(0);
        await sleep(90);
        expect(h.rec.phase).toBe('asking');
        h.rec.pressRecord();
        expect(h.mic.asked).toBe(1);
        await until(() => h.rec.phase === 'recording', 'the recording to start');
        await h.rec.stop();
    });

    it('the time to answer starts when the question has been read out, not when it was begun', async () => {
        let readOut!: () => void;
        const reading = new Promise<void>((resolve) => {
            readOut = resolve;
        });
        const h = setup({ askMs: 40, say: () => reading });
        h.rec.pressRecord();
        await sleep(120); // longer than the time to answer, shorter than the reading limit
        expect(h.rec.phase).toBe('asking');
        expect(keys(h.said)).toEqual(['rec.ask']);
        readOut();
        await until(() => h.rec.phase === 'idle', 'the question to time out after it was read');
        expect(keys(h.said)).toEqual(['rec.ask', 'rec.off']);
        expect(h.mic.asked).toBe(0);
    });

    it('presses while it is starting, stopping or finishing do nothing', async () => {
        const h = setup();
        h.rec.pressRecord();
        h.rec.pressRecord();
        h.rec.pressRecord(); // 'starting': ignored
        h.rec.pressRecord();
        await until(() => h.rec.phase === 'recording', 'start');
        fly(h, 0.5);
        const first = h.rec.stop();
        h.rec.pressRecord(); // 'closing': ignored
        const second = h.rec.stop(); // the same stop
        expect(await first).toBe(await second);
        expect(h.created).toHaveLength(1);
        expect(h.mic.asked).toBe(1);
    });

    it('does nothing while the sound mode is off, and refuses to start when the mode goes away', async () => {
        const off = setup({ mode: 'off' });
        off.rec.onSample(sampleAt(0));
        off.rec.onEvent(lessonOpen(0));
        expect(off.created).toEqual([]);
        off.rec.pressRecord();
        off.rec.pressRecord();
        await until(() => off.rec.phase === 'idle', 'idle');
        expect(off.rec.status().error).toMatch(/mode is off/);
        expect(off.created).toEqual([]);
        expect(off.mic.stopped).toBe(1); // the microphone it had asked for is let go
    });

    it('too little storage: refused before anything is written, the microphone is let go, the pilot hears that recording is off', async () => {
        const h = setup({ free: 10 * 1024 * 1024 });
        h.rec.pressRecord();
        h.rec.pressRecord();
        await until(() => h.rec.phase === 'idle', 'refusal');
        expect(h.rec.status().error).toMatch(/10 MB .* 50 MB/);
        expect(keys(h.said)).toEqual(['rec.ask', 'rec.off']);
        expect(h.created).toEqual([]);
        expect(h.mic.stopped).toBe(1);
        // control: with room it records
        const ok = setup({ free: 500 * 1024 * 1024 });
        await startRecording(ok);
        await ok.rec.stop();
    });

    it('events the package would refuse are dropped and counted, and the package still reads (control: written as they are it does not)', async () => {
        const h = setup();
        await startRecording(h);
        const bad = { t: 100, kind: 'touch', material: 'water', speed: -3, pos: [0, 0, 0] } as unknown as SessionEvent;
        h.rec.onEvent(bad);
        h.rec.onEvent({ t: 100, kind: 'speech', key: 'k', text: 'z'.repeat(5000) });
        h.rec.onSample({ ...sampleAt(h.state.now + 5000), pos: [Number.POSITIVE_INFINITY, 0, 0] });
        fly(h, 0.5);
        const done = await h.rec.stop();
        const pkg = await packageOf(h, done!.id);
        expect(pkg.problems).toEqual([]);
        expect(pkg.events.some((e) => e.kind === 'touch' || e.kind === 'speech')).toBe(false);
        const report = h.rec.refusalReport();
        expect(report.total).toBe(3);
        expect(report.first.join(' ')).toMatch(/event: .*material/);
        // control: the same bad line written straight into the package makes the strict reader refuse the whole thing
        const { SessionWriter } = await import('../../../packages/sonic-fpv/src');
        const dir = new FakeDirectory('x');
        const store = new OpfsChunkStore(dir);
        const writer = await SessionWriter.start({ sink: store, manifest: { ...(await import('../../../apps/fly/src/sonic-session/manifest-input')).buildManifestInput({ runtime: h.fake.runtime, env: ENV, consent: consentFor(newProfile(), { voice: false, at: '2026-11-07T10:00:00Z' }), profile: newProfile(), startIso: '2026-11-07T10:00:00Z', id: 'controlSession00000001' }) }, gzip: nodeGzip });
        writer.event(bad);
        await writer.finish({ ended: '2026-11-07T10:00:01Z' });
        const zip = new Uint8Array(await new Blob((await packSession(store)) as BlobPart[]).arrayBuffer());
        expect(() => readPackage(zip)).toThrow(/problem/);
    });

    it('after the stop the flight and the lesson events stop; speech (the survey) is still written, the voice runs on until the package ends', async () => {
        const h = setup();
        await startRecording(h);
        fly(h, 1);
        let seenInSurvey = -1;
        const done = await h.rec.stop({
            survey: async (env) => {
                expect(env.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
                expect(h.rec.phase).toBe('closing');
                h.rec.onEvent({ t: h.state.now + 5000, kind: 'touch', material: 'wall', speed: 1, pos: [0, 0, 0] });
                h.rec.onEvent({ t: h.state.now + 5000, kind: 'speech', key: 'survey.item.fun', text: 'How much did you enjoy flying by sound?' });
                fly(h, 1); // frames after the stop are not written
                seenInSurvey = h.mic.emitted.length;
                await sleep(100); // the pilot answers aloud: the voice keeps coming in
                return { format: 'shramko-sonic-answers/1', surveyId: 'first-flight', version: 1, skipped: false, answers: [{ item: 'fun', value: 4, via: 'key', t: env.now() }] };
            }
        });
        const pkg = await packageOf(h, done!.id);
        expect(pkg.events.filter((e) => e.kind === 'touch')).toHaveLength(0);
        expect(pkg.events.filter((e) => e.kind === 'speech')).toHaveLength(1);
        expect((pkg.frames[pkg.frames.length - 1] as FlightFrame).t).toBeLessThan(1100);
        expect(pkg.survey?.answers[0]).toMatchObject({ item: 'fun', value: 4, via: 'key' });
        expect((pkg.voice as Uint8Array).length).toBeGreaterThan(seenInSurvey * 300); // voice slices made during the survey are in the package
        expect(pkg.problems).toEqual([]);
    });

    it('a failing survey does not lose the recording', async () => {
        const h = setup();
        await startRecording(h);
        fly(h, 1);
        const done = await h.rec.stop({ survey: async () => { throw new Error('survey broke'); } });
        expect(done).not.toBeNull();
        expect(h.rec.status().error).toMatch(/survey broke/);
        expect((await packageOf(h, done!.id)).frames.length).toBeGreaterThan(25);
    });

    it('the host clock may start anywhere and may jump: the package starts at 0, time never goes back, the jump is counted', async () => {
        for (const offset of [0, 5000, 123_456_789]) {
            const h = setup();
            await startRecording(h);
            fly(h, 1, 60, offset);
            const done = await h.rec.stop();
            const pkg = await packageOf(h, done!.id);
            expect(pkg.frames[0]?.t, `offset ${offset}`).toBeLessThan(40);
            expect((pkg.frames[pkg.frames.length - 1] as FlightFrame).t, `offset ${offset}`).toBeLessThan(1100);
        }
        const h = setup();
        await startRecording(h);
        fly(h, 1, 60, 5000);
        fly(h, 1, 60, -2000); // the flight started its clock over
        fly(h, 1, 60, -2000);
        const done = await h.rec.stop();
        const pkg = await packageOf(h, done!.id);
        const ts = pkg.frames.map((f) => f.t);
        expect(ts.every((t, i) => i === 0 || t >= (ts[i - 1] as number))).toBe(true);
        expect(h.rec.refusalReport().clockJumps).toBe(1);
        expect(ts[ts.length - 1]).toBeGreaterThan(2900);
        expect(ts[ts.length - 1]).toBeLessThan(3100);
    });
});

describe('what a failure costs', () => {
    it('storage that fails mid-recording stops it, says so, lets go of the microphone, and keeps what was written, recoverable', async () => {
        const h = setup();
        await startRecording(h);
        fly(h, 2);
        await sleep(80); // flushed: the first two seconds are in the store
        h.dir.faults.writesLeft = 0; // the quota is gone
        fly(h, 2);
        await sleep(80);
        await until(() => h.rec.phase === 'idle', 'the recorder to give up');
        expect(h.rec.status().error).toMatch(/cannot be stored/);
        expect(h.mic.stopped).toBe(1);
        expect(keys(h.said)).toContain('rec.stopped');
        expect(keys(h.said)).not.toContain('rec.saved');
        // a new tab with room finds the session and brings it back
        h.dir.faults.writesLeft = null;
        const ids = [...h.dir.dirs.keys()];
        expect(ids).toHaveLength(1);
        const report = await recoverSession(await openSessionStore(h.dir, ids[0] as string), { gzip: nodeGzip });
        expect(report.frames).toBeGreaterThan(55); // at least the first two seconds of 30 Hz
        expect(report.manifest.complete).toBe(false);
    });

    it('a tab that dies mid-recording loses at most what the last flush had not written: under 3 s at the page\'s one-second flush', async () => {
        const h = setup();
        await startRecording(h);
        // 6 s of flight with a real second-ish between flushes: feed in slices and let the timer run
        let emitted = 0;
        for (let i = 0; i < 12; i++) {
            fly(h, 0.5);
            emitted = h.state.now - 100_000;
            await sleep(25);
        }
        const flushedUpTo = ((): number => emitted)();
        h.dir.kill(); // the tab is gone, with whatever was in memory
        h.dir.revive();
        const ids = [...h.dir.dirs.keys()];
        const report = await recoverSession(await openSessionStore(h.dir, ids[0] as string), { gzip: nodeGzip });
        const lostMs = flushedUpTo - report.lastT;
        expect(lostMs).toBeLessThan(3000);
        expect(report.frames).toBeGreaterThan(100);
        h.rec.dispose();
    });
});

describe('the sync marks of the voice', () => {
    it('the start of the voice and one mark per slice are kept next to the session, in order, on the recording clock', async () => {
        const h = setup();
        await startRecording(h);
        fly(h, 0.2);
        await sleep(130);
        const done = await h.rec.stop();
        const store = await openSessionStore(h.dir, done!.id);
        const marks = ((await store.read('voice-sync.jsonl')) as Uint8Array);
        const all = new TextDecoder().decode(marks).trim().split('\n').map((l) => JSON.parse(l) as { k?: number; t?: number; bytes?: number; start?: { called: number; event: number } });
        // the first line is the start: when the recorder was started (that is voiceOffsetMs) and when the browser said it had
        expect(all[0]?.start).toBeDefined();
        const pkg = await packageOf(h, done!.id);
        expect(all[0]?.start?.called).toBeCloseTo(pkg.manifest.clock.voiceOffsetMs as number, 1);
        expect(all[0]?.start?.event as number).toBeGreaterThanOrEqual(all[0]?.start?.called as number);
        const slices = all.slice(1);
        expect(slices.length).toBeGreaterThanOrEqual(3);
        slices.forEach((m, i) => expect(m.k).toBe(i));
        expect(slices.every((m, i) => i === 0 || (m.t as number) >= (slices[i - 1]?.t as number))).toBe(true);
        // the sidecar is not part of the package
        expect(pkg.problems).toEqual([]);
        expect(pkg.manifest.files.map((f) => f.name)).not.toContain('voice-sync.jsonl');
    });
});
