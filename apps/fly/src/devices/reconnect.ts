// Item 5: a radio that was set up before flies again without the Controls screen. The browser
// remembers which HID devices this site may open (navigator.hid.getDevices(), no prompt, no user
// gesture); a gamepad appears on its own once an axis is off centre (an EdgeTX throttle at the
// bottom already is). A device counts only when its fingerprint has a saved profile.

import type { Profile } from '@gsfpv/input';
import { HidSource } from './hid';
import { GamepadSource } from './gamepad';

export interface Reconnected {
    kind: 'hid' | 'gamepad';
    profile: Profile;
    hid?: HidSource;
    gamepad?: GamepadSource;
}

type Lookup = (key: string) => Profile | null;

/** The first report tells the report length, which is part of the fingerprint. */
function firstReport(src: HidSource, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => { src.onFrame = null; resolve(false); }, ms);
        src.onFrame = () => { clearTimeout(timer); src.onFrame = null; resolve(true); };
    });
}

/** Open every granted HID device, keep the one with a saved profile (`prefer` first), release the rest. */
export async function findSavedHid(lookup: Lookup, prefer: string | null, ms = 1500): Promise<Reconnected | null> {
    if (!HidSource.supported()) return null;
    let devices: HIDDevice[];
    try {
        devices = await (navigator as Navigator & { hid: HID }).hid.getDevices();
    } catch {
        return null;
    }
    const tries = await Promise.all(devices.map(async (d) => {
        const wasOpen = d.opened;
        const src = new HidSource();
        try {
            await src.open(d);
            const heard = await firstReport(src, ms);
            const profile = heard ? lookup(src.key) : null;
            return { d, src, wasOpen, profile };
        } catch {
            src.close();
            return { d, src, wasOpen, profile: null };
        }
    }));
    const hit = tries.find((x) => x.profile && x.src.key === prefer) ?? tries.find((x) => x.profile);
    for (const x of tries) {
        if (x === hit) continue;
        x.src.close();
        if (!x.wasOpen && x.d.opened) void x.d.close().catch(() => undefined); // not ours to keep
    }
    return hit?.profile ? { kind: 'hid', profile: hit.profile, hid: hit.src } : null;
}

/** A connected gamepad whose fingerprint has a saved profile, within `ms`. */
export function findSavedGamepad(lookup: Lookup, ms = 1500): Promise<Reconnected | null> {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return Promise.resolve(null);
    const gp = new GamepadSource();
    let seen = '';
    return new Promise((resolve) => {
        const timer = setTimeout(() => { gp.onFrame = null; gp.stop(); resolve(null); }, ms);
        gp.onFrame = () => {
            const key = gp.key;
            if (key === seen) return; // looked up already (frames come at up to 500 Hz)
            seen = key;
            const profile = lookup(key);
            if (!profile) return; // a pad not set up yet: the Controls screen handles it
            clearTimeout(timer);
            gp.onFrame = null;
            resolve({ kind: 'gamepad', profile, gamepad: gp });
        };
        gp.start();
    });
}
