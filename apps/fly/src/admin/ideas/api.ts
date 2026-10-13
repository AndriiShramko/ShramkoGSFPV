// The admin's ideas API, typed: every pilot's idea, bug and the owner's notes in one store (lane B,
// apps/api), with the kanban status, urgency, comments, the public roadmap text and the e-mails sent.
// This module is the only place that knows the paths and bodies (IDEAS_ROUTES); the contract it assumes
// is written down in docs/wip/v07-c.md, so reconciling it with the server is a change here only.
// No DOM, no i18n: the kanban model and the tests run in Node (tools/bench/test/admin-ideas.test.ts).
import type { LocalText } from '@gsfpv/scenes';
import type { AdminClient } from '../api';

/** Kanban columns in board order: New, Accepted (the work queue), In progress, Done, Rejected. */
export const IDEA_STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Least to most urgent. */
export const URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Urgency = (typeof URGENCIES)[number];
/** idea / bug: a pilot's report; note: the owner's words (Telegram); feature: the roadmap seed. */
export const IDEA_KINDS = ['idea', 'bug', 'note', 'feature'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];
/** The languages of the public title (the landing's). */
export const PUBLIC_LANGS = ['en', 'es', 'pl', 'ru'] as const;
export type PublicLang = (typeof PUBLIC_LANGS)[number];

/** A comment of the owner's (from this page or from Telegram). */
export interface IdeaComment { ts: string; text: string; via: string }
/** An e-mail the server sent about this idea. */
export interface IdeaMail { ts: string; kind: 'reply' | 'thanks'; to: string; ok: boolean }
/** What the landing shows: the title in four languages, whether it is on the roadmap, its group there. */
export interface IdeaPublic { title: LocalText; roadmap: boolean; group: string | null }

/** One card of the kanban, every optional field of the store filled with its empty value. */
export interface Idea {
    id: string;
    kind: IdeaKind;
    status: IdeaStatus;
    urgency: Urgency;
    /** created (ISO) */
    ts: string;
    /** the pilot's words, or the owner's note: private, never on the landing */
    text: string;
    /** a pilot suggested it (a report, or the owner writing down what a pilot told him) */
    fromPilot: boolean;
    /** everything the pilot sent with it ('' when not given) */
    locale: string;
    page: string;
    scene: string;
    release: string;
    contact: string;
    suspect: boolean;
    /** a bug's technical details: stored (true), not stored for lack of room ('skipped'), none (false) */
    diagnostics: boolean | 'skipped';
    comments: IdeaComment[];
    public: IdeaPublic;
    /** position in its column, smaller first (null: by date) */
    order: number | null;
    /** when it was done (ISO), null while not done */
    done: string | null;
    mails: IdeaMail[];
}

/** A thank-you e-mail as the server drafts it; nothing is sent until `sendThanks`. */
export interface ThanksDraft { to: string; lang: string; subject: string; body: string }

/** Paths under /api/admin/ and their methods (docs/wip/v07-c.md, "Admin ideas API"). */
export const IDEAS_ROUTES = {
    list: 'ideas',
    status: 'ideas/status',
    urgency: 'ideas/urgency',
    comment: 'ideas/comment',
    public: 'ideas/public',
    reply: 'ideas/reply',
    thanksDraft: 'ideas/thanks/draft',
    thanksSend: 'ideas/thanks/send'
} as const;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function localText(v: unknown): LocalText {
    const out: LocalText = {};
    if (v && typeof v === 'object') for (const l of PUBLIC_LANGS) { const s = (v as Record<string, unknown>)[l]; if (typeof s === 'string' && s.trim()) out[l] = s; }
    return out;
}

/** One record of the store as the board uses it, or null when it cannot be placed (no id, unknown status or kind). */
export function parseIdea(raw: unknown): Idea | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id) || !isOneOf(IDEA_STATUSES, o.status) || !isOneOf(IDEA_KINDS, o.kind)) return null;
    const pub = (o.public && typeof o.public === 'object' ? o.public : {}) as Record<string, unknown>;
    return {
        id: o.id,
        kind: o.kind,
        status: o.status,
        urgency: isOneOf(URGENCIES, o.urgency) ? o.urgency : 'normal',
        ts: str(o.ts),
        text: str(o.text),
        fromPilot: o.fromPilot === true,
        locale: str(o.locale),
        page: str(o.page),
        scene: str(o.scene),
        release: str(o.release),
        contact: str(o.contact),
        suspect: o.suspect === true,
        diagnostics: o.diagnostics === true ? true : o.diagnostics === 'skipped' ? 'skipped' : false,
        comments: Array.isArray(o.comments) ? o.comments.filter((c) => c && typeof c === 'object').map((c) => ({ ts: str(c.ts), text: str(c.text), via: str(c.via) })) : [],
        public: { title: localText(pub.title), roadmap: pub.roadmap === true, group: typeof pub.group === 'string' && pub.group ? pub.group : null },
        order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : null,
        done: typeof o.done === 'string' && o.done ? o.done : null,
        mails: Array.isArray(o.mails)
            ? o.mails.filter((m) => m && typeof m === 'object' && (m.kind === 'reply' || m.kind === 'thanks')).map((m) => ({ ts: str(m.ts), kind: m.kind as 'reply' | 'thanks', to: str(m.to), ok: m.ok === true }))
            : []
    };
}

/** The list answer: the records the board can place, and how many it could not (shown, never guessed). */
export function parseIdeas(raw: unknown): { ideas: Idea[]; unreadable: number } {
    const list = raw && typeof raw === 'object' ? (raw as { ideas?: unknown }).ideas : undefined;
    if (!Array.isArray(list)) throw new Error('the server sent no list of ideas');
    const ideas: Idea[] = [];
    const seen = new Set<string>();
    let unreadable = 0;
    for (const r of list) {
        const i = parseIdea(r);
        if (!i || seen.has(i.id)) { unreadable++; continue; }
        seen.add(i.id);
        ideas.push(i);
    }
    return { ideas, unreadable };
}

/** Where a bug's stored technical details are served (the admin's existing route). */
export const diagnosticsUrl = (id: string): string => `/api/admin/reports/${encodeURIComponent(id)}/diagnostics`;

/** The ideas half of the admin API over the admin's session (AdminClient: cookie, CSRF, 401 -> login). */
export class IdeasClient {
    constructor(private readonly api: Pick<AdminClient, 'get' | 'post'>) {}

    async list(): Promise<{ ideas: Idea[]; unreadable: number }> {
        return parseIdeas(await this.api.get<unknown>(IDEAS_ROUTES.list));
    }

    /** A kanban move. */
    setStatus(id: string, status: IdeaStatus): Promise<Idea> {
        return this.one(IDEAS_ROUTES.status, { id, status });
    }

    setUrgency(id: string, urgency: Urgency): Promise<Idea> {
        return this.one(IDEAS_ROUTES.urgency, { id, urgency });
    }

    comment(id: string, text: string): Promise<Idea> {
        return this.one(IDEAS_ROUTES.comment, { id, text });
    }

    /** The landing's title (4 languages), whether the idea is on the roadmap and in which group. */
    setPublic(id: string, pub: IdeaPublic): Promise<Idea> {
        return this.one(IDEAS_ROUTES.public, { id, title: pub.title, roadmap: pub.roadmap, group: pub.group });
    }

    /** E-mail the pilot the owner's answer (the server quotes the pilot's words). */
    reply(id: string, text: string): Promise<Idea> {
        return this.one(IDEAS_ROUTES.reply, { id, text });
    }

    /** The server's draft of the thank-you e-mail; sends nothing. */
    async thanksDraft(id: string): Promise<ThanksDraft> {
        const r = await this.api.post<Partial<ThanksDraft>>(IDEAS_ROUTES.thanksDraft, { id });
        return { to: str(r.to), lang: str(r.lang), subject: str(r.subject), body: str(r.body) };
    }

    /** Sends the thank-you e-mail as the owner left it in the dialog. */
    sendThanks(id: string, subject: string, body: string): Promise<Idea> {
        return this.one(IDEAS_ROUTES.thanksSend, { id, subject, body });
    }

    private async one(path: string, body: Record<string, unknown>): Promise<Idea> {
        const r = await this.api.post<{ idea?: unknown }>(path, body);
        const idea = parseIdea(r.idea);
        if (!idea) throw new Error('the server answered without the idea');
        return idea;
    }
}
