// Splat renderer on the PlayCanvas engine directly (no viewer wrapper): our camera is never
// overwritten, our render scale really changes the backbuffer, and nothing private is used.
// Decision record: docs/decisions.md (D18, probe A1).

import {
    AppBase, AppOptions, Asset, Entity, Color, StandardMaterial, Vec3, Quat,
    CameraComponentSystem, GSplatComponentSystem, RenderComponentSystem, LightComponentSystem,
    GSplatHandler, TextureHandler, BinaryHandler, ContainerHandler,
    createGraphicsDevice,
    GSPLAT_RENDERER_RASTER_GPU_SORT, GSPLAT_RENDERER_RASTER_CPU_SORT, GSPLAT_LODMODE_DISTANCE,
    FILLMODE_NONE, RESOLUTION_FIXED,
    TONEMAP_LINEAR, TONEMAP_NEUTRAL, TONEMAP_ACES, TONEMAP_ACES2, TONEMAP_FILMIC, TONEMAP_HEJL, TONEMAP_NONE
} from 'playcanvas';
import type { GraphicsDevice, GSplatComponent } from 'playcanvas';
import { LatencyGuard, inputToScreenMs } from './governor';

/** What the HUD shows about the delay (see LatencyGuard, inputToScreenMs). */
export interface LatencyStats {
    /** learned display period, ms (Infinity before the first frames) */
    periodMs: number;
    /** last measured rAF -> presentation, ms (NaN: not measured yet, or not measurable here) */
    rafToPresentMs: number;
    /** median submit -> GPU done of the last frames, ms (NaN on WebGL2) */
    submitToDoneMs: number;
    /** estimated stick -> screen, ms */
    inputToScreenMs: number;
    /** frames skipped by the latency guard so far */
    skips: number;
}

/** a drawn frame the GPU has not finished after this long is not waited for (ms) */
const HOLD_MAX_MS = 1000;

interface WgpuQueue {
    onSubmittedWorkDone(): Promise<void>;
}

export interface RendererOptions {
    /** 1 = CSS pixels * devicePixelRatio */
    renderScale?: number;
    hFovDeg?: number;
    /** draw the 16x16 CSS-px latency marker in the top-left corner (?lat=1) */
    latencyMarker?: boolean;
    splatBudgetMillions?: number;
}

export const TONEMAPS: Record<string, number> = {
    linear: TONEMAP_LINEAR, neutral: TONEMAP_NEUTRAL, aces: TONEMAP_ACES, aces2: TONEMAP_ACES2,
    filmic: TONEMAP_FILMIC, hejl: TONEMAP_HEJL, none: TONEMAP_NONE
};

/** What the first view of a scan has downloaded so far (see SplatRenderer.splatBytes). */
export interface SplatBytes {
    /** the scan's file list is known (lod-meta.json or meta.json has been read) */
    listed: boolean;
    /** bytes received for the images of the files the first view needs */
    received: number;
    /** exact sizes of the images that have started, estimates for files that have not */
    total: number;
    /** no estimate left in `total` */
    exact: boolean;
    /** every file the first view needs has all its bytes */
    complete: boolean;
    /** images the engine gave up on */
    failed: number;
    /** performance.now() of the last byte, 0 before the first */
    lastByteAt: number;
}

// Sizes of files whose images have not all reported yet, from the splat counts in lod-meta.json /
// meta.json. SOG measured 16.6 bytes per splat with spherical harmonics (shN images) and 12.2
// without on the showcase scans. Until a file's image list is known, take the larger, so the bar
// jumps forward when the real sizes arrive instead of stalling. lod-meta has no splat count for the
// environment file: the two measured were 0.30 MB (with SH) and 0.015 MB (without).
const BYTES_PER_SPLAT_SH = 16.6;
const BYTES_PER_SPLAT = 12.2;
const ENV_BYTES_SH = 300_000;
const ENV_BYTES = 30_000;

const estimateBytes = (count: number | null, sh: boolean | null): number =>
    count === null ? (sh === false ? ENV_BYTES : ENV_BYTES_SH) : count * (sh === false ? BYTES_PER_SPLAT : BYTES_PER_SPLAT_SH);

interface ImageBytes {
    dir: string;
    loaded: number;
    total: number;
    failed: boolean;
}

interface ByteCount {
    /** folder of the scan's content; only images under it are counted */
    base: string;
    listed: boolean;
    /** folder of each file the first view needs -> its splat count (null: not in lod-meta) */
    expected: Map<string, number | null>;
    images: Map<string, ImageBytes>;
    lastByteAt: number;
    /** after the first reveal the detail streams in; that is not part of the load */
    frozen: boolean;
}

/** The parts of the engine's GSplatOctree read here (public fields, not in the typings). */
interface OctreeView {
    lodLevels?: number;
    files?: { url: string }[];
    nodes?: { lods?: { fileIndex: number; count: number }[] }[];
    environmentUrl?: string | null;
}

const dirOf = (u: string): string => {
    const abs = new URL(u, location.href).href;
    return abs.slice(0, abs.lastIndexOf('/') + 1);
};

export class SplatRenderer {
    readonly app: AppBase;
    readonly device: GraphicsDevice;
    readonly canvas: HTMLCanvasElement;
    readonly camera: Entity;
    splat: Entity | null = null;
    renderScale: number;
    private markerId = 0;
    private tmpQ = new Quat();
    private tiltQ = new Quat();
    private ro: ResizeObserver;
    lastSize = { w: 0, h: 0 };
    loadStartedAt = 0;
    firstFrameAt = 0;
    debrisRoot: Entity;
    private count: ByteCount = { base: '', listed: false, expected: new Map(), images: new Map(), lastByteAt: 0, frozen: false };
    /** the scan's own asset, and every asset the engine adds for it later (SOG images, streamed LOD files) */
    private splatAsset: Asset | null = null;
    private sceneAssets = new Set<Asset>();
    /** the scene transform T(w) = s*w + t (design E.7); applied to every scan loaded after it is set */
    private sceneS = 1;
    private sceneT: [number, number, number] = [0, 0, 0];
    /** Chrome compositor latency guard (governor.ts); idle until startLatencyGuard() */
    readonly latencyGuard = new LatencyGuard();
    /** true during the first frame after a skip: its long interval was made on purpose */
    frameAfterSkip = false;
    private skipPending = false;
    private skipTimer = 0;
    private destroyed = false;
    private latObserver: PerformanceObserver | null = null;
    private latProbe: { id: string; raf: number; node: HTMLElement } | null = null;
    private latSeq = 0;
    private gpuQueue: WgpuQueue | null = null;
    private submitDone: number[] = [];
    /**
     * Frames the GPU may still be working on when the next one is drawn (0: no limit). With 1, a
     * frame is drawn only once the GPU has finished the last one; otherwise it is not drawn and the
     * next animation frame tries again with a newer pose (the flight model steps either way).
     * Without the limit, frames queue on the GPU behind another GPU user (a DaVinci render) and each
     * queued frame is one more period between the stick and the screen: positive control, another
     * process keeping the GPU busy (v05-latency HOG_MS=40), submit -> GPU done p50 129 ms and event
     * -> presentation p50 152 ms against 10 ms and 56 ms without it.
     */
    maxFramesInFlight = 2;
    /** frames not drawn because the GPU had not finished the previous ones (for the governor and the probe) */
    framesHeld = 0;
    /** submit times of the drawn frames the GPU has not finished, oldest first */
    private inFlight: number[] = [];
    /** this engine frame draws (decided at 'framerender') */
    private drawing = true;
    /** the backbuffer size the video export draws at (F.3), whatever the canvas' CSS size; null: the window's */
    private fixedRes: { w: number; h: number } | null = null;
    /** engine frames begun (counted at 'frameupdate'): what splatFrame.frame refers to */
    frameNumber = 0;
    /**
     * The scan's state in the last frame the engine prepared it (the gsplat system's 'frame:ready'):
     * `ready` is every level of detail for this view in place and sorted, `loading` the files still
     * on their way. The video export (F.3) encodes a frame only when both say the view is complete.
     */
    readonly splatFrame = { frame: -1, ready: false, loading: 0 };

    private constructor(canvas: HTMLCanvasElement, device: GraphicsDevice, opts: RendererOptions) {
        this.canvas = canvas;
        this.device = device;
        this.renderScale = opts.renderScale ?? 1;
        const app = new AppBase(canvas);
        const ao = new AppOptions();
        ao.graphicsDevice = device;
        ao.componentSystems = [CameraComponentSystem, GSplatComponentSystem, RenderComponentSystem, LightComponentSystem];
        ao.resourceHandlers = [GSplatHandler, TextureHandler, BinaryHandler, ContainerHandler];
        app.init(ao);
        app.setCanvasFillMode(FILLMODE_NONE);
        app.setCanvasResolution(RESOLUTION_FIXED, 16, 16);
        this.app = app;

        const cam = new Entity('fpv-camera', app);
        cam.addComponent('camera', {
            clearColor: new Color(0, 0, 0, 1),
            nearClip: 0.01, // <= 10 mm: the craft flies within centimetres of surfaces
            farClip: 2000,
            fov: opts.hFovDeg ?? 115,
            horizontalFov: true,
            toneMapping: TONEMAP_LINEAR
        });
        app.root.addChild(cam);
        this.camera = cam;

        const light = new Entity('light', app);
        light.setEulerAngles(35, 45, 0);
        light.addComponent('light', { color: new Color(1, 0.98, 0.957), intensity: 1 });
        app.root.addChild(light);
        app.scene.ambientLight.set(0.51, 0.55, 0.65);

        this.debrisRoot = new Entity('debris', app);
        app.root.addChild(this.debrisRoot);

        const g = app.scene.gsplat;
        g.lodUpdateAngle = 90;
        g.lodBehindPenalty = 5;
        g.lodMode = GSPLAT_LODMODE_DISTANCE;
        g.minContribution = 1;
        g.alphaClip = 1 / 255;
        g.radialSorting = true;
        g.splatBudget = (opts.splatBudgetMillions ?? 4) * 1_000_000;
        g.colorUpdateAngle = 0.2;
        g.renderer = device.isWebGPU ? GSPLAT_RENDERER_RASTER_GPU_SORT : GSPLAT_RENDERER_RASTER_CPU_SORT;

        if (opts.latencyMarker) this.initMarker();

        // every SOG image is its own texture asset with exact byte progress from its XHR
        app.assets.on('add', (a: Asset) => this.countAsset(a));

        app.on('frameupdate', this.onFrameUpdate);
        (app.systems as unknown as { gsplat: { on(name: string, cb: (...a: unknown[]) => void): void } }).gsplat.on('frame:ready', (_camera: unknown, _layer: unknown, ready: unknown, loading: unknown) => {
            this.splatFrame.frame = this.frameNumber;
            this.splatFrame.ready = ready === true;
            this.splatFrame.loading = typeof loading === 'number' ? loading : 0;
        });
        this.gpuQueue = (device as unknown as { wgpu?: { queue?: WgpuQueue } }).wgpu?.queue ?? null;
        if (this.gpuQueue) {
            app.on('framerender', this.onFrameRender);
            app.on('frameend', this.onFrameEnd);
        }
        document.addEventListener('visibilitychange', this.onVisibility);

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas);
        this.resize();
    }

    static async create(canvas: HTMLCanvasElement, opts: RendererOptions = {}): Promise<SplatRenderer> {
        const device = await createGraphicsDevice(canvas, {
            deviceTypes: ['webgpu', 'webgl2'],
            antialias: false,
            depth: true,
            stencil: false,
            powerPreference: 'high-performance'
        });
        // resize() already sizes the backbuffer in device pixels (CSS px * devicePixelRatio * scale);
        // the engine multiplies by min(maxPixelRatio, dpr) again, so anything above 1 made it
        // dpr-squared: 5760x3240 instead of 3840x2160 at 150 % (2.25x the pixels, 4x at 200 %)
        device.maxPixelRatio = 1;
        return new SplatRenderer(canvas, device, opts);
    }

    get isWebGPU(): boolean {
        return this.device.isWebGPU;
    }

    /** 2 = GSPLAT_RENDERER_RASTER_GPU_SORT: Gaussians are sorted on the GPU */
    get currentRenderer(): number {
        return this.app.scene.gsplat.currentRenderer;
    }

    setRenderScale(scale: number): void {
        this.renderScale = scale;
        this.resize();
    }

    resize(): void {
        const f = this.fixedRes;
        const w = f ? f.w : Math.max(1, Math.round(this.canvas.clientWidth * window.devicePixelRatio * this.renderScale));
        const h = f ? f.h : Math.max(1, Math.round(this.canvas.clientHeight * window.devicePixelRatio * this.renderScale));
        if (!f && (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0)) return;
        if (w !== this.lastSize.w || h !== this.lastSize.h) {
            this.app.setCanvasResolution(RESOLUTION_FIXED, w, h);
            this.lastSize = { w, h };
        }
    }

    /**
     * Draw at exactly w x h device pixels whatever the canvas' size on the page (the video export
     * draws 1920 x 1080, 2560 x 1440 or 3840 x 2160, F.3); null goes back to the window's size and
     * the render scale. The camera's aspect follows the backbuffer.
     */
    setFixedResolution(size: { w: number; h: number } | null): void {
        this.fixedRes = size ? { w: Math.max(2, Math.round(size.w)), h: Math.max(2, Math.round(size.h)) } : null;
        this.resize();
    }

    /**
     * The time this frame is for: its requestAnimationFrame timestamp (the display's frame time, ms
     * on performance.now()'s clock), however late the callback ran. A recording stamps frames with it
     * (W4-1): stamped with the moment the work ended, a frame whose callback ran half a period late
     * (the main thread busy, a scan still streaming) took the next frame's slot, and that frame was
     * left without one, so the slot before repeated the previous picture.
     */
    get frameTime(): number {
        return this.app._time;
    }

    /**
     * The frame the engine just drew showed the scan complete for its view: nothing loading, every
     * level of detail in place and sorted (the gsplat 'frame:ready' of this very frame). True without
     * a scan on screen (none loaded, hidden, or ?render=off). Call it in 'frameend'.
     */
    get sceneComplete(): boolean {
        if (!this.splat || !this.splat.enabled) return true;
        const f = this.splatFrame;
        return f.frame === this.frameNumber && f.ready && f.loading === 0;
    }

    setToneMapping(name: string | undefined): void {
        const tm = name ? TONEMAPS[name] : undefined;
        if (tm !== undefined && this.camera.camera) this.camera.camera.toneMapping = tm;
    }

    setBackground(rgb: number[] | undefined): void {
        if (rgb && this.camera.camera) this.camera.camera.clearColor = new Color(rgb[0], rgb[1], rgb[2], 1);
    }

    setFov(hFovDeg: number): void {
        if (this.camera.camera) this.camera.camera.fov = hFovDeg;
    }

    /** Load splat content: lod-meta.json (streamed octree) or meta.json (single SOG). */
    loadSplat(url: string, onProgress?: (pct: number) => void): Promise<Entity> {
        this.loadStartedAt = performance.now();
        const filename = new URL(url, location.href).pathname.split('/').pop() || 'scene';
        const isMeta = filename.toLowerCase() === 'meta.json';
        const c = this.count;
        c.base = dirOf(url);
        const start = async (): Promise<unknown> => {
            if (!isMeta) return undefined;
            const data = (await (await fetch(url)).json()) as { count?: number; means?: { shape?: number[] } };
            // a single SOG: all of it is the first view
            c.expected.set(c.base, data.count ?? data.means?.shape?.[0] ?? 0);
            c.listed = true;
            return data;
        };
        return start().then((data) => new Promise<Entity>((resolve, reject) => {
            const asset = new Asset(filename, 'gsplat', { url, filename }, data as object | undefined);
            this.splatAsset = asset;
            asset.on('load', () => {
                const e = new Entity('gsplat', this.app);
                e.setLocalEulerAngles(0, 0, 180); // SuperSplat scenes are stored upside down
                e.setLocalPosition(this.sceneT[0], this.sceneT[1], this.sceneT[2]);
                e.setLocalScale(this.sceneS, this.sceneS, this.sceneS);
                e.addComponent('gsplat', { asset }); // unified rendering is the engine default
                this.app.root.addChild(e);
                this.splat = e;
                // coarse LOD first for a fast reveal; revealFullDetail() opens the full range
                const comp = e.gsplat as GSplatComponent;
                const octree = (comp.resource as unknown as { octree?: OctreeView } | null)?.octree;
                const lodLevels = octree?.lodLevels;
                if (lodLevels) comp.lodRangeMin = comp.lodRangeMax = lodLevels - 1;
                if (octree && lodLevels) this.expectCoarse(octree, lodLevels - 1);
                resolve(e);
            });
            asset.on('progress', (rec: number, len: number) => onProgress?.(Math.min(100, (rec / Math.max(1, len)) * 100)));
            asset.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        }));
    }

    /** The coarse level's files (splat counts from lod-meta) and the environment are the first view. */
    private expectCoarse(octree: OctreeView, level: number): void {
        const c = this.count;
        const perFile = new Map<number, number>();
        for (const n of octree.nodes ?? []) {
            const l = n.lods?.[level];
            if (l && l.fileIndex >= 0 && l.count > 0) perFile.set(l.fileIndex, (perFile.get(l.fileIndex) ?? 0) + l.count);
        }
        for (const [i, n] of perFile) {
            const f = octree.files?.[i];
            if (f?.url) c.expected.set(dirOf(f.url), n);
        }
        if (octree.environmentUrl) c.expected.set(dirOf(octree.environmentUrl), null);
        c.listed = true;
    }

    private countAsset(a: Asset): void {
        const c = this.count;
        const url = (a.file as { url?: string } | null)?.url;
        // everything under the scan's folder belongs to the scan: unloadSplat() frees it
        if (c.base && url && url.startsWith(c.base) && a !== this.splatAsset) this.sceneAssets.add(a);
        if (c.frozen || !c.base || a.type !== 'texture') return;
        if (!url || !url.startsWith(c.base)) return;
        // keyed by URL: an image the engine retries keeps what already arrived (never goes back)
        let r = c.images.get(url);
        if (!r) {
            r = { dir: url.slice(0, url.lastIndexOf('/') + 1), loaded: 0, total: 0, failed: false };
            c.images.set(url, r);
        }
        const rec = r;
        rec.failed = false;
        a.on('progress', (loaded: number, total: number) => {
            if (loaded > rec.loaded) {
                rec.loaded = loaded;
                c.lastByteAt = performance.now();
            }
            if (total > 0) rec.total = total;
        });
        a.once('error', () => { rec.failed = true; });
    }

    /**
     * Download state of the first view, from the engine's own per-image progress: images that have
     * started report exact sizes; files that have not started count with their lod-meta estimate.
     */
    splatBytes(): SplatBytes {
        const c = this.count;
        const dirs = new Map<string, { total: number; sized: boolean; done: boolean; sh: boolean }>();
        let received = 0;
        let failed = 0;
        for (const [url, r] of c.images) {
            received += r.loaded;
            if (r.failed) failed++;
            const d = dirs.get(r.dir) ?? { total: 0, sized: true, done: true, sh: false };
            d.total += Math.max(r.total, r.loaded);
            if (r.total <= 0) d.sized = false;
            if (!(r.total > 0 && r.loaded >= r.total)) d.done = false;
            if (url.slice(r.dir.length).startsWith('shN')) d.sh = true;
            dirs.set(r.dir, d);
        }
        let total = 0;
        let exact = c.listed;
        let complete = c.listed;
        for (const [dir, count] of c.expected) {
            const d = dirs.get(dir);
            if (!d) {
                total += estimateBytes(count, null);
                exact = false;
                complete = false;
                continue;
            }
            // a file's images are all listed the moment it starts (so SH or not is known), but each
            // reports its size only once its own bytes flow: until then the estimate is a floor
            total += d.sized ? d.total : Math.max(estimateBytes(count, d.sh), d.total);
            if (!d.sized) exact = false;
            if (!d.done) complete = false;
        }
        for (const [dir, d] of dirs) {
            if (c.expected.has(dir)) continue;
            // a file the first view needed that lod-meta did not predict
            total += d.total;
            if (!d.sized) exact = false;
            if (!d.done) complete = false;
        }
        return { listed: c.listed, received, total: Math.max(total, received), exact, complete, failed, lastByteAt: c.lastByteAt };
    }

    /** Open the full LOD range after the coarse level has been shown. */
    revealFullDetail(): void {
        this.count.frozen = true;
        const comp = this.splat?.gsplat as GSplatComponent | undefined;
        if (!comp) return;
        comp.lodRangeMin = 0;
        comp.lodRangeMax = 1000;
    }

    /** 'final': the finest level of detail everywhere (cinema mode); 'auto': by distance. */
    setDetail(mode: 'auto' | 'final'): void {
        const comp = this.splat?.gsplat as GSplatComponent | undefined;
        if (!comp) return;
        comp.lodRangeMin = 0;
        comp.lodRangeMax = mode === 'final' ? 0 : 1000;
    }

    /**
     * Drop the scan (design E.4, in-page scene switching): the entity, its asset and every asset the
     * engine loaded for it (SOG images, streamed LOD files) are unloaded and removed, and the load
     * counters start over, so the next loadSplat() is a first load again. The camera, the debris,
     * the latency guard and the device stay. Lead contract step before wave 3.
     */
    unloadSplat(): void {
        if (this.splat) {
            this.splat.destroy();
            this.splat = null;
        }
        const assets = [...this.sceneAssets];
        if (this.splatAsset) assets.unshift(this.splatAsset);
        for (const a of assets) {
            a.unload();
            this.app.assets.remove(a);
        }
        this.splatAsset = null;
        this.sceneAssets.clear();
        this.count = { base: '', listed: false, expected: new Map(), images: new Map(), lastByteAt: 0, frozen: false };
        this.loadStartedAt = 0;
        this.firstFrameAt = 0;
    }

    /**
     * The scene transform T(w) = s*w + t (design E.7, scene scale around the drone): the scan's entity
     * gets position t and uniform scale s and keeps its rotation; the engine's LOD handles uniform
     * scale. Kept for scans loaded later. Collision and physics are transformed elsewhere
     * (collision transform.ts); this only moves the picture. Lead contract step before wave 3.
     */
    setSceneTransform(s: number, t: [number, number, number]): void {
        if (!(s > 0) || !Number.isFinite(s) || !t.every(Number.isFinite)) throw new RangeError(`bad scene transform s=${s} t=${t.join(',')}`);
        this.sceneS = s;
        this.sceneT = [t[0], t[1], t[2]];
        if (this.splat) {
            this.splat.setLocalPosition(t[0], t[1], t[2]);
            this.splat.setLocalScale(s, s, s);
        }
    }

    /** The transform set by setSceneTransform: [s, tx, ty, tz]. */
    get sceneTransform(): [number, number, number, number] {
        return [this.sceneS, this.sceneT[0], this.sceneT[1], this.sceneT[2]];
    }

    /**
     * Draw the next animation frame even if the engine would skip it (autoRender off): a preview
     * while the flight is paused (the scale row in the summary panel). With autoRender on, the
     * default here, every frame already draws. Lead contract step before wave 3.
     */
    renderOnce(): void {
        this.app.renderNextFrame = true;
    }

    /** Show or hide the scan (the voxel overlay's "voxels only"): the splats stop drawing, nothing is unloaded. */
    setSplatVisible(on: boolean): void {
        if (this.splat) this.splat.enabled = on;
    }

    get splatVisible(): boolean {
        return !!this.splat?.enabled;
    }

    /** Upper bound of splats drawn per frame, in millions (the quality governor moves it). */
    setSplatBudgetMillions(m: number): void {
        this.app.scene.gsplat.splatBudget = Math.round(m * 1_000_000);
    }

    /** Camera at the body pose, tilted up by the FPV camera uptilt. Quaternion (w, x, y, z). */
    setPose(px: number, py: number, pz: number, qw: number, qx: number, qy: number, qz: number, uptiltDeg: number): void {
        this.tmpQ.set(qx, qy, qz, qw);
        this.tiltQ.setFromEulerAngles(uptiltDeg, 0, 0);
        this.tmpQ.mul(this.tiltQ);
        this.camera.setPosition(px, py, pz);
        this.camera.setRotation(this.tmpQ);
    }

    start(): void {
        this.app.start();
    }

    // ---- latency guard: measure rAF -> presentation, skip out of Chrome's slow state ----

    /**
     * Start measuring rAF -> presentation (the HUD shows it) and, with `recover`, skipping frames
     * to leave Chrome's slow compositor state. The first measurement is taken at the next frame.
     * Needs Element Timing (Chromium); elsewhere nothing is measured and nothing is skipped.
     */
    startLatencyGuard(recover: boolean): void {
        const types = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver.supportedEntryTypes ?? [] : [];
        const g = this.latencyGuard;
        g.recover = recover;
        g.active = types.includes('element');
        g.trigger(performance.now());
    }

    /**
     * Hold the engine loop for `ms`: no rAF until then. Chrome leaves its slow state only when
     * BeginFrames pass with no main frame pending. The flight model catches up on the next frame
     * (SimClock), so only one picture is shown longer.
     */
    skipFrames(ms: number): boolean {
        const app = this.app;
        if (!app.frameRequestId || this.skipTimer || this.destroyed) return false;
        cancelAnimationFrame(app.frameRequestId);
        app.frameRequestId = null;
        this.skipPending = true;
        this.skipTimer = window.setTimeout(() => {
            this.skipTimer = 0;
            if (!this.destroyed && !app.frameRequestId) app.requestAnimationFrame();
        }, ms);
        return true;
    }

    /** Display period, measured delay and the stick -> screen estimate, for the HUD. */
    latencyStats(): LatencyStats {
        const g = this.latencyGuard;
        const sd = this.submitToDoneMs();
        const P = g.period.ms;
        return { periodMs: P, rafToPresentMs: g.rafToPresentMs, submitToDoneMs: sd, inputToScreenMs: Number.isFinite(P) ? inputToScreenMs(P, g.rafToPresentMs, sd) : NaN, skips: g.skips };
    }

    /** median submit -> GPU done of the last 30 frames, ms (NaN on WebGL2) */
    private submitToDoneMs(): number {
        const d = [...this.submitDone].sort((x, y) => x - y);
        return d.length ? d[d.length >> 1] : NaN;
    }

    private onFrameUpdate = (): void => {
        this.frameNumber++;
        this.frameAfterSkip = this.skipPending;
        this.skipPending = false;
        // inside the rAF callback the document timeline's time is this frame's rAF timestamp
        const ct = document.timeline?.currentTime;
        const t = typeof ct === 'number' ? ct : performance.now();
        const a = this.latencyGuard.onFrame(t, performance.now());
        if (a?.kind === 'measure') this.measurePresentation(t);
    };

    /**
     * A tiny text node inserted in this rAF is committed in the same main frame as the canvas, and
     * Element Timing reports that frame's presentation time: rAF -> presentation without input
     * events. It sits under the canvas: painted, so it is reported, but never seen.
     */
    private measurePresentation(raf: number): void {
        if (!this.latObserver) {
            this.latObserver = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    const p = this.latProbe;
                    const el = e as PerformanceEntry & { identifier?: string; renderTime?: number };
                    if (!p || el.identifier !== p.id) continue;
                    this.latProbe = null;
                    p.node.remove();
                    const a = this.latencyGuard.onSample(performance.now(), (el.renderTime || NaN) - p.raf, this.submitToDoneMs());
                    if (a?.kind === 'skip') this.skipFrames(a.ms);
                }
            });
            this.latObserver.observe({ type: 'element', buffered: false });
        }
        this.latProbe?.node.remove(); // an earlier one never reported (tab hidden): replaced
        const id = `gsfpv-lat-${++this.latSeq}`;
        const n = document.createElement('span');
        n.setAttribute('elementtiming', id);
        n.setAttribute('aria-hidden', 'true');
        n.textContent = 'x';
        const s = n.style;
        s.position = 'fixed';
        s.left = '0';
        s.top = '0';
        s.zIndex = '-1';
        s.font = '4px/4px monospace';
        s.color = '#fff';
        s.pointerEvents = 'none';
        document.body.append(n);
        this.latProbe = { id, raf, node: n };
    }

    /**
     * After the flight model and the scene moved, before drawing: hold this frame when the GPU has
     * not finished maxFramesInFlight frames (see there). Never while a recording or the video export
     * runs (the guard's holdSkips: every slot of the file wants a picture), and never for a frame
     * that is owed (renderOnce). A frame unfinished for HOLD_MAX_MS is not waited for any longer: a
     * lost promise must not stop the picture.
     */
    private onFrameRender = (): void => {
        const app = this.app;
        const cap = this.maxFramesInFlight;
        const f = this.inFlight;
        const hold = cap > 0 && f.length >= cap && !this.latencyGuard.holdSkips && performance.now() - f[0] < HOLD_MAX_MS;
        app.autoRender = !hold;
        this.drawing = !hold || app.renderNextFrame;
        if (!this.drawing) this.framesHeld++;
    };

    /** submit -> GPU done of each drawn frame: a queue behind another GPU user shows up here first. */
    private onFrameEnd = (): void => {
        const q = this.gpuQueue;
        if (!q || !this.drawing) return;
        const t0 = performance.now();
        const f = this.inFlight;
        f.push(t0);
        // the queue finishes work in submission order: the oldest entry is the one done
        q.onSubmittedWorkDone().then(() => {
            f.shift();
            this.submitDone.push(performance.now() - t0);
            if (this.submitDone.length > 30) this.submitDone.shift();
        }, () => { f.shift(); /* device lost: no number */ });
    };

    private onVisibility = (): void => {
        // back from another tab or window: switching is a main-thread hitch of its own
        if (document.visibilityState === 'visible') this.latencyGuard.trigger(performance.now());
    };

    // ---- latency marker: 16x16 CSS px in the top-left corner, drawn in the same frame ----
    // Four 8x8 px cells, black or white, encode (id mod 16). Black and white survive any tone
    // mapping or colour management, so the capture side decodes bits instead of colours.
    private markerCells: Entity[] = [];
    private markerWhite: StandardMaterial | null = null;
    private markerBlack: StandardMaterial | null = null;

    private initMarker(): void {
        const mk = (rgb: number) => {
            const m = new StandardMaterial();
            m.useLighting = false;
            m.diffuse = new Color(0, 0, 0);
            m.emissive = new Color(rgb, rgb, rgb);
            m.depthTest = false;
            m.depthWrite = false;
            m.useTonemap = false;
            m.update();
            return m;
        };
        this.markerWhite = mk(1);
        this.markerBlack = mk(0);
        // the Immediate layer is drawn after everything else, including the gsplat pass
        const uiLayer = this.app.scene.layers.getLayerByName('Immediate');
        for (let i = 0; i < 4; i++) {
            const e = new Entity(`lat-marker-${i}`, this.app);
            e.addComponent('render', { type: 'plane', material: this.markerBlack, castShadows: false, layers: uiLayer ? [uiLayer.id] : undefined });
            this.camera.addChild(e);
            this.markerCells.push(e);
        }
        this.app.on('update', () => this.placeMarker());
        this.setMarker(0);
    }

    private placeMarker(): void {
        const cam = this.camera.camera;
        if (!cam || this.markerCells.length === 0) return;
        const d = 0.05; // metres in front of the lens (> near clip)
        const aspect = this.lastSize.w / Math.max(1, this.lastSize.h);
        // horizontal FOV is configured, derive the vertical half-extent
        const halfW = d * Math.tan((cam.fov * Math.PI) / 360);
        const halfH = halfW / aspect;
        const cssH = Math.max(1, this.canvas.clientHeight);
        const cell = (8 / cssH) * 2 * halfH; // 8 CSS px in world units at distance d
        for (let i = 0; i < 4; i++) {
            const cx = i % 2, cy = i >> 1;
            const e = this.markerCells[i];
            e.setLocalPosition(-halfW + cell * (cx + 0.5), halfH - cell * (cy + 0.5), -d);
            e.setLocalEulerAngles(90, 0, 0);
            e.setLocalScale(cell, 1, cell);
        }
    }

    /** Bit k of (id mod 16) -> cell k white. Cell order: top-left, top-right, bottom-left, bottom-right. */
    setMarker(id: number): void {
        this.markerId = id;
        const v = ((id % 16) + 16) % 16;
        for (let i = 0; i < this.markerCells.length; i++) {
            const r = this.markerCells[i].render;
            if (r) r.material = ((v >> i) & 1) ? this.markerWhite! : this.markerBlack!;
        }
    }

    get marker(): number {
        return this.markerId;
    }

    // ---- simple debris visuals (the physics lives in packages/crash) ----
    addBox(sx: number, sy: number, sz: number, rgb: [number, number, number]): Entity {
        const m = new StandardMaterial();
        m.diffuse = new Color(rgb[0], rgb[1], rgb[2]);
        m.update();
        const e = new Entity('debris-piece', this.app);
        e.addComponent('render', { type: 'box', material: m, castShadows: false });
        e.setLocalScale(sx, sy, sz);
        this.debrisRoot.addChild(e);
        return e;
    }

    clearDebris(): void {
        for (const c of [...this.debrisRoot.children]) c.destroy();
    }

    /** A simple visible craft (only shown after a crash): body plate + four ducts. */
    createCraftModel(ductOffset: number, ductRadius: number): Entity {
        const root = new Entity('craft-model', this.app);
        const mat = (rgb: [number, number, number]) => {
            const m = new StandardMaterial();
            m.diffuse = new Color(rgb[0], rgb[1], rgb[2]);
            m.update();
            return m;
        };
        const body = new Entity('craft-body', this.app);
        body.addComponent('render', { type: 'box', material: mat([0.12, 0.12, 0.14]), castShadows: false });
        body.setLocalScale(ductOffset * 1.6, ductRadius * 0.45, ductOffset * 1.9);
        root.addChild(body);
        for (const [dx, dz] of [[ductOffset, ductOffset], [ductOffset, -ductOffset], [-ductOffset, ductOffset], [-ductOffset, -ductOffset]]) {
            const d = new Entity('craft-duct', this.app);
            d.addComponent('render', { type: 'cylinder', material: mat([0.85, 0.25, 0.12]), castShadows: false });
            d.setLocalPosition(dx, 0, dz);
            d.setLocalScale(ductRadius * 2, ductRadius * 0.7, ductRadius * 2);
            root.addChild(d);
        }
        this.debrisRoot.addChild(root);
        return root;
    }

    setEntityPose(e: Entity, px: number, py: number, pz: number, qw: number, qx: number, qy: number, qz: number): void {
        e.setPosition(px, py, pz);
        this.tmpQ.set(qx, qy, qz, qw);
        e.setRotation(this.tmpQ);
    }

    /** Third-person camera (crash view): at `pos`, looking at `target`. */
    setCameraLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
        this.camera.setPosition(px, py, pz);
        this.camera.lookAt(tx, ty, tz);
    }

    destroy(): void {
        this.destroyed = true;
        this.latencyGuard.active = false;
        clearTimeout(this.skipTimer);
        this.latObserver?.disconnect();
        this.latProbe?.node.remove();
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.ro.disconnect();
        this.app.destroy();
    }
}

export { Vec3, Quat };
