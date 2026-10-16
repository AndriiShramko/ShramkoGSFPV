// Known controllers (v0.8 lane B, the owner's item 4: "plug the DJI controller in and everything
// works"): the DJI FPV Remote Controller 3 is recognised on both paths (WebHID by its ids and the shape
// of its descriptor, the Gamepad API by the ids in its id string and its counts) and flies with a
// ready profile: sticks Mode 2 at full range, the flight-mode switch as one 3-position switch, its
// Betaflight channel table. Negative controls: the same ids with another shape, another device with
// the same shape, and a pad with the DJI ids but not its axes are not the DJI; an EdgeTX radio is
// recognised by name and keeps the wizard.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL } from '@gsfpv/sim-core';
import {
    KNOWN_DEVICES, USAGE, applyDeadband, gamepadUsbIds, knownDevice, knownProfile, makeHidReader, mapFrame, recognise, seenFromGamepad, seenFromHid
} from '../src/index';
import type { KnownDevice, Profile, RawFrame } from '../src/index';
import { DJI_RC3, DJI_RC3_WINDOWS, EDGETX_CLASSIC, djiRc3Report, edgeTxAdvanced } from '../src/sim/devices';
import { DJI_RC3_STIR } from './fixtures/dji-rc3-stir';

const DJI_ID_CHROME = 'HID Interface (Vendor: 2ca3 Product: 1021)';
const DJI_ID_FIREFOX = '2ca3-1021-DJI Virtual Joystick';
const pad = (id: string, axes: number, buttons: number) => ({ id, axes: { length: axes }, buttons: { length: buttons } });

function djiProfile(path: 'hid' | 'gamepad'): Profile {
    const m = path === 'hid' ? recognise(seenFromHid(DJI_RC3)) : recognise(seenFromGamepad(pad(DJI_ID_CHROME, 5, 24)));
    expect(m?.device.id).toBe('dji-virtual-joystick');
    const p = knownProfile(m!, 'key', 'DJI');
    expect(p).not.toBeNull();
    return p!;
}

describe('the DJI FPV Remote Controller 3 is recognised', () => {
    it('over WebHID, in both descriptor shapes Chromium gives (descriptor order, Windows preparsed data)', () => {
        for (const spec of [DJI_RC3, DJI_RC3_WINDOWS]) {
            const m = recognise(seenFromHid(spec));
            expect(m?.device.id, spec.name).toBe('dji-virtual-joystick');
            expect([USAGE.X, USAGE.Y, USAGE.Z, USAGE.Rx, USAGE.Ry].map((u) => m!.axisIndex(u))).toEqual([0, 1, 2, 3, 4]);
        }
    });

    it('over the Gamepad API, by the ids in Chrome\'s and Firefox\'s id strings and its 5 axes', () => {
        for (const id of [DJI_ID_CHROME, DJI_ID_FIREFOX]) expect(recognise(seenFromGamepad(pad(id, 5, 24)))?.device.id, id).toBe('dji-virtual-joystick');
        expect(gamepadUsbIds(DJI_ID_CHROME)).toEqual({ vendorId: 0x2ca3, productId: 0x1021 });
        expect(gamepadUsbIds('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)')).toEqual({ vendorId: 0x045e, productId: 0x02fd });
        expect(gamepadUsbIds('Some pad')).toBeNull();
    });

    it('control: the same USB ids with another shape (DJI reuses 2ca3:1021: 2 axes, other ranges, no buttons) are not it', () => {
        const twoAxes = { ...DJI_RC3_WINDOWS, collections: [{ ...DJI_RC3_WINDOWS.collections[0], inputReports: [{ reportId: 0, items: DJI_RC3_WINDOWS.collections[0].inputReports![0].items!.filter((it) => !(it.usages && (it.usages[0] & 0xffff) >= 0x32 && (it.usages[0] & 0xffff) <= 0x34)) }] }] };
        expect(seenFromHid(twoAxes).axisCount).toBe(2);
        expect(recognise(seenFromHid(twoAxes))).toBeNull();
        const otherRange = { ...DJI_RC3_WINDOWS, collections: [{ ...DJI_RC3_WINDOWS.collections[0], inputReports: [{ reportId: 0, items: DJI_RC3_WINDOWS.collections[0].inputReports![0].items!.map((it) => (it.reportSize === 16 ? { ...it, logicalMinimum: -1024, logicalMaximum: 1024 } : it)) }] }] };
        expect(recognise(seenFromHid(otherRange))).toBeNull();
        const noButtons = { ...DJI_RC3_WINDOWS, collections: [{ ...DJI_RC3_WINDOWS.collections[0], inputReports: [{ reportId: 0, items: DJI_RC3_WINDOWS.collections[0].inputReports![0].items!.filter((it) => it.reportSize === 16) }] }] };
        expect(recognise(seenFromHid(noButtons))).toBeNull();
        expect(recognise(seenFromGamepad(pad(DJI_ID_CHROME, 2, 24)))).toBeNull();
        expect(recognise(seenFromGamepad(pad(DJI_ID_CHROME, 5, 2)))).toBeNull();
    });

    it('control: the DJI\'s shape under other USB ids is not it (the ids are required, not only the shape)', () => {
        expect(recognise(seenFromHid({ ...DJI_RC3, vendorId: 0x1234 }))).toBeNull();
        expect(recognise(seenFromGamepad(pad('HID Interface (Vendor: 1234 Product: 1021)', 5, 24)))).toBeNull();
        expect(recognise(seenFromGamepad(pad('HID Interface', 5, 24)))).toBeNull();
    });
});

describe('the DJI flies out of the box', () => {
    it('its profile: Mode 2 sticks at full range, the start/stop button toggles the arm, the flight-mode switch is one 3-position switch, its Betaflight channels', () => {
        for (const path of ['hid', 'gamepad'] as const) {
            const p = djiProfile(path);
            expect(p.axes).toEqual({
                roll: { index: 0, invert: false, center: 0, min: -1, max: 1 },
                pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 },
                throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 },
                yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 }
            });
            expect(p.arm).toEqual({ kind: 'button', bit: 2, toggle: true });
            expect(p.modeSwitch).toEqual({ input: { kind: 'bits', lo: 6, hi: 7 }, modes: ['angle', 'horizon', 'acro'] });
            expect(p.channels?.slice(0, 6)).toEqual([{ kind: 'axis', index: 0 }, { kind: 'axis', index: 1 }, { kind: 'axis', index: 2 }, { kind: 'axis', index: 3 }, { kind: 'bits', lo: 6, hi: 7 }, { kind: 'bits', lo: 4, hi: 5 }]);
            expect(p).toMatchObject({ version: 1, wizard: 2, known: 'dji-virtual-joystick', deadband: 0.025 });
            expect(JSON.parse(JSON.stringify(p))).toEqual(p);
        }
    });

    it('its real reports through the WebHID reader and the profile: N / S / M give Angle / Horizon / Acro, full sticks read +-1, rest reads 0', () => {
        const p = djiProfile('hid');
        const read = makeHidReader(DJI_RC3);
        const f: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
        const ch = new Float32Array(8);
        const at = (axes: number[], buttons: number) => { expect(read(0, new DataView(djiRc3Report(axes, buttons).buffer), f)).toBe(true); return Array.from(mapFrame(p, f, ch)); };
        // rest as measured: X -11, Rx -8, buttons 0x50 (mode switch at N, the C2 switch at its low end)
        const rest = at([-11, 0, 0, -8, 0], 0x50);
        expect(rest.slice(0, 4)).toEqual([0, 0, 0, 0]); // throttle in the middle: the stick springs (measured)
        expect(rest[5]).toBe(MODE_CHANNEL.angle);
        expect(at([0, 0, -660, 0, 0], 0x10)[5]).toBe(MODE_CHANNEL.horizon);
        expect(at([0, 0, -660, 0, 0], 0x90)[5]).toBe(MODE_CHANNEL.acro);
        const full = at([660, 660, 660, 660, 0], 0x50);
        expect(full.slice(0, 4)).toEqual([1, 1, 1, 1]);
        expect(at([-660, -660, -660, -660, 0], 0x50).slice(0, 4)).toEqual([-1, -1, -1, -1]);
        // the start/stop button (bit 2) reads as the arm input; the latch (Controls) toggles on each press
        expect(at([0, 0, -660, 0, 0], 0x54)[4]).toBe(1);
    });

    it('the owner\'s real 25 s stir through the known profile reaches both ends of every stick (no stir needed to set the range)', () => {
        const p = djiProfile('hid');
        const ch = new Float32Array(8);
        const lo = [1, 1, 1, 1], hi = [-1, -1, -1, -1];
        for (const r of DJI_RC3_STIR) {
            const f: RawFrame = { t: r[0], axes: new Float32Array(r.slice(1, 6).map((v) => v / 660)), buttons: r[6] };
            mapFrame(p, f, ch);
            for (let i = 0; i < 4; i++) { lo[i] = Math.min(lo[i], ch[i]); hi[i] = Math.max(hi[i], ch[i]); }
        }
        expect(lo).toEqual([-1, -1, -1, -1]);
        expect(hi).toEqual([1, 1, 1, 1]);
    });

    it('control: the measured rest offset reads as a stick deflection without the deadband (the drift it removes)', () => {
        const p = { ...djiProfile('hid'), deadband: 0 };
        const out = mapFrame(p, { t: 0, axes: new Float32Array([-11 / 660, 0, 0, -8 / 660, 0]), buttons: 0x50 }, new Float32Array(8));
        expect(out[0]).toBeCloseTo(-0.0167, 3);
        expect(out[3]).toBeCloseTo(-0.0121, 3);
    });
});

describe('the deadband is continuous (v0.8)', () => {
    it('0 inside, then the rest of the travel scaled onto 0..1: no step at its edge, full deflection still 1', () => {
        const db = 0.025;
        expect(applyDeadband(0.02, db)).toBe(0);
        expect(applyDeadband(-0.025, db)).toBe(0);
        expect(applyDeadband(0.0251, db)).toBeCloseTo(0.0001 / 0.975, 9);
        expect(applyDeadband(1, db)).toBe(1);
        expect(applyDeadband(-1, db)).toBe(-1);
        expect(applyDeadband(0.5, 0)).toBe(0.5);
        // monotonic, and the largest jump between two readings 0.001 apart is ~0.001 (no step)
        let maxJump = 0;
        for (let x = -1; x < 1; x += 0.001) maxJump = Math.max(maxJump, Math.abs(applyDeadband(x + 0.001, db) - applyDeadband(x, db)));
        expect(maxJump).toBeLessThan(0.0011);
    });

    it('control: the deadband as v0.1-v0.7 applied it (zero inside, unchanged outside) jumps by the whole deadband at its edge', () => {
        const old = (x: number, db: number) => (Math.abs(x) < db ? 0 : x);
        expect(old(0.0251, 0.025) - old(0.0249, 0.025)).toBeGreaterThan(0.025);
    });
});

describe('EdgeTX radios are recognised by name and keep the wizard', () => {
    it('the Classic USB joystick: known as an EdgeTX radio, no profile (the channels are the pilot\'s own model setup)', () => {
        const m = recognise(seenFromHid(EDGETX_CLASSIC));
        expect(m?.device.id).toBe('edgetx-joystick');
        expect(knownProfile(m!, 'k', 'n')).toBeNull();
        expect(recognise(seenFromGamepad(pad('RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)', 8, 24)))?.device.id).toBe('edgetx-joystick');
    });

    it('control: an EdgeTX radio in Advanced mode (another layout) is not taken for the Classic one', () => {
        const adv = edgeTxAdvanced({ ifMode: 0x05, axes: [0x30, 0x31, 0x32, 0x33].map((u) => 0x10000 | u), buttonMaxId: 8 });
        expect(seenFromHid(adv).axisCount).toBe(4);
        expect(recognise(seenFromHid(adv))).toBeNull();
    });
});

describe('the table itself', () => {
    const dict = (lang: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../i18n/locales/fly/controllers/${lang}.json`, import.meta.url), 'utf8'));

    it('every fact is marked, a sourced one names where, an assumed one says why', () => {
        const facts = (d: KnownDevice) => [
            ...(d.mapping ? [d.mapping.sticksFact, d.mapping.directionFact, d.mapping.throttleFact, d.mapping.armFact, d.mapping.modeFact, d.mapping.channelsFact, d.mapping.deadbandFact] : []),
            ...d.controls.map((c) => c.fact)
        ];
        for (const d of KNOWN_DEVICES) {
            for (const f of facts(d)) {
                if (f.kind === 'sourced') expect(f.url.length, d.id).toBeGreaterThan(10);
                else if (f.kind === 'measured') expect(f.where.length, d.id).toBeGreaterThan(10);
                else expect(f.why.length, d.id).toBeGreaterThan(10);
            }
        }
    });

    it('every label, note and reason the check screen shows exists in en, es, pl and ru', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const t = dict(lang);
            for (const d of KNOWN_DEVICES) {
                for (const c of d.controls) expect(t[`controllers.control.${c.label}`], `${lang} ${c.label}`).toBeTruthy();
                for (const n of d.notes) expect(t[n], `${lang} ${n}`).toBeTruthy();
                if (d.whyNoMapping) expect(t[d.whyNoMapping], `${lang} ${d.whyNoMapping}`).toBeTruthy();
            }
        }
    });

    it('ids are unique, and knownDevice finds an entry by the id a profile keeps', () => {
        expect(new Set(KNOWN_DEVICES.map((d) => d.id)).size).toBe(KNOWN_DEVICES.length);
        expect(knownDevice('dji-virtual-joystick')?.name).toBe('DJI FPV Remote Controller 3');
        expect(knownDevice('gone')).toBeNull();
        expect(knownDevice(undefined)).toBeNull();
    });
});
