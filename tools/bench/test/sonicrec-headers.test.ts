// Fly by Sound, step 1 (docs/wip/v12-feedback.md): the headers a recording page needs, as the local server of the
// simulator (tools/bench/scripts/serve-csp.mjs) sends them. It takes every header from deploy/nginx.conf, so a run
// on localhost meets the rule of the live site: microphone=(self) on /{lang}/fly/ only, media-src 'self' blob: in the
// CSP, and /api/session/ as nginx has it (GET and POST only, a body of at most 1100k, no cookie forwarded).
// Node only (a real server on a free port, a stub API behind it). The browser side of the same claims, getUserMedia
// and a blob: <audio> under these headers, is tools/bench/src/sonicrec-headers.ts. Every claim has a control: the
// same check run against a copy of the config as it was before v0.12 (NGINX_CONF) must fail it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NGINX_CONF, firstCutConf, makeDist, serveDist } from '../src/sonicrec-serve';
import type { Served } from '../src/sonicrec-serve';

const NGINX = readFileSync(NGINX_CONF, 'utf8');

let dist = '';
const toStop: Served[] = [];
const toClose: Server[] = [];

beforeAll(() => {
    dist = makeDist({
        'en/fly/index.html': '<!doctype html><html lang="en"><title>fly</title><script type="module" src="/fly/assets/app.js"></script>',
        'en/index.html': '<!doctype html><html lang="en"><title>landing</title>',
        'fly/assets/app.js': 'export {};',
        'admin/index.html': '<!doctype html><main id="admin"></main>'
    });
});

afterAll(async () => {
    for (const s of toStop) await s.stop();
    for (const s of toClose) await new Promise((r) => s.close(r));
    rmSync(dist, { recursive: true, force: true });
});

/** The text of the Permissions-Policy of a location of the config, found by its first line (a second reading, not serve-csp's own regex). */
function policyOfLocation(conf: string, header: string): string {
    const lines = conf.split('\n');
    const at = lines.findIndex((l) => l.trim() === header);
    expect(at, header).toBeGreaterThanOrEqual(0);
    for (let i = at + 1; i < lines.length; i++) {
        const m = /add_header Permissions-Policy "([^"]+)" always;/.exec(lines[i] as string);
        if (m) return m[1] as string;
        if ((lines[i] as string).startsWith('    }')) break;
    }
    throw new Error(`no Permissions-Policy in ${header}`);
}

async function head(port: number, path: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers }> {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });
    await r.arrayBuffer();
    return { status: r.status, headers: r.headers };
}

const mic = (policy: string | null): string | undefined => /(?:^|,\s*)microphone=\(([^)]*)\)/.exec(policy ?? '')?.[1];

/** Everything this step promises of the headers for one running server: what is wrong, empty when nothing is. */
async function headerProblems(port: number): Promise<string[]> {
    const out: string[] = [];
    const fly = await head(port, '/en/fly/');
    if (mic(fly.headers.get('permissions-policy')) !== 'self') out.push(`/en/fly/ microphone=(${mic(fly.headers.get('permissions-policy'))})`);
    // a deep link falls back to the simulator page in nginx (try_files ... /$1/fly/index.html)
    const deep = await head(port, '/en/fly/lesson/hall');
    if (mic(deep.headers.get('permissions-policy')) !== 'self') out.push(`/en/fly/lesson/hall microphone=(${mic(deep.headers.get('permissions-policy'))})`);
    const csp = fly.headers.get('content-security-policy') ?? '';
    if (!csp.includes("media-src 'self' blob:")) out.push('/en/fly/ CSP has no media-src blob:');
    for (const p of ['/en/', '/fly/assets/app.js', '/admin/']) {
        const r = await head(port, p);
        if (mic(r.headers.get('permissions-policy')) !== '') out.push(`${p} microphone=(${mic(r.headers.get('permissions-policy'))}) instead of ()`);
    }
    const del = await head(port, '/api/session/probe', { method: 'DELETE' });
    if (del.status !== 403) out.push(`DELETE /api/session/probe -> ${del.status} instead of 403`);
    const big = await head(port, '/api/session/probe/0', { method: 'POST', body: new Uint8Array(1100 * 1024 + 1) });
    if (big.status !== 413) out.push(`a 1100k + 1 body to /api/session/ -> ${big.status} instead of 413`);
    return out;
}

describe('serve-csp.mjs sends the headers nginx.conf has', () => {
    it('the Permissions-Policy of every response is the text of its nginx location: (self) for the microphone on the simulator only', async () => {
        const s = await serveDist(dist);
        toStop.push(s);
        const flyText = policyOfLocation(NGINX, 'location ~ ^/(en|es|pl|ru)/fly/ {');
        const siteText = policyOfLocation(NGINX, 'location / {');
        const assetsText = policyOfLocation(NGINX, 'location ~ ^/(_next/static|fly/assets)/ {');
        const adminText = policyOfLocation(NGINX, 'location ^~ /admin/ {');
        expect((await head(s.port, '/en/fly/')).headers.get('permissions-policy')).toBe(flyText);
        expect((await head(s.port, '/en/fly/anything/deep')).headers.get('permissions-policy')).toBe(flyText);
        expect((await head(s.port, '/en/')).headers.get('permissions-policy')).toBe(siteText);
        expect((await head(s.port, '/fly/assets/app.js')).headers.get('permissions-policy')).toBe(assetsText);
        expect((await head(s.port, '/admin/')).headers.get('permissions-policy')).toBe(adminText);
        expect(mic(flyText)).toBe('self');
        for (const text of [siteText, assetsText, adminText]) expect(mic(text)).toBe('');
        // nothing but the microphone differs between the simulator's policy and the site's
        expect(flyText.replace('microphone=(self)', 'microphone=()')).toBe(siteText);
        expect(await headerProblems(s.port)).toEqual([]);
    });

    it('the enforced CSP of a page carries media-src \'self\' blob: next to worker-src (the map both headers share)', async () => {
        const s = await serveDist(dist);
        toStop.push(s);
        const fly = await head(s.port, '/en/fly/');
        expect(fly.headers.get('x-csp-mode')).toBe('enforced');
        expect(fly.headers.get('content-security-policy')).toContain("worker-src 'self' blob:; media-src 'self' blob:; style-src");
        expect(fly.headers.get('content-security-policy-report-only')).toBeNull();
    });

    it('control: against the config as it was before v0.12 the same checks fail, each for its own reason', async () => {
        const conf = join(dist, 'nginx-first-cut.conf');
        const cut = firstCutConf(NGINX);
        expect(cut).not.toBe(NGINX);
        writeFileSync(conf, cut);
        const s = await serveDist(dist, { NGINX_CONF: conf });
        toStop.push(s);
        const problems = await headerProblems(s.port);
        expect(problems).toEqual([
            '/en/fly/ microphone=()',
            '/en/fly/lesson/hall microphone=()',
            '/en/fly/ CSP has no media-src blob:',
            'DELETE /api/session/probe -> 204 instead of 403',
            'a 1100k + 1 body to /api/session/ -> 204 instead of 413'
        ]);
    });
});

describe('/api/session/ through serve-csp.mjs with an API behind it', () => {
    it('forwards the method, the body and the query string, but not the cookie; /api/admin/ still gets its cookie', async () => {
        const seen: { url: string | undefined; method: string | undefined; headers: IncomingHttpHeaders; bytes: number }[] = [];
        const api = createServer((req, res) => {
            let bytes = 0;
            req.on('data', (b: Buffer) => { bytes += b.length; });
            req.on('end', () => {
                seen.push({ url: req.url, method: req.method, headers: req.headers, bytes });
                res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
            });
        });
        toClose.push(api);
        const apiPort = await new Promise<number>((resolve) => api.listen(0, '127.0.0.1', () => resolve((api.address() as { port: number }).port)));
        const s = await serveDist(dist, { API_PROXY: `http://127.0.0.1:${apiPort}` });
        toStop.push(s);
        const chunk = new Uint8Array(1024 * 1024).fill(7);
        const up = await fetch(`http://127.0.0.1:${s.port}/api/session/abcdefghijklmnopqrstuv/3?token=t0k`, { method: 'POST', body: chunk, headers: { cookie: 'a=b', 'content-type': 'application/octet-stream' } });
        expect(up.status).toBe(200);
        const adm = await fetch(`http://127.0.0.1:${s.port}/api/admin/me`, { headers: { cookie: 'sid=1' } });
        expect(adm.status).toBe(200);
        expect(seen).toHaveLength(2);
        expect(seen[0]).toMatchObject({ url: '/api/session/abcdefghijklmnopqrstuv/3?token=t0k', method: 'POST', bytes: 1024 * 1024 });
        expect(seen[0]?.headers['cookie']).toBeUndefined();
        expect(seen[1]?.headers['cookie']).toBe('sid=1');
        // a refused method never reaches the API
        const before = seen.length;
        expect((await head(s.port, '/api/session/x', { method: 'PUT', body: 'x' })).status).toBe(403);
        expect(seen.length).toBe(before);
    });
});
