// Serve a release dist/ like deploy/nginx.conf does, with the ENFORCED CSP built from the release's
// csp-hashes.conf and the same policy text as nginx.conf, so the simulator can be tried under the
// real policy before it reaches the hub. Usage: node serve-csp.mjs <dist> <port>
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createServer } from 'node:http';
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
// copied from deploy/nginx.conf ($gsfpv_csp_rest and the enforced script-src)
const nginx = readFileSync(new URL('../../../deploy/nginx.conf', import.meta.url), 'utf8');
const rest = nginx.match(/map \$uri \$gsfpv_csp_rest \{\s*default "([^"]+)";/)[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) { res.writeHead(204).end(); return; }
    if (p === '/') { res.writeHead(302, { location: '/en/' }).end(); return; }
    let file = join(dist, p);
    // nginx: try_files $uri $uri/ /$1/fly/index.html for /{locale}/fly/...
    if (existsSync(file) && statSync(file).isDirectory()) { file = join(file, 'index.html'); p = p.replace(/\/?$/, '/index.html'); }
    if (!existsSync(file)) {
        const m = p.match(/^\/(en|es|pl|ru)\/fly\//);
        if (m) { file = join(dist, m[1], 'fly', 'index.html'); p = `/${m[1]}/fly/index.html`; }
    }
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (file.endsWith('.html')) {
        const h = hashes.get(p) ?? hashes.get(p.replace(/index\.html$/, ''));
        if (h) headers['content-security-policy'] = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com ${h}; ${rest}`;
        else headers['content-security-policy-report-only'] = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com; ${rest}`;
        headers['x-csp-mode'] = h ? 'enforced' : 'report-only';
    }
    res.writeHead(200, headers);
    res.end(readFileSync(file));
}).listen(port, () => console.log(`csp server on ${port} for ${dist} (${hashes.size} hashed uris)`));
