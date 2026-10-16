// Known controllers (v0.8 lane B; the owner's message 21, item 4: "plug the DJI controller in and
// everything works, nothing to reassign"). No DOM. Data, not if-branches: a table of controllers, how
// each is recognised, and the setup it flies with out of the box. The app has no device names in its
// code; it asks `recognise` and gets a ready profile (or a known name without one).
//
// How a controller is recognised (`seenFromHid`, `seenFromGamepad`, `recognise`):
// - WebHID: the USB vendor / product id AND the shape of its game-control collection (the axes' HID
//   usages and logical ranges, the number of buttons). DJI reuses one id for several controllers
//   (docs/research/radios/dji-rc3.md), so the id alone never decides.
// - Gamepad API: the vendor / product id inside the id string (Chrome "HID Interface (Vendor: 2ca3
//   Product: 1021)", Firefox "2ca3-1021-HID Interface") and the axis / button counts. Chrome lists a
//   generic HID gamepad's axes in HID usage order (X, Y, Z, Rx, Ry...; measured for the DJI on Chrome
//   152), so an axis is found by the rank of its usage among the device's axis usages.
//
// What an entry gives (`KnownDevice`): the sticks by HID usage (Mode 2) and direction, the arm control,
// the flight-mode switch and the mode of each position, the device's Betaflight channel table (a
// two-bit 3-position switch is one channel), every control with its label for the check screen, the
// deadband, and for every one of these where it comes from (`Fact`): measured (the evidence), sourced
// (a link) or assumed (why). The check screen shows these marks, so a pilot can confirm or correct a
// layout in half a minute; Reverse, Set again and Recalibrate still override anything here.
//
// An entry with `mapping: null` is recognised by name only (EdgeTX): its channels are the pilot's own
// model setup, so the wizard asks for them.
//
// Adding a controller: one entry in KNOWN_DEVICES, facts marked, a recognition test with its descriptor
// (sim/devices.ts) and a negative control (a device with the same ids and another shape is not it).

import type { Fn, Profile, ArmMap } from './calib';
import type { SwitchInput, SwitchModes } from './mode-switch';
import type { HidCollectionInfo } from './hid-layout';
import { layoutsFromCollections, readsAsEdgeTx } from './hid-layout';
import { EDGETX_USB } from './edgetx';
import { FRAME_BUTTONS } from './frame';

/** Where a fact comes from. */
export type Fact =
    | { kind: 'measured'; where: string } // evidence file or test in this repository
    | { kind: 'sourced'; url: string } // a page that says so
    | { kind: 'assumed'; why: string }; // not measured, not found written: the reason it is the best guess

/** Generic Desktop axis usages (page 0x01): X .. Wheel. */
export const USAGE = { X: 0x30, Y: 0x31, Z: 0x32, Rx: 0x33, Ry: 0x34, Rz: 0x35, Slider: 0x36, Dial: 0x37, Wheel: 0x38 } as const;

/** An input of a known controller: an axis by its HID usage (its index differs between WebHID and the Gamepad API), or button bits. */
export type KnownInput = { kind: 'axis'; usage: number } | { kind: 'button'; bit: number } | { kind: 'bits'; lo: number; hi: number };

/** One physical control, for the check screen: what it is (i18n `controllers.control.<label>`), what it sends, how we know. */
export interface KnownControl {
    label: string;
    input: KnownInput;
    fact: Fact;
}

/** The setup a known controller flies with, with the source of each part. */
export interface KnownMapping {
    /** Mode 2 sticks: the axis of each function and whether it reads reversed (stick up / right must read +1) */
    sticks: Record<Fn, { usage: number; invert: boolean }>;
    sticksFact: Fact;
    directionFact: Fact;
    /** the throttle stick springs back to its middle as the controller ships (the pilot can change that on the controller) */
    throttleSprings: boolean;
    throttleFact: Fact;
    /** the arm control: a button that toggles the arm (each press), a held button, or none (Space) */
    arm: { kind: 'button'; bit: number; toggle: boolean } | null;
    armFact: Fact;
    /** the flight-mode switch and the mode of its low / middle / high position */
    modeSwitch: { input: KnownInput; modes: SwitchModes } | null;
    modeFact: Fact;
    /** the Betaflight channel table, CH1 first */
    channels: KnownInput[];
    channelsFact: Fact;
    /** the deadband around the stick centres, in -1..1 units */
    deadband: number;
    deadbandFact: Fact;
}

export interface KnownDevice {
    /** stable id, kept in profiles (Profile.known) */
    id: string;
    /** the controller's name as its maker writes it (not translated) */
    name: string;
    match: {
        /** USB ids (WebHID vendorId / productId; the Gamepad API id string carries the same) */
        usb: readonly { vendorId: number; productId: number }[];
        /** the axes the controller's game-control collection has, by HID usage, in usage order; null = any */
        axisUsages: readonly number[] | null;
        /** the logical range every one of those axes has; null = any */
        logical: readonly [number, number] | null;
        /** at least this many buttons */
        minButtons: number;
        /** WebHID: the descriptor must read exactly as the EdgeTX USB joystick's (Classic) */
        edgeTxLayout?: true;
    };
    /** null: recognised by name only, the wizard sets it up (with the reason, i18n key) */
    mapping: KnownMapping | null;
    whyNoMapping?: string;
    /** every control for the check screen, in the order the pilot meets them */
    controls: readonly KnownControl[];
    /** short notes for the check screen (i18n keys), e.g. how to stop the throttle springing back */
    notes: readonly string[];
}

const DJI_MANUAL = 'https://www.lensrentals.com/product-assets/874ea987-4063-4505-8cfd-fcddd02c7a19/1110698.pdf';
const DJI_REC = 'evidence/2026-10-15/dji-rc3/ (facts.json, winmm-40s-recording.csv); tools/radios/dji-recording.py';
const DJI_RESEARCH = 'docs/research/radios/dji-rc3.md';
const OSCAR = 'https://oscarliang.com/setup-dji-rc3-o4-betaflight/';

const DJI_MODE: KnownInput = { kind: 'bits', lo: 6, hi: 7 };
const DJI_C2: KnownInput = { kind: 'bits', lo: 4, hi: 5 };
const ASSUMED_BUTTONS: Fact = { kind: 'assumed', why: `buttons in the order of DJI's manual (C1, pause/RTH, start/stop, shutter); bits 0..3 are push buttons (measured, ${DJI_REC}) but which is which was not recorded` };

/** The controllers the simulator knows. */
export const KNOWN_DEVICES: readonly KnownDevice[] = [
    {
        id: 'dji-virtual-joystick',
        name: 'DJI FPV Remote Controller 3',
        match: {
            usb: [{ vendorId: 0x2ca3, productId: 0x1021 }],
            axisUsages: [USAGE.X, USAGE.Y, USAGE.Z, USAGE.Rx, USAGE.Ry],
            logical: [-660, 660],
            minButtons: 8
        },
        mapping: {
            sticks: {
                roll: { usage: USAGE.X, invert: false },
                pitch: { usage: USAGE.Y, invert: false },
                throttle: { usage: USAGE.Z, invert: false },
                yaw: { usage: USAGE.Rx, invert: false }
            },
            sticksFact: { kind: 'sourced', url: 'https://steamcommunity.com/app/1682970/discussions/0/3037103480425804141 (DJI FPV Remote Controller 2: axis 1 roll, 2 pitch, 3 throttle, 4 yaw); measured consistent: X/Rx horizontal, Y/Z vertical (' + DJI_RESEARCH + ')' },
            directionFact: { kind: 'assumed', why: 'stick up and right read positive: DJI RC units are 1024 +- 660 and its Onboard SDK sends "up" as 1684; the recording does not say what the hands did' },
            throttleSprings: true,
            throttleFact: { kind: 'measured', where: `the throttle axis rested exactly in the middle between stirs (${DJI_REC}); DJI's manual: "tighten the screws behind the throttle stick to keep the stick from auto recentering" (${DJI_MANUAL})` },
            arm: { kind: 'button', bit: 2, toggle: true },
            armFact: ASSUMED_BUTTONS,
            modeSwitch: { input: DJI_MODE, modes: ['angle', 'horizon', 'acro'] },
            modeFact: { kind: 'assumed', why: `bits 6/7 pass through their middle on every flip like a 3-way toggle (measured, ${DJI_RESEARCH}); N (where it rested, DJI's safe default) = bit 6 -> Angle, S = middle -> Horizon, M = bit 7 -> Acro` },
            channels: [
                { kind: 'axis', usage: USAGE.X }, { kind: 'axis', usage: USAGE.Y }, { kind: 'axis', usage: USAGE.Z }, { kind: 'axis', usage: USAGE.Rx },
                DJI_MODE, DJI_C2, { kind: 'button', bit: 1 }, { kind: 'button', bit: 2 }, { kind: 'button', bit: 0 }
            ],
            channelsFact: { kind: 'sourced', url: `${OSCAR} (AUX1 mode switch, AUX2 the other 3-position toggle, AUX3 return-to-home, AUX4 start/stop, AUX5 C1); the bits behind them are assumed (${DJI_RESEARCH})` },
            deadband: 0.025,
            deadbandFact: { kind: 'measured', where: `rest offsets 11 and 8 of 660 units (1.7 % and 1.2 %) with a jitter of a few units stay inside 2.5 % (${DJI_REC})` }
        },
        controls: [
            { label: 'rightStickX', input: { kind: 'axis', usage: USAGE.X }, fact: { kind: 'sourced', url: DJI_RESEARCH } },
            { label: 'rightStickY', input: { kind: 'axis', usage: USAGE.Y }, fact: { kind: 'sourced', url: DJI_RESEARCH } },
            { label: 'leftStickY', input: { kind: 'axis', usage: USAGE.Z }, fact: { kind: 'sourced', url: DJI_RESEARCH } },
            { label: 'leftStickX', input: { kind: 'axis', usage: USAGE.Rx }, fact: { kind: 'sourced', url: DJI_RESEARCH } },
            { label: 'gimbalDial', input: { kind: 'axis', usage: USAGE.Ry }, fact: { kind: 'measured', where: DJI_REC } },
            { label: 'flightModeSwitch', input: DJI_MODE, fact: { kind: 'assumed', why: 'see the mode switch' } },
            { label: 'c2Switch', input: DJI_C2, fact: { kind: 'assumed', why: 'the other 3-position switch (bits 4/5, measured)' } },
            { label: 'c1Button', input: { kind: 'button', bit: 0 }, fact: ASSUMED_BUTTONS },
            { label: 'pauseRthButton', input: { kind: 'button', bit: 1 }, fact: ASSUMED_BUTTONS },
            { label: 'startStopButton', input: { kind: 'button', bit: 2 }, fact: ASSUMED_BUTTONS },
            { label: 'shutterButton', input: { kind: 'button', bit: 3 }, fact: ASSUMED_BUTTONS }
        ],
        notes: ['controllers.note.djiThrottle', 'controllers.note.djiArm', 'controllers.note.djiMode']
    },
    {
        id: 'edgetx-joystick',
        name: 'EdgeTX / OpenTX radio',
        match: { usb: [{ ...EDGETX_USB }], axisUsages: null, logical: null, minButtons: 0, edgeTxLayout: true },
        mapping: null,
        whyNoMapping: 'controllers.edgetx.why',
        controls: [],
        notes: []
    }
];

/** What the page sees of a connected controller, from either path. */
export interface DeviceSeen {
    path: 'hid' | 'gamepad';
    vendorId: number | null;
    productId: number | null;
    /** the axes' HID usages in channel order (WebHID, from the descriptor); null on the Gamepad API (no descriptor) */
    axisUsages: number[] | null;
    /** the axes' logical ranges in channel order (WebHID); null on the Gamepad API */
    logical: [number, number][] | null;
    axisCount: number;
    buttonCount: number;
    /** WebHID: the descriptor reads exactly as the EdgeTX USB joystick (Classic) */
    edgeTxLayout: boolean;
}

/** A WebHID device as seen through its descriptor (the reader's own rules: game-control collections only, at most 8 axes). */
export function seenFromHid(d: { vendorId: number; productId: number; collections?: readonly HidCollectionInfo[] }): DeviceSeen {
    const layouts = layoutsFromCollections(d.collections);
    const axes = layouts.flatMap((l) => l.axes).filter((a) => a.ch >= 0).sort((a, b) => a.ch - b.ch);
    let buttons = 0;
    for (const l of layouts) buttons += l.buttons.length;
    return {
        path: 'hid',
        vendorId: d.vendorId,
        productId: d.productId,
        axisUsages: axes.map((a) => (a.page === 0x01 ? a.usage : 0x10000 * a.page + a.usage)),
        logical: axes.map((a) => [a.lo, a.hi]),
        axisCount: axes.length,
        buttonCount: Math.min(buttons, FRAME_BUTTONS),
        edgeTxLayout: readsAsEdgeTx(layouts)
    };
}

/**
 * The USB ids inside a Gamepad API id string: Chrome "Name (Vendor: 2ca3 Product: 1021)" or "(STANDARD
 * GAMEPAD Vendor: 054c Product: 09cc)", Firefox "2ca3-1021-Name"; null where the browser gives none.
 */
export function gamepadUsbIds(id: string): { vendorId: number; productId: number } | null {
    const chrome = /Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})/i.exec(id);
    const firefox = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
    const m = chrome ?? firefox;
    return m ? { vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) } : null;
}

/** A Gamepad API pad as seen: its USB ids from the id string and its counts (no descriptor). */
export function seenFromGamepad(g: { id: string; axes: { length: number }; buttons: { length: number } }): DeviceSeen {
    const ids = gamepadUsbIds(g.id);
    return {
        path: 'gamepad',
        vendorId: ids?.vendorId ?? null,
        productId: ids?.productId ?? null,
        axisUsages: null,
        logical: null,
        axisCount: g.axes.length,
        buttonCount: Math.min(g.buttons.length, FRAME_BUTTONS),
        edgeTxLayout: false
    };
}

/** A recognised controller: its entry, and the channel index of each of its axis usages on the path it came by. */
export interface KnownMatch {
    device: KnownDevice;
    /** the frame channel (0-based) an axis usage arrives on, or null */
    axisIndex(usage: number): number | null;
}

function sameUsages(seen: readonly number[], want: readonly number[]): boolean {
    return seen.length === want.length && [...seen].sort((a, b) => a - b).every((u, i) => u === [...want].sort((a, b) => a - b)[i]);
}

/** Which known controller this is, if any (`table`: KNOWN_DEVICES; tests pass their own). */
export function recognise(seen: DeviceSeen, table: readonly KnownDevice[] = KNOWN_DEVICES): KnownMatch | null {
    for (const device of table) {
        const m = device.match;
        if (!m.usb.some((u) => u.vendorId === seen.vendorId && u.productId === seen.productId)) continue;
        if (seen.buttonCount < m.minButtons) continue;
        if (seen.path === 'hid') {
            if (m.edgeTxLayout && !seen.edgeTxLayout) continue;
            if (m.axisUsages && !(seen.axisUsages && sameUsages(seen.axisUsages, m.axisUsages))) continue;
            if (m.logical && !(seen.logical && seen.logical.length > 0 && seen.logical.every(([lo, hi]) => lo === m.logical![0] && hi === m.logical![1]))) continue;
            const usages = seen.axisUsages ?? [];
            return { device, axisIndex: (u) => { const i = usages.indexOf(u); return i >= 0 ? i : null; } };
        }
        // the Gamepad API: no descriptor; the count of axes must be the entry's, each found by the rank of its usage
        if (m.edgeTxLayout) {
            // an EdgeTX radio on the Gamepad API: 8 axes (its channels 1-8), recognised by its ids
            if (seen.axisCount < 1) continue;
            return { device, axisIndex: (u) => (u >= USAGE.X && u - USAGE.X < seen.axisCount ? u - USAGE.X : null) };
        }
        if (m.axisUsages && seen.axisCount !== m.axisUsages.length) continue;
        const order = m.axisUsages ? [...m.axisUsages].sort((a, b) => a - b) : [];
        return { device, axisIndex: (u) => { const i = order.indexOf(u); return i >= 0 ? i : null; } };
    }
    return null;
}

/** A known input as a profile's switch input on the path it was matched on; null when an axis is missing. */
export function resolveInput(k: KnownInput, match: KnownMatch): SwitchInput | null {
    if (k.kind === 'axis') {
        const i = match.axisIndex(k.usage);
        return i === null ? null : { kind: 'axis', index: i };
    }
    return k.kind === 'button' ? { kind: 'button', bit: k.bit } : { kind: 'bits', lo: k.lo, hi: k.hi };
}

/**
 * The profile a recognised controller flies with out of the box (null when its entry has no mapping
 * or an axis of it is missing). `wizard: 2` like any setup checked on the check screen: once the pilot
 * presses Fly there it is saved and flies at once next time.
 */
export function knownProfile(match: KnownMatch, deviceKey: string, deviceName: string): Profile | null {
    const m = match.device.mapping;
    if (!m) return null;
    const axes = {} as Profile['axes'];
    for (const fn of ['roll', 'pitch', 'throttle', 'yaw'] as Fn[]) {
        const s = m.sticks[fn];
        const index = match.axisIndex(s.usage);
        if (index === null) return null;
        // the full logical range: every stick of the DJI reaches it (measured), so no stir is needed
        axes[fn] = fn === 'throttle'
            ? { index, invert: s.invert, center: s.invert ? 1 : -1, min: -1, max: 1 }
            : { index, invert: s.invert, center: 0, min: -1, max: 1 };
    }
    const channels: SwitchInput[] = [];
    for (const k of m.channels) {
        const i = resolveInput(k, match);
        if (!i) return null;
        channels.push(i);
    }
    const modeInput = m.modeSwitch ? resolveInput(m.modeSwitch.input, match) : null;
    const arm: ArmMap | null = m.arm ? (m.arm.toggle ? { kind: 'button', bit: m.arm.bit, toggle: true } : { kind: 'button', bit: m.arm.bit }) : { kind: 'key' };
    return {
        version: 1,
        deviceKey,
        deviceName,
        axes,
        arm,
        angleMode: null,
        deadband: m.deadband,
        created: new Date().toISOString(),
        mode: 2,
        wizard: 2,
        ...(m.modeSwitch && modeInput ? { modeSwitch: { input: modeInput, modes: [m.modeSwitch.modes[0], m.modeSwitch.modes[1], m.modeSwitch.modes[2]] } } : {}),
        channels,
        known: match.device.id
    };
}

/**
 * The known setup to offer for a saved setup of a recognised controller that does not know the
 * controller (no `known`: the wizard's, saved before v0.8 recognised it, such as a DJI setup with the
 * flight-mode switch on one bit), or null: the device has no known mapping, or the setup already knows
 * it (its known setup, a wizard run on it since v0.8, or one the pilot kept: keepOwnSetup). The app
 * shows the offer where the pilot meets that setup: on the Controls screen's radio in use, on the
 * saved setup's check screen, and once at load when the setup came back by itself (app/input.ts).
 */
export function knownOffer(saved: Profile, match: KnownMatch | null): Profile | null {
    if (!match?.device.mapping || saved.known === match.device.id) return null;
    return knownProfile(match, saved.deviceKey, match.device.name);
}

/**
 * The pilot keeps his own setup of a recognised controller (the offer declined): his sticks, arm,
 * mode switch and switches as they are; what belongs to the device joins it (its channel table, if
 * the setup has none, and its id), so its controls are named and labelled as the device's and the
 * offer is not made again (knownOffer).
 */
export function keepOwnSetup(saved: Profile, match: KnownMatch): Profile {
    const channels = saved.channels ?? knownProfile(match, saved.deviceKey, saved.deviceName)?.channels;
    return { ...saved, ...(channels ? { channels: channels.map((i) => ({ ...i })) } : {}), known: match.device.id };
}

/** The entry a profile came from (Profile.known), for the check screen's labels. */
export function knownDevice(id: string | undefined, table: readonly KnownDevice[] = KNOWN_DEVICES): KnownDevice | null {
    return (id && table.find((d) => d.id === id)) || null;
}
