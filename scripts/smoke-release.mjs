// Smoke test of a served release (CI: dist/ behind the production nginx.conf; also usable against
// the live site). No GPU needed: routing, locale redirects, headers, caching, broken links.
// Usage: node scripts/smoke-release.mjs <baseUrl>
import { createHash } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const problems = [];
const ok = [];
const cb = () => `cb=${Math.random().toString(36).slice(2)}`;

async function get(path, headers = {}) {
    const u = `${BASE}${path}${path.includes('?') ? '&' : '?'}${cb()}`;
    const r = await fetch(u, { redirect: 'manual', headers });
    const body = r.status === 200 ? await r.text() : '';
    return { r, body };
}
function expect(cond, msg) {
    (cond ? ok : problems).push(msg);
}
// same rule as scripts/build-release.mjs: executable inline scripts only, CR/CRLF read as LF
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
function inlineScriptHashes(html) {
    const out = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (/\ssrc\s*=/i.test(m[1])) continue;
        const type = (m[1].match(/\stype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ?? '').trim();
        if (!/^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma)script)$/i.test(type)) continue;
        const text = m[2].split(CR + LF).join(LF).split(CR).join(LF);
        out.push(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`);
    }
    return [...new Set(out)];
}

// locale redirect on "/"
for (const [hdr, want] of [[{}, '/en/'], [{ 'Accept-Language': 'pl-PL,pl;q=0.9' }, '/pl/'], [{ 'Accept-Language': 'pl', Cookie: 'NEXT_LOCALE=ru' }, '/ru/'], [{ 'Accept-Language': 'es-ES' }, '/es/']]) {
    const { r } = await get('/', hdr);
    expect(r.status === 302 && (r.headers.get('location') ?? '').endsWith(want), `/ ${JSON.stringify(hdr)} -> ${r.status} ${r.headers.get('location')} (want ${want})`);
}
{
    const { r } = await get('/fly/', { 'Accept-Language': 'ru' });
    expect(r.status === 302 && (r.headers.get('location') ?? '').includes('/ru/fly/'), `/fly/ -> ${r.status} ${r.headers.get('location')}`);
}

const pages = [];
for (const l of ['en', 'es', 'pl', 'ru']) {
    for (const p of [`/${l}/`, `/${l}/privacy/`, `/${l}/licenses/`, `/${l}/fly/`]) {
        const { r, body } = await get(p);
        expect(r.status === 200, `${p} -> ${r.status}`);
        expect(new RegExp(`<html[^>]*lang="${l}"`).test(body), `${p} has lang=${l}`);
        const seen = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/\s[a-zA-Z_:][-a-zA-Z0-9_:.]*=/g, ' ');
        expect(!/\b(undefined|TODO|PLACEHOLDER)\b|[Ll]orem ipsum/.test(seen), `${p} has no placeholder text`); // Spanish "todo" is a word
        expect(r.headers.get('x-content-type-options') === 'nosniff', `${p} nosniff`);
        expect(!!r.headers.get('referrer-policy'), `${p} referrer-policy`);
        expect(!!r.headers.get('x-frame-options'), `${p} x-frame-options`);
        expect((r.headers.get('permissions-policy') ?? '').includes('hid=(self)'), `${p} permissions-policy hid=(self)`);
        // either header counts as "has a CSP"; an HTML page must get the enforced one, and it must
        // list the hash of every inline script actually served (a stale map after a release switch
        // without an nginx reload shows up here, before a browser blocks the page)
        const csp = r.headers.get('content-security-policy') ?? '';
        expect(!!csp || !!r.headers.get('content-security-policy-report-only'), `${p} has a CSP header`);
        expect(csp.includes("script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com") && csp.includes("object-src 'none'"), `${p} CSP enforced`);
        const missing = inlineScriptHashes(body).filter((h) => !csp.includes(h));
        expect(missing.length === 0, `${p} CSP lists all ${inlineScriptHashes(body).length} inline script hashes${missing.length ? ` (missing ${missing.length})` : ''}`);
        pages.push({ p, body });
    }
}
for (const p of ['/sitemap.xml', '/robots.txt', '/llms.txt', '/og.png', '/fly/showcase.json']) {
    const { r } = await get(p);
    expect(r.status === 200, `${p} -> ${r.status}`);
}
// hashed simulator asset: immutable
const flyHtml = pages.find((x) => x.p === '/en/fly/')?.body ?? '';
const asset = flyHtml.match(/\/fly\/assets\/[^"']+\.js/)?.[0];
if (asset) {
    const { r } = await get(asset);
    expect(r.status === 200 && (r.headers.get('cache-control') ?? '').includes('immutable'), `${asset} immutable`);
} else problems.push('no /fly/assets/*.js referenced from /en/fly/');
// internal links on the EN landing
const en = pages.find((x) => x.p === '/en/')?.body ?? '';
const links = [...new Set([...en.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]))].filter((h) => !h.startsWith('//'));
for (const h of links) {
    const { r } = await get(h);
    expect([200, 301, 302].includes(r.status), `link ${h} -> ${r.status}`);
}

console.log(`${ok.length} checks passed`);
if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
