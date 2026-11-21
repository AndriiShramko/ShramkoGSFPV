// Lane editor3 E4: one press belongs to one handle. The move, turn and scale handles of PlayCanvas 2.23.2 all listen on the
// canvas and each starts its own drag when its own shapes are under the cursor; a gizmo's stopPropagation does not stop the
// others on the same element. A press that started two of them moved the gate and lost the size change (E2 smoke on
// Wroclaw). Lane edit4a A2: all three handles are on the gate at once (the owner, brief 543), so a ring may lie in front of
// a box or an arrow on the screen: the handle whose shape under the cursor is nearest the eye owns the press, as in Blender;
// the others are switched off until the button goes up.

/** the order the handles are asked in; on an equal distance the earlier one keeps the press (the centre box first) */
export const PRESS_ORDER = ['size', 'move', 'turn'] as const;

/** index of the handle that owns a press: `dists` in PRESS_ORDER, each the distance from the eye to that handle's shape
 *  under the cursor (null: none of its shapes is there); -1 when none is under the cursor */
export function pressOwner(dists: readonly (number | null)[]): number {
    let best = -1;
    for (let i = 0; i < dists.length; i++) {
        const d = dists[i];
        if (d === null || d === undefined || !Number.isFinite(d)) continue;
        if (best < 0 || d < dists[best]!) best = i;
    }
    return best;
}
