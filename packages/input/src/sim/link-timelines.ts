// Synthetic report timelines of a controller's link, for the tests and the latency harness
// (v0.9 lane E, the owner's item 12): when the browser has each report the device sent. Seeded and
// deterministic. The numbers are the ones research found for each link (docs/wip/v09-e.md): a USB
// joystick reports on its polling interval (1 ms full speed at 1000 Hz, 8 ms at 125 Hz, 10 ms at the
// 100 Hz many wired joysticks use: HID bInterval 10), a Bluetooth LE joystick on its connection
// interval (Windows picks one in the 7.5-30 ms range) with jitter, or in bunches when the radio event
// carries several queued notifications.

import { mulberry32 } from './signals';

export type LinkKind =
    /** USB, 1000 Hz, timer jitter of a few tenths of a millisecond */
    | 'usb1000'
    /** USB, 125 Hz (an ordinary gamepad: 8 ms), jitter 0.3 ms */
    | 'usb125'
    /** USB, 100 Hz (HID bInterval 10 ms: many wired joysticks), timer noise 0.4 ms; its mean sits exactly on 10 ms */
    | 'usb100'
    /** Bluetooth LE at about 90 reports a second (11.1 ms) with +-3 ms of jitter */
    | 'ble90'
    /** Bluetooth LE at about 50 reports a second (20 ms: a central that stays at its own interval) with +-6 ms of jitter */
    | 'ble50'
    /** Bluetooth LE at about 30 reports a second (33 ms) with +-8 ms of jitter */
    | 'ble30'
    /** Bluetooth LE in bunches: 3-6 reports within 1.5 ms every 50-100 ms */
    | 'bleBursty';

/** The mean gap of each kind, ms (a bunch counts as its reports spread over its period). */
export const LINK_MEAN_MS: Record<LinkKind, number> = { usb1000: 1, usb125: 8, usb100: 10, ble90: 11.1, ble50: 20, ble30: 33.3, bleBursty: 75 / 4.5 };

/** The times (ms from 0, strictly increasing) at which the browser gets each report of `kind` over `durationMs`. */
export function reportTimes(kind: LinkKind, durationMs: number, seed = 1): number[] {
    const r = mulberry32(seed);
    const out: number[] = [];
    const push = (t: number): void => {
        const last = out.length ? out[out.length - 1] : -1;
        out.push(t > last ? t : last + 0.001);
    };
    if (kind === 'bleBursty') {
        for (let t = r() * 50; t < durationMs; t += 50 + r() * 50) {
            const k = 3 + Math.floor(r() * 4);
            for (let i = 0; i < k; i++) push(t + (i / k) * 1.5);
        }
        return out;
    }
    const gap = LINK_MEAN_MS[kind];
    const jit = { usb1000: 0.3, usb125: 0.3, usb100: 0.4, ble90: 6, ble50: 12, ble30: 16, bleBursty: 0 }[kind];
    for (let t = r() * gap; t < durationMs; t += gap + (r() - 0.5) * jit) push(t);
    return out;
}
