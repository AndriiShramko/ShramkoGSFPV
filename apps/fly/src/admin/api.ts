// The admin page's only door to the server: /api/admin/* (apps/api/admin.py). The session lives in an
// HttpOnly cookie the page never sees; the CSRF token comes with the login (or /session after a reload)
// and goes with every POST as X-CSRF. A 401 anywhere means the session is gone: back to the login.
// The flight page uses the same client for its one admin action, "Save as this scene's default"
// (app/builtin/scene-default.ts), offered only where the admin hint below is set and the session answers.
import type { SceneCatalog } from '@gsfpv/scenes';

export interface HistoryEntry { name: string; published: string | null; note: string; scenes: number }
export interface CatalogState {
    draft: SceneCatalog;
    published: (SceneCatalog & { published?: string }) | null;
    dirty: boolean;
    history: HistoryEntry[];
    version?: string;
}
export interface ReportRow {
    id: string;
    ts: string;
    kind: 'bug' | 'idea';
    page: string;
    locale: string;
    scene: string;
    release: string;
    message: string;
    contact: string;
    suspect: boolean;
    diagnostics: boolean | 'skipped';
    status: 'open' | 'closed';
}

export class ApiError extends Error {
    constructor(readonly status: number, readonly reason: string) {
        super(reason || `HTTP ${status}`);
    }
}

export type LoginResult = { ok: true } | { ok: false; why: 'password' | 'locked' | 'disabled' | 'network' | 'bad'; retryAfter?: number };

/**
 * localStorage key: this browser signed in to the admin page. A hint only, never trusted: the flight
 * page asks GET /api/admin/session before it offers an admin action (app/builtin/scene-default.ts),
 * and a page without the hint never calls the admin API (a visitor's console stays free of 401s).
 */
export const ADMIN_HINT_KEY = 'gsfpv.admin';

/** Set or clear the hint; storage blocked (or Node) = no hint, everything else works the same. */
export function setAdminHint(on: boolean): void {
    try {
        if (on) localStorage.setItem(ADMIN_HINT_KEY, '1');
        else localStorage.removeItem(ADMIN_HINT_KEY);
    } catch { /* no storage: no hint */ }
}

/** Has this browser signed in to the admin page (and not out since)? */
export function adminHinted(): boolean {
    try {
        return localStorage.getItem(ADMIN_HINT_KEY) === '1';
    } catch {
        return false;
    }
}

export class AdminClient {
    private csrf = '';
    /** called once when the server says the session is gone (401) */
    onLoggedOut: (() => void) | null = null;

    /** After a reload: is there a live session? 'disabled' when the server has no password hash. */
    async resume(): Promise<boolean | 'disabled'> {
        try {
            const r = await fetch('/api/admin/session', { cache: 'no-store' });
            if (r.status === 503) return 'disabled';
            if (r.status === 401) setAdminHint(false);
            if (!r.ok) return false;
            this.csrf = ((await r.json()) as { csrf: string }).csrf;
            setAdminHint(true);
            return true;
        } catch {
            return false;
        }
    }

    async login(password: string): Promise<LoginResult> {
        let r: Response;
        try {
            r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), cache: 'no-store' });
        } catch {
            return { ok: false, why: 'network' };
        }
        if (r.ok) {
            this.csrf = ((await r.json()) as { csrf: string }).csrf;
            setAdminHint(true);
            return { ok: true };
        }
        if (r.status === 429) return { ok: false, why: 'locked', retryAfter: Number(r.headers.get('Retry-After') ?? 0) };
        if (r.status === 503) return { ok: false, why: 'disabled' };
        if (r.status === 401) return { ok: false, why: 'password' };
        return { ok: false, why: r.status >= 500 ? 'network' : 'bad' };
    }

    async logout(): Promise<void> {
        try {
            await this.post('logout', {});
        } finally {
            this.csrf = '';
            setAdminHint(false);
        }
    }

    get<T>(path: string): Promise<T> {
        return this.call<T>('GET', path);
    }

    post<T>(path: string, body: unknown): Promise<T> {
        return this.call<T>('POST', path, body);
    }

    private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
        const r = await fetch(`/api/admin/${path}`, {
            method,
            cache: 'no-store',
            headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF': this.csrf } : {},
            body: method === 'POST' ? JSON.stringify(body) : undefined
        });
        const j = (await r.json().catch(() => ({}))) as { reason?: string };
        if (r.status === 401) {
            this.csrf = '';
            setAdminHint(false);
            this.onLoggedOut?.();
        }
        if (!r.ok) throw new ApiError(r.status, j.reason ?? '');
        return j as T;
    }
}
