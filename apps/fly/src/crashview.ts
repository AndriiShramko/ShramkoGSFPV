// What the pilot sees after a crash. The FPV camera never tumbles with the wreck (a camera
// spinning 15 turns a second is both nauseating and a flash hazard); instead a chase camera behind
// the impact follows the tumbling craft and its debris smoothly. Rapier supplies the tumble and
// the debris when it is loaded; otherwise the simulator's own tumble drives the craft model.

import { S } from '@gsfpv/sim-core';
import type { SimEvent } from '@gsfpv/sim-core';
import { CrashScene, loadRapier } from '@gsfpv/crash';
import type { Entity } from 'playcanvas';
import type { FlightSession } from './session';

export type CrashEngine = 'rapier' | 'sim-core';

export interface CrashInfo {
    speed: number;
    tick: number;
    engine: CrashEngine;
    debris: number;
    maxAngularSpeed: number;
    staticBoxes: number;
}

export class CrashView {
    private s: FlightSession;
    private scene: CrashScene | null = null;
    private craft: Entity | null = null;
    private debris: Entity[] = [];
    active = false;
    info: CrashInfo | null = null;
    private cam = { x: 0, y: 0, z: 0 };
    private look = { x: 0, y: 0, z: 0 };
    private lastT = 0;
    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    onSettled: (() => void) | null = null;
    private settledFired = false;
    private preCam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
    rapierReady = false;

    constructor(s: FlightSession) {
        this.s = s;
        // warm up Rapier in the background so the first crash has it
        loadRapier().then((r) => { this.rapierReady = !!r; });
    }

    /** Remember where the pilot's camera was just before the impact. */
    trackCamera(): void {
        if (this.active) return;
        const st = this.s.sim.s;
        const vx = st[S.vx], vy = st[S.vy], vz = st[S.vz];
        const v = Math.hypot(vx, vy, vz);
        this.preCam = { x: st[S.px], y: st[S.py], z: st[S.pz], fx: v > 0.3 ? vx / v : 0, fy: v > 0.3 ? vy / v : 0, fz: v > 0.3 ? vz / v : -1 };
    }

    async onCrash(e: Extract<SimEvent, { type: 'crash' }>): Promise<void> {
        const s = this.s;
        const st = s.sim.s;
        this.active = true;
        this.settledFired = false;
        const p = s.params;
        this.craft = s.renderer.createCraftModel(p.spheres[0] || 0.033, p.spheres[3] || 0.03);
        // chase camera: behind the impact along the flight direction, a little up, inside free space
        const back = 0.45;
        let cx = this.preCam.x - this.preCam.fx * back, cy = this.preCam.y - this.preCam.fy * back + 0.12, cz = this.preCam.z - this.preCam.fz * back;
        const col = s.collision;
        if (col) {
            const push = { x: 0, y: 0, z: 0 };
            for (let i = 0; i < 6 && col.querySphere(cx, cy, cz, 0.06, push); i++) { cx += push.x; cy += push.y; cz += push.z; }
        }
        this.cam = { x: cx, y: cy, z: cz };
        this.look = { x: st[S.px], y: st[S.py], z: st[S.pz] };
        this.info = { speed: e.speed, tick: e.tick, engine: 'sim-core', debris: 0, maxAngularSpeed: 0, staticBoxes: 0 };
        const R = this.rapierReady ? await loadRapier() : null;
        if (R && col && this.active) {
            // world angular velocity from body angular velocity
            const qw = st[S.qw], qx = st[S.qx], qy = st[S.qy], qz = st[S.qz];
            const bx = st[S.wx], by = st[S.wy], bz = st[S.wz];
            const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
            const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
            const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
            this.scene = new CrashScene(R, col, {
                p: [st[S.px], st[S.py], st[S.pz]],
                q: [qw, qx, qy, qz],
                v: [st[S.vx], st[S.vy], st[S.vz]],
                w: [r00 * bx + r01 * by + r02 * bz, r10 * bx + r11 * by + r12 * bz, r20 * bx + r21 * by + r22 * bz],
                mass: p.mass,
                ductOffset: p.spheres[0] || 0.033,
                ductRadius: p.spheres[3] || 0.03,
                bodyRadius: p.spheres.length >= 20 ? p.spheres[19] : 0.025,
                impact: [e.px, e.py, e.pz],
                normal: [e.nx, e.ny, e.nz],
                seed: e.tick
            }, p.gravity);
            this.info.engine = 'rapier';
            this.info.debris = this.scene.debrisCount;
            this.info.staticBoxes = this.scene.staticBoxes;
            for (const pc of this.scene.pieces()) if (pc.kind === 'debris') this.debris.push(s.renderer.addBox(pc.size[0], pc.size[1], pc.size[2], [0.9, 0.9, 0.92]));
        }
        this.lastT = performance.now();
    }

    /** Per frame while a crash is active: advance the tumble and place the chase camera. */
    frame(now: number): void {
        if (!this.active || !this.craft) return;
        const dt = Math.min(0.1, (now - this.lastT) / 1000);
        this.lastT = now;
        const r = this.s.renderer;
        let tx: number, ty: number, tz: number;
        if (this.scene) {
            this.scene.advance(dt);
            const pcs = this.scene.pieces();
            const c = pcs[0];
            r.setEntityPose(this.craft, c.p[0], c.p[1], c.p[2], c.q[0], c.q[1], c.q[2], c.q[3]);
            for (let i = 1; i < pcs.length; i++) r.setEntityPose(this.debris[i - 1], pcs[i].p[0], pcs[i].p[1], pcs[i].p[2], pcs[i].q[0], pcs[i].q[1], pcs[i].q[2], pcs[i].q[3]);
            [tx, ty, tz] = c.p;
            if (this.info) this.info.maxAngularSpeed = Math.max(this.info.maxAngularSpeed, this.scene.craftAngularSpeed());
            if (this.scene.done && !this.settledFired) { this.settledFired = true; this.onSettled?.(); }
        } else {
            const st = this.s.sim.s;
            r.setEntityPose(this.craft, st[S.px], st[S.py], st[S.pz], st[S.qw], st[S.qx], st[S.qy], st[S.qz]);
            tx = st[S.px]; ty = st[S.py]; tz = st[S.pz];
            if (this.info) this.info.maxAngularSpeed = Math.max(this.info.maxAngularSpeed, Math.hypot(st[S.wx], st[S.wy], st[S.wz]));
            if (st[S.crashed] === 2 && !this.settledFired) { this.settledFired = true; this.onSettled?.(); }
        }
        // smooth look-at (critically damped, ~250 ms) so the image never jumps between frames
        const k = this.reducedMotion ? 0.02 : 1 - Math.exp(-dt / 0.25);
        this.look.x += (tx - this.look.x) * k;
        this.look.y += (ty - this.look.y) * k;
        this.look.z += (tz - this.look.z) * k;
        r.setCameraLookAt(this.cam.x, this.cam.y, this.cam.z, this.look.x, this.look.y, this.look.z);
    }

    clear(): void {
        this.active = false;
        this.scene?.free();
        this.scene = null;
        this.s.renderer.clearDebris();
        this.craft = null;
        this.debris = [];
    }
}
