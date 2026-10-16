// Which known controller (@gsfpv/input known-devices.ts) a connected device is, from what its source
// can tell: a WebHID device by its USB ids and descriptor (HidSource.device), a Gamepad API pad by the
// ids in its id string and its counts (GamepadSource.info()). One place for the Controls screen
// (ui/radio.ts) and the input from last time (app/input.ts), so both ask the same question.
// Structural types, not the classes: the Node tests pass stand-ins.

import { knownOffer, recognise, seenFromGamepad, seenFromHid } from '@gsfpv/input';
import type { KnownMatch, Profile } from '@gsfpv/input';

/** What recognition needs of a WebHID source (HidSource). */
export interface HidSeen { device: HIDDevice | null }
/** What recognition needs of a Gamepad API source (GamepadSource). */
export interface PadSeen { info(): { id: string; axes: { length: number }; buttons: { length: number } } | null }

/** The known controller behind a source of the given kind, or null (not connected, not known, another kind). */
export function recogniseSource(kind: string, dev: HidSeen | PadSeen | null | undefined): KnownMatch | null {
    if (!dev) return null;
    if (kind === 'hid' && 'device' in dev && dev.device) return recognise(seenFromHid(dev.device));
    if (kind === 'gamepad' && 'info' in dev) {
        const i = dev.info();
        return i ? recognise(seenFromGamepad(i)) : null;
    }
    return null;
}

/** A device and the setup it flies with (RadioChoice's shape). */
export interface ChoiceSeen { kind: string; profile: Profile | null; hid?: HidSeen; gamepad?: PadSeen }

/**
 * The known setup to offer for the setup a choice flies with (knownOffer: a recognised controller's
 * setup saved before it was recognised), with the match it came from; null when there is none.
 */
export function choiceOffer(c: ChoiceSeen | null): { offer: Profile; match: KnownMatch } | null {
    if (!c?.profile) return null;
    const match = recogniseSource(c.kind, c.kind === 'hid' ? c.hid : c.kind === 'gamepad' ? c.gamepad : null);
    const offer = match ? knownOffer(c.profile, match) : null;
    return offer && match ? { offer, match } : null;
}
