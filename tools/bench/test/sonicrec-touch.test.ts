// v0.13, lane v13-host A3 (W11 of the sound package's merge review, its M1; docs/wip/v13-host.md): the recorder keeps every
// sample with a touch. A lesson that re-centres on a touch (the corridor and the tunnels: onTouch 'bump-recentre') puts the craft
// back at once, so the frame after a touch is already at the respawn. The replay applies a recorded touch on the first frame at
// or after its time; when the touch's own sample was not kept (the recorder keeps one sample in two at 60 Hz) it derives the
// touch at the respawn, a metre or more off (tolerance 0.15 m), and an honest recording reads FAIL. FrameSampler
// (apps/fly/src/sonic-session/frames.ts) now keeps a touched sample between two due ones too.
//
// Here a host loop as the simulator runs it (the package's lesson runner and cue planner at 60 Hz, the speech queue reported
// empty with its speech.end markers, the frames chosen by the simulator's own FrameSampler) flies tunnel-narrow along its
// world's track and touches its side walls three times, each touch on a sample that is not due: the package's replay check
// reads PASS, every touch and reset re-derived. Control: the same flight with the rule off (the sampler given the samples
// without their touch, as at v0.12) reads FAIL on a touch's position.
import { describe, expect, it } from 'vitest';
import { CuePlanner, DICTS, SPEECH_END_KEY, buildManifest, checkSession, createAnalyticWorld, createLessonRunner, createTranslator, defaultPrefs, getBuiltinTheme, getLesson, replayVerdict, yawQuat } from '../../../packages/sonic-fpv/src';
import type { AnalyticWorldInfo, FlightFrame, FlightSample, LessonDef, LessonSession, RunnerAction, SessionEvent, Vec3, WorldCheckpoint } from '../../../packages/sonic-fpv/src';
import { FrameSampler } from '../../../apps/fly/src/sonic-session/frames';

const HZ = 60;
const STEP_MS = 1000 / HZ;
const SPEED = 2;
/**
 * The touches: halfway between these points of the world's track and the next, each into the wall on the left of the way. The
 * three are straight legs of the tunnel (the others cut its corners): along +X at z = -5, along -Z at x = 5 and at x = 10.
 */
const TOUCH_AFTER = [2, 4, 8];

/** The simulator's host loop around the lesson runner, recording as its recorder does. */
class TunnelHost {
    readonly lesson: LessonDef = getLesson('tunnel-narrow');
    readonly world: AnalyticWorldInfo = createAnalyticWorld((this.lesson.world as Extract<LessonDef['world'], { kind: 'analytic' }>).spec);
    readonly runner: LessonSession = createLessonRunner(this.lesson, { locale: 'en', sessionStartMs: Date.parse('2026-11-08T10:00:00Z') });
    readonly planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: this.lesson.layers });
    readonly sampler = new FrameSampler();
    readonly frames: FlightFrame[] = [];
    readonly events: SessionEvent[] = [];
    /** the t of every touched sample */
    readonly touchedAt: number[] = [];
    private readonly tr = createTranslator('en', DICTS);
    t = 500;
    tick = 0;
    pos: Vec3;
    yaw: number;
    vel: Vec3 = [0, 0, 0];
    placed = 0;
    private touchNext = false;
    private speaking = false;
    private ttsEnd = -1;

    /** `rule` false: the sampler is given the samples without their touch (the recorder before W11). */
    constructor(private readonly rule: boolean) {
        this.pos = this.lesson.start.pos;
        this.yaw = this.lesson.start.yawDeg;
        this.events.push(...this.runner.begin(this.t));
        this.drain();
    }

    private handle(actions: readonly RunnerAction[]): void {
        for (const a of actions) {
            if (a.kind === 'say') {
                const text = this.tr.text(a.line);
                this.events.push({ t: this.t, kind: 'speech', key: a.line.key, text });
                this.ttsEnd = Math.max(this.t, this.ttsEnd) + 300 + 45 * text.length;
                this.speaking = true;
            } else if (a.kind === 'cue') this.planner.cue(a.event);
            else if (a.kind === 'place') {
                this.pos = a.pose.pos;
                this.yaw = a.pose.yawDeg;
                this.vel = [0, 0, 0];
                this.placed++;
            }
        }
    }

    private drain(): void {
        for (let g = 0; g < 50; g++) {
            const a = this.runner.takeActions();
            if (a.length === 0) return;
            this.handle(a);
        }
    }

    /** Whether the next sample is one the sampler keeps anyway (a due one): every second one at 60 Hz, from the first. */
    get nextDue(): boolean {
        return (this.tick + 1) % 2 === 1;
    }

    /** One 60 Hz frame: the speech queue, the runner, the planner, the sampler. */
    step(): void {
        this.t += STEP_MS;
        this.tick++;
        if (this.speaking && this.t >= this.ttsEnd) {
            this.speaking = false;
            this.events.push({ t: this.t, kind: 'speech', key: SPEECH_END_KEY, text: '' });
            this.events.push(...this.runner.spoken(this.t));
            this.drain();
        }
        const touched = this.touchNext;
        this.touchNext = false;
        if (touched) this.touchedAt.push(this.t);
        const sample: FlightSample = { t: this.t, tick: this.tick, pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0], yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched, paused: false };
        this.events.push(...this.runner.step(sample, this.world));
        this.drain();
        // lane sonic-beacon: the beacon beside the target, as the simulator's mode.ts gives it (the replay hums at it too)
        const plan = this.planner.plan(this.runner.demoFrame(this.t) ?? { sample, world: this.world, target: this.runner.target(), beacon: this.runner.beaconTarget(), floorY: 0 });
        const frame = this.sampler.take(this.rule ? sample : { ...sample, touched: false }, this.t, plan.cues.map((c) => c.id));
        if (frame) this.frames.push(frame);
    }

    until(cond: () => boolean, maxS: number): void {
        for (let i = 0; i < maxS * HZ && !cond(); i++) this.step();
    }

    /** Straight to `to` at SPEED, heading along the way; stops early when the runner placed the craft. */
    flyTo(to: Vec3): void {
        const placed = this.placed;
        for (let g = 0; g < 100000 && this.placed === placed; g++) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const len = Math.hypot(d[0], d[1], d[2]);
            const stepM = SPEED / HZ;
            if (len <= stepM) {
                this.vel = [0, 0, 0];
                this.pos = to;
                this.step();
                return;
            }
            this.vel = [(d[0] / len) * SPEED, (d[1] / len) * SPEED, (d[2] / len) * SPEED];
            this.pos = [this.pos[0] + this.vel[0] / HZ, this.pos[1] + this.vel[1] / HZ, this.pos[2] + this.vel[2] / HZ];
            if (Math.hypot(d[0], d[2]) > 0.05) this.yaw = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
            this.step();
        }
    }

    /**
     * Into the wall along `dir` at SPEED: the next sample moves a step on and has the contact; it is made one that the sampler
     * would not keep on its own (a frame is held first if needed).
     */
    touch(dir: Vec3): void {
        if (this.nextDue) this.step();
        this.vel = [dir[0] * SPEED, dir[1] * SPEED, dir[2] * SPEED];
        this.pos = [this.pos[0] + this.vel[0] / HZ, this.pos[1] + this.vel[1] / HZ, this.pos[2] + this.vel[2] / HZ];
        this.touchNext = true;
        this.step();
    }
}

/**
 * tunnel-narrow flown along its world's track at 2 m/s: halfway along each leg of TOUCH_AFTER the craft goes to the wall on the
 * left of the way and touches it; the runner puts it back 1 m before the last point passed, and it flies on from there, to the end.
 */
function fly(rule: boolean): TunnelHost {
    const h = new TunnelHost(rule);
    h.until(() => h.runner.phase === 'flying', 180);
    const track = (h.world as unknown as { readonly checkpoints: readonly WorldCheckpoint[] }).checkpoints;
    const left = new Set(TOUCH_AFTER);
    for (let i = 1; i < track.length && h.runner.phase === 'flying'; i++) {
        const a = track[i - 1]!.pos, b = track[i]!.pos;
        if (left.delete(i - 1)) {
            const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
            h.flyTo(mid);
            // the wall on the left of the way: the way's direction turned a quarter to the left, at the hull's reach of the wall
            const dir = track[i - 1]!.dir;
            const leftOf: Vec3 = [dir[2], 0, -dir[0]];
            const half = (h.world.resolved['widthM'] as number) / 2 - 0.13 - SPEED / HZ;
            h.flyTo([mid[0] + leftOf[0] * half, mid[1], mid[2] + leftOf[2] * half]);
            const placed = h.placed;
            h.touch(leftOf);
            expect(h.placed, 'the touch re-centred the craft').toBe(placed + 1);
            // back 1 m before the last point passed: on to it, then the leg again
            h.flyTo(a);
        }
        h.flyTo(b);
    }
    h.until(() => h.runner.phase !== 'flying', 10);
    for (let i = 0; i < 90; i++) h.step();
    return h;
}

function check(h: TunnelHost): ReturnType<typeof checkSession> {
    const manifest = buildManifest({
        id: 'touchSession00000001',
        created: '2026-11-08T10:00:00Z',
        app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
        scene: { kind: 'analytic', id: h.world.id, version: h.world.version, transform: [1, 0, 0, 0] },
        lesson: { id: h.lesson.id, version: h.lesson.version, path: 'full' },
        theme: { id: 'soft', version: getBuiltinTheme('soft').version },
        settings: defaultPrefs(),
        assists: h.lesson.assists,
        device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
        consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-08T10:00:00Z' },
        pilot: { id: 'testPilot01', nickname: null },
        clock: { startIso: '2026-11-08T10:00:00Z', frameHz: 30 }
    });
    return checkSession({ manifest, frames: h.frames, events: h.events });
}

describe('the recorder keeps every touched sample: a flight with touches in a tunnel replays (W11)', () => {
    it('tunnel-narrow, three touches of its walls at 60 Hz, each on a sample that is not due: the replay reads PASS, every touch and reset re-derived', () => {
        const h = fly(true);
        const touches = h.events.filter((e) => e.kind === 'touch');
        const resets = h.events.filter((e) => e.kind === 'reset');
        expect(touches).toHaveLength(TOUCH_AFTER.length);
        expect(touches.every((e) => e.kind === 'touch' && e.material === 'wall')).toBe(true);
        expect(resets.every((e) => e.kind === 'reset' && e.to === 'checkpoint' && /^w[0-9]+$/.test(e.checkpointId ?? ''))).toBe(true);
        expect(resets).toHaveLength(TOUCH_AFTER.length);
        expect(h.events.some((e) => e.kind === 'lesson' && e.what === 'passed')).toBe(true);
        // each touched sample is a frame of its own, between two due ones
        for (const t of h.touchedAt) expect(h.frames.some((f) => f.t === t)).toBe(true);
        const { check: c } = check(h);
        expect(c.events.diffs).toEqual([]);
        expect(c.events.byKind.touch!.matched).toBe(TOUCH_AFTER.length);
        expect(c.events.byKind.reset!.matched).toBe(TOUCH_AFTER.length);
        expect(c.ok).toBe(true);
        expect(replayVerdict(c)).toBe('pass');
    });

    it('control: the same flight with the rule off (the touched samples not kept, as at v0.12) reads FAIL on a touch\'s position', () => {
        const h = fly(false);
        expect(h.events.filter((e) => e.kind === 'touch')).toHaveLength(TOUCH_AFTER.length);
        // the touched samples are not in the recording: the next frame is at the respawn
        for (const t of h.touchedAt) expect(h.frames.some((f) => f.t === t)).toBe(false);
        const { check: c } = check(h);
        expect(c.ok).toBe(false);
        expect(replayVerdict(c)).toBe('fail');
        expect(c.events.diffs.some((d) => d.kind === 'touch' && /position differs/.test(d.detail))).toBe(true);
    });
});
