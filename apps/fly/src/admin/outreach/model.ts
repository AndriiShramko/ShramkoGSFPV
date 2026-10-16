// The Outreach tab as a model, no DOM: how the groups and posts are sorted, filtered and searched, which
// checkpoint a measurement belongs to, what the funnel's bars are, which slice rows the picker shows. tab.ts
// draws it; tools/bench/test/admin-outreach.test.ts checks it. The numbers themselves (score, medians, due)
// are worked out by the server (apps/api/outreach.py) so that the vault's report and this tab never differ.
import { CHECKPOINTS_H } from './api';
import type { CheckRow, GroupRow, OutreachView, PostRow, SliceMode, SliceRow } from './api';

export const ANY = 'any';
/** A group or post field that is not set (null) is offered, and matched, as this value. */
export const NONE = 'none';

export type SortDir = 'asc' | 'desc';
export interface Sort { key: string; dir: SortDir }

export const GROUP_COLUMNS = ['name', 'lang', 'topic', 'members', 'fit', 'verdict', 'wave', 'state', 'posts', 'score', 'best_reactions', 'best_comments', 'last_post_at', 'note'] as const;
export type GroupColumn = (typeof GROUP_COLUMNS)[number];
export const POST_COLUMNS = ['group_name', 'kind', 'format', 'lang', 'topic', 'sent_at', 'state', 'eng'] as const;
export type PostColumn = (typeof POST_COLUMNS)[number];

/** Numbers sort largest first when a column is chosen the first time; words A to Z, the newest time first. */
const NUMERIC = new Set<string>(['members', 'fit', 'wave', 'posts', 'score', 'best_reactions', 'best_comments', 'last_post_at', 'sent_at', 'eng', 'age_h']);
export const firstDir = (key: string): SortDir => (NUMERIC.has(key) ? 'desc' : 'asc');

/** The next sort when a header is pressed: a new column starts in its natural direction, the same one flips. */
export function nextSort(cur: Sort, key: string): Sort {
    return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) };
}

type Cell = string | number | null | undefined;

/** Sorted by one value; an unset value is always last, whatever the direction; ties by name then id so that the order is stable. */
export function sortBy<T>(rows: readonly T[], value: (r: T) => Cell, dir: SortDir, tie: (r: T) => string): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const xn = x === null || x === undefined || x === '';
        const yn = y === null || y === undefined || y === '';
        if (xn || yn) return xn === yn ? tie(a).localeCompare(tie(b)) : xn ? 1 : -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
        return c !== 0 ? sign * c : tie(a).localeCompare(tie(b));
    });
}

export function groupValue(g: GroupRow, key: string): Cell {
    switch (key) {
        case 'posts': return g.posts;
        case 'score': return g.score;
        default: return (g as unknown as Record<string, Cell>)[key];
    }
}

export function postValue(p: PostRow, key: string): Cell {
    switch (key) {
        case 'reactions': return p.latest?.reactions;
        case 'comments': return p.latest?.comments;
        case 'shares': return p.latest?.shares;
        default: return (p as unknown as Record<string, Cell>)[key];
    }
}

export const sortGroups = (rows: readonly GroupRow[], s: Sort): GroupRow[] => sortBy(rows, (g) => groupValue(g, s.key), s.dir, (g) => `${g.name}\u0000${g.id}`);
export const sortPosts = (rows: readonly PostRow[], s: Sort): PostRow[] => sortBy(rows, (p) => postValue(p, s.key), s.dir, (p) => p.id);

export interface GroupFilter { verdict: string; state: string; lang: string; topic: string; wave: string; worthOnly: boolean; search: string }
export const ALL_GROUPS: GroupFilter = { verdict: ANY, state: ANY, lang: ANY, topic: ANY, wave: ANY, worthOnly: false, search: '' };
export interface PostFilter { state: string; format: string; lang: string; kind: string; search: string }
export const ALL_POSTS: PostFilter = { state: ANY, format: ANY, lang: ANY, kind: ANY, search: '' };

const facetOf = (v: Cell): string => (v === null || v === undefined || v === '' ? NONE : String(v));
const passes = (want: string, v: Cell): boolean => want === ANY || facetOf(v) === want;

/** Every word of the search must be found somewhere in the row. */
function wordsIn(search: string, haystack: string): boolean {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const h = haystack.toLowerCase();
    return words.every((w) => h.includes(w));
}

export function groupMatches(g: GroupRow, f: GroupFilter): boolean {
    if (!passes(f.verdict, g.verdict) || !passes(f.state, g.state) || !passes(f.lang, g.lang) || !passes(f.topic, g.topic) || !passes(f.wave, g.wave)) return false;
    if (f.worthOnly && !g.worth) return false;
    return wordsIn(f.search, [g.id, g.name, g.url, g.lang, g.topic, g.verdict, g.state, g.note, g.prior_sim_post].filter(Boolean).join('\n'));
}

export function postMatches(p: PostRow, f: PostFilter): boolean {
    if (!passes(f.state, p.state) || !passes(f.format, p.format) || !passes(f.lang, p.lang) || !passes(f.kind, p.kind)) return false;
    return wordsIn(f.search, [p.id, p.group, p.group_name, p.angle, p.note, p.topic, p.url].filter(Boolean).join('\n'));
}

/** The values a filter can take, from the rows themselves (an unset field is offered as NONE, last). */
export function facet<T>(rows: readonly T[], pick: (r: T) => Cell): string[] {
    const set = new Set(rows.map((r) => facetOf(pick(r))));
    const named = [...set].filter((v) => v !== NONE).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return set.has(NONE) ? [...named, NONE] : named;
}

/** Which measurement of a post belongs to checkpoint i (+1 h, +24 h, ...): the same windows the server's due list uses. */
export function checkFor(p: PostRow, i: number): CheckRow | null {
    const cp = CHECKPOINTS_H[i];
    const lo = cp - Math.max(0.25 * cp, 0.5);
    const hi = i + 1 < CHECKPOINTS_H.length ? CHECKPOINTS_H[i + 1] : Infinity;
    const inside = p.checks.filter((c) => c.age_h >= lo && c.age_h < hi);
    return inside.length ? inside.reduce((a, b) => (Math.abs(a.age_h - cp) <= Math.abs(b.age_h - cp) ? a : b)) : null;
}

export type CheckpointState = 'taken' | 'due' | 'missed' | 'future';

/** One cell of the checkpoint strip: taken (a measurement), due now, missed (the time passed, no measurement), or still to come. */
export function checkpointState(p: PostRow, i: number, dueCp: number | undefined): CheckpointState {
    if (checkFor(p, i)) return 'taken';
    if (dueCp === CHECKPOINTS_H[i]) return 'due';
    if (p.age_h !== null && p.age_h < CHECKPOINTS_H[i]) return 'future';
    return 'missed';
}

/** The cells of one post's strip. */
export const checkpointStrip = (p: PostRow, dueCp: number | undefined): { cp: number; state: CheckpointState; check: CheckRow | null }[] =>
    CHECKPOINTS_H.map((cp, i) => ({ cp, state: checkpointState(p, i, dueCp), check: checkFor(p, i) }));

/** The funnel's bars: width against the first stage, and the share of the stage before it (null when that one is empty). */
export function funnelBars(funnel: OutreachView['funnel']): { stage: string; n: number; width: number; ofPrev: number | null }[] {
    const first = funnel[0]?.n ?? 0;
    return funnel.map((f, i) => ({
        stage: f.stage, n: f.n, width: first > 0 ? Math.round((100 * f.n) / first) : 0,
        ofPrev: i === 0 ? null : funnel[i - 1].n > 0 ? Math.round((100 * f.n) / funnel[i - 1].n) : null
    }));
}

/** 'worth' from the server's threshold, 'ok' from 40, 'low' below it, 'none' for a group without posts. */
export function scoreBand(score: number | null, worthMin: number): 'worth' | 'ok' | 'low' | 'none' {
    if (score === null) return 'none';
    return score >= worthMin ? 'worth' : score >= 40 ? 'ok' : 'low';
}

/** The dimensions of each slice picker button. */
export const SLICE_DIMS: Record<SliceMode, readonly ('format' | 'lang' | 'topic' | 'kind')[]> = {
    format: ['format'], lang: ['lang'], topic: ['topic'], kind: ['kind'], format_lang_topic: ['format', 'lang', 'topic']
};

/** A slice row's name: its values in the dimensions' order. */
export const sliceName = (r: SliceRow, mode: SliceMode): string[] => SLICE_DIMS[mode].map((d) => r[d] ?? NONE);

/** Hours as the largest whole unit that reads well: 3 h, 2 d. */
export function ageParts(h: number | null): { n: number; unit: 'h' | 'd' } | null {
    if (h === null || !Number.isFinite(h)) return null;
    return h < 48 ? { n: Math.max(0, Math.round(h)), unit: 'h' } : { n: Math.round(h / 24), unit: 'd' };
}

/** The group ids that have a link to open (an https address only: the server refuses others, this is the second lock). */
export const safeUrl = (u: string | null): string | null => (u && /^https:\/\/[^\s]+$/.test(u) ? u : null);

/** The top visits by utm_content, largest first (a group id is the usual key; its name when known). */
export function visitRows(v: NonNullable<OutreachView['visits']>, groups: readonly GroupRow[], n = 10): { key: string; name: string | null; count: number }[] {
    const names = new Map(groups.map((g) => [g.id, g.name]));
    return Object.entries(v.by_content).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
        .map(([key, count]) => ({ key, name: names.get(key) ?? null, count }));
}
