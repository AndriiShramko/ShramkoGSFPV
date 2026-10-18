// The Ideas kanban as a model, no DOM: which card is in which column and in what order, what the
// filters and the search keep, how much of a long archive column is drawn, what a move sends, when a
// thank-you e-mail is due, whether a public title is ready for the landing. tab.ts draws it;
// tools/bench/test/admin-ideas.test.ts checks it.
// The landing's rules are lane B's (apps/api/ideas.py roadmap_items): an English title, a status the
// landing shows (accepted is published as "planned"), not hidden, not marked as spam.
import { IDEA_KINDS, IDEA_STATUSES, PUBLIC_LANGS, URGENCIES } from './api';
import type { Idea, IdeaKind, IdeaMail, IdeaPublic, IdeaStatus, MailState, PublicLang, Urgency } from './api';

/** Statuses the landing shows; new and rejected never are. */
export const ON_LANDING: ReadonlySet<IdeaStatus> = new Set(['accepted', 'in_progress', 'done']);

/** What the board shows: kinds, a lowest urgency, with or without a contact, on the landing or not, words. */
export interface IdeaFilter {
    kinds: ReadonlySet<IdeaKind>;
    minUrgency: Urgency | 'any';
    contact: 'any' | 'yes' | 'no';
    landing: 'any' | 'yes' | 'no';
    search: string;
}

export const ALL_IDEAS: IdeaFilter = { kinds: new Set(IDEA_KINDS), minUrgency: 'any', contact: 'any', landing: 'any', search: '' };

/** low 0 ... urgent 3; not set yet -1 (below every level). */
const rank = (u: Urgency | null): number => (u === null ? -1 : URGENCIES.indexOf(u));

/** Whether the idea is on the landing now (lane B's roadmap rules). */
export function onLanding(i: Idea): boolean {
    return i.public.visible && !!i.public.title.en?.trim() && ON_LANDING.has(i.status) && !i.suspect;
}

/** Everything the search looks in: what the pilot sent, the owner's comments, the public titles. */
function haystack(i: Idea): string {
    return [i.id, i.text, i.contact, i.scene, i.page, i.locale, i.release, ...i.comments.map((c) => c.text), ...PUBLIC_LANGS.map((l) => i.public.title[l] ?? '')].join('\n').toLowerCase();
}

/** Does the card pass the filters? Every word of the search must be found somewhere in it. */
export function matches(i: Idea, f: IdeaFilter): boolean {
    if (!f.kinds.has(i.kind)) return false;
    if (f.minUrgency !== 'any' && rank(i.urgency) < rank(f.minUrgency)) return false;
    if (f.contact !== 'any' && (i.contact.trim() !== '') !== (f.contact === 'yes')) return false;
    if (f.landing !== 'any' && onLanding(i) !== (f.landing === 'yes')) return false;
    const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const h = haystack(i);
    return words.every((w) => h.includes(w));
}

const byNewest = (a: Idea, b: Idea): number => b.ts.localeCompare(a.ts);
const byOrder = (a: Idea, b: Idea): number => (a.order ?? Infinity) - (b.order ?? Infinity);
/** The work queue: most urgent first (not set yet last), then the seed's order, then the oldest. */
const byQueue = (a: Idea, b: Idea): number => rank(b.urgency) - rank(a.urgency) || byOrder(a, b) || a.ts.localeCompare(b.ts);
/** Done: the latest done first; the seeded features (done when the store was seeded) keep their order. */
const byDone = (a: Idea, b: Idea): number => (b.done ?? '').localeCompare(a.done ?? '') || byOrder(a, b) || a.ts.localeCompare(b.ts);

const ORDER: Record<IdeaStatus, (a: Idea, b: Idea) => number> = { new: byNewest, accepted: byQueue, in_progress: byQueue, done: byDone, rejected: byNewest };

/** The cards of every column that pass the filters, each column in its order. */
export function columns(ideas: readonly Idea[], f: IdeaFilter): Record<IdeaStatus, Idea[]> {
    const out = Object.fromEntries(IDEA_STATUSES.map((s) => [s, [] as Idea[]])) as Record<IdeaStatus, Idea[]>;
    for (const i of ideas) if (matches(i, f)) out[i.status].push(i);
    for (const s of IDEA_STATUSES) out[s].sort(ORDER[s]);
    return out;
}

/** Whether the filters narrow the board (a search word, a kind left out, a select set): then every match is drawn. */
export function narrowed(f: IdeaFilter): boolean {
    return f.search.trim() !== '' || IDEA_KINDS.some((k) => !f.kinds.has(k)) || f.minUrgency !== 'any' || f.contact !== 'any' || f.landing !== 'any';
}

/** The archive columns: they grow without end (the live Done held 60 cards), so they draw their newest few. */
export const CLIPPED: ReadonlySet<IdeaStatus> = new Set(['done', 'rejected']);
/** How many cards an archive column draws until the owner asks for all of them. */
export const CLIP_AT = 8;

/** How a column is drawn: the whole column (`all`: Show all pressed), and the card to keep in view. */
export interface ClipView {
    all: boolean;
    narrowed: boolean;
    /** the card the owner last opened or moved: drawn even beyond the newest few, so the focus can go back to it */
    keep: string | null;
}

/**
 * The cards a column draws, in its order, and how many it leaves out. The work columns (New, Accepted,
 * In progress) draw everything; an archive column (Done, Rejected) with more than CLIP_AT cards draws its
 * newest CLIP_AT (its own order: Done by done date, Rejected by date) plus the kept card, unless the
 * owner pressed Show all or the filters narrow the board (a search finds every card it matches, drawn).
 * The column's count is always its whole length, never the drawn part.
 */
export function clip(status: IdeaStatus, list: readonly Idea[], v: ClipView): { cards: Idea[]; hidden: number } {
    if (!CLIPPED.has(status) || v.all || v.narrowed || list.length <= CLIP_AT) return { cards: [...list], hidden: 0 };
    const cards = list.filter((i, k) => k < CLIP_AT || i.id === v.keep);
    return { cards, hidden: list.length - cards.length };
}

/** The column left (-1) or right (+1) of this one, or null at the edge (the keyboard move). */
export function neighbour(status: IdeaStatus, step: -1 | 1): IdeaStatus | null {
    return IDEA_STATUSES[IDEA_STATUSES.indexOf(status) + step] ?? null;
}

/** The body of the status call for a move, or null when there is nothing to send (same column, unknown column). */
export function moveBody(i: Idea, to: string): { id: string; status: IdeaStatus } | null {
    if (!(IDEA_STATUSES as readonly string[]).includes(to) || to === i.status) return null;
    return { id: i.id, status: to as IdeaStatus };
}

/** A thank-you in one of these states has gone, may have gone, or is on its way: no other is offered. */
const THANKS_GOING: ReadonlySet<MailState> = new Set(['queued', 'sending', 'sent', 'unknown']);
/**
 * A thank-you in one of these states waits for the owner's Send: a draft, one saved until Gmail is set up, one that
 * failed, one held because the pilot cannot surely read it (waiting_language: Send sends it as written).
 */
const THANKS_PENDING: ReadonlySet<MailState> = new Set(['draft', 'waiting_setup', 'waiting_language', 'failed']);

/**
 * The thank-you e-mail waiting for the owner's Send, if there is one (the latest). The dialog shows it and
 * Sends it instead of writing a new one, so a pilot is never thanked twice.
 */
export function thanksPending(i: Idea): IdeaMail | null {
    return [...i.mails].reverse().find((m) => m.kind === 'done' && THANKS_PENDING.has(m.state)) ?? null;
}

/**
 * A thank-you e-mail is offered when a pilot's idea is Done and the pilot left an e-mail, until it has
 * gone, may have gone or is on its way (owner's item 7). A pending one (thanksPending) is offered to Send.
 */
export function thanksDue(i: Idea): boolean {
    return i.status === 'done' && i.fromPilot && i.email !== '' && i.notified === null
        && !i.mails.some((m) => m.kind === 'done' && THANKS_GOING.has(m.state));
}

/**
 * What the owner is told after an e-mail call, by the state of the e-mail in the server's answer: on its
 * way after the undo window (queued), saved until Gmail is set up (waiting), or just its state.
 */
export function mailNotice(m: IdeaMail | null): 'queued' | 'waiting' | 'state' {
    return m?.state === 'queued' ? 'queued' : m?.state === 'waiting_setup' ? 'waiting' : 'state';
}

/** Languages of the public title still empty (the landing shows English there). */
export function missingLangs(title: IdeaPublic['title']): PublicLang[] {
    return PUBLIC_LANGS.filter((l) => !title[l]?.trim());
}

/** Why the idea cannot be on the landing yet, or null when it can: an English title, a status it shows. */
export function landingBlocker(title: IdeaPublic['title'], status: IdeaStatus): 'title' | 'status' | null {
    if (!title.en?.trim()) return 'title';
    return ON_LANDING.has(status) ? null : 'status';
}
