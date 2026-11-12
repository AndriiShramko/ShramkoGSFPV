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
    sticks = { roll: 0, pitch: 0, thr: 0, yaw: 0, button: false };
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
        return { t: this.t, axes: new Float32Array([s.roll, s.pitch, s.thr, s.yaw, 0, 0, 0, 0]), buttons: s.button ? 1 << 2 : 0 };
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
    it('acro (DJI M): the throttle is raw, the centre is half power', () => {
        const r = new Rig('centred', 'acro');
        r.run(300);
        r.sticks.yaw = 0.5;
        r.run(600);
        r.sticks.yaw = 0;
        expect(r.sim.armed).toBe(true);
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
