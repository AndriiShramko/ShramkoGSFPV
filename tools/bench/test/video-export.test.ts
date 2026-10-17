// The video export from the flight log (docs/architecture-v03.md F.3, F.5; item 19): apps/fly/src/videoexport.ts
// driven with a fake engine (frames that show the scan incomplete, an encoder that is sometimes
// behind) on a life flown by sim-core. A 5 s stretch gives 300 frames, each encoded only on a frame
// drawn complete after its pose was set, and the frames show the replay at exactly k/60 s.
// Controls: a 1/30 s step gives 150 frames and the wrong last pose; encoding regardless of the
// scan's state encodes incomplete frames.
import { describe, expect, it } from 'vitest';
import { Runner, S, compileParams, lifeSim } from '../../../packages/sim-core/src/index';
import type { LifeHeader, Sim } from '../../../packages/sim-core/src/index';
import { PRESET, header } from '../../../packages/sim-core/test/log-kit';
import { LivesPlayer } from '../../../apps/fly/src/session/replay';
import type { WallsSource } from '../../../apps/fly/src/session/replay';
import { LogExport, exportFrameCount, exportFrameTick } from '../../../apps/fly/src/videoexport';
import type { ExportView, LogExportOptions } from '../../../apps/fly/src/videoexport';

const WALLS: WallsSource = { collisionSha256: null, world: null, collision: null };
const SCENE: LifeHeader['scene'] = { id: 'room', version: 3, transform: [1, 0, 0, 0], floaterMinBlocks: 0 };
const WORLD_AT = 3_000;

/** 7 s of flight with no walls: arm, climb, pitch and roll around; a scene-scale record at 3 s. */
function flight(): Runner {
    const r = new Runner(lifeSim(compileParams(PRESET), null), header({ at: [0, 2, 0, 0], scene: SCENE }), { traceHash: true });
    for (let t = 4000; t <= 7_000_000; t += 4000) {
        const ch = t < 20_000 ? [0, 0, -1, 0, -1, 1, 0, 0] : t < 100_000 ? [0, 0, -1, 0, 1, 1, 0, 0] : [Math.sin(t / 400_000) * 0.4, 0.3, 0.1, 0.2, 1, 1, 0, 0];
        r.enqueue({ tUs: t, ch });
        r.advanceTo(t);
        if (t === WORLD_AT * 1000) r.world({ s: 0.5, t: [1, 2, 3], floaterMinBlocks: 0 });
    }
    return r;
}

const RUN = flight();
const LIVES = RUN.lives();
const FROM = 1_000;
const TO = FROM + 5_000;

/** A fake engine: every third frame shows the scan still loading; the encoder is behind every fifth. */
function harness(o: Partial<LogExportOptions> = {}) {
    const engine = { frameNumber: 0, sceneComplete: true };
    const shown: { tick: number; ms: number }[] = [];
    const transforms: number[][] = [];
    let current: Sim | null = null;
    const view: ExportView = {
        beforeStep: () => undefined,
        crash: async () => undefined,
        respawn: () => undefined,
        transform: (t) => { if (transforms.length === 0 || transforms[transforms.length - 1].some((v, i) => v !== t[i])) transforms.push([...t]); },
        show: (sim, ms) => { current = sim; shown.push({ tick: sim.tick, ms }); },
        camera: () => { const s = current!.s; return [s[S.px], s[S.py], s[S.pz]]; }
    };
    let taken = 0;
    const sink = { get canTake() { return engine.frameNumber % 5 !== 0; }, take: () => { taken++; return true; } };
    const ex = new LogExport(LIVES, WALLS, { fromTick: FROM, toTick: TO, ...o }, engine, view, sink);
    const drive = async (): Promise<number> => {
        await ex.prepare();
        let drawn = 0;
        for (; drawn < 100_000 && !ex.done; drawn++) {
            engine.frameNumber++;
            engine.sceneComplete = engine.frameNumber % 3 !== 0;
            if (ex.onFrameEnd() === 'took') await ex.prepare();
        }
        return drawn;
    };
    return { ex, engine, shown, transforms, drive, taken: () => taken };
}

/** The replayed pose at a tick, from a fresh player (independent of the export's stepping). */
function replayed(tick: number): { p: number[]; q: number[] } {
    const pl = new LivesPlayer(LIVES, WALLS, tick);
    pl.stepTo(tick);
    const s = pl.sim.s;
    return { p: [s[S.px], s[S.py], s[S.pz]], q: [s[S.qw], s[S.qx], s[S.qy], s[S.qz]] };
}

describe('frames of a stretch of flight', () => {
    it('5 s at 60 fps is 300 frames, frame k at the nearest tick to k/60 s', () => {
        expect(exportFrameCount(5000)).toBe(300);
        expect(exportFrameCount(4999)).toBe(299);
        expect(exportFrameCount(5016)).toBe(300);
        expect(exportFrameCount(5017)).toBe(301);
        expect(exportFrameTick(100, 1)).toBe(117);
        expect(exportFrameTick(100, 3)).toBe(150);
        expect(exportFrameTick(100, 299)).toBe(100 + 4983);
    });
});

describe('LogExport on a flown life (fake engine)', () => {
    it('a 5 s stretch gives 300 frames, each encoded on a complete frame drawn after its pose, at k/60 s', async () => {
        const hx = harness();
        const drawn = await hx.drive();
        const ex = hx.ex;
        expect(ex.frames).toBe(300);
        expect(ex.k).toBe(300);
        expect(hx.taken()).toBe(300);
        expect(ex.encodedIncomplete).toBe(0);
        // the fake did make it wait: incomplete frames and a busy encoder were skipped, not encoded
        expect(ex.incomplete).toBeGreaterThan(50);
        expect(ex.waited).toBeGreaterThan(50);
        expect(drawn).toBeGreaterThan(300);
        // every frame shown once, at exactly the tick of k/60 s, the replay's clock with it
        expect(hx.shown.map((s) => s.tick)).toEqual(Array.from({ length: 300 }, (_, k) => exportFrameTick(FROM, k)));
        expect(hx.shown.every((s) => s.ms === s.tick - FROM)).toBe(true);
        // first and last frame poses equal the replayed sim's
        const first = replayed(FROM), last = replayed(exportFrameTick(FROM, 299));
        expect(ex.first!.tick).toBe(FROM);
        expect(ex.last!.tick).toBe(FROM + 4983);
        expect(ex.first!.p).toEqual(first.p);
        expect(ex.first!.q).toEqual(first.q);
        expect(ex.last!.p).toEqual(last.p);
        expect(ex.last!.q).toEqual(last.q);
        // the drone moved in those 5 s (else a wrong step could not show)
        expect(Math.hypot(last.p[0] - first.p[0], last.p[1] - first.p[1], last.p[2] - first.p[2])).toBeGreaterThan(0.5);
    });

    it('the scan is drawn under the life\'s transform: the header\'s, then the world record\'s from its tick', async () => {
        const hx = harness();
        await hx.drive();
        expect(hx.transforms).toEqual([[1, 0, 0, 0], [0.5, 1, 2, 3]]);
        const firstScaled = hx.shown.findIndex((s) => s.tick >= WORLD_AT);
        expect(firstScaled).toBeGreaterThan(0);
    });

    it('control: a 1/30 s frame step gives 150 frames and a last pose that is not the replay\'s at 299/60 s', async () => {
        const hx = harness({ stepFps: 30 });
        await hx.drive();
        expect(hx.ex.frames).toBe(150);
        expect(hx.ex.k).toBe(150);
        const want = replayed(exportFrameTick(FROM, 299));
        expect(hx.ex.last!.tick).toBe(FROM + 4967);
        expect(hx.ex.last!.p).not.toEqual(want.p);
    });

    it('control: encoding whatever the scan\'s state encodes frames drawn incomplete', async () => {
        const hx = harness({ ignoreScene: true });
        await hx.drive();
        expect(hx.ex.k).toBe(300);
        expect(hx.ex.encodedIncomplete).toBeGreaterThan(0);
    });
});

/**
 * v0.9 (the owner's item 3b): a scan that never becomes complete for the view (1994c65c at the finest
 * level: 70 s on a fast link, 10 min on the owner's, evidence/2026-10-17/v09-load-probe-base-export.json).
 * A fake clock moves 33 ms per drawn frame (a 30 Hz display).
 */
describe('a frame waits for the scan only so long (the export always finishes)', () => {
    async function never(o: Partial<LogExportOptions>) {
        let clock = 0;
        const engine = { frameNumber: 0, sceneComplete: false };
        let current: Sim | null = null;
        const view: ExportView = {
            beforeStep: () => undefined, crash: async () => undefined, respawn: () => undefined, transform: () => undefined,
            show: (sim) => { current = sim; },
            camera: () => { const s = current!.s; return [s[S.px], s[S.py], s[S.pz]]; }
        };
        const ex = new LogExport(LIVES, WALLS, { fromTick: FROM, toTick: FROM + 1000, now: () => clock, ...o }, engine, view, { canTake: true, take: () => true });
        await ex.prepare();
        const waits: string[] = [];
        const tookAt: number[] = [];
        let drawn = 0;
        for (; drawn < 50_000 && !ex.done; drawn++) {
            engine.frameNumber++;
            clock += 33;
            const step = ex.onFrameEnd();
            if (step === 'took' || step === 'done') tookAt.push(clock);
            if (step === 'took') await ex.prepare();
            else if (ex.waitingFor && waits[waits.length - 1] !== ex.waitingFor) waits.push(ex.waitingFor);
        }
        return { ex, drawn, seconds: clock / 1000, waits, tookAt };
    }

    it('60 frames: the first after 20 s, the others together after their share (60 x 0.15 s), all forced; the bar is told', async () => {
        const r = await never({});
        expect(r.ex.frames).toBe(60);
        expect(r.ex.k).toBe(60);
        expect(r.ex.forced).toBe(60);
        expect(r.ex.encodedIncomplete).toBe(60);
        // 20 s for frame 0, then 9 s for all the others together, within a frame each
        expect(r.seconds).toBeGreaterThan(20 + 9 - 0.1);
        expect(r.seconds).toBeLessThan(20 + 9 + 60 * 0.1);
        expect(r.waits).toContain('scan');
    });

    it('the share is spread: the last frames of a slow export wait their part too (v0.9 review: the first ones took it all, the rest waited 0)', async () => {
        const r = await never({});
        const gaps = r.tookAt.slice(1).map((t, i) => t - r.tookAt[i]);
        // each later frame waits about 9 s / 59 = 0.15 s (a frame of 33 ms more at most); front-loaded, the
        // last 50 frames came 33 ms apart (drawn, then encoded at once: their share was gone)
        expect(gaps.length).toBe(59);
        expect(Math.min(...gaps.slice(-10))).toBeGreaterThanOrEqual(100);
        expect(Math.max(...gaps)).toBeLessThan(250);
    });

    it('a share large enough: every later frame waits its full 4 s', async () => {
        const r = await never({ waitShareMs: 10_000 });
        expect(r.ex.k).toBe(60);
        expect(r.seconds).toBeGreaterThan(20 + 59 * 4 - 0.1);
        expect(r.seconds).toBeLessThan(20 + 59 * 4 + 60 * 0.1);
    });

    it('control (of the spread): a share of 0 makes every later frame go at once, 33 ms apart', async () => {
        const r = await never({ waitShareMs: 0 });
        const gaps = r.tookAt.slice(1).map((t, i) => t - r.tookAt[i]);
        expect(Math.max(...gaps.slice(-10))).toBe(33);
    });

    it('control: v0.8\'s unbounded wait (Infinity) never gets past frame 0', async () => {
        const r = await never({ firstWaitMs: Infinity, frameWaitMs: Infinity });
        expect(r.drawn).toBe(50_000);
        expect(r.ex.k).toBe(0);
        expect(r.ex.forced).toBe(0);
        expect(r.ex.forcedInMs()).toBeNull();
    });
});

/**
 * v0.9 review: a hidden tab draws no frames (no requestAnimationFrame), so the clock jumps between two
 * 'frameend's. That time must not count as waiting: before, one 50 s tab switch spent the whole share of a
 * 300-frame export (294 frames then encoded without a wait) or forced frame 0 with a scan the hidden tab
 * never streamed. Each case runs without the jump as its control; `forced` is 0 in both.
 */
describe('a hidden tab\'s time is not waiting', () => {
    /**
     * A fake engine on a fake clock, 33 ms a frame. A view is complete `needMs` after its pose was placed
     * (the downloads go on while hidden), or after `needDrawn` drawn frames of its wait (`firstNeedDrawn`
     * for frame 0: the engine streams only while it draws). `gap` jumps the clock once while frame `k`
     * waits for the scan (the tab hidden for `ms`).
     */
    async function hidden(o: { needMs?: number; needDrawn?: number; firstNeedDrawn?: number; gap?: { k: number; ms: number } }) {
        let clock = 0;
        const engine = { frameNumber: 0, sceneComplete: false };
        let current: Sim | null = null;
        const view: ExportView = {
            beforeStep: () => undefined, crash: async () => undefined, respawn: () => undefined, transform: () => undefined,
            show: (sim) => { current = sim; },
            camera: () => { const s = current!.s; return [s[S.px], s[S.py], s[S.pz]]; }
        };
        const ex = new LogExport(LIVES, WALLS, { fromTick: FROM, toTick: TO, now: () => clock }, engine, view, { canTake: true, take: () => true });
        await ex.prepare();
        let poseAt = clock;
        let drawnInWait = 0;
        let jumped = false;
        for (let drawn = 0; drawn < 100_000 && !ex.done; drawn++) {
            engine.frameNumber++;
            clock += 33;
            drawnInWait++;
            engine.sceneComplete = o.needMs !== undefined
                ? clock - poseAt >= o.needMs
                : drawnInWait >= (ex.k === 0 ? o.firstNeedDrawn ?? 1 : o.needDrawn ?? 1);
            const step = ex.onFrameEnd();
            if (step === 'took') {
                await ex.prepare();
                poseAt = clock;
                drawnInWait = 0;
            } else if (o.gap && !jumped && ex.k === o.gap.k && ex.waitingFor === 'scan') {
                clock += o.gap.ms;
                jumped = true;
            }
        }
        return { ex, jumped, seconds: clock / 1000 };
    }

    it('a 50 s tab switch while frame 5 waits leaves the share for the other frames (each view needs 66 ms)', async () => {
        const r = await hidden({ needMs: 66, gap: { k: 5, ms: 50_000 } });
        expect(r.jumped).toBe(true);
        expect(r.ex.k).toBe(300);
        expect(r.ex.forced).toBe(0);
        const control = await hidden({ needMs: 66 });
        expect(control.ex.k).toBe(300);
        expect(control.ex.forced).toBe(0);
    });

    it('a 50 s tab switch at frame 0 does not force it before the scan it needs was drawn in (10 s of frames)', async () => {
        const r = await hidden({ firstNeedDrawn: 300, needDrawn: 2, gap: { k: 0, ms: 50_000 } });
        expect(r.jumped).toBe(true);
        expect(r.ex.k).toBe(300);
        expect(r.ex.forced).toBe(0);
        const control = await hidden({ firstNeedDrawn: 300, needDrawn: 2 });
        expect(control.ex.forced).toBe(0);
    });

    it('the bound still holds across tab switches: a scan never complete, hidden 30 s at every frame, still finishes', async () => {
        let clock = 0;
        const engine = { frameNumber: 0, sceneComplete: false };
        let current: Sim | null = null;
        const view: ExportView = {
            beforeStep: () => undefined, crash: async () => undefined, respawn: () => undefined, transform: () => undefined,
            show: (sim) => { current = sim; },
            camera: () => { const s = current!.s; return [s[S.px], s[S.py], s[S.pz]]; }
        };
        const ex = new LogExport(LIVES, WALLS, { fromTick: FROM, toTick: FROM + 1000, now: () => clock }, engine, view, { canTake: true, take: () => true });
        await ex.prepare();
        for (let drawn = 0; drawn < 50_000 && !ex.done; drawn++) {
            engine.frameNumber++;
            clock += drawn % 10 === 9 ? 30_000 : 33;
            if (ex.onFrameEnd() === 'took') await ex.prepare();
        }
        expect(ex.k).toBe(60);
        expect(ex.forced).toBe(60);
    });
});
