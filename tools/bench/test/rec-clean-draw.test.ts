// v0.10 lane R, the owner's item 2: REC and auto-record draw the clean (sorted) picture while they run. In Node on the real
// Recording (apps/fly/src/app/builtin/recording.ts) with only the encoder replaced (as flight-ux-recording.test.ts): the
// recorder takes a hold on the sorted drawing (app/clean-draw.ts SortedHold) before its first frame and lets go when the
// recording ends, however it ends. Each claim has a control that must fail: a Recording without the dep (v0.9 left the
// pilot's drawing alone, so a stochastic desktop recorded grain), a recorder that never lets go, a failed start that
// keeps the hold.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { Recording } from '../../../apps/fly/src/app/builtin/recording';
import type { RecordingDeps } from '../../../apps/fly/src/app/builtin/recording';
import { SortedHold } from '../../../apps/fly/src/app/clean-draw';

const fake = vi.hoisted(() => {
    const state = { failStart: false, made: [] as { endByItself(): void; recording: boolean }[], framesWhileHeld: [] as boolean[] };
    type Sink = { write(c: { data: Uint8Array; position: number }): Promise<void>; close(): Promise<void> };
    type Target = { kind: string; open(name: string): Promise<Sink> };
    class FakeRecorder {
        static get supported(): boolean {
            return true;
        }
        recording = false;
        seconds = 0;
        lastCreditStripStd = 0;
        onEnded: ((info: unknown) => void) | null = null;
        readonly target: Target;
        /** what the first frame sees: the hook of this test reads the drawing's hold at start() */
        static onStart: (() => void) | null = null;
        constructor(readonly o: { scene: string; width: number; height: number; target: Target }) {
            this.target = o.target;
            state.made.push(this);
        }
        async start(): Promise<string> {
            FakeRecorder.onStart?.();
            if (state.failStart) throw new Error('the encoder refused');
            this.recording = true;
            return 'avc1.fake';
        }
        pause(): void {}
        addFrame(): void {}
        async cancel(): Promise<void> {
            this.recording = false;
        }
        stop(): Promise<unknown> {
            return this.close('stop');
        }
        endByItself(): void {
            void this.close('cap').then((info) => this.onEnded?.(info));
        }
        private async close(ended: string): Promise<unknown> {
            this.recording = false;
            const name = `gsfpv-${this.o.scene}-${state.made.indexOf(this)}.mp4`;
            const sink = await this.target.open(name);
            await sink.write({ data: new Uint8Array([1]), position: 0 });
            await sink.close();
            return {
                codec: 'avc1.fake', width: this.o.width, height: this.o.height, fps: 60, frames: 60, bytes: 1, seconds: 1, duplicated: 0, heldForEncoder: 0, dropped: 0,
                file: name, files: [{ name, bytes: 1, frames: 60, seconds: 1 }], where: this.target.kind, folder: '', ended, picture: '2d'
            };
        }
    }
    return { state, FakeRecorder };
});
vi.mock('../../../apps/fly/src/cinema', async (orig) => ({ ...(await orig<object>()), CinemaRecorder: fake.FakeRecorder }));

/** The page's wiring (builtin/cinema.ts): the dep takes the hold and counts it. */
function wired(hold: SortedHold): { deps: RecordingDeps; acquired: () => number } {
    let n = 0;
    return {
        deps: {
            prefs: mkStore(), canvas: { width: 1280, height: 720 } as HTMLCanvasElement, scene: () => ({ id: '723068d7', credit: 'credit' }), autoRespawn: () => false,
            cleanDraw: () => { n++; return hold.acquire(); }
        },
        acquired: () => n
    };
}
const settle = (rec: Recording): Promise<unknown> => rec.queue(async () => undefined);

afterEach(() => {
    fake.state.failStart = false;
    fake.state.made.length = 0;
    fake.FakeRecorder.onStart = null;
});

describe('REC draws sorted while it runs and lets go when it ends', () => {
    it('the pilot\'s REC: held before the first frame, held while recording, let go at stop', async () => {
        const hold = new SortedHold();
        const { deps } = wired(hold);
        const rec = new Recording(deps);
        const atStart: boolean[] = [];
        fake.FakeRecorder.onStart = () => atStart.push(hold.held);
        expect(hold.held).toBe(false);
        await rec.start({ auto: false, activation: true });
        expect([atStart, hold.held, rec.recording, rec.drawsClean]).toEqual([[true], true, true, true]);
        await rec.stop();
        expect([hold.held, rec.drawsClean]).toEqual([false, false]);
    });

    it('control: the v0.9 Recording (no dep) never takes the hold, so the pilot\'s stochastic drawing is recorded as it is', async () => {
        const hold = new SortedHold();
        const rec = new Recording({ ...wired(hold).deps, cleanDraw: undefined });
        await rec.start({ auto: false, activation: true });
        expect([rec.recording, hold.held, rec.drawsClean]).toEqual([true, false, false]);
        await rec.stop();
    });

    it('auto-record: held from the arm, let go by the auto stop 3 s after the disarm', async () => {
        const hold = new SortedHold();
        const rec = new Recording(wired(hold).deps);
        rec.setAuto(true);
        rec.onSim({ type: 'arm' }, 0, false);
        await settle(rec);
        expect([rec.recording, rec.autoRun, hold.held]).toEqual([true, true, true]);
        rec.onSim({ type: 'disarm', reason: 'switch' }, 1000, false);
        for (const t of [2000, 3999, 4000]) {
            rec.tick(t);
            await settle(rec);
        }
        expect([rec.recording, hold.held]).toEqual([false, false]);
    });

    it('a recording that ends by itself (the memory cap, a full disk) lets go too', async () => {
        const hold = new SortedHold();
        const rec = new Recording(wired(hold).deps);
        await rec.start({ auto: false, activation: true });
        expect(hold.held).toBe(true);
        fake.state.made.at(-1)!.endByItself();
        await vi.waitFor(() => expect(hold.held).toBe(false));
        expect(rec.recording).toBe(false);
    });

    it('a start the encoder refuses leaves nothing drawn sorted (control: the hold WAS taken, it did not simply never happen)', async () => {
        const hold = new SortedHold();
        const w = wired(hold);
        const rec = new Recording(w.deps);
        fake.state.failStart = true;
        await expect(rec.start({ auto: false, activation: true })).rejects.toThrow('the encoder refused');
        expect(w.acquired()).toBe(1);
        expect([hold.held, rec.recording, rec.drawsClean]).toEqual([false, false, false]);
        // the next recording works, and holds again
        fake.state.failStart = false;
        await rec.start({ auto: false, activation: true });
        expect(hold.held).toBe(true);
        await rec.stop();
        expect(hold.held).toBe(false);
    });

    it('two recordings one after the other: one hold each, none left over', async () => {
        const hold = new SortedHold();
        const w = wired(hold);
        const rec = new Recording(w.deps);
        for (let i = 0; i < 3; i++) {
            await rec.start({ auto: false, activation: true });
            expect(hold.held, `recording ${i}`).toBe(true);
            await rec.stop();
            expect(hold.held, `after ${i}`).toBe(false);
        }
        expect(w.acquired()).toBe(3);
        // control: a recorder that never lets go (a hold with no release on stop) leaves the page sorted for good
        const leaky = new SortedHold();
        leaky.acquire();
        expect(leaky.held).toBe(true);
    });

    it('the video export is its own business: opening it takes no hold from the Recording', async () => {
        const hold = new SortedHold();
        const w = wired(hold);
        const rec = new Recording(w.deps);
        const r = await rec.openExport({ width: 1280, height: 720, activation: true });
        expect([hold.held, w.acquired(), rec.exporting]).toEqual([false, 0, true]);
        await rec.cancelExport(r);
    });
});
