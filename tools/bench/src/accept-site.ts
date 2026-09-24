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
async function auditControls(page: Page, path: string, inject: boolean): Promise<{ total: number; dead: string[]; links: number; buttons: number }> {
    await page.goto(url(path), { waitUntil: 'networkidle' });
    const dismiss = page.locator('[aria-label="Analytics cookies"] button', { hasText: 'Decline' });
    if (await dismiss.count()) await dismiss.click().catch(() => undefined); // decline: banner out of the way
    if (inject) await page.evaluate(() => { const b = document.createElement('button'); b.id = 'inert-control'; b.textContent = 'Inert'; b.type = 'button'; document.querySelector('main')?.prepend(b); });
    const list = await page.evaluate(() => [...document.querySelectorAll('a, button, [role=button]')].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !(e as HTMLButtonElement).disabled; }).map((e, i) => { (e as HTMLElement).dataset.auditId = String(i); return { i, tag: e.tagName.toLowerCase(), href: (e as HTMLAnchorElement).getAttribute('href'), text: (e.textContent ?? '').trim().slice(0, 40) || e.getAttribute('aria-label') || '' }; }));
    const dead: string[] = [];
    let links = 0, buttons = 0;
    for (const el of list) {
        if (el.tag === 'a') {
            links++;
            if (!el.href || el.href === '#') { dead.push(`a "${el.text}" has no target`); continue; }
            if (el.href.startsWith('/') && !el.href.startsWith('//')) {
                const tgt = el.href.split('#')[0];
                if (tgt) { const s = (await raw(url(tgt))).status; if (![200, 301, 302].includes(s)) dead.push(`a "${el.text}" -> ${el.href} ${s}`); }
            }
            continue;
        }
        buttons++;
        // a button must do something observable: DOM change, navigation, a request, or the clipboard
        await page.goto(url(path), { waitUntil: 'networkidle' });
        const d2 = page.locator('[aria-label="Analytics cookies"] button', { hasText: 'Decline' });
        if (await d2.count() && !el.text.match(/accept|decline|akcept|odrzu|acept|rechaz|принять|отклон/i)) await d2.click().catch(() => undefined);
        if (inject) await page.evaluate(() => { const b = document.createElement('button'); b.id = 'inert-control'; b.textContent = 'Inert'; b.type = 'button'; document.querySelector('main')?.prepend(b); });
        await page.evaluate(() => { const w = window as unknown as { __mut: number }; w.__mut = 0; new MutationObserver((m) => { w.__mut += m.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); });
        const before = page.url();
        const focusBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? '');
        let requests = 0;
        const onReq = () => { requests++; };
        page.on('request', onReq);
        const target = inject && el.text === 'Inert' ? page.locator('#inert-control') : page.locator(`a, button, [role=button]`).nth(el.i);
        await target.click({ timeout: 3000, trial: false }).catch(() => undefined);
        await page.waitForTimeout(400);
        page.off('request', onReq);
        const mut = await page.evaluate(() => (window as unknown as { __mut: number }).__mut).catch(() => 1);
        const focusAfter = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? '').catch(() => focusBefore);
        const focusMoved = focusAfter !== focusBefore && !/^<button/.test(focusAfter); // focus moved to a field it asks for
        if (mut === 0 && page.url() === before && requests === 0 && !focusMoved) dead.push(`button "${el.text}" did nothing`);
    }
    return { total: list.length, dead, links, buttons };
}
if (want('B3')) {
    const B = await launchVisible();
    await B.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
    await B.ctx.route(/google-analytics\.com|googletagmanager\.com|analytics\.google\.com/, (r) => r.fulfill({ status: 204 })); // no GA noise from this audit
    await B.ctx.route('**/api/e', (r) => r.fulfill({ status: 204 }));
    await B.ctx.route('**/api/lead', (r) => r.fulfill({ status: 204 }));
    const pages: Record<string, unknown> = {};
    for (const p of ['/en/', '/en/privacy/', '/en/licenses/', '/ru/']) pages[p] = await auditControls(B.page, p, false);
    const ctl = await auditControls(B.page, '/en/licenses/', true);
    await B.close();
    const pass = Object.values(pages).every((r) => (r as { dead: string[] }).dead.length === 0) && ctl.dead.some((d) => d.includes('Inert'));
    record('B3', { pass, rule: 'links: a real target (internal ones answer 200/30x); buttons: a DOM mutation, a navigation, or a request within 400 ms of a click', pages, control: { injectedInertButton: true, flagged: ctl.dead, fired: ctl.dead.some((d) => d.includes('Inert')) } });
}

// ------------------------------------------------------------------ B4 SEO / GEO / §17
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
    for (const l of LOCALES) for (const p of ['', 'privacy/', 'licenses/']) {
        const b = (await raw(url(`/${l}/${p}`))).body;
        canon[`/${l}/${p}`] = b.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
        if (p === '') {
            ldTypes[l] = [...b.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const j = JSON.parse(m[1]); return (Array.isArray(j) ? j : j['@graph'] ?? [j]).map((x: { '@type': string }) => x['@type']); } catch { return ['<broken>']; } });
            const d = siteDict(l);
            const phrase = (d.contact?.open ?? '') as string;
            const html = b.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            contacts[l] = { name: html.includes('Andrii Shramko'), linkedin: html.includes('https://www.linkedin.com/in/andrii-shramko/'), calendar: html.includes('https://calendar.app.google/Ff729HqGk4RpzPNDA'), email: html.includes('mailto:zmei116@gmail.com'), github: html.includes('https://github.com/AndriiShramko'), phrase: !!phrase && html.includes(phrase), agentBlock: html.includes('AGENT_SETUP.md'), risks: /id="risks"/.test(html) };
        }
    }
    const canonOk = Object.entries(canon).every(([p, c]) => c === `${SITE}${p}`) && new Set(Object.values(canon)).size === 12;
    // control: a broken JSON-LD must be caught by the same parser
    const brokenCaught = (() => { try { JSON.parse('{"@type":"SoftwareApplication","name":"x"'); return false; } catch { return true; } })();
    // Lighthouse accessibility, mobile (headless is fine for a11y; no GPU involved)
    const lh: Record<string, number | string> = {};
    for (const l of ['en', 'ru']) {
        try {
            const out = execSync(`npx -y lighthouse@12 "${SITE}/${l}/" --only-categories=accessibility --form-factor=mobile --screenEmulation.mobile --output=json --quiet --chrome-flags="--headless=new"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
            lh[l] = Math.round(JSON.parse(out).categories.accessibility.score * 100);
        } catch (e) { lh[l] = `error: ${String(e).slice(0, 120)}`; }
    }
    const pass = sitemap.status === 200 && (sitemap.body.match(/<loc>/g) ?? []).length === 12 && robots.status === 200 && robotsAllows && llms.status === 200 && ogSize?.w === 1200 && ogSize?.h === 630
        && canonOk && Object.values(ldTypes).every((t) => t.includes('SoftwareApplication') && !t.includes('<broken>')) && Object.values(contacts).every((c) => Object.values(c).every(Boolean)) && brokenCaught
        && Object.values(lh).every((v) => typeof v === 'number' && v >= 95);
    record('B4', { pass, sitemap: { status: sitemap.status, locs: (sitemap.body.match(/<loc>/g) ?? []).length }, robots: { status: robots.status, aiCrawlersAllowed: robotsAllows }, llms: llms.status, ogImage: ogSize, canonical: { ok: canonOk, pages: canon }, jsonLd: ldTypes, contacts, lighthouseA11yMobile: lh, control: { brokenJsonLdCaught: brokenCaught }, placeholders: 'checked by scripts/smoke-release.mjs on the live site (visible text)' });
}

// ------------------------------------------------------------------ B5 analytics (real Google hit after consent)
if (want('B5')) {
    const B = await launchVisible();
    const google: { url: string; status: number }[] = [];
    B.page.on('response', (r) => { if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(r.url())) google.push({ url: r.url().split('?')[0], status: r.status() }); });
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
    const after = { gaCookies: (await B.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).length, collectStatus: hit?.status() ?? null, collectHost: hit ? new URL(hit.url()).host : null, gtagLoaded: google.some((g) => /gtag\/js/.test(g.url) && g.status === 200) };
    await B.page.reload({ waitUntil: 'networkidle' });
    await B.page.waitForTimeout(1500);
    const reload = { banner: await B.page.locator('[aria-label="Analytics cookies"]').count(), gaCookies: (await B.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).length };
    await B.close();
    const pass = before.gaCookies === 0 && before.googleRequests === 0 && before.banner === 1 && beacon === 204 && after.gaCookies > 0 && after.collectStatus === 204 && after.gtagLoaded && reload.banner === 0 && reload.gaCookies > 0;
    record('B5', { pass, measurementId: 'G-E7X0ES0QBE', beforeConsent: { ...before, apiEvent: beacon }, acceptButton: acceptText, afterAccept: after, afterReload: reload, control: { beforeConsentGaCookies: before.gaCookies, googleRequestsBeforeConsent: before.googleRequests } });
}

console.log(JSON.stringify(summary));
