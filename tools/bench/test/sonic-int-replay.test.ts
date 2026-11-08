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
// v0.13 (lane v13-host A2, docs/wip/v13-host.md "Changed tests"): module 0's sounds are 'repeat-cue' plays (the rig's answerer reads
// them); rings-first's lesson sounds agree on every frame and only its safety layer differs, each kind of difference named below
// (W19); the floor control hovers within ALWAYS_HEARD_M (M41-13: a still craft 1.5 m up hears no floor).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_HEARD_M, CuePlanner, DEFAULT_SAMPLER_CONFIG, DEFAULT_TOLERANCES, buildManifest, checkSession, compareCues, createAnalyticWorld, defaultPrefs, getBuiltinTheme, getLesson, packSession, readPackage } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, FlightSample, LessonLayers, ReplaySetup, SessionEvent, SessionManifest, SessionPackage, SonicEngine, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import { lessonViewWorld } from '../../../apps/fly/src/sonic/lesson-world';
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
    /** page time spent in the second lesson before the recording stops, ms (default 6000) */
    readonly after?: number;
}
const RINGS: Flight = { a: 'rings-first', b: 'rings-line', pilot: throughTheGate, reopen: true };

/**
 * The frames of a replayed lesson whose cues differ from the recording outside the safety layer, by the comparer's slack (a
 * recorded frame agrees when the derived cues of a frame within the slack have the same ids). The lesson's own sounds (the
 * target, the height, the shape, the room) must agree on every frame. The safety layer is held by the shares only, and each way
 * it differs is known (W19, measured on rings-first at the gitlink 16c01a1: 29 of 2225 frames by kind): its hazard voices change
 * sector, at a corner even floor for wall, with the rate the sampler is fed at (about 60 Hz live, 30 Hz in the replay: 9 frames);
 * the open-way chime holds on from a sample the recording does not keep (10 frames); and the host's touch ping (SonicMode, at
 * every touched sample, the task and the time between attempts included) is not derived by the replay at all (11 frames;
 * "Needs from the package" in docs/wip/v13-host.md).
 */
function beyondSafety(frames: readonly FlightFrame[], derived: readonly (readonly string[])[]): number[] {
    const key = (ids: readonly string[]): string => [...new Set(ids.filter((id) => !id.startsWith('safety.')))].sort().join('|');
    const rec = frames.map((f) => key(f.c));
    const der = derived.map(key);
    const n = Math.min(rec.length, der.length);
    const slack = DEFAULT_TOLERANCES.cueSlackFrames;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        let ok = false;
        for (let k = Math.max(0, i - slack); k <= Math.min(n - 1, i + slack) && !ok; k++) ok = rec[k] === der[i];
        if (!ok) out.push(i);
    }
    return out;
}

/** Module 0: a digit for each question from the side the sound came from (sonic-lessons.test.ts's pilot: left 1, right 2, behind 2). */
const earsPilot: Control = (r) => {
    if (!r.host.asking || r.engine.speaking) return null;
    const d = r.engine.lastPreviewDir();
    return { answer: d && d[0] < 0 ? 1 : d && d[0] > 0 ? 2 : d && d[2] > 0 ? 2 : 1 };
};
const EARS: Flight = { a: 'ears-headphones', b: 'ears-glossary', pilot: earsPilot, reopen: true, after: 90000 };

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
    await rig.run(o.after ?? 6000, o.pilot);
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

    it('rings-first to its pass, then rings-line opened by the host: every event of each lesson re-derived, the lesson\'s own cues on every frame, the safety layer\'s by kind on 98 % once a lesson has settled; controls: the one-lesson check fails, a lesson cue missing is caught', async () => {
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
        const derived: (readonly (readonly string[])[])[] = [];
        for (const s of out.segments) {
            const c = s.check!;
            const cues = { frames: c.cues.frames, share: c.cues.share, classShare: c.cues.classShare };
            expect(c.events.diffs, s.segment.lessonId ?? '').toEqual([]);
            expect(c.events.matched).toBe(c.events.recorded);
            // the lesson's own sounds agree on every frame (beyondSafety says how the safety layer differs, and why)
            const seg = s.segment;
            const d = checkSession({ manifest: seg.manifest, frames: seg.frames, events: seg.events }).result.cues;
            derived.push(d);
            expect(beyondSafety(seg.frames, d), seg.lessonId ?? '').toEqual([]);
            // The first moments of a lesson the host opened are left out of the shares: the live engine still holds the hazard
            // sectors of what it heard before (the sampler keeps every active sector holdMs on when the clock goes back, and
            // nothing resets it at a new lesson: "Needs from the package"), while the replay starts each lesson fresh. At 16c01a1
            // rings-line's first 9 frames differ so (the ceiling voiced with the craft at rest 2.2 m under it), 95 % by kind in all.
            const settle = seg.lead ? 0 : seg.frames.findIndex((f) => f.t >= seg.fromT + DEFAULT_SAMPLER_CONFIG.holdMs + 100);
            const from = settle < 0 ? seg.frames.length : settle;
            const settled = compareCues(seg.frames.slice(from), d.slice(from));
            expect(from).toBeLessThan(seg.frames.length / 10);
            // the sector of a hazard voice flips with the rate the sampler is fed at (compare.ts): the rig renders a frame every 16 ms
            // and the recorder keeps them on a 33.3 ms grid, so 32 and 48 ms apart (the page, at a steady 60 Hz, is measured by
            // tools/bench/src/sonic-int-page.ts replay). In v0.13's 10 x 12.5 m room (micro-drone scale, M41-18) the walls are heard
            // on most frames, so more voices flip: rings-first by kind 98.7 %, by sector 85.8 % at 16c01a1 (v0.12 held 99 % and 90 %)
            const shares = { ...cues, settled: { from, classShare: settled.classShare, share: settled.share } };
            expect(settled.classShare, `${s.segment.lessonId}: ${JSON.stringify(shares)}`).toBeGreaterThanOrEqual(0.98);
            expect(settled.share, `${s.segment.lessonId}: ${JSON.stringify(shares)}`).toBeGreaterThanOrEqual(0.85);
        }
        // control: a lesson sound missing from the replay in one frame of fifty is caught by the check above
        const a = out.segments[0]!.segment;
        const missing = derived[0]!.map((ids, i) => (i % 50 === 0 ? ids.filter((id) => !id.startsWith('height.')) : ids));
        expect(beyondSafety(a.frames, missing).length).toBeGreaterThan(0);
        expect(out.check!.events.recorded).toBe(out.segments.reduce((a, s) => a + s.check!.events.recorded, 0));
        expect(out.check!.events.diffs).toEqual([]);
        expect(out.check!.cues.frames).toBe(pkg.frames.length);
        expect(out.segments[1]!.setup.world?.id).not.toBe(out.segments[0]!.setup.world?.id); // two worlds
        expect(out.check!.events.byKind.gate.matched).toBeGreaterThanOrEqual(getLesson('rings-first').pass.required); // rings-first: r through its ring
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

// ------------------------------------------------------------------ module 0: no world for the sound

describe('module 0 (the ears lessons) has no world for the sound, so its recording replays with every sound the same', () => {
    let made: { pkg: SessionPackage; rig: Rig } | null = null;
    afterEach(() => {
        made?.rig.dispose();
        made = null;
    });

    it('ears-headphones to its pass, then ears-glossary opened by the host: every event re-derived and the cue ids of EVERY frame equal (found in the joined page: 0 % in ears-glossary); the engine was given no world', async () => {
        made = await recordTwoLessons(EARS);
        const { pkg, rig } = made;
        const opens = pkg.events.filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => (e as { lessonId: string }).lessonId);
        expect(opens).toEqual(['ears-headphones', 'ears-glossary']);
        // what the engine heard in the glossary: the craft over the page's floor would voice a hazard (the floor below) between the previews;
        // the glossary's layers include safety, so this is where it shows
        // (neither lesson plays a demo scene, whose own little worlds are the lesson's: every frame the engine was fed is the craft with no world)
        expect(rig.engine.inputs.length).toBeGreaterThan(100);
        expect(rig.engine.inputs.every((i) => i.world === null)).toBe(true);
        expect(rig.engine.lastInput?.world).toBeNull();
        const out: ReplayOutcome = await checkPackage(pkg);
        expect(out.error).toBeNull();
        expect(out.segments.map((s) => s.segment.lessonId)).toEqual(['ears-headphones', 'ears-glossary']);
        for (const s of out.segments) {
            const c = s.check!;
            expect(c.events.diffs, s.segment.lessonId ?? '').toEqual([]);
            expect(c.events.matched).toBe(c.events.recorded);
            expect(c.cues.frames).toBeGreaterThan(100);
            // before the fix the glossary's share was 0 (every frame had a floor voice no replay derives); now the only frames that differ are
            // the ones where a preview's note ends: the rig renders a frame every 16 ms and the recorder keeps a 33.3 ms grid (32 and 48 ms
            // apart), so a note that ends between two kept frames can end a frame early or late in the replay (the page's steady 60 Hz is
            // measured by tools/bench/src/sonic-e2e.ts)
            expect(c.cues.share, `${s.segment.lessonId}: ${JSON.stringify(c.cues.mismatches.slice(0, 2))}`).toBeGreaterThanOrEqual(0.995);
            expect(c.cues.classShare, s.segment.lessonId ?? '').toBeGreaterThanOrEqual(0.995);
            expect(c.cues.identical / c.cues.frames).toBeGreaterThanOrEqual(0.99);
        }
        expect(out.check!.ok).toBe(true);
        // the recorded frames of the glossary carry the sounds that were really there: previews of a hazard, the room, the height tone, and no floor voice
        const ids = new Set(pkg.frames.flatMap((f) => f.c));
        expect(ids.has('safety.floor:down')).toBe(false);
        expect(ids.has('safety.floor:preview')).toBe(true); // the glossary's own preview of that cue is
        expect(ids.has('room.bed')).toBe(true);
    }, 600000);

    it('control: the same glossary heard over a floor, as the page fed it before, voices the floor below at every frame, and no replay (which has no world there) derives it', () => {
        const lesson = getLesson('ears-glossary');
        const heard = (world: ReturnType<typeof lessonViewWorld>): string[] => {
            const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
            // within ALWAYS_HEARD_M of the floor: since M41-13 a still craft hears a surface by its time to contact, and 1.5 m up
            // (where the page's floor puts the ears lessons' craft) it hears none; this near, a surface is always heard
            const sample: FlightSample = { t: 1000, tick: 1, pos: [0, ALWAYS_HEARD_M, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
            let ids: string[] = [];
            for (let k = 0; k < 10; k++) ids = planner.plan({ sample: { ...sample, t: 1000 + k * 33, tick: k }, world, target: null, floorY: 0 }).cues.map((c) => c.id);
            return ids;
        };
        expect(heard(lessonViewWorld(lesson))).toContain('safety.floor:down');
        expect(heard(null)).not.toContain('safety.floor:down');
    });
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

