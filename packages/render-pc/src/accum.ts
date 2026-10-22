// The accumulating stochastic drawing (v0.11 lane S): SuperSplat's own renderer for its stochastic mode (a projector,
// a counting depth order, an unsorted raster that keeps each fragment with the probability of its opacity, and a temporal
// resolve with a history of 256 frames at rest and up to 16 moving), vendored byte for byte but for marked type edits
// (vendor/supersplat-viewer/UPSTREAM.md), and this adapter around it.
//
// What the adapter does and the vendored code does not:
//   - makes the renderer only when stochastic is first wanted (a pilot on sorted never pays for its shaders and targets);
//   - asks the renderer for the engine's work-buffer data path only ('workbuffer'): the engine's own splat textures stay
//     untouched, so handing the picture back to the sorted drawing (REC, video export, share picture) needs no repair;
//   - checks that this engine and device have everything the renderer drives directly (accumMissing) and reports what is
//     missing instead of crashing, so renderer.ts keeps the engine's own dither on such an engine (planStochastic);
//   - guards every place the renderer's code runs from the engine (guardRenderer): its per-frame function, which runs inside
//     the engine's gsplat `frame:ready` event (an exception there would break the engine's update on every frame), the passes
//     it adds to the camera's render graph (bind, raster, taa) and its `frameend` handler. A throw switches the renderer off
//     for good, hands the splats back and says so once (`failed`, `failedAt`); a throw inside the engine's frame (the frame
//     function or a pass) hands back at that frame's end, never in the middle of the update or the render;
//   - never asks the app for extra frames (`requestFrame` is a no-op): this page draws every frame, and a request would
//     override the latency guard's deliberate hold (renderer.ts onFrameRender).
// This file and the vendored folder are the first code of ours that reaches the engine's internal gsplat classes
// (`gsplatDirector`, `GSplatManager.world`, indirect draw slots); renderer.ts's header says so.

import type { AppBase, CameraComponent, GraphicsDevice, Layer } from 'playcanvas';
import { LAYERID_WORLD } from 'playcanvas';
import { StochasticSplatRenderer } from './vendor/supersplat-viewer/render/stochastic-splat-renderer';
import type { AccumRequirement } from './accum-policy';

/** The pinned upstream the renderer was vendored from (vendor/supersplat-viewer/UPSTREAM.md). */
export const ACCUM_UPSTREAM = { release: 'v1.38.0', commit: '88482a6e4a145520cddf4d9c3d9e00481ae558c1' } as const;

type Anything = Record<string, unknown>;

/**
 * The requirements this engine and device do not meet (empty: the renderer can run). Checks the members the vendored
 * renderer calls directly, by their presence, so an engine bump that moves one turns into the engine's own dither instead of a
 * crash. `splats` is the largest splat budget the cache must hold (the projected cache reserves 25 % over it).
 */
export function accumMissing(app: AppBase, camera: CameraComponent | null | undefined, splats: number): AccumRequirement[] {
    const miss: AccumRequirement[] = [];
    const device = app.graphicsDevice as GraphicsDevice & Anything;
    if (!device.isWebGPU) miss.push('webgpu');
    for (const name of ['computeDispatch', 'getIndirectDrawSlot', 'getIndirectDispatchSlot'] as const) {
        if (typeof device[name] !== 'function') miss.push(name);
    }
    if (!device.indirectDrawBuffer) miss.push('indirectDrawBuffer');
    if (!device.indirectDispatchBuffer) miss.push('indirectDispatchBuffer');
    const system = (app.systems as unknown as { gsplat?: Anything }).gsplat;
    if (!system || typeof system.on !== 'function') miss.push('gsplat system events');
    const renderer = app.renderer as unknown as Anything;
    // made by the gsplat component system's constructor (engine 2.23.2 gsplat/system.js), so present once that system is registered
    if (!renderer.gsplatDirector) miss.push('gsplatDirector');
    if (typeof renderer.renderForwardLayer !== 'function') miss.push('renderForwardLayer');
    if (!camera?.camera || !Array.isArray((camera.camera as unknown as Anything).beforePasses)) miss.push('camera.beforePasses');
    if (!worldLayer(app)) miss.push('world layer');
    if (!StochasticSplatRenderer.cacheFits(device, splats)) miss.push('cache fits one storage binding');
    return miss;
}

/** The layer the splats are drawn in (the scan's entity has no layer list of its own). */
export function worldLayer(app: AppBase): Layer | null {
    return app.scene.layers.getLayerById(LAYERID_WORLD) ?? null;
}

/** What the F3 panel and the benches read from the running renderer. */
export interface AccumStats {
    /** the renderer exists and draws the scan (not handed back) */
    active: boolean;
    /** the last frame ran the temporal accumulation */
    taaActive: boolean;
    /** the last frame ran the occlusion cull */
    culling: boolean;
    /** cull:auto has the test switched off for culling too little */
    cullSuspended: boolean;
    /** bytes of the renderer's own buffers and targets */
    gpuBytes: number;
    /** splats resident this frame (survivors of the projection are only known to the GPU) */
    activeSplats: number;
    /** the switches in force (upstream's `Variant`) */
    variant: Readonly<Record<string, unknown>>;
    /** the error that switched the renderer off, else null */
    failed: string | null;
    /** where that error came from ('start': making or enabling the renderer), else null */
    failedAt: GuardSite | 'start' | null;
    /** the places the renderer's code runs from the engine that are guarded (guardRenderer) */
    guarded: GuardSite[];
}

/** Where the renderer's code runs from the engine: its frame function, the three kinds of passes it adds to the camera, its frameend handler. */
export type GuardSite = 'frame' | 'bind' | 'raster' | 'sets' | 'taa' | 'frameend';

/**
 * A throw at these sites must not tear the renderer down on the spot: the engine is in the middle of a frame (the frame function runs inside the engine's
 * gsplat update, the passes inside its render) and is using the renderer's buffers, targets and the work buffer it patched. The hand-back waits for the
 * frame's end. Found by the real-page fault test (acceptance V9): handing back from inside the frame function gave 5 WebGPU validation errors and a page error.
 * A throw in the frameend handler is already at the frame's end.
 */
const DEFER_TO_FRAME_END: readonly GuardSite[] = ['frame', 'bind', 'raster', 'sets', 'taa'];

export interface GuardHooks {
    /** a guarded function threw: it is not rethrown, the engine goes on */
    onThrow(site: GuardSite, e: unknown): void;
    /** runs first inside every guarded function, so a throw from here is a throw of the function (the page's fault hook, forceFault) */
    before?(site: GuardSite): void;
    /** true once the renderer failed: every guarded function then does nothing, so the passes after the failed one never run on its half-written state */
    dead?(): boolean;
}

/** `owner[key]` replaced by a function that runs the original under `hooks` (false: there is no such function, nothing was guarded). */
function guardMember(owner: object, key: string, site: GuardSite, hooks: GuardHooks): boolean {
    const target = owner as Record<string, unknown>;
    const original = target[key];
    if (typeof original !== 'function') return false;
    const run = (original as (...a: unknown[]) => unknown).bind(owner);
    target[key] = (...a: unknown[]): unknown => {
        if (hooks.dead?.()) return undefined;
        try {
            hooks.before?.(site);
            return run(...a);
        } catch (e) {
            hooks.onThrow(site, e);
            return undefined;
        }
    };
    return true;
}

/**
 * Make every function the engine calls into the renderer safe, by replacing it on the instance (so no vendored line changes):
 *   - `frame`: the provider's callback looks it up on the instance when the engine's `frame:ready` fires;
 *   - `execute` of the bind pass, the raster pass, the four pixel-set passes and the taa pass: the render graph calls them
 *     through the pass objects the renderer put into `camera.beforePasses` (they stay the same objects over disable and enable);
 *   - `onFrameEnd`: registered on the app's `frameend`; the registration is replaced too (the renderer's `destroy` unregisters the
 *     property's current value, which is the guard).
 * Returns the sites that were guarded; a member an upstream update renamed is missing from it (the acceptance checks the list).
 */
export function guardRenderer(r: object, app: { on(name: string, cb: () => void): unknown; off(name: string, cb: () => void): unknown } | null, hooks: GuardHooks): GuardSite[] {
    const R = r as Record<string, unknown>;
    const done: GuardSite[] = [];
    const add = (ok: boolean, site: GuardSite): void => { if (ok && !done.includes(site)) done.push(site); };
    add(guardMember(r, 'frame', 'frame', hooks), 'frame');
    for (const [field, site] of [['bindPass', 'bind'], ['rasterPass', 'raster'], ['taaPass', 'taa']] as const) {
        const pass = R[field];
        if (pass && typeof pass === 'object') add(guardMember(pass, 'execute', site, hooks), site);
    }
    const sets = R.setPasses;
    if (Array.isArray(sets)) for (const pass of sets) if (pass && typeof pass === 'object') add(guardMember(pass, 'execute', 'sets', hooks), 'sets');
    const onEnd = R.onFrameEnd;
    if (app && typeof onEnd === 'function') {
        app.off('frameend', onEnd as () => void);
        add(guardMember(r, 'onFrameEnd', 'frameend', hooks), 'frameend');
        app.on('frameend', R.onFrameEnd as () => void);
    }
    return done;
}

/**
 * Leave a renderer that was just detached quiet (v0.11 lane N, the side finding of docs/wip/v11-n.md). The vendored `detach()` destroys the
 * views (their targets, textures and buffers) and puts an empty one in their place, but leaves the pass flags as the last drawn frame set
 * them: the raster, pixel-set and taa passes enabled, the compose instance visible, `ready` set. The passes take their render target, and the
 * compose its textures and buffers, from the view's bindings, which only a frame of the renderer writes. So a renderer attached again before such a
 * frame has run (no scan yet, the engine's manager without a world state, a frame function that throws first) starts the engine's render pass
 * on the target of the destroyed view: `Cannot read properties of null (reading 'createView')` out of the engine's `startRenderPass` (outside
 * every guard) on EVERY frame until a frame binds a view again (bench accept-v11-n FUZZ=toggle: the drawing switched at random moments during
 * scene switches, 14 of 40 switches on the base build, bursts of 2 to 17 page errors, all in this state: enabled, passes on, no bindings, no
 * resident set). Quiet is the state the renderer is made in: `ready` false (the vendored setReady: raster and pixel-set passes disabled, the
 * compose hidden) and the taa pass disabled. The first frame that binds a view turns them on again (setReady(true) at the end of the frame's
 * preparation, `taaPass.enabled` in the same place). True: done; false: this renderer has no such member (an upstream update moved it).
 */
export function quietRenderer(r: object): boolean {
    const R = r as Record<string, unknown>;
    if (typeof R.setReady !== 'function') return false;
    (R.setReady as (v: boolean) => void).call(r, false);
    const taa = R.taaPass as { enabled?: boolean } | undefined;
    if (taa && typeof taa === 'object') taa.enabled = false;
    return true;
}

export interface AccumOptions {
    app: AppBase;
    camera: CameraComponent;
    layer: Layer;
    /** `key:value,key:value` seeds for upstream's switches (a test hook; empty = upstream's defaults) */
    variant?: string;
    /** called once if the renderer threw inside a frame and was handed back (the caller may choose another drawing) */
    onFail?: () => void;
    /** makes the renderer (tests pass a fake; the default is upstream's, work-buffer data path, per-pixel coverage) */
    create?: (variant: string) => StochasticSplatRenderer;
}

export class AccumDrawing {
    private r: StochasticSplatRenderer | null = null;
    private on = false;
    /** why the renderer was switched off for good, else null */
    failed: string | null = null;
    /** where the failing call came from, else null */
    failedAt: GuardSite | 'start' | null = null;
    /** the sites of the renderer's code that are guarded (guardRenderer; empty before the renderer is made) */
    guarded: GuardSite[] = [];
    private variant: string;
    private readonly o: AccumOptions;
    /** the site the next guarded call throws from (forceFault), else null */
    private faultAt: GuardSite | null = null;

    constructor(o: AccumOptions) {
        this.o = o;
        this.variant = o.variant ?? '';
    }

    /** The renderer draws the scan now. */
    get active(): boolean {
        return this.on && this.r !== null && this.failed === null;
    }

    /** Upstream's renderer, for the benches (setVariant, resetHistory, allowQueryTaa, seed); null before the first enable. */
    get inner(): StochasticSplatRenderer | null {
        return this.r;
    }

    /** Make the renderer (once) and let it draw. False when it failed (then `failed` says why). */
    enable(): boolean {
        if (this.failed !== null) return false;
        try {
            if (!this.r) this.r = this.make();
            this.r.setEnabled(true);
            this.on = true;
        } catch (e) {
            this.fail(e);
            return false;
        }
        return true;
    }

    /** Hand the scan back to the engine's own renderer (the sorted drawing); the renderer stays made, its targets are freed. */
    disable(): void {
        if (!this.on || !this.r) return;
        this.on = false;
        try {
            this.r.setEnabled(false);
            quietRenderer(this.r);
        } catch (e) {
            this.fail(e);
        }
    }

    /** Replace upstream's switches (a test hook): the history starts over. */
    setVariant(text: string): void {
        this.variant = text;
        this.r?.setVariant(text);
    }

    /**
     * Test hook (the acceptance): the next call of the guarded function at `site` throws, inside the guard, so the real hand-back and
     * the real fallback run in the real page. The throw is the guard's own try block's, not the vendored function's: it proves the
     * guard and what follows a throw, not that a particular line of upstream can throw.
     */
    forceFault(site: GuardSite | null): void {
        this.faultAt = site;
    }

    stats(): AccumStats {
        const r = this.r;
        return {
            active: this.active,
            taaActive: !!r && this.on && r.taaActive,
            culling: !!r && this.on && r.culling,
            cullSuspended: !!r && r.cullSuspended,
            gpuBytes: r && this.on ? r.gpuBytes : 0,
            activeSplats: r && this.on ? r.activeSplats : 0,
            variant: r ? { ...r.variant } : {},
            failed: this.failed,
            failedAt: this.failedAt,
            guarded: [...this.guarded]
        };
    }

    destroy(): void {
        this.on = false;
        const r = this.r;
        this.r = null;
        try {
            r?.destroy();
        } catch (e) {
            console.error('accum destroy', e);
        }
    }

    private make(): StochasticSplatRenderer {
        const { app, camera, layer } = this.o;
        const r = this.o.create
            ? this.o.create(this.variant)
            : new StochasticSplatRenderer(app, camera, layer, {
                source: 'workbuffer',
                mode: 'pixel',
                variant: this.variant,
                // this page draws every frame; a request would override the latency guard's hold
                requestFrame: () => undefined
            });
        // `frame` runs inside the engine's `frame:ready` event (a throw there would break the engine's update on every frame), the
        // passes and the frameend handler run inside the engine's render: all of it is guarded
        this.guarded = guardRenderer(r, app as unknown as Parameters<typeof guardRenderer>[1], {
            onThrow: (site, e) => this.fail(e, site),
            before: (site) => {
                if (this.faultAt === site) {
                    this.faultAt = null;
                    throw new Error(`forced fault at ${site}`);
                }
            },
            dead: () => this.failed !== null
        });
        return r;
    }

    /**
     * The renderer threw: it is off for good (`failed`), the splats go back to the engine's renderer and the caller is told once.
     * From inside the engine's frame (the frame function or a pass) the hand-back waits for the frame's end: detaching the passes,
     * freeing the targets and giving the work buffer back while the engine is updating or drawing with them would turn one throw into
     * several; until then every guarded function does nothing.
     */
    private fail(e: unknown, site: GuardSite | 'start' = 'start'): void {
        if (this.failed !== null) return;
        this.failed = e instanceof Error ? e.message : String(e);
        this.failedAt = site;
        console.error(`accumulating stochastic drawing failed (${site}), drawing without it`, e);
        this.on = false;
        let handed = false;
        const handBack = (): void => {
            if (handed) return;
            handed = true;
            try {
                this.r?.setEnabled(false);
                if (this.r) quietRenderer(this.r);
            } catch (e2) {
                console.error('accum hand-back', e2);
            }
            this.o.onFail?.();
        };
        const app = this.o.app as unknown as { once?: (name: string, cb: () => void) => unknown };
        if (site !== 'start' && DEFER_TO_FRAME_END.includes(site) && typeof app.once === 'function') {
            app.once('frameend', handBack);
            // the frame may never end (a throw elsewhere in the engine's tick): hand back anyway
            setTimeout(handBack, 250);
        } else {
            handBack();
        }
    }
}
