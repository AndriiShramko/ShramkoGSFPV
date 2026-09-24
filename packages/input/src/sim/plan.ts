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
