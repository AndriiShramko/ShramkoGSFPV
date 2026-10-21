// Which implementation draws the "stochastic" picture (v0.11 lane S, the owner's message 24): the vendored SuperSplat
// renderer with temporal accumulation ('accum', accum.ts) or the engine's own dither (v0.10's, 'engine'). Pure policy, no
// engine and no DOM, so it runs in Node tests; renderer.ts applies its result.
//
// The pilot never chooses an implementation: "Render: Stochastic" means the best stochastic this device and engine allow
// (D75's order of who decides is untouched, drawing.ts). 'engine' exists as the bench's control (the v0.10 numbers) and as
// the fallback when the accumulating renderer cannot run here or has failed.

/** Which code draws a stochastic picture. */
export type StochasticImpl = 'accum' | 'engine';
export const STOCHASTIC_IMPLS: readonly StochasticImpl[] = ['accum', 'engine'];
/** What a renderer starts with: the accumulating one wherever it can run. */
export const DEFAULT_STOCHASTIC_IMPL: StochasticImpl = 'accum';

/** The page address' `impl` (a test switch: ?impl=engine); anything else says nothing. */
export function parseImpl(text: string | null | undefined): StochasticImpl | undefined {
    return text === 'accum' || text === 'engine' ? text : undefined;
}

/** What draws the scan after a call to setStochastic. */
export type DrawPlan =
    | { draw: 'sorted'; why: 'not-asked' | 'no-gpu-sort' }
    | { draw: 'engine'; why: 'impl' | 'unsupported' | 'failed' }
    | { draw: 'accum'; why: 'ok' };

export interface PlanInput {
    /** stochastic is wanted (drawing.ts resolved it, and no recording holds the picture clean) */
    on: boolean;
    /** the engine's GPU-sort renderer is the one running (WebGPU): the only place any stochastic drawing exists */
    gpuSort: boolean;
    /** the implementation asked for */
    impl: StochasticImpl;
    /** the engine members the accumulating renderer needs that this engine lacks (accum.ts accumMissing); empty = it can run */
    missing: readonly string[];
    /** the accumulating renderer threw while drawing and was switched off for good (accum.ts) */
    failed: boolean;
}

/**
 * The drawing for a request. Sorted unless stochastic is wanted and a GPU-sort renderer runs. Then the accumulating renderer
 * if it is asked for, can run on this engine and has not failed; else the engine's own dither (v0.10 behaviour).
 */
export function planStochastic(i: PlanInput): DrawPlan {
    if (!i.on) return { draw: 'sorted', why: 'not-asked' };
    if (!i.gpuSort) return { draw: 'sorted', why: 'no-gpu-sort' };
    if (i.impl === 'engine') return { draw: 'engine', why: 'impl' };
    if (i.failed) return { draw: 'engine', why: 'failed' };
    if (i.missing.length > 0) return { draw: 'engine', why: 'unsupported' };
    return { draw: 'accum', why: 'ok' };
}

/** The members of the engine and device the accumulating renderer drives directly, with how to read each (accum.ts checks them). */
export const ACCUM_REQUIRES = [
    'webgpu', 'computeDispatch', 'getIndirectDrawSlot', 'indirectDrawBuffer', 'getIndirectDispatchSlot', 'indirectDispatchBuffer',
    'gsplat system events', 'gsplatDirector', 'camera.beforePasses', 'renderForwardLayer', 'world layer', 'cache fits one storage binding'
] as const;
export type AccumRequirement = (typeof ACCUM_REQUIRES)[number];
