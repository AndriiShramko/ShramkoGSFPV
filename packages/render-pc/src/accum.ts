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
//   - wraps the renderer's per-frame function: it runs inside the engine's gsplat `frame:ready` event, so an exception would
//     break the engine's update for every frame. A throw switches the renderer off for good, hands the splats back to the
//     sorted drawing and says so once (`failed`);
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
    if (!('gsplatDirector' in renderer)) miss.push('gsplatDirector');
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
}

export class AccumDrawing {
    private r: StochasticSplatRenderer | null = null;
    private on = false;
    /** why the renderer was switched off for good, else null */
    failed: string | null = null;

    constructor(
        private readonly app: AppBase,
        private readonly camera: CameraComponent,
        private readonly layer: Layer,
        /** `key:value,key:value` seeds for upstream's switches (a test hook; empty = upstream's defaults) */
        private variant = '',
        /** called once if the renderer threw inside a frame and was handed back (the caller may choose another drawing) */
        private readonly onFail: () => void = () => undefined
    ) {}

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
        } catch (e) {
            this.fail(e);
        }
    }

    /** Replace upstream's switches (a test hook): the history starts over. */
    setVariant(text: string): void {
        this.variant = text;
        this.r?.setVariant(text);
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
            failed: this.failed
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
        const r = new StochasticSplatRenderer(this.app, this.camera, this.layer, {
            source: 'workbuffer',
            mode: 'pixel',
            variant: this.variant,
            // this page draws every frame; a request would override the latency guard's hold
            requestFrame: () => undefined
        });
        // `frame` runs inside the engine's `frame:ready` event (the provider's callback looks it up on the instance at call
        // time): a throw there would break the engine's update on every frame
        const target = r as unknown as { frame: (...a: unknown[]) => void };
        const frame = target.frame.bind(r);
        target.frame = (...a: unknown[]): void => {
            try {
                frame(...a);
            } catch (e) {
                this.fail(e);
            }
        };
        return r;
    }

    private fail(e: unknown): void {
        if (this.failed !== null) return;
        this.failed = e instanceof Error ? e.message : String(e);
        console.error('accumulating stochastic drawing failed, drawing sorted', e);
        this.on = false;
        try {
            this.r?.setEnabled(false);
        } catch (e2) {
            console.error('accum hand-back', e2);
        }
        this.onFail();
    }
}
