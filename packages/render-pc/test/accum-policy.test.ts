// Which code draws "stochastic" (v0.11 lane S, accum-policy.ts planStochastic): sorted unless stochastic is wanted and a
// GPU-sort renderer runs; then the accumulating renderer if asked for, supported and not failed, else the engine's own dither.
// Controls: a policy that ignores the support report, one that ignores a failure, one that ignores the implementation switch,
// and one that draws stochastic without a GPU-sort renderer each fail the rows that need the check.
import { describe, it, expect } from 'vitest';
import { ACCUM_REQUIRES, DEFAULT_STOCHASTIC_IMPL, STOCHASTIC_IMPLS, applyStochastic, parseImpl, planStochastic } from '../src/accum-policy';
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
        ['a scene switch is under way: the accumulating renderer waits, sorted draws', { hold: true }, { draw: 'sorted', why: 'loading' }],
        ['the engine\'s own dither does not wait (it has no work buffer of its own)', { hold: true, impl: 'engine' }, { draw: 'engine', why: 'impl' }],
        ['not asked beats the hold', { hold: true, on: false }, { draw: 'sorted', why: 'not-asked' }],
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
    it('ignoring the hold binds the projector to the work buffer the engine has reset to 1x1 (WebGPU validation errors in the page, v0.11 acceptance V7)', () => {
        const ignoresHold = (i: PlanInput): DrawPlan => planStochastic({ ...i, hold: false });
        const i = { ...base, hold: true };
        expect(planStochastic(i)).toEqual({ draw: 'sorted', why: 'loading' });
        expect(ignoresHold(i).draw).toBe('accum');
    });
    it('ignoring the GPU-sort test draws stochastic on WebGL', () => {
        const i = { ...base, gpuSort: false };
        expect(planStochastic(i).draw).toBe('sorted');
        expect(ignoresGpuSort(i).draw).toBe('accum');
    });
});

describe('applyStochastic (the whole of SplatRenderer.setStochastic, without the engine)', () => {
    /** An adapter that records what was asked of it; `canStart` false = it cannot start (it failed). */
    const fake = (canStart = true) => {
        const calls: string[] = [];
        return { calls, enable() { calls.push('enable'); return canStart; }, disable() { calls.push('disable'); } };
    };
    const run = (over: Partial<PlanInput>, existing: ReturnType<typeof fake> | null, canStart = true, params = { stochastic: false }) => {
        const a = existing ?? fake(canStart);
        let made = 0;
        const r = applyStochastic({ ...base, ...over }, () => { made++; return a; }, existing, params);
        return { ...r, made, calls: a.calls, params };
    };

    it('wanted and supported: the adapter is made and enabled, the engine\'s dither stays off', () => {
        const r = run({}, null);
        expect(r).toMatchObject({ plan: { draw: 'accum', why: 'ok' }, on: true, made: 1, calls: ['enable'], params: { stochastic: false } });
    });
    it('not wanted: nothing is made (a pilot on sorted pays nothing), an adapter made before is handed back, the flag is off', () => {
        expect(run({ on: false }, null)).toMatchObject({ plan: { draw: 'sorted' }, on: false, made: 0, params: { stochastic: false } });
        const was = fake();
        expect(run({ on: false }, was)).toMatchObject({ on: false, made: 0, calls: ['disable'], params: { stochastic: false } });
    });
    it('the engine\'s dither asked for: nothing is made, an adapter made before is handed back, the flag is on', () => {
        const was = fake();
        expect(run({ impl: 'engine' }, was)).toMatchObject({ plan: { draw: 'engine', why: 'impl' }, on: true, made: 0, calls: ['disable'], params: { stochastic: true } });
    });
    it('a scene switch under way: nothing is made, an adapter made before is handed back, the engine\'s flag stays off', () => {
        const was = fake();
        expect(run({ hold: true }, was)).toMatchObject({ plan: { draw: 'sorted', why: 'loading' }, on: false, made: 0, calls: ['disable'], params: { stochastic: false } });
        expect(run({ hold: true }, null)).toMatchObject({ made: 0, on: false });
    });
    it('an engine that lacks members: the engine\'s dither, nothing made', () => {
        expect(run({ missing: ['gsplatDirector'] }, null)).toMatchObject({ plan: { draw: 'engine', why: 'unsupported' }, on: true, made: 0, params: { stochastic: true } });
    });
    it('an adapter that cannot start turns the plan into the engine\'s dither (a failed adapter hands itself back inside enable; one made before is handed back here too)', () => {
        const r = run({}, null, false);
        expect(r).toMatchObject({ plan: { draw: 'engine', why: 'failed' }, on: true, made: 1, params: { stochastic: true } });
        expect(r.calls).toEqual(['enable']);
        const was = fake(false);
        expect(run({}, was, false).calls).toEqual(['enable', 'disable']);
    });
    it('without a GPU-sort renderer nothing stochastic exists: sorted, the flag stays off, nothing is made', () => {
        expect(run({ gpuSort: false }, null)).toMatchObject({ plan: { draw: 'sorted', why: 'no-gpu-sort' }, on: false, made: 0, params: { stochastic: false } });
        expect(run({ gpuSort: false, impl: 'engine' }, null)).toMatchObject({ on: false, params: { stochastic: false } });
    });
    it('on, off, on again: the adapter is made once by its owner and enabled, disabled, enabled', () => {
        const a = fake();
        const params = { stochastic: false };
        const step = (on: boolean) => applyStochastic({ ...base, on }, () => a, a, params);
        step(true); step(false); step(true);
        expect(a.calls).toEqual(['enable', 'disable', 'enable']);
        expect(params.stochastic).toBe(false);
    });

    // The controls of applyStochastic are its own rows above: each names the call a missing rule would drop or add (a switch that never
    // makes the renderer: "wanted and supported" expects made 1 and the engine's flag off; one that makes it for a pilot on sorted: "not
    // wanted" expects made 0; one that forgets to hand back: "an adapter made before is handed back" expects calls ['disable']). An
    // earlier version of this file kept locally pasted copies of applyStochastic as "controls"; they tested the copies and were
    // removed (v0.11 fix round, finding: controls that cannot fail).
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
