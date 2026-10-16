// Touch pad geometry (docs/wip/v08-a.md section 3; the owner's message 21, item 2). Pure: Node tests
// compare it with a radio's mapping.
//
// A radio's stick is where the thumb finds it: touching it never moves it. v0.7's pads were absolute
// (the pad's centre was the stick's centre), so a finger landing off-centre was an instant step on
// that stick, and every new touch on the left pad set the throttle to wherever the thumb landed.
// The grab below keeps the stick's value under the finger at touch-down (for a spring axis that is
// "the touch point is the centre", for the sticky throttle "the throttle stays"), and from there the
// finger moves the stick by the same amount per pixel as before: full deflection at PAD_TRAVEL px.

/** The knob's half size: full deflection is the pad's half width minus this (v0.7: 24 px). */
export const KNOB_HALF_PX = 24;

/** Full-deflection travel of a pad `widthPx` wide, px. */
export function padTravel(widthPx: number): number {
    return Math.max(8, widthPx / 2 - KNOB_HALF_PX);
}

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** One finger on one pad: where its zero is, in client pixels. */
export class PadGrab {
    ox = 0;
    oy = 0;

    /**
     * Touch-down at (px, py) with the stick now at (curX, curY) (-1..1, y up): the origin goes where
     * the stick's centre must be for the stick to read exactly (curX, curY) under the finger.
     */
    grab(px: number, py: number, curX: number, curY: number, travel: number): void {
        this.ox = px - curX * travel;
        this.oy = py + curY * travel;
    }

    /** The stick (x right, y up; each -1..1, clamped per axis like a radio's square gimbal) for the finger at (px, py). */
    read(px: number, py: number, travel: number): [number, number] {
        return [clamp1((px - this.ox) / travel), clamp1(-(py - this.oy) / travel)];
    }
}

/** v0.7's absolute pad (the pad's centre is the stick's centre): the tests' negative control. */
export function absoluteRead(px: number, py: number, cx: number, cy: number, travel: number): [number, number] {
    return [clamp1((px - cx) / travel), clamp1(-(py - cy) / travel)];
}
