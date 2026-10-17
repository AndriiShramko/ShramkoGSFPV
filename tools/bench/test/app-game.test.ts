// v0.9 lane B (docs/wip/v09-b.md): the game scheme's assist layer against the real model. The page is emulated
// as it runs (game-loop.ts): the Sim steps at 1 kHz, the page's frames (60 Hz) refresh what the input reads,
// the input source emits every 10 ms through the real AutoArm and ArmGate. Every claim has a negative control.
//  - W held moves the drone several metres in the facing direction; every key let go and it brakes and holds
//    its place and its height (control: v0.8's keys, a tilt while held, coast on after release);
//  - movement is relative to the aim (a mouse turn), a diagonal is not faster, the speed settings are speeds;
//  - the mouse turns the aim and the heading follows; the gimbal is clamped and invert-Y flips it;
//  - Space climbs, Shift descends and lands softly (control: told there is no ground, the same descent crashes);
//    landed, the motors stop by themselves and the next key starts them;
//  - every preset stops and holds; the sticks are all the model sees (the log replays without the assist).
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { S, Sim } from '@gsfpv/sim-core';
import { FloorWorld, GameLoop, PRESET_DIR, params } from './game-loop';
import { GAME_SPEEDS, GIMBAL_MAX_DEG, GIMBAL_MIN_DEG, MOUSE_DEG_PER_PX, StickCurve, headingDeg, mouseToAim, wrap180 } from '../../../apps/fly/src/play/game';
import { gimbalQuat } from '../../../apps/fly/src/play/gimbal';
import { PROBE_M, groundClearance } from '../../../apps/fly/src/play/ground';
import { stickForAngle, stickForRate } from '../../../apps/fly/src/play/keys';
import { setpointRate } from '@gsfpv/sim-core';

const PRESET_IDS = readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

/** Motors started by a tap on Space, then a settle: hovering about a metre up. */
function hover(L: GameLoop, settleMs = 1500): void {
    L.run(100, { lift: 1 });
    L.run(settleMs);
}

describe('W moves the drone forward; let go and it brakes and holds its place', () => {
    it('2 s of W: several metres in the facing direction (-z), no sideways drift; released: under 0.5 m/s within 2.5 s and the height held', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        const x0 = L.sim.s[S.px], z0 = L.sim.s[S.pz], y0 = L.y;
        L.run(2000, { forward: 1 });
        expect(z0 - L.sim.s[S.pz]).toBeGreaterThan(5);
        expect(Math.abs(L.sim.s[S.px] - x0)).toBeLessThan(0.6);
        expect(L.speed).toBeGreaterThan(5);
        const dzRun = z0 - L.sim.s[S.pz];
        L.run(2500, {});
        expect(L.speed).toBeLessThan(0.5);
        expect(Math.abs(L.y - y0)).toBeLessThan(0.5);
        // it stopped near where it braked, not metres on
        expect(z0 - L.sim.s[S.pz] - dzRun).toBeLessThan(6);
        // and it stays: another 3 s with nothing held moves it less than a metre
        const z1 = L.sim.s[S.pz], x1 = L.sim.s[S.px];
        L.run(3000, {});
        expect(Math.hypot(L.sim.s[S.pz] - z1, L.sim.s[S.px] - x1)).toBeLessThan(1);
    });

    it('control: v0.8\'s keys (a tilt while held, level when released) coast on after the release', () => {
        const C = new GameLoop(params(), null, 50, 'normal', { tiltKeys: true });
        hover(C);
        C.run(2000, { forward: 1 });
        const vRun = C.speed;
        C.run(2500, {});
        expect(vRun).toBeGreaterThan(3);
        expect(C.speed).toBeGreaterThan(1); // the game scheme is under 0.5 at the same moment
    });

    it('every preset: 2 s of W then released stops under 0.5 m/s within 2.5 s and holds the height within 0.6 m', () => {
        for (const id of PRESET_IDS) {
            const L = new GameLoop(params(id), null, 50);
            hover(L);
            const y0 = L.y;
            L.run(2000, { forward: 1 });
            expect(L.speed, `${id} moving`).toBeGreaterThan(3);
            let worst = 0;
            for (let i = 0; i < 25; i++) { L.run(100, {}); worst = Math.max(worst, Math.abs(L.y - y0)); }
            expect(L.speed, `${id} after 2.5 s`).toBeLessThan(0.5);
            expect(worst, `${id} height`).toBeLessThan(0.6);
            expect(L.sim.crashed, id).toBe(false);
        }
    });

    it('back (S) and sideways (A / D) do the same: the facing direction is forward, +x is right', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        const z0 = L.sim.s[S.pz], x0 = L.sim.s[S.px];
        L.run(1500, { forward: -1 });
        expect(L.sim.s[S.pz] - z0).toBeGreaterThan(3); // back is +z
        L.run(2500, {});
        const x1 = L.sim.s[S.px];
        L.run(1500, { strafe: 1 });
        expect(L.sim.s[S.px] - x1).toBeGreaterThan(3); // D is +x at heading 0
        expect(Math.abs(x1 - x0)).toBeLessThan(0.8);
    });
});

describe('the aim: movement is relative to where the drone faces', () => {
    it('after a 90 degree turn to the right W flies +x and D flies +z; control: without the turn W flies -z', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.game.look(90, 0);
        L.run(800);
        expect(Math.abs(wrap180(headingDeg(L.sim.s) - 90))).toBeLessThan(4);
        const x0 = L.sim.s[S.px], z0 = L.sim.s[S.pz];
        L.run(2000, { forward: 1 });
        expect(L.sim.s[S.px] - x0).toBeGreaterThan(5);
        expect(Math.abs(L.sim.s[S.pz] - z0)).toBeLessThan(1);
        L.run(2500, {});
        const z1 = L.sim.s[S.pz];
        L.run(1500, { strafe: 1 });
        expect(L.sim.s[S.pz] - z1).toBeGreaterThan(3);
        const C = new GameLoop(params(), null, 50);
        hover(C);
        const cx = C.sim.s[S.px], cz = C.sim.s[S.pz];
        C.run(2000, { forward: 1 });
        expect(cz - C.sim.s[S.pz]).toBeGreaterThan(5);
        expect(Math.abs(C.sim.s[S.px] - cx)).toBeLessThan(0.6);
    });

    it('W is the direction of the aim even while the body is still turning to it', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.game.look(150, 0);
        // the keys go down at once: the velocity target is along the aim, whatever the body faces right now
        L.run(1500, { forward: 1 });
        const vx = L.sim.s[S.vx], vz = L.sim.s[S.vz];
        const along = vx * Math.sin((150 * Math.PI) / 180) - vz * Math.cos((150 * Math.PI) / 180);
        expect(along).toBeGreaterThan(4);
        expect(Math.abs(vx * Math.cos((150 * Math.PI) / 180) + vz * Math.sin((150 * Math.PI) / 180))).toBeLessThan(1.2);
    });

    it('a diagonal is not faster than straight on', () => {
        const straight = new GameLoop(params(), null, 50);
        hover(straight);
        straight.run(3500, { forward: 1 });
        const diag = new GameLoop(params(), null, 50);
        hover(diag);
        diag.run(3500, { forward: 1, strafe: 1 });
        expect(diag.speed).toBeLessThan(straight.speed * 1.08);
        expect(Math.hypot(diag.game.goal.forward, diag.game.goal.right)).toBeLessThanOrEqual(GAME_SPEEDS.normal.horizontal + 1e-9);
        // control: the keys summed would ask for the square root of two
        expect(Math.hypot(GAME_SPEEDS.normal.horizontal, GAME_SPEEDS.normal.horizontal)).toBeGreaterThan(GAME_SPEEDS.normal.horizontal * 1.4);
    });

    it('the speed settings: slow and normal reach their speeds, fast is faster and no more than 14 m/s; up and down 3 / 5 / 8', () => {
        const speedAfter = (speed: 'slow' | 'normal' | 'fast'): number => {
            const L = new GameLoop(params('nazgulf5v3-6s'), null, 50, speed);
            hover(L);
            L.run(4500, { forward: 1 });
            return L.speed;
        };
        const slow = speedAfter('slow'), normal = speedAfter('normal'), fast = speedAfter('fast');
        expect(Math.abs(slow - 4)).toBeLessThan(0.5);
        expect(Math.abs(normal - 8)).toBeLessThan(0.8);
        expect(fast).toBeGreaterThan(normal * 1.1);
        expect(fast).toBeLessThanOrEqual(14.5);
        for (const speed of ['slow', 'normal', 'fast'] as const) {
            const L = new GameLoop(params('nazgulf5v3-6s'), null, 50, speed);
            hover(L);
            L.run(1800, { lift: 1 });
            expect(Math.abs(L.vy - GAME_SPEEDS[speed].vertical), speed).toBeLessThan(0.8);
        }
    });
});

describe('the mouse: yaw turns the aim and the drone follows; pitch is the gimbal', () => {
    it('a 90 degree mouse turn is followed to within 4 degrees in 0.5 s, a 170 degree flick in 0.7 s, without overshooting past 5 degrees', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.game.look(90, 0);
        L.run(500);
        expect(Math.abs(wrap180(headingDeg(L.sim.s) - 90))).toBeLessThan(4);
        L.game.look(80, 0);
        let worst = 0;
        for (let i = 0; i < 14; i++) { L.run(50); worst = Math.max(worst, Math.abs(wrap180(headingDeg(L.sim.s) - 170))); }
        expect(Math.abs(wrap180(headingDeg(L.sim.s) - 170))).toBeLessThan(4);
        // turning the other way round the circle: the error is wrapped, the short way
        L.game.look(-200, 0);
        L.run(900);
        expect(Math.abs(wrap180(headingDeg(L.sim.s) - wrap180(170 - 200)))).toBeLessThan(4);
        expect(worst).toBeGreaterThan(0);
    });

    it('a steady sweep of 90 deg/s lags the aim by under 10 degrees', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.run(1500, {}, { yawDegPerS: 90 });
        const lag = wrap180((L.game.aimYawDeg ?? 0) - headingDeg(L.sim.s));
        expect(lag).toBeGreaterThan(0);
        expect(lag).toBeLessThan(10);
    });

    it('looking around on the ground keeps the aim for the take-off: a parked model does not turn, W then flies along the aim; control: the model alone stays at its heading', () => {
        const L = new GameLoop(params(), new FloorWorld(), 0.05);
        L.game.look(120, 0);
        L.run(300);
        expect(L.sim.armed).toBe(false);
        expect(Math.abs(headingDeg(L.sim.s))).toBeLessThan(1);
        expect(L.game.aimYawDeg).toBeCloseTo(120, 6);
        L.run(2500, { forward: 1 });
        expect(Math.abs(wrap180(headingDeg(L.sim.s) - 120))).toBeLessThan(5);
        const h = (120 * Math.PI) / 180;
        const along = L.sim.s[S.vx] * Math.sin(h) - L.sim.s[S.vz] * Math.cos(h);
        expect(along).toBeGreaterThan(4);
        expect(Math.abs(L.sim.s[S.vx] * Math.cos(h) + L.sim.s[S.vz] * Math.sin(h))).toBeLessThan(1.5);
    });

    it('pixels to degrees: right and away from you are positive yaw and a look up; invert-Y flips the pitch only; the gimbal stops at -60 and +30', () => {
        const a = mouseToAim(100, 0, 1, false);
        expect(a.yaw).toBeCloseTo(100 * MOUSE_DEG_PER_PX, 9);
        expect(a.pitch).toBeCloseTo(0, 9);
        expect(mouseToAim(0, -50, 1, false).pitch).toBeGreaterThan(0);
        expect(mouseToAim(0, -50, 1, true).pitch).toBeLessThan(0);
        expect(mouseToAim(30, 0, 2.5, true).yaw).toBeCloseTo(30 * MOUSE_DEG_PER_PX * 2.5, 9);
        const L = new GameLoop(params(), null, 50);
        L.game.look(0, 500);
        expect(L.game.gimbalDeg).toBe(GIMBAL_MAX_DEG);
        L.game.look(0, -1000);
        expect(L.game.gimbalDeg).toBe(GIMBAL_MIN_DEG);
        L.game.look(0, 20);
        expect(L.game.gimbalDeg).toBe(GIMBAL_MIN_DEG + 20);
        expect([GIMBAL_MIN_DEG, GIMBAL_MAX_DEG]).toEqual([-60, 30]);
    });

    it('the gimbal camera: level and facing -z at zero; 90 deg of heading faces +x; the pitch raises the view; no roll', () => {
        const rot = (q: readonly number[], v: readonly number[]): number[] => {
            const [w, x, y, z] = q;
            const [vx, vy, vz] = v;
            // v + 2 w (q x v) + 2 q x (q x v)
            const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
            return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
        };
        const fwd = [0, 0, -1], right = [1, 0, 0];
        const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
        near(rot(gimbalQuat({ yawDeg: 0, pitchDeg: 0 }), fwd), [0, 0, -1]);
        near(rot(gimbalQuat({ yawDeg: 90, pitchDeg: 0 }), fwd), [1, 0, 0]);
        near(rot(gimbalQuat({ yawDeg: 90, pitchDeg: 0 }), right), [0, 0, 1]);
        const up30 = rot(gimbalQuat({ yawDeg: 0, pitchDeg: 30 }), fwd);
        near(up30, [0, Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6)]);
        // the view's right stays level whatever the pitch and the heading: no roll
        const r = rot(gimbalQuat({ yawDeg: 37, pitchDeg: -45 }), right);
        expect(r[1]).toBeCloseTo(0, 9);
        // control: a body quaternion rolled 20 degrees (what the camera would show without the gimbal) is not level
        const roll = (20 * Math.PI) / 360;
        const rolled = rot([Math.cos(roll), 0, 0, Math.sin(roll)], right);
        expect(Math.abs(rolled[1])).toBeGreaterThan(0.3);
    });
});

describe('Space climbs, Shift descends and lands softly; landed, the motors stop by themselves', () => {
    it('Space released holds the height; Shift from 20 m lands without a crash and the motors stop', () => {
        for (const id of ['pavo20pro-3s', 'taurusx8-komodo-6s', 'air65-1s']) {
            const L = new GameLoop(params(id), new FloorWorld(), 20, 'fast');
            hover(L);
            let worstContact = 0;
            for (let i = 0; i < 120 && L.sim.armed; i++) {
                L.run(250, { lift: -1 });
                for (const e of L.sim.events) if (e.type === 'contact') worstContact = Math.max(worstContact, e.speed);
            }
            expect(L.sim.crashed, `${id} crashed`).toBe(false);
            expect(L.sim.armed, `${id} motors stopped by landing`).toBe(false);
            expect(L.y, `${id} on the floor`).toBeLessThan(0.3);
            expect(worstContact, `${id} touch-down speed`).toBeLessThan(L.p.vCrash * 0.6);
            // the next key starts the motors and the drone climbs off the floor
            L.run(100, { lift: 1 });
            L.run(2500, { lift: 1 });
            expect(L.sim.armed, `${id} started again`).toBe(true);
            expect(L.y, `${id} climbing`).toBeGreaterThan(3);
        }
    });

    it('control: told there is no ground below, the same descent from 20 m hits the floor at a crash speed', () => {
        for (const id of ['pavo20pro-3s', 'taurusx8-komodo-6s']) {
            const L = new GameLoop(params(id), new FloorWorld(), 20, 'fast', { blindGround: true });
            hover(L);
            for (let i = 0; i < 120 && L.sim.armed; i++) L.run(250, { lift: -1 });
            expect(L.sim.crashed, id).toBe(true);
        }
    });

    it('Shift alone on the ground starts nothing; W from the ground takes off with a short hop and flies on', () => {
        const L = new GameLoop(params(), new FloorWorld(), 0.05);
        L.run(500, { lift: -1 });
        expect(L.sim.armed).toBe(false);
        L.run(1500, { forward: 1 });
        expect(L.sim.armed).toBe(true);
        expect(L.sim.crashed).toBe(false);
        expect(L.y).toBeGreaterThan(0.7);
        expect(L.y).toBeLessThan(1.8);
        expect(L.speed).toBeGreaterThan(3);
    });

    it('the height holds with nothing pressed, in the air for 6 s, within 0.3 m', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.run(2000, { lift: 1 });
        L.run(1500);
        const y0 = L.y;
        let worst = 0;
        for (let i = 0; i < 60; i++) { L.run(100); worst = Math.max(worst, Math.abs(L.y - y0)); }
        expect(worst).toBeLessThan(0.3);
    });
});

describe('the assist is an input: the model sees the channels only', () => {
    it('the recorded channels, fed to a fresh model, end in the same state bit for bit; control: one LSB of a stick does not', () => {
        const L = new GameLoop(params(), null, 50);
        hover(L);
        L.play([{ ms: 1500, forward: 1 }, { ms: 800, mouseYawDegPerS: 100 }, { ms: 1200, forward: 1, strafe: -1 }, { ms: 1500 }]);
        const replay = (tamper: boolean): Float64Array => {
            const sim = new Sim(L.p, null);
            sim.reset(0, 50, 0, 0, { soc: 1 });
            // the loop applied the 10 ms frame at ticks 0, 10, 20 ... : one record per 10 steps
            for (let tick = 0; tick < L.t; tick++) {
                if (tick % 10 === 0) {
                    const rec = Float32Array.from(L.sent[tick / 10]);
                    if (tamper && tick === 5000) rec[0] += 1e-6;
                    sim.setChannels(rec);
                }
                sim.step();
            }
            return sim.s;
        };
        const same = replay(false);
        expect(Array.from(same)).toEqual(Array.from(L.sim.s));
        expect(Array.from(replay(true))).not.toEqual(Array.from(L.sim.s));
    });
});

describe('the parts: stick curves and the ground probe', () => {
    it('the sampled curve inverts the drone\'s rate curve like the bisection does (angle and rate)', () => {
        const p = params();
        const max = setpointRate(p.rates.type, 1, p.rates.pitch, p.rates.rateLimit);
        const pitch = new StickCurve((u) => (p.level.limitDeg * setpointRate(p.rates.type, u, p.rates.pitch, p.rates.rateLimit)) / max);
        const yaw = new StickCurve((u) => setpointRate(p.rates.type, u, p.rates.yaw, p.rates.rateLimit));
        for (const deg of [1, 5, 12, 25, 40, 55]) expect(Math.abs(pitch.stickFor(deg) - stickForAngle(deg, p.rates, 'pitch', p.level.limitDeg)), `${deg} deg`).toBeLessThan(0.004);
        for (const dps of [10, 110, 300, 600]) expect(Math.abs(yaw.stickFor(dps) - stickForRate(dps, p.rates, 'yaw')), `${dps} deg/s`).toBeLessThan(0.004);
        expect(pitch.stickFor(0)).toBe(0);
        expect(pitch.stickFor(1000)).toBe(1);
        // control: a straight line from the end points is not the curve (expo)
        const linear = 25 / p.level.limitDeg;
        expect(Math.abs(linear - stickForAngle(25, p.rates, 'pitch', p.level.limitDeg))).toBeGreaterThan(0.02);
    });

    it('the ground probe reads the clearance of the lowest body point; nothing within the reach, or no world, is null', () => {
        const p = params();
        const at = (y: number): Float64Array => { const s = new Float64Array(80); s[S.px] = 3; s[S.py] = y; s[S.pz] = -2; return s; };
        const floor = new FloorWorld();
        expect(groundClearance(floor, at(2.03), p)).toBeCloseTo(2.03 - p.bodyBottom, 1);
        expect(groundClearance(floor, at(p.bodyBottom), p)).toBeLessThan(0.1);
        expect(groundClearance(floor, at(PROBE_M + 5), p)).toBeNull();
        expect(groundClearance(null, at(2), p)).toBeNull();
    });
});
