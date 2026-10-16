// v0.8 lane A (docs/wip/v08-a.md): easy play's pure parts against the real model. The page is emulated
// as it runs: the Sim steps at 1 kHz, the page's frames refresh what the inputs read at 60 Hz, the
// input source emits at 100 Hz through the real ArmGate. Every claim has a negative control.
//  - auto-arm: the model arms from a flying input with no switch, the throttle at the bottom at the
//    edge (control: arm and hover throttle in one frame is refused by both the gate and the model);
//  - altitude help: holds the height for every preset, on the Moon, in auto-throttle mode and on a
//    drained pack; holds it through a 25 deg key tilt (control: the hover stick alone loses metres);
//    climbs and sinks at the asked speeds;
//  - keys: physical targets (25 deg, 110 deg/s, 200 deg/s acro) reached in the model, the same for
//    any rates (control: a fixed stick differs by rates); ramps instead of steps; both layouts
//    read only keyboard-flying keys, none of the keymap's shortcuts;
//  - touch: a touch-down never moves a stick (control: v0.7's absolute pad jumps), and a finger
//    moves the stick as far as a calibrated radio's stick moves its channel;
//  - pilot school: steps from the settings, progress per life and step.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Sim, S, compileParams, hoverSolve, attitude, MODE_CHANNEL, setpointRate } from '@gsfpv/sim-core';
import type { FlightMode, ParamOverrides, PresetJson, RatesConfig, SimParams } from '@gsfpv/sim-core';
import { ArmGate, mapFrame } from '@gsfpv/input';
import type { Profile } from '@gsfpv/input';
import { REPO } from '../../../packages/prefs/test/helpers';
import { FLYING_CODES, KEYMAP, keymapProblems } from '../../../packages/prefs/src';
import type { KeyBinding } from '../../../packages/prefs/src';
import { ARM_RETRY_MS, AltitudeHelp, AutoArm, CLIMB_BOOST, CLIMB_MPS, SINK_MPS, helpFlies, stickForThrust } from '../../../apps/fly/src/play/assist';
import { BOOST_CODES, GAME_KEYS, KEY_ACRO_DPS, KEY_TILT_DEG, KEY_YAW_DPS, MODE2_KEYS, MOTOR_STOP_HOLD_MS, MotorKey, RAMP_FALL_PER_S, RAMP_RISE_PER_S, axisDirs, flyingKeyCodes, keyTargets, slew, stickForRate } from '../../../apps/fly/src/play/keys';
import { PadGrab, SCREEN_EDGE_PX, UNBOUNDED, absoluteRead, padTravel, reachOf } from '../../../apps/fly/src/play/touch-map';
import { GOAL_S, SCHOOL_STEPS, SchoolProgress, settingsOf, stepOf } from '../../../apps/fly/src/play/school';
import { KeyCardShow } from '../../../apps/fly/src/ui/key-card-state';

const PRESET_DIR = join(REPO, 'packages', 'sim-core', 'presets');
const PRESET_IDS = readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const params = (id = 'pavo20pro-3s', o: ParamOverrides = {}): SimParams => compileParams(JSON.parse(readFileSync(join(PRESET_DIR, `${id}.json`), 'utf8')) as PresetJson, o);

/** What one emitted frame asks for (sticks -1..1, lift -1..1 for the help). */
interface Ask { roll?: number; pitch?: number; yaw?: number; lift?: number; boost?: boolean; fly?: boolean; thrStick?: number }

/**
 * The page around the model: 1 kHz steps, a state snapshot per 60 Hz frame (what an input reads in the
 * page), a 100 Hz input source through the real ArmGate. `assist` false: the throttle stick is
 * ask.thrStick (the control's fixed hover stick).
 */
class PageLoop {
    readonly sim: Sim;
    readonly gate = new ArmGate({ keepArmedAfterCrash: true });
    readonly arm = new AutoArm();
    snap: Float64Array;
    snapArmed = false;
    t = 0;
    private lastEmit = -1e9;
    readonly sent: number[][] = [];

    constructor(readonly p: SimParams, readonly mode: FlightMode, readonly assist = true, soc = 1, readonly help = new AltitudeHelp()) {
        this.sim = new Sim(p, null);
        this.sim.reset(0, 50, 0, 0, { soc });
        this.snap = new Float64Array(this.sim.s);
    }

    run(ms: number, ask: Ask): void {
        for (let i = 0; i < ms; i++) {
            // a new page frame (60 Hz): what the input source reads is refreshed only then
            if (Math.floor((this.t * 60) / 1000) !== Math.floor(((this.t - 1) * 60) / 1000)) {
                this.snap = new Float64Array(this.sim.s);
                this.snapArmed = this.sim.armed;
            }
            if (this.t - this.lastEmit >= 10) {
                const dt = this.lastEmit < 0 ? 0 : (this.t - this.lastEmit) / 1000;
                this.lastEmit = this.t;
                this.emit(ask, dt);
            }
            this.sim.step();
            this.t++;
        }
    }

    private emit(ask: Ask, dt: number): void {
        if (ask.fly) this.arm.request();
        const a = this.arm.step({ simArmed: this.snapArmed, crashed: this.sim.crashed, paused: false, now: this.t });
        let thr: number;
        if (!this.assist) thr = ask.thrStick ?? 0;
        else if (a.holdLow) { this.help.reset(); thr = 0; } else thr = this.help.update(ask.lift ?? 0, !!ask.boost, this.p, this.snap, dt);
        const ch = new Float32Array([ask.roll ?? 0, ask.pitch ?? 0, thr * 2 - 1, ask.yaw ?? 0, this.assist ? a.arm : ask.fly ? 1 : -1, MODE_CHANNEL[this.mode], 0, 0]);
        ch[4] = this.gate.update({} as Profile, ch, 0, true, this.sim.crashed);
        this.sent.push(Array.from(ch));
        this.sim.setChannels(ch);
    }

    get y(): number { return this.sim.s[S.py]; }
    get vy(): number { return this.sim.s[S.vy]; }
}

/** Armed by easy play and hovering at about 50 m for `settleMs`. */
function airborne(p: SimParams, mode: FlightMode = 'angle', soc = 1, settleMs = 3000, help = new AltitudeHelp()): PageLoop {
    const L = new PageLoop(p, mode, true, soc, help);
    L.run(200, {});
    L.run(settleMs, { fly: true });
    if (!L.sim.armed) throw new Error('easy play did not arm');
    return L;
}

describe('easy play: the motors start from a flying input, no switch', () => {
    it('arms within 0.1 s of the first input; the throttle stick is at the bottom on the edge', () => {
        const L = new PageLoop(params(), 'angle');
        L.run(300, {});
        expect(L.sim.armed).toBe(false);
        const before = L.sent.length;
        L.run(100, { fly: true });
        expect(L.sim.armed).toBe(true);
        const first = L.sent.slice(before).find((c) => c[4] > 0)!;
        expect(first[2]).toBeLessThanOrEqual(-0.9);
        // after arming the help takes the throttle: it climbs off the bottom
        L.run(500, { fly: true });
        expect(L.sent.at(-1)![2]).toBeGreaterThan(-0.5);
    });

    it('control: arm and a hover throttle in one frame are refused by the gate and the model', () => {
        const p = params();
        const sim = new Sim(p, null);
        sim.reset(0, 50, 0, 0);
        const gate = new ArmGate({ keepArmedAfterCrash: true });
        const hover = hoverSolve(p, 1).stick * 2 - 1;
        const off = new Float32Array([0, 0, -1, 0, -1, 1, 0, 0]);
        off[4] = gate.update({} as Profile, off, 0, true, false);
        sim.setChannels(off);
        for (let i = 0; i < 50; i++) sim.step();
        const naive = new Float32Array([0, 0, hover, 0, 1, 1, 0, 0]);
        const out = Float32Array.from(naive);
        out[4] = gate.update({} as Profile, naive, 0, true, false);
        expect(gate.block).toBe('throttle');
        // past the gate (a page that skipped it), the model refuses the edge too
        sim.setChannels(naive);
        for (let i = 0; i < 1000; i++) sim.step();
        expect(sim.armed).toBe(false);
    });

    it('an edge the model does not take is tried again (off, then on) after ARM_RETRY_MS', () => {
        const a = new AutoArm();
        a.request();
        const arms: number[] = [];
        for (let t = 0; t <= 1000; t += 10) arms.push(a.step({ simArmed: false, crashed: false, paused: false, now: t }).arm);
        const rising = arms.filter((v, i) => i > 0 && v > 0 && arms[i - 1] < 0).length;
        expect(rising).toBeGreaterThanOrEqual(2);
        // paused: no time passes, no retry
        const b = new AutoArm();
        b.request();
        b.step({ simArmed: false, crashed: false, paused: false, now: 0 });
        b.step({ simArmed: false, crashed: false, paused: false, now: 0 });
        for (let t = 10; t < ARM_RETRY_MS * 3; t += 10) expect(b.step({ simArmed: false, crashed: false, paused: true, now: t }).arm).toBe(1);
    });

    it('Space: a tap in the air keeps the motors on, a 0.5 s hold stops them; control: the hold drops the drone', () => {
        const k = new MotorKey();
        expect(k.press(0, false)).toBe('start');
        expect(k.press(1000, true)).toBe(null);
        for (let t = 1000; t < 1000 + MOTOR_STOP_HOLD_MS; t += 2) expect(k.tick(t)).toBe(null);
        k.release();
        expect(k.tick(9000)).toBe(null); // released before the hold ended: nothing pending
        k.press(10000, true);
        expect(k.tick(10000 + MOTOR_STOP_HOLD_MS)).toBe('stop');
        expect(k.tick(11000)).toBe(null); // once per press
        // in flight with the help: Space as the keyboard drives it (press, 500 Hz ticks, release)
        const space = (holdMs: number): { armed: boolean; lossM: number } => {
            const L = airborne(params());
            const key = new MotorKey();
            const y0 = L.y;
            if (key.press(L.t, L.arm.want) === 'start') L.arm.request();
            for (let i = 0; i < holdMs; i += 2) { L.run(2, {}); if (key.tick(L.t) === 'stop') L.arm.stop(); }
            key.release();
            L.run(2000, {});
            return { armed: L.sim.armed, lossM: y0 - L.y };
        };
        const tap = space(150);
        expect(tap.armed).toBe(true);
        expect(Math.abs(tap.lossM)).toBeLessThan(0.3);
        const hold = space(600);
        expect(hold.armed).toBe(false);
        expect(hold.lossM).toBeGreaterThan(1);
    });

    it('a model that drops out by itself waits for the next input; a crash keeps the switch on (keepArmed)', () => {
        const a = new AutoArm();
        a.request();
        for (let t = 0; t < 30; t += 10) a.step({ simArmed: t > 10, crashed: false, paused: false, now: t });
        expect(a.state).toBe('on');
        expect(a.step({ simArmed: false, crashed: true, paused: false, now: 40 }).arm).toBe(1);
        expect(a.step({ simArmed: false, crashed: false, paused: false, now: 50 }).arm).toBe(-1);
        expect(a.want).toBe(false);
        expect(a.step({ simArmed: false, crashed: false, paused: false, now: 60 }).arm).toBe(-1);
        a.stop();
        expect(a.state).toBe('off');
    });
});

describe('altitude help: holds the height, climbs and sinks at the asked speed', () => {
    it('holds within 0.3 m for 20 s on every preset', () => {
        const rows: Record<string, number> = {};
        for (const id of PRESET_IDS) {
            const L = airborne(params(id));
            const y0 = L.y;
            let worst = 0;
            for (let s = 0; s < 20; s++) { L.run(1000, { fly: true }); worst = Math.max(worst, Math.abs(L.y - y0)); }
            rows[id] = worst;
        }
        for (const [id, w] of Object.entries(rows)) expect(w, id).toBeLessThan(0.3);
    });

    it('holds on the Moon, in auto-throttle mode and on a drained pack', () => {
        for (const [why, p, soc] of [['moon', params('pavo20pro-3s', { gravity: 1.62 }), 1], ['auto-throttle', params('pavo20pro-3s', { gravityMode: 'auto-throttle' }), 1], ['pack at 25 %', params(), 0.25]] as const) {
            const L = airborne(p, 'angle', soc);
            const y0 = L.y;
            let worst = 0;
            for (let s = 0; s < 10; s++) { L.run(1000, { fly: true }); worst = Math.max(worst, Math.abs(L.y - y0)); }
            expect(worst, why).toBeLessThan(0.3);
        }
    });

    it('holds through a 25 deg key tilt; control: the level hover stick alone loses metres', () => {
        const p = params();
        const pitch = keyTargets(p.rates, p.level.limitDeg, 'angle').pitch;
        const L = airborne(p);
        const y0 = L.y;
        let worst = 0;
        for (let i = 0; i < 40; i++) { L.run(100, { fly: true, pitch }); worst = Math.max(worst, Math.abs(L.y - y0)); }
        expect(worst).toBeLessThan(0.6);
        // control: the same tilt with the throttle frozen at the level hover stick
        const C = new PageLoop(p, 'angle', false);
        const hover = hoverSolve(p, 1).stick;
        C.run(200, { thrStick: 0 });
        C.run(20, { thrStick: 0, fly: true });
        C.run(2000, { thrStick: hover, fly: true });
        expect(C.sim.armed).toBe(true);
        const c0 = C.y;
        C.run(4000, { thrStick: hover, pitch, fly: true });
        expect(c0 - C.y).toBeGreaterThan(2);
    });

    it('upside down the help gives idle: a horizon flip loses no more height than a cut throttle; control: the help as first shipped pushes the craft down', () => {
        // the review of 2026-10-16: the help forced on in horizon, full roll held, then released. The
        // shipped page never flies the help in horizon (helpFlies); this proves the guard for any tip-over
        // (a collision in angle mode, a high angle limit) and that the test sees the old fault
        const flip = (id: string, holdMs: number, help: AltitudeHelp): { lossM: number; tippedThr: number[] } => {
            const L = airborne(params(id), 'horizon', 1, 3000, help);
            const y0 = L.y;
            let low = y0;
            const tippedThr: number[] = [];
            const watch = (ms: number, ask: Ask): void => {
                for (let i = 0; i < ms; i += 10) {
                    L.run(10, ask);
                    low = Math.min(low, L.y);
                    if (help.tipped) tippedThr.push((L.sent.at(-1)![2] + 1) / 2);
                }
            };
            watch(holdMs, { fly: true, roll: 1 });
            watch(4000, { fly: true });
            return { lossM: y0 - low, tippedThr };
        };
        for (const id of ['pavo20pro-3s', 'air65-1s']) {
            for (const holdMs of [400, 700]) {
                const guarded = flip(id, holdMs, new AltitudeHelp());
                const first = flip(id, holdMs, new AltitudeHelp(-1)); // never gives idle: v0.8's first help
                const idle = stickForThrust(params(id), params(id).vNom, 0);
                expect(guarded.tippedThr.length, `${id} ${holdMs} ms: the craft went past 78 deg`).toBeGreaterThan(0);
                for (const thr of guarded.tippedThr) expect(thr, `${id} ${holdMs} ms`).toBeCloseTo(idle, 6);
                expect(guarded.lossM, `${id} ${holdMs} ms`).toBeLessThan(3);
                // control: the first help kept pushing while inverted and lost at least 1 m more
                expect(first.lossM - guarded.lossM, `${id} ${holdMs} ms`).toBeGreaterThan(1);
            }
        }
    });

    it('the help flies in angle mode only, and the school step shown is what flies; control: the first rule (all but acro) disagreed in horizon', () => {
        expect(helpFlies('angle')).toBe(true);
        expect(helpFlies('horizon')).toBe(false);
        expect(helpFlies('acro')).toBe(false);
        for (const m of ['angle', 'horizon', 'acro'] as FlightMode[]) {
            for (const on of [true, false]) {
                const o = settingsOf(stepOf(m, on));
                expect(o.mode, `${m} ${on}`).toBe(m);
                expect(o.altitudeHelp && helpFlies(o.mode), `${m} ${on}`).toBe(on && helpFlies(m));
            }
        }
        const firstRule = (m: FlightMode): boolean => m !== 'acro';
        expect(settingsOf(stepOf('horizon', true)).altitudeHelp).not.toBe(firstRule('horizon'));
    });

    it('climbs at 2.5 m/s, sinks at 2 m/s, twice as fast with Shift', () => {
        const p = params();
        const avg = (L: PageLoop, ask: Ask): number => {
            L.run(2000, ask);
            let sum = 0;
            for (let i = 0; i < 20; i++) { L.run(100, ask); sum += L.vy; }
            return sum / 20;
        };
        expect(avg(airborne(p), { fly: true, lift: 1 })).toBeCloseTo(CLIMB_MPS, 0);
        expect(Math.abs(avg(airborne(p), { fly: true, lift: 1 }) - CLIMB_MPS)).toBeLessThan(0.25);
        expect(Math.abs(avg(airborne(p), { fly: true, lift: -1 }) + SINK_MPS)).toBeLessThan(0.25);
        expect(Math.abs(avg(airborne(p), { fly: true, lift: 1, boost: true }) - CLIMB_MPS * CLIMB_BOOST)).toBeLessThan(0.5);
    });

    it('stickForThrust is the model\'s own chain: the hover thrust gives hoverSolve\'s stick', () => {
        for (const id of PRESET_IDS) {
            const p = params(id);
            const h = hoverSolve(p, 1);
            expect(stickForThrust(p, h.volts, p.mass * p.gravity), id).toBeCloseTo(h.stick, 3);
        }
    });
});

describe('keys: physical targets through the drone\'s rates, ramps, layouts', () => {
    it('a tilt key levels the model at 25 deg (angle), a turn key yaws at 110 deg/s, an acro key rolls at 200 deg/s', () => {
        const p = params();
        const k = keyTargets(p.rates, p.level.limitDeg, 'angle');
        const L = airborne(p);
        L.run(2000, { fly: true, pitch: k.pitch });
        expect(Math.abs(attitude(L.sim.s).pitch - KEY_TILT_DEG)).toBeLessThan(2.5);
        const M = airborne(p);
        M.run(800, { fly: true, yaw: k.yaw });
        const yawRate = -M.sim.s[S.wy] * (180 / Math.PI);
        expect(Math.abs(yawRate - KEY_YAW_DPS)).toBeLessThan(KEY_YAW_DPS * 0.08);
        const a = keyTargets(p.rates, p.level.limitDeg, 'acro');
        expect(Math.abs(setpointRate(p.rates.type, a.roll, p.rates.roll, p.rates.rateLimit) - KEY_ACRO_DPS)).toBeLessThan(1);
    });

    it('the same physical turn whatever the rates; control: v0.7\'s fixed 0.5 stick differs by rates', () => {
        const actual = params().rates;
        // Betaflight's classic rates in its CLI units (rc_rate 100, srate 70, expo 0), as presets and diffs hold them
        const classic: RatesConfig = { type: 'BETAFLIGHT', roll: { rcRate: 100, rate: 70, expo: 0 }, pitch: { rcRate: 100, rate: 70, expo: 0 }, yaw: { rcRate: 100, rate: 70, expo: 0 }, rateLimit: 1998 };
        const dps = (r: RatesConfig, x: number): number => setpointRate(r.type, x, r.yaw, r.rateLimit);
        expect(Math.abs(dps(actual, stickForRate(KEY_YAW_DPS, actual, 'yaw')) - KEY_YAW_DPS)).toBeLessThan(0.5);
        expect(Math.abs(dps(classic, stickForRate(KEY_YAW_DPS, classic, 'yaw')) - KEY_YAW_DPS)).toBeLessThan(0.5);
        const fixed = [dps(actual, 0.5), dps(classic, 0.5)];
        expect(Math.abs(fixed[0] - fixed[1]) / Math.min(...fixed)).toBeGreaterThan(0.2);
    });

    it('a key ramps the stick: 0 -> 0.5 in 0.2 s, back in 0.08 s; a reversal crosses centre at the fall rate; control: bang-bang is there at once', () => {
        const steps = (from: number, to: number): number => { let x = from; let n = 0; while (Math.abs(x - to) > 1e-9 && n < 10000) { x = slew(x, to, 0.001); n++; } return n; };
        expect(Math.abs(steps(0, 0.5) - (0.5 / RAMP_RISE_PER_S) * 1000)).toBeLessThanOrEqual(1);
        expect(Math.abs(steps(0.5, 0) - (0.5 / RAMP_FALL_PER_S) * 1000)).toBeLessThanOrEqual(1);
        expect(slew(0.3, -0.3, 0.05)).toBeCloseTo(-(0.05 - 0.3 / RAMP_FALL_PER_S) * RAMP_RISE_PER_S, 9);
        const bangBang = (_from: number, to: number): number => to; // the pilot layout
        expect(bangBang(0, 0.6)).toBe(0.6);
        expect(slew(0, 0.6, 0.001)).toBeLessThan(0.01);
    });

    it('both layouts read only keyboard-flying keys, the keymap is sound, and no shortcut sits on a flying key', () => {
        for (const c of flyingKeyCodes()) expect(FLYING_CODES, c).toContain(c);
        expect(keymapProblems(KEYMAP)).toEqual([]);
        for (const b of KEYMAP) if (!b.flying) for (const k of b.keys) expect(flyingKeyCodes(), `${b.action} ${k.code}`).not.toContain(k.code);
        for (const c of BOOST_CODES) expect(KEYMAP.some((b) => b.keys.some((k) => k.code === c))).toBe(false);
        // control: a shortcut put on Q (now a turn key) is reported
        const bad: KeyBinding[] = [...KEYMAP, { action: 'test.q', keys: [{ code: 'KeyQ', cap: 'Q', aria: 'Q' }], when: 'always', labelKey: 'keys.test.q', status: 'shipped' }];
        expect(keymapProblems(bad).some((s) => s.includes('KeyQ'))).toBe(true);
    });

    it('opposite keys cancel; Q and the left arrow turn left once; the game layout moves with WASD', () => {
        expect(axisDirs(new Set(['KeyW', 'KeyD']), GAME_KEYS)).toEqual({ roll: 1, pitch: 1, yaw: 0, lift: 0 });
        expect(axisDirs(new Set(['KeyW', 'KeyS']), GAME_KEYS).pitch).toBe(0);
        expect(axisDirs(new Set(['KeyQ', 'ArrowLeft']), GAME_KEYS).yaw).toBe(-1);
        expect(axisDirs(new Set(['ArrowUp']), GAME_KEYS).lift).toBe(1);
        expect(axisDirs(new Set(['KeyW']), MODE2_KEYS)).toEqual({ roll: 0, pitch: 0, yaw: 0, lift: 1 });
        expect(axisDirs(new Set(['ArrowUp']), MODE2_KEYS).pitch).toBe(1);
    });
});

describe('touch: a touch-down never moves a stick; a finger moves it like a radio stick', () => {
    const W = { phone: padTravel(Math.min(0.4 * 375, 220)), tablet: padTravel(Math.min(0.4 * 1024, 220)) };

    it('travel: full deflection at 51 px on a 375 px phone, 86 px on a tablet (pad = min(40vw, 220 px))', () => {
        expect(W.phone).toBe(51);
        expect(W.tablet).toBe(86);
    });

    it('touch-down keeps the stick; control: v0.7\'s absolute pad jumps by where the finger landed', () => {
        const g = new PadGrab();
        const travel = W.tablet;
        const cx = 500, cy = 600;
        const cases: [number, number, number, number][] = [[cx + 30, cy - 20, 0, 0], [cx - 50, cy + 40, 0, -1], [cx + 10, cy + 70, 0, -0.4]];
        let jumps = 0;
        for (const [px, py, curX, curY] of cases) {
            g.grab(px, py, curX, curY, travel, reachOf(1024, 768));
            const [x, y] = g.read(px, py);
            expect(x).toBeCloseTo(curX, 9);
            expect(y).toBeCloseTo(curY, 9);
            const [ax, ay] = absoluteRead(px, py, cx, cy, travel);
            if (Math.abs(ax - curX) > 0.1 || Math.abs(ay - curY) > 0.1) jumps++;
        }
        expect(jumps).toBe(cases.length);
    });

    it('moving the finger by f x travel moves the channel by f, as a calibrated radio stick moved by f of its half travel', () => {
        const radio: Profile = {
            version: 1, deviceKey: 'hid:test', deviceName: 'test radio', deadband: 0, created: '', wizard: 2, mode: 2, angleMode: null, arm: null,
            axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } }
        } as unknown as Profile;
        const g = new PadGrab();
        for (const f of [0.1, 0.25, 0.5, 0.9]) {
            g.grab(300, 400, 0, 0, W.phone, reachOf(375, 812));
            const [x] = g.read(300 + f * W.phone, 400);
            const out = mapFrame(radio, { t: 0, axes: new Float32Array([f, 0, -1, 0, 0, 0, 0, 0]), buttons: 0 }, new Float32Array(8));
            expect(x).toBeCloseTo(out[0], 6); // the radio's channel is a float32
        }
    });

    it('full deflection is reachable on screen from any touch-down inside a pad, and the touch-down still moves nothing; control: the first grab (radio travel on every side) left about half of full stick unreachable at the edge', () => {
        // fly.css: .touch-pad 24 px from the left / right / bottom edges, a circle min(40vw, 220 px) wide
        const SIZES: [string, number, number][] = [['phone', 375, 812], ['tablet', 1024, 768], ['phone-landscape', 812, 375]];
        const rows: Record<string, { landings: number; worstFirstGrab: number }> = {};
        for (const [name, w, hgt] of SIZES) {
            const size = Math.min(0.4 * w, 220);
            const travel = padTravel(size);
            const reach = reachOf(w, hgt);
            let landings = 0;
            let worstFirst = 1;
            for (const left of [true, false]) {
                const cx = left ? 24 + size / 2 : w - 24 - size / 2;
                const cy = hgt - 24 - size / 2;
                for (let px = cx - size / 2; px <= cx + size / 2; px += 4) {
                    for (let py = cy - size / 2; py <= cy + size / 2; py += 4) {
                        if (Math.hypot(px - cx, py - cy) > size / 2 - 1) continue; // the pad is a circle
                        // spring axes at centre; the left pad's sticky throttle anywhere
                        for (const curY of left ? [-1, -0.2, 0.6, 1] : [0]) {
                            const g = new PadGrab();
                            g.grab(px, py, 0, curY, travel, reach);
                            const at = g.read(px, py);
                            expect(Math.abs(at[0]) + Math.abs(at[1] - curY), `${name} ${px},${py}`).toBeLessThan(1e-9);
                            expect([g.read(reach.left, py)[0], g.read(reach.right, py)[0], g.read(px, reach.top)[1], g.read(px, reach.bottom)[1]], `${name} ${left ? 'L' : 'R'} ${px},${py} cur ${curY}`).toEqual([-1, 1, 1, -1]);
                            const first = new PadGrab();
                            first.grab(px, py, 0, curY, travel, UNBOUNDED);
                            worstFirst = Math.min(worstFirst, -first.read(reach.left, py)[0], first.read(reach.right, py)[0], -first.read(px, reach.bottom)[1]);
                            landings++;
                        }
                    }
                }
            }
            rows[name] = { landings, worstFirstGrab: worstFirst };
            expect(landings).toBeGreaterThan(500);
            expect(worstFirst, name).toBeLessThan(0.6);
        }
        // a finger landing well inside the screen keeps the radio's travel: half the travel = half stick
        const g = new PadGrab();
        g.grab(24 + 110, 768 - 24 - 110, 0, 0, padTravel(220), reachOf(1024, 768));
        expect(g.read(24 + 110 + padTravel(220) / 2, 768 - 24 - 110)[0]).toBeCloseTo(0.5, 9);
        expect(SCREEN_EDGE_PX).toBeLessThan(24); // the edge margin is inside the pads' 24 px gutter
    });
});

describe('every text easy play names exists in all four languages', () => {
    const FLY = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const dict = (l: string): Record<string, string> => {
        const d = JSON.parse(readFileSync(join(FLY, `${l}.json`), 'utf8')) as Record<string, string>;
        for (const ns of readdirSync(FLY)) if (!ns.endsWith('.json')) Object.assign(d, JSON.parse(readFileSync(join(FLY, ns, `${l}.json`), 'utf8')));
        return d;
    };
    const SRC = ['app/builtin/play.ts', 'devices/keyboard.ts', 'devices/touch.ts', 'ui/hud.ts', 'app/builtin/sound.ts'];
    it('literal t() keys of the changed files, and the school steps built from a template', () => {
        const names = new Set<string>();
        for (const f of SRC) for (const m of readFileSync(join(REPO, 'apps', 'fly', 'src', f), 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) names.add(m[1]);
        for (const s of SCHOOL_STEPS) { names.add(`play.school.step${s}`); names.add(`play.school.step${s}.about`); }
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const d = dict(l);
            expect([...names].filter((k) => !d[k]), l).toEqual([]);
        }
        // control: a key that does not exist is caught
        expect(dict('en')['play.school.step5']).toBeUndefined();
    });
});

describe('the key card: K hides it when it is up, shows and pins it when it is not', () => {
    interface CardRule { shown(ground: boolean): boolean; toggle(): boolean }
    /** What the player sees through a ground wait, K, take-off, K in the air: the broken promises, [] when none. */
    const scenario = (k: CardRule): string[] => {
        const bad: string[] = [];
        const want = (what: string, got: boolean, exp: boolean): void => { if (got !== exp) bad.push(`${what}: ${got}`); };
        want('ground: up by itself', k.shown(true), true);
        want('K over the ground card: away', k.toggle(), false);
        want('still away on the ground', k.shown(true), false);
        want('take-off: not over the flight', k.shown(false), false);
        want('the next ground wait: up again', k.shown(true), true);
        k.shown(false);
        want('K in the air: up', k.toggle(), true);
        want('pinned through the flight', k.shown(false), true);
        want('pinned on the ground', k.shown(true), true);
        want('K again: away', k.toggle(), false);
        want('away in the air', k.shown(false), false);
        return bad;
    };

    it('K on the ground hides the card until take-off without pinning it; K in the air pins it; control: the first rule (K flips a pin) fails the same walk', () => {
        expect(scenario(new KeyCardShow())).toEqual([]);
        // the first version: shown = ground || pinned, K flipped the pin
        const first = new (class implements CardRule {
            private pinned = false;
            shown(ground: boolean): boolean { return ground || this.pinned; }
            toggle(): boolean { this.pinned = !this.pinned; return this.pinned; }
        })();
        expect(scenario(first)).toContain('take-off: not over the flight: true');
    });
});

describe('pilot school', () => {
    it('steps come from the settings and go back to them', () => {
        for (const s of SCHOOL_STEPS) { const o = settingsOf(s); expect(stepOf(o.mode, o.altitudeHelp)).toBe(s); }
        expect(stepOf('acro', true)).toBe(4);
        expect(stepOf('horizon', true)).toBe(3);
    });

    it('counts seconds without a crash per life and step, and reports a goal once', () => {
        const sp = new SchoolProgress();
        expect(sp.update(1, { index: 0, airtimeS: 0, crashes: 0 }).seconds).toBe(0);
        expect(sp.update(1, { index: 0, airtimeS: 10, crashes: 0 }).seconds).toBe(10);
        expect(sp.update(1, { index: 0, airtimeS: 12, crashes: 1 }).seconds).toBe(0);
        expect(sp.update(1, { index: 1, airtimeS: 0, crashes: 0 }).seconds).toBe(0);
        const r = sp.update(1, { index: 1, airtimeS: GOAL_S[1], crashes: 0 });
        expect(r.reached).toBe(true);
        expect(sp.update(1, { index: 1, airtimeS: GOAL_S[1] + 1, crashes: 0 }).reached).toBe(false);
        // another step starts its own count
        expect(sp.update(2, { index: 1, airtimeS: GOAL_S[1] + 2, crashes: 0 }).seconds).toBe(0);
    });
});
