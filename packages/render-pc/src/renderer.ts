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
        device.maxPixelRatio = window.devicePixelRatio;
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
        const w = Math.max(1, Math.round(this.canvas.clientWidth * window.devicePixelRatio * this.renderScale));
        const h = Math.max(1, Math.round(this.canvas.clientHeight * window.devicePixelRatio * this.renderScale));
        if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) return;
        if (w !== this.lastSize.w || h !== this.lastSize.h) {
            this.app.setCanvasResolution(RESOLUTION_FIXED, w, h);
            this.lastSize = { w, h };
        }
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
            asset.on('load', () => {
                const e = new Entity('gsplat', this.app);
                e.setLocalEulerAngles(0, 0, 180); // SuperSplat scenes are stored upside down
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
        if (c.frozen || !c.base || a.type !== 'texture') return;
        const url = (a.file as { url?: string } | null)?.url;
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
        this.ro.disconnect();
        this.app.destroy();
    }
}

export { Vec3, Quat };
