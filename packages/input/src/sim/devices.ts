// Descriptions of real HID controllers, for the tests and for the fake radio of the page tests
// (apps/fly/src/devices/fakehid.ts), so that a controller is checked in CI without the hardware.
// Each carries the report descriptor in the shape WebHID gives it (device.collections) and the
// facts measured on the real device. What was measured and what was not is in docs/research/radios/.

import type { HidCollectionInfo } from '../hid-layout';

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
                { isConstant: false, isRange: false, usages: [P1 | 0x30, P1 | 0x31, P1 | 0x32, P1 | 0x33, P1 | 0x34], reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 },
                { isConstant: false, isRange: true, usageMinimum: P9 | 0x01, usageMaximum: P9 | 0x18, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 }
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
