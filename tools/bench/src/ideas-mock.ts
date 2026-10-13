// A mock of the admin ideas API exactly as docs/wip/v07-c.md assumes lane B builds it (session + CSRF,
// /api/admin/ideas..., the existing reports/<id>/diagnostics), in memory, recording every call. Used by
// tools/bench/test/admin-ideas.test.ts (through a fake fetch) and tools/bench/src/accept-v07-ideas.ts
// (through Playwright's routing). It sends nothing anywhere: "reply" and "thanks" only record a mail.
// Fixture people are made up (example.com addresses).

export interface MockCall { method: string; path: string; body: Record<string, unknown> | null }
export interface MockAnswer { status: number; json: unknown; headers?: Record<string, string> }

const STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'];
const URGENCIES = ['low', 'normal', 'high', 'urgent'];
const EMAIL = /[^\s<>(),;:"'@]+@[^\s<>(),;:"'@]+\.[A-Za-z]{2,}/;
export const MOCK_CSRF = 'csrf-test-token';

type Rec = Record<string, unknown> & { id: string };

/** The starting store: one card per situation the board has to show. */
export function mockIdeas(): Rec[] {
    return [
        { id: 'R-20261006-0001', kind: 'idea', status: 'new', urgency: 'normal', ts: '2026-10-06T09:00:00Z', fromPilot: true, text: 'Rates types: Betaflight, Raceflight, KISS, Actual, Quick, with manual editing in the options.', locale: 'pl', page: 'fly', scene: '39e63ce9', release: 'cbc41e8', contact: 'pilot.one@example.com', suspect: false, diagnostics: false, comments: [], public: { title: {}, roadmap: false }, mails: [] },
        { id: 'R-20261006-0002', kind: 'idea', status: 'accepted', urgency: 'high', ts: '2026-10-06T09:05:00Z', fromPilot: true, text: 'A crosshair in the centre of the screen.', locale: 'pl', page: 'fly', scene: '', release: 'cbc41e8', contact: 'pilot.one@example.com or @pilotone on Telegram', suspect: false, diagnostics: false, comments: [{ ts: '2026-10-07T10:00:00Z', text: 'Small, do it with the HUD work', via: 'telegram' }], public: { title: { en: 'A crosshair in the centre of the view' }, roadmap: true, group: 'camera' }, mails: [] },
        { id: 'R-20261008-0003', kind: 'bug', status: 'new', urgency: 'urgent', ts: '2026-10-08T18:30:00Z', fromPilot: true, text: 'The throttle stops working after I switch windows.', locale: 'en', page: 'fly', scene: '887f27aa', release: 'f92d98b', contact: '', suspect: false, diagnostics: true, comments: [], public: { title: {}, roadmap: false }, mails: [] },
        { id: 'N-20261010-0001', kind: 'note', status: 'in_progress', urgency: 'normal', ts: '2026-10-10T12:00:00Z', fromPilot: true, text: 'A pilot at the field asked for the motor sound.', locale: '', page: '', scene: '', release: '', contact: '', suspect: false, diagnostics: false, comments: [], public: { title: { en: 'Motor sound', es: 'Sonido de los motores' }, roadmap: true, group: 'camera' }, mails: [] },
        { id: 'R-20261011-0004', kind: 'idea', status: 'rejected', urgency: 'low', ts: '2026-10-11T08:00:00Z', fromPilot: true, text: 'buy cheap followers here', locale: 'en', page: 'site', scene: '', release: '', contact: 'spam@example.com', suspect: true, diagnostics: false, comments: [], public: { title: {}, roadmap: false }, mails: [] },
        { id: 'F-edgetx-radio-over-usb-webhid-in-chrome', kind: 'feature', status: 'done', urgency: 'normal', ts: '2026-09-24T00:00:00Z', fromPilot: false, text: '', comments: [], public: { title: { en: 'EdgeTX radio over USB (WebHID) in Chrome or Edge' }, roadmap: true, group: 'radio' }, order: 1, mails: [] },
        { id: 'R-20261012-0005', kind: 'idea', status: 'in_progress', urgency: 'normal', ts: '2026-10-12T07:00:00Z', fromPilot: true, text: 'Assign arm and mode to radio channels, CH6 and CH5 as on my radio.', locale: 'pl', page: 'fly', scene: '', release: 'cbc41e8', contact: 'pilot.two@example.com', suspect: false, diagnostics: false, comments: [], public: { title: { en: 'Radio channel functions' }, roadmap: true, group: 'radio' }, mails: [] },
        { id: 'X-unknown-status', kind: 'idea', status: 'someday', urgency: 'normal', ts: '2026-10-12T07:00:00Z', text: 'a record the board cannot place' }
    ];
}

/** The in-memory store and its routes. */
export class IdeasMock {
    readonly calls: MockCall[] = [];
    ideas: Rec[];
    /** answer every POST to this route with this status (a failing server) */
    failNext: { path: string; status: number } | null = null;
    private clock = Date.parse('2026-10-13T12:00:00Z');

    constructor(ideas: Rec[] = mockIdeas()) {
        this.ideas = structuredClone(ideas);
    }

    private now(): string {
        this.clock += 1000;
        return new Date(this.clock).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    /** POST calls to ideas routes only (what the board sent). */
    posts(): MockCall[] {
        return this.calls.filter((c) => c.method === 'POST' && c.path.startsWith('ideas'));
    }

    /** One request: `path` is under /api/admin/ (no leading slash). */
    handle(method: string, path: string, headers: Record<string, string>, body: Record<string, unknown> | null): MockAnswer {
        this.calls.push({ method, path, body });
        if (method === 'GET' && path === 'session') return { status: 200, json: { ok: true, csrf: MOCK_CSRF, expires: 0 } };
        if (method === 'GET' && path === 'catalog') return { status: 200, json: { ok: true, draft: { collections: [], scenes: [] }, published: null, dirty: false, history: [] } };
        if (method === 'GET' && path === 'ideas') return { status: 200, json: { ok: true, ideas: this.ideas } };
        const diag = /^reports\/([A-Za-z0-9-]+)\/diagnostics$/.exec(path);
        if (method === 'GET' && diag) {
            const it = this.ideas.find((x) => x.id === diag[1]);
            return it?.diagnostics === true ? { status: 200, json: { id: it.id, diagnostics: { browser: { userAgent: 'test' }, errors: [] } }, headers: { 'content-disposition': `inline; filename="${it.id}.json"` } } : { status: 404, json: { ok: false } };
        }
        if (method !== 'POST') return { status: 404, json: { ok: false } };
        if ((headers['x-csrf'] ?? '') !== MOCK_CSRF) return { status: 403, json: { ok: false, reason: 'csrf' } };
        if (this.failNext && this.failNext.path === path) {
            const s = this.failNext.status;
            this.failNext = null;
            return { status: s, json: { ok: false, reason: 'test-failure' } };
        }
        const b = body ?? {};
        const it = this.ideas.find((x) => x.id === b.id);
        if (path.startsWith('ideas/') && !it) return { status: 404, json: { ok: false, reason: 'no-idea' } };
        const one = (): MockAnswer => ({ status: 200, json: { ok: true, idea: it } });
        const email = typeof it?.contact === 'string' ? EMAIL.exec(it.contact)?.[0] : undefined;
        switch (path) {
            case 'ideas/status':
                if (!STATUSES.includes(String(b.status))) return { status: 400, json: { ok: false, reason: 'status' } };
                it!.status = b.status;
                if (b.status === 'done') it!.done = this.now();
                return one();
            case 'ideas/urgency':
                if (!URGENCIES.includes(String(b.urgency))) return { status: 400, json: { ok: false, reason: 'urgency' } };
                it!.urgency = b.urgency;
                return one();
            case 'ideas/comment':
                (it!.comments as unknown[]).push({ ts: this.now(), text: String(b.text), via: 'admin' });
                return one();
            case 'ideas/public':
                it!.public = { title: b.title, roadmap: b.roadmap === true, group: b.group ?? null };
                return one();
            case 'ideas/reply':
                if (!email) return { status: 409, json: { ok: false, reason: 'no-contact' } };
                (it!.mails as unknown[]).push({ ts: this.now(), kind: 'reply', to: email, ok: true });
                return one();
            case 'ideas/thanks/draft':
                if (!email) return { status: 409, json: { ok: false, reason: 'no-contact' } };
                return { status: 200, json: { ok: true, to: email, lang: it!.locale || 'en', subject: 'Your idea is in the simulator', body: `Thank you for: ${String(it!.text)}\n\nAndrii` } };
            case 'ideas/thanks/send':
                if (!email) return { status: 409, json: { ok: false, reason: 'no-contact' } };
                (it!.mails as unknown[]).push({ ts: this.now(), kind: 'thanks', to: email, ok: true });
                return one();
            default:
                return { status: 404, json: { ok: false } };
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
