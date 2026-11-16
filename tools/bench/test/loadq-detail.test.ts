// Lane loadq G1 and G2 (apps/fly/src/app/detail-rule.ts): a budget the pilot set by hand is not lowered by the frame
// rate keeper (the governor), and the detail line's text for each state.
import { describe, expect, it } from 'vitest';
import { detailLine, detailState, detailVisible, drawPlan, FULL_SHOW_MS, StillRise, stillCapM, stillTopM, STILL_FRAME_MS } from '../../../apps/fly/src/app/detail-rule';
import type { DetailInput, StillSample } from '../../../apps/fly/src/app/detail-rule';

const say = (k: string, v?: Record<string, string | number>): string => (v ? `${k} ${JSON.stringify(v)}` : k);

const base: DetailInput = {
    handSet: true, released: false, keeperSlow: false, step: 0, topM: 16, budgetM: 16, drawnM: 6.2,
    pending: 14, retrying: 0, givenUp: 0, filesPerSec: 0.7
};

describe('G1: a hand-set budget is kept', () => {
    const at = { userMaxScale: 1, presetScale: 1, settingBudgetM: 16, stepScale: 0.5, stepBudgetM: 6 };
    it('the keeper at its lowest step does not lower a pinned budget or resolution', () => {
        expect(drawPlan({ ...at, pinned: true })).toEqual({ scale: 1, budgetM: 16 });
    });
    it('not pinned (auto, or let go): the keeper lowers as before', () => {
        expect(drawPlan({ ...at, pinned: false })).toEqual({ scale: 0.5, budgetM: 6 });
    });
});

describe('G2: the detail line', () => {
    it('coming: drawn of the setting, files to go and about how long', () => {
        const s = detailState(base);
        expect(s).toBe('coming');
        expect(detailLine(s, base, say).text).toBe('detail.coming {"drawn":"6.2","top":"16","files":14,"secs":20}');
        expect(detailLine(s, { ...base, filesPerSec: 0 }, say).text).toBe('detail.comingStart {"drawn":"6.2","top":"16","files":14}');
    });
    it('full for the setting, shown a few seconds then hidden; no finer level when less is drawn with nothing to come', () => {
        const full = { ...base, pending: 0, drawnM: 15.59 };
        expect(detailState(full)).toBe('full');
        expect(detailLine('full', full, say).text).toBe('detail.full');
        expect(detailVisible('full', 0, FULL_SHOW_MS - 1)).toBe(true);
        expect(detailVisible('full', 0, FULL_SHOW_MS)).toBe(false);
        expect(detailState({ ...full, drawnM: 9 })).toBe('nofiner');
    });
    it('held by the keeper: says so and offers to let the page choose; after the press: lowered', () => {
        const kept = { ...base, keeperSlow: true, step: 4 };
        expect(detailState(kept)).toBe('kept');
        const l = detailLine('kept', kept, say);
        expect(l.text).toBe('detail.kept');
        expect(l.action).toBe('release');
        expect(l.actionText).toBe('detail.release');
        const low = { ...kept, released: true, budgetM: 6, drawnM: 5.7 };
        expect(detailState(low)).toBe('lowered');
        expect(detailLine('lowered', low, say).text).toBe('detail.lowered {"drawn":"5.7","top":"16"}');
    });
    it('network: trying again, then the Try again press; for every pilot', () => {
        const net = { ...base, handSet: false, retrying: 12 };
        expect(detailState(net)).toBe('network');
        expect(detailLine('network', net, say).text).toBe('detail.network {"files":12}');
        const gone = { ...net, givenUp: 3 };
        expect(detailState(gone)).toBe('givenup');
        expect(detailLine('givenup', gone, say)).toEqual({ text: 'detail.givenup {"files":3}', action: 'retry', actionText: 'detail.retry' });
    });
    it('G4: a pilot who never set the budget sees nothing while detail streams', () => {
        expect(detailState({ ...base, handSet: false })).toBe('hidden');
        expect(detailVisible('hidden', 0, 0)).toBe(false);
    });
});

describe('G3: a file that stalled and is asked again', () => {
    it('the line names the network while a file that failed once is loading again, not only during its pause', () => {
        const i = { ...base, retrying: 0, troubled: 3, pending: 163 };
        expect(detailState(i)).toBe('network');
        expect(detailLine('network', i, say).text).toBe('detail.network {"files":3}');
        expect(detailState({ ...i, handSet: false })).toBe('network');
    });
});

/** The rule with the hover rise switched on (StillRise.hover): the tests of the rise's own mechanics. */
function hovering(): StillRise {
    const r = new StillRise();
    r.hover = true;
    return r;
}

describe('G6: more detail while the craft is still', () => {
    const rest: StillSample = { now: 0, paused: false, speed: 0.05, turnDegS: 2, roll: 0, pitch: 0, yaw: 0, throttle: -0.1, frameMs: 10 };
    /** frames of `ms` each for `secs` seconds at 100 frames a second; the budgets after each frame */
    function run(r: StillRise, from: number, secs: number, s: Partial<StillSample> = {}, baseM = 0.5, capM = 16): { t: number; boostM: number; changed: boolean }[] {
        const out = [];
        for (let k = 1; k <= secs * 100; k++) {
            const now = from + k * 10;
            const changed = r.frame({ ...rest, ...s, now }, baseM, capM, true);
            out.push({ t: now, boostM: r.boostM, changed });
        }
        return out;
    }
    it('at rest the budget rises x1.5 a second after 1 s still, up to the memory cap', () => {
        const r = hovering();
        const o = run(r, 0, 12);
        expect(o.find((x) => x.t === 1000)?.boostM).toBe(0);
        expect(o.find((x) => x.t === 1010)?.boostM).toBeCloseTo(0.75, 6);
        expect(o.find((x) => x.t === 2010)?.boostM).toBeCloseTo(1.125, 6);
        expect(r.boostM).toBe(2); // loadq2 R3: at most 4 times the flight budget 0.5
        const capped = hovering();
        run(capped, 0, 20, {}, 2, 4);
        expect(capped.boostM).toBe(4);
    });
    it('a stick move sets the base back in the same frame', () => {
        const r = hovering();
        run(r, 0, 5);
        expect(r.boostM).toBeGreaterThan(0.5);
        expect(r.frame({ ...rest, now: 5010, roll: 0.2 }, 0.5, 16, true)).toBe(true);
        expect(r.boostM).toBe(0);
        const t = hovering();
        run(t, 0, 5);
        expect(t.frame({ ...rest, now: 5010, throttle: 0.0 }, 0.5, 16, true)).toBe(true);
        expect(t.boostM).toBe(0);
    });
    it('speed or a turn over the bounds is a move; a paused flight rises, its end falls back', () => {
        const r = hovering();
        run(r, 0, 5, { speed: 0.5 });
        expect(r.boostM).toBe(0);
        run(r, 5000, 5, { turnDegS: 30 });
        expect(r.boostM).toBe(0);
        const p = hovering();
        run(p, 0, 5, { paused: true, speed: 3, roll: 0.5 });
        expect(p.boostM).toBeGreaterThan(0.5);
        expect(p.frame({ ...rest, now: 5010 }, 0.5, 16, true)).toBe(true);
        expect(p.boostM).toBe(0);
    });
    it('frames at the still bound stop the rise and step it back; the switch off keeps the base', () => {
        const r = hovering();
        run(r, 0, 4);
        const top = r.boostM;
        run(r, 4000, 3, { frameMs: STILL_FRAME_MS + 4 });
        expect(r.boostM).toBeLessThan(top);
        const off = hovering();
        for (let k = 1; k <= 500; k++) off.frame({ ...rest, now: k * 10 }, 0.5, 16, false);
        expect(off.boostM).toBe(0);
    });
    it('the memory cap: 4 M at 4 GB or less, 8 M under 8 GB or unknown, 16 M at 8 GB', () => {
        expect([stillCapM(2), stillCapM(4), stillCapM(6), stillCapM(undefined), stillCapM(8)]).toEqual([4, 4, 8, 8, 16]);
    });
    it('the line says the detail is sharpening at rest, for every pilot', () => {
        const i = { ...base, handSet: false, pending: 0, still: true, drawnM: 2.53 };
        expect(detailState(i)).toBe('still');
        expect(detailLine('still', i, say).text).toBe('detail.still {"drawn":"2.5"}');
    });
});

describe('loadq2 review', () => {
    const base: DetailInput = { handSet: true, released: false, keeperSlow: false, step: 0, topM: 16, budgetM: 16, drawnM: 0.5, pending: 141, retrying: 0, givenUp: 0, filesPerSec: 4.5, still: true };
    it('LR-1: a hand-set budget still loading at rest says the files to go, not "sharper while you hold still"', () => {
        expect(detailState(base)).toBe('coming');
        expect(detailState({ ...base, pending: 0, drawnM: 15.6 })).toBe('still');
        expect(detailState({ ...base, handSet: false })).toBe('still');
    });
    it('LR-4: the detail does not rise before the frame rate keeper has chosen the step of the flight', () => {
        const r = hovering();
        const s = (now: number): StillSample => ({ now, paused: false, speed: 0, turnDegS: 0, roll: 0, pitch: 0, yaw: 0, throttle: -1, frameMs: 16 });
        for (let now = 16; now < 5000; now += 16) r.frame(s(now), 1, 8, true, false);
        expect(r.boostM).toBe(0);
        for (let now = 5000; now < 8000; now += 16) r.frame(s(now), 1, 8, true, true);
        expect(r.boostM).toBeGreaterThan(1);
    });
});

describe('loadq2 R2-rest', () => {
    const s = (now: number, o: Partial<StillSample> = {}): StillSample => ({ now, paused: false, speed: 0, turnDegS: 0, roll: 0, pitch: 0, yaw: 0, throttle: -1, frameMs: 16, ...o });
    const rise = (r: StillRise, baseM: number, capM: number, touch: boolean, o: Partial<StillSample> = {}, from = 0, ms = 20000): void => {
        for (let now = from + 16; now < from + ms; now += 16) r.frame(s(now, o), baseM, capM, true, true, touch);
    };
    it('R3: the still budget stops at 4 times the flight budget, 2 on a touch device, and at the memory cap', () => {
        const d = hovering();
        rise(d, 2.5, 16, false);
        expect(d.boostM).toBe(10);
        const t = hovering();
        rise(t, 2, 16, true);
        expect(t.boostM).toBe(4);
        const m = hovering();
        rise(m, 2.5, 4, false);
        expect(m.boostM).toBe(4);
        expect([stillTopM(2.5, 16, false), stillTopM(2, 16, true), stillTopM(2.5, 4, false), stillTopM(8, 4, false)]).toEqual([10, 4, 4, 8]);
    });
    it('R3: after a device fault the line says once that the setting was switched off', () => {
        const i: DetailInput = { handSet: false, released: false, keeperSlow: false, step: 0, topM: 4, budgetM: 4, drawnM: 4, pending: 0, retrying: 0, givenUp: 0, filesPerSec: 0, still: false, stillOff: true };
        expect(detailState(i)).toBe('stilloff');
        expect(detailLine('stilloff', i, say).text).toBe('detail.stilloff');
        expect(detailState({ ...i, stillOff: false })).toBe('hidden');
    });
    it('R5: the view turning or moving is a move, in a pause too', () => {
        const p = hovering();
        rise(p, 1, 16, false, { paused: true });
        expect(p.boostM).toBeGreaterThan(1);
        expect(p.frame(s(20100, { paused: true, viewTurnDegS: 40 }), 1, 16, true, true)).toBe(true);
        expect(p.boostM).toBe(0);
        rise(p, 1, 16, false, { paused: true, viewTurnDegS: 40 }, 20100, 5000);
        expect(p.boostM).toBe(0);
        rise(p, 1, 16, false, { paused: true, viewSpeed: 1 }, 25100, 5000);
        expect(p.boostM).toBe(0);
        const h = hovering();
        rise(h, 1, 16, false, { viewTurnDegS: 3, viewSpeed: 0.05 });
        expect(h.boostM).toBeGreaterThan(1);
    });
});

describe('loadq2 R4', () => {
    const s = (now: number, o: Partial<StillSample> = {}): StillSample => ({ now, paused: false, speed: 0, turnDegS: 0, roll: 0, pitch: 0, yaw: 0, throttle: -1, frameMs: 16, ...o });
    it('the page rises only in a pause: a still hover keeps the flight budget, a pause rises, the end of the pause falls back', () => {
        const r = new StillRise();
        for (let now = 16; now < 20000; now += 16) r.frame(s(now), 1, 16, true, true);
        expect(r.boostM).toBe(0);
        for (let now = 20000; now < 30000; now += 16) r.frame(s(now, { paused: true }), 1, 16, true, true);
        expect(r.boostM).toBe(4);
        expect(r.frame(s(30000), 1, 16, true, true)).toBe(true);
        expect(r.boostM).toBe(0);
    });
});
