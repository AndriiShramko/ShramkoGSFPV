// Serve a release dist/ like deploy/nginx.conf does, with the ENFORCED CSP built from the release's
// csp-hashes.conf and the same policy text as nginx.conf, so the simulator can be tried under the
// real policy before it reaches the hub. Usage: node serve-csp.mjs <dist> <port>
// Every response also carries the Permissions-Policy of the nginx.conf location it would fall in (microphone=(self)
// on /{lang}/fly/ only), so the microphone rule of Fly by Sound's recorder is met locally as on the live site.
// API_PROXY=http://127.0.0.1:<port> sends /api/** to a local API the way nginx does (method, body, cookie, CSRF and
// cache headers in; status and headers out, streamed): without it /api/** answers 204. A browser download of an
// /api/ file then goes over plain HTTP, which a Playwright route.fulfill cannot do (Chromium cancels it).
// /api/session/ follows its nginx location: GET and POST only (else 403), bodies up to its client_max_body_size
// (else 413), no cookie or Authorization forwarded, every other request header forwarded (the upload's X-Session-Token and
// X-Chunk-Sha256 among them).
// NGINX_CONF=<file> takes the policies from another copy of the config (a control for the header checks).
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const dist = process.argv[2];
const port = Number(process.argv[3] ?? 5320);
const conf = readFileSync(join(dist, 'csp-hashes.conf'), 'utf8');
const hashes = new Map();
for (const line of conf.split('\n')) {
    const m = line.match(/^"([^"]+)"\s+"([^"]*)";/);
    if (m) hashes.set(m[1], m[2]);
}
// copied from deploy/nginx.conf ($gsfpv_csp_rest and the enforced script-src). NGINX_CONF=<file> reads another
// copy of the config instead: a check of the headers can then be run against the config it must catch (a control)
const nginx = readFileSync(process.env.NGINX_CONF ?? new URL('../../../deploy/nginx.conf', import.meta.url), 'utf8');
const rest = nginx.match(/map \$uri \$gsfpv_csp_rest \{\s*default "([^"]+)";/)[1];
// lane rc2: $gsfpv_rc_bridge (the Shramko RC bridge on ws://127.0.0.1) is filled in only for /{lang}/fly/, as nginx's map does
const rcBridge = nginx.match(/map \$uri \$gsfpv_rc_bridge \{\s*default "";\s*"~\^\/\(en\|es\|pl\|ru\)\/fly\/" "([^"]*)";/)?.[1] ?? '';
const restFor = (path) => rest.replace('$gsfpv_rc_bridge', /^\/(en|es|pl|ru)\/fly\//.test(path) ? rcBridge : '');
// the owner's admin page has its own location in nginx.conf (location ^~ /admin/): its own strict CSP in
// place of the site's, and try_files $uri /admin/index.html; mirrored here so /admin/ runs under the live policy
const adminCsp = nginx.match(/location \^~ \/admin\/ \{[^}]*?add_header Content-Security-Policy "([^"]+)" always;/)[1];
// Permissions-Policy: nginx sends it per location, and a page may ask for the microphone (Fly by Sound's
// recorder, the browser's speech recognition) only where it says microphone=(self): the /{lang}/fly/ location.
// Read from each location of the config, so a local run meets the live site's rule (a header copied by hand drifts).
const policyOf = (loc) => {
    const m = nginx.match(new RegExp(`location ${loc} \\{[^}]*?add_header Permissions-Policy "([^"]+)" always;`));
    if (!m) throw new Error(`nginx.conf has no Permissions-Policy in the location ${loc.replace(/\\/g, '')}`);
    return m[1];
};
const POLICY = {
    fly: policyOf('~ \\^/\\(en\\|es\\|pl\\|ru\\)/fly/'),
    assets: policyOf('~ \\^/\\(_next/static\\|fly/assets\\)/'),
    admin: policyOf('\\^~ /admin/'),
    site: policyOf('/')
};
/** The policy of the location nginx picks for this path: /{lang}/fly/, the hashed assets, the admin page, else `location /`. */
const policyFor = (path) => {
    if (/^\/(en|es|pl|ru)\/fly\//.test(path)) return POLICY.fly;
    if (/^\/(_next\/static|fly\/assets)\//.test(path)) return POLICY.assets;
    if (path.startsWith('/admin/')) return POLICY.admin;
    return POLICY.site;
};
/** The body of the nginx.conf location that starts with `header` (found by braces: limit_except has its own), or null. */
function locationBlock(header) {
    const at = nginx.indexOf(header);
    if (at < 0) return null;
    let depth = 0;
    for (let i = at + header.length - 1; i < nginx.length; i++) {
        if (nginx[i] === '{') depth++;
        else if (nginx[i] === '}' && --depth === 0) return nginx.slice(at + header.length, i);
    }
    return null;
}
// /api/session/ (location ^~ /api/session/ in nginx.conf) as the config has it: the methods limit_except lets through
// (GET lets HEAD through too), the largest body, and whether the visitor's cookie is cleared. A config without the
// location (the one before v0.12) gets no rules, so a check of these rules fails against it.
const sessionBlock = locationBlock('location ^~ /api/session/ {');
const SESSION = sessionBlock === null ? null : {
    methods: (() => {
        const m = sessionBlock.match(/limit_except\s+([A-Z ]+?)\s*\{/)?.[1];
        if (!m) return null;
        const list = m.split(/\s+/);
        return list.includes('GET') ? [...list, 'HEAD'] : list;
    })(),
    bodyMax: Number(sessionBlock.match(/client_max_body_size\s+(\d+)k;/)?.[1] ?? 0) * 1024,
    noCookie: /proxy_set_header\s+Cookie\s+"";/.test(sessionBlock)
};
const HOP = new Set(['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'x-forwarded-for']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    const policy = policyFor(p);
    if (p.startsWith('/api/')) {
        const session = SESSION !== null && p.startsWith('/api/session/') ? SESSION : null;
        if (session?.methods && !session.methods.includes(req.method ?? '')) { res.writeHead(403).end(); return; }
        if (session && session.bodyMax > 0 && Number(req.headers['content-length'] ?? 0) > session.bodyMax) { res.writeHead(413).end(); return; }
        const target = process.env.API_PROXY;
        if (!target) { res.writeHead(204).end(); return; }
        const headers = { 'x-forwarded-for': '198.51.100.1' };
        for (const k of ['content-type', 'content-length', 'cookie', 'x-csrf', 'if-none-match']) if (req.headers[k] && !(session?.noCookie && k === 'cookie')) headers[k] = req.headers[k];
        // /api/session/ in nginx clears Cookie and Authorization and passes every other header (proxy_pass's default): the upload's
        // X-Session-Token and X-Chunk-Sha256 must reach the API here as they do there
        if (session) for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !(k in headers) && !HOP.has(k) && k !== 'cookie' && k !== 'authorization') headers[k] = v;
        const up = httpRequest(new URL(req.url, target), { method: req.method, headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
        up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        req.pipe(up);
        return;
    }
    if (p === '/') { res.writeHead(302, { location: '/en/' }).end(); return; }
    // nginx `location = /fly/`: to the visitor's own language, the query kept (a Fly by Sound lesson link has no language in it,
    // v12-optin): the NEXT_LOCALE cookie, then the first language of Accept-Language (es, pl, ru, uk and be as ru), else en
    if (p === '/fly/') {
        const cookie = /(?:^|;\s*)NEXT_LOCALE=(en|es|pl|ru)(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
        const al = (req.headers['accept-language'] ?? '').trim().toLowerCase();
        const browser = /^es/.test(al) ? 'es' : /^pl/.test(al) ? 'pl' : /^(ru|uk|be)/.test(al) ? 'ru' : 'en';
        res.writeHead(302, { location: `/${cookie ?? browser}/fly/${url.search}`, 'cache-control': 'no-cache' }).end();
        return;
    }
    if (p === '/admin') { res.writeHead(301, { location: '/admin/' }).end(); return; }
    if (p.startsWith('/admin/')) {
        let file = join(dist, p);
        if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'admin', 'index.html');
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store',
            'content-security-policy': adminCsp, 'permissions-policy': policy, 'x-frame-options': 'DENY', 'x-csp-mode': 'admin' });
        res.end(readFileSync(file));
        return;
    }
    let file = join(dist, p);
    // nginx: try_files $uri $uri/ /$1/fly/index.html for /{locale}/fly/...
    if (existsSync(file) && statSync(file).isDirectory()) { file = join(file, 'index.html'); p = p.replace(/\/?$/, '/index.html'); }
    if (!existsSync(file)) {
        const m = p.match(/^\/(en|es|pl|ru)\/fly\//);
        if (m) { file = join(dist, m[1], 'fly', 'index.html'); p = `/${m[1]}/fly/index.html`; }
    }
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'permissions-policy': policy };
    if (file.endsWith('.html')) {
        const h = hashes.get(p) ?? hashes.get(p.replace(/index\.html$/, ''));
        if (h) headers['content-security-policy'] = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com ${h}; ${restFor(p)}`;
        else headers['content-security-policy-report-only'] = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com; ${restFor(p)}`;
        headers['x-csp-mode'] = h ? 'enforced' : 'report-only';
    }
    res.writeHead(200, headers);
    res.end(readFileSync(file));
}).listen(port, () => console.log(`csp server on ${port} for ${dist} (${hashes.size} hashed uris)`));
