// A 3-position switch sent as two button bits (the DJI FPV Remote Controller 3's flight-mode and C2
// switches, docs/research/radios/dji-rc3.md) is ONE switch input of kind 'bits' (v0.8 lane B). Through
// every place a switch input goes: positions and ch[5] (mapFrame), microseconds and ranges (switches.ts),
// the Betaflight channel numbers (a device's channel table), saved profiles, the mode-switch watch
// and the wizard's check. Every claim has a negative control that must fire: the same bits read as
// single buttons give two positions, a table-less import lands on the EdgeTX channel, a profile with
// an input an older build cannot read loses that switch and keeps its sticks.
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, parseAuxPaste } from '@gsfpv/sim-core';
import {
    CalibrationWizard, MODE_SWITCH_TUNING, ModeSwitchDetector, channelInput, channelOf, channelUs, inputFromKey, inputKey, inputName,
    mapFrame, modePositions, rangesMode, readChannelTable, setModePositions, switchPos, switchesFromBetaflight, tablePairs, validModeSwitch, validSwitchInput
} from '../src/calib';
import type { Profile, RawFrame, SwitchFlip, SwitchInput, Switches } from '../src/calib';

const LEVEL = MODE_SWITCH_TUNING.LEVEL_MS;
const MODE: SwitchInput = { kind: 'bits', lo: 6, hi: 7 };
const C2: SwitchInput = { kind: 'bits', lo: 4, hi: 5 };
/** The DJI's Betaflight channels (Oscar Liang's RC 3 + O4 map): sticks AETR, AUX1 mode switch, AUX2 C2, then three buttons. */
const DJI_TABLE: SwitchInput[] = [
    { kind: 'axis', index: 0 }, { kind: 'axis', index: 1 }, { kind: 'axis', index: 2 }, { kind: 'axis', index: 3 },
    MODE, C2, { kind: 'button', bit: 1 }, { kind: 'button', bit: 2 }, { kind: 'button', bit: 0 }
];
const frame = (buttons: number): RawFrame => ({ t: 0, axes: new Float32Array([0, 0, -1, 0, 0]), buttons });
const LO = 1 << 6, HI = 1 << 7;

describe('a two-bit switch reads three positions', () => {
    it('lo bit = low, neither = middle, hi bit = high; both (never sent) = middle', () => {
        expect([0, LO, HI, LO | HI].map((b) => switchPos(MODE, frame(b)))).toEqual([1, 0, 2, 1]);
        expect([0, LO, HI].map((b) => channelUs(MODE, frame(b)))).toEqual([1500, 988, 2012]);
        // the other buttons do not move it
        expect(switchPos(MODE, frame(LO | 0b1111))).toBe(0);
    });

    it('control: the same masks through one of its bits as a button read two positions only (the limitation before v0.8)', () => {
        const one: SwitchInput = { kind: 'button', bit: 7 };
        expect(new Set([0, LO, HI].map((b) => switchPos(one, frame(b))))).toEqual(new Set([0, 2]));
    });

    it('as the mode switch: N / S / M give Angle / Horizon / Acro on ch[5]; control: a single-bit switch cannot give Horizon', () => {
        const p = profile({ modeSwitch: { input: MODE, modes: ['angle', 'horizon', 'acro'] } });
        const ch = new Float32Array(8);
        const read = (b: number) => mapFrame(p, frame(b), ch)[5];
        expect([LO, 0, HI].map(read)).toEqual([MODE_CHANNEL.angle, MODE_CHANNEL.horizon, MODE_CHANNEL.acro]);
        const single = profile({ modeSwitch: { input: { kind: 'button', bit: 7 }, modes: ['angle', 'horizon', 'acro'] } });
        const seen = new Set([LO, 0, HI].map((b) => mapFrame(single, frame(b), ch)[5]));
        expect(seen.has(MODE_CHANNEL.horizon)).toBe(false);
    });

    it('as Switches ranges: the three position bands, read back position by position', () => {
        const sw: Switches = setModePositions({ v: 1, ranges: [] }, MODE, ['angle', 'horizon', 'acro']);
        expect(sw.ranges).toEqual([{ fn: 'angle', input: MODE, lo: 900, hi: 1325 }, { fn: 'horizon', input: MODE, lo: 1325, hi: 1675 }]);
        expect([LO, 0, HI].map((b) => rangesMode(sw, frame(b)))).toEqual(['angle', 'horizon', 'acro']);
        expect(modePositions(sw, MODE)).toEqual(['angle', 'horizon', 'acro']);
    });
});

describe('stored and imported: saved profiles keep working', () => {
    it('validSwitchInput reads the new kind and refuses a broken one', () => {
        expect(validSwitchInput({ kind: 'bits', lo: 6, hi: 7, extra: 1 })).toEqual(MODE);
        for (const bad of [{ kind: 'bits', lo: 6, hi: 6 }, { kind: 'bits', lo: -1, hi: 7 }, { kind: 'bits', lo: 6, hi: 24 }, { kind: 'bits', lo: 6.5, hi: 7 }, { kind: 'bits', lo: 6 }]) expect(validSwitchInput(bad)).toBeNull();
        // the kinds every saved profile has are read as before
        expect(validSwitchInput({ kind: 'axis', index: 5 })).toEqual({ kind: 'axis', index: 5 });
        expect(validSwitchInput({ kind: 'button', bit: 3 })).toEqual({ kind: 'button', bit: 3 });
    });

    it('a mode switch saved with the new kind round-trips through JSON', () => {
        const ms = { input: MODE, modes: ['angle', 'horizon', 'acro'] };
        expect(validModeSwitch(JSON.parse(JSON.stringify(ms)))).toEqual(ms);
    });

    it('control: a reader from before v0.8 (axis and button only) drops that mode switch and nothing else', () => {
        // the pre-v0.8 validSwitchInput, verbatim in effect: an input it cannot read is null, so the
        // profile loads without its mode switch (controls.ts checkProfile's rule) and keeps its sticks
        const oldRead = (v: { kind?: string; index?: number; bit?: number }): unknown =>
            (v.kind === 'axis' && Number.isInteger(v.index)) || (v.kind === 'button' && Number.isInteger(v.bit)) ? v : null;
        expect(oldRead(MODE)).toBeNull();
        expect(oldRead({ kind: 'axis', index: 5 })).not.toBeNull();
    });

    it('readChannelTable: a table is read entry by entry; a duplicate or a broken entry refuses it (names fall back)', () => {
        expect(readChannelTable(JSON.parse(JSON.stringify(DJI_TABLE)))).toEqual(DJI_TABLE);
        expect(readChannelTable([...DJI_TABLE, MODE])).toBeNull();
        expect(readChannelTable([{ kind: 'bits', lo: 1, hi: 1 }])).toBeNull();
        expect(readChannelTable('CH5')).toBeNull();
        expect(readChannelTable([])).toBeNull();
        expect(readChannelTable([{ kind: 'button', bit: 0 }, { kind: 'button', bit: 1 }, { kind: 'button', bit: 0 }])).toBeNull();
        // Betaflight's 18 channels: a longer table is cut there (entries past it are never read)
        expect(readChannelTable(new Array(20).fill(0).map((_, i) => ({ kind: 'button', bit: i })))?.length).toBe(18);
    });

    it('inputKey / inputFromKey round-trip every kind; control: a malformed key is null', () => {
        for (const i of [{ kind: 'axis', index: 4 }, { kind: 'button', bit: 11 }, MODE] as SwitchInput[]) expect(inputFromKey(inputKey(i))).toEqual(i);
        expect(inputFromKey('p6.6')).toBeNull();
        expect(inputFromKey('x1')).toBeNull();
    });
});

describe('Betaflight channel numbers: a device channel table puts a two-bit switch on ONE channel', () => {
    it('with the DJI table the flight-mode switch is CH5 (AUX1), C2 CH6; buttons outside it are named as buttons', () => {
        expect(channelOf(MODE, DJI_TABLE)).toBe(5);
        expect(channelOf(C2, DJI_TABLE)).toBe(6);
        expect(channelOf({ kind: 'button', bit: 2 }, DJI_TABLE)).toBe(8);
        expect(inputName(MODE, 'hid', DJI_TABLE)).toEqual({ kind: 'ch', n: 5 });
        expect(inputName(MODE, 'gamepad', DJI_TABLE)).toEqual({ kind: 'ch', n: 5 });
        expect(inputName({ kind: 'button', bit: 3 }, 'hid', DJI_TABLE)).toEqual({ kind: 'button', n: 4 });
        expect(inputName({ kind: 'axis', index: 4 }, 'hid', DJI_TABLE)).toEqual({ kind: 'axis', n: 5 });
        expect(channelInput(5, DJI_TABLE)).toEqual(MODE);
    });

    it('control: without a table the EdgeTX numbering is unchanged, and a two-bit switch has no single channel', () => {
        expect(channelOf({ kind: 'axis', index: 4 })).toBe(5);
        expect(channelOf({ kind: 'button', bit: 2 })).toBe(11);
        expect(channelOf(MODE)).toBeNull();
        expect(inputName(MODE, 'hid')).toEqual({ kind: 'chs', a: 15, b: 16 });
        expect(inputName(MODE, 'gamepad')).toEqual({ kind: 'buttons', a: 7, b: 8 });
        expect(channelInput(5)).toEqual({ kind: 'axis', index: 4 });
        expect(channelInput(11)).toEqual({ kind: 'button', bit: 2 });
    });

    it('a diff from a DJI-flown quad (Angle low, Horizon middle on AUX1) lands on the DJI flight-mode switch; control: without the table on CH5 of an EdgeTX radio', () => {
        const r = parseAuxPaste('aux 0 1 0 900 1300 0 0\naux 1 2 0 1300 1700 0 0');
        expect(r?.errors).toEqual([]);
        const dji = switchesFromBetaflight(r!.aux, DJI_TABLE).switches;
        expect(dji.ranges.map((x) => x.input)).toEqual([MODE, MODE]);
        expect([LO, 0, HI].map((b) => rangesMode(dji, frame(b)))).toEqual(['angle', 'horizon', 'acro']);
        const edgetx = switchesFromBetaflight(r!.aux).switches;
        expect(edgetx.ranges.map((x) => x.input)).toEqual([{ kind: 'axis', index: 4 }, { kind: 'axis', index: 4 }]);
    });

    it('a channel past the device\'s table is not on that radio: never put on a control the table numbers otherwise (review R2)', () => {
        // the DJI has 9 channels: CH10 (AUX6), CH11 (AUX7), CH13, CH15 do not exist on it; under the
        // EdgeTX numbering they would be buttons 2, 3, 5, 7: the pause/RTH and start/stop buttons and
        // single bits of the C2 and mode switches
        for (const ch of [10, 11, 13, 15, 16]) expect(channelInput(ch, DJI_TABLE)).toBeNull();
        expect(channelInput(9, DJI_TABLE)).toEqual({ kind: 'button', bit: 0 }); // its last channel (AUX5, C1)
        // a quad armed on AUX7 (CH11) with Angle on AUX1: ARM is left out with its reason, Angle lands on the mode switch
        const r = parseAuxPaste('aux 0 0 6 1700 2100 0 0\naux 1 1 0 900 1300 0 0');
        expect(r?.errors).toEqual([]);
        const imp = switchesFromBetaflight(r!.aux, DJI_TABLE);
        expect(imp.switches.ranges.map((x) => [x.fn, x.input])).toEqual([['angle', MODE]]);
        expect(imp.applied.map((c) => c.mode)).toEqual(['ANGLE']);
        expect(imp.skipped.map((x) => `${x.cond.mode}:${x.cond.channel}:${x.why}`)).toEqual(['ARM:11:notOnRadio']);
    });

    it('control: without a table every channel keeps the EdgeTX USB numbering (CH11 = button 3), so the same paste arms on it', () => {
        expect(channelInput(11)).toEqual({ kind: 'button', bit: 2 });
        expect(channelInput(32)).toEqual({ kind: 'button', bit: 23 });
        const r = parseAuxPaste('aux 0 0 6 1700 2100 0 0\naux 1 1 0 900 1300 0 0');
        const imp = switchesFromBetaflight(r!.aux);
        expect(imp.switches.ranges.map((x) => [x.fn, x.input])).toEqual([['arm', { kind: 'button', bit: 2 }], ['angle', { kind: 'axis', index: 4 }]]);
        expect(imp.skipped).toEqual([]);
    });

    it('tablePairs lists the two-bit switches of a table', () => {
        expect(tablePairs(DJI_TABLE)).toEqual([{ lo: 6, hi: 7 }, { lo: 4, hi: 5 }]);
        expect(tablePairs(undefined)).toEqual([]);
    });
});

/** Feed a detector from 0 to `ms` at 250 Hz with `buttons(t)`; every flip it reports. */
function run(det: ModeSwitchDetector, buttons: (t: number) => number, ms: number): SwitchFlip[] {
    const out: SwitchFlip[] = [];
    const f: RawFrame = { t: 0, axes: new Float32Array(5), buttons: 0 };
    for (let t = 0; t <= ms; t += 4) { f.t = t; f.buttons = buttons(t); const fl = det.feed(f); if (fl) out.push(fl); }
    return out;
}

describe('the mode-switch watch sees a two-bit switch as one switch', () => {
    // the recording's switch rests at bit 6 (0x40 with bit 4 of the other switch: 0x50)
    const REST = (1 << 4) | LO;

    it('a pair named up front: a flip into the middle is that switch (low -> middle), then middle -> high', () => {
        const det = new ModeSwitchDetector();
        det.pairs([{ lo: 6, hi: 7 }, { lo: 4, hi: 5 }]);
        const flips = run(det, (t) => (t < 800 ? REST : t < 1800 ? 1 << 4 : (1 << 4) | HI), 2600);
        expect(flips).toEqual([{ input: MODE, from: 0, to: 1 }, { input: MODE, from: 1, to: 2 }]);
    });

    it('control: the same flips with no pair named: the middle flip is bit 6 released, the next one bit 7 pressed (two buttons)', () => {
        const det = new ModeSwitchDetector();
        const flips = run(det, (t) => (t < 800 ? REST : t < 1800 ? 1 << 4 : (1 << 4) | HI), 2600);
        expect(flips.map((f) => f.input)).toEqual([{ kind: 'button', bit: 6 }, { kind: 'button', bit: 7 }]);
    });

    it('an unknown pair is learned from an end-to-end flip (the recording: through the middle in 28-62 ms, or in one report), and is one switch from then on', () => {
        for (const gap of [0, 28, 62]) {
            const det = new ModeSwitchDetector();
            const flips = run(det, (t) => (t < 800 ? REST : t < 800 + gap ? 1 << 4 : t < 2000 ? (1 << 4) | HI : 1 << 4), 2800);
            expect(flips, `gap ${gap}`).toEqual([{ input: MODE, from: 0, to: 2 }, { input: MODE, from: 2, to: 1 }]);
            expect(det.knownPairs()).toEqual([{ lo: 6, hi: 7 }]);
        }
    });

    it('the other end coming on a little after the first went off, and going off a little after the other came on: the same pair', () => {
        const det = new ModeSwitchDetector();
        // hi comes on at 800, lo goes off 40 ms later (both ends held then)
        expect(run(det, (t) => (t < 800 ? LO : t < 840 ? LO | HI : HI), 2000)).toEqual([{ input: MODE, from: 0, to: 2 }]);
    });

    it('control: two buttons, one released and another pressed a second later, are two buttons, not a switch', () => {
        const det = new ModeSwitchDetector();
        const flips = run(det, (t) => (t < 800 ? 1 << 2 : t < 1800 ? 0 : 1 << 3), 2600);
        expect(flips.map((f) => f.input)).toEqual([{ kind: 'button', bit: 2 }, { kind: 'button', bit: 3 }]);
        expect(det.knownPairs()).toEqual([]);
    });

    it('control: a pair with an excluded bit (the arm) is never reported, and its flips are not taken as the other bit alone', () => {
        const det = new ModeSwitchDetector();
        det.exclude([], [7]);
        det.pairs([{ lo: 6, hi: 7 }]);
        expect(run(det, (t) => (t < 800 ? LO : t < 1600 ? 0 : HI), 2400)).toEqual([]);
    });

    it('it is found only once the new position held LEVEL_MS', () => {
        const det = new ModeSwitchDetector();
        det.pairs([{ lo: 6, hi: 7 }]);
        expect(run(det, (t) => (t < 800 ? LO : 0), 800 + LEVEL - 12)).toEqual([]);
    });

    it('reset() forgets a learned pair but keeps the named ones', () => {
        const det = new ModeSwitchDetector();
        det.pairs([{ lo: 4, hi: 5 }]);
        run(det, (t) => (t < 800 ? LO : HI), 1600);
        expect(det.knownPairs()).toEqual([{ lo: 4, hi: 5 }, { lo: 6, hi: 7 }]);
        det.reset();
        expect(det.knownPairs()).toEqual([{ lo: 4, hi: 5 }]);
    });
});

function profile(extra: Partial<Profile> = {}): Profile {
    return {
        version: 1, deviceKey: 'hid:2ca3:1021:HID Interface:13:d', deviceName: 'DJI', created: '', wizard: 2, deadband: 0, angleMode: null,
        axes: {
            roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 },
            throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 }
        },
        arm: { kind: 'button', bit: 2, toggle: true },
        ...extra
    };
}

describe('the wizard check screen with a recognised device', () => {
    function rig(p: Profile) {
        const w = CalibrationWizard.resume(p);
        w.auto = true;
        w.start(0);
        let t = 0;
        const f: RawFrame = { t: 0, axes: new Float32Array([0, 0, -1, 0, 0]), buttons: 0 };
        const feed = (ms: number, buttons: number) => { const end = t + ms; while (t < end) { t += 4; f.t = t; f.buttons = buttons; w.feed(f); } };
        return { w, feed };
    }

    it('its channel table names the pairs: a flip of the mode switch into its middle is the 3-position switch at once', () => {
        const { w, feed } = rig(profile({ channels: DJI_TABLE, known: 'dji-virtual-joystick' }));
        feed(600, (1 << 4) | LO);
        feed(600, 1 << 4);
        expect(w.state.modeSwitch?.sw?.input).toEqual(MODE);
        expect(w.state.modeSwitch?.pos).toBe(1);
        feed(600, (1 << 4) | HI);
        expect(w.state.modeSwitch?.seen).toEqual([true, true, true]);
        expect(w.state.profile?.channels).toEqual(DJI_TABLE);
        expect(w.state.profile?.known).toBe('dji-virtual-joystick');
    });

    it('control: without the table the same middle flip is one button (2 positions); an end-to-end flip later makes it the switch, each end keeping its mode', () => {
        const { w, feed } = rig(profile());
        feed(600, LO);
        feed(600, 0);
        expect(w.state.modeSwitch?.sw).toEqual({ input: { kind: 'button', bit: 6 }, modes: ['acro', 'horizon', 'angle'] });
        // bit 6 "pressed" (the low end) gave Angle: as a pair that end is position 0
        feed(600, HI);
        feed(600, LO);
        expect(w.state.modeSwitch?.sw).toEqual({ input: MODE, modes: ['angle', 'horizon', 'acro'] });
    });

    it('Set again keeps the channel table and the known id (they come with the device, the wizard does not measure them)', () => {
        const { w, feed } = rig(profile({ channels: DJI_TABLE, known: 'dji-virtual-joystick' }));
        feed(400, 0);
        expect(w.redo('yaw').ok).toBe(true);
        expect(w.back()).toBe(true);
        expect(w.state.profile?.channels).toEqual(DJI_TABLE);
        expect(w.state.profile?.known).toBe('dji-virtual-joystick');
        // a fresh wizard told about the device keeps them in what it builds
        const fresh = new CalibrationWizard('k', 'n', { channels: DJI_TABLE, known: 'x' });
        expect((fresh as unknown as { device: unknown }).device).toEqual({ channels: DJI_TABLE, known: 'x' });
    });
});
