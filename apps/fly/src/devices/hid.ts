// EdgeTX radio in "USB Joystick" mode over WebHID. Report layout from the EdgeTX source (not
// measured on hardware yet): 3 bytes of buttons + 8 x uint16 little-endian, 0..2048, centre 1024.
// Timestamps are the browser's event.timeStamp (same clock as performance.now()).

import type { RawFrame } from '@gsfpv/input';

export const EDGETX_FILTERS: HIDDeviceFilter[] = [
    { vendorId: 0x1209, productId: 0x4f54 }, // EdgeTX / OpenTX
    { usagePage: 0x01, usage: 0x04 }, // joystick
    { usagePage: 0x01, usage: 0x05 }, // gamepad
    { usagePage: 0x01, usage: 0x08 } // multi-axis controller
];

export function parseEdgeTxReport(data: DataView, out: RawFrame): boolean {
    const n = data.byteLength;
    if (n >= 19) {
        out.buttons = data.getUint8(0) | (data.getUint8(1) << 8) | (data.getUint8(2) << 16);
        for (let i = 0; i < 8; i++) out.axes[i] = (data.getUint16(3 + i * 2, true) - 1024) / 1024;
        return true;
    }
    if (n >= 16) {
        // no button bytes
        out.buttons = 0;
        for (let i = 0; i < 8; i++) out.axes[i] = (data.getUint16(i * 2, true) - 1024) / 1024;
        return true;
    }
    return false;
}

export function hidDeviceKey(d: { vendorId: number; productId: number; productName: string }, reportLen: number): string {
    return `hid:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName}:${reportLen}`;
}

export class HidSource {
    device: HIDDevice | null = null;
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    reports = 0;
    private rateT0 = 0;
    private rateN = 0;
    rateHz = 0;
    reportLen = 0;
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
        d.addEventListener('inputreport', this.onReport);
    }

    private onReport = (e: HIDInputReportEvent): void => {
        this.reportLen = e.data.byteLength;
        const f = this.frame;
        if (!parseEdgeTxReport(e.data, f)) return;
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
        return this.device ? hidDeviceKey(this.device, this.reportLen) : '';
    }

    close(): void {
        this.device?.removeEventListener('inputreport', this.onReport);
    }
}
