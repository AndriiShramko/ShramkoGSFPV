// Lane center-throttle, stage 1 (docs/wip/center-throttle.md): the centred throttle style flies a DJI FPV Remote
// Controller like a camera drone. A scripted DJI (its known setup: the throttle on Z over the full range, the
// start/stop button as a toggle arm, frames every 8 ms through the real Controls, its mapping and arm gate) flies the
// real Sim over a floor at 1 kHz with CentrePilot in Controls.assist.
//  - nothing to arm: the throttle rests in the centre and the start/stop button is never pressed, yet a pitch push
//    starts the motors (control: the from-zero style, Controls.assist null, never arms with the stick in the centre:
//    the gate blocks with 'throttle'; with the stick at the bottom and the button pressed it arms as always);
//  - let go: the drone stops (horizontal speed under 0.3 m/s within 3 s) and holds its height within 0.5 m (control: the
//    same pilot with plain angle control instead of the velocity loop still drifts past 0.3 m/s after 3 s);
//  - the left stick up climbs, down descends; horizon holds the height; acro sends the raw throttle (centre = half power);
//  - the start/stop button stops the motors, and a stick still held does not start them again until it is let go;
//  - the channels the pilot sent replay without it to the same flight (assists are input: the flight log is untouched).
// The 0.3 m/s and 0.5 m bounds and the 3 s are estimates of "stops and hovers", not measured on the owner's controller.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { S, Sim } from '../../../packages/sim-core/src';
import type { FlightMode } from '../../../packages/sim-core/src';
import type { Profile, RawFrame } from '../../../packages/input/src';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { FloorWorld, params } from './game-loop';

type AppControls = typeof import('../../../apps/fly/src/controls');
type CentreMod = typeof import('../../../apps/fly/src/play/centre-pilot');
type GroundMod = typeof import('../../../apps/fly/src/play/ground');
let C: AppControls, CP: CentreMod, G: GroundMod;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    C = await import('../../../apps/fly/src/controls');
    CP = await import('../../../apps/fly/src/play/centre-pilot');
    G = await import('../../../apps/fly/src/play/ground');
});
afterEach(() => { vi.restoreAllMocks(); });

/** The DJI FPV Remote Controller as its known setup flies it (known-devices.ts knownProfile): full-range axes, start/stop = button bit 2, a toggle. */
const DJI: Profile = {
    version: 1, deviceKey: 'hid:2ca3:1021:DJI Virtual Joystick', deviceName: 'DJI FPV Remote Controller', deadband: 0.025, created: '2026-11-12T00:00:00.000Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
    arm: { kind: 'button', bit: 2, toggle: true }, angleMode: null, known: 'dji-virtual-joystick'
} as Profile;

type Style = 'centred' | 'zero' | 'plain-angle';

class Rig {
    readonly sim = new Sim(params('pavo20pro-3s', { crashOn: false }), new FloorWorld());
    readonly controls: InstanceType<AppControls['Controls']>;
    pilot: InstanceType<CentreMod['CentrePilot']> | null = null;
    t = 0;
    /** the sticks as the hands hold them; thr 0 = the middle, where the DJI's spring puts it; the start/stop button */
    sticks = { roll: 0, pitch: 0, thr: 0, yaw: 0, button: false, sw: -1 };
    /** every channel set sent to the model, by the model's tick (the flight log's content) */
    readonly sent: { tick: number; ch: Float32Array }[] = [];
    private pending: Float32Array | null = null;

    constructor(style: Style, mode: FlightMode = 'angle') {
        this.sim.reset(0, 0.05, 0, 0, { soc: 1 });
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const rig = this;
        const session = { get sim() { return rig.sim; }, paused: false, input: (ch: ArrayLike<number>) => { rig.pending = Float32Array.from(ch); }, beforeStep: null };
        this.controls = new C.Controls(session as never);
        this.controls.setProfile(DJI);
        this.controls.source = 'hid';
        this.controls.setMode(mode);
        if (style !== 'zero') {
            const env = {
                sim: () => this.sim, paused: () => false,
                ground: (sim: Sim) => G.groundClearance(sim.contactWorld, sim.s, sim.p),
                mode: () => this.controls.flyingMode(), speed: () => 'normal' as const, toggleArm: () => true
            };
            const pilot = new CP.CentrePilot(env);
            // the control: the pilot's own sticks in angle with the height held, no velocity loop ("a drone coasts")
            if (style === 'plain-angle') pilot.pilot.setAssists({ ...CP.centreAssists('angle', 'normal'), control: 'angle' });
            this.pilot = pilot;
            this.controls.assist = (ch, out, tt) => pilot.apply(ch, out, tt);
        }
        vi.spyOn(performance, 'now').mockImplementation(() => this.t);
    }

    frame(): RawFrame {
        const s = this.sticks;
        return { t: this.t, axes: new Float32Array([s.roll, s.pitch, s.thr, s.yaw, s.sw, 0, 0, 0]), buttons: s.button ? 1 << 2 : 0 };
    }

    /** Press and release the start/stop button (two reports apart). */
    press(): void {
        this.sticks.button = true;
        this.run(40);
        this.sticks.button = false;
        this.run(40);
    }

    run(ms: number, each?: () => void): void {
        for (let i = 0; i < ms; i++) {
            if (this.t % 8 === 0) this.controls.raw(this.frame());
            if (this.t % 16 === 0) this.controls.tick(this.t);
            if (this.pending) {
                this.sim.setChannels(this.pending);
                this.sent.push({ tick: this.sim.tick, ch: this.pending });
                this.pending = null;
            }
            this.sim.step();
            this.t++;
            each?.();
        }
    }

    get speed(): number { return Math.hypot(this.sim.s[S.vx], this.sim.s[S.vz]); }
    get y(): number { return this.sim.s[S.py]; }
}

/** Arm by a pitch push of 0.6 for `ms`, then let go; returns the ms from the push to armed (-1: never). */
function pushToFly(r: Rig, ms = 1500): number {
    const t0 = r.t;
    let armedAt = -1;
    r.sticks.pitch = 0.6;
    r.run(ms, () => { if (armedAt < 0 && r.sim.armed) armedAt = r.t; });
    r.sticks.pitch = 0;
    return armedAt < 0 ? -1 : armedAt - t0;
}

describe('centred: nothing to arm, the first stick move starts the motors', () => {
    it('the throttle resting in the centre and no button: still on the ground; a pitch push: armed within 0.5 s', () => {
        const r = new Rig('centred');
        r.run(2000);
        expect(r.sim.armed).toBe(false);
        expect(r.y).toBeLessThan(0.2);
        const ms = pushToFly(r);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThan(500);
        expect(r.sim.armed).toBe(true);
    });

    it('control: from zero (no assist, today\'s path) the same stream never arms; the gate says why: the throttle', () => {
        const r = new Rig('zero');
        r.run(1000);
        r.press();
        pushToFly(r);
        r.run(1000);
        expect(r.sim.armed).toBe(false);
        expect(r.controls.block).toBe('throttle');
        // and the FPV way still arms it: the stick at the bottom, sticks let go, the start/stop button
        r.sticks.thr = -1;
        r.run(500);
        r.press();
        r.run(300);
        expect(r.sim.armed).toBe(true);
    });
});

describe('centred, angle (DJI N): let go and it stops and hovers', () => {
    const letGo = (style: Style): { speed: number; dy: number } => {
        const r = new Rig(style);
        r.run(500);
        pushToFly(r, 3000);
        expect(r.sim.armed).toBe(true);
        r.run(3000);
        const speed = r.speed;
        const y0 = r.y;
        let dy = 0;
        r.run(2000, () => { dy = Math.max(dy, Math.abs(r.y - y0)); });
        return { speed: Math.max(speed, r.speed), dy };
    };
    it('3 s after the sticks are let go the drone is still (< 0.3 m/s) and holds its height within 0.5 m for 2 s', () => {
        const m = letGo('centred');
        expect(m.speed).toBeLessThan(0.3);
        expect(m.dy).toBeLessThan(0.5);
    });
    it('control: the pilot\'s own angle sticks without the velocity loop still drift past 0.3 m/s after 3 s', () => {
        expect(letGo('plain-angle').speed).toBeGreaterThan(0.3);
    });
    it('from the ground, the left stick alone pushed up takes off and climbs past 1 m in 2.5 s (the page probe\'s first move)', () => {
        const r = new Rig('centred');
        r.run(300);
        const y0 = r.y;
        r.sticks.thr = 0.6;
        r.run(2500);
        expect(r.sim.armed).toBe(true);
        expect(r.y - y0).toBeGreaterThan(1);
    });

    it('the left stick up climbs, down descends, the centre holds', () => {
        const r = new Rig('centred');
        r.run(300);
        pushToFly(r, 600);
        r.run(1500);
        r.sticks.thr = 0.8;
        let up = 0;
        r.run(1500, () => { up = Math.max(up, r.sim.s[S.vy]); });
        expect(up).toBeGreaterThan(1);
        r.sticks.thr = 0;
        r.run(1500);
        const y0 = r.y;
        r.sticks.thr = -0.8;
        let down = 0;
        r.run(800, () => { down = Math.min(down, r.sim.s[S.vy]); });
        expect(down).toBeLessThan(-1);
        expect(r.y).toBeLessThan(y0);
    });
});

describe('the controller\'s mode switch keeps working', () => {
    it('horizon (DJI S): the pilot\'s own sticks, the height held within 0.5 m with the stick in the centre', () => {
        const r = new Rig('centred', 'horizon');
        r.run(300);
        r.sticks.yaw = 0.5; // a yaw nudge starts the motors without tipping
        r.run(400);
        r.sticks.yaw = 0;
        r.run(2500);
        expect(r.sim.armed).toBe(true);
        r.sticks.thr = 0.6;
        r.run(800);
        r.sticks.thr = 0;
        r.run(1500);
        const y0 = r.y;
        let dy = 0;
        r.run(2000, () => { dy = Math.max(dy, Math.abs(r.y - y0)); });
        expect(dy).toBeLessThan(0.5);
    });
    it('acro (DJI M): a stick nudge with the throttle in the centre starts nothing (no half power on the ground)', () => {
        const r = new Rig('centred', 'acro');
        r.run(300);
        r.sticks.yaw = 0.5;
        r.run(900);
        r.sticks.yaw = 0;
        r.run(300);
        expect(r.sim.armed).toBe(false);
        expect(Math.max(...r.sent.map((x) => x.ch[2]))).toBeLessThanOrEqual(-0.99);
    });
    it('acro (DJI M): a stop pressed with the throttle at the bottom does not start the motors again', () => {
        const r = new Rig('centred', 'acro');
        r.run(300);
        r.sticks.thr = -1;
        r.run(600);
        expect(r.sim.armed).toBe(true);
        r.press();
        r.run(600);
        expect(r.sim.armed).toBe(false);
    });
    it('acro (DJI M): the throttle lowered to the bottom starts the motors at idle, then the throttle is raw', () => {
        const r = new Rig('centred', 'acro');
        r.run(300);
        r.sticks.thr = -1;
        r.run(600);
        expect(r.sim.armed).toBe(true);
        expect(r.sent[r.sent.length - 1].ch[2]).toBeLessThanOrEqual(-0.99);
        r.sticks.thr = 0.2;
        r.run(40);
        const last = r.sent[r.sent.length - 1].ch;
        expect(last[2]).toBeCloseTo(r.controls.mapped[2], 5);
        expect(last[2]).toBeCloseTo(0.2, 2);
    });
});

describe('stopping the motors', () => {
    it('the start/stop button stops them; a stick still held does not start them again until it is let go', () => {
        const r = new Rig('centred');
        r.run(300);
        pushToFly(r, 800);
        r.run(1500);
        expect(r.sim.armed).toBe(true);
        r.sticks.pitch = 0.5;
        r.press();
        r.run(500);
        expect(r.sim.armed).toBe(false);
        r.run(1000);
        expect(r.sim.armed).toBe(false); // still held: nothing new
        r.sticks.pitch = 0;
        r.run(300);
        expect(pushToFly(r, 800)).toBeGreaterThanOrEqual(0); // let go, then a new move: it flies again
    });
});

describe('assists are input: the channels sent replay without the pilot to the same flight', () => {
    it('a fresh model fed the recorded channels at their ticks ends in the same state', () => {
        const r = new Rig('centred');
        r.run(300);
        pushToFly(r, 1200);
        r.sticks.thr = 0.5;
        r.run(1000);
        r.sticks.thr = 0;
        r.run(1500);
        const replay = new Sim(params('pavo20pro-3s', { crashOn: false }), new FloorWorld());
        replay.reset(0, 0.05, 0, 0, { soc: 1 });
        let k = 0;
        while (replay.tick < r.sim.tick) {
            while (k < r.sent.length && r.sent[k].tick === replay.tick) replay.setChannels(r.sent[k++].ch);
            replay.step();
        }
        expect(Array.from(replay.s)).toEqual(Array.from(r.sim.s));
    });
});

describe('a lesson replaces the centred pilot; setLesson(null) puts it back (InputHost, app/input.ts)', () => {
    it('the centred style flies by the centred pilot, a lesson takes Controls.assist, its end gives it back from the ground', async () => {
        // KeyboardSource (made by InputHost) listens on the window and the document, and samples on a timer
        vi.stubGlobal('addEventListener', () => undefined);
        vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined });
        vi.stubGlobal('document', { ...doc, addEventListener: () => undefined, querySelector: () => null });
        try {
            const { InputHost } = await import('../../../apps/fly/src/app/input');
            const r = new Rig('zero');
            const session = { get sim() { return r.sim; }, paused: false, collision: null };
            const host = new InputHost({ controls: r.controls, prefs: { get: () => undefined }, session } as never);
            const hid = { onFrame: null as ((f: RawFrame) => void) | null, close: () => undefined };
            host.use({ kind: 'hid', profile: r.controls.profile, hid: hid as never }, false);
            // control: in the from-zero style a lesson's end leaves no assist (today's path)
            host.setLesson(CP.centreAssists('angle', 'normal'));
            host.setLesson(null);
            expect(r.controls.assist).toBeNull();
            expect(host.centrePilot).toBeNull();
            host.setThrottleStyle('centred');
            const centre = host.centrePilot;
            expect(centre).not.toBeNull();
            expect(r.controls.assist).not.toBeNull();
            const centreFn = r.controls.assist;
            // a lesson: its pilot flies, the centred one is out
            host.setLesson(CP.centreAssists('angle', 'normal'));
            expect(host.lessonPilot).not.toBeNull();
            expect(host.centrePilot).toBeNull();
            expect(r.controls.assist).not.toBe(centreFn);
            expect(r.controls.forcedMode).toBe('angle');
            // a style change during the lesson does not take the lesson's place
            host.setThrottleStyle('zero');
            host.setThrottleStyle('centred');
            expect(host.centrePilot).toBeNull();
            expect(host.lessonPilot).not.toBeNull();
            // the lesson ends: the centred pilot again, no forced mode, and it flies (a stick move starts the motors)
            host.setLesson(null);
            expect(host.lessonPilot).toBeNull();
            expect(host.centrePilot).toBe(centre);
            expect(r.controls.assist).toBe(centreFn);
            expect(r.controls.forcedMode).toBeNull();
            r.run(500);
            expect(r.sim.armed).toBe(false);
            const ms = pushToFly(r);
            expect(ms).toBeGreaterThanOrEqual(0);
            expect(ms).toBeLessThan(500);
        } finally {
            vi.stubGlobal('document', doc);
            vi.stubGlobal('window', undefined);
        }
    });
});

/** An FPV radio's wizard setup: the arm switch is a level switch on CH5 (axis 4), the throttle springs nowhere. */
const FPV: Profile = { ...DJI, deviceKey: 'hid:1209:4f54:Radio', deviceName: 'Radio', known: undefined, deadband: 0, arm: { kind: 'axis', index: 4, threshold: 0.5, onAbove: true, off: -1, on: 1 } } as Profile;
/** The DJI flown with Space / the on-screen ARM (a gamepad's usual setup, a controller without an arm entry). */
const KEYED: Profile = { ...DJI, arm: { kind: 'key' } } as Profile;

/** The real InputHost (app/input.ts) over a Rig in the from-zero path, with `profile` as the HID controller in use. */
async function withHost(profile: Profile, fn: (r: Rig, host: InstanceType<typeof import('../../../apps/fly/src/app/input')['InputHost']>) => void): Promise<void> {
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined });
    vi.stubGlobal('document', { ...doc, addEventListener: () => undefined, querySelector: () => null });
    try {
        const { InputHost } = await import('../../../apps/fly/src/app/input');
        const r = new Rig('zero');
        r.controls.setProfile(profile);
        const session = { get sim() { return r.sim; }, paused: false, collision: null };
        const host = new InputHost({ controls: r.controls, prefs: { get: () => undefined }, session } as never);
        const hid = { onFrame: null as ((f: RawFrame) => void) | null, close: () => undefined };
        host.use({ kind: 'hid', profile, hid: hid as never }, false);
        fn(r, host);
    } finally {
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', undefined);
    }
}

describe('a change of style never arms by itself (review B1): the arm switch must be flipped again', () => {
    it('control: from zero from the start, the switch left on with the throttle at the bottom never arms; the gate says: the switch', async () => {
        await withHost(FPV, (r) => {
            r.sticks.thr = -1;
            r.sticks.sw = 1;
            r.run(1000);
            expect(r.sim.armed).toBe(false);
            expect(r.controls.block).toBe('switch');
        });
    });
    it('the same hands after centred -> from zero (J, the chip, the Controls row, the automatic choice): not armed; off -> on arms as always', async () => {
        await withHost(FPV, (r, host) => {
            r.sticks.thr = -1;
            r.sticks.sw = 1;
            r.run(300);
            host.setThrottleStyle('centred');
            r.run(300);
            host.setThrottleStyle('zero');
            r.run(1000);
            expect(r.sim.armed).toBe(false);
            expect(r.controls.block).toBe('switch');
            r.sticks.sw = -1;
            r.run(100);
            r.sticks.sw = 1;
            r.run(300);
            expect(r.sim.armed).toBe(true);
        });
    });
    it('a lesson that ends with the motors off leaves the switch to be flipped again too', async () => {
        await withHost(FPV, (r, host) => {
            r.sticks.thr = -1;
            r.sticks.sw = 1;
            r.run(300);
            host.setLesson(CP.centreAssists('angle', 'normal'));
            r.run(300);
            host.setLesson(null);
            r.run(1000);
            expect(r.sim.armed).toBe(false);
        });
    });
});

describe('centred with Space / the on-screen ARM as the arm input (review M3): one press stops the motors', () => {
    it('a pitch push starts them, one Space press stops them within 0.5 s', async () => {
        await withHost(KEYED, (r, host) => {
            host.setThrottleStyle('centred');
            r.run(300);
            expect(pushToFly(r, 800)).toBeGreaterThanOrEqual(0);
            r.run(1000);
            expect(r.sim.armed).toBe(true);
            r.controls.toggleArm();
            r.run(500);
            expect(r.sim.armed).toBe(false);
        });
    });
});

describe('the arm card offer hears the real Controls (review M1, M2)', () => {
    type OfferMod = typeof import('../../../apps/fly/src/ui/arm-offer-logic');
    /** Feeds an ArmOffer from the real Controls' view every ms, as the HUD does every frame; returns how many times it was taken. */
    function watch(r: Rig, O: OfferMod, ms: number, offer: InstanceType<OfferMod['ArmOffer']>): number {
        let n = 0;
        r.run(ms, () => {
            const v = r.controls.view();
            // arm: ch[4] as the HUD handed it before the review (no longer read; kept so the old rule can be run against this test)
            const input = { style: 'zero' as const, block: r.controls.block, throttle: v.ch[2], arm: v.ch[4], presses: v.presses, toggle: v.armKind === 'toggle', visible: true, profileGen: v.profileGen, now: r.t };
            const of = offer.update(input);
            if (of.accept) n++;
        });
        return n;
    }
    it('the DJI start/stop pressed while the offer shows takes it (the gate refuses the press, ch[4] stays -1)', async () => {
        const O = await import('../../../apps/fly/src/ui/arm-offer-logic');
        const r = new Rig('zero');
        r.sticks.thr = 11 / 660; // the DJI's measured rest offset (known-devices.ts)
        const offer = new O.ArmOffer();
        expect(watch(r, O, 3600, offer)).toBe(0);
        r.sticks.button = true;
        let n = watch(r, O, 200, offer);
        r.sticks.button = false;
        n += watch(r, O, 200, offer);
        expect(n).toBe(1);
        expect(r.sim.armed).toBe(false);
    });
    it('control: an FPV radio level switch flipped with the throttle left in the middle never takes it', async () => {
        const O = await import('../../../apps/fly/src/ui/arm-offer-logic');
        const r = new Rig('zero');
        r.controls.setProfile(FPV);
        r.sticks.thr = 0.1; // a throttle with no spring left at 55 % (inside TUNING.CENTRE_TOL)
        const offer = new O.ArmOffer();
        let n = watch(r, O, 3600, offer);
        r.sticks.sw = 1;
        n += watch(r, O, 500, offer);
        expect(n).toBe(0);
    });
});

describe('the builtin that decides the style (app/builtin/throttle-style.ts, review M4 and m5)', () => {
    /** A fake flight context with what the builtin reads: prefs, keys, events, the HUD, the input host and Controls. */
    function fakeCtx(profile: Profile) {
        const store = new Map<string, unknown>([['input.throttleStyle', 'auto']]);
        const prefLs: ((c: { id: string }) => void)[] = [];
        const frameLs: (() => void)[] = [];
        const keyLs = new Map<string, (e: { repeat: boolean }) => void>();
        const input = { now: 'zero' as string, setThrottleStyle(st: string) { this.now = st; }, settleStyle() { /* the motors are off */ }, get throttleStyle() { return { now: this.now, pending: null }; }, centrePilot: null };
        const controls = { source: 'hid', profile, gate: { armed: false }, lastSampleAt: 1, mapped: new Float32Array(8), flyingMode: () => 'angle' };
        const ctx = {
            prefs: { get: (id: string) => store.get(id), set: (id: string, v: unknown) => { store.set(id, v); for (const l of prefLs) l({ id }); }, onChange: (l: (c: { id: string }) => void) => { prefLs.push(l); return () => undefined; } },
            keys: { on: (id: string, fn: (e: { repeat: boolean }) => void) => { keyLs.set(id, fn); return () => undefined; } },
            events: { on: (name: string, fn: () => void) => { if (name === 'frame') frameLs.push(fn); return () => undefined; } },
            hud: { flash: () => undefined, throttle: null }, hook: {}, input, controls
        };
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        /** `ms` of frames every 16 ms with the throttle at f(t) */
        const frames = (ms: number, f: (t: number) => number): void => {
            for (const end = now + ms; now <= end; now += 16) { controls.mapped[2] = f(now); for (const l of frameLs) l(); }
        };
        return { ctx, input, controls, store, frames, key: (id: string) => keyLs.get(id)?.({ repeat: false }) };
    }
    it('an FPV radio armed before any still half second: a throttle left in the middle after the disarm keeps it from zero', async () => {
        vi.stubGlobal('document', { ...doc, querySelector: () => null });
        try {
            const { throttleStyle } = await import('../../../apps/fly/src/app/builtin/throttle-style');
            const f = fakeCtx({ ...FPV });
            const off = throttleStyle.install(f.ctx as never);
            f.frames(1000, (t) => -1 + 0.5 * (1 + Math.sin(t / 40))); // moved up and down, never still
            f.controls.gate.armed = true; // armed straight away (throttle lowered and the switch flipped)
            f.frames(1000, () => 0.3);
            f.controls.gate.armed = false; // a disarm or a crash: the stick with no spring stays near the middle
            f.frames(2000, () => 0.05);
            expect(f.input.now).toBe('zero');
            // control: the same radio with no arming at all, resting in the middle, is decided by that rest
            const g = fakeCtx({ ...FPV, deviceKey: 'hid:1209:4f54:Radio2' });
            const off2 = throttleStyle.install(g.ctx as never);
            g.frames(2000, () => 0.05);
            expect(g.input.now).toBe('centred');
            off?.();
            off2?.();
        } finally {
            vi.stubGlobal('document', doc);
        }
    });
    it('the pilot choice is saved for that controller and not applied to another one', async () => {
        vi.stubGlobal('document', { ...doc, querySelector: () => null });
        try {
            const { throttleStyle } = await import('../../../apps/fly/src/app/builtin/throttle-style');
            const a = { ...FPV, throttleRest: 'bottom' } as Profile;
            const f = fakeCtx(a);
            const off = throttleStyle.install(f.ctx as never);
            f.frames(700, () => -1);
            expect(f.input.now).toBe('zero');
            f.key('throttle.style'); // J
            f.frames(100, () => -1);
            expect(a.throttleStyle).toBe('centred');
            expect(f.input.now).toBe('centred');
            const b = { ...FPV, deviceKey: 'hid:0483:5710:Other', throttleRest: 'bottom' } as Profile;
            f.controls.profile = b;
            f.frames(700, () => -1);
            expect(b.throttleStyle).toBeUndefined();
            expect(f.store.get('input.throttleStyle')).toBe('auto');
            expect(f.input.now).toBe('zero');
            off?.();
        } finally {
            vi.stubGlobal('document', doc);
        }
    });
});
