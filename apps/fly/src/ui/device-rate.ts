// What the Controls screen asks of the device in use besides its frames (v0.9 lane E): its reports per
// second, how those reports arrive (the line about a slow or bunched link) and, for a gamepad, a read
// of the pad just before each frame draws. Split from ui/radio.ts so Node tests run the real code
// (tools/bench/test/app-device-rate.test.ts): the screen itself needs a browser, these three do not.
import type { LinkStats } from '@gsfpv/input';
import { GamepadSource } from '../devices/gamepad';
import type { HidSource } from '../devices/hid';
import { t } from '../i18n';
import { linkLines } from './link-text';

/** The line about how the reports arrive is rewritten this often (numbers that change with every frame cannot be read). */
export const LINK_TEXT_MS = 500;

/**
 * A device as the Controls screen reads it. `link` and `pollNow` are the device's own and optional: the
 * simulated radio of the test modes has neither (a rate only), a WebHID radio has a link meter but
 * nothing to poll (its reports are events).
 */
export interface DeviceRate {
    /** reports per second */
    hz(): number;
    /** how the reports arrive: interval, jitter, longest gap, verdict */
    link?(now: number): LinkStats;
    /** read the pad once more, just before a frame draws (a gamepad only): a report the browser published since the polling loop's last look is in this frame, not the next */
    pollNow?(): void;
}

/** The rate of a real device with its link meter and, for a gamepad, its read-before-draw. */
export function rateOf(d: HidSource | GamepadSource): DeviceRate {
    if (d instanceof GamepadSource) return { hz: () => d.rateHz, link: (now) => d.link.stats(now), pollNow: () => d.pollNow() };
    return { hz: () => d.rateHz, link: (now) => d.link.stats(now) };
}

/** One display frame of the Controls screen: the pad is read once more, then the screen draws what it found. */
export function drawFrame(rate: DeviceRate, render: () => void): void {
    rate.pollNow?.();
    render();
}

/** The two elements the link readout writes: the line of numbers and the note. */
export interface LinkSlots {
    line: { textContent: string | null };
    note: { textContent: string | null; hidden: boolean | string };
}

/**
 * The Controls screen's line about how the device's reports arrive, and its note when the link is slow
 * or sends in bunches: written twice a second, nothing before the device has reported, nothing for a
 * device with no meter.
 */
export class LinkReadout {
    private at = -LINK_TEXT_MS;
    constructor(private slots: LinkSlots) {}

    /** `reporting`: the device has sent a frame (nothing to count before the first report). */
    update(rate: DeviceRate, now: number, reporting: boolean): void {
        if (!rate.link || now - this.at < LINK_TEXT_MS) return;
        this.at = now;
        const ll = reporting ? linkLines(rate.link(now), t, 'screen') : null;
        const line = ll?.line ?? '';
        const note = ll?.note ?? '';
        // assigning the same text again would make screen readers repeat it
        if (this.slots.line.textContent !== line) this.slots.line.textContent = line;
        if (this.slots.note.textContent !== note) this.slots.note.textContent = note;
        this.slots.note.hidden = !note;
    }
}
