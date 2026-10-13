// A mock of lane B's admin ideas API (apps/api/ideas_admin.py + service.py; contract in docs/wip/v07-b.md,
// "Contracts for lane C"; B's 8b1fef4), in memory, recording every call: session + CSRF, GET ideas and
// ideas/<id>, POST ideas/update (all or nothing, unknown fields refused), ideas/note, ideas/reply (queued
// behind the undo window, waiting_setup without Gmail, or no_email), ideas/mail/cancel, ideas/done (done +
// a DRAFT thank-you; an older draft becomes superseded), ideas/send-done {id, mail: the draft's id} (409
// stale-draft for a superseded one), ideas/mail/send, and the existing reports/<id>/diagnostics; 503
// ideas-store for the ideas routes while the store is unreadable (storeBroken). Used by
// tools/bench/test/admin-ideas.test.ts (a fake fetch) and tools/bench/src/accept-v07-ideas.ts (Playwright
// routing). It sends nothing anywhere: an e-mail is only a record with a state. Fixture people are made up
// (example.com addresses).
// Held to the server: apps/api/tests/ideas-admin-contract.json is replayed against the real handler
// (apps/api/tests/test_ideas_contract.py) and against this mock (tools/bench/test/ideas-contract.test.ts),
// so a difference between the two fails one of them. Change the three together.

export interface MockCall { method: string; path: string; body: Record<string, unknown> | null }
export interface MockAnswer { status: number; json: unknown; headers?: Record<string, string> }

const STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'];
const URGENCIES = ['urgent', 'high', 'normal', 'low'];
const UPDATE_KEYS = ['id', 'status', 'urgency', 'comment', 'publicTitle', 'publicText', 'visible', 'release', 'order'];
const MAIL_ID = /^M-[0-9]{1,9}$/;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/;
export const MOCK_CSRF = 'csrf-test-token';
export const MOCK_UNDO_S = 60;

type Rec = Record<string, unknown> & { id: string };
type Mail = Record<string, unknown> & { id: string; kind: string; state: string };

/** A record as lane B's new_record() makes it, with these fields over the defaults. */
export function mockRecord(o: Record<string, unknown> & { id: string; kind: string }): Rec {
    return rec(o);
}

function rec(o: Record<string, unknown> & { id: string; kind: string }): Rec {
    const contact = typeof o.contact === 'string' ? o.contact : '';
    const email = EMAIL.exec(contact)?.[0] ?? '';
    return {
        created: '2026-10-06T09:00:00Z', text: '', lang: '', page: '', scene: '', release: '', contact, contactKind: email ? 'email' : contact ? 'other' : 'none', email,
        suspect: false, diagnostics: false, status: 'new', statusAt: '2026-10-06T09:00:00Z', urgency: null, comments: [],
        public: { title: {}, text: {}, visible: true }, done: null, notified: null, releases: [], thread: [], order: null, source: 'report', tg: {},
        ...o
    } as Rec;
}

/** The starting store: one card per situation the board has to show. */
export function mockIdeas(): Rec[] {
    return [
        rec({ id: 'R-20261006-0001', kind: 'idea', created: '2026-10-06T09:00:00Z', text: 'Rates types: Betaflight, Raceflight, KISS, Actual, Quick, with manual editing in the options.', lang: 'pl', page: 'fly', scene: '39e63ce9', release: 'cbc41e8', contact: 'pilot.one@example.com' }),
        rec({ id: 'R-20261006-0002', kind: 'idea', status: 'accepted', urgency: 'high', created: '2026-10-06T09:05:00Z', text: 'A crosshair in the centre of the screen.', lang: 'pl', page: 'fly', release: 'cbc41e8', contact: 'pilot.one@example.com or @pilotone on Telegram',
            comments: [{ at: '2026-10-07T10:00:00Z', text: 'Small, do it with the HUD work', by: 'telegram' }], public: { title: { en: 'A crosshair in the centre of the view' }, text: {}, visible: true } }),
        rec({ id: 'R-20261008-0003', kind: 'bug', urgency: 'urgent', created: '2026-10-08T18:30:00Z', text: 'The throttle stops working after I switch windows.', lang: 'en', page: 'fly', scene: '887f27aa', release: 'f92d98b', diagnostics: true }),
        rec({ id: 'N-20261010-0001', kind: 'note', status: 'in_progress', created: '2026-10-10T12:00:00Z', text: 'A pilot at the field asked for the motor sound.', source: 'telegram',
            public: { title: { en: 'Motor sound', es: 'Sonido de los motores' }, text: {}, visible: true } }),
        rec({ id: 'R-20261011-0004', kind: 'idea', status: 'rejected', urgency: 'low', created: '2026-10-11T08:00:00Z', text: 'buy cheap followers here', lang: 'en', page: 'site', contact: 'spam@example.com', suspect: true }),
        rec({ id: 'F-edgetx-radio-over-usb-webhid-in-chrome', kind: 'feature', status: 'done', created: '2026-09-24T00:00:00Z', source: 'seed', order: 1,
            public: { title: { en: 'EdgeTX radio over USB (WebHID) in Chrome or Edge' }, text: {}, visible: true }, done: { at: '2026-09-24T00:00:00Z', summary: {}, by: 'seed' } }),
        rec({ id: 'R-20261012-0005', kind: 'idea', status: 'in_progress', urgency: 'normal', created: '2026-10-12T07:00:00Z', text: 'Assign arm and mode to radio channels, CH6 and CH5 as on my radio.', lang: 'pl', page: 'fly', release: 'cbc41e8', contact: 'pilot.two@example.com',
            public: { title: { en: 'Radio channel functions' }, text: {}, visible: true } }),
        rec({ id: 'R-20261012-0006', kind: 'idea', status: 'someday', created: '2026-10-12T07:00:00Z', text: 'a record the board cannot place' })
    ];
}

/** The in-memory store and its routes. */
export class IdeasMock {
    readonly calls: MockCall[] = [];
    ideas: Rec[];
    /** whether Gmail is set up: without it a queued e-mail waits (waiting_setup) */
    mailConfigured = true;
    /** answer the next POST to this route with this status (a failing server) */
    failNext: { path: string; status: number } | null = null;
    /** ideas.json unreadable on the server: the ideas routes answer 503 ideas-store, the rest of the admin works */
    storeBroken = false;
    private clock = Date.parse('2026-10-13T12:00:00Z');
    private mailSeq = 0;
    private noteSeq = 0;

    constructor(ideas: Rec[] = mockIdeas()) {
        this.ideas = structuredClone(ideas);
    }

    private now(plus = 0): string {
        this.clock += 1000;
        return new Date(this.clock + plus * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    /** POST calls to ideas routes only (what the board sent). */
    posts(): MockCall[] {
        return this.calls.filter((c) => c.method === 'POST' && c.path.startsWith('ideas'));
    }

    /** Every e-mail of every idea whose state is one of these. */
    mails(...states: string[]): Mail[] {
        return this.ideas.flatMap((i) => i.thread as Mail[]).filter((m) => !states.length || states.includes(m.state));
    }

    private mail(it: Rec, kind: string, body: string, state: string): Mail {
        const lang = ['en', 'es', 'pl', 'ru'].includes(String(it.lang)) ? String(it.lang) : 'en';
        return { id: `M-${++this.mailSeq}`, kind, to: it.email, lang, subject: kind === 'done' ? `Your idea is in ShramkoGSFPV (${it.id})` : `Re: your message (${it.id})`,
            body, plain: `${body}\n\n> ${String(it.text)}\n\nAndrii`, state, created: this.now(), notBefore: null, sentAt: null, error: '' } as Mail;
    }

    private queue(m: Mail): void {
        if (!this.mailConfigured) { m.state = 'waiting_setup'; return; }
        m.state = 'queued';
        m.notBefore = this.now(MOCK_UNDO_S);
    }

    /** A world step of the contract file: Gmail set up or not, the store unreadable. */
    world(change: { mail?: boolean; store?: string }): void {
        if (typeof change.mail === 'boolean') this.mailConfigured = change.mail;
        if (change.store === 'broken') this.storeBroken = true;
    }

    /** One request: `path` is under /api/admin/ (no leading slash). */
    handle(method: string, path: string, headers: Record<string, string>, body: Record<string, unknown> | null): MockAnswer {
        this.calls.push({ method, path, body });
        if (method === 'GET' && path === 'session') return { status: 200, json: { ok: true, csrf: MOCK_CSRF, expires: 0 } };
        if (method === 'GET' && path === 'catalog') return { status: 200, json: { ok: true, draft: { collections: [], scenes: [] }, published: null, dirty: false, history: [] } };
        // admin.py checks the session and the CSRF token first, then answers 503 for the store
        const storeRoute = path === 'ideas' || path.startsWith('ideas/') || path === 'reports' || path === 'reports/status';
        if (method === 'POST' && (headers['x-csrf'] ?? '') !== MOCK_CSRF) return { status: 403, json: { ok: false, reason: 'csrf' } };
        if (this.storeBroken && storeRoute) return { status: 503, json: { ok: false, reason: 'ideas-store' } };
        if (method === 'GET' && path === 'ideas') {
            return { status: 200, json: { ok: true, ideas: this.ideas, mail: { configured: this.mailConfigured, from: this.mailConfigured ? 'owner@example.com' : null }, bot: { configured: false }, undoSeconds: MOCK_UNDO_S } };
        }
        const one = /^ideas\/([RNF]-[A-Za-z0-9][A-Za-z0-9-]{0,47})$/.exec(path);
        if (method === 'GET' && one) {
            const it = this.ideas.find((x) => x.id === one[1]);
            return it ? { status: 200, json: { ok: true, idea: it } } : { status: 404, json: { ok: false } };
        }
        const diag = /^reports\/([A-Za-z0-9-]+)\/diagnostics$/.exec(path);
        if (method === 'GET' && diag) {
            const it = this.ideas.find((x) => x.id === diag[1]);
            return it?.diagnostics === true ? { status: 200, json: { id: it.id, diagnostics: { browser: { userAgent: 'test' }, errors: [] } }, headers: { 'content-disposition': `inline; filename="${it.id}.json"` } } : { status: 404, json: { ok: false } };
        }
        if (method !== 'POST') return { status: 404, json: { ok: false } };
        if (this.failNext && this.failNext.path === path) {
            const s = this.failNext.status;
            this.failNext = null;
            return { status: s, json: { ok: false, reason: 'test-failure' } };
        }
        const b = body ?? {};
        const refuse = (reason: string, status = 400): MockAnswer => ({ status, json: { ok: false, reason } });
        if (path === 'ideas/mail/cancel' || path === 'ideas/mail/send') {
            const it = this.ideas.find((x) => (x.thread as Mail[]).some((m) => m.id === b.id));
            const m = it && (it.thread as Mail[]).find((x) => x.id === b.id);
            if (!it || !m) return refuse('not-found', 404);
            if (m.state === 'superseded') return refuse('stale-draft', 409);
            if (path === 'ideas/mail/cancel') {
                if (['sending', 'sent', 'no_email'].includes(m.state)) return refuse('too-late', 409);
                m.state = 'cancelled';
            } else {
                if (!['waiting_setup', 'failed', 'unknown', 'draft'].includes(m.state)) return refuse('not-resendable', 409);
                this.queue(m);
            }
            return { status: 200, json: { ok: true, idea: it, mail: m } };
        }
        if (path === 'ideas/note') {
            if (typeof b.text !== 'string' || !b.text.trim()) return refuse('empty');
            const it = rec({ id: `N-20261013-${String(++this.noteSeq).padStart(4, '0')}`, kind: 'note', created: this.now(), text: b.text, contact: typeof b.contact === 'string' ? b.contact : '', lang: typeof b.lang === 'string' ? b.lang : '',
                urgency: URGENCIES.includes(String(b.urgency)) ? b.urgency : null, source: 'admin' });
            this.ideas.push(it);
            return { status: 200, json: { ok: true, idea: it } };
        }
        const it = this.ideas.find((x) => x.id === b.id);
        if (!it) return refuse('not-found', 404);
        const answer = (extra: Record<string, unknown> = {}): MockAnswer => ({ status: 200, json: { ok: true, idea: it, ...extra } });
        switch (path) {
            case 'ideas/update': {
                if (Object.keys(b).some((k) => !UPDATE_KEYS.includes(k))) return refuse('unknown-field');
                if ('status' in b && !STATUSES.includes(String(b.status))) return refuse('bad-status');
                if ('urgency' in b && b.urgency !== null && !URGENCIES.includes(String(b.urgency))) return refuse('bad-urgency');
                if ('comment' in b && !(typeof b.comment === 'string' && b.comment.trim())) return refuse('empty');
                if ('status' in b) {
                    it.status = b.status;
                    it.statusAt = this.now();
                    if (b.status === 'done') it.done = { summary: {}, ...((it.done as object) ?? {}), at: it.statusAt, by: 'admin' };
                }
                if ('urgency' in b) it.urgency = b.urgency;
                if ('comment' in b) (it.comments as unknown[]).push({ at: this.now(), text: b.comment, by: 'admin' });
                const pub = it.public as Record<string, unknown>;
                if ('publicTitle' in b) pub.title = b.publicTitle;
                if ('publicText' in b) pub.text = b.publicText;
                if (typeof b.visible === 'boolean') pub.visible = b.visible;
                return answer();
            }
            case 'ideas/reply': {
                if (typeof b.text !== 'string' || !b.text.trim()) return refuse('empty');
                const m = this.mail(it, 'reply', b.text, 'no_email');
                if (it.contactKind === 'email') this.queue(m);
                (it.thread as Mail[]).push(m);
                return answer({ mail: m });
            }
            case 'ideas/done': {
                const s = b.summary && typeof b.summary === 'object' ? (b.summary as Record<string, string>) : null;
                if (!s || !Object.values(s).some((x) => typeof x === 'string' && x.trim())) return refuse('empty');
                if (it.status !== 'done') { it.status = 'done'; it.statusAt = this.now(); }
                const done = (it.done as Record<string, unknown> | null) ?? { at: it.statusAt };
                it.done = { ...done, summary: { ...((done.summary as object) ?? {}), ...s }, by: 'admin' };
                let draft: Mail | null = null;
                if (it.contactKind === 'email') {
                    for (const m of it.thread as Mail[]) if (m.kind === 'done' && m.state === 'draft') m.state = 'superseded';
                    draft = this.mail(it, 'done', Object.values(s)[0], 'draft');
                    (it.thread as Mail[]).push(draft);
                }
                return answer({ draft });
            }
            case 'ideas/send-done': {
                if (typeof b.mail !== 'string' || !MAIL_ID.test(b.mail)) return refuse('bad-mail');
                const draft = (it.thread as Mail[]).find((m) => m.id === b.mail && m.kind === 'done');
                if (!draft) return refuse('not-found', 404);
                if (draft.state === 'superseded') return refuse('stale-draft', 409);
                if (draft.state !== 'draft') return refuse('no-draft', 409);
                this.queue(draft);
                return answer({ mail: draft });
            }
            default:
                return refuse('no-route', 404);
        }
    }

    /** A fetch for code that calls /api/admin/... (vitest: vi.stubGlobal('fetch', mock.fetch)). */
    readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(String(input), 'http://127.0.0.1');
        const headers: Record<string, string> = {};
        new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        const a = url.pathname.startsWith('/api/admin/') ? this.handle(init.method ?? 'GET', url.pathname.slice('/api/admin/'.length), headers, body) : { status: 404, json: {} };
        return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json', ...(a.headers ?? {}) } });
    };
}
