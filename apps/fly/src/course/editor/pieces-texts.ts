// The words of lane edit4c (course editor content: live warnings, pieces), as keys of the locale folder
// packages/i18n/locales/fly/course-pieces (en es pl ru, keys course.piece.*). Pure: no DOM, no i18n; the page turns a
// TextRef into words with t(), the unit test checks the keys against the four locale files.
import type { Warning, WarningCode } from './warn';
import { LEG_LONG_M } from './warn';

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

/** Every key this lane uses (the unit test finds each in en es pl ru). */
export const PIECE_KEYS: readonly string[] = [
    ...Object.values(WARN_KEYS),
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
