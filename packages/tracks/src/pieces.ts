// Ready pieces of the course editor (lane edit4c, stage C2, complaint E12; design edit4.md 5 C2). The owner's words (brief
// 545): "double vertical, triple vertical gates, flown at once along a special path; double horizontal, triple horizontal".
// A piece is a few ordinary square gates put in at once (one undo step, editor.ts EditAction 'piece'), each passed forward
// in the course order, so the lap judge (laps.ts) needs nothing new and the file format does not change. Each next gate of
// a piece faces the other way: the pilot flies through the first, turns round (a loop up for a stack, a hairpin for a row)
// and comes back through the next one. Pure.
import { quatMultiply, quatRotate } from '@shramko/sonic-fpv';
import type { Quat, Vec3 } from '@shramko/sonic-fpv';
import { SQUARE_BAR_M, SQUARE_SIDE_M } from './generate';

export type PieceKind = 'double-vertical' | 'triple-vertical' | 'double-horizontal' | 'triple-horizontal';

/** One piece: how many gates, which way they stand from the first one, and the gap between two frames (flown m). */
export interface PieceSpec {
    readonly kind: PieceKind;
    readonly count: number;
    /** 'up': stacked one over the other (flown as a loop up and back); 'side': side by side to the right (a hairpin, a slalom) */
    readonly stack: 'up' | 'side';
    readonly gapM: number;
}

/** the opening of a piece's gates, flown m: the 5 ft (1.5 m) square gate of MultiGP races, the generator's square (estimate) */
export const PIECE_OPENING_M = SQUARE_SIDE_M;
/** the bar of a piece's frames, flown m (the generator's square bar) */
export const PIECE_BAR_M = SQUARE_BAR_M;

/** The pieces, in the order of the Add chooser (gaps are estimates: a stack's frames nearly touch, a row leaves room to turn). */
export const PIECES: readonly PieceSpec[] = [
    { kind: 'double-vertical', count: 2, stack: 'up', gapM: 0.3 },
    { kind: 'triple-vertical', count: 3, stack: 'up', gapM: 0.3 },
    { kind: 'double-horizontal', count: 2, stack: 'side', gapM: 0.5 },
    { kind: 'triple-horizontal', count: 3, stack: 'side', gapM: 0.5 }
];

export function pieceSpec(kind: PieceKind): PieceSpec {
    const p = PIECES.find((x) => x.kind === kind);
    if (!p) throw new Error(`no piece ${kind}`);
    return p;
}

/** centre to centre of two neighbour gates of a piece, flown m: the opening, a bar on each side and the gap */
export function pieceStepM(spec: PieceSpec): number {
    return PIECE_OPENING_M + 2 * PIECE_BAR_M + spec.gapM;
}

/** half a turn about the vertical (w, x, y, z) */
const HALF_TURN: Quat = [0, 0, 1, 0];

/** One gate of a piece: its centre and its turn. */
export interface PiecePose {
    readonly pos: Vec3;
    readonly quat: Quat;
}

/**
 * The gates of piece `kind` whose first gate stands at `pos` turned by `quat` (the place and the angle the click gives:
 * add-place.ts placeFor). A stack goes up from it; a row goes to the first gate's right, centred on `pos`. Every second gate
 * is turned half round about the vertical. `perM` is how many units of the frame `pos` is in make one flown metre (the
 * course frame: 1 / scale); the offsets are flown metres.
 */
export function pieceLayout(kind: PieceKind, pos: Vec3, quat: Quat, perM = 1): PiecePose[] {
    const spec = pieceSpec(kind);
    const step = pieceStepM(spec) * perM;
    const dir: Vec3 = spec.stack === 'up' ? [0, 1, 0] : quatRotate(quat, [1, 0, 0]);
    const first = spec.stack === 'up' ? 0 : -(spec.count - 1) / 2;
    const out: PiecePose[] = [];
    for (let k = 0; k < spec.count; k++) {
        const d = (first + k) * step;
        out.push({ pos: [pos[0] + dir[0] * d, pos[1] + dir[1] * d, pos[2] + dir[2] * d], quat: k % 2 === 0 ? quat : quatMultiply(HALF_TURN, quat) });
    }
    return out;
}
