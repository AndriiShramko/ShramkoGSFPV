// The Ideas kanban as a model, no DOM: which card is in which column and in what order, what the
// filters and the search keep, what a move sends, when a thank-you e-mail is due, whether a public
// title is ready for the landing. tab.ts draws it; tools/bench/test/admin-ideas.test.ts checks it.
import { IDEA_KINDS, IDEA_STATUSES, PUBLIC_LANGS, URGENCIES } from './api';
import type { Idea, IdeaKind, IdeaPublic, IdeaStatus, PublicLang, Urgency } from './api';

/**
 * The landing's groups of done items (keys of features.groups in packages/i18n/locales/site/*.json and the
 * `group` of apps/api/locales/roadmap-seed.json; tools/bench/test/admin-ideas.test.ts keeps the three equal).
 */
export const LANDING_GROUPS = ['radio', 'controls', 'drone', 'crash', 'camera', 'scenes', 'walls', 'settings'] as const;

/** Statuses the landing shows (accepted is published as "planned"); new and rejected never are. */
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

const rank = (u: Urgency): number => URGENCIES.indexOf(u);
const EMAIL_RE = /[^\s<>(),;:"'@]+@[^\s<>(),;:"'@]+\.[A-Za-z]{2,}/;

/** The first e-mail address in what the pilot left as a contact ("me@x.com or @me on Telegram"), or null. */
export function emailOf(contact: string): string | null {
    return contact.match(EMAIL_RE)?.[0] ?? null;
}

/** Whether the idea is on the landing now: ticked, an English title, and a status the landing shows. */
export function onLanding(i: Idea): boolean {
    return i.public.roadmap && !!i.public.title.en?.trim() && ON_LANDING.has(i.status);
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
/** The work queue: most urgent first, then the owner's order, then the oldest. */
const byQueue = (a: Idea, b: Idea): number => rank(b.urgency) - rank(a.urgency) || byOrder(a, b) || a.ts.localeCompare(b.ts);
/** Done: the latest done first; never-dated (the seeded features) after them in their order. */
const byDone = (a: Idea, b: Idea): number => (b.done ?? '').localeCompare(a.done ?? '') || byOrder(a, b) || a.ts.localeCompare(b.ts);

const ORDER: Record<IdeaStatus, (a: Idea, b: Idea) => number> = { new: byNewest, accepted: byQueue, in_progress: byQueue, done: byDone, rejected: byNewest };

/** The cards of every column that pass the filters, each column in its order. */
export function columns(ideas: readonly Idea[], f: IdeaFilter): Record<IdeaStatus, Idea[]> {
    const out = Object.fromEntries(IDEA_STATUSES.map((s) => [s, [] as Idea[]])) as Record<IdeaStatus, Idea[]>;
    for (const i of ideas) if (matches(i, f)) out[i.status].push(i);
    for (const s of IDEA_STATUSES) out[s].sort(ORDER[s]);
    return out;
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

/** A thank-you e-mail is offered when an idea reaches Done: a pilot's, with an e-mail to write to, not thanked yet. */
export function thanksDue(i: Idea): boolean {
    return i.status === 'done' && i.fromPilot && i.kind !== 'feature' && emailOf(i.contact) !== null && !i.mails.some((m) => m.kind === 'thanks' && m.ok);
}

/** Languages of the public title still empty (the landing shows English there). */
export function missingLangs(title: IdeaPublic['title']): PublicLang[] {
    return PUBLIC_LANGS.filter((l) => !title[l]?.trim());
}

/** Why the idea cannot be on the landing yet, or null when it can: an English title, a status it shows. */
export function landingBlocker(pub: IdeaPublic, status: IdeaStatus): 'title' | 'status' | null {
    if (!pub.title.en?.trim()) return 'title';
    return ON_LANDING.has(status) ? null : 'status';
}
