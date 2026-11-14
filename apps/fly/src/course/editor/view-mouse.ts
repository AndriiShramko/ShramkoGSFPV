// The edit mode's mouse, camera keys and handles on the page (lane editor3, stage E2, docs/wip/editor3.md "The design"). The
// owner's words of message 51: "I clicked an obstacle and the X, Y, Z appeared on it: move, rotate and scale, all with the
// mouse", "move around the scene with the usual W A S D, up, down". The math is pure and tested (fly-cam.ts, pick.ts,
// drag.ts); this file only binds it to the canvas, the keys and PlayCanvas's gizmos. The mouse stays free in this mode: the
// editor's window is one of mouse-look.ts CURSOR_WINDOWS, so no pointer lock is held.
import { Entity, Gizmo, Quat as PcQuat, RotateGizmo, ScaleGizmo, TranslateGizmo, Vec3 as PcVec3 } from 'playcanvas';
import type { AppBase, CameraComponent, Layer } from 'playcanvas';
import { CAM_KEYS, camForward, camTarget, stepCam, turnCam, wheelSpeed, type FlyCam } from './fly-cam';
import { fromPcQuat, toPcQuat, type FlownPose } from './drag';
import { pickGate, rayThrough, type Pickable, type Ray } from './pick';

/** a press that moves less than this before it is let go is a click, px (an estimate) */
export const CLICK_SLOP_PX = 4;
/** the handles' snaps: 0.1 flown m, 15 degrees, a tenth of the opening (The design); Ctrl held drags free */
export const SNAP_MOVE_M = 0.1;
export const SNAP_TURN_DEG = 15;
export const SNAP_SCALE = 0.1;

export interface EditViewHost {
    readonly app: AppBase;
    readonly camera: Entity;
    /** the gates as drawn now, flown frame (course order) */
    gates(): readonly Pickable[];
    /** the camera moved: put the renderer's camera there */
    onCamera(eye: readonly [number, number, number], at: readonly [number, number, number]): void;
    /** a click took gate `index` */
    onPick(index: number): void;
    /** lane editor3 E3: with Add gate armed, a click on the scene: the ray through it, flown frame */
    onPlace?(ray: Ray): void;
    /** a handle is being dragged (`end` false) or was let go (`end` true): the stand-in's pose, flown frame */
    onDrag(pose: FlownPose, end: boolean): void;
    /** the wheel set the camera speed (m/s) */
    onSpeed(speed: number): void;
    /** a key press goes to a text field (the camera keys are left to it) */
    typing(target: EventTarget | null): boolean;
}

type Handle = TranslateGizmo | RotateGizmo | ScaleGizmo;

export class EditView {
    cam: FlyCam;
    private readonly host: EditViewHost;
    private readonly canvas: HTMLCanvasElement;
    private readonly held = new Set<string>();
    private fast = false;
    private readonly layer: Layer;
    private readonly stand: Entity;
    private readonly handles: Handle[];
    private openingAtStart = 0;
    /** the selected gate's opening, flown m (the scale handle's factor multiplies it) */
    private opening = 0;
    private dragging = false;
    /** a handle was dragged during this press (its release is not a click) */
    private dragged = false;
    private press: { id: number; button: number; x: number; y: number; look: boolean } | null = null;
    private disposed = false;
    /** lane editor3 E3: Add gate armed, the next click on the scene places a gate */
    adding = false;
    /** lane editor3 E3: the drone flies (armed): no handles, no camera keys, no clicks; the camera is the drone's */
    private suspended = false;
    private standPose: FlownPose | null = null;

    constructor(host: EditViewHost, start: FlyCam) {
        this.host = host;
        this.cam = start;
        this.canvas = host.app.graphicsDevice.canvas as HTMLCanvasElement;
        const cc = host.camera.camera as CameraComponent;
        this.layer = Gizmo.createLayer(host.app);
        cc.layers = cc.layers.concat(this.layer.id);
        this.stand = new Entity('course-edit-stand', host.app);
        host.app.root.addChild(this.stand);
        const move = new TranslateGizmo(cc, this.layer);
        const turn = new RotateGizmo(cc, this.layer);
        const size = new ScaleGizmo(cc, this.layer);
        move.coordSpace = 'local';
        turn.coordSpace = 'local';
        size.coordSpace = 'local';
        move.snapIncrement = SNAP_MOVE_M;
        turn.snapIncrement = SNAP_TURN_DEG;
        size.snapIncrement = SNAP_SCALE;
        // a gate's size is one number (its opening): only the centre box of the scale handle, uniform
        size.uniform = true;
        for (const a of ['x', 'y', 'z', 'yz', 'xz', 'xy'] as const) size.enableShape(a, false);
        // the centre belongs to the scale box: the move handle keeps its arrows and planes, the turn handle its three rings
        // PlayCanvas 2.23.2 shape names (build/playcanvas.mjs _shapes): the move handle's centre is the sphere 'xyz' (it took
        // the centre drag from the scale box in the smoke probe of E2 pass 2), the turn handle's are 'face' (f) and 'xyz'
        move.enableShape('xyz', false);
        turn.enableShape('face', false);
        turn.enableShape('xyz', false);
        turn.size = 1.5;
        this.handles = [move, turn, size];
        for (const h of this.handles) {
            h.snap = true;
            h.on('transform:start', () => {
                this.dragging = true;
                this.dragged = true;
                this.openingAtStart = this.opening;
            });
            h.on('transform:move', () => host.onDrag(this.pose(this.openingAtStart), false));
            h.on('transform:end', () => {
                // the drag is over before the course takes it, so put() of the new gate places the stand-in again
                this.dragging = false;
                host.onDrag(this.pose(this.openingAtStart), true);
            });
        }
        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('contextmenu', this.onMenu);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onUp);
        window.addEventListener('keydown', this.onKey, true);
        window.addEventListener('keyup', this.onKeyUp, true);
        window.addEventListener('blur', this.onBlur);
        host.app.on('update', this.onUpdate);
        this.apply();
    }

    /** The stand-in at the selected gate (null: no gate, the handles hidden). Not while a drag holds it. */
    put(p: FlownPose | null): void {
        if (this.dragging) return;
        this.standPose = p;
        if (!p || this.suspended) {
            for (const h of this.handles) h.detach();
            return;
        }
        const q = toPcQuat(p.quat);
        this.stand.setPosition(p.pos[0], p.pos[1], p.pos[2]);
        this.stand.setRotation(new PcQuat(q[0], q[1], q[2], q[3]));
        this.stand.setLocalScale(1, 1, 1);
        this.opening = p.opening;
        for (const h of this.handles) h.attach([this.stand]);
    }

    /** The drone flies (true): the handles go and the keys and the mouse are left to the flight; false: back where it was. */
    suspend(on: boolean): void {
        if (on === this.suspended) return;
        this.suspended = on;
        this.held.clear();
        this.press = null;
        this.adding = false;
        if (on) for (const h of this.handles) h.detach();
        else {
            this.put(this.standPose);
            this.apply();
        }
    }

    /** The camera put somewhere (a key selected a gate: the view goes to it). */
    setCam(c: FlyCam): void {
        this.cam = c;
        this.apply();
    }

    /** the stand-in's pose; the scale handle's factor times `opening` is the new opening */
    private pose(opening: number): FlownPose {
        const p = this.stand.getPosition();
        const r = this.stand.getRotation();
        const k = this.stand.getLocalScale().x;
        return { pos: [p.x, p.y, p.z], quat: fromPcQuat(r.x, r.y, r.z, r.w), opening: opening * (k > 0 ? k : 1) };
    }

    private apply(): void {
        this.host.onCamera(this.cam.pos, camTarget(this.cam));
    }

    private onUpdate = (dt: number): void => {
        if (this.held.size === 0 || this.suspended) return;
        const next = stepCam(this.cam, this.held, this.fast, dt);
        if (next !== this.cam) {
            this.cam = next;
            this.apply();
        }
    };

    private onDown = (e: PointerEvent): void => {
        if (this.suspended || (e.button !== 0 && e.button !== 2)) return;
        // a press on a handle is the gizmo's (it fired transform:start in its own pointerdown, or will on the first move)
        this.press = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, look: e.button === 2 };
        if (e.button === 2) e.preventDefault();
    };

    private onPointerMove = (e: PointerEvent): void => {
        const p = this.press;
        if (!p || p.id !== e.pointerId || this.dragging) return;
        if (!p.look && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.look = true;
        if (!p.look) return;
        this.cam = turnCam(this.cam, e.movementX, e.movementY);
        this.apply();
    };

    private onUp = (e: PointerEvent): void => {
        const p = this.press;
        if (!p || p.id !== e.pointerId) return;
        this.press = null;
        const wasDrag = this.dragging || this.dragged;
        this.dragging = false;
        this.dragged = false;
        if (wasDrag || p.look || p.button !== 0) return;
        const r = this.canvas.getBoundingClientRect();
        const cc = this.host.camera.camera as CameraComponent;
        const far = cc.screenToWorld(e.clientX - r.left, e.clientY - r.top, cc.farClip, new PcVec3());
        const eye = this.host.camera.getPosition();
        const ray = rayThrough([eye.x, eye.y, eye.z], [far.x, far.y, far.z]);
        if (!ray) return;
        if (this.adding && this.host.onPlace) {
            this.adding = false;
            return this.host.onPlace(ray);
        }
        const i = pickGate(ray, this.host.gates());
        if (i >= 0) this.host.onPick(i);
    };

    private onMenu = (e: Event): void => e.preventDefault();

    private onWheel = (e: WheelEvent): void => {
        if (this.suspended) return;
        e.preventDefault();
        const s = wheelSpeed(this.cam.speed, e.deltaY);
        if (s === this.cam.speed) return;
        this.cam = { ...this.cam, speed: s };
        this.host.onSpeed(s);
    };

    private setSnap(on: boolean): void {
        for (const h of this.handles) h.snap = on;
    }

    private onKey = (e: KeyboardEvent): void => {
        this.fast = e.shiftKey;
        if (e.key === 'Control' || e.key === 'Meta') this.setSnap(false);
        if (this.suspended || !CAM_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || this.host.typing(e.target)) return;
        this.held.add(e.code);
        e.preventDefault();
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.fast = e.shiftKey;
        if (e.key === 'Control' || e.key === 'Meta') this.setSnap(true);
        this.held.delete(e.code);
    };

    private onBlur = (): void => {
        this.held.clear();
        this.fast = false;
        this.setSnap(true);
    };

    /** the way the camera looks on the floor (x, z), unit: the arrows move a gate by it */
    floorForward(): [number, number] {
        const f = camForward(this.cam);
        const h = Math.hypot(f[0], f[2]);
        return h > 1e-6 ? [f[0] / h, f[2] / h] : [0, -1];
    }

    /** The selected gate's centre on the page (CSS px) and its depth (above 0: in front); null when no gate is selected. */
    standScreen(): [number, number, number] | null {
        if (!this.handles[0]?.nodes.length) return null;
        const cc = this.host.camera.camera as CameraComponent;
        const r = this.canvas.getBoundingClientRect();
        const s = cc.worldToScreen(this.stand.getPosition(), new PcVec3());
        return [s.x + r.left, s.y + r.top, s.z];
    }

    /** For the page probes (tools/bench/src/editor3-smoke.ts): the handles, the stand-in's pose, and where on the canvas
     * (CSS px) each gate's centre and the stand-in's local axes are. Read only. */
    debug(): Record<string, unknown> {
        const cc = this.host.camera.camera as CameraComponent;
        const r = this.canvas.getBoundingClientRect();
        const scr = (x: number, y: number, z: number): number[] => {
            const s = cc.worldToScreen(new PcVec3(x, y, z), new PcVec3());
            return [Math.round(s.x + r.left), Math.round(s.y + r.top), Math.round(s.z * 100) / 100];
        };
        const p = this.stand.getPosition();
        const axis = (v: PcVec3): number[] => {
            const d = p.distance(this.host.camera.getPosition()) * 0.05;
            const a = scr(p.x, p.y, p.z);
            const b = scr(p.x + v.x * d, p.y + v.y * d, p.z + v.z * d);
            const n = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1;
            return [(b[0]! - a[0]!) / n, (b[1]! - a[1]!) / n];
        };
        const on = this.handles.some((h) => (h as unknown as { nodes?: unknown[] }).nodes?.length);
        return {
            handles: on,
            layer: (cc.layers ?? []).includes(this.layer.id),
            stand: { pos: [p.x, p.y, p.z], quat: [...fromPcQuat(this.stand.getRotation().x, this.stand.getRotation().y, this.stand.getRotation().z, this.stand.getRotation().w)], scale: this.stand.getLocalScale().x, opening: this.opening, screen: scr(p.x, p.y, p.z) },
            axes: { x: axis(this.stand.right), y: axis(this.stand.up), z: axis(this.stand.forward) },
            gates: this.host.gates().map((g) => scr(g.pos[0], g.pos[1], g.pos[2])),
            cam: { pos: [...this.cam.pos], speed: this.cam.speed },
            held: [...this.held],
            dragging: this.dragging
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('contextmenu', this.onMenu);
        this.canvas.removeEventListener('wheel', this.onWheel);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onUp);
        window.removeEventListener('keydown', this.onKey, true);
        window.removeEventListener('keyup', this.onKeyUp, true);
        window.removeEventListener('blur', this.onBlur);
        this.host.app.off('update', this.onUpdate);
        for (const h of this.handles) {
            h.detach();
            h.destroy();
        }
        this.stand.destroy();
        const cc = this.host.camera.camera as CameraComponent | undefined;
        if (cc) cc.layers = cc.layers.filter((id) => id !== this.layer.id);
        const layers = this.host.app.scene.layers;
        layers.remove(this.layer);
    }
}
