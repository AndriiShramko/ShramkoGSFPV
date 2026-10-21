// Which code draws "stochastic" (v0.11 lane S, accum-policy.ts planStochastic): sorted unless stochastic is wanted and a
// GPU-sort renderer runs; then the accumulating renderer if asked for, supported and not failed, else the engine's own dither.
// Controls: a policy that ignores the support report, one that ignores a failure, one that ignores the implementation switch,
// and one that draws stochastic without a GPU-sort renderer each fail the rows that need the check.
import { describe, it, expect } from 'vitest';
import { ACCUM_REQUIRES, DEFAULT_STOCHASTIC_IMPL, STOCHASTIC_IMPLS, parseImpl, planStochastic } from '../src/accum-policy';
import type { DrawPlan, PlanInput } from '../src/accum-policy';

const base: PlanInput = { on: true, gpuSort: true, impl: 'accum', missing: [], failed: false };

describe('planStochastic', () => {
    const rows: [string, Partial<PlanInput>, DrawPlan][] = [
        ['not asked: sorted', { on: false }, { draw: 'sorted', why: 'not-asked' }],
        ['not asked beats everything else', { on: false, impl: 'engine', failed: true, missing: ['webgpu'] }, { draw: 'sorted', why: 'not-asked' }],
        ['asked without a GPU-sort renderer (WebGL): sorted', { gpuSort: false }, { draw: 'sorted', why: 'no-gpu-sort' }],
        ['asked without GPU sort, engine implementation: still sorted', { gpuSort: false, impl: 'engine' }, { draw: 'sorted', why: 'no-gpu-sort' }],
        ['asked, supported: the accumulating renderer', {}, { draw: 'accum', why: 'ok' }],
        ['the bench asks for the engine\'s dither', { impl: 'engine' }, { draw: 'engine', why: 'impl' }],
        ['the engine\'s dither also when the accumulating renderer would have been supported', { impl: 'engine', missing: [] }, { draw: 'engine', why: 'impl' }],
        ['an engine without a member it needs: the engine\'s dither', { missing: ['gsplatDirector'] }, { draw: 'engine', why: 'unsupported' }],
        ['several members missing: the same', { missing: ['webgpu', 'computeDispatch'] }, { draw: 'engine', why: 'unsupported' }],
        ['it threw while drawing: the engine\'s dither', { failed: true }, { draw: 'engine', why: 'failed' }],
        ['failed beats missing in the reason', { failed: true, missing: ['x'] }, { draw: 'engine', why: 'failed' }]
    ];
    for (const [name, over, want] of rows) {
        it(name, () => expect(planStochastic({ ...base, ...over })).toEqual(want));
    }
});

describe('controls: a policy missing one check fails its own rows', () => {
    // each control is planStochastic with one rule removed; the rows above must tell it from the real one
    const ignoresSupport = (i: PlanInput): DrawPlan => planStochastic({ ...i, missing: [] });
    const ignoresFailure = (i: PlanInput): DrawPlan => planStochastic({ ...i, failed: false });
    const ignoresImpl = (i: PlanInput): DrawPlan => planStochastic({ ...i, impl: 'accum' });
    const ignoresGpuSort = (i: PlanInput): DrawPlan => planStochastic({ ...i, gpuSort: true });

    it('ignoring the support report draws on an engine that lacks members', () => {
        const i = { ...base, missing: ['gsplatDirector'] };
        expect(planStochastic(i).draw).toBe('engine');
        expect(ignoresSupport(i).draw).toBe('accum');
    });
    it('ignoring a failure draws with a renderer that threw', () => {
        const i = { ...base, failed: true };
        expect(planStochastic(i).draw).toBe('engine');
        expect(ignoresFailure(i).draw).toBe('accum');
    });
    it('ignoring the implementation switch removes the bench control', () => {
        const i = { ...base, impl: 'engine' as const };
        expect(planStochastic(i).draw).toBe('engine');
        expect(ignoresImpl(i).draw).toBe('accum');
    });
    it('ignoring the GPU-sort test draws stochastic on WebGL', () => {
        const i = { ...base, gpuSort: false };
        expect(planStochastic(i).draw).toBe('sorted');
        expect(ignoresGpuSort(i).draw).toBe('accum');
    });
});

describe('the implementation names', () => {
    it('knows two, defaults to the accumulating one', () => {
        expect([...STOCHASTIC_IMPLS]).toEqual(['accum', 'engine']);
        expect(DEFAULT_STOCHASTIC_IMPL).toBe('accum');
    });
    it('parses the page address switch strictly', () => {
        expect(parseImpl('engine')).toBe('engine');
        expect(parseImpl('accum')).toBe('accum');
        for (const bad of [null, undefined, '', 'Engine', 'sorted', 'both', '1']) expect(parseImpl(bad as string | null | undefined), String(bad)).toBeUndefined();
    });
    it('names every engine requirement once', () => {
        expect(new Set(ACCUM_REQUIRES).size).toBe(ACCUM_REQUIRES.length);
        expect(ACCUM_REQUIRES).toContain('gsplatDirector');
    });
});
