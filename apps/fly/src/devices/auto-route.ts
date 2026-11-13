// Which way the Controls screen opens a controller it found by itself (lane connect, review CN-4). An FPV radio shows
// on the Gamepad API as soon as it is plugged in and, granted before, in navigator.hid.getDevices() too: the pad watch
// and the screen's first look must open the route under which the pilot's setup is saved, so a returning pilot gets
// his check screen and not a new wizard. Pure: the caller lists the devices and the saved profile keys.

/** What a granted WebHID device shows before it is opened. */
export interface HidSeenNow { vendorId: number; productId: number; productName?: string }

/** A pad on the Gamepad API: its profile key (gamepadKey) and whether a known controller table names it. */
export interface PadSeenNow { key: string; known: boolean }

export type AutoRoute = { kind: 'hid'; index: number } | { kind: 'pad' } | null;

/** The saved profile keys of a HID device start with this (hidProfileKey: `hid:<vid>:<pid>:<product name>:...`). */
export function hidKeyPrefix(d: HidSeenNow): string {
    return `hid:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName ?? ''}:`;
}

/**
 * The route to open: a granted HID device with a saved setup first, then a pad with a saved setup, then a pad a
 * known controller table names, then any granted HID device (the better route for a new setup: its own reports),
 * then the pad. `null`: nothing to open.
 */
export function autoRoute(o: { pad: PadSeenNow | null; hid: readonly HidSeenNow[]; saved: readonly string[] }): AutoRoute {
    const saved = new Set(o.saved);
    const hidSaved = o.hid.findIndex((d) => { const p = hidKeyPrefix(d); return o.saved.some((k) => k.startsWith(p)); });
    if (hidSaved >= 0) return { kind: 'hid', index: hidSaved };
    if (o.pad && (saved.has(o.pad.key) || o.pad.known)) return { kind: 'pad' };
    if (o.hid.length) return { kind: 'hid', index: 0 };
    return o.pad ? { kind: 'pad' } : null;
}
