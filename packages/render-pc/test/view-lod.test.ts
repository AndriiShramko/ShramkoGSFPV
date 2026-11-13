// The frame's priority in the choice of detail of a streamed scan (lane lod-view, docs/wip/lod-view.md): view-lod.ts.
// Held here, with no browser and no engine:
//   - the geometry: the frame's half angles from the camera's lens, how far a node's sphere lies outside the frame, and the
//     factor that makes of it (1 in the frame, a little in the ring, the full factor far out and behind);
//   - the turn: its axis and rate from two view axes, the look-ahead it gives, and its limits;
//   - the download order: files asked for nearest first instead of the engine's coarser-level-of-the-whole-scan first, with
//     the engine's own formula left to do the sum (control: the engine's order puts a far node's coarse file first);
//   - the wrapper on a stand-in for the engine's octree instance: the engine's own distances are kept for what touches the
//     frame and multiplied outside it; the look-ahead keeps the leading side sharp; a new choice is asked for when the view
//     has turned; a fault inside never reaches the engine and switches the wrapper off; dispose puts the method back.
// Controls that must fail a wrong rule: factors of 1 change nothing; switched off changes nothing; the trailing side of a
// turn is NOT kept; a turn below the refresh angle asks for nothing.
import { afterEach, describe, it, expect } from 'vitest';
import { Mat4, Vec3 } from 'playcanvas';
import type { AppBase, Entity } from 'playcanvas';
import { ENGINE_LOD_MULTIPLIER, MAX_LEAD_DEG, MIN_ASK_MS, TIER_PREFETCH, TIER_SWITCH, TIER_VISIBLE, TURN_MIN_DEG_S, VIEW_LOD_DEFAULTS, ViewLod, frameHalfAngles, leadDeg, nearFirstRank, outsideFrame, rampFor, turnOf, turned, viewFactor, viewLodMissing } from '../src/view-lod';

const D2R = Math.PI / 180;
const deg = (rad: number): number => rad / D2R;

describe('the frame, from the camera\'s lens', () => {
    it('a horizontal 115 degree lens on a 2.068 wide picture: 57.5 degrees to each side, about 37 up and down', () => {
        const f = frameHalfAngles(115, true, 2.068);
        expect(deg(f.h)).toBeCloseTo(57.5, 5);
        expect(deg(f.v)).toBeCloseTo(deg(Math.atan(Math.tan(57.5 * D2R) / 2.068)), 5);
        expect(deg(f.v)).toBeGreaterThan(36);
        expect(deg(f.v)).toBeLessThan(38);
    });

    it('a vertical 60 degree lens at 16:9: 30 up and down, about 45.7 to each side; a bad aspect ratio counts as square', () => {
        const f = frameHalfAngles(60, false, 16 / 9);
        expect(deg(f.v)).toBeCloseTo(30, 5);
        expect(deg(f.h)).toBeCloseTo(deg(Math.atan(Math.tan(30 * D2R) * 16 / 9)), 5);
        const sq = frameHalfAngles(60, false, 0);
        expect(deg(sq.h)).toBeCloseTo(30, 5);
        expect(deg(frameHalfAngles(60, false, Number.NaN).h)).toBeCloseTo(30, 5);
    });
});

describe('how far a node lies outside the frame', () => {
    const H = 57.5 * D2R;
    const V = 37 * D2R;
    /** a small sphere at `d` metres, `yaw` degrees to the right of the view axis and `pitch` degrees above it */
    const at = (yaw: number, pitch: number, d = 100, r = 0.001): number => {
        const y = Math.sin(pitch * D2R) * d;
        const flat = Math.cos(pitch * D2R) * d;
        return deg(outsideFrame(Math.sin(yaw * D2R) * flat, y, Math.cos(yaw * D2R) * flat, d, r, H, V));
    };

    it('inside the frame: nothing, to the right and the left alike', () => {
        expect(at(0, 0)).toBe(0);
        expect(at(50, 0)).toBe(0);
        expect(at(-50, 0)).toBe(0);
        expect(at(0, 30)).toBe(0);
        expect(at(0, -30)).toBe(0);
    });

    it('beside the frame: the angle beyond its edge', () => {
        expect(at(67.5, 0)).toBeCloseTo(10, 1);
        expect(at(-67.5, 0)).toBeCloseTo(10, 1);
        expect(at(90, 0)).toBeCloseTo(32.5, 1);
        expect(at(0, 57)).toBeCloseTo(20, 1);
    });

    it('beside AND above is further out than either alone; straight behind is far out', () => {
        const corner = at(75, 50);
        expect(corner).toBeGreaterThan(at(75, 0));
        expect(corner).toBeGreaterThan(at(0, 50));
        expect(at(180, 0)).toBeGreaterThan(120);
    });

    it('a node\'s size counts: a big sphere that reaches into the frame is in it, and the camera inside a node is in it', () => {
        // 10 degrees beyond the edge, but its radius covers 12 degrees
        expect(at(67.5, 0, 100, 100 * Math.sin(12 * D2R))).toBe(0);
        // the same place with a radius of 5 degrees: 5 degrees out
        expect(at(67.5, 0, 100, 100 * Math.sin(5 * D2R))).toBeCloseTo(5, 1);
        expect(deg(outsideFrame(0, 0, -5, 5, 6, H, V))).toBe(0);
    });
});

describe('the factor on a node\'s distance', () => {
    const p = rampFor(VIEW_LOD_DEFAULTS, ENGINE_LOD_MULTIPLIER);

    it('1 in the frame, growing through the ring to ringFactor, then smoothly to farFactor, where it stays', () => {
        expect(viewFactor(0, p)).toBe(1);
        expect(viewFactor(-1, p)).toBe(1);
        expect(viewFactor(p.ringDeg * D2R / 2, p)).toBeCloseTo(1 + (p.ringFactor - 1) / 2, 6);
        expect(viewFactor(p.ringDeg * D2R, p)).toBeCloseTo(p.ringFactor, 6);
        expect(viewFactor(p.farDeg * D2R, p)).toBeCloseTo(p.farFactor, 6);
        expect(viewFactor(170 * D2R, p)).toBe(p.farFactor);
    });

    it('never falls as a node goes further out, and has no jump at the ring\'s edge', () => {
        let last = 0;
        for (let a = 0; a <= 180; a += 0.5) {
            const k = viewFactor(a * D2R, p);
            expect(k).toBeGreaterThanOrEqual(last);
            last = k;
        }
        const edge = p.ringDeg * D2R;
        expect(Math.abs(viewFactor(edge + 1e-6, p) - viewFactor(edge - 1e-6, p))).toBeLessThan(1e-3);
    });

    it('a number that is not one (a broken node) leaves the distance alone', () => {
        expect(viewFactor(Number.NaN, p)).toBe(1);
    });

    it('the params are levels of detail: the factor is the scan\'s multiplier to that power, so the effect is the same at any multiplier', () => {
        expect(VIEW_LOD_DEFAULTS.ringLevels).toBe(0.5);
        expect(VIEW_LOD_DEFAULTS.farLevels).toBe(3);
        for (const m of [1.5, 2, 3]) {
            const r = rampFor(VIEW_LOD_DEFAULTS, m);
            expect(Math.log(r.ringFactor) / Math.log(m)).toBeCloseTo(0.5, 9);
            expect(Math.log(r.farFactor) / Math.log(m)).toBeCloseTo(3, 9);
        }
        expect(rampFor(VIEW_LOD_DEFAULTS, 2).farFactor).toBeCloseTo(8, 9);
        expect(rampFor(VIEW_LOD_DEFAULTS, 3).farFactor).toBeCloseTo(27, 9);
        // a multiplier that is none (missing, 1, not a number) is the engine\'s own 3
        for (const bad of [Number.NaN, 0, 1]) expect(rampFor(VIEW_LOD_DEFAULTS, bad).farFactor).toBeCloseTo(27, 9);
    });
});

describe('the turn and its look-ahead', () => {
    it('two view axes a quarter turn apart in a quarter of a second: 360 degrees a second about the axis between them', () => {
        const t = turnOf({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, 0.25);
        expect(t.degPerS).toBeCloseTo(360, 5);
        expect(t.axis.x).toBeCloseTo(0, 6);
        expect(t.axis.y).toBeCloseTo(1, 6);
        expect(t.axis.z).toBeCloseTo(0, 6);
    });

    it('turning the newer axis on about that axis continues the turn (not back)', () => {
        const prev = { x: 0, y: 0, z: 1 };
        const now = { x: Math.sin(10 * D2R), y: 0, z: Math.cos(10 * D2R) };
        const t = turnOf(prev, now, 0.1);
        const next = turned(now, t.axis, 20);
        expect(next.x).toBeCloseTo(Math.sin(30 * D2R), 6);
        expect(next.z).toBeCloseTo(Math.cos(30 * D2R), 6);
        // control: turning the other way goes back past the older axis
        expect(turned(now, t.axis, -20).x).toBeCloseTo(Math.sin(-10 * D2R), 6);
    });

    it('no turn, or no time: a rate of nothing', () => {
        expect(turnOf({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 0.1).degPerS).toBe(0);
        expect(turnOf({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, 0).degPerS).toBe(0);
    });

    it('the look-ahead is the rate times the time, nothing for a slow drift, and capped', () => {
        expect(leadDeg(200, 0.25)).toBeCloseTo(50, 6);
        expect(leadDeg(TURN_MIN_DEG_S - 1, 0.25)).toBe(0);
        expect(leadDeg(600, 0.25)).toBe(MAX_LEAD_DEG);
        expect(leadDeg(600, 0)).toBe(0);
    });
});

describe('the download order: nearest first', () => {
    /** the engine's own sum (requestFile) */
    const engine = (tier: number, level: number, rank: number, levels = 10): number => tier + (level + rank) / levels;

    it('control, the engine as it is: a far node\'s coarse file comes before a near node\'s fine one, and a near node\'s next level after everything', () => {
        const nearFine = engine(TIER_SWITCH, 0, 0.9);
        const farCoarse = engine(TIER_SWITCH, 9, 0.001);
        expect(farCoarse).toBeGreaterThan(nearFine);
        expect(engine(TIER_PREFETCH, 0, 0.9)).toBeLessThan(farCoarse);
    });

    it('asked with the near-first rank, the engine\'s own sum comes out as 1 + rank for a wanted level and for a next finer level alike, whatever the file\'s level', () => {
        for (const tier of [TIER_SWITCH, TIER_PREFETCH]) {
            for (const level of [0, 4, 9]) {
                for (const rank of [0.001, 0.25, 0.9]) {
                    expect(engine(tier, level, nearFirstRank(tier, rank, level, 10)), `tier ${tier} level ${level} rank ${rank}`).toBeCloseTo(1 + rank, 9);
                }
            }
        }
        // so: the near node\'s fine file before the far node\'s coarse one, and its next level no longer behind everything
        const nearFine = engine(TIER_SWITCH, 0, nearFirstRank(TIER_SWITCH, 0.9, 0, 10));
        const farCoarse = engine(TIER_SWITCH, 9, nearFirstRank(TIER_SWITCH, 0.001, 9, 10));
        expect(nearFine).toBeGreaterThan(farCoarse);
        expect(engine(TIER_PREFETCH, 0, nearFirstRank(TIER_PREFETCH, 0.9, 0, 10))).toBeGreaterThan(farCoarse);
    });

    it('a node that shows nothing keeps the engine\'s order (coarse first fills holes) and stays above everything else', () => {
        expect(nearFirstRank(TIER_VISIBLE, 0.5, 3, 10)).toBe(0.5);
        expect(engine(TIER_VISIBLE, 0, 0)).toBeGreaterThan(engine(TIER_SWITCH, 9, nearFirstRank(TIER_SWITCH, 1, 9, 10)));
    });

    it('a rank out of range stays inside its tier; a scan with no levels to read keeps the engine\'s rank', () => {
        expect(engine(TIER_SWITCH, 5, nearFirstRank(TIER_SWITCH, 7, 5, 10))).toBeLessThan(2);
        expect(engine(TIER_SWITCH, 5, nearFirstRank(TIER_SWITCH, -3, 5, 10))).toBeCloseTo(1, 9);
        expect(engine(TIER_SWITCH, 5, nearFirstRank(TIER_SWITCH, Number.NaN, 5, 10))).toBeCloseTo(1, 9);
        expect(nearFirstRank(TIER_SWITCH, 0.5, 5, 0)).toBe(0.5);
        expect(nearFirstRank(TIER_SWITCH, 0.5, Number.NaN, 10)).toBe(0.5);
    });
});

// ---- a stand-in for the engine: one octree instance whose own method writes plain squared distances ----

interface FakeNode {
    boundingSphere: { x: number; y: number; z: number; w: number };
}
class FakeInstance {
    octree: { nodes: FakeNode[]; lodLevels: number; files: { lodLevel: number }[] };
    /** file index -> the priority the engine's formula gave it (the highest asked) */
    requests = new Map<number, number>();
    nodeInfos: { worldDistanceSq: number }[];
    placement: { node: { getWorldTransform(): Mat4 }; lodMultiplier?: number } = { node: { getWorldTransform: (): Mat4 => new Mat4() } };
    engineCalls = 0;
    constructor(nodes: FakeNode[]) {
        // ten levels; file k holds level k (0 the finest, 9 the coarsest)
        this.octree = { nodes, lodLevels: 10, files: Array.from({ length: 10 }, (_, k) => ({ lodLevel: k })) };
        this.nodeInfos = nodes.map(() => ({ worldDistanceSq: 0 }));
    }
    /** the engine's request (gsplat-octree-instance.js requestFile): tier, then the file's level, then the rank */
    requestFile(fileIndex: number, tier: number, distanceRank: number): boolean {
        const priority = tier + ((this.octree.files[fileIndex] as { lodLevel: number }).lodLevel + distanceRank) / this.octree.lodLevels;
        const current = this.requests.get(fileIndex);
        if (current === undefined || priority > current) this.requests.set(fileIndex, priority);
        return false;
    }
    /** the engine's part: the squared distance from the camera to each node's centre */
    evaluateNodeDistances(cameraNode: Entity, _params: unknown): void {
        this.engineCalls++;
        const p = cameraNode.getPosition();
        this.octree.nodes.forEach((n, i) => {
            const s = n.boundingSphere;
            (this.nodeInfos[i] as { worldDistanceSq: number }).worldDistanceSq = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
        });
    }
}

/** A camera at the origin looking along +z by default, a horizontal 115 degree lens on a 2:1 picture. */
function fakeCamera(yawDeg = 0): Entity & { yaw(d: number): void; roll(d: number): void } {
    const cam = {
        camera: { fov: 115, horizontalFov: true, aspectRatio: 2 },
        forward: new Vec3(0, 0, 1),
        right: new Vec3(1, 0, 0),
        up: new Vec3(0, 1, 0),
        getPosition: (): Vec3 => new Vec3(0, 0, 0),
        yaw(d: number): void {
            cam.forward.set(Math.sin(d * D2R), 0, Math.cos(d * D2R));
            cam.right.set(Math.cos(d * D2R), 0, -Math.sin(d * D2R));
        },
        /** rolled `d` degrees about a view axis along +z */
        roll(d: number): void {
            cam.right.set(Math.cos(d * D2R), Math.sin(d * D2R), 0);
            cam.up.set(-Math.sin(d * D2R), Math.cos(d * D2R), 0);
        }
    };
    cam.yaw(yawDeg);
    return cam as unknown as Entity & { yaw(d: number): void; roll(d: number): void };
}

function fakeApp(inst: FakeInstance | null): { app: AppBase; world: { _octreeInstances: Map<number, FakeInstance>; _lodUpdateRequested: boolean; marked: number; markInstancesNeedLodUpdate(): void } } {
    const world = {
        _octreeInstances: new Map<number, FakeInstance>(inst ? [[1, inst]] : []),
        _lodUpdateRequested: false,
        marked: 0,
        markInstancesNeedLodUpdate(): void {
            world.marked++;
        }
    };
    const app = { renderer: { gsplatDirector: { camerasMap: new Map([[1, { layersMap: new Map([[1, { gsplatManager: { world } }]]) }]]) } } };
    return { app: app as unknown as AppBase, world };
}

/** a small node `d` metres away, `yaw` degrees to the right of +z */
const node = (yaw: number, d = 100, r = 1): FakeNode => ({ boundingSphere: { x: Math.sin(yaw * D2R) * d, y: 0, z: Math.cos(yaw * D2R) * d, w: r } });

/** The stand-in's own method, as written above: every test leaves the class as it found it, whatever it did. */
const ENGINE_METHOD = FakeInstance.prototype.evaluateNodeDistances;
const ENGINE_REQUEST = FakeInstance.prototype.requestFile;

describe('the wrapper on the engine\'s choice of detail', () => {
    afterEach(() => {
        FakeInstance.prototype.evaluateNodeDistances = ENGINE_METHOD;
        FakeInstance.prototype.requestFile = ENGINE_REQUEST;
        delete (FakeInstance.prototype as unknown as { __gsfpvViewLod?: unknown }).__gsfpvViewLod;
    });
    const NODES = [node(0), node(40), node(70), node(100), node(180)];
    const params = { ...VIEW_LOD_DEFAULTS, predictS: 0 };
    const ramp = rampFor(params, ENGINE_LOD_MULTIPLIER);
    /** what the factor should be for NODES[i] as seen from a camera looking `yaw` degrees right of +z */
    const expected = (i: number, yaw = 0): number => {
        const s = (NODES[i] as FakeNode).boundingSphere;
        const f = frameHalfAngles(115, true, 2);
        const x = s.x * Math.cos(yaw * D2R) - s.z * Math.sin(yaw * D2R);
        const z = s.x * Math.sin(yaw * D2R) + s.z * Math.cos(yaw * D2R);
        return viewFactor(outsideFrame(x, 0, z, 100, s.w, f.h, f.v), ramp);
    };

    it('says what is missing: no gsplat director, no streamed scan yet, an engine without the method', () => {
        expect(viewLodMissing({ renderer: {} } as unknown as AppBase)).toEqual(['gsplatDirector']);
        expect(viewLodMissing(fakeApp(null).app)).toEqual(['no streamed scan yet']);
        const broken = { octree: { nodes: [node(0)] }, nodeInfos: [{ worldDistanceSq: 0 }], placement: { node: { getWorldTransform: (): Mat4 => new Mat4() } } };
        expect(viewLodMissing(fakeApp(broken as unknown as FakeInstance).app)).toContain('evaluateNodeDistances');
        expect(viewLodMissing(fakeApp(new FakeInstance(NODES)).app)).toEqual([]);
    });

    it('keeps the engine\'s distance for what touches the frame and multiplies it outside: the ring a little, far out and behind by the full factor', () => {
        const inst = new FakeInstance(NODES);
        const { app } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        expect(v.install()).toBe(true);
        expect(v.active).toBe(true);
        inst.evaluateNodeDistances(cam, {});
        const d2 = inst.nodeInfos.map((n) => n.worldDistanceSq);
        // straight ahead and 40 degrees to the side: in the frame (57.5), the engine's own 100 m squared
        expect(d2[0]).toBeCloseTo(10000, 3);
        expect(d2[1]).toBeCloseTo(10000, 3);
        // 70 degrees: in the ring; 100 degrees: beyond it; behind: the full factor
        for (const i of [2, 3, 4]) expect(d2[i], `node ${i}`).toBeCloseTo(10000 * expected(i) ** 2, 3);
        expect(expected(2)).toBeGreaterThan(1);
        expect(expected(2)).toBeLessThan(ramp.ringFactor);
        expect(expected(3)).toBeGreaterThan(ramp.ringFactor);
        expect(expected(4)).toBe(ramp.farFactor);
        expect(inst.engineCalls).toBe(1);
        const s = v.stats();
        expect(s).toMatchObject({ active: true, failed: null, calls: 1, inFrame: 2, ring: 1, out: 2 });
        v.dispose();
    });

    it('controls: no levels to lose (factors of 1) change nothing, and switched off changes nothing (the engine\'s numbers come through)', () => {
        for (const make of [
            (app: AppBase, cam: Entity): ViewLod => new ViewLod(app, cam, { ...params, ringLevels: 0, farLevels: 0 }),
            (app: AppBase, cam: Entity): ViewLod => { const v = new ViewLod(app, cam, params); v.enabled = false; return v; }
        ]) {
            const inst = new FakeInstance(NODES);
            const { app } = fakeApp(inst);
            const cam = fakeCamera();
            const v = make(app, cam);
            v.install();
            inst.evaluateNodeDistances(cam, {});
            for (const n of inst.nodeInfos) expect(n.worldDistanceSq).toBeCloseTo(10000, 3);
            v.dispose();
        }
    });

    it('the frame follows the camera: turned 100 degrees, the node that was far out is in the frame and the one ahead is out', () => {
        const inst = new FakeInstance(NODES);
        const { app } = fakeApp(inst);
        const cam = fakeCamera(100);
        const v = new ViewLod(app, cam, params);
        v.install();
        inst.evaluateNodeDistances(cam, {});
        expect((inst.nodeInfos[3] as { worldDistanceSq: number }).worldDistanceSq).toBeCloseTo(10000, 3);
        expect((inst.nodeInfos[0] as { worldDistanceSq: number }).worldDistanceSq).toBeCloseTo(10000 * expected(0, 100) ** 2, 3);
        expect(expected(0, 100)).toBeGreaterThan(ramp.ringFactor);
        v.dispose();
    });

    it('asks the engine for a new choice once the view has turned past the refresh angle, and not before (control)', () => {
        const inst = new FakeInstance(NODES);
        const { app, world } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        v.tick(0);
        inst.evaluateNodeDistances(cam, {});
        // a turn smaller than the refresh angle: nothing asked
        cam.yaw(params.refreshDeg - 1);
        v.tick(100);
        expect(world._lodUpdateRequested).toBe(false);
        expect(world.marked).toBe(0);
        // past it: asked
        cam.yaw(params.refreshDeg + 1);
        v.tick(200);
        expect(world._lodUpdateRequested).toBe(true);
        expect(world.marked).toBe(1);
        expect(v.stats().asked).toBe(1);
        // the engine chooses again: from then on the new axis is the one to leave
        world._lodUpdateRequested = false;
        inst.evaluateNodeDistances(cam, {});
        v.tick(300);
        expect(world._lodUpdateRequested).toBe(false);
        v.dispose();
    });

    it('the factor comes from the scan\'s own multiplier: at 2 a node behind is 2 to the 3rd further, at the engine\'s 3 it is 27 times', () => {
        for (const [m, factor] of [[2, 8], [undefined, 27]] as const) {
            const inst = new FakeInstance(NODES);
            if (m !== undefined) inst.placement.lodMultiplier = m;
            const { app } = fakeApp(inst);
            const cam = fakeCamera();
            const v = new ViewLod(app, cam, params);
            v.install();
            inst.evaluateNodeDistances(cam, {});
            expect((inst.nodeInfos[4] as { worldDistanceSq: number }).worldDistanceSq, `multiplier ${m}`).toBeCloseTo(10000 * factor * factor, 2);
            v.dispose();
        }
    });

    it('a roll about the view axis asks for a new choice too (the frame turns although its axis stays), a small one does not (control)', () => {
        const inst = new FakeInstance(NODES);
        const { app, world } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        v.tick(0);
        inst.evaluateNodeDistances(cam, {});
        cam.roll(params.refreshDeg);
        v.tick(100);
        expect(world.marked).toBe(0);
        cam.roll(2 * params.refreshDeg + 1);
        v.tick(200);
        expect(world.marked).toBe(1);
        v.dispose();
    });

    it('asks at most every MIN_ASK_MS however fast the view turns: the second ask waits for its time', () => {
        const inst = new FakeInstance(NODES);
        const { app, world } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        v.tick(0);
        inst.evaluateNodeDistances(cam, {});
        cam.yaw(20);
        v.tick(10);
        expect(world.marked).toBe(1);
        // the engine has chosen for the new view; the view runs on at once
        inst.evaluateNodeDistances(cam, {});
        cam.yaw(40);
        v.tick(20);
        expect(world.marked).toBe(1);
        v.tick(10 + MIN_ASK_MS);
        expect(world.marked).toBe(2);
        v.dispose();
    });

    it('while the view turns, the side it turns toward is kept as if in the frame, the side it leaves is not (control)', () => {
        const ahead = new FakeInstance([node(80), node(-80)]);
        const { app } = fakeApp(ahead);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, { ...VIEW_LOD_DEFAULTS, predictS: 0.25 });
        // turning right at about 200 degrees a second: 2 degrees every 10 ms, for long enough to be believed
        let yaw = 0;
        for (let t = 0; t <= 200; t += 10) {
            cam.yaw(yaw);
            v.tick(t);
            yaw += 2;
        }
        const s = v.stats();
        expect(s.turnDegS).toBeGreaterThan(150);
        expect(s.leadDeg).toBeGreaterThan(35);
        ahead.evaluateNodeDistances(cam, {});
        const lead = (ahead.nodeInfos[0] as { worldDistanceSq: number }).worldDistanceSq;
        const trail = (ahead.nodeInfos[1] as { worldDistanceSq: number }).worldDistanceSq;
        // the node on the right, where the view will be: the engine's own distance; the one on the left: pushed away
        expect(lead).toBeCloseTo(10000, 3);
        expect(trail).toBeGreaterThan(10000 * 1.5);
        // control: the same view standing still pushes both sides away alike
        const still = new FakeInstance([node(80 + (yaw - 2)), node(-80 + (yaw - 2))]);
        const b = fakeApp(still);
        const cam2 = fakeCamera(yaw - 2);
        const v2 = new ViewLod(b.app, cam2, { ...VIEW_LOD_DEFAULTS, predictS: 0.25 });
        v.dispose();
        v2.install();
        still.evaluateNodeDistances(cam2, {});
        expect((still.nodeInfos[0] as { worldDistanceSq: number }).worldDistanceSq).toBeGreaterThan(10000 * 1.02);
        expect((still.nodeInfos[0] as { worldDistanceSq: number }).worldDistanceSq).toBeCloseTo((still.nodeInfos[1] as { worldDistanceSq: number }).worldDistanceSq, 3);
        v2.dispose();
    });

    it('a fault in the frame\'s part never reaches the engine: no throw, the wrapper off for good and saying why, the engine\'s distances untouched for the nodes after it', () => {
        const inst = new FakeInstance([node(0), node(100), node(180)]);
        const { app } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        v.install();
        // the engine's part still works (it reads the sphere before it goes), the frame's part meets a node without one
        const nodes = inst.octree.nodes as unknown as { boundingSphere: unknown }[];
        const sphere = (nodes[1] as { boundingSphere: unknown }).boundingSphere;
        // (the second read of all is the frame's part of the first call: only that one finds nothing)
        let reads = 0;
        Object.defineProperty(nodes[1], 'boundingSphere', { get: () => (reads++ === 1 ? null : sphere) });
        expect(() => inst.evaluateNodeDistances(cam, {})).not.toThrow();
        expect(v.stats().failed).not.toBeNull();
        expect(v.active).toBe(false);
        // the node behind was never reached: its distance is the engine's own
        expect((inst.nodeInfos[2] as { worldDistanceSq: number }).worldDistanceSq).toBeCloseTo(10000, 3);
        // and from now on the wrapper only calls through
        expect(() => inst.evaluateNodeDistances(cam, {})).not.toThrow();
        expect(v.install()).toBe(false);
        v.dispose();
    });

    it('files are asked for nearest first through the engine\'s own request; switched off, or with nearFirst off, the engine\'s order comes through (controls)', () => {
        const ask = (inst: FakeInstance): { nearFine: number; farCoarse: number; nearNext: number; hole: number } => {
            inst.requests.clear();
            inst.requestFile(0, TIER_SWITCH, 0.9);
            inst.requestFile(9, TIER_SWITCH, 0.001);
            inst.requestFile(1, TIER_PREFETCH, 0.9);
            inst.requestFile(8, TIER_VISIBLE, 0.2);
            return { nearFine: inst.requests.get(0) as number, farCoarse: inst.requests.get(9) as number, nearNext: inst.requests.get(1) as number, hole: inst.requests.get(8) as number };
        };
        const inst = new FakeInstance(NODES);
        const { app } = fakeApp(inst);
        const cam = fakeCamera();
        const v = new ViewLod(app, cam, params);
        v.install();
        const on = ask(inst);
        expect(on.nearFine).toBeCloseTo(1.9, 9);
        expect(on.farCoarse).toBeCloseTo(1.001, 9);
        expect(on.nearNext).toBeCloseTo(1.9, 9);
        expect(on.hole).toBeCloseTo(2 + 8.2 / 10, 9);
        expect(v.stats().reordered).toBe(4);
        // switched off: the engine's own sums
        v.enabled = false;
        const off = ask(inst);
        expect(off.nearFine).toBeCloseTo(1 + 0.9 / 10, 9);
        expect(off.farCoarse).toBeCloseTo(1 + 9.001 / 10, 9);
        expect(off.nearNext).toBeCloseTo(1.9 / 10, 9);
        expect(off.farCoarse).toBeGreaterThan(off.nearFine);
        v.dispose();
        expect(FakeInstance.prototype.requestFile).toBe(ENGINE_REQUEST);
        // nearFirst off: the frame's priority without the order
        const inst2 = new FakeInstance(NODES);
        const b = fakeApp(inst2);
        const v2 = new ViewLod(b.app, cam, { ...params, nearFirst: false });
        v2.install();
        expect(ask(inst2).farCoarse).toBeCloseTo(1 + 9.001 / 10, 9);
        expect(v2.stats().reordered).toBe(0);
        v2.dispose();
    });

    it('dispose puts the engine\'s own method back, and a second ViewLod can take the wrapper over', () => {
        const orig = FakeInstance.prototype.evaluateNodeDistances;
        const inst = new FakeInstance(NODES);
        const { app } = fakeApp(inst);
        const cam = fakeCamera();
        const a = new ViewLod(app, cam, params);
        a.install();
        expect(FakeInstance.prototype.evaluateNodeDistances).not.toBe(orig);
        // (far out by a factor of 4 at the engine's multiplier 3)
        const b = new ViewLod(app, cam, { ...params, farLevels: Math.log(4) / Math.log(3) });
        b.install();
        expect(a.active).toBe(false);
        expect(b.active).toBe(true);
        inst.evaluateNodeDistances(cam, {});
        expect((inst.nodeInfos[4] as { worldDistanceSq: number }).worldDistanceSq).toBeCloseTo(10000 * 16, 3);
        a.dispose();
        expect(b.active).toBe(true);
        b.dispose();
        expect(FakeInstance.prototype.evaluateNodeDistances).toBe(orig);
    });
});
