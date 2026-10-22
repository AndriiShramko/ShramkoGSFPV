// Google Analytics 4 in the simulator (WEB-TECH-BASELINE T6, Consent Mode basic), under the SAME consent
// as the landing: localStorage "gsfpv_consent" = "yes" | "no" on the same origin (apps/site/src/lib/track.ts).
// Nothing from Google is requested before Accept. A visitor who answered on the landing is not asked again;
// one who comes straight to /xx/fly/ (a Facebook post, a share page) gets the same banner, here as a card
// at the bottom edge. Accept -> gtag.js, consent default denied + update granted, `config` sends this page's
// granted page_view (GA's Enhanced Measurement counts the address changes of a scene switch itself; no
// page_view is sent by hand). The pause menu's "Cookie settings" opens the card again; Decline withdraws.
// Test pages (?nowarn, ?simradio, ?lat: the benches; app/boot.ts tells startAnalytics) get neither the card
// nor GA (internal traffic). This module never reads the address itself (app/env.ts is the only reader).
// The events are the funnel the cookieless counter already has (app/env.ts beacon() sends both), with GA's
// own parameter names: scene_id, source, seconds, input, mode, reason, has_collision, walls_on, voxel_cm.
import { h } from '../ui/dom';
import { t, locale } from '../i18n';

type GtagFn = (...args: unknown[]) => void;
type GaWindow = Window & { gtag?: GtagFn; dataLayer?: unknown[]; __gsfpvGa?: boolean } & Record<string, unknown>;

/** GA4 property "ShramkoGSFPV": public, committed on purpose (scripts/build-release.mjs and deploy.sh refuse a release without it). */
export const GA_ID = 'G-E7X0ES0QBE';
export const CONSENT_KEY = 'gsfpv_consent';
/** 14 months (426 days), the property's data retention (the privacy notice says so). */
const COOKIE_SECONDS = 426 * 24 * 3600;
const DISABLE = `ga-disable-${GA_ID}`;

const w = (): GaWindow => window as unknown as GaWindow;

/** Off until startAnalytics() ran on a page that is not a test page. */
let off = true;

function stored(): string | null {
    try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function store(v: 'yes' | 'no'): void {
    try { localStorage.setItem(CONSENT_KEY, v); } catch { /* storage blocked: this page only */ }
}

function loadGa(): void {
    const g = w();
    if (g.__gsfpvGa) {
        // accepted again after a withdrawal on this page
        g[DISABLE] = false;
        g.gtag?.('consent', 'update', { analytics_storage: 'granted' });
        return;
    }
    g.__gsfpvGa = true;
    g[DISABLE] = false;
    g.dataLayer = g.dataLayer || [];
    const gtag: GtagFn = function gtag() {
        // gtag.js expects the Arguments object itself
        // eslint-disable-next-line prefer-rest-params
        g.dataLayer!.push(arguments);
    };
    g.gtag = gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'denied', wait_for_update: 500 });
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('set', { allow_google_signals: false, allow_ad_personalization_signals: false });
    gtag('config', GA_ID, { cookie_domain: location.hostname, cookie_expires: COOKIE_SECONDS, site_lang: locale });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(s);
}

/** Every _ga / _ga_<suffix> cookie, on this host and each parent domain (an older tag wrote .flyreelstudio.eu). */
function dropGaCookies(): void {
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^_ga(_|$)/.test(n));
    const parts = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join('.')}`);
    for (const n of names) for (const d of domains) document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
}

function withdraw(): void {
    store('no');
    const g = w();
    try { if (g.__gsfpvGa) g.gtag?.('consent', 'update', { analytics_storage: 'denied' }); } catch { /* ignore */ }
    g[DISABLE] = true;
    dropGaCookies();
}

/** A GA4 event; nothing before consent, nothing on a test page, never throws. True when it went to gtag. */
export function gaEvent(name: string, params: Record<string, string | number | boolean | undefined> = {}): boolean {
    if (typeof window === 'undefined') return false; // Node tests of the features call beacon() too
    const g = w();
    if (!g.__gsfpvGa || typeof g.gtag !== 'function' || g[DISABLE]) return false;
    const out: Record<string, string | number | boolean> = { site_lang: locale };
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') out[k] = v;
    try { g.gtag('event', name, out); return true; } catch { return false; }
}

/** The counter's property names (apps/api/server.py EVENTS) as GA4 parameters (custom dimensions). */
const RENAME: Record<string, string> = { kind: 'input', load_ms_bucket: 'seconds', flight_s_bucket: 'seconds', on: 'walls_on', cm: 'voxel_cm' };

export function gaParams(p: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(p)) out[RENAME[k] ?? k] = v;
    return out;
}

let card: HTMLElement | null = null;

/** The consent card (again): Decline and Accept of the same weight, a link to the privacy notice. */
export function openConsent(): void {
    if (card || off) return;
    const decide = (yes: boolean): void => {
        card?.remove();
        card = null;
        if (yes) { store('yes'); loadGa(); } else withdraw();
    };
    card = h('div', { class: 'consent-card', role: 'region', 'aria-label': t('consent.title'), 'data-testid': 'consent' },
        h('p', {}, h('strong', {}, t('consent.title')), ' ', t('consent.text'), ' ', h('a', { href: `/${locale}/privacy/`, target: '_blank', rel: 'noopener' }, t('consent.more'))),
        h('div', { class: 'consent-actions' },
            h('button', { type: 'button', class: 'btn primary', 'data-action': 'consent-decline', onclick: () => decide(false) }, t('consent.decline')),
            h('button', { type: 'button', class: 'btn primary', 'data-action': 'consent-accept', onclick: () => decide(true) }, t('consent.accept'))));
    document.body.append(card);
}

/** Whether the pause menu offers "Cookie settings" (not on a test page, where there is no GA at all). */
export function consentSettingsShown(): boolean {
    return !off;
}

let started = false;

/**
 * Once per page, after the boot has settled the address (app/boot.ts): GA when the visitor said yes (here or
 * on the landing), else the card unless they said no. Errors of the page's own scripts go to GA as exception.
 * `testPage`: a bench's page (the first-visit notices are off there too): nothing at all.
 */
export function startAnalytics(testPage: boolean): void {
    if (started || testPage) return;
    started = true;
    off = false;
    const s = stored();
    if (s === 'yes') loadGa();
    else if (s !== 'no') openConsent();
    addEventListener('error', (e: ErrorEvent) => {
        if (e.filename && !e.filename.startsWith(location.origin)) return; // an extension's error is not ours
        const name = e.error instanceof Error ? e.error.name : 'Error';
        gaEvent('exception', { description: String(e.message || name).replace(/https?:\/\/\S+/g, '<url>').slice(0, 100), fatal: false });
    });
}
