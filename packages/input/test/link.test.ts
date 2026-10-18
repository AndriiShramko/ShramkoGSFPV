// The link meter (link.ts): what a device's report cadence looks like on the timelines of a USB cable
// and of Bluetooth LE (sim/link-timelines.ts), and that the verdict is about the LINK. Every verdict
// has a control that must say something else: no wired timeline (1000, 125 and 100 Hz) is ever called
// slow, a bursty one is told from a merely slow one, the page's own stalls are not the link's, a quiet
// device is not a slow one, and a window with too few reports says nothing. Review 2026-10-18: the
// slow line was 10 ms, exactly the report period of a 100 Hz wired joystick, so timer noise decided.
import { describe, expect, it } from 'vitest';
import { LINK, LinkMeter } from '../src/link';
import { LINK_MEAN_MS, mulberry32, reportTimes } from '../src/sim';
import type { LinkKind } from '../src/sim';

/** A meter fed with `kind` for `ms`, asked at the end of it. */
function measure(kind: LinkKind, ms = 3000, seed = 1) {
    const m = new LinkMeter();
    for (const t of reportTimes(kind, ms, seed)) m.note(t);
    return m.stats(ms);
}

describe('LinkMeter on the timelines of each link', () => {
    it('USB at 1000 Hz and 125 Hz: fast and steady, no note', () => {
        for (const [kind, hz] of [['usb1000', 1000], ['usb125', 125]] as const) {
            const s = measure(kind);
            expect(s.verdict, kind).toBe('ok');
            expect(s.hz / hz, kind).toBeGreaterThan(0.97);
            expect(s.hz / hz, kind).toBeLessThan(1.03);
            expect(s.jitterMs, kind).toBeLessThan(0.6);
            expect(s.ageMs, kind).toBeLessThan(5);
        }
    });

    it('Bluetooth at about 90 Hz: a link that delivers on time (11 ms): its numbers, no verdict against it', () => {
        const s = measure('ble90');
        expect(s.verdict).toBe('ok');
        expect(s.meanMs).toBeGreaterThan(10.5);
        expect(s.meanMs).toBeLessThan(11.7);
        expect(s.jitterMs).toBeGreaterThan(1.3); // uniform +-3 ms: 1.7
        expect(s.jitterMs).toBeLessThan(2.2);
        expect(s.maxGapMs).toBeLessThan(15);
        expect(s.ageMs).toBeCloseTo(s.meanMs / 2, 0); // a steady device: the newest report is half a gap old
    });

    it('Bluetooth at about 50 Hz (a 20 ms interval) is slow, and so is a steady 16.7 ms: just over the line', () => {
        const s = measure('ble50');
        expect(s.verdict).toBe('slow');
        expect(s.meanMs).toBeGreaterThan(18.5);
        expect(s.meanMs).toBeLessThan(21.5);
        expect(s.bunched).toBeLessThan(0.05);
    });

    it('a wired joystick at 100 Hz (HID interval 10 ms) is not slow, whatever its timer noise: its mean sits where the old line was', () => {
        // review 2026-10-18: with the line at 10 ms, 28 of 40 runs of this device came out "slow"
        for (let seed = 1; seed <= 40; seed++) {
            for (const slack of [LINK.STALL_SLACK_MS, 0]) { // WebHID (timed by the page) and the Gamepad API (timed by the browser)
                const m = new LinkMeter(slack);
                for (const t of reportTimes('usb100', 3000, seed)) m.note(t);
                const s = m.stats(3000);
                expect(s.verdict, `usb100 seed ${seed} slack ${slack}`).toBe('ok');
                expect(s.meanMs).toBeGreaterThan(9.9);
                expect(s.meanMs).toBeLessThan(10.1);
            }
        }
    });

    it('control: the line itself: a mean of 10 ms is ok, 15 ms is ok, 16 ms is slow (so the line is neither 10 nor out of reach of a slow link)', () => {
        const steady = (gap: number) => {
            const m = new LinkMeter();
            for (let t = 0; t < 3000; t += gap) m.note(t);
            return m.stats(3000).verdict;
        };
        expect(steady(10)).toBe('ok');
        expect(steady(LINK.SLOW_MS)).toBe('ok');
        expect(steady(LINK.SLOW_MS + 1)).toBe('slow');
        expect(LINK.SLOW_MS).toBeGreaterThan(11.25); // above Apple's documented best case for BLE HID, not a verdict against it
    });

    it('Bluetooth at 30 Hz is slow, not bursty (a regular 33 ms link has no bunches)', () => {
        const s = measure('ble30');
        expect(s.verdict).toBe('slow');
        expect(s.bunched).toBeLessThan(0.05);
        expect(s.meanMs).toBeGreaterThan(31);
    });

    it('Bluetooth in bunches (3-6 reports together every 50-100 ms): bursty, with the pause between bunches as the longest gap', () => {
        const s = measure('bleBursty');
        expect(s.verdict).toBe('bursty');
        expect(s.bunched).toBeGreaterThan(0.5);
        expect(s.maxGapMs).toBeGreaterThan(45);
        expect(s.maxGapMs).toBeLessThan(105);
        // the mean gap looks like a fast link (16.7 ms); the age does not: the newest value is 3x older
        expect(s.ageMs).toBeGreaterThan(s.meanMs * 1.8);
        expect(s.ageMs).toBeGreaterThan(25);
    });

    it('control: the same mean cadence without bunches (a steady 16.7 ms) is slow, not bursty, and its newest value is far fresher', () => {
        const m = new LinkMeter();
        for (let t = 0; t < 3000; t += LINK_MEAN_MS.bleBursty) m.note(t);
        const steady = m.stats(3000);
        const bursty = measure('bleBursty');
        expect(steady.verdict).toBe('slow');
        expect(steady.ageMs).toBeLessThan(bursty.ageMs / 2);
    });

    it('control: no timeline of a cable gets a verdict against it, on any seed', () => {
        for (let seed = 1; seed <= 20; seed++) {
            expect(measure('usb1000', 3000, seed).verdict).toBe('ok');
            expect(measure('usb125', 3000, seed).verdict).toBe('ok');
            expect(measure('usb100', 3000, seed).verdict).toBe('ok');
        }
    });

    it('control: every slow or bunched timeline gets its verdict, on any seed (the meter is not tuned to one), and a healthy BLE link none', () => {
        for (let seed = 1; seed <= 20; seed++) {
            expect(measure('ble90', 3000, seed).verdict, `ble90 ${seed}`).toBe('ok');
            expect(measure('ble50', 3000, seed).verdict, `ble50 ${seed}`).toBe('slow');
            expect(measure('ble30', 3000, seed).verdict, `ble30 ${seed}`).toBe('slow');
            expect(measure('bleBursty', 3000, seed).verdict, `bursty ${seed}`).toBe('bursty');
        }
    });
});

describe('LinkMeter leaves out what is not the link', () => {
    it('a device that reports only changes: its idle seconds are not a slow link', () => {
        // 100 Hz while the sticks move (0.5 s), then 1.5 s of nothing, three times
        const m = new LinkMeter();
        for (let k = 0; k < 3; k++) for (let i = 0; i < 50; i++) m.note(k * 2000 + i * 10);
        const s = m.stats(6000);
        expect(s.verdict).toBe('ok');
        expect(s.meanMs).toBeCloseTo(10, 5);
        expect(s.hz).toBeCloseTo(100, 3);
    });

    it('control: the same timeline with its idle gaps kept would read as a slow link (they are what is dropped)', () => {
        const gaps: number[] = [];
        let prev = NaN;
        for (let k = 0; k < 3; k++) for (let i = 0; i < 50; i++) { const t = k * 2000 + i * 10; if (!Number.isNaN(prev)) gaps.push(t - prev); prev = t; }
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        expect(mean).toBeGreaterThan(LINK.SLOW_MS * 2); // 30 ms against a real 10 ms
    });

    it('a 1000 Hz USB device read through WebHID while the page is blocked 20 ms of every 40 ms: bursty without the stall list, ok with it', () => {
        // events pile up during a block and are all delivered at its end, a few microseconds apart;
        // in the 20 ms the page is free they come on time, 1 ms apart
        const build = (withStalls: boolean) => {
            const m = new LinkMeter();
            for (let f = 0; f < 75; f++) {
                const start = f * 40;
                const end = start + 20;
                for (let i = 0; i < 20; i++) m.note(end + i * 0.01);
                for (let i = 1; i < 20; i++) m.note(end + i);
                if (withStalls) m.stall(start, end);
            }
            return m.stats(3000);
        };
        const without = build(false);
        const withList = build(true);
        expect(without.verdict).toBe('bursty');
        expect(withList.verdict).toBe('ok');
        expect(withList.meanMs).toBeCloseTo(1, 1);
    });

    it('a source timed by the device (no slack): the samples after a stall, taken on time, still count', () => {
        // the Gamepad API: the page looks every 4 ms for 8 ms of each 33 ms frame, and finds the samples' own times
        const build = (slack: number) => {
            const m = new LinkMeter(slack);
            for (let f = 0; f < 90; f++) {
                const start = f * 33.3;
                for (let i = 0; i < 25; i++) m.note(start + i); // the device reported every ms through the block
                m.stall(start, start + 25);
                for (let i = 25; i < 33; i++) m.note(start + i);
            }
            return m.stats(3000);
        };
        expect(build(0).n).toBeGreaterThan(300); // what is left after the stalls is measured
        expect(build(0).verdict).toBe('ok');
        expect(build(LINK.STALL_SLACK_MS).n).toBeLessThan(build(0).n); // the control: a slack drops the free window
    });

    it('control: a real bunched link is still bursty when the page also stalls now and then', () => {
        const m = new LinkMeter();
        for (const t of reportTimes('bleBursty', 3000, 3)) m.note(t);
        for (let k = 0; k < 10; k++) m.stall(k * 300 + 100, k * 300 + 125);
        expect(m.stats(3000).verdict).toBe('bursty');
    });

    it('timestamps that go backwards are not samples; the rest still measure', () => {
        const m = new LinkMeter();
        const r = mulberry32(5);
        let t = 0;
        for (let i = 0; i < 300; i++) {
            t += 8;
            m.note(t);
            if (r() < 0.2) m.note(t - 30); // a stale stamp
        }
        const s = m.stats(t);
        expect(s.meanMs).toBeCloseTo(8, 5);
        expect(s.verdict).toBe('ok');
    });

    it('the window: samples older than 3 s are gone, and a window with too few says nothing', () => {
        const m = new LinkMeter();
        for (const t of reportTimes('ble50', 1000)) m.note(t);
        expect(m.stats(1000).verdict).toBe('slow');
        expect(m.stats(1000 + LINK.WINDOW_MS + 50).verdict).toBe('unknown'); // the device went quiet
        const few = new LinkMeter();
        for (let i = 0; i < LINK.MIN_GAPS; i++) few.note(i * 5); // MIN_GAPS samples = MIN_GAPS - 1 gaps
        expect(few.stats(200).verdict).toBe('unknown');
        few.note(LINK.MIN_GAPS * 5);
        expect(few.stats(200).verdict).toBe('ok');
    });

    it('a full ring keeps the newest samples (1000 Hz for 6 s)', () => {
        const m = new LinkMeter();
        for (let i = 0; i < 6000; i++) m.note(i);
        const s = m.stats(6000);
        expect(s.n).toBeGreaterThan(2900);
        expect(s.meanMs).toBeCloseTo(1, 6);
    });
});
