// v0.12 Fly by Sound, lane v12-flight step 4 (docs/wip/v12-plan.md 2.3 and 4.2): the lesson pilot in every pilot's
// input path. A scripted RC radio (a TX16S profile, frames at 250 Hz through the real Controls, its mapping, the
// lesson pilot in Controls.assist and the real arm gate) flies the real Sim in the walls-hall lesson world at 1 kHz.
//  - its arm switch never moves, yet a stick starts the motors (control: with the hook null the gate refuses the
//    same switchless radio, block 'switch', and the model never arms);
//  - full sticks stay within the lesson's caps + 10 % (speed 3 m/s, climb 1 m/s, yaw 90 deg/s) and reach them
//    (control: the same pilot with the speed cap left open flies past it), and the height holds within 0.3 m;
//  - a hidden tab disarms (the gate), and the pilot arms again with no new input once the tab is back;
//  - the keyboard and the touch sticks reach it as intents and are capped alike;
//  - with no lesson, nothing changes: the mode the radio's switch picks flies, the channels are the source's.
// Controls reads document and performance.now: the document is stubbed, the clock is the rig's.
// v0.13 (lane v13-host A2, docs/wip/v13-host.md "Changed tests"): walls-hall is a 10 x 12 m room, so the caps (5 s of full stick,
// 15 m at 3 m/s) are flown in an open world with walls-hall's start and assists; the rest still flies walls-hall.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_CHANNEL, S, Sim } from '../../../packages/sim-core/src';
import type { RawFrame, Profile } from '../../../packages/input/src';
import { getLesson, makeSpec } from '../../../packages/sonic-fpv/src';
import type { LessonAssists } from '../../../packages/sonic-fpv/src';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { buildLessonWorld, lessonSceneId, lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';
import { params } from './game-loop';

type AppControls = typeof import('../../../apps/fly/src/controls');
type Pilot = typeof import('../../../apps/fly/src/play/lesson-pilot');
type GamePilotMod = typeof import('../../../apps/fly/src/play/game-pilot');
type EasyMod = typeof import('../../../apps/fly/src/play/easy');

let C: AppControls, LP: Pilot, GP: GamePilotMod, EP: EasyMod;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    C = await import('../../../apps/fly/src/controls');
    LP = await import('../../../apps/fly/src/play/lesson-pilot');
    GP = await import('../../../apps/fly/src/play/game-pilot');
    EP = await import('../../../apps/fly/src/play/easy');
});

/** A TX16S as the setup wizard saves it (app-modes.test.ts): axes 0..3 sticks, the arm switch on axis 4. */
const TX16S: Profile = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.999, max: 0.999 }, pitch: { index: 1, invert: false, center: -0.002, min: -0.999, max: 0.999 }, throttle: { index: 2, invert: false, center: -0.999, min: -0.999, max: 0.999 }, yaw: { index: 3, invert: false, center: 0.001, min: -0.999, max: 0.999 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -0.999, on: 0.999 }, angleMode: null
} as unknown as Profile;

const LESSON = getLesson('walls-hall');
const CAPS = { speed: LESSON.assists.maxSpeedMps!, climb: LESSON.assists.maxClimbMps!, yaw: LESSON.assists.maxYawDps! };
let world: LessonWorld;
/** A floor and no walls, with walls-hall's start (as the page flies a lesson without walls): where the caps are flown. */
let openWorld: LessonWorld;

/** The page around the model: the Sim at 1 kHz, the radio's frames every 4 ms through Controls, a frame tick every 16 ms. */
class Rig {
    readonly sim: Sim;
    readonly controls: InstanceType<AppControls['Controls']>;
    pilot: InstanceType<Pilot['LessonPilot']> | null = null;
    t = 0;
    /** the radio's sticks as the pilot holds them: roll, pitch, yaw -1..1; throttle -1 (bottom) .. 1 (top); its arm switch */
    sticks = { roll: 0, pitch: 0, thr: -1, yaw: 0, armSwitch: false };
    private pending: Float32Array | null = null;
    /** what the rig measured since the last clear() */
    rec = { maxSpeed: 0, maxClimb: 0, maxYawDps: 0, minY: Infinity, maxY: -Infinity, armedAt: -1 };

    constructor(assists: LessonAssists | null, readonly w: LessonWorld = world) {
        this.sim = new Sim(params('pavo20pro-3s', { crashOn: false }), w.builtin.contact!);
        this.sim.reset(0, 1.5, 0, 0, { platform: true });
        const session = { get sim() { return rig.sim; }, paused: false, input: (ch: ArrayLike<number>) => { this.pending = Float32Array.from(ch); }, beforeStep: null };
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const rig = this;
        this.controls = new C.Controls(session as never);
        this.controls.setProfile(TX16S);
        this.controls.source = 'hid';
        if (assists) this.lesson(assists);
    }

    lesson(assists: LessonAssists): void {
        const pilot = new LP.LessonPilot({ sim: () => this.sim, paused: () => false, ground: (sim) => LP.rayClearance(this.w.collision, sim) }, assists);
        this.pilot = pilot;
        this.controls.assist = (ch, out, t) => pilot.apply(ch, out, t);
        this.controls.forcedMode = LP.lessonMode(assists);
    }

    frame(): RawFrame {
        const s = this.sticks;
        const ax = (v: number): number => v * 0.999;
        // the throttle axis: -0.999 bottom .. 0.999 top
        return { t: this.t, axes: new Float32Array([ax(s.roll), ax(s.pitch), ax(s.thr), ax(s.yaw), s.armSwitch ? 0.999 : -0.999, 0, 0, 0]), buttons: 0 };
    }

    clear(): void {
        this.rec = { maxSpeed: 0, maxClimb: 0, maxYawDps: 0, minY: Infinity, maxY: -Infinity, armedAt: this.rec.armedAt };
    }

    run(ms: number): void {
        for (let i = 0; i < ms; i++) {
            if (this.t % 4 === 0) this.controls.raw(this.frame());
            if (this.t % 16 === 0) this.controls.tick(this.t);
            if (this.pending) {
                this.sim.setChannels(this.pending);
                this.pending = null;
            }
            this.sim.step();
            this.t++;
            const s = this.sim.s;
            if (this.sim.armed && this.rec.armedAt < 0) this.rec.armedAt = this.t;
            this.rec.maxSpeed = Math.max(this.rec.maxSpeed, Math.hypot(s[S.vx], s[S.vz]));
            this.rec.maxClimb = Math.max(this.rec.maxClimb, s[S.vy]);
            // the yaw rate about the world's up axis: the world's y row of the body rate (R w)
            const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
            const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
            const yawRate = Math.abs(r10 * s[S.wx] + r11 * s[S.wy] + r12 * s[S.wz]) * (180 / Math.PI);
            this.rec.maxYawDps = Math.max(this.rec.maxYawDps, yawRate);
            this.rec.minY = Math.min(this.rec.minY, s[S.py]);
            this.rec.maxY = Math.max(this.rec.maxY, s[S.py]);
        }
    }
}

beforeEach(() => {
    world = world ?? lessonWorldOf(LESSON)!;
    openWorld = openWorld ?? buildLessonWorld(makeSpec('open', { startHeightM: LESSON.start.pos[1] }), lessonSceneId(LESSON.id), LESSON.start);
    doc.visibilityState = 'visible';
});
afterEach(() => { vi.restoreAllMocks(); });

/** A rig whose page clock is its own (Controls stamps arrivals with performance.now); `w`: the world flown (walls-hall's own). */
function rig(assists: LessonAssists | null, w?: LessonWorld): Rig {
    const r = new Rig(assists, w);
    vi.spyOn(performance, 'now').mockImplementation(() => r.t);
    return r;
}

describe('the motors start with no switch; with the hook null the gate still refuses a switchless radio', () => {
    it('lesson: the arm switch never moves; the throttle stick in the middle, then the pitch stick: armed within 0.5 s', () => {
        const r = rig(LESSON.assists);
        r.sticks.thr = 0; // the middle: hold
        r.run(1000);
        expect(r.sim.armed).toBe(false); // centred sticks ask for nothing yet
        r.sticks.pitch = 1;
        r.run(1500);
        expect(r.sim.armed).toBe(true);
        expect(r.rec.armedAt - 1000).toBeLessThan(500);
        expect(r.sticks.armSwitch).toBe(false);
    });

    it('control: the same radio with no lesson (hook null) never arms; the gate says why (switch, or throttle when it is up)', () => {
        const r = rig(null);
        r.run(1000);
        expect(r.controls.block).toBe('switch');
        r.sticks.pitch = 1;
        r.run(1500);
        r.sticks.pitch = 0;
        r.sticks.thr = 0;
        r.run(500);
        expect(r.controls.block).toBe('throttle');
        expect(r.rec.armedAt).toBe(-1);
        expect(r.sim.armed).toBe(false);
    });
});

describe('full sticks stay within the lesson\'s caps + 10 % and reach them; the height holds', () => {
    it(`walls-hall caps: forward ${CAPS.speed} m/s with the height held within 0.3 m, climb ${CAPS.climb} m/s, yaw ${CAPS.yaw} deg/s (in the open)`, () => {
        const r = rig(LESSON.assists, openWorld);
        r.sticks.thr = 0;
        r.sticks.pitch = 1;
        r.run(1500); // armed and away
        const y0 = r.sim.s[S.py];
        r.clear();
        r.run(5000);
        expect(r.rec.maxSpeed).toBeLessThan(CAPS.speed * 1.1);
        expect(r.rec.maxSpeed).toBeGreaterThan(CAPS.speed * 0.9);
        expect(r.rec.maxY - y0).toBeLessThan(0.3);
        expect(y0 - r.rec.minY).toBeLessThan(0.3);
        const forward = { max: r.rec.maxSpeed, dy: Math.max(r.rec.maxY - y0, y0 - r.rec.minY) };
        // let go: it brakes and holds
        r.sticks.pitch = 0;
        r.run(3000);
        expect(Math.hypot(r.sim.s[S.vx], r.sim.s[S.vz])).toBeLessThan(0.3);
        // the throttle stick full up: the climb cap
        r.clear();
        r.sticks.thr = 1;
        r.run(3000);
        expect(r.rec.maxClimb).toBeLessThan(CAPS.climb * 1.1);
        expect(r.rec.maxClimb).toBeGreaterThan(CAPS.climb * 0.9);
        const climb = r.rec.maxClimb;
        // back to the middle: it holds the new height
        r.sticks.thr = 0;
        r.run(1500);
        const y1 = r.sim.s[S.py];
        r.clear();
        // the yaw stick full: the turn cap, the height still held
        r.sticks.yaw = 1;
        r.run(3000);
        expect(r.rec.maxYawDps).toBeLessThan(CAPS.yaw * 1.1);
        expect(r.rec.maxYawDps).toBeGreaterThan(CAPS.yaw * 0.9);
        expect(Math.max(r.rec.maxY - y1, y1 - r.rec.minY)).toBeLessThan(0.3);
        console.log(`sonic-pilot walls-hall: forward max ${forward.max.toFixed(3)} m/s (height within ${forward.dy.toFixed(3)} m), climb max ${climb.toFixed(3)} m/s, yaw max ${r.rec.maxYawDps.toFixed(1)} deg/s (height within ${Math.max(r.rec.maxY - y1, y1 - r.rec.minY).toFixed(3)} m); caps ${CAPS.speed} m/s, ${CAPS.climb} m/s, ${CAPS.yaw} deg/s`);
    });

    it('control: the same pilot with the speed cap left open flies past it (the cap is what holds the speed)', () => {
        const r = rig({ ...LESSON.assists, maxSpeedMps: null }, openWorld);
        r.sticks.thr = 0;
        r.sticks.pitch = 1;
        r.run(4000);
        expect(r.rec.maxSpeed).toBeGreaterThan(CAPS.speed * 1.5);
    });
});

describe('a hidden tab disarms; the pilot arms again by itself', () => {
    it('hidden for 300 ms in flight: disarmed by the gate; visible again, armed within 1.5 s with no new stick movement', () => {
        const r = rig(LESSON.assists);
        r.sticks.thr = 0;
        r.sticks.pitch = 0.5;
        r.run(2000);
        expect(r.sim.armed).toBe(true);
        doc.visibilityState = 'hidden';
        r.run(300);
        expect(r.sim.armed).toBe(false);
        doc.visibilityState = 'visible';
        const back = r.t;
        let again = -1;
        for (let i = 0; i < 1500 && again < 0; i += 10) {
            r.run(10);
            if (r.sim.armed) again = r.t - back;
        }
        expect(again).toBeGreaterThanOrEqual(0);
        expect(again).toBeLessThan(1500);
        expect(r.sticks.pitch).toBe(0.5); // the stick was held all along: no new edge
    });
});

describe('the keyboard and the touch sticks reach the lesson pilot as intents', () => {
    it('W through GamePilot (intents on): armed, capped; the touch pad through EasyPilot alike', () => {
        for (const kind of ['keyboard', 'touch'] as const) {
            const r = rig(LESSON.assists);
            r.controls.setProfile(null);
            r.controls.source = kind;
            r.controls.play = 'easy';
            const session = { sim: r.sim, paused: false } as never;
            const game = new GP.GamePilot(r.controls, { session: () => session, speed: () => 'normal' });
            const easy = new EP.EasyPilot(r.controls, { session: () => session, altitudeHelp: () => true });
            game.intents = true;
            easy.intents = true;
            for (let i = 0; i < 5000; i++) {
                // the source's own cadence: 10 ms; the rig's radio is silent (no profile)
                if (r.t % 10 === 0) {
                    if (kind === 'keyboard') game.send({ forward: 1, strafe: 0, turn: 0, lift: 0 }, r.t);
                    else easy.send({ roll: 0, pitch: 1, yaw: 0, lift: 0, throttle: 0, boost: false }, r.t);
                }
                r.run(1);
            }
            expect(r.sim.armed).toBe(true);
            expect(r.rec.maxSpeed).toBeLessThan(CAPS.speed * 1.1);
            expect(r.rec.maxSpeed).toBeGreaterThan(CAPS.speed * 0.9);
        }
    });
});

describe('with no lesson nothing changes', () => {
    it('the radio\'s own mode and channels go out as before; with a lesson the mode is the lesson\'s (angle), the radio\'s mode switch aside', () => {
        const withSwitch = { ...TX16S, deviceKey: 'hid:mode', modeSwitch: { input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] } } as unknown as Profile;
        const sent: number[][] = [];
        const session = { sim: null, paused: false, input: (ch: ArrayLike<number>) => sent.push(Array.from(ch)), beforeStep: null };
        const c = new C.Controls(session as never);
        c.setProfile(withSwitch);
        c.source = 'hid';
        const f: RawFrame = { t: 0, axes: new Float32Array([0.5, -0.25, -0.999, 0.1, -0.999, -0.9, 0, 0]), buttons: 0 };
        c.raw(f);
        expect(c.radioDecides()).toBe(true);
        expect(c.flyingMode()).toBe('acro');
        expect(sent[0][5]).toBe(MODE_CHANNEL.acro);
        expect(sent[0].slice(0, 4).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.498, -0.249, -1, 0.099]);
        // a lesson's forced mode wins over the switch
        c.forcedMode = 'angle';
        c.raw(f);
        expect(c.flyingMode()).toBe('angle');
        expect(sent[1][5]).toBe(MODE_CHANNEL.angle);
        // taken out again: the switch decides
        c.forcedMode = null;
        c.raw(f);
        expect(sent[2][5]).toBe(MODE_CHANNEL.acro);
    });
});
