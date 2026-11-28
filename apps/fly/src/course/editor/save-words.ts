// Lane edit4s (train 4, complaint E9): the words of a failed save. Every case says what happened, that the course is kept
// (as a draft in this browser, drafts.ts), and what to do; the old line 'not saved this time, press save again' threw the
// reason away. Pure: builtin/course.ts shows the words, outlines the field or points at the gate, and offers Save again.
import { NAME_EXTRA, NAME_LEN, SAVE_WARNING_KINDS, TITLE_EXTRA, TITLE_LEN, textIssues } from '@gsfpv/tracks';
import type { GateMove, SaveWarning, SaveWarningKind, StoreBlocker, StoreBlockerKind } from '@gsfpv/tracks';
import type { SaveProblem } from '../store';
import { clockOf } from './drafts';

/**
 * The save fields' live check (as saveMine sends them: trimmed, NFC): the key of the field's rule when the server's rule
 * (server.ts textIssues) refuses it, else null. An empty title is no problem: the save keeps the course's own title.
 */
export function fieldProblem(field: 'name' | 'title', value: string): string | null {
    const s = value.trim().normalize('NFC');
    if (field === 'title' && s === '') return null;
    const issues: string[] = [];
    if (field === 'name') textIssues('author.name', s, NAME_LEN, NAME_EXTRA, issues);
    else textIssues('title', s, TITLE_LEN, TITLE_EXTRA, issues);
    return issues.length ? `course.save.problem.${field}` : null;
}

/** what the page offers with the words */
export interface SaveAgain {
    /** the Save again button is shown; enabled from `at` (ms since 1970; null: at once) */
    at: number | null;
}

export interface SaveWords {
    key: string;
    args: Record<string, string | number>;
    /** the field to outline with its rule (the press cannot be repeated until it is right) */
    field: 'name' | 'title' | null;
    /** the gate to point at, from 1 */
    gate: number | null;
    again: SaveAgain | null;
}

/** the 429 without a Retry-After: the oldest create leaves the hour at most this long from now (tracks.py, one hour) */
export const RATE_WAIT_DEFAULT_S = 3600;

export function saveProblemWords(p: SaveProblem, nowMs: number, gates: number): SaveWords {
    const none = { field: null, gate: null, again: null } as const;
    switch (p.code) {
        case 'rate': {
            const at = nowMs + (p.retryAfterS ?? RATE_WAIT_DEFAULT_S) * 1000;
            return { ...none, key: 'course.save.problem.rate', args: { time: clockOf(at) }, again: { at } };
        }
        case 'network':
            return { ...none, key: 'course.save.problem.network', args: {}, again: { at: null } };
        case 'invalid-name':
            return { ...none, key: 'course.save.problem.name', args: {}, field: 'name' };
        case 'invalid-title':
            return { ...none, key: 'course.save.problem.title', args: {}, field: 'title' };
        case 'leg-long': {
            const a = p.gate ?? 1;
            const b = gates > 0 ? (a % gates) + 1 : 1;
            return { ...none, key: 'course.save.problem.leg', args: { a, b }, gate: a };
        }
        case 'storage':
            return { ...none, key: 'course.save.problem.storage', args: {}, again: { at: nowMs + 60_000 } };
        case 'invalid':
        case 'refused':
            return { ...none, key: 'course.save.problem.other', args: { msg: p.detail.slice(0, 120) }, again: { at: null } };
    }
}

/** the keys of save-words, in one list so the tests hold all four languages to it */
export const SAVE_WORD_KEYS: readonly string[] = [
    'course.save.problem.rate',
    'course.save.problem.network',
    'course.save.problem.name',
    'course.save.problem.title',
    'course.save.problem.leg',
    'course.save.problem.storage',
    'course.save.problem.other',
    'course.save.again',
    'course.save.againAt',
];

// Lane n-save (t7-plan Decision 1, the owner's wish 1: "save it as it is, with the errors, or fix it all in one click"):
// the words of the Save verdict (packages/tracks saveVerdict). A blocker is what the server refuses: one plain line with
// the way out. Warnings never block: the dialog counts them, one line per kind with its gates (from 1), and three buttons.

/** a sentence: its key and its arguments */
export interface Words {
    readonly key: string;
    readonly args: Record<string, string | number>;
}

/** the Save dialog's own words */
export const SAVE_ASK_KEYS = {
    title: 'course.edit.saveWarn.title',
    fixAll: 'course.edit.saveWarn.fixAll',
    asIs: 'course.edit.saveWarn.asIs',
    show: 'course.edit.saveWarn.show',
    close: 'course.edit.saveWarn.close',
    closed: 'course.edit.saveWarn.closed',
} as const;

/** one line of the dialog per warning kind */
export const WARN_KIND_KEYS: Readonly<Record<SaveWarningKind, string>> = {
    'in-scan': 'course.edit.saveWarn.kind.inScan',
    'under-ground': 'course.edit.saveWarn.kind.underGround',
    'same-place': 'course.edit.saveWarn.kind.samePlace',
    'too-close': 'course.edit.saveWarn.kind.tooClose',
    'sharp-turn': 'course.edit.saveWarn.kind.sharpTurn',
    'blocked-start': 'course.edit.saveWarn.kind.blockedStart',
    'leg-blocked': 'course.edit.saveWarn.kind.legBlocked',
    'wrong-way': 'course.edit.saveWarn.kind.wrongWay',
    'no-order': 'course.edit.saveWarn.kind.noOrder',
};

/** what the server refuses, each with its way out */
export const BLOCKER_KEYS: Readonly<Record<Exclude<StoreBlockerKind, 'name-refused'>, string>> & { readonly tooFarStart: string } = {
    'no-gates': 'course.edit.saveBlock.noGates',
    'too-many-gates': 'course.edit.saveBlock.tooManyGates',
    'gate-too-big': 'course.edit.saveBlock.gateTooBig',
    'leg-too-long': 'course.edit.saveBlock.legTooLong',
    'too-far': 'course.edit.saveBlock.tooFar',
    tooFarStart: 'course.edit.saveBlock.tooFarStart',
};

/** the line after Fix all and its Undo */
export const FIXED_KEYS = {
    moved: 'course.fix.moved',
    none: 'course.fix.none',
    left: 'course.fix.left',
    undo: 'course.fix.undo',
    undone: 'course.fix.undone',
} as const;

/** a gate id's number from 1 in `order` (the course's gate ids), 0 when it is not there */
const numberOf = (order: readonly string[], id: string): number => order.indexOf(id) + 1;
const numbers = (order: readonly string[], ids: readonly string[]): number[] => [...new Set(ids.filter((id) => id !== 'start').map((id) => numberOf(order, id)).filter((n) => n > 0))].sort((a, b) => a - b);

/** The dialog's content: the count of warnings and one line per kind, its gates from 1 ('3, 5'). */
export function saveAskWords(warnings: readonly SaveWarning[], order: readonly string[]): { title: Words; lines: (Words & { kind: SaveWarningKind })[] } {
    const kinds = SAVE_WARNING_KINDS.filter((k) => warnings.some((w) => w.kind === k));
    const lines = kinds.map((kind) => {
        const gates = numbers(order, warnings.filter((w) => w.kind === kind).flatMap((w) => (kind === 'leg-blocked' ? w.gates.slice(-1) : w.gates)));
        return { kind, key: WARN_KIND_KEYS[kind], args: { gates: gates.join(', '), n: gates.length } };
    });
    return { title: { key: SAVE_ASK_KEYS.title, args: { n: warnings.length } }, lines };
}

/** One blocker as one plain line with its way out; a refused name or title is the field's own rule. */
export function blockerWords(b: StoreBlocker, order: readonly string[]): Words & { field: 'name' | 'title' | null; gate: number | null } {
    const none = { field: null, gate: null } as const;
    const g = b.gate === undefined || b.gate === 'start' ? 0 : numberOf(order, b.gate);
    switch (b.kind) {
        case 'name-refused':
            return { key: `course.save.problem.${b.field ?? 'name'}`, args: {}, field: b.field ?? 'name', gate: null };
        case 'too-many-gates':
            return { ...none, key: BLOCKER_KEYS['too-many-gates'], args: { limit: b.limit ?? 0, extra: Math.max(1, order.length - (b.limit ?? 0)) } };
        case 'too-far':
            if (b.gate === 'start') return { ...none, key: BLOCKER_KEYS.tooFarStart, args: {} };
            return { ...none, key: BLOCKER_KEYS['too-far'], args: { g }, gate: g || null };
        case 'leg-too-long':
            return { ...none, key: BLOCKER_KEYS['leg-too-long'], args: { a: g, b: order.length > 0 ? (g % order.length) + 1 : 1, limit: b.limit ?? 0 }, gate: g || null };
        case 'gate-too-big':
            return { ...none, key: BLOCKER_KEYS['gate-too-big'], args: { g, limit: b.limit ?? 0 }, gate: g || null };
        case 'no-gates':
            return { ...none, key: BLOCKER_KEYS['no-gates'], args: {} };
    }
}

/** The line after Fix all: how many gates moved (their numbers) and what was left as it is (the kinds' lines). */
export function fixedWords(moves: readonly GateMove[], leftovers: readonly SaveWarning[], order: readonly string[]): { moved: Words; left: Words[] } {
    const gates = moves.map((m) => m.index + 1).sort((a, b) => a - b);
    const moved: Words = gates.length === 0 ? { key: FIXED_KEYS.none, args: {} } : { key: FIXED_KEYS.moved, args: { n: gates.length, gates: gates.join(', ') } };
    return { moved, left: saveAskWords(leftovers, order).lines.map((l) => ({ key: l.key, args: l.args })) };
}

/** every key of the Save verdict's words, for the four-language test */
export const SAVE_VERDICT_KEYS: readonly string[] = [...Object.values(SAVE_ASK_KEYS), ...Object.values(WARN_KIND_KEYS), ...Object.values(BLOCKER_KEYS), ...Object.values(FIXED_KEYS)];
