// v0.12 Fly by Sound, lane v12-flight step 2 (docs/wip/v12-plan.md 4.2 and 9.5): the bridge between the flight and
// the sound package. Driven with a fake session (a scripted craft, a runner slot, contact events at chosen
// ticks) and once with the real FlightSession in a lesson world.
//  - nothing while the mode is off: no hook on the runner, no sample, no event (control: on, it does all three);
//  - one sample per frame mirroring the model; the flight's pause and resume as 'session' events;
//  - contacts become touches after 0.5 s of quiet (control: contacts 0.6 s apart are one touch each);
//  - the tick hook follows each new runner, chains what was there and gives it back;
//  - the markers: a lesson recorded through the bridge passes the sound package's replay check (checkSession);
//    controls: the same recording without the speech.end markers, or without the reset and next keys, fails;
//  - when the frames stop the engine gets no layer, and say() passes interrupt and reports the empty queue.
// v0.13 (lane v13-host A2, docs/wip/v13-host.md "Changed tests"): walls-hall is a small room (10 x 12 m), so every place is
// taken from its world's landmarks, and N is pressed in the task (N while flying leaves the lesson, M41-6).
import { afterEach, describe, expect, it } from 'vitest';
import { S, attitude } from '../../../packages/sim-core/src';
import type { Sim, SimEvent } from '../../../packages/sim-core/src';
import { CuePlanner, DICTS, SPEECH_END_KEY, buildManifest, checkSession, createAnalyticWorld, createLessonRunner, createTranslator, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, FlightSample, LessonDef, LessonLayers, LessonSession, RunnerAction, SessionEvent, SonicWorld, SpeechLine, Vec3 } from '../../../packages/sonic-fpv/src';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { SILENT_LAYERS, SonicBridge, TOUCH_QUIET_TICKS } from '../../../apps/fly/src/sonic/bridge';
import type { BridgeEngine, BridgeRunner, BridgeSession } from '../../../apps/fly/src/sonic/bridge';
import { lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';

const DEG = Math.PI / 180;

/** walls-hall's world (the room the bridge tests fly) and its named points: the start and the middles of its walls, at the start height. */
const HALL = createAnalyticWorld((getLesson('walls-hall').world as Extract<LessonDef['world'], { kind: 'analytic' }>).spec);
const mark = (id: string): Vec3 => HALL.landmarks.find((l) => l.id === id)!.pos;

/** A model-like object with what the bridge reads (s, tick, ch) and a runner slot with its events. */
class FakeFlight implements BridgeSession {
    readonly sim = { s: new Float64Array(S.size), tick: 0, ch: new Float64Array(8) } as unknown as Sim;
    runner: (BridgeRunner & { events: SimEvent[] }) | undefined = { sim: this.sim, events: [], onStep: null };
    paused = false;
    replaying = false;
    get shownSim(): Sim | undefined {
        return this.runner ? this.sim : undefined;
    }

    place(pos: Vec3, vel: Vec3, yawDeg: number): void {
        const s = this.sim.s;
        s[S.px] = pos[0]; s[S.py] = pos[1]; s[S.pz] = pos[2];
        s[S.vx] = vel[0]; s[S.vy] = vel[1]; s[S.vz] = vel[2];
        const h = -yawDeg * DEG * 0.5; // sim-core reset(): a rotation about +y, right heading negative
        s[S.qw] = Math.cos(h); s[S.qx] = 0; s[S.qy] = Math.sin(h); s[S.qz] = 0;
        s[S.armed] = 1;
    }

    /** Steps the model's tick to `tick`, calling the runner's hook every tick; a contact at the ticks in `contacts`. */
    stepTo(tick: number, contacts: readonly number[] = []): void {
        const r = this.runner!;
        while (this.sim.tick < tick) {
            (this.sim as { tick: number }).tick++;
            if (contacts.includes(this.sim.tick)) r.events.push({ type: 'contact', tick: this.sim.tick, speed: 0.8, regime: 'slide' });
            r.onStep?.(this.sim);
        }
    }
}

function bridgeOn(clock: { t: number }): { bridge: SonicBridge; samples: FlightSample[]; events: SessionEvent[] } {
    const samples: FlightSample[] = [];
    const events: SessionEvent[] = [];
    const bridge = new SonicBridge({ sample: (s) => samples.push(s), event: (e) => events.push(e) }, () => clock.t);
    return { bridge, samples, events };
}

describe('the bridge does nothing while the mode is off', () => {
    it('no hook on the runner, no sample, no event; control: started, it does all three; stopped, the hook is given back', () => {
        const clock = { t: 1000 };
        const f = new FakeFlight();
        const mine = (): void => undefined;
        f.runner!.onStep = mine;
        const { bridge, samples, events } = bridgeOn(clock);
        bridge.follow(f);
        expect(bridge.frame()).toBeNull();
        bridge.key('KeyR', 'reset.start');
        bridge.event({ t: 0, kind: 'checkpoint', id: 'cp' });
        f.stepTo(600, [100]);
        expect(f.runner!.onStep).toBe(mine);
        expect(samples).toEqual([]);
        expect(events).toEqual([]);
        // control: the mode on
        bridge.start(f);
        expect(f.runner!.onStep).not.toBe(mine);
        f.stepTo(1200, [1100]);
        expect(bridge.frame()?.touched).toBe(true);
        bridge.key('KeyR', 'reset.start');
        expect(samples).toHaveLength(1);
        expect(events.map((e) => e.kind)).toEqual(['touch', 'key']);
        bridge.stop();
        expect(f.runner!.onStep).toBe(mine);
        expect(bridge.frame()).toBeNull();
    });
});

describe('samples', () => {
    it('one per frame, mirroring the model; t on the mode clock from start(); paused while paused or replaying, with session events', () => {
        const clock = { t: 5000 };
        const f = new FakeFlight();
        const { bridge, samples, events } = bridgeOn(clock);
        bridge.start(f);
        f.place([1, 2, 3], [0.5, -0.25, -2], 30);
        f.sim.s[S.wx] = 0.1; f.sim.s[S.wy] = -0.2; f.sim.s[S.wz] = 0.3;
        f.sim.ch.set([0.1, -0.2, 0.3, -0.4, 1, 0, 0, 0]);
        f.stepTo(1234);
        clock.t = 5016.7;
        const s = bridge.frame()!;
        expect(s.t).toBe(17);
        expect(s.tick).toBe(1234);
        expect(s.pos).toEqual([1, 2, 3]);
        expect(s.vel).toEqual([0.5, -0.25, -2]);
        expect(s.rate).toEqual([0.1, -0.2, 0.3]);
        expect(s.sticks).toEqual([0.1, -0.2, 0.3, -0.4]);
        const a = attitude(f.sim.s);
        expect(s.yawDeg).toBeCloseTo(30, 9);
        expect([s.yawDeg, s.pitchDeg, s.rollDeg]).toEqual([a.yaw, a.pitch, a.roll]);
        expect(s.quat).toEqual([f.sim.s[S.qw], 0, f.sim.s[S.qy], 0]);
        expect(s.armed).toBe(true);
        expect(s.paused).toBe(false);
        f.paused = true;
        clock.t += 16;
        expect(bridge.frame()!.paused).toBe(true);
        f.paused = false;
        f.replaying = true;
        expect(bridge.frame()!.paused).toBe(true);
        f.replaying = false;
        clock.t += 16;
        expect(bridge.frame()!.paused).toBe(false);
        expect(samples).toHaveLength(4);
        expect(events.map((e) => (e.kind === 'session' ? e.what : e.kind))).toEqual(['pause', 'resume']);
        // a scene switch in progress: no model, no sample
        f.runner = undefined;
        expect(bridge.frame()).toBeNull();
    });
});

describe('touches: contacts after 0.5 s of quiet', () => {
    /** Contacts at the given ticks, a frame every 16 ticks; the frames whose sample says touched. */
    function touchedFrames(contacts: readonly number[]): number[] {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge } = bridgeOn(clock);
        bridge.start(f);
        const out: number[] = [];
        for (let tick = 16; tick <= 4000; tick += 16) {
            f.stepTo(tick, contacts);
            clock.t = tick;
            if (bridge.frame()!.touched) out.push(tick);
        }
        return out;
    }

    it('a scrape (a contact every 100 ms for 1 s) is one touch; contacts 600 ms apart are one touch each (control)', () => {
        const scrape = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];
        expect(touchedFrames(scrape)).toEqual([1008]);
        expect(touchedFrames([1000, 1600, 2200])).toEqual([1008, 1600, 2208]);
        // quiet is counted from the LAST contact: 400 ms after the scrape ends it is still the same touch
        expect(touchedFrames([...scrape, 2300])).toEqual([1008]);
        expect(touchedFrames([...scrape, 1900 + TOUCH_QUIET_TICKS])).toEqual([1008, 2400]);
    });

    it('a respawn between two contacts makes the second a new touch', () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge } = bridgeOn(clock);
        bridge.start(f);
        f.stepTo(1000, [1000]);
        expect(bridge.frame()!.touched).toBe(true);
        f.runner!.events.push({ type: 'respawn', tick: 1001 });
        f.stepTo(1001);
        f.stepTo(1100, [1100]);
        expect(bridge.frame()!.touched).toBe(true);
        // control: no respawn, the same 100 ms gap is the same touch
        f.stepTo(1200, [1200]);
        expect(bridge.frame()!.touched).toBe(false);
    });

    it('without a lesson runner the bridge writes the touch event by the runner\'s rule; with one it does not', () => {
        const lw = lessonWorldOf(getLesson('walls-hall'))!;
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge, events } = bridgeOn(clock);
        bridge.world = lw.world;
        bridge.start(f);
        // on the floor, halfway from the start to the front wall
        const floor: Vec3 = [(mark('start')[0] + mark('wall-front')[0]) / 2, 0.06, (mark('start')[2] + mark('wall-front')[2]) / 2];
        f.place(floor, [0, -0.5, 0], 0);
        f.stepTo(1000, [1000]);
        clock.t = 1000;
        bridge.frame();
        expect(events).toEqual([{ t: 1000, kind: 'touch', material: 'floor', speed: 0.5, pos: floor }]);
        bridge.runner = createLessonRunner(getLesson('walls-hall'));
        f.stepTo(2000, [2000]);
        expect(bridge.frame()!.touched).toBe(true);
        expect(events).toHaveLength(1);
    });
});

describe('the tick hook follows the runner', () => {
    it('a new runner gets the hook, the old one gets back what it had; a hook that was there is still called first', () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge } = bridgeOn(clock);
        const calls: string[] = [];
        const before = (sim: Sim): void => { calls.push(`before ${sim.tick}`); };
        f.runner!.onStep = before;
        bridge.start(f);
        const first = f.runner!;
        f.stepTo(1);
        expect(calls).toEqual(['before 1']);
        // a new flight model (rebuildSim): a new runner object
        f.runner = { sim: f.sim, events: [], onStep: null };
        bridge.follow(f);
        expect(first.onStep).toBe(before);
        expect(f.runner.onStep).not.toBeNull();
        f.stepTo(1500, [1400]);
        expect(bridge.frame()!.touched).toBe(true);
        // following the same runner again changes nothing
        const hook = f.runner.onStep;
        bridge.follow(f);
        expect(f.runner.onStep).toBe(hook);
        // the frame follows by itself too
        const third = { sim: f.sim, events: [] as SimEvent[], onStep: null };
        f.runner = third;
        bridge.frame();
        expect(third.onStep).not.toBeNull();
    });
});

describe('the frames stop: the engine falls silent', () => {
    function fakeEngine(): BridgeEngine & { layers: LessonLayers[]; said: { line: SpeechLine; interrupt: boolean | undefined; done: () => void }[] } {
        const e = {
            layers: [] as LessonLayers[],
            said: [] as { line: SpeechLine; interrupt: boolean | undefined; done: () => void }[],
            setLayers(l: LessonLayers): void { e.layers.push(l); },
            cue(): void { /* not heard here */ },
            say(line: SpeechLine, o?: { readonly interrupt?: boolean }): Promise<void> {
                return new Promise((resolve) => e.said.push({ line, interrupt: o?.interrupt, done: resolve }));
            }
        };
        return e;
    }

    it('paused, a playback or the mode stopping: setLayers with no layer, once; going on: the lesson\'s layers again', () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge } = bridgeOn(clock);
        const engine = fakeEngine();
        const layers = getLesson('walls-hall').layers;
        bridge.engine = engine;
        bridge.layers = layers;
        bridge.start(f);
        bridge.frame();
        bridge.frame();
        expect(engine.layers).toEqual([layers]);
        f.paused = true;
        bridge.frame();
        bridge.frame();
        expect(engine.layers).toEqual([layers, SILENT_LAYERS]);
        f.paused = false;
        bridge.frame();
        expect(engine.layers).toEqual([layers, SILENT_LAYERS, layers]);
        bridge.playback(true);
        expect(bridge.frame()).toBeNull();
        bridge.playback(false);
        bridge.frame();
        bridge.stop();
        expect(engine.layers).toEqual([layers, SILENT_LAYERS, layers, SILENT_LAYERS, layers, SILENT_LAYERS]);
        expect(SILENT_LAYERS.on).toEqual([]);
    });

    it('say(): interrupt goes to the engine; the queue running empty is one speech.end marker and runner.spoken', async () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge, events } = bridgeOn(clock);
        const engine = fakeEngine();
        bridge.engine = engine;
        bridge.start(f);
        const spokenAt: number[] = [];
        bridge.runner = { ...createLessonRunner(getLesson('walls-hall')), spoken: (t: number) => { spokenAt.push(t); return []; } } as unknown as LessonSession;
        const a = bridge.say({ key: 'x.one' }, true);
        const b = bridge.say({ key: 'x.two' });
        expect(engine.said.map((s) => [s.line.key, s.interrupt])).toEqual([['x.one', true], ['x.two', false]]);
        expect(bridge.speechQueue).toBe(2);
        clock.t = 700;
        engine.said[0].done();
        await a;
        expect(events).toEqual([]); // one line still in the queue
        clock.t = 1500;
        engine.said[1].done();
        await b;
        expect(events).toEqual([{ t: 1500, kind: 'speech', key: SPEECH_END_KEY, text: '' }]);
        expect(spokenAt).toEqual([1500]);
    });

    // review of v12-flight, D2: G (the glossary), a lesson chosen on the start screen over the flight, or any other way into
    // another lesson enters the mode again while the engine may still be saying the line of the lesson that was left; that
    // line ends later (a new line with interrupt cuts it and speechSynthesis resolves it) and used to take one off the NEW
    // lesson's count, so the new lesson's queue looked empty while its own first line was being said
    it('review D2: a line of the lesson that was left, ending after the next lesson began, is not the end of the new lesson\'s speech', async () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge, events } = bridgeOn(clock);
        const engine = fakeEngine();
        bridge.engine = engine;
        bridge.start(f);
        const left = bridge.say({ key: 'x.old-intro' });
        expect(bridge.speechQueue).toBe(1);
        // the next lesson opens (LessonHost.open -> SonicMode.enter -> SonicBridge.start): a new clock, a new runner
        clock.t = 4000;
        bridge.start(f);
        const spokenAt: number[] = [];
        bridge.runner = { ...createLessonRunner(getLesson('walls-hall')), spoken: (t: number) => { spokenAt.push(t); return []; } } as unknown as LessonSession;
        expect(bridge.speechQueue).toBe(0);
        const fresh = bridge.say({ key: 'x.new-intro' }, true);
        expect(bridge.speechQueue).toBe(1);
        // the engine cuts the old line (speechSynthesis.cancel) and it ends
        engine.said[0].done();
        await left;
        // the new lesson is still saying its intro: no end of speech, no runner.spoken, the count is its own
        expect(events.filter((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY)).toEqual([]);
        expect(spokenAt).toEqual([]);
        expect(bridge.speechQueue).toBe(1);
        // its own line ends: now it is the end of speech, once, on the new lesson's clock
        clock.t = 5300;
        engine.said[1].done();
        await fresh;
        expect(events).toEqual([{ t: 1300, kind: 'speech', key: SPEECH_END_KEY, text: '' }]);
        expect(spokenAt).toEqual([1300]);
        expect(bridge.speechQueue).toBe(0);
    });

    it('review D2 control: lines of the same lesson count as before (a line cut by a later one is not the end; one end after the last line)', async () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge, events } = bridgeOn(clock);
        const engine = fakeEngine();
        bridge.engine = engine;
        bridge.start(f);
        const a = bridge.say({ key: 'x.one' });
        const b = bridge.say({ key: 'x.two' }, true);
        engine.said[0].done();
        await a;
        expect(events).toEqual([]);
        expect(bridge.speechQueue).toBe(1);
        clock.t = 900;
        engine.said[1].done();
        await b;
        expect(events).toEqual([{ t: 900, kind: 'speech', key: SPEECH_END_KEY, text: '' }]);
    });

    it('review D2 control: a line of a lesson that was left, ending after the mode stopped, says nothing; the next start counts from zero', async () => {
        const clock = { t: 0 };
        const f = new FakeFlight();
        const { bridge, events } = bridgeOn(clock);
        const engine = fakeEngine();
        bridge.engine = engine;
        bridge.start(f);
        const left = bridge.say({ key: 'x.old-intro' });
        bridge.stop();
        engine.said[0].done();
        await left;
        expect(events).toEqual([]);
        bridge.start(f);
        expect(bridge.speechQueue).toBe(0);
    });
});

// ---------------------------------------------------------------- the replay check of a lesson recorded through the bridge

/** A host loop around the bridge, as the page will run it (runner, cue planner, speech queue), flying a scripted craft. */
class BridgeHost {
    readonly flight = new FakeFlight();
    readonly clock = { t: 0 };
    readonly frames: FlightFrame[] = [];
    readonly events: SessionEvent[] = [];
    readonly bridge: SonicBridge;
    readonly runner: LessonSession;
    readonly planner: CuePlanner;
    readonly world: SonicWorld | null;
    private readonly tr = createTranslator('en', DICTS);
    private ttsEnd = -1;
    private speaking = false;
    private frameNo = 0;
    pos: Vec3;
    yaw: number;
    private contactAt: number[] = [];

    constructor(readonly lesson: LessonDef, readonly speechEnds: boolean) {
        this.bridge = new SonicBridge({ sample: () => undefined, event: (e) => this.events.push(e) }, () => this.clock.t);
        this.world = lessonWorldOf(lesson)?.world ?? null;
        this.bridge.world = this.world;
        this.runner = createLessonRunner(lesson, { locale: 'en', sessionStartMs: Date.parse('2026-11-07T10:00:00Z') });
        this.planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
        this.pos = lesson.start.pos;
        this.yaw = lesson.start.yawDeg;
        this.flight.place(this.pos, [0, 0, 0], this.yaw);
        this.bridge.start(this.flight);
    }

    private handle(actions: readonly RunnerAction[]): void {
        for (const a of actions) {
            if (a.kind === 'say') {
                const text = this.tr.text(a.line);
                this.bridge.speech(a.line.key, text);
                this.ttsEnd = Math.max(this.clock.t, this.ttsEnd) + 300 + 45 * text.length;
                this.speaking = true;
            } else if (a.kind === 'cue') this.planner.cue(a.event);
            else if (a.kind === 'place') this.put(a.pose.pos, a.pose.yawDeg);
        }
    }

    private put(pos: Vec3, yaw: number): void {
        this.pos = pos;
        this.yaw = yaw;
        this.flight.place(pos, [0, 0, 0], yaw);
        this.flight.runner!.events.push({ type: 'respawn', tick: this.flight.sim.tick });
    }

    private drain(): void {
        for (let g = 0; g < 50; g++) {
            const a = this.runner.takeActions();
            if (a.length === 0) return;
            this.handle(a);
        }
    }

    begin(): void {
        this.clock.t = 500;
        this.bridge.begin(this.runner);
        this.drain();
    }

    /** One 60 Hz frame. */
    frame(vel: Vec3 = [0, 0, 0]): void {
        this.clock.t += 1000 / 60;
        if (this.speaking && this.clock.t >= this.ttsEnd) {
            this.speaking = false;
            if (this.speechEnds) this.bridge.spoken();
            this.drain();
        }
        this.flight.place(this.pos, vel, this.yaw);
        this.flight.stepTo(Math.round(this.clock.t), this.contactAt);
        const sample = this.bridge.frame()!;
        this.bridge.events(this.runner.step(sample, this.world));
        this.drain();
        const input = this.runner.demoFrame(sample.t) ?? { sample, world: this.world, target: this.runner.target(), beacon: this.runner.beaconTarget(), floorY: 0 }; // lane sonic-beacon: as mode.ts
        const plan = this.planner.plan(input);
        if (++this.frameNo % 2 === 0) this.frames.push({ t: sample.t, tick: sample.tick, p: sample.pos, v: sample.vel, q: sample.quat, s: sample.sticks, c: plan.cues.map((c) => c.id) });
    }

    hold(seconds: number): void {
        for (let i = 0; i < Math.round(seconds * 60); i++) this.frame();
    }

    until(cond: () => boolean, maxSeconds: number): void {
        for (let i = 0; i < maxSeconds * 60 && !cond(); i++) this.frame();
    }

    flyTo(to: Vec3, speed: number): void {
        const step = speed / 60;
        for (let g = 0; g < 100000; g++) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const len = Math.hypot(...d);
            if (len <= step) { this.pos = to; this.frame(); return; }
            const v: Vec3 = [(d[0] / len) * speed, (d[1] / len) * speed, (d[2] / len) * speed];
            this.pos = [this.pos[0] + v[0] / 60, this.pos[1] + v[1] / 60, this.pos[2] + v[2] / 60];
            this.frame(v);
        }
    }

    /** A contact of the flight model at the next tick. */
    touch(): void {
        this.contactAt.push(this.flight.sim.tick + 1);
    }

    resetTo(to: 'checkpoint' | 'start'): void {
        const r = this.bridge.resetTo(to, 'KeyR');
        if (r) this.put(r.pose.pos, r.pose.yawDeg);
        this.drain();
    }

    next(): void {
        this.bridge.next('KeyN');
        this.drain();
    }

    pkg(events: readonly SessionEvent[] = this.events): { manifest: ReturnType<typeof buildManifest>; frames: FlightFrame[]; events: SessionEvent[] } {
        const world = this.world;
        const manifest = buildManifest({
            id: 'bridgeSession0000001',
            created: '2026-11-07T10:00:00Z',
            app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
            scene: world === null ? { kind: 'none', id: 'none', version: 1, transform: [1, 0, 0, 0] } : { kind: 'analytic', id: world.id, version: world.version, transform: [1, 0, 0, 0] },
            lesson: { id: this.lesson.id, version: this.lesson.version, path: 'full' },
            theme: { id: 'soft', version: getBuiltinTheme('soft').version },
            settings: defaultPrefs(),
            assists: this.lesson.assists,
            device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
            consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' },
            pilot: { id: 'testPilot01', nickname: null },
            clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30 }
        });
        return { manifest, frames: this.frames, events: [...events] };
    }
}

/**
 * walls-hall flown through the bridge with the pilot's keys: next (in the task: N while flying leaves the lesson since v0.13),
 * a stop a metre from the front wall, a contact, a reset to the checkpoint, a long reset; the places are the world's landmarks.
 */
function wallsHall(speechEnds = true): BridgeHost {
    const h = new BridgeHost(getLesson('walls-hall'), speechEnds);
    const start = mark('start'), front = mark('wall-front'), back = mark('wall-back');
    const stop: Vec3 = [front[0], front[1], front[2] + 1];
    const behind: Vec3 = [start[0], start[1], (start[2] + back[2]) / 2];
    h.begin();
    h.hold(1.5);
    h.next();
    h.until(() => h.runner.phase === 'flying', 120);
    h.flyTo(stop, 3);
    h.hold(1.2);
    h.until(() => h.runner.phase === 'flying', 20);
    h.flyTo(start, 3);
    h.touch();
    h.flyTo(behind, 3);
    h.resetTo('checkpoint');
    h.hold(0.5);
    h.resetTo('start');
    h.flyTo(stop, 3);
    h.hold(4.5);
    return h;
}

describe('the replay markers: a lesson recorded through the bridge passes the sound package\'s replay check', () => {
    it('walls-hall with N, R short, R long and a contact: every event re-derived, the cues of 95 % of the frames', () => {
        const h = wallsHall();
        const kinds = h.events.map((e) => e.kind);
        expect(h.events[0]).toMatchObject({ kind: 'lesson', what: 'open', lessonId: 'walls-hall' });
        expect(h.events.filter((e) => e.kind === 'key').map((e) => (e.kind === 'key' ? e.action : ''))).toEqual(['next', 'reset.checkpoint', 'reset.start']);
        expect(h.events.some((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY)).toBe(true);
        expect(kinds.filter((k) => k === 'touch')).toHaveLength(1);
        const { check } = checkSession(h.pkg());
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.events.byKind.touch.matched).toBe(1);
        expect(check.events.byKind.reset.matched).toBe(2);
    });

    it('control: the same recording without its speech.end markers fails', () => {
        const h = wallsHall();
        const { check } = checkSession(h.pkg(h.events.filter((e) => !(e.kind === 'speech' && e.key === SPEECH_END_KEY))));
        expect(check.ok).toBe(false);
        expect(check.notes.map((n) => n.code)).toContain('no-speech-end-markers');
    });

    it('control: the same recording without its key events (N, R) fails', () => {
        const h = wallsHall();
        const { check } = checkSession(h.pkg(h.events.filter((e) => e.kind !== 'key')));
        expect(check.ok).toBe(false);
        expect(check.events.diffs.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------- the real session

/** A renderer that draws nothing (as wind-session.test.ts). */
function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, { get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined) }) as NonNullable<SessionOptions['renderer']>;
}

describe('with the real FlightSession in a lesson world', () => {
    let ses: FlightSession | null = null;
    afterEach(() => { ses?.dispose(); ses = null; });

    it('a flight into the hall\'s wall: touched samples from the model\'s contacts; a new flight model gets the hook', async () => {
        const lw = lessonWorldOf(getLesson('walls-hall'))!;
        ses = await FlightSession.start({} as HTMLCanvasElement, { sceneId: lw.builtin.scene.id, world: lw.builtin, renderer: nullRenderer(), crashOn: false, windSeed: 1 });
        const s = ses;
        const clock = { t: 0 };
        const { bridge, samples } = bridgeOn(clock);
        bridge.start(s);
        // put the craft 1.5 m before the front wall, armed, pitching toward it
        const r = s.runner;
        const t0 = r.sim.tick;
        for (let i = 0; i < 4000; i++) r.enqueue({ tUs: (t0 + i) * 1000, ch: [0, i < 400 ? 0 : 0.35, i < 300 ? -1 : 0.25, 0, i < 100 ? -1 : 1, -1, 0, 0] });
        const front = mark('wall-front');
        r.sim.reset(front[0], front[1], front[2] + 1.5, 0);
        for (let t = t0 + 16; t <= t0 + 4000; t += 16) {
            r.advanceTo(t * 1000);
            clock.t += 16;
            bridge.frame();
        }
        const touched = samples.filter((x) => x.touched).length;
        let contacts = 0;
        for (const e of r.events) if (e.type === 'contact') contacts++;
        expect(contacts).toBeGreaterThan(touched); // many contacts (sliding), few touches
        expect(touched).toBeGreaterThanOrEqual(1);
        expect(samples.length).toBe(250);
        expect(samples.at(-1)!.tick).toBe(r.sim.tick);
        // a new flight model (another drone while parked): a new runner, and the hook moves to it
        const before = s.runner;
        s.rebuildSim('pavo20pro-3s', {});
        expect(s.runner).not.toBe(before);
        bridge.frame(); // the frame after it (the page also follows on the 'life' event the rebuild sends)
        expect(before.onStep).toBeNull();
        expect(s.runner.onStep).not.toBeNull();
        bridge.stop();
        expect(s.runner.onStep).toBeNull();
    });
});
