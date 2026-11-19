// The words of lane edit4c (course editor content: live warnings, pieces), as keys of the locale folder
// packages/i18n/locales/fly/course-pieces (en es pl ru, keys course.piece.*). Pure: no DOM, no i18n; the page turns a
// TextRef into words with t(), the unit test checks the keys against the four locale files.
import type { Warning, WarningCode } from './warn';
import { LEG_LONG_M } from './warn';
import { PIECES, type PieceKind } from '@gsfpv/tracks';

/** A text to show: its locale key and the values put into it. */
export interface TextRef {
    readonly key: string;
    readonly vars?: Record<string, string | number>;
}

/** The words of each warning (gate numbers count from 1 as the gate line does; -1 is the start). */
export const WARN_KEYS: Readonly<Record<WarningCode, string>> = {
    'sharp-turn': 'course.piece.warn.sharpTurn',
    'too-close': 'course.piece.warn.tooClose',
    'wall-in-opening': 'course.piece.warn.wallInOpening',
    'leg-long': 'course.piece.warn.legLong',
    'leg-wall': 'course.piece.warn.legWall'
};
/** leg-wall from the start (no gate before the first one) */
export const WARN_LEG_WALL_START_KEY = 'course.piece.warn.legWallStart';
/** the question on a release with a warning, its two answers and its cross */
export const ASK_KEY = 'course.piece.ask';
export const KEEP_KEY = 'course.piece.keep';
export const PUT_BACK_KEY = 'course.piece.putBack';
export const CLOSE_KEY = 'course.piece.close';
/** what the page says after the gate was kept (a press on Keep, the cross, or no answer in time) */
export const KEPT_KEY = 'course.piece.kept';
/** the tag's last line when more warnings than it shows stand */
export const MORE_KEY = 'course.piece.more';

/** C2: what Add puts: a plain gate or a ready piece (packages/tracks pieces.ts) */
export type AddChoice = 'gate' | PieceKind;
/** C2: the choices of the Add list, in its order: a plain gate first, then the pieces of the table */
export const ADD_CHOICES: readonly AddChoice[] = ['gate', ...PIECES.map((p) => p.kind)];
/** C2: the Add list's title and the name of each choice */
export const ADD_TITLE_KEY = 'course.piece.addTitle';
/** C2: the Add list's cross (adding ends) */
export const ADD_CLOSE_KEY = 'course.piece.addClose';
export const ADD_CHOICE_KEYS: Readonly<Record<AddChoice, string>> = {
    gate: 'course.piece.item.gate',
    'double-vertical': 'course.piece.item.doubleVertical',
    'triple-vertical': 'course.piece.item.tripleVertical',
    'double-horizontal': 'course.piece.item.doubleHorizontal',
    'triple-horizontal': 'course.piece.item.tripleHorizontal'
};
/** C2: the top bar's line while a piece is chosen (where to click), and what a placed piece did */
export const PIECE_HINT_KEY = 'course.piece.hint';
export const PIECE_ADDED_KEY = 'course.piece.added';

/** Every key this lane uses (the unit test finds each in en es pl ru). */
export const PIECE_KEYS: readonly string[] = [
    ...Object.values(WARN_KEYS),
    ADD_TITLE_KEY,
    ADD_CLOSE_KEY,
    ...Object.values(ADD_CHOICE_KEYS),
    PIECE_HINT_KEY,
    PIECE_ADDED_KEY,
    WARN_LEG_WALL_START_KEY,
    ASK_KEY,
    KEEP_KEY,
    PUT_BACK_KEY,
    CLOSE_KEY,
    KEPT_KEY,
    MORE_KEY
];

/** the warnings a tag shows at most (the rest as 'and N more') */
export const TAG_LINES = 2;

/** The text of one warning. */
export function warnText(w: Warning): TextRef {
    const gate = w.gate + 1;
    const other = (w.other ?? -1) + 1;
    if (w.code === 'leg-wall' && w.gate < 0) return { key: WARN_LEG_WALL_START_KEY, vars: { other } };
    if (w.code === 'leg-long') return { key: WARN_KEYS[w.code], vars: { gate, other, max: LEG_LONG_M } };
    if (w.code === 'too-close' || w.code === 'leg-wall') return { key: WARN_KEYS[w.code], vars: { gate, other } };
    return { key: WARN_KEYS[w.code], vars: { gate } };
}

/** The tag's lines for a list of warnings: at most TAG_LINES of them, then 'and N more'; none for no warning. */
export function warnLines(ws: readonly Warning[]): TextRef[] {
    const out = ws.slice(0, TAG_LINES).map(warnText);
    if (ws.length > TAG_LINES) out.push({ key: MORE_KEY, vars: { n: ws.length - TAG_LINES } });
    return out;
}
