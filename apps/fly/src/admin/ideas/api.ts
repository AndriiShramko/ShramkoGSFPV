// The admin's ideas API, typed: every pilot's idea, bug and the owner's notes in one store (lane B:
// apps/api/ideas.py, service.py, ideas_admin.py), with the kanban status, urgency, comments, the public
// roadmap words, the "done" summary and the e-mail thread. This module is the only place that knows the
// paths and bodies (IDEAS_ROUTES, docs/wip/v07-b.md "Contracts for lane C"); the rest of the tab works on
// the `Idea` below. No DOM, no i18n: the kanban model and its tests run in Node
// (tools/bench/test/admin-ideas.test.ts, against tools/bench/src/ideas-mock.ts).
import type { LocalText } from '@gsfpv/scenes';
import type { AdminClient } from '../api';

/** Kanban columns in board order: New, Accepted (the work queue), In progress, Done, Rejected. */
export const IDEA_STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Least to most urgent; an idea may have none yet (null: the owner has not set it). */
export const URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Urgency = (typeof URGENCIES)[number];
/** idea / bug: a pilot's report; note: the owner's words (Telegram or here); feature: the roadmap seed. */
export const IDEA_KINDS = ['idea', 'bug', 'note', 'feature'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];
/** The languages of the public words and of the e-mails (the landing's). */
export const PUBLIC_LANGS = ['en', 'es', 'pl', 'ru'] as const;
export type PublicLang = (typeof PUBLIC_LANGS)[number];
/**
 * The longest public title, in characters (the landing's seed carries up to 211, es). The same limit must
 * hold in lane B's store (ideas.TITLE_MAX), the seed's contract test (apps/api/tests/test_roadmap_seed.py)
 * and the landing's parser (apps/site/src/lib/roadmap.ts TITLE_MAX); see docs/wip/v07-c.md.
 */
export const PUBLIC_TITLE_MAX = 240;

/** States of an e-mail in an idea's thread (lane B's outbox; superseded: a draft thank-you a newer one replaced). */
export const MAIL_STATES = ['draft', 'superseded', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'waiting_setup', 'no_email', 'unknown'] as const;
export type MailState = (typeof MAIL_STATES)[number];
/** States the owner may still cancel, and the ones Send (again) applies to. */
export const CANCELLABLE: ReadonlySet<MailState> = new Set(['draft', 'queued', 'waiting_setup', 'failed', 'unknown']);
export const SENDABLE: ReadonlySet<MailState> = new Set(['draft', 'waiting_setup', 'failed', 'unknown']);

/** A comment of the owner's: from this page ('admin'), Telegram, or an agent. */
export interface IdeaComment { at: string; text: string; by: string }
/** One e-mail about the idea: the owner's reply, or the thank-you when it is done. */
export interface IdeaMail {
    id: string;
    kind: 'reply' | 'done';
    to: string;
    lang: string;
    subject: string;
    /** the whole e-mail as it goes out (the quote, the signature) */
    plain: string;
    state: MailState;
    created: string;
    /** a queued e-mail waits until then (the undo window) */
    notBefore: string | null;
    sentAt: string | null;
    error: string;
}
/** What the landing shows: the title (and a short text) per language, and whether it is shown at all. */
export interface IdeaPublic { title: LocalText; text: LocalText; visible: boolean }

/** One card of the kanban, every optional field of the store filled with its empty value. */
export interface Idea {
    id: string;
    kind: IdeaKind;
    status: IdeaStatus;
    urgency: Urgency | null;
    /** created (ISO) */
    ts: string;
    /** the pilot's words, or the owner's note: private, never on the landing */
    text: string;
    /** a pilot suggested it (a report, or the owner writing down what a pilot told him); not a seeded feature */
    fromPilot: boolean;
    /** everything the pilot sent with it ('' when not given) */
    locale: string;
    page: string;
    scene: string;
    release: string;
    contact: string;
    /** the e-mail address found in the contact ('' when there is none: no reply, no thank-you) */
    email: string;
    suspect: boolean;
    /** a bug's technical details: stored (true), not stored for lack of room ('skipped'), none (false) */
    diagnostics: boolean | 'skipped';
    comments: IdeaComment[];
    public: IdeaPublic;
    /** position among the seeded features (null: by date) */
    order: number | null;
    /** when it was done (ISO), null while not done */
    done: string | null;
    /** what was done, per language (the thank-you e-mail's body) */
    summary: LocalText;
    /** when the thank-you e-mail went out (null: not yet) */
    notified: string | null;
    mails: IdeaMail[];
}

/** The server's answer to a change: the idea as it is now, and the e-mail the call queued or changed (null: none). */
export interface IdeaAnswer { idea: Idea; mail: IdeaMail | null }

/** Whether the server can send e-mail and reach the owner's bot (shown above the board). */
export interface IdeasSetup { mail: boolean; mailFrom: string | null; bot: boolean; undoSeconds: number }

/** Paths under /api/admin/ (lane B's ideas_admin.py); one idea is `ideas/<id>` (ideaPath). */
export const IDEAS_ROUTES = {
    list: 'ideas',
    update: 'ideas/update',
    note: 'ideas/note',
    reply: 'ideas/reply',
    done: 'ideas/done',
    sendDone: 'ideas/send-done',
    mailCancel: 'ideas/mail/cancel',
    mailSend: 'ideas/mail/send'
} as const;

/** GET one idea (after a refused Send, to show what the server has now). */
export const ideaPath = (id: string): string => `${IDEAS_ROUTES.list}/${encodeURIComponent(id)}`;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function localText(v: unknown): LocalText {
    const out: LocalText = {};
    for (const l of PUBLIC_LANGS) { const s = obj(v)[l]; if (typeof s === 'string' && s.trim()) out[l] = s; }
    return out;
}

function parseMail(raw: unknown): IdeaMail | null {
    const m = obj(raw);
    if (typeof m.id !== 'string' || (m.kind !== 'reply' && m.kind !== 'done') || !isOneOf(MAIL_STATES, m.state)) return null;
    return { id: m.id, kind: m.kind, to: str(m.to), lang: str(m.lang), subject: str(m.subject), plain: str(m.plain), state: m.state,
        created: str(m.created), notBefore: strOrNull(m.notBefore), sentAt: strOrNull(m.sentAt), error: str(m.error) };
}

/** One record of the store as the board uses it, or null when it cannot be placed (no id, unknown status or kind). */
export function parseIdea(raw: unknown): Idea | null {
    const o = obj(raw);
    if (typeof o.id !== 'string' || !ID_RE.test(o.id) || !isOneOf(IDEA_STATUSES, o.status) || !isOneOf(IDEA_KINDS, o.kind)) return null;
    const pub = obj(o.public);
    const done = obj(o.done);
    return {
        id: o.id,
        kind: o.kind,
        status: o.status,
        urgency: isOneOf(URGENCIES, o.urgency) ? o.urgency : null,
        ts: str(o.created),
        text: str(o.text),
        fromPilot: o.kind !== 'feature',
        locale: str(o.lang),
        page: str(o.page),
        scene: str(o.scene),
        release: str(o.release),
        contact: str(o.contact),
        email: str(o.email),
        suspect: o.suspect === true,
        diagnostics: o.diagnostics === true ? true : o.diagnostics === 'skipped' ? 'skipped' : false,
        comments: (Array.isArray(o.comments) ? o.comments : []).map(obj).map((c) => ({ at: str(c.at), text: str(c.text), by: str(c.by) })),
        public: { title: localText(pub.title), text: localText(pub.text), visible: pub.visible !== false },
        order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : null,
        done: o.status === 'done' ? strOrNull(done.at) ?? strOrNull(o.statusAt) : null,
        summary: localText(done.summary),
        notified: strOrNull(o.notified),
        mails: (Array.isArray(o.thread) ? o.thread : []).map(parseMail).filter((m): m is IdeaMail => m !== null)
    };
}

/** The list answer: the records the board can place, how many it could not (shown, never guessed), the setup. */
export function parseIdeas(raw: unknown): { ideas: Idea[]; unreadable: number; setup: IdeasSetup } {
    const r = obj(raw);
    if (!Array.isArray(r.ideas)) throw new Error('the server sent no list of ideas');
    const ideas: Idea[] = [];
    const seen = new Set<string>();
    let unreadable = 0;
    for (const x of r.ideas) {
        const i = parseIdea(x);
        if (!i || seen.has(i.id)) { unreadable++; continue; }
        seen.add(i.id);
        ideas.push(i);
    }
    const mail = obj(r.mail);
    const undo = typeof r.undoSeconds === 'number' && Number.isFinite(r.undoSeconds) ? r.undoSeconds : 60;
    return { ideas, unreadable, setup: { mail: mail.configured === true, mailFrom: strOrNull(mail.from), bot: obj(r.bot).configured === true, undoSeconds: undo } };
}

/** Where a bug's stored technical details are served (the admin's existing route). */
export const diagnosticsUrl = (id: string): string => `/api/admin/reports/${encodeURIComponent(id)}/diagnostics`;

/** A new note from this page (the owner writes down an idea a pilot told him outside the form, item 8). */
export interface NewNote { text: string; contact?: string; lang?: string; urgency?: Urgency | null; publicTitle?: LocalText }

/** The ideas half of the admin API over the admin's session (AdminClient: cookie, CSRF, 401 -> login). */
export class IdeasClient {
    constructor(private readonly api: Pick<AdminClient, 'get' | 'post'>) {}

    async list(): Promise<ReturnType<typeof parseIdeas>> {
        return parseIdeas(await this.api.get<unknown>(IDEAS_ROUTES.list));
    }

    /** One idea as the server has it now. */
    async get(id: string): Promise<Idea> {
        return this.answer(await this.api.get<{ idea?: unknown }>(ideaPath(id))).idea;
    }

    /** A kanban move. */
    setStatus(id: string, status: IdeaStatus): Promise<IdeaAnswer> {
        return this.update({ id, status });
    }

    /** null clears it (the idea leaves the work queue until it gets one again). */
    setUrgency(id: string, urgency: Urgency | null): Promise<IdeaAnswer> {
        return this.update({ id, urgency });
    }

    comment(id: string, text: string): Promise<IdeaAnswer> {
        return this.update({ id, comment: text });
    }

    /** The landing's title in four languages and whether the idea is shown there (its public text is left as it is). */
    setPublic(id: string, title: LocalText, visible: boolean): Promise<IdeaAnswer> {
        return this.update({ id, publicTitle: title, visible });
    }

    async addNote(n: NewNote): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown }>(IDEAS_ROUTES.note, { text: n.text, contact: n.contact ?? '', lang: n.lang ?? '', urgency: n.urgency ?? null, kind: 'note', ...(n.publicTitle ? { publicTitle: n.publicTitle } : {}) }));
    }

    /**
     * E-mail the pilot the owner's answer (the server quotes the pilot's words). The answer's mail says what
     * happened: queued behind the undo window, waiting_setup while Gmail is not set up, no_email.
     */
    async reply(id: string, text: string): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown; mail?: unknown }>(IDEAS_ROUTES.reply, { id, text }));
    }

    /** Done, with what was done per language: the server writes the thank-you as a DRAFT (none without an e-mail). */
    async done(id: string, summary: LocalText): Promise<{ idea: Idea; draft: IdeaMail | null }> {
        const r = await this.api.post<{ idea?: unknown; draft?: unknown }>(IDEAS_ROUTES.done, { id, summary });
        return { idea: this.answer(r).idea, draft: r.draft ? parseMail(r.draft) : null };
    }

    /**
     * The owner's Send under the draft thank-you he was shown (`mailId`: that draft): the only call that
     * queues it. The server refuses a draft a newer summary replaced (409 stale-draft).
     */
    async sendDone(id: string, mailId: string): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown; mail?: unknown }>(IDEAS_ROUTES.sendDone, { id, mail: mailId }));
    }

    /** Stop an e-mail that has not gone yet (its id, not the idea's). */
    async cancelMail(mailId: string): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown; mail?: unknown }>(IDEAS_ROUTES.mailCancel, { id: mailId }));
    }

    /** Send an e-mail that waited for Gmail's setup, failed or may not have gone, or a draft. */
    async sendMail(mailId: string): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown; mail?: unknown }>(IDEAS_ROUTES.mailSend, { id: mailId }));
    }

    private async update(body: Record<string, unknown>): Promise<IdeaAnswer> {
        return this.answer(await this.api.post<{ idea?: unknown }>(IDEAS_ROUTES.update, body));
    }

    private answer(r: { idea?: unknown; mail?: unknown }): IdeaAnswer {
        const idea = parseIdea(r.idea);
        if (!idea) throw new Error('the server answered without the idea');
        return { idea, mail: r.mail ? parseMail(r.mail) : null };
    }
}
