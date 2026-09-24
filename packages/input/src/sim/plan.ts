// Build a bot flight plan for a scene: validated spawn, a box that fits, and a wall to hit.
import type { ScenarioPlan } from './scenario';
import { boxAround } from './scenario';
import { findWall } from './bot';

export interface PlanCollision {
    querySphere(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean;
    queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): { x: number; y: number; z: number } | null;
}

export function headingOf(pos: number[], target: number[]): number {
    return (Math.atan2(target[0] - pos[0], -(target[2] - pos[2])) * 180) / Math.PI;
}

export function makePlan(
    col: PlanCollision,
    boundRadius: number,
    pos: number[],
    target: number[],
    dashSpeed: number,
    findSpawn?: (x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }) => boolean
): ScenarioPlan {
    const push = { x: 0, y: 0, z: 0 };
    const R = boundRadius + 0.03;
    let spawn: [number, number, number] = [pos[0], pos[1], pos[2]];
    if (col.querySphere(spawn[0], spawn[1], spawn[2], R, push) && findSpawn) {
        const out = { x: 0, y: 0, z: 0 };
        if (findSpawn(spawn[0], spawn[1], spawn[2], R, out)) spawn = [out.x, out.y, out.z];
    }
    let box = boxAround(spawn, 1.2);
    for (const size of [1.2, 0.8, 0.5, 0.3]) {
        box = boxAround(spawn, size);
        if (box.every((b) => !col.querySphere(b[0], b[1], b[2], R, push))) break;
    }
    const wall = findWall((ox, oy, oz, dx, dy, dz, m) => col.queryRay(ox, oy, oz, dx, dy, dz, m), spawn, 2.5, 8);
    return {
        spawn,
        spawnYawDeg: headingOf(pos, target),
        box,
        wallDir: wall ? wall.dir : null,
        wallYawDeg: wall ? wall.yawDeg : 0,
        dashSpeed
    };
}

/**
 * Cinematic tour: from the spawn, repeatedly take the longest free horizontal corridor (at least
 * `minLeg` m, ignoring the way back), fly 70 % of it, `legs` times; then aim at the closest wall.
 */
export function makeTourPlan(
    col: PlanCollision,
    boundRadius: number,
    pos: number[],
    target: number[],
    dashSpeed: number,
    legs = 4,
    minLeg = 2.5
): ScenarioPlan {
    const base = makePlan(col, boundRadius, pos, target, dashSpeed);
    const push = { x: 0, y: 0, z: 0 };
    const R = boundRadius + 0.08;
    const pts: [number, number, number][] = [];
    let p: [number, number, number] = [...base.spawn];
    let lastDir: [number, number] | null = null;
    for (let leg = 0; leg < legs; leg++) {
        let best: { d: number; dir: [number, number] } | null = null;
        for (let a = 0; a < 360; a += 10) {
            const r = (a * Math.PI) / 180;
            const dx = Math.sin(r), dz = -Math.cos(r);
            if (lastDir && dx * lastDir[0] + dz * lastDir[1] < -0.3) continue; // no U-turns
            const hit = col.queryRay(p[0], p[1], p[2], dx, 0, dz, 25);
            const d = hit ? Math.hypot(hit.x - p[0], hit.z - p[2]) : 25;
            if (d >= minLeg && (!best || d > best.d)) best = { d, dir: [dx, dz] };
        }
        if (!best) break;
        const len = Math.min(best.d * 0.7, 8);
        const next: [number, number, number] = [p[0] + best.dir[0] * len, p[1], p[2] + best.dir[1] * len];
        if (col.querySphere(next[0], next[1], next[2], R, push)) break;
        pts.push(next);
        p = next;
        lastDir = best.dir;
    }
    const wall = findWall((ox, oy, oz, dx, dy, dz, m) => col.queryRay(ox, oy, oz, dx, dy, dz, m), p, 2.5, 10);
    return { ...base, tour: pts, tourSpeed: 4, wallDir: wall ? wall.dir : base.wallDir, wallYawDeg: wall ? wall.yawDeg : base.wallYawDeg };
}
