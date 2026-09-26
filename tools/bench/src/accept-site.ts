// Phase B acceptance of the landing and what surrounds it, on the live site: B1 certificate,
// B2 languages (the parts verify.mjs does not cover), B3 no fake buttons, B4 SEO/GEO/§17,
// B5 analytics with a REAL hit to Google after consent, B18 repository. Each with its control.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-site.ts [B1 B2 ...]
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import { writeEvidence, REPO, today } from './evidence';
import { waitReady } from './browser';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const HOST = new URL(SITE).host;
const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'b-site');
mkdirSync(SHOTS, { recursive: true });
const cb = () => `cb=${Math.random().toString(36).slice(2)}`;
const url = (p: string) => `${SITE}${p}${p.includes('?') ? '&' : '?'}${cb()}`;
const siteDict = (l: string) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8'));
const summary: Record<string, boolean> = {};
// consent banner of a locale: region label and button words come from the site dictionaries (no foreign letters in this file)
type Consent = { region: string; accept: string; decline: string };
const consentOf = (l: string): Consent => {
    const c = siteDict(l).consent;
    return { region: `[role="region"][aria-label=${JSON.stringify(String(c.title))}]`, accept: String(c.accept), decline: String(c.decline) };
};
const GA_HOSTS = /google-analytics\.com|googletagmanager\.com|analytics\.google\.com/;
function record(id: string, data: Record<string, unknown> & { pass: boolean }): void {
    summary[id] = data.pass;
    writeEvidence(`b-site-${id.toLowerCase()}`, { site: SITE, ...data });
    console.log(`${id} ${data.pass ? 'PASS' : 'FAIL'}`);
}
async function raw(u: string, headers: Record<string, string> = {}): Promise<{ status: number; location: string | null; body: string; type: string | null }> {
    const r = await fetch(u, { redirect: 'manual', headers });
    const body = r.status === 200 ? await r.text() : '';
    return { status: r.status, location: r.headers.get('location'), body, type: r.headers.get('content-type') };
}
async function launchVisible(opts: { locale?: string; width?: number; height?: number } = {}): Promise<{ ctx: BrowserContext; page: Page; close: () => Promise<void> }> {
    const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=60,60'] });
    const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 860 }, locale: opts.locale ?? 'en-US', extraHTTPHeaders: opts.locale ? { 'Accept-Language': opts.locale } : {} });
    const page = await ctx.newPage();
    return { ctx, page, close: () => browser.close() };
}

// ------------------------------------------------------------------ B1 certificate
type CertShape = { subjectCN: string; issuer: string; validTo: number; san: string };
function isProductionCert(c: CertShape, host: string): { ok: boolean; why: string[] } {
    const why: string[] = [];
    if (/STAGING|Fake LE|Pebble/i.test(c.issuer)) why.push('staging issuer');
    if (!/Let's Encrypt/i.test(c.issuer)) why.push('not Let\'s Encrypt');
    if (c.validTo < Date.now() + 60 * 86400e3) why.push('expires within 60 days');
    if (!c.san.split(/,\s*/).includes(`DNS:${host}`)) why.push('host not in SAN');
    return { ok: why.length === 0, why };
}
if (want('B1')) {
    const live = await new Promise<CertShape>((res, rej) => {
        const s = tls.connect({ host: HOST, port: 443, servername: HOST }, () => {
            const c = s.getPeerCertificate();
            res({ subjectCN: String(c.subject?.CN), issuer: `${c.issuer?.O} ${c.issuer?.CN}`, validTo: Date.parse(c.valid_to), san: c.subjectaltname ?? '' });
            s.end();
        });
        s.on('error', rej);
    });
    const verdict = isProductionCert(live, HOST);
    const https200 = (await raw(url('/en/'))).status; // fetch verifies the chain; a bad cert throws
    const http = await raw(`http://${HOST}/en/`);
    // control: the staging certificate saved during the first issue must be rejected
    const pemPath = join(REPO, '.cache', 'staging-gsfpv.pem');
    let control: Record<string, unknown> = { ran: false };
    if (existsSync(pemPath)) {
        const x = new X509Certificate(readFileSync(pemPath));
        const shape: CertShape = { subjectCN: x.subject, issuer: x.issuer.replace(/\n/g, ' '), validTo: Date.parse(x.validTo), san: x.subjectAltName ?? '' };
        const v = isProductionCert(shape, HOST);
        control = { ran: true, issuer: shape.issuer, rejected: !v.ok, why: v.why };
    }
    const pass = verdict.ok && https200 === 200 && http.status === 301 && (http.location ?? '').startsWith(`https://${HOST}/`) && control.rejected === true;
    record('B1', { pass, cert: { ...live, validTo: new Date(live.validTo).toISOString(), daysLeft: Math.round((live.validTo - Date.now()) / 86400e3) }, verdict, https200, http: { status: http.status, location: http.location }, control });
}

// ------------------------------------------------------------------ B2 languages (redirects, persistence, untranslated strings)
if (want('B2')) {
    const r1 = await raw(url('/'), { 'Accept-Language': 'pl-PL,pl;q=0.9' });
    const r2 = await raw(url('/'), { 'Accept-Language': 'pl-PL,pl;q=0.9', Cookie: 'NEXT_LOCALE=ru' });
    // in a browser: Polish visitor lands on /pl/, switches to RU by hand, RU survives "/" and reload
    const B = await launchVisible({ locale: 'pl-PL' });
    await B.page.goto(url('/'));
    const landed = new URL(B.page.url()).pathname;
    const langPl = await B.page.evaluate(() => document.documentElement.lang);
    await B.page.locator('header a[hreflang="ru"], header a[href="/ru/"]').first().click();
    await B.page.waitForURL(/\/ru\//);
    await B.page.goto(url('/'));
    const afterManual = new URL(B.page.url()).pathname;
    await B.page.reload();
    const afterReload = { path: new URL(B.page.url()).pathname, lang: await B.page.evaluate(() => document.documentElement.lang), h1: (await B.page.locator('h1').first().textContent())?.trim() };
    await B.close();
    // hreflang: 4 languages + x-default on every page
    const hreflang: Record<string, number> = {};
    for (const l of LOCALES) for (const p of ['', 'privacy/', 'licenses/']) {
        const b = (await raw(url(`/${l}/${p}`))).body;
        hreflang[`/${l}/${p}`] = new Set([...b.matchAll(/<link rel="alternate" hrefLang="([a-z-]+)"/gi)].map((m) => m[1].toLowerCase())).size;
    }
    // control: strings in ES/PL/RU equal to EN (only brand and technical terms may stay)
    const flat = (o: unknown, pre = ''): Record<string, string> => Object.entries(o as Record<string, unknown>).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [pre + k]: v } : { ...acc, ...flat(v, `${pre}${k}.`) }), {} as Record<string, string>);
    const en = flat(siteDict('en'));
    const TERMS = /^[\s\d.,:;/()+·×%≈—–-]*$|^(ShramkoGSFPV|GitHub|LinkedIn|SuperSplat|PlayCanvas|Rapier|Betaflight|SplatFPV|WebGPU|WebHID|EdgeTX|MIT|FAQ|OK|Email|E-mail|Liftoff|VelociDrone|DJI|RadioMaster|BetaFPV|Pavo20 Pro|3S|Andrii Shramko|zmei116@gmail\.com|Discord|Chrome|Edge|Firefox|Safari|Apache-2\.0|GPL-3\.0|CC BY 4\.0|JSON|CSV|USB|HID|PID|FPV|LOD|GPU|CPU|Gamepad|Raceflight|KISS|Actual|AGENTS\.md|AGENT_SETUP\.md|llms\.txt|SECURITY\.md|docs\/warnings\.md|Studio|Developer|Investor|Vendor|Pilot|Radio|Robots|Hz|ms|mm|m\/s|g)$/i;
    // not prose, so equal in every language by design: enum codes the page translates through t()
    // (".src" = manufacturer/measured/claim/estimate, ".level" = sim/emulated/…) and names or specs
    const CODE_KEY = /\.(src|level)$/;
    const NAME_TOKENS = /^(Safari|iPad|Android|Betaflight|Actual|KISS|Raceflight|Gamepad|API|PlayCanvas|Engine|fdlibm|musl|LAVA|KV|g|≈|>|\/)$/i;
    const isNameOrSpec = (v: string) => v.split(/[\s, ]+/).filter(Boolean).every((w) => NAME_TOKENS.test(w) || /\d/.test(w));
    const same: Record<string, string[]> = {};
    for (const l of ['es', 'pl', 'ru']) {
        const d = flat(siteDict(l));
        same[l] = Object.keys(en).filter((k) => d[k] === en[k] && !TERMS.test(en[k]) && !/https?:\/\//.test(en[k]) && !CODE_KEY.test(k) && !isNameOrSpec(en[k]));
    }
    // control: a copy of RU with one prose string left in English must be caught
    const ru = flat(siteDict('ru'));
    const proseKey = Object.keys(en).find((k) => /^hero\./.test(k) && en[k].split(' ').length > 5 && ru[k] !== en[k]) ?? '';
    const mutated = { ...ru, [proseKey]: en[proseKey] };
    const caught = Object.keys(en).filter((k) => mutated[k] === en[k] && !TERMS.test(en[k]) && !/https?:\/\//.test(en[k]) && !CODE_KEY.test(k) && !isNameOrSpec(en[k])).includes(proseKey);
    const pass = caught && r1.status === 302 && (r1.location ?? '').endsWith('/pl/') && (r2.location ?? '').endsWith('/ru/') && landed === '/pl/' && langPl === 'pl' && afterManual === '/ru/' && afterReload.path === '/ru/' && afterReload.lang === 'ru'
        && Object.values(hreflang).every((n) => n === 5) && Object.values(same).every((a) => a.length === 0);
    record('B2', { pass, note: 'the 16 switcher clicks (nav + footer, landing + privacy) are in verify.mjs run against the live site', acceptLanguagePl: r1, manualRuBeatsPl: { status: r2.status, location: r2.location }, browser: { landed, langPl, afterManual, afterReload }, hreflangPerPage: hreflang, control: { untranslatedStrings: same, exempt: 'keys ending in .src/.level (enum codes translated via t()) and values made only of product names, units and numbers', injected: { key: proseKey, caught } } });
}

// ------------------------------------------------------------------ B3 no fake buttons
// Landings in all four languages, privacy and licenses, and the simulator UI (picker, flight, pause
// menu and every panel it opens). Links need a real target; a button must change the DOM, navigate,
// send a request, move focus away from itself, or cause an effect the DOM does not show (clipboard,
// device chooser, download, new window). Background activity measured before the click does not
// count. Each control is scrolled into view BEFORE that baseline, so the harness's own scroll and the
// lazy images it pulls in are never credited; scrolling and image/font loads never count at all (no
// button on the site or in the simulator only scrolls: if one ever does, it shows up here as dead).

// Runs before any page script on every load: counts the effects the DOM does not show, answers the
// HID chooser with "no device" (a native dialog would block the run), and forgets the stored consent
// so the banner shows on every load and its own buttons are audited too. A string: nothing here may
// be rewritten by the bundler.
const AUDIT_INIT = `(() => {
  const s = { clipboard: 0, device: 0, download: 0, open: 0 };
  window.__auditSide = s;
  try { const c = navigator.clipboard; if (c) { const w = c.writeText.bind(c); c.writeText = (t) => { s.clipboard++; return w(t); }; } } catch (e) {}
  try { if (navigator.hid) navigator.hid.requestDevice = async () => { s.device++; return []; }; } catch (e) {}
  const ac = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) s.download++; return ac.call(this); };
  const wo = window.open;
  window.open = function () { s.open++; return wo.apply(window, arguments); };
  try { localStorage.removeItem('gsfpv_consent'); } catch (e) {}
})();`;

type Row = { i: number; tag: string; href: string | null; abs: string; text: string; banner: boolean };
type Tagged = { rows: Row[]; hidden: number; disabled: string[]; scopeFound: boolean };
type Planted = { text: string; belowFold: boolean };
type Side = { clipboard: number; device: number; download: number; open: number };
interface Surface {
    name: string;
    open: (page: Page) => Promise<void>;
    scope?: string; // audit only inside the last element matching this (a panel); default: the whole page
    consent?: Consent;
    inject?: 'main' | 'body'; // plant inert buttons (negative control)
    onlyInjected?: boolean;
}
interface SurfaceResult {
    total: number;
    links: number;
    buttons: number;
    dead: string[];
    effects: Record<string, string>;
    skipped: { hidden: number; disabled: string[] };
    consent?: Record<string, unknown>;
    planted?: Planted[];
    error?: string;
}

/** Tag every visible, enabled control in scope with data-audit-id (numbered in that same filtered order). */
async function tagControls(page: Page, scope: string | null, region: string | null): Promise<Tagged> {
    return page.evaluate(({ scope, region }) => {
        for (const e of document.querySelectorAll('[data-audit-id]')) e.removeAttribute('data-audit-id');
        const roots = scope ? document.querySelectorAll(scope) : null;
        const root: ParentNode | null = roots ? (roots[roots.length - 1] ?? null) : document;
        if (!root) return { rows: [], hidden: 0, disabled: [], scopeFound: false };
        const all = [...root.querySelectorAll('a, button, [role=button]')] as HTMLElement[];
        const shown = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
        const enabled = shown.filter((e) => !(e as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true');
        const disabled = shown.filter((e) => !enabled.includes(e)).map((e) => (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || e.getAttribute('aria-label') || e.tagName);
        const rows = enabled.map((e, i) => {
            e.setAttribute('data-audit-id', String(i));
            const abs = (e as HTMLAnchorElement).href;
            return { i, tag: e.tagName.toLowerCase(), href: e.getAttribute('href'), abs: typeof abs === 'string' ? abs : '', text: (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || e.getAttribute('aria-label') || '', banner: !!region && !!e.closest(region) };
        });
        return { rows, hidden: all.length - shown.length, disabled, scopeFound: true };
    }, { scope: scope ?? null, region: region ?? null });
}

/** Plant inert buttons. In <main>: one first (first screen) and one last (below the fold, so a scroll
 *  before the click and the lazy images it loads must not make it look alive); on the flight page one
 *  fixed button over the canvas, where the HUD and the scene stream never stop. */
async function injectInert(page: Page, where: 'main' | 'body'): Promise<Planted[]> {
    return page.evaluate((where) => {
        const make = (text: string) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'inert-control'; b.textContent = text; return b; };
        const planted: HTMLButtonElement[] = [];
        if (where === 'body') {
            const b = make('Inert fixed');
            b.style.cssText = 'position:fixed;left:12px;top:140px;z-index:2147483647';
            document.body.append(b);
            planted.push(b);
        } else {
            const m = document.querySelector('main') ?? document.body;
            const top = make('Inert top');
            const end = make('Inert end');
            m.prepend(top);
            m.append(end);
            planted.push(top, end);
        }
        return planted.map((b) => ({ text: b.textContent ?? '', belowFold: b.getBoundingClientRect().top + scrollY >= innerHeight }));
    }, where);
}

async function prepare(page: Page, s: Surface): Promise<Tagged & { planted: Planted[] }> {
    await s.open(page);
    const planted = s.inject ? await injectInert(page, s.inject) : [];
    return { ...(await tagControls(page, s.scope ?? null, s.consent?.region ?? null)), planted };
}

// requests to a host already busy before the click (scene streaming) are background, except document
// loads; the site's own API only counts when the baseline had none and it is not a beacon the app
// sends by itself (apps/fly/src/main.ts: crash)
const reqKey = (u: string): string => { try { return new URL(u).host; } catch { return u.slice(0, 40); } };
const BACKGROUND_BEACONS = new Set(['crash']);
const beaconEvent = (body: string | null): string => { try { return String((JSON.parse(body ?? '') as { e?: unknown }).e ?? ''); } catch { return ''; } };
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function auditSurface(page: Page, s: Surface): Promise<SurfaceResult> {
    const out: SurfaceResult = { total: 0, links: 0, buttons: 0, dead: [], effects: {}, skipped: { hidden: 0, disabled: [] } };
    try {
        const first = await prepare(page, s);
        if (!first.scopeFound) throw new Error(`scope ${s.scope} not found`);
        if (s.inject) out.planted = first.planted;
        const plantedTexts = first.planted.map((p) => p.text);
        const rows = s.onlyInjected ? first.rows.filter((r) => r.tag === 'button' && plantedTexts.includes(r.text)) : first.rows;
        out.total = first.rows.length;
        out.skipped = { hidden: first.hidden, disabled: first.disabled };
        const consent: Record<string, unknown> = {};
        if (s.consent) {
            const seen = first.rows.filter((r) => r.banner && r.tag !== 'a').map((r) => r.text);
            consent.shown = seen.length > 0;
            consent.buttons = seen;
            if (!seen.some((t) => t.toLowerCase().includes(s.consent!.accept.toLowerCase())) || !seen.some((t) => t.toLowerCase().includes(s.consent!.decline.toLowerCase()))) out.dead.push('consent banner: accept/decline buttons not found');
        }
        // links first, while the page is still in its opened state
        for (const r of rows.filter((x) => x.tag === 'a')) {
            out.links++;
            const h = r.href ?? '';
            const label = `${r.i} a "${r.text}"`;
            if (!h || h === '#' || /^javascript:/i.test(h)) { out.dead.push(`${label} has no target`); continue; }
            let u: URL | null = null;
            try { u = new URL(r.abs || h, page.url()); } catch { out.dead.push(`${label} bad href ${h}`); continue; }
            if (u.host !== HOST || !/^https?:$/.test(u.protocol)) { out.effects[label] = u.protocol === 'mailto:' ? 'mailto' : `external ${u.host}`; continue; }
            const here = new URL(page.url());
            if (u.pathname === here.pathname && u.hash) {
                const id = decodeURIComponent(u.hash.slice(1));
                const exists = await page.evaluate((id) => !!document.getElementById(id), id);
                if (!exists) out.dead.push(`${label} -> ${h}: no element #${id} on the page`);
                out.effects[label] = `anchor #${id}`;
                continue;
            }
            if (u.hash) {
                // anchor on another page (e.g. /en/#risks from privacy): the target page must have that id
                const id = decodeURIComponent(u.hash.slice(1));
                const r2 = await fetch(url(u.pathname + u.search));
                const body = r2.ok ? await r2.text() : '';
                const has = new RegExp(`\\sid=["']${escRe(id)}["']`).test(body);
                if (!r2.ok || !has) out.dead.push(`${label} -> ${h}: ${r2.ok ? `no element #${id} on ${u.pathname}` : `${r2.status}`}`);
                out.effects[label] = `link ${r2.status}, anchor #${id} ${has ? 'found' : 'missing'}`;
                continue;
            }
            const st = (await raw(url(u.pathname + u.search))).status;
            if (![200, 301, 302].includes(st)) out.dead.push(`${label} -> ${h} ${st}`);
            out.effects[label] = `link ${st}`;
        }
        for (const r of rows.filter((x) => x.tag !== 'a')) {
            out.buttons++;
            const label = `${r.i} ${r.tag} "${r.text}"`;
            const again = await prepare(page, s);
            const now = again.rows[r.i];
            // same position must be the same control, or the click would test a different one
            if (!now || now.tag !== r.tag || now.text !== r.text) { out.dead.push(`${label}: list changed on reload (got ${now ? `${now.tag} "${now.text}"` : 'nothing'})`); continue; }
            if (s.consent && !r.banner) {
                // banner out of the way for everything that is not the banner itself
                await page.locator(`${s.consent.region} button`, { hasText: s.consent.decline }).click({ timeout: 3000 }).catch(() => undefined);
                await page.waitForTimeout(200);
            }
            const target = page.locator(`[data-audit-id="${r.i}"]`);
            // into view BEFORE the baseline: that scroll and the lazy images it loads are the harness's doing
            await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
            await page.evaluate(() => {
                const a = { phase: 'base', base: new Set<Node>(), hits: 0 };
                (window as unknown as { __audit: typeof a }).__audit = a;
                new MutationObserver((ms) => {
                    for (const m of ms) {
                        const t = m.target;
                        if (a.phase === 'base') a.base.add(t);
                        else if (!a.base.has(t) && !(t.nodeType === 3 && t.parentNode && a.base.has(t.parentNode))) a.hits++;
                    }
                }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
            });
            const baseHosts = new Set<string>();
            const caused: string[] = [];
            let phase: 'base' | 'click' = 'base';
            let gtag = 0, navs = 0, downloads = 0, baseApi = 0;
            const onReq = (q: import('playwright').Request) => {
                const k = reqKey(q.url());
                if (/googletagmanager\.com\/gtag\/js/.test(q.url()) && phase === 'click') gtag++;
                // images and fonts follow layout and scrolling, never a button's own work
                if (q.resourceType() === 'image' || q.resourceType() === 'font') return;
                let path = '';
                try { path = new URL(q.url()).pathname; } catch { /* not a URL */ }
                const own = k === HOST && path.startsWith('/api/');
                if (phase === 'base') { baseHosts.add(k); if (own) baseApi++; return; }
                if (own) {
                    const ev = beaconEvent(q.postData());
                    if (baseApi === 0 && !BACKGROUND_BEACONS.has(ev)) caused.push(`${q.method()} ${k}${path}${ev ? ` ${ev}` : ''}`);
                    return;
                }
                if (!baseHosts.has(k) || q.resourceType() === 'document') caused.push(`${q.method()} ${k}`);
            };
            const onNav = (f: import('playwright').Frame) => { if (phase === 'click' && f === page.mainFrame()) navs++; };
            const onDl = () => { downloads++; };
            page.on('request', onReq);
            page.on('framenavigated', onNav);
            page.on('download', onDl);
            await page.waitForTimeout(1000); // baseline: what changes with nobody touching anything
            const before = await page.evaluate(() => ({ url: location.href, focus: document.activeElement?.outerHTML.slice(0, 80) ?? '', y: scrollY, side: { ...((window as unknown as { __auditSide?: Record<string, number> }).__auditSide ?? {}) } }));
            await page.evaluate(() => { (window as unknown as { __audit: { phase: string } }).__audit.phase = 'click'; });
            phase = 'click';
            let clickErr = '';
            await target.click({ timeout: 3000 }).catch((e: Error) => { clickErr = String(e.message).split('\n')[0].slice(0, 160); });
            await page.waitForTimeout(500);
            page.off('request', onReq);
            page.off('framenavigated', onNav);
            page.off('download', onDl);
            const after = await page.evaluate((id) => ({ url: location.href, dom: (window as unknown as { __audit?: { hits: number } }).__audit?.hits ?? 0, focus: document.activeElement?.outerHTML.slice(0, 80) ?? '', focusIsClicked: document.activeElement?.getAttribute('data-audit-id') === id, y: scrollY, side: { ...((window as unknown as { __auditSide?: Record<string, number> }).__auditSide ?? {}) } }), String(r.i)).catch(() => null);
            if (clickErr) { out.dead.push(`${label} not clickable: ${clickErr}`); out.effects[label] = 'not clickable'; continue; }
            const eff: string[] = [];
            const notes: string[] = []; // recorded, never credited
            if (navs > 0 || !after || after.url !== before.url) eff.push('nav');
            if (after) {
                if (after.dom > 0) eff.push(`dom ${after.dom}`);
                // focus moved to a field it asks for; a click focusing the clicked control itself is not an effect
                if (after.focus !== before.focus && !after.focusIsClicked && !/^<button/.test(after.focus)) eff.push('focus');
                if (Math.abs(after.y - before.y) > 20) notes.push('scroll (not counted)');
                for (const k of ['clipboard', 'device', 'download', 'open'] as (keyof Side)[]) if ((after.side[k] ?? 0) > (before.side[k] ?? 0)) eff.push(k);
            }
            if (downloads > 0 && !eff.includes('download')) eff.push('download');
            if (caused.length) eff.push(`req ${caused[0]}`);
            out.effects[label] = [...eff, ...notes].join(', ') || 'nothing';
            if (eff.length === 0) out.dead.push(`${label} did nothing`);
            if (s.consent && r.banner) {
                // decline: banner gone and nothing from Google; accept: banner gone and gtag requested (routed to 204)
                const kind = r.text.toLowerCase().includes(s.consent.accept.toLowerCase()) ? 'accept' : r.text.toLowerCase().includes(s.consent.decline.toLowerCase()) ? 'decline' : 'other';
                const bannerGone = (await page.locator(s.consent.region).count()) === 0;
                const ok = kind === 'accept' ? bannerGone && gtag > 0 : kind === 'decline' ? bannerGone && gtag === 0 : true;
                consent[kind] = { text: r.text, bannerGone, gtagRequested: gtag, ok };
                if (!ok) out.dead.push(`consent ${kind} "${r.text}": bannerGone=${bannerGone} gtagRequests=${gtag}`);
            }
        }
        if (s.consent) out.consent = consent;
    } catch (e) {
        out.error = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);
    }
    return out;
}

const landing = (p: string, l: string): Surface => ({
    name: p,
    consent: consentOf(l),
    open: async (page) => {
        await page.goto(url(p), { waitUntil: 'networkidle' });
        await page.locator(consentOf(l).region).waitFor({ timeout: 8000 }).catch(() => undefined); // banner mounts after hydration
    }
});
const FLY_SCENE = 'scene=39e63ce9&nowarn=1&input=touch';
async function openFlight(page: Page): Promise<void> {
    await page.goto(url(`/en/fly/?${FLY_SCENE}`));
    const h = await waitReady(page, 180000);
    if (h.status !== 'ready') throw new Error(`flight did not start: ${String(h.status)} ${String(h.error ?? '')}`);
    await page.waitForTimeout(800);
}
const viaPause = (action: string, before?: (page: Page) => Promise<void>) => async (page: Page): Promise<void> => {
    await openFlight(page);
    if (before) await before(page);
    await page.click('[data-action="pause"]', { timeout: 5000 });
    await page.click(`[data-action="${action}"]`, { timeout: 5000 });
    await page.waitForTimeout(300);
};
const PANEL = '.panel[role=dialog]';
const FLY_SURFACES: Surface[] = [
    {
        name: '/en/fly/ first-visit warning',
        scope: PANEL,
        open: async (page) => {
            await page.goto(url('/en/fly/'));
            await page.evaluate(() => { try { localStorage.removeItem('gsfpv.warned'); } catch { /* blocked storage */ } });
            await page.reload();
            await page.locator('[data-action="warning-ok"]').waitFor({ timeout: 30000 });
        }
    },
    {
        name: '/en/fly/ picker',
        open: async (page) => {
            // clean storage: favourites and recents would reorder the cards between reloads
            await page.goto(url('/en/fly/?nowarn=1'));
            await page.evaluate(() => { try { localStorage.clear(); } catch { /* blocked storage */ } });
            await page.goto(url('/en/fly/?nowarn=1'));
            const h = await waitReady(page, 60000);
            if (h.status !== 'picker') throw new Error(`picker did not show: ${String(h.status)}`);
        }
    },
    { name: 'flight: top buttons and overlays', open: openFlight },
    { name: 'flight: pause menu', scope: PANEL, open: async (page) => { await openFlight(page); await page.click('[data-action="pause"]', { timeout: 5000 }); await page.waitForTimeout(300); } },
    { name: 'flight: settings', scope: PANEL, open: viaPause('pause.settings') },
    { name: 'flight: drones', scope: '.screen.drones', open: viaPause('pause.drone') },
    { name: 'flight: radio', scope: '.screen.radio', open: viaPause('pause.radio') },
    // one saved flight so the replay row with play / CSV / JSON exists
    { name: 'flight: replays', scope: PANEL, open: viaPause('pause.replays', async (page) => { await page.evaluate(() => { (window as unknown as { __gsfpv: { saveLog: (l: string) => unknown } }).__gsfpv.saveLog('audit'); }); }) },
    { name: 'flight: measure', scope: PANEL, open: viaPause('pause.measure') },
    { name: 'flight: import', scope: PANEL, open: viaPause('pause.import') },
    { name: 'flight: cinema', open: viaPause('pause.cinema') }
];

if (want('B3')) {
    const release = await raw(url('/release.json')).then((r) => { try { return JSON.parse(r.body) as unknown; } catch { return { status: r.status }; } });
    const prep = async (ctx: BrowserContext) => {
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
        await ctx.addInitScript(AUDIT_INIT);
        await ctx.route(GA_HOSTS, (r) => r.fulfill({ status: 204 })); // Accept still shows up as a gtag request
        await ctx.route('**/api/e', (r) => r.fulfill({ status: 204 }));
        await ctx.route('**/api/lead', (r) => r.fulfill({ status: 204 }));
    };
    const pages: Record<string, SurfaceResult> = {};
    const controls: Record<string, SurfaceResult> = {};
    const B = await launchVisible();
    await prep(B.ctx);
    for (const l of LOCALES) pages[`/${l}/`] = await auditSurface(B.page, landing(`/${l}/`, l));
    for (const p of ['/en/privacy/', '/en/licenses/']) pages[p] = await auditSurface(B.page, landing(p, 'en'));
    controls['/en/ + inert buttons first and last in main'] = await auditSurface(B.page, { ...landing('/en/', 'en'), inject: 'main', onlyInjected: true });
    for (const s of FLY_SURFACES) pages[s.name] = await auditSurface(B.page, s);
    // on the flight page the HUD and the scene stream never stop: the inert button must still be caught
    controls['flight + inert button over the canvas'] = await auditSurface(B.page, { name: 'flight control', open: openFlight, inject: 'body', onlyInjected: true });
    await B.close();
    // phone width: sticky CTA and the mobile header are only there
    const M = await launchVisible({ width: 390, height: 844 });
    await prep(M.ctx);
    pages['/en/ (390x844)'] = await auditSurface(M.page, landing('/en/', 'en'));
    await M.close();
    // fired = EVERY planted button was clicked and judged "did nothing" ("not clickable" or "list changed"
    // entries do not count), and the landing run had one planted below the fold
    const fired = Object.fromEntries(Object.entries(controls).map(([k, r]) => {
        const planted = r.planted ?? [];
        const allCaught = planted.length > 0 && planted.every((p) => r.dead.some((d) => d.includes(`"${p.text}"`) && d.endsWith('did nothing')));
        const foldOk = !k.startsWith('/en/') || planted.some((p) => p.belowFold);
        return [k, !r.error && allCaught && foldOk];
    }));
    const pass = Object.values(pages).every((r) => !r.error && r.total > 0 && r.dead.length === 0) && Object.values(fired).every(Boolean);
    record('B3', {
        pass,
        release,
        rule: 'links: a real target (internal ones answer 200/30x, same-page anchors exist, anchors on another page exist in its HTML); buttons: each on a fresh load, scrolled into view BEFORE a 1 s baseline, clicked by data-audit-id; within 500 ms of the click a DOM mutation outside what changed in the baseline, a navigation, a request (not an image or font, not to a host busy in the baseline except documents; /api/ only if the baseline had none and not a crash beacon), focus moving to a non-button that is not the clicked control, a clipboard write, a device chooser, a download or a new window; scrolling is recorded but never counted; consent decline hides the banner, accept hides it and requests gtag',
        totals: { controls: Object.values(pages).reduce((a, r) => a + r.total, 0), buttonsClicked: Object.values(pages).reduce((a, r) => a + r.buttons, 0), linksChecked: Object.values(pages).reduce((a, r) => a + r.links, 0) },
        pages,
        control: { injectedInertButtons: 'landing: first and last in <main> (the last below the fold); flight: one fixed over the canvas', fired, runs: controls }
    });
}

// ------------------------------------------------------------------ B4 SEO / GEO / §17
const LD_BLOCK = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
/** @type values of every JSON-LD block; a block that does not parse becomes '<broken>'. */
function jsonLdTypes(html: string): string[] {
    return [...html.matchAll(LD_BLOCK)].flatMap((m) => { try { const j = JSON.parse(m[1]); return (Array.isArray(j) ? j : j['@graph'] ?? [j]).map((x: { '@type': string }) => x['@type']); } catch { return ['<broken>']; } });
}
const ldOk = (types: string[]): boolean => types.includes('SoftwareApplication') && !types.includes('<broken>');
/** Placeholder words in what a reader sees: the rule of scripts/smoke-release.mjs (scripts, styles and attribute names removed; Spanish "todo" is a word, so only upper-case TODO). */
function placeholderHits(html: string): string[] {
    const seen = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/\s[a-zA-Z_:][-a-zA-Z0-9_:.]*=/g, ' ');
    return [...seen.matchAll(/\b(undefined|TODO|PLACEHOLDER)\b|[Ll]orem ipsum/g)].map((m) => seen.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30).replace(/\s+/g, ' '));
}
if (want('B4')) {
    const sitemap = await raw(url('/sitemap.xml'));
    const robots = await raw(url('/robots.txt'));
    const llms = await raw(url('/llms.txt'));
    const og = Buffer.from(await (await fetch(url('/og.png'))).arrayBuffer());
    const ogSize = og.subarray(1, 4).toString() === 'PNG' ? { w: og.readUInt32BE(16), h: og.readUInt32BE(20) } : null;
    const robotsAllows = ['GPTBot', 'ClaudeBot', 'PerplexityBot'].every((b) => new RegExp(`User-agent: ${b}\\s+Allow: /`, 'i').test(robots.body));
    const canon: Record<string, string | null> = {};
    const ldTypes: Record<string, string[]> = {};
    const contacts: Record<string, Record<string, boolean>> = {};
    const placeholders: Record<string, string[]> = {};
    const htmlOf: Record<string, string> = {};
    for (const l of LOCALES) for (const p of ['', 'privacy/', 'licenses/']) {
        const b = (await raw(url(`/${l}/${p}`))).body;
        htmlOf[`/${l}/${p}`] = b;
        placeholders[`/${l}/${p}`] = b ? placeholderHits(b) : ['<no body>'];
        canon[`/${l}/${p}`] = b.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
        if (p === '') {
            ldTypes[l] = jsonLdTypes(b);
            const d = siteDict(l);
            const phrase = (d.contact?.open ?? '') as string;
            const html = b.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            contacts[l] = { name: html.includes('Andrii Shramko'), linkedin: html.includes('https://www.linkedin.com/in/andrii-shramko/'), calendar: html.includes('https://calendar.app.google/Ff729HqGk4RpzPNDA'), email: html.includes('mailto:zmei116@gmail.com'), github: html.includes('https://github.com/AndriiShramko'), phrase: !!phrase && html.includes(phrase), agentBlock: html.includes('AGENT_SETUP.md'), risks: /id="risks"/.test(html) };
        }
    }
    for (const l of LOCALES) { const b = (await raw(url(`/${l}/fly/`))).body; placeholders[`/${l}/fly/`] = b ? placeholderHits(b) : ['<no body>']; }
    const canonOk = Object.entries(canon).every(([p, c]) => c === `${SITE}${p}`) && new Set(Object.values(canon)).size === 12;
    // controls through the same functions: the live /en/ page with its first JSON-LD block cut short,
    // and the same page with a TODO in its visible text
    const enHtml = htmlOf['/en/'] ?? '';
    const brokenHtml = enHtml.replace(/(<script type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/, (_m, a: string, j: string, c: string) => a + j.trimEnd().slice(0, -1) + c);
    const brokenTypes = jsonLdTypes(brokenHtml);
    const ldControl = { blocksOnPage: [...enHtml.matchAll(LD_BLOCK)].length, typesLive: jsonLdTypes(enHtml), typesBrokenCopy: brokenTypes, reported: brokenTypes.includes('<broken>'), pageCheckFails: !ldOk(brokenTypes) };
    const todoHtml = enHtml.includes('</main>') ? enHtml.replace('</main>', '<p>TODO</p></main>') : enHtml.replace('</body>', '<p>TODO</p></body>');
    const phControl = { hitsLive: placeholderHits(enHtml).length, hitsInjected: placeholderHits(todoHtml), caught: placeholderHits(todoHtml).length > placeholderHits(enHtml).length };
    // "For your AI agent": the copy button really puts the prompt shown on the page on the clipboard
    const clipboard: Record<string, Record<string, unknown>> = {};
    const CB = await launchVisible();
    await CB.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
    await CB.ctx.route(GA_HOSTS, (r) => r.fulfill({ status: 204 }));
    await CB.ctx.route('**/api/e', (r) => r.fulfill({ status: 204 }));
    for (const l of LOCALES) {
        const P = CB.page;
        await P.goto(url(`/${l}/`), { waitUntil: 'networkidle' });
        await P.bringToFront();
        const c = consentOf(l);
        await P.locator(c.region).waitFor({ timeout: 8000 }).catch(() => undefined);
        await P.locator(`${c.region} button`, { hasText: c.decline }).click({ timeout: 3000 }).catch(() => undefined);
        const shown = ((await P.locator('#agent-prompt').textContent()) ?? '').trim();
        const btn = P.locator('button[aria-describedby="agent-prompt"]');
        const sentinel = `gsfpv-b4-sentinel-${cb()}`; // a stale clipboard cannot pass
        await P.evaluate((s) => navigator.clipboard.writeText(s), sentinel);
        const labelBefore = ((await btn.textContent()) ?? '').trim();
        await btn.click();
        await P.waitForTimeout(300);
        const got = await P.evaluate(() => navigator.clipboard.readText()).catch((e: Error) => `<read failed: ${e.message.slice(0, 80)}>`);
        const labelAfter = ((await btn.textContent()) ?? '').trim();
        const copiedWord = String(siteDict(l).agents.copied);
        clipboard[l] = { shownChars: shown.length, clipboardChars: got.length, clipboardStart: got.slice(0, 80), sentinelReplaced: got !== sentinel, equalsShownPrompt: shown.length > 0 && got.trim() === shown, labelBefore, labelAfter, labelIsCopied: labelAfter === copiedWord };
    }
    await CB.close();
    const clipOk = Object.values(clipboard).every((c) => c.equalsShownPrompt === true && c.sentinelReplaced === true && c.labelIsCopied === true);
    // Lighthouse accessibility, mobile (headless is fine for a11y; no GPU involved)
    const lh: Record<string, number | string> = {};
    for (const l of ['en', 'ru']) {
        try {
            const out = execSync(`npx -y lighthouse@12 "${SITE}/${l}/" --only-categories=accessibility --form-factor=mobile --screenEmulation.mobile --output=json --quiet --chrome-flags="--headless=new"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
            lh[l] = Math.round(JSON.parse(out).categories.accessibility.score * 100);
        } catch (e) { lh[l] = `error: ${String(e).slice(0, 120)}`; }
    }
    const pass = sitemap.status === 200 && (sitemap.body.match(/<loc>/g) ?? []).length === 12 && robots.status === 200 && robotsAllows && llms.status === 200 && ogSize?.w === 1200 && ogSize?.h === 630
        && canonOk && Object.values(ldTypes).every(ldOk) && Object.values(contacts).every((c) => Object.values(c).every(Boolean))
        && Object.values(placeholders).every((h) => h.length === 0) && clipOk
        && ldControl.reported && ldControl.pageCheckFails && phControl.caught
        && Object.values(lh).every((v) => typeof v === 'number' && v >= 95);
    record('B4', {
        pass, sitemap: { status: sitemap.status, locs: (sitemap.body.match(/<loc>/g) ?? []).length }, robots: { status: robots.status, aiCrawlersAllowed: robotsAllows }, llms: llms.status, ogImage: ogSize, canonical: { ok: canonOk, pages: canon }, jsonLd: ldTypes, contacts,
        agentPromptClipboard: clipboard, placeholders: { rule: 'visible text as in scripts/smoke-release.mjs', pages: placeholders },
        lighthouseA11yMobile: lh, lighthouseMode: 'headless=new (accessibility only, no GPU involved); every other check here ran in a visible window',
        control: { brokenJsonLd: ldControl, injectedTodo: phControl }
    });
}

// ------------------------------------------------------------------ B5 analytics (real Google hit after consent)
/** GA4 event names of a /g/collect hit: en= in the query, or one per line of a batched body. */
function collectEvents(u: string, body: string | null): string[] {
    const names = new Set<string>();
    let q = '';
    try { q = new URL(u).search.slice(1); } catch { /* not a URL */ }
    for (const part of [q, ...(body ?? '').split(/\r?\n/)]) { const v = new URLSearchParams(part).get('en'); if (v) names.add(v); }
    return [...names];
}
if (want('B5')) {
    const B = await launchVisible();
    const google: { url: string; status: number }[] = [];
    const collects: { status: number; events: string[] }[] = [];
    B.page.on('response', (r) => {
        if (GA_HOSTS.test(r.url())) google.push({ url: r.url().split('?')[0], status: r.status() });
        if (/\/g\/collect/.test(r.url())) collects.push({ status: r.status(), events: collectEvents(r.url(), r.request().postData()) });
    });
    await B.page.goto(url('/en/'), { waitUntil: 'networkidle' });
    await B.page.waitForTimeout(2500);
    const before = { gaCookies: (await B.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).length, googleRequests: google.length, banner: await B.page.locator('[aria-label="Analytics cookies"]').count() };
    const beacon = await B.page.evaluate(async () => (await fetch('/api/e', { method: 'POST', body: JSON.stringify({ e: 'page_view', p: { locale: 'en' } }) })).status);
    const acceptBtn = B.page.locator('[aria-label="Analytics cookies"] button', { hasText: 'Accept' });
    const acceptText = (await acceptBtn.textContent())?.trim();
    const collect = B.page.waitForResponse((r) => /\/g\/collect/.test(r.url()), { timeout: 30000 }).catch(() => null);
    await acceptBtn.click();
    const hit = await collect;
    await B.page.waitForTimeout(1500);
    const after = {
        gaCookies: (await B.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).length, collectStatus: hit?.status() ?? null, collectHost: hit ? new URL(hit.url()).host : null,
        collectEvents: hit ? collectEvents(hit.url(), hit.request().postData()) : [], gtagLoaded: google.some((g) => /gtag\/js/.test(g.url) && g.status === 200)
    };
    await B.page.reload({ waitUntil: 'networkidle' });
    await B.page.waitForTimeout(1500);
    const reload = { banner: await B.page.locator('[aria-label="Analytics cookies"]').count(), gaCookies: (await B.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).length };
    await B.close();
    // the event reader itself: a hit without en= must give nothing, a batched body must give each name
    const parserControl = { noEvent: collectEvents('https://region1.google-analytics.com/g/collect?v=2&tid=G-X', null), batched: collectEvents('https://region1.google-analytics.com/g/collect?v=2', 'en=page_view&_et=1\nen=scroll&_et=2') };
    const parserOk = parserControl.noEvent.length === 0 && parserControl.batched.join(',') === 'page_view,scroll';
    const pass = before.gaCookies === 0 && before.googleRequests === 0 && before.banner === 1 && beacon === 204 && after.gaCookies > 0 && after.collectStatus === 204 && after.collectEvents.length > 0 && after.gtagLoaded && reload.banner === 0 && reload.gaCookies > 0 && parserOk;
    record('B5', { pass, measurementId: 'G-E7X0ES0QBE', beforeConsent: { ...before, apiEvent: beacon }, acceptButton: acceptText, afterAccept: after, collectHits: collects, afterReload: reload, control: { beforeConsentGaCookies: before.gaCookies, googleRequestsBeforeConsent: before.googleRequests, eventParser: { ...parserControl, ok: parserOk } } });
}

console.log(JSON.stringify(summary));
