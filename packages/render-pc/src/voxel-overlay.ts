// Voxel overlay (design G, item 24): the collision's exposed faces drawn over the scan or instead
// of it, in four styles, with an opacity. The geometry comes in chunks (packages/collision
// overlay.ts, built in a worker by the app); this class only turns them into meshes and draws them.
//
// Engine side: one Mesh + MeshInstance per chunk in a layer of its own, after the World layer, so
// it draws after the splats; two directional lights that light only that layer shade the cube
// faces apart (the scene's light is on the World layer). Splats write no depth (the gsplat
// material's depthWrite is off unless dithering), so the voxels show through the scan like an
// x-ray: the point of an alignment check. Styles are StandardMaterials (no custom shaders: the
// same code runs on WebGPU and WebGL2); a small repeating texture in cell units draws each voxel's
// edges. Each chunk arrives as one interleaved vertex buffer packed off the main thread
// (voxel-colors.ts packChunk, in the app's worker; the engine's per-attribute path cost 3.4 ms per
// chunk on the main thread in the Winter Garden, up to 22 ms); a style change rewrites only its
// colour bytes, a few chunks per frame.

import {
    Layer, Mesh, MeshInstance, GraphNode, Entity, StandardMaterial, Texture, Color, BoundingBox, Vec3,
    VertexFormat, VertexBuffer, IndexBuffer,
    PRIMITIVE_TRIANGLES, BLEND_NORMAL, BLEND_NONE, PIXELFORMAT_RGBA8, ADDRESS_REPEAT, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR,
    SEMANTIC_POSITION, SEMANTIC_NORMAL, SEMANTIC_TEXCOORD0, SEMANTIC_COLOR, TYPE_FLOAT32, TYPE_UINT8,
    BUFFER_STATIC, INDEXFORMAT_UINT16, INDEXFORMAT_UINT32
} from 'playcanvas';
import type { SplatRenderer } from './renderer';
import { VOXEL_STYLES, writeColors } from './voxel-colors';
import type { VoxelStyle, VoxelLayout, PackedChunk } from './voxel-colors';

export { VOXEL_STYLES };
export type { VoxelStyle, VoxelLayout, PackedChunk };

interface Entry {
    mi: MeshInstance;
    vb: VertexBuffer;
    floater: Uint8Array;
    quads: number;
    /** style (and height range, for 'height') its colours were written for */
    colored: VoxelStyle;
    lo: number;
    hi: number;
}

/** 64 x 64 cell texture: r = interior 1 / edge 0.38 (dark edges), g = interior 0.42 / edge 1 (bright edges), a = edge mask. */
function gridTexture(r: SplatRenderer): Texture {
    const N = 64, E = 2; // edge: 2 px on each side of the cell
    const tex = new Texture(r.device, {
        name: 'gsfpv-voxel-grid', width: N, height: N, format: PIXELFORMAT_RGBA8, mipmaps: true,
        addressU: ADDRESS_REPEAT, addressV: ADDRESS_REPEAT, minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR, anisotropy: 8
    });
    const px = tex.lock() as Uint8Array;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const edge = x < E || y < E || x >= N - E || y >= N - E;
        const i = (y * N + x) * 4;
        px[i] = edge ? 96 : 255;
        px[i + 1] = edge ? 255 : 107;
        px[i + 2] = 0;
        px[i + 3] = edge ? 255 : 0;
    }
    tex.unlock();
    return tex;
}

export interface VoxelOverlayStats {
    chunks: number;
    quads: number;
    triangles: number;
    pendingUploads: number;
    recolorPending: number;
    /** main-thread cost of turning chunks into GPU meshes so far: count, total and longest ms, and quads */
    uploads: number;
    uploadMs: number;
    uploadMaxMs: number;
    uploadQuads: number;
}

export class VoxelOverlay {
    readonly layer: Layer;
    private r: SplatRenderer;
    private root = new GraphNode('gsfpv-voxels');
    private entries = new Map<string, Entry>();
    private queue = new Map<string, PackedChunk>();
    private tex: Texture;
    private lights: Entity[] = [];
    private mats: Record<VoxelStyle, StandardMaterial>;
    private format: VertexFormat;
    /** the interleaved vertex layout chunks must be packed in (packChunk) */
    readonly layout: VoxelLayout;
    private styleNow: VoxelStyle = 'wire';
    private opacityNow = 0.4;
    private lo = 0;
    private hi = 4;
    private quadsNow = 0;
    private up = { n: 0, ms: 0, max: 0, quads: 0 };
    /**
     * Uploads and recolours per frame: a burst of new chunks must not cost one long frame (about
     * 0.23 us per quad here, most of it the GPU buffer copy). A chunk larger than the budget still
     * goes alone.
     */
    maxUploadsPerFrame = 2;
    maxUploadQuadsPerFrame = 20_000;
    maxRecolorQuadsPerFrame = 100_000;

    constructor(r: SplatRenderer) {
        this.r = r;
        const layers = r.app.scene.layers;
        this.layer = new Layer({ name: 'GSFPV Voxels' });
        const world = layers.getLayerByName('World');
        layers.insert(this.layer, world ? layers.getTransparentIndex(world) + 1 : layers.layerList.length);
        const cam = r.camera.camera!;
        cam.layers = [...cam.layers, this.layer.id];
        this.layer.enabled = false;
        // key light from above, a weaker fill from the other side: the three face directions of a cube read apart
        for (const [name, pitch, yaw, k] of [['key', 55, 35, 0.95], ['fill', 20, 215, 0.35]] as const) {
            const e = new Entity(`gsfpv-voxel-${name}`, r.app);
            e.addComponent('light', { type: 'directional', color: new Color(1, 0.98, 0.95), intensity: k, castShadows: false, layers: [this.layer.id] });
            e.setEulerAngles(pitch, yaw, 0);
            r.app.root.addChild(e);
            this.lights.push(e);
        }
        this.format = new VertexFormat(r.device, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_NORMAL, components: 3, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_TEXCOORD0, components: 2, type: TYPE_FLOAT32 },
            { semantic: SEMANTIC_COLOR, components: 4, type: TYPE_UINT8, normalize: true }
        ]);
        const off = (name: string): number => {
            const el = this.format.elements.find((e) => e.name === name);
            if (!el) throw new Error(`vertex format has no ${name}`);
            return el.offset as number;
        };
        this.layout = { stride: this.format.size, pos: off(SEMANTIC_POSITION), nrm: off(SEMANTIC_NORMAL), uv: off(SEMANTIC_TEXCOORD0), col: off(SEMANTIC_COLOR) };
        this.tex = gridTexture(r);
        this.mats = {
            solid: this.material('solid'),
            wire: this.material('wire'),
            height: this.material('height'),
            floaters: this.material('floaters')
        };
        this.applyOpacity();
    }

    private material(style: VoxelStyle): StandardMaterial {
        const m = new StandardMaterial();
        m.name = `gsfpv-voxels-${style}`;
        m.useFog = false;
        m.useSkybox = false;
        m.useTonemap = false;
        m.depthWrite = true;
        m.depthTest = true;
        if (style === 'solid' || style === 'floaters') {
            // lit cubes: the layer's two lights and the ambient shade each face direction differently
            m.useLighting = true;
            m.diffuse = new Color(1, 1, 1);
            m.diffuseVertexColor = true;
            m.diffuseMap = this.tex;
            m.diffuseMapChannel = 'rrr';
            m.specular = new Color(0.06, 0.06, 0.06);
            m.gloss = 0.25;
            const e = style === 'floaters' ? 0.3 : 0.12;
            m.emissive = new Color(e, e, e);
            m.emissiveVertexColor = true;
        } else if (style === 'wire') {
            // only the cell edges: the texture's mask cuts the rest away
            m.useLighting = false;
            m.diffuse = new Color(0, 0, 0);
            m.emissive = new Color(1, 1, 1);
            m.emissiveVertexColor = true;
            m.opacityMap = this.tex;
            m.opacityMapChannel = 'a';
        } else {
            // glowing height bands with brighter edges
            m.useLighting = false;
            m.diffuse = new Color(0, 0, 0);
            m.emissive = new Color(1, 1, 1);
            m.emissiveVertexColor = true;
            m.emissiveMap = this.tex;
            m.emissiveMapChannel = 'ggg';
        }
        m.update();
        return m;
    }

    private applyOpacity(): void {
        const a = this.opacityNow;
        for (const s of VOXEL_STYLES) {
            const m = this.mats[s];
            m.opacity = a;
            // wire: the mask is 0 inside a cell and 1 on its edges; far away its mip levels average
            // the edges down to ~0.1, so the test only drops the empty inside, never a far edge
            m.alphaTest = s === 'wire' ? Math.min(0.02, a * 0.05) : 0;
            m.blendType = a < 0.999 || s === 'wire' ? BLEND_NORMAL : BLEND_NONE;
            m.update();
        }
    }

    get style(): VoxelStyle {
        return this.styleNow;
    }

    get opacity(): number {
        return this.opacityNow;
    }

    setVisible(on: boolean): void {
        this.layer.enabled = on;
    }

    get visible(): boolean {
        return this.layer.enabled;
    }

    /** Style and opacity (0.05..1). A style change recolours the chunks a few per frame. */
    setLook(style: VoxelStyle, opacity: number): void {
        const a = Math.max(0.05, Math.min(1, opacity));
        if (a !== this.opacityNow) {
            this.opacityNow = a;
            this.applyOpacity();
        }
        if (style !== this.styleNow) {
            this.styleNow = style;
            const m = this.mats[style];
            for (const e of this.entries.values()) e.mi.material = m;
        }
    }

    /** World heights (m) mapped to the ends of the height ramp (chunks recolour when the style is 'height'). */
    setHeightRange(lo: number, hi: number): void {
        this.lo = lo;
        this.hi = Math.max(lo + 0.5, hi);
    }

    get heightRange(): [number, number] {
        return [this.lo, this.hi];
    }

    /** Colours written for another style (or another height range) are rewritten by update(). */
    private stale(e: { colored: VoxelStyle; lo: number; hi: number }): boolean {
        return e.colored !== this.styleNow || (this.styleNow === 'height' && (e.lo !== this.lo || e.hi !== this.hi));
    }

    /** Queue a packed chunk (replacing one with the same key once it is uploaded). */
    add(key: string, c: PackedChunk): void {
        this.queue.set(key, c);
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    remove(key: string): void {
        this.queue.delete(key);
        const e = this.entries.get(key);
        if (!e) return;
        this.layer.removeMeshInstances([e.mi]);
        e.mi.destroy(); // and its mesh with the buffers
        this.entries.delete(key);
        this.quadsNow -= e.quads;
    }

    keys(): IterableIterator<string> {
        return this.entries.keys();
    }

    clear(): void {
        for (const k of [...this.entries.keys()]) this.remove(k);
        this.queue.clear();
    }

    /** Per frame: upload queued chunks and recolour stale ones within the per-frame budgets. Returns keys uploaded. */
    update(): string[] {
        const done: string[] = [];
        let quads = 0;
        for (const [key, c] of this.queue) {
            if (done.length >= this.maxUploadsPerFrame || (done.length > 0 && quads + c.quads > this.maxUploadQuadsPerFrame)) break;
            this.queue.delete(key);
            const t0 = performance.now();
            this.upload(key, c);
            const ms = performance.now() - t0;
            this.up.n++;
            this.up.ms += ms;
            this.up.max = Math.max(this.up.max, ms);
            this.up.quads += c.quads;
            done.push(key);
            quads += c.quads;
        }
        let recolor = 0;
        for (const e of this.entries.values()) {
            if (!this.stale(e)) continue;
            if (recolor > 0 && recolor + e.quads > this.maxRecolorQuadsPerFrame) break;
            const buf = e.vb.lock();
            writeColors(ArrayBuffer.isView(buf) ? (buf.buffer as ArrayBuffer) : buf, this.layout, e.quads * 4, this.styleNow, e.floater, this.lo, this.hi);
            e.vb.unlock();
            e.colored = this.styleNow;
            e.lo = this.lo;
            e.hi = this.hi;
            recolor += e.quads;
        }
        return done;
    }

    private upload(key: string, c: PackedChunk): void {
        this.remove(key);
        if (c.quads === 0) return;
        const nv = c.quads * 4;
        if (c.vertices.byteLength !== nv * this.layout.stride) throw new Error('chunk was packed for another vertex layout');
        const device = this.r.device;
        const vb = new VertexBuffer(device, this.format, nv, { usage: BUFFER_STATIC, data: c.vertices });
        const ib = new IndexBuffer(device, c.indices instanceof Uint16Array ? INDEXFORMAT_UINT16 : INDEXFORMAT_UINT32, c.indices.length, BUFFER_STATIC, c.indices);
        const mesh = new Mesh(device);
        mesh.vertexBuffer = vb;
        mesh.indexBuffer[0] = ib;
        const prim = mesh.primitive[0];
        prim.type = PRIMITIVE_TRIANGLES;
        prim.base = 0;
        prim.baseVertex = 0;
        prim.count = c.indices.length;
        prim.indexed = true;
        const a = c.aabb;
        mesh.aabb = new BoundingBox(new Vec3((a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2), new Vec3((a[3] - a[0]) / 2, (a[4] - a[1]) / 2, (a[5] - a[2]) / 2));
        const mi = new MeshInstance(mesh, this.mats[this.styleNow], this.root);
        mi.castShadow = false;
        this.layer.addMeshInstances([mi]);
        this.entries.set(key, { mi, vb, floater: c.floater, quads: c.quads, colored: c.style, lo: c.lo, hi: c.hi });
        this.quadsNow += c.quads;
    }

    stats(): VoxelOverlayStats {
        let recolorPending = 0;
        for (const e of this.entries.values()) if (this.stale(e)) recolorPending++;
        return { chunks: this.entries.size, quads: this.quadsNow, triangles: this.quadsNow * 2, pendingUploads: this.queue.size, recolorPending, uploads: this.up.n, uploadMs: this.up.ms, uploadMaxMs: this.up.max, uploadQuads: this.up.quads };
    }

    dispose(): void {
        this.clear();
        const layers = this.r.app.scene.layers;
        const cam = this.r.camera.camera;
        if (cam) cam.layers = cam.layers.filter((id) => id !== this.layer.id);
        layers.remove(this.layer);
        for (const s of VOXEL_STYLES) this.mats[s].destroy();
        for (const e of this.lights) e.destroy();
        this.tex.destroy();
    }
}
