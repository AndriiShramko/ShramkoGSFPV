// The live recorder's pure parts (apps/fly/src/cinema.ts; docs/architecture-v03.md F.1, F.2, F.5;
// items 19 and 14): the FramePacer puts rendered frames on a fixed 1/60 s grid, whatever the
// display rate, and counts repeated and dropped frames; auto-record starts at arm and stops 3 s
// after a disarm that is not a crash; file names and video sizes. Every claim has a negative
// control that must fire: v0.2's path (a frame per render, snapped to the track's rate) at 144 Hz
// puts about 2.4 frames in a slot, and at 60 Hz into its 30 fps track about 29 duplicate
// timestamps a second; the same checks catch both.
import { describe, expect, it } from 'vitest';
import { AutoRecordRules, FramePacer, bitrateFor, declareFramerate, outputSize, recordingName, slotUs } from '../../../apps/fly/src/cinema';

/** Render times of `seconds` at `hz`, each off by up to `jitterMs` (a vsync's wobble), seeded. */
function renderTimes(hz: number, seconds: number, jitterMs = 0, seed = 7, start = 1234.5): number[] {
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const n = Math.round(hz * seconds);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(start + (i * 1000) / hz + (jitterMs ? rnd() * jitterMs : 0));
    return out;
}

interface Run { stamps: number[]; at: number[]; repeats: number; dropped: number; pacer: FramePacer }

/** The pacer over these render times: each stamp is a slot written to the file, in order. */
function paced(times: readonly number[], fps: 30 | 60 = 60, maxRepeat?: number): Run {
    const pacer = new FramePacer(fps, { maxRepeat });
    const stamps: number[] = [];
    const at: number[] = [];
    let repeats = 0, dropped = 0;
    for (const t of times) {
        const r = pacer.onRendered(t);
        repeats += Math.max(0, r.slots.length - 1);
        dropped += r.dropped;
        for (const k of r.slots) { stamps.push(k); at.push(t); }
    }
    return { stamps, at, repeats, dropped, pacer };
}

/** v0.2's path (the control): every rendered frame, its timestamp snapped to the track's rate (Mediabunny). */
function unpaced(times: readonly number[], trackFps: number): number[] {
    const t0 = times[0];
    return times.map((t) => Math.round(((t - t0) / 1000) * trackFps));
}

/** What a constant-frame-rate file needs: one frame per slot, slots in order, no slot twice. */
function cfr(stamps: readonly number[]): { ok: boolean; duplicates: number; maxPerSlot: number; perSlot: number; gaps: number } {
    const count = new Map<number, number>();
    let ordered = true, gaps = 0;
    for (let i = 0; i < stamps.length; i++) {
        count.set(stamps[i], (count.get(stamps[i]) ?? 0) + 1);
        if (i > 0 && stamps[i] <= stamps[i - 1]) ordered = false;
        if (i > 0 && stamps[i] > stamps[i - 1] + 1) gaps += stamps[i] - stamps[i - 1] - 1;
    }
    const maxPerSlot = Math.max(...count.values());
    const duplicates = stamps.length - count.size;
    return { ok: ordered && duplicates === 0, duplicates, maxPerSlot, perSlot: stamps.length / count.size, gaps };
}

describe('FramePacer: a 60 fps file from any render rate (F.1, F.5)', () => {
    const HZ = [45, 60, 75, 144, 240];

    for (const hz of HZ) {
        it(`at ${hz} Hz: one frame per 1/60 s slot, slots in order, exactly k/60, 600 +- 1 in 10 s`, () => {
            const times = renderTimes(hz, 10, 1); // +-1 ms of vsync wobble
            const r = paced(times);
            const c = cfr(r.stamps);
            expect(c.ok).toBe(true);
            expect(c.gaps).toBe(0);
            expect(Math.abs(r.stamps.length - 600)).toBeLessThanOrEqual(1);
            expect(r.stamps[0]).toBe(0);
            // stamped exactly k/60 s: the microsecond timestamp is k/60 rounded, never two slots on one
            for (const k of r.stamps) expect(Math.abs(slotUs(k, 60) - (k * 1e6) / 60)).toBeLessThanOrEqual(0.5);
            // and the picture in slot k was rendered within half a slot of k/60 (the grid starts at the first frame)
            const t0 = times[0];
            r.stamps.forEach((k, i) => {
                const isRepeat = i + 1 < r.stamps.length && r.at[i + 1] === r.at[i];
                if (!isRepeat) expect(Math.abs(r.at[i] - t0 - (k * 1000) / 60)).toBeLessThanOrEqual(1000 / 120 + 1);
            });
            // the counts the pilot sees after stop
            const expectRepeats = hz < 60 ? Math.round(600 - hz * 10) : 0;
            expect(Math.abs(r.repeats - expectRepeats)).toBeLessThanOrEqual(1);
            expect(r.dropped).toBe(0);
            expect(r.pacer.duplicated).toBe(r.repeats);
            expect(r.pacer.stamped + r.pacer.dropped).toBe(r.pacer.slotCount);
            if (hz > 60) expect(r.pacer.unused).toBe(times.length - r.stamps.length);
        });
    }

    it("at 30 Hz (the owner's monitor over HDMI): still 60/1 with every slot filled, each frame twice, the repeats counted", () => {
        const r = paced(renderTimes(30, 10, 1));
        expect(cfr(r.stamps).ok).toBe(true);
        expect(Math.abs(r.stamps.length - 600)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.repeats - 300)).toBeLessThanOrEqual(1);
        expect(r.dropped).toBe(0);
    });

    it('a render hitch or a slow render: the missed slots repeat the previous frame up to 1 s, a longer gap is dropped; both counted', () => {
        // 15 Hz: every frame reaches 4 slots, 3 of them repeats; the file stays complete and constant-rate
        const r = paced(renderTimes(15, 10));
        expect(cfr(r.stamps).ok).toBe(true);
        expect(cfr(r.stamps).gaps).toBe(0);
        expect(r.repeats).toBe(3 * 149);
        expect(r.dropped).toBe(0);
        // a one-off 100 ms hitch at 60 Hz (the owner's PC has them, recording or not): 6 repeats, no gap
        const times = renderTimes(60, 3);
        const shift = (ms: number) => [...times.slice(0, 60), ...times.slice(60).map((t) => t + ms)];
        const h = paced(shift(100));
        expect(cfr(h.stamps).ok).toBe(true);
        expect(cfr(h.stamps).gaps).toBe(0);
        expect(h.repeats).toBe(6);
        expect(h.dropped).toBe(0);
        // a 1.5 s stall: one second of repeats, the rest of the gap dropped
        const long = paced(shift(1500));
        expect(long.repeats).toBe(60);
        expect(long.dropped).toBe(30);
        expect(cfr(long.stamps).gaps).toBe(30);
        expect(long.pacer.stamped + long.pacer.dropped).toBe(long.pacer.slotCount);
        // the limit is a parameter: the design's first figure (2) drops the 15 Hz render's fourth slot
        const two = paced(renderTimes(15, 10), 60, 2);
        expect(two.repeats).toBe(2 * 149);
        expect(two.dropped).toBe(149);
    });

    it('a pause (menu, hidden tab) takes no slots and leaves no gap: the grid restarts at the next frame', () => {
        const pacer = new FramePacer(60);
        const times = renderTimes(60, 3);
        const stamps: number[] = [];
        times.forEach((t, i) => {
            if (i === 60) pacer.pause(true);
            if (i === 120) pacer.pause(false);
            for (const k of pacer.onRendered(t).slots) stamps.push(k);
        });
        expect(cfr(stamps).ok).toBe(true);
        expect(cfr(stamps).gaps).toBe(0);
        expect(stamps.length).toBe(120);
        expect(pacer.dropped).toBe(0);
        expect(pacer.duplicated).toBe(0);
        // control: without the pause the same stretch would have been 60 more slots
        const plain = paced(times);
        expect(plain.stamps.length).toBe(180);
    });

    it('30 fps (recording.fps) works the same on its own grid', () => {
        const r = paced(renderTimes(60, 10, 1), 30);
        expect(cfr(r.stamps).ok).toBe(true);
        expect(Math.abs(r.stamps.length - 300)).toBeLessThanOrEqual(1);
        expect(r.repeats).toBe(0);
        for (const k of r.stamps.slice(0, 50)) expect(slotUs(k, 30)).toBe(Math.round((k * 1e6) / 30));
    });

    it('control: pacing off at 144 Hz puts about 2.4 frames in each slot, and the same check catches it', () => {
        const stamps = unpaced(renderTimes(144, 10, 1), 60);
        const c = cfr(stamps);
        expect(c.ok).toBe(false);
        expect(c.maxPerSlot).toBeGreaterThanOrEqual(2);
        expect(c.perSlot).toBeGreaterThan(2.3);
        expect(c.perSlot).toBeLessThan(2.5);
    });

    it("control: v0.2's 30 fps track at a 60 Hz render gives about 29-30 duplicate timestamps a second", () => {
        const stamps = unpaced(renderTimes(60, 10, 1), 30);
        const c = cfr(stamps);
        expect(c.ok).toBe(false);
        expect(c.duplicates / 10).toBeGreaterThanOrEqual(29);
        expect(c.duplicates / 10).toBeLessThanOrEqual(30.1);
        // the pacer on the same render times: none
        expect(cfr(paced(renderTimes(60, 10, 1)).stamps).duplicates).toBe(0);
    });
});

describe('auto-record: starts at arm, stops 3 s after a disarm that is not a crash (F.2, item 14)', () => {
    it('arm starts; a switch disarm stops exactly 3 s later', () => {
        const r = new AutoRecordRules();
        expect(r.onEvent({ type: 'arm' }, 1000, false)).toBe('start');
        expect(r.onEvent({ type: 'disarm', reason: 'switch' }, 5000, false)).toBeNull();
        expect(r.tick(7999)).toBeNull();
        expect(r.tick(8000)).toBe('stop');
        expect(r.tick(9000)).toBeNull(); // once
    });

    it('arming again within the 3 s keeps the same recording', () => {
        const r = new AutoRecordRules();
        r.onEvent({ type: 'arm' }, 0, false);
        r.onEvent({ type: 'disarm', reason: 'switch' }, 1000, false);
        expect(r.onEvent({ type: 'arm' }, 2500, false)).toBe('start');
        expect(r.tick(10_000)).toBeNull();
    });

    it('with auto-respawn on, a crash does not stop it, and neither does the respawn that follows', () => {
        const r = new AutoRecordRules();
        r.onEvent({ type: 'arm' }, 0, true);
        r.onEvent({ type: 'disarm', reason: 'crash' }, 1000, true);
        r.onEvent({ type: 'crash' }, 1000, true);
        r.onEvent({ type: 'respawn' }, 3000, true);
        expect(r.pendingStopAt).toBeNull();
        expect(r.tick(60_000)).toBeNull();
    });

    it('control: the same crash with auto-respawn off stops 3 s after it (the crash stays in the clip)', () => {
        const r = new AutoRecordRules();
        r.onEvent({ type: 'arm' }, 0, false);
        r.onEvent({ type: 'disarm', reason: 'crash' }, 1000, false);
        expect(r.tick(3999)).toBeNull();
        expect(r.tick(4000)).toBe('stop');
    });

    it('R while flying (a respawn that leaves the craft disarmed) counts as a disarm; one that keeps it armed does not', () => {
        const r = new AutoRecordRules();
        r.onEvent({ type: 'arm' }, 0, true);
        r.onEvent({ type: 'respawn' }, 2000, true);
        expect(r.pendingStopAt).toBe(5000);
        const k = new AutoRecordRules();
        k.onEvent({ type: 'arm' }, 0, true);
        k.onEvent({ type: 'respawn' }, 2000, true);
        k.onEvent({ type: 'arm' }, 2000, true); // kept armed: the runner's arm in the same step
        expect(k.tick(10_000)).toBeNull();
    });
});

describe('file names and video sizes (F.1, F.2)', () => {
    it('gsfpv-<scene>-<YYYYMMDD-HHMMSS>.mp4 in local time, -n for a second file in the same second', () => {
        const d = new Date(2026, 9, 1, 7, 5, 9);
        expect(recordingName('39e63ce9', d)).toBe('gsfpv-39e63ce9-20261001-070509.mp4');
        expect(recordingName('39e63ce9', d, 2)).toBe('gsfpv-39e63ce9-20261001-070509-2.mp4');
        expect(recordingName('../a b/c', d)).toBe('gsfpv-abc-20261001-070509.mp4');
    });

    it('the size as flown, or the canvas scaled to the chosen height (the governor may draw it smaller), always even', () => {
        expect(outputSize(3840, 2000, '1080p')).toEqual({ width: 2074, height: 1080 });
        expect(outputSize(640, 400, '1080p')).toEqual({ width: 1728, height: 1080 });
        expect(outputSize(1921, 1081, 'native')).toEqual({ width: 1920, height: 1080 });
        expect(outputSize(3840, 2160, '1440p')).toEqual({ width: 2560, height: 1440 });
        expect(outputSize(3840, 2160, '2160p')).toEqual({ width: 3840, height: 2160 });
    });

    it('bitrate w x h x fps x 0.1; a declared frame rate only up to 1920 x 1080', () => {
        expect(bitrateFor(1920, 1080, 60)).toBe(12_441_600);
        expect(declareFramerate(1920, 1080)).toBe(true);
        expect(declareFramerate(2560, 1440)).toBe(false);
    });
});
