// v0.9 lane A (the owner's items 8, 10/16): when the first view of a scan is shown. RevealWatch is driven
// with frame-by-frame traces shaped like the ones the probe recorded on the real page
// (evidence/2026-10-17/v09-load-probe-base*.json); every case also runs v0.8's rule (the control, copied
// below from loader.ts at 631fd5f) to show what the pilot met before.
import { describe, expect, it } from 'vitest';
import { RevealWatch, SETTLE_MS, REVEAL_STALL_MS, FLY_NOW_AFTER_MS, FlyNow, revealPartial } from '../../../apps/fly/src/session/reveal';
import type { RevealReason, ViewNow } from '../../../apps/fly/src/session/reveal';

const FRAME_MS = 33; // the owner's 30 Hz display

/** v0.8's watchCoarse: reveal on ready && loading 0 once loading > 0 was seen; else 30 s of silence (bytes and state). */
class V08Rule {
    private streaming = false;
    private state = '';
    private changedAt: number;
    constructor(now: number) { this.changedAt = now; }
    step(v: ViewNow, now: number): RevealReason | null {
        const st = `${v.ready}/${v.loading}`;
        if (st !== this.state) { this.state = st; this.changedAt = now; }
        if (v.loading > 0) this.streaming = true;
        if (v.ready && v.loading === 0 && this.streaming) return 'ready';
        if (now - Math.max(this.changedAt, v.lastByteAt) > 30000) return 'stall';
        return null;
    }
}

/** Runs a trace (one ViewNow per frame) until a reveal or `limitS`; the reveal and when (ms). */
function run(trace: (frame: number, now: number) => ViewNow, rule: 'v09' | 'v08', limitS = 120, pilotAt = Infinity): { why: RevealReason | null; ms: number } {
    const w = new RevealWatch(0);
    const old = new V08Rule(0);
    for (let f = 0; f * FRAME_MS <= limitS * 1000; f++) {
        const now = f * FRAME_MS;
        const v = trace(f, now);
        const why = rule === 'v09' ? w.step(v, now, now >= pilotAt) : old.step(v, now);
        if (why) return { why, ms: now };
    }
    return { why: null, ms: limitS * 1000 };
}

const view = (o: Partial<ViewNow>): ViewNow => ({ listed: true, complete: true, files: 1, filesIn: 1, drawn: 0, ready: true, loading: 0, lastByteAt: 0, ...o });

// single file (meta.json): whole before the engine draws it; the engine never reports a file loading
// (d8ba72a6: 908 frames, all ready, loading 0); drawn from the second frame
const SINGLE = (f: number): ViewNow => view({ drawn: f >= 2 ? 750322 : 0 });
// streamed (lod-meta.json): 2 coarse files arrive over 1.5 s with the engine loading them, then resident (a8cfc66e)
const STREAMED = (f: number, now: number): ViewNow => now < 1500
    ? view({ complete: false, files: 2, filesIn: now < 800 ? 0 : 1, drawn: now < 800 ? 0 : 380000, loading: 2, lastByteAt: now })
    : view({ files: 2, filesIn: 2, drawn: 760780, loading: 0, lastByteAt: 1500 });
// the first view is in and drawn, but the engine goes on loading something it does not need for it
// (a prefetch, the environment), bytes still flowing
const NEVER_QUIET = (f: number, now: number): ViewNow => view({ drawn: 760780, loading: 2, lastByteAt: now });
// ready and loading flip every frame and are never ready with nothing loading together
const FLIPPING = (f: number, now: number): ViewNow => view({ drawn: 760780, ready: f % 2 === 0, loading: f % 2 === 0 ? 1 : 0, lastByteAt: now });
// nothing arrives at all
const SILENT = (): ViewNow => view({ listed: false, complete: false, files: 0, filesIn: 0 });

describe('the first view is shown as soon as it is drawable, whatever the content type', () => {
    it('a single file: on the frame after the engine drew it (v0.8: 30 s of silence, the owner\'s "never loads")', () => {
        const now = run(SINGLE, 'v09');
        expect(now).toEqual({ why: 'ready', ms: 2 * FRAME_MS });
        const before = run(SINGLE, 'v08');
        expect(before.why).toBe('stall');
        expect(before.ms).toBeGreaterThan(30000);
    });

    it('a streamed scan: when its coarse files are resident (v0.8 too: this case always worked)', () => {
        expect(run(STREAMED, 'v09').why).toBe('ready');
        expect(run(STREAMED, 'v09').ms).toBeLessThan(1600);
        expect(run(STREAMED, 'v08').why).toBe('ready');
    });

    it('the engine never goes quiet: shown SETTLE_MS after the view was in (v0.8: never, the bytes kept the watchdog awake)', () => {
        const now = run(NEVER_QUIET, 'v09');
        expect(now.why).toBe('settled');
        expect(now.ms).toBeGreaterThanOrEqual(SETTLE_MS);
        expect(now.ms).toBeLessThan(SETTLE_MS + 2 * FRAME_MS);
        expect(run(NEVER_QUIET, 'v08').why).toBeNull();
    });

    it('ready / loading flipping every frame: bounded the same way (v0.8: never)', () => {
        expect(run(FLIPPING, 'v09').why).toBe('settled');
        expect(run(FLIPPING, 'v08').why).toBeNull();
    });

    it('nothing arrives: shown after REVEAL_STALL_MS with the reason (both rules)', () => {
        const now = run(SILENT, 'v09');
        expect(now.why).toBe('stall');
        expect(now.ms).toBeGreaterThan(REVEAL_STALL_MS);
        expect(now.ms).toBeLessThan(REVEAL_STALL_MS + 2 * FRAME_MS);
    });

    // v0.9 review: the bytes are in but the engine has drawn nothing yet (a slow GPU or the CPU sort preparing them)
    const SLOW_PREPARE = (f: number, now: number): ViewNow => view({ drawn: now < 4000 ? 0 : 750322, ready: now >= 4000 });
    const NEVER_DRAWN = (): ViewNow => view({ drawn: 0, ready: false });

    it('bytes in, nothing drawn for 4 s: shown when the engine drew it ("ready"), not "settled" on a blank scene at 2.5 s', () => {
        const now = run(SLOW_PREPARE, 'v09');
        expect(now.why).toBe('ready');
        expect(now.ms).toBeGreaterThanOrEqual(4000);
        expect(now.ms).toBeLessThan(4000 + 2 * FRAME_MS);
    });

    it('bytes in, never drawn: no "settled"; the stall shows it after REVEAL_STALL_MS, and as partial (the card does not say ready)', () => {
        const now = run(NEVER_DRAWN, 'v09');
        expect(now.why).toBe('stall');
        expect(now.ms).toBeGreaterThan(REVEAL_STALL_MS);
        expect(revealPartial('stall', NEVER_DRAWN())).toBe(true);
        // controls: the same stall with the scan drawn is not partial, nor is a settled or ready view
        expect(revealPartial('stall', view({ drawn: 1 }))).toBe(false);
        expect(revealPartial('settled', view({ drawn: 1 }))).toBe(false);
        expect(revealPartial('pilot', view({ complete: false, drawn: 1 }))).toBe(true);
        // and a view drawn with its bytes in still settles as before (NEVER_QUIET above)
        expect(run(NEVER_QUIET, 'v09').why).toBe('settled');
    });

    it('the settle bound counts down where the card can show it, and is null when not running', () => {
        const w = new RevealWatch(0);
        expect(w.revealInMs(0)).toBeNull();
        w.step(view({ drawn: 1, loading: 3 }), 100);
        expect(w.revealInMs(1100)).toBe(SETTLE_MS - 1000);
        w.step(view({ complete: false, drawn: 1, loading: 3 }), 1200);
        expect(w.revealInMs(1300)).toBeNull();
    });
});

describe('Fly now', () => {
    // a slow streamed coarse level: something drawn, more coming, bytes flowing
    const SLOW = (f: number, now: number): ViewNow => view({ complete: false, files: 16, filesIn: 3, drawn: 120000, loading: 13, lastByteAt: now });

    it('offered once something is drawn and the wait lasted FLY_NOW_AFTER_MS; pressing it shows the view', () => {
        const w = new RevealWatch(0);
        expect(w.canFlyNow(view({ drawn: 0 }), 10000)).toBe(false);
        expect(w.canFlyNow(view({ drawn: 1 }), FLY_NOW_AFTER_MS - 1)).toBe(false);
        expect(w.canFlyNow(view({ drawn: 1 }), FLY_NOW_AFTER_MS)).toBe(true);
        const pressedEarly = run(SLOW, 'v09', 120, 1000);
        expect(pressedEarly.why).toBe('pilot');
        expect(pressedEarly.ms).toBeGreaterThanOrEqual(FLY_NOW_AFTER_MS);
        expect(pressedEarly.ms).toBeLessThan(FLY_NOW_AFTER_MS + 2 * FRAME_MS);
    });

    it('control: without the press the same scan waits for its bytes (no reveal in 20 s)', () => {
        expect(run(SLOW, 'v09', 20).why).toBeNull();
    });

    it('a press before the loader watches is kept', () => {
        const f = new FlyNow();
        f.press();
        let called = 0;
        f.bind(() => { called++; });
        expect(called).toBe(1);
        f.press();
        expect(called).toBe(2);
    });
});
