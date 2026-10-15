// The EdgeTX "USB Joystick" (Classic) report. Layout from the EdgeTX source (not measured on hardware
// yet): 3 bytes of buttons + 8 x uint16 little-endian, 0..2048, centre 1024; 16 bytes = no button bytes.
// Every other HID joystick or gamepad is read through its own descriptor (hid-layout.ts).

import type { RawFrame } from './calib';

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

/** The EdgeTX radio keeps its documented fixed layout (it works on the real radio); every other device goes by its descriptor. */
export function isEdgeTx(d: { vendorId: number; productId: number }): boolean {
    return d.vendorId === 0x1209 && d.productId === 0x4f54;
}
