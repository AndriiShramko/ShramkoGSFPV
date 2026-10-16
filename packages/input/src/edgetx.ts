// The EdgeTX "USB Joystick" (Classic) report as a fixed layout, from the EdgeTX source
// (usbd_hid_joystick.c; not measured on a radio): 3 bytes of buttons + 8 x uint16 little-endian,
// 0..2047, centre 1024; 16 bytes = no button bytes. No device is read with it by its USB ids: every
// device, the EdgeTX radio too, is read through its own report descriptor (hid-layout.ts), and the
// EdgeTX radio's descriptor gives exactly this layout. It stays only as the fallback for a device whose
// browser hands over no usable descriptor (hid-layout.ts makeHidReader), as every device was read before.

import type { RawFrame } from './calib';

/** The USB ids EdgeTX and OpenTX radios use for their joystick (pid.codes 1209:4F54), the one place they are written. */
export const EDGETX_USB = { vendorId: 0x1209, productId: 0x4f54 } as const;

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
