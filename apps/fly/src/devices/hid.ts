// A radio or game controller over WebHID. Every device is read through its own report descriptor,
// which the browser hands over as device.collections (packages/input/src/hid-layout.ts): an EdgeTX
// radio in "USB Joystick" mode (its descriptor gives the layout of the EdgeTX source: 3 bytes of
// buttons + 8 x uint16 little-endian, 0..2047, centre 1024), a DJI controller in its simulator mode
// (13 bytes: 5 x int16 and 24 button bits), any HID joystick, gamepad or multi-axis controller. The
// fixed EdgeTX layout is only the fallback when the browser hands over no usable descriptor. The
// chooser lists every HID game control and the EdgeTX USB ids. Timestamps are the browser's
// event.timeStamp (same clock as performance.now()).

import { EDGETX_USB, GAME_CONTROL_USAGES, hidDisplayName, hidProfileKey, makeHidReader, parseEdgeTxReport } from '@gsfpv/input';
import type { HidReader, RawFrame } from '@gsfpv/input';

/** What the browser's chooser offers: the EdgeTX / OpenTX joystick by its USB ids, and every HID game control (joystick, gamepad, multi-axis controller), the collections the reader reads. */
export const HID_CHOOSER_FILTERS: HIDDeviceFilter[] = [
    { ...EDGETX_USB },
    ...GAME_CONTROL_USAGES.map((usage) => ({ usagePage: 0x01, usage }))
];

export { hidDisplayName, parseEdgeTxReport };

export class HidSource {
    device: HIDDevice | null = null;
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    reports = 0;
    /** reports the reader cannot read (shorter than the layout, an unknown report id) and the last one's length */
    badReports = 0;
    lastBadLen = 0;
    private rateT0 = 0;
    private rateN = 0;
    rateHz = 0;
    reportLen = 0;
    /** the device's own descriptor, or the fixed EdgeTX layout without one (makeHidReader) */
    private read: HidReader = makeHidReader({});
    onFrame: ((f: RawFrame) => void) | null = null;

    static supported(): boolean {
        return typeof navigator !== 'undefined' && 'hid' in navigator;
    }

    /** Must be called from a user gesture. */
    async request(): Promise<HIDDevice | null> {
        const hid = (navigator as Navigator & { hid: HID }).hid;
        const list = await hid.requestDevice({ filters: HID_CHOOSER_FILTERS });
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

    /** The profile key (hidProfileKey): a descriptor-read device's axis report length and ':d'; the EdgeTX layout's arriving length, as before. */
    get key(): string {
        return this.device ? hidProfileKey(this.device, this.read, this.reportLen) : '';
    }

    close(): void {
        this.device?.removeEventListener('inputreport', this.onReport);
    }
}
