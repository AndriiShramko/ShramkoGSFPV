// Lane edit4s (train 4, complaint E9): the words of a failed save. Every case says what happened, that the course is kept
// (as a draft in this browser, drafts.ts), and what to do; the old line 'not saved this time, press save again' threw the
// reason away. Pure: builtin/course.ts shows the words, outlines the field or points at the gate, and offers Save again.
import { NAME_EXTRA, NAME_LEN, TITLE_EXTRA, TITLE_LEN, textIssues } from '@gsfpv/tracks';
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
