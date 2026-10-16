// Touch pad geometry (docs/wip/v08-a.md section 3; the owner's message 21, item 2). Pure: Node tests
// compare it with a radio's mapping.
//
// A radio's stick is where the thumb finds it: touching it never moves it. v0.7's pads were absolute
// (the pad's centre was the stick's centre), so a finger landing off-centre was an instant step on
// that stick, and every new touch on the left pad set the throttle to wherever the thumb landed.
// The grab below keeps the stick's value under the finger at touch-down (for a spring axis that is
// "the touch point is the centre", for the sticky throttle "the throttle stays"), and from there the
// finger moves the stick by the same amount per pixel as a radio's gimbal: full deflection at the
// travel (the pad's half width minus the knob).
//
// The screen's edge: the pads sit 24 px from the edges, so a finger landing on a pad's outer rim had
// less room toward the edge than the travel (on a 375 px phone about half of full stick; the review
// of 2026-10-16). Per side, the distance to full deflection is the radio's, unless the screen cuts
// it: then full deflection is where the finger reaches the screen's edge (SCREEN_EDGE_PX in), so it
// is always reachable, and the touch-down still moves nothing. A finger landing well inside the
// screen has the radio's travel on every side.
//
// The knob (devices/touch.ts) shows the stick's position on its pad, as a radio's gimbal would: it
// is the value, not the finger.

/** The knob's half size: full deflection is the pad's half width minus this (v0.7: 24 px). */
export const KNOB_HALF_PX = 24;

/** A thumb's touch point stops about this far from the screen's edge, px. */
export const SCREEN_EDGE_PX = 8;

/** A side never gets a shorter way to full deflection than this, px (the screen edge nearer than that: a touch outside the pads). */
const MIN_SIDE_PX = 8;

/** Full-deflection travel of a pad `widthPx` wide, px. */
export function padTravel(widthPx: number): number {
    return Math.max(8, widthPx / 2 - KNOB_HALF_PX);
}

/** The part of the screen a finger can reach, client px. */
export interface Reach { left: number; top: number; right: number; bottom: number }

/** The reach of a window `w` x `h` px. */
export function reachOf(w: number, h: number): Reach {
    return { left: SCREEN_EDGE_PX, top: SCREEN_EDGE_PX, right: w - SCREEN_EDGE_PX, bottom: h - SCREEN_EDGE_PX };
}

/** No screen edge: the radio's travel on every side (the tests' first-grab control). */
export const UNBOUNDED: Reach = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

/** One axis of a grab: the finger's coordinate at touch-down, the stick there, the distance to +1 and to -1. */
interface Axis { at: number; v: number; toMax: number; toMin: number; dir: 1 | -1 }

/**
 * An axis grabbed at `at` px with the stick at `v`. `dir` +1: the stick grows with the coordinate
 * (x, right); -1: it grows as the coordinate falls (y, up). `low` / `high`: the reach on this axis.
 */
function grabAxis(at: number, v: number, travel: number, low: number, high: number, dir: 1 | -1): Axis {
    const side = (need: number, room: number): number => (need <= 0 ? 0 : Math.max(Math.min(need, room), Math.min(need, MIN_SIDE_PX)));
    const roomUp = dir > 0 ? high - at : at - low; // px toward +1
    const roomDown = dir > 0 ? at - low : high - at; // px toward -1
    return { at, v, dir, toMax: side((1 - v) * travel, roomUp), toMin: side((1 + v) * travel, roomDown) };
}

function readAxis(a: Axis, p: number): number {
    const u = (p - a.at) * a.dir; // px toward +1
    if (u >= 0) return a.toMax > 0 ? a.v + (1 - a.v) * Math.min(1, u / a.toMax) : a.v;
    return a.toMin > 0 ? a.v - (1 + a.v) * Math.min(1, -u / a.toMin) : a.v;
}

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** One finger on one pad: where it landed and how far each side's full deflection is. */
export class PadGrab {
    private x: Axis = { at: 0, v: 0, toMax: 1, toMin: 1, dir: 1 };
    private y: Axis = { at: 0, v: 0, toMax: 1, toMin: 1, dir: -1 };

    /**
     * Touch-down at (px, py) with the stick now at (curX, curY) (-1..1, y up): that value stays under
     * the finger; full deflection is `travel` px away per side, or the edge of `reach` where nearer.
     */
    grab(px: number, py: number, curX: number, curY: number, travel: number, reach: Reach): void {
        this.x = grabAxis(px, clamp1(curX), travel, reach.left, reach.right, 1);
        this.y = grabAxis(py, clamp1(curY), travel, reach.top, reach.bottom, -1);
    }

    /** The stick (x right, y up; each -1..1, per axis like a radio's square gimbal) for the finger at (px, py). */
    read(px: number, py: number): [number, number] {
        return [readAxis(this.x, px), readAxis(this.y, py)];
    }
}

/** v0.7's absolute pad (the pad's centre is the stick's centre): the tests' negative control. */
export function absoluteRead(px: number, py: number, cx: number, cy: number, travel: number): [number, number] {
    return [clamp1((px - cx) / travel), clamp1(-(py - cy) / travel)];
}
