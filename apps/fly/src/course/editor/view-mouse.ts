// The edit mode's mouse, camera keys and handles on the page (lane editor3, stage E2, docs/wip/editor3.md "The design"). The
// owner's words of message 51: "I clicked an obstacle and the X, Y, Z appeared on it: move, rotate and scale, all with the
// mouse", "move around the scene with the usual W A S D, up, down". The math is pure and tested (fly-cam.ts, pick.ts,
// drag.ts); this file only binds it to the canvas, the keys and PlayCanvas's gizmos. The mouse stays free in this mode: the
// editor's window is one of mouse-look.ts CURSOR_WINDOWS, so no pointer lock is held.
import { Color, Entity, Gizmo, Quat as PcQuat, RotateGizmo, ScaleGizmo, TranslateGizmo, Vec3 as PcVec3 } from 'playcanvas';
import type { AppBase, CameraComponent, Layer } from 'playcanvas';
import { CAM_KEYS, camForward, camRay, camTarget, stepCam, turnCam, wheelSpeed, type FlyCam } from './fly-cam';
import { fromPcQuat, scaledOpening, toPcQuat, type FlownPose } from './drag';
import { pickGate, type Pickable, type Ray } from './pick';
import { pressOwner } from './press-owner';
import { toolAfter, toolOfKey, type Tool } from './bar-place';
import { blendCam, FRAME_GLIDE_MS } from './frame';
import { AXIS_RGB, gizmoSize, guideOnlyWhileDragging, HANDLE_PX, sizeAxes, units } from './handle-look';
import { minorAxis, pickRing, ringDeg, type DrawnRing, type P2 } from './ring-pick';

/** a press that moves less than this before it is let go is a click, px (an estimate) */
export const CLICK_SLOP_PX = 4;
/** the handles' snaps: 0.1 flown m, 15 degrees, a tenth of the opening (The design); Ctrl held drags free */
export const SNAP_MOVE_M = 0.1;
export const SNAP_TURN_DEG = 15;
export const SNAP_SCALE = 0.1;
/** lane editfix E2: the buttons the handles take (left only); the right button is the look everywhere */
export const HANDLE_BUTTONS: readonly [boolean, boolean, boolean] = [true, false, false];

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
    /** lane editor3 H1: a key chose another set of handles (the gate bar shows it) */
    onTool?(tool: Tool): void;
    /** H2-look: the words beside the Size handle for an opening of `m` flown metres */
    sizeText?(m: number): string;
    /** I1 (D2): the words beside the Move and Turn handles while dragged: flown m from the start, degrees from the start */
    moveText?(m: number): string;
    turnText?(deg: number): string;
    /** I1 (D1): F pressed: frame the selected gate again */
    onFrame?(): void;
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
    /** G2: endStale() detaches a gizmo that kept its axis: its transform:end is not a drag of ours */
    private quietEnd = false;
    /** G2: how many stale gizmo drags were ended (for the probes) */
    private staleEnded = 0;
    /** a handle was dragged during this press (its release is not a click) */
    private dragged = false;
    private press: { id: number; button: number; x: number; y: number; lx: number; ly: number; look: boolean } | null = null;
    private disposed = false;
    /** lane editor3 E3: Add gate armed, the next click on the scene places a gate */
    adding = false;
    /** lane editor3 E3: the drone flies (armed): no handles, no camera keys, no clicks; the camera is the drone's */
    private suspended = false;
    private standPose: FlownPose | null = null;
    /** lane editor3 E4: the handles in press-owner.ts PRESS_ORDER (size, move, turn); the ones switched off for this press */
    private readonly byPress: Handle[];
    private muted: Handle[] = [];
    /** lane editor3 H1: the one set of handles shown (Move when a gate gets selected) and the gate it belongs to */
    tool: Tool = 'move';
    private toolGate: string | number | null = null;
    /** J1 (E2): the selected gate's shape kind ('ring', 'square', 'cube-frame') */
    private kind: string | null = null;
    /** H2-look: the Size set and the opening in metres shown beside it while it is dragged */
    private readonly size: ScaleGizmo;
    private readonly tag: HTMLDivElement;
    /** I1 (D2): the Move and Turn sets (the tags beside them while dragged) */
    private readonly move: TranslateGizmo;
    private readonly turn: RotateGizmo;
    /** the stand-in's pose when a drag began (the tags say how far from it) */
    private readonly startPos = new PcVec3();
    private readonly startRot = new PcQuat();
    /** I1 (D1): the glide to a framing, and the canvas size the handles were last fitted to */
    private glide: { from: FlyCam; to: FlyCam; t0: number } | null = null;
    private fitW = 0;
    private fitH = 0;
    /** I1 (D4), J1 (E3): a ring taken by the edit view: its axis (0 x, 1 y, 2 z), the page way of a positive turn, the press */
    private ring: { axis: number; dir: P2; x: number; y: number } | null = null;

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
        // lane editfix E2: the PlayCanvas default [true, true, true] let a right drag that began on the handles move the gate
        // instead of turning the view (E1 cause 3). PlayCanvas 2.23.2 has only a getter that returns the array it reads
        // (Gizmo._mouseButtons, checked by the button of each pointerdown), so it is changed in place
        for (const g of [move, turn, size]) g.mouseButtons.splice(0, 3, ...HANDLE_BUTTONS);
        move.coordSpace = 'local';
        turn.coordSpace = 'local';
        size.coordSpace = 'local';
        move.snapIncrement = SNAP_MOVE_M;
        turn.snapIncrement = SNAP_TURN_DEG;
        size.snapIncrement = SNAP_SCALE;
        // lane editor3 H2-look: the Size tool reads as a scale tool of an ordinary 3D editor: a box at the end of each axis the
        // gate is sized along (x and y in its plane, z too for a cube, put()) and a big box in the centre. A gate has one size
        // (its opening), so each of them changes that one number (pose() reads the axis pulled); no planes. Sizes: estimates.
        size.uniform = true;
        for (const a of ['yz', 'xz', 'xy'] as const) size.enableShape(a, false);
        this.size = size;
        this.move = move;
        this.turn = turn;
        this.tag = document.createElement('div');
        this.tag.className = 'ce-size-tag';
        this.tag.hidden = true;
        document.body.appendChild(this.tag);
        // the centre belongs to the scale box: the move handle keeps its arrows and planes, the turn handle its three rings
        // PlayCanvas 2.23.2 shape names (build/playcanvas.mjs _shapes): the move handle's centre is the sphere 'xyz' (it took
        // the centre drag from the scale box in the smoke probe of E2 pass 2), the turn handle's are 'face' (f) and 'xyz'
        move.enableShape('xyz', false);
        for (const a of ['yz', 'xz', 'xy'] as const) move.enableShape(a, false);
        turn.enableShape('face', false);
        turn.enableShape('xyz', false);
        this.look(move, turn, size);
        this.handles = [move, turn, size];
        this.byPress = [size, move, turn];
        for (const h of this.handles) {
            h.snap = true;
            h.on('transform:start', () => {
                this.dragging = true;
                this.dragged = true;
                this.glide = null;
                this.openingAtStart = this.opening;
                this.startOf();
            });
            // G2: a move from a gizmo that still believes it drags after the button went up is not a drag of ours
            h.on('transform:move', () => {
                if (!this.dragging) return;
                const p = this.pose(this.openingAtStart);
                host.onDrag(p, false);
                if (h === this.size) this.showTag(scaledOpening(p.opening, 1));
                else this.showMoveTurnTag(h === this.move);
            });
            h.on('transform:end', () => {
                this.tag.hidden = true;
                // review EJ-3: the dragged line back to its axis colour (PlayCanvas 2.23.2 TransformGizmo._hover() with no
                // mesh clears the hover; the pointer resting on it after the drag kept it hover-yellow)
                (h as unknown as { _hover?: (m?: unknown) => void })._hover?.();
                if (this.quietEnd) return;
                // the drag is over before the course takes it, so put() of the new gate places the stand-in again
                this.dragging = false;
                host.onDrag(this.pose(this.openingAtStart), true);
            });
        }
        // capture on the window runs before the gizmos' own pointerdown on the canvas: one handle owns the press
        window.addEventListener('pointerdown', this.onOwnPress, true);
        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('contextmenu', this.onMenu);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
        // G2: capture, because a gizmo's own pointermove and pointerup stop propagation over its shapes (PlayCanvas 2.23.2
        // Gizmo._onPointerUp), so a window listener in the bubble phase missed the up after every drag that ended on a handle
        window.addEventListener('pointermove', this.onPointerMove, true);
        window.addEventListener('pointerup', this.onUpCapture, true);
        window.addEventListener('pointercancel', this.onUpCapture, true);
        window.addEventListener('keydown', this.onKey, true);
        window.addEventListener('keyup', this.onKeyUp, true);
        window.addEventListener('blur', this.onBlur);
        host.app.on('update', this.onUpdate);
        this.apply();
    }

    /** The stand-in at the selected gate (null: no gate, the handles hidden). Not while a drag holds it. `kind`: the
     *  gate's shape kind (J1 E2: the Size handle's axes, handle-look.ts sizeAxes); left out, the last one stays. */
    put(p: FlownPose | null, gate: string | number | null = null, kind?: string | null): void {
        if (this.dragging) return;
        if (kind !== undefined) this.kind = kind;
        this.fit();
        this.standPose = p;
        this.tool = toolAfter(this.tool, this.toolGate, gate);
        this.toolGate = gate;
        if (!p || this.suspended) {
            for (const h of this.handles) h.detach();
            return;
        }
        const q = toPcQuat(p.quat);
        this.stand.setPosition(p.pos[0], p.pos[1], p.pos[2]);
        this.stand.setRotation(new PcQuat(q[0], q[1], q[2], q[3]));
        this.stand.setLocalScale(1, 1, 1);
        this.opening = p.opening;
        this.showTool();
        this.sizeShapes();
    }

    /** J1 (E2): the Size handle's lines for this gate only (a ring one pair along its width), the others not drawn */
    private sizeShapes(): void {
        const on = sizeAxes(this.kind);
        const shapes = (this.size as unknown as { _shapes?: Record<string, { visible: boolean }> })._shapes ?? {};
        for (const a of ['x', 'y', 'z'] as const) {
            this.size.enableShape(a, on.includes(a));
            const sh = shapes[a];
            if (sh) sh.visible = on.includes(a);
        }
    }

    /** lane editor3 H1: the gate bar's Move, Turn or Size (or M, R, T): only that set of handles is on the gate */
    setTool(tool: Tool): void {
        if (this.dragging || tool === this.tool) return;
        this.tool = tool;
        if (this.standPose && !this.suspended) this.showTool();
    }

    private active(): Handle {
        return this.handles[this.tool === 'move' ? 0 : this.tool === 'turn' ? 1 : 2]!;
    }

    private showTool(): void {
        const on = this.active();
        for (const h of this.handles) {
            if (h !== on) {
                h.detach();
                h.enabled = false;
            }
        }
        on.enabled = true;
        on.attach([this.stand]);
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
            this.put(this.standPose, this.toolGate);
            this.apply();
        }
    }

    /** true while the drone flies (the handles are away and the view does not write the camera) */
    isSuspended(): boolean {
        return this.suspended;
    }

    /** The camera put somewhere (a key selected a gate: the view goes to it). */
    setCam(c: FlyCam): void {
        this.glide = null;
        this.cam = c;
        this.apply();
    }

    /** I1 (D1): the view glides to `c` in FRAME_GLIDE_MS (a framing); false while a drag holds the view */
    glideTo(c: FlyCam): boolean {
        if (this.dragging || this.suspended) return false;
        this.glide = { from: this.cam, to: c, t0: performance.now() };
        return true;
    }

    /** I1 (D2): the handles in CSS px whatever the canvas and the field (handle-look.ts), refitted when the canvas changes */
    private fit(): void {
        const w = this.canvas.clientWidth;
        const hh = this.canvas.clientHeight;
        if (w === this.fitW && hh === this.fitH) return;
        this.fitW = w;
        this.fitH = hh;
        const cc = this.host.camera.camera as CameraComponent;
        const k = gizmoSize((cc.horizontalFov ? w : hh) / 2);
        for (const h of this.handles) h.size = k;
    }

    /** I1 (D2): saturated axes, yellow under the mouse and while dragged, thin lines, small tips (handle-look.ts) */
    private look(move: TranslateGizmo, turn: RotateGizmo, size: ScaleGizmo): void {
        const c = (v: readonly number[]): Color => new Color(v[0], v[1], v[2], 1);
        const base = { x: c(AXIS_RGB.x), y: c(AXIS_RGB.y), z: c(AXIS_RGB.z), xyz: c(AXIS_RGB.centre), f: c(AXIS_RGB.centre) };
        const hov = c(AXIS_RGB.hover);
        const theme = { shapeBase: base, shapeHover: { x: hov, y: hov, z: hov, xyz: hov, f: hov }, guideBase: { x: c(AXIS_RGB.x), y: c(AXIS_RGB.y), z: c(AXIS_RGB.z) } };
        const P = HANDLE_PX;
        // PlayCanvas 2.23.2 TransformGizmo.setTheme (build/playcanvas.mjs 121711)
        for (const h of [move, turn, size]) (h as unknown as { setTheme: (t: unknown) => void }).setTheme(theme);
        move.axisLineThickness = units(P.line);
        move.axisArrowLength = units(P.arrowLength);
        move.axisArrowThickness = units(P.arrowWidth);
        move.axisLineLength = units(P.moveReach - P.arrowLength);
        move.axisLineTolerance = units(P.pickTolerance);
        move.axisGap = 0;
        turn.xyzRingRadius = units(P.ringRadius);
        turn.xyzTubeRadius = units(P.line / 2);
        turn.ringTolerance = units(P.pickTolerance);
        size.axisLineThickness = units(P.line);
        size.axisBoxSize = units(P.sizeBox);
        size.axisLineLength = units(P.sizeReach - P.sizeBox);
        size.axisCenterSize = units(P.centreBox);
        size.axisLineTolerance = units(P.pickTolerance);
        size.axisGap = 0;
        // I1 (D2): a shape switched off by enableShape is still drawn in grey (PlayCanvas 2.23.2 Shape.disabled only recolours
        // it), and _drag(false) shows every shape again at a drag's end (build/playcanvas.mjs 122376, 122877, 123402): the
        // turn handle's 143 px grey centre sphere and its face ring, measured on Tunis by editor3-gizmo.ts. Hide them, also
        // after each drag.
        type Sh = { _disabled?: boolean; visible: boolean };
        for (const h of [move, turn, size]) {
            const g = h as unknown as { _shapes?: Record<string, Sh>; _drag?: (state: boolean) => void };
            const hideOff = (): void => {
                for (const s of Object.values(g._shapes ?? {})) if (s._disabled) s.visible = false;
            };
            const drag = g._drag?.bind(h);
            if (drag) g._drag = (state: boolean): void => { drag(state); hideOff(); };
            hideOff();
        }
        // I3 (D2): the axis guide (a line across the whole view along the axis) only while a handle is dragged, as in Blender.
        // PlayCanvas 2.23.2 draws it also for the axis under the mouse (prerender, build/playcanvas.mjs 121750, 122452), so
        // after a Move drag the pointer resting on the X arrow kept a red line across the view (editor3-move-1920.png).
        for (const h of [move, turn, size]) guideOnlyWhileDragging(h);
        // J1 (E2): PlayCanvas 2.23.2 TransformGizmo._hover lights x, y, z and xyz for the centre cube under the mouse (the
        // three yellow lines of editor3-size-1920.png, the pointer rests on the centre after a drag): only the cube lights
        type Hv = { _hover?: (mi?: unknown) => void; _hoverAxis?: string; _hovering?: Set<string>; _shapes?: Record<string, { hover(s: boolean): void }> };
        const sg = size as unknown as Hv;
        const hover = sg._hover?.bind(size);
        if (hover) {
            sg._hover = (mi?: unknown): void => {
                hover(mi);
                if (sg._hoverAxis !== 'xyz') return;
                for (const a of ['x', 'y', 'z']) {
                    if (!sg._hovering?.delete(a)) continue;
                    sg._shapes?.[a]?.hover(false);
                }
            };
        }
    }

    /** the stand-in's pose at a drag's start (the tags beside the handles count from it) */
    private startOf(): void {
        this.startPos.copy(this.stand.getPosition());
        this.startRot.copy(this.stand.getRotation());
    }

    /** I1 (D2): flown m moved or degrees turned beside the Move or Turn handle while dragged */
    private showMoveTurnTag(moved: boolean): void {
        if (moved) {
            if (this.host.moveText) this.tagAt(this.host.moveText(this.stand.getPosition().distance(this.startPos)));
            return;
        }
        const q = this.stand.getRotation();
        const dot = Math.min(1, Math.abs(q.x * this.startRot.x + q.y * this.startRot.y + q.z * this.startRot.z + q.w * this.startRot.w));
        if (this.host.turnText) this.tagAt(this.host.turnText((2 * Math.acos(dot) * 180) / Math.PI));
    }

    /** I1 (D4): the three turn rings as drawn on the canvas (CSS px from its corner): x, y, z */
    private drawnRings(): DrawnRing[] {
        const cc = this.host.camera.camera as CameraComponent;
        const root = (this.turn as unknown as { root?: Entity }).root;
        const r = units(HANDLE_PX.ringRadius) * (root ? root.getLocalScale().x : 0);
        const c = this.stand.getPosition().clone();
        const ax = [this.stand.right.clone(), this.stand.up.clone(), this.stand.forward.clone()];
        // J1 (E3): the points go round in the order a positive turn about the local axis moves them (u x v = that axis):
        // the local x, y and z (z is the back, PlayCanvas's forward is -z), so an open ring's segment is its drag direction
        const loc = [ax[0]!, ax[1]!, this.stand.forward.clone().mulScalar(-1)];
        const cs = cc.worldToScreen(c, new PcVec3());
        return [0, 1, 2].map((i) => {
            const u = loc[(i + 1) % 3]!;
            const v = loc[(i + 2) % 3]!;
            const pts: P2[] = [];
            for (let k = 0; k < 64; k++) {
                const t = (k / 64) * 2 * Math.PI;
                const ct = Math.cos(t) * r;
                const st = Math.sin(t) * r;
                const s = cc.worldToScreen(new PcVec3(c.x + u.x * ct + v.x * st, c.y + u.y * ct + v.y * st, c.z + u.z * ct + v.z * st), new PcVec3());
                pts.push([s.x, s.y]);
            }
            // review EI-4: the ring's own axis on the page orients its line's direction (ring-pick.ts orientTangent)
            const a = ax[i]!;
            const as = cc.worldToScreen(new PcVec3(c.x + a.x * r, c.y + a.y * r, c.z + a.z * r), new PcVec3());
            return { pts, minor: minorAxis(pts, [cs.x, cs.y]), axis: [as.x - cs.x, as.y - cs.y] as P2 };
        });
    }

    /**
     * Review EI-3: the taken edge-on ring in the hover yellow (on) or back (off). The turn handle stays shown during the drag
     * (D2: the dragged handle in yellow); its own input sits the drag out because the edit view stops the pointer events
     * before they reach the canvas (onOwnPress, onPointerMove). PlayCanvas 2.23.2 TransformGizmo._hover() with no mesh
     * clears its own hover; Shape.hover(state) recolours one shape (build/playcanvas.mjs 121541).
     */
    private ringLook(axis: number, on: boolean): void {
        const g = this.turn as unknown as { _hover?: (m?: unknown) => void; _shapes?: Record<string, { hover?: (s: boolean) => void }> };
        g._hover?.();
        g._shapes?.['xyz'[axis]!]?.hover?.(on);
    }

    /** I1 (D4), J1 (E3): a ring dragged (across its line when edge-on, along it when open) turns the gate about its axis
     *  (snapped unless Ctrl) */
    private ringMove(e: PointerEvent): void {
        const g = this.ring!;
        let deg = ringDeg(g.dir, e.clientX - g.x, e.clientY - g.y);
        if (this.move.snap) deg = Math.round(deg / SNAP_TURN_DEG) * SNAP_TURN_DEG;
        const axis = g.axis === 0 ? new PcVec3(1, 0, 0) : g.axis === 1 ? new PcVec3(0, 1, 0) : new PcVec3(0, 0, 1);
        const q = new PcQuat().copy(this.startRot).mul(new PcQuat().setFromAxisAngle(axis, deg));
        this.stand.setRotation(q);
        this.host.onDrag(this.pose(this.openingAtStart), false);
        this.showMoveTurnTag(false);
    }

    /** I1, for the page probes: the edit eye's distance to the selected gate, the gate's height on the canvas (its opening
     *  along its up, CSS px), the three rings' minor axes and each shown handle part's rectangle on the page. Read only. */
    measure(): Record<string, unknown> | null {
        if (!this.standPose) return null;
        // review EJ-1: project with the edit view's camera, as onOwnPress does before it picks
        if (!this.suspended) this.apply();
        const cc = this.host.camera.camera as CameraComponent;
        const rc = this.canvas.getBoundingClientRect();
        const c = this.stand.getPosition().clone();
        const up = this.stand.up.clone().mulScalar(this.opening / 2);
        const a = cc.worldToScreen(new PcVec3().add2(c, up), new PcVec3());
        const b = cc.worldToScreen(new PcVec3().sub2(c, up), new PcVec3());
        const parts: { name: string; rect: number[] }[] = [];
        type Mi = { visible?: boolean; node: { name: string; getWorldTransform(): { transformPoint(a: PcVec3, b: PcVec3): PcVec3 } }; mesh?: { getPositions?(a: number[]): number }; aabb: { getMin(): PcVec3; getMax(): PcVec3 } };
        type Sh = { _visible?: boolean; _disabled?: boolean; meshInstances?: Mi[] };
        const shapes = (this.active() as unknown as { _shapes?: Record<string, Sh> })._shapes ?? {};
        for (const sh of Object.values(shapes)) {
            if (sh._visible === false || sh._disabled) continue;
            for (const mi of sh.meshInstances ?? []) {
                if (mi.visible === false) continue;
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                const add = (w: PcVec3): void => {
                    const s = cc.worldToScreen(w, new PcVec3());
                    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
                };
                // the drawn extent: the mesh's own vertices through its node (the world box of a turned cone or cube is larger)
                const pos: number[] = [];
                const n = mi.mesh?.getPositions?.(pos) ?? 0;
                if (n > 0) {
                    const m = mi.node.getWorldTransform();
                    for (let k = 0; k < n; k++) add(m.transformPoint(new PcVec3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]), new PcVec3()));
                } else {
                    const lo = mi.aabb.getMin();
                    const hi = mi.aabb.getMax();
                    for (let k = 0; k < 8; k++) add(new PcVec3(k & 1 ? hi.x : lo.x, k & 2 ? hi.y : lo.y, k & 4 ? hi.z : lo.z));
                }
                parts.push({ name: n > 0 ? mi.node.name : `${mi.node.name} (box)`, rect: [Math.round(x0 + rc.left), Math.round(y0 + rc.top), Math.round(x1 - x0), Math.round(y1 - y0)] });
            }
        }
        return {
            eyeDist: Math.round(c.distance(new PcVec3(this.cam.pos[0], this.cam.pos[1], this.cam.pos[2])) * 100) / 100,
            gatePx: Math.round(Math.hypot(a.x - b.x, a.y - b.y)),
            viewH: rc.height,
            rings: this.drawnRings().map((r) => Math.round(r.minor)),
            glide: this.glide !== null,
            parts
        };
    }

    /** the stand-in's pose; the scale handle's factor times `opening` is the new opening */
    private pose(opening: number): FlownPose {
        const p = this.stand.getPosition();
        const r = this.stand.getRotation();
        // H2-look: an axis box scales one axis, the centre box all three: the axis pulled furthest from 1 is the factor
        const sc = this.stand.getLocalScale();
        const k = [sc.x, sc.y, sc.z].reduce((a, v) => (Math.abs(v - 1) > Math.abs(a - 1) ? v : a), 1);
        return { pos: [p.x, p.y, p.z], quat: fromPcQuat(r.x, r.y, r.z, r.w), opening: opening * (k > 0 ? k : 1) };
    }

    private apply(): void {
        this.host.onCamera(this.cam.pos, camTarget(this.cam));
    }

    /** H2-look: the opening in metres beside the Size handle while it is dragged (above right of the gate's centre) */
    private showTag(m: number): void {
        if (this.host.sizeText) this.tagAt(this.host.sizeText(m));
    }

    private tagAt(text: string): void {
        const s = this.standScreen();
        if (!s) return;
        this.tag.textContent = text;
        this.tag.style.left = `${Math.round(s[0] + 28)}px`;
        this.tag.style.top = `${Math.round(s[1] - 48)}px`;
        this.tag.hidden = false;
    }

    private onUpdate = (dt: number): void => {
        if (this.suspended) return;
        this.fit();
        if (this.glide) {
            // D1: a drag in progress never moves the view; the pilot's own flight (keys, look) ends the glide
            if (this.dragging || this.held.size > 0) this.glide = null;
            else {
                const t = (performance.now() - this.glide.t0) / FRAME_GLIDE_MS;
                this.cam = blendCam(this.glide.from, this.glide.to, t);
                if (t >= 1) this.glide = null;
                this.apply();
                return;
            }
        }
        if (this.held.size === 0) return;
        const next = stepCam(this.cam, this.held, this.fast, dt);
        if (next !== this.cam) {
            this.cam = next;
            this.apply();
        }
    };

    /** press-owner.ts: the first handle with a shape under the cursor keeps the press, the others sit it out */
    private onOwnPress = (e: PointerEvent): void => {
        this.unmute();
        if (this.suspended || e.target !== this.canvas || e.button !== 0) return;
        // G2: the gizmos pick with the renderer's camera entity: give it the edit view's pose first (g2/floor3)
        this.apply();
        const sels = this.byPress.map((h) => {
            // PlayCanvas 2.23.2 TransformGizmo._getSelection(x, y): the gizmo's own shapes under a canvas point, nearest first
            const sel = (h as unknown as { _getSelection?: (x: number, y: number) => { node?: { name?: string } }[] })._getSelection?.(e.offsetX, e.offsetY);
            return h.enabled && sel && sel[0] ? sel[0] : null;
        });
        const own = pressOwner(sels.map((s) => !!s));
        // I1 (D4), J1 (E3): every turn ring within RING_PICK_PX is taken here: the gizmo's absolute mode turned the y ring by
        // 0 deg for a drag along it at its side, and an edge-on one always (ring-pick.ts pickRing)
        const rp = this.tool === 'turn' && this.turn.enabled && this.standPose ? pickRing([e.offsetX, e.offsetY], this.drawnRings()) : null;
        if (rp) {
            this.ring = { axis: rp.index, dir: rp.dir, x: e.clientX, y: e.clientY };
            this.dragging = true;
            this.dragged = true;
            this.glide = null;
            this.openingAtStart = this.opening;
            this.startOf();
            // review EI-3: the rings stay shown, the taken one yellow; the press does not reach the gizmo's canvas listener
            e.stopPropagation();
            this.ringLook(rp.index, true);
            return;
        }
        if (own < 0) return;
        this.muted = this.byPress.filter((_, i) => i !== own);
        for (const h of this.muted) h.enabled = false;
    };

    private unmute(): void {
        if (this.muted.length === 0) return;
        this.muted = [];
        // lane editor3 H1: only the shown set takes presses
        for (const h of this.handles) h.enabled = h === this.active();
    }

    private onDown = (e: PointerEvent): void => {
        if (this.suspended || (e.button !== 0 && e.button !== 2)) return;
        // a press on a handle is the gizmo's (it fired transform:start in its own pointerdown, or will on the first move)
        this.press = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, look: e.button === 2 };
        if (e.button === 2) e.preventDefault();
    };

    private onPointerMove = (e: PointerEvent): void => {
        if (this.ring) {
            // review EI-3: the gizmo (shown) does not hover other shapes while the edit view turns the ring
            e.stopPropagation();
            return this.ringMove(e);
        }
        const p = this.press;
        if (!p || p.id !== e.pointerId || this.dragging) return;
        if (!p.look && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.look = true;
        // lane editor3 H1: the step from the last position, not movementX (0 for some synthetic and remote pointers)
        const dx = e.clientX - p.lx;
        const dy = e.clientY - p.ly;
        p.lx = e.clientX;
        p.ly = e.clientY;
        if (!p.look) return;
        this.glide = null;
        this.cam = turnCam(this.cam, dx, dy);
        this.apply();
    };

    /** G2: the up is handled after the whole dispatch (the gizmo's own pointerup first), whoever stopped it on the way */
    private onUpCapture = (e: PointerEvent): void => {
        setTimeout(() => {
            if (!this.disposed) this.onUp(e);
        }, 0);
    };

    /** G2: true only while a handle really drags (the gate bar hides for that time) */
    isDragging(): boolean {
        return this.dragging;
    }

    /**
     * G2: a gizmo still holding a selected axis after the button went up believes it drags: its next pointerdown is ignored
     * (TransformGizmo POINTERDOWN returns while _dragging) and pointer moves send transform:move. Detaching fires its
     * POINTERUP, which clears the axis; its transform:end is not a drag of ours (quietEnd). The shown set is put back.
     */
    private endStale(): number {
        let n = 0;
        for (const h of this.handles) {
            const g = h as unknown as { _selectedAxis?: string; _hoverAxis?: string };
            if (!g._selectedAxis) continue;
            n++;
            g._hoverAxis = '';
            this.quietEnd = true;
            try {
                h.detach();
            } finally {
                this.quietEnd = false;
            }
            g._selectedAxis = '';
            if (h === this.active() && this.standPose && !this.suspended) h.attach([this.stand]);
        }
        this.staleEnded += n;
        return n;
    }

    private onUp = (e: PointerEvent): void => {
        this.unmute();
        this.tag.hidden = true;
        // review ED-1: a handle that took the press but sent no transform:end (its own pointerup returns while it is
        // switched off) would leave `dragging` set, and put() then never places the handles on another gate
        if (this.dragging) {
            this.dragging = false;
            this.host.onDrag(this.pose(this.openingAtStart), true);
        }
        if (this.ring) {
            this.ringLook(this.ring.axis, false);
            this.ring = null;
        }
        this.endStale();
        const p = this.press;
        if (!p || p.id !== e.pointerId) return;
        this.press = null;
        const wasDrag = this.dragging || this.dragged;
        this.dragging = false;
        this.dragged = false;
        if (wasDrag || p.look || p.button !== 0) return;
        const r = this.canvas.getBoundingClientRect();
        const cc = this.host.camera.camera as CameraComponent;
        // G2: the ray from the edit camera's own pose (the entity may hold the drone's pose between frames, g2/floor3)
        const ray = camRay(this.cam, e.clientX - r.left, e.clientY - r.top, r.width, r.height, cc.fov, cc.horizontalFov);
        if (!ray) return;
        this.apply();
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
        const tool = this.suspended || e.repeat || this.host.typing(e.target) ? null : toolOfKey(e.code, e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);
        if (tool) {
            e.preventDefault();
            this.setTool(tool);
            this.host.onTool?.(this.tool);
            return;
        }
        // I1 (D1): F frames the selected gate again ('frame selected'); the page's own F (full screen) does not see it here
        if (e.code === 'KeyF' && !this.suspended && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !this.host.typing(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            if (!this.dragging) this.host.onFrame?.();
            return;
        }
        if (this.suspended || !CAM_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || this.host.typing(e.target)) return;
        this.glide = null;
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

    /**
     * J1 (E1): the selected gate's drawn box on the canvas (CSS px from its corner: x0, y0, x1, y1) and the canvas's size:
     * the corners at the centre +- right and up (and forward for a cube frame) times half the opening. box null: a corner
     * lies behind the eye. Null: no gate. Read only (course.ts asks it when a drag ends, frame.ts reframeAfterDrag).
     */
    gateBox(): { box: [number, number, number, number] | null; w: number; h: number } | null {
        if (!this.standPose) return null;
        // fixes3 pass 2 (left a): a drag's start and end come between frames, when the camera entity may hold the drone's
        // pose: project with the edit view's camera, as hitAt and measure do (a box from the drone's eye read 'outside')
        if (!this.suspended) this.apply();
        const cc = this.host.camera.camera as CameraComponent;
        const c = this.stand.getPosition();
        const k = this.opening / 2;
        const r = this.stand.right.clone().mulScalar(k);
        const u = this.stand.up.clone().mulScalar(k);
        const f = this.stand.forward.clone().mulScalar(this.kind === 'cube-frame' ? k : 0);
        let box: [number, number, number, number] | null = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < 8 && box; i++) {
            const p = new PcVec3().copy(c);
            p.add(new PcVec3().copy(r).mulScalar(i & 1 ? 1 : -1));
            p.add(new PcVec3().copy(u).mulScalar(i & 2 ? 1 : -1));
            p.add(new PcVec3().copy(f).mulScalar(i & 4 ? 1 : -1));
            const s = cc.worldToScreen(p, new PcVec3());
            if (!(s.z > 0)) box = null;
            else box = [Math.min(box[0], s.x), Math.min(box[1], s.y), Math.max(box[2], s.x), Math.max(box[3], s.y)];
        }
        return { box, w: this.canvas.clientWidth, h: this.canvas.clientHeight };
    }

    /** The selected gate's centre on the page (CSS px) and its depth (above 0: in front); null when no gate is selected. */
    standScreen(): [number, number, number] | null {
        // G2 (measured, REPRO run g2/repro2): this read only the Move set, so Turn or Size (one set at a time) hid the bar
        if (!this.handles.some((h) => h.nodes.length > 0)) return null;
        const cc = this.host.camera.camera as CameraComponent;
        const r = this.canvas.getBoundingClientRect();
        const s = cc.worldToScreen(this.stand.getPosition(), new PcVec3());
        return [s.x + r.left, s.y + r.top, s.z];
    }

    /** For the page probes (tools/bench/src/editor3-smoke.ts): the handles, the stand-in's pose, and where on the canvas
     * (CSS px) each gate's centre and the stand-in's local axes are. Read only. */
    debug(): Record<string, unknown> {
        // fixes3 pass 2 (left a): how far the camera entity stood from the edit eye before this read, then project with the
        // edit view's own pose (the entity may hold the drone's pose between frames, as hitAt and measure)
        const e0 = this.host.camera.getPosition();
        const camGap = Math.round(Math.hypot(e0.x - this.cam.pos[0], e0.y - this.cam.pos[1], e0.z - this.cam.pos[2]) * 100) / 100;
        if (!this.suspended) this.apply();
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
            cam: { pos: [...this.cam.pos], speed: this.cam.speed, gap: camGap },
            // I3: the camera's field in degrees and whether it is horizontal (the probe's frameF share of the view)
            fov: { deg: cc.fov, horizontal: !!cc.horizontalFov, aspect: Math.round((r.width / (r.height || 1)) * 1000) / 1000 },
            held: [...this.held],
            dragging: this.dragging,
            // review EI-3: the edge-on ring the edit view holds (0 x, 1 y, 2 z) or null; the probe reads it mid-drag
            ring: this.ring ? this.ring.axis : null,
            staleEnded: this.staleEnded,
            tool: this.tool,
            // lane editor3 H2: each set's own state (PlayCanvas 2.23.2 TransformGizmo fields), and a held pointer lock
            sets: this.handles.map((h) => {
                const g = h as unknown as { enabled: boolean; nodes: unknown[]; _selectedAxis?: string; _hoverAxis?: string };
                return [g.enabled, g.nodes.length, g._selectedAxis ?? '', g._hoverAxis ?? ''];
            }),
            muted: this.muted.length,
            lock: !!document.pointerLockElement,
            // H2-look: the stand-in's scale per axis and the shown size tag
            scale3: [this.stand.getLocalScale().x, this.stand.getLocalScale().y, this.stand.getLocalScale().z],
            tag: this.tag.hidden ? null : this.tag.textContent
        };
    }

    /** For the page probes: which shape of the shown handles is under a page point (CSS px): [tool, axis] or null. Read only;
     * the probe walks out from the gate's centre with it to find the ring, the arrow or the box it then presses. */
    hitAt(x: number, y: number, own = false): [Tool, string] | null {
        // review EJ-1: the same camera as onOwnPress (the entity may hold the drone's pose between frames)
        if (!this.suspended) this.apply();
        const r = this.canvas.getBoundingClientRect();
        const h = this.active();
        if (!h.nodes.length) return null;
        // PlayCanvas 2.23.2 (build/playcanvas.mjs 121283, 121530): a hit carries its meshInstances; the axis is the part of the
        // first one's node name after ':' (as the gizmo's own _getAxis)
        // H2: _getSelection returns the nearest shape's mesh instances (playcanvas.mjs 121263-121300), not hit records
        type Hit = { node?: { name?: string } };
        const sel = (h as unknown as { _getSelection?: (x: number, y: number) => Hit[] })._getSelection?.(x - r.left, y - r.top);
        const name = sel?.[0]?.node?.name ?? '';
        // I1 (D4), J1 (E3): a ring the edit view takes itself (the same rule as onOwnPress): 'edge:y' edge-on, 'ring:y' open
        const rp = this.tool === 'turn' ? pickRing([x - r.left, y - r.top], this.drawnRings()) : null;
        const axis = sel && sel[0] ? (name.split(':')[1] ?? '') : null;
        // review EJ-1: `own` reports the gizmo's own hit test only (the probe presses where PlayCanvas draws the ring)
        if (own) return axis !== null ? [this.tool, axis] : null;
        if (rp) return [this.tool, `${rp.edge ? 'edge' : 'ring'}:${'xyz'[rp.index]}`];
        return axis !== null ? [this.tool, axis] : null;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        window.removeEventListener('pointerdown', this.onOwnPress, true);
        this.unmute();
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('contextmenu', this.onMenu);
        this.canvas.removeEventListener('wheel', this.onWheel);
        window.removeEventListener('pointermove', this.onPointerMove, true);
        window.removeEventListener('pointerup', this.onUpCapture, true);
        window.removeEventListener('pointercancel', this.onUpCapture, true);
        window.removeEventListener('keydown', this.onKey, true);
        window.removeEventListener('keyup', this.onKeyUp, true);
        window.removeEventListener('blur', this.onBlur);
        this.host.app.off('update', this.onUpdate);
        for (const h of this.handles) {
            h.detach();
            h.destroy();
        }
        this.stand.destroy();
        this.tag.remove();
        const cc = this.host.camera.camera as CameraComponent | undefined;
        if (cc) cc.layers = cc.layers.filter((id) => id !== this.layer.id);
        const layers = this.host.app.scene.layers;
        layers.remove(this.layer);
    }
}
