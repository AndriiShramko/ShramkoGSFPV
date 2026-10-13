// The radio's channel functions (switches.ts): Betaflight's range test and OR / AND logic, Angle over
// Horizon, the setup wizard's result as the default, ranges driving arm and mode through mapFrame,
// action edges and the Betaflight aux import. Every claim has a negative control that must fail.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODE_CHANNEL, parseBetaflightDiff } from '@gsfpv/sim-core';
import type { FlightMode } from '@gsfpv/sim-core';
import {
    POSITION_BANDS, SWITCH_ACTIONS, SwitchActionWatch, armByRanges, bandOf, channelInput, channelOf, channelUs, fnOn, importOver, inputName, mapFrame, modeInput,
    modePositions, profileArmLevel, ArmLatch, radioSetsMode, rangeOn, rangesMode, readSwitches, setModePositions, switchesFromBetaflight,
    switchesFromProfile
} from '../src/calib';
import type { Profile, RawFrame, SwitchFn, SwitchInput, SwitchModes, SwitchRange, Switches } from '../src/calib';
import { KEYMAP } from '../../prefs/src/keymap';

const BF_FIXTURES = join(__dirname, '..', '..', 'sim-core', 'test', 'fixtures', 'betafpv');
const ax = (index: number): SwitchInput => ({ kind: 'axis', index });
const btn = (bit: number): SwitchInput => ({ kind: 'button', bit });
/** A frame with 8 axes at -1 (switches low) and the given ones set; v from microseconds. */
function frame(us: Record<number, number> = {}, buttons = 0): RawFrame {
    const axes = new Float32Array(8).fill(-1);
    axes[0] = 0; axes[1] = 0; axes[3] = 0;
    for (const [i, u] of Object.entries(us)) axes[Number(i)] = (u - 1500) / 512;
    return { t: 0, axes, buttons };
}
const sw = (...ranges: SwitchRange[]): Switches => ({ v: 1, ranges });
const r = (fn: SwitchFn, input: SwitchInput, lo: number, hi: number, and = false): SwitchRange => ({ fn, input, lo, hi, ...(and ? { and: true as const } : {}) });

const PROFILE: Profile = {
    version: 1, deviceKey: 'hid:1209:4f54:TX16S:19', deviceName: 'TX16S', deadband: 0, created: '2026-10-13T00:00:00.000Z', wizard: 2, angleMode: null,
    axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -1, on: 1 }
};

describe('channel values and Betaflight\'s range test', () => {
    it('an axis is 1500 + 512 v, clamped to 900..2099; a button 2012 / 988; a missing input null', () => {
        expect(channelUs(ax(4), frame({ 4: 988 }))).toBeCloseTo(988, 3);
        expect(channelUs(ax(4), { t: 0, axes: Float32Array.from([0, 0, 0, 0, 0]), buttons: 0 })).toBe(1500);
        expect(channelUs(ax(4), { t: 0, axes: Float32Array.from([0, 0, 0, 0, 1.3]), buttons: 0 })).toBe(2099);
        expect(channelUs(ax(4), { t: 0, axes: Float32Array.from([0, 0, 0, 0, -1.3]), buttons: 0 })).toBe(900);
        expect(channelUs(ax(9), frame())).toBeNull();
        expect(channelUs(btn(2), frame({}, 0b100))).toBe(2012);
        expect(channelUs(btn(2), frame({}, 0b011))).toBe(988);
    });

    it('start is in, end is out; the clamp keeps full travel inside a range ending at 2100', () => {
        const low = r('angle', ax(5), 900, 1300), mid = r('horizon', ax(5), 1300, 1700), high = r('arm', ax(4), 1700, 2100);
        expect(rangeOn(low, frame({ 5: 1300 }))).toBe(false);
        expect(rangeOn(mid, frame({ 5: 1300 }))).toBe(true);
        expect(rangeOn(low, frame({ 5: 900 }))).toBe(true);
        expect(rangeOn(high, { t: 0, axes: Float32Array.from([0, 0, 0, 0, 1.3]), buttons: 0 })).toBe(true);
        // control: an inclusive end puts 1300 in both bands of a 3-position switch
        const inclusive = (x: SwitchRange, f: RawFrame) => { const u = channelUs(x.input, f)!; return u >= x.lo && u <= x.hi; };
        expect(inclusive(low, frame({ 5: 1300 })) && inclusive(mid, frame({ 5: 1300 }))).toBe(true);
    });

    it('one naming of an input: a USB radio by its channel (buttons CH9..), a gamepad by its axis number or "button n"', () => {
        expect(inputName(ax(5), 'hid')).toEqual({ kind: 'ch', n: 6 });
        expect(inputName(btn(2), 'hid')).toEqual({ kind: 'ch', n: 11 });
        expect(inputName(ax(5), 'gamepad')).toEqual({ kind: 'ch', n: 6 });
        expect(inputName(btn(2), 'gamepad')).toEqual({ kind: 'button', n: 3 });
        // control: the radio's channel layout on a gamepad's button (what the HUD said in v0.7) is CH11, not button 3
        expect(channelOf(btn(2))).toBe(11);
        expect(inputName(btn(2), 'gamepad')).not.toEqual({ kind: 'ch', n: channelOf(btn(2)) });
    });
});

/** Betaflight's updateMasksForMac / updateActivatedModes, transcribed as an oracle (bit per function). */
function oracle(s: Switches, f: RawFrame, fns: readonly SwitchFn[]): Record<string, boolean> {
    const andMask = new Set<SwitchFn>(), newMask = new Set<SwitchFn>();
    for (const m of s.ranges) {
        if (andMask.has(m.fn) || !newMask.has(m.fn)) {
            const active = rangeOn(m, f);
            if (!m.and) { if (active) { andMask.delete(m.fn); newMask.add(m.fn); } }
            else { andMask.add(m.fn); if (!active) newMask.add(m.fn); }
        }
    }
    return Object.fromEntries(fns.map((fn) => [fn, newMask.has(fn) !== andMask.has(fn)]));
}

describe('OR and AND as Betaflight', () => {
    const FNS: SwitchFn[] = ['arm', 'angle', 'horizon'];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const grid = () => 900 + 25 * Math.floor(rnd() * 49);
    function randomCase(): { s: Switches; f: RawFrame } {
        const n = 1 + Math.floor(rnd() * 6);
        const ranges: SwitchRange[] = [];
        for (let i = 0; i < n; i++) {
            let lo = grid(), hi = grid();
            if (lo > hi) [lo, hi] = [hi, lo];
            if (lo === hi) hi = Math.min(2100, lo + 25);
            if (lo === hi) lo -= 25;
            ranges.push(r(FNS[Math.floor(rnd() * 3)], ax(4 + Math.floor(rnd() * 3)), lo, hi, rnd() < 0.5));
        }
        return { s: sw(...ranges), f: frame({ 4: grid(), 5: grid(), 6: grid() }) };
    }

    it('fnOn agrees with the firmware\'s mask algorithm on 20 000 random cases; control: "all ranges AND" and "AND ignored" do not', () => {
        let naiveAll = 0, naiveOr = 0;
        for (let k = 0; k < 20000; k++) {
            const { s, f } = randomCase();
            const want = oracle(s, f, FNS);
            for (const fn of FNS) {
                expect(fnOn(s, fn, f)).toBe(want[fn]);
                const mine = s.ranges.filter((x) => x.fn === fn);
                if (mine.length && mine.every((x) => rangeOn(x, f)) !== want[fn]) naiveAll++;
                if (mine.some((x) => rangeOn(x, f)) !== want[fn]) naiveOr++;
            }
        }
        expect(naiveAll).toBeGreaterThan(100);
        expect(naiveOr).toBeGreaterThan(100);
    });

    it('Angle wins over Horizon, neither is Acro; no mode range: null (the pilot\'s mode)', () => {
        const s = sw(r('angle', ax(5), 1500, 2100), r('horizon', ax(5), 1300, 2100));
        expect(rangesMode(s, frame({ 5: 1900 }))).toBe('angle');
        expect(rangesMode(s, frame({ 5: 1400 }))).toBe('horizon');
        expect(rangesMode(s, frame({ 5: 1000 }))).toBe('acro');
        expect(rangesMode(sw(r('arm', ax(4), 1700, 2100)), frame())).toBeNull();
    });
});

describe('the pilot\'s case: flight mode on CH5, arm on CH6', () => {
    const p: Profile = { ...PROFILE, switches: sw(r('arm', ax(5), 1700, 2100), r('angle', ax(4), 900, 1300), r('horizon', ax(4), 1300, 1700)) };
    it('mapFrame: CH6 high arms, CH5 low / middle / high is angle / horizon / acro', () => {
        const out = new Float32Array(8);
        const cases: [number, number, number, FlightMode][] = [[1000, 1000, -1, 'angle'], [1000, 2000, 1, 'angle'], [1500, 2000, 1, 'horizon'], [2000, 2000, 1, 'acro']];
        for (const [ch5, ch6, arm, mode] of cases) {
            mapFrame(p, frame({ 4: ch5, 5: ch6 }), out);
            expect([out[4], out[5]]).toEqual([arm, MODE_CHANNEL[mode]]);
            expect(profileArmLevel(p, frame({ 4: ch5, 5: ch6 }), new ArmLatch())).toBe(arm === 1);
        }
        expect(radioSetsMode(p)).toBe(true);
        expect(armByRanges(p)).toBe(true);
        // control: the same radio without switches arms on CH5 (the wizard's) and leaves the mode to the pilot
        mapFrame(PROFILE, frame({ 4: 2000, 5: 1000 }), out);
        expect(out[4]).toBe(1);
        expect(radioSetsMode(PROFILE)).toBe(false);
    });

    it('switches with no arm range keep the wizard\'s arm; with no mode range the pilot\'s mode', () => {
        const q: Profile = { ...PROFILE, modeSwitch: { input: ax(5), modes: ['acro', 'horizon', 'angle'] }, switches: sw(r('record.toggle', ax(6), 1700, 2100)) };
        expect(profileArmLevel(q, frame({ 4: 2000 }), new ArmLatch())).toBe(true);
        expect(armByRanges(q)).toBe(false);
        expect(radioSetsMode(q)).toBe(false); // switches present: the wizard's mode switch is not read
        expect(radioSetsMode({ ...q, switches: undefined })).toBe(true);
    });
});

describe('the wizard\'s result is the default', () => {
    const MODES: SwitchModes[] = [];
    for (const a of ['acro', 'angle', 'horizon'] as FlightMode[]) for (const b of ['acro', 'angle', 'horizon'] as FlightMode[]) for (const c of ['acro', 'angle', 'horizon'] as FlightMode[]) MODES.push([a, b, c]);

    /** Arm and mode of a profile with and without its switches over a sweep of CH5 and CH6; disagreements away from a band edge. */
    function compare(p: Profile, conv: (p: Profile) => Switches): { same: number; all: number; farOff: number } {
        const withSw: Profile = { ...p, switches: conv(p) };
        const a = new Float32Array(8), b = new Float32Array(8);
        let same = 0, all = 0, farOff = 0;
        for (let i = -100; i <= 100; i += 2) for (let j = -100; j <= 100; j += 4) {
            const f: RawFrame = { t: 0, axes: Float32Array.from([0, 0, -1, 0, i / 100, j / 100, 0, 0]), buttons: 0 };
            mapFrame(p, f, a);
            mapFrame(withSw, f, b);
            all++;
            if (a[4] === b[4] && a[5] === b[5]) { same++; continue; }
            // only next to a threshold (the 25 us grid against the wizard's exact level)
            const near = (v: number, edges: number[]) => edges.some((e) => Math.abs(1500 + 512 * v - e) <= 25);
            if (!near(i / 100, [1500 + 512 * 0.4985]) && !near(j / 100, [1329.3, 1670.7])) farOff++;
        }
        return { same, all, farOff };
    }

    it('arm switch and each of the 27 mode-switch settings: same arm and mode except within 25 us of a threshold', () => {
        for (const modes of MODES) {
            const p: Profile = { ...PROFILE, modeSwitch: { input: ax(5), modes } };
            const c = compare(p, switchesFromProfile);
            expect(c.farOff, modes.join('/')).toBe(0);
            expect(c.same / c.all, modes.join('/')).toBeGreaterThan(0.9);
        }
    });

    it('a held arm button and an inverted one become ranges; a latching button and Space stay the wizard\'s', () => {
        expect(switchesFromProfile({ ...PROFILE, arm: { kind: 'button', bit: 3 } }).ranges).toEqual([r('arm', btn(3), 1500, 2100)]);
        expect(switchesFromProfile({ ...PROFILE, arm: { kind: 'button', bit: 3, inverted: true } }).ranges).toEqual([r('arm', btn(3), 900, 1500)]);
        expect(switchesFromProfile({ ...PROFILE, arm: { kind: 'button', bit: 3, toggle: true } }).ranges).toEqual([]);
        expect(switchesFromProfile({ ...PROFILE, arm: { kind: 'key' } }).ranges).toEqual([]);
        expect(switchesFromProfile({ ...PROFILE, arm: { kind: 'axis', index: 4, threshold: 0, onAbove: false } }).ranges).toEqual([r('arm', ax(4), 900, 1500)]);
    });

    it('control: a conversion with the arm direction flipped disagrees far from any threshold', () => {
        const flipped = (p: Profile): Switches => {
            const s = switchesFromProfile(p);
            s.ranges = s.ranges.map((x) => (x.fn === 'arm' ? { ...x, lo: 900, hi: x.lo } : x));
            return s;
        };
        expect(compare(PROFILE, flipped).farOff).toBeGreaterThan(100);
    });
});

describe('flight-mode positions', () => {
    it('positions -> ranges -> positions round-trips all 27 settings on a 3-position switch and 9 on a button', () => {
        for (const a of ['acro', 'angle', 'horizon'] as FlightMode[]) for (const b of ['acro', 'angle', 'horizon'] as FlightMode[]) for (const c of ['acro', 'angle', 'horizon'] as FlightMode[]) {
            const s = setModePositions(sw(r('arm', ax(6), 1700, 2100)), ax(5), [a, b, c]);
            expect(modePositions(s, ax(5))).toEqual([a, b, c]);
            expect(s.ranges.filter((x) => x.fn === 'arm')).toHaveLength(1);
            const k = setModePositions(sw(), btn(1), [a, b, c]);
            expect([modePositions(k, btn(1))[0], modePositions(k, btn(1))[2]]).toEqual([a, c]);
        }
        // neighbours with the same mode merge: angle low and middle is one range 900..1675
        expect(setModePositions(sw(), ax(5), ['angle', 'angle', 'acro']).ranges).toEqual([r('angle', ax(5), 900, 1675)]);
        expect(modeInput(setModePositions(sw(), ax(5), ['angle', 'horizon', 'acro']))).toEqual(ax(5));
        expect(modeInput(sw(r('angle', ax(5), 900, 1300), r('horizon', ax(6), 900, 1300)))).toBeNull();
    });

    it('a level falls in its position band; the bands are the wizard\'s thirds on the 25 us grid', () => {
        expect(POSITION_BANDS).toEqual([[900, 1325], [1325, 1675], [1675, 2100]]);
        expect(bandOf(ax(5), 988)).toEqual([900, 1325]);
        expect(bandOf(ax(5), 1500)).toEqual([1325, 1675]);
        expect(bandOf(ax(5), 2099)).toEqual([1675, 2100]);
        expect(bandOf(btn(0), 2012)).toEqual([1500, 2100]);
    });
});

describe('stored switches are checked', () => {
    it('keeps the good ranges, drops the rest (off the grid, empty, unknown function or input), at most 20', () => {
        const good = r('arm', ax(5), 1700, 2100);
        const res = readSwitches({ v: 1, ranges: [good, { ...good, lo: 1710 }, { ...good, lo: 2100 }, { ...good, fn: 'turbo' }, { ...good, input: { kind: 'axis', index: 40 } }, { ...good, and: 'yes' }] });
        expect(res.switches).toEqual(sw(good));
        expect(res.dropped).toBe(5);
        expect(readSwitches({ v: 1, ranges: Array.from({ length: 25 }, () => good) }).switches?.ranges).toHaveLength(20);
        expect(readSwitches({ v: 2, ranges: [] }).switches).toBeNull();
        expect(readSwitches('arm').switches).toBeNull();
    });
});

describe('actions run on the switch edge', () => {
    it('never on the first frame, once per flip on, never while held; a range added later starts quiet', () => {
        const w = new SwitchActionWatch();
        const s = sw(r('respawn.rewind', ax(6), 1700, 2100));
        expect(w.update(s, frame({ 6: 2000 }))).toEqual([]); // already on when first seen
        expect(w.update(s, frame({ 6: 2000 }))).toEqual([]);
        expect(w.update(s, frame({ 6: 1000 }))).toEqual([]);
        expect(w.update(s, frame({ 6: 2000 }))).toEqual(['respawn.rewind']);
        expect(w.update(s, frame({ 6: 2000 }))).toEqual([]);
        const more = sw(...s.ranges, r('record.toggle', ax(7), 1700, 2100));
        expect(w.update(more, frame({ 6: 1000, 7: 2000 }))).toEqual([]);
        expect(w.update(more, frame({ 6: 2000, 7: 1000 }))).toEqual(['respawn.rewind']);
        expect(w.update(more, frame({ 6: 2000, 7: 2000 }))).toEqual(['record.toggle']);
        w.reset();
        expect(w.update(more, frame({ 6: 2000, 7: 2000 }))).toEqual([]);
        // control: firing on the level (not the edge) would run the rewind every frame it is held
        const level = (x: Switches, f: RawFrame) => SWITCH_ACTIONS.filter((a) => x.ranges.some((y) => y.fn === a) && fnOn(x, a, f));
        expect(level(s, frame({ 6: 2000 }))).toEqual(['respawn.rewind']);
    });

    it('every switch action is a shipped, routed keymap action', () => {
        for (const a of SWITCH_ACTIONS) {
            const b = KEYMAP.find((k) => k.action === a);
            expect(b, a).toBeDefined();
            expect(b!.status, a).toBe('shipped');
            expect(b!.flying, a).toBeUndefined();
        }
    });
});

describe('Betaflight aux import', () => {
    const read = (name: string) => parseBetaflightDiff(readFileSync(join(BF_FIXTURES, name), 'utf8'));

    it('BetaFPV Pavo20 Pro, ELRS: ARM CH5, ANGLE / HORIZON CH6 applied; BEEPER, FLIP OVER AFTER CRASH, USER1 listed as not in the simulator', () => {
        const imp = switchesFromBetaflight(read('pavo20pro-bf450-elrs-20241216.txt').aux);
        expect(imp.switches.ranges).toEqual([r('arm', ax(4), 1700, 2100), r('angle', ax(5), 900, 1300), r('horizon', ax(5), 1300, 1700)]);
        expect(imp.skipped.map((x) => `${x.cond.mode}:${x.why}`)).toEqual(['BEEPER:notInSimulator', 'FLIP OVER AFTER CRASH:notInSimulator', 'USER1:notInSimulator']);
        const p: Profile = { ...PROFILE, arm: { kind: 'key' }, switches: imp.switches };
        const out = new Float32Array(8);
        mapFrame(p, frame({ 4: 2000, 5: 1000 }), out);
        expect([out[4], out[5]]).toEqual([1, MODE_CHANNEL.angle]);
        mapFrame(p, frame({ 4: 1000, 5: 2000 }), out);
        expect([out[4], out[5]]).toEqual([-1, MODE_CHANNEL.acro]);
    });

    it('SBUS variant: arm on CH7, modes on CH5; control: AUX n read as CH n puts the arm on CH3 (the throttle), so CH7 no longer arms', () => {
        const aux = read('pavo20pro-bf450-sbus-20250610.txt').aux;
        const imp = switchesFromBetaflight(aux);
        expect(imp.switches.ranges.slice(0, 3)).toEqual([r('arm', ax(6), 1700, 2100), r('angle', ax(4), 900, 1300), r('horizon', ax(4), 1300, 1700)]);
        expect(channelOf(imp.switches.ranges[0].input)).toBe(7);
        // the pilot flips CH7 with the throttle low: armed
        const out = new Float32Array(8);
        const armed = (s: Switches, f: RawFrame): number => mapFrame({ ...PROFILE, arm: { kind: 'key' }, switches: s }, f, out)[4];
        expect(armed(imp.switches, frame({ 6: 2000 }))).toBe(1);
        expect(armed(imp.switches, frame({ 6: 1000 }))).toBe(-1);
        // control: the same conditions with AUX n read as CH n (no +4 for the sticks): the arm range sits on
        // the throttle, CH7 does nothing, and full throttle would "arm"
        const broken = switchesFromBetaflight(aux.map((c) => ({ ...c, channel: c.channel - 4 }))).switches;
        expect(channelOf(broken.ranges[0].input)).toBe(3);
        expect(armed(broken, frame({ 6: 2000 }))).toBe(-1);
        expect(armed(broken, frame({ 2: 2000 }))).toBe(1);
    });

    it('channels above 8 arrive as buttons (EdgeTX USB joystick); AND and linked conditions', () => {
        expect(channelInput(9)).toEqual(btn(0));
        expect(channelInput(16)).toEqual(btn(7));
        expect(channelOf(btn(7))).toBe(16);
        const cond = (o: Partial<import('@gsfpv/sim-core').BfAuxCondition>) => ({ slot: 0, modeId: 0, mode: 'ARM', channel: 10, lo: 1700, hi: 2100, and: false, linkedTo: null, ...o });
        const imp = switchesFromBetaflight([cond({}), cond({ slot: 1, mode: 'ANGLE', modeId: 1, and: true }), cond({ slot: 2, mode: 'HORIZON', modeId: 2, linkedTo: 'ANGLE' })]);
        expect(imp.switches.ranges).toEqual([r('arm', btn(1), 1700, 2100), r('angle', btn(1), 1700, 2100, true)]);
        expect(imp.skipped.map((x) => x.why)).toEqual(['linked']);
    });
});

describe('a Betaflight import over the pilot\'s switches (importOver)', () => {
    // the pilot's setup: arm CH6, Angle CH5 low, rewind CH7, record CH8
    const mine = sw(r('arm', ax(5), 1700, 2100), r('angle', ax(4), 900, 1300), r('respawn.rewind', ax(6), 1700, 2100), r('record.toggle', ax(7), 1700, 2100));
    const cond = (o: Partial<import('@gsfpv/sim-core').BfAuxCondition>) => ({ slot: 0, modeId: 0, mode: 'ARM', channel: 5, lo: 1700, hi: 2100, and: false, linkedTo: null, ...o });

    it('the diff\'s ARM / ANGLE replace arm and the mode; rewind and record stay; control: the v0.7 import (the diff\'s switches as they are) lost them', () => {
        const diff = switchesFromBetaflight([cond({}), cond({ slot: 1, modeId: 1, mode: 'ANGLE', channel: 6, lo: 1300, hi: 2100 })]).switches;
        const over = importOver(mine, diff);
        expect(over.switches.ranges).toEqual([r('arm', ax(4), 1700, 2100), r('angle', ax(5), 1300, 2100), r('respawn.rewind', ax(6), 1700, 2100), r('record.toggle', ax(7), 1700, 2100)]);
        expect(over.kept).toEqual([r('respawn.rewind', ax(6), 1700, 2100), r('record.toggle', ax(7), 1700, 2100)]);
        expect([over.dropped, over.noArm, over.noMode]).toEqual([0, false, false]);
        // the kept ranges still run their actions (a copy, not the pilot's objects)
        expect(fnOn(over.switches, 'respawn.rewind', frame({ 6: 2000 }))).toBe(true);
        expect(over.kept[0]).not.toBe(mine.ranges[2]);
        // control: what v0.7 stored, the diff's switches alone
        expect(diff.ranges.some((x) => x.fn === 'respawn.rewind' || x.fn === 'record.toggle')).toBe(false);
    });

    it('a diff without ANGLE / HORIZON leaves the mode to the pilot (noMode), one without ARM to the wizard\'s arm (noArm); the wizard\'s setup has nothing to keep', () => {
        const armOnly = importOver(mine, switchesFromBetaflight([cond({})]).switches);
        expect(armOnly.noMode).toBe(true);
        expect(armOnly.switches.ranges.filter((x) => x.fn === 'angle' || x.fn === 'horizon')).toEqual([]);
        expect(rangesMode(armOnly.switches, frame({ 4: 1000 }))).toBeNull();
        const angleOnly = importOver(mine, switchesFromBetaflight([cond({ mode: 'ANGLE', modeId: 1 })]).switches);
        expect([angleOnly.noArm, angleOnly.noMode]).toEqual([true, false]);
        expect(armByRanges({ ...PROFILE, switches: angleOnly.switches })).toBe(false);
        const fresh = importOver(undefined, switchesFromBetaflight([cond({})]).switches);
        expect([fresh.kept, fresh.dropped]).toEqual([[], 0]);
    });

    it('kept ranges that no longer fit under 20 are counted, never silently lost', () => {
        const many = sw(...Array.from({ length: 6 }, (_, i) => r('hud.toggle', ax(6), 900 + i * 100, 1000 + i * 100)));
        const full = switchesFromBetaflight(Array.from({ length: 17 }, (_, i) => cond({ slot: i, lo: 900 + i * 25, hi: 2100 }))).switches;
        const over = importOver(many, full);
        expect(over.switches.ranges.length).toBe(20);
        expect([over.kept.length, over.dropped]).toEqual([3, 3]);
    });
});
