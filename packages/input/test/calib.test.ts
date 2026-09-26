// Calibration wizard v3 (user-paced): rule by rule, each with a scripted input, plus the ideal
// person as the positive control. The random people and the negative controls live in
// human.test.ts, fuzz*.test.ts and paced.test.ts. Every Rig records its screen changes: a change
// without a button press (other than the three frame changes) fails the test that made it.

import { afterEach, describe, expect, it } from 'vitest';
import { ArmGate, ArmLatch, CalibrationWizard, mapFrame, armOn, TUNING } from '../src/calib';
import type { ArmMap, Profile, RawFrame, WizardState } from '../src/calib';
import { ArmGate as HeadGate, mapFrame as headMapFrame } from './fixtures/calib-head';
import type { Profile as HeadProfile } from './fixtures/calib-head';
import { idealHuman, judge, quantize11 } from '../src/sim/human';
import type { UiAction } from '../src/sim/human';
import { mulberry32 } from '../src/sim/signals';
import { allOrders, gridHuman, invSet, invText, Rig, runNew, V2Rig, v3FrameChange, Watch } from './helpers';

const IDEAL = () => idealHuman('AETR', invSet(0)); // CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 arm
type Priv = { rest: Float64Array; assigned: Record<string, { invert: boolean; center: number; index: number }>; armMap: ArmMap | null; stickSet: number[]; results: Record<string, unknown>; pushEnd: Record<string, number> };
const priv = (w: CalibrationWizard) => w as unknown as Priv;
const rest = (w: CalibrationWizard) => priv(w).rest;
const assignedOf = (rig: Rig) => priv(rig.wz).assigned;
const TWO_PI = 2 * Math.PI;
const key = (s: WizardState) => (s.stage ? `${s.id}/${s.stage}` : s.id);
const armFrame = (v: number): RawFrame => ({ t: 0, axes: new Float32Array([0, 0, 0, 0, v, 0, 0, 0]), buttons: 0 });
const armRead = (p: Profile) => [-1, 0, 1].map((v) => armOn(p.arm, armFrame(v))); // OFF end, middle, ON end

function gaussOf(seed: number): () => number {
    const r = mulberry32(seed);
    return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(TWO_PI * r());
}

// every rig of a test is checked for screen changes without a button (I1)
const rigs: Rig[] = [];
function rigOf(...a: ConstructorParameters<typeof Rig>): Rig { const r = new Rig(...a); rigs.push(r); return r; }
afterEach(() => {
    const v = rigs.flatMap((r) => r.watch.violations);
    rigs.length = 0;
    expect(v).toEqual([]);
});

/** Press and expect a refusal with this hint key; returns the hint params. */
function refused(rig: Rig, a: UiAction, hintKey: string): Record<string, string | number> {
    const v = rig.press(a);
    expect(v.ok, `${a.kind} should be refused with ${hintKey}`).toBe(false);
    if (v.ok) return {};
    expect(v.hint.key).toBe(hintKey);
    return v.hint.params;
}

function accepted(rig: Rig, a: UiAction): void {
    const v = rig.press(a);
    expect(v.ok, `${a.kind} refused: ${v.ok ? '' : `${v.hint.key} ${JSON.stringify(v.hint.params)}`}`).toBe(true);
}

describe('calibration wizard v3 (user-paced)', () => {
    it('1. the ideal person gets every channel order and inversion right (384 runs, each < 40 s, only button-made screen changes)', () => {
        let ok = 0, worst = 0;
        const bad: string[] = [];
        for (const order of allOrders()) for (let k = 0; k < 16; k++) {
            const cfg = idealHuman(order, invSet(k));
            const w = new Watch(v3FrameChange);
            const o = runNew(cfg, 60000, w);
            worst = Math.max(worst, o.ms);
            if (o.kind === 'correct' && o.ms < 40000 && w.violations.length === 0) ok++;
            else bad.push(`${order}/${invText(cfg.inv)}: ${o.kind} ${o.where} ${o.problems.join('; ')} ${w.violations.join('; ')}`);
        }
        expect(bad).toEqual([]);
        expect(ok).toBe(384);
        expect(worst).toBeLessThan(40000);
    });

    it('2. the centre is measured only on Measure with the sticks still, and it is the true rest', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('centre', 'active')).toBe(true);
        rig.manual = (t, ch) => {
            const w = (t / 1000) * TWO_PI;
            ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = Math.cos(1.3 * w); ch[4] = -1;
        };
        rig.for(1000);
        refused(rig, { kind: 'next' }, 'wizard.hint.centre.moving'); // Measure while stirring
        const trueRest = [0.021, -0.013, -1, 0.017];
        rig.hold({ 0: trueRest[0], 1: trueRest[1], 2: -1, 3: trueRest[3] });
        rig.for(10000); // still for 10 s, nobody presses: nothing happens
        expect(key(rig.st)).toBe('centre/active');
        accepted(rig, { kind: 'next' });
        expect(key(rig.st)).toBe('centre/done');
        for (const i of [0, 1, 3]) expect(Math.abs(rest(rig.wz)[i] - trueRest[i])).toBeLessThan(0.02);
        expect(rig.st.result).toMatchObject({ kind: 'centre', end: 2 });
    });

    it('3. two sticks pushed at once assign nothing and say so at once', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('yaw', 'active')).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => {
            const k = Math.min(1, (t - t0) / 200) * 0.8;
            ch[0] = k; ch[1] = 0; ch[2] = -1; ch[3] = k; ch[4] = -1;
        };
        let assigned = false, twoAt = -1;
        rig.for(6000, (s, t) => {
            if (s.assigned.yaw !== undefined || s.id !== 'yaw') assigned = true;
            if (twoAt < 0 && s.gauge?.zone === 'two') twoAt = t - t0;
        });
        expect(assigned).toBe(false);
        expect(twoAt).toBeGreaterThanOrEqual(0);
        expect(twoAt).toBeLessThan(200);
        expect(rig.st.hint?.key).toBe('wizard.hint.push.two');
        expect(rig.st.hint?.params).toMatchObject({ a: 1, b: 4 });
    });

    it('4. Start is refused while the stick of the step is held; let go, Start, push: taken', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('yaw', 'ready')).toBe(true);
        rig.hold({ 3: 0.9 }); // yaw parked at 90 % before Start
        rig.for(1000);
        expect(refused(rig, { kind: 'begin' }, 'wizard.hint.begin.held')).toMatchObject({ ch: 4 });
        rig.hold();
        rig.for(1000);
        accepted(rig, { kind: 'begin' });
        rig.hold({ 3: 0.9 });
        rig.for(600);
        expect(rig.st.assigned.yaw).toBe(3);
        expect(key(rig.st)).toBe('yaw/done');
    });

    it('5. throttle up at Start, pulled down and held: taken the wrong way round, caught on its result, fixed with Reverse', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('throttle', 'ready')).toBe(true);
        rig.hold({ 2: 1 }); // "all the way down, then Start" ignored: the throttle is up
        rig.for(1000);
        accepted(rig, { kind: 'begin' });
        rig.hold({ 2: -1 }); // pulled down and held there
        rig.for(600);
        expect(key(rig.st)).toBe('throttle/done');
        expect(assignedOf(rig).throttle.invert).toBe(true);
        rig.for(200);
        expect(rig.st.mapped.throttle).toBeCloseTo(1, 2); // the bar reads full with the stick down: visible
        expect(refused(rig, { kind: 'next' }, 'wizard.hint.next.thrDown')).toMatchObject({ pct: 100 });
        rig.press({ kind: 'reverse', what: 'throttle' });
        expect(assignedOf(rig).throttle.invert).toBe(false);
        accepted(rig, { kind: 'next' });
        rig.manual = null;
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);

        // pulled down for 300 ms and back up: nothing taken, and the hint says to hold
        const r2 = rigOf(IDEAL());
        expect(r2.to('throttle', 'ready')).toBe(true);
        r2.hold({ 2: 1 });
        r2.for(1000);
        accepted(r2, { kind: 'begin' });
        const t0 = r2.t;
        r2.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; const e = t - t0; ch[2] = e < 300 ? -1 : 1; };
        r2.for(2000);
        expect(key(r2.st)).toBe('throttle/active');
        expect(r2.st.assigned.throttle).toBeUndefined();
        expect(r2.st.hint?.key).toBe('wizard.hint.push.hold');
    });

    it('6. a thumb resting on a stick during "let go" does not end up in the centre', () => {
        const cfg = IDEAL();
        cfg.thumbRest = 0.12;
        cfg.seed = 3;
        const rig = rigOf(cfg);
        expect(rig.to('throttle', 'ready')).toBe(true);
        const polluted = Math.max(Math.abs(rest(rig.wz)[0]), Math.abs(rest(rig.wz)[1]), Math.abs(rest(rig.wz)[3]));
        expect(polluted).toBeGreaterThan(0.08); // the case really happened: the centre step saw the thumb
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const p = rig.st.profile!;
        for (const fn of ['roll', 'pitch', 'yaw'] as const) expect(Math.abs(p.axes[fn].center)).toBeLessThan(0.03);
        expect(judge(cfg, p)).toEqual([]);
    });

    it('7. an arm switch flicked while stirring is a switch, never a stick candidate', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('stir', 'active')).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => {
            const w = ((t - t0) / 1000) * TWO_PI * 0.8;
            ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = Math.cos(1.3 * w);
            const flips = Math.min(4, Math.floor((t - t0) / 400)); // 4 flicks at 0.4, 0.8, 1.2, 1.6 s
            ch[4] = flips % 2 === 1 ? 1 : -1;
        };
        expect(rig.until((s) => s.can.next, 20000)).toBe(true);
        rig.for(1500);
        accepted(rig, { kind: 'next' });
        expect(rig.st.channels[4].kind).toBe('switch');
        expect(rig.st.result).toMatchObject({ kind: 'stir', sticks: [0, 1, 2, 3], switches: [4] });
        rig.manual = null;
        expect(rig.to('throttle', 'ready')).toBe(true);
        expect(rig.wz.freeChannels()).toEqual([0, 1, 2, 3]);
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('8. a noisy pot and no arm switch: nothing is armed, the hint comes at 8 s, Skip gives the key', () => {
        const cfg = IDEAL();
        cfg.arm = 'none';
        cfg.aux[2] = 'potNearBin';
        cfg.auxValue[2] = -0.623;
        cfg.auxNoise[2] = 0.005;
        const rig = rigOf(cfg);
        expect(rig.to('arm', 'active')).toBe(true);
        const t0 = rig.t;
        const g = gaussOf(11);
        rig.manual = (_t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = 0; ch[5] = 0; ch[6] = 0; ch[7] = -0.623 + g() * 0.005; };
        let firstHint = -1;
        rig.for(20000, (s, t) => { if (s.hint && firstHint < 0) firstHint = t - t0; });
        expect(key(rig.st)).toBe('arm/active');
        expect(rig.st.armSource).toBeNull();
        expect(firstHint).toBeGreaterThanOrEqual(7900);
        expect(firstHint).toBeLessThanOrEqual(8100);
        expect(rig.st.hint?.key).toBe('wizard.hint.arm.none');
        accepted(rig, { kind: 'skipArm' });
        expect(key(rig.st)).toBe('arm/done');
        expect(rig.st.result).toEqual({ kind: 'arm', source: { kind: 'key' } });
        accepted(rig, { kind: 'next' });
        expect(rig.st.id).toBe('check');
        expect(rig.st.profile?.arm).toEqual({ kind: 'key' });
        expect(rig.st.armSource).toEqual({ kind: 'key' });
    });

    it('9. a momentary button tapped once toggles; a latching one held ON and let go is a level; ON alone is never enough', () => {
        const hands = (ch: Float64Array) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; };
        const tap = rigOf(IDEAL());
        expect(tap.to('arm', 'active')).toBe(true);
        let t0 = tap.t;
        tap.manual = (t, ch) => { hands(ch); const e = t - t0; return e >= 300 && e < 450 ? 1 : 0; };
        expect(tap.until((s) => s.stage === 'done', 3000)).toBe(true);
        expect(tap.t - t0).toBeGreaterThanOrEqual(450 + TUNING.ARM_LEVEL_MS - 5); // released for a level first
        expect(priv(tap.wz).armMap).toEqual({ kind: 'button', bit: 0, toggle: true });

        const latch = rigOf(IDEAL());
        expect(latch.to('arm', 'active')).toBe(true);
        t0 = latch.t;
        latch.manual = (t, ch) => { hands(ch); return t - t0 >= 300 ? 1 : 0; };
        const phases = new Set<string>();
        latch.for(10000, (s) => phases.add(s.armFlip ? `${s.armFlip.phase}:${s.armFlip.src.kind}${s.armFlip.src.kind === 'key' ? '' : s.armFlip.src.n}` : '-'));
        expect(key(latch.st)).toBe('arm/active'); // held ON for 10 s: not taken, it must come back OFF
        expect([...phases]).toEqual(['-', 'on:button1', 'off:button1']);
        expect([latch.st.message, latch.st.target?.dir]).toEqual(['wizard.say.arm.back', 'off']);
        t0 = latch.t;
        latch.manual = (_t, ch) => { hands(ch); return 0; };
        expect(latch.until((s) => s.stage === 'done', 3000)).toBe(true);
        expect(latch.t - t0).toBeGreaterThanOrEqual(TUNING.ARM_LEVEL_MS - 5);
        expect(priv(latch.wz).armMap).toEqual({ kind: 'button', bit: 0 });
    });

    it('10. no screen advances with idle hands and no press, and every screen offers the next action (an enabled button, or a hint within 12 s)', () => {
        const stages: [string, string][] = [
            ['stir', 'ready'], ['stir', 'active'], ['stir', 'done'], ['centre', 'ready'], ['centre', 'active'], ['centre', 'done'],
            ['throttle', 'ready'], ['throttle', 'active'], ['throttle', 'done'], ['yaw', 'ready'], ['yaw', 'active'], ['yaw', 'done'],
            ['roll', 'active'], ['arm', 'ready'], ['arm', 'active'], ['arm', 'done']
        ];
        const report: string[] = [];
        for (const [id, stage] of stages) {
            const rig = rigOf(IDEAL());
            expect(rig.to(id, stage), `${id}/${stage}`).toBe(true);
            const t0 = rig.t;
            rig.hold(); // hands off: sticks centred, throttle down, arm off; no press from here on
            let hintAt = -1, left = false, enabled = false;
            rig.for(15000, (s, t) => {
                if (s.id !== id || s.stage !== stage) left = true;
                if (s.hint && hintAt < 0 && t - t0 <= 12000) hintAt = t - t0;
                if (s.can.begin || s.can.next) enabled = true;
            });
            report.push(`${id}/${stage}: hint ${hintAt} ms (${rig.st.hint?.key}), primary ${enabled}`);
            expect(left, `${id}/${stage} left by itself`).toBe(false);
            expect(enabled || hintAt >= 0, `${id}/${stage}: no enabled button and no hint`).toBe(true);
            expect(rig.st.can.back, `${id}/${stage}: Back`).toBe(true);
            if (stage === 'active' && id !== 'centre' && id !== 'stir') expect(hintAt, `${id}/${stage} hint`).toBeGreaterThanOrEqual(0);
        }
        // no frames at all: the connect screen says so after 3 s through tick()
        const w = new CalibrationWizard('k', 'n');
        w.start(0);
        expect(w.tick(2900).hint).toBeNull();
        expect(w.tick(3100).hint?.key).toBe('wizard.hint.noData');
        expect(w.state.id).toBe('connect');
        expect(report.length).toBe(stages.length);
    });

    it('11. Back: active -> ready, done -> ready (capture dropped), ready -> the previous result (capture kept); Set again and Back returns to the check', () => {
        const rig = rigOf(IDEAL());
        rig.step();
        expect(key(rig.st)).toBe('stir/ready');
        expect(rig.press({ kind: 'back' }).ok).toBe(false); // nothing before: the UI shows the device choice
        expect(rig.to('yaw', 'ready')).toBe(true);
        rig.clicks = false;
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('throttle/done');
        expect(rig.st.assigned.throttle).toBe(2); // kept, and its result shown again
        expect(rig.st.result).toEqual({ kind: 'fn', fn: 'throttle', ch: 2, invert: false });
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('throttle/ready');
        expect(rig.st.assigned.throttle).toBeUndefined(); // dropped
        rig.for(600);
        accepted(rig, { kind: 'begin' });
        expect(key(rig.st)).toBe('throttle/active');
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('throttle/ready');
        rig.clicks = true;
        expect(rig.to('check', null)).toBe(true);
        rig.clicks = false;
        const before = JSON.stringify(rig.st.profile!.axes);
        accepted(rig, { kind: 'redo', what: 'yaw' });
        expect([key(rig.st), rig.st.redoing, rig.st.assigned.yaw, rig.st.profile]).toEqual(['yaw/ready', true, undefined, null]);
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('check');
        expect(JSON.stringify(rig.st.profile!.axes)).toBe(before);
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('arm/done');
        rig.clicks = true;
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('12. ArmLatch: the key toggles, a toggle button flips on the press edge only, reset turns it off', () => {
        const f = (b: number): RawFrame => ({ t: 0, axes: new Float32Array(8), buttons: b });
        const k = new ArmLatch();
        expect(k.level({ kind: 'key' }, null)).toBe(false);
        k.toggle();
        expect(k.level({ kind: 'key' }, null)).toBe(true);
        k.reset();
        expect(k.level({ kind: 'key' }, null)).toBe(false);
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
        const rig = rigOf(cfg);
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

    it('a switch left ON at Start: over and straight back says "was it ON?"; OFF, Back, Start, ON, OFF: correct. Held OFF long enough, it is taken reversed and Reverse fixes it', () => {
        const hands = (ch: Float64Array) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; };
        const rig = rigOf(IDEAL());
        expect(rig.to('roll', 'done')).toBe(true);
        rig.hold({ 4: 1 }); // left ON, "put it OFF, then Start" ignored
        rig.for(1000);
        accepted(rig, { kind: 'next' });
        expect(key(rig.st)).toBe('arm/ready');
        rig.for(300);
        accepted(rig, { kind: 'begin' });
        let t0 = rig.t;
        rig.manual = (t, ch) => { hands(ch); const e = t - t0; ch[4] = e >= 400 && e < 600 ? -1 : 1; };
        rig.for(2000);
        expect(key(rig.st)).toBe('arm/active');
        expect(rig.st.hint?.key).toBe('wizard.hint.arm.wasOn');
        expect(rig.st.hint?.params).toEqual({ ch: 5 });
        accepted(rig, { kind: 'back' });
        rig.hold({ 4: -1 });
        rig.for(300);
        accepted(rig, { kind: 'begin' });
        rig.hold({ 4: 1 });
        rig.for(600);
        expect(rig.st.armFlip).toMatchObject({ src: { kind: 'ch', n: 5 }, phase: 'off' });
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.stage === 'done', 2000)).toBe(true);
        expect(rig.st.mapped.arm).toBe(false);
        accepted(rig, { kind: 'next' });
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);

        // the same mistake, but held OFF for a level: ON (at Start) -> OFF -> ON is taken with
        // its ends swapped; the result reads OFF with the switch ON, Reverse turns it round
        const r2 = rigOf(IDEAL());
        expect(r2.to('arm', 'ready')).toBe(true);
        r2.hold({ 4: 1 });
        r2.for(500);
        accepted(r2, { kind: 'begin' });
        t0 = r2.t;
        r2.manual = (t, ch) => { hands(ch); const e = t - t0; ch[4] = e >= 400 && e < 1200 ? -1 : 1; };
        expect(r2.until((s) => s.stage === 'done', 3000)).toBe(true);
        expect(r2.st.mapped.arm).toBe(false); // the switch is ON in the hand
        r2.press({ kind: 'reverse', what: 'arm' });
        r2.for(50);
        expect(r2.st.mapped.arm).toBe(true);
        refused(r2, { kind: 'next' }, 'wizard.hint.next.armOn');
        r2.hold({ 4: -1 });
        r2.for(100);
        accepted(r2, { kind: 'next' });
        expect(armRead(r2.st.profile!)).toEqual([false, false, true]);
    });

    it('Measure pressed while the throttle is still being lowered: refused naming CH3, then accepted', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('centre', 'active')).toBe(true);
        const t0 = rig.t;
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; ch[2] = 0.5 - 1.5 * Math.min(1, (t - t0) / 1000); };
        rig.for(300);
        expect(refused(rig, { kind: 'next' }, 'wizard.hint.centre.moving')).toEqual({ ch: 3 });
        expect(key(rig.st)).toBe('centre/active');
        rig.for(1500);
        accepted(rig, { kind: 'next' });
        expect(rest(rig.wz)[2]).toBeCloseTo(-1, 2);
    });

    it('Start is refused while a free stick is moving, naming it', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('yaw', 'ready')).toBe(true);
        rig.manual = (t, ch) => { ch[0] = 0.2 * Math.sin(TWO_PI * 2 * t / 1000); ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; };
        rig.for(1000);
        expect(refused(rig, { kind: 'begin' }, 'wizard.hint.begin.moving')).toEqual({ ch: 1 });
        expect(key(rig.st)).toBe('yaw/ready');
    });

    it('a push hint does not flicker: once shown it stays at least HINT_MIN_MS', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('yaw', 'active')).toBe(true);
        const t0 = rig.t;
        // every 400 ms: roll and yaw pushed half way together ("two sticks"), then both back at rest
        // ("almost: you reached 50 %"): the two texts would swap every 400 ms
        rig.manual = (t, ch) => {
            const k = Math.floor((t - t0) / 400) % 2;
            ch[0] = k === 0 ? 0.5 : 0; ch[1] = 0; ch[2] = -1; ch[3] = k === 0 ? 0.5 : 0; ch[4] = -1;
        };
        const changes: number[] = [];
        let last: string | null = null;
        rig.for(14000, (s, t) => { const k = s.hint?.key ?? null; if (k !== last) { changes.push(t - t0); last = k; } });
        expect(changes.length).toBeGreaterThanOrEqual(3); // it does switch between the texts
        for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1]).toBeGreaterThanOrEqual(TUNING.HINT_MIN_MS - 5);
        expect(rig.st.assigned.yaw).toBeUndefined();
    });

    it('a saved profile resumes at the check: live values, Reverse, Back leads to the device choice, Set again works', () => {
        const rig = rigOf(IDEAL());
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        const saved = JSON.parse(JSON.stringify(rig.st.profile)) as Profile;
        const w = CalibrationWizard.resume(saved);
        w.start(0);
        expect([w.state.id, w.state.step, w.state.can.back, w.state.can.fly, w.state.can.redo]).toEqual(['check', 6, true, true, true]);
        let t = 0;
        const f: RawFrame = { t: 0, axes: new Float32Array([0, 0, quantize11(-1), 0, quantize11(1), 0, 0, 0]), buttons: 0 };
        const feed = (ms: number) => { const end = t + ms; while (t < end) { t += 2; f.t = t; w.feed(f); } };
        feed(20);
        expect(w.state.checks?.throttleLow).toBe(true);
        expect(w.state.checks?.armOn).toBe(true);
        expect(w.state.mapped.throttle).toBeCloseTo(-1, 2);
        w.reverse('throttle');
        expect(w.state.profile?.axes.throttle.invert).toBe(true);
        feed(4);
        expect(w.state.mapped.throttle).toBeCloseTo(1, 2);
        w.reverse('throttle');
        expect(w.back()).toBe(false);
        // Set again on the resumed profile: yaw measured from the saved range and centre
        f.axes[4] = quantize11(-1);
        feed(600);
        expect(w.redo('yaw').ok).toBe(true);
        expect([w.state.id, w.state.stage]).toEqual(['yaw', 'ready']);
        expect(w.begin().ok).toBe(true);
        f.axes[3] = quantize11(0.95);
        feed(500);
        expect([w.state.id, w.state.stage, w.state.assigned.yaw]).toEqual(['yaw', 'done', 3]);
        f.axes[3] = 0;
        feed(1000);
        expect(w.next().ok).toBe(true);
        expect(w.state.id).toBe('check');
        expect(w.state.profile?.axes.yaw).toMatchObject({ index: 3, invert: false });
        expect(judge(IDEAL(), w.state.profile!)).toEqual([]);
    });

    it('someone who stirs corner to corner and pauses in each corner gets four sticks; switches stay switches', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('stir', 'active')).toBe(true);
        const t0 = rig.t;
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
        rig.manual = (tt, ch) => {
            const t = tt - t0;
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
        rig.for(8000);
        expect(rig.st.can.next).toBe(true);
        accepted(rig, { kind: 'next' });
        expect(rig.st.channels.slice(0, 6).map((c) => c.kind)).toEqual(['stick', 'stick', 'stick', 'stick', 'switch', 'switch']);
        rig.manual = null;
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(IDEAL(), rig.st.profile!)).toEqual([]);
    });

    it('sticks that move but not like sticks yet: Done stays disabled, the stir hint does not blame USB mode', () => {
        // all four jump corner to corner in one frame (no sweep yet): "move both sticks all the way"
        const jump = rigOf(IDEAL());
        jump.clicks = false;
        jump.step();
        accepted(jump, { kind: 'begin' });
        jump.manual = (t, ch) => { const k = Math.floor(t / 500) % 4; ch[0] = k < 2 ? 1 : -1; ch[1] = k % 2 ? 1 : -1; ch[2] = k % 3 ? 1 : -1; ch[3] = k === 1 ? 1 : -1; ch[4] = -1; };
        jump.for(13000);
        expect([key(jump.st), jump.st.hint?.key, jump.st.can.next]).toEqual(['stir/active', 'wizard.needFourAxes', false]);
        expect(jump.press({ kind: 'next' }).ok).toBe(false);
        // three sticks stirred, CH4 swept only to 40 %: say which one and how far
        const part = rigOf(IDEAL());
        part.clicks = false;
        part.step();
        accepted(part, { kind: 'begin' });
        part.manual = (t, ch) => { const w = (t / 1000) * TWO_PI; ch[0] = Math.cos(w); ch[1] = Math.sin(w); ch[2] = Math.sin(1.3 * w); ch[3] = 0.4 * Math.cos(1.3 * w); ch[4] = -1; };
        part.for(13000);
        expect([key(part.st), part.st.hint?.key, part.st.hint?.params.ch, part.st.can.next]).toEqual(['stir/active', 'wizard.hint.stir.coverage', 4, false]);
        expect(part.st.hint?.params.pct).toBeGreaterThanOrEqual(39);
        expect(part.st.hint?.params.pct).toBeLessThanOrEqual(41);
    });

    it('only one stick stirred: Done stays disabled, the hint names the unstirred channel; stirred, Done is enabled', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('stir', 'active')).toBe(true);
        let full = false;
        rig.manual = (t, ch) => { const w = (t / 1000) * TWO_PI; const k = full ? 1 : 0.4; ch[0] = k * Math.cos(1.1 * w); ch[1] = k * Math.sin(1.1 * w); ch[2] = Math.sin(w); ch[3] = Math.cos(w); ch[4] = -1; };
        rig.for(9000);
        expect([key(rig.st), rig.st.can.next, rig.st.hint?.key, rig.st.hint?.params.ch]).toEqual(['stir/active', false, 'wizard.hint.stir.coverage', 1]);
        expect(rig.press({ kind: 'next' }).ok).toBe(false);
        full = true;
        expect(rig.until((s) => s.can.next, 5000)).toBe(true);
        accepted(rig, { kind: 'next' });
        expect(rig.st.result).toMatchObject({ kind: 'stir', sticks: [0, 1, 2, 3], short: [] });
    });

    it('a radio whose output stops at 75 %: Done is enabled by the plateau (counted in movements), and the setup is right', () => {
        const cfg = IDEAL();
        cfg.rangeLimit = 0.75;
        const rig = rigOf(cfg);
        expect(rig.to('stir', 'done')).toBe(true);
        expect(rig.st.result).toMatchObject({ kind: 'stir', sticks: [0, 1, 2, 3], short: [0, 1, 2, 3] });
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(judge(cfg, rig.st.profile!)).toEqual([]);
        // no plateau without the repeated movements: the same radio stirred to its end ONCE, held
        const once = rigOf(cfg);
        expect(once.to('stir', 'active')).toBe(true);
        const t0 = once.t;
        once.manual = (t, ch) => { const e = Math.min(1, (t - t0) / 1500); const w = e * TWO_PI; const k = 0.75 * e; ch[0] = k * Math.cos(w); ch[1] = k * Math.sin(w); ch[2] = k * Math.sin(w); ch[3] = k * Math.cos(w); ch[4] = -1; };
        once.for(12000);
        expect(once.st.can.next).toBe(false);
    });

    it('a pad that reports only changes: the still stages and the hold finish on tick(), with presses only', () => {
        const cfg = IDEAL();
        cfg.noise = 0;
        cfg.trim = { A: 0.021, E: -0.013, R: 0.017 };
        const rig = rigOf(cfg, { sparse: true });
        expect(rig.until(() => rig.flew, 60000)).toBe(true);
        expect(rig.skipped).toBeGreaterThan(1000); // the case really happened: long stretches without frames
        expect(rig.human.escapes.filter((e) => e === 'measureAnyway')).toEqual([]);
        expect(judge(cfg, rig.st.profile!)).toEqual([]);
    });

    it('a stick that never settles: after two refusals "Measure as it is" takes it as it holds', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('centre', 'active')).toBe(true);
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0.02 + 0.15 * Math.sin(TWO_PI * 3 * t / 1000); ch[4] = -1; };
        rig.for(1000);
        expect(rig.st.can.measureAnyway).toBe(false);
        expect(refused(rig, { kind: 'next' }, 'wizard.hint.centre.moving')).toEqual({ ch: 4 });
        expect(rig.press({ kind: 'measureAnyway' }).ok).toBe(false);
        rig.for(1000);
        refused(rig, { kind: 'next' }, 'wizard.hint.centre.moving');
        expect(rig.st.can.measureAnyway).toBe(true);
        accepted(rig, { kind: 'measureAnyway' });
        expect(key(rig.st)).toBe('centre/done');
        expect(Math.abs(rest(rig.wz)[3] - 0.02)).toBeLessThan(0.12);
    });

    it('a stick still held at its end on "let go": Measure is refused naming two ends; let go, it rests right', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('centre', 'active')).toBe(true);
        rig.hold({ 0: 1, 1: 1 }); // a slow reader: the right stick still in a corner, throttle down
        rig.for(1000);
        expect(refused(rig, { kind: 'next' }, 'wizard.hint.centre.ends')).toEqual({ a: 1, b: 2 });
        rig.hold({ 0: 0.02, 1: -0.01 });
        rig.for(1000);
        accepted(rig, { kind: 'next' });
        expect(rest(rig.wz)[0]).toBeCloseTo(0.02, 2);
        expect(rest(rig.wz)[1]).toBeCloseTo(-0.01, 2);
        // a radio throttle left in the middle: "put it all the way down"
        const r2 = rigOf(IDEAL());
        expect(r2.to('centre', 'active')).toBe(true);
        r2.hold({ 2: 0.4 });
        r2.for(1000);
        expect(refused(r2, { kind: 'next' }, 'wizard.hint.centre.parked')).toMatchObject({ ch: 3 });
    });

    it('one glitch sample on a pot does not become the arm switch', () => {
        const cfg = IDEAL();
        cfg.arm = 'none';
        const rig = rigOf(cfg);
        expect(rig.to('arm', 'active')).toBe(true);
        const t0 = rig.t;
        // fuzz potEdge:19: a pot resting at 0.071 jumps to 0.6 for one report (2 ms) and back
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = 0; ch[6] = 0; ch[7] = 0; ch[5] = t - t0 >= 1000 && t - t0 < 1000 + rig.dt ? 0.6 : 0.071; };
        rig.for(4000);
        expect([key(rig.st), rig.st.armSource, rig.st.hint?.key ?? null]).toEqual(['arm/active', null, null]);
    });

    it('Reverse on the arm line keeps the middle of a 3-position switch OFF and swaps the ends', () => {
        const rig = rigOf(IDEAL());
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

    it('an impatient pilot who pushes the throttle up for a moment and rests back at the bottom is not taken; held up, it is (not reversed)', () => {
        // up 0.4 s with 100 ms ramps (>= 70 % for about 360 ms < HOLD_MS), back at the bottom 0.9 s,
        // again and again; also on a radio whose throttle reads +1 at the bottom
        const loop = (bottom: number) => (e: number) => {
            const x = e % 1300;
            const up = x < 200 ? 0 : x < 300 ? (x - 200) / 100 : x < 600 ? 1 : x < 700 ? 1 - (x - 600) / 100 : 0;
            return bottom * (1 - 2 * up);
        };
        for (const bottom of [-1, 1]) {
            const rig = rigOf(IDEAL());
            expect(rig.to('throttle', 'ready')).toBe(true);
            rig.hold({ 2: bottom });
            rig.for(1000);
            accepted(rig, { kind: 'begin' });
            const t0 = rig.t;
            rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[4] = -1; ch[2] = loop(bottom)(t - t0); };
            rig.for(8000);
            expect(rig.st.assigned.throttle, `bottom ${bottom}`).toBeUndefined();
            rig.hold({ 2: -bottom }); // now held up on purpose
            rig.for(1000);
            expect(rig.st.assigned.throttle, `bottom ${bottom}`).toBe(2);
            expect(assignedOf(rig).throttle.invert, `bottom ${bottom}`).toBe(bottom > 0);
        }
    });

    it('a momentary button held 1 s is taken as a level: ON only while held; Back and one tap make it a toggle', () => {
        const hands = (ch: Float64Array) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1; };
        const rig = rigOf(IDEAL());
        expect(rig.to('arm', 'active')).toBe(true);
        const t0 = rig.t;
        let down = true;
        rig.manual = (t, ch) => { hands(ch); const e = t - t0; return (e >= 300 && e < 1300) || (!down && e >= 3000) ? 1 : 0; };
        expect(rig.until((s) => s.stage === 'done', 3000)).toBe(true);
        expect(priv(rig.wz).armMap).toEqual({ kind: 'button', bit: 0 });
        expect(rig.st.mapped.arm).toBe(false); // let go: it reads OFF
        down = false;
        rig.for(3200 - (rig.t - t0));
        expect(rig.st.mapped.arm).toBe(true); // pressed: ON only while held, the pilot sees it is not a switch
        rig.hold();
        rig.for(100);
        accepted(rig, { kind: 'back' });
        rig.for(300);
        accepted(rig, { kind: 'begin' });
        const t1 = rig.t;
        rig.manual = (t, ch) => { hands(ch); const e = t - t1; return e >= 300 && e < 450 ? 1 : 0; };
        expect(rig.until((s) => s.stage === 'done', 2000)).toBe(true);
        expect(priv(rig.wz).armMap).toEqual({ kind: 'button', bit: 0, toggle: true });
        expect(rig.st.can.reverse).toBe(false);
    });

    it('a 3-position switch paused in its middle on the way to ON: the far end is ON, the middle reads OFF', () => {
        const rig = rigOf(IDEAL());
        expect(rig.to('arm', 'active')).toBe(true);
        const t0 = rig.t;
        // fuzz arm3:116: 900 ms in the middle detent, on to the far end, then OFF again
        rig.manual = (t, ch) => { ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; const e = t - t0; ch[4] = e < 300 ? -1 : e < 1200 ? 0 : e < 2200 ? 1 : -1; };
        expect(rig.until((s) => s.stage === 'done', 4000)).toBe(true);
        rig.for(500);
        accepted(rig, { kind: 'next' });
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);
    });

    it('a 3-position far end seen before Back does not carry over to the next try', () => {
        // try 1 flips to the far end; Back from the check twice; try 2 holds the middle as ON (a
        // switch whose middle is ON): the middle must read ON, not the far end of try 1
        const rig = rigOf(IDEAL());
        expect(rig.to('arm', 'active')).toBe(true);
        rig.hold({ 4: 1 });
        rig.for(500);
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.stage === 'done', 2000)).toBe(true);
        accepted(rig, { kind: 'next' });
        expect(armRead(rig.st.profile!)).toEqual([false, false, true]);
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('arm/done');
        accepted(rig, { kind: 'back' });
        expect(key(rig.st)).toBe('arm/ready');
        rig.for(300);
        accepted(rig, { kind: 'begin' });
        rig.hold({ 4: 0 });
        rig.for(500);
        rig.hold({ 4: -1 });
        expect(rig.until((s) => s.stage === 'done', 2000)).toBe(true);
        accepted(rig, { kind: 'next' });
        expect(armRead(rig.st.profile!)).toEqual([false, true, true]);
    });

    it('I3: a refused command changes no capture, and its hint names a channel or a function', () => {
        const snap = (w: CalibrationWizard) => { const p = priv(w); return JSON.stringify([p.assigned, Array.from(p.rest), p.armMap, p.stickSet, p.results, p.pushEnd]); };
        let refusals = 0;
        const keys = new Set<string>();
        const bad: string[] = [];
        for (let i = 0; i < 40; i++) {
            const cfg = gridHuman(i, 500);
            const rig = rigOf(cfg);
            rig.human.onAct = (a) => {
                if (a.kind === 'fly') { rig.flew = true; return; }
                const before = snap(rig.wz), where = key(rig.st);
                const v = rig.press(a);
                if (v.ok || v.hint.key === 'wizard.hint.disabled') return;
                refusals++;
                keys.add(v.hint.key);
                if (snap(rig.wz) !== before) bad.push(`#${i} ${a.kind} on ${where} (${v.hint.key}) changed a capture`);
                const p = v.hint.params;
                const names = p.ch !== undefined || p.a !== undefined || p.fn !== undefined || v.hint.key === 'wizard.hint.next.thrDown' || v.hint.key === 'wizard.hint.next.armOn';
                if (!names) bad.push(`#${i} ${v.hint.key} names nothing`);
            };
            expect(rig.until(() => rig.flew, 180000), `#${i}`).toBe(true);
            expect(judge(cfg, rig.st.profile!), `#${i}`).toEqual([]);
        }
        expect(bad).toEqual([]);
        expect(refusals).toBeGreaterThan(20); // the people really were refused, again and again
        expect(keys.size).toBeGreaterThanOrEqual(3);
    });

    it('Andrii 2026-09-26, arm: nothing is watched before Start; noise, drift, glitches under 300 ms, a knob and the sticks never become the arm, his switch does; the frozen v2 took the glitchy channel and the knob within 3 s', () => {
        type D = (t: number, g: () => number, r: () => number) => number;
        const glitchy = (level: number, far: number, lo: number, hi: number): D => {
            let next = 1500, end = -1;
            return (t, g, r) => { if (t >= next) { end = t + lo + (hi - lo) * r(); next = end + 1500 + 1500 * r(); } return (t < end ? far : level) + g() * 0.005; };
        };
        // channels that are not a switch, on CH6; the pilot's switch is CH5 (OFF = -1)
        const DIST: Record<string, () => D> = {
            'pot, noise sd 0.03': () => (_t, g) => -0.4 + g() * 0.03,
            'one LSB of jitter': () => (_t, _g, r) => 0.125 + (r() < 0.5 ? 1 : -1) / 1024,
            'slow drift +-0.6': () => (t, g) => 0.6 * Math.sin((TWO_PI * t) / 20000) + g() * 0.005,
            'glitches to 0.9 for 30..250 ms': () => glitchy(0, 0.9, 30, 250),
            'a knob turned back and forth': () => (t, g) => 0.9 * Math.sin((TWO_PI * t) / 4000) + g() * 0.005
        };
        const handsOf = (d: D, seed: number, extra?: (t: number, ch: Float64Array) => void) => {
            const r = mulberry32(seed);
            const g = () => (r() + r() + r() + r() - 2) * 1.7320508075688772;
            return (t: number, ch: Float64Array): number => {
                ch[0] = g() * 0.005; ch[1] = g() * 0.005; ch[2] = -1; ch[3] = g() * 0.005; ch[4] = -1; ch[6] = 0; ch[7] = 0;
                ch[5] = Math.max(-1, Math.min(1, d(t, g, r)));
                extra?.(t, ch);
                return 0;
            };
        };
        const v2took: string[] = [];
        for (const [name, mk] of Object.entries(DIST)) {
            const rig = rigOf(IDEAL());
            expect(rig.to('arm', 'ready')).toBe(true);
            rig.clicks = false;
            rig.manual = handsOf(mk(), 7);
            const seen = new Set<string>();
            const hints = new Set<string>();
            const log = (s: WizardState) => { seen.add(`${key(s)} ${JSON.stringify(s.armSource)}`); if (s.hint) hints.add(`${s.hint.key} ${JSON.stringify(s.hint.params)}`); };
            rig.for(20000, log);
            expect([...seen], name).toEqual(['arm/ready null']); // nothing is watched before Start
            accepted(rig, { kind: 'begin' });
            // 60 s of it, the sticks pushed to their ends now and then
            const t1 = rig.t;
            rig.manual = handsOf(mk(), 8, (t, ch) => { const e = (t - t1) % 6000; if (e < 800) { ch[0] = 1; ch[3] = -1; } else if (e >= 3000 && e < 3800) { ch[1] = -1; ch[2] = 1; } });
            rig.for(60000, log);
            expect([...seen], name).toEqual(['arm/ready null', 'arm/active null']);
            if (name.startsWith('a knob')) expect([...hints], name).toContain('wizard.hint.arm.sweep {"ch":6}');
            // his switch: ON, a moment, back OFF
            const t2 = rig.t;
            rig.manual = handsOf(mk(), 9, (t, ch) => { const e = t - t2; ch[4] = e >= 200 && e < 1200 ? 1 : -1; });
            expect(rig.until((s) => s.stage === 'done', 3000), name).toBe(true);
            expect(rig.st.result, name).toEqual({ kind: 'arm', source: { kind: 'ch', n: 5 } });
            // negative control: the frozen v2, the same channel from its arm screen on, no switch touched
            const v2 = new V2Rig(IDEAL());
            expect(v2.until((s) => s.id === 'arm', 60000)).toBe(true);
            const t3 = v2.t;
            v2.manual = handsOf(mk(), 7);
            if (v2.until((s) => s.armSource !== null, 20000)) v2took.push(`${name} ${JSON.stringify(v2.st.armSource)} ${v2.t - t3 <= 3000 ? '<= 3 s' : `${v2.t - t3} ms`}`);
        }
        expect(v2took).toEqual([
            'glitches to 0.9 for 30..250 ms {"kind":"ch","n":6} <= 3 s',
            'a knob turned back and forth {"kind":"ch","n":6} <= 3 s'
        ]);
    });

    it("arm by hand (Liftoff's dots): every non-stick channel is listed; a switch at a low weight is not taken by itself, picked it is; a pick on the result drops it and listens to the picked channel only, where a knob counts; Skip on the result", () => {
        const base = (c: Float64Array) => { c[0] = 0; c[1] = 0; c[2] = -1; c[3] = 0; c[4] = -1; c[5] = 0; c[6] = 0; c[7] = 0; };
        const rig = rigOf(IDEAL());
        expect(rig.to('arm', 'ready')).toBe(true);
        rig.clicks = false;
        rig.manual = (_t, c) => base(c);
        rig.for(500);
        expect(rig.st.can.pick).toBe(true);
        expect(rig.wz.freeChannels()).toEqual([4, 5, 6, 7]); // the four sticks are not offered
        accepted(rig, { kind: 'begin' });
        // CH7, a switch at 30 % weight: -0.3 <-> +0.3 every 3 s, a jump, but under ARM_JUMP
        let t0 = rig.t;
        const flip = (ch: number, off: number, on: number) => (t: number, c: Float64Array) => { base(c); const e = (t - t0) % 3000; c[ch] = e >= 500 && e < 1500 ? on : off; };
        rig.manual = flip(6, -0.3, 0.3);
        rig.for(12000);
        expect(key(rig.st)).toBe('arm/active');
        expect(rig.st.armSource).toBeNull();
        expect([rig.st.hint?.key, rig.st.hint?.params]).toEqual(['wizard.hint.arm.small', { ch: 7 }]);
        accepted(rig, { kind: 'pick', ch: 6 });
        expect([key(rig.st), rig.st.picked]).toEqual(['arm/active', 6]);
        t0 = rig.t;
        expect(rig.until((s) => s.stage === 'done', 4000)).toBe(true);
        expect(rig.st.result).toEqual({ kind: 'arm', source: { kind: 'ch', n: 7 } });
        expect(priv(rig.wz).armMap).toMatchObject({ kind: 'axis', index: 6, onAbove: true });
        expect(rig.st.mapped.arm).toBe(false); // taken at the end of the OFF hold
        rig.for(2000);
        expect(rig.st.mapped.arm).toBe(true); // the next cycle's ON: the result card shows it live
        // a pick on the result: the capture goes, from now only CH8 counts
        rig.manual = (_t, c) => base(c);
        rig.for(500);
        accepted(rig, { kind: 'pick', ch: 7 });
        expect([key(rig.st), rig.st.picked, rig.st.armSource]).toEqual(['arm/active', 7, null]);
        t0 = rig.t;
        rig.manual = flip(4, -1, 1); // the CH5 switch, a perfect flip, but not the channel picked
        rig.for(4000);
        expect(key(rig.st)).toBe('arm/active');
        // CH8 a knob: 0 -> 0.8 in 600 ms, held, back in 600 ms: picked, a sweep counts
        t0 = rig.t;
        rig.manual = (t, c) => { base(c); const e = t - t0; c[7] = e < 600 ? (0.8 * e) / 600 : e < 1400 ? 0.8 : e < 2000 ? 0.8 * (1 - (e - 1400) / 600) : 0; };
        expect(rig.until((s) => s.stage === 'done', 4000)).toBe(true);
        expect(rig.st.result).toEqual({ kind: 'arm', source: { kind: 'ch', n: 8 } });
        expect(rig.st.can.skipArm).toBe(true);
        accepted(rig, { kind: 'skipArm' });
        expect([key(rig.st), rig.st.result]).toEqual(['arm/done', { kind: 'arm', source: { kind: 'key' } }]);
        accepted(rig, { kind: 'next' });
        expect(rig.st.profile?.arm).toEqual({ kind: 'key' });
    });
});
