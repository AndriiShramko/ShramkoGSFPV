// v0.12 v12-int step 5 (docs/wip/v12-int.md): a recording replays lesson by lesson. A recording usually spans several lessons (a pass
// moves on along the path, N and the start screen too); each lesson is a new enter() of the mode, a new clock of the bridge and a new
// `lesson open`, while the recorder keeps ONE package. The replay core runs one lesson, so the package is cut at replay time at its
// `lesson open` events (apps/fly/src/sonic-session/replay-segments.ts), each piece is checked and played against its own lesson and world
// (replay-check.ts, replay-player.ts) on the package's one clock, with its one voice. Here, in Node:
//   - the cut itself on made-up packages;
//   - the recorder's clock: the next lesson's open and first lines arrive BEFORE its first sample and were stamped with the old origin;
//   - the real thing: the lesson rig (the real flight model, lesson pilot, mode, bridge, host and the package's runner; only the engine
//     and the drawing are fakes) flies rings-first to its pass, the host opens rings-line by itself, and the REAL recorder on the
//     bus records both into one package; the package checks lesson by lesson, every event and every frame; control: the package's own
//     one-lesson check of the same bytes fails;
//   - the player on a fake audio clock: each lesson's world shown when its first frame is due, its layers, every frame once, one voice.
// The page (both worlds drawn in turn, the voice measured within 0.2 s) is tools/bench/src/sonic-int-page.ts replay.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildManifest, checkSession, createAnalyticWorld, defaultPrefs, getBuiltinTheme, getLesson, packSession, readPackage } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, LessonLayers, ReplaySetup, SessionEvent, SessionManifest, SessionPackage, SonicEngine, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import { SessionClock } from '../../../apps/fly/src/sonic-session/clock';
import { lessonSegments } from '../../../apps/fly/src/sonic-session/replay-segments';
import { checkPackage } from '../../../apps/fly/src/sonic-session/replay-check';
import type { ReplayOutcome } from '../../../apps/fly/src/sonic-session/replay-check';
import { ReplayPlayer } from '../../../apps/fly/src/sonic-session/replay-player';
import type { ReplayDeps, WorldSink } from '../../../apps/fly/src/sonic-session/replay-player';
import type { VoiceBuffer } from '../../../apps/fly/src/sonic-session/replay-voice';
import { Recorder } from '../../../apps/fly/src/sonic-session/recorder';
import type { SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { listSessionIds, openSessionStore, removeSession } from '../../../apps/fly/src/sonic-session/store';
import { VoiceCapture } from '../../../apps/fly/src/sonic-session/voice';
import { FakeDirectory, FakeMic, nodeGzip } from './sonicrec-fixtures';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------------ made-up packages

const BASE = buildManifest({
    id: 'segmentsSession000001',
    created: '2026-11-07T10:00:00Z',
    app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
    scene: { kind: 'analytic', id: 'x', version: 1, transform: [1, 0, 0, 0] },
    lesson: { id: 'shapes-square', version: 1, path: 'full' },
    theme: { id: 'soft', version: getBuiltinTheme('soft').version },
    settings: defaultPrefs(),
    assists: getLesson('shapes-square').assists,
    device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
    consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' },
    pilot: { id: 'testPilot01', nickname: null },
    clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30 }
}) as SessionManifest;
const frameAt = (t: number): FlightFrame => ({ t, tick: t, p: [0, 1, 0], v: [0, 0, 0], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: [] });
const open = (t: number, lessonId: string): SessionEvent => ({ t, kind: 'lesson', lessonId, version: 1, what: 'open', attempt: 0 });

describe('the cut of a package at its `lesson open` events', () => {
    it('a package of one lesson stays the package itself (no open, or the open of its own lesson with no frame before it)', () => {
        const frames = [0, 33, 66].map(frameAt);
        const none = lessonSegments({ manifest: BASE, frames, events: [] });
        expect(none).toHaveLength(1);
        expect(none[0]!.manifest).toBe(BASE);
        expect(none[0]!.frames).toBe(frames);
        const own = lessonSegments({ manifest: BASE, frames, events: [{ t: 0, kind: 'session', what: 'start' }, open(0, 'shapes-square')] });
        expect(own).toHaveLength(1);
        expect(own[0]!.manifest).toBe(BASE);
    });

    it('a lead, then a piece per open: frames by time, events by their place, each manifest naming its lesson and world', () => {
        const frames = [0, 33, 66, 100, 133, 166, 200, 233].map(frameAt);
        const events: SessionEvent[] = [
            { t: 0, kind: 'session', what: 'start' },
            { t: 10, kind: 'speech', key: 'fly.go', text: 'Go.' },
            open(100, 'shapes-series'),
            { t: 120, kind: 'speech', key: 'fly.go', text: 'Go.' },
            open(200, 'rings-first'),
            { t: 233, kind: 'recording', what: 'stop' }
        ];
        const s = lessonSegments({ manifest: BASE, frames, events });
        expect(s.map((x) => [x.lessonId, x.lead, x.firstFrame, x.frames.map((f) => f.t), x.events.length])).toEqual([
            ['shapes-square', true, 0, [0, 33, 66], 2],
            ['shapes-series', false, 3, [100, 133, 166], 2],
            ['rings-first', false, 6, [200, 233], 2]
        ]);
        expect(s[0]!.manifest).toBe(BASE);
        expect(s[1]!.manifest.lesson).toEqual({ id: 'shapes-series', version: 1, path: 'full' });
        expect(s[1]!.manifest.scene).toMatchObject({ kind: 'analytic', id: createAnalyticWorld((getLesson('shapes-series').world as { spec: never }).spec).id });
        expect(s[2]!.manifest.assists).toEqual(getLesson('rings-first').assists);
    });

    it('a recording begun with no lead frames: the events before the first open go with the first piece', () => {
        const s = lessonSegments({ manifest: BASE, frames: [50, 80, 150].map(frameAt), events: [{ t: 0, kind: 'recording', what: 'start' }, open(40, 'shapes-series'), open(140, 'rings-first')] });
        expect(s.map((x) => [x.lessonId, x.events.map((e) => e.kind)])).toEqual([
            ['shapes-series', ['recording', 'lesson']],
            ['rings-first', ['lesson']]
        ]);
    });
});

// ------------------------------------------------------------------ the recorder's clock

describe('the recording clock across a lesson change', () => {
    it('the next lesson\'s open and first lines, arriving before its first sample, are stamped where they arrive (the host clock restarted)', () => {
        let now = 1000;
        const c = new SessionClock(() => now);
        c.begin(); // the recording starts 30 s into lesson A: A's clock reads 30 000 now
        now += 16;
        expect(c.sample(30_016)).toBe(16);
        now += 5000; // 5 s of A
        expect(c.sample(35_016)).toBe(5016);
        expect(c.fromHost(35_020)).toBe(5020); // an event of A, sent as it happened
        expect(c.fromHost(34_016)).toBe(4016); // one a host stamped a second before it sent it keeps its time (no restart)
        now += 1500; // A passed, B opens: its clock starts at 0, its open (t 0) and its intro come before its first sample
        expect(c.fromHost(0, true)).toBe(6516); // the open begins the new run: the mapping is taken from it
        expect(c.fromHost(3)).toBe(6519);
        now += 16;
        expect(c.sample(16)).toBe(6532); // B's first sample, on the mapping its open gave
        expect(c.jumps).toBe(1);
        // control: an open that maps where it arrives is no restart (a lesson opened while the clock was already right)
        const d = new SessionClock(() => now);
        d.begin();
        expect(d.sample(500)).toBe(0);
        now += 100;
        expect(d.fromHost(600, true)).toBe(100);
        expect(d.jumps).toBe(0);
    });
});

// ------------------------------------------------------------------ two lessons through the host, recorded by the recorder

/** Module 1: up to the middle of the 2 to 3 m band, then the throttle centred holds the height (sonic-lessons.test.ts's pilot). */
const hover: Control = (r) => {
    const e = 2.5 - r.pos[1];
    return { lift: Math.abs(e) < 0.15 ? 0 : Math.max(-0.6, Math.min(0.6, e * 0.8)) };
};

/** Through the gate of a rings or shapes lesson at 3 m (sonic-lessons.test.ts's pilot). */
const throughTheGate: Control = (r) => ({ forward: 1, lift: Math.max(-0.4, Math.min(0.4, (3 - r.pos[1]) * 0.8)) });

interface Flight {
    readonly a: string;
    readonly b: string;
    readonly pilot: Control;
    /** the lesson opened again when the recording starts, as the session side does (false: the old way, the lesson goes on) */
    readonly reopen: boolean;
}
const RINGS: Flight = { a: 'rings-first', b: 'rings-line', pilot: throughTheGate, reopen: true };

/**
 * Lesson `a` flown a little, a recording started (as the helper's Start does), `a` opened again from its beginning as the session side
 * does when a recording starts, flown to its pass, `b` opened by the host after it, flown 6 s, the recording stopped: the package read
 * back strictly.
 */
async function recordTwoLessons(o: Flight = RINGS): Promise<{ pkg: SessionPackage; rig: Rig }> {
    const rig = await Rig.make(getLesson(o.a));
    expect(await rig.host.open(o.a)).toBe(true);
    const dir = new FakeDirectory('sonic-sessions');
    const stores: SessionStores = {
        durable: true,
        create: async (id) => openSessionStore(dir, id),
        open: async (id) => openSessionStore(dir, id, false),
        list: async () => listSessionIds(dir),
        remove: async (id) => removeSession(dir, id)
    };
    const runtime = {
        engine: rig.engine as unknown as SonicEngine,
        prefs: defaultPrefs(),
        theme: getBuiltinTheme('soft'),
        get world() {
            return rig.host.world;
        },
        get lesson() {
            return rig.host.lesson;
        },
        runner: null,
        playback() {}
    } as unknown as SonicRuntime;
    const rec = new Recorder({
        nowMs: () => rig.clock.t,
        nowIso: () => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + rig.clock.t).toISOString(),
        runtime: () => runtime,
        env: () => ({ release: { sha: 'test', sonic: 'test' }, locale: 'en', userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] }),
        stores,
        voice: new VoiceCapture(new FakeMic('deny')),
        profile: () => newProfile(),
        say: (_line: SpeechLine) => undefined,
        keyLabel: (c) => c,
        gzip: nodeGzip,
        freeBytes: async () => null
    });
    rig.events.on('sonicSample', (s) => rec.onSample(s));
    rig.events.on('sonicEvent', (e) => rec.onEvent(e));
    await rig.run(400, o.pilot); // the recording starts in the middle of the lesson, as a helper's Start would
    expect(await rec.startByHelper()).toBe(true);
    if (o.reopen) expect(await rig.host.reopen()).toBe(true);
    await rig.run(600000, o.pilot, () => rig.passed);
    await rig.run(60000, o.pilot, () => rig.host.lesson?.id !== o.a);
    expect(rig.host.lesson?.id).toBe(o.b);
    await rig.run(6000, o.pilot);
    const done = await rec.stop();
    expect(done).not.toBeNull();
    const parts = await packSession(await openSessionStore(dir, done!.id, false));
    const pkg = readPackage(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()));
    expect(pkg.problems).toEqual([]);
    return { pkg, rig };
}

describe('two lessons flown through the host and recorded as one package replay lesson by lesson', () => {
    let made: { pkg: SessionPackage; rig: Rig } | null = null;
    afterEach(() => {
        made?.rig.dispose();
        made = null;
    });

    it('rings-first to its pass, then rings-line opened by the host: every event of each lesson re-derived, the cues by kind on 99 % of the frames; control: the one-lesson check fails', async () => {
        made = await recordTwoLessons();
        const { pkg } = made;
        const opens = pkg.events.filter((e) => e.kind === 'lesson' && e.what === 'open');
        // the recording started inside rings-first, which opened again at once: both lessons are in it from their opens
        expect(opens.map((e) => (e as { lessonId: string }).lessonId)).toEqual(['rings-first', 'rings-line']);
        expect(pkg.frames[0]!.t).toBeGreaterThanOrEqual((opens[0] as SessionEvent).t);
        const lastOfA = pkg.frames.filter((f) => f.t < (opens[1] as SessionEvent).t).at(-1)!;
        expect((opens[1] as SessionEvent).t).toBeGreaterThan(lastOfA.t); // the open of B is where it happened, after A's frames (the clock fix)
        const out: ReplayOutcome = await checkPackage(pkg);
        expect(out.error).toBeNull();
        expect(out.segments.map((s) => s.segment.lessonId)).toEqual(['rings-first', 'rings-line']);
        for (const s of out.segments) {
            const c = s.check!;
            const cues = { frames: c.cues.frames, share: c.cues.share, classShare: c.cues.classShare };
            expect(c.events.diffs, s.segment.lessonId ?? '').toEqual([]);
            expect(c.events.matched).toBe(c.events.recorded);
            // the sector of a hazard voice flips with the rate the sampler is fed at (compare.ts): the rig renders a frame every 16 ms
            // and the recorder keeps them on a 33.3 ms grid, so 32 and 48 ms apart; the kind of every cue agrees (the page, at a steady
            // 60 Hz, is measured by tools/bench/src/sonic-int-page.ts replay)
            expect(c.cues.classShare, `${s.segment.lessonId}: ${JSON.stringify(cues)}`).toBeGreaterThanOrEqual(0.99);
            expect(c.cues.share, `${s.segment.lessonId}: ${JSON.stringify(cues)}`).toBeGreaterThanOrEqual(0.9);
        }
        expect(out.check!.events.recorded).toBe(out.segments.reduce((a, s) => a + s.check!.events.recorded, 0));
        expect(out.check!.events.diffs).toEqual([]);
        expect(out.check!.cues.frames).toBe(pkg.frames.length);
        expect(out.segments[1]!.setup.world?.id).not.toBe(out.segments[0]!.setup.world?.id); // two worlds
        expect(out.check!.events.byKind.gate.matched).toBeGreaterThanOrEqual(8); // rings-first: eight of ten through its ring
        // control: the same bytes through the package's one-lesson check (what the replay did before this step) do not re-derive
        const old = checkSession(pkg);
        expect(old.check.events.diffs.length).toBeGreaterThan(0);
        expect(old.check.notes.map((n) => n.code)).toContain('other-lesson-events');
    }, 600000);

    it('the old way (the lesson not opened again at the recording\'s start): the lead is replayed and not compared, said in the details; the next lesson is compared', async () => {
        made = await recordTwoLessons({ ...RINGS, reopen: false });
        const out = await checkPackage(made.pkg);
        expect(out.segments.map((s) => [s.segment.lessonId, s.segment.lead, s.check === null])).toEqual([
            ['rings-first', true, true],
            ['rings-line', false, false]
        ]);
        expect(out.check!.events.diffs).toEqual([]);
        expect(out.check!.cues.frames).toBe(out.segments[1]!.segment.frames.length);
        expect(out.line).toMatch(/rings-first: began before the recording/);
        // control: compared as the lane's replay did (from the first frame, as if the lesson had begun there) the lead does not agree
        const lead = out.segments[0]!.segment;
        expect(checkSession({ manifest: lead.manifest, frames: lead.frames, events: lead.events }).check.ok).toBe(false);
    }, 600000);
});

// ------------------------------------------------------------------ the player, lesson by lesson, on a fake audio clock

describe('the player plays the lessons in turn on the package\'s one clock', () => {
    it('each lesson\'s world is shown when its first frame is due, its layers sound, every frame is fed once, the voice is started once', async () => {
        const { pkg, rig } = await recordTwoLessons();
        try {
            const out = await checkPackage(pkg);
            const clock = { a: 100 };
            const shown: { lesson: string | null; world: string | null; at: number }[] = [];
            let restored = 0;
            const view: WorldSink = {
                show: (setup: ReplaySetup) => {
                    shown.push({ lesson: setup.lesson?.id ?? null, world: setup.world?.id ?? null, at: clock.a });
                    return true;
                },
                restore: () => void restored++
            };
            const fed: number[] = [];
            const layers: LessonLayers[] = [];
            const plays: { whenAc: number; offsetS: number }[] = [];
            const deps: ReplayDeps = {
                now: () => clock.a,
                engine: { update: (i) => void fed.push(i.sample.t), cue: () => undefined, say: async () => undefined, setLayers: (l) => void layers.push(l), setPrefs: () => undefined, setTheme: () => undefined },
                pose: { begin: () => undefined, show: () => undefined, end: () => undefined },
                voice: { decode: async () => ({ duration: 60 }) as VoiceBuffer, play: (_b, whenAc, offsetS) => { plays.push({ whenAc, offsetS }); return { stop: () => undefined }; } },
                own: () => ({ prefs: defaultPrefs(), theme: getBuiltinTheme('soft') }),
                playback: () => undefined,
                view
            };
            const withVoice: SessionPackage = { ...pkg, voice: new Uint8Array(10), manifest: { ...pkg.manifest, clock: { ...pkg.manifest.clock, voiceOffsetMs: 0 } } };
            const player = new ReplayPlayer(deps, withVoice, out.segments);
            await player.prepare();
            player.play();
            const firstB = out.segments[1]!.segment.frames[0]!.t;
            for (let i = 0; i < 20000 && player.state.phase !== 'ended'; i++) {
                clock.a += 1 / 60;
                player.tick();
            }
            expect(player.state.phase).toBe('ended');
            expect(shown.map((s) => s.lesson)).toEqual(['rings-first', 'rings-line']);
            // B's world came in the tick its first frame was due: its package time on the clock, within one display frame
            const atB = 100 + firstB / 1000;
            expect(shown[1]!.at).toBeGreaterThanOrEqual(atB - 1e-9);
            expect(shown[1]!.at - atB).toBeLessThan(1 / 60 + 1e-9);
            // the engine took rings-line's own layers when it came (then, at the end, none)
            const bLayers = out.segments[1]!.setup.lesson!.layers;
            expect(bLayers).not.toEqual(out.segments[0]!.setup.lesson!.layers);
            expect(layers.findIndex((l) => JSON.stringify(l) === JSON.stringify(bLayers))).toBeGreaterThan(0);
            expect(layers.at(-1)!.on).toEqual([]);
            expect(player.trace.fed.map((f) => f.t)).toEqual(pkg.frames.map((f) => f.t)); // every frame once, in order, across both lessons
            expect(plays).toHaveLength(1); // the voice runs on: not started again for the second lesson
            expect(player.trace.switches.map((s) => s.part)).toEqual([0, 1]);
            // at the end B is on: a seek back into A shows A, one into B shows B again (each replayer at the frame sought); a seek
            // inside the lesson shown draws nothing anew; close gives the mode's own view back
            player.seek(100);
            player.seek(firstB + 300);
            player.seek(firstB + 600);
            expect(shown.map((s) => s.lesson)).toEqual(['rings-first', 'rings-line', 'rings-first', 'rings-line']);
            expect(player.state.lesson).toBe('rings-line');
            expect(player.state.frame).toBe(out.segments[1]!.segment.firstFrame + out.segments[1]!.segment.frames.filter((f) => f.t <= firstB + 600).length);
            player.close();
            expect(restored).toBe(1);
        } finally {
            rig.dispose();
        }
    }, 600000);

    it('an unknown lesson in a later piece keeps today\'s refusal (the replay core names it); a package of one lesson is unchanged', async () => {
        const frames = [0, 33, 66, 100, 133].map(frameAt);
        const out = await checkPackage({ manifest: BASE, frames, events: [open(66, 'no-such-lesson')] });
        expect(out.error?.code).toBe('unknown-lesson');
        expect(out.setup).toBeNull();
        const one = await checkPackage({ manifest: BASE, frames, events: [] });
        expect(one.segments).toHaveLength(1);
        expect(one.segments[0]!.segment.manifest).toBe(BASE);
    });
});

