// ux4b (train 4): cancel a scene that is loading. The owner: "I picked the wrong scene, I cannot cancel,
// I wait long for it and its walls". apps/fly/src/app/scene-load.ts is the one mechanism: a LoadRun's
// signal reaches every await of the load (abortable), every fetch, and the walls bake (bake.ts bakeBase).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadCancelled, LoadRun, LoadSlot, abortable, afterCancel, isCancelled } from '../../../apps/fly/src/app/scene-load';
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

// B-2: the flow. A fake load of three abortable steps stands for SceneHost.runLoad (DOM and engine stay out).
const wait = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** SceneHost.load in small: slot.next(), wait for the run replaced, then three steps; the log says what ran. */
function fakeHost(log: string[]): { load(id: string): Promise<'done' | 'cancelled'>; slot: LoadSlot } {
    const slot = new LoadSlot();
    const runLoad = async (run: LoadRun, prev: LoadRun | null, id: string): Promise<'done' | 'cancelled'> => {
        if (prev) await prev.settled;
        if (run.signal.aborted) { log.push(`${id}:never`); return 'cancelled'; }
        log.push(`${id}:start`);
        try {
            for (const step of ['lookup', 'splats', 'walls']) {
                await abortable(wait(40), run.signal);
                log.push(`${id}:${step}`);
            }
        } catch (e) {
            if (isCancelled(e, run.signal)) { log.push(`${id}:cancelled:${run.why}`); return 'cancelled'; }
            throw e;
        }
        return 'done';
    };
    return {
        slot,
        load(id) {
            const { run, prev } = slot.next();
            return run.watch(runLoad(run, prev, id));
        }
    };
}

describe('ux4b B-2: a pick during a load replaces it, Cancel stops it', () => {
    it('afterCancel: the pilot\'s Cancel opens the scene list, a new pick goes on at once', () => {
        expect(afterCancel('pilot')).toBe('picker');
        expect(afterCancel('replaced')).toBe('replace');
    });

    it('a second pick cancels the first at once and starts only after the first unwound (one load on the renderer)', async () => {
        const log: string[] = [];
        const host = fakeHost(log);
        const a = host.load('lublin');
        await wait(55); // lublin is past its lookup
        const b = host.load('wroclaw');
        expect(host.slot.current?.why).toBeNull();
        expect(await a).toBe('cancelled');
        expect(await b).toBe('done');
        expect(log).toEqual(['lublin:start', 'lublin:lookup', 'lublin:cancelled:replaced', 'wroclaw:start', 'wroclaw:lookup', 'wroclaw:splats', 'wroclaw:walls']);
        expect(host.slot.loading).toBe(false);
    });

    it('three quick picks: the last wins, the middle one never begins', async () => {
        const log: string[] = [];
        const host = fakeHost(log);
        const a = host.load('a');
        const b = host.load('b');
        const c = host.load('c');
        expect(await Promise.all([a, b, c])).toEqual(['cancelled', 'cancelled', 'done']);
        expect(log.filter((l) => l.startsWith('b'))).toEqual(['b:never']);
        expect(log.filter((l) => l.startsWith('c'))).toEqual(['c:start', 'c:lookup', 'c:splats', 'c:walls']);
    });

    it('Cancel stops the load under way with why pilot; with none under way it says false', async () => {
        const log: string[] = [];
        const host = fakeHost(log);
        expect(host.slot.cancel()).toBe(false);
        const a = host.load('lublin');
        await wait(55);
        const t0 = Date.now();
        expect(host.slot.cancel()).toBe(true);
        expect(host.slot.cancel()).toBe(false); // a second press changes nothing
        expect(await a).toBe('cancelled');
        expect(Date.now() - t0).toBeLessThan(15); // at once, not after the step it was in
        expect(log).toEqual(['lublin:start', 'lublin:lookup', 'lublin:cancelled:pilot']);
        expect(host.slot.loading).toBe(false);
    });

    it('the host: no refusal while busy, the load\'s signal goes to the session, a cancel is no failure, Cancel on the card', () => {
        const hs = text('apps/fly/src/app/scene-host.ts');
        expect(hs).not.toContain('busyNow');
        expect(hs).toContain('signal: run.signal');
        expect(hs).toContain("onCancel: () => run.cancel('pilot')");
        expect(hs).toMatch(/await abortable\(next\.visible, run\.signal\)/);
        // the cancelled branch returns before recordFailure and the failure line
        const cancelled = hs.slice(hs.indexOf('if (isCancelled(e, run.signal))'), hs.indexOf('const code = failureCode(e)'));
        expect(cancelled).toContain("state: 'cancelled'");
        expect(cancelled).toContain('next?.dispose()');
        expect(cancelled).not.toContain('recordFailure');
        expect(hs).toMatch(/if \(this\.picking\) return false;/);
        const ld = text('apps/fly/src/ui/loading.ts');
        expect(ld).toContain("'data-action': 'load-cancel'");
        expect(ld).toContain("'aria-keyshortcuts': 'Escape'");
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(text(`packages/i18n/locales/fly/load/${l}.json`)) as Record<string, string>;
            for (const k of ['load.cancel', 'load.cancel.key', 'load.cancel.done', 'load.cancel.back']) expect(j[k], `${l} ${k}`).toBeTruthy();
            expect(j['load.cancel.back']).toContain('{title}');
        }
    });
});
