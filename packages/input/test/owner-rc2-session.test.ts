// Lane connect, stage C1 (docs/wip/connect.md): the owner's real DJI RC 2 session of 2026-11-13 through the wizard.
// His left stick springs to the centre; at "Let go" the screen asks for the throttle all the way down and he held it
// there, so the wizard measured the throttle's rest at the bottom and the page flew him "from zero" (FPV). The wizard
// now keeps what the stick did (spring.ts): a throttle that snapped back to its middle from above and from below rests
// in the centre. Counter-cases: radio throttles with no spring (the simulated pilots of sim/human.ts, and the same
// record with the throttle's spring taken away) keep the rest the step measured, so an FPV radio still flies from zero
// (review M4). Negative control: calib.ts of origin/main measures 'bottom' on the owner's record.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CalibrationWizard } from '../src/calib';
import type { Profile } from '../src';
import { resolveStyle, profileStyle } from '../src';
import { SpringWatch, SPRING } from '../src/spring';
import { randomHuman } from '../src/sim/human';
import { invSet, Rig } from './helpers';

const FIX = fileURLToPath(new URL('./fixtures/dji-rc2/owner-session-2026-11-13.jsonl', import.meta.url));
/** the record: t in ms from the page's connection, six raw values (roll, pitch, throttle, yaw, left dial, right dial) */
const ROWS: { t: number; v: number[] }[] = readFileSync(FIX, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
/** the RC 2 as the page reads it (dji-duml.ts RC2_HID_COLLECTIONS, hid-layout.ts axisScale): (raw - 1024) / 660 */
const norm = (raw: number): number => (raw - 1024) / 660;

interface Walk { profile: Profile | null; checkAtS: number | null; centreAtS: number | null; centreThrottle: number | null }

/** The wizard as the Controls screen runs it (auto: the sticks move it on), fed the record answer by answer. */
function walk(rows: { t: number; v: number[] }[], t0 = 1000): Walk {
    const w = new CalibrationWizard('hid:2ca3:1021:DJI RC 2:12:d', 'DJI RC 2');
    w.auto = true;
    w.start(t0);
    let checkAtS: number | null = null, centreAtS: number | null = null, centreThrottle: number | null = null;
    for (const r of rows) {
        const st = w.feed({ t: t0 + r.t, axes: Float32Array.from(r.v.map(norm)), buttons: 0 });
        if (centreAtS === null && st.id === 'centre' && st.stage === 'done') { centreAtS = r.t / 1000; centreThrottle = r.v[2]; }
        if (st.id === 'check') { checkAtS = r.t / 1000; break; }
    }
    return { profile: w.state.profile ?? null, checkAtS, centreAtS, centreThrottle };
}

describe('the owner\'s DJI RC 2 session of 2026-11-13 through the wizard', () => {
    const owner = walk(ROWS);

    it('reaches the check screen with the throttle on raw channel 3, the sticks as recorded', () => {
        expect(owner.checkAtS).not.toBeNull();
        expect(owner.checkAtS!).toBeGreaterThan(40);
        expect(owner.checkAtS!).toBeLessThan(60);
        const p = owner.profile!;
        expect(p.axes.throttle?.index).toBe(2);
        expect(p.axes.throttle?.invert).toBe(false);
        expect(p.axes.yaw?.index).toBe(3);
        expect(p.axes.pitch?.index).toBe(1);
        expect(p.axes.roll?.index).toBe(0);
    });

    it('as recorded, the wizard measured "Let go" before he lowered the throttle: rest in the centre (the replay of the page agrees)', () => {
        expect(owner.centreAtS).not.toBeNull();
        expect(owner.centreAtS!).toBeLessThan(13); // he lowered it at 13.0 s, on the throttle screen
        expect(owner.centreThrottle).toBe(1024);
        expect(owner.profile!.throttleRest).toBe('centre');
        expect(profileStyle(owner.profile!, null)).toEqual({ style: 'centred', why: 'wizard' });
        expect(profileStyle(owner.profile!, 'centre')).toEqual({ style: 'centred', why: 'seen' });
    });

    // the same hands, obeying "Thumbs off, throttle all the way down" on the Let go screen at once: the throttle at the
    // bottom from 9.0 s (the stir's end) until 14.5 s, where his own record lets it spring back
    const obey = ROWS.map((r) => (r.t >= 9000 && r.t < 14500 ? { t: r.t, v: [r.v[0], r.v[1], 364, r.v[3], r.v[4], r.v[5]] } : r));
    const obeyed = walk(obey);

    it('his throttle held down at "Let go", as the screen asks: measured at the bottom there', () => {
        expect(obeyed.centreAtS).not.toBeNull();
        expect(obeyed.centreThrottle).toBe(364);
        expect(obeyed.checkAtS).not.toBeNull();
    });

    it('the wizard still keeps the rest in the centre: the throttle snapped back to its middle from both sides', () => {
        expect(obeyed.profile!.throttleRest).toBe('centre');
        expect(profileStyle(obeyed.profile!, null)).toEqual({ style: 'centred', why: 'wizard' });
        expect(profileStyle(obeyed.profile!, 'centre')).toEqual({ style: 'centred', why: 'seen' });
    });

    // review CN-1: the stir a few percent short on one end (his throttle reaching 410 instead of 364, or 1618 instead of
    // 1684), then the throttle held down from 10.0 s as the screen asks; the throttle step completes the range later
    const short = (scaleLow: number, scaleHigh: number) => ROWS.map((r) => {
        let thr = r.v[2];
        if (r.t < 9000) thr = thr < 1024 ? Math.round(1024 - (1024 - thr) * scaleLow) : Math.round(1024 + (thr - 1024) * scaleHigh);
        if (r.t >= 10000 && r.t < 14500) thr = 364;
        return { t: r.t, v: [r.v[0], r.v[1], thr, r.v[3], r.v[4], r.v[5]] };
    });
    for (const [lo, hi] of [[0.93, 1], [1, 0.9], [0.95, 1]] as [number, number][]) {
        it(`a stir short on one end (low x${lo}, high x${hi}) and the throttle held down at "Let go": still centre`, () => {
            const w = walk(short(lo, hi));
            expect(w.checkAtS).not.toBeNull();
            expect(w.centreThrottle).toBe(364);
            expect(w.profile!.throttleRest).toBe('centre');
            expect(profileStyle(w.profile!, null)).toEqual({ style: 'centred', why: 'wizard' });
        });
    }

    it('SpringWatch on his throttle channel: springs; the same hands on a stick with no spring: does not', () => {
        const feedCh = (vals: { t: number; x: number }[]): SpringWatch => {
            const w = new SpringWatch();
            for (const { t, x } of vals) w.update(norm(x), t, 0, 1);
            return w;
        };
        expect(feedCh(ROWS.map((r) => ({ t: r.t, x: r.v[2] }))).springs).toBe(true);
        // no spring: the stick follows the hand out and across the middle, never back towards it by itself
        let held = 1024;
        const still = ROWS.map((r) => {
            const x = r.v[2], o = x - 1024, h = held - 1024;
            if (x !== 1024 && (Math.abs(o) > Math.abs(h) || Math.sign(o) !== Math.sign(h))) held = x;
            return { t: r.t, x: held };
        });
        expect(feedCh(still).springs).toBe(false);
    });
});

describe('FPV radios keep flying from zero (review M4): simulated pilots with radio throttles', () => {
    it('no radio throttle is read as a spring; every gamepad-like spring throttle is', () => {
        const seen: string[] = [];
        let radios = 0, pads = 0;
        for (let seed = 1; seed <= 40; seed++) {
            const cfg = randomHuman(seed, 'AETR', invSet(seed));
            const rig = new Rig(cfg);
            if (!rig.until(() => rig.flew, 180000)) continue;
            const p = rig.st.profile!;
            if (cfg.gamepadLike) { pads++; expect(p.throttleRest, `seed ${seed} pad`).toBe('centre'); continue; }
            radios++;
            seen.push(`${seed}:${cfg.lowerThrottleInCentre ? 'down' : 'left'}:${p.throttleRest}`);
            if (cfg.lowerThrottleInCentre) expect(p.throttleRest, `seed ${seed}`).toBe('bottom');
            // the style a radio flies with is never centred by a measured spring: from zero unless the step saw the middle
            if (p.throttleRest === 'centre') expect(cfg.lowerThrottleInCentre).toBe(false);
        }
        expect(radios).toBeGreaterThan(20);
        expect(seen.filter((s) => s.endsWith(':centre')).length).toBeLessThanOrEqual(seen.filter((s) => s.includes(':left:')).length);
        expect(pads).toBeGreaterThan(0);
    });

    it('resolveStyle keeps the M4 rule: a centre seen now never beats a wizard bottom', () => {
        expect(resolveStyle({ seen: 'centre', wizard: 'bottom' })).toEqual({ style: 'zero', why: 'wizard' });
    });
});

describe('SpringWatch: a snap back to the same middle from both sides', () => {
    const run = (path: [number, number][], ms = 8): SpringWatch => {
        // path: [until ms, value]; samples every `ms`
        const w = new SpringWatch();
        let i = 0;
        for (let t = 0; t <= path[path.length - 1][0]; t += ms) {
            while (path[i][0] < t) i++;
            w.update(path[i][1], t, 0, 1);
        }
        return w;
    };
    it('up, let go, down, let go: springs', () => {
        expect(run([[1000, 0], [1500, 1], [1530, 0.4], [1560, 0], [3000, 0], [3500, -1], [3550, 0], [5000, 0]]).springs).toBe(true);
    });
    it('negative control: one side only does not', () => {
        expect(run([[1000, 0], [1500, 1], [1560, 0], [3000, 0], [3500, 1], [3550, 0], [5000, 0]]).springs).toBe(false);
    });
    it('negative control: a hand that brings it to the middle slower than RETURN_MS does not', () => {
        // a ramp from the end to the middle: it crosses AWAY..NEAR (0.35 of the half range) in more than RETURN_MS
        const ramp = (t0: number, s: number): [number, number][] => Array.from({ length: 21 }, (_, k) => [t0 + k * 50, s * (1 - k / 20)] as [number, number]);
        expect(run([[1000, 0], [1500, 1], ...ramp(1500, 1), [3000, 0], [3500, -1], ...ramp(3500, -1), [5000, 0]]).springs).toBe(false);
        expect(run([[1000, 0], [1500, 1], [1530, 0], [3000, 0], [3500, -1], [3530, 0], [5000, 0]]).springs).toBe(true); // control: the same, fast
    });
    it('negative control: two different landing values (a hand parking it) do not', () => {
        expect(run([[1000, 0], [1500, 1], [1560, 0.1], [3000, 0.1], [3500, -1], [3550, -0.05], [5000, -0.05]]).springs).toBe(false);
    });
    it('negative control: a stir that only passes the middle does not', () => {
        const w = new SpringWatch();
        for (let t = 0; t <= 8000; t += 8) w.update(Math.sin(t / 1000 * Math.PI * 2 * 0.6), t, 0, 1);
        expect(w.springs).toBe(false);
    });
});
