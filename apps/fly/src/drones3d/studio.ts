// The 3D studio of the drone models (v0.9 lane D): its own PlayCanvas app and graphics device on its own canvas, a soft
// studio (a procedural softbox environment for the reflections, a key light with a soft shadow, a pool of light on the
// floor), PBR materials from materials.ts, and the turntable camera of orbit.ts. It draws only while it is told to and
// frees everything on dispose(): the app, its device (GPUDevice.destroy) and every texture and buffer, with a tally of
// what was alive so a test can see it go.
// The engine keeps one "current application" for the whole page and every app sets itself as current when it ticks
// (AppBase.tick), so the flight's own app takes it back on its next frame; everything here passes `app` explicitly and
// nothing of the flight's path calls getApplication() between a tick of this studio and the next tick of the flight.
import {
    AppBase, AppOptions, Entity, Color, Vec3, StandardMaterial, Mesh, MeshInstance, Texture, EnvLighting,
    CameraComponentSystem, RenderComponentSystem, LightComponentSystem, TextureHandler,
    createGraphicsDevice,
    FILLMODE_NONE, RESOLUTION_FIXED, PRIMITIVE_TRIANGLES, TONEMAP_NEUTRAL, PIXELFORMAT_RGBA8, PIXELFORMAT_SRGBA8,
    ADDRESS_CLAMP_TO_EDGE, ADDRESS_REPEAT, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, TEXTUREPROJECTION_EQUIRECT,
    BLEND_NORMAL, SHADOW_PCF5_32F
} from 'playcanvas';
import type { GraphicsDevice } from 'playcanvas';
import { merge } from './mesh';
import type { MeshData, Vec3 as V3 } from './mesh';
import { MATERIALS } from './materials';
import type { MaterialId, MaterialSpec } from './materials';
import type { Model } from './kit';
import { viewPosition } from './orbit';
import type { OrbitState } from './orbit';
import { brushedStreaks, carbonWeave, floorFade, studioEnvironment } from './textures';

export interface StudioOptions {
    /** 'webgl2' forces the fallback (tests); default: WebGPU where there is one */
    backend?: 'auto' | 'webgl2';
    /** the clear colour, so the canvas melts into the panel it sits in */
    background?: readonly [number, number, number];
}

/** What the studio holds on the GPU. A closed studio reads all zeros and `destroyed`. */
export interface Tally {
    backend: 'webgpu' | 'webgl2';
    textures: number;
    buffers: number;
    targets: number;
    shaders: number;
    destroyed: boolean;
}

const FOV = 28;
const col = (c: readonly [number, number, number]): Color => new Color(c[0], c[1], c[2]);

export class Studio {
    readonly app: AppBase;
    readonly device: GraphicsDevice;
    readonly canvas: HTMLCanvasElement;
    /** called every engine frame before the frame is drawn, with the seconds since the last */
    onFrame: ((dt: number) => void) | null = null;
    /** the GPU took the device away (a driver reset, a crash): not our own dispose; the stage can say so and stop */
    onLost: ((reason: string) => void) | null = null;
    frames = 0;
    /** draw every other engine frame (the idle turn needs no more, and the flight's own scan is drawing beside it) */
    halfRate = false;
    private skip = false;
    private camera: Entity;
    private modelRoot: Entity | null = null;
    private meshes: Mesh[] = [];
    private materials = new Map<MaterialId, StandardMaterial>();
    private extraTextures: Texture[] = [];
    private floor: Entity;
    private radius = 1;
    private target: [number, number, number] = [0, 0.4, 0];
    private lost: Promise<unknown> | null;
    private destroyed = false;
    private gpuDestroyed = false;
    private ro: ResizeObserver;
    private size = { w: 0, h: 0 };

    private constructor(canvas: HTMLCanvasElement, device: GraphicsDevice, o: StudioOptions) {
        this.canvas = canvas;
        this.device = device;
        const app = new AppBase(canvas);
        const ao = new AppOptions();
        ao.graphicsDevice = device;
        ao.componentSystems = [CameraComponentSystem, RenderComponentSystem, LightComponentSystem];
        ao.resourceHandlers = [TextureHandler];
        app.init(ao);
        app.setCanvasFillMode(FILLMODE_NONE);
        app.setCanvasResolution(RESOLUTION_FIXED, 16, 16);
        this.app = app;
        const wgpu = (device as unknown as { wgpu?: { lost?: Promise<{ reason: string }> } }).wgpu;
        this.lost = wgpu?.lost ?? null;
        void this.lost?.then((info) => {
            const reason = (info as { reason?: string } | undefined)?.reason ?? 'unknown';
            if (reason === 'destroyed') this.gpuDestroyed = true;
            else if (!this.destroyed) this.onLost?.(reason);
        });

        const bg = o.background ?? [0.075, 0.09, 0.11];
        const cam = new Entity('studio-camera', app);
        cam.addComponent('camera', { clearColor: new Color(bg[0], bg[1], bg[2], 1), fov: FOV, nearClip: 0.05, farClip: 60, toneMapping: TONEMAP_NEUTRAL });
        app.root.addChild(cam);
        this.camera = cam;

        // key light with a soft shadow, a cool rim and a weak fill: the studio
        const key = new Entity('key', app);
        key.addComponent('light', {
            type: 'directional', color: new Color(1, 0.96, 0.9), intensity: 3.3, castShadows: true, shadowType: SHADOW_PCF5_32F,
            shadowResolution: 2048, shadowDistance: 12, shadowBias: 0.08, normalOffsetBias: 0.04, shadowIntensity: 0.9
        });
        key.setEulerAngles(52, 38, 0);
        app.root.addChild(key);
        const rim = new Entity('rim', app);
        rim.addComponent('light', { type: 'directional', color: new Color(0.62, 0.78, 1), intensity: 1.5, castShadows: false });
        rim.setEulerAngles(28, 200, 0);
        app.root.addChild(rim);
        const fill = new Entity('fill', app);
        fill.addComponent('light', { type: 'directional', color: new Color(1, 0.9, 0.82), intensity: 0.8, castShadows: false });
        fill.setEulerAngles(-18, -110, 0);
        app.root.addChild(fill);

        app.scene.exposure = 1.55;
        app.scene.skyboxIntensity = 1.9;
        app.scene.ambientLight.set(0.05, 0.055, 0.068);
        this.buildEnvironment();
        this.floor = this.buildFloor();

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas);
        this.resize();
        app.on('update', (dt: number) => {
            if (this.destroyed) return;
            this.onFrame?.(dt);
            if (this.active) {
                this.skip = this.halfRate ? !this.skip : false;
                this.app.autoRender = !this.skip;
            }
        });
        // counted where a frame is really drawn (the engine fires 'frameend' for a skipped one too)
        app.on('postrender', () => { this.frames++; });
        app.start();
    }

    static async create(canvas: HTMLCanvasElement, o: StudioOptions = {}): Promise<Studio> {
        const device = await createGraphicsDevice(canvas, {
            deviceTypes: o.backend === 'webgl2' ? ['webgl2'] : ['webgpu', 'webgl2'],
            antialias: true,
            depth: true,
            stencil: false,
            powerPreference: 'high-performance'
        });
        device.maxPixelRatio = 1;
        return new Studio(canvas, device, o);
    }

    private tex(c: HTMLCanvasElement, o: { srgb?: boolean; repeat?: boolean; mips?: boolean; name: string }): Texture {
        const t = new Texture(this.device, {
            name: o.name, width: c.width, height: c.height, format: o.srgb ? PIXELFORMAT_SRGBA8 : PIXELFORMAT_RGBA8, mipmaps: o.mips !== false,
            addressU: o.repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE, addressV: o.repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE,
            minFilter: o.mips === false ? FILTER_LINEAR : FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR, anisotropy: 8
        });
        t.setSource(c);
        this.extraTextures.push(t);
        return t;
    }

    /** Softboxes -> reflections and ambient light for every material. */
    private buildEnvironment(): void {
        const c = studioEnvironment();
        const equirect = new Texture(this.device, { name: 'studio-equirect', width: c.width, height: c.height, format: PIXELFORMAT_RGBA8, mipmaps: false, projection: TEXTUREPROJECTION_EQUIRECT, addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE, minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR });
        equirect.setSource(c);
        const source = EnvLighting.generateLightingSource(equirect);
        const atlas = EnvLighting.generateAtlas(source);
        this.app.scene.envAtlas = atlas;
        this.extraTextures.push(atlas);
        equirect.destroy();
        source.destroy();
    }

    private buildFloor(): Entity {
        const mat = new StandardMaterial();
        mat.useMetalness = true;
        mat.diffuse = new Color(0.17, 0.18, 0.21);
        mat.metalness = 0;
        mat.gloss = 0.12;
        const fade = this.tex(floorFade(), { name: 'floor-fade' });
        mat.opacityMap = fade;
        mat.opacityMapChannel = 'a';
        mat.blendType = BLEND_NORMAL;
        mat.depthWrite = false;
        mat.update();
        this.materialsExtra.push(mat);
        // a plain square with planar uvs: the fade picture must not be wrapped round like a lathe's
        const quad: MeshData = {
            positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
            uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 2, 1, 0, 3, 2]
        };
        const mesh = this.meshOf(quad, 'floor');
        const e = new Entity('floor', this.app);
        e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)], castShadows: false, receiveShadows: true });
        this.app.root.addChild(e);
        return e;
    }
    private materialsExtra: StandardMaterial[] = [];

    private meshOf(d: MeshData, name: string): Mesh {
        const m = new Mesh(this.device);
        m.setPositions(new Float32Array(d.positions));
        m.setNormals(new Float32Array(d.normals));
        m.setUvs(0, new Float32Array(d.uvs));
        m.setIndices(d.positions.length / 3 > 65535 ? new Uint32Array(d.indices) : new Uint16Array(d.indices));
        m.update(PRIMITIVE_TRIANGLES);
        (m as unknown as { name: string }).name = name;
        this.meshes.push(m);
        return m;
    }

    private material(id: MaterialId): StandardMaterial {
        const hit = this.materials.get(id);
        if (hit) return hit;
        const spec: MaterialSpec = MATERIALS[id];
        const m = new StandardMaterial();
        m.useMetalness = true;
        m.diffuse = col(spec.color);
        m.metalness = spec.metal;
        m.gloss = spec.gloss;
        if (spec.clearcoat) { m.clearCoat = spec.clearcoat; m.clearCoatGloss = 0.96; }
        if (spec.emissive) { m.emissive = col(spec.emissive); m.emissiveIntensity = 1; }
        if (spec.texture === 'carbon') {
            const t = this.tex(carbonWeave(), { name: 'carbon', srgb: true, repeat: true });
            m.diffuseMap = t;
            m.diffuseMapTiling.set(spec.tiling ?? 1, spec.tiling ?? 1);
            m.glossMap = this.tex(carbonWeave(), { name: 'carbon-gloss', repeat: true });
            m.glossMapTiling.set(spec.tiling ?? 1, spec.tiling ?? 1);
            m.glossMapChannel = 'r';
        } else if (spec.texture === 'brushed') {
            m.glossMap = this.tex(brushedStreaks(), { name: 'brushed', repeat: true });
            m.glossMapTiling.set(spec.tiling ?? 1, spec.tiling ?? 1);
            m.glossMapChannel = 'r';
        }
        m.update();
        this.materials.set(id, m);
        return m;
    }

    /** Show a model (the previous one is destroyed, its GPU buffers with it). */
    setModel(model: Model): void {
        this.dropModel();
        const accent = this.material('accent');
        accent.diffuse = col(model.accent);
        accent.update();
        const byMat = new Map<MaterialId, MeshData[]>();
        for (const p of model.parts) {
            const list = byMat.get(p.material);
            if (list) list.push(p.mesh); else byMat.set(p.material, [p.mesh]);
        }
        const root = new Entity('model', this.app);
        const unit = 1 / model.radius;
        root.setLocalScale(unit, unit, unit);
        for (const [id, list] of byMat) {
            const e = new Entity(`part-${id}`, this.app);
            e.addComponent('render', { meshInstances: [new MeshInstance(this.meshOf(merge(list), id), this.material(id))], castShadows: true, receiveShadows: true });
            root.addChild(e);
        }
        this.app.root.addChild(root);
        this.modelRoot = root;
        this.radius = 1;
        const h = (model.bounds.max[1] - model.bounds.min[1]) * unit;
        this.target = [0, h * 0.42, 0];
        const fs = 1.9 * Math.max(1, (model.bounds.max[0] - model.bounds.min[0]) * unit * 0.5);
        this.floor.setLocalScale(fs, 1, fs);
        this.app.renderNextFrame = true;
    }

    private dropModel(): void {
        if (this.modelRoot) { this.modelRoot.destroy(); this.modelRoot = null; }
        const keep = this.meshes.filter((m) => (m as unknown as { name: string }).name === 'floor');
        for (const m of this.meshes) if (!keep.includes(m)) m.destroy();
        this.meshes = keep;
    }

    /** Point the camera as `s` says. */
    setView(s: OrbitState): void {
        const p = viewPosition(s, this.radius, this.target);
        this.camera.setPosition(p[0], p[1], p[2]);
        this.camera.lookAt(this.target[0], this.target[1], this.target[2]);
    }

    /** Draw frames (true) or hold the last one (false): a hidden stage costs nothing. */
    setActive(on: boolean): void {
        this.active = on;
        this.app.autoRender = on;
        if (on) this.app.renderNextFrame = true;
    }
    private active = true;

    resize(): void {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) return;
        if (w === this.size.w && h === this.size.h) return;
        this.size = { w, h };
        this.app.setCanvasResolution(RESOLUTION_FIXED, w, h);
        this.app.renderNextFrame = true;
    }

    /** A model-space point (mm) on the stage: CSS pixels from the canvas' top-left corner and whether it is in front of the camera. */
    project(p: V3): { x: number; y: number; front: boolean } {
        const s = this.modelRoot ? this.modelRoot.getLocalScale().x : 1;
        const world = new Vec3(p[0] * s, p[1] * s, p[2] * s);
        const out = new Vec3();
        this.camera.camera!.worldToScreen(world, out);
        return { x: out.x, y: out.y, front: out.z > 0 };
    }

    /** Where the camera is, for fading the pins that face away. */
    cameraPosition(): V3 {
        const p = this.camera.getPosition();
        const u = this.modelRoot ? this.modelRoot.getLocalScale().x : 1;
        return [p.x / u, p.y / u, p.z / u];
    }

    tally(): Tally {
        const d = this.device as unknown as { textures?: Set<unknown>; buffers?: Set<unknown>; targets?: Set<unknown>; shaders?: unknown[]; isWebGPU?: boolean };
        return {
            backend: this.device.isWebGPU ? 'webgpu' : 'webgl2',
            textures: d.textures?.size ?? 0,
            buffers: d.buffers?.size ?? 0,
            targets: d.targets?.size ?? 0,
            shaders: d.shaders?.length ?? 0,
            destroyed: this.destroyed
        };
    }

    /** True once the GPU reported its device destroyed (WebGPU: GPUDevice.lost resolved with reason 'destroyed'). */
    get gpuReleased(): boolean {
        return this.gpuDestroyed;
    }

    /** Resolves when the GPU says the device is gone (WebGPU), or at once on WebGL where there is no such report. */
    async whenReleased(timeoutMs = 3000): Promise<boolean> {
        if (!this.lost) return true;
        return Promise.race([this.lost.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(this.gpuDestroyed), timeoutMs))]);
    }

    /** Destroy the app, the device, every texture, buffer and shader. Safe to call twice. */
    dispose(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ro.disconnect();
        this.onFrame = null;
        this.dropModel();
        for (const m of this.meshes) m.destroy();
        this.meshes = [];
        for (const m of this.materials.values()) m.destroy();
        for (const m of this.materialsExtra) m.destroy();
        this.materials.clear();
        this.materialsExtra = [];
        for (const t of this.extraTextures) t.destroy();
        this.extraTextures = [];
        this.app.destroy();
    }
}
