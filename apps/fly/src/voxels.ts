// Voxel overlay feature (design G, brief item 24): show the walls' voxel grid over the scan, or
// hide the scan and fly the voxels only; style, opacity; floating pieces painted, so a phantom
// wall where there should be none stands out. Chunks around the camera are built in a worker
// (voxels.worker.ts) and drawn by render-pc's VoxelOverlay: the nearest ones per voxel while a face
// budget lasts, the rest of the radius per 4x4x4 block. The walls themselves are untouched:
// flying on the voxels is just flying. With a collision ceiling (v0.7) the voxels above it are drawn
// in their own colour (no longer walls), and its panel's preview adds a translucent plane at the height.
import { VoxelOverlay, VOXEL_STYLES } from '@gsfpv/render-pc';
import type { VoxelFog, VoxelStyle } from '@gsfpv/render-pc';
import { FLOATER_MIN_BLOCKS_MAX, ceilingCut, chunkDims, chunksNear, groupKey, overlapKeys, overlayChunkSize, planChunksAround, validCeiling } from '@gsfpv/collision';
import type { CeilingCut, PlannedChunk, VoxelCollision } from '@gsfpv/collision';
import { KEEPER_EVERY_MS, drawnShare, fillLeftS, keeperStep, trimFillSamples, type FillSample } from './voxel-keeper';
import type { FlightSession } from './session';
import type { FromWorker, ToWorker, WorkerGrid } from './voxels.worker';

export type VoxelMode = 'off' | 'overlay' | 'only';
export const VOXEL_MODES: readonly VoxelMode[] = ['off', 'overlay', 'only'];
/** A chunk drawn in colours a floater preview change made old: asked for again, kept on screen meanwhile. */
const STALE = -1;
/** Metres around the camera a floater preview draws at least (the budgets still hold). */
const PREVIEW_RADIUS_M = 60;
export { VOXEL_STYLES };
export type { VoxelStyle };

export interface VoxelPrefs {
    style: VoxelStyle;
    /** opacity over the scan, and with the scan hidden: one slider, the mode in use decides which */
    opacityOverlay: number;
    opacityOnly: number;
}

const PREFS_KEY = 'gsfpv.voxels';
const DEFAULT_PREFS: VoxelPrefs = { style: 'wire', opacityOverlay: 0.55, opacityOnly: 1 };

/** Style and opacities survive a reload (the mode does not: a reload shows the scan). */
export function loadVoxelPrefs(): VoxelPrefs {
    try {
        const j = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<VoxelPrefs> | null;
        if (!j) return { ...DEFAULT_PREFS };
        const op = (v: unknown, d: number): number => (typeof v === 'number' && v >= 0.05 && v <= 1 ? v : d);
        return {
            style: VOXEL_STYLES.includes(j.style as VoxelStyle) ? (j.style as VoxelStyle) : DEFAULT_PREFS.style,
            opacityOverlay: op(j.opacityOverlay, DEFAULT_PREFS.opacityOverlay),
            opacityOnly: op(j.opacityOnly, DEFAULT_PREFS.opacityOnly)
        };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function saveVoxelPrefs(p: VoxelPrefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

/** Uploads per frame in the whole-scene view (estimate; the overlay's per-frame face cap still holds). */
const WHOLE_UPLOADS_PER_FRAME = 8;

export type VoxelState = 'off' | 'no-walls' | 'preparing' | 'ready' | 'failed';

export interface VoxelStats {
    state: VoxelState;
    mode: VoxelMode;
    style: VoxelStyle;
    opacity: number;
    voxelCm: number | null;
    chunkVoxels: number;
    /** drawn now */
    chunks: number;
    quads: number;
    triangles: number;
    /** V1: depth-only copies of the gates and other World items drawn before the voxels */
    depthItems: number;
    /** voxux4 V3: the fog of the voxels-only view (m), null when the scene's own fog holds (not alone) */
    fog: VoxelFog | null;
    /** the plan's reach: per voxel up to fineRadiusM, per block up to radiusM (m) */
    fineRadiusM: number;
    radiusM: number;
    /** the view of voxels alone plans the whole scene (X2): every occupied chunk, far ones as larger cubes */
    whole: boolean;
    /** chunks of the walls holding a wall cell, chunks planned, chunks drawn at their planned level */
    wallChunks: number;
    plannedChunks: number;
    drawnChunks: number;
    /** drawnChunks / plannedChunks in percent (0 before the first plan, 100 when the plan is empty) */
    share: number;
    /** the whole view while it fills: seconds left at the pace so far (null: unknown or full) */
    fillLeftS: number | null;
    /** chunks on screen at their planned level, per level (index: 0 voxels, 1 blocks of 4, 2 cubes of 8, 3 cubes of 16 voxels) */
    perLevel: number[];
    /** the meshes (draws) those chunks take per level: far chunks are joined into group meshes */
    meshesPerLevel: number[];
    /** distance of the farthest chunk planned, and of the farthest drawn (m) */
    farthestM: number;
    drawnFarM: number;
    /** the frame rate keeper's share of the face budgets (1 = full; V3: it never removes chunks) and its mean frame (ms) */
    detail: number;
    frameMs: number;
    inFlight: number;
    pendingUploads: number;
    /** connected pieces of the walls and the floating ones among them */
    components: number;
    floaters: number;
    /** the floater preview's N (previewFloaters), null when none runs: `floaters` then counts the pieces it would drop */
    preview: number | null;
    /** the floater filter (G.3, prefs scene.dropFloaters): pieces under minBlocks dropped from the walls; null = off */
    dropped: { minBlocks: number; pieces: number } | null;
    /** the collision ceiling drawn (scan metres): the panel's preview, else the applied one; null = none */
    ceilingM: number | null;
    /** the ceiling's plane is on screen (only during the panel's preview) */
    ceilingPlane: boolean;
    prepareMs: number | null;
    /** mean worker time per chunk so far, ms */
    chunkMs: number;
    chunksBuilt: number;
    /** main thread: chunks turned into GPU meshes, their total and longest time (ms) */
    uploads: number;
    uploadMs: number;
    uploadMaxMs: number;
    error: string | null;
    /** voxux4 V2: the chunks right around the camera (27 inside the grid), null before the walls are ready */
    near: NearChunkState[] | null;
}

/** What the view holds of one chunk next to the camera (VoxelStats.near). */
export interface NearChunkState {
    key: number;
    /** it holds a wall cell (the walls after the floater filter) */
    occupied: boolean;
    /** the level the plan wants it at / drawn at (null: none); a far group mesh covering it counts as its level */
    wanted: number | null;
    loaded: number | null;
    /** its mesh waits in the upload queue or at the worker */
    pending: boolean;
    /** faces at the drawn level, when measured */
    quads: number | null;
    /** the group mesh (negative key) that draws it, if any */
    group: number | null;
}

export class VoxelController {
    mode: VoxelMode = 'off';
    prefs: VoxelPrefs = loadVoxelPrefs();
    /**
     * Metres around the camera, and the face budgets (quads) of the two levels: 850 k quads are
     * 1.7 M triangles. With nothing within the radius (a camera high over an aerial scan) the
     * radius doubles up to 160 m until the nearest walls are in; the budgets stay.
     */
    radiusM = 20;
    fineQuads = 600_000;
    coarseQuads = 250_000;
    /** level 2 cubes (8 voxels) past the two budgets in the whole-scene view; the rest of the scene is level 3 (estimate) */
    farQuads = 250_000;
    /** the frame rate keeper's share of the budgets, its mean frame time, and a forced share (test hook) */
    private detail = 1;
    private forced: number | null = null;
    private keeper = { last: 0, sum: 0, n: 0, at: 0, fast: 0, ms: 0 };
    private lastPlan: PlannedChunk[] = [];
    private planFar = 0;
    /** when the whole view's fill began (performance.now), 0 when full */
    private fillFrom = 0;
    /** readings of the share since the fill began (first one kept), for the pace of the last 2 s */
    private fillSamples: FillSample[] = [];
    private session: FlightSession;
    private overlay: VoxelOverlay | null = null;
    private worker: Worker | null = null;
    private col: VoxelCollision | null = null;
    private gen = 0;
    private size = 48;
    private occupied: Set<number> | null = null;
    private error: string | null = null;
    private prepStart = 0;
    private prepareMs: number | null = null;
    private components = 0;
    private floaters = 0;
    private known = { fine: new Map<number, number>(), coarse: new Map<number, number>() };
    /** levels 2 and up: quads per chunk and their sums (lod -> ...) */
    private knownFar = new Map<number, Map<number, number>>();
    private sumFar = new Map<number, { q: number; n: number }>();
    private sum = { fine: 0, nFine: 0, coarse: 0, nCoarse: 0, ms: 0, n: 0 };
    private wanted = new Map<number, number>();
    /** the level drawn per chunk; STALE: drawn in colours a floater preview change made old */
    private loaded = new Map<number, number>();
    /** the floater filter's preview (previewFloaters): N, or null when off */
    private previewN: number | null = null;
    /** the collision ceiling's preview (previewCeiling): a height in scan metres, or null when off */
    private previewC: number | null = null;
    /** the ceiling the worker was told (its rows), as a height: what the chunks drawn are coloured for */
    private cutM: number | null = null;
    private inFlight = new Set<string>();
    private plan = { fineRadius: 0, radius: 0 };
    /** a plan was made since the worker became ready (until then "settled" means nothing) */
    private planned = false;
    private lastPlanAt = 0;
    private listeners = new Set<() => void>();
    maxInFlight = 4;

    /** A new scene (E.4): the grid is rebuilt for its walls at the next frame; the mode and look stay. */
    setSession(session: FlightSession): void {
        this.session = session;
        this.apply();
    }

    constructor(session: FlightSession) {
        this.session = session;
        this.col = session.collision;
    }

    /** Called on every change of mode, style, opacity or state (the controls and the legend listen). */
    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private notify(): void {
        for (const cb of [...this.listeners]) {
            try { cb(); } catch (e) { console.error(e); }
        }
    }

    get hasWalls(): boolean {
        return !!this.session.collision;
    }

    get opacity(): number {
        return this.mode === 'only' ? this.prefs.opacityOnly : this.prefs.opacityOverlay;
    }

    /** The mode drawn: the pilot's, but over the scan while a floater or ceiling preview runs with the grid off. */
    private get shown(): VoxelMode {
        return (this.previewN !== null || this.previewC !== null) && this.mode === 'off' ? 'overlay' : this.mode;
    }

    /** The ceiling to draw: the panel's preview, else the one the walls have (scan metres); null = none. */
    private ceilingNow(): number | null {
        return this.previewC ?? this.session.ceilingM;
    }

    /** The rows above a ceiling, from the scan's own grid (every scaled or filtered copy shares it). */
    private cutOf(c: number | null): CeilingCut | null {
        const base = this.session.baseCollision;
        return c === null || !base ? null : ceilingCut(base, c);
    }

    /** The collision ceiling's preview (null: none). */
    get ceilingPreview(): number | null {
        return this.previewC;
    }

    /**
     * Preview the collision ceiling at `c` (scan metres; the ceiling panel, ui/ceiling.ts): the grid
     * over the scan, the voxels above in their own colour, and a translucent plane at the height
     * around the camera. null ends it: the grid is the pilot's again. Nothing here is remembered.
     */
    previewCeiling(c: number | null): void {
        if (c !== null && !validCeiling(c)) return;
        if (c === this.previewC) return;
        this.previewC = c;
        if (c === null) this.overlay?.setCeilingPlane(null);
        this.recut();
        this.apply();
        this.notify();
    }

    /** The worker's ceiling follows ceilingNow(): the chunks drawn are asked for again in the new colours. */
    private recut(): void {
        const c = this.ceilingNow();
        if (c === this.cutM) return;
        this.cutM = c;
        if (!this.worker) return; // the next init sends it
        this.gen++;
        const msg: ToWorker = { t: 'ceiling', gen: this.gen, cut: this.cutOf(c) };
        this.worker.postMessage(msg);
        this.inFlight.clear();
        for (const k of this.loaded.keys()) this.loaded.set(k, STALE);
        this.lastPlanAt = 0;
    }

    /**
     * The colours drawn: the pilot's style, or the floater colours while a floater or ceiling preview
     * runs (grey walls, red specks, violet above the ceiling: the colours the panels' legends name).
     */
    private get look(): VoxelStyle {
        return this.previewN !== null || this.previewC !== null ? 'floaters' : this.prefs.style;
    }

    /** The walls drawn: the flown ones, or the scan's own (before the filter) while a preview runs. */
    private target(): VoxelCollision | null {
        return this.previewN !== null ? this.session.unfilteredWalls : this.session.collision;
    }

    /** The floater filter's preview at N (or null: none). */
    get preview(): number | null {
        return this.previewN;
    }

    /**
     * Preview the floater filter at `n` (Settings' "drop floating pieces", ui/floaters.ts): the scan's
     * own walls over the scan, the pieces the filter would drop at n in red, the rest as walls. null
     * ends it and the grid is the pilot's again (mode, style and walls); nothing here is remembered.
     */
    previewFloaters(n: number | null): void {
        if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= FLOATER_MIN_BLOCKS_MAX)) return;
        if (n === this.previewN) return;
        const was = this.previewN;
        this.previewN = n;
        if (was !== null && n !== null && this.worker && this.col === this.target()) {
            // the same walls, other pieces in red: what is drawn is asked for again in the new colours
            this.gen++;
            const msg: ToWorker = { t: 'mark', gen: this.gen, minBlocks: n };
            this.worker.postMessage(msg);
            this.inFlight.clear();
            for (const k of this.loaded.keys()) this.loaded.set(k, STALE);
            this.lastPlanAt = 0;
            this.apply();
            this.notify();
        } else this.resetFor(this.target());
    }

    setMode(m: VoxelMode): void {
        if (!VOXEL_MODES.includes(m)) return;
        this.mode = m;
        this.apply();
        this.notify();
    }

    /** The view of voxels alone with no preview running: the whole scene is planned (X2). */
    private get whole(): boolean {
        return this.shown === 'only' && this.previewN === null && this.previewC === null;
    }

    /** Force the keeper's share of the budgets (0.05..1; null: the keeper decides again). Tests and the bench. */
    forceDetail(d: number | null): void {
        this.forced = d === null || !Number.isFinite(d) ? null : Math.max(0.05, Math.min(1, d));
        this.lastPlanAt = 0;
    }

    /** V: off -> over the scan -> voxels only -> off. */
    cycle(): VoxelMode {
        this.setMode(VOXEL_MODES[(VOXEL_MODES.indexOf(this.mode) + 1) % VOXEL_MODES.length]);
        return this.mode;
    }

    setStyle(s: VoxelStyle): void {
        if (!VOXEL_STYLES.includes(s)) return;
        this.prefs.style = s;
        saveVoxelPrefs(this.prefs);
        this.apply();
        this.notify();
    }

    /**
     * Style, opacity and mode at once, not remembered (URL test switches, the test hook): the
     * opacity goes to the mode given, or to the mode in use.
     */
    configure(o: { style?: VoxelStyle; opacity?: number; mode?: VoxelMode }): void {
        if (o.style && VOXEL_STYLES.includes(o.style)) this.prefs.style = o.style;
        if (o.opacity !== undefined && Number.isFinite(o.opacity)) {
            const v = Math.max(0.05, Math.min(1, o.opacity));
            if ((o.mode ?? this.mode) === 'only') this.prefs.opacityOnly = v;
            else this.prefs.opacityOverlay = v;
        }
        if (o.mode && VOXEL_MODES.includes(o.mode)) this.mode = o.mode;
        this.apply();
        this.notify();
    }

    /** Something the controls show changed outside (the walls switch). */
    touch(): void {
        this.notify();
    }

    /** The opacity of the mode in use (over the scan when off). */
    setOpacity(a: number): void {
        const v = Math.max(0.05, Math.min(1, a));
        if (this.mode === 'only') this.prefs.opacityOnly = v;
        else this.prefs.opacityOverlay = v;
        saveVoxelPrefs(this.prefs);
        this.apply();
        this.notify();
    }

    private apply(): void {
        const walls = !!this.target();
        const mode = this.shown;
        const on = mode !== 'off' && walls;
        if (on && !this.overlay) this.overlay = new VoxelOverlay(this.session.renderer);
        this.overlay?.setVisible(on);
        this.overlay?.setLook(this.look, mode === 'only' ? this.prefs.opacityOnly : this.prefs.opacityOverlay, mode === 'only' && walls);
        // without walls there is nothing to fly on: the scan stays
        this.session.renderer.setSplatVisible(!(mode === 'only' && walls));
        if (on) this.ensureWorker();
    }

    get state(): VoxelState {
        if (!this.session.collision) return 'no-walls';
        if (this.error) return 'failed';
        if (this.shown === 'off') return 'off';
        return this.occupied ? 'ready' : 'preparing';
    }

    /** Per frame, before drawing: new walls reset the grid; chunks are planned and uploaded. */
    frame(now: number): void {
        const want = this.target();
        if (want !== this.col) this.resetFor(want);
        this.recut();
        this.ceilingPlane();
        if (this.shown === 'off' || !this.overlay || !this.col) { this.keeper.last = 0; return; }
        this.keep(now);
        const t0 = performance.now();
        this.overlay.update();
        const t1 = performance.now();
        this.perf.frames++;
        this.perf.update += t1 - t0;
        this.perf.updateMax = Math.max(this.perf.updateMax, t1 - t0);
        if (now - this.lastPlanAt >= 150) {
            this.lastPlanAt = now;
            this.replan();
            const t2 = performance.now();
            this.perf.replans++;
            this.perf.replan += t2 - t1;
            this.perf.replanMax = Math.max(this.perf.replanMax, t2 - t1);
        }
    }

    /** V3: the frame rate keeper (voxel-keeper.ts) lowers the far cubes' detail when frames are slow; it never removes chunks. */
    private keep(now: number): void {
        const k = this.keeper;
        if (k.last > 0) { k.sum += now - k.last; k.n++; }
        k.last = now;
        if (now - k.at < KEEPER_EVERY_MS || k.n === 0) return;
        k.ms = k.sum / k.n;
        k.at = now; k.sum = 0; k.n = 0;
        const next = keeperStep(this.detail, k.ms, k.fast);
        k.fast = next.fast;
        if (next.detail !== this.detail) { this.detail = next.detail; this.lastPlanAt = 0; }
    }

    /** During the ceiling preview: the plane at the previewed height in the flown world, centred under the camera. */
    private ceilingPlane(): void {
        const c = this.previewC;
        if (c === null || !this.overlay || this.shown === 'off') return;
        const tr = this.session.transform;
        const p = this.session.renderer.camera.getPosition();
        this.overlay.setCeilingPlane({ x: p.x, y: tr.s * c + tr.t[1], z: p.z, half: Math.max(this.radiusM, PREVIEW_RADIUS_M) });
    }

    /** Main-thread time of the overlay per frame so far: uploads (update) and chunk planning (ms). */
    readonly perf = { frames: 0, update: 0, updateMax: 0, replans: 0, replan: 0, replanMax: 0, messages: 0, message: 0, messageMax: 0 };

    /** The walls changed (a bake, a refine, an import): a new grid from the new walls. */
    private resetFor(col: VoxelCollision | null): void {
        this.worker?.terminate();
        this.worker = null;
        this.col = col;
        this.occupied = null;
        this.known.fine.clear();
        this.known.coarse.clear();
        this.knownFar.clear();
        this.sumFar.clear();
        this.lastPlan = [];
        this.wanted.clear();
        this.loaded.clear();
        this.inFlight.clear();
        this.overlay?.clear();
        this.prepareMs = null;
        this.error = null;
        this.cutM = null; // the next worker is told the ceiling at its init
        this.apply();
        this.notify();
    }

    private ensureWorker(): void {
        if (this.worker || !this.col) return;
        const col = this.col;
        const gen = ++this.gen;
        this.size = overlayChunkSize(col.voxelResolution);
        let w: Worker;
        try {
            w = new Worker(new URL('./voxels.worker.ts', import.meta.url), { type: 'module' });
        } catch (e) {
            this.error = String((e as Error)?.message ?? e);
            return;
        }
        w.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
        w.onerror = (e) => {
            this.error = e.message || 'worker error';
            this.notify();
        };
        const grid: WorkerGrid = {
            flip: col.flipXY,
            min: [col.gridMinX, col.gridMinY, col.gridMinZ],
            res: col.voxelResolution,
            n: [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ],
            leafSize: col.leafSize,
            treeDepth: col.treeDepth
        };
        // the worker gets its own copy: the flight keeps reading these arrays
        const nodes = col.nodes.slice(), leaf = col.leafData.slice();
        this.cutM = this.ceilingNow();
        const msg: ToWorker = { t: 'init', gen, grid, nodes, leaf, size: this.size, layout: this.overlay!.layout, minBlocks: this.previewN ?? 0, cut: this.cutOf(this.cutM) };
        w.postMessage(msg, [nodes.buffer, leaf.buffer]);
        this.worker = w;
        this.prepStart = performance.now();
        // the height colours: from a little under the spawn (the floor, most often) up a quarter of the scan
        const y0 = this.session.spawn[1] - 2;
        const tall = col.numVoxelsY * col.voxelResolution;
        this.overlay?.setHeightRange(y0, y0 + Math.max(4, Math.min(25, tall / 4)));
    }

    private onMessage(m: FromWorker): void {
        const t0 = performance.now();
        this.handle(m);
        const ms = performance.now() - t0;
        this.perf.messages++;
        this.perf.message += ms;
        this.perf.messageMax = Math.max(this.perf.messageMax, ms);
    }

    private handle(m: FromWorker): void {
        if (m.gen !== this.gen) return;
        if (m.t === 'error') {
            this.error = m.message;
            this.inFlight.clear(); // the failed request must not hold a slot for ever
            this.notify();
            return;
        }
        if (m.t === 'marked') {
            this.floaters = m.floaters;
            this.planned = false;
            this.lastPlanAt = 0;
            this.notify();
            return;
        }
        if (m.t === 'ready') {
            this.occupied = new Set(m.occupied);
            this.components = m.components;
            this.floaters = m.floaters;
            this.prepareMs = performance.now() - this.prepStart;
            this.lastPlanAt = 0;
            this.planned = false;
            this.notify();
            return;
        }
        const id = `${m.key}:${m.lod}`;
        this.inFlight.delete(id);
        // a group mesh (negative key) is not one chunk: it stays out of the per-chunk sizes the plan budgets with
        if (m.key < 0) { this.sum.ms += m.ms; this.sum.n++; }
        else if (m.lod <= 1) (m.lod === 0 ? this.known.fine : this.known.coarse).set(m.key, m.quads);
        else {
            if (!this.knownFar.has(m.lod)) this.knownFar.set(m.lod, new Map());
            this.knownFar.get(m.lod)!.set(m.key, m.quads);
            const f = this.sumFar.get(m.lod) ?? { q: 0, n: 0 };
            f.q += m.quads; f.n++;
            this.sumFar.set(m.lod, f);
        }
        if (m.key >= 0) {
            if (m.lod === 0) { this.sum.fine += m.quads; this.sum.nFine++; } else if (m.lod === 1) { this.sum.coarse += m.quads; this.sum.nCoarse++; }
            this.sum.ms += m.ms;
            this.sum.n++;
        }
        // no longer wanted at this level (the camera moved on): measured, not drawn
        if (this.wanted.get(m.key) !== m.lod || !this.overlay) return;
        // same key: the upload replaces the other level in the same frame, so nothing blinks
        this.overlay.add(String(m.key), m);
        this.loaded.set(m.key, m.lod);
        // keep the worker busy: the next chunks of the last plan, nearest first, without waiting for the next plan
        this.feed();
    }

    /** Ask the worker for the chunks of the last plan not yet drawn at their level, up to maxInFlight at once. */
    private feed(): void {
        if (!this.worker || !this.overlay) return;
        for (const c of this.lastPlan) {
            if (this.inFlight.size >= this.maxInFlight) break;
            if (this.loaded.get(c.key) === c.lod) continue;
            const id = `${c.key}:${c.lod}`;
            if (this.inFlight.has(id)) continue;
            this.inFlight.add(id);
            const [lo, hi] = this.overlay.heightRange;
            const msg: ToWorker = { t: 'chunk', gen: this.gen, key: c.key, x: c.x, y: c.y, z: c.z, lod: c.lod, style: this.look, lo, hi, group: c.group ?? 1 };
            this.worker.postMessage(msg);
        }
    }

    private replan(): void {
        const col = this.col;
        if (!col || !this.occupied || !this.worker || !this.overlay) return;
        const p = this.session.renderer.camera.getPosition();
        const avgFine = this.sum.nFine ? this.sum.fine / this.sum.nFine : undefined;
        const avgCoarse = this.sum.nCoarse ? this.sum.coarse / this.sum.nCoarse : undefined;
        // a floater preview looks further: the pieces it would drop are often away from the craft
        const radius = this.previewN !== null ? Math.max(this.radiusM, PREVIEW_RADIUS_M) : this.radiusM;
        const whole = this.whole;
        const d = this.forced ?? this.detail;
        const avgFar = new Map<number, number>();
        for (const [lod, f] of this.sumFar) avgFar.set(lod, f.q / f.n);
        // the whole scene joins far chunks into group meshes (overlay.ts groupPlan): 27236 draws -> 2852 on Wroclaw
        const plan = planChunksAround(col, this.size, this.occupied, p.x, p.y, p.z, { radius, fineQuads: this.fineQuads * d, coarseQuads: this.coarseQuads * d, known: this.known, avgFine, avgCoarse, whole, groups: whole, farQuads: this.farQuads * d, knownFar: this.knownFar, avgFar });
        this.plan = { fineRadius: plan.fineRadius, radius: plan.radius };
        this.planFar = plan.chunks.reduce((f, c) => Math.max(f, c.farDist ?? c.dist), 0);
        // V3 (voxux4): the voxels-only view fogs into the background where the farthest planned chunk ends
        this.overlay?.setFogReach(Math.max(plan.radius, this.planFar));
        this.lastPlan = plan.chunks;
        this.planned = true;
        this.wanted = new Map(plan.chunks.map((c) => [c.key, c.lod]));
        // small far meshes: more of them per frame in the whole view; the per-frame face cap still holds (estimate)
        this.overlay.maxUploadsPerFrame = whole ? WHOLE_UPLOADS_PER_FRAME : 2;
        const dims = chunkDims(col, this.size);
        const onScreen = (k: number): boolean => this.wanted.get(k) === this.loaded.get(k) && !this.overlay!.pending(String(k));
        let quads = this.overlay.stats().quads;
        for (const [key, lod] of this.loaded) {
            const want = this.wanted.get(key);
            // a chunk that should now be coarse stays fine until its coarse mesh lands (no hole),
            // unless that keeps the drawn faces over the budgets (flying fast through a dense scan)
            // (the whole-scene view keeps every chunk until its new level lands: no hole)
            const over = !whole && want === 1 && lod === 0 && quads > this.fineQuads + this.coarseQuads;
            if (want !== undefined && !over) continue;
            // whole view: a chunk or group leaves only when the wanted meshes over the same chunks are on screen
            if (whole && want === undefined && overlapKeys(dims, key).some((k) => this.wanted.has(k) && !onScreen(k))) continue;
            quads -= (lod <= 1 ? this.known[lod === 0 ? 'fine' : 'coarse'].get(key) : this.knownFar.get(lod)?.get(key)) ?? 0;
            this.overlay.remove(String(key));
            this.loaded.delete(key);
        }
        this.feed();
    }

    stats(): VoxelStats {
        const o = this.overlay?.stats();
        const col = this.col;
        // on screen = uploaded at the planned level; a mesh waiting in the upload queue is not counted
        const sh = drawnShare(this.lastPlan, (k) => (this.overlay?.pending(String(k)) ? undefined : this.loaded.get(k)));
        // nothing planned yet (the grid is being prepared): nothing is drawn, not all of it
        const share = this.planned ? sh.share : 0;
        // the fill's pace: from the first plan of the whole view that was not all on screen
        const now = performance.now();
        if (!this.whole || share >= 100) { this.fillFrom = 0; this.fillSamples = []; }
        else {
            if (this.fillFrom === 0) this.fillFrom = now;
            this.fillSamples.push({ t: now, share: sh.meshShare });
            trimFillSamples(this.fillSamples, now);
        }
        return {
            state: this.state,
            mode: this.mode,
            style: this.prefs.style,
            opacity: this.opacity,
            voxelCm: col ? Math.round(col.voxelResolution * 1000) / 10 : null,
            chunkVoxels: this.size,
            chunks: o?.chunks ?? 0,
            quads: o?.quads ?? 0,
            triangles: o?.triangles ?? 0,
            depthItems: o?.depthItems ?? 0,
            fog: o?.fog ?? null,
            fineRadiusM: this.plan.fineRadius,
            radiusM: this.plan.radius,
            whole: this.whole,
            wallChunks: this.occupied?.size ?? 0,
            plannedChunks: sh.total,
            drawnChunks: sh.drawn,
            share,
            fillLeftS: this.fillFrom ? fillLeftS(this.fillSamples, now, sh.meshShare) : null,
            perLevel: sh.perLevel,
            meshesPerLevel: sh.meshesPerLevel,
            farthestM: this.planFar,
            drawnFarM: sh.drawnFarM,
            detail: this.forced ?? this.detail,
            frameMs: this.keeper.ms,
            inFlight: this.inFlight.size,
            pendingUploads: o?.pendingUploads ?? 0,
            components: this.components,
            floaters: this.floaters,
            preview: this.previewN,
            dropped: this.session.floaterMinBlocks > 0 && this.session.floaterFilter ? { minBlocks: this.session.floaterMinBlocks, pieces: this.session.floaterFilter.pieces } : null,
            ceilingM: this.ceilingNow(),
            ceilingPlane: this.overlay?.ceilingPlaneShown ?? false,
            prepareMs: this.prepareMs,
            chunkMs: this.sum.n ? this.sum.ms / this.sum.n : 0,
            chunksBuilt: this.sum.n,
            uploads: o?.uploads ?? 0,
            uploadMs: o?.uploadMs ?? 0,
            uploadMaxMs: o?.uploadMaxMs ?? 0,
            error: this.error,
            near: this.nearState()
        };
    }

    /** VoxelStats.near: the plan and the drawing of the chunks right around the camera. */
    private nearState(): NearChunkState[] | null {
        const col = this.col;
        if (!col || !this.occupied) return null;
        const p = this.session.renderer.camera.getPosition();
        const dims = chunkDims(col, this.size);
        const inFlight = (k: number): boolean => [...this.inFlight].some((id) => id.startsWith(`${k}:`));
        return chunksNear(col, this.size, p.x, p.y, p.z).chunks.map((c) => {
            let key = c.key;
            let group: number | null = null;
            if (!this.wanted.has(key) && !this.loaded.has(key)) {
                for (const g of [2, 4, 8]) {
                    const gk = groupKey(dims, g, Math.floor(c.x / g), Math.floor(c.y / g), Math.floor(c.z / g));
                    if (this.wanted.has(gk) || this.loaded.has(gk)) { key = gk; group = gk; break; }
                }
            }
            const loaded = this.loaded.get(key) ?? null;
            const q = loaded === null ? undefined : loaded <= 1 ? this.known[loaded === 0 ? 'fine' : 'coarse'].get(c.key) : this.knownFar.get(loaded)?.get(c.key);
            return {
                key: c.key,
                occupied: this.occupied!.has(c.key),
                wanted: this.wanted.get(key) ?? null,
                loaded,
                pending: !!this.overlay?.pending(String(key)) || inFlight(key),
                quads: group === null ? q ?? null : null,
                group
            };
        });
    }

    /** Everything wanted is drawn (tests and screenshots wait for it). */
    get settled(): boolean {
        if (this.shown === 'off' || !this.col) return true;
        if (this.state !== 'ready' || !this.planned) return false;
        const o = this.overlay?.stats();
        if (!o || o.pendingUploads > 0 || o.recolorPending > 0 || this.inFlight.size > 0) return false;
        for (const [k, lod] of this.wanted) if (this.loaded.get(k) !== lod) return false;
        return true;
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.overlay?.dispose();
        this.overlay = null;
        this.session.renderer.setSplatVisible(true);
        this.listeners.clear();
    }
}
