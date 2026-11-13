// View-dependent level of detail for a streamed scan (lane lod-view, docs/wip/lod-view.md; the owner's stress test on the
// Lublin scan, 259 M splats, flown above the roofs on a small splat budget).
//
// The engine (2.23.2) picks each octree node's level of detail from ONE number, a "distance": the real distance to the node,
// made longer only for nodes BEHIND the camera (lodBehindPenalty). A node in front of the camera but outside the picture
// counts like one in its centre, so part of the budget is drawn where nobody looks; and after a turn the picture shows what
// was chosen for the old view until the engine looks again (every 10th frame, and then only after lodUpdateAngle degrees).
// Neither the engine (up to 2.25 beta) nor the SuperSplat viewer has a rule for the frame; a hook for one was declined
// upstream (engine PR 8700). Other open viewers have one (Spark: a cone around the view axis; Babylon.js, Aholo: the
// frustum); none predicts from the turn rate.
//
// What this file adds, in that same one number (so the engine's own budget balancer moves the freed splats into the
// frame, and the download order follows, since both read it):
//   - nodes that touch the FRAME keep their distance;
//   - around the frame a ring where the detail falls a little (ringLevels levels at ringDeg beyond the frame's edge): a turn
//     finds something there, half a level coarser;
//   - beyond the ring the detail falls smoothly to farLevels levels coarser (at farDeg beyond the edge, and behind): coarse,
//     never nothing, so a fast turn shows a coarse city and not a hole;
//   - while the view turns, the frame is widened toward where it is turning (the frame as it will be predictS seconds on at
//     the present turn rate, at most MAX_LEAD_DEG ahead): detail and downloads start before the picture gets there. The
//     full-detail zone is only ever widened, never moved away from what is on screen;
//   - a new choice is asked for as soon as the view has turned refreshDeg since the last one, or rolled twice that (tick(),
//     every frame, at most every MIN_ASK_MS), and once more when a turn ends.
// The params are in LEVELS of detail, and the factor on the distance is made from them with the scan's own lodMultiplier
// (a factor F makes a node log(F) / log(lodMultiplier) levels coarser), so the effect is the same whatever multiplier the
// renderer sets.
//
// This reaches engine internals (the octree instance's evaluateNodeDistances and nodeInfos, the world's
// _lodUpdateRequested and markInstancesNeedLodUpdate), as the accumulating renderer does (accum.ts): viewLodMissing names
// what is not there, and then nothing is installed and the engine works as before. The wrapper calls the engine's own
// method first and only multiplies its result, never throws into the engine's update (a failure switches it off for good
// and is reported), and counts its calls, so a silent no-op after an engine bump shows in stats().

import { Mat4, Vec3 } from 'playcanvas';
import type { AppBase, Entity } from 'playcanvas';

export interface ViewLodParams {
    /** degrees beyond the frame's edge at which the detail has fallen by ringLevels levels */
    ringDeg: number;
    ringLevels: number;
    /** degrees beyond the frame's edge at which the detail is farLevels levels coarser (and stays: behind is the same) */
    farDeg: number;
    farLevels: number;
    /** the frame is widened toward where the view will be after this many seconds of the present turn rate; 0: no look-ahead */
    predictS: number;
    /** degrees the view may turn before a new choice of detail is asked for */
    refreshDeg: number;
    /** files are fetched nearest first (by the frame's distance) instead of the engine's coarser-level-of-the-whole-scan first */
    nearFirst: boolean;
}

/**
 * The values the Lublin stress test settled on (docs/wip/lod-view.md): between the two that were scored against a 16 M
 * reference, 0.43 and 2.5 levels (best right after a snap turn) and 0.68 and 4 levels (best once the view has settled).
 */
export const VIEW_LOD_DEFAULTS: ViewLodParams = { ringDeg: 25, ringLevels: 0.5, farDeg: 80, farLevels: 3, predictS: 0.25, refreshDeg: 6, nearFirst: true };

/** The engine's lodMultiplier where a scan does not say its own. */
export const ENGINE_LOD_MULTIPLIER = 3;

/** The ramp of the distance factor: 1 in the frame, ringFactor at ringDeg beyond its edge, farFactor from farDeg on. */
export interface ViewRamp {
    ringDeg: number;
    ringFactor: number;
    farDeg: number;
    farFactor: number;
}

/** The ramp these params make with a scan's lodMultiplier: so many levels coarser is the multiplier to that power. */
export function rampFor(p: Pick<ViewLodParams, 'ringDeg' | 'ringLevels' | 'farDeg' | 'farLevels'>, multiplier: number): ViewRamp {
    const m = multiplier > 1 && Number.isFinite(multiplier) ? multiplier : ENGINE_LOD_MULTIPLIER;
    return { ringDeg: p.ringDeg, ringFactor: m ** p.ringLevels, farDeg: p.farDeg, farFactor: m ** p.farLevels };
}

/** The look-ahead never widens the frame by more than this (two frames this far apart still overlap at a 115 degree lens). */
export const MAX_LEAD_DEG = 90;
/** A turn slower than this (degrees per second) is not a turn: no look-ahead, and its end is not an event. */
export const TURN_MIN_DEG_S = 20;
/**
 * New choices of detail are asked for at most this often (ms apart): a choice walks every node of the scan (about 2 ms on a
 * laptop for the 9534 nodes of the Lublin scan, more on a phone), and at 20 a second a fast turn is still followed: the
 * ring and the look-ahead cover what the view passes in between.
 */
export const MIN_ASK_MS = 50;

const D2R = Math.PI / 180;

/** The frame's half angles in radians (horizontal, vertical) from the camera's field of view in degrees and its aspect ratio. */
export function frameHalfAngles(fovDeg: number, horizontalFov: boolean, aspect: number): { h: number; v: number } {
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
    let tanV = Math.tan(fovDeg * 0.5 * D2R);
    if (horizontalFov) tanV /= a;
    return { h: Math.atan(tanV * a), v: Math.atan(tanV) };
}

/**
 * How far, in radians, a sphere lies outside the frame: 0 when it is inside or touches it. (x, y, z) is the sphere's centre
 * in the camera's own axes (right, up, forward; x and y may be given with either sign), `d` its distance (the length of
 * that vector), `r` its radius. The horizontal and the vertical excess are measured each in its own plane and joined as the
 * two sides of a right angle, so a node beside the frame AND above it is further out than one that is only beside it; a
 * node straight behind is 180 degrees less the half angle out.
 */
export function outsideFrame(x: number, y: number, z: number, d: number, r: number, halfH: number, halfV: number): number {
    if (d <= r) return 0;
    const ar = Math.asin(r / d);
    const eh = Math.atan2(Math.abs(x), z) - halfH - ar;
    const ev = Math.atan2(Math.abs(y), z) - halfV - ar;
    if (eh <= 0) return ev <= 0 ? 0 : ev;
    return ev <= 0 ? eh : Math.hypot(eh, ev);
}

/** The factor on a node's distance for an angle outside the frame (radians): 1 inside, ringFactor at the ring's edge, farFactor from farDeg on. */
export function viewFactor(outside: number, p: ViewRamp): number {
    if (!(outside > 0)) return 1;
    const ring = p.ringDeg * D2R;
    if (outside < ring) return 1 + (p.ringFactor - 1) * (outside / ring);
    const span = Math.max(1e-3, p.farDeg * D2R - ring);
    const t = Math.min(1, (outside - ring) / span);
    return p.ringFactor + (p.farFactor - p.ringFactor) * (t * t * (3 - 2 * t));
}

/** Three numbers. */
export interface V3 {
    x: number;
    y: number;
    z: number;
}

/**
 * The turn between two view axes `dtS` seconds apart: the axis it turns about (unit; any when the turn is nil) and its rate
 * in degrees per second. Roll about the view axis is not seen (it does not move the frame's centre).
 */
export function turnOf(prev: V3, now: V3, dtS: number): { axis: V3; degPerS: number } {
    const cx = prev.y * now.z - prev.z * now.y;
    const cy = prev.z * now.x - prev.x * now.z;
    const cz = prev.x * now.y - prev.y * now.x;
    const s = Math.hypot(cx, cy, cz);
    const c = prev.x * now.x + prev.y * now.y + prev.z * now.z;
    const angle = Math.atan2(s, c);
    if (!(dtS > 0) || s < 1e-9) return { axis: { x: 0, y: 1, z: 0 }, degPerS: 0 };
    return { axis: { x: cx / s, y: cy / s, z: cz / s }, degPerS: angle / D2R / dtS };
}

/** `v` turned by `deg` degrees about the unit `axis` (Rodrigues). */
export function turned(v: V3, axis: V3, deg: number): V3 {
    const a = deg * D2R;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
    return {
        x: v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * dot * (1 - c),
        y: v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * dot * (1 - c),
        z: v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * dot * (1 - c)
    };
}

/** How far ahead (degrees) the frame is widened for a turn rate: rate times predictS, nothing below TURN_MIN_DEG_S, at most MAX_LEAD_DEG. */
export function leadDeg(degPerS: number, predictS: number): number {
    if (!(predictS > 0) || !(degPerS >= TURN_MIN_DEG_S)) return 0;
    return Math.min(MAX_LEAD_DEG, degPerS * predictS);
}

// ---- the engine's side ----

interface NodeLike {
    boundingSphere: { x: number; y: number; z: number; w: number };
}
interface InstanceLike {
    octree: { nodes: NodeLike[]; lodLevels?: number; files?: { lodLevel?: number }[] };
    nodeInfos: { worldDistanceSq: number }[];
    placement: { node: { getWorldTransform(): Mat4 }; lodMultiplier?: number };
    evaluateNodeDistances(cameraNode: Entity, params: unknown): void;
    requestFile?(fileIndex: number, tier: number, distanceRank: number): boolean;
}

/** The engine's tiers of a file request (gsplat-octree-instance.js): a node's next finer level, a node's wanted level, a node that shows nothing. */
const TIER_PREFETCH = 0;
const TIER_SWITCH = 1;
const TIER_VISIBLE = 2;

/**
 * The rank to hand the engine's requestFile so that a file is fetched NEAREST FIRST. The engine's priority is
 * tier + (the file's level + rank) / levels: within a tier the coarser level of the WHOLE scan comes before any finer one,
 * and a node's next finer level (tier 0) waits behind every other node's wanted level (tier 1). So after the reveal the
 * far parts of a scan are at their final detail seconds before what is near (measured, docs/wip/gpu-select.md). Asked with
 * the rank this returns, the same formula gives 1 + rank for both of those tiers: nearest first by the distance the frame's
 * priority has already weighted (in the frame before the ring before the rest), whatever the level; a node still goes
 * coarse to fine by itself (lodUnderfillLimit). A node that shows NOTHING (the engine's top tier) keeps the engine's
 * order, coarse first: that is what fills holes.
 */
export function nearFirstRank(tier: number, rank: number, fileLevel: number, levels: number): number {
    if (tier !== TIER_PREFETCH && tier !== TIER_SWITCH) return rank;
    if (!(levels > 0) || !Number.isFinite(fileLevel)) return rank;
    const near = !(rank > 0) ? 0 : rank > 0.999999 ? 0.999999 : rank;
    return (TIER_SWITCH - tier + near) * levels - fileLevel;
}
export { TIER_PREFETCH, TIER_SWITCH, TIER_VISIBLE };
interface WorldLike {
    _octreeInstances: Map<unknown, InstanceLike>;
    _lodUpdateRequested: boolean;
    markInstancesNeedLodUpdate(): void;
}
type Anything = Record<string, unknown>;

/** The gsplat worlds of the app (one per camera and layer that draws splats). */
function worlds(app: AppBase): WorldLike[] {
    const out: WorldLike[] = [];
    const director = (app.renderer as unknown as { gsplatDirector?: { camerasMap?: Map<unknown, { layersMap?: Map<unknown, { gsplatManager?: { world?: WorldLike } }> }> } | null }).gsplatDirector;
    director?.camerasMap?.forEach((cd) => cd.layersMap?.forEach((ld) => {
        const w = ld.gsplatManager?.world;
        if (w && !out.includes(w)) out.push(w);
    }));
    return out;
}

/** The first octree instance there is (a streamed scan), or null. */
function firstInstance(app: AppBase): InstanceLike | null {
    for (const w of worlds(app)) {
        if (!(w._octreeInstances instanceof Map)) continue;
        for (const inst of w._octreeInstances.values()) return inst;
    }
    return null;
}

/**
 * The engine members this needs that are missing (empty: it can run). Before a streamed scan is in there is no octree
 * instance to look at: that is 'no streamed scan yet', not a fault, and install() is simply tried again.
 */
export function viewLodMissing(app: AppBase): string[] {
    const miss: string[] = [];
    const renderer = app.renderer as unknown as Anything;
    if (!renderer.gsplatDirector) return ['gsplatDirector'];
    const ws = worlds(app);
    const inst = firstInstance(app);
    if (!inst) return ['no streamed scan yet'];
    const proto = Object.getPrototypeOf(inst) as Anything | null;
    if (!proto || typeof proto.evaluateNodeDistances !== 'function') miss.push('evaluateNodeDistances');
    if (!Array.isArray(inst.nodeInfos) || (inst.nodeInfos.length > 0 && typeof inst.nodeInfos[0]?.worldDistanceSq !== 'number')) miss.push('nodeInfos.worldDistanceSq');
    const node = inst.octree?.nodes?.[0];
    if (!node || typeof node.boundingSphere?.w !== 'number') miss.push('octree.nodes.boundingSphere');
    if (typeof inst.placement?.node?.getWorldTransform !== 'function') miss.push('placement.node');
    const w = ws[0] as unknown as Anything | undefined;
    if (!w || typeof w.markInstancesNeedLodUpdate !== 'function') miss.push('markInstancesNeedLodUpdate');
    if (!w || typeof w._lodUpdateRequested !== 'boolean') miss.push('_lodUpdateRequested');
    return miss;
}

export interface ViewLodStats {
    /** the wrapper is on the engine's method and has not failed */
    active: boolean;
    /** what is missing in this engine (empty when active or not yet tried) */
    missing: string[];
    /** the exception that switched it off, if one did */
    failed: string | null;
    /** choices of detail made through the wrapper, and how many of them this file asked for (a turn) */
    calls: number;
    asked: number;
    /** file requests whose rank this file set (0 on an engine without requestFile, or with nearFirst off) */
    reordered: number;
    /** the wrapper's own time in the last choice, ms */
    lastMs: number;
    /** nodes of the last choice: touching the frame, in the ring, beyond it */
    inFrame: number;
    ring: number;
    out: number;
    /** the turn rate the last tick saw (degrees per second) and the look-ahead it gave (degrees) */
    turnDegS: number;
    leadDeg: number;
}

interface Hook {
    /** the engine's own method */
    orig: (this: InstanceLike, cameraNode: Entity, params: unknown) => void;
    /** the engine's own requestFile, when it has one to wrap (else the download order stays the engine's) */
    origRequest: ((this: InstanceLike, fileIndex: number, tier: number, distanceRank: number) => boolean) | null;
    /** the ViewLod that owns the wrapper now (null: the wrapper only calls through) */
    owner: ViewLod | null;
}

const _inv = new Mat4();
const _p = new Vec3();
const _f = new Vec3();
const _r = new Vec3();
const _u = new Vec3();
const _pf = new Vec3();
const _pr = new Vec3();
const _pu = new Vec3();

/**
 * The frame's priority on one app's streamed scan. `tick()` once per frame (it installs the wrapper as soon as a streamed
 * scan is there, follows the turn rate and asks for a new choice when the view has turned); `dispose()` puts the engine's
 * method back.
 */
export class ViewLod {
    readonly params: ViewLodParams;
    enabled = true;
    private hook: Hook | null = null;
    private proto: Anything | null = null;
    private missing: string[] = [];
    private failed: string | null = null;
    private calls = 0;
    private asked = 0;
    private reordered = 0;
    /** when the last new choice was asked for (the frame's time, ms) */
    private askedAt = -Infinity;
    private lastMs = 0;
    private counts = { inFrame: 0, ring: 0, out: 0 };
    /** the view axis of the last choice (and the camera's right axis then), of the last tick, and when that tick was (ms) */
    private evalAxis: V3 | null = null;
    private evalRight: V3 | null = null;
    private tickAxis: V3 | null = null;
    private tickAt = 0;
    /** the present turn: its axis, rate, and the look-ahead in use by the last choice */
    private turnAxis: V3 = { x: 0, y: 1, z: 0 };
    private turnDegS = 0;
    private lead = 0;
    private evalLead = 0;

    private readonly app: AppBase;
    private readonly camera: Entity;

    constructor(app: AppBase, camera: Entity, params: Partial<ViewLodParams> = {}) {
        this.app = app;
        this.camera = camera;
        this.params = { ...VIEW_LOD_DEFAULTS, ...params };
    }

    /** Puts the wrapper on the engine's method (once per engine class; later calls only take it over). False while it cannot. */
    install(): boolean {
        if (this.failed) return false;
        if (this.hook && this.hook.owner === this) return true;
        const miss = viewLodMissing(this.app);
        if (miss.length) {
            this.missing = miss[0] === 'no streamed scan yet' ? [] : miss;
            return false;
        }
        const inst = firstInstance(this.app) as InstanceLike;
        const proto = Object.getPrototypeOf(inst) as Anything;
        let hook = proto.__gsfpvViewLod as Hook | undefined;
        if (!hook) {
            const orig = proto.evaluateNodeDistances as Hook['orig'];
            const origRequest = typeof proto.requestFile === 'function' ? (proto.requestFile as NonNullable<Hook['origRequest']>) : null;
            const h: Hook = { orig, origRequest, owner: null };
            hook = h;
            proto.evaluateNodeDistances = function (this: InstanceLike, cameraNode: Entity, params: unknown): void {
                orig.call(this, cameraNode, params);
                h.owner?.after(this, cameraNode);
            };
            // the download order: the same call with another rank (nearFirstRank); the engine's own code decides the rest
            if (origRequest) {
                proto.requestFile = function (this: InstanceLike, fileIndex: number, tier: number, distanceRank: number): boolean {
                    const o = h.owner;
                    return origRequest.call(this, fileIndex, tier, o ? o.rankFor(this, fileIndex, tier, distanceRank) : distanceRank);
                };
            }
            proto.__gsfpvViewLod = h;
        }
        hook.owner = this;
        this.hook = hook;
        this.proto = proto;
        this.missing = [];
        return true;
    }

    /** The engine's own method back in its place (nothing else of the engine was changed). */
    dispose(): void {
        if (this.hook && this.hook.owner === this) {
            this.hook.owner = null;
            if (this.proto && this.proto.__gsfpvViewLod === this.hook) {
                this.proto.evaluateNodeDistances = this.hook.orig;
                if (this.hook.origRequest) this.proto.requestFile = this.hook.origRequest;
                delete this.proto.__gsfpvViewLod;
            }
        }
        this.hook = null;
        this.proto = null;
    }

    /** Once per frame, before the engine's update. `nowMs`: the frame's time. */
    tick(nowMs: number): void {
        if (!this.enabled || this.failed) return;
        if (!this.install()) return;
        const f = this.camera.forward;
        const axis: V3 = { x: f.x, y: f.y, z: f.z };
        if (this.tickAxis && nowMs > this.tickAt) {
            const dt = (nowMs - this.tickAt) / 1000;
            // a long gap (a hidden tab, a hitch) says nothing about a turn
            const turn = dt < 0.5 ? turnOf(this.tickAxis, axis, dt) : { axis: this.turnAxis, degPerS: 0 };
            // smoothed a little: one odd frame must not switch the look-ahead on and off
            this.turnDegS = this.turnDegS * 0.5 + turn.degPerS * 0.5;
            if (turn.degPerS > 0) this.turnAxis = turn.axis;
            this.lead = leadDeg(this.turnDegS, this.params.predictS);
        }
        this.tickAxis = axis;
        this.tickAt = nowMs;
        // a new choice: the view has left the axis of the last one, or the look-ahead the last one used has gone (the turn ended)
        let ask = false;
        if (this.evalAxis) {
            const dot = Math.min(1, Math.max(-1, axis.x * this.evalAxis.x + axis.y * this.evalAxis.y + axis.z * this.evalAxis.z));
            if (Math.acos(dot) > this.params.refreshDeg * D2R) ask = true;
        }
        // a roll about the view axis leaves the axis where it was and still turns the frame (its wide side comes to where its
        // narrow side was): the camera's right axis tells it
        if (!ask && this.evalRight) {
            const r = this.camera.right;
            const dot = Math.min(1, Math.max(-1, r.x * this.evalRight.x + r.y * this.evalRight.y + r.z * this.evalRight.z));
            if (Math.acos(dot) > 2 * this.params.refreshDeg * D2R) ask = true;
        }
        if (this.evalLead > 0 && this.lead === 0) ask = true;
        if (ask && nowMs - this.askedAt >= MIN_ASK_MS) this.ask(nowMs);
    }

    /** Asks the engine for a new choice of detail on its next update. */
    private ask(nowMs: number): void {
        for (const w of worlds(this.app)) {
            w._lodUpdateRequested = true;
            w.markInstancesNeedLodUpdate();
        }
        this.asked++;
        this.askedAt = nowMs;
    }

    /** The rank a file is asked for with (the wrapper on the engine's requestFile): nearest first while at work, the engine's own otherwise. */
    private rankFor(inst: InstanceLike, fileIndex: number, tier: number, rank: number): number {
        if (!this.enabled || this.failed || !this.params.nearFirst) return rank;
        const level = inst.octree.files?.[fileIndex]?.lodLevel;
        const levels = inst.octree.lodLevels;
        if (typeof level !== 'number' || typeof levels !== 'number') return rank;
        this.reordered++;
        return nearFirstRank(tier, rank, level, levels);
    }

    /** After the engine's own distances: the frame's factor on every node outside it. */
    private after(inst: InstanceLike, cameraNode: Entity): void {
        if (!this.enabled || this.failed) return;
        const t0 = performance.now();
        try {
            this.apply(inst, cameraNode);
        } catch (e) {
            // never into the engine's update: off for good, said once (stats().failed)
            this.failed = String((e as Error)?.message ?? e).slice(0, 200);
        }
        this.calls++;
        this.lastMs = performance.now() - t0;
    }

    private apply(inst: InstanceLike, cameraNode: Entity): void {
        const camera = cameraNode.camera;
        if (!camera) return;
        const p = rampFor(this.params, inst.placement.lodMultiplier ?? ENGINE_LOD_MULTIPLIER);
        const half = frameHalfAngles(camera.fov, camera.horizontalFov, camera.aspectRatio);
        const sinH = Math.sin(half.h);
        const cosH = Math.cos(half.h);
        const sinV = Math.sin(half.v);
        const cosV = Math.cos(half.v);
        // the camera in the octree's own space: its place and its three axes
        _inv.copy(inst.placement.node.getWorldTransform()).invert();
        _inv.transformPoint(cameraNode.getPosition(), _p);
        _inv.transformVector(cameraNode.forward, _f).normalize();
        _inv.transformVector(cameraNode.right, _r).normalize();
        _inv.transformVector(cameraNode.up, _u).normalize();
        const fw = cameraNode.forward;
        const rt = cameraNode.right;
        this.evalAxis = { x: fw.x, y: fw.y, z: fw.z };
        this.evalRight = { x: rt.x, y: rt.y, z: rt.z };
        // the frame as it will be `lead` degrees further along the present turn (world axis, taken into the octree's space)
        const lead = this.lead;
        this.evalLead = lead;
        const ahead = lead > 0;
        if (ahead) {
            const ax = _inv.transformVector(new Vec3(this.turnAxis.x, this.turnAxis.y, this.turnAxis.z), new Vec3()).normalize();
            const set = (v: Vec3, to: Vec3): void => {
                const t = turned(v, ax, lead);
                to.set(t.x, t.y, t.z);
            };
            set(_f, _pf);
            set(_r, _pr);
            set(_u, _pu);
        }
        const nodes = inst.octree.nodes;
        const infos = inst.nodeInfos;
        const px = _p.x, py = _p.y, pz = _p.z;
        let nIn = 0, nRing = 0, nOut = 0;
        const ring = p.ringDeg * D2R;
        for (let i = 0; i < nodes.length; i++) {
            const s = (nodes[i] as NodeLike).boundingSphere;
            const vx = s.x - px, vy = s.y - py, vz = s.z - pz;
            const r = s.w;
            const d2 = vx * vx + vy * vy + vz * vz;
            if (d2 <= r * r) {
                nIn++;
                continue;
            }
            const z = vx * _f.x + vy * _f.y + vz * _f.z;
            const x = Math.abs(vx * _r.x + vy * _r.y + vz * _r.z);
            const y = Math.abs(vx * _u.x + vy * _u.y + vz * _u.z);
            // touches the frame (its sphere reaches over both side planes): no trigonometry for most nodes
            if (z > -r && x * cosH - z * sinH <= r && y * cosV - z * sinV <= r) {
                nIn++;
                continue;
            }
            const d = Math.sqrt(d2);
            let e = outsideFrame(x, y, z, d, r, half.h, half.v);
            if (e > 0 && ahead) {
                const z2 = vx * _pf.x + vy * _pf.y + vz * _pf.z;
                const x2 = vx * _pr.x + vy * _pr.y + vz * _pr.z;
                const y2 = vx * _pu.x + vy * _pu.y + vz * _pu.z;
                const e2 = outsideFrame(x2, y2, z2, d, r, half.h, half.v);
                if (e2 < e) e = e2;
            }
            if (!(e > 0)) {
                nIn++;
                continue;
            }
            if (e < ring) nRing++;
            else nOut++;
            const k = viewFactor(e, p);
            (infos[i] as { worldDistanceSq: number }).worldDistanceSq *= k * k;
        }
        this.counts = { inFrame: nIn, ring: nRing, out: nOut };
    }

    /** The wrapper is on the engine's method, has not failed and is wanted. */
    get active(): boolean {
        return !!this.hook && this.hook.owner === this && !this.failed && this.enabled;
    }

    stats(): ViewLodStats {
        return {
            active: this.active,
            missing: [...this.missing],
            failed: this.failed,
            calls: this.calls,
            asked: this.asked,
            reordered: this.reordered,
            lastMs: Math.round(this.lastMs * 100) / 100,
            ...this.counts,
            turnDegS: Math.round(this.turnDegS),
            leadDeg: Math.round(this.lead)
        };
    }
}
