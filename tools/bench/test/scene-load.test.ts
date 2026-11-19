// ux4b (train 4): cancel a scene that is loading. The owner: "I picked the wrong scene, I cannot cancel,
// I wait long for it and its walls". apps/fly/src/app/scene-load.ts is the one mechanism: a LoadRun's
// signal reaches every await of the load (abortable), every fetch, and the walls bake (bake.ts bakeBase).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadCancelled, LoadRun, abortable, isCancelled } from '../../../apps/fly/src/app/scene-load';
import { BakeCancelledError, bakeBase } from '../../../apps/fly/src/bake';
import type { BakeResult } from '../../../apps/fly/src/bake';

const ROOT = join(__dirname, '..', '..', '..');
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const never = <T>(): Promise<T> => new Promise<T>(() => { /* a download that never ends */ });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('abortable', () => {
    it('rejects with LoadCancelled at once on abort, while the work goes on', async () => {
        const run = new LoadRun();
        const p = abortable(never<number>(), run.signal);
        let got: unknown = 'waiting';
        p.catch((e) => { got = e; });
        await tick();
        expect(got).toBe('waiting');
        run.cancel('pilot');
        await tick();
        expect(got).toBeInstanceOf(LoadCancelled);
        expect((got as LoadCancelled).why).toBe('pilot');
        expect(isCancelled(got)).toBe(true);
    });
    it('an aborted signal rejects before the work is awaited; no signal passes p through', async () => {
        const run = new LoadRun();
        run.cancel('replaced');
        await expect(abortable(Promise.resolve(1), run.signal)).rejects.toBeInstanceOf(LoadCancelled);
        await expect(abortable(Promise.resolve(2))).resolves.toBe(2);
        await expect(abortable(Promise.resolve(3), new LoadRun().signal)).resolves.toBe(3);
    });
});

describe('LoadRun', () => {
    it("cancel('replaced') settles the run once its work unwinds; a finished run is not cancelled", async () => {
        const run = new LoadRun();
        const work = run.watch(abortable(never<void>(), run.signal));
        work.catch(() => { /* cancelled */ });
        run.cancel('replaced');
        await run.settled;
        expect(run.done).toBe(true);
        expect(run.why).toBe('replaced');
        const ok = new LoadRun();
        await ok.watch(Promise.resolve());
        ok.cancel('pilot');
        expect(ok.why).toBeNull();
        expect(ok.signal.aborted).toBe(false);
    });
    it('a load of three awaits stops after the first when cancelled there', async () => {
        const run = new LoadRun();
        const steps: string[] = [];
        let releaseLookup!: () => void;
        const lookup = new Promise<void>((r) => { releaseLookup = r; });
        // the shape of FlightSession.init: the lookup, the splats, the walls, each abortable
        const init = async (s: AbortSignal): Promise<void> => {
            await abortable(lookup, s); steps.push('lookup');
            await abortable(never<void>(), s); steps.push('splats');
            await abortable(never<void>(), s); steps.push('walls');
        };
        const p = run.watch(init(run.signal));
        p.catch(() => { /* cancelled */ });
        releaseLookup();
        await tick();
        run.cancel('pilot');
        await run.settled;
        expect(steps).toEqual(['lookup']);
        await expect(p).rejects.toBeInstanceOf(LoadCancelled);
    });
});

describe('the walls bake ends with its session (bake.ts bakeBase signal)', () => {
    it('a running step that cannot stop by itself is left at once, and no lighter step follows', async () => {
        const stop = new AbortController();
        let calls = 0;
        const bake = (): Promise<BakeResult> => { calls++; return never<BakeResult>(); };
        const p = bakeBase('x', 'meta', {} as never, () => {}, { size: { gaussians: 1000, bytes: 1 } as never, limits: null, capGb: 8, bake, signal: stop.signal });
        let got: unknown = 'waiting';
        p.catch((e) => { got = e; });
        await tick();
        expect(calls).toBe(1);
        stop.abort();
        await tick();
        expect(got).toBeInstanceOf(BakeCancelledError);
        expect(calls).toBe(1);
    });
});

describe('the load path carries the signal (by reading the code)', () => {
    it('session init awaits every step abortably and fetches with the signal', () => {
        const s = text('apps/fly/src/session/index.ts');
        expect(s).toMatch(/resolveScene\(o\.sceneId, signal \?/);
        expect(s).toContain('await abortable(splatLoad, signal)');
        expect(s).toContain('await abortable(walls, signal)');
        expect(s).toMatch(/new SessionLoader\(s, o\.onProgress, o\.signal\)/);
        expect(text('apps/fly/src/session/loader.ts')).toMatch(/fetch\(u, this\.signal \? \{ \.\.\.init, signal: this\.signal \}/);
    });
    it('the walls widget hands its stop to both bakes and aborts it on dispose', () => {
        const w = text('apps/fly/src/walls.ts');
        expect(w).toContain('bake: bakeOffThread, signal: stop.signal');
        expect(w).toMatch(/limits: fake, signal: stop\.signal \}\)/);
        expect(w).toMatch(/dispose: \(\) => \{\s+stop\.abort\(\);/);
    });
});
