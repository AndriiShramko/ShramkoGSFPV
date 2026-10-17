// A short timer that tells a LinkMeter when the page's main thread was busy. WebHID hands over its
// reports as events on the main thread, stamped when the page runs them (event.timeStamp): while a
// frame holds the thread for 25 ms, 25 reports of a 1000 Hz cable queue up and run together, which
// looks exactly like a Bluetooth link that sends in bunches. A timer that comes round late is the
// witness: every pass that is more than STALL_MS later than its period is a stall of the page, and
// the meter leaves the gaps it caused out of the link's numbers.
import type { LinkMeter } from '@gsfpv/input';

/** The timer's period (the browser clamps below this anyway) and the lateness that counts as a stall, ms. */
const PERIOD_MS = 4;
const STALL_MS = 12;

/** Watch the page for stalls on behalf of `meter` until the returned function is called. A hidden page's timers are throttled to once a second: nothing is noted then. */
export function watchStalls(meter: LinkMeter): () => void {
    let last = performance.now();
    const id = setInterval(() => {
        const now = performance.now();
        // (no document: a Node test of a source, where the timer must not keep the process alive either)
        if (now - last > STALL_MS && (typeof document === 'undefined' || document.visibilityState === 'visible')) meter.stall(last, now);
        last = now;
    }, PERIOD_MS);
    (id as { unref?: () => void }).unref?.();
    return () => clearInterval(id);
}
