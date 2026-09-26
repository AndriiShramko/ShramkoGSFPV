// Calibration wizard v2: rule by rule, each with a scripted input, plus the ideal person as the
// positive control. The random-people fuzz and the negative control live in human.test.ts.

import { describe, expect, it } from 'vitest';
import { ArmGate, ArmLatch, CalibrationWizard, mapFrame, armOn, TUNING } from '../src/calib';
import type { Profile, RawFrame, WizardState } from '../src/calib';
import { ArmGate as HeadGate, mapFrame as headMapFrame } from './fixtures/calib-head';
import type { Profile as HeadProfile } from './fixtures/calib-head';
import { idealHuman, judge, quantize11 } from '../src/sim/human';
import { mulberry32 } from '../src/sim/signals';
import { allOrders, invSet, invText, Rig, runNew } from './helpers';

const IDEAL = () => idealHuman('AETR', invSet(0)); // CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 arm
const rest = (w: CalibrationWizard) => (w as unknown as { rest: Float64Array }).rest;
const TWO_PI = 2 * Math.PI;

function gaussOf(seed: number): () => number {
    const r = mulberry32(seed);
    return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(TWO_PI * r());
}

describe('calibration wizard v2', () => {
    it('1. the ideal person gets every channel order and inversion right (384 runs, each < 40 s)', () => {
        let ok = 0, worst = 0;
        const bad: string[] = [];
        for (const order of allOrders()) for (let k = 0; k < 16; k++) {
            const cfg = idealHuman(order, invSet(k));
            const o = runNew(cfg, 60000);
            worst = Math.max(worst, o.ms);
            if (o.kind === 'correct' && o.ms < 40000) ok++;
            else bad.push(`${order}/${invText(cfg.inv)}: ${o.kind} ${o.where} ${o.problems.join('; ')}`);
        }
        expect(bad).toEqual([]);
        expect(ok).toBe(384);
        expect(worst).toBeLessThan(40000);
    });

    it('2. the centre is taken only when the sticks are still, and it is the true rest', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('centre')).toBe(true);
        rig.manual = (t, ch) => {
            const w = (t / 1000) * TWO_PI;
            ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = Math.cos(1.3 * w); ch[4] = -1;
        };
        let left = false;
        rig.for(3000, (s) => { if (s.id !== 'centre' || s.ok) left = true; });
        expect(left).toBe(false); // still stirring 3 s into the screen: no capture
        const trueRest = [0.021, -0.013, -1, 0.017];
        const letGo = rig.t;
        rig.hold({ 0: trueRest[0], 1: trueRest[1], 2: -1, 3: trueRest[3] });
        expect(rig.until((s) => s.ok || s.id !== 'centre', 5000)).toBe(true);
        expect(rig.t - letGo).toBeGreaterThanOrEqual(TUNING.CENTRE_HOLD_MS);
        for (const i of [0, 1, 3]) expect(Math.abs(rest(rig.wz)[i] - trueRest[i])).toBeLessThan(0.02);
    });

    it('3. two sticks pushed at once assign nothing and say so after 5 s', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('yaw', 'push')).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => {
            const k = Math.min(1, (t - t0) / 200) * 0.8;
            ch[0] = k; ch[1] = 0; ch[2] = -1; ch[3] = k; ch[4] = -1;
        };
        let assigned = false;
        let early: string | null = null;
        rig.for(6000, (s, t) => {
            if (s.assigned.yaw !== undefined || s.id !== 'yaw') assigned = true;
            if (t - t0 < 4900 && s.hint && !early) early = s.hint.key;
        });
        expect(assigned).toBe(false);
        expect(early).toBeNull();
        expect(rig.st.hint?.key).toBe('wizard.hint.push.two');
        expect(rig.st.hint?.params).toMatchObject({ a: 1, b: 4 });
    });

    it('4. a stick already pushed when the screen appears is not taken until it came back to the middle', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('throttle', 'release')).toBe(true);
        rig.hold({ 2: -1, 3: 0.9 }); // yaw parked at 90 % before the yaw screen
        expect(rig.to('yaw', 'push', 5000)).toBe(true);
        rig.for(2000);
        expect(rig.st.assigned.yaw).toBeUndefined();
        rig.hold({ 2: -1, 3: 0 });
        rig.for(300);
        rig.hold({ 2: -1, 3: 0.9 });
        rig.for(600);
        expect(rig.st.assigned.yaw).toBe(3);
    });

    it('5. throttle already up, pulled down first with a 450 ms dwell: not taken as inverted', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('centre')).toBe(true);
        rig.hold({ 2: 1 }); // the throttle is left up
        expect(rig.to('throttle', 'push', 5000)).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => {
            const e = t - t0;
            ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1;
            const down = Math.min(1, Math.max(0, (e - 300) / 100)); // 300..400 ms: pull down
            const up = Math.min(1, Math.max(0, (e - 850) / 100)); // dwell 450 ms, then push up
            ch[2] = 1 - 2 * down + 2 * up;
        };
        rig.for(3500); // up is where it rested at "let go": taken after THROTTLE_DOUBT_HOLD_MS, not 700 ms
        expect(rig.st.assigned.throttle).toBe(2);
        const a = (rig.wz as unknown as { assigned: Record<string, { invert: boolean }> }).assigned.throttle;
        expect(a.invert).toBe(false);
    });

    it('6. a thumb resting on a stick during "let go" does not end up in the centre', () => {
        const cfg = IDEAL();
        cfg.thumbRest = 0.12;
        cfg.seed = 3;
        const rig = new Rig(cfg);
        expect(rig.to('throttle', 'push')).toBe(true);
        const polluted = Math.max(Math.abs(rest(rig.wz)[0]), Math.abs(rest(rig.wz)[1]), Math.abs(rest(rig.wz)[3]));
        expect(polluted).toBeGreaterThan(0.08); // the case really happened: the centre step saw the thumb
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const p = rig.st.profile!;
        for (const fn of ['roll', 'pitch', 'yaw'] as const) expect(Math.abs(p.axes[fn].center)).toBeLessThan(0.03);
        expect(judge(cfg, p)).toEqual([]);
    });

    it('7. an arm switch flicked while stirring is a switch, never a stick candidate', () => {
        const rig = new Rig(IDEAL());
        rig.manual = (t, ch) => {
            const w = (t / 1000) * TWO_PI * 0.8;
            ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = Math.cos(1.3 * w);
            const flips = Math.min(4, Math.floor(t / 400)); // 4 flicks at 0.4, 0.8, 1.2, 1.6 s
            ch[4] = flips % 2 === 1 ? 1 : -1;
        };
        expect(rig.until((s) => s.id === 'centre', 20000)).toBe(true);
        expect(rig.st.channels[4].kind).toBe('switch');
        rig.manual = null;
        expect(rig.to('throttle', 'push')).toBe(true);
        expect(rig.wz.freeChannels()).toEqual([0, 1, 2, 3]);
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('8. a noisy pot and no arm switch: nothing is armed, the hint comes at 8 s, Skip gives the key', () => {
        const cfg = IDEAL();
        cfg.arm = 'none';
        cfg.aux[2] = 'potNearBin'; // CH8 sits next to a 0.25 step of the first wizard's switch bins
        cfg.auxValue[2] = -0.623;
        cfg.auxNoise[2] = 0.005;
        const rig = new Rig(cfg);
        expect(rig.to('arm', 'on')).toBe(true);
        const t0 = rig.t;
        const g = gaussOf(11);
        rig.manual = (_t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = 0; ch[5] = 0; ch[6] = 0; ch[7] = -0.623 + g() * 0.005; };
        let firstHint = -1;
        rig.for(20000, (s, t) => { if (s.hint && firstHint < 0) firstHint = t - t0; });
        expect(rig.st.id).toBe('arm');
        expect(rig.st.phase).toBe('on');
        expect(rig.st.armSource).toBeNull();
        expect(firstHint).toBeGreaterThanOrEqual(7900);
        expect(firstHint).toBeLessThanOrEqual(8100);
        expect(rig.st.hint?.key).toBe('wizard.hint.arm.none');
        rig.wz.skipArm();
        expect(rig.st.id).toBe('check');
        expect(rig.st.profile?.arm).toEqual({ kind: 'key' });
        expect(rig.st.armSource).toEqual({ kind: 'key' });
    });

    it('9. a momentary button (two taps) toggles; a latching one is a level', () => {
        const tap = new Rig(IDEAL());
        expect(tap.to('arm', 'on')).toBe(true);
        let t0 = tap.t;
        tap.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; const e = t - t0; return (e >= 300 && e < 450) || (e >= 800 && e < 950) ? 1 : 0; };
        expect(tap.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(tap.st.profile?.arm).toEqual({ kind: 'button', bit: 0, toggle: true });

        const latch = new Rig(IDEAL());
        expect(latch.to('arm', 'on')).toBe(true);
        t0 = latch.t;
        // flipped OFF after "Now flip it OFF" appears (~1.4 s); let go before that screen it is a
        // momentary button held long (see "a momentary button held 1 s" below)
        latch.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; const e = t - t0; return e >= 300 && e < 2000 ? 1 : 0; };
        expect(latch.until((s) => s.id === 'check', 5000)).toBe(true);
        expect(latch.st.profile?.arm).toEqual({ kind: 'button', bit: 0 });
    });

    it('10. no screen waits silently: a hint and a way out within 12 s', () => {
        const cases: { name: string; id: string; phase: string | null; script: (rig: Rig) => void }[] = [
            { name: 'stir, nothing moves', id: 'stir', phase: null, script: (r) => r.hold() },
            { name: 'centre, one stick keeps moving', id: 'centre', phase: null, script: (r) => { r.manual = (t, ch) => { ch[0] = 0.3 * Math.sin(TWO_PI * 2 * t / 1000); ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; }; } },
            { name: 'push, all sticks at rest', id: 'throttle', phase: 'push', script: (r) => r.hold() },
            { name: 'stick release, stick held at 90 %', id: 'yaw', phase: 'release', script: (r) => r.hold({ 3: 0.9 }) },
            { name: 'throttle release, throttle held up', id: 'throttle', phase: 'release', script: (r) => r.hold({ 2: 1 }) },
            { name: 'arm on, nothing moves', id: 'arm', phase: 'on', script: (r) => r.hold() },
            { name: 'arm off, switch held on', id: 'arm', phase: 'off', script: (r) => r.hold({ 4: 1 }) }
        ];
        const report: string[] = [];
        for (const c of cases) {
            const rig = new Rig(IDEAL());
            if (c.id === 'stir') rig.hold();
            else expect(rig.to(c.id, c.phase)).toBe(true);
            const t0 = c.id === 'stir' ? 0 : rig.t - rig.dt;
            c.script(rig);
            let hintAt = -1, escAt = -1, left = false;
            rig.for(15000, (s: WizardState, t) => {
                if (s.id !== c.id || s.phase !== c.phase) left = true;
                if (s.hint && hintAt < 0) hintAt = t - t0;
                if ((s.can.cont || s.can.useCurrent || s.can.pick || s.can.skipArm) && escAt < 0) escAt = t - t0;
            });
            report.push(`${c.name}: hint ${hintAt} ms (${rig.st.hint?.key}), escape ${escAt} ms, left ${left}`);
            expect(left, c.name).toBe(false);
            expect(hintAt, c.name).toBeGreaterThanOrEqual(0);
            expect(hintAt, c.name).toBeLessThanOrEqual(12000);
            expect(escAt, c.name).toBeGreaterThanOrEqual(0); // the stir screen too: Continue after 12 s
            expect(escAt, c.name).toBeLessThanOrEqual(12000);
        }
        // no frames at all: the connect screen says so after 3 s through tick()
        const w = new CalibrationWizard('k', 'n');
        w.start(0);
        expect(w.tick(2900).hint).toBeNull();
        expect(w.tick(3100).hint?.key).toBe('wizard.hint.noData');
        expect(report.length).toBe(cases.length);
    });

    it('11. Back redoes the previous step and undoes its capture', () => {
        const rig = new Rig(IDEAL());
        expect(rig.wz.back()).toBe(false); // on stir
        expect(rig.to('yaw', 'push')).toBe(true);
        expect(rig.st.assigned.throttle).toBe(2);
        expect(rig.wz.back()).toBe(true);
        expect([rig.st.id, rig.st.phase, rig.st.ok]).toEqual(['throttle', 'push', false]);
        expect(rig.st.assigned.throttle).toBeUndefined();
        // during the check-mark pause: the same screen again, its capture undone
        expect(rig.until((s) => s.id === 'yaw' && s.ok, 20000)).toBe(true);
        expect(rig.st.assigned.yaw).toBe(3);
        expect(rig.wz.back()).toBe(true);
        expect([rig.st.id, rig.st.phase, rig.st.ok]).toEqual(['yaw', 'push', false]);
        expect(rig.st.assigned.yaw).toBeUndefined();
        // and the wizard still finishes right
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('12. ArmLatch: the key toggles, a toggle button flips on the press edge only, reset turns it off', () => {
        const f = (b: number): RawFrame => ({ t: 0, axes: new Float32Array(8), buttons: b });
        const key = new ArmLatch();
        expect(key.level({ kind: 'key' }, null)).toBe(false);
        key.toggle();
        expect(key.level({ kind: 'key' }, null)).toBe(true);
        key.reset();
        expect(key.level({ kind: 'key' }, null)).toBe(false);
        const btn = new ArmLatch();
        const a = { kind: 'button' as const, bit: 2, toggle: true };
        const seq = [0, 4, 4, 4, 0, 0, 4, 0].map((b) => btn.level(a, f(b)));
        expect(seq).toEqual([false, true, true, true, true, true, false, false]);
        btn.level(a, f(4));
        expect(btn.on).toBe(true);
        btn.reset();
        expect(btn.level(a, f(4))).toBe(false); // still held: no new edge
        const lvl = new ArmLatch();
        expect(lvl.level({ kind: 'button', bit: 0 }, f(1))).toBe(true);
        expect(lvl.level({ kind: 'button', bit: 0, inverted: true }, f(1))).toBe(false);
        expect(armOn({ kind: 'key' }, f(1))).toBe(false);
    });

    it('13. mapFrame and ArmGate behave as in the first wizard for an axis-arm profile', () => {
        const r = mulberry32(99);
        const U = (a: number, b: number) => a + (b - a) * r();
        const outA = new Float32Array(8), outB = new Float32Array(8);
        for (let k = 0; k < 500; k++) {
            const ax = (index: number, c: number) => ({ index, invert: r() < 0.5, center: c, min: U(-1, -0.7), max: U(0.7, 1) });
            const p = { version: 1 as const, deviceKey: 'k', deviceName: 'n', deadband: r() < 0.5 ? 0 : 0.02, created: '', angleMode: null,
                axes: { roll: ax(0, U(-0.05, 0.05)), pitch: ax(1, U(-0.05, 0.05)), throttle: ax(2, -1), yaw: ax(3, U(-0.05, 0.05)) },
                arm: { kind: 'axis' as const, index: 4, threshold: U(-0.5, 0.5), onAbove: r() < 0.5 } };
            const f: RawFrame = { t: 0, axes: Float32Array.from({ length: 8 }, () => U(-1, 1)), buttons: 0 };
            mapFrame(p as Profile, f, outA);
            headMapFrame(p as HeadProfile, f, outB);
            expect(Array.from(outA)).toEqual(Array.from(outB));
        }
        // accept-fly B11: switch ON at load does not arm; a full off -> on does; mid throttle blocks
        for (const G of [ArmGate, HeadGate]) {
            const g = new G();
            const P = {} as Profile & HeadProfile;
            const ch = new Float32Array([0, 0, -1, 0, 1, -1, 0, 0]);
            let a = -1;
            for (let i = 0; i < 20; i++) a = Math.max(a, g.update(P, ch, 0, true, false));
            expect(a).toBeLessThan(0);
            ch[4] = -1; g.update(P, ch, 0, true, false);
            ch[4] = 1;
            expect(g.update(P, ch, 0, true, false)).toBeGreaterThan(0);
            const m = new G();
            const mid = new Float32Array([0, 0, 0, 0, -1, -1, 0, 0]);
            m.update(P, mid, 0, true, false);
            mid[4] = 1;
            expect(m.update(P, mid, 0, true, false)).toBeLessThan(0);
            expect(m.block).toBe('throttle');
        }
    });

    it('14. the judge can fail: swapped axes, an inverted throttle and a wrong arm channel are caught', () => {
        const cfg = IDEAL();
        const o = runNew(cfg, 60000);
        expect(o.kind).toBe('correct');
        const rig = new Rig(cfg);
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const good = rig.st.profile!;
        expect(judge(cfg, good)).toEqual([]);
        const clone = (): Profile => JSON.parse(JSON.stringify(good)) as Profile;
        const swapped = clone();
        [swapped.axes.roll, swapped.axes.pitch] = [swapped.axes.pitch, swapped.axes.roll];
        expect(judge(cfg, swapped).join()).toMatch(/roll on CH2/);
        const inv = clone();
        inv.axes.throttle.invert = !inv.axes.throttle.invert;
        expect(judge(cfg, inv).join()).toMatch(/throttle inverted wrong/);
        const arm6 = clone();
        arm6.arm = { kind: 'axis', index: 5, threshold: 0.5, onAbove: true };
        expect(judge(cfg, arm6).join()).toMatch(/arm should be CH5/);
        const off = clone();
        off.axes.yaw.center = 0.2;
        expect(judge(cfg, off).join()).toMatch(/yaw centre off/);
    });

    // rules added after the sweep found people they protect (each fails without its rule)
    it('a switch already ON, flipped OFF and straight back ON (too fast to settle OFF), is found', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('roll', 'release')).toBe(true);
        rig.hold({ 4: 1 }); // the arm switch was left ON while stirring
        expect(rig.to('arm', 'on', 5000)).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; const e = t - t0; ch[4] = e >= 400 && e < 480 ? -1 : 1; };
        expect(rig.until((s) => s.id === 'arm' && s.phase === 'off' && !s.ok, 4000)).toBe(true);
        expect(rig.st.armSource).toEqual({ kind: 'ch', n: 5 });
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.id === 'check', 3000)).toBe(true);
        const a = rig.st.profile!.arm!;
        const f = (v: number): RawFrame => ({ t: 0, axes: new Float32Array([0, 0, 0, 0, v, 0, 0, 0]), buttons: 0 });
        expect([armOn(a, f(quantize11(1))), armOn(a, f(-1)), armOn(a, f(0))]).toEqual([true, false, false]);
    });

    it('someone already still when "let go" appears lowers the throttle late: the screen waits for it', () => {
        const rig = new Rig(IDEAL());
        expect(rig.until((s) => s.id === 'stir' && s.ok, 20000)).toBe(true);
        rig.hold({ 2: 0 }); // sticks let go early, throttle in the middle
        expect(rig.to('centre', null, 2000)).toBe(true);
        const t0 = rig.t;
        // 1.5 s later they read "Leave the throttle all the way down" and pull it down
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; ch[2] = -Math.min(1, Math.max(0, (t - t0 - 1500) / 150)); };
        let doneAt = -1;
        rig.for(4000, (s, t) => { if (s.ok && doneAt < 0) doneAt = t - t0; });
        expect(doneAt).toBeGreaterThanOrEqual(1500 + TUNING.CENTRE_HOLD_MS); // still 800 ms after the late movement
        expect(rig.to('throttle', 'push', 2000)).toBe(true);
        rig.for(1500); // the lowering is over: nothing is taken
        expect(rig.st.assigned.throttle).toBeUndefined();
    });

    it('a movement already under way when the push screen appears is not taken as the push', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('centre')).toBe(true);
        rig.hold({ 2: 1 }); // the throttle rests up
        expect(rig.until((s) => s.id === 'centre' && s.ok, 5000)).toBe(true);
        const t0 = rig.t; // 500 ms before the throttle screen: start pulling it down slowly
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; ch[2] = 1 - 2 * Math.min(1, Math.max(0, (t - t0 - 300) / 600)); };
        expect(rig.to('throttle', 'push', 2000)).toBe(true);
        rig.for(2500);
        expect(rig.st.assigned.throttle).toBeUndefined();
    });

    it('a hint does not flicker: once shown it stays at least HINT_MIN_MS', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('yaw', 'release')).toBe(true);
        const t0 = rig.t;
        // held off centre, with a small jolt every 400 ms: "still moving" and "off centre" alternate
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[4] = -1; ch[3] = 0.9 - (Math.floor((t - t0) / 400) % 2) * 0.12; };
        const changes: number[] = [];
        let last: string | null = null;
        rig.for(14000, (s, t) => { const k = s.hint?.key ?? null; if (k !== last) { changes.push(t - t0); last = k; } });
        expect(changes.length).toBeGreaterThanOrEqual(2); // it does switch between the two texts
        for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1]).toBeGreaterThanOrEqual(TUNING.HINT_MIN_MS - 5);
    });

    it('a saved profile resumes at the check screen: live values, Reverse, no Back', () => {
        const rig = new Rig(IDEAL());
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const saved = JSON.parse(JSON.stringify(rig.st.profile)) as Profile;
        const w = CalibrationWizard.resume(saved);
        w.start(0);
        expect([w.state.id, w.state.step, w.state.can.back, w.state.can.fly]).toEqual(['check', 6, false, true]);
        const f: RawFrame = { t: 10, axes: new Float32Array([0, 0, quantize11(-1), 0, quantize11(1), 0, 0, 0]), buttons: 0 };
        const st = w.feed(f);
        expect(st.checks?.throttleLow).toBe(true);
        expect(st.checks?.armOn).toBe(true);
        expect(st.mapped.throttle).toBeCloseTo(-1, 2);
        w.reverse('throttle');
        expect(w.state.profile?.axes.throttle.invert).toBe(true);
        expect(w.feed({ ...f, t: 20 }).mapped.throttle).toBeCloseTo(1, 2);
        expect(w.back()).toBe(false);
    });

    // rules added after the adversarial fuzz of 2026-09-25 (.cache/v02/verify-fuzz); each fails without its rule
    const armFrame = (v: number): RawFrame => ({ t: 0, axes: new Float32Array([0, 0, 0, 0, v, 0, 0, 0]), buttons: 0 });
    const armRead = (p: Profile) => [-1, 0, 1].map((v) => armOn(p.arm, armFrame(v))); // OFF end, middle, ON end

    it('someone who stirs corner to corner and pauses in each corner gets four sticks; switches stay switches', () => {
        const rig = new Rig(IDEAL());
        // fuzz andrii:42: about 880 ms in each corner, 140 ms from one corner to the next
        const C = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
        const dwell = 880, transit = 140, seg = dwell + transit;
        const at = (t: number): [number, number] => {
            const x = t % (4 * seg), k = Math.floor(x / seg), w = x - k * seg, a = C[k], b = C[(k + 1) % 4];
            if (w < dwell) return [a[0], a[1]];
            const f = (w - dwell) / transit;
            return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        };
        const r = mulberry32(5);
        let mid = NaN;
        rig.manual = (t, ch) => {
            const [lx, ly] = at(t), [rx, ry] = at(t + 2 * seg);
            ch[0] = rx; ch[1] = ry; ch[2] = ly; ch[3] = lx;
            // CH5: a 2-position switch flicked 10 times, each flick caught once half way (a slow
            // report); CH6: a 3-position switch that rests 50 ms in its middle on every pass
            const k5 = Math.floor(t / 700);
            const edge5 = k5 >= 1 && k5 <= 10 && t - k5 * 700 < rig.dt;
            if (edge5 && Number.isNaN(mid)) mid = r() * 2 - 1;
            if (!edge5) mid = NaN;
            ch[4] = edge5 ? mid : k5 % 2 === 1 && k5 <= 10 ? 1 : -1;
            ch[5] = t % 600 < 50 ? 0 : Math.floor(t / 600) % 2 ? -1 : 1;
        };
        expect(rig.until((s) => s.id === 'centre', 20000)).toBe(true);
        expect(rig.st.channels.slice(0, 6).map((c) => c.kind)).toEqual(['stick', 'stick', 'stick', 'stick', 'switch', 'switch']);
        rig.manual = null;
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('sticks that move but not like sticks yet: the stir hint does not blame USB mode', () => {
        // all four jump corner to corner in one frame (no sweep yet): "move both sticks all the way"
        const jump = new Rig(IDEAL());
        jump.manual = (t, ch) => { const k = Math.floor(t / 500) % 4; ch[0] = k < 2 ? 1 : -1; ch[1] = k % 2 ? 1 : -1; ch[2] = k % 3 ? 1 : -1; ch[3] = k === 1 ? 1 : -1; ch[4] = -1; };
        jump.for(13000);
        expect([jump.st.id, jump.st.hint?.key]).toEqual(['stir', 'wizard.needFourAxes']);
        // three sticks stirred, CH4 swept only to 40 %: say which one and how far
        const part = new Rig(IDEAL());
        part.manual = (t, ch) => { const w = (t / 1000) * TWO_PI; ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = 0.4 * Math.cos(1.3 * w); ch[4] = -1; };
        part.for(13000);
        expect([part.st.id, part.st.hint?.key, part.st.hint?.params.ch]).toEqual(['stir', 'wizard.hint.stir.coverage', 4]);
        expect(part.st.hint?.params.pct).toBeGreaterThanOrEqual(39);
        expect(part.st.hint?.params.pct).toBeLessThanOrEqual(41);
    });

    it('a pad that reports only changes: the still screens finish on tick(), no escape needed, centres right', () => {
        const cfg = IDEAL();
        cfg.noise = 0;
        cfg.trim = { A: 0.021, E: -0.013, R: 0.017 };
        const rig = new Rig(cfg, { sparse: true });
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(rig.skipped).toBeGreaterThan(1000); // the case really happened: long stretches without frames
        expect(rig.human.escapes).toEqual(['fly']); // nobody had to press "Use the current position"
        expect(judge(cfg, rig.st.profile!)).toEqual([]);
    });

    it('"Use the current position" on a sparse pad takes the value the stick holds, not a stale average', () => {
        const rig = new Rig(IDEAL(), { sparse: true });
        expect(rig.until((s) => s.id === 'stir' && s.ok, 20000)).toBe(true);
        rig.hold();
        expect(rig.to('centre', null, 2000)).toBe(true);
        rig.hold({ 3: 0.9 }); // one frame: yaw jumps to 0.9 and stays (then no frames at all)
        let hintCh: unknown = null;
        rig.for(10500, (s) => { if (s.hint && hintCh === null) hintCh = s.hint.params.ch; });
        expect([rig.st.id, rig.st.ok, rig.st.can.useCurrent]).toEqual(['centre', false, true]); // held at its end: not let go
        expect(hintCh).toBe(4);
        rig.wz.useCurrent();
        expect(rest(rig.wz)[3]).toBeCloseTo(quantize11(0.9), 3);
    });

    it('a stick still held at its end when "let go" appears is not its centre, and it cannot pass "let go" there', () => {
        const rig = new Rig(IDEAL());
        expect(rig.until((s) => s.id === 'stir' && s.ok, 20000)).toBe(true);
        rig.hold({ 0: 1, 1: 1 }); // a slow reader: the right stick still paused in a corner, throttle down
        expect(rig.to('centre', null, 2000)).toBe(true);
        rig.for(7000);
        expect([rig.st.id, rig.st.ok, rig.st.hold, rig.st.hint?.key]).toEqual(['centre', false, 0, 'wizard.hint.centre.moving']);
        expect([1, 2]).toContain(rig.st.hint?.params.ch);
        rig.hold({ 0: 0.02, 1: -0.01 }); // now they let go
        expect(rig.until((s) => s.ok, 3000)).toBe(true);
        expect(rest(rig.wz)[0]).toBeCloseTo(0.02, 2);
        expect(rest(rig.wz)[1]).toBeCloseTo(-0.01, 2);

        // a rest that is an end anyway (pressed "Use the current position" while held there):
        // the stick held at that end must not pass its "let go" screen
        const r2 = new Rig(IDEAL());
        expect(r2.until((s) => s.id === 'stir' && s.ok, 20000)).toBe(true);
        r2.hold({ 0: 1 });
        expect(r2.until((s) => s.id === 'centre' && s.can.useCurrent, 13000)).toBe(true);
        r2.wz.useCurrent();
        expect(rest(r2.wz)[0]).toBeGreaterThan(0.99);
        r2.manual = null;
        expect(r2.to('roll', 'release')).toBe(true);
        r2.hold({ 0: 1 });
        r2.for(2000);
        expect([r2.st.id, r2.st.phase, r2.st.ok]).toEqual(['roll', 'release', false]);
        r2.hold({ 0: 0.01 });
        expect(r2.until((s) => s.ok, 2000)).toBe(true);
        expect((r2.wz as unknown as { assigned: Record<string, { center: number }> }).assigned.roll.center).toBeCloseTo(0.01, 2);
    });

    it('one glitch sample on a pot does not become the arm switch', () => {
        const cfg = IDEAL();
        cfg.arm = 'none';
        const rig = new Rig(cfg);
        expect(rig.to('arm', 'on')).toBe(true);
        const t0 = rig.t;
        // fuzz potEdge:19: a pot resting at 0.071 jumps to 0.6 for one report (2 ms) and back
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = 0; ch[6] = 0; ch[7] = 0; ch[5] = t - t0 >= 1000 && t - t0 < 1000 + rig.dt ? 0.6 : 0.071; };
        rig.for(4000);
        expect([rig.st.id, rig.st.phase, rig.st.armSource]).toEqual(['arm', 'on', null]);
    });

    it('a switch that was ON: a long OFF pause then back ON is swapped back when it reads ON at the check', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('roll', 'release')).toBe(true);
        rig.hold({ 4: 1 }); // left ON after the stir
        expect(rig.to('arm', 'on', 5000)).toBe(true);
        const t0 = rig.t;
        // fuzz armStartsOn:127: OFF held 800 ms (taken as ON), back ON 300 ms after "Now flip it OFF"
        // appeared (taken as OFF), then they do what that screen says. (Back ON during the check
        // mark or within ARM_REACT_MS is caught earlier, on the OFF screen: see "cycled OFF and back ON".)
        let offShown = -1;
        rig.manual = (t, ch) => {
            ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0;
            if (offShown < 0 && rig.st.id === 'arm' && rig.st.phase === 'off' && !rig.st.ok) offShown = t;
            ch[4] = t - t0 < 300 ? 1 : offShown < 0 || t < offShown + 300 ? -1 : t < offShown + 900 ? 1 : -1;
        };
        expect(rig.until((s) => s.id === 'check', 5000)).toBe(true);
        expect(rig.t - (offShown + 900)).toBeGreaterThan(0); // the OFF flip landed before the check opened
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);
        rig.for(300);
        expect(rig.st.checks?.armOn).toBe(false); // switch OFF now: the check shows DISARMED
    });

    it('Reverse on the arm line keeps the middle of a 3-position switch OFF and swaps the ends', () => {
        const rig = new Rig(IDEAL());
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const saved = JSON.parse(JSON.stringify(rig.st.profile)) as Profile; // as stored: the levels survive JSON
        expect(saved.arm).toMatchObject({ kind: 'axis', index: 4, onAbove: true });
        expect(armRead(saved)).toEqual([false, false, true]);
        const w = CalibrationWizard.resume(saved);
        w.reverse('arm');
        expect(armRead(w.state.profile!)).toEqual([true, false, false]);
        w.reverse('arm');
        expect(armRead(w.state.profile!)).toEqual([false, false, true]);
        expect((w.state.profile!.arm as { threshold: number }).threshold).toBeCloseTo((saved.arm as { threshold: number }).threshold, 9);
        // an older profile without the levels has a midpoint threshold: a plain flip
        const old = { ...saved, arm: { kind: 'axis' as const, index: 4, threshold: 0, onAbove: true } };
        const w2 = CalibrationWizard.resume(old);
        w2.reverse('arm');
        expect(w2.state.profile!.arm).toEqual({ kind: 'axis', index: 4, threshold: 0, onAbove: false });
    });

    // rules added after the fuzz recheck of 2026-09-25 evening (.cache/v02/polish); each fails without its rule
    const assignedOf = (rig: Rig) => (rig.wz as unknown as { assigned: Record<string, { invert: boolean; center: number }> }).assigned;
    const script = (rig: Rig, thr: (e: number) => number) => {
        const t0 = rig.t;
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; ch[2] = thr(t - t0); };
    };

    it('an impatient pilot who pushes the throttle up for a moment and rests back at the bottom is not taken as inverted', () => {
        // fuzz impatient:25 (rests at the bottom), impatient:122 (rested half way), and the same on a
        // radio whose throttle reads +1 at the bottom: up 0.4 s, back at the bottom 0.9 s, again and
        // again (100 ms ramps: a stick passes its middle)
        const loop = (bottom: number) => (e: number) => {
            const x = e % 1300;
            const up = x < 200 ? 0 : x < 300 ? (x - 200) / 100 : x < 600 ? 1 : x < 700 ? 1 - (x - 600) / 100 : 0;
            return bottom * (1 - 2 * up);
        };
        for (const [restAt, bottom] of [[-1, -1], [0, -1], [1, 1]]) {
            const rig = new Rig(IDEAL());
            expect(rig.to('centre')).toBe(true);
            rig.hold({ 2: restAt });
            expect(rig.to('throttle', 'push', 5000)).toBe(true);
            script(rig, loop(bottom));
            rig.for(8000);
            expect(rig.st.assigned.throttle, `rest ${restAt}`).toBeUndefined();
            rig.hold({ 2: -bottom }); // now held up on purpose
            rig.for(2500);
            expect(rig.st.assigned.throttle, `rest ${restAt}`).toBe(2);
            expect(assignedOf(rig).throttle.invert, `rest ${restAt}`).toBe(bottom > 0);
        }
    });

    it('"Continue anyway" on "Throttle all the way down" while the throttle still reads full: that is down, it flips', () => {
        const run = (atCont: number) => {
            const rig = new Rig(IDEAL());
            expect(rig.to('centre')).toBe(true);
            rig.hold({ 2: 0 });
            expect(rig.to('throttle', 'push', 5000)).toBe(true);
            rig.hold({ 2: -1 }); // held at the bottom for 2 s: the only end left, taken as "up"
            expect(rig.to('throttle', 'release', 4000)).toBe(true);
            expect(assignedOf(rig).throttle.invert).toBe(true);
            rig.hold({ 2: atCont }); // for this pilot it IS down, so it stays there
            expect(rig.until((s) => s.can.cont, 10000)).toBe(true);
            rig.wz.cont();
            return assignedOf(rig).throttle;
        };
        const flipped = run(-1);
        expect(flipped.invert).toBe(false);
        expect(flipped.center).toBeCloseTo(-1, 2);
        expect(run(0).invert).toBe(true); // half way says nothing either way: kept
    });

    it('only one stick stirred: Continue after 12 s, and the stick steps still find all four with both halves of each range', () => {
        // fuzz slow:13 / slow:129: stirs the left stick only; the right one was bumped to 28 % once.
        // Roll and pitch read negative when pushed right / up, i.e. towards the side never seen.
        const cfg = idealHuman('AETR', invSet(3));
        const rig = new Rig(cfg);
        rig.manual = (t, ch) => { const w = (t / 1000) * TWO_PI; const bump = t >= 2000 && t < 2300 ? 0.28 : 0; ch[0] = bump; ch[1] = bump; ch[2] = Math.sin(w); ch[3] = Math.cos(w); ch[4] = -1; };
        let contAt = -1;
        rig.for(13000, (s, t) => { if (s.can.cont && contAt < 0) contAt = t; });
        expect([rig.st.id, rig.st.hint?.key]).toEqual(['stir', 'wizard.hint.stir.few']);
        expect(contAt).toBeGreaterThanOrEqual(11900);
        expect(contAt).toBeLessThanOrEqual(12100);
        rig.wz.cont();
        rig.manual = null;
        expect(rig.until(() => rig.flew, 90000)).toBe(true);
        expect(rig.human.escapes.filter((e) => e !== 'fly' && e !== 'cont')).toEqual([]); // no pick, no "use current"
        const p = rig.st.profile!;
        expect(judge(cfg, p)).toEqual([]);
        for (const fn of ['roll', 'pitch'] as const) {
            expect(p.axes[fn].max - p.axes[fn].center, fn).toBeGreaterThan(0.9);
            expect(p.axes[fn].center - p.axes[fn].min, fn).toBeGreaterThan(0.9); // the side never visited is mirrored
        }
    });

    it('after "Continue anyway" with one stick stirred, that stick still held in a corner is not its centre', () => {
        // the "held at its end" rule counts only stirred channels: an unstirred one's little range
        // (CH1/CH2 bumped to 28 % once) says nothing about its ends and must not dilute the count
        const rig = new Rig(IDEAL());
        rig.manual = (t, ch) => { const w = (t / 1000) * TWO_PI; const bump = t >= 2000 && t < 2300 ? 0.28 : 0; ch[0] = bump; ch[1] = bump; ch[2] = Math.sin(w); ch[3] = Math.cos(w); ch[4] = -1; };
        expect(rig.until((s) => s.can.cont, 13000)).toBe(true);
        rig.wz.cont();
        rig.hold({ 2: 1, 3: 1 }); // a slow reader: the left stick still in its top-right corner
        expect(rig.to('centre', null, 2000)).toBe(true);
        rig.for(4000);
        expect([rig.st.id, rig.st.ok, rig.st.hold]).toEqual(['centre', false, 0]);
        rig.hold({ 2: -1, 3: 0.01 }); // now let go: throttle down, yaw back in the middle
        expect(rig.until((s) => s.ok, 3000)).toBe(true);
        expect(rest(rig.wz)[3]).toBeCloseTo(0.01, 2);
    });

    it('a momentary button held 1 s on "Flip ON" and let go before "Now flip it OFF" appears is a toggle, not a level', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('arm', 'on')).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; const e = t - t0; return e >= 300 && e < 1300 ? 1 : 0; };
        expect(rig.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(rig.st.profile?.arm).toEqual({ kind: 'button', bit: 0, toggle: true });
    });

    it('a switch that was ON, cycled OFF and back ON before "Now flip it OFF" appeared: the next move decides', () => {
        // axis, fuzz armStartsOn:128: OFF held 800 ms (taken as ON), back ON during the check mark
        const ax = new Rig(IDEAL());
        expect(ax.to('roll', 'release')).toBe(true);
        ax.hold({ 4: 1 });
        expect(ax.to('arm', 'on', 5000)).toBe(true);
        const t0 = ax.t;
        ax.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; const e = t - t0; ch[4] = e < 300 ? 1 : e < 1100 ? -1 : 1; };
        expect(ax.to('arm', 'off', 3000)).toBe(true);
        ax.for(3000);
        expect([ax.st.id, ax.st.phase, ax.st.hold]).toEqual(['arm', 'off', 0]); // back at "OFF" before the screen: no answer yet
        ax.hold({ 4: -1 }); // now they do what the screen says
        expect(ax.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(armRead(ax.st.profile!)).toEqual([false, false, true]);
        // a latching button already pressed: let go 800 ms (taken as ON), pressed again during the check mark
        const bt = new Rig(IDEAL());
        expect(bt.to('roll', 'release')).toBe(true);
        bt.hold({}, 1);
        expect(bt.to('arm', 'on', 5000)).toBe(true);
        const t1 = bt.t;
        bt.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; const e = t - t1; return e < 300 ? 1 : e < 1100 ? 0 : 1; };
        expect(bt.to('arm', 'off', 3000)).toBe(true);
        bt.for(3000);
        expect([bt.st.id, bt.st.phase]).toEqual(['arm', 'off']);
        bt.hold({}, 0);
        expect(bt.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(bt.st.profile?.arm).toEqual({ kind: 'button', bit: 0 });
    });

    it('a 3-position switch paused in its middle on the way to ON: the far end is ON, the middle reads OFF', () => {
        const rig = new Rig(IDEAL());
        expect(rig.to('arm', 'on')).toBe(true);
        const t0 = rig.t;
        let offShown = -1;
        // fuzz arm3:116: 900 ms in the middle detent (taken as ON), on to the far end during the check
        // mark; back OFF through the middle once "Now flip it OFF" shows
        rig.manual = (t, ch) => {
            ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0;
            if (offShown < 0 && rig.st.id === 'arm' && rig.st.phase === 'off' && !rig.st.ok) offShown = t;
            const e = t - t0;
            ch[4] = e < 300 ? -1 : e < 1200 ? 0 : offShown < 0 || t < offShown + 500 ? 1 : t < offShown + 560 ? 0 : -1;
        };
        expect(rig.until((s) => s.id === 'check', 5000)).toBe(true);
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);
    });

    // round 2 of the recheck (2026-09-26, .cache/v02/polish): each fails without its rule
    it('"Throttle all the way down" is not confirmed by a movement that began before the screen', () => {
        // fuzz slow:7: the throttle was left up at "let go"; pulled down first and rested there 2 s
        // (taken as "up", the wrong way round), then pushed up in one slow movement that went on
        // into the "down" screen. Its top now reads "down": that must not confirm the inversion.
        const rig = new Rig(IDEAL());
        expect(rig.to('centre')).toBe(true);
        rig.hold({ 2: 1 });
        expect(rig.to('throttle', 'push', 5000)).toBe(true);
        script(rig, (e) => 1 - 2 * Math.min(1, e / 300)); // pulled down, and rests there
        expect(rig.until((s) => s.ok, 4000)).toBe(true);
        expect(assignedOf(rig).throttle.invert).toBe(true); // the case really happened
        // during the check mark: up in 2.4 s (as slowly as in slow:7: under 0.1 per 100 ms), 1.2 s at
        // the top, then down for good
        const t0 = rig.t;
        script(rig, (e) => (e < 100 ? -1 : e < 2500 ? -1 + (2 * (e - 100)) / 2400 : e < 3700 ? 1 : -1));
        let left = false;
        rig.for(4000, (s) => { if (s.id !== 'throttle' || (s.phase === 'release' && s.ok)) left = true; });
        expect(left).toBe(false);
        expect(rig.until((s) => s.can.cont, 9000)).toBe(true); // it reads "up" at the bottom: hint, then Continue
        expect(rig.st.hint?.key).toBe('wizard.hint.throttle.down');
        rig.wz.cont();
        expect(assignedOf(rig).throttle.invert).toBe(false);
        expect(rig.t - t0).toBeLessThan(12000);
        // controls: held up (still) when the screen shows, then pulled down, is taken in THR_DOWN_HOLD_MS;
        // already down when it shows, in THR_LATE_MS
        for (const [atShow, want] of [[1, TUNING.THR_DOWN_HOLD_MS], [-1, TUNING.THR_LATE_MS]]) {
            const r = new Rig(IDEAL());
            expect(r.to('throttle', 'push')).toBe(true);
            script(r, (e) => -1 + 2 * Math.min(1, e / 200)); // pushed up and held there
            expect(r.until((s) => s.ok, 3000)).toBe(true);
            r.hold({ 2: atShow });
            expect(r.to('throttle', 'release', 2000)).toBe(true);
            const shown = r.t;
            if (atShow > 0) { r.for(600); r.hold({ 2: -1 }); }
            const down = atShow > 0 ? r.t : shown;
            expect(r.until((s) => s.ok, 4000)).toBe(true);
            expect(r.t - down, `at ${atShow}`).toBeGreaterThanOrEqual(want - 5);
            expect(r.t - down, `at ${atShow}`).toBeLessThan(want + 150);
        }
    });

    it('back at OFF within ARM_REACT_MS of "Now flip it OFF" is not an answer: the next move decides', () => {
        // fuzz armStartsOn:134: the switch was ON; OFF held until the OFF screen (taken as ON), back ON
        // 150 ms after that screen appeared (their own cycle, too soon to be a reaction), then flipped OFF
        const cycle = (offAt: number) => {
            const rig = new Rig(IDEAL());
            expect(rig.to('roll', 'release')).toBe(true);
            rig.hold({ 4: 1 });
            expect(rig.to('arm', 'on', 5000)).toBe(true);
            const t0 = rig.t;
            let offShown = -1;
            rig.manual = (t, ch) => {
                ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0;
                if (offShown < 0 && rig.st.id === 'arm' && rig.st.phase === 'off' && !rig.st.ok) offShown = t;
                ch[4] = t - t0 < 300 ? 1 : offShown < 0 || t < offShown + 150 ? -1 : t < offShown + offAt ? 1 : -1;
            };
            expect(rig.until((s) => s.id === 'check', 6000)).toBe(true);
            return [rig.t - offShown, armRead(rig.st.profile!)] as const;
        };
        const [ms, read] = cycle(1200);
        expect(ms).toBeGreaterThan(1200); // it waited for their real OFF flip
        expect(read).toEqual([false, false, true]);
        // nothing moves after that (a robot answering at once): the levels stand after ARM_SOON_WAIT_MS
        const [ms2, read2] = cycle(60000);
        expect(ms2).toBeGreaterThanOrEqual(TUNING.ARM_SOON_WAIT_MS);
        expect(ms2).toBeLessThan(TUNING.ARM_SOON_WAIT_MS + TUNING.OK_MS + 100);
        expect(read2).toEqual([true, false, false]); // as taken: the level held on "Flip ON" arms
        // a momentary button pressed long and let go 120 ms after the OFF screen appeared: a toggle
        const bt = new Rig(IDEAL());
        expect(bt.to('arm', 'on')).toBe(true);
        let shown = -1;
        bt.manual = (t, ch) => {
            ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1;
            if (shown < 0 && bt.st.id === 'arm' && bt.st.phase === 'off' && !bt.st.ok) shown = t;
            return shown < 0 || t < shown + 120 ? 1 : 0;
        };
        expect(bt.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(bt.st.profile?.arm).toEqual({ kind: 'button', bit: 0, toggle: true });
    });

    it('a 3-position far end seen before Back does not carry over to the next try', () => {
        // try 1 flips to the far end; Back from the check; try 2 holds the middle as ON (a
        // switch whose middle is ON): the middle must read ON, not the far end of try 1
        const rig = new Rig(IDEAL());
        expect(rig.to('arm', 'on')).toBe(true);
        rig.hold({ 4: 1 });
        expect(rig.to('arm', 'off', 3000)).toBe(true);
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);
        expect(rig.wz.back()).toBe(true);
        expect([rig.st.id, rig.st.phase]).toEqual(['arm', 'on']);
        rig.for(300);
        rig.hold({ 4: 0 });
        expect(rig.to('arm', 'off', 3000)).toBe(true);
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.id === 'check', 3000)).toBe(true);
        expect(armRead(rig.st.profile!)).toEqual([false, true, true]);
    });
});
