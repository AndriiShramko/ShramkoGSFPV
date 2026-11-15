// Lane editor3 E4: one press belongs to one handle. The move, turn and scale handles of PlayCanvas 2.23.2 all listen on the
// canvas and each starts its own drag when its own shapes are under the cursor; a gizmo's stopPropagation does not stop the
// others on the same element. Near the centre the move handle's planes and the scale box overlap, so a press on the centre
// box started both: the move ended first, the course took the moved gate and put the stand-in back to scale 1, and the scale
// drag's end read a factor of 1 (E2 smoke on Wroclaw: the gate moved 0.3 m, the opening stayed). The owner of a press is
// the first handle in PRESS_ORDER with a shape under the cursor; the others are switched off until the button goes up.

/** the order the handles are asked in: the scale box (the centre) first, then the move arrows and planes, then the rings */
export const PRESS_ORDER = ['size', 'move', 'turn'] as const;

/** index of the handle that owns a press (hits in PRESS_ORDER), -1 when none is under the cursor */
export function pressOwner(hits: readonly boolean[]): number {
    for (let i = 0; i < hits.length; i++) if (hits[i]) return i;
    return -1;
}
