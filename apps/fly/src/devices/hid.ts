// A radio or gamepad over WebHID. An EdgeTX radio in "USB Joystick" mode sends the layout from the
// EdgeTX source: 3 bytes of buttons + 8 x uint16 little-endian, 0..2048, centre 1024. Any other HID
// joystick or gamepad (a DJI controller in its simulator mode, 13 bytes: 5 x int16 and 24 button bits)
// is read through its own report descriptor, which the browser hands over as device.collections
// (packages/input/src/hid-layout.ts). The chooser lists every HID joystick, gamepad and multi-axis
// controller. Timestamps are the browser's event.timeStamp (same clock as performance.now()).

import { hidDisplayName, makeHidReader, parseEdgeTxReport } from '@gsfpv/input';
import type { HidReader, RawFrame } from '@gsfpv/input';

export const EDGETX_FILTERS: HIDDeviceFilter[] = [
    { vendorId: 0x1209, productId: 0x4f54 }, // EdgeTX / OpenTX
    { usagePage: 0x01, usage: 0x04 }, // joystick
    { usagePage: 0x01, usage: 0x05 }, // gamepad
    { usagePage: 0x01, usage: 0x08 } // multi-axis controller
];

export { hidDisplayName, parseEdgeTxReport };

export function hidDeviceKey(d: { vendorId: number; productId: number; productName: string }, reportLen: number): string {
    return `hid:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName}:${reportLen}`;
}

export class HidSource {
    device: HIDDevice | null = null;
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    reports = 0;
    /** reports this parser cannot read (e.g. EdgeTX "Advanced" joystick layouts) and the last one's length */
    badReports = 0;
    lastBadLen = 0;
    private rateT0 = 0;
    private rateN = 0;
    rateHz = 0;
    reportLen = 0;
    /** EdgeTX's fixed layout, or the device's own descriptor (makeHidReader) */
    private read: HidReader = (_id, data, out) => parseEdgeTxReport(data, out);
    onFrame: ((f: RawFrame) => void) | null = null;

    static supported(): boolean {
        return typeof navigator !== 'undefined' && 'hid' in navigator;
    }

    /** Must be called from a user gesture. */
    async request(): Promise<HIDDevice | null> {
        const hid = (navigator as Navigator & { hid: HID }).hid;
        const list = await hid.requestDevice({ filters: EDGETX_FILTERS });
        return list[0] ?? null;
    }

    async open(d: HIDDevice): Promise<void> {
        if (!d.opened) await d.open();
        this.device = d;
        this.read = makeHidReader(d);
        d.addEventListener('inputreport', this.onReport);
    }

    private onReport = (e: HIDInputReportEvent): void => {
        this.reportLen = e.data.byteLength;
        const f = this.frame;
        if (!this.read(e.reportId, e.data, f)) {
            // the wizard's connect screen says so instead of waiting for frames that never come
            this.badReports++;
            this.lastBadLen = e.data.byteLength;
            return;
        }
        f.t = e.timeStamp;
        this.reports++;
        this.rateN++;
        if (f.t - this.rateT0 >= 1000) {
            this.rateHz = (this.rateN * 1000) / (f.t - this.rateT0);
            this.rateN = 0;
            this.rateT0 = f.t;
        }
        this.onFrame?.(f);
    };

    get key(): string {
        // a descriptor-read device: its axis report's length, whichever of its reports came first
        return this.device ? hidDeviceKey(this.device, this.read.keyBytes ?? this.reportLen) : '';
    }

    close(): void {
        this.device?.removeEventListener('inputreport', this.onReport);
    }
}
