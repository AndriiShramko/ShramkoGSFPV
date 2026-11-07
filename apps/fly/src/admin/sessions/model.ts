// The Sessions tab's data, typed, and what is worked out from it (apps/api/sessions_admin.py: GET /api/admin/sessions). No DOM and no i18n
// here, so the tab's logic and its tests run in Node (tools/bench/test/admin-sessions.test.ts). The server holds the truth about each
// recording and each of its two channels; this module only says how a row is read: delivered (both channels confirmed), half (one
// confirmed, the other not yet), failed (a channel gave up: the owner can resend it), or waiting.

/** The delivery channels the server works, in its order (sessions.py CHANNELS). */
export const CHANNELS = ['telegram', 'email'] as const;
export type ChannelName = (typeof CHANNELS)[number];

export interface ChannelView {
    readonly status: string;
    readonly attempts: number;
    /** a short code (network, telegram-401, smtp-535 ...), never a URL, a token or a password */
    readonly error: string;
    readonly at: string | null;
}

export interface Summary {
    readonly packageId: string;
    readonly lesson: string;
    readonly path: string;
    readonly locale: string;
    readonly minor: boolean;
    readonly guardianConfirmed: boolean;
    readonly voice: boolean;
    readonly complete: boolean;
    readonly durationMs: number | null;
    readonly release: string;
    readonly sonic: string;
    readonly files: readonly { readonly name: string; readonly bytes: number }[];
}

export interface SessionRow {
    readonly id: string;
    readonly storedAt: string | null;
    readonly bytes: number | null;
    readonly sha256: string | null;
    readonly summary: Summary;
    readonly channels: Readonly<Record<string, ChannelView>>;
    readonly delivered: boolean;
}

export interface Totals {
    readonly stored: number;
    readonly delivered: number;
    readonly failed: number;
    readonly waiting: number;
    readonly bytes: number;
}

export interface ChannelConfig {
    readonly configured: boolean;
    readonly maxBytes: number;
}

export interface SessionsAnswer {
    readonly sessions: readonly SessionRow[];
    readonly totals: Totals;
    readonly config: { readonly telegram?: ChannelConfig; readonly email?: ChannelConfig };
    readonly retentionDays: number;
    readonly maxPackageBytes: number;
}

export type RowState = 'delivered' | 'half' | 'failed' | 'waiting';

/** True for a channel the server counts as done: the file went (sent), or a message with the admin link went (link). */
export const confirmed = (status: string | undefined): boolean => status === 'sent' || status === 'link';

/** How a row reads: failed wins (a channel gave up and waits for the owner), then half, then waiting; delivered only with both confirmed. */
export function rowState(r: SessionRow): RowState {
    const states = CHANNELS.map((c) => r.channels[c]?.status);
    if (states.every(confirmed) && r.delivered) return 'delivered';
    if (states.some((s) => s === 'failed')) return 'failed';
    if (states.some(confirmed)) return 'half';
    return 'waiting';
}

export type StateFilter = 'all' | 'undelivered' | 'failed';

/** Does a row pass the state filter and the search (the id, the lesson, the language, the release; case does not matter)? */
export function matches(r: SessionRow, filter: StateFilter, query: string): boolean {
    const state = rowState(r);
    if (filter === 'undelivered' && state === 'delivered') return false;
    if (filter === 'failed' && state !== 'failed') return false;
    const q = query.trim().toLowerCase();
    if (q === '') return true;
    return [r.id, r.summary.lesson, r.summary.locale, r.summary.release, r.summary.path, r.summary.packageId].some((x) => x.toLowerCase().includes(q));
}

/** "2.0 MB", "512 KB": decimal, the units of a mail attachment. */
export function formatBytes(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    if (n < 1000) return `${n} B`;
    if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
    return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
}

/** A size limit as the deployment names it: binary (a 15 MiB mail limit is 15 MiB, not "16 MB"). */
export function formatMiB(n: number | null | undefined): string {
    return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${Math.round(n / 1_048_576)} MiB`;
}

/** m:ss of a length in ms; "—" when the manifest did not say. */
export function formatLength(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The recordings that wait for a person: not delivered, newest first as the server sent them. */
export const undelivered = (rows: readonly SessionRow[]): SessionRow[] => rows.filter((r) => rowState(r) !== 'delivered');
