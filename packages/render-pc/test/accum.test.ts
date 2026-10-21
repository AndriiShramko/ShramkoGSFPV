// The adapter around the vendored SuperSplat renderer (v0.11 lane S, accum.ts) without a GPU: the engine-member check
// (accumMissing), the guards that keep an exception out of the engine's frame event, render graph and frameend (guardFrame,
// guardRenderer), and the on/off/failed life of AccumDrawing with a fake renderer. What discriminates: each engine member is
// removed from an otherwise complete engine and must be named; a throw at each guarded site must be swallowed, hand the splats
// back (at the frame's end for the passes) and tell the caller once; an empty engine must be reported as missing everything;
// an adapter that forgets a failure would enable again.
import { describe, it, expect, vi } from 'vitest';
import type { AppBase, CameraComponent, Layer } from 'playcanvas';
import { AccumDrawing, accumMissing, guardFrame, guardRenderer, worldLayer } from '../src/accum';
import type { GuardSite } from '../src/accum';
import { ACCUM_REQUIRES } from '../src/accum-policy';
import type { StochasticSplatRenderer } from '../src/vendor/supersplat-viewer/render/stochastic-splat-renderer';

type Anything = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** An app shaped like a WebGPU engine 2.23 with everything the renderer drives; `over` replaces parts. */
const app = (over: Anything = {}): AppBase => {
    const device = {
        isWebGPU: true, computeDispatch() {}, getIndirectDrawSlot() { return 0; }, getIndirectDispatchSlot() { return 0; },
        indirectDrawBuffer: {}, indirectDispatchBuffer: {}, wgpu: { limits: { maxStorageBufferBindingSize: 2 ** 31 } }, ...(over.device ?? {})
    };
    return {
        graphicsDevice: device,
        systems: { gsplat: { on() {} }, ...(over.systems ?? {}) },
        renderer: { gsplatDirector: {}, renderForwardLayer() {}, ...(over.renderer ?? {}) },
        scene: { layers: { getLayerById: () => ('layer' in over ? over.layer : {}) } }
    } as unknown as AppBase;
};
const cam = (beforePasses: unknown = []): CameraComponent => ({ camera: { beforePasses } }) as unknown as CameraComponent;
const M4 = 4_000_000;

describe('accumMissing', () => {
    it('finds nothing missing on an engine that has everything', () => {
        expect(accumMissing(app(), cam(), M4)).toEqual([]);
    });
    const cases: [string, Anything, string][] = [
        ['no WebGPU', { device: { isWebGPU: false } }, 'webgpu'],
        ['no computeDispatch', { device: { computeDispatch: undefined } }, 'computeDispatch'],
        ['no getIndirectDrawSlot', { device: { getIndirectDrawSlot: undefined } }, 'getIndirectDrawSlot'],
        ['no getIndirectDispatchSlot', { device: { getIndirectDispatchSlot: undefined } }, 'getIndirectDispatchSlot'],
        ['no indirectDrawBuffer', { device: { indirectDrawBuffer: undefined } }, 'indirectDrawBuffer'],
        ['no indirectDispatchBuffer', { device: { indirectDispatchBuffer: undefined } }, 'indirectDispatchBuffer'],
        ['no gsplat system', { systems: { gsplat: undefined } }, 'gsplat system events'],
        ['a gsplat system without events', { systems: { gsplat: {} } }, 'gsplat system events'],
        ['no gsplat director', { renderer: { gsplatDirector: undefined, renderForwardLayer() {} } }, 'gsplatDirector'],
        ['no renderForwardLayer', { renderer: { gsplatDirector: {}, renderForwardLayer: undefined } }, 'renderForwardLayer'],
        ['no World layer', { layer: null }, 'world layer']
    ];
    for (const [name, over, want] of cases) {
        it(`reports ${name}`, () => {
            const miss = accumMissing(app(over), cam(), M4);
            expect(miss, name).toContain(want);
        });
    }
    it('reports a camera without beforePasses', () => {
        expect(accumMissing(app(), cam(null), M4)).toContain('camera.beforePasses');
        expect(accumMissing(app(), { camera: null } as unknown as CameraComponent, M4)).toContain('camera.beforePasses');
    });
    it('reports a projected cache that does not fit one storage binding', () => {
        // 6 words of 4 bytes per splat, 25 % over: 8 M splats are 240 MB, over the 128 MiB default; 4 M are 120 MB, under it
        const small = app({ device: { wgpu: { limits: { maxStorageBufferBindingSize: 128 * 1024 * 1024 } } } });
        expect(accumMissing(small, cam(), M4)).toEqual([]);
        expect(accumMissing(small, cam(), 8_000_000)).toContain('cache fits one storage binding');
    });
    it('control: an engine that lacks everything is reported as lacking every requirement, and the rows above name every requirement (a check dropped from accumMissing fails its row)', () => {
        const empty = { graphicsDevice: { isWebGPU: false, wgpu: { limits: { maxStorageBufferBindingSize: 1 } } }, systems: {}, renderer: {}, scene: { layers: { getLayerById: () => null } } } as unknown as AppBase;
        // every requirement the policy knows, from the real checker on the real (empty) shape
        expect(new Set(accumMissing(empty, undefined, M4))).toEqual(new Set(ACCUM_REQUIRES));
        // and the rows above each remove ONE member of a complete engine: together they cover every requirement
        const named = new Set(cases.map(([, , want]) => want));
        named.add('camera.beforePasses');
        named.add('cache fits one storage binding');
        expect(named).toEqual(new Set(ACCUM_REQUIRES));
    });
});

describe('worldLayer', () => {
    it('is the layer the engine returns, null when it has none', () => {
        expect(worldLayer(app())).toEqual({});
        expect(worldLayer(app({ layer: null }))).toBeNull();
    });
});

describe('guardFrame', () => {
    it('passes the arguments and the return through while nothing throws', () => {
        const seen: unknown[][] = [];
        const r = { frame(...a: unknown[]) { seen.push(a); } };
        guardFrame(r, () => { throw new Error('unexpected'); });
        r.frame(1, 'two', {});
        expect(seen).toEqual([[1, 'two', {}]]);
    });
    it('keeps `this` for the original function', () => {
        const r = { n: 0, frame() { this.n++; } };
        guardFrame(r, () => undefined);
        r.frame();
        expect(r.n).toBe(1);
    });
    it('hands a throw to the callback instead of the engine\'s event', () => {
        const got: unknown[] = [];
        const r = { frame() { throw new Error('boom'); } };
        guardFrame(r, (e) => got.push(e));
        expect(() => r.frame()).not.toThrow();
        expect((got[0] as Error).message).toBe('boom');
    });
});

/** A renderer shaped like upstream's for the guards: its own `frame` and `onFrameEnd`, the passes it keeps (bind, raster, taa, four pixel-set passes), each with an `execute`. */
function shaped(log: string[]) {
    const pass = (name: string) => ({ name, execute() { log.push(name); } });
    return {
        frame() { log.push('frame'); },
        onFrameEnd() { log.push('frameend'); },
        bindPass: pass('bind'), rasterPass: pass('raster'), taaPass: pass('taa'), setPasses: [pass('s0'), pass('s1'), pass('s2'), pass('s3')]
    };
}
/** The part of an app that carries `frameend`: records the handlers; `endFrame` is what the engine does at the end of a frame. */
function events() {
    const handlers: (() => void)[] = [];
    const once: (() => void)[] = [];
    return {
        handlers,
        on: (name: string, cb: () => void) => { if (name === 'frameend') handlers.push(cb); },
        off: (name: string, cb: () => void) => { const i = handlers.indexOf(cb); if (name === 'frameend' && i >= 0) handlers.splice(i, 1); },
        once: (name: string, cb: () => void) => { if (name === 'frameend') once.push(cb); },
        endFrame() { for (const h of [...handlers]) h(); for (const h of once.splice(0)) h(); }
    };
}

describe('guardRenderer', () => {
    const sites = (calls: { site: GuardSite; e: unknown }[]) => calls.map((c) => c.site);

    it('guards the frame function, the bind, raster, pixel-set and taa passes and the frameend handler, and says which', () => {
        const log: string[] = [];
        const r = shaped(log);
        const app = events();
        app.on('frameend', r.onFrameEnd);
        const guarded = guardRenderer(r, app, { onThrow: () => undefined });
        expect(guarded.sort()).toEqual(['bind', 'frame', 'frameend', 'raster', 'sets', 'taa']);
        // the frameend registration moved to the guard: one handler, and it is the property's current value
        expect(app.handlers).toHaveLength(1);
        expect(app.handlers[0]).toBe(r.onFrameEnd);
    });
    it('swallows a throw at each site and names the site (the original function throws: the real thing the engine would have seen)', () => {
        for (const site of ['frame', 'bind', 'raster', 'sets', 'taa', 'frameend'] as GuardSite[]) {
            const log: string[] = [];
            const r = shaped(log);
            const app = events();
            app.on('frameend', r.onFrameEnd);
            const calls: { site: GuardSite; e: unknown }[] = [];
            // make the ORIGINAL at that site throw before it is guarded
            const boom = () => { throw new Error(`boom at ${site}`); };
            if (site === 'frame') r.frame = boom;
            else if (site === 'frameend') { app.off('frameend', r.onFrameEnd); r.onFrameEnd = boom; app.on('frameend', boom); }
            else if (site === 'bind') r.bindPass.execute = boom;
            else if (site === 'raster') r.rasterPass.execute = boom;
            else if (site === 'taa') r.taaPass.execute = boom;
            else r.setPasses[2].execute = boom;
            guardRenderer(r, app, { onThrow: (s, e) => calls.push({ site: s, e }) });
            // what the engine does: the event, the passes in order, the frameend event
            const frame = (): void => { r.frame(); r.bindPass.execute(); for (const p of r.setPasses) p.execute(); r.rasterPass.execute(); r.taaPass.execute(); app.endFrame(); };
            expect(frame, site).not.toThrow();
            expect(sites(calls), site).toEqual([site]);
            expect((calls[0].e as Error).message).toBe(`boom at ${site}`);
        }
    });
    it('control: the same throw without the guard reaches the engine at every site (the guard is what stops it)', () => {
        for (const site of ['frame', 'bind', 'raster', 'sets', 'taa', 'frameend'] as GuardSite[]) {
            const log: string[] = [];
            const r = shaped(log);
            const app = events();
            app.on('frameend', r.onFrameEnd);
            const boom = () => { throw new Error('boom'); };
            if (site === 'frame') r.frame = boom;
            else if (site === 'frameend') { app.off('frameend', r.onFrameEnd); r.onFrameEnd = boom; app.on('frameend', boom); }
            else if (site === 'bind') r.bindPass.execute = boom;
            else if (site === 'raster') r.rasterPass.execute = boom;
            else if (site === 'taa') r.taaPass.execute = boom;
            else r.setPasses[0].execute = boom;
            const frame = (): void => { r.frame(); r.bindPass.execute(); for (const p of r.setPasses) p.execute(); r.rasterPass.execute(); r.taaPass.execute(); app.endFrame(); };
            expect(frame, site).toThrow('boom');
        }
    });
    it('passes arguments and `this` through while nothing throws, and runs the hook first', () => {
        const seen: unknown[] = [];
        const r = { n: 0, frame(...a: unknown[]) { this.n++; seen.push(a); return 'done'; } };
        const before: GuardSite[] = [];
        guardRenderer(r, null, { onThrow: () => { throw new Error('unexpected'); }, before: (s) => before.push(s) });
        expect(r.frame(1, 'two')).toBe('done');
        expect(r.n).toBe(1);
        expect(seen).toEqual([[1, 'two']]);
        expect(before).toEqual(['frame']);
    });
    it('a throw from the hook is a throw of the function: swallowed, named, and the original does not run', () => {
        const log: string[] = [];
        const r = shaped(log);
        const calls: GuardSite[] = [];
        guardRenderer(r, null, { onThrow: (s) => calls.push(s), before: (s) => { if (s === 'raster') throw new Error('forced'); } });
        r.rasterPass.execute();
        r.taaPass.execute();
        expect(calls).toEqual(['raster']);
        expect(log).toEqual(['taa']);
    });
    it('once dead, every guarded function does nothing (the passes after a failed one never run on its half-written state)', () => {
        const log: string[] = [];
        const r = shaped(log);
        let dead = false;
        guardRenderer(r, null, { onThrow: () => { dead = true; }, dead: () => dead, before: (s) => { if (s === 'raster') throw new Error('x'); } });
        r.bindPass.execute();
        r.rasterPass.execute();
        r.taaPass.execute();
        r.frame();
        expect(log).toEqual(['bind']);
    });
    it('a member an upstream update renamed is missing from the answer instead of crashing', () => {
        const r = { frame() { /* kept */ }, rasterPass: {} as Record<string, unknown>, taaPass: null, setPasses: 'not a list' };
        expect(guardRenderer(r, null, { onThrow: () => undefined })).toEqual(['frame']);
    });
});

type Fake = StochasticSplatRenderer & {
    calls: string[]; frame: (...a: unknown[]) => void;
    bindPass: { execute(): void }; rasterPass: { execute(): void }; taaPass: { execute(): void }; setPasses: { execute(): void }[]; onFrameEnd: () => void;
};

/** A stand-in for upstream's renderer: records the calls the adapter makes, and has the passes and the frameend handler the guards look for. */
function fake(): Fake {
    const calls: string[] = [];
    const pass = (name: string) => ({ execute() { calls.push(name); } });
    return {
        calls,
        frame: () => { calls.push('frame'); },
        onFrameEnd: () => { calls.push('frameend'); },
        bindPass: pass('bind'), rasterPass: pass('raster'), taaPass: pass('taa'), setPasses: [pass('s0'), pass('s1'), pass('s2'), pass('s3')],
        setEnabled(v: boolean) { calls.push(`enabled:${v}`); },
        setVariant(t: string) { calls.push(`variant:${t}`); },
        destroy() { calls.push('destroy'); },
        taaActive: true, culling: false, cullSuspended: false, gpuBytes: 1234, activeSplats: 77, variant: { taa: 'on', taaMax: 256 }
    } as unknown as Fake;
}

const make = (r = fake(), extra: Partial<ConstructorParameters<typeof AccumDrawing>[0]> = {}) => {
    const created: string[] = [];
    const fails: number[] = [];
    const ev = events();
    const a = new AccumDrawing({
        app: Object.assign(app(), { on: ev.on, off: ev.off, once: ev.once }), camera: cam(), layer: {} as Layer, variant: 'taa:on',
        create: (v) => { created.push(v); return r; }, onFail: () => fails.push(1), ...extra
    });
    return { a, r, created, fails, ev };
};

describe('AccumDrawing', () => {
    it('makes nothing until it is wanted', () => {
        const { a, created } = make();
        expect(created).toEqual([]);
        expect(a.active).toBe(false);
        expect(a.inner).toBeNull();
        expect(a.stats().gpuBytes).toBe(0);
    });
    it('makes the renderer once, with the variant, and turns it on', () => {
        const { a, r, created } = make();
        expect(a.enable()).toBe(true);
        expect(a.enable()).toBe(true);
        expect(created).toEqual(['taa:on']);
        expect(r.calls.filter((c) => c === 'enabled:true')).toHaveLength(2);
        expect(a.active).toBe(true);
        expect(a.inner).toBe(r);
    });
    it('hands the splats back on disable and takes them again on enable', () => {
        const { a, r } = make();
        a.enable();
        a.disable();
        expect(a.active).toBe(false);
        expect(r.calls).toEqual(['enabled:true', 'enabled:false']);
        a.disable();
        expect(r.calls).toEqual(['enabled:true', 'enabled:false']);
        expect(a.enable()).toBe(true);
        expect(r.calls.at(-1)).toBe('enabled:true');
    });
    it('reports the renderer\'s numbers only while it draws', () => {
        const { a } = make();
        a.enable();
        expect(a.stats()).toMatchObject({ active: true, taaActive: true, gpuBytes: 1234, activeSplats: 77, failed: null, variant: { taa: 'on', taaMax: 256 } });
        a.disable();
        expect(a.stats()).toMatchObject({ active: false, taaActive: false, gpuBytes: 0, activeSplats: 0 });
    });
    it('forwards a new variant', () => {
        const { a, r } = make();
        a.enable();
        a.setVariant('taa:off');
        expect(r.calls).toContain('variant:taa:off');
    });
    it('a renderer that throws while it is made: failed, not enabled, the caller told once', () => {
        const fails: number[] = [];
        const a = new AccumDrawing({ app: app(), camera: cam(), layer: {} as Layer, create: () => { throw new Error('no shader'); }, onFail: () => fails.push(1) });
        expect(a.enable()).toBe(false);
        expect(a.failed).toBe('no shader');
        expect(a.active).toBe(false);
        expect(a.enable()).toBe(false);
        expect(fails).toEqual([1]);
    });
    it('a throw inside a frame hands the splats back for good', () => {
        const r = fake();
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        r.frame = () => { throw new Error('bad buffer'); };
        const { a, fails } = make(r);
        a.enable();
        // the engine's event calls the instance's frame: the guard catches it
        expect(() => r.frame()).not.toThrow();
        expect(a.failed).toBe('bad buffer');
        expect(a.active).toBe(false);
        expect(r.calls).toContain('enabled:false');
        expect(a.enable()).toBe(false);
        expect(r.calls.filter((c) => c === 'enabled:true')).toHaveLength(1);
        expect(fails).toEqual([1]);
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
    it('a throw inside a pass of the render graph: the passes after it do nothing, the hand-back and the caller wait for the frame\'s end (not in the middle of the render)', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const r = fake();
        r.rasterPass.execute = () => { throw new Error('bad pass'); };
        const { a, ev, fails } = make(r);
        a.enable();
        // what the engine does inside one render: the camera's passes in order
        r.bindPass.execute(); r.rasterPass.execute(); r.taaPass.execute();
        expect(a.failed).toBe('bad pass');
        expect(a.failedAt).toBe('raster');
        expect(a.active).toBe(false);
        expect(r.calls).toEqual(['enabled:true', 'bind']); // taa did not run on the raster's half-written state, and nothing was torn down yet
        expect(fails).toEqual([]);
        ev.endFrame();
        expect(r.calls.at(-1)).toBe('enabled:false');
        expect(fails).toEqual([1]);
        // a second frame: everything is dead, nothing runs, nothing is reported again
        r.frame(); r.bindPass.execute(); r.taaPass.execute(); ev.endFrame();
        expect(r.calls).toEqual(['enabled:true', 'bind', 'enabled:false']);
        expect(fails).toEqual([1]);
        expect(a.enable()).toBe(false);
        err.mockRestore();
    });
    it('a frame that never ends still hands back, after 250 ms, and only once', () => {
        vi.useFakeTimers();
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const r = fake();
        r.taaPass.execute = () => { throw new Error('bad taa'); };
        const { a, ev, fails } = make(r);
        a.enable();
        r.taaPass.execute();
        expect(r.calls).not.toContain('enabled:false');
        vi.advanceTimersByTime(250);
        expect(r.calls.filter((c) => c === 'enabled:false')).toHaveLength(1);
        expect(fails).toEqual([1]);
        ev.endFrame(); // the late frameend does not hand back again
        expect(r.calls.filter((c) => c === 'enabled:false')).toHaveLength(1);
        expect(fails).toEqual([1]);
        err.mockRestore();
        vi.useRealTimers();
    });
    it('a throw in the frame function or the frameend handler hands back at once (the engine is not rendering with it)', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        for (const site of ['frame', 'frameend'] as const) {
            const r = fake();
            const { a, ev, fails } = make(r);
            a.enable();
            a.forceFault(site);
            if (site === 'frame') r.frame(); else ev.endFrame();
            expect(a.failedAt, site).toBe(site);
            expect(r.calls.at(-1), site).toBe('enabled:false');
            expect(fails, site).toEqual([1]);
        }
        err.mockRestore();
    });
    it('forceFault throws once at the named site only, inside the guard (the page\'s way of exercising the real fallback)', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { a, r, ev } = make();
        a.enable();
        a.forceFault('taa');
        r.rasterPass.execute(); r.bindPass.execute(); r.frame();        // other sites: nothing happens
        expect(a.failed).toBeNull();
        expect(r.calls).toEqual(['enabled:true', 'raster', 'bind', 'frame']);
        r.taaPass.execute();
        expect(a.failed).toBe('forced fault at taa');
        ev.endFrame();
        expect(a.stats()).toMatchObject({ failed: 'forced fault at taa', failedAt: 'taa', active: false });
        err.mockRestore();
    });
    it('says which sites are guarded', () => {
        const { a } = make();
        expect(a.stats().guarded).toEqual([]);
        a.enable();
        expect(a.stats().guarded.sort()).toEqual(['bind', 'frame', 'frameend', 'raster', 'sets', 'taa']);
    });
    it('control: an adapter that forgot a failure would enable again', () => {
        const r = fake();
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        r.frame = () => { throw new Error('x'); };
        const { a } = make(r);
        a.enable();
        r.frame();
        const forgetful = (): boolean => { a.failed = null; return a.enable(); };
        expect(a.enable()).toBe(false);
        expect(forgetful()).toBe(true);
        err.mockRestore();
    });
    it('destroys the renderer once and survives a throw in it', () => {
        const { a, r } = make();
        a.enable();
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        r.destroy = () => { throw new Error('gone'); };
        expect(() => a.destroy()).not.toThrow();
        expect(a.inner).toBeNull();
        err.mockRestore();
    });
});
