// Descriptions of real HID controllers, for the tests and for the fake radio of the page tests
// (apps/fly/src/devices/fakehid.ts), so that a controller is checked in CI without the hardware.
// Each carries the report descriptor in the shape WebHID gives it (device.collections) and the
// facts measured on the real device or read from its firmware source. What was measured and what
// was not is in docs/research/radios/.

import type { HidCollectionInfo, HidItemInfo } from '../hid-layout';
import { EDGETX_USB } from '../edgetx';

export interface HidPadSpec {
    /** short name for test titles */
    name: string;
    vendorId: number;
    productId: number;
    /** HIDDevice.productName / the Gamepad API id's name (not the USB product string) */
    productName: string;
    /** data bytes of the one input report (report id 0: not counted) */
    reportBytes: number;
    collections: HidCollectionInfo[];
    /** the logical range of every axis */
    axisRange: [number, number];
    /** resting raw value of each axis (raw units) */
    rest: number[];
    /** button bits that read pressed at rest */
    restButtons: number;
    rateHz: number;
}

const P1 = 0x10000; // usage page 0x01 (generic desktop) in the high half of a WebHID usage
const P2 = 0x20000; // usage page 0x02 (simulation controls)
const P6 = 0x60000; // usage page 0x06 (generic device controls)
const P9 = 0x90000; // usage page 0x09 (button)

/**
 * DJI FPV Remote Controller 3 in its simulator mode: Windows lists it as "DJI Virtual Joystick"
 * (USB 2ca3:1021, composite: a libusb bulk interface and the HID interface), HID usage page 1 usage 5
 * (gamepad). MEASURED 2026-10-15 on Windows (hid.dll HidP_GetCaps / GetValueCaps / GetButtonCaps, winmm
 * joyGetPosEx, Chrome 152 getGamepads): 5 axes X Y Z Rx Ry of 16 bits with logical range -660..660, one
 * button range 1..24 of one bit each, input report length 14 with the report id (13 data bytes), about
 * 160 reports a second, rest: X -11, Rx -8 (both jitter by a few units), Y Z Ry 0, buttons 0x50 held.
 * NOT MEASURED: the order of the fields inside the report (the controller was unplugged before the raw
 * reports could be read); axes first, then the 3 button bytes is assumed here. The reader follows
 * whatever order the browser's descriptor gives, so this only matters to the fake device.
 * This is the shape Chromium builds from the descriptor (macOS, Linux); DJI_RC3_WINDOWS is the one it
 * builds from Windows' preparsed data.
 */
export const DJI_RC3: HidPadSpec = {
    name: 'DJI RC 3 (simulator mode)',
    vendorId: 0x2ca3,
    productId: 0x1021,
    productName: 'HID Interface',
    reportBytes: 13,
    axisRange: [-660, 660],
    rest: [-11, 0, 0, -8, 0],
    restButtons: 0x50,
    rateHz: 160,
    collections: [{
        usagePage: 0x01,
        usage: 0x05,
        children: [],
        inputReports: [{
            reportId: 0,
            items: [
                { isConstant: false, isArray: false, isRange: false, usages: [P1 | 0x30, P1 | 0x31, P1 | 0x32, P1 | 0x33, P1 | 0x34], reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 },
                { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 0x01, usageMaximum: P9 | 0x18, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 }
            ]
        }]
    }]
};

/**
 * The same controller as Chromium builds it on Windows (services/device/hid/hid_service_win.cc): from
 * the preparsed data, one item per value cap (each axis its own single-usage item) in bit order, the
 * button range as one item, padded to the input report length.
 */
export const DJI_RC3_WINDOWS: HidPadSpec = {
    ...DJI_RC3,
    collections: [{
        usagePage: 0x01,
        usage: 0x05,
        children: [],
        inputReports: [{
            reportId: 0,
            items: [
                ...[0x30, 0x31, 0x32, 0x33, 0x34].map((u): HidItemInfo => ({ isConstant: false, isArray: false, isRange: false, usages: [P1 | u], reportSize: 16, reportCount: 1, logicalMinimum: -660, logicalMaximum: 660 })),
                { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 0x01, usageMaximum: P9 | 0x18, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 }
            ]
        }]
    }]
};

/**
 * The report of DJI_RC3 for these raw axis values (-660..660, 5 of them) and 24 button bits: five
 * int16 little-endian, then three button bytes. Written by hand from the layout above, not from the
 * reader, so that the reader is checked against it.
 */
export function djiRc3Report(axes: readonly number[], buttons: number): Uint8Array {
    const out = new Uint8Array(DJI_RC3.reportBytes);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < 5; i++) dv.setInt16(i * 2, Math.round(axes[i] ?? 0), true);
    out[10] = buttons & 0xff;
    out[11] = (buttons >> 8) & 0xff;
    out[12] = (buttons >> 16) & 0xff;
    return out;
}

/**
 * An EdgeTX radio in "USB Joystick" Classic mode, its descriptor from the EdgeTX source
 * (radio/src/usb_joystick.cpp HID_JOYSTICK_ClassicReportDesc, main 2026-10; NOT read from a radio):
 * Game Pad application collection with a nested Physical one, Buttons 1..24 of one bit, X Y Z Rx Ry
 * Rz Slider Dial of 16 bits, logical 0..2047, no report id: 19 bytes, the layout edgetx.ts reads.
 * Values are channel + 1024 limited to 0..2047 (centre 1024). Chromium lists the items in both
 * collections. The product name is a RadioMaster's as an example; EdgeTX radios name themselves.
 */
const edgeTxClassicItems: HidItemInfo[] = [
    { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 0x01, usageMaximum: P9 | 0x18, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 },
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37].map((u) => P1 | u), reportSize: 16, reportCount: 8, logicalMinimum: 0, logicalMaximum: 2047 }
];
export const EDGETX_CLASSIC: HidPadSpec = {
    name: 'EdgeTX USB Joystick (Classic)',
    ...EDGETX_USB,
    productName: 'RadioMaster TX16S Joystick',
    reportBytes: 19,
    axisRange: [0, 2047],
    rest: [1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024],
    restButtons: 0,
    rateHz: 1000,
    collections: [{
        usagePage: 0x01,
        usage: 0x05,
        inputReports: [{ reportId: 0, items: edgeTxClassicItems }],
        children: [{ usagePage: 0x01, usage: 0x00, inputReports: [{ reportId: 0, items: edgeTxClassicItems }], children: [] }]
    }]
};

/** An EdgeTX Classic report: 3 button bytes, then 8 x uint16 little-endian (raw 0..2047). By hand, from the source. */
export function edgeTxClassicReport(axes: readonly number[], buttons: number): Uint8Array {
    const out = new Uint8Array(19);
    const dv = new DataView(out.buffer);
    out[0] = buttons & 0xff;
    out[1] = (buttons >> 8) & 0xff;
    out[2] = (buttons >> 16) & 0xff;
    for (let i = 0; i < 8; i++) dv.setUint16(3 + i * 2, Math.round(axes[i] ?? 1024), true);
    return out;
}

/** What an EdgeTX model's "USB Joystick" Advanced mode is set to (the radio's USB joystick page). */
export interface EdgeTxAdvancedConfig {
    /** the application collection: 4 joystick (EdgeTX's default), 5 gamepad, 8 multi-axis controller */
    ifMode: 0x04 | 0x05 | 0x08;
    /** the channels sent as axes, in channel order: full usages, Generic Desktop (P1 | 0x30..0x38) or Simulation Controls (P2 | 0xb0 aileron, 0xb8 elevator, 0xba rudder, 0xbb throttle, 0xc4, 0xc5, 0xc8) */
    axes: number[];
    /** the highest button number the model's button channels use (0: none) */
    buttonMaxId: number;
}

/**
 * An EdgeTX radio in "USB Joystick" Advanced mode: the descriptor EdgeTX builds for `cfg`
 * (radio/src/usb_joystick.cpp setupUSBJoystick, main 2026-10; NOT read from a radio), in Chromium's
 * shape. The axes come FIRST (all of them in one item, 16 bits, logical 0..2048, inside a Pointer /
 * Physical collection), then Buttons 1..max (at least 2 for a joystick, 4 for a gamepad) padded to 32
 * bits, then a battery byte (Generic Device Controls 0x20, 0..100): 2 x axes + 5 bytes. The fixed
 * EdgeTX layout misreads every such report (3 button bytes first).
 */
export function edgeTxAdvanced(cfg: EdgeTxAdvancedConfig, productName = 'RadioMaster TX16S Joystick'): HidPadSpec {
    const btnMax = Math.max(cfg.buttonMaxId, cfg.ifMode === 0x05 ? 4 : cfg.ifMode === 0x04 ? 2 : 0);
    const axesItem: HidItemInfo = { isConstant: false, isArray: false, isRange: false, usages: [...cfg.axes], reportSize: 16, reportCount: cfg.axes.length, logicalMinimum: 0, logicalMaximum: 2048 };
    const items: HidItemInfo[] = [];
    if (cfg.axes.length) items.push(axesItem);
    // USAGE_MINIMUM 1 .. USAGE_MAXIMUM max; Chromium calls an item a range only when the two differ, and
    // hands a one-button "range" over with no usage at all (hid_report_item.cc)
    if (btnMax) items.push({ isConstant: false, isArray: false, isRange: btnMax > 1, ...(btnMax > 1 ? { usageMinimum: P9 | 1, usageMaximum: P9 | btnMax } : { usages: [] }), reportSize: 1, reportCount: btnMax, logicalMinimum: 0, logicalMaximum: 1 });
    if (btnMax < 32) items.push({ isConstant: true, isArray: false, reportSize: 32 - btnMax, reportCount: 1 });
    items.push({ isConstant: false, isArray: false, isRange: false, usages: [P6 | 0x20], reportSize: 8, reportCount: 1, logicalMinimum: 0, logicalMaximum: 100 });
    return {
        name: `EdgeTX USB Joystick (Advanced, ${cfg.axes.length} axes)`,
        ...EDGETX_USB,
        productName,
        reportBytes: cfg.axes.length * 2 + 5,
        axisRange: [0, 2048],
        rest: cfg.axes.map(() => 1024),
        restButtons: 0,
        rateHz: 1000,
        collections: [{
            usagePage: 0x01,
            usage: cfg.ifMode,
            inputReports: [{ reportId: 0, items }],
            children: cfg.axes.length ? [{ usagePage: 0x01, usage: 0x01, inputReports: [{ reportId: 0, items: [axesItem] }], children: [] }] : []
        }]
    };
}

/** An EdgeTX Advanced report for edgeTxAdvanced(cfg): the axes (raw 0..2048), 4 button bytes, the battery byte. By hand, from the source. */
export function edgeTxAdvancedReport(cfg: EdgeTxAdvancedConfig, axes: readonly number[], buttons: number, battery = 87): Uint8Array {
    const n = cfg.axes.length;
    const out = new Uint8Array(n * 2 + 5);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < n; i++) dv.setUint16(i * 2, Math.round(axes[i] ?? 1024), true);
    dv.setUint32(n * 2, buttons >>> 0, true);
    out[n * 2 + 4] = battery;
    return out;
}

/** Full usages of the Simulation Controls page EdgeTX's Advanced mode offers (usb_joystick.cpp simTypeCodes). */
export const SIM = { aileron: P2 | 0xb0, elevator: P2 | 0xb8, rudder: P2 | 0xba, throttle: P2 | 0xbb, accelerator: P2 | 0xc4, brake: P2 | 0xc5, steering: P2 | 0xc8 } as const;
