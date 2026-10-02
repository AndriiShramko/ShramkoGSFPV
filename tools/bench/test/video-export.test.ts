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
