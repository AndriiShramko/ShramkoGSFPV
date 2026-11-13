// The course editor's own key table (tracks-plan.md 2.11, lane tracks, train 2, stage T3-editor-ui). While the editor is open
// the page's key router is blocked (ctx.keys.block) and these keys go to the editor only, so no global letter is taken. Pure:
// a key press (code and modifiers) and the view's heading become an editing action of packages/tracks/src/editor.ts or one of
// the editor's commands. The panel's buttons run the same rows (KEY_ROWS), so the mouse and the keyboard do the same things.
import type { EditAction } from '@gsfpv/tracks';

export type EditorCommand = 'save-mine' | 'save-all' | 'exit' | 'regen' | 'regen-same';

export type EditorKey = { readonly edit: EditAction } | { readonly cmd: EditorCommand };

export interface KeyPress {
    readonly code: string;
    readonly shiftKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly altKey?: boolean;
}

/** a big step of the arrows (Shift), flown m (tracks-plan 2.11) */
export const BIG_STEP_M = 1;

/**
 * The flown horizontal axis nearest to a direction (x, z): arrows move a gate "relative to the view" by the world axis the
 * view looks along most, so one press is always one clean step of the editing model.
 */
export function nearestAxis(dx: number, dz: number): { axis: 0 | 2; sign: 1 | -1 } {
    if (Math.abs(dx) > Math.abs(dz)) return { axis: 0, sign: dx >= 0 ? 1 : -1 };
    return { axis: 2, sign: dz >= 0 ? 1 : -1 };
}

/** The view's forward on the floor from a quaternion (w, x, y, z): the body's -Z turned by it, y dropped. */
export function forwardOf(qw: number, qx: number, qy: number, qz: number): [number, number] {
    // R * (0, 0, -1): the third column of the rotation matrix, negated
    const fx = -2 * (qx * qz + qw * qy);
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    return [fx, fz];
}

/** One arrow: ArrowUp forward, ArrowDown back, ArrowRight right, ArrowLeft left of a view looking along (fx, fz). */
export function arrowMove(code: string, fx: number, fz: number, big: boolean): EditAction | null {
    // right of forward (fx, fz) on the floor seen from above, y up: (-fz, fx)
    const dir: Record<string, [number, number]> = { ArrowUp: [fx, fz], ArrowDown: [-fx, -fz], ArrowRight: [-fz, fx], ArrowLeft: [fz, -fx] };
    const d = dir[code];
    if (!d) return null;
    const { axis, sign } = nearestAxis(d[0], d[1]);
    return big ? { kind: 'move', axis, steps: sign, stepM: BIG_STEP_M } : { kind: 'move', axis, steps: sign };
}

/** The editor's meaning of a key press, or null (the key does nothing in the editor). */
export function editorKey(e: KeyPress, forward: readonly [number, number]): EditorKey | null {
    const shift = !!e.shiftKey;
    const mod = !!(e.ctrlKey || e.metaKey);
    if (e.altKey) return null;
    if (mod) {
        if (e.code === 'KeyZ') return { edit: { kind: shift ? 'redo' : 'undo' } };
        if (e.code === 'KeyY') return { edit: { kind: 'redo' } };
        if (e.code === 'KeyS') return { cmd: 'save-mine' };
        return null;
    }
    const arrow = arrowMove(e.code, forward[0], forward[1], shift);
    if (arrow) return { edit: arrow };
    switch (e.code) {
        case 'Tab': return { edit: { kind: 'select-step', step: shift ? -1 : 1 } };
        case 'PageUp': return { edit: shift ? { kind: 'move', axis: 1, steps: 1, stepM: BIG_STEP_M } : { kind: 'move', axis: 1, steps: 1 } };
        case 'PageDown': return { edit: shift ? { kind: 'move', axis: 1, steps: -1, stepM: BIG_STEP_M } : { kind: 'move', axis: 1, steps: -1 } };
        case 'KeyQ': return { edit: { kind: 'turn', steps: -1 } };
        case 'KeyE': return { edit: { kind: 'turn', steps: 1 } };
        case 'Digit1': case 'Numpad1': return { edit: { kind: 'shape', to: 'ring' } };
        case 'Digit2': case 'Numpad2': return { edit: { kind: 'shape', to: 'square' } };
        case 'Digit3': case 'Numpad3': return { edit: { kind: 'dive' } };
        case 'Digit4': case 'Numpad4': return { edit: { kind: 'shape', to: 'cube-frame' } };
        case 'Equal': case 'NumpadAdd': return { edit: { kind: 'size', steps: 1 } };
        case 'Minus': case 'NumpadSubtract': return { edit: { kind: 'size', steps: -1 } };
        case 'Insert': case 'KeyI': return { edit: { kind: 'insert' } };
        case 'Delete': case 'Backspace': return { edit: { kind: 'delete' } };
        case 'Comma': return { edit: { kind: 'order', step: -1 } };
        case 'Period': return { edit: { kind: 'order', step: 1 } };
        case 'KeyG': return { cmd: shift ? 'regen-same' : 'regen' };
        case 'Enter': case 'NumpadEnter': return { cmd: 'save-mine' };
        case 'Escape': return { cmd: 'exit' };
        default: return null;
    }
}

/**
 * The rows the panel shows and the mouse clicks: the key caps (plain ASCII names, the same in every language) and the
 * locale key of what the row does. `press` is the key press the row stands for (a click runs editorKey on it).
 */
export const KEY_ROWS: readonly { readonly caps: string; readonly labelKey: string; readonly press: KeyPress }[] = [
    { caps: 'Tab', labelKey: 'course.edit.key.next', press: { code: 'Tab' } },
    { caps: 'Shift+Tab', labelKey: 'course.edit.key.prev', press: { code: 'Tab', shiftKey: true } },
    { caps: 'Up', labelKey: 'course.edit.key.forward', press: { code: 'ArrowUp' } },
    { caps: 'Down', labelKey: 'course.edit.key.back', press: { code: 'ArrowDown' } },
    { caps: 'Left', labelKey: 'course.edit.key.left', press: { code: 'ArrowLeft' } },
    { caps: 'Right', labelKey: 'course.edit.key.right', press: { code: 'ArrowRight' } },
    { caps: 'PgUp', labelKey: 'course.edit.key.up', press: { code: 'PageUp' } },
    { caps: 'PgDn', labelKey: 'course.edit.key.down', press: { code: 'PageDown' } },
    { caps: 'Q', labelKey: 'course.edit.key.turnLeft', press: { code: 'KeyQ' } },
    { caps: 'E', labelKey: 'course.edit.key.turnRight', press: { code: 'KeyE' } },
    { caps: '1', labelKey: 'course.edit.key.ring', press: { code: 'Digit1' } },
    { caps: '2', labelKey: 'course.edit.key.square', press: { code: 'Digit2' } },
    { caps: '3', labelKey: 'course.edit.key.dive', press: { code: 'Digit3' } },
    { caps: '4', labelKey: 'course.edit.key.cube', press: { code: 'Digit4' } },
    { caps: '+', labelKey: 'course.edit.key.bigger', press: { code: 'Equal' } },
    { caps: '-', labelKey: 'course.edit.key.smaller', press: { code: 'Minus' } },
    { caps: 'Ins / I', labelKey: 'course.edit.key.insert', press: { code: 'Insert' } },
    { caps: 'Del', labelKey: 'course.edit.key.delete', press: { code: 'Delete' } },
    { caps: ', .', labelKey: 'course.edit.key.order', press: { code: 'Period' } },
    { caps: 'Ctrl+Z', labelKey: 'course.edit.key.undo', press: { code: 'KeyZ', ctrlKey: true } },
    { caps: 'Ctrl+Y', labelKey: 'course.edit.key.redo', press: { code: 'KeyY', ctrlKey: true } },
    { caps: 'G', labelKey: 'course.edit.key.regen', press: { code: 'KeyG' } },
    { caps: 'Esc', labelKey: 'course.edit.key.exit', press: { code: 'Escape' } }
];
