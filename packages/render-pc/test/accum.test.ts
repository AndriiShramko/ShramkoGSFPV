// The adapter around the vendored SuperSplat renderer (v0.11 lane S, accum.ts) without a GPU: the engine-member check
// (accumMissing), the guard that keeps an exception out of the engine's frame event (guardFrame), and the on/off/failed
// life of AccumDrawing with a fake renderer. Controls: an unguarded frame throws; a checker that reports nothing passes an
// engine that lacks every member; an adapter that does not remember a failure would enable again.
import { describe, it, expect, vi } from 'vitest';
import type { AppBase, CameraComponent, Layer } from 'playcanvas';
import { AccumDrawing, accumMissing, guardFrame, worldLayer } from '../src/accum';
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
    it('control: a checker that reports nothing would pass an engine that lacks everything', () => {
        const empty = { graphicsDevice: { isWebGPU: false }, systems: {}, renderer: {}, scene: { layers: { getLayerById: () => null } } } as unknown as AppBase;
        expect(accumMissing(empty, undefined, M4).length).toBeGreaterThanOrEqual(8);
        const reportsNothing = (): string[] => [];
        expect(reportsNothing()).toEqual([]);
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
    it('control: without the guard the throw reaches the caller', () => {
        const r = { frame() { throw new Error('boom'); } };
        expect(() => r.frame()).toThrow('boom');
    });
});

/** A stand-in for upstream's renderer: records the calls the adapter makes. */
function fake(): StochasticSplatRenderer & { calls: string[]; frame: (...a: unknown[]) => void } {
    const calls: string[] = [];
    return {
        calls,
        frame: () => { calls.push('frame'); },
        setEnabled(v: boolean) { calls.push(`enabled:${v}`); },
        setVariant(t: string) { calls.push(`variant:${t}`); },
        destroy() { calls.push('destroy'); },
        taaActive: true, culling: false, cullSuspended: false, gpuBytes: 1234, activeSplats: 77, variant: { taa: 'on', taaMax: 256 }
    } as unknown as StochasticSplatRenderer & { calls: string[]; frame: (...a: unknown[]) => void };
}

const make = (r = fake(), extra: Partial<ConstructorParameters<typeof AccumDrawing>[0]> = {}) => {
    const created: string[] = [];
    const fails: number[] = [];
    const a = new AccumDrawing({
        app: app(), camera: cam(), layer: {} as Layer, variant: 'taa:on',
        create: (v) => { created.push(v); return r; }, onFail: () => fails.push(1), ...extra
    });
    return { a, r, created, fails };
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
