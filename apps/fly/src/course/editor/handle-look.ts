// Lane editor3 I1 (decision D2 of train 3): the handles look as in ordinary 3D editors (Blender and Unity as the reference).
// Saturated red, green and blue axes, the handle under the mouse and the dragged one yellow, lines of 2.5 px, Move as arrows
// with cone tips about 90 px long, Turn as full rings of about 85 px radius, Size as thin lines with a cube at each end
// and a light cube in the centre. No part is drawn larger than 16 px except the lines and the rings: the gate stays visible
// through its handles. Sizes in CSS px as set; a part is drawn up to DRAWN_PER_SET times larger (measured), so the set
// sizes are smaller than the decision's 12 and 14 px. view-mouse.ts turns them into the gizmo's own units. Pure.

/** lane edit4a A2: the three parts of the one gizmo (Blender's Transform tool): move arrows, turn rings, size boxes */
export type Handle = 'move' | 'turn' | 'size';
/** the axis of a handle's part; 'xyz' is the size handle's centre box (the whole gate) */
export type HandleAxis = 'x' | 'y' | 'z' | 'xyz';

/**
 * The sizes of the handles' parts, CSS px. Lane edit4a A2 (the owner, brief 543: one gizmo with arrows, boxes and rings at
 * once): the parts lie in separate bands from the centre out, so nothing lies over another thing on the gate's own axes:
 * the size boxes inside (to 35 px), the rings in the middle (60 px), the move arrows outside (75 to 115 px). Estimates of the
 * edit4 design (units of the gizmo's size), checked by the edit4a probe.
 */
export const HANDLE_PX = {
    /** Move: from the centre to where the arrow's line begins, and to the arrow's tip */
    moveGap: 75,
    moveReach: 115,
    /** Move: the cone tip's length and width (drawn up to DRAWN_PER_SET times larger) */
    arrowLength: 13,
    arrowWidth: 9,
    /** every line and every ring's tube */
    line: 2.5,
    /** Turn: the rings' radius */
    ringRadius: 60,
    /** Size: from the centre to the far side of an end cube (no line to it), the end cubes and the centre cube */
    sizeReach: 35,
    sizeBox: 9,
    centreBox: 9.5,
    /** how far from a line or a ring the pointer may be and still take it */
    pickTolerance: 8
} as const;

/** lane edit4a A2: where each handle can take a press, CSS px from the gizmo's centre along the gate's own axes */
export function handleBands(px: typeof HANDLE_PX = HANDLE_PX): Record<Handle, readonly [number, number]> {
    const boxHalf = (Math.max(px.sizeBox, px.centreBox) * DRAWN_PER_SET) / 2;
    return {
        size: [0, px.sizeReach + boxHalf],
        turn: [px.ringRadius - px.pickTolerance, px.ringRadius + px.pickTolerance],
        move: [px.moveGap, px.moveReach]
    };
}

/** the smallest gap between two bands, CSS px (negative: they overlap) */
export function bandGap(bands: Record<Handle, readonly [number, number]>): number {
    const s = Object.values(bands).sort((a, b) => a[0] - b[0]);
    let gap = Infinity;
    for (let i = 1; i < s.length; i++) gap = Math.min(gap, s[i]![0] - s[i - 1]![1]);
    return gap;
}

/**
 * How much larger a part is drawn than its set size: a cube seen at an angle spans up to sqrt(3) of its edge and the wide
 * field stretches parts off the centre. Measured by tools/bench/src/editor3-gizmo.ts (MODE=after, 5c51b4f1's tree, Tunis
 * and Wroclaw, 1920x1080): cone 18 px drawn for 16 set (1.13), cubes 16 to 20 px for 12 and 14 set (up to 1.67).
 */
export const DRAWN_PER_SET = 1.67;

/** the largest part that is not a line or a ring, CSS px as set */
export const PART_MAX_PX = Math.max(HANDLE_PX.arrowLength, HANDLE_PX.arrowWidth, HANDLE_PX.sizeBox, HANDLE_PX.centreBox);

/** the largest part as drawn at the worst measured ratio, CSS px (D2: at most 16) */
export const PART_MAX_DRAWN_PX = PART_MAX_PX * DRAWN_PER_SET;

/** the gizmo's own unit in CSS px: the shapes are set in these units and the gizmo's size makes one unit this many px */
export const UNIT_PX = 100;

/**
 * J1 (E2 of train 3): the Size handle's axes for a gate: a ring has one size, so one handle along its width (x) and the
 * centre cube; a square its width and height (x, y); a cube frame all three. Pure.
 */
export function sizeAxes(kind: string | null | undefined): readonly ('x' | 'y' | 'z')[] {
    return kind === 'ring' ? ['x'] : kind === 'cube-frame' ? ['x', 'y', 'z'] : ['x', 'y'];
}

/** J1 (E5 of train 3): in the edit view the course's arrows are drawn at this share of their flight width (an estimate) */
export const EDIT_ARROW_SHARE = 1 / 3;

/** sRGB, 0..1: x red, y green, z blue, the centre light grey; under the mouse and dragged: yellow */
export const AXIS_RGB = {
    x: [0.96, 0.16, 0.16],
    y: [0.18, 0.84, 0.18],
    z: [0.16, 0.42, 1],
    centre: [0.9, 0.9, 0.9],
    hover: [1, 0.86, 0.08]
} as const;

/**
 * The gizmo's `size` that makes one of its units UNIT_PX CSS px. PlayCanvas 2.23.2 Gizmo._updateScale (build/playcanvas.mjs
 * 121246): scale = tan(fov / 2) * depth * PERS_SCALE_RATIO (0.3) * size, so a unit is 0.3 * size * the half extent in px
 * along which the field is given (the width with a horizontal field, else the height).
 */
export function gizmoSize(halfExtentPx: number, ratio = 0.3): number {
    return halfExtentPx > 0 ? UNIT_PX / (ratio * halfExtentPx) : 1;
}

/** a size in CSS px as the gizmo's units */
export const units = (px: number): number => px / UNIT_PX;

/**
 * I3 (D2): a PlayCanvas 2.23.2 transform gizmo draws its axis guide (a line across the whole view) also for the axis under
 * the mouse (prerender -> _drawGuideLines, build/playcanvas.mjs 121750, 122452), so after a Move drag the pointer resting
 * on the X arrow kept a red line across the view. Wrap it so the guide is drawn only while a handle is dragged (Blender).
 */
export function guideOnlyWhileDragging(gizmo: unknown): void {
    const g = gizmo as { _dragging?: boolean; _drawGuideLines?: (...a: unknown[]) => void };
    const draw = g._drawGuideLines?.bind(gizmo);
    if (!draw) return;
    g._drawGuideLines = (...a: unknown[]): void => {
        if (g._dragging) draw(...a);
    };
}
