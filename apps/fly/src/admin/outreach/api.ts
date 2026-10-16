// The Outreach tab's data, typed (apps/api/outreach.py: GET /api/admin/outreach and export.csv). The vault
// holds the truth and pushes one snapshot to the server; the server works out the score, the totals, the
// funnel, the medians and the due list, and this tab draws them: no write goes back (there is no route),
// so this module only reads. No DOM, no i18n: model.ts and its tests run in Node
// (tools/bench/test/admin-outreach.test.ts).
import type { AdminClient } from '../api';

/** Slices the server works out (apps/api/outreach.py build_view `slices`). */
export const SLICE_MODES = ['format', 'lang', 'topic', 'kind', 'format_lang_topic'] as const;
export type SliceMode = (typeof SLICE_MODES)[number];

/** The checkpoints after a post (hours): +1 h, +24 h, +72 h, +7 d, +30 d. */
export const CHECKPOINTS_H = [1, 24, 72, 168, 720] as const;

export interface Policy { video: string | null; images: string | null; links: string | null; self_promo: string | null; post_approval: string | null }

export interface GroupRow {
    id: string; name: string; url: string | null; lang: string | null; members: number | null; topic: string | null;
    fit: number | null; verdict: string | null; wave: number | null; policy: Policy; state: string; prior_sim_post: string | null;
    last_post_at: string | null; posts: number; published: number; removed: number; best_reactions: number; best_comments: number;
    /** worked out by the server from the formula in the spec (the pushed score is kept as score_pushed) */
    score: number | null; score_pushed: number | null; eng: number; pub_rate: number | null; removed_rate: number | null;
    worth: boolean; due_n: number; note: string | null;
}

export interface CheckRow { age_h: number; state: string | null; reactions: number; comments: number; shares: number; views: number | null; admin_action: string }

export interface PostRow {
    id: string; group: string; group_name: string; kind: string; format: string; lang: string | null; sent_at: string; state: string;
    url: string | null; link_placement: string | null; first_comment: string; angle: string | null; checks: CheckRow[]; note: string | null;
    topic: string | null; latest: CheckRow | null; eng: number | null; age_h: number | null;
}

export interface SliceRow {
    format?: string; lang?: string; topic?: string; kind?: string; n: number; published: number; removed: number; measured: number;
    median_reactions: number | null; median_comments: number | null; median_eng: number | null;
}

export interface Totals {
    groups: number; groups_known: number; posted: number; published: number; removed: number; banned: number; posts: number;
    posts_published: number; posts_removed: number; posts_declined: number; posts_waiting: number;
    reactions: number; comments: number; shares: number; views: number;
}

export interface RankRow { id: string; name: string; score: number; eng: number; pub_rate: number | null; removed_rate: number | null; worth: boolean }
export interface DueCheck { post: string; group: string; name: string; state: string; age_h: number; due_cp_h: number; next_cp_h: number | null }
export interface Unresolved { post: string; group: string; name: string; state: string; age_h: number | null }
export interface ReadyGroup { id: string; name: string; verdict: string | null; fit: number | null; members: number | null; lang: string | null; topic: string | null }
export interface Visits { days: number; by_content: Record<string, number>; note: string | null; total: number }

/** A snapshot is stored and worked out. */
export interface OutreachView {
    empty: false; unreadable: false; campaign: string; generated: string; received: string; age_h: number | null; stale: boolean;
    meta: { groups_total: number; groups_researched: number; waves: number }; worth_min: number; totals: Totals;
    funnel: { stage: 'groups' | 'posted' | 'published' | 'removed'; n: number }[]; groups: GroupRow[]; posts: PostRow[];
    slices: Record<SliceMode, SliceRow[]>; ranking: RankRow[];
    due: { checks: DueCheck[]; unresolved: Unresolved[]; ready: ReadyGroup[] }; visits: Visits | null;
}
/** Nothing stored yet (or the file cannot be read: the next push restores it). */
export interface OutreachEmpty { empty: true; unreadable: boolean }
export type OutreachAnswer = OutreachView | OutreachEmpty;

/** The answer of GET /api/admin/outreach; anything that is not the documented shape is an error, never guessed. */
export function parseAnswer(j: unknown): OutreachAnswer {
    const o = j as Record<string, unknown> | null;
    if (!o || o.ok !== true) throw new Error('outreach: unexpected answer');
    if (o.empty === true) return { empty: true, unreadable: o.unreadable === true };
    for (const k of ['groups', 'posts'] as const) if (!Array.isArray(o[k])) throw new Error(`outreach: ${k} is not a list`);
    for (const k of ['totals', 'slices', 'due', 'meta'] as const) if (typeof o[k] !== 'object' || o[k] === null) throw new Error(`outreach: ${k} is missing`);
    if (!Array.isArray(o.funnel) || !Array.isArray(o.ranking)) throw new Error('outreach: funnel or ranking is missing');
    return o as unknown as OutreachView;
}

/** The CSV route; the browser downloads it as an attachment (the session cookie goes with the click). */
export const csvPath = (table: 'groups' | 'posts'): string => `/api/admin/outreach/export.csv?table=${table}`;

export class OutreachClient {
    constructor(private readonly api: AdminClient) {}

    async view(): Promise<OutreachAnswer> {
        return parseAnswer(await this.api.get<unknown>('outreach'));
    }
}
